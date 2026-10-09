// The motion recording (P1): what the in-page recorder writes and what the analysis reads. Plain numbers and arrays, JSON-safe, so a
// recording can be read out of a page by the driver (scripts/motion.mjs), saved, and analysed in node. Nothing here touches the DOM or a clock.
//
// A recording holds only the current view's own state: frames the viewer saw, the units the plan moves, the plan's own timings. It never reads
// the true state of the match, so a fogged viewer's recording says nothing the viewer could not see (D-016).
import type { QualityTier } from '../../board3d/stage/quality';

/** Bumped when the shape changes, so a saved baseline from an older build is recognised and not compared blindly. */
export const MOTION_SCHEMA = 1;

export type Vec3 = readonly [x: number, y: number, z: number];

/** One unit the plan moves, in one frame: its id, its world position, and the move beat it is on (-1: no glide is running for it). */
export type UnitPose = readonly [id: number, x: number, y: number, z: number, beat: number];

/** One drawn frame. */
export interface FrameSample {
  /** The animation frame's timestamp, ms (the same clock as `performance.now()`). */
  t: number;
  /** How long the runtime's own frame() took on the JS thread, ms. The GPU's share is not in it. */
  js: number;
  tier: QualityTier;
  /** The internal render scale in force: the drawing buffer as a fraction of the canvas's CSS size. */
  scale: number;
  /** The camera's world position as drawn (the shake included). */
  cam: Vec3;
  /** The plan this frame belongs to (StepStart.seq), or -1 before any view. */
  seq: number;
  /** The timeline step on screen. */
  step: number;
  /** The plan's clock, ms, or null when no plan was running (the step rests). */
  planT: number | null;
  /** The camera shake applied this frame, 0..1 of its peak (0: none). */
  shake: number;
  /** How strongly the attack camera applied, 0..1 (0: off). */
  attack: number;
  /** True when the runtime cut the camera on purpose this frame (a scrub or a step with nothing to animate): a jump is allowed there. */
  cut: boolean;
  /** Animation frames the stage chose not to draw since the previous drawn frame (it gives the thread back to playback at a step boundary on a slow machine). */
  skips: number;
  /** Every unit that has a move beat in the current plan, with its world position this frame. */
  units: readonly UnitPose[];
}

/** One move beat of the plan, as planned: the spec the glide is measured against. Tiles are tile coordinates. */
export interface PlannedMove {
  unitId: number;
  startMs: number;
  durMs: number;
  path: readonly (readonly [x: number, y: number])[];
}

/** A step's plan arrived (the viewer moved on, by playing or by hand). */
export interface StepStart {
  type: 'start';
  /** performance.now() when the stage was handed the plan. */
  t: number;
  /** Counts the plans the stage was handed, from 0. Frames carry the same number. */
  seq: number;
  step: number;
  /** The playback speed on screen (1, 2 or 4), or null when the page did not say. */
  speed: number | null;
  reduced: boolean;
  /** False when unit glides are off (4x, reduced motion). */
  tween: boolean;
  /** False for a step reached by a jump or a rewind: it has no plan, so its length is the viewer's, not playback's. */
  planned: boolean;
  durationMs: number;
  /** The pause playback waits after the animation, from timing.ts (null when the speed is not known). */
  dwellMs: number | null;
  moves: readonly PlannedMove[];
}

/** The plan ran to its end (the stage told the page). */
export interface StepDone {
  type: 'done';
  t: number;
  seq: number;
  step: number;
}

export type PlaybackEvent = StepStart | StepDone;

export interface LongTask {
  start: number;
  dur: number;
}

export interface Recording {
  schema: typeof MOTION_SCHEMA;
  frames: FrameSample[];
  events: PlaybackEvent[];
  longTasks: LongTask[];
  /** True when the recorder stopped keeping frames because it hit its limit. */
  truncated: boolean;
}

/** The recorder as the runtime sees it: three calls and a way to stop. Tests hand the runtime a stand-in that counts them. */
export interface MotionProbe {
  frame(sample: FrameSample): void;
  stepStart(event: StepStart): void;
  stepDone(event: StepDone): void;
  dispose(): void;
}

/** The page address asks for the recorder with `?probe=motion`. Anything else (or nothing) is off. */
export function probeRequested(search: string): boolean {
  const q = search.startsWith('?') ? search.slice(1) : search;
  for (const part of q.split('&')) {
    const [key, value = ''] = part.split('=');
    if (key !== 'probe') continue;
    let v = value;
    try {
      v = decodeURIComponent(value);
    } catch {
      // a malformed escape is just not a request
    }
    if (v.toLowerCase() === 'motion') return true;
  }
  return false;
}
