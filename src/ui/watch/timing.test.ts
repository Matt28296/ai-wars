// Animation timing by speed: the limits the order and the quality bar set, checked against literal numbers.
import { describe, expect, it } from 'vitest';
import { SPEEDS, TIMINGS, bannerMs, cutInMs, dwellMs, glideEase, isSpeed, moveTileMs, scaled, slideInOut, tweenEnabled, typedText } from './timing';

describe('unit glides', () => {
  it('take at most 250 ms per tile at 1x, and shrink as the speed rises', () => {
    expect(moveTileMs(1)).toBeGreaterThan(0);
    expect(moveTileMs(1)).toBeLessThanOrEqual(250);
    expect(moveTileMs(2)).toBe(Math.round(TIMINGS.moveTileMs / 2));
    expect(moveTileMs(2)).toBeLessThan(moveTileMs(1));
  });

  it('are skipped at 4x (0 ms means no glide), and for a viewer who asked for reduced motion', () => {
    expect(moveTileMs(4)).toBe(0);
    expect(tweenEnabled(4, false)).toBe(false);
    expect(tweenEnabled(1, true)).toBe(false);
    expect(moveTileMs(1, true)).toBe(0);
    expect(moveTileMs(2, true)).toBe(0);
    expect(tweenEnabled(2, false)).toBe(true);
  });
});

describe('the power cut-in', () => {
  it('is at most 2.2 s at 1x and scales with the speed', () => {
    expect(TIMINGS.cutInMs).toBeLessThanOrEqual(2200);
    expect(cutInMs(1)).toBeLessThanOrEqual(2200);
    expect(cutInMs(1)).toBeGreaterThan(1500); // long enough to read a name and a line
    expect(cutInMs(2)).toBe(cutInMs(1) / 2);
    expect(cutInMs(4)).toBe(cutInMs(1) / 4);
  });
});

describe('turn banner and pauses', () => {
  it('hold the banner about 1.1 s at 1x, and pause about 200 ms between actions (quality bar 8.1 and 12.2)', () => {
    expect(bannerMs(1)).toBe(1100);
    expect(bannerMs(4)).toBe(275);
    expect(dwellMs(1, 500)).toBe(200);
    expect(dwellMs(4, 500)).toBe(50);
  });

  it('give a step with nothing to animate a short beat, never zero (the scrubber keeps a pulse)', () => {
    for (const s of SPEEDS) expect(dwellMs(s, 0)).toBeGreaterThan(0);
    expect(dwellMs(1, 0)).toBeLessThan(dwellMs(1, 1));
  });
});

describe('scaled and isSpeed', () => {
  it('divides by the speed, rounds to whole ms and never goes negative', () => {
    expect(scaled(1000, 4)).toBe(250);
    expect(scaled(333, 2)).toBe(167);
    expect(scaled(-50, 1)).toBe(0);
  });

  it('accepts exactly 1, 2 and 4 (known-bad speeds refused)', () => {
    for (const n of [1, 2, 4]) expect(isSpeed(n)).toBe(true);
    for (const n of [0, 3, 8, 1.5, -1, NaN, '2', null, undefined]) expect(isSpeed(n), String(n)).toBe(false);
  });
});

describe('slideInOut', () => {
  it('starts off to the left, settles at 0 after the in-phase, holds, then leaves to the right', () => {
    expect(slideInOut(0, 0.2, 0.2)).toBe(-1);
    expect(slideInOut(0.2, 0.2, 0.2)).toBeCloseTo(0, 10);
    expect(slideInOut(0.5, 0.2, 0.2)).toBe(0);
    expect(slideInOut(0.8, 0.2, 0.2)).toBeCloseTo(0, 10);
    expect(slideInOut(1, 0.2, 0.2)).toBeCloseTo(1, 10);
  });

  it('eases out on the way in: halfway through the in-phase it has covered more than half the distance', () => {
    // -(1-0.5)^2 = -0.25: only a quarter of the way left to go
    expect(slideInOut(0.1, 0.2, 0.2)).toBeCloseTo(-0.25, 10);
  });

  it('is monotonic (never bounces) and clamps outside 0..1', () => {
    let last = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = slideInOut(i / 100, 0.18, 0.18);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(slideInOut(-3, 0.2, 0.2)).toBe(-1);
    expect(slideInOut(9, 0.2, 0.2)).toBeCloseTo(1, 10);
  });
});

describe('typedText', () => {
  it('reveals a prefix of the text between its start and its end', () => {
    expect(typedText('Jury-rig it', 0, 100, 1000)).toBe('');
    expect(typedText('Jury-rig it', 100, 100, 1000)).toBe('');
    expect(typedText('Jury-rig it', 600, 100, 1000)).toBe('Jury-'); // half of 11 chars = 5
    expect(typedText('Jury-rig it', 1100, 100, 1000)).toBe('Jury-rig it');
    expect(typedText('Jury-rig it', 99999, 100, 1000)).toBe('Jury-rig it');
  });

  it('shows everything at once when the typing takes no time', () => {
    expect(typedText('abc', 0, 0, 0)).toBe('abc');
  });
});

describe('glideEase', () => {
  it('runs 0 to 1, is half way at half way, and eases at both ends', () => {
    expect(glideEase(0)).toBe(0);
    expect(glideEase(1)).toBe(1);
    expect(glideEase(0.5)).toBe(0.5);
    expect(glideEase(0.1)).toBeLessThan(0.1); // slow start
    expect(glideEase(0.9)).toBeGreaterThan(0.9); // slow stop
    expect(glideEase(-1)).toBe(0);
    expect(glideEase(2)).toBe(1);
  });
});
