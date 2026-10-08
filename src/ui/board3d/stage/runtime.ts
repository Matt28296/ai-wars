// The 3D stage's renderer: one WebGLRenderer on one canvas inside a host element, the scene (lights, table, terrain, unit views, fx), the
// camera rig and the post-processing chain. React owns only the DOM around it (Stage3D.tsx); this class owns everything on the GPU and
// is told what to show by `setView`. Every animation frame it samples the SAME transition plan the 2D stage does (transition.ts), maps
// the sample to the picture (mapping.ts) and draws.
//
// Post (art-direction.md): bloom with a high threshold -> tone mapping and sRGB (OutputPass) -> FXAA -> a light vignette.
import {
  ACESFilmicToneMapping, BoxGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial, PCFShadowMap,
  PerspectiveCamera, SRGBColorSpace, Scene, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import type { Weather } from '../../../game/aw';
import { sampleTransition } from '../../watch/transition';
import type { BannerSample, CutInSample, TransitionPlan, TransitionSample } from '../../watch/transition';
import { homeFacings } from '../../watch/unitview';
import type { Facing } from '../../watch/unitview';
import type { Timeline, ViewFrame } from '../../watch/timeline';
import type { CreateFx, CreateTerrain, CreateUnitView, FxView, TerrainView } from '../contract';
import { TILE } from '../contract';
import { createFx as defaultFx } from '../fx';
import { createTerrain as defaultTerrain } from '../terrain';
import { createUnitView as defaultUnits } from '../units';
import { UI } from '../palette';
import { safeFrame } from './guard';
import {
  EXPOSURE, KEY_LUX, SHADOW_MAP_SIZE, fitShadow, lightingFor, lightningFlash, stormMixFor, sunDirection,
} from './lighting';
import { analyseStep, captureProgress, facingHeading, mapSignature, mapStage, surfaceY, toFxItems, toNumberItems } from './mapping';
import type { StageState, StepInfo, WorldEnv } from './mapping';
import { UnitRegistry } from './registry';
import { CameraRig, FOV_DEG, MAX_ZOOM_LEVEL, defaultZoomLevel, easeToward, stepZoom, wheelToSteps } from './rig';

export interface Overlay { banner: BannerSample | null; cutIn: CutInSample | null }

export interface StageHooks {
  /** A plan has run to its end (called once per plan). */
  onDone(plan: TransitionPlan): void;
  /** The banner sweep and the power cut-in are DOM; this is what they should draw now, or null when neither is up. */
  onOverlay(overlay: Overlay | null): void;
  /** The zoom step changed (0 widest). */
  onZoom?(level: number): void;
  /** The GPU side cannot go on (no context, or it was lost). The page falls back to the flat board. */
  onFail(reason: string): void;
}

export interface StageView {
  timeline: Timeline;
  step: number;
  plan: TransitionPlan | null;
  reducedMotion: boolean;
}

export interface StageModules {
  createTerrain: CreateTerrain;
  createUnitView: CreateUnitView;
  createFx: CreateFx;
}

/** FXAA is on: the renderer's own antialiasing is therefore off (art-direction.md "Tone and post"). */
const FXAA_ON = true;
/** The effects kit's look was tuned with these (bloom, then OutputPass), so only emissives and effects glow. */
const BLOOM = { strength: 0.6, radius: 0.4, threshold: 0.9 } as const;
const VIGNETTE = { offset: 0.85, darkness: 0.7 } as const;
const MAX_PIXEL_RATIO = 2;

export class StageRuntime {
  readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly fxaa: ShaderPass;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV_DEG, 1.6, 0.1, 200);
  private readonly hemi = new HemisphereLight(0xcfe3ff, 0x5b4a3a, 1);
  private readonly sun = new DirectionalLight(0xfff0d6, KEY_LUX);
  private readonly unitsGroup = new Group();
  private readonly rig = new CameraRig();
  private readonly registry: UnitRegistry;
  private readonly modules: StageModules;
  private readonly fx: FxView;
  private readonly tmp = new Vector3();
  private readonly ro: ResizeObserver;
  private table: Mesh<BoxGeometry, MeshStandardMaterial> | null = null;
  private terrain: TerrainView | null = null;
  private mapSig = '';
  private appliedFrame: ViewFrame | null = null;

  private view: StageView | null = null;
  private info: StepInfo | null = null;
  private homes: Facing[] = [];
  private planStart = 0;
  private planDone = false;
  private overlayUp = false;
  private stormMix = 0;
  private time = 0;
  private last = 0;
  private raf = 0;
  /** The loop has stopped (disposed, or it failed). */
  private disposed = false;
  private cleaned = false;
  /** The viewer chose a zoom step themselves: the size-based default no longer applies. */
  private userZoomed = false;
  private wheelAcc = 0;
  private wheelLockUntil = 0;
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(host: HTMLElement, private readonly hooks: StageHooks, modules: Partial<StageModules> = {}) {
    this.host = host;
    this.modules = { createTerrain: defaultTerrain, createUnitView: defaultUnits, createFx: defaultFx, ...modules };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'aww-stage3d-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: !FXAA_ON, powerPreference: 'high-performance', stencil: false });
    } catch (err) {
      this.canvas.remove();
      throw err;
    }
    const r = this.renderer;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = EXPOSURE;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap; // three 0.186 removed PCFSoftShadowMap: PCFShadowMap is the soft-filtered one now

    this.scene.background = new Color(UI.void);
    this.scene.add(this.hemi);
    const dir = sunDirection();
    this.sun.position.set(dir.x * 20, dir.y * 20, dir.z * 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.unitsGroup.name = 'units';
    this.scene.add(this.unitsGroup);

    this.registry = new UnitRegistry(this.modules.createUnitView);
    this.fx = this.modules.createFx();
    this.scene.add(this.fx.group);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.enabled = FXAA_ON;
    this.composer.addPass(this.fxaa);
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = VIGNETTE.offset;
    vignette.uniforms.darkness.value = VIGNETTE.darkness;
    this.composer.addPass(vignette);

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.canvas.style.touchAction = 'pan-y';
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------ what to show

  setView(view: StageView): void {
    if (this.disposed) return;
    const prev = this.view;
    this.view = view;
    const step = view.timeline.steps[Math.min(view.step, view.timeline.last)];
    const before = view.timeline.steps[Math.max(0, step.index - 1)];
    if (!prev || prev.timeline !== view.timeline) this.homes = homeFacings(view.timeline.steps[0].frame);
    const planChanged = !prev || prev.plan !== view.plan;
    if (planChanged) {
      this.planStart = performance.now();
      this.planDone = false;
    }

    const frame = safeFrame(step.frame).frame;
    this.ensureTerrain(frame);
    if (this.appliedFrame !== step.frame) {
      this.appliedFrame = step.frame;
      this.applyFrame(frame);
    }
    if (!prev || prev.step !== view.step || prev.timeline !== view.timeline || planChanged) {
      this.info = analyseStep(before.frame, step.frame, step.events, view.plan);
      const snap = !view.plan || view.plan.durationMs <= 0;
      this.rig.focusOn(step.index > 0 ? this.info.focus ?? null : null, snap);
    }
  }

  private ensureTerrain(frame: ViewFrame): void {
    const sig = mapSignature(frame);
    if (sig === this.mapSig && this.terrain) return;
    this.mapSig = sig;
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
    }
    this.terrain = this.modules.createTerrain({
      width: frame.width,
      height: frame.height,
      terrainAt: (x, y) => frame.tiles[y][x].terrain,
      ownerAt: (x, y) => frame.tiles[y][x].owner,
      factionOf: (p) => frame.players[p]?.faction ?? null,
      weather: frame.weather,
    });
    this.scene.add(this.terrain.group);
    this.rig.setBoard({ width: frame.width, height: frame.height });
    this.buildTable(frame);
    this.fitSun(frame);
    this.stormMix = stormMixFor(frame.weather);
  }

  /** The command table the diorama stands on: a dark slab a little larger than the board, below the water line. */
  private buildTable(frame: ViewFrame): void {
    if (this.table) {
      this.scene.remove(this.table);
      this.table.geometry.dispose();
      this.table.material.dispose();
    }
    const margin = 0.7;
    const geo = new BoxGeometry(frame.width * TILE + margin * 2, 0.4, frame.height * TILE + margin * 2);
    const mat = new MeshStandardMaterial({ color: 0x141b25, roughness: 0.75, metalness: 0.25 });
    const table = new Mesh(geo, mat);
    table.position.set((frame.width * TILE) / 2, -0.2 - 0.3, (frame.height * TILE) / 2);
    table.receiveShadow = true;
    table.name = 'table';
    this.scene.add(table);
    this.table = table;
  }

  private fitSun(frame: ViewFrame): void {
    const fit = fitShadow({ width: frame.width, height: frame.height });
    const cam = this.sun.shadow.camera;
    this.sun.position.set(fit.position.x, fit.position.y, fit.position.z);
    this.sun.target.position.set(fit.target.x, fit.target.y, fit.target.z);
    this.sun.target.updateMatrixWorld();
    cam.left = fit.left;
    cam.right = fit.right;
    cam.top = fit.top;
    cam.bottom = fit.bottom;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.updateProjectionMatrix();
  }

  /** Owners, capture progress, sight and weather change per step, never per animation frame. */
  private applyFrame(frame: ViewFrame): void {
    const t = this.terrain;
    if (!t) return;
    t.setOwners((x, y) => frame.tiles[y]?.[x]?.owner ?? null);
    t.setCapture((x, y) => captureProgress(frame.tiles[y]?.[x]?.capture));
    t.setVisible((x, y) => frame.visible[y]?.[x] ?? true);
    t.setWeather(frame.weather);
  }

  // ------------------------------------------------------------ frame loop

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    try {
      this.frame(now, dt);
    } catch (err) {
      this.hooks.onFail(err instanceof Error ? err.message : String(err));
      this.disposed = true;
      cancelAnimationFrame(this.raf);
    }
  };

  private env(): WorldEnv {
    const t = this.terrain;
    const w = this.view?.timeline.steps[0].frame.width ?? 1;
    const h = this.view?.timeline.steps[0].frame.height ?? 1;
    return {
      surface: (x, y) => (t ? surfaceY((cx, cy) => t.heightAt(cx, cy), x, y, w, h) : 0),
      muzzleOf: (id, out) => {
        const v = this.registry.view(id);
        if (!v) return null;
        v.object.updateMatrixWorld(true);
        return v.muzzleWorld(out);
      },
    };
  }

  private frame(now: number, dt: number): void {
    const view = this.view;
    const terrain = this.terrain;
    if (!view || !terrain || this.canvas.clientWidth === 0) return;
    const step = view.timeline.steps[Math.min(view.step, view.timeline.last)];
    const before = view.timeline.steps[Math.max(0, step.index - 1)];
    const info = this.info;
    if (!info) return;

    // The plan's clock. It runs from the moment the plan arrived; when it ends the step rests on its own frame.
    const plan = view.plan;
    let sample: TransitionSample | null = null;
    let t = 0;
    if (plan && plan.durationMs > 0 && !this.planDone) {
      t = now - this.planStart;
      if (t >= plan.durationMs) {
        this.planDone = true;
        this.hooks.onDone(plan);
      } else {
        sample = sampleTransition(plan, t);
      }
    }
    const reduced = view.reducedMotion;
    const state = mapStage({ frame: step.frame, prev: before.frame, plan, sample, t, info, step: step.index });
    this.syncUnits(state, dt, !reduced && sample !== null);
    this.drawFx(state);
    this.overlay(sample);

    terrain.update(dt, this.time);
    this.registry.update(dt, this.time);
    this.fx.update(dt, this.time);
    this.updateLight(step.frame.weather, dt, reduced);
    this.updateCamera(dt, reduced, state.shake);
    this.composer.render(dt);
  }

  private syncUnits(state: StageState, dt: number, smooth: boolean): void {
    const owners = new Map<number, number>();
    for (const u of state.units) owners.set(u.id, u.unit.owner);
    const g = this.unitsGroup;
    this.registry.sync(
      state.units.map((u) => ({ id: u.id, type: u.unit.type, faction: u.faction })),
      (id) => facingHeading(this.homes[owners.get(id) ?? 0] ?? 'right'),
      (v) => g.add(v.object),
      (v) => g.remove(v.object),
    );
    const env = this.env();
    for (const u of state.units) {
      const view = this.registry.view(u.id);
      if (!view) continue;
      const heading = this.registry.heading(u.id, u.heading, dt, smooth);
      const y = env.surface(u.x, u.y);
      // A destroyed unit sinks and shrinks away under its explosion; its materials belong to its module and are left alone.
      const sink = u.ghost ? u.fade : 0;
      view.object.position.set((u.x + 0.5) * TILE, y - sink * 0.12, (u.y + 0.5) * TILE);
      view.object.scale.setScalar(u.ghost ? Math.max(0.001, 1 - sink * sink * 0.9) : 1);
      this.registry.look(u.id, { ...u.look, heading });
      this.registry.pose(u.id, u.pose, u.poseT);
    }
  }

  private drawFx(state: StageState): void {
    const env = this.env();
    this.fx.draw(toFxItems(state.fx, env));
    this.fx.numbers(toNumberItems(state.numbers, env));
  }

  private overlay(sample: TransitionSample | null): void {
    const up = !!(sample && (sample.banner || sample.cutIn));
    if (up && sample) this.hooks.onOverlay({ banner: sample.banner, cutIn: sample.cutIn });
    else if (this.overlayUp) this.hooks.onOverlay(null);
    this.overlayUp = up;
  }

  private updateLight(weather: Weather, dt: number, reduced: boolean): void {
    this.stormMix = easeToward(this.stormMix, stormMixFor(weather), dt, 1.2, reduced);
    const flash = lightningFlash(this.time, weather === 'ionstorm' && !reduced);
    const l = lightingFor(this.stormMix, flash);
    this.hemi.color.setHex(l.sky);
    this.hemi.groundColor.setHex(l.ground);
    this.hemi.intensity = l.hemiIntensity;
    this.sun.color.setHex(l.sun);
    this.sun.intensity = l.sunIntensity;
    this.renderer.toneMappingExposure = l.exposure;
    (this.scene.background as Color).setHex(l.background);
  }

  private updateCamera(dt: number, reduced: boolean, shake: number): void {
    this.rig.update(dt, !reduced);
    const pose = this.rig.pose(0);
    const cam = this.camera;
    let sx = 0;
    let sz = 0;
    if (shake > 0 && !reduced) {
      const k = shake * 0.1;
      sx = (Math.sin(this.time * 61) + Math.sin(this.time * 97 + 1)) * 0.5 * k;
      sz = (Math.sin(this.time * 73 + 2) + Math.sin(this.time * 113)) * 0.5 * k;
    }
    cam.position.set(pose.position.x + sx, pose.position.y, pose.position.z + sz);
    cam.near = pose.near;
    cam.far = pose.far;
    cam.lookAt(this.tmp.set(pose.target.x + sx, pose.target.y, pose.target.z + sz));
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ size

  private resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, Math.floor(this.host.clientWidth));
    const h = Math.max(1, Math.floor(this.host.clientHeight));
    const pr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.rig.setAspect(w / h);
    if (!this.userZoomed) this.setZoomLevel(defaultZoomLevel(w), true);
  }

  private setZoomLevel(level: number, snap: boolean): void {
    if (level === this.rig.level) return;
    this.rig.setLevel(level, snap);
    this.canvas.style.touchAction = this.rig.level > 0 ? 'none' : 'pan-y';
    this.hooks.onZoom?.(this.rig.level);
  }

  // ------------------------------------------------------------ camera input (camera only: nothing here selects or commands a unit)

  zoomStep(dir: 1 | -1): void {
    this.userZoomed = true;
    this.setZoomLevel(stepZoom(this.rig.level, dir), false);
  }

  get zoomLevel(): number { return this.rig.level; }
  get maxZoomLevel(): number { return MAX_ZOOM_LEVEL; }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const now = performance.now();
    if (now < this.wheelLockUntil) return;
    const r = wheelToSteps(this.wheelAcc, e.deltaY, e.deltaMode);
    this.wheelAcc = r.acc;
    if (r.dir !== 0) {
      this.wheelLockUntil = now + 140;
      this.zoomStep(r.dir);
    }
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    const tag = t?.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select' || (tag === 'input' && (t as HTMLInputElement).type !== 'range')) return;
    if (e.key === '+' || e.key === '=') this.zoomStep(1);
    else if (e.key === '-' || e.key === '_') this.zoomStep(-1);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.rig.pan(e.clientX - d.x, e.clientY - d.y, this.canvas.clientHeight);
    d.x = e.clientX;
    d.y = e.clientY;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.drag?.id === e.pointerId) {
      this.canvas.releasePointerCapture?.(e.pointerId);
      this.drag = null;
    }
  };

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.hooks.onFail('the WebGL context was lost');
  };

  // ------------------------------------------------------------ teardown

  dispose(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.registry.dispose((v) => this.unitsGroup.remove(v.object));
    this.fx.dispose();
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
      this.terrain = null;
    }
    if (this.table) {
      this.table.geometry.dispose();
      this.table.material.dispose();
      this.table = null;
    }
    this.sun.shadow.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
