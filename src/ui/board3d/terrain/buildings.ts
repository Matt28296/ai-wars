// The six property models (arcology, fabricator, skyport, dock, uplink, spire), built from primitives. Each stands on a raised pad,
// keeps its bulk in the back half of the tile so a unit on the tile stays readable in front of it, and carries four owner cues:
//   paint  roofs, the pad's edge band and the banner cloth take the owner's faction colour (neutral grey until owned);
//   accent the beacon (and landing lights) glow in the faction's accent;
//   ink    two sigil decals: one on a roof, one on the banner.
// So ownership is colour AND shape AND light, never hue alone.
import { NEUTRAL_COLOR } from '../palette';
import type { PartSet } from './geo';
import { PAD_H, type Dir, type PropertyId, type TileInfo } from './layout';
import { hash2 } from './rng';

export const NEUTRAL_ACCENT = 0xb9c2cc;

const C = {
  wall: 0x77818d, wallDark: 0x4d5762, metal: 0x3a434e, steel: 0xaab4bf, concrete: 0x7b858f, asphalt: 0x30373f,
  wood: 0x7a5f41, woodDark: 0x5a4430, yellow: 0xc9a43c, glass: 0x35607f, white: 0xdfe7ee, warm: 0xffb347,
};
const paint = { color: NEUTRAL_COLOR, role: 'paint' as const };
const accent = (mult: number) => ({ color: NEUTRAL_ACCENT, role: 'accent' as const, bucket: 'glow' as const, mult });

/** The pad every property stands on, with the owner's colour as an edge band. */
function pad(p: PartSet, h: number): void {
  p.box(0.5, h / 2, 0.5, 0.92, h, 0.92, { color: C.concrete });
  const y = h + 0.003;
  const w = 0.024;
  p.box(0.5, y, 0.5 - 0.448, 0.92, 0.006, w, paint);
  p.box(0.5, y, 0.5 + 0.448, 0.92, 0.006, w, paint);
  p.box(0.5 - 0.448, y, 0.5, w, 0.006, 0.92 - 2 * w, paint);
  p.box(0.5 + 0.448, y, 0.5, w, 0.006, 0.92 - 2 * w, paint);
}

/** A faint painted bay in the front half of the pad, where a unit stands (kept clear of every model). */
function bay(p: PartSet, h: number): void {
  const y = h + 0.0015;
  const c = { color: 0x929ca7 };
  p.box(0.5, y, 0.58, 0.5, 0.003, 0.012, c);
  p.box(0.5, y, 0.9, 0.5, 0.003, 0.012, c);
  p.box(0.25, y, 0.74, 0.012, 0.003, 0.32, c);
  p.box(0.75, y, 0.74, 0.012, 0.003, 0.32, c);
}

/** A banner on a pole at the tile's west edge, facing the camera. The sigil on the cloth is the second ownership cue. */
function banner(p: PartSet, h: number): void {
  p.frame(0);
  p.cyl(0.075, h + 0.17, 0.46, 0.008, 0.01, 0.34, 6, { color: C.steel });
  p.sphere(0.075, h + 0.345, 0.46, 0.014, 0.014, 0.014, 6, 4, { color: C.steel });
  p.box(0.14, h + 0.26, 0.46, 0.115, 0.15, 0.01, paint);
  p.decal(0.14, h + 0.26, 0.4655, 0.09, 0.09, 'south', { color: 0xffffff });
}

const roofDecal = (p: PartSet, x: number, y: number, z: number, size: number): void => p.decal(x, y, z, size, size, 'up', { color: 0xffffff });

function tower(p: PartSet, cx: number, cz: number, w: number, d: number, y0: number, h: number, off: [number, number]): void {
  p.box(cx, y0 + h / 2, cz, w, h, d, { color: C.wall, bucket: 'windows', winOffset: off });
}

function arcology(p: PartSet, t: TileInfo): void {
  const y0 = PAD_H;
  bay(p, y0);
  const r = (i: number): [number, number] => [Math.floor(hash2(t.x, t.y, 40 + i) * 4) * 0.25, Math.floor(hash2(t.x, t.y, 50 + i) * 4) * 0.25];
  pad(p, y0);
  // Three stacked towers of different heights, a low podium and a skybridge between the two tallest.
  tower(p, 0.5, 0.42, 0.7, 0.14, y0, 0.14, r(0));
  tower(p, 0.3, 0.27, 0.2, 0.2, y0, 0.42, r(1));
  tower(p, 0.3, 0.27, 0.14, 0.14, y0 + 0.42, 0.14, r(2));
  p.box(0.3, y0 + 0.565, 0.27, 0.2, 0.02, 0.2, paint);
  tower(p, 0.6, 0.23, 0.2, 0.18, y0, 0.58, r(3));
  tower(p, 0.6, 0.23, 0.13, 0.12, y0 + 0.58, 0.18, r(4));
  p.box(0.6, y0 + 0.77, 0.23, 0.2, 0.02, 0.18, paint);
  tower(p, 0.84, 0.34, 0.15, 0.15, y0, 0.32, r(5));
  p.box(0.84, y0 + 0.33, 0.34, 0.17, 0.02, 0.17, paint);
  p.box(0.45, y0 + 0.31, 0.26, 0.15, 0.035, 0.05, { color: C.wallDark });
  p.cyl(0.6, y0 + 0.86, 0.23, 0.006, 0.01, 0.16, 5, { color: C.steel });
  p.sphere(0.6, y0 + 0.945, 0.23, 0.02, 0.02, 0.02, 8, 6, accent(2.4));
  p.box(0.3, y0 + 0.36, 0.385, 0.16, 0.02, 0.03, { color: C.wallDark });
  roofDecal(p, 0.84, y0 + 0.342, 0.34, 0.13);
  roofDecal(p, 0.3, y0 + 0.576, 0.27, 0.17);
}

function fabricator(p: PartSet, _t: TileInfo): void {
  const y0 = PAD_H;
  bay(p, y0);
  pad(p, y0);
  // A long hall with a flat annex, three sawtooth roof bays, a stack and a gantry crane.
  p.box(0.46, y0 + 0.1, 0.3, 0.76, 0.2, 0.34, { color: C.wall });
  p.box(0.46, y0 + 0.012, 0.3, 0.78, 0.024, 0.36, { color: C.wallDark });
  p.box(0.2, y0 + 0.205, 0.3, 0.24, 0.014, 0.36, paint);
  roofDecal(p, 0.2, y0 + 0.2145, 0.3, 0.16);
  for (let i = 0; i < 3; i++) {
    const x = 0.45 + i * 0.185;
    p.box(x, y0 + 0.228, 0.3, 0.19, 0.022, 0.35, { ...paint, rz: -0.32 });
    p.box(x - 0.087, y0 + 0.232, 0.3, 0.012, 0.05, 0.34, { color: C.glass });
  }
  p.box(0.46, y0 + 0.075, 0.4725, 0.34, 0.1, 0.005, { color: C.warm, bucket: 'glow', mult: 1.2 });
  p.cyl(0.8, y0 + 0.3, 0.17, 0.034, 0.044, 0.4, 8, { color: C.metal });
  p.cyl(0.8, y0 + 0.5, 0.17, 0.042, 0.042, 0.03, 8, paint);
  p.sphere(0.8, y0 + 0.525, 0.17, 0.02, 0.02, 0.02, 6, 4, accent(1.8));
  // Gantry crane along the east side.
  const gx = 0.925;
  p.box(gx, y0 + 0.2, 0.14, 0.028, 0.4, 0.028, { color: C.yellow });
  p.box(gx, y0 + 0.2, 0.5, 0.028, 0.4, 0.028, { color: C.yellow });
  p.box(gx, y0 + 0.405, 0.32, 0.03, 0.03, 0.4, { color: C.yellow });
  p.box(gx, y0 + 0.372, 0.34, 0.05, 0.03, 0.06, { color: C.metal });
  p.cyl(gx, y0 + 0.3, 0.34, 0.003, 0.003, 0.14, 4, { color: C.steel });
  p.box(gx, y0 + 0.225, 0.34, 0.04, 0.03, 0.04, { color: C.metal });
}

function skyport(p: PartSet, _t: TileInfo): void {
  const y0 = PAD_H;
  pad(p, y0);
  // The landing disc sits at the centre of the front half; the control tower and hangar stay at the back.
  p.cyl(0.5, y0 + 0.011, 0.58, 0.335, 0.335, 0.022, 28, { color: C.asphalt });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    p.box(0.5 + Math.cos(a) * 0.285, y0 + 0.024, 0.58 + Math.sin(a) * 0.285, 0.05, 0.004, 0.014, { color: C.white, ry: -a + Math.PI / 2 });
  }
  p.box(0.43, y0 + 0.024, 0.58, 0.022, 0.004, 0.17, { color: C.white });
  p.box(0.57, y0 + 0.024, 0.58, 0.022, 0.004, 0.17, { color: C.white });
  p.box(0.5, y0 + 0.024, 0.58, 0.14, 0.004, 0.022, { color: C.white });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    p.sphere(0.5 + Math.cos(a) * 0.325, y0 + 0.03, 0.58 + Math.sin(a) * 0.325, 0.012, 0.012, 0.012, 6, 4, accent(1.7));
  }
  // Control tower.
  p.cyl(0.86, y0 + 0.2, 0.19, 0.038, 0.05, 0.4, 8, { color: C.wall });
  p.cyl(0.86, y0 + 0.425, 0.19, 0.083, 0.07, 0.05, 8, { color: C.wallDark });
  p.cyl(0.86, y0 + 0.47, 0.19, 0.088, 0.088, 0.04, 8, { color: C.glass, bucket: 'glow', mult: 0.9 });
  p.cone(0.86, y0 + 0.525, 0.19, 0.105, 0.07, 8, paint);
  p.cyl(0.86, y0 + 0.62, 0.19, 0.004, 0.006, 0.12, 4, { color: C.steel });
  p.sphere(0.86, y0 + 0.69, 0.19, 0.02, 0.02, 0.02, 8, 6, accent(2.6));
  // Hangar.
  p.box(0.17, y0 + 0.07, 0.17, 0.22, 0.14, 0.18, { color: C.wall });
  p.box(0.17, y0 + 0.15, 0.17, 0.25, 0.022, 0.21, paint);
  roofDecal(p, 0.17, y0 + 0.162, 0.17, 0.14);
  p.box(0.17, y0 + 0.06, 0.263, 0.14, 0.09, 0.006, { color: C.warm, bucket: 'glow', mult: 0.8 });
}

function dock(p: PartSet, t: TileInfo): void {
  const y0 = 0.04;
  pad(p, y0);
  banner(p, y0);
  // Canonical frame: the water is to the north. `frame` turns the pier toward the real water.
  const dirRot: Record<Dir, number> = { N: 0, E: 1, S: 2, W: 3 };
  p.frame(dirRot[t.dockDir ?? 'N']);
  p.box(0.5, y0 + 0.012, 0.13, 0.9, 0.024, 0.2, { color: C.wood });
  for (let i = 0; i < 9; i++) p.box(0.1 + i * 0.1, y0 + 0.0255, 0.13, 0.006, 0.003, 0.2, { color: C.woodDark });
  for (let i = 0; i < 6; i++) {
    const x = 0.12 + i * 0.152;
    p.cyl(x, -0.02, 0.045, 0.02, 0.02, 0.12, 6, { color: C.woodDark });
    p.cyl(x, y0 + 0.04, 0.04, 0.016, 0.016, 0.03, 6, { color: C.metal });
  }
  p.box(0.5, y0 + 0.012, 0.025, 0.9, 0.03, 0.03, { color: C.woodDark });
  // Crane.
  p.box(0.84, y0 + 0.05, 0.4, 0.13, 0.1, 0.13, { color: C.wallDark });
  p.cyl(0.84, y0 + 0.2, 0.4, 0.018, 0.026, 0.22, 6, { color: C.yellow });
  p.box(0.84, y0 + 0.36, 0.26, 0.032, 0.03, 0.34, { ...paint, rx: -0.3 });
  p.box(0.84, y0 + 0.32, 0.47, 0.07, 0.05, 0.07, { color: C.metal });
  p.cyl(0.84, y0 + 0.25, 0.13, 0.003, 0.003, 0.2, 4, { color: C.steel });
  p.box(0.84, y0 + 0.14, 0.13, 0.04, 0.04, 0.04, { color: C.yellow });
  p.sphere(0.84, y0 + 0.385, 0.4, 0.016, 0.016, 0.016, 6, 4, accent(1.8));
  // Warehouse.
  p.box(0.36, y0 + 0.09, 0.42, 0.3, 0.18, 0.2, { color: C.wall });
  p.box(0.36, y0 + 0.19, 0.42, 0.33, 0.022, 0.23, paint);
  roofDecal(p, 0.36, y0 + 0.202, 0.42, 0.15);
  p.frame(0);
}

function uplink(p: PartSet, _t: TileInfo): void {
  const y0 = PAD_H;
  bay(p, y0);
  pad(p, y0);
  p.box(0.3, y0 + 0.065, 0.3, 0.3, 0.13, 0.22, { color: C.wall });
  p.box(0.3, y0 + 0.14, 0.3, 0.33, 0.02, 0.25, paint);
  roofDecal(p, 0.3, y0 + 0.151, 0.3, 0.15);
  p.box(0.3, y0 + 0.055, 0.412, 0.12, 0.07, 0.005, { color: C.glass, bucket: 'glow', mult: 0.7 });
  // Lattice mast: a tapered tower with bracing rings.
  p.cyl(0.72, y0 + 0.31, 0.26, 0.016, 0.046, 0.62, 6, { color: C.steel });
  for (const [yy, rr] of [[0.1, 0.044], [0.24, 0.034], [0.38, 0.026], [0.5, 0.02]] as const) {
    p.cyl(0.72, y0 + yy, 0.26, rr, rr, 0.012, 6, { color: C.metal });
  }
  // The dish: a bowl opening toward the camera, with its feed horn and a beacon at the focus.
  p.sphere(0.72, y0 + 0.66, 0.285, 0.19, 0.095, 0.19, 16, 6, { color: 0xcdd5de, rx: 0.62, inside: true }, Math.PI / 2 + 0.3, Math.PI / 2 - 0.3);
  p.sphere(0.72, y0 + 0.66, 0.285, 0.19, 0.095, 0.19, 16, 2, { ...paint, rx: 0.62, inside: true }, Math.PI / 2, 0.3);
  p.cyl(0.72, y0 + 0.76, 0.34, 0.004, 0.004, 0.13, 4, { color: C.steel, rx: 0.62 });
  p.sphere(0.72, y0 + 0.83, 0.38, 0.02, 0.02, 0.02, 8, 6, accent(2.6));
  p.cyl(0.72, y0 + 0.64, 0.26, 0.02, 0.02, 0.05, 6, { color: C.metal });
}

function spire(p: PartSet, t: TileInfo): void {
  const y0 = PAD_H;
  bay(p, y0);
  const r = (i: number): [number, number] => [Math.floor(hash2(t.x, t.y, 60 + i) * 4) * 0.25, Math.floor(hash2(t.x, t.y, 70 + i) * 4) * 0.25];
  pad(p, y0);
  tower(p, 0.5, 0.3, 0.72, 0.3, y0, 0.16, r(0));
  p.box(0.5, y0 + 0.17, 0.3, 0.76, 0.02, 0.34, paint);
  roofDecal(p, 0.255, y0 + 0.1815, 0.3, 0.15);
  roofDecal(p, 0.745, y0 + 0.1815, 0.3, 0.15);
  tower(p, 0.5, 0.3, 0.22, 0.22, y0 + 0.18, 0.36, r(1));
  p.box(0.5, y0 + 0.555, 0.3, 0.26, 0.024, 0.26, paint);
  tower(p, 0.5, 0.3, 0.14, 0.14, y0 + 0.567, 0.3, r(2));
  p.box(0.5, y0 + 0.875, 0.3, 0.18, 0.026, 0.18, paint);
  p.cyl(0.5, y0 + 1.0, 0.3, 0.004, 0.014, 0.25, 6, { color: C.steel });
  p.sphere(0.5, y0 + 1.14, 0.3, 0.032, 0.032, 0.032, 10, 8, accent(3.2));
  // Buttress fins at the corners of the lower shaft.
  for (const [dx, dz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]] as const) {
    p.box(0.5 + dx, y0 + 0.3, 0.3 + dz, 0.03, 0.24, 0.03, { color: C.wallDark });
  }
}

const BUILD: Record<PropertyId, (p: PartSet, t: TileInfo) => void> = { arcology, fabricator, skyport, dock, uplink, spire };

/** Add one property tile's model (and, for every kind, its banner) to the part set. */
export function addProperty(p: PartSet, t: TileInfo): void {
  if (!t.property) return;
  p.begin(t.index, t.x, t.y);
  BUILD[t.terrain as PropertyId](p, t);
  if (t.terrain !== 'dock') banner(p, PAD_H);
}
