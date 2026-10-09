// The motion analysis (P1): a recording in, a report out. Pure (no DOM, no clock, no three.js), so it is tested in node against recordings written by
// hand, and the driver (scripts/motion.mjs) runs the very same code on what a page recorded.
//
// What it measures, and what it holds the numbers to:
//   frame pacing   fps (wall clock: the frame intervals over the time the frames span, gaps included); the frame interval's p50, p95, p99 and max;
//                  the share of frames over 1.5x the median ("dropped") and over 50 ms; long tasks; the JS time of the stage's own frame(). A stretch
//                  where the stage deliberately did not draw (it gives the thread back to playback at a step boundary on a slow machine; the frame after
//                  it has `skips` > 0) is a GAP, not a frame interval: counted apart and left out of the percentiles and of `drawFps` (the rate while
//                  drawing), but NOT out of `fps`, and `maxStillMs` is the longest the picture did not change: the longer of the longest gap and the
//                  longest frame interval
//   unit glide     per move beat, ms per tile against TIMINGS.moveTileMs at that speed (within 15% or one frame, whichever is larger); steadiness (the peak
//                  per-frame speed over the mean speed, the final tile left out: about 1 for a steady march, about 1.5 for the old smoothstep); no teleport
//                  (a frame's step is at most dt / msPerTile x 1.5 tiles, plus a small epsilon); progress along the path never goes back; the glide
//                  ends exactly on the destination tile; at 4x and under reduced motion there are no glides at all (timing.ts)
//   camera         per-frame displacement, with no jump outside a cut the stage declared; a shake decays
//   cadence        each step's measured length against its plan (durationMs + the dwell), as a ratio per speed, and steps per second per speed,
//                  with story holds excluded
import { TILE } from '../../board3d/contract';
import { GLIDE_CRUISE, GLIDE_SETTLE, dwellMs, moveTileMs, tweenEnabled } from '../timing';
import type { Speed } from '../timing';
import { MOTION_SCHEMA } from './types';
import type { FrameSample, LongTask, PlaybackEvent, Recording, StepStart } from './types';

// ---------------------------------------------------------------- the limits (one place, so MOTION.md and the tests quote the same numbers)

export const LIMITS = {
  /** A glide's measured ms per tile may differ from the spec by this fraction, or by one frame, whichever is larger. */
  glideTolerance: 0.15,
  /**
   * A frame may move a unit this many times dt / msPerTile. A steady march peaks at about 1.05 (glideEase's cruise) and the old smoothstep at 1.5; this is the
   * loose "no teleport" line, and the tight one is `steadyMax` below.
   */
  teleportFactor: 1.5,
  /** Plus this many tiles of slack (a position is a float). */
  teleportEpsilonTiles: 0.05,
  /** The glide ends within this many tiles of its destination tile's centre. */
  endToleranceTiles: 0.02,
  /** A glide may not leave its path by more than this many tiles. */
  offPathTiles: 0.05,
  /** A glide's progress may fall back by this fraction of its length at most (a float). */
  backwardsFraction: 0.002,
  /** A frame interval over this many times the median is "dropped". */
  droppedFactor: 1.5,
  /**
   * A glide is steady when its peak per-frame speed is at most this many times its mean speed (the final tile left out). A steady march reads 1.00 at any frame
   * rate (its position is a straight line against the clock); the old smoothstep reads 1.5 at 60 fps and, measured on this box's 10 to 15 fps frames, 1.17 to 1.44.
   */
  steadyMax: 1.1,
  /** A frame interval over this is "slow", in ms. */
  slowFrameMs: 50,
  /** A hitch: an interval over both this many times the median and `hitchMs`. */
  hitchFactor: 3,
  hitchMs: 100,
  /** The absolute checks that depend on being smooth apply only at this frame rate or better. */
  smoothFps: 30,
  /** A step's measured length may differ from its plan by this fraction (per speed, in total). */
  cadenceTolerance: 0.1,
  /** A step may overshoot its plan by this many ms, or three frames, whichever is larger, before it is a stall. */
  stallMs: 100,
  stallFrames: 3,
  /** The camera's largest honest speed, world units a second. The ease (5 per second over at most a board's width) stays far below it. */
  cameraMaxSpeed: 80,
  /** The runtime clamps its own dt to this, so the camera cannot move farther than speed x this in one frame. */
  cameraDtCapSec: 0.1,
  cameraEpsilon: 0.02,
  /** A shake episode needs this many frames to judge whether it decays. */
  shakeMinFrames: 4,
} as const;

// ---------------------------------------------------------------- small maths

/** The p-th percentile (0..100) of an ascending list, linear between ranks. NaN for an empty list. */
export function percentile(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0];
  const rank = (Math.max(0, Math.min(100, p)) / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

const asc = (xs: readonly number[]): number[] => xs.slice().sort((a, b) => a - b);
const round = (n: number, digits = 3): number => (Number.isFinite(n) ? Math.round(n * 10 ** digits) / 10 ** digits : n);

// ---------------------------------------------------------------- frame pacing

export interface Spread {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface PacingReport {
  frames: number;
  /** The wall time the frames span, seconds. */
  seconds: number;
  /** Frames a second on the wall clock: the frame intervals (frames - 1) over the time the frames span, deliberate gaps included. */
  fps: number;
  /** Frames a second while the stage was drawing: the real intervals only, so a deliberate gap does not lower it. */
  drawFps: number;
  /** The longest time the picture did not change, ms: the longer of the longest gap and the longest frame interval. */
  maxStillMs: number;
  /** Frame intervals, ms, gaps left out. */
  interval: Spread;
  /** Stretches where the stage chose not to draw (the frame after each has `skips` > 0): how many, how long in all and the longest, ms. */
  gaps: { count: number; totalMs: number; maxMs: number };
  /** The share of intervals over 1.5x the median. */
  droppedShare: number;
  /** The share of intervals over 50 ms. */
  over50Share: number;
  /** Intervals over both 3x the median and 100 ms: a visible stall. */
  hitches: number;
  longTasks: { count: number; totalMs: number; maxMs: number };
  /** The JS time of the stage's frame(): null when the frames carry none (a page-level sample). */
  js: { p50: number; p95: number } | null;
}

const EMPTY_SPREAD: Spread = { p50: Number.NaN, p95: Number.NaN, p99: Number.NaN, max: Number.NaN };

function spreadOf(xs: readonly number[]): Spread {
  if (xs.length === 0) return EMPTY_SPREAD;
  const s = asc(xs);
  return { p50: percentile(s, 50), p95: percentile(s, 95), p99: percentile(s, 99), max: s[s.length - 1] };
}

/**
 * Pacing from frame timestamps (ms, ascending) and, where the stage measured them, the JS time of each frame. `afterSkip[i]` says frame i came after
 * frames the stage chose not to draw, so the interval before it is a gap and not a frame time.
 */
export function framePacing(times: readonly number[], longTasks: readonly LongTask[] = [], jsMs: readonly number[] = [], afterSkip: readonly boolean[] = []): PacingReport {
  const intervals: number[] = [];
  const gapMs: number[] = [];
  for (let i = 1; i < times.length; i++) (afterSkip[i] ? gapMs : intervals).push(times[i] - times[i - 1]);
  const seconds = times.length > 1 ? (times[times.length - 1] - times[0]) / 1000 : 0;
  const drawSeconds = intervals.reduce((a, b) => a + b, 0) / 1000;
  const still = Math.max(0, ...intervals, ...gapMs);
  const spread = spreadOf(intervals);
  const median = spread.p50;
  let dropped = 0;
  let slow = 0;
  let hitches = 0;
  for (const iv of intervals) {
    if (iv > median * LIMITS.droppedFactor) dropped++;
    if (iv > LIMITS.slowFrameMs) slow++;
    if (iv > median * LIMITS.hitchFactor && iv > LIMITS.hitchMs) hitches++;
  }
  const n = Math.max(1, intervals.length);
  const js = jsMs.length > 0 ? asc(jsMs) : null;
  return {
    frames: times.length,
    seconds: round(seconds),
    fps: seconds > 0 ? round((times.length - 1) / seconds, 2) : 0,
    drawFps: drawSeconds > 0 ? round(intervals.length / drawSeconds, 2) : 0,
    maxStillMs: round(still),
    interval: { p50: round(spread.p50), p95: round(spread.p95), p99: round(spread.p99), max: round(spread.max) },
    gaps: { count: gapMs.length, totalMs: round(gapMs.reduce((a, b) => a + b, 0), 1), maxMs: round(gapMs.reduce((a, b) => Math.max(a, b), 0), 1) },
    droppedShare: round(dropped / n, 4),
    over50Share: round(slow / n, 4),
    hitches,
    longTasks: {
      count: longTasks.length,
      totalMs: round(longTasks.reduce((a, t) => a + t.dur, 0), 1),
      maxMs: round(longTasks.reduce((a, t) => Math.max(a, t.dur), 0), 1),
    },
    js: js ? { p50: round(percentile(js, 50)), p95: round(percentile(js, 95)) } : null,
  };
}

/** Pacing for a whole recording, and the same split by the quality tier and render scale each frame was drawn at. */
export function recordingPacing(rec: Recording): { all: PacingReport; byConfig: Record<string, PacingReport> } {
  const times = rec.frames.map((f) => f.t);
  const all = framePacing(times, rec.longTasks, rec.frames.map((f) => f.js), rec.frames.map((f) => f.skips > 0));
  const groups = new Map<string, FrameSample[]>();
  for (const f of rec.frames) {
    const key = `${f.tier}@${f.scale}`;
    const list = groups.get(key);
    if (list) list.push(f);
    else groups.set(key, [f]);
  }
  const byConfig: Record<string, PacingReport> = {};
  for (const [key, list] of groups) {
    const lo = list[0].t;
    const hi = list[list.length - 1].t;
    byConfig[key] = framePacing(list.map((f) => f.t), rec.longTasks.filter((t) => t.start >= lo && t.start <= hi), list.map((f) => f.js), list.map((f) => f.skips > 0));
  }
  return { all, byConfig };
}

// ---------------------------------------------------------------- unit glide

/** What a glide check found wrong, by kind: the verdicts are made from the kinds, never from the wording. */
export type GlideKind = 'speed' | 'steady' | 'teleport' | 'path' | 'end';

export interface GlideProblem {
  kind: GlideKind;
  text: string;
}

export interface GlideBeat {
  step: number;
  seq: number;
  unitId: number;
  /** The playback speed it was planned at; null when neither the page nor the beat's length said. */
  speed: number | null;
  tiles: number;
  /** The spec: TIMINGS.moveTileMs at this speed, ms per tile. */
  specMsPerTile: number | null;
  /** The glide's length as the frames show it (a fit of the eased progress against time), or null when too few frames fall inside it. */
  measuredMs: number | null;
  measuredMsPerTile: number | null;
  /** How far off the spec the measurement may be and still pass, ms. */
  toleranceMs: number | null;
  /** Frames inside the glide, and the largest step any frame took, in tiles. */
  framesInside: number;
  maxStepTiles: number;
  /**
   * The peak per-frame speed over the mean speed, from the first moving frame to the last one before the final tile (that tile is where the unit settles).
   * 1 is a steady march. Null when the path has no tile before the last, or fewer than three frames fall in that stretch.
   */
  steadiness: number | null;
  problems: GlideProblem[];
  ok: boolean;
}

export interface GlideReport {
  beats: GlideBeat[];
  /** Plans (steps) that should have no glide at all (4x, reduced motion) and the ones that wrongly had one. */
  noGlideSteps: number;
  wrongGlides: string[];
  /** Beats too short for the frame rate to say anything about (fewer than two frames inside): counted, not failed. */
  unmeasured: number;
  /** The steadiness of the beats that have one: how many, their mean and their largest. */
  steadiness: { beats: number; mean: number | null; max: number | null };
}

interface Pt {
  x: number;
  y: number;
}

/** Where a point is along a polyline: the arc length reached, the polyline's length, and how far the point is from it. */
export function projectOnPath(path: readonly Pt[], p: Pt): { s: number; length: number; off: number } {
  let length = 0;
  let bestS = 0;
  let bestOff = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
      const off = Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
      if (off < bestOff) {
        bestOff = off;
        bestS = length + k * len;
      }
    }
    length += len;
  }
  return { s: bestS, length, off: Number.isFinite(bestOff) ? bestOff : 0 };
}

/** The speed a step ran at: what the page said, else read off its first glide (TIMINGS.moveTileMs a tile is 1x, half of it is 2x). */
export function stepSpeed(s: StepStart): number | null {
  if (s.speed !== null) return s.speed;
  for (const m of s.moves) {
    const tiles = polylineLength(m.path);
    if (tiles <= 0) continue;
    const per = m.durMs / tiles;
    for (const sp of [1, 2] as const) if (Math.abs(per - moveTileMs(sp)) <= 1) return sp;
  }
  return null;
}

const polylineLength = (path: readonly (readonly [number, number])[]): number => {
  let n = 0;
  for (let i = 0; i + 1 < path.length; i++) n += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  return n;
};

/** The median gap between frames, ms; 0 for fewer than two. */
function medianInterval(frames: readonly { t: number }[]): number {
  const ivs: number[] = [];
  for (let i = 1; i < frames.length; i++) ivs.push(frames[i].t - frames[i - 1].t);
  return ivs.length ? percentile(asc(ivs), 50) : 0;
}

export function analyseGlide(rec: Recording, tile: number = TILE): GlideReport {
  const out: GlideReport = { beats: [], noGlideSteps: 0, wrongGlides: [], unmeasured: 0, steadiness: { beats: 0, mean: null, max: null } };
  const frameMs = medianInterval(rec.frames);
  const bySeq = new Map<number, FrameSample[]>();
  for (const f of rec.frames) {
    const list = bySeq.get(f.seq);
    if (list) list.push(f);
    else bySeq.set(f.seq, [f]);
  }
  for (const e of rec.events) {
    if (e.type !== 'start') continue;
    const speed = stepSpeed(e);
    const frames = (bySeq.get(e.seq) ?? []).slice().sort((a, b) => a.t - b.t);

    // 4x and reduced motion: nothing glides
    if (speed !== null && isSpeedValue(speed) && e.planned) {
      const expect = tweenEnabled(speed, e.reduced);
      if (!expect) {
        out.noGlideSteps++;
        if (e.tween || e.moves.length > 0) out.wrongGlides.push(`step ${e.step}: ${e.moves.length} glide(s) planned at ${speed}x${e.reduced ? ' with reduced motion' : ''}, where timing.ts has none`);
        else if (frames.some((f) => f.units.some((u) => u[4] >= 0))) out.wrongGlides.push(`step ${e.step}: a unit glided in the frames at ${speed}x${e.reduced ? ' with reduced motion' : ''}`);
      } else if (e.moves.length > 0 && !e.tween) {
        out.wrongGlides.push(`step ${e.step}: glides are planned but the plan says it does not tween`);
      }
    }

    e.moves.forEach((m, beat) => {
      const tiles = polylineLength(m.path);
      if (tiles <= 0) return;
      const path = m.path.map(([x, y]) => ({ x, y }));
      const specPer = speed !== null && isSpeedValue(speed) ? moveTileMs(speed) : null;
      const problems: GlideProblem[] = [];
      const bad = (kind: GlideKind, text: string): void => {
        problems.push({ kind, text });
      };

      // the plan itself: the beat's length is tiles x TIMINGS at that speed
      if (specPer !== null && Math.abs(m.durMs - tiles * specPer) > 1) {
        bad('speed', `the plan gives ${round(m.durMs / tiles, 1)} ms a tile, TIMINGS says ${specPer}`);
      }

      // this unit's pose in every frame of the plan, as tiles along its path
      const series: { t: number; beat: number; prog: number; off: number; x: number; y: number }[] = [];
      for (const f of frames) {
        const pose = f.units.find((u) => u[0] === m.unitId);
        if (!pose) continue;
        const x = pose[1] / tile - 0.5;
        const y = pose[3] / tile - 0.5;
        const pr = projectOnPath(path, { x, y });
        series.push({ t: f.t, beat: pose[4], prog: pr.length > 0 ? pr.s / pr.length : 0, off: pr.off, x, y });
      }
      const inside = series.filter((s) => s.beat === beat);

      // a step of the unit between two frames can be no more than the ease allows
      let maxStep = 0;
      for (let i = 1; i < series.length; i++) {
        const dt = series[i].t - series[i - 1].t;
        const d = Math.hypot(series[i].x - series[i - 1].x, series[i].y - series[i - 1].y);
        maxStep = Math.max(maxStep, d);
        if (specPer !== null) {
          const allowed = (dt / specPer) * LIMITS.teleportFactor + LIMITS.teleportEpsilonTiles;
          if (d > allowed) bad('teleport', `moved ${round(d, 2)} tiles in ${round(dt, 1)} ms (at most ${round(allowed, 2)})`);
        }
      }

      // never off the path, never backwards
      for (const s of inside) {
        if (s.off > LIMITS.offPathTiles) {
          bad('path', `left the path by ${round(s.off, 2)} tiles`);
          break;
        }
      }
      for (let i = 1; i < inside.length; i++) {
        if (inside[i].prog < inside[i - 1].prog - LIMITS.backwardsFraction) {
          bad('path', `went backwards at ${round(inside[i].t, 1)} ms`);
          break;
        }
      }

      // the end: the last frame after the glide must stand on the destination tile (only the unit's last beat has a final resting tile)
      const last = e.moves.reduce((acc, mv, i) => (mv.unitId === m.unitId && mv.startMs + mv.durMs >= e.moves[acc].startMs + e.moves[acc].durMs ? i : acc), beat);
      if (last === beat && series.length > 0) {
        const final = series[series.length - 1];
        const afterEnd = final.beat < 0;
        if (afterEnd) {
          const dest = path[path.length - 1];
          const miss = Math.hypot(final.x - dest.x, final.y - dest.y);
          if (miss > LIMITS.endToleranceTiles) bad('end', `ended ${round(miss, 2)} tiles off its destination tile`);
        }
      }

      // the glide's measured length: before its settle a glide moves at one steady speed, so progress is linear in time over the frames strictly inside it
      // (the settle and the first moments are left out); the whole glide takes the cruise share of that speed longer than the slope says
      let measuredMs: number | null = null;
      const cruiseEnd = GLIDE_CRUISE * (1 - GLIDE_SETTLE) - 0.02;
      const fit = inside.filter((s) => s.prog > 0.02 && s.prog < cruiseEnd);
      if (fit.length >= 2) {
        const ts = fit.map((s) => s.t);
        const ps = fit.map((s) => s.prog);
        const mt = ts.reduce((a, b) => a + b, 0) / ts.length;
        const mp = ps.reduce((a, b) => a + b, 0) / ps.length;
        let cov = 0;
        let vt = 0;
        for (let i = 0; i < ts.length; i++) {
          cov += (ts[i] - mt) * (ps[i] - mp);
          vt += (ts[i] - mt) ** 2;
        }
        if (vt > 0 && cov > 0) measuredMs = (GLIDE_CRUISE * vt) / cov;
      }

      // steadiness: the peak per-frame speed over the mean speed, from the first moving frame to the last one before the final tile
      let steadiness: number | null = null;
      if (tiles > 1) {
        const run = inside.filter((s) => s.prog > 0 && s.prog * tiles <= tiles - 1);
        if (run.length >= 3) {
          let peak = 0;
          for (let i = 1; i < run.length; i++) peak = Math.max(peak, ((run[i].prog - run[i - 1].prog) * tiles) / (run[i].t - run[i - 1].t));
          const mean = ((run[run.length - 1].prog - run[0].prog) * tiles) / (run[run.length - 1].t - run[0].t);
          if (mean > 0) steadiness = peak / mean;
        }
      }
      if (steadiness !== null && steadiness > LIMITS.steadyMax) bad('steady', `peak speed ${round(steadiness, 2)} times the mean (a steady march is under ${LIMITS.steadyMax})`);
      let toleranceMs: number | null = null;
      if (measuredMs !== null && specPer !== null) {
        const spec = tiles * specPer;
        toleranceMs = Math.max(LIMITS.glideTolerance * spec, frameMs);
        if (Math.abs(measuredMs - spec) > toleranceMs) {
          bad('speed', `${round(measuredMs / tiles, 1)} ms a tile, spec ${specPer} (${measuredMs < spec ? 'too fast' : 'too slow'})`);
        }
      } else if (measuredMs === null && fit.length < 2) {
        out.unmeasured++;
      }

      out.beats.push({
        step: e.step, seq: e.seq, unitId: m.unitId, speed, tiles: round(tiles, 3), specMsPerTile: specPer,
        measuredMs: measuredMs === null ? null : round(measuredMs, 1),
        measuredMsPerTile: measuredMs === null ? null : round(measuredMs / tiles, 1),
        toleranceMs: toleranceMs === null ? null : round(toleranceMs, 1),
        framesInside: inside.length, maxStepTiles: round(maxStep, 3), steadiness: steadiness === null ? null : round(steadiness, 3),
        problems: dedupe(problems), ok: problems.length === 0,
      });
    });
  }
  const st = out.beats.map((b) => b.steadiness).filter((v): v is number => v !== null);
  if (st.length) out.steadiness = { beats: st.length, mean: round(st.reduce((a, b) => a + b, 0) / st.length, 3), max: Math.max(...st) };
  return out;
}

const isSpeedValue = (n: number): n is Speed => n === 1 || n === 2 || n === 4;

/** One problem of each kind and wording: a long glide with the same fault in every frame says it once. */
const dedupe = (xs: GlideProblem[]): GlideProblem[] => {
  const seen = new Set<string>();
  const out: GlideProblem[] = [];
  for (const x of xs) {
    const key = `${x.kind}:${x.text.replace(/[0-9.]+/g, '#')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out;
};

// ---------------------------------------------------------------- camera

export interface CameraReport {
  frames: number;
  /** The largest displacement between two frames, world units, and the speed it implies. */
  maxStep: number;
  maxSpeed: number;
  jumps: { t: number; step: number; distance: number; allowed: number }[];
  /** Shake episodes judged, those that did not decay, and those too short (fewer frames than the rule needs) to judge. */
  shakeEpisodes: number;
  shakeNotDecaying: { step: number; firstHalf: number; secondHalf: number }[];
  shakeUnjudged: number;
}

export interface CameraOptions {
  maxSpeed?: number;
}

export function analyseCamera(rec: Recording, opt: CameraOptions = {}): CameraReport {
  const maxSpeed = opt.maxSpeed ?? LIMITS.cameraMaxSpeed;
  const out: CameraReport = { frames: rec.frames.length, maxStep: 0, maxSpeed: 0, jumps: [], shakeEpisodes: 0, shakeNotDecaying: [], shakeUnjudged: 0 };
  const fr = rec.frames;
  for (let i = 1; i < fr.length; i++) {
    const a = fr[i - 1];
    const b = fr[i];
    const d = Math.hypot(b.cam[0] - a.cam[0], b.cam[1] - a.cam[1], b.cam[2] - a.cam[2]);
    const dt = Math.max(1e-3, (b.t - a.t) / 1000);
    out.maxStep = Math.max(out.maxStep, d);
    out.maxSpeed = Math.max(out.maxSpeed, d / dt);
    const allowed = maxSpeed * Math.min(dt, LIMITS.cameraDtCapSec) + LIMITS.cameraEpsilon;
    if (d > allowed && !b.cut) out.jumps.push({ t: round(b.t, 1), step: b.step, distance: round(d, 3), allowed: round(allowed, 3) });
  }
  out.maxStep = round(out.maxStep, 3);
  out.maxSpeed = round(out.maxSpeed, 2);

  // a shake: contiguous frames of one plan with the shake on. Its size must not grow from the first half to the second.
  let i = 0;
  while (i < fr.length) {
    if (fr[i].shake <= 0) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < fr.length && fr[j + 1].shake > 0 && fr[j + 1].seq === fr[i].seq) j++;
    const n = j - i + 1;
    if (n < LIMITS.shakeMinFrames) out.shakeUnjudged++;
    else {
      out.shakeEpisodes++;
      const half = Math.floor(n / 2);
      let first = 0;
      let second = 0;
      for (let k = 0; k < half; k++) first = Math.max(first, fr[i + k].shake);
      for (let k = half; k < n; k++) second = Math.max(second, fr[i + k].shake);
      if (second > first + 1e-6) out.shakeNotDecaying.push({ step: fr[i].step, firstHalf: round(first, 4), secondHalf: round(second, 4) });
    }
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------- playback cadence

export interface StepCadence {
  step: number;
  speed: number;
  measuredMs: number;
  /** durationMs + the dwell. */
  plannedMs: number;
  ratio: number;
  /** How far past its plan the step ran, ms (negative: short). */
  overshootMs: number;
}

export interface SpeedCadence {
  speed: number;
  steps: number;
  measuredMs: number;
  plannedMs: number;
  /** Total measured over total planned. 1 is exactly on plan. */
  ratio: number;
  stepsPerSec: number;
}

export interface CadenceReport {
  steps: StepCadence[];
  perSpeed: SpeedCadence[];
  /** Pairs of consecutive steps left out, and why. */
  excluded: { held: number; speedChange: number; notPlayed: number; unknownSpeed: number };
}

export interface Span {
  from: number;
  to: number;
}

export interface CadenceOptions {
  /** Time spans (performance.now ms) when the story held playback: a step whose span overlaps one is left out. */
  holds?: readonly Span[];
}

const overlaps = (a: number, b: number, spans: readonly Span[]): boolean => spans.some((s) => s.from < b && s.to > a);

export function analyseCadence(events: readonly PlaybackEvent[], opt: CadenceOptions = {}): CadenceReport {
  const starts = events.filter((e): e is StepStart => e.type === 'start').slice().sort((a, b) => a.t - b.t);
  const out: CadenceReport = { steps: [], perSpeed: [], excluded: { held: 0, speedChange: 0, notPlayed: 0, unknownSpeed: 0 } };
  const holds = opt.holds ?? [];
  for (let i = 0; i + 1 < starts.length; i++) {
    const a = starts[i];
    const b = starts[i + 1];
    if (b.step !== a.step + 1 || !a.planned || !b.planned) {
      out.excluded.notPlayed++;
      continue;
    }
    const sa = stepSpeed(a);
    const sb = stepSpeed(b);
    if (sa !== sb) {
      out.excluded.speedChange++;
      continue;
    }
    if (sa === null || !isSpeedValue(sa)) {
      out.excluded.unknownSpeed++;
      continue;
    }
    if (overlaps(a.t, b.t, holds)) {
      out.excluded.held++;
      continue;
    }
    const plannedMs = a.durationMs + dwellMs(sa, a.durationMs);
    const measuredMs = b.t - a.t;
    out.steps.push({ step: a.step, speed: sa, measuredMs: round(measuredMs, 1), plannedMs, ratio: round(measuredMs / plannedMs, 3), overshootMs: round(measuredMs - plannedMs, 1) });
  }
  const speeds = [...new Set(out.steps.map((s) => s.speed))].sort((x, y) => x - y);
  for (const speed of speeds) {
    const list = out.steps.filter((s) => s.speed === speed);
    const measured = list.reduce((acc, s) => acc + s.measuredMs, 0);
    const planned = list.reduce((acc, s) => acc + s.plannedMs, 0);
    out.perSpeed.push({ speed, steps: list.length, measuredMs: round(measured, 1), plannedMs: planned, ratio: round(measured / planned, 3), stepsPerSec: round(list.length / (measured / 1000), 3) });
  }
  return out;
}

// ---------------------------------------------------------------- the whole report

export interface Verdict {
  /** The budget's name, as MOTION.md spells it. */
  check: string;
  ok: boolean;
  /** False when the budget does not apply to this recording (too slow a machine, nothing to measure): it neither passes nor fails. */
  applies: boolean;
  reason: string;
}

export interface MotionReport {
  schema: typeof MOTION_SCHEMA;
  pacing: PacingReport;
  pacingByConfig: Record<string, PacingReport>;
  glide: GlideReport;
  camera: CameraReport;
  cadence: CadenceReport;
  verdicts: Verdict[];
  /** The names of the checks that applied and failed. */
  failed: string[];
  ok: boolean;
}

export interface AnalyseOptions extends CadenceOptions, CameraOptions {
  tile?: number;
}

const cap = (xs: readonly string[], n = 3): string => (xs.length <= n ? xs.join('; ') : `${xs.slice(0, n).join('; ')}; and ${xs.length - n} more`);

export function analyseMotion(rec: Recording, opt: AnalyseOptions = {}): MotionReport {
  const { all: pacing, byConfig } = recordingPacing(rec);
  const glide = analyseGlide(rec, opt.tile);
  const camera = analyseCamera(rec, opt);
  const cadence = analyseCadence(rec.events, opt);
  // how fast the machine draws, not how long the stage chose to hold still: the gaps only happen under 20 fps, so they cannot hide a 30 fps machine
  const smooth = pacing.frames >= 3 && pacing.drawFps >= LIMITS.smoothFps;
  const slowNote = `${pacing.drawFps} fps, under ${LIMITS.smoothFps}`;
  const v: Verdict[] = [];
  const add = (check: string, applies: boolean, bad: readonly string[], none: string): void => {
    v.push({ check, applies, ok: bad.length === 0, reason: !applies ? none : bad.length === 0 ? 'ok' : cap(bad) });
  };

  add('hitch', smooth, pacing.hitches > 0 ? [`${pacing.hitches} frame(s) over ${LIMITS.hitchFactor}x the median and ${LIMITS.hitchMs} ms (the longest ${pacing.interval.max} ms)`] : [], `not judged: ${slowNote}`);

  const named = (kind: GlideKind): string[] =>
    glide.beats.flatMap((b) => b.problems.filter((p) => p.kind === kind).map((p) => `step ${b.step} unit ${b.unitId}: ${p.text}`));
  const measured = glide.beats.filter((b) => b.measuredMs !== null);
  add('glide-speed', glide.beats.length > 0 && measured.length + named('speed').length > 0, named('speed'),
    glide.beats.length === 0 ? 'no glide in the recording' : 'no glide had two frames inside it to measure');
  add('glide-steady', glide.steadiness.beats > 0, named('steady'), glide.beats.length === 0 ? 'no glide in the recording' : 'no glide had a tile before its last and three frames in it to judge');
  add('no-teleport', glide.beats.length > 0, named('teleport'), 'no glide in the recording');
  add('glide-path', glide.beats.length > 0, named('path'), 'no glide in the recording');
  add('glide-end', glide.beats.length > 0, named('end'), 'no glide in the recording');
  add('no-glide-at-4x', glide.noGlideSteps > 0 || glide.wrongGlides.length > 0, glide.wrongGlides, 'no 4x or reduced-motion step in the recording');

  add('camera-jump', camera.frames > 1, camera.jumps.map((j) => `step ${j.step}: ${j.distance} world units in one frame (at most ${j.allowed})`), 'fewer than two frames');
  add('shake-decay', camera.shakeEpisodes > 0, camera.shakeNotDecaying.map((s) => `step ${s.step}: ${s.secondHalf} in the second half, ${s.firstHalf} in the first`), camera.shakeUnjudged > 0 ? `${camera.shakeUnjudged} shake(s) too short to judge` : 'no shake in the recording');

  const off = cadence.perSpeed.filter((s) => Math.abs(s.ratio - 1) > LIMITS.cadenceTolerance).map((s) => `${s.speed}x runs at ${s.ratio}x its plan over ${s.steps} steps`);
  add('cadence', smooth && cadence.perSpeed.length > 0, off, cadence.perSpeed.length === 0 ? 'no played step pair in the recording' : `not judged: ${slowNote}`);
  const stallAt = Math.max(LIMITS.stallMs, LIMITS.stallFrames * pacing.interval.p50);
  add('step-stall', smooth && cadence.steps.length > 0,
    cadence.steps.filter((s) => s.overshootMs > stallAt).map((s) => `step ${s.step} at ${s.speed}x ran ${s.overshootMs} ms past its plan (limit ${round(stallAt, 0)})`),
    cadence.steps.length === 0 ? 'no played step pair in the recording' : `not judged: ${slowNote}`);

  const failed = v.filter((x) => x.applies && !x.ok).map((x) => x.check);
  return { schema: MOTION_SCHEMA, pacing, pacingByConfig: byConfig, glide, camera, cadence, verdicts: v, failed, ok: failed.length === 0 };
}
