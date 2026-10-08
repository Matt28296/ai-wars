// Seeded randomness for the effects kit. Every particle of an effect is drawn from (kind, progress, seed) alone, so the
// random numbers must be a pure function of the seed: mulberry32 (a public-domain 32-bit generator by Tommy Ettinger).

/** The standard closure form, kept for callers that want one stream; draw() uses the reusable `Rng` below instead. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same stream as `mulberry32`, but re-seedable in place, so draw() allocates no closure per effect. */
export class Rng {
  private a = 0;

  reset(seed: number): this {
    this.a = seed >>> 0;
    return this;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
}
