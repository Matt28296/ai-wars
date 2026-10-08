// The camera rig of the 3D stage, as pure maths (no three.js, no DOM), so the framing can be tested against known answers.
//
// art-direction.md "Camera": perspective, FOV about 30 degrees, pitch about 55 degrees down from horizontal, yaw 0 (map rows stay
// horizontal), the whole map fits at the widest zoom, three zoom steps, and the camera EASES toward the transition plan's focus
// (it never snaps, except when the viewer scrubs). Reduced motion: no shake and no easing at all.
//
// The camera is camera only: nothing here selects or commands a unit (D-004, D-007).
import { TILE } from '../contract';

export const FOV_DEG = 30;
export const PITCH_DEG = 55;
/** The three zoom steps, widest first. Step 0 fits the whole map. */
export const ZOOM_STEPS: readonly number[] = [1, 1.75, 3];
export const MAX_ZOOM_LEVEL = ZOOM_STEPS.length - 1;
/** Slack round the board at the widest zoom, in tiles. */
export const FIT_MARGIN = 0.7;
/** The tallest thing on the board (a spire), so towers never leave the top of the picture at the widest zoom. */
export const FIT_HEIGHT = 1.5;
/** Exponential easing rate of the camera target and the zoom, per second. Critically damped: it never overshoots. */
export const EASE_RATE = 5;
/** Canvases narrower than this (CSS px) start one zoom step in. */
export const NARROW_CANVAS_PX = 520;

const RAD = Math.PI / 180;

export interface Vec2 { x: number; z: number }
export interface Board { width: number; height: number }

export interface CameraPose {
  /** World position of the camera. */
  position: { x: number; y: number; z: number };
  /** World point it looks at. */
  target: { x: number; y: number; z: number };
  fovDeg: number;
  near: number;
  far: number;
  /** Distance from the camera to its target. */
  distance: number;
}

/** The world-space corners (8) of the box that must fit at the widest zoom: the board plus its margin, from the water line to the tallest tower. */
export function fitCorners(board: Board, margin = FIT_MARGIN, top = FIT_HEIGHT): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const x of [-margin, board.width * TILE + margin]) {
    for (const y of [-0.3, top]) {
      for (const z of [-margin, board.height * TILE + margin]) out.push({ x, y, z });
    }
  }
  return out;
}

/**
 * The distance at which the whole board fits the picture when the camera looks at the board's centre. Closed form: with the camera
 * `d` away along (0, sin p, cos p), a point at offset (dx, dy, dz) from the target has depth d - dy sin p - dz cos p, screen-x dx and
 * screen-y dy cos p - dz sin p, and it is inside the picture while |x| <= depth tan(fov/2) aspect and |y| <= depth tan(fov/2).
 */
export function fitDistance(board: Board, aspect: number, fovDeg = FOV_DEG, pitchDeg = PITCH_DEG): number {
  const tanH = Math.tan((fovDeg * RAD) / 2);
  const sin = Math.sin(pitchDeg * RAD);
  const cos = Math.cos(pitchDeg * RAD);
  const cx = (board.width * TILE) / 2;
  const cz = (board.height * TILE) / 2;
  let d = 0;
  for (const c of fitCorners(board)) {
    const dx = c.x - cx;
    const dy = c.y;
    const dz = c.z - cz;
    const lift = dy * sin + dz * cos; // how much nearer to the camera than the target this corner is
    const sx = Math.abs(dx) / (tanH * Math.max(0.2, aspect));
    const sy = Math.abs(dy * cos - dz * sin) / tanH;
    d = Math.max(d, Math.max(sx, sy) + lift);
  }
  return d;
}

/** The camera pose for a target and a distance. Yaw 0: the camera sits south (+Z) of the target and looks north. */
export function poseFor(target: { x: number; y: number; z: number }, distance: number, board: Board, fovDeg = FOV_DEG, pitchDeg = PITCH_DEG): CameraPose {
  const sin = Math.sin(pitchDeg * RAD);
  const cos = Math.cos(pitchDeg * RAD);
  const reach = Math.hypot(board.width, board.height) * TILE + FIT_HEIGHT;
  return {
    position: { x: target.x, y: target.y + distance * sin, z: target.z + distance * cos },
    target: { ...target },
    fovDeg,
    near: Math.max(0.1, distance - reach),
    far: distance + reach * 1.5 + 10,
    distance,
  };
}

export interface Footprint {
  /** Ground distance from the target to the top edge of the picture, along Z (negative: north of the target). */
  top: number;
  /** Ground distance from the target to the bottom edge of the picture (positive: south). */
  bottom: number;
  /** Half the ground width of the picture at its far (top) edge, the widest. */
  halfFar: number;
  /** Half the ground width at its near (bottom) edge. */
  halfNear: number;
}

/**
 * Where the picture's edges land on the ground (y = 0) when the camera looks at a ground target from `distance`. The footprint is the
 * same shape wherever the target is, because the camera is the target plus a fixed offset. The far half of the picture covers more
 * ground than the near half (perspective), which is why a flat "half the board / zoom" limit would show the void beyond the far edge.
 */
export function groundFootprint(distance: number, aspect: number, fovDeg = FOV_DEG, pitchDeg = PITCH_DEG): Footprint {
  const tanH = Math.tan((fovDeg * RAD) / 2);
  const sin = Math.sin(pitchDeg * RAD);
  const cos = Math.cos(pitchDeg * RAD);
  const height = distance * sin; // the camera's height above the ground
  const behind = distance * cos; // and how far south of the target it is
  // A ray through the top edge of the picture is (0, -sin + tanH cos, -cos - tanH sin) per unit of forward depth; through the bottom edge
  // (0, -sin - tanH cos, -cos + tanH sin). It reaches the ground after height / -dir.y units.
  const tTop = height / (sin - tanH * cos);
  const tBottom = height / (sin + tanH * cos);
  return {
    top: behind + tTop * (-cos - tanH * sin),
    bottom: behind + tBottom * (-cos + tanH * sin),
    halfFar: tTop * tanH * Math.max(0.2, aspect),
    halfNear: tBottom * tanH * Math.max(0.2, aspect),
  };
}

/**
 * The target stays where the picture stays on the board: the whole picture's ground footprint inside the board's rectangle. On an axis
 * where the picture is wider than the board (the widest zoom, always) the target is the board's centre exactly.
 */
export function clampTarget(t: Vec2, board: Board, zoom: number, aspect: number): Vec2 {
  const z = Math.max(1, zoom);
  const w = board.width * TILE;
  const h = board.height * TILE;
  const f = groundFootprint(fitDistance(board, aspect) / z, aspect);
  const axis = (v: number, lo: number, hi: number, centre: number): number =>
    lo > hi ? centre : Math.max(lo, Math.min(hi, v));
  return {
    x: axis(t.x, f.halfFar, w - f.halfFar, w / 2),
    // the picture spans [target + top, target + bottom] along Z, so the target is limited to [-top, h - bottom]
    z: axis(t.z, -f.top, h - f.bottom, h / 2),
  };
}

/**
 * The zoom step a canvas of this width starts on. On a phone-sized canvas the whole map is too small to read a unit on, so it starts one
 * step closer and follows the action; the viewer can still zoom out to the whole map. Wider canvases start on the whole map.
 */
export function defaultZoomLevel(canvasWidthPx: number): number {
  return canvasWidthPx < NARROW_CANVAS_PX ? 1 : 0;
}

/** One step of the zoom ladder: +1 closer, -1 wider. Clamped to the ladder. */
export function stepZoom(level: number, dir: 1 | -1): number {
  return Math.max(0, Math.min(MAX_ZOOM_LEVEL, Math.trunc(level) + dir));
}

/**
 * Accumulates mouse-wheel or trackpad movement into zoom steps: one step per `threshold` pixels of movement, at most one per call,
 * so a trackpad's inertia does not run the whole ladder at once. Returns the new accumulator and the step taken (0 for none).
 */
export function wheelToSteps(acc: number, deltaY: number, deltaMode: number, threshold = 60): { acc: number; dir: 1 | -1 | 0 } {
  const px = deltaMode === 1 ? deltaY * 24 : deltaMode === 2 ? deltaY * 400 : deltaY; // lines and pages to pixels
  const sum = acc + px;
  if (sum <= -threshold) return { acc: 0, dir: 1 }; // wheel up zooms in
  if (sum >= threshold) return { acc: 0, dir: -1 };
  return { acc: sum, dir: 0 };
}

/** World units per screen pixel at the target for this distance (vertical, across the screen). */
export function worldPerPixel(distance: number, viewportHeight: number, fovDeg = FOV_DEG): number {
  return (2 * distance * Math.tan((fovDeg * RAD) / 2)) / Math.max(1, viewportHeight);
}

/** How far the target moves (world) when the viewer drags the picture by (dxPx, dyPx): the board follows the pointer. */
export function panDelta(dxPx: number, dyPx: number, distance: number, viewportHeight: number, pitchDeg = PITCH_DEG): Vec2 {
  const k = worldPerPixel(distance, viewportHeight);
  return { x: -dxPx * k, z: (-dyPx * k) / Math.sin(pitchDeg * RAD) };
}

/** One step of exponential easing: never overshoots, and `rate <= 0` or `snap` lands on the goal at once. */
export function easeToward(current: number, goal: number, dtSec: number, rate = EASE_RATE, snap = false): number {
  if (snap || rate <= 0) return goal;
  const k = 1 - Math.exp(-rate * Math.max(0, dtSec));
  const next = current + (goal - current) * k;
  return Math.abs(goal - next) < 1e-4 ? goal : next;
}

/** The size the canvas asks for, as width / height, so a wide map gets a wide stage and a square one a squarer stage. */
export function stageAspect(board: Board): number {
  const a = (board.width + 1.5) / (board.height * Math.sin(PITCH_DEG * RAD) + 2.5);
  return Math.max(1.05, Math.min(2.2, a));
}

/**
 * The stateful rig. It owns the zoom level, the eased zoom and the eased target; the runtime applies `pose()` to the three.js camera
 * every frame and feeds it pointer, wheel and key input. Every method is camera-only.
 */
export class CameraRig {
  private board: Board = { width: 1, height: 1 };
  private aspect = 1.6;
  private lvl = 0;
  private zoomNow = 1;
  private cur: Vec2 = { x: 0.5, z: 0.5 };
  private goal: Vec2 = { x: 0.5, z: 0.5 };
  private focusGoal: Vec2 | null = null;
  private snapNext = true;
  /** The viewer dragged the picture on this step: the focus does not pull it back until the next step. */
  manual = false;

  get level(): number { return this.lvl; }
  get zoom(): number { return this.zoomNow; }
  get target(): Vec2 { return { ...this.cur }; }
  get goalTarget(): Vec2 { return { ...this.goal }; }

  setBoard(board: Board): void {
    if (board.width === this.board.width && board.height === this.board.height) return;
    this.board = { width: board.width, height: board.height };
    this.focusGoal = null;
    this.lvl = Math.min(this.lvl, MAX_ZOOM_LEVEL);
    this.recentre();
    this.snapNext = true;
  }

  setAspect(aspect: number): void {
    if (Number.isFinite(aspect) && aspect > 0) this.aspect = aspect;
  }

  private centre(): Vec2 { return { x: (this.board.width * TILE) / 2, z: (this.board.height * TILE) / 2 }; }

  private recentre(): void {
    this.goal = this.centre();
    this.cur = { ...this.goal };
  }

  /** Jumps to a zoom step. */
  setLevel(level: number, snap = false): void {
    this.lvl = Math.max(0, Math.min(MAX_ZOOM_LEVEL, Math.trunc(level)));
    this.refreshGoal();
    if (snap) this.snapNext = true;
  }

  zoomStep(dir: 1 | -1): void {
    this.setLevel(stepZoom(this.lvl, dir));
  }

  /**
   * A new step has arrived. `focus` is the tile the step centres on (focusOf), or null when the viewer saw nothing. `snap` is true when
   * the viewer scrubbed or jumped (no animation plan), in which case the camera lands on the focus at once.
   */
  focusOn(focusTile: { x: number; y: number } | null | undefined, snap: boolean): void {
    this.manual = false;
    this.focusGoal = focusTile ? { x: (focusTile.x + 0.5) * TILE, z: (focusTile.y + 0.5) * TILE } : null;
    this.refreshGoal();
    if (snap) this.snapNext = true;
  }

  private refreshGoal(): void {
    const want = this.lvl === 0 ? this.centre() : this.focusGoal ?? this.goal;
    this.goal = clampTarget(want, this.board, ZOOM_STEPS[this.lvl], this.aspect);
  }

  /** The viewer drags the picture. Does nothing at the widest zoom, where the whole map is in view. */
  pan(dxPx: number, dyPx: number, viewportHeight: number): void {
    if (this.lvl === 0) return;
    const fit = fitDistance(this.board, this.aspect);
    const delta = panDelta(dxPx, dyPx, fit / this.zoomNow, viewportHeight);
    this.manual = true;
    this.goal = clampTarget({ x: this.goal.x + delta.x, z: this.goal.z + delta.z }, this.board, ZOOM_STEPS[this.lvl], this.aspect);
    this.cur = { ...this.goal }; // a drag follows the pointer exactly
  }

  /** Advances the easing by `dtSec`. `smooth` false (reduced motion) lands on the goal at once. */
  update(dtSec: number, smooth: boolean): void {
    const snap = this.snapNext || !smooth;
    this.snapNext = false;
    this.zoomNow = easeToward(this.zoomNow, ZOOM_STEPS[this.lvl], dtSec, EASE_RATE, snap);
    this.cur = {
      x: easeToward(this.cur.x, this.goal.x, dtSec, EASE_RATE, snap),
      z: easeToward(this.cur.z, this.goal.z, dtSec, EASE_RATE, snap),
    };
    // While the zoom eases the allowed range moves; keep the target inside it.
    this.cur = clampTarget(this.cur, this.board, this.zoomNow, this.aspect);
  }

  pose(groundY = 0): CameraPose {
    const fit = fitDistance(this.board, this.aspect);
    return poseFor({ x: this.cur.x, y: groundY, z: this.cur.z }, fit / this.zoomNow, this.board);
  }
}
