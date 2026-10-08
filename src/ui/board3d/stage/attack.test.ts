// The attack camera, as pure maths: when it applies (the window and the easing), where the camera goes (about 25% closer and a little
// lower, toward the midpoint of the fight) and the guard that keeps both units in the picture. The expected numbers are worked out here
// from the order and from the rig's own geometry, not read back from attack.ts.
import { describe, expect, it } from 'vitest';
import { ATTACK, attackPose, attackStrength, attackWindow, toScreen } from './attack';
import type { AttackPoseInput, P3 } from './attack';
import { FOV_DEG, PITCH_DEG, clampTarget, fitDistance, poseFor } from './rig';

describe('the window: from just before the first strike to just after the last, kept inside the plan', () => {
  it('a strike at 420..800 in a plan 1380 long: eases in from 200 ms before and out until 240 ms after', () => {
    expect(attackWindow([{ startMs: 420, durMs: 380 }], 1380)).toEqual({ startMs: 220, endMs: 1040 });
  });
  it('an attack that opens the step has no lead (there is no time before it) and a plan that ends with it has no tail', () => {
    expect(attackWindow([{ startMs: 0, durMs: 380 }], 380)).toEqual({ startMs: 0, endMs: 380 });
    expect(attackWindow([{ startMs: 100, durMs: 380 }], 480)).toEqual({ startMs: 0, endMs: 480 });
  });
  it('a strike and its counter make one window', () => {
    expect(attackWindow([{ startMs: 420, durMs: 380 }, { startMs: 800, durMs: 380 }], 5000)).toEqual({ startMs: 220, endMs: 1180 + 240 });
  });
  it('is nothing when there is no strike to look at', () => {
    expect(attackWindow([], 1000)).toBeNull();
    expect(attackWindow([{ startMs: 5, durMs: 0 }], 1000)).toBeNull();
  });
});

describe('the easing: 0 outside, in, hold at 1, out, symmetric', () => {
  const win = { startMs: 220, endMs: 1040 };

  it('is exactly 0 at the start and the end and outside them: the camera is exactly the resting one then', () => {
    for (const t of [-100, 0, 220, 1040, 1041, 5000]) expect(attackStrength(win, t), `t=${t}`).toBe(0);
  });
  it('rises smoothly over 240 ms, holds at exactly 1, and falls over 240 ms', () => {
    let prev = 0;
    for (let t = 230; t <= 460; t += 10) {
      const s = attackStrength(win, t);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
    expect(attackStrength(win, 460)).toBe(1);
    for (const t of [461, 600, 799, 800]) expect(attackStrength(win, t), `t=${t}`).toBe(1);
    prev = 1;
    for (let t = 810; t <= 1030; t += 10) {
      const s = attackStrength(win, t);
      expect(s).toBeLessThan(prev);
      prev = s;
    }
  });
  it('the way out mirrors the way in', () => {
    for (const x of [5, 40, 100, 200]) expect(attackStrength(win, 220 + x)).toBeCloseTo(attackStrength(win, 1040 - x), 12);
  });
  it('a short attack eases for at most 40% of its length each way, so it can still reach 1', () => {
    const short = { startMs: 0, endMs: 100 };
    expect(attackStrength(short, 20)).toBeGreaterThan(0.2);
    expect(attackStrength(short, 40)).toBe(1);
    expect(attackStrength(short, 50)).toBe(1);
    expect(attackStrength(short, 60)).toBe(1);
    expect(attackStrength(short, 80)).toBeLessThan(0.6);
  });
  it('stays between 0 and 1', () => {
    for (let t = 0; t <= 1100; t += 7) {
      const s = attackStrength(win, t);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------- the pose

const unit = (x: number, z: number): P3[] => {
  // the points the stage keeps in view for a unit on tile (x, z): feet, head and the corners of its tile
  const cx = x + 0.5;
  const cz = z + 0.5;
  const pts: P3[] = [{ x: cx, y: 0.05, z: cz }, { x: cx, y: 0.65, z: cz }];
  for (const sx of [-0.45, 0.45]) for (const sz of [-0.45, 0.45]) pts.push({ x: cx + sx, y: 0.05, z: cz + sz });
  return pts;
};

function input(board: { width: number; height: number }, aspect: number, a: [number, number], b: [number, number], strength: number, zoom = 1): AttackPoseInput {
  const rest = fitDistance(board, aspect) / zoom;
  const centre = { x: board.width / 2, z: board.height / 2 };
  return {
    board, aspect, zoom, target: clampTarget(centre, board, zoom, aspect),
    mid: { x: (a[0] + b[0]) / 2 + 0.5, z: (a[1] + b[1]) / 2 + 0.5 },
    keep: [...unit(...a), ...unit(...b)], strength, restDistance: rest,
  };
}

describe('the pose with the layer on a laptop-shaped picture', () => {
  const board = { width: 14, height: 10 };
  const aspect = 1.6;
  const i = input(board, aspect, [9, 6], [10, 6], 1);

  it('strength 0 is exactly the resting pose (no layer, nothing changed)', () => {
    const r = attackPose({ ...i, strength: 0 });
    const rest = poseFor({ x: i.target.x, y: 0, z: i.target.z }, i.restDistance, board);
    expect(r.strength).toBe(0);
    expect(r.pitchDeg).toBe(PITCH_DEG);
    expect(r.pose).toEqual(rest);
  });

  it('at full strength the camera stands a quarter nearer and 6 degrees lower, looking toward the fight', () => {
    const r = attackPose(i);
    expect(r.strength).toBe(1);
    expect(r.pose.distance).toBeCloseTo(i.restDistance * 0.75, 9);
    expect(ATTACK.closer).toBe(0.25);
    expect(r.pitchDeg).toBe(PITCH_DEG - 6);
    // the pitch the camera is actually at: from its position and its target
    const flat = Math.hypot(r.pose.position.x - r.pose.target.x, r.pose.position.z - r.pose.target.z);
    expect((Math.atan2(r.pose.position.y - r.pose.target.y, flat) * 180) / Math.PI).toBeCloseTo(49, 9);
    // the target moved 60% of the way from the board's centre (7, 5) to the middle of the two units (10, 6.5): (8.8, 5.9)
    expect(ATTACK.pull).toBe(0.6);
    expect(r.pose.target.x).toBeCloseTo(7 + 0.6 * (10 - 7), 9);
    expect(r.pose.target.z).toBeCloseTo(5 + 0.6 * (6.5 - 5), 9);
    expect(r.pose.target.y).toBe(0);
  });

  it('the stage the fight is on is in the picture: both units inside the safe margin', () => {
    const r = attackPose(i);
    for (const p of i.keep) {
      const q = toScreen(r.pose, r.pitchDeg, aspect, p);
      expect(Math.abs(q.x)).toBeLessThanOrEqual(ATTACK.margin);
      expect(Math.abs(q.y)).toBeLessThanOrEqual(ATTACK.margin);
      expect(q.depth).toBeGreaterThan(0);
    }
  });

  it('a fight at the very edge of the board never pulls the camera off the board', () => {
    const edge = input(board, aspect, [0, 0], [1, 0], 1);
    const r = attackPose(edge);
    expect(r.pose.target.x).toBeGreaterThanOrEqual(0);
    expect(r.pose.target.z).toBeGreaterThanOrEqual(0);
    const far = input(board, aspect, [12, 9], [13, 9], 1);
    const q = attackPose(far);
    expect(q.pose.target.x).toBeLessThanOrEqual(board.width);
    expect(q.pose.target.z).toBeLessThanOrEqual(board.height);
  });

  it('the in-between is a blend: half strength is half the zoom (an eighth of the distance) and half the tilt', () => {
    const r = attackPose({ ...i, strength: 0.5 });
    expect(r.strength).toBe(0.5);
    expect(r.pose.distance).toBeCloseTo(i.restDistance * (1 - 0.125), 9);
    expect(r.pitchDeg).toBe(PITCH_DEG - 3);
  });
});

describe('the guard: nothing is cut off', () => {
  // A phone held upright at the widest zoom: the whole map is in the picture and very small, and a push-in would cut off a fight
  // whose units are far apart across the board.
  const board = { width: 22, height: 14 };
  const aspect = 390 / 844;
  const wide = input(board, aspect, [2, 6], [19, 6], 1);

  it('KNOWN-BAD: the unguarded push-in (a quarter nearer, aimed at the midpoint) would cut those units off at the widest zoom', () => {
    // worked out here from the order alone, with the rig's own geometry
    const closer = 0.75;
    const target = { x: wide.target.x + 0.6 * (wide.mid.x - wide.target.x), z: wide.target.z + 0.6 * (wide.mid.z - wide.target.z) };
    const pose = poseFor({ x: target.x, y: 0, z: target.z }, wide.restDistance * closer, board, FOV_DEG, PITCH_DEG - 6);
    const worst = Math.max(...wide.keep.map((p) => Math.abs(toScreen(pose, PITCH_DEG - 6, aspect, p).x)));
    expect(worst).toBeGreaterThan(ATTACK.margin);
    // and at rest the same units are in the picture, so nothing is lost by the guard
    const rest = poseFor({ x: wide.target.x, y: 0, z: wide.target.z }, wide.restDistance, board);
    for (const p of wide.keep) expect(Math.abs(toScreen(rest, PITCH_DEG, aspect, p).x)).toBeLessThanOrEqual(ATTACK.margin);
  });

  it('the guarded pose gives less (down to nothing) and keeps both units inside the picture', () => {
    const r = attackPose(wide);
    expect(r.strength).toBeLessThan(1);
    for (const p of wide.keep) {
      const q = toScreen(r.pose, r.pitchDeg, aspect, p);
      expect(Math.abs(q.x)).toBeLessThanOrEqual(ATTACK.margin + 1e-6);
      expect(Math.abs(q.y)).toBeLessThanOrEqual(ATTACK.margin + 1e-6);
    }
  });

  it('the strength it allows never falls when more is asked, and never exceeds what was asked: no jump as the layer eases in', () => {
    let prev = 0;
    for (let k = 0; k <= 20; k++) {
      const asked = k / 20;
      const got = attackPose({ ...wide, strength: asked }).strength;
      expect(got).toBeLessThanOrEqual(asked + 1e-12);
      expect(got).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = got;
    }
  });

  it('a fight that is close together on the same phone still gets the whole push-in', () => {
    const near = input(board, aspect, [10, 6], [11, 6], 1);
    const r = attackPose(near);
    for (const p of near.keep) {
      const q = toScreen(r.pose, r.pitchDeg, aspect, p);
      expect(Math.abs(q.x)).toBeLessThanOrEqual(ATTACK.margin + 1e-6);
    }
    expect(r.strength).toBeGreaterThan(attackPose(wide).strength);
  });

  it('units that are already cut off at rest change nothing: the resting pose, strength 0', () => {
    const off: AttackPoseInput = { ...wide, keep: [{ x: 500, y: 0, z: 500 }] };
    const r = attackPose(off);
    expect(r.strength).toBe(0);
    expect(r.pose).toEqual(poseFor({ x: off.target.x, y: 0, z: off.target.z }, off.restDistance, board));
  });
});

describe('the screen projection', () => {
  it('puts the camera\'s own target in the middle and a point east of it on the right, by the field of view', () => {
    const board = { width: 20, height: 12 };
    const pose = poseFor({ x: 10, y: 0, z: 6 }, 18, board);
    const mid = toScreen(pose, PITCH_DEG, 1.6, { x: 10, y: 0, z: 6 });
    expect(mid.x).toBeCloseTo(0, 12);
    expect(mid.y).toBeCloseTo(0, 12);
    expect(mid.depth).toBeCloseTo(18, 9);
    // a point 3 east of the target is on the same depth, so x = 3 / (18 tan(15 degrees) 1.6)
    const east = toScreen(pose, PITCH_DEG, 1.6, { x: 13, y: 0, z: 6 });
    expect(east.x).toBeCloseTo(3 / (18 * Math.tan((15 * Math.PI) / 180) * 1.6), 9);
    expect(east.y).toBeCloseTo(0, 12);
    // a point north of the target (farther from a camera that looks north) is up the picture and deeper
    const north = toScreen(pose, PITCH_DEG, 1.6, { x: 10, y: 0, z: 3 });
    expect(north.y).toBeGreaterThan(0);
    expect(north.depth).toBeGreaterThan(18);
  });
});
