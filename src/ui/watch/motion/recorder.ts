// The in-page motion recorder (P1). Off unless the address says `?probe=motion`: then the runtime builds one, calls it from its own frame loop
// (never a second loop), and the page can read and reset it through `window.__awMotion`. When it is off nothing here runs and nothing is
// added to `window`.
//
// It keeps what the viewer's own stage already knows: per drawn frame the timestamp, the JS time of the stage's frame(), the quality tier, the
// render scale, the camera and the units the plan moves; per step the plan's own timings; and the browser's long tasks.
import { dwellMs, isSpeed } from '../timing';
import type { TransitionPlan } from '../transition';
import { MOTION_SCHEMA } from './types';
import type { FrameSample, LongTask, MotionProbe, PlaybackEvent, PlannedMove, Recording, StepDone, StepStart } from './types';

/** The one property this adds to `window`, and only when the recorder is on. */
export const WINDOW_KEY = '__awMotion';

/** Frames kept before the recorder stops keeping more and says so (about 11 minutes at 60 fps). A runaway page cannot fill memory. */
export const MAX_FRAMES = 40_000;

/** What `window.__awMotion` offers. */
export interface MotionApi {
  version: typeof MOTION_SCHEMA;
  /** Everything recorded since the last reset. The arrays are copies: reading never disturbs the recording. */
  read(): Recording;
  /** Starts a new recording; the page keeps being observed. */
  reset(): void;
}

export interface RecorderOptions {
  maxFrames?: number;
  /** Watch long tasks (default true; a node test has none). */
  longTasks?: boolean;
}

export class MotionRecorder implements MotionProbe, MotionApi {
  readonly version = MOTION_SCHEMA;
  private frames: FrameSample[] = [];
  private events: PlaybackEvent[] = [];
  private tasks: LongTask[] = [];
  private truncated = false;
  private observer: PerformanceObserver | null = null;
  private readonly maxFrames: number;

  constructor(opts: RecorderOptions = {}) {
    this.maxFrames = opts.maxFrames ?? MAX_FRAMES;
    if (opts.longTasks !== false) this.observeLongTasks();
  }

  private observeLongTasks(): void {
    try {
      if (typeof PerformanceObserver === 'undefined') return;
      if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) this.tasks.push({ start: e.startTime, dur: e.duration });
      });
      this.observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // a browser without long-task entries simply records none
      this.observer = null;
    }
  }

  frame(sample: FrameSample): void {
    if (this.frames.length >= this.maxFrames) {
      this.truncated = true;
      return;
    }
    this.frames.push(sample);
  }

  stepStart(event: StepStart): void {
    this.events.push(event);
  }

  stepDone(event: StepDone): void {
    this.events.push(event);
  }

  read(): Recording {
    // the observer queues entries it has not delivered yet; take them so a read right after a long task includes it
    try {
      for (const e of this.observer?.takeRecords() ?? []) this.tasks.push({ start: e.startTime, dur: e.duration });
    } catch {
      // nothing to take
    }
    return { schema: MOTION_SCHEMA, frames: this.frames.slice(), events: this.events.slice(), longTasks: this.tasks.slice(), truncated: this.truncated };
  }

  reset(): void {
    this.frames = [];
    this.events = [];
    this.tasks = [];
    this.truncated = false;
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

/**
 * Builds the recorder and puts its API on `target` (the page's window). Returns the probe the runtime calls; disposing it takes the API off
 * again, but only if it is still this recorder's (a second stage may have replaced it).
 */
export function installMotionRecorder(target: object | undefined = typeof window === 'undefined' ? undefined : window, opts: RecorderOptions = {}): MotionProbe {
  const rec = new MotionRecorder(opts);
  const api: MotionApi = { version: MOTION_SCHEMA, read: () => rec.read(), reset: () => rec.reset() };
  if (target) (target as Record<string, unknown>)[WINDOW_KEY] = api;
  return {
    frame: (s) => rec.frame(s),
    stepStart: (e) => rec.stepStart(e),
    stepDone: (e) => rec.stepDone(e),
    dispose: () => {
      rec.dispose();
      if (target && (target as Record<string, unknown>)[WINDOW_KEY] === api) delete (target as Record<string, unknown>)[WINDOW_KEY];
    },
  };
}

// ---------------------------------------------------------------- what the runtime hands the recorder

/** The playback speed the controls show (the pressed "1x / 2x / 4x" button), or null where there are no controls (a gallery, a test). */
export function pageSpeed(doc: { querySelector?: (sel: string) => { textContent: string | null } | null } | undefined = typeof document === 'undefined' ? undefined : document): number | null {
  try {
    const text = doc?.querySelector?.('.aww-speeds [aria-pressed="true"]')?.textContent ?? '';
    const n = Number.parseInt(text, 10);
    return isSpeed(n) ? n : null;
  } catch {
    return null;
  }
}

/** The plan's own timings for a StepStart: what was planned, so the analysis can hold the drawn frames to it. */
export function describePlan(seq: number, t: number, step: number, plan: TransitionPlan | null, reduced: boolean, speed: number | null): StepStart {
  const moves: PlannedMove[] = (plan?.moves ?? []).map((m) => ({
    unitId: m.unitId, startMs: m.startMs, durMs: m.durMs, path: m.path.map((c) => [c.x, c.y] as const),
  }));
  const durationMs = plan?.durationMs ?? 0;
  return {
    type: 'start', t, seq, step, speed, reduced, tween: plan?.tween ?? false, planned: plan !== null, durationMs,
    dwellMs: isSpeed(speed) ? dwellMs(speed, durationMs) : null, moves,
  };
}

/**
 * The move beat unit `unitId` is on at plan time `t`: an index into `plan.moves`, -1 when none of its glides is running (all over, or the plan
 * is done). It follows sampleTransition exactly: the unit's first beat that has not ended by `t`.
 */
export function activeBeat(plan: TransitionPlan, unitId: number, t: number | null): number {
  if (t === null) return -1;
  let best = -1;
  for (let i = 0; i < plan.moves.length; i++) {
    const m = plan.moves[i];
    if (m.unitId !== unitId || t >= m.startMs + m.durMs) continue;
    if (best < 0 || m.startMs < plan.moves[best].startMs) best = i;
  }
  return best;
}
