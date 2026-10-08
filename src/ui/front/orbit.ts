// The preview camera as pure maths (no three.js, no DOM), so the framing can be tested against known answers.
//
// The title and the briefing both show a board from a low angle and let the camera drift: the title circles it slowly, the briefing only
// sways, so the dimmed map stays behind the dialogue. Both are described by an OrbitSpec; `orbitPose` turns a spec, a board, the picture's
// aspect and the time into a camera. Reduced motion is the spec at time 0: nothing moves.

export interface OrbitSpec {
  /** Degrees above the horizon. */
  pitchDeg: number;
  /** Vertical field of view. */
  fovDeg: number;
  /** The yaw at time 0, in degrees. 0 looks north from the south side, as the battle stage does. */
  yawDeg: number;
  /** Radians per second the yaw advances (a full circle), or 0. */
  spin: number;
  /** Degrees the yaw swings either way, and its period in seconds; 0 = none. Used when spin is 0. */
  swayDeg: number;
  swayPeriod: number;
  /** 1 fits the board's bounding circle in the picture; less is closer, so the edges of the board leave the frame. */
  fill: number;
  /** The same on a tall, narrow picture, where a board that fits the width would be a thin band. */
  fillNarrow: number;
  /** Where the board's centre sits in the picture, as a fraction of its width and height from the middle (+x right, +y down). */
  shift: { x: number; y: number };
  /** The same on a tall, narrow picture (aspect below NARROW_ASPECT), where the words sit under the board, not beside it. */
  shiftNarrow: { x: number; y: number };
}

/** Pictures narrower than this (width over height) use `shiftNarrow`. */
export const NARROW_ASPECT = 0.9;

export const shiftFor = (spec: OrbitSpec, aspect: number): { x: number; y: number } => (aspect < NARROW_ASPECT ? spec.shiftNarrow : spec.shift);

export const TITLE_ORBIT: OrbitSpec = {
  pitchDeg: 27, fovDeg: 34, yawDeg: -28, spin: 0.045, swayDeg: 0, swayPeriod: 0, fill: 0.7, fillNarrow: 0.66, shift: { x: 0.23, y: -0.03 }, shiftNarrow: { x: 0, y: -0.3 },
};
export const BRIEFING_ORBIT: OrbitSpec = {
  pitchDeg: 38, fovDeg: 32, yawDeg: 0, spin: 0, swayDeg: 9, swayPeriod: 70, fill: 0.78, fillNarrow: 0.46, shift: { x: 0, y: -0.1 }, shiftNarrow: { x: 0, y: -0.08 },
};

export interface Board { width: number; height: number }

export interface OrbitPose {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  near: number;
  far: number;
  distance: number;
  yawRad: number;
}

const RAD = Math.PI / 180;

/** Distance at which the board's bounding circle (radius `radius`) fits a picture of this aspect, times `fill`. */
export function orbitDistance(radius: number, aspect: number, fovDeg: number, fill: number): number {
  const half = (fovDeg * RAD) / 2;
  const halfH = Math.atan(Math.tan(half) * Math.max(0.2, aspect));
  return (radius / Math.sin(Math.min(half, halfH))) * fill;
}

/** The yaw in radians at `timeSec`. */
export function yawAt(spec: OrbitSpec, timeSec: number): number {
  const base = spec.yawDeg * RAD;
  if (spec.spin !== 0) return base + spec.spin * timeSec;
  if (spec.swayDeg === 0 || spec.swayPeriod <= 0) return base;
  return base + spec.swayDeg * RAD * Math.sin((timeSec / spec.swayPeriod) * Math.PI * 2);
}

export function orbitPose(spec: OrbitSpec, board: Board, aspect: number, timeSec: number): OrbitPose {
  const cx = board.width / 2;
  const cz = board.height / 2;
  const radius = Math.hypot(board.width, board.height) / 2 + 0.6;
  const distance = orbitDistance(radius, aspect, spec.fovDeg, aspect < NARROW_ASPECT ? spec.fillNarrow : spec.fill);
  const pitch = spec.pitchDeg * RAD;
  const yaw = yawAt(spec, timeSec);
  const ground = distance * Math.cos(pitch);
  return {
    // yaw 0 puts the camera south of the board looking north; a positive yaw swings it toward the east.
    position: { x: cx + Math.sin(yaw) * ground, y: distance * Math.sin(pitch) + 0.3, z: cz + Math.cos(yaw) * ground },
    target: { x: cx, y: 0.3, z: cz },
    near: Math.max(0.1, distance - radius * 1.5),
    far: distance + radius * 3 + 20,
    distance,
    yawRad: yaw,
  };
}
