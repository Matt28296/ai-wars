// How a unit is drawn: status chip priority, spent state, facing, the units that acted and where the camera looks.
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../content/maps';
import { createGame } from '../../game/aw';
import type { GameEvent, GameState, Unit } from '../../game/aw';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import { observe } from '../../game/aw/observe';
import { omniscientFrame } from './timeline';
import { PLAYERS, fieldSetup, pt } from './testing';
import { actorIds, focusOf, homeFacings, isSpent, unitDisplayHp, unitStatus } from './unitview';

// A 10 x 3 field with one neutral arcology at (5,1) so a trooper can stand on a property.
const state: GameState = createGame({
  ...fieldSetup([], { fog: false }),
  map: {
    id: 'status-fixture', name: 'status-fixture', description: 'fixture', players: 2,
    terrain: ['..........', '.....C....', '..........'],
    owners: ['..........', '..........', '..........'],
    units: [
      { type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'wasp', owner: 0, x: 1, y: 0 }, { type: 'lancer', owner: 0, x: 2, y: 0 },
      { type: 'mule', owner: 0, x: 3, y: 0 }, { type: 'trooper', owner: 1, x: 5, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 2 },
    ],
  },
});
const withUnit = (id: number, patch: Partial<Unit>): GameState => ({ ...state, units: state.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
const frameOf = (s: GameState) => omniscientFrame(s);
const unit = (s: GameState, id: number): Unit => s.units.find((u) => u.id === id)!;
/** The chip for unit `id` after patching it, read from a frame of the patched state (so the tile under it is the real one). */
const statusWith = (id: number, patch: Partial<Unit>) => {
  const s = withUnit(id, patch);
  return unitStatus(frameOf(s), unit(s, id));
};

describe('unitStatus: one chip, by priority', () => {
  it('shows nothing for a healthy unit', () => {
    for (const u of state.units) expect(unitStatus(frameOf(state), u), `${u.type} ${u.id}`).toBeUndefined();
  });

  it('shows capturing for a unit that can capture standing on a property being taken', () => {
    const s: GameState = { ...state, tiles: state.tiles.map((row, y) => (y === 1 ? row.map((t, x) => (x === 5 ? { ...t, capture: 12 } : t)) : row)) };
    expect(unitStatus(frameOf(s), unit(s, 5))).toBe('capturing'); // the Tidewell trooper on the arcology
    expect(unitStatus(frameOf(s), unit(s, 6))).toBeUndefined();     // another trooper, elsewhere
    // a full-strength property is not "being captured"
    expect(unitStatus(frameOf(state), unit(state, 5))).toBeUndefined();
  });

  it('shows low charge at a fifth of full charge or less, and not above it', () => {
    // wasp: charge 99, so a fifth is round(19.8) = 20
    expect(statusWith(2, { charge: 20 })).toBe('low-charge');
    expect(statusWith(2, { charge: 21 })).toBeUndefined();
    expect(statusWith(2, { charge: 0 })).toBe('low-charge');
  });

  it('shows low ammo at one round or none, only for a unit with a primary weapon', () => {
    expect(statusWith(3, { ammo: 1 })).toBe('low-ammo'); // lancer, 9 rounds when full
    expect(statusWith(3, { ammo: 0 })).toBe('low-ammo');
    expect(statusWith(3, { ammo: 2 })).toBeUndefined();
    expect(statusWith(1, { ammo: 0 })).toBeUndefined(); // a trooper has no primary weapon to run dry
  });

  it('shows loaded for a transport carrying cargo', () => {
    const cargo: Unit = { ...unit(state, 1), id: 99, x: 3, y: 0 };
    expect(statusWith(4, { cargo: [cargo] })).toBe('loaded');
  });

  it('puts capturing before low charge before low ammo before loaded', () => {
    expect(statusWith(2, { charge: 5, ammo: 0 })).toBe('low-charge'); // low charge outranks low ammo
    expect(statusWith(3, { ammo: 0, charge: 1 })).toBe('low-charge');
    expect(statusWith(3, { ammo: 0 })).toBe('low-ammo');
    // low ammo outranks cargo: give a lancer cargo it cannot really carry, only to test the order
    expect(statusWith(3, { ammo: 0, cargo: [{ ...unit(state, 1), id: 99 }] })).toBe('low-ammo');
    // capturing outranks everything
    const capturing: GameState = { ...state, tiles: state.tiles.map((row, y) => (y === 1 ? row.map((t, x) => (x === 5 ? { ...t, capture: 3 } : t)) : row)) };
    const lowTrooper = { ...unit(capturing, 5), charge: 0, cargo: [{ ...unit(state, 1), id: 99 }] };
    expect(unitStatus(frameOf(capturing), lowTrooper)).toBe('capturing');
  });
});

describe('isSpent', () => {
  it('greys a unit only on its owner\'s own turn, after it acted (known-bad: an enemy\'s stale flag must not grey it)', () => {
    const acted = withUnit(1, { acted: true });
    expect(acted.current).toBe(0);
    expect(isSpent(frameOf(acted), unit(acted, 1))).toBe(true);
    expect(isSpent(frameOf(state), unit(state, 1))).toBe(false);
    // the same flag on the player whose turn it is NOT: not spent
    const enemyActed = withUnit(5, { acted: true });
    expect(isSpent(frameOf(enemyActed), unit(enemyActed, 5))).toBe(false);
  });
});

describe('unitDisplayHp', () => {
  it('rounds internal HP up to the displayed 1-10 and never shows 0', () => {
    expect(unitDisplayHp({ ...unit(state, 1), hp: 100 })).toBe(10);
    expect(unitDisplayHp({ ...unit(state, 1), hp: 91 })).toBe(10);
    expect(unitDisplayHp({ ...unit(state, 1), hp: 90 })).toBe(9);
    expect(unitDisplayHp({ ...unit(state, 1), hp: 11 })).toBe(2);
    expect(unitDisplayHp({ ...unit(state, 1), hp: 1 })).toBe(1);
    expect(unitDisplayHp({ ...unit(state, 1), hp: 0 })).toBe(1);
  });
});

describe('homeFacings: units face the enemy, and the right-hand side of the map faces left', () => {
  const calder = createGame({ map: MAPS['calder-fields'], players: PLAYERS, fog: true, seed: 1, startFunds: 1000 });

  it('sends the left-hand army right and the right-hand army left on calder-fields', () => {
    // calder-fields: player 0 owns the spire at x=1, player 1 the spire at x=12 (14 wide)
    expect(homeFacings(omniscientFrame(calder))).toEqual(['right', 'left']);
  });

  it('is the same for a fogged viewer, because property ownership is public', () => {
    expect(homeFacings({ ...observe(calder, 0), viewer: 0 })).toEqual(['right', 'left']);
    expect(homeFacings({ ...observe(calder, 1), viewer: 1 })).toEqual(['right', 'left']);
  });

  it('falls back to the player index when a side owns no property: even right, odd left', () => {
    expect(homeFacings(frameOf(state))).toEqual(['right', 'left']);
  });
});

describe('actorIds and focusOf read only the events the viewer was given', () => {
  const events: GameEvent[] = [
    { kind: 'moved', unitId: 1, path: [pt(0), pt(1), pt(2)] },
    { kind: 'moved', unitId: 3, path: [pt(4)] }, // acted in place: not an actor worth marking
    { kind: 'attacked', attackerId: 1, defenderId: 5, damage: 30, counter: 0, attackerHp: 100, defenderHp: 70 },
    { kind: 'attacked', attackerId: UNSEEN_UNIT, defenderId: 1, damage: 10, counter: 0, attackerHp: UNSEEN_UNIT, defenderHp: 90 },
    { kind: 'captureProgress', unitId: 6, at: pt(5), remaining: 10 },
    { kind: 'supplied', byId: 4, unitIds: [1] },
    { kind: 'unloaded', unitId: 8, transportId: UNSEEN_UNIT, to: pt(2) },
  ];

  it('marks the units that moved, fired, captured, supplied or unloaded - and never the redacted shooter', () => {
    expect([...actorIds(events)].sort((a, b) => a - b)).toEqual([1, 4, 6]);
    expect(actorIds(events).has(UNSEEN_UNIT)).toBe(false);
    expect(actorIds([])).toEqual(new Set());
  });

  it('centres on the end of a move, a struck unit, or the tile where something happened, last event winning', () => {
    const f = frameOf(state);
    expect(focusOf([{ kind: 'moved', unitId: 1, path: [pt(0), pt(3)] }], f)).toEqual(pt(3));
    expect(focusOf([{ kind: 'captured', at: pt(5), terrain: 'arcology', by: 0, from: null }], f)).toEqual(pt(5));
    // unit 5 (Tidewell trooper) stands at (5,1): a hit on it centres there, after an earlier move elsewhere
    const hit: GameEvent = { kind: 'attacked', attackerId: 1, defenderId: 5, damage: 30, counter: 0, attackerHp: 100, defenderHp: 70 };
    expect(focusOf([{ kind: 'moved', unitId: 1, path: [pt(0), pt(2)] }, hit], f)).toEqual(pt(5));
    expect(focusOf([{ kind: 'turnEnded', player: 0 }], f)).toBeUndefined();
    expect(focusOf([], f)).toBeUndefined();
  });
});
