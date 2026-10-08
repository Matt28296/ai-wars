// The attack camera (G10): during an attack the camera eases a little toward the midpoint of attacker and defender (about 25% closer),
// tilts slightly lower, and returns as the attack ends. Like the match intro it is a LAYER over the rig: it changes the distance, the
// pitch and the target the rig's pose is taken at, and when it is over the pose is exactly the resting one.
//
// Pure maths (no three.js, no DOM), so every rule is tested against known answers:
//   attackWindow / attackStrength   WHEN: the span of the attack in plan time, and how strongly the layer applies at a moment (0..1);
//   attackPose                      WHERE: the camera's pose at a strength, kept off any cut-off: the strength is lowered, as far as
//                                   zero, until the attacker and the defender both stay inside the picture;
// Whether the layer runs at all is the stage's rule: never under reduced motion, never at 4x (no glides), never during the intro, and
// never once the viewer has taken the camera (zoom or drag), the same rule as the intro.
import { TILE } from '../contract';
import { FOV_DEG, PITCH_DEG, poseFor } from './rig';
import type { Board, CameraPose, Vec2 } from './rig';

export const ATTACK = {
  /** At full strength the camera stands this much nearer (a quarter of its distance). */
  closer: 0.25,
  /** ...and looks this many degrees lower (the pitch is smaller: 55 becomes 49). */
  tiltDeg: 6,
  /** The target moves this much of the way from where the rig has it to the midpoint of the fight (a little, not all the way). */
  pull: 0.6,
  /** The camera starts easing in this long before the first strike, if there is that much time before it (the glide into position). */
  leadMs: 200,
  /** ...and finishes its return this long after the last strike, if the plan runs on that long (an explosion follows a kill). */
  tailMs: 240,
  /** The longest ease in and ease out (a short attack eases for less: at most 40% of its span each way). */
  rampMs: 240,
  /** Both units must stay this far inside the picture (1 is its edge): 0.92 leaves a margin of 8% of the half-picture. */
  margin: 0.92,
} as const;

export interface Span { startMs: number; endMs: number }

/**
 * The span the camera layer covers: from `leadMs` before the first strike to `tailMs` after the last, kept inside the plan. `beats` are
 * the strikes' hit beats (the ones the stage could pair with a shooter, so an attacker is known). Null when there are none.
 */
export function attackWindow(beats: readonly { startMs: number; durMs: number }[], planMs: number): Span | null {
  if (!beats.length) return null;
  let first = Infinity;
  let last = -Infinity;
  for (const b of beats) {
    first = Math.min(first, b.startMs);
    last = Math.max(last, b.startMs + b.durMs);
  }
  if (!(last > first)) return null;
  const startMs = Math.max(0, first - ATTACK.leadMs);
  const endMs = Math.min(Math.max(last, planMs), last + ATTACK.tailMs);
  return endMs > startMs ? { startMs, endMs } : null;
}

const ease = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** How strongly the layer applies at plan time `t`: eases from 0 to 1, holds, and eases back to 0. Exactly 0 outside the window. */
export function attackStrength(win: Span, t: number): number {
  const span = win.endMs - win.startMs;
  if (!(span > 0) || !(t > win.startMs) || !(t < win.endMs)) return 0;
  const ramp = Math.min(ATTACK.rampMs, span * 0.4);
  return Math.min(ease((t - win.startMs) / ramp), ease((win.endMs - t) / ramp));
}

// ---------------------------------------------------------------- the pose

export interface P3 { x: number; y: number; z: number }

/** A point in the picture: x and y run -1..1 from the left and the bottom to the right and the top, depth is along the view. */
export function toScreen(pose: CameraPose, pitchDeg: number, aspect: number, p: P3): { x: number; y: number; depth: number } {
  const pitch = (pitchDeg * Math.PI) / 180;
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const rx = p.x - pose.position.x;
  const ry = p.y - pose.position.y;
  const rz = p.z - pose.position.z;
  // yaw 0: the camera looks along (0, -sin, -cos), its right is +X and its up is (0, cos, -sin)
  const depth = -ry * sin - rz * cos;
  const tan = Math.tan((FOV_DEG * Math.PI) / 360);
  return { x: rx / (depth * tan * Math.max(0.2, aspect)), y: (ry * cos - rz * sin) / (depth * tan), depth };
}

export interface AttackPoseInput {
  board: Board;
  aspect: number;
  /** The rig's own eased zoom and target now: the pose the layer starts from. */
  zoom: number;
  target: Vec2;
  /** Where the layer pulls the target (world, x and z): the midpoint of attacker and defender. */
  mid: Vec2;
  /** The attacker and the defender, in world space: neither may be cut off. A few points each (feet and head). */
  keep: readonly P3[];
  /** How strongly the layer wants to apply, 0..1 (attackStrength). */
  strength: number;
  /** The distance the rig itself stands at for this zoom. */
  restDistance: number;
}

export interface AttackPose { pose: CameraPose; pitchDeg: number; strength: number }

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function poseAt(i: AttackPoseInput, s: number): { pose: CameraPose; pitchDeg: number } {
  const closer = 1 - ATTACK.closer * s;
  const pitchDeg = PITCH_DEG - ATTACK.tiltDeg * s;
  // The target stays over the board but is not held to the rig's own clamp, which keeps the whole picture on the map: for the half
  // second of a fight the picture may run past the board's edge onto the table (the table reaches far beyond any picture).
  const k = ATTACK.pull * s;
  const target = {
    x: Math.max(0, Math.min(i.board.width * TILE, lerp(i.target.x, i.mid.x, k))),
    z: Math.max(0, Math.min(i.board.height * TILE, lerp(i.target.z, i.mid.z, k))),
  };
  return { pose: poseFor({ x: target.x, y: 0, z: target.z }, i.restDistance * closer, i.board, FOV_DEG, pitchDeg), pitchDeg };
}

/** True when every point in `keep` is inside the picture (with the margin) at strength `s`. */
function fits(i: AttackPoseInput, s: number): boolean {
  const { pose, pitchDeg } = poseAt(i, s);
  for (const p of i.keep) {
    const q = toScreen(pose, pitchDeg, i.aspect, p);
    if (!(q.depth > 0) || Math.abs(q.x) > ATTACK.margin || Math.abs(q.y) > ATTACK.margin) return false;
  }
  return true;
}

/**
 * The camera pose with the attack layer at (up to) `strength`. The strength is lowered, continuously, to the most that keeps every point
 * of `keep` inside the picture: at the widest zoom on a narrow phone, a push-in that would cut a unit off gives less, down to nothing
 * (strength 0 is exactly the resting pose). If the points are already cut off at rest, nothing changes either.
 */
export function attackPose(i: AttackPoseInput): AttackPose {
  const want = Math.max(0, Math.min(1, i.strength));
  let s = 0;
  if (want > 0 && fits(i, 0)) {
    // the most the points allow, found once for the whole range, so the strength given never jumps as `want` changes
    let limit = 1;
    if (!fits(i, 1)) {
      let lo = 0;
      let hi = 1;
      for (let n = 0; n < 16; n++) {
        const mid = (lo + hi) / 2;
        if (fits(i, mid)) lo = mid;
        else hi = mid;
      }
      limit = lo;
    }
    s = Math.min(want, limit);
  }
  const at = poseAt(i, s);
  return { pose: at.pose, pitchDeg: at.pitchDeg, strength: s };
}
