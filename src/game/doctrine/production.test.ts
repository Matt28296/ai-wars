// Doctrine production (B.5): what the agent builds follows the composition weights, the need, and what the enemy fields. Hand-built
// positions with a free production tile; the expected answers are worked out here from the unit table and the damage table, never read
// back from production.ts. Each test has a known-bad twin: the same position with the weight or the need changed.
import { describe, expect, it } from 'vitest';
import { UNIT_TYPES } from '../../data';
import { applyAction, buildOptions } from '../aw';
import { fixtureGame } from '../aw/testing';
import type { FixtureUnit } from '../aw/testing';
import type { Action, GameState, UnitTypeId } from '../aw/types';
import { categoryOf } from './eval';
import { DEFAULT_ORDERS, decide, validateOrders } from './index';
import type { StandingOrders } from './index';

const unit = (type: UnitTypeId, owner: number, x: number, y: number, hp?: number): FixtureUnit => ({ type, owner, x, y, ...(hp ? { hp } : {}) });
const orders = (o: object = {}): StandingOrders => validateOrders(o);
const setPlayer = (s: GameState, i: number, patch: Partial<GameState['players'][0]>): GameState => ({
  ...s, players: s.players.map((p, k) => (k === i ? { ...p, ...patch } : p)),
});

/** Everything the agent builds in one turn, with the units it has left alone. Only builds are collected. */
function builtThisTurn(state: GameState, o: StandingOrders, cap = 40): UnitTypeId[] {
  const out: UnitTypeId[] = [];
  let s = state;
  for (let i = 0; s.current === state.current && s.winnerTeam === null && i < cap; i++) {
    const a: Action = decide(s, state.current, o);
    if (a.kind === 'build') out.push(a.unitType);
    s = applyAction(s, a).state;
  }
  return out;
}

describe('composition weights', () => {
  // three fabricators, a skyport and a dock, all ours and empty, and a lot of money
  const terrain = ['F.F.F.', '......', 'A.D...', '..~~~~'];
  const owners = ['0.0.0.', '......', '0.0...', '......'];
  const rich = (extra: FixtureUnit[] = []) => {
    const s = fixtureGame(terrain, [unit('trooper', 0, 1, 1), unit('trooper', 1, 5, 1), unit('lancer', 1, 5, 0), ...extra], { owners });
    return setPlayer({ ...s, cycle: 6 }, 0, { funds: 90000 });
  };

  it('the setup: every kind of production tile is free and affordable', () => {
    const s = rich();
    for (const at of [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }]) expect(buildOptions(s, at).some((o) => o.affordable)).toBe(true);
  });

  it('a category with weight 0 is never built, whatever else is going on', () => {
    for (const zero of ['infantry', 'vehicles', 'indirect', 'air', 'naval'] as const) {
      const comp = { infantry: 5, vehicles: 5, indirect: 5, air: 5, naval: 10, [zero]: 0 };
      const built = builtThisTurn(rich(), orders({ composition: comp }));
      expect(built.length, `weights without ${zero}: something is built`).toBeGreaterThan(0);
      expect(built.filter((t) => categoryOf(t) === zero), `no ${zero} unit is built`).toEqual([]);
    }
  });

  it('only the category with weight is built', () => {
    const only = (cat: 'infantry' | 'vehicles' | 'indirect' | 'air' | 'naval') => {
      const comp = { infantry: 0, vehicles: 0, indirect: 0, air: 0, naval: 0, [cat]: 10 };
      return builtThisTurn(rich(), orders({ composition: comp }));
    };
    expect(only('infantry').every((t) => categoryOf(t) === 'infantry')).toBe(true);
    expect(only('infantry').length).toBeGreaterThan(0);
    expect(only('vehicles').every((t) => categoryOf(t) === 'vehicles')).toBe(true);
    expect(only('indirect').every((t) => categoryOf(t) === 'indirect')).toBe(true);
    expect(only('indirect').length).toBeGreaterThan(0);
    expect(only('air').every((t) => categoryOf(t) === 'air')).toBe(true);
    expect(only('air').length).toBeGreaterThan(0);
  });

  it('all weights 0 builds nothing: the player ordered no army', () => {
    const none = { infantry: 0, vehicles: 0, indirect: 0, air: 0, naval: 0 };
    expect(builtThisTurn(rich(), orders({ composition: none }))).toEqual([]);
  });

  it('known-bad twin: the default weights do build ground units, so the empty result above comes from the zeros', () => {
    const built = builtThisTurn(rich(), DEFAULT_ORDERS);
    expect(built.length).toBeGreaterThan(0);
    expect(built.some((t) => UNIT_TYPES[t].domain === 'ground')).toBe(true);
  });

  it('spends: with three fabricators and 90000 funds it fills every free tile it can', () => {
    const s = rich();
    const built = builtThisTurn(s, orders({ composition: { infantry: 5, vehicles: 5, indirect: 5, air: 0, naval: 0 } }));
    expect(built.length).toBe(3);
  });
});

describe('need', () => {
  const terrain = ['F....C...C.', '...........', '.C.......C.'];
  const owners = ['0..........', '...........', '...........'];

  it('early, with free properties about, a capturer is built', () => {
    let s = fixtureGame(terrain, [unit('trooper', 0, 3, 1), unit('trooper', 1, 10, 1)], { owners });
    s = setPlayer(s, 0, { funds: 3000 });
    const built = builtThisTurn(s, DEFAULT_ORDERS);
    expect(built.length).toBe(1);
    expect(UNIT_TYPES[built[0]].captures, built[0]).toBe(true);
  });

  it('known-bad twin: with nothing left to capture, the next unit is not a capturer', () => {
    // every property is already ours, and plenty of money: a fighter, not another trooper
    const t = ['F....C...C.', '...........', '.C.......C.'];
    const o = ['0....0...0.', '...........', '.0.......0.'];
    let s = fixtureGame(t, [unit('trooper', 0, 3, 1), unit('lancer', 1, 10, 1)], { owners: o });
    s = setPlayer({ ...s, cycle: 8 }, 0, { funds: 16000 });
    const built = builtThisTurn(s, DEFAULT_ORDERS);
    expect(built.length).toBe(1);
    expect(UNIT_TYPES[built[0]].captures, built[0]).toBeFalsy();
  });

  it('anti-air against air: a Warden is built when the enemy fields Wasps and the army has no answer', () => {
    const t = ['F.........', '..........', '..........'];
    const o = ['0.........', '..........', '..........'];
    const air = fixtureGame(t, [unit('trooper', 0, 4, 1), unit('wasp', 1, 8, 0), unit('wasp', 1, 8, 1), unit('wasp', 1, 8, 2)], { owners: o });
    const built = builtThisTurn(setPlayer({ ...air, cycle: 8 }, 0, { funds: 9000 }), orders({ composition: { infantry: 0, vehicles: 10, indirect: 0, air: 0, naval: 0 } }));
    expect(built).toEqual(['warden']);
    // known-bad twin: against tanks, with money for a tank of its own, it does not buy the Warden
    const tanks = fixtureGame(t, [unit('trooper', 0, 4, 1), unit('bastion', 1, 8, 0), unit('bastion', 1, 8, 1), unit('bastion', 1, 8, 2)], { owners: o });
    const other = builtThisTurn(setPlayer({ ...tanks, cycle: 8 }, 0, { funds: 30000 }), orders({ composition: { infantry: 0, vehicles: 10, indirect: 0, air: 0, naval: 0 } }));
    expect(other.length).toBe(1);
    expect(other).not.toEqual(['warden']);
  });

  it('cannot afford: with 500 funds nothing is built and the turn ends', () => {
    let s = fixtureGame(terrain, [unit('trooper', 0, 3, 1), unit('trooper', 1, 10, 1)], { owners });
    s = setPlayer(s, 0, { funds: 500 });
    expect(builtThisTurn(s, DEFAULT_ORDERS)).toEqual([]);
  });
});
