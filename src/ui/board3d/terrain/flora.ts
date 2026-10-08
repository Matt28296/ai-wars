// Trees, rocks and glass: the small stuff that makes a tile read as its terrain.
//  - canopy: 3-5 stylised trees per tile as instances of two species (a pine and a broadleaf), seeded so a map always grows the same
//    wood; they keep to the sides and back of the tile so a unit standing in the wood stays readable.
//  - ridge: faceted boulders on the plateau's rim. flats: a few pebbles. glass: dark glossy shards with a faint red glow at their roots
//    and along hairline cracks.
import { Color, Euler, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { TERRAIN_COLOR } from '../palette';
import { PartSet } from './geo';
import { surfaceY, type Board, type TileInfo } from './layout';
import { rngFrom, tileSeed } from './rng';

// ---------------------------------------------------------------- trees

function treePart(species: 'pine' | 'broadleaf'): BufferGeometry {
  const p = new PartSet().begin(0, -0.5, -0.5);
  if (species === 'pine') {
    p.cyl(0.5, 0.045, 0.5, 0.016, 0.024, 0.09, 5, { color: 0x5a4332 });
    p.cone(0.5, 0.15, 0.5, 0.125, 0.17, 6, { color: 0x2d6a45 });
    p.cone(0.5, 0.26, 0.5, 0.1, 0.16, 6, { color: 0x377a50 });
    p.cone(0.5, 0.36, 0.5, 0.07, 0.14, 6, { color: 0x4a9060 });
  } else {
    p.cyl(0.5, 0.06, 0.5, 0.014, 0.022, 0.12, 5, { color: 0x5f4a36 });
    p.ico(0.5, 0.23, 0.5, 0.13, 0.1, 0.13, { color: 0x3e8656 });
    p.ico(0.54, 0.3, 0.48, 0.09, 0.075, 0.09, { color: 0x4c9a62 });
    p.ico(0.45, 0.27, 0.54, 0.08, 0.07, 0.08, { color: 0x357a4e });
  }
  const g = p.finish().solid!;
  return g;
}

export const pineGeometry = (): BufferGeometry => treePart('pine');
export const broadleafGeometry = (): BufferGeometry => treePart('broadleaf');

export interface TreeInstance { species: 0 | 1; matrix: Matrix4; tint: Color; tile: number }

/** Where candidate trees may stand inside a tile; the last two are at the front (nearest the camera) and are used last and smaller. */
const TREE_SLOTS: [number, number][] = [[0.2, 0.24], [0.5, 0.13], [0.8, 0.22], [0.13, 0.6], [0.87, 0.58], [0.27, 0.86], [0.74, 0.87]];

export function planTrees(board: Board): TreeInstance[] {
  const out: TreeInstance[] = [];
  const q = new Quaternion();
  const e = new Euler();
  const pos = new Vector3();
  const sc = new Vector3();
  for (const t of board.tiles) {
    if (t.terrain !== 'canopy') continue;
    const rnd = rngFrom(tileSeed(t.x, t.y, 7));
    const count = 3 + Math.floor(rnd() * 3);
    const order = TREE_SLOTS.map((s, i) => ({ s, k: rnd() + (i >= 5 ? 0.6 : 0) })).sort((a, b) => a.k - b.k).slice(0, count);
    for (const { s } of order) {
      const front = s[1] > 0.8;
      const x = t.x + s[0] + (rnd() - 0.5) * 0.1;
      const z = t.y + s[1] + (rnd() - 0.5) * 0.08;
      const scale = (0.95 + rnd() * 0.45) * (front ? 0.82 : 1);
      e.set(0, rnd() * Math.PI * 2, 0);
      q.setFromEuler(e);
      pos.set(x, surfaceY(t, 0.5, 0.5), z);
      sc.set(scale, scale * (0.9 + rnd() * 0.25), scale);
      const tint = new Color(0.86 + rnd() * 0.3, 0.9 + rnd() * 0.18, 0.86 + rnd() * 0.26);
      out.push({ species: rnd() < 0.58 ? 0 : 1, matrix: new Matrix4().compose(pos, q, sc), tint, tile: t.index });
    }
  }
  return out;
}

// ---------------------------------------------------------------- rocks, pebbles and glass

const ROCK_DETAIL = new Color(TERRAIN_COLOR.ridge.detail);
const BOULDER_SLOTS: [number, number][] = [[0.17, 0.2], [0.84, 0.22], [0.82, 0.82], [0.16, 0.8], [0.5, 0.1]];
const SHARD_SLOTS: [number, number][] = [[0.14, 0.2], [0.82, 0.16], [0.9, 0.62], [0.12, 0.7], [0.4, 0.9], [0.7, 0.88], [0.5, 0.12], [0.3, 0.2]];

function hexOf(c: Color): number { return c.getHex(); }

/** Boulders on ridge tiles, pebbles on flats and shards on glass, added to the part set (solid, glossy and glow buckets). */
export function addDecor(p: PartSet, t: TileInfo): void {
  p.begin(t.index, t.x, t.y);
  const rnd = rngFrom(tileSeed(t.x, t.y, 3));
  if (t.terrain === 'ridge') {
    const count = 2 + Math.floor(rnd() * 2);
    const order = BOULDER_SLOTS.map((s) => ({ s, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, count);
    for (const { s } of order) {
      const size = 0.065 + rnd() * 0.06;
      const c = new Color().copy(ROCK_DETAIL).multiplyScalar(0.78 + rnd() * 0.3);
      p.ico(s[0], surfaceY(t, s[0], s[1]) + size * 0.3, s[1], size, size * 0.72, size * 0.9, { color: hexOf(c), ry: rnd() * 6.28, rx: (rnd() - 0.5) * 0.5, rz: (rnd() - 0.5) * 0.5 });
    }
  } else if (t.terrain === 'flats') {
    const count = Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const size = 0.014 + rnd() * 0.016;
      const g = 0.5 + rnd() * 0.22;
      p.ico(0.1 + rnd() * 0.8, size * 0.35, 0.1 + rnd() * 0.8, size, size * 0.55, size * 0.85, { color: new Color(g, g * 0.97, g * 0.9).getHex(), ry: rnd() * 6.28 });
    }
    // Grass tufts: three thin blades leaning apart, in slightly lighter or darker greens than the ground.
    const tufts = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < tufts; i++) {
      const tx = 0.12 + rnd() * 0.76;
      const tz = 0.12 + rnd() * 0.76;
      const c = new Color(TERRAIN_COLOR.flats.detail).multiplyScalar(0.8 + rnd() * 0.45);
      for (let k = 0; k < 3; k++) {
        const a = rnd() * 6.28;
        const h = 0.04 + rnd() * 0.04;
        p.cone(tx + Math.cos(a) * 0.012, h / 2, tz + Math.sin(a) * 0.012, 0.011, h, 3, { color: c.getHex(), rx: Math.sin(a) * 0.35, rz: -Math.cos(a) * 0.35 });
      }
    }
    if (rnd() < 0.18) {
      const fx = 0.15 + rnd() * 0.7;
      const fz = 0.15 + rnd() * 0.7;
      p.cyl(fx, 0.02, fz, 0.003, 0.003, 0.04, 3, { color: 0x4d7a3a });
      p.ico(fx, 0.045, fz, 0.016, 0.012, 0.016, { color: [0xf4eab0, 0xf1b6d4, 0xf6d36b, 0xc9b8f2][Math.floor(rnd() * 4)] });
    }
  } else if (t.terrain === 'glass') {
    // Dark glossy shards standing in the pale glass, and jagged hairline cracks glowing a faint red.
    for (const sh of glassShards(t)) {
      p.cone(sh.x, sh.h / 2, sh.z, sh.r, sh.h, sh.seg, { color: sh.ink, bucket: 'glossy', rx: sh.rx, rz: sh.rz, ry: sh.ry });
      p.cone(sh.x + sh.dx, sh.h * 0.3, sh.z + sh.dz, sh.r * 0.6, sh.h * 0.6, 4, { color: sh.ink, bucket: 'glossy', ry: sh.ry + 1, rx: -sh.rx * 1.4, rz: -sh.rz * 1.4 });
    }
    for (const c of glassCracks(t)) {
      p.box(c.x, 0.004, c.z, c.len, 0.003, c.w, { color: 0xff2a3a, bucket: 'glow', mult: 0.55, ry: -c.angle });
    }
  }
}

// ---------------------------------------------------------------- glass sites (shared with the ground colouring, so the glow sits under the shards)

export interface Shard { x: number; z: number; h: number; r: number; seg: number; rx: number; rz: number; ry: number; ink: number; dx: number; dz: number }
export interface Crack { x: number; z: number; len: number; angle: number; w: number }

export function glassShards(t: TileInfo): Shard[] {
  const rnd = rngFrom(tileSeed(t.x, t.y, 5));
  const count = 5 + Math.floor(rnd() * 3);
  const order = SHARD_SLOTS.map((s) => ({ s, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, count);
  return order.map(({ s }) => ({
    x: s[0] + (rnd() - 0.5) * 0.06,
    z: s[1] + (rnd() - 0.5) * 0.06,
    h: 0.12 + rnd() * 0.2,
    r: 0.04 + rnd() * 0.04,
    seg: 4 + Math.floor(rnd() * 2),
    rx: (rnd() - 0.5) * 0.5,
    rz: (rnd() - 0.5) * 0.5,
    ry: rnd() * 6.28,
    ink: new Color(0.07 + rnd() * 0.05, 0.09 + rnd() * 0.05, 0.15 + rnd() * 0.07).getHex(),
    dx: (rnd() - 0.5) * 0.05,
    dz: (rnd() - 0.5) * 0.05,
  }));
}

/** Cracks as short straight segments that wander: a main fissure of four steps and a two-step branch, two or three times per tile. */
export function glassCracks(t: TileInfo): Crack[] {
  const rnd = rngFrom(tileSeed(t.x, t.y, 6));
  const out: Crack[] = [];
  const n = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    let a = rnd() * Math.PI * 2;
    let x = 0.5 + (rnd() - 0.5) * 0.3;
    let z = 0.5 + (rnd() - 0.5) * 0.3;
    for (let k = 0; k < 4; k++) {
      const len = 0.06 + rnd() * 0.06;
      out.push({ x: x + Math.cos(a) * len / 2, z: z + Math.sin(a) * len / 2, len, angle: a, w: 0.006 + rnd() * 0.004 });
      x += Math.cos(a) * len;
      z += Math.sin(a) * len;
      if (k === 1) {
        let bx = x; let bz = z; let ba = a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.5);
        for (let j = 0; j < 2; j++) {
          const bl = 0.05 + rnd() * 0.04;
          out.push({ x: bx + Math.cos(ba) * bl / 2, z: bz + Math.sin(ba) * bl / 2, len: bl, angle: ba, w: 0.005 });
          bx += Math.cos(ba) * bl; bz += Math.sin(ba) * bl; ba += (rnd() - 0.5) * 0.7;
        }
      }
      a += (rnd() - 0.5) * 1.0;
    }
  }
  return out;
}

/** 0..1: how much the glass at tile-local (u, v) glows from underneath: strongest at the roots of shards and along cracks. */
export function glassGlow(t: TileInfo, u: number, v: number): number {
  let g = 0;
  for (const s of glassShards(t)) g = Math.max(g, Math.exp(-(((u - s.x) ** 2 + (v - s.z) ** 2) / ((s.r * 3.2) ** 2))));
  for (const c of glassCracks(t)) {
    const dx = Math.cos(c.angle); const dz = Math.sin(c.angle);
    const along = Math.max(-c.len / 2, Math.min(c.len / 2, (u - c.x) * dx + (v - c.z) * dz));
    const d = Math.hypot(u - (c.x + dx * along), v - (c.z + dz * along));
    g = Math.max(g, 0.9 * Math.exp(-((d / 0.045) ** 2)));
  }
  return g;
}
