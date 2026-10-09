// Animation timing for the viewer, in one table so it can be tuned in one place (docs/research/quality-bar.md, "every timing in one
// timings.ts"). All figures are for 1x; speed divides them. At 4x unit tweens are skipped outright (a viewer at 4x wants the result,
// not the glide), while flashes, explosions and the power cut-in stay readable by shrinking with the speed.

export type Speed = 1 | 2 | 4;
export const SPEEDS: readonly Speed[] = [1, 2, 4];
export const DEFAULT_SPEED: Speed = 1;

export const TIMINGS = {
  /**
   * A unit glides one tile in this long at 1x: 240 ms, 120 at 2x. A steady, deliberate march the player can follow, the pace of the classic tactics
   * games, where the old ~140 ms read as a dash and quality-bar 5.1's ~80 ms was a blink: a four-tile move takes just under a second. The glide is
   * steady (glideEase): one speed from tile to tile with a short settle at the end, and its total time is tiles x this. At 4x and under reduced
   * motion there is no glide at all.
   */
  moveTileMs: 240,
  /** Hit flash on the unit that was struck (quality-bar 6.3 impact beat is ~400 ms). */
  hitMs: 380,
  /** The floating damage number rises and fades over this long. */
  numberMs: 900,
  /** Destruction (quality-bar 6.7: ~500 ms explosion). */
  explosionMs: 520,
  /** How long the next beat waits for an explosion to get going. */
  explosionLeadMs: 300,
  /** The "!" over an ambushed unit (quality-bar 5.7: 150 ms bounce + 500 ms hold). */
  ambushMs: 650,
  ambushLeadMs: 450,
  /** A property changing hands, and build-in. */
  pulseMs: 500,
  pulseLeadMs: 220,
  spawnMs: 360,
  spawnLeadMs: 280,
  /** Power cut-in: at most 2.2 s from the first frame of the band to the last (quality-bar 7.1). */
  cutInMs: 2200,
  /** Turn banner: slide in, hold, slide out, about 1.1 s (quality-bar 8.1). */
  bannerMs: 1100,
  /** A power's area effect pulse. */
  powerEffectMs: 600,
  powerEffectLeadMs: 450,
  /** Pause after each action while playing (quality-bar 12.2: ~200 ms normal, ~60 ms fast). */
  stepPauseMs: 200,
  /** A step with nothing to show still takes this long, so the log and scrubber keep a pulse. */
  emptyStepMs: 60,
} as const;

/** `ms` at the given speed, rounded to a whole millisecond (never negative). */
export function scaled(ms: number, speed: Speed): number {
  return Math.max(0, Math.round(ms / speed));
}

/** Whether units glide between tiles at all: not at 4x, and not for a viewer who asked for reduced motion. */
export function tweenEnabled(speed: Speed, reducedMotion: boolean): boolean {
  return speed < 4 && !reducedMotion;
}

/** Milliseconds a unit takes per tile at this speed; 0 means the glide is skipped. */
export function moveTileMs(speed: Speed, reducedMotion = false): number {
  return tweenEnabled(speed, reducedMotion) ? scaled(TIMINGS.moveTileMs, speed) : 0;
}

export function cutInMs(speed: Speed): number {
  return scaled(TIMINGS.cutInMs, speed);
}

export function bannerMs(speed: Speed): number {
  return scaled(TIMINGS.bannerMs, speed);
}

/** How long playback waits after a step's animation before it moves on. */
export function dwellMs(speed: Speed, animatedMs: number): number {
  return animatedMs > 0 ? scaled(TIMINGS.stepPauseMs, speed) : scaled(TIMINGS.emptyStepMs, speed);
}

export function isSpeed(n: unknown): n is Speed {
  return n === 1 || n === 2 || n === 4;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Where a sliding band is, for progress p in 0..1: -1 is fully off to the left, 0 is on screen, +1 fully off to the right.
 * It eases out on the way in (never bounces), holds, then eases in on the way out.
 */
export function slideInOut(p: number, inFrac: number, outFrac: number): number {
  const q = clamp01(p);
  if (q < inFrac) {
    const k = q / inFrac;
    return -(1 - k) * (1 - k); // ease out: fast at first, settling at 0
  }
  if (q > 1 - outFrac) {
    const k = (q - (1 - outFrac)) / outFrac;
    return k * k; // ease in on the way out
  }
  return 0;
}

/** The part of `text` that has been "typed" by `elapsedMs`, when typing starts at `startMs` and takes `durMs`. */
export function typedText(text: string, elapsedMs: number, startMs: number, durMs: number): string {
  if (durMs <= 0) return text;
  const k = clamp01((elapsedMs - startMs) / durMs);
  return text.slice(0, Math.floor(text.length * k));
}

/**
 * The share of a glide's time that is its settle: before it the unit moves at one steady speed, tile after tile, and in the last tenth it eases out to
 * a stop on the destination. glideEase takes only the progress through the glide's time, so it cannot know how long the path is: a tenth of the time is
 * the last 5.3% of the path: a quarter of a tile on a path of four and three quarter tiles (a typical move), a little less on a longer path and a little
 * more on a shorter one.
 */
export const GLIDE_SETTLE = 0.1;
/**
 * The steady speed of a glide, in whole paths per whole glide time: a little over 1, because the settle covers its share of the path at a falling speed
 * and the steady part makes up for it so that the unit arrives exactly when the glide's time is up (total time = tiles x moveTileMs).
 */
export const GLIDE_CRUISE = 1 / (1 - GLIDE_SETTLE / 2);

/**
 * How far along its whole path a gliding unit is (0..1) after progress `p` (0..1) through the glide's time: a constant speed from the first moment
 * (no ease-in, no acceleration, no peak) and an ease out over the last GLIDE_SETTLE of the time, which meets the steady speed without a jump and ends
 * at rest exactly on 1. Per path, not per tile: the speed is the same on every tile.
 */
export function glideEase(p: number): number {
  const q = clamp01(p);
  if (q <= 1 - GLIDE_SETTLE) return GLIDE_CRUISE * q;
  const left = (1 - q) / GLIDE_SETTLE; // 1 at the start of the settle, 0 at the end
  return 1 - (GLIDE_CRUISE * GLIDE_SETTLE * left * left) / 2;
}
