// The comparison budgets, in node, against reports written by hand. The expected verdicts are worked out here from the rule in MOTION.md (fps, p95 and the longest
// still: 10% worse AND past the slack, in the metric's own direction; the floor rule for a smaller render scale), and each case is shown in both directions: the
// regression is caught, and the same numbers moving the good way, or inside the slack, are not.
import { describe, expect, it } from 'vitest';
import { DIRECTION, FLOOR, JUDGED, SLACK, compareReports, keyOf } from './compare';
import type { ReportLike, RunLike } from './compare';

const run = (over: Partial<RunLike> & { metrics?: Record<string, number> } = {}): RunLike => ({
  scenario: 'demo', size: 'desktop', speed: 1, tier: 'low', scale: 1,
  ...over,
  metrics: {
    'frame.fps': 10, 'frame.drawFps': 10, 'frame.maxStill': 160, 'frame.p50': 100, 'frame.p95': 130, 'frame.p99': 150, 'frame.max': 160, 'frame.dropped': 0.05,
    'frame.over50ms': 1, 'longtask.count': 20, 'longtask.totalMs': 2000, ...over.metrics,
  },
});
const report = (...runs: RunLike[]): ReportLike => ({ runs });

describe('the budgets are fps, the interval p95 and the longest still', () => {
  it('those three, and no others', () => {
    expect([...JUDGED]).toEqual(['frame.fps', 'frame.p95', 'frame.maxStill']);
  });

  it('identical numbers break nothing', () => {
    const c = compareReports(report(run()), report(run()));
    expect(c.broken).toEqual([]);
    expect(c.rows.every((r) => !r.worse && r.delta === 0)).toBe(true);
    expect(c.rows.length).toBe(11);
  });

  it('every other metric moving the wrong way is read, never a budget: p50 +50%, long tasks x10, JS time, drawFps -40%', () => {
    const c = compareReports(
      report(run({ metrics: { 'engine.js.p50': 2 } })),
      report(run({ metrics: { 'frame.p50': 150, 'longtask.count': 200, 'longtask.totalMs': 20000, 'frame.drawFps': 6, 'frame.dropped': 0.5, 'engine.js.p50': 20 } })),
    );
    expect(c.broken).toEqual([]);
    expect(c.rows.find((r) => r.metric === 'frame.p50')).toMatchObject({ was: 100, now: 150, worse: false });
    expect(c.rows.find((r) => r.metric === 'frame.drawFps')).toMatchObject({ was: 10, now: 6, worse: false });
  });
});

describe('same tier and scale: fps and p95 no more than 10% worse', () => {
  it('fps 11% lower is broken, 5% lower is not (higher is better)', () => {
    const bad = compareReports(report(run()), report(run({ metrics: { 'frame.fps': 8.9 } })));
    expect(bad.broken).toEqual([{ run: 'demo/desktop/1x', budget: 'fps and p95 no more than 10% worse', detail: 'frame.fps 10 -> 8.9' }]);
    const fine = compareReports(report(run()), report(run({ metrics: { 'frame.fps': 9.5 } })));
    expect(fine.broken).toEqual([]);
  });

  it('p95 11% higher is broken, 5% higher is not, and 30% LOWER is an improvement, not a break (lower is better)', () => {
    expect(compareReports(report(run()), report(run({ metrics: { 'frame.p95': 145 } }))).broken.map((b) => b.detail)).toEqual(['frame.p95 130 -> 145']);
    expect(compareReports(report(run()), report(run({ metrics: { 'frame.p95': 136 } }))).broken).toEqual([]);
    const better = compareReports(report(run()), report(run({ metrics: { 'frame.p95': 91, 'frame.fps': 14 } })));
    expect(better.broken).toEqual([]);
    expect(better.rows.find((r) => r.metric === 'frame.p95')?.delta).toBeCloseTo(-0.3, 10);
  });

  it('a change inside the slack is jitter, however large it is in percent: 3 ms on a 20 ms p95, half an fps on 3', () => {
    const base = report(run({ metrics: { 'frame.p95': 20, 'frame.fps': 3 } }));
    expect(compareReports(base, report(run({ metrics: { 'frame.p95': 23, 'frame.fps': 2.5 } }))).broken).toEqual([]); // +15% and -17%, but 3 ms and 0.5 fps are the slack
    expect(compareReports(base, report(run({ metrics: { 'frame.p95': 23.5, 'frame.fps': 3 } }))).broken.map((b) => b.detail)).toEqual(['frame.p95 20 -> 23.5']);
    expect(compareReports(base, report(run({ metrics: { 'frame.p95': 20, 'frame.fps': 2.4 } }))).broken.map((b) => b.detail)).toEqual(['frame.fps 3 -> 2.4']);
  });

  it('a metric that is not a budget (steps a second, cadence) is reported and never fails', () => {
    const c = compareReports(report(run({ metrics: { 'page.steps.perSec': 2 } })), report(run({ metrics: { 'page.steps.perSec': 0.5 } })));
    expect(c.broken).toEqual([]);
    expect(c.rows.find((r) => r.metric === 'page.steps.perSec')).toMatchObject({ was: 2, now: 0.5, worse: false });
    expect(DIRECTION['page.steps.perSec']).toBeUndefined();
  });

  it('the tolerance is a parameter: at 20% an 11% loss passes, at 5% it fails', () => {
    const cur = report(run({ metrics: { 'frame.fps': 8.9 } }));
    expect(compareReports(report(run()), cur, 0.2).broken).toEqual([]);
    expect(compareReports(report(run()), cur, 0.05).broken).toHaveLength(1);
  });
});

describe('the longest still: no more than 10% over the baseline\'s worst frame interval', () => {
  const MSG = "the longest still no more than 10% over the baseline's worst frame";

  it('a recording with a long gap lowers fps and fails on maxStill: 160 -> 400 ms is broken, with fps down to 7', () => {
    const c = compareReports(report(run()), report(run({ metrics: { 'frame.fps': 7, 'frame.drawFps': 10, 'frame.maxStill': 400, 'frame.max': 100 } })));
    expect(c.broken.map((b) => b.detail)).toEqual(['frame.fps 10 -> 7', 'frame.maxStill 160 -> 400']);
    expect(c.broken[1]).toMatchObject({ run: 'demo/desktop/1x', budget: MSG });
  });

  it('the same long gap with fps and p95 untouched still fails on maxStill alone (the other two cannot hide it)', () => {
    const c = compareReports(report(run()), report(run({ metrics: { 'frame.maxStill': 400 } })));
    expect(c.broken).toEqual([{ run: 'demo/desktop/1x', budget: MSG, detail: 'frame.maxStill 160 -> 400' }]);
  });

  it('a shorter still, or one inside 10%, passes: 120 ms, 160 ms, 175 ms (9.4% over); 177 ms (10.6% over) is broken', () => {
    for (const ms of [120, 160, 175]) expect(compareReports(report(run()), report(run({ metrics: { 'frame.maxStill': ms } }))).broken, `${ms}`).toEqual([]);
    expect(compareReports(report(run()), report(run({ metrics: { 'frame.maxStill': 177 } }))).broken.map((b) => b.detail)).toEqual(['frame.maxStill 160 -> 177']);
  });

  it('a few ms of jitter on a short still is the slack, not a break: 40 -> 49 passes, 40 -> 51 does not', () => {
    const base = report(run({ metrics: { 'frame.maxStill': 40 } }));
    expect(compareReports(base, report(run({ metrics: { 'frame.maxStill': 49 } }))).broken).toEqual([]);
    expect(compareReports(base, report(run({ metrics: { 'frame.maxStill': 51 } }))).broken.map((b) => b.detail)).toEqual(['frame.maxStill 40 -> 51']);
  });

  it('is held against the baseline\'s WORST FRAME INTERVAL: a baseline with no maxStill (from before it existed, or main with no gaps) is read as its frame.max', () => {
    const old = run();
    delete (old.metrics as Record<string, number>)['frame.maxStill'];
    expect(compareReports(report(old), report(run({ metrics: { 'frame.maxStill': 170 } }))).broken).toEqual([]); // 160 is its worst frame; 170 is 6% over
    const c = compareReports(report(old), report(run({ metrics: { 'frame.maxStill': 300 } })));
    expect(c.broken.map((b) => b.detail)).toEqual(['frame.maxStill 160 -> 300']);
    expect(c.notes.join(' ')).not.toContain('maxStill only on this side');
  });

  it('a baseline with neither is not compared, and says so', () => {
    const none = run();
    delete (none.metrics as Record<string, number>)['frame.maxStill'];
    delete (none.metrics as Record<string, number>)['frame.max'];
    const c = compareReports(report(none), report(run({ metrics: { 'frame.maxStill': 900 } })));
    expect(c.broken).toEqual([]);
    expect(c.notes).toContain('demo/desktop/1x: frame.maxStill only on this side; not compared');
  });
});

describe('the floor rule: the same tier at a smaller render scale', () => {
  const base = report(run({ tier: 'low', scale: 1 }));

  it('fps and p95 may not be worse, and maxStill keeps its 10%: better fps and p95 pass even when p50 and the long tasks are worse', () => {
    const cur = report(run({ tier: 'low', scale: 0.5, metrics: { 'frame.fps': 12, 'frame.p95': 120, 'frame.p50': 140, 'longtask.count': 50, 'frame.maxStill': 170 } }));
    const c = compareReports(base, cur);
    expect(c.broken).toEqual([]);
    expect(c.rows.every((r) => r.rule === 'floor')).toBe(true);
    expect(c.rows.find((r) => r.metric === 'frame.p50')?.worse).toBe(false);
  });

  it('is broken by a worse fps or a worse p95, even by a few percent (there is no tolerance, only the jitter slack)', () => {
    const slowFps = compareReports(base, report(run({ tier: 'low', scale: 0.7, metrics: { 'frame.fps': 9.2 } })));
    expect(slowFps.broken).toEqual([{ run: 'demo/desktop/1x', budget: 'floor: fps and p95 no worse', detail: 'frame.fps 10 -> 9.2' }]);
    const slowP95 = compareReports(base, report(run({ tier: 'low', scale: 0.7, metrics: { 'frame.p95': 140 } })));
    expect(slowP95.broken.map((b) => b.detail)).toEqual(['frame.p95 130 -> 140']);
    // inside the slack (0.3 fps, 2 ms) it is jitter
    expect(compareReports(base, report(run({ tier: 'low', scale: 0.7, metrics: { 'frame.fps': 9.7, 'frame.p95': 132 } }))).broken).toEqual([]);
  });

  it('the longest still is judged with its 10% here too: 190 ms against a worst frame of 160 is broken, 170 is not', () => {
    const long = compareReports(base, report(run({ tier: 'low', scale: 0.5, metrics: { 'frame.maxStill': 190 } })));
    expect(long.broken).toEqual([{ run: 'demo/desktop/1x', budget: "the longest still no more than 10% over the baseline's worst frame", detail: 'frame.maxStill 160 -> 190' }]);
    expect(compareReports(base, report(run({ tier: 'low', scale: 0.5, metrics: { 'frame.maxStill': 170 } }))).broken).toEqual([]);
  });

  it('allows no worsening of exactly these two', () => {
    expect([...FLOOR]).toEqual(['frame.fps', 'frame.p95']);
  });

  it('does not apply to a build at a LARGER scale, another tier, or a baseline with a scale below the current one: those are skipped, and said so', () => {
    for (const other of [run({ tier: 'low', scale: 1 }), run({ tier: 'medium', scale: 0.5 }), run({ tier: 'low', scale: 0.85 })]) {
      const c = compareReports(report(run({ tier: 'low', scale: 0.7 })), report(other));
      expect(c.rows, `${other.tier}@${other.scale}`).toEqual([]);
      expect(c.notes.join(' ')).toContain('not a like-for-like frame comparison');
    }
  });
});

describe('what is compared', () => {
  it('only runs and metrics both sides have: the rest is a note, never a failure', () => {
    const base = report(run({ metrics: { 'engine.js.p50': 2 } }));
    const cur = report(run({ metrics: { 'engine.js.p95': 4 } }), run({ scenario: 'live' }));
    const c = compareReports(base, cur);
    expect(c.broken).toEqual([]);
    expect(c.notes).toContain('demo/desktop/1x: engine.js.p95 only on this side; not compared');
    expect(c.notes).toContain('live/desktop/1x: not in the baseline');
    expect(c.rows.map((r) => r.metric)).not.toContain('engine.js.p50');
  });

  it('runs are matched by scenario, size and speed', () => {
    const slow = run({ speed: 4, metrics: { 'frame.fps': 5 } });
    const c = compareReports(report(run(), slow), report(run(), run({ speed: 4, metrics: { 'frame.fps': 4 } })));
    expect(c.broken.map((b) => b.run)).toEqual(['demo/desktop/4x']);
    expect(keyOf(slow)).toBe('demo/desktop/4x');
  });

  it('slack is written for every metric that has a direction, so none is judged on percent alone', () => {
    for (const k of Object.keys(DIRECTION)) expect(SLACK[k], k).toBeGreaterThan(0);
  });

  it('empty reports compare to nothing', () => {
    expect(compareReports(report(), report())).toEqual({ rows: [], broken: [], notes: [] });
  });
});
