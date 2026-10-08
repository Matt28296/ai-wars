// The match intro against known answers: the shape of the dolly, the policy of when it runs, and the clock that drives it.
import { describe, expect, it } from 'vitest';
import { INTRO_DISTANCE, INTRO_PITCH_DEG, INTRO_SECONDS, Intro, introAction, introEase, introFraming } from './intro';
import type { IntroEvent } from './intro';
import { PITCH_DEG, REST_FRAMING } from './rig';

describe('the intro dolly', () => {
  it('starts wide and low, ends exactly on the resting framing, and is about a second and a half long', () => {
    expect(INTRO_SECONDS).toBeGreaterThanOrEqual(1.2);
    expect(INTRO_SECONDS).toBeLessThanOrEqual(1.8);
    const start = introFraming(0);
    expect(start.distanceScale).toBeCloseTo(INTRO_DISTANCE, 12);
    expect(start.pitchDeg).toBeCloseTo(INTRO_PITCH_DEG, 12);
    expect(start.distanceScale).toBeGreaterThan(1.2); // wider
    expect(start.pitchDeg).toBeLessThan(PITCH_DEG - 10); // lower
    expect(introFraming(1)).toEqual(REST_FRAMING);
    expect(introFraming(5)).toEqual(REST_FRAMING);
  });

  it('eases: 0 and 1 at the ends, symmetric about the middle, monotonic, never outside 0..1', () => {
    expect(introEase(0)).toBe(0);
    expect(introEase(1)).toBe(1);
    expect(introEase(0.5)).toBeCloseTo(0.5, 12);
    let last = 0;
    for (let i = 0; i <= 100; i++) {
      const e = introEase(i / 100);
      expect(e).toBeGreaterThanOrEqual(last);
      expect(e).toBeLessThanOrEqual(1);
      expect(introEase(i / 100) + introEase(1 - i / 100)).toBeCloseTo(1, 12);
      last = e;
    }
    expect(introEase(-3)).toBe(0);
    expect(introEase(9)).toBe(1);
  });

  it('closes monotonically from the wide framing to the resting one, with no overshoot', () => {
    let distance = Infinity;
    let pitch = -Infinity;
    for (let i = 0; i <= 150; i++) {
      const f = introFraming(i / 150);
      expect(f.distanceScale).toBeLessThanOrEqual(distance);
      expect(f.distanceScale).toBeGreaterThanOrEqual(1);
      expect(f.pitchDeg).toBeGreaterThanOrEqual(pitch);
      expect(f.pitchDeg).toBeLessThanOrEqual(PITCH_DEG);
      distance = f.distanceScale;
      pitch = f.pitchDeg;
    }
  });

  it('a bad clock lands on the resting pose, never on the wide one', () => {
    expect(introFraming(NaN)).toEqual(REST_FRAMING);
    expect(introFraming(Infinity)).toEqual(REST_FRAMING);
  });
});

const base: IntroEvent = { first: false, step: 5, reducedMotion: false, timelineChanged: false, stepChanged: false, planned: false, active: false };

describe('when the intro runs', () => {
  it('starts when the match is opened at step 0', () => {
    expect(introAction({ ...base, first: true, step: 0 })).toBe('start');
  });

  it('known-bad inputs: not at a later step, not under reduced motion, not when it is not the first view', () => {
    expect(introAction({ ...base, first: true, step: 40 })).toBe('keep'); // opened at a later step
    expect(introAction({ ...base, first: true, step: 1 })).toBe('keep');
    expect(introAction({ ...base, first: true, step: 0, reducedMotion: true })).toBe('keep'); // reduced motion
    expect(introAction({ ...base, first: false, step: 0, stepChanged: true })).toBe('keep'); // scrubbing back to 0 is not an opening
    expect(introAction({ ...base, first: false, step: 0 })).toBe('keep');
  });

  it('a scrub or a viewer change ends a running intro; pressing play does not; reduced motion turning on does', () => {
    const running = { ...base, step: 0, active: true };
    expect(introAction({ ...running, stepChanged: true, planned: false })).toBe('skip'); // a jump or a rewind has no plan
    expect(introAction({ ...running, timelineChanged: true })).toBe('skip');
    expect(introAction({ ...running, stepChanged: true, planned: true })).toBe('keep'); // the next step arrived by playing
    expect(introAction({ ...running })).toBe('keep'); // nothing changed (a re-render)
    expect(introAction({ ...running, reducedMotion: true })).toBe('skip');
    expect(introAction({ ...base, reducedMotion: true })).toBe('keep'); // nothing running: nothing to skip
  });
});

describe('the intro clock', () => {
  it('runs from 0 to 1 over INTRO_SECONDS of the stage\'s clock, then rests on the resting framing', () => {
    const intro = new Intro();
    expect(intro.active).toBe(false); // never started: no intro
    expect(intro.framing()).toEqual(REST_FRAMING);
    intro.start();
    expect(intro.active).toBe(true);
    expect(intro.progress).toBe(0);
    expect(intro.framing().distanceScale).toBeCloseTo(INTRO_DISTANCE, 12);
    for (let i = 0; i < 45; i++) intro.update(1 / 60); // 0.75 s: halfway
    expect(intro.progress).toBeCloseTo(0.5, 9);
    expect(intro.active).toBe(true);
    intro.update(10);
    expect(intro.active).toBe(false);
    expect(intro.progress).toBe(1);
    expect(intro.framing()).toEqual(REST_FRAMING);
    intro.update(1); // idle after the end
    expect(intro.progress).toBe(1);
  });

  it('skip lands on the end at once; a negative or NaN step of time moves nothing', () => {
    const intro = new Intro();
    intro.start();
    intro.update(-5);
    intro.update(NaN);
    expect(intro.progress).toBe(0);
    intro.skip();
    expect(intro.active).toBe(false);
    expect(intro.framing()).toEqual(REST_FRAMING);
  });
});
