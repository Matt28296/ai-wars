// Recordings written by hand for the motion tests (not shipped: nothing in the game imports this file). A synthetic recording is built from the
// SPEC, written out here independently of the code under test: a steady march (one speed, then an ease out over the last tenth of the time), 240 ms a tile at
// 1x (and 120 at 2x), a dwell of 200 ms
// divided by the speed. Each fault the analysis must catch is one switch on the builder, so a test can show the same recording passing without it
// and failing with it.
import type { FrameSample, PlaybackEvent, PlannedMove, Recording, StepDone, StepStart, UnitPose } from './types';
import { MOTION_SCHEMA } from './types';

/** 240 ms a tile at 1x, divided by the speed. */
export const SPEC_TILE_MS: Readonly<Record<number, number>> = { 1: 240, 2: 120 };
/** 200 ms after a step that animated, divided by the speed. */
export const SPEC_DWELL_MS: Readonly<Record<number, number>> = { 1: 200, 2: 100, 4: 50 };

/** The old ease, kept as the known-bad: slow at both ends, 1.5x the mean speed in the middle. */
const smoothstep = (q: number): number => {
  const c = Math.max(0, Math.min(1, q));
  return c * c * (3 - 2 * c);
};

/**
 * The steady march, from the spec: one speed (a little over the mean, 1 / 0.95) for the first nine tenths of the time, which covers 0.9 / 0.95 of the path;
 * then a constant slowing over the last tenth, from that speed to a stop, which covers the rest. It ends exactly on 1.
 */
const steady = (q: number): number => {
  const c = Math.max(0, Math.min(1, q));
  const v = 1 / 0.95;
  if (c <= 0.9) return v * c;
  const into = c - 0.9;
  return v * 0.9 + v * into - (v / (2 * 0.1)) * into * into;
};

export interface Synth {
  /** Frames a second (default 60). */
  fps?: number;
  speed?: 1 | 2 | 4;
  reduced?: boolean;
  /** The path of the one glide each step plans, in tiles (default 3 tiles east along row 3). */
  path?: [number, number][];
  /** How many steps follow each other (default 4). */
  steps?: number;
  /** The first step's index (default 10). */
  firstStep?: number;
  unitId?: number;
  // ---- the faults
  /** The glide is drawn this many times faster than it was planned (2: twice the spec speed). */
  glideSpeedup?: number;
  /** The unit pops to the destination in one frame, half way through the glide of the first step. */
  teleport?: boolean;
  /** The glide's ease: 'steady' (the default, the spec) or 'smoothstep' (the old one, a fault). */
  ease?: 'steady' | 'smoothstep';
  /** The stage does not draw for this long, ms, half way through the first glide; `flagged` says whether the frame after it admits to having skipped. */
  skipWindow?: { ms: number; flagged: boolean };
  /** Frames missing so that one interval is this long, ms, half way through the first glide. */
  hitchMs?: number;
  /** The unit comes to rest this many tiles short of the destination. */
  stopShort?: number;
  /** The next step starts this long after it should, ms, after the first step. */
  stallMs?: number;
  /** The camera jumps this many world units in one frame during the first step. */
  cameraJump?: number;
  /** A jump that the stage declared a cut. */
  cameraJumpIsCut?: boolean;
  /** A shake of 250 ms in the first step whose size follows this (envelope(u), u in 0..1); default none. */
  shake?: (u: number) => number;
  /** Plan a glide even at 4x / reduced motion (a fault), or none at all there (the truth). */
  glideAtSpeed4?: boolean;
  /** The time from one step's start to the next is this many times its plan (cadence: 1.25 is slow by a quarter). */
  stretch?: number;
}

export interface Built {
  rec: Recording;
  /** The tiles of the glide, the plan's length of it and the step starts, for the test to quote. */
  tiles: number;
  glideMs: number;
  startsAt: number[];
  frameMs: number;
}

const tilesOf = (path: readonly (readonly [number, number])[]): number => {
  let n = 0;
  for (let i = 0; i + 1 < path.length; i++) n += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  return n;
};

/** The point `s` tiles along a polyline. */
const along = (path: readonly (readonly [number, number])[], s: number): [number, number] => {
  let left = Math.max(0, s);
  for (let i = 0; i + 1 < path.length; i++) {
    const len = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    if (left <= len || i + 2 === path.length) {
      const k = len > 0 ? Math.min(1, left / len) : 0;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k];
    }
    left -= len;
  }
  return [path[0][0], path[0][1]];
};

export function synthesize(o: Synth = {}): Built {
  const fps = o.fps ?? 60;
  const speed = o.speed ?? 1;
  const reduced = o.reduced === true;
  const path = o.path ?? [[2, 3], [3, 3], [4, 3], [5, 3]];
  const stepsN = o.steps ?? 4;
  const first = o.firstStep ?? 10;
  const unitId = o.unitId ?? 7;
  const tiles = tilesOf(path);
  const tween = speed < 4 && !reduced;
  const glides = tween || o.glideAtSpeed4 === true;
  const perTile = SPEC_TILE_MS[speed] ?? 240;
  const glideMs = glides ? tiles * perTile : 0;
  const durationMs = glideMs;
  const dwell = durationMs > 0 ? SPEC_DWELL_MS[speed] : Math.round(60 / speed);
  const stretch = o.stretch ?? 1;
  const frameMs = 1000 / fps;

  const events: PlaybackEvent[] = [];
  const startsAt: number[] = [];
  let t0 = 1000;
  for (let k = 0; k < stepsN; k++) {
    const moves: PlannedMove[] = glides ? [{ unitId, startMs: 0, durMs: glideMs, path }] : [];
    const start: StepStart = {
      type: 'start', t: t0, seq: k, step: first + k, speed, reduced, tween: glides, planned: true, durationMs, dwellMs: dwell, moves,
    };
    events.push(start);
    startsAt.push(t0);
    const done: StepDone = { type: 'done', t: t0 + durationMs, seq: k, step: first + k };
    events.push(done);
    t0 += (durationMs + dwell) * stretch + (k === 0 ? o.stallMs ?? 0 : 0);
  }
  const end = t0;

  const frames: FrameSample[] = [];
  const hitchFrom = startsAt[0] + glideMs / 2;
  let flagNext = false;
  const jumpAt = startsAt[0] + 40;
  let jumped = 0;
  for (let t = 1000; t < end; t += frameMs) {
    if (o.hitchMs !== undefined && t > hitchFrom && t < hitchFrom + o.hitchMs - frameMs / 2) continue;
    if (o.skipWindow && t > hitchFrom && t < hitchFrom + o.skipWindow.ms - frameMs / 2) {
      flagNext = o.skipWindow.flagged;
      continue;
    }
    let k = 0;
    while (k + 1 < stepsN && startsAt[k + 1] <= t) k++;
    const planT = t - startsAt[k];
    const gliding = glides && planT < glideMs;
    const units: UnitPose[] = [];
    if (glides) {
      let s: number;
      if (gliding) {
        const q = planT / glideMs;
        let p = (o.ease === 'smoothstep' ? smoothstep : steady)(q * (o.glideSpeedup ?? 1));
        if (o.teleport && k === 0) p = planT < glideMs / 2 ? 0 : 1;
        s = p * tiles;
      } else {
        s = tiles - (o.stopShort ?? 0);
      }
      const [x, y] = along(path, s);
      units.push([unitId, x + 0.5, 0, y + 0.5, gliding ? 0 : -1]);
    }
    let shake = 0;
    if (o.shake && k === 0 && planT >= 0 && planT < 250) shake = o.shake(planT / 250);
    const jump = o.cameraJump !== undefined && t >= jumpAt && jumped === 0;
    if (jump) jumped = 1;
    const skips = flagNext;
    flagNext = false;
    frames.push({
      t, js: 3, tier: 'high', scale: 1,
      cam: [10 + (o.cameraJump !== undefined && t >= jumpAt ? o.cameraJump : 0), 12, 9], seq: k, step: first + k,
      planT: planT < durationMs ? planT : null, shake, attack: 0, cut: jump && o.cameraJumpIsCut === true, skips: skips ? 1 : 0, units,
    });
  }
  return { rec: { schema: MOTION_SCHEMA, frames, events, longTasks: [], truncated: false }, tiles, glideMs, startsAt, frameMs };
}
