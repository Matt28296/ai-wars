// The impact shake (G10): when a unit is destroyed the camera gives a short, decaying shake (about 0.25 s). It is small, it dies away to
// EXACTLY zero, and it is deterministic: the same beat (its seed) at the same moment always shakes the same way, so scrubbing and
// replays show it exactly. Pure maths (no three.js, no clock); the stage turns the offset into a camera move.
//
// Where it applies, and where it does not, is the stage's rule and not this file's: never under reduced motion, and a hit gives none
// (art-direction.md: "reduced motion: no shake"). An ambush keeps its own short, gentler shake.
import { Rng } from '../fx/rng';

/** How long a shake lasts at 1x speed (milliseconds of plan time). At faster speeds it shortens with the beat that drives it. */
export const SHAKE_MS = 250;
/** The peak size of a shake at its start, as a fraction of the camera's distance: about five pixels on a 600 px tall picture, at any zoom. */
export const SHAKE_AMPLITUDE = 0.0055;
/** How hard each beat shakes, 0..1 of the peak. */
export const SHAKE_WEIGHT = { explosion: 1, ambush: 0.5 } as const;

/** One shake that is running: which beat (its seed), how far through it (0..1) and how strong. */
export interface ShakeSpec { seed: number; u: number; weight: number }

/** The strength left at `u` (0..1 through the shake): 1 at the start, falling smoothly, and exactly 0 from u = 1 on (and for a bad u). */
export function shakeEnvelope(u: number): number {
  if (!(u >= 0 && u < 1)) return 0;
  const k = 1 - u;
  return k * k;
}

export interface ShakeOffset { x: number; y: number }

const rng = new Rng();

/**
 * The camera's offset for this shake, as fractions of the peak amplitude: x across the picture, y up it. Two seeded oscillations (about
 * 16 to 26 hertz, so a quarter second holds four to six swings) under the decaying envelope. Exactly (0, 0) once the shake is over.
 */
export function shakeOffset(seed: number, u: number, weight: number, out: ShakeOffset): ShakeOffset {
  const env = shakeEnvelope(u) * Math.max(0, Math.min(1, weight));
  if (env <= 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  rng.reset(seed);
  const f1 = 16 + 10 * rng.next();
  const f2 = 16 + 10 * rng.next();
  const p1 = rng.next() * Math.PI * 2;
  const p2 = rng.next() * Math.PI * 2;
  const t = u * (SHAKE_MS / 1000);
  out.x = env * Math.sin(Math.PI * 2 * f1 * t + p1);
  out.y = env * 0.7 * Math.sin(Math.PI * 2 * f2 * t + p2);
  return out;
}
