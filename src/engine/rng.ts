// mulberry32 — tiny, fast, deterministic. The generator state lives in GameState.rng (an int32),
// so every random draw is part of the immutable state and games replay exactly from seed + actions.

/** Normalise any number into a valid int32 generator state. */
export function seedRng(seed: number): number {
  return Number.isFinite(seed) ? Math.floor(seed) | 0 : 0;
}

/** One step of mulberry32: returns a float in [0, 1) and the next state. */
export function nextRandom(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** Integer in [min, max] (inclusive) and the next state. */
export function randomInt(state: number, min: number, max: number): [number, number] {
  if (max <= min) return [min, nextRandom(state)[1]];
  const [f, next] = nextRandom(state);
  return [min + Math.floor(f * (max - min + 1)), next];
}
