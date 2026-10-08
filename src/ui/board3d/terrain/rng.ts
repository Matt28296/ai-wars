// Deterministic hashing, noise and a small PRNG for the terrain kit. There is no Math.random anywhere in the kit: the same map always
// builds the same board, tree for tree, so a screenshot, a test and a replay all see one world.

/** Integer-lattice hash to [0, 1). Same inputs, same output, on every machine. */
export function hash2(ix: number, iy: number, seed = 0): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** mulberry32: a tiny seeded generator returning [0, 1). */
export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable seed for a tile and a purpose (`salt`), so each feature on a tile varies independently. */
export function tileSeed(x: number, y: number, salt = 0): number {
  return (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0;
}

export const smooth = (t: number): number => t * t * (3 - 2 * t);
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** Smooth value noise in [0, 1). */
export function valueNoise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** Two octaves of value noise, in [0, 1). */
export function fbm(x: number, y: number, seed = 0): number {
  return valueNoise(x, y, seed) * 0.62 + valueNoise(x * 2.13 + 7.3, y * 2.13 - 3.1, seed + 1) * 0.38;
}
