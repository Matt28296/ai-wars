// The motion analysis, in node, against recordings written by hand (testing.ts). Every expected figure is worked out here from the spec: 240 ms a
// tile at 1x and 120 at 2x, smoothstep, a 200 ms dwell, 1.5x the median for "dropped". Each fault is a switch on the builder, and each test shows the
// same recording passing without it and failing with it, so no check is vacuous.
import { describe, expect, it } from 'vitest';
import { LIMITS, analyseCadence, analyseCamera, analyseGlide, analyseMotion, framePacing, percentile, projectOnPath, recordingPacing } from './analysis';
import { synthesize } from './testing';
import type { Synth } from './testing';
import type { StepStart } from './types';

const failedOf = (o: Synth): string[] => analyseMotion(synthesize(o).rec).failed;

describe('percentile: linear between ranks', () => {
  it('matches the values worked out by hand', () => {
    const xs = [1, 2, 3, 4, 5];
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 50)).toBe(3);
    expect(percentile(xs, 100)).toBe(5);
    expect(percentile(xs, 25)).toBe(2);
    expect(percentile(xs, 90)).toBeCloseTo(4.6, 10); // rank 3.6: between 4 and 5
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
    expect(percentile([1, 2], 50)).toBe(1.5);
  });
});

describe('frame pacing', () => {
  it('90 frames at 10 ms and 10 at 100 ms: p50 10, p95 and p99 and max 100, a tenth dropped and a tenth over 50 ms, no hitch (100 is not over 100)', () => {
    const times = [0];
    for (let i = 0; i < 90; i++) times.push(times[times.length - 1] + 10);
    for (let i = 0; i < 10; i++) times.push(times[times.length - 1] + 100);
    const p = framePacing(times, [{ start: 5, dur: 60 }, { start: 400, dur: 90 }], times.map(() => 4));
    expect(p.frames).toBe(101);
    expect(p.seconds).toBe(1.9); // 900 + 1000 ms
    expect(p.fps).toBe(52.63); // 100 intervals in 1.9 s
    expect(p.drawFps).toBe(52.63); // no gap: the two agree
    expect(p.maxStillMs).toBe(100);
    expect(p.interval).toEqual({ p50: 10, p95: 100, p99: 100, max: 100 });
    expect(p.droppedShare).toBe(0.1);
    expect(p.over50Share).toBe(0.1);
    expect(p.hitches).toBe(0);
    expect(p.longTasks).toEqual({ count: 2, totalMs: 150, maxMs: 90 });
    expect(p.js).toEqual({ p50: 4, p95: 4 });
  });

  it('a 120 ms interval among 16.7 ms ones is one hitch, one dropped frame and one slow frame', () => {
    const times = [0];
    for (let i = 0; i < 59; i++) times.push(times[times.length - 1] + 1000 / 60);
    times.push(times[times.length - 1] + 120);
    for (let i = 0; i < 40; i++) times.push(times[times.length - 1] + 1000 / 60);
    const p = framePacing(times);
    expect(p.hitches).toBe(1);
    expect(p.droppedShare).toBe(0.01);
    expect(p.over50Share).toBe(0.01);
    expect(p.interval.max).toBe(120);
    expect(p.interval.p50).toBe(16.667);
    expect(p.js).toBeNull();
  });

  it('a gap the stage chose (the frame after it says it skipped) is counted apart: not a hitch, not in drawFps or the percentiles; the same gap unflagged is a hitch', () => {
    const flagged = analyseMotion(synthesize({ skipWindow: { ms: 400, flagged: true } }).rec);
    expect(flagged.pacing.gaps.count).toBe(1);
    expect(flagged.pacing.gaps.maxMs).toBeGreaterThanOrEqual(400);
    expect(flagged.pacing.gaps.maxMs).toBeLessThanOrEqual(420);
    expect(flagged.pacing.hitches).toBe(0);
    expect(flagged.pacing.interval.max).toBe(16.667); // every interval left is a 60 fps frame
    expect(flagged.pacing.drawFps).toBe(60); // the rate while drawing
    expect(flagged.failed).toEqual([]);
    // known-bad: the identical recording with the flag taken away is a stall, and says so
    const bare = analyseMotion(synthesize({ skipWindow: { ms: 400, flagged: false } }).rec);
    expect(bare.pacing.gaps.count).toBe(0);
    expect(bare.pacing.hitches).toBe(1);
    expect(bare.failed).toContain('hitch');
    expect(bare.pacing.interval.max).toBeGreaterThanOrEqual(400);
  });

  it('the headline fps is the wall clock: a long gap LOWERS it, flagged or not, and maxStillMs is the longest time the picture did not change either way', () => {
    const smooth = analyseMotion(synthesize({}).rec).pacing;
    expect(smooth.fps).toBe(60);
    expect(smooth.maxStillMs).toBe(16.667);
    for (const flagged of [true, false]) {
      const p = analyseMotion(synthesize({ skipWindow: { ms: 400, flagged } }).rec).pacing;
      // the same frames over the same time: the gap is time without a new picture, whoever chose it
      expect(p.fps, `flagged ${flagged}`).toBeLessThan(smooth.fps);
      // 4 steps of 920 ms is 3.68 s of 60 fps frames with one 400 ms gap: fewer frames over the same span
      expect(p.fps, `flagged ${flagged}`).toBeGreaterThan(48);
      expect(p.fps, `flagged ${flagged}`).toBeLessThan(54);
      expect(p.maxStillMs, `flagged ${flagged}`).toBeGreaterThanOrEqual(400);
      expect(p.maxStillMs, `flagged ${flagged}`).toBeLessThanOrEqual(420);
    }
    // what the flag changes is drawFps, the percentiles and the hitch count, and nothing else
    expect(analyseMotion(synthesize({ skipWindow: { ms: 400, flagged: true } }).rec).pacing.drawFps).toBe(60);
    expect(analyseMotion(synthesize({ skipWindow: { ms: 400, flagged: false } }).rec).pacing.drawFps).toBeLessThan(60);
  });

  it('maxStillMs is the longer of the longest gap and the longest frame interval, from the numbers: a 50 ms frame beats a 30 ms gap, a 300 ms gap beats a 100 ms frame', () => {
    expect(framePacing([0, 10, 60, 70, 100, 110], [], [], [false, false, false, false, true, false]).maxStillMs).toBe(50);
    expect(framePacing([0, 10, 110, 120, 420, 430], [], [], [false, false, false, false, true, false]).maxStillMs).toBe(300);
    expect(framePacing([0, 10, 110, 120, 420, 430]).maxStillMs).toBe(300); // unflagged: the same, it is a frame interval
    expect(framePacing([]).maxStillMs).toBe(0);
    expect(framePacing([7]).maxStillMs).toBe(0);
  });

  it('framePacing takes the gaps from a flag per frame: interval i is a gap when frame i came after a skip', () => {
    const times = [0, 10, 20, 320, 330, 340];
    const p = framePacing(times, [], [], [false, false, false, true, false, false]);
    expect(p.gaps).toEqual({ count: 1, totalMs: 300, maxMs: 300 });
    expect(p.interval).toEqual({ p50: 10, p95: 10, p99: 10, max: 10 });
    expect(p.drawFps).toBe(100); // four 10 ms frames while drawing
    expect(p.fps).toBe(14.71); // five intervals over 0.34 s of wall clock: the gap counts
    expect(p.maxStillMs).toBe(300);
    expect(p.seconds).toBe(0.34);
    expect(framePacing(times).gaps).toEqual({ count: 0, totalMs: 0, maxMs: 0 }); // no flags, no gaps
  });

  it('is split by the tier and scale each frame was drawn at', () => {
    const { rec } = synthesize({ steps: 2 });
    const half = Math.floor(rec.frames.length / 2);
    rec.frames.forEach((f, i) => {
      if (i >= half) {
        f.tier = 'low';
        f.scale = 0.7;
      }
    });
    const { all, byConfig } = recordingPacing(rec);
    expect(Object.keys(byConfig).sort()).toEqual(['high@1', 'low@0.7']);
    expect(byConfig['high@1'].frames + byConfig['low@0.7'].frames).toBe(all.frames);
    expect(byConfig['low@0.7'].frames).toBe(rec.frames.length - half);
  });

  it('fewer than two frames give zero fps and no spread, never a throw', () => {
    expect(framePacing([]).fps).toBe(0);
    expect(framePacing([5]).frames).toBe(1);
    expect(framePacing([5]).interval.p50).toBeNaN();
  });
});

describe('the path', () => {
  it('projects a point on a bent path: arc length reached, the length, and the distance off it', () => {
    const path = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }];
    expect(projectOnPath(path, { x: 1, y: 0 })).toEqual({ s: 1, length: 5, off: 0 });
    expect(projectOnPath(path, { x: 2, y: 1 })).toEqual({ s: 3, length: 5, off: 0 });
    const away = projectOnPath(path, { x: 3, y: 1 });
    expect(away.s).toBe(3);
    expect(away.off).toBe(1);
  });
});

describe('a smooth glide at the spec speed passes everything', () => {
  it('3 tiles at 1x, 60 fps: 240 ms a tile, no teleport, ends on its tile, cadence on plan, no check fails', () => {
    const b = synthesize({});
    const r = analyseMotion(b.rec);
    expect(r.failed).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.pacing.fps).toBe(60);
    expect(r.pacing.interval.p50).toBe(16.667);
    expect(r.pacing.hitches).toBe(0);
    expect(r.glide.beats).toHaveLength(4);
    for (const beat of r.glide.beats) {
      expect(beat.measuredMsPerTile).toBeGreaterThan(239);
      expect(beat.measuredMsPerTile).toBeLessThan(241);
      expect(beat.specMsPerTile).toBe(240);
      expect(beat.problems).toEqual([]);
      expect(beat.framesInside).toBeGreaterThan(40); // 720 ms of 60 fps
    }
    // 3 tiles x 240 ms + 200 ms dwell = 920 ms a step, exactly as planned
    expect(r.cadence.perSpeed).toEqual([{ speed: 1, steps: 3, measuredMs: 2760, plannedMs: 2760, ratio: 1, stepsPerSec: 1.087 }]);
    expect(r.verdicts.filter((v) => v.applies).every((v) => v.ok)).toBe(true);
  });

  it('2 tiles at 2x, 60 fps: 120 ms a tile', () => {
    const r = analyseMotion(synthesize({ speed: 2, path: [[1, 1], [2, 1], [2, 2]] }).rec);
    expect(r.failed).toEqual([]);
    for (const beat of r.glide.beats) {
      expect(beat.specMsPerTile).toBe(120);
      expect(beat.measuredMsPerTile).toBeGreaterThan(119);
      expect(beat.measuredMsPerTile).toBeLessThan(121);
    }
    // 2 x 120 + 100 dwell = 340 ms a step
    expect(r.cadence.perSpeed[0]).toMatchObject({ speed: 2, ratio: 1, stepsPerSec: 2.941 });
  });

  it('a steady march reads a steadiness of 1: the peak per-frame speed is the mean speed, the final tile left out', () => {
    const r = analyseMotion(synthesize({ path: [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]] }).rec); // 4 tiles
    for (const beat of r.glide.beats) {
      expect(beat.steadiness).not.toBeNull();
      // the steady speed is 1 / 0.95 of the mean over the whole path; over the three steady tiles it is the mean of its own stretch
      expect(beat.steadiness).toBeGreaterThan(0.999);
      expect(beat.steadiness).toBeLessThan(1.001);
    }
    expect(r.glide.steadiness.beats).toBe(4);
    expect(r.glide.steadiness.max).toBeLessThan(1.001);
    expect(r.failed).toEqual([]);
    expect(r.verdicts.find((v) => v.check === 'glide-steady')).toMatchObject({ applies: true, ok: true });
  });

  it('known-bad: the old smoothstep reads about 1.4 or more and fails glide-steady; it is the only thing that changed from the passing recording', () => {
    const path: [number, number][] = [[0, 2], [1, 2], [2, 2], [3, 2], [4, 2]];
    const r = analyseMotion(synthesize({ path, ease: 'smoothstep' }).rec);
    expect(r.failed).toContain('glide-steady');
    for (const beat of r.glide.beats) {
      expect(beat.steadiness).toBeGreaterThan(1.3);
      expect(beat.steadiness).toBeLessThan(1.6);
    }
    expect(r.verdicts.find((v) => v.check === 'glide-steady')?.reason).toMatch(/peak speed 1\.\d+ times the mean/);
    expect(analyseMotion(synthesize({ path }).rec).failed).toEqual([]);
  });

  it('the steadiness of a glide with no tile before its last, or with fewer than three frames in the steady stretch, is not judged (not passed)', () => {
    const oneTile = analyseMotion(synthesize({ path: [[0, 0], [1, 0]] }).rec);
    expect(oneTile.glide.beats.every((b) => b.steadiness === null)).toBe(true);
    expect(oneTile.verdicts.find((v) => v.check === 'glide-steady')).toMatchObject({ applies: false });
    const slow = analyseMotion(synthesize({ fps: 2 }).rec); // 2 frames in the steady stretch of a 720 ms glide at most
    expect(slow.glide.beats.every((b) => b.steadiness === null)).toBe(true);
  });

  it('at 4x and under reduced motion there is no glide, and that is the pass', () => {
    for (const o of [{ speed: 4 as const }, { speed: 1 as const, reduced: true }]) {
      const r = analyseMotion(synthesize(o).rec);
      expect(r.glide.beats).toEqual([]);
      expect(r.glide.noGlideSteps).toBe(4);
      expect(r.glide.wrongGlides).toEqual([]);
      expect(r.failed, JSON.stringify(o)).toEqual([]);
      const v = r.verdicts.find((x) => x.check === 'no-glide-at-4x');
      expect(v).toMatchObject({ applies: true, ok: true });
    }
  });

  it('a slow machine (4 fps) is reported, and the budgets that need 30 fps say so instead of passing or failing', () => {
    const r = analyseMotion(synthesize({ fps: 4 }).rec);
    expect(r.pacing.fps).toBe(4);
    expect(r.verdicts.find((v) => v.check === 'hitch')).toMatchObject({ applies: false });
    expect(r.verdicts.find((v) => v.check === 'cadence')).toMatchObject({ applies: false });
    expect(r.verdicts.find((v) => v.check === 'cadence')?.reason).toContain('under 30');
    expect(r.ok).toBe(true);
  });
});

describe('each fault fails, with its own name', () => {
  it('a teleport: the unit pops 3 tiles in one frame', () => {
    const r = analyseMotion(synthesize({ teleport: true }).rec);
    expect(r.failed).toContain('no-teleport');
    const v = r.verdicts.find((x) => x.check === 'no-teleport');
    expect(v?.reason).toMatch(/moved 3 tiles in 16\.7 ms \(at most 0\.15\)/);
    // the rest of the recording is fine: only this check and its direct consequence fail
    expect(r.failed).not.toContain('hitch');
    expect(r.failed).not.toContain('camera-jump');
    expect(r.failed).not.toContain('cadence');
  });

  it('a 120 ms hitch: one interval of 120 ms in a 60 fps recording', () => {
    const r = analyseMotion(synthesize({ hitchMs: 120 }).rec);
    expect(r.failed).toEqual(['hitch']);
    expect(r.pacing.hitches).toBe(1);
    // frames sit on a 16.7 ms grid, so the first one after a 120 ms gap lands at 133.3 ms (eight intervals)
    expect(r.pacing.interval.max).toBeGreaterThanOrEqual(120);
    expect(r.pacing.interval.max).toBeLessThanOrEqual(135);
    expect(r.verdicts.find((x) => x.check === 'hitch')?.reason).toMatch(/1 frame\(s\) over 3x the median and 100 ms/);
  });

  it('a glide at twice the spec speed: 120 ms a tile where 240 is the spec', () => {
    const r = analyseMotion(synthesize({ glideSpeedup: 2 }).rec);
    expect(r.failed).toContain('glide-speed');
    const first = r.glide.beats[0];
    expect(first.measuredMsPerTile).toBeGreaterThan(115);
    expect(first.measuredMsPerTile).toBeLessThan(125);
    expect(r.verdicts.find((x) => x.check === 'glide-speed')?.reason).toMatch(/too fast/);
  });

  it('a glide at half the spec speed is too slow', () => {
    const r = analyseMotion(synthesize({ glideSpeedup: 0.5 }).rec);
    // half the progress by the planned end: the unit has not arrived when the plan says it has
    expect(r.failed.some((c) => c === 'glide-speed' || c === 'glide-end')).toBe(true);
  });

  it('a glide that ends off its tile: 0.4 tile short of the destination', () => {
    const r = analyseMotion(synthesize({ stopShort: 0.4 }).rec);
    expect(r.failed).toContain('glide-end');
    expect(r.verdicts.find((x) => x.check === 'glide-end')?.reason).toMatch(/ended 0\.4 tiles off its destination tile/);
  });

  it('a stall at a step boundary: the next step starts 400 ms late', () => {
    const b = synthesize({ stallMs: 400 });
    const r = analyseMotion(b.rec);
    expect(r.failed).toContain('step-stall');
    expect(r.cadence.steps[0].overshootMs).toBeCloseTo(400, 0);
    expect(r.cadence.steps[1].ratio).toBe(1);
    expect(r.verdicts.find((x) => x.check === 'step-stall')?.reason).toMatch(/step 10 at 1x ran 400 ms past its plan/);
  });

  it('a step cadence that runs a quarter slow: the ratio per speed is 1.25 and the cadence check fails', () => {
    const r = analyseMotion(synthesize({ stretch: 1.25 }).rec);
    expect(r.cadence.perSpeed[0].ratio).toBe(1.25);
    expect(r.failed).toContain('cadence');
    // and 8% slow is inside the 10% budget
    expect(analyseMotion(synthesize({ stretch: 1.08 }).rec).failed).not.toContain('cadence');
  });

  it('a camera jump: 6 world units in one frame; and the same jump declared a cut is allowed', () => {
    const r = analyseMotion(synthesize({ cameraJump: 6 }).rec);
    expect(r.failed).toEqual(['camera-jump']);
    expect(r.camera.jumps).toHaveLength(1);
    expect(r.camera.jumps[0].distance).toBe(6);
    expect(r.camera.jumps[0].allowed).toBe(1.353); // 80 per second x 16.67 ms + 0.02
    expect(analyseMotion(synthesize({ cameraJump: 6, cameraJumpIsCut: true }).rec).failed).toEqual([]);
  });

  it('a glide planned at 4x, or under reduced motion, fails: timing.ts has none', () => {
    for (const o of [{ speed: 4 as const, glideAtSpeed4: true }, { speed: 1 as const, reduced: true, glideAtSpeed4: true }]) {
      const r = analyseMotion(synthesize(o).rec);
      expect(r.failed, JSON.stringify(o)).toContain('no-glide-at-4x');
      expect(r.glide.wrongGlides[0]).toMatch(/glide\(s\) planned at/);
    }
  });

  it('a glide whose progress runs backwards, and one that leaves its path', () => {
    const back = synthesize({});
    // mid-glide of the first step, the unit steps back half a tile for a frame
    const mid = back.rec.frames.filter((f) => f.seq === 0 && f.units[0]?.[4] === 0);
    const f = mid[Math.floor(mid.length / 2)];
    f.units = [[7, f.units[0][1] - 0.5, 0, f.units[0][3], 0]];
    const r = analyseMotion(back.rec);
    expect(r.failed).toContain('glide-path');
    expect(r.verdicts.find((x) => x.check === 'glide-path')?.reason).toContain('went backwards');

    const off = synthesize({});
    const g = off.rec.frames.filter((x) => x.seq === 0 && x.units[0]?.[4] === 0)[5];
    g.units = [[7, g.units[0][1], 0, g.units[0][3] + 0.3, 0]];
    expect(analyseMotion(off.rec).verdicts.find((x) => x.check === 'glide-path')?.reason).toContain('left the path by 0.3 tiles');
  });

  it('a shake that grows instead of dying away fails; the real envelope (1 - u) squared passes', () => {
    const decaying = analyseMotion(synthesize({ shake: (u) => (1 - u) * (1 - u) * (0.6 + 0.4 * Math.sin(u * 40)) }).rec);
    expect(decaying.camera.shakeEpisodes).toBe(1);
    expect(decaying.failed).toEqual([]);
    const growing = analyseMotion(synthesize({ shake: (u) => 0.1 + 0.9 * u }).rec);
    expect(growing.failed).toEqual(['shake-decay']);
    expect(growing.camera.shakeNotDecaying[0].secondHalf).toBeGreaterThan(growing.camera.shakeNotDecaying[0].firstHalf);
  });
});

describe('only the faults named fail: the same recording without each switch is clean', () => {
  it('every fault above, taken away, leaves no failure', () => {
    for (const o of [{}, { teleport: false }, { glideSpeedup: 1 }, { stopShort: 0 }, { stallMs: 0 }, { hitchMs: undefined }]) {
      expect(failedOf(o), JSON.stringify(o)).toEqual([]);
    }
  });
});

describe('cadence: holds, speed changes and jumps are left out', () => {
  const base = synthesize({ steps: 5 });

  it('a step pair that overlaps a story hold is excluded, the others count', () => {
    const [s0, s1] = base.startsAt;
    const held = analyseCadence(base.rec.events, { holds: [{ from: s0 + 100, to: s1 + 50 }] });
    // the hold spans the start of step 11 (s1), so the pairs 10->11 and 11->12 overlap it; 12->13 and 13->14 do not
    expect(held.excluded.held).toBe(2);
    expect(held.steps.length).toBe(2);
  });

  it('a pair across a speed change is excluded', () => {
    const events = base.rec.events.map((e) => (e.type === 'start' && e.seq >= 2 ? { ...e, speed: 2 } : e));
    const c = analyseCadence(events);
    expect(c.excluded.speedChange).toBe(1);
  });

  it('a pair that is not a step forward (a scrub back) or not played (no plan) is excluded', () => {
    const events = base.rec.events.map((e) => (e.type === 'start' && e.seq === 2 ? { ...e, step: 3 } : e));
    expect(analyseCadence(events).excluded.notPlayed).toBe(2);
    const unplanned = base.rec.events.map((e) => (e.type === 'start' && e.seq === 0 ? { ...e, planned: false } : e));
    expect(analyseCadence(unplanned).excluded.notPlayed).toBe(1);
  });

  it('a step whose speed nobody said is left out, not guessed', () => {
    const events = base.rec.events.map((e): typeof e => (e.type === 'start' ? ({ ...e, speed: null, moves: [] } as StepStart) : e));
    const c = analyseCadence(events);
    expect(c.excluded.unknownSpeed).toBe(4);
    expect(c.steps).toEqual([]);
  });

  it('steps per second is steps over their measured time, per speed', () => {
    const c = analyseCadence(synthesize({ speed: 2, steps: 5, path: [[0, 0], [1, 0]] }).rec.events);
    // 120 ms + 100 ms dwell = 220 ms a step
    expect(c.perSpeed).toEqual([{ speed: 2, steps: 4, measuredMs: 880, plannedMs: 880, ratio: 1, stepsPerSec: 4.545 }]);
  });
});

describe('the glide measurement says what it cannot measure', () => {
  it('a glide shorter than two frames is counted as unmeasured and is neither a pass nor a fail on speed', () => {
    const r = analyseMotion(synthesize({ fps: 4, path: [[0, 0], [1, 0]], steps: 3 }).rec);
    expect(r.glide.unmeasured).toBeGreaterThan(0);
    expect(r.glide.beats.every((b) => b.measuredMs === null)).toBe(true);
    expect(r.verdicts.find((v) => v.check === 'glide-speed')).toMatchObject({ applies: false });
  });

  it('the camera of a calm recording moves a fraction of a unit a frame', () => {
    const c = analyseCamera(synthesize({}).rec);
    expect(c.maxStep).toBe(0);
    expect(c.jumps).toEqual([]);
    expect(LIMITS.cameraMaxSpeed).toBe(80);
  });

  it('a recording with nothing in it gives a report that applies nothing and fails nothing', () => {
    const r = analyseMotion({ schema: 1, frames: [], events: [], longTasks: [], truncated: false });
    expect(r.ok).toBe(true);
    expect(r.verdicts.every((v) => !v.applies)).toBe(true);
    expect(analyseGlide({ schema: 1, frames: [], events: [], longTasks: [], truncated: false }).beats).toEqual([]);
  });
});
