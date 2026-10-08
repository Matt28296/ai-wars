// The impact shake: short, small, seeded, decaying to exactly zero. Everything is worked out here from what the order asks for (about a
// quarter of a second, decaying, deterministic from the beat's seed), not read back from shake.ts.
import { describe, expect, it } from 'vitest';
import { SHAKE_AMPLITUDE, SHAKE_MS, SHAKE_WEIGHT, shakeEnvelope, shakeOffset } from './shake';
import type { ShakeOffset } from './shake';

const at = (seed: number, u: number, weight = 1): ShakeOffset => shakeOffset(seed, u, weight, { x: 0, y: 0 });
const grid = (n: number, from = 0, to = 1): number[] => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

describe('the shake lasts about a quarter of a second', () => {
  it('SHAKE_MS is 250 and the peak is small: about five pixels on a 600 px tall picture at any zoom', () => {
    expect(SHAKE_MS).toBe(250);
    // a picture 600 px tall shows 2 d tan(15 degrees) of world at distance d, so 0.0055 d is 0.0055 / (2 tan 15) * 600 pixels
    const px = (SHAKE_AMPLITUDE / (2 * Math.tan((15 * Math.PI) / 180))) * 600;
    expect(px).toBeGreaterThan(4);
    expect(px).toBeLessThan(7);
  });
  it('an explosion shakes harder than an ambush, and neither is more than the peak', () => {
    expect(SHAKE_WEIGHT.explosion).toBe(1);
    expect(SHAKE_WEIGHT.ambush).toBeGreaterThan(0);
    expect(SHAKE_WEIGHT.ambush).toBeLessThan(SHAKE_WEIGHT.explosion);
  });
});

describe('the envelope decays to exactly zero', () => {
  it('is 1 at the start, falls all the way down, and is exactly 0 from the end on', () => {
    expect(shakeEnvelope(0)).toBe(1);
    let prev = 1;
    for (const u of grid(200, 0.005, 0.995)) {
      const e = shakeEnvelope(u);
      expect(e).toBeLessThan(prev);
      expect(e).toBeGreaterThan(0);
      prev = e;
    }
    expect(shakeEnvelope(1)).toBe(0);
    expect(shakeEnvelope(1.5)).toBe(0);
    expect(shakeEnvelope(1e9)).toBe(0);
  });
  it('a bad progress is no shake at all, never NaN', () => {
    for (const u of [-0.0001, -1, NaN, Infinity, -Infinity]) expect(shakeEnvelope(u), String(u)).toBe(0);
  });
});

describe('the offset is deterministic from the seed', () => {
  it('the same (seed, progress) always gives the same offset, and another seed gives another', () => {
    for (const u of [0, 0.1, 0.37, 0.8]) {
      expect(at(11, u)).toEqual(at(11, u));
      expect(at(11, u)).not.toEqual(at(12, u));
    }
    // and it does not depend on what was asked before: scrubbing back is exact
    const first = { ...at(11, 0.3) };
    at(11, 0.9);
    at(99, 0.1);
    expect(at(11, 0.3)).toEqual(first);
  });
  it('never exceeds its envelope: across by the envelope, up by 0.7 of it', () => {
    for (const seed of [1, 2, 3, 50, 12345]) {
      for (const u of grid(120, 0, 0.999)) {
        const e = shakeEnvelope(u);
        const o = at(seed, u);
        expect(Math.abs(o.x)).toBeLessThanOrEqual(e + 1e-12);
        expect(Math.abs(o.y)).toBeLessThanOrEqual(0.7 * e + 1e-12);
      }
    }
  });
  it('swings several times in the quarter second (a shake, not a push) and in both directions', () => {
    for (const seed of [3, 4, 5]) {
      let flips = 0;
      let last = 0;
      for (const u of grid(500, 0, 0.9)) {
        const s = Math.sign(at(seed, u).x);
        if (s !== 0 && last !== 0 && s !== last) flips++;
        if (s !== 0) last = s;
      }
      expect(flips, `seed ${seed}`).toBeGreaterThanOrEqual(5);
    }
  });
  it('half the weight is half the shake', () => {
    for (const u of [0.05, 0.2, 0.5]) {
      const full = at(7, u, 1);
      const half = at(7, u, 0.5);
      expect(half.x).toBeCloseTo(full.x / 2, 12);
      expect(half.y).toBeCloseTo(full.y / 2, 12);
    }
  });
});

describe('it decays and then it is over', () => {
  const peak = (seed: number, from: number, to: number): number => Math.max(...grid(200, from, to).map((u) => Math.max(Math.abs(at(seed, u).x), Math.abs(at(seed, u).y))));

  it('the last quarter is under a tenth of the first, and it is exactly (0, 0) once the shake is over', () => {
    for (const seed of [1, 2, 3, 10, 777]) {
      expect(peak(seed, 0, 0.25), `seed ${seed} start`).toBeGreaterThan(0.25);
      expect(peak(seed, 0.75, 0.999), `seed ${seed} end`).toBeLessThan(0.07);
      for (const u of [1, 1.0001, 3, 1e6]) {
        const o = at(seed, u);
        expect(o.x, `seed ${seed} u ${u}`).toBe(0);
        expect(o.y).toBe(0);
      }
    }
  });
  it('KNOWN-BAD: a shake that does not decay fails the decay check above', () => {
    // the same two oscillations without the envelope: still shaking at the end
    const flat = (u: number): number => Math.abs(Math.sin(2 * Math.PI * 20 * u * 0.25 + 1));
    const lateFlat = Math.max(...grid(200, 0.75, 0.999).map(flat));
    expect(lateFlat).toBeGreaterThan(0.5);
    expect(lateFlat < 0.07).toBe(false);
  });
  it('writes into the object it is given and returns it (nothing allocated per frame)', () => {
    const out: ShakeOffset = { x: 9, y: 9 };
    expect(shakeOffset(1, 0.2, 1, out)).toBe(out);
    expect(shakeOffset(1, 5, 1, out)).toBe(out);
    expect(out).toEqual({ x: 0, y: 0 });
  });
});
