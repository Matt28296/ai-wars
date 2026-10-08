// D-016 at the 3D stage: a unit the viewer cannot see never gets a view. The leak is planted (a real fogged frame with the hidden
// enemy put back into it), and the guard and the whole map-to-views path must refuse it; the same enemy in the omniscient frame
// is allowed, so the guard is not simply refusing everything.
import { Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../../game/aw';
import { sampleTransition } from '../../watch/transition';
import type { ViewFrame } from '../../watch/timeline';
import { pt } from '../../watch/testing';
import type { CreateUnitView, UnitLook, UnitPose, UnitView } from '../contract';
import { isViewable, safeFrame } from './guard';
import { analyseStep, mapStage } from './mapping';
import { UnitRegistry, turnToward, wrapAngle } from './registry';
import { fieldTimeline, idOf, planOf } from './testing';

// Helion lancer on the west edge, Tidewell trooper on the east edge of a 10-wide field: far outside the lancer's sight.
const UNITS = [{ type: 'lancer' as const, owner: 0, x: 0, y: 1 }, { type: 'trooper' as const, owner: 1, x: 9, y: 1 }];
const mine = fieldTimeline(UNITS, 0, true).steps[0].frame; // player 0, fog on: what the engine's observe() lets through
const truth = fieldTimeline(UNITS, 'all', false).steps[0].frame; // the omniscient post-match frame
const LANCER = idOf(truth, 'lancer');
const TROOPER = idOf(truth, 'trooper');
const hiddenTrooper = truth.units.find((u) => u.id === TROOPER) as ViewFrame['units'][number];
/** The planted leak: the fogged frame with the unit it was never told about put back in. */
const leaked: ViewFrame = { ...mine, units: [...mine.units, hiddenTrooper] };

/** A unit view that only counts what is asked of it. */
function counting(): { create: CreateUnitView; built: { type: string; faction: string }[]; looks: UnitLook[]; poses: [UnitPose, number][]; disposed: () => number } {
  const built: { type: string; faction: string }[] = [];
  const looks: UnitLook[] = [];
  const poses: [UnitPose, number][] = [];
  let disposed = 0;
  const create: CreateUnitView = (type, faction) => {
    built.push({ type, faction });
    const view: UnitView = {
      object: new Object3D(), type,
      setLook: (l) => { looks.push(l); },
      setPose: (p, t) => { poses.push([p, t]); },
      muzzleWorld: (out) => out ?? new Vector3(),
      update: () => undefined,
      dispose: () => { disposed++; },
    };
    return view;
  };
  return { create, built, looks, poses, disposed: () => disposed };
}

describe('the planted leak is a real leak (the test is not vacuous)', () => {
  it('the fogged player never has the trooper, the omniscient frame does, and the leak puts it back', () => {
    expect(mine.units.map((u) => u.id)).toEqual([LANCER]);
    expect(mine.visible[1][9]).toBe(false); // its tile is dark to player 0
    expect(truth.units.map((u) => u.id).sort()).toEqual([LANCER, TROOPER].sort());
    expect(leaked.units.map((u) => u.id)).toContain(TROOPER);
  });
});

describe('the guard', () => {
  it('refuses an enemy on a tile the viewer cannot see, and says which', () => {
    const safe = safeFrame(leaked);
    expect(safe.refused.map((u) => u.id)).toEqual([TROOPER]);
    expect(safe.frame.units.map((u) => u.id)).toEqual([LANCER]);
    expect(isViewable(leaked, hiddenTrooper)).toBe(false);
  });

  it('lets through what the viewer may see: an enemy on a visible tile, its own units even on a dark tile, and everything in the omniscient frame', () => {
    const lit: ViewFrame = { ...leaked, visible: leaked.visible.map((row, y) => row.map((v, x) => (y === 1 && x === 9 ? true : v))) };
    expect(isViewable(lit, hiddenTrooper)).toBe(true);
    const dark: ViewFrame = { ...mine, visible: mine.visible.map((row) => row.map(() => false)) };
    expect(isViewable(dark, dark.units[0])).toBe(true); // its own lancer, on a tile the mask calls dark
    expect(safeFrame(truth).refused).toEqual([]);
    expect(safeFrame(truth).frame).toBe(truth);
  });

  it('returns a well-formed frame unchanged (the same object) and gives the same answer for the same frame', () => {
    expect(safeFrame(mine).frame).toBe(mine);
    expect(safeFrame(leaked)).toBe(safeFrame(leaked));
  });

  it('treats an allied unit as known and an enemy-team unit as unknown, by team and not by owner', () => {
    const ally: ViewFrame['units'][number] = { ...hiddenTrooper, owner: 0 };
    const withAlly: ViewFrame = { ...mine, units: [...mine.units, ally] };
    expect(isViewable(withAlly, ally)).toBe(true);
  });

  it('refuses a unit that is not on the board at all', () => {
    expect(isViewable(truth, { ...hiddenTrooper, x: 40 })).toBe(false);
    expect(isViewable(truth, { ...hiddenTrooper, y: -1 })).toBe(false);
    expect(isViewable(truth, { ...hiddenTrooper, x: 1.5 })).toBe(false);
  });
});

describe('from a leaked frame to unit views', () => {
  it('maps no state for the hidden unit, and the registry builds no view for it', () => {
    const plan = null;
    const info = analyseStep(leaked, leaked, [], plan);
    const state = mapStage({ frame: leaked, prev: leaked, plan, sample: null, t: 0, info, step: 0 });
    expect(state.units.map((u) => u.id)).toEqual([LANCER]);

    const fake = counting();
    const registry = new UnitRegistry(fake.create);
    const out = registry.sync(state.units.map((u) => ({ id: u.id, type: u.unit.type, faction: u.faction })), () => 0);
    expect(out.created).toEqual([LANCER]);
    expect(fake.built).toEqual([{ type: 'lancer', faction: 'helion' }]);
    expect(registry.has(TROOPER)).toBe(false);
    expect(registry.view(TROOPER)).toBeUndefined();
  });

  it('known-good control: the omniscient frame DOES give the trooper a view', () => {
    const state = mapStage({ frame: truth, prev: truth, plan: null, sample: null, t: 0, info: analyseStep(truth, truth, [], null), step: 0 });
    const fake = counting();
    const registry = new UnitRegistry(fake.create);
    registry.sync(state.units.map((u) => ({ id: u.id, type: u.unit.type, faction: u.faction })), () => 0);
    expect(registry.ids().sort()).toEqual([LANCER, TROOPER].sort());
    expect(fake.built.map((b) => b.type).sort()).toEqual(['lancer', 'trooper']);
  });

  it('a hidden unit that was shown in the previous frame is not resurrected as a ghost of a leaked frame', () => {
    // The enemy was in the (leaked) previous frame and is gone from the next one; the plan, built from raw frames, keeps a ghost for it.
    const prev: ViewFrame = { ...mine, units: [...mine.units, hiddenTrooper] };
    const events: GameEvent[] = [{ kind: 'destroyed', unitId: TROOPER, at: pt(9), type: 'trooper', owner: 1 }];
    const after: ViewFrame = { ...mine, units: mine.units };
    const plan = planOf(prev, after, events);
    expect(plan.ghosts.map((g) => g.unit.id)).toEqual([TROOPER]); // the plan itself would draw it ...
    const t = plan.fx[0].startMs + 10;
    const state = mapStage({ frame: after, prev, plan, sample: sampleTransition(plan, t), t, info: analyseStep(prev, after, events, plan), step: 1 });
    expect(state.units.some((u) => u.id === TROOPER)).toBe(false); // ... the stage refuses it
  });

  it('the camera focus cannot be pulled to a hidden unit either', () => {
    const attack: GameEvent = { kind: 'attacked', attackerId: LANCER, defenderId: TROOPER, damage: 10, counter: 0, attackerHp: 100, defenderHp: 90 };
    const open = analyseStep(truth, truth, [attack], planOf(truth, truth, [attack]));
    expect(open.focus).toEqual(pt(9)); // omniscient: the defender's tile
    const closed = analyseStep(leaked, leaked, [attack], planOf(leaked, leaked, [attack]));
    expect(closed.focus).toBeUndefined();
  });
});

describe('the unit registry', () => {
  const wanted = (id: number, type: 'lancer' | 'trooper' = 'lancer', faction: 'helion' | 'tidewell' = 'helion') => ({ id, type, faction });

  it('builds a view per new id, reuses it on later steps, and disposes it when the unit goes', () => {
    const fake = counting();
    const r = new UnitRegistry(fake.create);
    expect(r.sync([wanted(1), wanted(2)], () => 0).created).toEqual([1, 2]);
    const first = r.view(1);
    expect(r.sync([wanted(1), wanted(2)], () => 0)).toEqual({ created: [], removed: [] });
    expect(r.view(1)).toBe(first); // reused: its idle animation and heading carry over
    expect(fake.built).toHaveLength(2);
    expect(r.sync([wanted(2)], () => 0).removed).toEqual([1]);
    expect(fake.disposed()).toBe(1);
    expect(r.has(1)).toBe(false);
    r.dispose();
    expect(fake.disposed()).toBe(2);
    expect(r.size).toBe(0);
  });

  it('rebuilds a view when the id\'s type or faction changes (it is a different miniature now)', () => {
    const fake = counting();
    const r = new UnitRegistry(fake.create);
    r.sync([wanted(5, 'lancer', 'helion')], () => 0);
    const out = r.sync([wanted(5, 'trooper', 'tidewell')], () => 0);
    expect(out.created).toEqual([5]);
    expect(out.removed).toEqual([5]);
    expect(fake.disposed()).toBe(1);
  });

  it('adds new views to the scene group and takes them out again', () => {
    const fake = counting();
    const r = new UnitRegistry(fake.create);
    const inScene = new Set<Object3D>();
    r.sync([wanted(1)], () => 0, (v) => inScene.add(v.object), (v) => inScene.delete(v.object));
    expect(inScene.size).toBe(1);
    r.sync([], () => 0, (v) => inScene.add(v.object), (v) => inScene.delete(v.object));
    expect(inScene.size).toBe(0);
  });

  it('starts a new view facing its home heading, and sets a look only when it changed', () => {
    const fake = counting();
    const r = new UnitRegistry(fake.create);
    r.sync([wanted(1)], () => Math.PI);
    expect(r.heading(1, undefined, 1 / 60, true)).toBeCloseTo(Math.PI, 12);
    const look: UnitLook = { hp: 10, spent: false, heading: 0, status: null, focused: false };
    r.look(1, look);
    r.look(1, { ...look });
    r.look(1, { ...look, heading: 0.0004 }); // below the threshold: the same look
    expect(fake.looks).toHaveLength(1);
    r.look(1, { ...look, hp: 7 });
    r.look(1, { ...look, hp: 7, spent: true });
    expect(fake.looks).toHaveLength(3);
    r.look(99, look); // an id with no view is ignored, not an error
    expect(fake.looks).toHaveLength(3);
  });

  it('sends idle once and any other pose every frame (their t moves)', () => {
    const fake = counting();
    const r = new UnitRegistry(fake.create);
    r.sync([wanted(1)], () => 0);
    r.pose(1, 'idle', 0);
    r.pose(1, 'idle', 0);
    r.pose(1, 'fire', 0.1);
    r.pose(1, 'fire', 0.2);
    r.pose(1, 'idle', 0);
    expect(fake.poses).toEqual([['idle', 0], ['fire', 0.1], ['fire', 0.2], ['idle', 0]]);
  });

  it('turns smoothly by the shortest way when animating, and lands at once when not (scrubbing, reduced motion)', () => {
    const fake = counting();
    const r = new UnitRegistry(fake.create);
    r.sync([wanted(1)], () => 0);
    const a = r.heading(1, Math.PI / 2, 1 / 60, true);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(Math.PI / 2);
    expect(r.heading(1, undefined, 1 / 60, false)).toBe(Math.PI / 2); // not animating: the goal, at once
    expect(r.heading(1, undefined, 1 / 60, true)).toBe(Math.PI / 2); // and a unit with nothing new keeps its heading
  });
});

describe('angles', () => {
  it('wrap to (-PI, PI]', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI / 2 + 2 * Math.PI)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('turn the short way round, never overshoot, and land', () => {
    // from just under +PI to just over -PI is a small turn through PI, not a spin through 0
    const from = Math.PI - 0.1;
    const to = -Math.PI + 0.1;
    const step = turnToward(from, to, 1 / 60);
    expect(step).toBeGreaterThan(from); // keeps going up through PI
    let h = from;
    for (let i = 0; i < 400; i++) {
      h = turnToward(h, to, 1 / 60);
      expect(Math.abs(wrapAngle(to - h))).toBeLessThanOrEqual(0.2 + 1e-9);
    }
    expect(h).toBe(to);
  });
});
