// The front door's own small 3D renderer (G9): one board, lit like the battle stage, seen from a low angle by a camera that drifts.
// It builds the board with the battle kits (createTerrain, createUnitView) and nothing of the battle stage's runtime, so it carries no
// transition plan, no fx and no camera input: it only shows. It is imported by BoardPreview3D.tsx, which is a lazy chunk, so the title's
// first paint (the tile still underneath) never waits for three.js.
//
// Lighting follows docs/research/art-direction.md: a cool hemisphere fill (sky #cfe3ff over ground #5b4a3a) at 0.6 of a warm key, a sun
// from the north-west with soft shadows, ACES tone mapping, a high-threshold bloom so only emissive trim glows, and FXAA.
import {
  ACESFilmicToneMapping, BoxGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshStandardMaterial, PCFShadowMap,
  PerspectiveCamera, SRGBColorSpace, Scene, Vector2, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { UI } from '../board3d/palette';
import { createTerrain } from '../board3d/terrain';
import { createUnitView } from '../board3d/units';
import type { TerrainView, UnitView } from '../board3d/contract';
import { orbitPose, shiftFor } from './orbit';
import type { OrbitSpec } from './orbit';
import type { PreviewScene } from './scene';

/** The key light in three's physical units, and the hemisphere at 0.6 of it (art direction "Lighting and post"). */
const KEY_LUX = 2.3;
const HEMI_RATIO = 0.6;
const SUN_ELEVATION = 46 * (Math.PI / 180);
const SHADOW_MAP = 2048;
const MAX_PIXEL_RATIO = 1.5;
/** A frozen picture still needs the kits' eased states (a property sinking under its unit) to land: this many 30 Hz steps settle them. */
const SETTLE_STEPS = 45;

export interface PreviewOptions {
  orbit: OrbitSpec;
  /** Freeze the camera, the water and the idle motion. The picture is drawn once (and again when the host resizes). */
  reducedMotion: boolean;
  /** Called once, after the first picture has been drawn. */
  onReady?: () => void;
  /** The GPU side cannot go on (no context, or it was lost). */
  onFail: (reason: string) => void;
}

export class PreviewRuntime {
  readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly fxaa: ShaderPass;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly sun = new DirectionalLight(0xfff0d6, KEY_LUX);
  private readonly hemi = new HemisphereLight(0xcfe3ff, 0x5b4a3a, KEY_LUX * HEMI_RATIO);
  private readonly terrain: TerrainView;
  private readonly units: UnitView[] = [];
  private readonly table: Mesh<BoxGeometry, MeshStandardMaterial>;
  private readonly ro: ResizeObserver;
  private readonly board: { width: number; height: number };
  private time = 0;
  private last = 0;
  private raf = 0;
  private frames = 0;
  private ready = false;
  private disposed = false;
  private cleaned = false;
  private width = 1;
  private height = 1;

  constructor(host: HTMLElement, scene: PreviewScene, private readonly opts: PreviewOptions) {
    this.host = host;
    this.board = { width: scene.width, height: scene.height };
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'awf-preview-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(this.canvas);
    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    } catch (err) {
      this.canvas.remove();
      throw err;
    }
    const r = this.renderer;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;

    this.scene.background = new Color(UI.void);
    this.camera = new PerspectiveCamera(opts.orbit.fovDeg, 1.6, 0.1, 200);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    const radius = Math.hypot(scene.width, scene.height) / 2 + 1;
    const cx = scene.width / 2;
    const cz = scene.height / 2;
    const dirH = Math.cos(SUN_ELEVATION) / Math.SQRT2;
    const dist = radius * 3 + 10;
    this.sun.position.set(cx - dirH * dist, Math.sin(SUN_ELEVATION) * dist, cz - dirH * dist);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.target.updateMatrixWorld();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera;
    sc.left = -radius;
    sc.right = radius;
    sc.top = radius;
    sc.bottom = -radius;
    sc.near = 0.5;
    sc.far = dist + radius * 2;
    sc.updateProjectionMatrix();

    // The board, with the same kit the battle stage builds it with.
    this.terrain = createTerrain({
      width: scene.width,
      height: scene.height,
      terrainAt: (x, y) => scene.terrain[y][x],
      ownerAt: (x, y) => scene.owners[y][x],
      factionOf: (p) => scene.factions[p] ?? null,
      weather: scene.weather,
    });
    this.scene.add(this.terrain.group);

    const margin = 0.7;
    const table = new Mesh(
      new BoxGeometry(scene.width + margin * 2, 0.4, scene.height + margin * 2),
      new MeshStandardMaterial({ color: 0x141b25, roughness: 0.75, metalness: 0.25 }),
    );
    table.position.set(cx, -0.5, cz);
    table.receiveShadow = true;
    table.name = 'table';
    this.table = table;
    this.scene.add(table);

    const occupied = new Set<string>();
    const unitsGroup = new Group();
    unitsGroup.name = 'units';
    for (const u of scene.units) {
      const view = createUnitView(u.type, u.faction, u.unmarked ? { unmarked: true } : undefined);
      view.object.position.set(u.x + 0.5, this.terrain.heightAt(u.x, u.y), u.y + 0.5);
      view.setLook({ hp: 10, spent: false, heading: u.heading, status: null, focused: false });
      view.setPose('idle', 0);
      unitsGroup.add(view.object);
      this.units.push(view);
      occupied.add(`${u.x},${u.y}`);
    }
    this.scene.add(unitsGroup);
    this.terrain.setOccupied((x, y) => occupied.has(`${x},${y}`));

    // Far corners of a big board melt into the dark instead of ending at a hard edge.
    const far = orbitPose(opts.orbit, this.board, 1.6, 0).distance;
    this.scene.fog = new Fog(UI.void, far * 1.15, far * 2.4);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.55, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);

    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    if (opts.reducedMotion) this.settle();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Lets the kits' eased states (low-form properties, the first idle pose) arrive, then holds time at zero. */
  private settle(): void {
    for (let i = 0; i < SETTLE_STEPS; i += 1) {
      this.terrain.update(1 / 30, 0);
      for (const u of this.units) u.update(1 / 30, 0);
    }
  }

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    const frozen = this.opts.reducedMotion;
    // A frozen picture is drawn a few times (shader compile, first texture uploads) and then the loop rests.
    if (!frozen || this.frames < 3) this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!frozen) this.time += dt;
    try {
      this.draw(frozen ? 0 : dt);
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
  };

  private draw(dt: number): void {
    if (this.canvas.clientWidth === 0) return;
    const pose = orbitPose(this.opts.orbit, this.board, this.width / this.height, this.time);
    const cam = this.camera;
    cam.position.set(pose.position.x, pose.position.y, pose.position.z);
    cam.near = pose.near;
    cam.far = pose.far;
    cam.lookAt(pose.target.x, pose.target.y, pose.target.z);
    const { x, y } = shiftFor(this.opts.orbit, this.width / this.height);
    if (x !== 0 || y !== 0) cam.setViewOffset(this.width, this.height, -x * this.width, -y * this.height, this.width, this.height);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this.terrain.update(dt, this.time);
    for (const u of this.units) u.update(dt, this.time);
    this.composer.render(dt);
    this.frames += 1;
    if (!this.ready && this.frames >= 2) {
      this.ready = true;
      this.opts.onReady?.();
    }
  }

  private resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, Math.floor(this.host.clientWidth));
    const h = Math.max(1, Math.floor(this.host.clientHeight));
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // A frozen picture only redraws when something asks it to.
    if (this.opts.reducedMotion && this.ready && !this.disposed) {
      cancelAnimationFrame(this.raf);
      this.frames = 0;
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.fail('the WebGL context was lost');
  };

  private fail(reason: string): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.opts.onFail(reason);
  }

  dispose(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    for (const u of this.units) u.dispose();
    this.units.length = 0;
    this.scene.remove(this.terrain.group);
    this.terrain.dispose();
    this.table.geometry.dispose();
    this.table.material.dispose();
    this.sun.shadow.dispose();
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
