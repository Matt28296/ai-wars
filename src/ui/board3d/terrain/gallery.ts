// DEV-ONLY terrain gallery (gallery-terrain.html): a standalone three.js scene with its own renderer, the art-direction camera and lights,
// and one map from MAPS / MISSION_MAPS built by the terrain kit. Nothing in the product imports this file, and `vite build` ignores the page.
//
//   ?map=<id>        calder-fields (default), saltglass-bay, glass-waste, m14-null-spire, ... or `stress` for a busy 25x19 board
//   ?fog=1           hide the east half of the board (fog of war)        ?storm=1   ion-storm weather
//   ?cap=1           show capture rings on a few properties              ?units=0   hide the stand-in miniatures
//   ?time=<s>        freeze animation at this time (screenshots)         ?bloom=1   add the stage's own bloom (strength 0.6, radius 0.4, threshold 0.9)
//   ?probe=living&time=<s>&storm=<0..1>   no board: runs the living board's GLSL on a grid and compares it with the CPU mirror in living.ts
//                    (window.__probe = { maxErr: { cover, gust, caustic, live }, samples })
//                    window.__project(x, y, z) -> [px, py] and window.__tiles (x, y, terrain) let a script read the pixel of a tile
//   ?motion=0        reduced motion: the kit's ambient motion (cloud shadows, gusts, sway, caustics) holds still
//   ?occupied=x,y;x,y  put a unit on those tiles (properties show their low form)   ?occupied=all  a unit on every property
//   ?rows=a|b|c      a custom board from map codes, optionally &owners=... in the same shape (digits and dots)
//   ?w=<px>&h=<px>   canvas size (default: the window)                   ?hud=0     hide the stats overlay
import {
  ACESFilmicToneMapping, BoxGeometry, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial, NoBlending, PCFShadowMap,
  PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { MAPS } from '../../../content/maps';
import { MISSION_MAPS } from '../../../content/mission-maps';
import type { MapDef } from '../../../content/types';
import { TERRAIN_CODES } from '../../../data';
import type { FactionId } from '../../../game/aw';
import type { TerrainInput } from '../contract';
import { FACTION_ACCENT, FACTION_COLOR, UI } from '../palette';
import { createTerrainKit } from './index';
import {
  CAUSTIC_GLSL, CLOCK_GLSL, CLOUD_GLSL, GUST_GLSL, LIVE_CEIL, LIVE_FLOOR, causticWeb, cloudCover, cloudDarkening, gust, livingMultiplier,
} from './living';
import { stressRows } from './testing';

const FACTION_BY_PLAYER: FactionId[] = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'];
const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
const flag = (k: string, d = false): boolean => (q.has(k) ? q.get(k) !== '0' : d);

interface Board { id: string; terrain: string[]; owners: string[]; units: MapDef['units'] }

function pickBoard(): Board {
  if (q.has('rows')) {
    const terrain = q.get('rows')!.split('|');
    const owners = q.has('owners') ? q.get('owners')!.split('|') : terrain.map((r) => '.'.repeat(r.length));
    return { id: 'custom', terrain, owners, units: [] };
  }
  const id = q.get('map') ?? 'calder-fields';
  if (id === 'stress') {
    const terrain = stressRows(25, 19);
    const owners = terrain.map((r, y) => [...r].map((c, x) => ('CFADUH'.includes(c) ? String((x * 5 + y * 3) % 5) : '.')).join(''));
    return { id, terrain, owners, units: [] };
  }
  const m: MapDef | undefined = MAPS[id] ?? MISSION_MAPS[id];
  if (!m) throw new Error(`unknown map ${id}`);
  return { id, terrain: m.terrain, owners: m.owners, units: m.units };
}

const board = pickBoard();
const width = board.terrain[0].length;
const height = board.terrain.length;
const W = num('w', window.innerWidth);
const H = num('h', window.innerHeight);

const input: TerrainInput = {
  width,
  height,
  terrainAt: (x, y) => TERRAIN_CODES[board.terrain[y][x]],
  ownerAt: (x, y) => { const c = board.owners[y]?.[x]; return c && c !== '.' ? Number(c) : null; },
  factionOf: (p) => FACTION_BY_PLAYER[p] ?? null,
  weather: flag('storm') ? 'ionstorm' : 'clear',
};

/**
 * ?probe=living: the living board's GLSL (the very strings the materials are patched with) drawn over a grid of world positions into a render
 * target, read back, and compared with the CPU mirror in living.ts. This is the check that the shader and the tests' mirror agree.
 */
function runLivingProbe(): void {
  const time = num('time', 0);
  const storm = num('storm', 0);
  const NX = 100; const NZ = 76; const STEP = 0.25;
  const probeRenderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  probeRenderer.setSize(64, 64);
  const target = new WebGLRenderTarget(NX, NZ);
  const mat = new ShaderMaterial({
    uniforms: { uLive: { value: time }, uStorm: { value: storm } },
    vertexShader: 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader: `
      uniform float uStorm;
      ${CLOCK_GLSL}${GUST_GLSL}${CLOUD_GLSL}${CAUSTIC_GLSL}
      void main() {
        vec2 xz = gl_FragCoord.xy * ${STEP.toFixed(4)};
        float g = trnGust( xz );
        float c = trnCaustic( xz );
        float m = trnLive( xz, g, c );
        gl_FragColor = vec4( trnCloud( xz ), g * 0.5 + 0.5, c, ( m - ${LIVE_FLOOR.toFixed(5)} ) / ${(LIVE_CEIL - LIVE_FLOOR).toFixed(5)} );
      }`,
    blending: NoBlending,
    depthTest: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), mat);
  const probeScene = new Scene();
  probeScene.add(quad);
  quad.frustumCulled = false;
  probeRenderer.setRenderTarget(target);
  probeRenderer.render(probeScene, new PerspectiveCamera());
  const px = new Uint8Array(NX * NZ * 4);
  probeRenderer.readRenderTargetPixels(target, 0, 0, NX, NZ, px);
  const maxErr = { cover: 0, gust: 0, caustic: 0, live: 0 };
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const x = i + 0.5; const z = j + 0.5;
      const wx = x * STEP; const wz = z * STEP;
      const o = (j * NX + i) * 4;
      const cover = cloudCover(wx, wz, time);
      const g = gust(wx, wz, time);
      const c = causticWeb(wx, wz, time);
      const live = livingMultiplier(cloudDarkening(wx, wz, time, storm), g, c);
      maxErr.cover = Math.max(maxErr.cover, Math.abs(px[o] / 255 - cover));
      maxErr.gust = Math.max(maxErr.gust, Math.abs(px[o + 1] / 255 - (g * 0.5 + 0.5)) * 2);
      maxErr.caustic = Math.max(maxErr.caustic, Math.abs(px[o + 2] / 255 - c));
      maxErr.live = Math.max(maxErr.live, Math.abs((px[o + 3] / 255) * (LIVE_CEIL - LIVE_FLOOR) + LIVE_FLOOR - live));
    }
  }
  (window as unknown as { __probe?: unknown }).__probe = { time, storm, samples: NX * NZ, maxErr };
  quad.geometry.dispose();
  mat.dispose();
  target.dispose();
  probeRenderer.dispose();
}
if (q.get('probe') === 'living') runLivingProbe(); // the page then goes on to draw its board as usual; a probe run passes &w=64&h=64

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(UI.void);
const cx = width / 2;
const cz = height / 2;

// Lights (art-direction.md): hemisphere sky/ground, a warm key from the north-west at ~50 degrees with soft shadows fitted to the board,
// and a cool fill from the opposite side.
const hemi = new HemisphereLight(0xcfe3ff, 0x5b4a3a, 0.6);
const sun = new DirectionalLight(0xfff0d8, 2.7);
const elev = (50 * Math.PI) / 180;
const sunDir = new Vector3(-Math.cos(elev) * Math.SQRT1_2, Math.sin(elev), -Math.cos(elev) * Math.SQRT1_2);
sun.position.set(cx, 0, cz).addScaledVector(sunDir, 60);
sun.target.position.set(cx, 0, cz);
const half = Math.hypot(width, height) / 2 + 2;
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 140 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
const fill = new DirectionalLight(0x9bbcff, 0.35);
fill.position.set(cx + 30, 18, cz + 30);
fill.target.position.set(cx, 0, cz);
scene.add(hemi, sun, sun.target, fill, fill.target);

// The terrain.
const kit = createTerrainKit(input);
scene.add(kit.group);
kit.setOwners(input.ownerAt);
if (flag('fog')) kit.setVisible((x) => x < width / 2);
kit.setMotion(flag('motion', true));
if (flag('storm')) kit.setWeather('ionstorm');
if (flag('cap')) {
  const props: [number, number][] = [];
  for (const t of kit.board.tiles) if (t.property) props.push([t.x, t.y]);
  const steps = [0.2, 0.45, 0.7, 0.9, 1];
  const chosen = new Map<string, number>();
  props.filter((_, i) => i % 3 === 0).slice(0, 8).forEach(([x, y], i) => chosen.set(`${x},${y}`, steps[i % steps.length]));
  kit.setCapture((x, y) => chosen.get(`${x},${y}`) ?? 0);
}

// Who stands where: the map's own units and any `?occupied=x,y;x,y` (or `all` properties) each get a stand-in miniature (hidden by ?units=0,
// which hides the miniatures only), and a property under one shows its low form.
const standIns: { x: number; y: number; owner: number }[] = board.units.map((u) => ({ x: u.x, y: u.y, owner: u.owner }));
if (q.has('occupied')) {
  const spec = q.get('occupied')!;
  const extra: string[] = [];
  if (spec === 'all') for (const t of kit.board.tiles) { if (t.property) extra.push(`${t.x},${t.y}`); }
  else for (const part of spec.split(';')) { if (/^\d+,\d+$/.test(part)) extra.push(part); }
  for (const key of extra) {
    const [x, y] = key.split(',').map(Number);
    if (!standIns.some((u) => u.x === x && u.y === y)) standIns.push({ x, y, owner: (x + y) % 2 });
  }
}
const occupied = new Set(standIns.map((u) => `${u.x},${u.y}`));
kit.setOccupied((x, y) => occupied.has(`${x},${y}`));

// Stand-in miniatures (the real ones come from the units kit), so the gallery shows how props and units share a tile.
if (standIns.length && flag('units', true)) {
  const stand = new Group();
  const box = new BoxGeometry(0.6, 0.26, 0.42);
  const tur = new BoxGeometry(0.26, 0.14, 0.22);
  for (const u of standIns) {
    const f = FACTION_BY_PLAYER[u.owner] ?? 'helion';
    const mat = new MeshStandardMaterial({ color: FACTION_COLOR[f], roughness: 0.55, emissive: FACTION_ACCENT[f], emissiveIntensity: 0.12 });
    const body = new Mesh(box, mat);
    const top = new Mesh(tur, mat);
    const y = kit.heightAt(u.x, u.y);
    body.position.set(u.x + 0.5, y + 0.14, u.y + 0.5);
    top.position.set(u.x + 0.5, y + 0.33, u.y + 0.5);
    body.castShadow = true;
    top.castShadow = true;
    stand.add(body, top);
  }
  scene.add(stand);
}

// Camera (art-direction.md): FOV 30, pitch 55 down from horizontal, yaw 0 so map rows stay horizontal; the whole map fits.
const camera = new PerspectiveCamera(30, W / H, 0.5, 400);
const pitch = (55 * Math.PI) / 180;
function fitCamera(): void {
  const dir = new Vector3(0, Math.sin(pitch), Math.cos(pitch));
  const target = new Vector3(cx, 0, cz);
  const corners: Vector3[] = [];
  for (const x of [0, width]) for (const y of [-0.5, 1.3]) for (const z of [0, height]) corners.push(new Vector3(x, y, z));
  for (let d = 6; d < 200; d += 0.25) {
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const inside = corners.every((c) => {
      const p = c.clone().project(camera);
      return Math.abs(p.x) < 0.97 && Math.abs(p.y) < 0.97;
    });
    if (inside) return;
  }
}
fitCamera();
{
  const w = window as unknown as { __project?: (x: number, y: number, z: number) => [number, number]; __tiles?: unknown };
  camera.updateMatrixWorld();
  w.__project = (x, y, z) => { const p = new Vector3(x, y, z).project(camera); return [(p.x * 0.5 + 0.5) * W, (1 - (p.y * 0.5 + 0.5)) * H]; };
  w.__tiles = kit.board.tiles.map((t) => ({ x: t.x, y: t.y, terrain: t.terrain, y0: t.walk }));
}

const composer = flag('bloom') ? new EffectComposer(renderer) : null;
if (composer) {
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  // The stage's own numbers (stage/runtime.ts BLOOM), so a rail's halo in this gallery is the halo a player sees.
  composer.addPass(new UnrealBloomPass(new Vector2(W, H), 0.6, 0.4, 0.9));
  composer.addPass(new OutputPass());
}

const hud = document.getElementById('hud');
if (!flag('hud', true) && hud) hud.style.display = 'none';
const win = window as unknown as { __ready?: boolean; __stats?: Record<string, unknown> };

function frame(t: number, dt: number): void {
  kit.update(dt, t);
  if (composer) composer.render(); else renderer.render(scene, camera);
  const info = renderer.info;
  const stats = {
    map: board.id, tiles: width * height,
    drawCalls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
    kitEstimate: kit.stats.drawCalls, kitTriangles: kit.stats.triangles,
  };
  win.__stats = stats;
  if (hud) hud.textContent = `${board.id} ${width}x${height}${flag('fog') ? ' fog' : ''}${flag('storm') ? ' storm' : ''}\ndraw calls ${stats.drawCalls} (shadow pass included)  triangles ${stats.triangles}`;
}

if (q.has('time')) {
  const t = num('time', 0);
  // A few frames so the storm eases fully in and every shader has compiled before the picture is taken.
  for (let i = 0; i < 4; i++) frame(t, 1);
  win.__ready = true;
} else {
  let last = performance.now();
  const loop = (now: number): void => {
    frame(now / 1000, Math.min(0.1, (now - last) / 1000));
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  win.__ready = true;
}
