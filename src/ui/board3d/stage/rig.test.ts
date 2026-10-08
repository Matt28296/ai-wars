// The camera rig against known answers. The framing is checked with three.js's own projection (an independent implementation of the
// maths in rig.ts), so a mistake in the closed form cannot hide behind itself.
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../content/maps';
import {
  CameraRig, FIT_MARGIN, NARROW_CANVAS_PX, defaultZoomLevel, FOV_DEG, MAX_ZOOM_LEVEL, PITCH_DEG, ZOOM_STEPS, clampTarget, easeToward, fitCorners, fitDistance, groundFootprint, panDelta, poseFor,
  stageAspect, stepZoom, wheelToSteps,
} from './rig';
import type { Board, CameraPose } from './rig';

const cameraAt = (pose: CameraPose, aspect: number): PerspectiveCamera => {
  const cam = new PerspectiveCamera(pose.fovDeg, aspect, pose.near, pose.far);
  cam.position.set(pose.position.x, pose.position.y, pose.position.z);
  cam.lookAt(new Vector3(pose.target.x, pose.target.y, pose.target.z));
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
};

const ndc = (cam: PerspectiveCamera, p: { x: number; y: number; z: number }): Vector3 => new Vector3(p.x, p.y, p.z).project(cam);
const inside = (v: Vector3, eps = 1e-6): boolean => Math.abs(v.x) <= 1 + eps && Math.abs(v.y) <= 1 + eps && v.z >= -1 && v.z <= 1;

/** Every skirmish map the game ships, by its own dimensions. */
const BOARDS: { id: string; board: Board }[] = Object.values(MAPS).map((m) => ({ id: m.id, board: { width: m.terrain[0].length, height: m.terrain.length } }));

// Stage sizes the canvas takes: a phone, a laptop and a wide desktop.
const ASPECTS = [358 / 280, 860 / 540, 1280 / 720, 2.2];

describe('the skirmish maps the camera must fit', () => {
  it('are the six shipped sizes (14x10 up to 23x23)', () => {
    const sizes = BOARDS.map((b) => `${b.board.width}x${b.board.height}`).sort();
    expect(sizes).toEqual(['14x10', '18x14', '18x16', '22x14', '23x23', '25x15']);
  });
});

describe('fitting the whole map at the widest zoom', () => {
  for (const { id, board } of BOARDS) {
    for (const aspect of ASPECTS) {
      it(`${id} (${board.width}x${board.height}) at aspect ${aspect.toFixed(2)}: every corner of the board is in the picture, and the fit is tight`, () => {
        const d = fitDistance(board, aspect);
        const target = { x: board.width / 2, y: 0, z: board.height / 2 };
        const cam = cameraAt(poseFor(target, d, board), aspect);
        for (const c of fitCorners(board)) expect(inside(ndc(cam, c)), `corner ${JSON.stringify(c)}`).toBe(true);
        // the board's own four corners at the water line, too
        for (const [x, z] of [[0, 0], [board.width, 0], [0, board.height], [board.width, board.height]]) {
          expect(inside(ndc(cam, { x, y: 0, z }))).toBe(true);
        }
        // known-bad: a camera 4% closer loses a corner, so the fit is not just "far away"
        const closer = cameraAt(poseFor(target, d * 0.96, board), aspect);
        expect(fitCorners(board).some((c) => !inside(ndc(closer, c)))).toBe(true);
      });
    }
  }

  it('looks 55 degrees down with a 30 degree field of view, from the south, with yaw 0 (rows stay horizontal)', () => {
    expect(FOV_DEG).toBe(30);
    expect(PITCH_DEG).toBe(55);
    const board = { width: 14, height: 10 };
    const pose = poseFor({ x: 7, y: 0, z: 5 }, 20, board);
    const dx = pose.position.x - pose.target.x;
    const dy = pose.position.y - pose.target.y;
    const dz = pose.position.z - pose.target.z;
    expect(dx).toBe(0); // yaw 0: straight south of the target
    expect(dz).toBeGreaterThan(0);
    expect(Math.atan2(dy, dz) * (180 / Math.PI)).toBeCloseTo(55, 9);
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(20, 9);
    // map rows are horizontal on screen: two points with the same z project to the same screen y
    const cam = cameraAt(pose, 1.6);
    expect(ndc(cam, { x: 2, y: 0, z: 3 }).y).toBeCloseTo(ndc(cam, { x: 12, y: 0, z: 3 }).y, 9);
  });

  it('puts the clip planes round the board: nothing of it is cut off, near stays positive', () => {
    for (const { board } of BOARDS) {
      const d = fitDistance(board, 1.6);
      const pose = poseFor({ x: board.width / 2, y: 0, z: board.height / 2 }, d, board);
      expect(pose.near).toBeGreaterThan(0);
      expect(pose.near).toBeLessThan(d);
      expect(pose.far).toBeGreaterThan(d + Math.hypot(board.width, board.height) / 2);
    }
  });

  it('a wider canvas needs a smaller distance to fit a wide board (the width is the limit on a phone)', () => {
    const board = { width: 25, height: 15 };
    expect(fitDistance(board, 2)).toBeLessThanOrEqual(fitDistance(board, 1.2));
    expect(fitDistance(board, 1.2)).toBeGreaterThan(fitDistance(board, 1.2) * 0.5);
  });

  it('keeps the margin it promises', () => {
    expect(FIT_MARGIN).toBeGreaterThan(0);
    const corners = fitCorners({ width: 10, height: 10 });
    expect(Math.min(...corners.map((c) => c.x))).toBe(-FIT_MARGIN);
    expect(Math.max(...corners.map((c) => c.x))).toBe(10 + FIT_MARGIN);
  });
});

describe('zoom steps', () => {
  it('are three, widest first, and 1x is the fit', () => {
    expect(ZOOM_STEPS).toHaveLength(3);
    expect(ZOOM_STEPS[0]).toBe(1);
    expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...ZOOM_STEPS]);
    expect(MAX_ZOOM_LEVEL).toBe(2);
  });

  it('clamp at both ends of the ladder', () => {
    expect(stepZoom(0, -1)).toBe(0);
    expect(stepZoom(0, 1)).toBe(1);
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(2, -1)).toBe(1);
    // known-bad input: a fractional or out-of-range level still lands on the ladder
    expect(stepZoom(7, 1)).toBe(MAX_ZOOM_LEVEL);
    expect(stepZoom(-3, -1)).toBe(0);
  });

  it('come from the wheel one at a time: small movements add up, one notch is one step, inertia does not run the ladder', () => {
    let r = wheelToSteps(0, -20, 0);
    expect(r).toEqual({ acc: -20, dir: 0 });
    r = wheelToSteps(r.acc, -20, 0);
    expect(r.dir).toBe(0);
    r = wheelToSteps(r.acc, -30, 0); // -70 in all: past 60
    expect(r).toEqual({ acc: 0, dir: 1 }); // wheel up zooms in
    expect(wheelToSteps(0, 100, 0)).toEqual({ acc: 0, dir: -1 }); // one mouse notch down zooms out
    expect(wheelToSteps(0, 3, 1).dir).toBe(-1); // line mode: 3 lines is a notch
    expect(wheelToSteps(0, 0, 0)).toEqual({ acc: 0, dir: 0 });
  });

  it('bring the camera closer by exactly the step', () => {
    const board = { width: 18, height: 14 };
    const rig = new CameraRig();
    rig.setBoard(board);
    rig.setAspect(1.6);
    rig.update(0, false);
    const wide = rig.pose().distance;
    expect(wide).toBeCloseTo(fitDistance(board, 1.6), 9);
    for (let level = 1; level <= MAX_ZOOM_LEVEL; level++) {
      rig.setLevel(level);
      rig.update(0, false);
      expect(rig.pose().distance).toBeCloseTo(wide / ZOOM_STEPS[level], 9);
    }
  });
});

describe('the zoom a canvas starts on', () => {
  it('is one step in on a phone-sized canvas and the whole map on anything wider', () => {
    expect(defaultZoomLevel(358)).toBe(1);
    expect(defaultZoomLevel(NARROW_CANVAS_PX - 1)).toBe(1);
    expect(defaultZoomLevel(NARROW_CANVAS_PX)).toBe(0);
    expect(defaultZoomLevel(904)).toBe(0);
    expect(defaultZoomLevel(1600)).toBe(0);
  });

  it('is a step on the ladder', () => {
    for (const w of [1, 300, 519, 520, 2000]) {
      const l = defaultZoomLevel(w);
      expect(Number.isInteger(l) && l >= 0 && l <= MAX_ZOOM_LEVEL).toBe(true);
    }
  });
});

/** The ground points the picture's corners look at (bottom-left, bottom-right, top-right, top-left), by three.js's own ray casting. */
const castCorners = (cam: PerspectiveCamera): Vector3[] => {
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const ray = new Raycaster();
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    ray.setFromCamera(new Vector2(x, y), cam);
    const hit = ray.ray.intersectPlane(ground, new Vector3());
    if (!hit) throw new Error('a picture corner looks at the sky');
    return hit;
  });
};
const footprintOf = (board: Board, aspect: number, target: { x: number; z: number }, zoom: number): Vector3[] =>
  castCorners(cameraAt(poseFor({ x: target.x, y: 0, z: target.z }, fitDistance(board, aspect) / zoom, board), aspect));
const onBoard = (p: Vector3, board: Board, eps = 1e-6): boolean => p.x >= -eps && p.x <= board.width + eps && p.z >= -eps && p.z <= board.height + eps;

describe('the ground footprint of the picture', () => {
  it('matches where the picture\'s corners really land (ray casting)', () => {
    for (const aspect of [1.2, 1.6, 2.2]) {
      const d = 24;
      const f = groundFootprint(d, aspect);
      const board = { width: 20, height: 20 };
      const [bottomLeft, bottomRight, topRight, topLeft] = castCorners(cameraAt(poseFor({ x: 10, y: 0, z: 10 }, d, board), aspect));
      expect(topLeft.z - 10).toBeCloseTo(f.top, 6);
      expect(topRight.z - 10).toBeCloseTo(f.top, 6);
      expect(bottomLeft.z - 10).toBeCloseTo(f.bottom, 6);
      expect(bottomRight.z - 10).toBeCloseTo(f.bottom, 6);
      expect(topRight.x - 10).toBeCloseTo(f.halfFar, 6);
      expect(topLeft.x - 10).toBeCloseTo(-f.halfFar, 6);
      expect(bottomRight.x - 10).toBeCloseTo(f.halfNear, 6);
    }
  });

  it('is wider and farther on the far side than the near side (perspective)', () => {
    const f = groundFootprint(24, 1.6);
    expect(f.top).toBeLessThan(0);
    expect(f.bottom).toBeGreaterThan(0);
    expect(-f.top).toBeGreaterThan(f.bottom); // more ground to the north of the target than to the south
    expect(f.halfFar).toBeGreaterThan(f.halfNear);
  });
});

describe('panning and the target', () => {
  const board = { width: 22, height: 14 };
  const aspect = 1.6;

  it('stays on the centre at the widest zoom, whatever is asked (the whole map is in view already)', () => {
    for (const ask of [{ x: 0, z: 0 }, { x: 99, z: -50 }, { x: 11, z: 7 }]) expect(clampTarget(ask, board, 1, aspect)).toEqual({ x: 11, z: 7 });
  });

  for (const { id, board: b } of BOARDS) {
    for (const aspect2 of [358 / 280, 860 / 540, 2.2]) {
      it(`${id} at aspect ${aspect2.toFixed(2)}: wherever the target is asked to go, the zoomed picture stays on the board, and no tighter than it must`, () => {
        for (const zoom of ZOOM_STEPS.slice(1)) {
          const asks = [[-99, -99], [99, -99], [99, 99], [-99, 99], [b.width / 2, b.height / 2], [1, b.height - 1]];
          for (const [x, z] of asks) {
            const t = clampTarget({ x, z }, b, zoom, aspect2);
            // the picture's footprint, as three.js casts it, is inside the board wherever the footprint is smaller than the board
            const pts = footprintOf(b, aspect2, t, zoom);
            const wide = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
            const deep = Math.max(...pts.map((p) => p.z)) - Math.min(...pts.map((p) => p.z));
            if (wide <= b.width) for (const p of pts) expect(p.x, `${id} z${zoom} (${x},${z}) x`).toBeGreaterThanOrEqual(-1e-6);
            if (wide <= b.width) for (const p of pts) expect(p.x).toBeLessThanOrEqual(b.width + 1e-6);
            if (deep <= b.height) for (const p of pts) expect(p.z, `${id} z${zoom} (${x},${z}) z`).toBeGreaterThanOrEqual(-1e-6);
            if (deep <= b.height) for (const p of pts) expect(p.z).toBeLessThanOrEqual(b.height + 1e-6);
          }
          // an ask already inside is left alone; known-bad: the unclamped corner request does leave the board
          const f = groundFootprint(fitDistance(b, aspect2) / zoom, aspect2);
          if (2 * f.halfFar < b.width && f.bottom - f.top < b.height) {
            const raw = footprintOf(b, aspect2, { x: b.width * 2, z: b.height * 2 }, zoom);
            expect(raw.some((p) => !onBoard(p, b))).toBe(true);
          }
        }
      });
    }
  }

  it('when the picture is wider than the board on an axis, that axis is centred', () => {
    const wide = { width: 6, height: 40 };
    const t = clampTarget({ x: 0, z: 5 }, wide, 1.75, 1.6);
    expect(t.x).toBe(3);
  });

  it('drags the board with the pointer: dragging right moves the target left, dragging down moves it north', () => {
    const d = panDelta(100, 0, 30, 800);
    expect(d.x).toBeLessThan(0);
    expect(d.z).toBeCloseTo(0, 12);
    const v = panDelta(0, 100, 30, 800);
    expect(v.z).toBeLessThan(0);
    // the picture moves by exactly the drag: project the target before and after and compare screen positions
    const cam0 = cameraAt(poseFor({ x: 11, y: 0, z: 7 }, 30, board), 1.6);
    const cam1 = cameraAt(poseFor({ x: 11 + d.x, y: 0, z: 7 + d.z }, 30, board), 1.6);
    const before = ndc(cam0, { x: 11, y: 0, z: 7 });
    const after = ndc(cam1, { x: 11, y: 0, z: 7 });
    const pxPerNdc = 800 / 2; // the viewport is 800 tall, NDC spans 2
    expect((after.x - before.x) * pxPerNdc * 1.6).toBeCloseTo(100, 0); // the ground point followed the 100 px drag to the right
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-3);
  });

  it('ignores a drag at the widest zoom and follows it when zoomed in', () => {
    const rig = new CameraRig();
    rig.setBoard(board);
    rig.setAspect(1.6);
    rig.update(0, false);
    const centre = rig.target;
    rig.pan(80, 80, 600);
    expect(rig.target).toEqual(centre);
    rig.setLevel(2);
    rig.update(5, true);
    rig.pan(80, 0, 600);
    expect(rig.target.x).toBeLessThan(centre.x);
    expect(rig.manual).toBe(true);
  });
});

describe('easing toward the focus', () => {
  it('moves toward the goal without ever overshooting it', () => {
    let x = 0;
    let prev = 0;
    for (let i = 0; i < 600; i++) {
      x = easeToward(x, 10, 1 / 60);
      expect(x).toBeLessThanOrEqual(10);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
    expect(x).toBe(10);
    let y = 10;
    for (let i = 0; i < 600; i++) {
      y = easeToward(y, 0, 1 / 60);
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });

  it('snaps when asked (scrubbing) and when the rate is zero', () => {
    expect(easeToward(0, 7, 1 / 60, 5, true)).toBe(7);
    expect(easeToward(0, 7, 1 / 60, 0)).toBe(7);
  });

  it('eases from the old target toward the new focus, and snaps there when the viewer scrubs', () => {
    const board = { width: 22, height: 14 };
    const rig = new CameraRig();
    rig.setBoard(board);
    rig.setAspect(1.6);
    rig.setLevel(1);
    rig.focusOn({ x: 3, y: 3 }, true);
    rig.update(1 / 60, true);
    expect(rig.target.x).toBeCloseTo(clampTarget({ x: 3.5, z: 3.5 }, board, ZOOM_STEPS[1], 1.6).x, 9); // scrub: it landed
    rig.focusOn({ x: 18, y: 10 }, false); // forward step: ease
    const goal = rig.goalTarget;
    const start = rig.target;
    rig.update(1 / 60, true);
    const first = rig.target;
    expect(first.x).toBeGreaterThan(start.x); // moving
    expect(first.x).toBeLessThan(goal.x); // still on its way
    for (let i = 0; i < 600; i++) rig.update(1 / 60, true);
    expect(rig.target.x).toBeCloseTo(goal.x, 6);
    expect(rig.target.z).toBeCloseTo(goal.z, 6);
  });

  it('does not move at the widest zoom whatever the focus (the map is already all in view)', () => {
    const rig = new CameraRig();
    rig.setBoard({ width: 22, height: 14 });
    rig.setAspect(1.6);
    rig.update(1, true);
    const centre = rig.target;
    rig.focusOn({ x: 20, y: 12 }, false);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, true);
    expect(rig.target).toEqual(centre);
  });

  it('under reduced motion lands on the focus at once, with no travel to shake', () => {
    const rig = new CameraRig();
    rig.setBoard({ width: 22, height: 14 });
    rig.setAspect(1.6);
    rig.setLevel(2);
    rig.update(1, true);
    rig.focusOn({ x: 18, y: 3 }, false);
    rig.update(1 / 60, false);
    expect(rig.target).toEqual(rig.goalTarget);
  });

  it('a drag holds the picture until the next step brings a new focus', () => {
    const rig = new CameraRig();
    rig.setBoard({ width: 22, height: 14 });
    rig.setAspect(1.6);
    rig.setLevel(2);
    rig.focusOn({ x: 10, y: 6 }, true);
    rig.update(1, true);
    rig.pan(50, 50, 600);
    expect(rig.manual).toBe(true);
    rig.focusOn({ x: 2, y: 2 }, false);
    expect(rig.manual).toBe(false);
  });
});

describe('the canvas shape', () => {
  it('suits the map and stays within sane bounds', () => {
    for (const { board } of BOARDS) {
      const a = stageAspect(board);
      expect(a).toBeGreaterThanOrEqual(1.05);
      expect(a).toBeLessThanOrEqual(2.2);
    }
    expect(stageAspect({ width: 25, height: 15 })).toBeGreaterThan(stageAspect({ width: 23, height: 23 }));
  });
});
