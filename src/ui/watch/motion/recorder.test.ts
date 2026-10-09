// The recorder's own pieces, in node: the address switch, what it keeps and what it refuses to keep, the window API, and the plan summaries.
import { describe, expect, it } from 'vitest';
import type { TransitionPlan } from '../transition';
import { MAX_FRAMES, MotionRecorder, WINDOW_KEY, activeBeat, describePlan, installMotionRecorder, pageSpeed } from './recorder';
import { probeRequested } from './types';
import type { FrameSample } from './types';

const frame = (t: number): FrameSample => ({
  t, js: 1, tier: 'low', scale: 1, cam: [0, 1, 2], seq: 0, step: 0, planT: null, shake: 0, attack: 0, cut: false, skips: 0, units: [],
});

const planWith = (moves: TransitionPlan['moves'], durationMs: number, tween = true): TransitionPlan => ({
  durationMs, tween, moves, hp: [], fx: [], numbers: [], ghosts: [], appear: [], cutIn: null, banner: null,
});

describe('?probe=motion is the only switch', () => {
  it('reads motion anywhere in the query, in any case, percent-encoded too', () => {
    for (const s of ['?probe=motion', 'probe=motion', '?quality=low&probe=motion', '?probe=MOTION', '?probe=%6Dotion']) expect(probeRequested(s), s).toBe(true);
  });

  it('asks for nothing otherwise (known-bad: none of these turns it on)', () => {
    for (const s of ['', '?', '?probe', '?probe=', '?probe=on', '?probe=1', '?probe=motions', '?probe=motion,fps', '?probes=motion', '?xprobe=motion', '?quality=motion', '?probe=%E0%A4%A']) {
      expect(probeRequested(s), s).toBe(false);
    }
  });
});

describe('the recorder keeps frames, events and long tasks, and hands out copies', () => {
  it('read() gives what was recorded, in order, and mutating the copy does not touch the recording', () => {
    const r = new MotionRecorder({ longTasks: false });
    r.frame(frame(1));
    r.frame(frame(2));
    r.stepStart({ type: 'start', t: 1, seq: 0, step: 0, speed: null, reduced: false, tween: false, planned: false, durationMs: 0, dwellMs: null, moves: [] });
    r.stepDone({ type: 'done', t: 2, seq: 0, step: 0 });
    const a = r.read();
    expect(a.schema).toBe(1);
    expect(a.frames.map((f) => f.t)).toEqual([1, 2]);
    expect(a.events.map((e) => e.type)).toEqual(['start', 'done']);
    a.frames.length = 0;
    expect(r.read().frames).toHaveLength(2);
  });

  it('reset() starts a new recording', () => {
    const r = new MotionRecorder({ longTasks: false });
    r.frame(frame(1));
    r.reset();
    expect(r.read()).toEqual({ schema: 1, frames: [], events: [], longTasks: [], truncated: false });
    r.frame(frame(5));
    expect(r.read().frames.map((f) => f.t)).toEqual([5]);
  });

  it('stops keeping frames at its limit and says so; the default limit is large but finite', () => {
    const r = new MotionRecorder({ maxFrames: 3, longTasks: false });
    for (let i = 0; i < 10; i++) r.frame(frame(i));
    const rec = r.read();
    expect(rec.frames.map((f) => f.t)).toEqual([0, 1, 2]);
    expect(rec.truncated).toBe(true);
    expect(MAX_FRAMES).toBeGreaterThan(10_000);
    r.reset();
    expect(r.read().truncated).toBe(false);
  });

  it('in node, where there are no long-task entries, it records none and does not throw', () => {
    const r = new MotionRecorder();
    expect(r.read().longTasks).toEqual([]);
    r.dispose();
    r.dispose(); // twice is fine
  });
});

describe('window.__awMotion', () => {
  it('is added on install, reads and resets, and is removed by dispose', () => {
    const win: Record<string, unknown> = {};
    const probe = installMotionRecorder(win, { longTasks: false });
    const api = win[WINDOW_KEY] as { version: number; read(): { frames: unknown[] }; reset(): void };
    expect(WINDOW_KEY).toBe('__awMotion');
    expect(api.version).toBe(1);
    probe.frame(frame(1));
    expect(api.read().frames).toHaveLength(1);
    api.reset();
    expect(api.read().frames).toHaveLength(0);
    probe.dispose();
    expect(WINDOW_KEY in win).toBe(false);
  });

  it('a stage that was replaced does not take its successor\'s API away when it is disposed late', () => {
    const win: Record<string, unknown> = {};
    const first = installMotionRecorder(win, { longTasks: false });
    const second = installMotionRecorder(win, { longTasks: false });
    const mine = win[WINDOW_KEY];
    first.dispose(); // StrictMode: the first stage is torn down after the second was built
    expect(win[WINDOW_KEY]).toBe(mine);
    second.dispose();
    expect(WINDOW_KEY in win).toBe(false);
  });

  it('with no window to put it on (node) it still records, and adds nothing anywhere', () => {
    const probe = installMotionRecorder(undefined, { longTasks: false });
    expect(() => probe.frame(frame(1))).not.toThrow();
    expect(() => probe.dispose()).not.toThrow();
    expect(typeof (globalThis as Record<string, unknown>)[WINDOW_KEY]).toBe('undefined');
  });
});

describe('the speed the page shows', () => {
  const doc = (text: string | null) => ({ querySelector: (sel: string) => (sel === '.aww-speeds [aria-pressed="true"]' && text !== null ? { textContent: text } : null) });

  it('reads the pressed speed button: 1x, 2x or 4x', () => {
    expect(pageSpeed(doc('1x'))).toBe(1);
    expect(pageSpeed(doc('2x'))).toBe(2);
    expect(pageSpeed(doc('4x'))).toBe(4);
  });

  it('is null where there are no controls, or the button says something else, or the lookup throws', () => {
    expect(pageSpeed(doc(null))).toBeNull();
    expect(pageSpeed(doc('3x'))).toBeNull();
    expect(pageSpeed(doc('fast'))).toBeNull();
    expect(pageSpeed({})).toBeNull();
    expect(pageSpeed(undefined)).toBeNull();
    expect(pageSpeed({ querySelector: () => { throw new Error('no dom'); } })).toBeNull();
  });
});

describe('a plan summarised for the recording', () => {
  const walk = planWith([{ unitId: 4, startMs: 100, durMs: 280, path: [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 3 }] }], 380);

  it('carries the duration, the dwell for the speed (200 ms / speed after an animation, 60 / speed after none), the tween flag and every beat as plain arrays', () => {
    const s = describePlan(3, 5000, 12, walk, false, 2);
    expect(s).toEqual({
      type: 'start', t: 5000, seq: 3, step: 12, speed: 2, reduced: false, tween: true, planned: true, durationMs: 380, dwellMs: 100,
      moves: [{ unitId: 4, startMs: 100, durMs: 280, path: [[1, 2], [2, 2], [2, 3]] }],
    });
    expect(describePlan(0, 0, 0, planWith([], 0, false), false, 1).dwellMs).toBe(60);
    expect(describePlan(0, 0, 0, planWith([], 0, false), false, 4).dwellMs).toBe(15);
  });

  it('a step with no plan is not planned, has no beats, and an unknown speed has no dwell', () => {
    const none = describePlan(1, 10, 7, null, false, 1);
    expect(none).toMatchObject({ planned: false, durationMs: 0, tween: false, moves: [], dwellMs: 60 });
    expect(describePlan(1, 10, 7, walk, true, null)).toMatchObject({ speed: null, dwellMs: null, reduced: true });
  });
});

describe('the beat a unit is on', () => {
  const plan = planWith([
    { unitId: 1, startMs: 0, durMs: 200, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { unitId: 2, startMs: 200, durMs: 140, path: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
    { unitId: 1, startMs: 340, durMs: 140, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] },
  ], 480);

  it('is the unit\'s first move that has not ended at that time; -1 when all are over or the plan is not running', () => {
    expect(activeBeat(plan, 1, 0)).toBe(0);
    expect(activeBeat(plan, 1, 199)).toBe(0);
    expect(activeBeat(plan, 1, 200)).toBe(2); // the first has ended; the second is waiting at its start
    expect(activeBeat(plan, 1, 479)).toBe(2);
    expect(activeBeat(plan, 1, 480)).toBe(-1);
    expect(activeBeat(plan, 2, 100)).toBe(1); // not started yet: it stands at its first tile, on its beat
    expect(activeBeat(plan, 2, 340)).toBe(-1);
    expect(activeBeat(plan, 9, 100)).toBe(-1); // a unit the plan does not move
    expect(activeBeat(plan, 1, null)).toBe(-1);
  });
});
