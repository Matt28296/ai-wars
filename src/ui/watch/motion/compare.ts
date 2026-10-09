// Comparing two motion reports (P1): which frame metrics got worse, by the budgets in docs/delivery/MOTION.md. Pure (no DOM, no files), so the rule is tested
// in node against reports written by hand, and `pnpm motion --compare` runs this very code.
//
// Three metrics are judged (JUDGED): fps (wall clock, gaps included), the frame interval's p95, and maxStill (the longest the picture did not change).
//   same tier and render scale   each is no more than `tolerance` (10%) worse than the baseline's AND worse by more than its slack
//   the floor rule               the same tier but a SMALLER render scale than the baseline (a build that has the scale below `low`, against one that has
//                                not): fps and p95 may not be worse at all; maxStill still has the 10%
//   anything else                not a like-for-like frame comparison: skipped, and said so
// maxStill is held against the baseline's worst frame interval (`frame.maxStill`, or `frame.max` in a report from before maxStill existed).
//
// Only the metrics both sides have are compared (a baseline from a build with no recorder has no JS time): the rest is listed in `notes`. Every other
// frame metric is in the rows for reading and is never a budget.

/** The part of one run this reads. `metrics` is a flat map, e.g. `frame.fps`, `frame.p95`, `longtask.count`. */
export interface RunLike {
  scenario: string;
  size: string;
  speed: number;
  tier: string;
  scale: number;
  metrics: Readonly<Record<string, number>>;
}

export interface ReportLike {
  runs: readonly RunLike[];
}

/** Which way is good, for the metrics that are budgets. A metric not listed here is reported and never fails. */
export const DIRECTION: Readonly<Record<string, 'higher' | 'lower'>> = {
  'frame.fps': 'higher', 'frame.drawFps': 'higher', 'frame.maxStill': 'lower', 'frame.p50': 'lower', 'frame.p95': 'lower', 'frame.p99': 'lower', 'frame.max': 'lower',
  'frame.dropped': 'lower', 'frame.over50ms': 'lower', 'longtask.count': 'lower', 'longtask.totalMs': 'lower',
  'engine.js.p50': 'lower', 'engine.js.p95': 'lower',
};

/** The metrics that are budgets. */
export const JUDGED: readonly string[] = ['frame.fps', 'frame.p95', 'frame.maxStill'];

/**
 * A metric must be worse by more than the tolerance of the baseline AND by more than this much in its own unit before it counts, so a baseline of zero
 * long tasks, or one frame's jitter on a 4 ms median, cannot fail a run by itself.
 */
export const SLACK: Readonly<Record<string, number>> = {
  'frame.fps': 0.5, 'frame.drawFps': 0.5, 'frame.maxStill': 10, 'frame.p50': 2, 'frame.p95': 3, 'frame.p99': 5, 'frame.max': 10, 'frame.dropped': 0.02, 'frame.over50ms': 0.02,
  'longtask.count': 1, 'longtask.totalMs': 50, 'engine.js.p50': 2, 'engine.js.p95': 3,
};

/** The floor rule allows these no worsening at all (the rest of the judged metrics keep the tolerance). */
export const FLOOR: readonly string[] = ['frame.fps', 'frame.p95'];

export interface CompareRow {
  run: string;
  metric: string;
  was: number;
  now: number;
  /** (now - was) / |was|; Infinity when the baseline is zero and the metric moved. */
  delta: number;
  rule: 'same' | 'floor';
  worse: boolean;
}

export interface Broken {
  run: string;
  budget: string;
  detail: string;
}

export interface Comparison {
  rows: CompareRow[];
  broken: Broken[];
  notes: string[];
}

export const keyOf = (r: Pick<RunLike, 'scenario' | 'size' | 'speed'>): string => `${r.scenario}/${r.size}/${r.speed}x`;

export function compareReports(base: ReportLike, cur: ReportLike, tolerance = 0.1): Comparison {
  const rows: CompareRow[] = [];
  const broken: Broken[] = [];
  const notes: string[] = [];
  for (const r of cur.runs) {
    const b = base.runs.find((x) => keyOf(x) === keyOf(r));
    if (!b) {
      notes.push(`${keyOf(r)}: not in the baseline`);
      continue;
    }
    let rule: 'same' | 'floor' = 'same';
    if (b.tier !== r.tier || b.scale !== r.scale) {
      if (b.tier === r.tier && r.scale < b.scale) rule = 'floor';
      else {
        notes.push(`${keyOf(r)}: ${b.tier}@${b.scale} vs ${r.tier}@${r.scale} is not a like-for-like frame comparison; skipped`);
        continue;
      }
    }
    // a baseline from before maxStill existed has its worst frame interval as `frame.max`: that is what the still is held against
    const baseOf = (k: string): number | undefined => b.metrics[k] ?? (k === 'frame.maxStill' ? b.metrics['frame.max'] : undefined);
    for (const k of Object.keys(r.metrics)) if (baseOf(k) === undefined) notes.push(`${keyOf(r)}: ${k} only on this side; not compared`);
    for (const k of Object.keys(r.metrics)) {
      const was = baseOf(k);
      if (was === undefined) continue;
      const now = r.metrics[k];
      const dir = DIRECTION[k];
      const delta = was === 0 ? (now === 0 ? 0 : Number.POSITIVE_INFINITY) : (now - was) / Math.abs(was);
      let worse = false;
      if (dir && JUDGED.includes(k)) {
        const bad = dir === 'lower' ? now - was : was - now;
        const rel = was === 0 ? Number.POSITIVE_INFINITY : bad / Math.abs(was);
        // the floor rule has no tolerance on fps and p95: no worse at all (past the slack, which is only jitter)
        const tol = rule === 'floor' && FLOOR.includes(k) ? 0 : tolerance;
        if (bad > (SLACK[k] ?? 0) && rel > tol) worse = true;
      }
      rows.push({ run: keyOf(r), metric: k, was, now, delta, rule, worse });
      if (worse) {
        broken.push({
          run: keyOf(r),
          budget: k === 'frame.maxStill'
            ? `the longest still no more than ${Math.round(tolerance * 100)}% over the baseline's worst frame`
            : rule === 'floor' ? 'floor: fps and p95 no worse' : `fps and p95 no more than ${Math.round(tolerance * 100)}% worse`,
          detail: `${k} ${was} -> ${now}`,
        });
      }
    }
  }
  return { rows, broken, notes };
}
