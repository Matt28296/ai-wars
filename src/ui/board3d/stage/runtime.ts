// The 3D stage's renderer: one WebGLRenderer on one canvas inside a host element, the scene (lights, table, terrain, unit views, fx), the
// camera rig and the post-processing chain. React owns only the DOM around it (Stage3D.tsx); this class owns everything on the GPU and
// is told what to show by `setView`. Every animation frame it samples the SAME transition plan the 2D stage does (transition.ts), maps
// the sample to the picture (mapping.ts) and draws.
//
// Post (art-direction.md): bloom with a high threshold -> tone mapping and sRGB (OutputPass) -> FXAA -> a light vignette.
//
// G8b added to the core: the war-room table (table.ts), the match intro (intro.ts), the ion-storm static (storm.ts), the occupied-
// property call to the terrain (occupancy.ts), the effects kit's reduced-motion switch, and a tighter framing (rig.ts).
// G10 added the battle's feel: the movement trails (drawn by the effects kit from the plan's move beats, mapping.ts), the attack camera
// (attack.ts), the explosion's shake (shake.ts) and the power sweep (sweep.ts). The camera's three layers (the intro, the attack camera,
// the shake) all give way to the viewer: none runs under reduced motion, and none of the attack camera once the viewer has taken the
// camera by zooming or dragging.
import {
  ACESFilmicToneMapping, Color, DirectionalLight, Group, HemisphereLight, PCFShadowMap,
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
import { createFxKit } from '../fx';
import { createTerrain as defaultTerrain } from '../terrain';
import { createUnitView as defaultUnits } from '../units';
import { UI } from '../palette';
import { safeFrame } from './guard';
import {
  EXPOSURE, KEY_LUX, SHADOW_MAP_SIZE, fitShadow, lightingFor, lightningFlash, stormMixFor, sunDirection,
} from './lighting';
import { analyseStep, captureProgress, facingHeading, hashSeed, mapSignature, mapStage, surfaceY, toFxItems, toNumberItems } from './mapping';
import type { StageState, StepInfo, WorldEnv } from './mapping';
import { attackPose } from './attack';
import type { P3 } from './attack';
import { SHAKE_AMPLITUDE, shakeOffset } from './shake';
import type { ShakeOffset } from './shake';
import { PowerSweep } from './sweep';
import type { SweepStats } from './sweep';
import { Intro, introAction } from './intro';
import { OCCUPIED_SNAP_DT_SEC, occupiedPredicate, occupiedTiles, sameTiles } from './occupancy';
import { UnitRegistry } from './registry';
import { CameraRig, FOV_DEG, MAX_ZOOM_LEVEL, defaultZoomLevel, easeToward, stepZoom, wheelToSteps } from './rig';
import { createStormStatic } from './storm';
import type { StormStats, StormStatic } from './storm';
import { createTable } from './table';
import type { TableStats, TableView } from './table';

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
  /** The GPU side. Tests inject a stand-in so the whole stage can run in node; the page always uses the real one. */
  createRenderer: (canvas: HTMLCanvasElement) => WebGLRenderer;
}

/** Plain numbers for tests and the dev gallery: what the core is doing now. */
export interface StageDebug {
  intro: { active: boolean; progress: number };
  /** The camera's world position, its pitch down from horizontal (degrees) and its distance to what it looks at. */
  camera: { x: number; y: number; z: number; pitchDeg: number; distance: number };
  storm: StormStats | null;
  table: TableStats | null;
  zoomLevel: number;
  reducedMotion: boolean;
  /** How strongly the attack camera applies this frame (0 when it is off, was lowered to keep the units in view, or no attack is running). */
  attack: number;
  /** The camera shake applied this frame, as a fraction of its peak: 0 when none runs. */
  shake: number;
  /** The power sweep: whether it is up and what it shows. */
  sweep: SweepStats;
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
  private table: TableView | null = null;
  private storm: StormStatic | null = null;
  private terrain: TerrainView | null = null;
  private readonly intro = new Intro();
  private readonly sweep = new PowerSweep();
  private mapSig = '';
  private appliedFrame: ViewFrame | null = null;
  /** The tiles the terrain was last told are occupied, and whether it must be told again (a new terrain starts with none). */
  private occupied: ReadonlySet<number> = new Set();
  private occupiedDirty = true;
  /** The view just jumped (a scrub, a rewind, another viewer's timeline): the next occupancy change lands at once instead of easing. */
  private occupiedSnap = false;
  private boardSize = { width: 1, height: 1 };
  /** The reduced-motion setting last handed to the effects kit (null: never). */
  private fxReduced: boolean | null = null;
  private flash = 0;
  private viewportPx = 800;
  private lastPose: { x: number; y: number; z: number; pitchDeg: number; distance: number } = { x: 0, y: 0, z: 0, pitchDeg: 0, distance: 0 };

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
  /** The viewer zoomed or dragged: the camera is theirs, and the attack camera stays off (the intro's rule). */
  private cameraTaken = false;
  /** What the attack camera and the shake did to the last frame (for debug()). */
  private attackApplied = 0;
  private shakeApplied = 0;
  private readonly shakeOut: ShakeOffset = { x: 0, y: 0 };
  private wheelAcc = 0;
  private wheelLockUntil = 0;
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(host: HTMLElement, private readonly hooks: StageHooks, modules: Partial<StageModules> = {}) {
    this.host = host;
    this.modules = {
      createTerrain: defaultTerrain,
      createUnitView: defaultUnits,
      createFx: () => createFxKit(),
      createRenderer: (canvas) => new WebGLRenderer({ canvas, antialias: !FXAA_ON, powerPreference: 'high-performance', stencil: false }),
      ...modules,
    };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'aww-stage3d-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    try {
      this.renderer = this.modules.createRenderer(this.canvas);
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
    this.scene.add(this.sweep.mesh);

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
    this.followReducedMotion(view.reducedMotion);
    const jumped = !prev || prev.step !== view.step || prev.timeline !== view.timeline;
    if (jumped && !(view.plan && view.plan.durationMs > 0)) this.occupiedSnap = true;
    const intro = introAction({
      first: !prev,
      step: step.index,
      reducedMotion: view.reducedMotion,
      timelineChanged: !!prev && prev.timeline !== view.timeline,
      stepChanged: !!prev && prev.step !== view.step,
      planned: !!view.plan && view.plan.durationMs > 0,
      active: this.intro.active,
    });
    if (intro === 'start') this.intro.start();
    else if (intro === 'skip') this.intro.skip();

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

  /** The effects kit halves its particles under reduced motion. It is told on the first view and whenever the setting changes. */
  private followReducedMotion(reduced: boolean): void {
    if (this.fxReduced === reduced) return;
    this.fxReduced = reduced;
    const kit = this.fx as FxView & { setReducedMotion?: (on: boolean) => void };
    if (typeof kit.setReducedMotion === 'function') kit.setReducedMotion(reduced);
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
    this.boardSize = { width: frame.width, height: frame.height };
    this.occupied = new Set();
    this.occupiedDirty = true;
    this.rig.setBoard(this.boardSize);
    this.buildSetting(frame, sig);
    this.fitSun(frame);
    this.stormMix = stormMixFor(frame.weather);
  }

  /** The war-room table the diorama stands on and the ion-storm static over it: both are made from the board's size alone. */
  private buildSetting(frame: ViewFrame, signature: string): void {
    this.table?.dispose();
    this.storm?.dispose();
    const board = { width: frame.width, height: frame.height };
    this.table = createTable(board);
    this.scene.add(this.table.group);
    this.storm = createStormStatic(board, hashSeed(signature));
    this.scene.add(this.storm.points);
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
    this.syncOccupancy(state);
    this.drawFx(state);
    this.overlay(sample);
    this.updateSweep(state, reduced);

    terrain.update(dt, this.time);
    this.registry.update(dt, this.time);
    this.fx.update(dt, this.time);
    this.updateLight(step.frame.weather, dt, reduced);
    this.intro.update(dt);
    this.updateCamera(dt, reduced, state);
    this.updateSetting(reduced);
    this.composer.render(dt);
  }

  /**
   * Tells the terrain which tiles have a live unit on them, whenever that set changes (and once for every new terrain). The set is read
   * from the units drawn this frame, so ghosts of dying units and units the viewer cannot see never count.
   *
   * The terrain eases its low form inside update(dt). The first call on a board, and any change that comes with a scrub or a step jump,
   * is followed at once by an update with a long dt so the buildings snap to their state; during playback the real frame dt eases them.
   */
  private syncOccupancy(state: StageState): void {
    const t = this.terrain;
    if (!t) return;
    const snap = this.occupiedSnap;
    this.occupiedSnap = false;
    const next = occupiedTiles(state.units, this.boardSize.width, this.boardSize.height);
    if (!this.occupiedDirty && sameTiles(next, this.occupied)) return;
    const first = this.occupiedDirty;
    this.occupied = next;
    this.occupiedDirty = false;
    t.setOccupied(occupiedPredicate(next, this.boardSize.width));
    if (first || snap) t.update(OCCUPIED_SNAP_DT_SEC, this.time);
  }

  /** The table follows the camera and the weather; the storm static fades with the storm mix and drifts on the stage's clock. */
  private updateSetting(reduced: boolean): void {
    this.table?.update(this.camera.position, this.stormMix, this.flash);
    this.storm?.update(this.time, this.stormMix, reduced, this.viewportPx, FOV_DEG);
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
    this.flash = flash;
    const l = lightingFor(this.stormMix, flash);
    this.hemi.color.setHex(l.sky);
    this.hemi.groundColor.setHex(l.ground);
    this.hemi.intensity = l.hemiIntensity;
    this.sun.color.setHex(l.sun);
    this.sun.intensity = l.sunIntensity;
    this.renderer.toneMappingExposure = l.exposure;
    (this.scene.background as Color).setHex(l.background);
  }

  /** The power sweep crosses the board in the direction the commander's own side faces; under reduced motion it is a plain fade. */
  private updateSweep(state: StageState, reduced: boolean): void {
    const spec = state.sweep;
    const facing = spec ? this.homes[spec.player] ?? 'right' : 'right';
    this.sweep.update(spec, { width: this.boardSize.width, height: this.boardSize.height, direction: facing === 'left' ? -1 : 1, reduced });
  }

  /** The world points the attack camera must keep in the picture: both units' feet, heads and the corners of their tiles. */
  private attackPoints(state: StageState): { keep: P3[]; mid: { x: number; z: number } } | null {
    const a = state.attack;
    if (!a) return null;
    const env = this.env();
    const keep: P3[] = [];
    for (const c of [a.from, a.to]) {
      const x = (c.x + 0.5) * TILE;
      const z = (c.y + 0.5) * TILE;
      const y = env.surface(c.x, c.y);
      keep.push({ x, y: y + 0.05, z }, { x, y: y + 0.65, z });
      for (const sx of [-0.45, 0.45]) for (const sz of [-0.45, 0.45]) keep.push({ x: x + sx, y: y + 0.05, z: z + sz });
    }
    return { keep, mid: { x: ((a.from.x + a.to.x) / 2 + 0.5) * TILE, z: ((a.from.y + a.to.y) / 2 + 0.5) * TILE } };
  }

  private updateCamera(dt: number, reduced: boolean, state: StageState): void {
    this.rig.update(dt, !reduced);
    const framing = this.intro.framing();
    let pose = this.rig.pose(0, framing);
    let pitchDeg = framing.pitchDeg;
    // the attack camera: a layer over the rig, off under reduced motion, during the intro, and once the viewer has taken the camera
    this.attackApplied = 0;
    if (state.attack && !reduced && !this.cameraTaken && !this.intro.active) {
      const w = this.attackPoints(state);
      if (w) {
        const r = attackPose({
          board: this.boardSize, aspect: this.camera.aspect, zoom: this.rig.zoom, target: this.rig.target, mid: w.mid,
          keep: w.keep, strength: state.attack.strength, restDistance: pose.distance,
        });
        pose = r.pose;
        pitchDeg = r.pitchDeg;
        this.attackApplied = r.strength;
      }
    }
    // the shake: a small, decaying move of the whole picture across and up, sized to the camera's distance so it reads the same at any zoom
    let ox = 0;
    let oy = 0;
    this.shakeApplied = 0;
    if (state.shake && !reduced) {
      const o = shakeOffset(state.shake.seed, state.shake.u, state.shake.weight, this.shakeOut);
      const amp = SHAKE_AMPLITUDE * pose.distance;
      ox = o.x * amp;
      oy = o.y * amp;
      this.shakeApplied = Math.max(Math.abs(o.x), Math.abs(o.y));
    }
    const pitch = (pitchDeg * Math.PI) / 180;
    const dx = ox;
    const dy = oy * Math.cos(pitch);
    const dz = -oy * Math.sin(pitch);
    const cam = this.camera;
    cam.position.set(pose.position.x + dx, pose.position.y + dy, pose.position.z + dz);
    cam.near = pose.near;
    cam.far = pose.far;
    cam.lookAt(this.tmp.set(pose.target.x + dx, pose.target.y + dy, pose.target.z + dz));
    cam.updateProjectionMatrix();
    const flat = Math.hypot(pose.position.x - pose.target.x, pose.position.z - pose.target.z);
    this.lastPose = {
      x: pose.position.x, y: pose.position.y, z: pose.position.z, distance: pose.distance,
      pitchDeg: (Math.atan2(pose.position.y - pose.target.y, flat) * 180) / Math.PI,
    };
  }

  // ------------------------------------------------------------ size

  private resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, Math.floor(this.host.clientWidth));
    const h = Math.max(1, Math.floor(this.host.clientHeight));
    const pr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.viewportPx = h * pr;
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
    this.intro.skip(); // the viewer took the camera
    this.cameraTaken = true;
    this.userZoomed = true;
    this.setZoomLevel(stepZoom(this.rig.level, dir), false);
  }

  get zoomLevel(): number { return this.rig.level; }
  get maxZoomLevel(): number { return MAX_ZOOM_LEVEL; }

  /** What the core is doing now, as plain numbers (the tests and the dev gallery read it; nothing in the page does). */
  debug(): StageDebug {
    return {
      intro: { active: this.intro.active, progress: this.intro.progress },
      camera: { ...this.lastPose },
      storm: this.storm ? this.storm.stats() : null,
      table: this.table ? this.table.stats() : null,
      zoomLevel: this.rig.level,
      reducedMotion: this.view?.reducedMotion ?? false,
      attack: this.attackApplied,
      shake: this.shakeApplied,
      sweep: this.sweep.stats(),
    };
  }

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
    this.intro.skip();
    this.cameraTaken = true;
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
    this.sweep.dispose();
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
      this.terrain = null;
    }
    this.table?.dispose();
    this.table = null;
    this.storm?.dispose();
    this.storm = null;
    this.sun.shadow.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
