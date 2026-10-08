// DEV ONLY: the effects gallery (gallery-fx.html). A standalone scene with its own renderer, the art-direction camera, lights,
// ACES tone mapping and the same kind of bloom the battlefield uses, so effects can be judged on their own.
//
//   ?kind=<kind>&p=<0..1>     one effect at one progress (kind: muzzle tracer shell hit explosion pulse ambush spawn numbers all)
//   ?strip=<kind>             the same effect at progress 0.1 0.3 0.5 0.7 0.9, side by side (kind may be `numbers`)
//   ?play=1                   every kind animating on a loop (add &t=<seconds> to freeze the clock)
//   ?bench=<n>[&nums=<k>]     n mixed effects (and k numbers, default 6): draw() time and the renderer's draw calls for them alone
//   optional: &seed=<n>  &color=<hex>  &reduced=1  &bloom=<strength>  &w=<world width to frame>
import {
  ACESFilmicToneMapping, BoxGeometry, Color, DirectionalLight, GridHelper, HalfFloatType, HemisphereLight, Mesh,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Fx3dKind, FxItem, NumberItem } from '../contract';
import { createFxKit } from './index';

const KINDS: readonly Fx3dKind[] = ['muzzle', 'tracer', 'shell', 'hit', 'explosion', 'pulse', 'ambush', 'spawn'];
/** Seconds each kind lasts in ?play=1, from the transition plan's TIMINGS (the shot kinds are chosen by the renderer core). */
const SECONDS: Record<Fx3dKind, number> = { muzzle: 0.3, tracer: 0.35, shell: 0.8, hit: 0.38, explosion: 0.52, pulse: 0.5, ambush: 0.65, spawn: 0.36 };
const STRIP_P = [0.1, 0.3, 0.5, 0.7, 0.9];

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 7);
const colorParam = q.get('color');
const color = colorParam ? parseInt(colorParam.replace('#', ''), 16) : undefined;
const reduced = q.get('reduced') === '1';
const bloomStrength = Number(q.get('bloom') ?? 0.6);

// ---------------------------------------------------------------- renderer, camera, lights
const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x0a0e14);
const camera = new PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 200);

scene.add(new HemisphereLight(0xcfe3ff, 0x5b4a3a, 0.6));
const sun = new DirectionalLight(0xfff1dc, 2.4);
sun.position.set(-6, 7.5, -5);
scene.add(sun);

const ground = new Mesh(new PlaneGeometry(60, 60), new MeshStandardMaterial({ color: 0x141b24, roughness: 0.92, metalness: 0 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const grid = new GridHelper(60, 60, 0x2a3b52, 0x1b2736);
grid.position.y = 0.004;
scene.add(grid);

const fx = createFxKit();
fx.setReducedMotion(reduced);
scene.add(fx.group);

const composer = new EffectComposer(renderer, new WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new Vector2(window.innerWidth, window.innerHeight), bloomStrength, 0.4, 0.9));
composer.addPass(new OutputPass());

/** Frames a row `worldWidth` wide centred on `target`, at the art-direction angle (FOV 30, pitch 55 down, yaw 0). */
function frame(worldWidth: number, target: Vector3): void {
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  const dist = worldWidth / (2 * tan * camera.aspect);
  const pitch = (55 * Math.PI) / 180;
  camera.position.set(target.x, target.y + Math.sin(pitch) * dist, target.z + Math.cos(pitch) * dist);
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

// ---------------------------------------------------------------- a cell: one effect (or number pair) around (cx, cz)
const blockMat = new MeshStandardMaterial({ color: 0x3a4350, roughness: 0.6, metalness: 0.3 });
const blockGeo = new BoxGeometry(0.5, 0.3, 0.5);
function stand(x: number, y: number, z: number): void {
  const m = new Mesh(blockGeo, blockMat);
  m.position.set(x, y, z);
  scene.add(m);
}

function itemFor(kind: Fx3dKind, cx: number, cz: number, p: number): FxItem {
  const base = { kind, progress: p, seed, color };
  switch (kind) {
    case 'muzzle': return { ...base, at: new Vector3(cx - 0.7, 0.45, cz), to: new Vector3(cx + 0.9, 0.45, cz) };
    case 'tracer': return { ...base, at: new Vector3(cx - 1.0, 0.4, cz), to: new Vector3(cx + 1.0, 0.3, cz) };
    case 'shell': return { ...base, at: new Vector3(cx - 1.0, 0.3, cz + 0.2), to: new Vector3(cx + 1.0, 0.15, cz - 0.2) };
    case 'hit': return { ...base, at: new Vector3(cx, 0.4, cz) };
    default: return { ...base, at: new Vector3(cx, 0.12, cz) };
  }
}

function addStands(kind: Fx3dKind | 'numbers', cx: number, cz: number): void {
  if (kind === 'muzzle') stand(cx - 0.9, 0.15, cz);
  else if (kind === 'tracer') { stand(cx - 1.2, 0.15, cz); stand(cx + 1.2, 0.15, cz); }
  else if (kind === 'shell') { stand(cx - 1.2, 0.15, cz + 0.2); stand(cx + 1.2, 0.15, cz - 0.2); }
  else if (kind === 'hit' || kind === 'explosion' || kind === 'pulse' || kind === 'ambush') stand(cx, 0.15, cz);
}

function numbersFor(cx: number, cz: number, p: number): NumberItem[] {
  return [
    { at: new Vector3(cx - 0.55, 0.45, cz), text: '-42%', tone: 'damage', progress: p },
    { at: new Vector3(cx + 0.6, 0.45, cz), text: '+2', tone: 'heal', progress: p },
  ];
}

const labels: { el: HTMLDivElement; at: Vector3 }[] = [];
const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;left:10px;top:8px;font:12px/1.4 ui-monospace,Menlo,monospace;color:#9fb3c8;pointer-events:none;white-space:pre';
document.body.appendChild(hud);
function label(text: string, at: Vector3): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;transform:translate(-50%,0);font:12px ui-monospace,Menlo,monospace;color:#7f93a8;pointer-events:none';
  document.body.appendChild(el);
  labels.push({ el, at });
}
function placeLabels(): void {
  const v = new Vector3();
  for (const l of labels) {
    v.copy(l.at).project(camera);
    l.el.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
    l.el.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
  }
}

declare global {
  interface Window { __ready?: boolean; __bench?: Record<string, number>; __stats?: unknown }
}

function present(items: FxItem[], nums: NumberItem[]): void {
  fx.draw(items);
  fx.numbers(nums);
  composer.render();
  placeLabels();
  window.__stats = fx.stats();
}

// ---------------------------------------------------------------- modes
const strip = q.get('strip');
const kindParam = q.get('kind');
const play = q.get('play') === '1';
const benchParam = q.get('bench');

if (benchParam !== null) {
  const n = Math.max(1, Number(benchParam) || 10);
  frame(10, new Vector3(0, 0.4, 0));
  const items: FxItem[] = [];
  for (let i = 0; i < n; i++) {
    const k = KINDS[i % KINDS.length];
    items.push(itemFor(k, ((i * 7) % 11) - 5, ((i * 3) % 5) - 2, 0.25 + ((i * 13) % 6) * 0.1));
  }
  const nums: NumberItem[] = [];
  for (let i = 0; i < Math.min(Number(q.get('nums') ?? 6), 12); i++) nums.push({ at: new Vector3(i - 3, 0.4, 1), text: i % 2 ? '+2' : '-42%', tone: i % 2 ? 'heal' : 'damage', progress: 0.4 });
  fx.draw(items);
  fx.numbers(nums);
  const t0 = performance.now();
  const reps = 500;
  for (let i = 0; i < reps; i++) fx.draw(items);
  const drawMs = (performance.now() - t0) / reps;
  // The renderer's draw calls for the effects alone: a scene that holds only the effect group.
  const only = new Scene();
  only.add(fx.group);
  renderer.info.reset();
  renderer.render(only, camera);
  const calls = renderer.info.render.calls;
  const triangles = renderer.info.render.triangles;
  scene.add(fx.group);
  present(items, nums);
  const s = fx.stats();
  window.__bench = { effects: n, drawMs, calls, triangles, glow: s.instances.glow, smoke: s.instances.smoke, debris: s.instances.debris, numbers: s.numbers, lights: s.lights };
  hud.textContent = `bench ${n} effects: draw() ${drawMs.toFixed(3)} ms, ${calls} draw calls, ${triangles} triangles, instances glow ${s.instances.glow} smoke ${s.instances.smoke} debris ${s.instances.debris}, ${s.lights} lights`;
  window.__ready = true;
} else if (play) {
  const cols = 3;
  const gap = 3.4;
  const names: (Fx3dKind | 'numbers')[] = [...KINDS, 'numbers'];
  const cells = names.map((name, i) => ({ name, cx: ((i % cols) - 1) * gap, cz: (Math.floor(i / cols) - 1) * gap }));
  for (const c of cells) addStands(c.name, c.cx, c.cz);
  frame(15.5, new Vector3(0, 0.4, 0));
  const frozen = q.get('t');
  const draw = (timeSec: number): void => {
    const items: FxItem[] = [];
    const nums: NumberItem[] = [];
    cells.forEach((c, i) => {
      const dur = c.name === 'numbers' ? 0.9 : SECONDS[c.name];
      const phase = (timeSec + i * 0.13) / (dur * 1.35);
      const p = Math.min(1, (phase % 1) * 1.35);
      if (c.name === 'numbers') nums.push(...numbersFor(c.cx, c.cz, p));
      else items.push(itemFor(c.name, c.cx, c.cz, p));
    });
    present(items, nums);
  };
  if (frozen !== null) {
    draw(Number(frozen));
    window.__ready = true;
  } else {
    let last = performance.now();
    let acc = 0;
    let frames = 0;
    const loop = (now: number): void => {
      acc += now - last;
      last = now;
      frames++;
      draw(now / 1000);
      if (acc > 500) {
        hud.textContent = `play  ${((frames * 1000) / acc).toFixed(0)} fps  ${JSON.stringify((fx.stats() as { instances: unknown }).instances)}`;
        acc = 0;
        frames = 0;
      }
      window.__ready = true;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
} else if (strip) {
  const gap = 2.2;
  const items: FxItem[] = [];
  const nums: NumberItem[] = [];
  STRIP_P.forEach((p, i) => {
    const cx = (i - 2) * gap;
    if (strip === 'numbers') nums.push(...numbersFor(cx, 0, p));
    else {
      addStands(strip as Fx3dKind, cx, 0);
      items.push(itemFor(strip as Fx3dKind, cx, 0, p));
    }
    label(`${strip}  p=${p}`, new Vector3(cx, 0, 1.15));
  });
  frame(Number(q.get('w') ?? STRIP_P.length * gap + 1.8), new Vector3(0, 0.4, 0));
  present(items, nums);
  hud.textContent = `strip: ${strip}`;
  window.__ready = true;
} else {
  const kind = (kindParam ?? 'explosion') as Fx3dKind | 'numbers' | 'all';
  const p = Number(q.get('p') ?? 0.3);
  const items: FxItem[] = [];
  const nums: NumberItem[] = [];
  if (kind === 'all') {
    KINDS.forEach((k, i) => {
      const cx = ((i % 4) - 1.5) * 3;
      const cz = (Math.floor(i / 4) - 0.5) * 3;
      addStands(k, cx, cz);
      items.push(itemFor(k, cx, cz, p));
    });
    frame(Number(q.get('w') ?? 13), new Vector3(0, 0.4, 0));
  } else {
    if (kind === 'numbers') nums.push(...numbersFor(0, 0, p));
    else {
      addStands(kind, 0, 0);
      items.push(itemFor(kind, 0, 0, p));
    }
    frame(Number(q.get('w') ?? 5.2), new Vector3(0, 0.4, 0));
  }
  present(items, nums);
  hud.textContent = `${kind} p=${p}`;
  window.__ready = true;
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
