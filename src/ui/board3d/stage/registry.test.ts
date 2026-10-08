// G16: the unit registry's two new jobs. It builds a masked owner's units unmarked (and rebuilds a unit whose marking changed), and it hands
// the reduced-motion switch to every unit view, those already on the board and those made later, never twice for one value.
import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { FactionId, UnitTypeId } from '../../../game/aw';
import type { CreateUnitView, UnitView, UnitViewOptions } from '../contract';
import { UnitRegistry } from './registry';
import type { Wanted } from './registry';

interface Made { type: UnitTypeId; faction: FactionId; opts: UnitViewOptions | undefined; view: UnitView; motion: boolean[]; disposed: boolean }

/** A recording stand-in for the unit kit; `withMotion` false makes the views the contract's own, which have no setMotion. */
function kit(withMotion = true): { create: CreateUnitView; made: Made[] } {
  const made: Made[] = [];
  const create: CreateUnitView = (type, faction, opts) => {
    const record: Made = { type, faction, opts, view: null as unknown as UnitView, motion: [], disposed: false };
    const view = {
      object: new Object3D(), type, setLook: () => undefined, setPose: () => undefined, muzzleWorld: (out) => out, update: () => undefined,
      dispose: () => { record.disposed = true; },
      ...(withMotion ? { setMotion: (on: boolean) => { record.motion.push(on); } } : {}),
    } as UnitView;
    record.view = view;
    made.push(record);
    return view;
  };
  return { create, made };
}

const want = (id: number, type: UnitTypeId, faction: FactionId, unmarked?: boolean): Wanted => (unmarked === undefined ? { id, type, faction } : { id, type, faction, unmarked });
const home = (): number => 0;

describe('the registry builds a masked owner\'s units unmarked', () => {
  it('asks for `{ unmarked: true }` only for a wanted unit that says so, and for nothing at all otherwise', () => {
    const k = kit();
    const reg = new UnitRegistry(k.create);
    reg.sync([want(1, 'lancer', 'helion'), want(2, 'trooper', 'choir', true), want(3, 'mule', 'helion', false), want(4, 'wasp', 'choir', true)], home);
    expect(k.made.map((m) => [m.type, m.opts])).toEqual([['lancer', undefined], ['trooper', { unmarked: true }], ['mule', undefined], ['wasp', { unmarked: true }]]);
    // the nation is still asked for: colour is not a name
    expect(k.made.map((m) => m.faction)).toEqual(['helion', 'choir', 'helion', 'choir']);
  });

  it('a unit whose marking changes is rebuilt (the old view freed), and one whose marking did not is kept', () => {
    const k = kit();
    const reg = new UnitRegistry(k.create);
    reg.sync([want(1, 'lancer', 'choir'), want(2, 'trooper', 'choir')], home);
    const first = k.made.slice();
    reg.sync([want(1, 'lancer', 'choir'), want(2, 'trooper', 'choir')], home);
    expect(k.made).toHaveLength(2); // nothing changed: nothing rebuilt
    const r = reg.sync([want(1, 'lancer', 'choir', true), want(2, 'trooper', 'choir')], home);
    expect(r.created).toEqual([1]);
    expect(r.removed).toEqual([1]);
    expect(first[0].disposed).toBe(true);
    expect(first[1].disposed).toBe(false);
    expect(k.made[2].opts).toEqual({ unmarked: true });
    reg.sync([want(1, 'lancer', 'choir'), want(2, 'trooper', 'choir')], home); // and back: marked again
    expect(k.made[3].opts).toBeUndefined();
    expect(k.made[2].disposed).toBe(true);
  });
});

describe('the registry hands reduced motion to every unit view', () => {
  it('tells the views already on the board when it changes, and never repeats a value', () => {
    const k = kit();
    const reg = new UnitRegistry(k.create);
    reg.sync([want(1, 'lancer', 'helion'), want(2, 'wasp', 'helion')], home);
    reg.setMotion(true); // the default: nothing to say
    expect(k.made.map((m) => m.motion)).toEqual([[], []]);
    reg.setMotion(false);
    reg.setMotion(false);
    expect(k.made.map((m) => m.motion)).toEqual([[false], [false]]);
    reg.setMotion(true);
    expect(k.made.map((m) => m.motion)).toEqual([[false, true], [false, true]]);
  });

  it('tells a view made while motion is off, as it is made, so a unit that appears under reduced motion never starts moving', () => {
    const k = kit();
    const reg = new UnitRegistry(k.create);
    reg.setMotion(false);
    reg.sync([want(1, 'lancer', 'helion')], home);
    expect(k.made[0].motion).toEqual([false]);
    // a rebuilt (re-marked) unit is told as well
    reg.sync([want(1, 'lancer', 'helion', true)], home);
    expect(k.made[1].motion).toEqual([false]);
    // and with motion on again nothing extra is said to a view made afterwards (it starts on)
    reg.setMotion(true);
    reg.sync([want(1, 'lancer', 'helion', true), want(2, 'mule', 'helion')], home);
    expect(k.made[2].motion).toEqual([]);
  });

  it('skips a view that has no setMotion (the contract\'s own, or a stand-in) without a throw', () => {
    const k = kit(false);
    const reg = new UnitRegistry(k.create);
    reg.sync([want(1, 'lancer', 'helion')], home);
    expect(() => { reg.setMotion(false); reg.sync([want(2, 'mule', 'helion')], home); reg.setMotion(true); }).not.toThrow();
  });

  it('a setMotion that is not a function is skipped as well (the guard is typeof, not truthiness)', () => {
    const create: CreateUnitView = (type) => ({
      object: new Object3D(), type, setLook: () => undefined, setPose: () => undefined, muzzleWorld: (o: unknown) => o, update: () => undefined, dispose: () => undefined, setMotion: 'yes',
    }) as unknown as UnitView;
    const reg = new UnitRegistry(create);
    reg.sync([want(1, 'lancer', 'helion')], home);
    expect(() => reg.setMotion(false)).not.toThrow();
  });
});
