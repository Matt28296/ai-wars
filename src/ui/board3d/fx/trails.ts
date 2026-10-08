// The movement trails (G10): 'dust' (ground and hover units), 'wake' (ships, and hover craft over water) and 'contrail' (aircraft).
//
// Like every other effect they are STATELESS: drawn from (kind, progress, seed, at, to, color) alone, with no clock, no stored particle and
// no Math.random, so scrubbing backwards shows exactly what going forwards showed. What the renderer core hands over:
//   at        where the mover is now (the front of the trail);
//   to        a point behind it on its path: the trail streams from `at` toward `to` (the direction it came from), and its length is the
//             distance between them. The core makes it the mover's own reach (a tread kicks up more than a hover skimmer; a ship's wake
//             is long) and shortens it at the start of a move, when there is no path behind the mover yet. The kit reads the LENGTH as how
//             hard the mover works its surroundings and scales density and opacity with it; a hover craft over water has a short one and so
//             draws ripples where a ship draws a full V;
//   progress  0..1 through the move. The trail follows the mover's speed: it builds as the mover gets going and dies away as it slows to
//             its stop, so nothing pops at either end (the glide eases in and out);
//   color     optional tint (the core passes the dust a dry terrain colour).
//
// World anchoring: a puff is not stuck to the mover. Puffs sit on a lattice laid along the line of travel (every `spacing` world units,
// numbered by their position along it), so once dropped a puff stays where it was dropped and the mover leaves it behind; its age is how
// far behind the mover it now is. Each puff's own scatter is seeded by (item seed, lattice number), so a puff keeps its look as it ages.
// Everything is drawn through the existing batches: smoke (alpha puffs, foam) and glow (rings, ribbons), so a trail adds no draw call.
import type { FxItem } from '../contract';
import type { FxContext } from './kinds';
import { MODE, SHAPE } from './shaders';
import { clamp01, rgbOf, smoothstep, TAU } from './util';
import type { Rgb } from './util';

const DUST = rgbOf(0xb3a47c);
const FOAM = rgbOf(0xeaf6ff);
const CONTRAIL = rgbOf(0xeaf3ff);

/** Lattice spacing of the dust puffs, the wake's arm foam, its churn and its ripples (world units; reduced motion widens them). */
export const DUST_SPACING = 0.25;
export const ARM_SPACING = 0.2;
export const CHURN_SPACING = 0.14;
export const RING_SPACING = 0.5;
/** Never walk more than this many lattice points in one effect (a guard: a long or degenerate trail cannot run away). */
const MAX_STEPS = 48;
/** Half the angle of the wake's V, as a ratio of sideways to backwards (tan 19 degrees, the angle of a real ship's wake). */
export const WAKE_SPREAD = 0.34;
/** Trail lengths below this draw nothing (a mover that has barely left its tile). */
export const MIN_TRAIL = 0.02;

/** How strongly a trail is drawn for `progress` through the move: 0 at both ends, 1 at its middle, following the glide's speed. */
export function trailEnv(p: number): number {
  const s = clamp01(4 * p * (1 - p));
  const k = Math.sqrt(s);
  return k * k * (3 - 2 * k);
}

/** A hash of (seed, lattice number) that decorrelates neighbouring cells, for reseeding the generator per puff. */
export function cellSeed(seed: number, j: number): number {
  let h = (seed >>> 0) ^ Math.imul(j | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The line a trail runs along, resolved once per item. (x, y, z) is the mover; (bx, bz) the unit vector pointing BACK along its path. */
interface Line { x: number; y: number; z: number; bx: number; bz: number; px: number; pz: number; len: number; s0: number }
const line: Line = { x: 0, y: 0, z: 0, bx: 0, bz: 0, px: 0, pz: 0, len: 0, s0: 0 };

function resolve(it: FxItem): Line | null {
  const to = it.to;
  if (!to) return null;
  const dx = to.x - it.at.x;
  const dz = to.z - it.at.z;
  const len = Math.hypot(dx, dz);
  if (!(len >= MIN_TRAIL)) return null;
  line.x = it.at.x; line.y = it.at.y; line.z = it.at.z;
  line.bx = dx / len; line.bz = dz / len;
  line.px = -line.bz; line.pz = line.bx; // sideways: the back direction turned a quarter
  line.len = len;
  line.s0 = it.at.x * line.bx + it.at.z * line.bz;
  return line;
}

// ---------------------------------------------------------------------------------------------------------------- dust

export function dust(c: FxContext, it: FxItem, p: number): void {
  const env = trailEnv(p);
  if (!(env > 0.003)) return;
  const L = resolve(it);
  if (!L) return;
  const strength = clamp01(L.len / 1.5);
  const sp = DUST_SPACING / c.density;
  const col = c.pick(c.k1, DUST, 1);
  const tone = c.k2;
  const rng = c.rng;
  let j = Math.ceil(L.s0 / sp);
  for (let n = 0; n < MAX_STEPS; n++, j++) {
    const d = j * sp - L.s0;
    if (d > L.len) break;
    rng.reset(cellSeed(it.seed, j));
    const r1 = rng.next(), r2 = rng.next(), r3 = rng.next(), r4 = rng.next();
    const a = d / L.len;
    const alpha = 1.0 * strength * env * Math.pow(1 - a, 1.1) * smoothstep(0, 0.12, a);
    // from behind the mover's rear edge, drifting further back and spreading as it ages
    const back = d + 0.25 + 0.14 * a;
    const side = (r1 * 2 - 1) * (0.05 + 0.1 * a);
    const x = L.x + L.bx * back + L.px * side;
    const z = L.z + L.bz * back + L.pz * side;
    const y = L.y + 0.06 + 0.26 * Math.pow(a, 0.7) * (0.6 + 0.4 * r2);
    const size = (0.14 + 0.24 * Math.pow(a, 0.8) + 0.05 * r3) * (0.7 + 0.5 * strength);
    const shade = 0.8 + 0.3 * r2;
    tone.r = col.r * shade; tone.g = col.g * shade; tone.b = col.b * shade;
    c.puff(x, y, z, size, r4 * TAU, tone, alpha, r3);
  }
}

// ---------------------------------------------------------------------------------------------------------------- wake

/** A foam blob lying on the water. */
function foam(c: FxContext, col: Rgb, x: number, y: number, z: number, size: number, rot: number, a: number, variation: number): void {
  c.smoke.sprite(x, y, z, size, rot, SHAPE.SMOKE, col.r, col.g, col.b, a, MODE.FLAT, variation, 0);
}

export function wake(c: FxContext, it: FxItem, p: number): void {
  const env = trailEnv(p);
  if (!(env > 0.003)) return;
  const L = resolve(it);
  if (!L) return;
  // A ship (long trail) draws the full V; a hover craft over water (short trail) draws ripples and a little churn.
  const vee = smoothstep(1.1, 1.8, L.len);
  const rng = c.rng;
  const y = L.y;
  const bow = -0.25; // the V starts a little ahead of the mover's centre
  const k = c.pick(c.k1, FOAM, 0.2);

  if (vee > 0.02) {
    const sp = ARM_SPACING / c.density;
    let j = Math.ceil(L.s0 / sp);
    for (let n = 0; n < MAX_STEPS; n++, j++) {
      const d = j * sp - L.s0;
      if (d > L.len) break;
      rng.reset(cellSeed(it.seed, j));
      const r1 = rng.next(), r2 = rng.next(), r3 = rng.next(), r4 = rng.next();
      const a = d / L.len;
      const alpha = 0.9 * vee * env * Math.pow(1 - a, 1.1) * smoothstep(0, 0.06, a);
      const size = 0.07 + 0.11 * Math.pow(a, 0.8) + 0.025 * r1;
      for (let s = -1; s <= 1; s += 2) {
        const lat = s * (0.04 + WAKE_SPREAD * d + (r2 - 0.5) * 0.05);
        foam(c, k, L.x + L.bx * (d + bow) + L.px * lat, y + 0.004, L.z + L.bz * (d + bow) + L.pz * lat, size * (s < 0 ? 1 : 0.9 + 0.2 * r3), r4 * TAU + s, alpha, r3);
      }
    }
    // the crest lines: two thin streaks along the arms, bright at the bow and gone at the far end
    const far = L.len + bow;
    for (let s = -1; s <= 1; s += 2) {
      const lat0 = s * 0.04;
      const lat1 = s * (0.04 + WAKE_SPREAD * L.len);
      c.streak(
        L.x + L.bx * far + L.px * lat1, y + 0.006, L.z + L.bz * far + L.pz * lat1,
        L.x + L.bx * bow + L.px * lat0, y + 0.006, L.z + L.bz * bow + L.pz * lat0,
        0.02, k, 1.0, 0.75 * vee * env, 1.5,
      );
    }
  }

  // the churn along the middle of the path
  {
    const sp = CHURN_SPACING / c.density;
    let j = Math.ceil(L.s0 / sp);
    for (let n = 0; n < MAX_STEPS; n++, j++) {
      const d = j * sp - L.s0;
      if (d > L.len) break;
      rng.reset(cellSeed(it.seed ^ 0x5bd1e995, j));
      const r1 = rng.next(), r2 = rng.next(), r3 = rng.next();
      const a = d / L.len;
      const alpha = (0.34 + 0.22 * vee) * env * Math.pow(1 - a, 1.5) * smoothstep(0, 0.05, a);
      const lat = (r1 * 2 - 1) * 0.06 * (0.5 + a);
      foam(c, k, L.x + L.bx * (d + 0.1) + L.px * lat, y + 0.003, L.z + L.bz * (d + 0.1) + L.pz * lat, 0.09 + 0.1 * a + 0.02 * r2, r3 * TAU, alpha, r2);
    }
  }

  // ripples: rings that spread from where the mover was
  {
    const sp = RING_SPACING / c.density;
    let j = Math.ceil(L.s0 / sp);
    for (let n = 0; n < MAX_STEPS; n++, j++) {
      const d = j * sp - L.s0;
      if (d > L.len) break;
      const a = d / L.len;
      const alpha = 0.7 * env * Math.pow(1 - a, 1.4) * smoothstep(0, 0.08, a) * (1 - 0.55 * vee);
      c.glowAt(L.x + L.bx * (d + 0.05), y + 0.006, L.z + L.bz * (d + 0.05), 0.09 + 0.34 * a, SHAPE.RING, k, 0.9, alpha, 0, MODE.FLAT, 0, 0.2);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------- contrail

export function contrail(c: FxContext, it: FxItem, p: number): void {
  const env = trailEnv(p);
  if (!(env > 0.003)) return;
  const L = resolve(it);
  if (!L) return;
  const col = c.pick(c.k1, CONTRAIL, 0.2);
  const y = L.y;
  const NEAR = 0.14; // behind the aircraft's centre, at its tail
  const full = c.density >= 1;
  // two thin trails from the wing roots, opening a little as they age
  for (let s = -1; s <= 1; s += 2) {
    const lat0 = s * 0.085;
    const lat1 = s * (0.085 + 0.02 * L.len);
    c.streak(
      L.x + L.bx * L.len + L.px * lat1, y, L.z + L.bz * L.len + L.pz * lat1,
      L.x + L.bx * NEAR + L.px * lat0, y, L.z + L.bz * NEAR + L.pz * lat0,
      0.022, col, 2.0, 0.9 * env, 1.2,
    );
  }
  if (full) {
    // a soft haze down the middle, and a glint at the tail
    c.streak(L.x + L.bx * L.len * 0.85, y, L.z + L.bz * L.len * 0.85, L.x + L.bx * NEAR, y, L.z + L.bz * NEAR, 0.075, col, 0.6, 0.22 * env, 1.0);
    c.glowAt(L.x + L.bx * NEAR, y, L.z + L.bz * NEAR, 0.1, SHAPE.CORE, col, 1.8, 0.5 * env);
  }
}
