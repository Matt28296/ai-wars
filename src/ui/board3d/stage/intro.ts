// The match intro (G8b): at step 0 the camera starts wider and lower and eases into the resting framing over about 1.5 seconds.
// It runs only when the viewer OPENS the match at step 0 (a first view), never when they scrub (a jump to any step, or another
// viewer's timeline), never when the match is opened at a later step, and never under reduced motion (no easing at all there).
// The intro is a layer over the rig: it only changes the distance and the pitch the rig's pose is taken at, so the focus, the zoom
// and the drag keep working underneath it, and when it ends the pose is exactly the resting one.
import { PITCH_DEG, REST_FRAMING } from './rig';
import type { Framing } from './rig';

/** How long the intro takes (seconds of the stage's own clock). */
export const INTRO_SECONDS = 1.5;
/** It starts this many times farther away than the resting distance... */
export const INTRO_DISTANCE = 1.35;
/** ...and looking this far down from horizontal (the resting pitch is 55). Lower is also lower in the air: the camera starts about 20% nearer the table. */
export const INTRO_PITCH_DEG = 32;

/** Ease in and out (cubic): the dolly leaves its mark gently and arrives gently. 0 -> 0, 1 -> 1, monotonic. */
export function introEase(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** The framing at progress 0..1 through the intro: the wide low start at 0 and exactly the resting framing at 1. */
export function introFraming(progress: number): Framing {
  if (!(progress < 1)) return REST_FRAMING; // also NaN: a bad clock lands on the resting pose, never on a wide one
  const k = 1 - introEase(progress);
  return { distanceScale: 1 + (INTRO_DISTANCE - 1) * k, pitchDeg: PITCH_DEG + (INTRO_PITCH_DEG - PITCH_DEG) * k };
}

export type IntroAction = 'start' | 'skip' | 'keep';

export interface IntroEvent {
  /** This is the runtime's first view (nothing was shown before). */
  first: boolean;
  /** The step index the view shows. */
  step: number;
  reducedMotion: boolean;
  /** The timeline changed (another viewer's timeline over the same match: a snap, not an animation). */
  timelineChanged: boolean;
  /** The step changed since the last view. */
  stepChanged: boolean;
  /** The step has an animation plan (it was reached by playing forward one step), as opposed to a jump or a rewind. */
  planned: boolean;
  /** The intro is running now. */
  active: boolean;
}

/** What a new view does to the intro. */
export function introAction(e: IntroEvent): IntroAction {
  if (e.reducedMotion) return e.active ? 'skip' : 'keep';
  if (e.first) return e.step === 0 ? 'start' : 'keep';
  if (!e.active) return 'keep';
  // A running intro survives the viewer pressing play (the next step arrives with a plan); a scrub or a viewer change ends it.
  if (e.timelineChanged || (e.stepChanged && !e.planned)) return 'skip';
  return 'keep';
}

export class Intro {
  private elapsed = INTRO_SECONDS;

  start(): void { this.elapsed = 0; }

  skip(): void { this.elapsed = INTRO_SECONDS; }

  /** Advances the intro's own clock. Does nothing once it is over. */
  update(dtSec: number): void {
    if (this.elapsed >= INTRO_SECONDS) return;
    this.elapsed = Math.min(INTRO_SECONDS, this.elapsed + (Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0));
  }

  get active(): boolean { return this.elapsed < INTRO_SECONDS; }

  /** 0 at the start, 1 when over (or never started). */
  get progress(): number { return this.elapsed / INTRO_SECONDS; }

  framing(): Framing { return introFraming(this.progress); }
}
