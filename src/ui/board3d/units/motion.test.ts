// G16: reduced motion reaches the units. A view's `setMotion(false)` holds its idle motion (the hover and air bob, the ship's roll, the
// walker's shift, a squad's breathing, the spinning rotors and radars, the focus ring's breath) exactly where it is, whatever time the stage
// hands it; the poses that show an action (move, fire, hit) still play (the clock runs while a unit moves and holds again when it stops);
// and `setMotion(true)` carries on from where the clock stopped, so nothing jumps. "Where a unit is" is read the way the renderer draws it:
// every vertex of every mesh in world space, skeleton pose included, plus the group transforms and the ring. Expected values are computed
// here, never copied out of the implementation.
import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import type { FactionId, UnitTypeId } from '../../../game/aw';
import type { UnitLook, UnitView } from '../contract';
import { UNIT_IDS, createUnitViewWithPhase } from './index';
import type { UnitKit } from './index';
import { modelOf, worldPositions } from './measure';

const look = (over: Partial<UnitLook> = {}): UnitLook => ({ hp: 10, spent: false, heading: 0, status: null, focused: true, ...over });
const FRAME = 1 / 60;

/** A view with a fixed phase (so two views of one type idle in step) and the focus ring on (so its breath is measured too). */
const make = (type: UnitTypeId, index: number, faction: FactionId = 'helion'): UnitKit => {
  const v = createUnitViewWithPhase(type, faction, 0.7 + index * 0.9);
  v.setLook(look());
  return v;
};

/** Every number that says where a unit is right now: all its vertices in world space, its group transforms and the ring's scale. */
function stance(v: UnitView): Float64Array {
  v.object.updateMatrixWorld(true);
  const lists: ArrayLike<number>[] = [];
  modelOf(v).traverse((o) => { if (o instanceof Mesh) lists.push(worldPositions(o)); });
  const groups: number[] = [];
  for (const name of ['pose', 'idle', 'ring']) {
    const g = v.object.getObjectByName(name);
    if (!g) throw new Error(`unit ${v.type} has no ${name} group`);
    groups.push(g.position.x, g.position.y, g.position.z, g.rotation.x, g.rotation.y, g.rotation.z, g.scale.x, g.scale.y, g.scale.z);
  }
  lists.push(groups);
  const out = new Float64Array(lists.reduce((n, l) => n + l.length, 0));
  let at = 0;
  for (const l of lists) for (let i = 0; i < l.length; i += 1) out[at++] = l[i];
  return out;
}

/** The largest difference between two stances (Infinity if they are not the same length). */
function distance(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
}

const TIMES = [3.7, 9.1, 47.3, 600.9];

/** True when the stance is exactly the same at every one of `TIMES` as at the first `t0` (the unit is held still). */
function holdsStill(v: UnitView): boolean {
  v.update(FRAME, 3.0);
  const first = stance(v);
  return TIMES.every((t) => {
    v.update(FRAME, t);
    return distance(first, stance(v)) === 0;
  });
}

describe('with motion off, a unit\'s idle motion holds whatever time the stage gives it', () => {
  it.each(UNIT_IDS.map((t, i) => [t, i] as const))('%s', (type, index) => {
    const v = make(type, index);
    v.update(FRAME, 1.0);
    v.setMotion(false);
    expect(v.motion).toBe(false);
    expect(holdsStill(v), `${type} at rest, motion off`).toBe(true);
    v.dispose();
  });

  it('known-bad: the same check says a unit that was never frozen is NOT still (so the test above is not vacuous), for all 16 types', () => {
    for (const [i, type] of UNIT_IDS.entries()) {
      const v = make(type, i);
      expect(v.motion).toBe(true); // a view starts with motion on
      expect(holdsStill(v), `${type} moves with motion on`).toBe(false);
      v.dispose();
    }
  });

  it('a unit that has an idle motion of each class really moves with motion on: bob, roll, shift, shuffle, spin', () => {
    // one of each class; the amount it moves between two idle times is at least a millimetre of tile somewhere on it
    for (const type of ['skimmer', 'wasp', 'dreadnought', 'colossus', 'trooper', 'warden'] as const) {
      const v = make(type, 2);
      v.update(FRAME, 3.0);
      const a = stance(v);
      v.update(FRAME, 3.7);
      expect(distance(a, stance(v)), `${type} idle motion`).toBeGreaterThan(0.001);
      v.dispose();
    }
  });

  it('the focus ring\'s breath is held too', () => {
    const v = make('lancer', 0);
    v.update(FRAME, 1.0);
    const ring = v.object.getObjectByName('ring')!;
    expect(ring.visible).toBe(true);
    const ringAt = (t: number): number => { v.update(FRAME, t); return ring.scale.x; };
    const on = [ringAt(1.1), ringAt(1.4), ringAt(1.8)];
    expect(new Set(on).size, 'the ring breathes with motion on').toBeGreaterThan(1);
    v.setMotion(false);
    const held = ringAt(2.0);
    expect([ringAt(2.3), ringAt(5.9), ringAt(77.7)]).toEqual([held, held, held]);
    v.dispose();
  });

  it('a squad held still stays still at every size it can show, and a view with motion off is held from its first frame', () => {
    for (const hp of [10, 5, 2]) {
      const v = createUnitViewWithPhase('breacher', 'tidewell', 1.3);
      v.setLook(look({ hp }));
      v.setMotion(false); // before any update
      expect(holdsStill(v), `breacher hp ${hp}`).toBe(true);
      v.dispose();
    }
  });
});

describe('the poses that show an action still play with motion off', () => {
  const frozen = (type: UnitTypeId, index: number): UnitKit => {
    const v = make(type, index);
    v.update(FRAME, 4.0);
    v.setMotion(false);
    v.update(FRAME, 4.0 + FRAME);
    return v;
  };

  it.each(UNIT_IDS.map((t, i) => [t, i] as const))('%s: move leans and strides, fire recoils, hit shakes; idle stays held between them', (type, index) => {
    const v = frozen(type, index);
    const idle = stance(v);
    const poseGroup = v.object.getObjectByName('pose')!;
    const idleLean = poseGroup.rotation.z;

    // fire and hit are drawn from their own t: they change the stance, and the same t gives the same stance at any later time
    for (const [pose, t] of [['fire', 0.15], ['hit', 0.3]] as const) {
      v.setPose(pose, t);
      const during = stance(v);
      expect(distance(idle, during), `${type} ${pose} plays`).toBeGreaterThan(0);
      v.update(FRAME, 9.1);
      expect(distance(during, stance(v)), `${type} ${pose}: the idle part under it is held`).toBe(0);
    }

    // a move: the lean (nose down, from the pose's own t) and the stride (from the stage's time) both play
    v.setPose('move', 0.5);
    expect(poseGroup.rotation.z, `${type} leans into the move`).toBeLessThan(idleLean);
    v.update(FRAME, 20.0);
    const a = stance(v);
    v.update(FRAME, 20.13);
    expect(distance(a, stance(v)), `${type} strides while it moves`).toBeGreaterThan(0);

    // and when the move is over the unit stops leaning and is held again, where the move left it (it neither drifts on nor leaps back)
    v.setPose('idle', 0);
    v.update(FRAME, 21.0);
    expect(poseGroup.rotation.z, `${type} stops leaning`).toBe(idleLean);
    const after = stance(v);
    for (const t of [24.4, 99.9]) {
      v.update(FRAME, t);
      expect(distance(after, stance(v)), `${type} held again after the move, at stage time ${t}`).toBe(0);
    }
    v.dispose();
  });

  it('a move that is held would NOT stride: known-bad twin built by freezing the pose time', () => {
    // the same two updates with motion on, then compare with what a "frozen stride" would give: the stride differs between 20.0 and 20.13 only
    // because the move runs on the stage's own time, which is what the test above relies on
    const v = make('colossus', 0);
    v.setMotion(false);
    v.setPose('idle', 0);
    v.update(FRAME, 20.0);
    const a = stance(v);
    v.update(FRAME, 20.13);
    expect(distance(a, stance(v)), 'idle is held').toBe(0);
    v.setPose('move', 0.5);
    v.update(FRAME, 20.0);
    const b = stance(v);
    v.update(FRAME, 20.13);
    expect(distance(b, stance(v)), 'but the same two times stride in a move').toBeGreaterThan(0);
    v.dispose();
  });
});

describe('motion back on carries on from where the clock stopped, with no jump', () => {
  it.each(UNIT_IDS.map((t, i) => [t, i] as const))('%s: the first frame after resuming is the one frame of motion after the held picture', (type, index) => {
    const phase = 0.7 + index * 0.9;
    const reference = createUnitViewWithPhase(type, 'helion', phase); // never frozen: its clock is the stage's
    reference.setLook(look());
    const v = make(type, index);

    v.update(FRAME, 5.0);
    reference.update(FRAME, 5.0);
    const heldPicture = stance(v);
    v.setMotion(false);
    // a long freeze: the stage's time runs on 100 s while the unit holds
    for (let t = 5.0 + FRAME; t < 105; t += 0.25) v.update(FRAME, t);
    expect(distance(heldPicture, stance(v)), `${type} held through the freeze`).toBe(0);
    v.update(FRAME, 105.0);
    v.setMotion(true);
    v.update(FRAME, 105.0 + FRAME);

    // one frame of idle clock after the held picture: what a unit that never stopped shows one frame after 5.0
    reference.update(FRAME, 5.0 + FRAME);
    expect(distance(stance(reference), stance(v)), `${type} resumes at the clock where it stopped`).toBeLessThan(1e-9);
    // ... which is a frame's motion from the held picture, not the 100 s the stage's own time jumped
    const frameMotion = distance(heldPicture, stance(v));
    expect(frameMotion, `${type} moves a frame, not a leap`).toBeLessThan(0.15);

    // and it goes on moving from there
    v.update(FRAME, 106.0);
    expect(distance(heldPicture, stance(v)), `${type} moves again`).toBeGreaterThan(0);
    reference.dispose();
    v.dispose();
  });

  it('known-bad: a clock that followed the stage\'s time through the freeze would have jumped by 100 s of motion', () => {
    const v = make('wasp', 0);
    const ref = make('wasp', 0);
    v.update(FRAME, 5.0);
    ref.update(FRAME, 5.0);
    v.setMotion(false);
    v.update(FRAME, 105.0);
    v.setMotion(true);
    v.update(FRAME, 105.0 + FRAME);
    ref.update(FRAME, 105.0 + FRAME); // what a clock that never held shows
    expect(distance(stance(ref), stance(v)), 'the held clock is NOT the stage clock').toBeGreaterThan(0.001);
    v.dispose();
    ref.dispose();
  });

  it('a time that is not a number is ignored, and does not poison the clock for later', () => {
    const v = make('skimmer', 1);
    v.update(FRAME, 5.0);
    const before = stance(v);
    v.update(FRAME, Number.NaN);
    expect(distance(before, stance(v))).toBe(0);
    v.setMotion(false);
    v.update(FRAME, Number.POSITIVE_INFINITY);
    v.update(FRAME, 7.0);
    v.setMotion(true);
    v.update(FRAME, 7.0 + FRAME);
    const after = stance(v);
    expect(Array.from(after).every(Number.isFinite)).toBe(true);
    v.dispose();
  });

  it('setMotion on a disposed view does nothing and does not throw', () => {
    const v = make('lancer', 0);
    v.dispose();
    expect(() => v.setMotion(false)).not.toThrow();
    expect(v.motion).toBe(true);
  });
});
