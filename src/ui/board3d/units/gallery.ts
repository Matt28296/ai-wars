// Dev-only gallery for the unit miniatures (gallery-units.html). Its own renderer, the art-direction camera and lights, ACES.
// Not imported by the product.
import {
  ACESFilmicToneMapping, BoxGeometry, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PCFShadowMap, PerspectiveCamera, Scene, SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import type { FactionId, UnitTypeId } from '../../../game/aw';
import { UNIT_TYPES } from '../../../data';
import type { UnitPose, UnitView } from '../contract';
import type { UnitStatusKind } from '../../watch/unitview';
import { TERRAIN_COLOR } from '../palette';
import { FACTION_IDS, UNIT_IDS, createUnitViewWithPhase, setRimStrength } from './index';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const view = q.get('view') ?? (q.has('unit') ? 'turntable' : 'sheet');
const pose = (q.get('pose') ?? 'idle') as UnitPose;
const poseT = num('t', pose === 'fire' ? 0.15 : 0.4);
const spent = q.get('spent') === '1';
const hp = num('hp', 10);
const status = (q.get('status') ?? null) as UnitStatusKind | null;
const focus = q.get('focus') === '1';
const showMuzzle = q.get('muzzle') === '1' || pose === 'fire';
const timeSec = num('time', 1.0);
const anim = q.get('anim') === '1';
// the faction rim (G7): 0 turns it off for a before-and-after look at the paint alone; the default is the game's. Set before any unit is built.
if (q.has('rim')) setRimStrength(num('rim', 0.25));

const FOV = 30;
const PITCH = (55 * Math.PI) / 180;

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x0a0e14);
const camera = new PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 200);

scene.add(new HemisphereLight(0xcfe3ff, 0x5b4a3a, 0.6));

const views: UnitView[] = [];
const labels: { el: HTMLElement; at: Vector3; anchor: 'center' | 'left' }[] = [];
const labelHost = document.getElementById('labels') as HTMLElement;

function label(text: string, at: Vector3, anchor: 'center' | 'left' = 'center'): void {
  const el = document.createElement('span');
  el.textContent = text;
  if (anchor === 'left') el.className = 'row';
  labelHost.appendChild(el);
  labels.push({ el, at, anchor });
}

const landMat = new MeshStandardMaterial({ color: TERRAIN_COLOR.flats.base, roughness: 0.95 });
const landAlt = new MeshStandardMaterial({ color: TERRAIN_COLOR.flats.detail, roughness: 0.95 });
const seaMat = new MeshStandardMaterial({ color: TERRAIN_COLOR.sea.detail, roughness: 0.4, metalness: 0.1 });
const tileGeo = new BoxGeometry(0.98, 0.2, 0.98);

function tile(x: number, z: number, sea: boolean): void {
  const m = new Mesh(tileGeo, sea ? seaMat : (x + z) % 2 === 0 ? landMat : landAlt);
  m.position.set(x + 0.5, (sea ? -0.08 : 0) - 0.1, z + 0.5);
  m.receiveShadow = true;
  scene.add(m);
}

const muzzleMarks: { view: UnitView; mark: Mesh }[] = [];

function place(type: UnitTypeId, faction: FactionId, x: number, z: number, heading: number, index: number): void {
  const naval = UNIT_TYPES[type].domain === 'sea';
  tile(Math.floor(x), Math.floor(z), naval);
  const v = createUnitViewWithPhase(type, faction, index * 0.9);
  v.object.position.set(x, naval ? -0.08 : 0, z);
  v.setLook({ hp, spent, heading, status, focused: focus });
  v.update(0.016, timeSec);
  if (pose !== 'idle') v.setPose(pose, poseT);
  scene.add(v.object);
  views.push(v);
  if (showMuzzle) {
    const mark = new Mesh(new SphereGeometry(0.025, 8, 6), new MeshBasicMaterial({ color: 0xff00ff }));
    scene.add(mark);
    muzzleMarks.push({ view: v, mark });
  }
}

/** Fit the camera so a width x depth board (centred at cx, cz, with units about 0.7 tall) fills the frame at the art-direction pitch. */
function frame(cx: number, cz: number, width: number, depth: number): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const corners = [
    new Vector3(cx - width / 2, 0, cz - depth / 2), new Vector3(cx + width / 2, 0, cz - depth / 2),
    new Vector3(cx - width / 2, 0.8, cz - depth / 2), new Vector3(cx + width / 2, 0.8, cz - depth / 2),
    new Vector3(cx - width / 2, 0, cz + depth / 2), new Vector3(cx + width / 2, 0, cz + depth / 2),
  ];
  let d = 6;
  for (let i = 0; i < 40; i += 1) {
    camera.position.set(cx, d * Math.sin(PITCH), cz + d * Math.cos(PITCH));
    camera.lookAt(cx, 0, cz);
    camera.updateMatrixWorld(true);
    let worst = 0;
    for (const c of corners) {
      const p = c.clone().project(camera);
      worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
    }
    if (worst < 0.97 && worst > 0.9) break;
    d *= worst / 0.94;
  }

  const sun = new DirectionalLight(0xfff0dc, 2.2);
  const reach = Math.hypot(width, depth) / 2 + 2;
  sun.position.set(cx - reach * 0.5, reach * 0.85, cz - reach * 0.5);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -reach;
  s.right = reach;
  s.top = reach;
  s.bottom = -reach;
  s.near = 0.5;
  s.far = reach * 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const fill = new DirectionalLight(0x9bb8ff, 0.5);
  fill.position.set(cx + reach * 0.6, reach * 0.4, cz + reach * 0.6);
  scene.add(fill);
}

const typeOrder = UNIT_IDS;
const info = document.getElementById('info') as HTMLElement;

if (view === 'turntable') {
  const types = (q.get('unit') ?? 'lancer').split(',') as UnitTypeId[];
  const faction = (q.get('faction') ?? 'helion') as FactionId;
  const factions = q.get('faction') === 'all' ? FACTION_IDS : [faction];
  const heads = [Math.PI / 4, 0, (-3 * Math.PI) / 4];
  const spacing = 1.0;
  const rowGap = 1.0;
  let row = 0;
  for (const type of types) {
    factions.forEach((f, fi) => {
      heads.forEach((h, i) => place(type, f, 0.5 + i * spacing, 0.5 + row * rowGap, h, i + fi));
      if (types.length > 1 || factions.length > 1) label(`${type} ${f}`, new Vector3(-1.4, 0, 0.5 + row * rowGap), 'left');
      row += 1;
    });
  }
  const zoom = num('zoom', 1);
  const w = (heads.length * spacing + 0.4) / zoom + (row > 1 ? 1.8 : 0);
  frame(0.5 + ((heads.length - 1) * spacing) / 2 - (row > 1 ? 0.9 : 0), 0.5 + ((row - 1) * rowGap) / 2, w, (row * rowGap + 0.4) / zoom);
  info.textContent = `${types.join(',')} / ${factions.join(',')} / headings 45, 0, -135 deg`;
} else {
  const only = q.get('faction');
  const factions = only ? FACTION_IDS.filter((f) => f === only) : FACTION_IDS;
  const cols = Math.max(1, Math.min(16, num('cols', 16)));
  const bands = Math.ceil(typeOrder.length / cols);
  const rowsPerFaction = bands;
  factions.forEach((f, fi) => {
    typeOrder.forEach((t, i) => {
      const col = i % cols;
      const row = fi * rowsPerFaction + Math.floor(i / cols);
      place(t, f, col + 0.5, row + 0.5, 0, i + fi * 3);
      if (cols === 16 ? fi === 0 : true) label(t, new Vector3(col + 0.5, 0, cols === 16 ? -0.45 : row + 0.95));
    });
    label(f, new Vector3(-1.6, 0, fi * rowsPerFaction + 0.5), 'left');
  });
  const rows = factions.length * rowsPerFaction;
  const wide = factions.length > 1 || cols === 16;
  frame(cols / 2 - (wide ? 0.9 : 0), rows / 2 - 0.2, cols + (wide ? 3.0 : 0.8), rows + 1.2);
  info.textContent = `sheet: ${typeOrder.length} types x ${factions.length} faction(s)`;
}

function positionLabels(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const p = new Vector3();
  for (const l of labels) {
    p.copy(l.at).project(camera);
    l.el.style.left = `${((p.x + 1) / 2) * w}px`;
    l.el.style.top = `${((1 - p.y) / 2) * h}px`;
  }
}

function draw(): void {
  for (const { view: v, mark } of muzzleMarks) v.muzzleWorld(mark.position);
  renderer.render(scene, camera);
  positionLabels();
}

camera.updateMatrixWorld(true);
scene.updateMatrixWorld(true);
draw();
(window as unknown as { __galleryReady: boolean }).__galleryReady = true;

if (anim) {
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    for (const v of views) {
      v.update(dt, t);
      if (pose !== 'idle') v.setPose(pose, (t * 0.5) % 1);
    }
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  draw();
});
