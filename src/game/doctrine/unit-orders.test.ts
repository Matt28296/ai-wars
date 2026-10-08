// Orders for each kind of unit (M3.4): six groups of unit types (infantry, armour, artillery, air, navy, transports), orders per group
// (`groups`) and per unit type (`types`) that fall through type, then group, then the army-wide orders, and a fixed list of missions per group.
// Expected answers are worked out here from the order text and the unit data (a distance on the board, a forecast, a count of tiles in the
// observation), never read back from the brain.
//
// How the behaviour tests are built. Each board is one tile high (a "strip"), so every tile of it has its own distance to the two bases and
// no two tiles tie: the brain breaks exact ties with a generator seeded from a hash of the orders, and a test of "this order changes that
// group and nobody else" must not be reading a tie. A board is accepted only if a no-op order (an explicit default mission for a group
// that is not on it) changes no unit's decision, which a seed-dependent tie would break. Each unit is asked alone (every other unit has
// already acted, as in pressure.test.ts), so no unit's decision is the result of a tile another unit happened to take first. The foe on
// these boards is a distant colossus, strong enough that Doctrine is not "ahead" and presses nobody (pressure has its own tests below).
// Every behaviour has a known-bad twin: the order given to a group that is not on the board, the order with its cause taken away.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { MAPS } from '../../content/maps';
import { UNIT_LIST, UNIT_TYPES } from '../../data';
import { applyAction, canSeeUnit, createGame, effectiveVision } from '../aw';
import type { CreateGameOptions, PlayerSetup } from '../aw';
import { actionKey } from '../aw/legal';
import { agentActions, observe, observedState } from '../aw/observe';
import { canonicalJson, fnv1a64, stateHash } from '../aw/replay';
import { fixtureGame } from '../aw/testing';
import type { FixtureUnit } from '../aw/testing';
import type { Action, Coord, FactionId, GameState, Unit, UnitTypeId } from '../aw/types';
import { BASE_LEASH, ESCORT_LEASH, PRESSURE_EXEMPT_MISSIONS, baseTiles, buildCtx, pressesType, pressureOf, revealGain } from './eval';
import type { Ctx } from './eval';
import {
  DEFAULT_ORDERS, GROUPED_TYPES, GROUP_MEMBERS, GROUP_MISSIONS, GROUP_NAMES, MISSION_NAMES, TARGET_PRIORITIES, UNIT_GROUPS, decide, defaultMission,
  groupOf, ordersFor, playDoctrine, validateOrders,
} from './index';
import type { GroupOrders, Mission, StandingOrders, UnitGroup } from './index';

// ---------------------------------------------------------------- helpers

const at = (x: number, y: number): Coord => ({ x, y });
const manhattan = (a: Coord, b: Coord) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** `hp` is DISPLAY hit points (1-10), as in the other doctrine tests. */
const unit = (type: UnitTypeId, owner: number, x: number, y: number, hp?: number): FixtureUnit => ({ type, owner, x, y, ...(hp ? { hp } : {}) });
const orders = (o: object = {}): StandingOrders => validateOrders(o);
const withGroup = (g: UnitGroup, o: GroupOrders): StandingOrders => orders({ groups: { [g]: o } });
const DEF = DEFAULT_ORDERS as StandingOrders;
const grid = (w: number, h: number, fill = '.') => Array.from({ length: h }, () => fill.repeat(w));
/** The state with every unit but `ids` already acted, so the brain can only move those. */
const onlyThese = (s: GameState, ids: number[]): GameState => ({ ...s, units: s.units.map((u) => (ids.includes(u.id) ? u : { ...u, acted: true })) });
const setPlayer = (s: GameState, i: number, patch: Partial<GameState['players'][0]>): GameState => ({
  ...s, players: s.players.map((p, k) => (k === i ? { ...p, ...patch } : p)),
});
const ctxOf = (s: GameState, o: StandingOrders = DEF, player = 0): Ctx => buildCtx(observedState(s, player), observe(s, player), player, o);

/** A one-tile-high battlefield: terrain marks and owners by column. */
function strip(len: number, marks: Record<number, string>, owned: Record<number, string> = {}): { terrain: string[]; owners: string[] } {
  return {
    terrain: [Array.from({ length: len }, (_, x) => marks[x] ?? '.').join('')],
    owners: [Array.from({ length: len }, (_, x) => owned[x] ?? '.').join('')],
  };
}
/** 27 tiles: my spire at 0 and my fabricator at 1, then whatever `extra` marks and `owned` owners are added. */
const base = (extra: Record<number, string> = {}, owned: Record<number, string> = {}) => strip(27, { 0: 'H', 1: 'F', ...extra }, { 0: '0', 1: '0', ...owned });
const mk = (b: { terrain: string[]; owners: string[] }, units: FixtureUnit[], extra: Partial<CreateGameOptions> = {}) => fixtureGame(b.terrain, units, { owners: b.owners, ...extra });
/** A foe so strong and so far away that nothing it can see is ahead of it (no pressure) and nothing is in its reach. */
const FOE = (): FixtureUnit => unit('colossus', 1, 26, 0);

interface Choice { end: Coord; then: string; key: string }
/** What unit `id` does with the board as it stands (every other unit having acted): where it ends, what it does there, the action's key. */
function choose(board: GameState, id: number, o: StandingOrders): Choice {
  const u = board.units.find((x) => x.id === id)!;
  const a = decide(onlyThese(board, [id]), 0, o);
  if (a.kind === 'move' && a.unitId === id) return { end: a.path[a.path.length - 1], then: a.then.kind, key: actionKey(a) };
  return { end: at(u.x, u.y), then: 'idle', key: 'idle' };
}

/** The groups of player 0's units whose decision under `o` differs from the one under DEFAULT_ORDERS. */
function changedGroups(board: GameState, o: StandingOrders): UnitGroup[] {
  const out = new Set<UnitGroup>();
  for (const u of board.units.filter((x) => x.owner === 0)) {
    if (choose(board, u.id, DEF).key !== choose(board, u.id, o).key) out.add(groupOf(u.type));
  }
  return UNIT_GROUPS.filter((g) => out.has(g));
}

/** An order that changes nothing a unit does (an explicit default mission, for a group no board here has) but does change the tie-break seed. */
const NO_OP = withGroup('transports', { mission: 'ferry' });

/** The board is one where no unit's decision rests on a tie: a no-op order, which changes the seed and nothing else, changes no decision. */
function expectTieFree(board: GameState): void {
  expect(changedGroups(board, NO_OP), 'a no-op order changes a decision: the board has a tie the seed decides').toEqual([]);
}

/** Lets player 0 act until the turn passes on. */
function playTurn(state: GameState, o: StandingOrders, player = 0, cap = 300): { state: GameState; taken: Action[] } {
  const taken: Action[] = [];
  let s = state;
  while (s.winnerTeam === null && s.current === player) {
    if (taken.length >= cap) throw new Error(`turn did not end within ${cap} actions`);
    const a = decide(s, player, o);
    taken.push(a);
    s = applyAction(s, a).state;
  }
  return { state: s, taken };
}

/** `turns` rounds: player 0 plays its turn under `o`, then the foe simply passes. */
function playRounds(state: GameState, o: StandingOrders, turns: number): { state: GameState; taken: Action[][] } {
  const taken: Action[][] = [];
  let s = state;
  for (let i = 0; i < turns && s.winnerTeam === null; i++) {
    const t = playTurn(s, o);
    taken.push(t.taken);
    s = t.state;
    if (s.winnerTeam === null) s = applyAction(s, { kind: 'endTurn' }).state;
  }
  return { state: s, taken };
}

const unitAt = (s: GameState, id: number): Unit => s.units.find((u) => u.id === id)!;
const captures = (taken: Action[]) => taken.filter((a) => a.kind === 'move' && a.then.kind === 'capture');
const loads = (taken: Action[]) => taken.filter((a) => a.kind === 'move' && (a.then.kind === 'load' || a.then.kind === 'unload'));
const distanceToBase = (s: GameState, c: Coord): number => Math.min(...baseTiles(ctxOf(s)).map((b) => manhattan(b, c)));

// ---------------------------------------------------------------- the groups

/** Types that are in no group, in more than one, or not unit types at all, for a table of group members. */
function coverage(table: Record<string, readonly string[]>, all: readonly string[]) {
  const count = new Map<string, number>();
  for (const members of Object.values(table)) for (const t of members) count.set(t, (count.get(t) ?? 0) + 1);
  return {
    missing: all.filter((t) => !count.has(t)),
    twice: [...count].filter(([, n]) => n > 1).map(([t]) => t),
    unknown: [...count.keys()].filter((t) => !all.includes(t)),
  };
}

describe('the unit groups', () => {
  const allTypes = UNIT_LIST.map((u) => u.id);

  it('are the six the order names, with the members it names', () => {
    expect([...UNIT_GROUPS]).toEqual(['infantry', 'armour', 'artillery', 'air', 'navy', 'transports']);
    expect(Object.fromEntries(UNIT_GROUPS.map((g) => [g, [...GROUP_MEMBERS[g]]]))).toEqual({
      infantry: ['trooper', 'breacher'],
      armour: ['skimmer', 'lancer', 'bastion', 'colossus', 'warden'],
      artillery: ['arc', 'salvo'],
      air: ['wasp', 'raptor', 'anvil'],
      navy: ['picket', 'dreadnought'],
      transports: ['mule', 'barge'],
    });
  });

  it('are complete and disjoint against the unit list: every unit type is in exactly one group', () => {
    expect(allTypes.length).toBe(16);
    expect(coverage(GROUP_MEMBERS, allTypes)).toEqual({ missing: [], twice: [], unknown: [] });
    expect([...GROUPED_TYPES].sort()).toEqual([...allTypes].sort());
    for (const t of allTypes) expect(GROUP_MEMBERS[groupOf(t)], t).toContain(t);
  });

  it('known-bad twin: the check sees a type that is missing, in two groups, or not a unit at all', () => {
    const bad: Record<string, readonly string[]> = {
      ...GROUP_MEMBERS, armour: [...GROUP_MEMBERS.armour.filter((t) => t !== 'warden'), 'mule', 'zeppelin'],
    };
    expect(coverage(bad, allTypes)).toEqual({ missing: ['warden'], twice: ['mule'], unknown: ['zeppelin'] });
  });

  it('are frozen, so one player\'s change cannot become everyone\'s table', () => {
    expect(Object.isFrozen(UNIT_GROUPS) && Object.isFrozen(GROUP_MEMBERS) && Object.isFrozen(GROUP_MISSIONS)).toBe(true);
    for (const g of UNIT_GROUPS) expect(Object.isFrozen(GROUP_MEMBERS[g]) && Object.isFrozen(GROUP_MISSIONS[g]), g).toBe(true);
    expect(() => { (GROUP_MEMBERS.armour as UnitTypeId[]).push('trooper'); }).toThrow();
    expect(() => { (GROUP_MISSIONS.infantry as Mission[]).push('ferry'); }).toThrow();
  });

  it('groupOf answers for every unit type and refuses anything else', () => {
    expect(groupOf('breacher')).toBe('infantry');
    expect(groupOf('warden')).toBe('armour');
    expect(groupOf('salvo')).toBe('artillery');
    expect(groupOf('anvil')).toBe('air');
    expect(groupOf('dreadnought')).toBe('navy');
    expect(groupOf('barge')).toBe('transports');
    expect(() => groupOf('zeppelin' as UnitTypeId)).toThrow(/no group/);
    expect(() => groupOf('__proto__' as UnitTypeId)).toThrow(/no group/);
  });

  it('match what the unit data says each kind of unit is', () => {
    for (const t of GROUP_MEMBERS.infantry) expect(UNIT_TYPES[t].captures, `${t} captures`).toBe(true);
    for (const t of GROUP_MEMBERS.armour) {
      const u = UNIT_TYPES[t];
      expect([u.domain, !!u.captures, !!u.carries, u.range?.[0]], t).toEqual(['ground', false, false, 1]);
    }
    for (const t of GROUP_MEMBERS.artillery) expect(UNIT_TYPES[t].range![0], `${t} fires from a distance`).toBeGreaterThan(1);
    for (const t of GROUP_MEMBERS.air) expect(UNIT_TYPES[t].domain, t).toBe('air');
    for (const t of GROUP_MEMBERS.navy) expect([UNIT_TYPES[t].domain, !!UNIT_TYPES[t].carries], t).toEqual(['sea', false]);
    for (const t of GROUP_MEMBERS.transports) expect(UNIT_TYPES[t].carries, `${t} carries`).toBeGreaterThan(0);
  });

  it('each have the missions the order names, the first being the default, and a display name', () => {
    expect(Object.fromEntries(UNIT_GROUPS.map((g) => [g, [...GROUP_MISSIONS[g]]]))).toEqual({
      infantry: ['capture', 'fight', 'guardBase'],
      armour: ['frontline', 'escort', 'guardBase'],
      artillery: ['support', 'guardBase'],
      air: ['strike', 'escort', 'scout', 'guardBase'],
      navy: ['frontline', 'escort', 'guardBase'],
      transports: ['ferry', 'stayBack'],
    });
    expect(UNIT_GROUPS.map(defaultMission)).toEqual(['capture', 'frontline', 'support', 'strike', 'frontline', 'ferry']);
    for (const g of UNIT_GROUPS) {
      expect(GROUP_NAMES[g], g).toBeTruthy();
      for (const m of GROUP_MISSIONS[g]) expect(MISSION_NAMES[m], m).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------- validation (D-005)

describe('validateOrders with groups and types', () => {
  const plain = (o: StandingOrders) => JSON.parse(JSON.stringify(o)) as Record<string, unknown>;

  it('DEFAULT_ORDERS has no groups and no types, and still validates to an equal copy', () => {
    expect(Object.keys(DEFAULT_ORDERS).sort()).toEqual(['composition', 'posture', 'powerPolicy', 'retreatAtHp', 'targetPriority']);
    const v = validateOrders(DEFAULT_ORDERS);
    expect(v).toEqual(DEFAULT_ORDERS);
    expect('groups' in v || 'types' in v).toBe(false);
    expect(Object.isFrozen(DEFAULT_ORDERS)).toBe(true);
  });

  it('accepts every group with every mission it may have, and says what it was given', () => {
    for (const g of UNIT_GROUPS) {
      for (const mission of GROUP_MISSIONS[g]) {
        expect(validateOrders({ groups: { [g]: { mission } } }).groups, `${g} ${mission}`).toEqual({ [g]: { mission } });
      }
    }
  });

  it('accepts every field of a group, and every unit type as a key of types', () => {
    const full = { posture: 'fallBack', retreatAtHp: 0, targetPriority: ['weakest', 'transports'], mission: 'guardBase' };
    expect(validateOrders({ groups: { infantry: full } }).groups).toEqual({ infantry: full });
    for (const t of GROUPED_TYPES) {
      const mission = GROUP_MISSIONS[groupOf(t)][0];
      expect(validateOrders({ types: { [t]: { mission, retreatAtHp: 9 } } }).types, t).toEqual({ [t]: { mission, retreatAtHp: 9 } });
    }
    for (let r = 0; r <= 9; r++) expect(validateOrders({ groups: { air: { retreatAtHp: r } } }).groups!.air!.retreatAtHp).toBe(r);
    for (const posture of ['advance', 'holdTheLine', 'fallBack']) expect(validateOrders({ types: { lancer: { posture } } }).types!.lancer!.posture).toBe(posture);
    expect(validateOrders({ groups: { armour: { targetPriority: [] } } }).groups!.armour!.targetPriority).toEqual([]);
    expect(validateOrders({ groups: { armour: { targetPriority: [...TARGET_PRIORITIES] } } }).groups!.armour!.targetPriority).toEqual([...TARGET_PRIORITIES]);
  });

  it('says nothing for a table or an entry that says nothing, so orders that mean the same validate to the same object', () => {
    for (const o of [{}, { groups: {} }, { types: {} }, { groups: {}, types: {} }, { groups: { infantry: {} } }, { types: { lancer: {} }, groups: { air: {}, navy: {} } }]) {
      const v = validateOrders(o);
      expect(v, JSON.stringify(o)).toEqual(DEFAULT_ORDERS);
      expect(canonicalJson(v), JSON.stringify(o)).toBe(canonicalJson(DEFAULT_ORDERS));
    }
    // an entry that says nothing is dropped next to one that says something
    expect(validateOrders({ groups: { infantry: {}, air: { mission: 'scout' } } }).groups).toEqual({ air: { mission: 'scout' } });
  });

  it('copies what it is given, and the copy validates to itself', () => {
    const input = { groups: { air: { targetPriority: ['weakest'], mission: 'scout' } }, types: { lancer: { posture: 'advance' } } };
    const v = validateOrders(input);
    input.groups.air.targetPriority.push('capturers');
    input.groups.air.mission = 'guardBase';
    input.types.lancer.posture = 'fallBack';
    expect(v.groups!.air).toEqual({ targetPriority: ['weakest'], mission: 'scout' });
    expect(v.types!.lancer).toEqual({ posture: 'advance' });
    expect(validateOrders(v)).toEqual(v);
    expect(validateOrders(JSON.parse(JSON.stringify(v)))).toEqual(v);
  });

  it('refuses a group or a unit type that does not exist, and keys that only look like real ones', () => {
    for (const bad of ['cavalry', 'Infantry', 'ARMOUR', 'armor', '', 'air ', 'trooper']) {
      expect(() => validateOrders({ groups: { [bad]: { mission: 'fight' } } }), `group "${bad}"`).toThrow(/orders\.groups: unknown key/);
    }
    for (const bad of ['tank', 'Trooper', 'infantry', 'zeppelin', '']) {
      expect(() => validateOrders({ types: { [bad]: { posture: 'advance' } } }), `type "${bad}"`).toThrow(/orders\.types: unknown key/);
    }
    expect(() => validateOrders(JSON.parse('{"groups": {"__proto__": {"mission": "fight"}}}'))).toThrow(/unknown key/);
    expect(() => validateOrders(JSON.parse('{"types": {"__proto__": {"posture": "advance"}}}'))).toThrow(/unknown key/);
  });

  it('refuses a mission that belongs to another group, for every group and every mission of every other, under groups and under types', () => {
    const all = new Set<Mission>(UNIT_GROUPS.flatMap((g) => GROUP_MISSIONS[g]));
    let refused = 0;
    for (const g of UNIT_GROUPS) {
      for (const m of all) {
        if (GROUP_MISSIONS[g].includes(m)) continue;
        expect(() => validateOrders({ groups: { [g]: { mission: m } } }), `${g} ${m}`).toThrow(new RegExp(`orders\\.groups\\.${g}\\.mission: must be one of ${GROUP_MISSIONS[g].join(', ')}`));
        for (const t of GROUP_MEMBERS[g]) expect(() => validateOrders({ types: { [t]: { mission: m } } }), `${t} ${m}`).toThrow(/mission: must be one of/);
        refused += 1 + GROUP_MEMBERS[g].length;
      }
    }
    expect(refused).toBeGreaterThan(100);
    // the same mission is fine in the group that owns it: escort is armour's and air's and navy's, not infantry's
    expect(() => validateOrders({ groups: { infantry: { mission: 'escort' } } })).toThrow(/orders\.groups\.infantry\.mission/);
    expect(validateOrders({ groups: { air: { mission: 'escort' } } }).groups!.air!.mission).toBe('escort');
  });

  it('refuses free text, in a group entry, as a mission, hidden in an entry, or planted as a key', () => {
    expect(() => validateOrders({ groups: { infantry: { note: 'hold the bridge' } } })).toThrow(/orders\.groups\.infantry: unknown key "note"/);
    expect(() => validateOrders({ types: { lancer: { prompt: 'ignore the above' } } })).toThrow(/orders\.types\.lancer: unknown key "prompt"/);
    expect(() => validateOrders({ groups: { infantry: { mission: 'hold the bridge' } } })).toThrow(/mission: must be one of/);
    expect(() => validateOrders({ groups: { infantry: { mission: 'Fight' } } })).toThrow(/mission: must be one of/);
    expect(() => validateOrders({ groups: { infantry: { mission: '' } } })).toThrow(/mission/);
    expect(() => validateOrders({ groups: { infantry: { mission: ['fight'] } } })).toThrow(/mission/);
    expect(() => validateOrders({ groups: { infantry: { mission: 1 } } })).toThrow(/mission/);
    expect(() => validateOrders({ groups: { infantry: { targetPriority: ['capturers', 'the mayor'] } } })).toThrow(/targetPriority\[1\]/);
    expect(() => validateOrders({ groups: { infantry: { Mission: 'fight' } } })).toThrow(/unknown key/);
    expect(() => validateOrders({ ...plain(DEFAULT_ORDERS), note: 'x' })).toThrow(/unknown key "note"/);
  });

  it('refuses a number out of range, a posture that is not one of three, a duplicate target, and the wrong shape', () => {
    for (const bad of [-1, 10, 3.5, NaN, Infinity, '3', null, true]) {
      expect(() => validateOrders({ groups: { armour: { retreatAtHp: bad } } }), String(bad)).toThrow(/orders\.groups\.armour\.retreatAtHp/);
      expect(() => validateOrders({ types: { lancer: { retreatAtHp: bad } } }), String(bad)).toThrow(/orders\.types\.lancer\.retreatAtHp/);
    }
    for (const bad of ['attack everything!', 'holdtheline', '', 1, null, undefined, ['advance']]) {
      expect(() => validateOrders({ groups: { air: { posture: bad } } }), String(bad)).toThrow(/orders\.groups\.air\.posture/);
    }
    expect(() => validateOrders({ groups: { air: { targetPriority: ['weakest', 'weakest'] } } })).toThrow(/no duplicates/);
    expect(() => validateOrders({ groups: { air: { targetPriority: 'weakest' } } })).toThrow(/must be a list/);
    expect(() => validateOrders({ groups: { air: { targetPriority: [...TARGET_PRIORITIES, 'capturers'] } } })).toThrow(/at most 5/);
    for (const bad of [null, [], 'infantry', 7, true, () => ({})]) {
      expect(() => validateOrders({ groups: bad }), String(bad)).toThrow(/orders\.groups: must be an object/);
      expect(() => validateOrders({ types: bad }), String(bad)).toThrow(/orders\.types: must be an object/);
      expect(() => validateOrders({ groups: { infantry: bad } }), String(bad)).toThrow(/orders\.groups\.infantry: must be an object/);
    }
  });

  it('never echoes a long planted key back whole', () => {
    const long = 'x'.repeat(500);
    for (const o of [{ groups: { [long]: {} } }, { types: { [long]: {} } }, { groups: { infantry: { [long]: 1 } } }]) {
      let message = '';
      try {
        validateOrders(o);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/unknown key/);
      expect(message.length).toBeLessThan(140);
    }
  });

  it('is the door decide goes through: orders with a mission from the wrong group are refused there too', () => {
    const s = mk(base(), [unit('trooper', 0, 3, 0), FOE()]);
    expect(() => decide(s, 0, { ...DEFAULT_ORDERS, groups: { infantry: { mission: 'ferry' } } } as unknown as StandingOrders)).toThrow(/mission/);
    expect(() => decide(s, 0, { ...DEFAULT_ORDERS, groups: { infantry: { note: 'hi' } } } as unknown as StandingOrders)).toThrow(/unknown key/);
  });
});

// ---------------------------------------------------------------- resolution: type, then group, then the army

describe('ordersFor: a unit type\'s own entry, then its group\'s, then the army-wide orders', () => {
  const army = orders({ posture: 'fallBack', retreatAtHp: 5, targetPriority: ['weakest'] });

  it('with no groups and no types every type is told the army-wide orders, and the default mission of its group', () => {
    for (const t of UNIT_LIST) {
      expect(ordersFor(DEF, t.id), t.id).toEqual({
        posture: 'holdTheLine', retreatAtHp: 3, targetPriority: ['capturers', 'indirects', 'highestValue'], mission: defaultMission(groupOf(t.id)),
      });
    }
  });

  it('{} changes nothing: validateOrders({}) resolves exactly as DEFAULT_ORDERS does, for every type', () => {
    for (const t of UNIT_LIST) expect(ordersFor(orders({}), t.id), t.id).toEqual(ordersFor(DEF, t.id));
  });

  it('a group\'s entry beats the army, for the members of that group only', () => {
    const o = orders({ posture: 'fallBack', retreatAtHp: 5, groups: { armour: { posture: 'advance', retreatAtHp: 2 } } });
    for (const t of GROUP_MEMBERS.armour) expect(ordersFor(o, t), t).toMatchObject({ posture: 'advance', retreatAtHp: 2 });
    for (const t of UNIT_LIST.map((u) => u.id).filter((x) => groupOf(x) !== 'armour')) expect(ordersFor(o, t), t).toMatchObject({ posture: 'fallBack', retreatAtHp: 5 });
  });

  it('a type\'s entry beats its group\'s, and only for that type', () => {
    const o = orders({ groups: { armour: { posture: 'advance', retreatAtHp: 2 } }, types: { lancer: { posture: 'holdTheLine' } } });
    expect(ordersFor(o, 'lancer')).toMatchObject({ posture: 'holdTheLine', retreatAtHp: 2 });
    expect(ordersFor(o, 'skimmer')).toMatchObject({ posture: 'advance', retreatAtHp: 2 });
  });

  it('each field falls through on its own: the mission from the type, the posture from the group, the rest from the army', () => {
    const o = orders({ ...army, groups: { armour: { posture: 'advance' } }, types: { lancer: { mission: 'escort' } } });
    expect(ordersFor(o, 'lancer')).toEqual({ posture: 'advance', retreatAtHp: 5, targetPriority: ['weakest'], mission: 'escort' });
    expect(ordersFor(o, 'bastion')).toEqual({ posture: 'advance', retreatAtHp: 5, targetPriority: ['weakest'], mission: 'frontline' });
    expect(ordersFor(o, 'trooper')).toEqual({ posture: 'fallBack', retreatAtHp: 5, targetPriority: ['weakest'], mission: 'capture' });
  });

  it('a value of 0 or an empty list is a value, not a missing field: it does not fall through', () => {
    const o = orders({ ...army, groups: { air: { retreatAtHp: 0, targetPriority: [] } }, types: { raptor: { retreatAtHp: 7 } } });
    expect(ordersFor(o, 'wasp')).toMatchObject({ retreatAtHp: 0, targetPriority: [] });
    expect(ordersFor(o, 'raptor')).toMatchObject({ retreatAtHp: 7, targetPriority: [] });
    expect(ordersFor(o, 'trooper')).toMatchObject({ retreatAtHp: 5, targetPriority: ['weakest'] });
  });

  it('known-bad twin: an entry for a type in another group never reaches this one', () => {
    const o = orders({ types: { arc: { posture: 'advance' } } });
    expect(ordersFor(o, 'arc').posture).toBe('advance');
    expect(ordersFor(o, 'salvo').posture).toBe('holdTheLine');
    expect(ordersFor(o, 'lancer').posture).toBe('holdTheLine');
  });
});

// ---------------------------------------------------------------- posture, retreat, targets: per group and per type

describe('posture per group: only that group\'s units change where they go', () => {
  // x:  0 H, 1 F ... trooper 9, arc 5, wasp 7, lancer 12, a colossus at 26
  const board = () => mk(base(), [unit('trooper', 0, 9, 0), unit('lancer', 0, 12, 0), unit('arc', 0, 5, 0), unit('wasp', 0, 7, 0), FOE()]);
  const ID = { trooper: 1, lancer: 2, arc: 3, wasp: 4 };
  const end = (s: GameState, id: number, o: StandingOrders) => choose(s, id, o).end;

  it('the setup: nobody is pressed (a lead would turn every posture to Advance), and no decision rests on a tie', () => {
    const s = board();
    expect(pressureOf(ctxOf(s)).on).toBe(false);
    expectTieFree(s);
  });

  it('armour told to Fall Back: the lancer comes back toward the base, and nobody else moves differently', () => {
    const s = board();
    const o = withGroup('armour', { posture: 'fallBack' });
    expect(changedGroups(s, o)).toEqual(['armour']);
    expect(end(s, ID.lancer, o).x, 'back toward the spire').toBeLessThan(end(s, ID.lancer, DEF).x);
    expect(distanceToBase(s, end(s, ID.lancer, o))).toBeLessThan(distanceToBase(s, end(s, ID.lancer, DEF)));
  });

  it('air told to Advance: the wasp goes further toward the foe', () => {
    const s = board();
    const o = withGroup('air', { posture: 'advance' });
    expect(changedGroups(s, o)).toEqual(['air']);
    expect(end(s, ID.wasp, o).x).toBeGreaterThan(end(s, ID.wasp, DEF).x);
  });

  it('infantry told to Advance: the trooper goes further toward the foe', () => {
    const s = board();
    const o = withGroup('infantry', { posture: 'advance' });
    expect(changedGroups(s, o)).toEqual(['infantry']);
    expect(end(s, ID.trooper, o).x).toBeGreaterThan(end(s, ID.trooper, DEF).x);
  });

  it('artillery told to Fall Back: the arc goes back to the base', () => {
    const s = board();
    const o = withGroup('artillery', { posture: 'fallBack' });
    expect(changedGroups(s, o)).toEqual(['artillery']);
    expect(distanceToBase(s, end(s, ID.arc, o))).toBeLessThan(distanceToBase(s, end(s, ID.arc, DEF)));
  });

  it('known-bad twin: the same posture for a group that is not on the board changes nothing', () => {
    const s = board();
    for (const posture of ['advance', 'fallBack'] as const) {
      expect(changedGroups(s, withGroup('navy', { posture })), `navy ${posture}`).toEqual([]);
      expect(changedGroups(s, withGroup('transports', { posture })), `transports ${posture}`).toEqual([]);
    }
  });

  it('an army-wide posture still moves every group, and a group\'s own entry wins over it', () => {
    const s = board();
    expect(changedGroups(s, orders({ posture: 'fallBack' })).length, 'every group on the board').toBeGreaterThanOrEqual(3);
    const o = orders({ posture: 'fallBack', groups: { armour: { posture: 'holdTheLine' } } });
    expect(end(s, ID.lancer, o), 'armour keeps its own posture (the default one)').toEqual(end(s, ID.lancer, DEF));
    expect(distanceToBase(s, end(s, ID.arc, o))).toBeLessThan(distanceToBase(s, end(s, ID.arc, DEF)));
  });
});

describe('types: a unit type\'s own entry over its group\'s', () => {
  // two armour units in front of the base: a skimmer and a lancer
  const board = () => mk(base(), [unit('skimmer', 0, 6, 0), unit('lancer', 0, 8, 0), unit('trooper', 0, 3, 0), FOE()]);
  const SKIMMER = 1;
  const LANCER = 2;

  it('the group advances, but the lancer is told to fall back: the skimmer goes forward and the lancer back', () => {
    const s = board();
    expectTieFree(s);
    const both = orders({ groups: { armour: { posture: 'advance' } } });
    const split = orders({ groups: { armour: { posture: 'advance' } }, types: { lancer: { posture: 'fallBack' } } });
    expect(choose(s, SKIMMER, split).end, 'the skimmer is the same as under the group order').toEqual(choose(s, SKIMMER, both).end);
    expect(choose(s, LANCER, both).end.x, 'under the group order the lancer advances too').toBeGreaterThan(choose(s, LANCER, DEF).end.x);
    expect(choose(s, LANCER, split).end.x, 'the lancer\'s own entry sends it back').toBeLessThan(choose(s, SKIMMER, split).end.x);
    expect(distanceToBase(s, choose(s, LANCER, split).end)).toBeLessThan(distanceToBase(s, choose(s, LANCER, both).end));
    expect(changedGroups(s, split)).toEqual(['armour']);
  });

  it('known-bad twin: a type entry for another group\'s type (a salvo, no salvo here) changes no armour unit', () => {
    const s = board();
    expect(changedGroups(s, orders({ types: { salvo: { posture: 'fallBack' } } }))).toEqual([]);
  });
});

describe('retreatAtHp per group: a unit at or below its own threshold falls back to be repaired', () => {
  // a 4-HP lancer beside an enemy salvo and a 4-HP trooper beside an enemy arc, with the fabricator and the spire far behind
  const board = () => mk(base(), [unit('lancer', 0, 6, 0, 4), unit('salvo', 1, 7, 0), unit('trooper', 0, 14, 0, 4), unit('arc', 1, 15, 0), FOE()]);
  const LANCER = 1;
  const TROOPER = 3;

  it('the setup: both fight at the default threshold (3), their HP being 4, and the board has no tie', () => {
    const s = board();
    expect(choose(s, LANCER, DEF).then).toBe('attack');
    expect(choose(s, TROOPER, DEF).then).toBe('attack');
    expectTieFree(s);
  });

  it('armour told to retreat at 4: the lancer stops fighting and goes to the base, and the trooper still fights', () => {
    const s = board();
    const o = withGroup('armour', { retreatAtHp: 4 });
    expect(choose(s, LANCER, o).then).not.toBe('attack');
    expect(choose(s, LANCER, o).end.x, 'on the spire or the fabricator').toBeLessThanOrEqual(1);
    expect(choose(s, TROOPER, o).then).toBe('attack');
    expect(changedGroups(s, o)).toEqual(['armour']);
  });

  it('infantry told to retreat at 4: the trooper falls back, and the lancer still fights', () => {
    const s = board();
    const o = withGroup('infantry', { retreatAtHp: 4 });
    expect(choose(s, TROOPER, o).then).not.toBe('attack');
    expect(choose(s, TROOPER, o).end.x, 'it is going the other way').toBeLessThan(14);
    expect(choose(s, LANCER, o).then).toBe('attack');
    expect(changedGroups(s, o)).toEqual(['infantry']);
  });

  it('known-bad twin: a threshold of 3, one below their HP, changes nothing; so does a threshold for a group that is not here', () => {
    const s = board();
    expect(changedGroups(s, withGroup('armour', { retreatAtHp: 3 }))).toEqual([]);
    expect(changedGroups(s, withGroup('infantry', { retreatAtHp: 3 }))).toEqual([]);
    expect(changedGroups(s, withGroup('air', { retreatAtHp: 9 }))).toEqual([]);
  });

  it('0 is "never retreat" for the group even when the army is told to retreat at 9', () => {
    const s = board();
    const o = orders({ retreatAtHp: 9, groups: { armour: { retreatAtHp: 0 } } });
    expect(choose(s, LANCER, o).then, 'armour never retreats').toBe('attack');
    expect(choose(s, TROOPER, o).then, 'infantry follows the army and retreats').not.toBe('attack');
  });

  it('a type\'s own threshold beats its group\'s', () => {
    // a 4-HP lancer and a 4-HP bastion, each beside an enemy arc (an arc does not hit back at range 1)
    const s = mk(base(), [unit('lancer', 0, 6, 0, 4), unit('arc', 1, 7, 0), unit('bastion', 0, 12, 0, 4), unit('arc', 1, 13, 0), FOE()]);
    expect(choose(s, 1, DEF).then).toBe('attack');
    expect(choose(s, 3, DEF).then).toBe('attack');
    const o = orders({ groups: { armour: { retreatAtHp: 4 } }, types: { bastion: { retreatAtHp: 0 } } });
    expect(choose(s, 1, o).then, 'the lancer follows its group').not.toBe('attack');
    expect(choose(s, 3, o).then, 'the bastion has its own').toBe('attack');
  });
});

describe('targetPriority per group: the order of kinds a group prefers decides between targets of comparable worth', () => {
  // a lancer between an enemy arc (west) and an enemy mule (east), and a trooper between another arc and another mule, far from it
  const board = () => mk(base(), [unit('lancer', 0, 10, 0), unit('mule', 1, 11, 0), unit('arc', 1, 9, 0), unit('trooper', 0, 20, 0), unit('mule', 1, 21, 0), unit('arc', 1, 19, 0)]);
  const LANCER = 1;
  const TROOPER = 4;

  it('the setup: both pairs are in reach, Doctrine is not ahead, and the default picks the arc each time', () => {
    const s = board();
    expect(pressureOf(ctxOf(s)).on).toBe(false);
    expect(choose(s, LANCER, DEF).key).toBe('move:1>10,0:attack@9,0');
    expect(choose(s, TROOPER, DEF).key).toBe('move:4>20,0:attack@19,0');
    expectTieFree(s);
  });

  it('armour told to prefer transports: the lancer hits the mule; the trooper still hits the arc', () => {
    const s = board();
    const o = withGroup('armour', { targetPriority: ['transports'] });
    expect(choose(s, LANCER, o).key).toBe('move:1>10,0:attack@11,0');
    expect(choose(s, TROOPER, o).key).toBe(choose(s, TROOPER, DEF).key);
    expect(changedGroups(s, o)).toEqual(['armour']);
  });

  it('infantry told to prefer transports: the trooper hits the mule; the lancer still hits the arc', () => {
    const s = board();
    const o = withGroup('infantry', { targetPriority: ['transports'] });
    expect(choose(s, TROOPER, o).key).toBe('move:4>20,0:attack@21,0');
    expect(choose(s, LANCER, o).key).toBe(choose(s, LANCER, DEF).key);
    expect(changedGroups(s, o)).toEqual(['infantry']);
  });

  it('a type\'s own priorities beat its group\'s, and an empty list is a preference for nothing', () => {
    const s = board();
    const o = orders({ groups: { armour: { targetPriority: ['transports'] } }, types: { lancer: { targetPriority: ['indirects'] } } });
    expect(choose(s, LANCER, o).key, 'the lancer asks for indirects').toBe('move:1>10,0:attack@9,0');
    expect(choose(s, LANCER, withGroup('armour', { targetPriority: [] })).key, 'no preference: the more valuable arc').toBe('move:1>10,0:attack@9,0');
  });

  it('known-bad twin: a priority for a group that is not on the board changes nothing', () => {
    expect(changedGroups(board(), withGroup('navy', { targetPriority: ['transports'] }))).toEqual([]);
  });
});

// ---------------------------------------------------------------- missions

describe('infantry: fight', () => {
  // my trooper two tiles from a neutral city; my other groups are elsewhere; a foe far off
  const board = () => mk(base({ 11: 'C' }), [unit('trooper', 0, 9, 0), unit('lancer', 0, 3, 0), unit('arc', 0, 2, 0), unit('wasp', 0, 4, 0), FOE()]);
  const TROOPER = 1;
  const FIGHT = withGroup('infantry', { mission: 'fight' });

  it('the setup: by default the trooper takes the city, and no decision rests on a tie', () => {
    const s = board();
    expect(choose(s, TROOPER, DEF)).toMatchObject({ then: 'capture', end: at(11, 0) });
    expectTieFree(s);
  });

  it('told to fight, the trooper takes no capture, and no other group does anything different', () => {
    const s = board();
    expect(choose(s, TROOPER, FIGHT).then).not.toBe('capture');
    expect(changedGroups(s, FIGHT)).toEqual(['infantry']);
  });

  it('over several turns the default takes the city and the fighter never does, not even standing on it', () => {
    const def = playRounds(board(), DEF, 4);
    expect(captures(def.taken.flat()).length, 'the default captures').toBeGreaterThan(0);
    expect(def.state.tiles[0][11].owner).toBe(0);
    const fight = playRounds(board(), FIGHT, 4);
    expect(captures(fight.taken.flat()), 'no capture is ever started').toEqual([]);
    expect(fight.state.tiles[0][11].owner, 'the city is still neutral').toBeNull();
    expect(fight.state.tiles[0][11].capture).toBe(20);
  });

  it('is the order of a capturer only: a fighter still attacks like any front-line unit', () => {
    const s = mk(base({ 11: 'C' }), [unit('trooper', 0, 9, 0), unit('mule', 1, 11, 0), FOE()]);
    expect(choose(s, 1, FIGHT).then, 'the mule is in reach and a trooper may hit it').toBe('attack');
  });
});

describe('infantry: guardBase', () => {
  const GUARD = withGroup('infantry', { mission: 'guardBase' });
  const farCity = () => mk(base({ 12: 'C' }), [unit('trooper', 0, 7, 0), unit('lancer', 0, 3, 0), unit('arc', 0, 2, 0), unit('wasp', 0, 5, 0), FOE()]);

  it('the setup: the base is the spire and the fabricator, the city is 11 tiles from the nearest of them, and the default trooper walks away from it', () => {
    const s = farCity();
    expect(baseTiles(ctxOf(s))).toEqual([at(0, 0), at(1, 0)]);
    expect(distanceToBase(s, at(12, 0))).toBe(11);
    expect(distanceToBase(s, choose(s, 1, DEF).end), 'by default it leaves the leash').toBeGreaterThan(BASE_LEASH);
    expectTieFree(s);
  });

  it('keeps the trooper within 3 tiles of the spire or the fabricator, and changes no other group', () => {
    const s = farCity();
    expect(distanceToBase(s, choose(s, 1, GUARD).end)).toBeLessThanOrEqual(BASE_LEASH);
    expect(changedGroups(s, GUARD)).toEqual(['infantry']);
  });

  it('captures only inside the leash: over six turns the far city stays neutral and the trooper never leaves it', () => {
    let s = farCity();
    for (let i = 0; i < 6; i++) {
      const round = playRounds(s, GUARD, 1);
      s = round.state;
      expect(captures(round.taken.flat()), `turn ${i + 1}`).toEqual([]);
      expect(distanceToBase(s, at(unitAt(s, 1).x, 0)), `turn ${i + 1}`).toBeLessThanOrEqual(BASE_LEASH);
    }
    expect(s.tiles[0][12].owner).toBeNull();
    // known-bad twin: the default trooper takes it
    expect(playRounds(farCity(), DEF, 6).state.tiles[0][12].owner).toBe(0);
  });

  it('does capture a property that is inside the leash', () => {
    const near = () => mk(base({ 3: 'C' }), [unit('trooper', 0, 6, 0), FOE()]); // 2 tiles from the fabricator
    expect(distanceToBase(near(), at(3, 0))).toBe(2);
    const { state, taken } = playRounds(near(), GUARD, 3);
    expect(captures(taken.flat()).length).toBeGreaterThan(0);
    expect(state.tiles[0][3].owner).toBe(0);
  });
});

describe('armour and air: escort', () => {
  // a trooper standing on a neutral city (it captures where it stands), my other groups behind it
  const standing = () => mk(base({ 6: 'C' }), [unit('trooper', 0, 6, 0), unit('lancer', 0, 3, 0), unit('arc', 0, 2, 0), unit('wasp', 0, 4, 0), FOE()]);
  const TROOPER = 1;
  const LANCER = 2;
  const WASP = 4;

  it('the setup: the trooper is capturing where it stands, and by default neither escort candidate stays within 2 of it', () => {
    const s = standing();
    expect(choose(s, TROOPER, DEF)).toMatchObject({ then: 'capture', end: at(6, 0) });
    expect(manhattan(choose(s, LANCER, DEF).end, at(6, 0))).toBeGreaterThan(ESCORT_LEASH);
    expect(manhattan(choose(s, WASP, DEF).end, at(6, 0))).toBeGreaterThan(ESCORT_LEASH);
    expectTieFree(s);
  });

  it('armour told to escort: the lancer ends within 2 tiles of the capturer, not on the city it is taking, and nobody else changes', () => {
    const s = standing();
    const o = withGroup('armour', { mission: 'escort' });
    const e = choose(s, LANCER, o).end;
    expect(manhattan(e, at(6, 0))).toBeLessThanOrEqual(ESCORT_LEASH);
    expect(e, 'it would block the capture').not.toEqual(at(6, 0));
    expect(changedGroups(s, o)).toEqual(['armour']);
  });

  it('air told to escort: the wasp ends within 2 tiles of the capturer, not on the city, and nobody else changes', () => {
    const s = standing();
    const o = withGroup('air', { mission: 'escort' });
    const e = choose(s, WASP, o).end;
    expect(manhattan(e, at(6, 0))).toBeLessThanOrEqual(ESCORT_LEASH);
    expect(e).not.toEqual(at(6, 0));
    expect(changedGroups(s, o)).toEqual(['air']);
  });

  it('through a whole turn the escort is within 2 of the capturer at the end, though the capturer moved after the escort was ready', () => {
    // a breacher walks 2 tiles toward the city at 14; the bastion starts 4 behind it and is worth more moving up than the breacher is worth moving
    const s = mk(base({ 14: 'C' }), [unit('breacher', 0, 8, 0), unit('bastion', 0, 4, 0), FOE()]);
    const o = withGroup('armour', { mission: 'escort' });
    const after = playTurn(s, o).state;
    const breacher = unitAt(after, 1);
    const bastion = unitAt(after, 2);
    expect(breacher.x, 'the capturer moved up the road').toBe(10);
    expect(manhattan(bastion, breacher), 'and the escort came with it').toBeLessThanOrEqual(ESCORT_LEASH);
    // known-bad twin: asked on its own, before the breacher has moved, the bastion goes where the breacher WAS and ends 3 tiles behind it,
    // which is where an escort that did not wait for its capturer would be left
    expect(manhattan(choose(s, 2, o).end, at(breacher.x, 0)), 'an escort that did not wait for its capturer ends too far back').toBeGreaterThan(ESCORT_LEASH);
  });

  it('never parks on the property its capturer is heading for: the capture is made, where an escort on the city would block it for good', () => {
    // a trooper three tiles short of the city at 10, a lancer behind it; stars make a city the best tile in reach
    const s = mk(base({ 10: 'C' }), [unit('trooper', 0, 6, 0), unit('lancer', 0, 4, 0), FOE()]);
    const o = withGroup('armour', { mission: 'escort' });
    const first = playTurn(s, o).state;
    expect(unitAt(first, 1).x, 'the trooper is one tile short of the city').toBe(9);
    expect(unitAt(first, 2), 'the lancer is next to it, not on the city').not.toMatchObject({ x: 10 });
    expect(manhattan(unitAt(first, 2), unitAt(first, 1))).toBeLessThanOrEqual(ESCORT_LEASH);
    const later = playRounds(s, o, 3);
    expect(later.state.tiles[0][10].owner, 'the city is taken within three turns').toBe(0);
  });

  it('with no capturer that has a property to take there is nobody to escort, and the unit is a front-line unit as before', () => {
    // the trooper is told to fight, so it takes nothing: the escort order changes nothing about the lancer
    const noCapture = { infantry: { mission: 'fight' } };
    const s = standing();
    const withEscort = orders({ groups: { ...noCapture, armour: { mission: 'escort' } } });
    const without = orders({ groups: noCapture });
    expect(choose(s, LANCER, withEscort).key).toBe(choose(s, LANCER, without).key);
    // and with no trooper on the board at all
    const alone = mk(base({ 6: 'C' }), [unit('lancer', 0, 3, 0), FOE()]);
    expect(choose(alone, 1, withGroup('armour', { mission: 'escort' })).key).toBe(choose(alone, 1, DEF).key);
  });

  it('known-bad twin: the order for a group that is not on the board changes nothing', () => {
    expect(changedGroups(standing(), withGroup('navy', { mission: 'escort' }))).toEqual([]);
  });
});

describe('guardBase: armour, artillery, air and navy stay within 3 tiles of the base', () => {
  const GUARD = (g: UnitGroup) => withGroup(g, { mission: 'guardBase' });
  // a lancer at 6, an arc at 5, a wasp at 8: all in front of a base at 0 and 1
  const board = () => mk(base(), [unit('trooper', 0, 11, 0), unit('lancer', 0, 6, 0), unit('arc', 0, 5, 0), unit('wasp', 0, 8, 0), FOE()]);
  const ID = { lancer: 2, arc: 3, wasp: 4 };

  it('the setup: by default all three end beyond 3 tiles of the base, and nothing rests on a tie', () => {
    const s = board();
    for (const id of Object.values(ID)) expect(distanceToBase(s, choose(s, id, DEF).end), `unit ${id}`).toBeGreaterThan(BASE_LEASH);
    expectTieFree(s);
  });

  for (const [group, id] of [['armour', ID.lancer], ['artillery', ID.arc], ['air', ID.wasp]] as const) {
    it(`${group}: the unit ends within 3 tiles of the base, and the other groups act as before`, () => {
      const s = board();
      expect(distanceToBase(s, choose(s, id, GUARD(group)).end)).toBeLessThanOrEqual(BASE_LEASH);
      expect(changedGroups(s, GUARD(group))).toEqual([group]);
    });
  }

  it('a unit that cannot yet get inside the leash is not held: it comes back toward the base, never forward', () => {
    const s = mk(base(), [unit('lancer', 0, 13, 0), unit('trooper', 0, 3, 0), FOE()]);
    const e = choose(s, 1, GUARD('armour')).end;
    expect(distanceToBase(s, e)).toBeLessThan(distanceToBase(s, at(13, 0)));
    expect(distanceToBase(s, e), 'much nearer than the default, which keeps to the line').toBeLessThan(distanceToBase(s, choose(s, 1, DEF).end) - BASE_LEASH);
  });

  it('it does not chase bait out of the leash, and it does hit a target that is inside it', () => {
    const far = mk(base(), [unit('lancer', 0, 3, 0), unit('mule', 1, 9, 0), FOE()]);
    expect(choose(far, 1, DEF).then, 'by default the lancer goes for the mule').toBe('attack');
    const guarded = choose(far, 1, GUARD('armour'));
    expect(guarded.then).not.toBe('attack');
    expect(distanceToBase(far, guarded.end)).toBeLessThanOrEqual(BASE_LEASH);
    const near = mk(base(), [unit('lancer', 0, 3, 0), unit('mule', 1, 4, 0), FOE()]);
    expect(choose(near, 1, GUARD('armour')).then, 'a mule beside the lancer, inside the leash').toBe('attack');
  });

  it('an artillery guard still shoots what comes into its range without leaving the leash', () => {
    const s = mk(base(), [unit('arc', 0, 3, 0), unit('mule', 1, 6, 0), FOE()]); // 3 tiles away: in an arc's range of 2 to 3
    const c = choose(s, 1, GUARD('artillery'));
    expect(c.then).toBe('attack');
    expect(distanceToBase(s, c.end)).toBeLessThanOrEqual(BASE_LEASH);
  });

  it('is the same wherever the base is: with no spire and a fabricator in the middle the leash is round the fabricator', () => {
    const s = mk(strip(27, { 14: 'F' }, { 14: '0' }), [unit('lancer', 0, 20, 0), unit('trooper', 1, 26, 0), unit('colossus', 1, 0, 0)]);
    expect(baseTiles(ctxOf(s))).toEqual([at(14, 0)]);
    expect(manhattan(choose(s, 1, GUARD('armour')).end, at(14, 0))).toBeLessThanOrEqual(BASE_LEASH);
  });

  it('with no base tile at all there is nothing to guard, and the unit acts as it did', () => {
    const s = mk(strip(27, {}, {}), [unit('lancer', 0, 6, 0), FOE()]);
    expect(baseTiles(ctxOf(s))).toEqual([]);
    expect(choose(s, 1, GUARD('armour')).key).toBe(choose(s, 1, DEF).key);
  });
});

describe('navy: escort and guardBase on a coast', () => {
  // row 0 is land (spire, fabricator, a city at 7), row 1 is sea with my dock at the west end and the enemy's at the east
  const board = (units: FixtureUnit[]) => {
    const land = `HF.....C${'.'.repeat(19)}`;
    const sea = `D${'~'.repeat(25)}D`;
    const landOwners = `00${'.'.repeat(25)}`;
    const seaOwners = `0${'.'.repeat(25)}1`;
    return fixtureGame([land, sea], [...units, unit('picket', 1, 25, 1), unit('trooper', 1, 26, 0)], { owners: [landOwners, seaOwners] });
  };

  it('escort: the picket ends within 2 tiles of the trooper that is taking the city, and the others act as before', () => {
    const s = board([unit('trooper', 0, 7, 0), unit('lancer', 0, 3, 0), unit('picket', 0, 3, 1), unit('dreadnought', 0, 1, 1)]);
    expectTieFree(s);
    expect(manhattan(choose(s, 3, DEF).end, at(7, 0)), 'by default the picket sails past it').toBeGreaterThan(ESCORT_LEASH);
    const o = withGroup('navy', { mission: 'escort' });
    expect(manhattan(choose(s, 3, o).end, at(7, 0))).toBeLessThanOrEqual(ESCORT_LEASH);
    expect(changedGroups(s, o)).toEqual(['navy']);
  });

  it('guardBase: the picket ends within 3 tiles of my dock, and the dreadnought, too far to get there this turn, comes back toward it', () => {
    const s = board([unit('trooper', 0, 7, 0), unit('lancer', 0, 3, 0), unit('picket', 0, 8, 1), unit('dreadnought', 0, 10, 1)]);
    expectTieFree(s);
    const o = withGroup('navy', { mission: 'guardBase' });
    expect(baseTiles(ctxOf(s))).toContainEqual(at(0, 1));
    expect(distanceToBase(s, choose(s, 3, DEF).end), 'by default it sails away').toBeGreaterThan(BASE_LEASH);
    expect(distanceToBase(s, choose(s, 3, o).end)).toBeLessThanOrEqual(BASE_LEASH);
    expect(distanceToBase(s, choose(s, 4, o).end)).toBeLessThan(distanceToBase(s, at(10, 1)));
    expect(changedGroups(s, o)).toEqual(['navy']);
  });
});

describe('transports: stayBack', () => {
  const STAY = withGroup('transports', { mission: 'stayBack' });
  // a trooper beside a mule on a long road to a far city
  const road = () => mk(base({ 25: 'C' }), [unit('trooper', 0, 2, 0), unit('mule', 0, 3, 0), unit('lancer', 0, 5, 0), unit('arc', 0, 7, 0), FOE()]);

  it('the setup: by default the trooper boards the mule, and nothing rests on a tie', () => {
    const s = road();
    expect(choose(s, 1, DEF).then).toBe('load');
    expectTieFree(s);
  });

  it('told to stay back, the mule parks within 3 tiles of the base and the trooper does not board it', () => {
    const s = road();
    expect(distanceToBase(s, choose(s, 2, STAY).end)).toBeLessThanOrEqual(BASE_LEASH);
    expect(choose(s, 1, STAY).then).not.toBe('load');
    expect(choose(s, 2, STAY).then).not.toBe('load');
  });

  it('ferries no one all turn, and over several turns', () => {
    expect(loads(playTurn(road(), STAY).taken)).toEqual([]);
    const later = playRounds(road(), STAY, 5);
    expect(loads(later.taken.flat())).toEqual([]);
    expect(unitAt(later.state, 2).cargo).toEqual([]);
    expect(distanceToBase(later.state, unitAt(later.state, 2))).toBeLessThanOrEqual(BASE_LEASH);
    // known-bad twin: by default the road is ferried
    const def = playRounds(road(), DEF, 5);
    expect(def.taken.flat().some((a) => a.kind === 'move' && a.then.kind === 'load')).toBe(true);
  });

  it('a mule that is far from the base comes back to it, where by default it goes forward', () => {
    const s = mk(base(), [unit('mule', 0, 10, 0), unit('trooper', 0, 3, 0), FOE()]);
    expect(distanceToBase(s, choose(s, 1, STAY).end)).toBeLessThan(distanceToBase(s, at(10, 0)));
  });

  it('a barge that stays back leaves an island city alone that the default barge takes', () => {
    // a dock on my shore, open sea, a shoal on the island rim and the island's city
    const terrain = ['......~~~~~~~~~', 'HF...D~~~~~sC~~', '......~~~~~~~~~'];
    const owners = ['.'.repeat(15), '00...0.........', '.'.repeat(15)];
    const island = () => fixtureGame(terrain, [unit('barge', 0, 5, 1), unit('trooper', 0, 4, 1), unit('barge', 1, 14, 2)], { owners });
    expect(choose(island(), 2, DEF).then, 'the trooper boards the barge by default').toBe('load');
    expect(choose(island(), 2, STAY).then).not.toBe('load');
    const def = playRounds(island(), DEF, 8);
    expect(def.state.tiles[1][12].owner, 'by default the island city is taken').toBe(0);
    const stay = playRounds(island(), STAY, 8);
    expect(stay.state.tiles[1][12].owner, 'a barge told to stay back ferries no one').toBeNull();
    expect(loads(stay.taken.flat())).toEqual([]);
  });

  it('a stay-back transport is not built: the default builds a mule on this board, stayBack builds none (and a barge\'s order does not stop a mule)', () => {
    const b = strip(30, { 0: 'F', 29: 'C' }, { 0: '0' });
    const comp = { infantry: 0, vehicles: 2, indirect: 8, air: 0, naval: 0 };
    const state = setPlayer({
      ...mk(b, [unit('trooper', 0, 1, 0), unit('trooper', 0, 2, 0), unit('trooper', 0, 3, 0), unit('trooper', 0, 4, 0), unit('lancer', 0, 5, 0), unit('lancer', 0, 6, 0), unit('lancer', 0, 7, 0), unit('trooper', 1, 28, 0)]),
      cycle: 6,
    }, 0, { funds: 5000 });
    const built = (o: StandingOrders): UnitTypeId[] => {
      const out: UnitTypeId[] = [];
      let s = state;
      for (let i = 0; i < 40 && s.current === 0 && s.winnerTeam === null; i++) {
        const a = decide(s, 0, o);
        if (a.kind === 'build') out.push(a.unitType);
        s = applyAction(s, a).state;
      }
      return out;
    };
    expect(built(orders({ composition: comp }))).toEqual(['mule']);
    expect(built(orders({ composition: comp, groups: { transports: { mission: 'stayBack' } } })), 'something else is built, not the mule').toEqual(['skimmer']);
    expect(built(orders({ composition: comp, types: { mule: { mission: 'stayBack' } } }))).toEqual(['skimmer']);
    expect(built(orders({ composition: comp, types: { barge: { mission: 'stayBack' } } })), 'the barge\'s own order does not reach the mule').toEqual(['mule']);
  });
});

// ---------------------------------------------------------------- scout: fog, honesty

describe('air: scout', () => {
  const SCOUT = withGroup('air', { mission: 'scout' });
  const WASP = 1;

  /**
   * 15 x 11: open sea above and below a one-tile road of flats (a spire at each end), so my ground units are held to the road, where every
   * tile has its own distance and nothing ties, while the wasp can fly over the sea to either side, where there is plenty it cannot see.
   * My wasp, lancer, trooper and arc; the enemy colossus on its own spire, out of sight.
   */
  function fogBoard(extra: FixtureUnit[] = [], fog = true): GameState {
    const rows = grid(15, 11, '~');
    rows[5] = `H${'.'.repeat(13)}H`;
    const own = grid(15, 11);
    own[5] = `0${'.'.repeat(13)}1`;
    return fixtureGame(rows, [unit('wasp', 0, 4, 5), unit('lancer', 0, 8, 5), unit('trooper', 0, 6, 5), unit('arc', 0, 2, 5), unit('colossus', 1, 14, 5), ...extra], { owners: own, fog });
  }

  /** Tiles in the observation that are not visible, within the wasp's vision of `d`: counted here from the mask and the engine's vision rule. */
  function unseenFrom(s: GameState, d: Coord): number {
    const o = observe(s, 0);
    const v = effectiveVision(s, unitAt(s, WASP), d);
    let n = 0;
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (manhattan(at(x, y), d) <= v && !o.visible[y][x]) n++;
    return n;
  }

  it('the setup: fog is up, the enemy is out of sight, and where the wasp stands shows nothing new', () => {
    const s = fogBoard();
    expect(ctxOf(s).fogged).toBe(true);
    expect(canSeeUnit(s, 0, unitAt(s, 5)), 'the colossus').toBe(false);
    expect(unseenFrom(s, at(4, 5))).toBe(0);
  });

  it('under fog the scout ends where it shows more tiles it cannot see now than where the default ends', () => {
    const s = fogBoard();
    const scout = choose(s, WASP, SCOUT).end;
    const def = choose(s, WASP, DEF).end;
    expect(scout, 'it chose somewhere else').not.toEqual(def);
    expect(unseenFrom(s, scout)).toBeGreaterThan(unseenFrom(s, def));
  });

  it('and no other group does anything different (the ground units are on the road, where no decision rests on a tie)', () => {
    const s = fogBoard();
    expect(changedGroups(s, NO_OP).filter((g) => g !== 'air'), 'a no-op order changes no ground unit').toEqual([]);
    expect(changedGroups(s, SCOUT)).toEqual(['air']);
  });

  it('revealGain counts exactly the tiles the observation says are unseen (computed here from the mask), and is 0 with fog down', () => {
    const s = fogBoard();
    const ctx = ctxOf(s);
    const wasp = ctx.mine.find((u) => u.type === 'wasp')!;
    for (const d of [at(4, 5), at(6, 2), at(6, 1), at(2, 1), at(10, 9), at(0, 0), at(14, 10)]) {
      expect(revealGain(ctx, wasp, d), `${d.x},${d.y}`).toBe(unseenFrom(s, d));
    }
    const cc = ctxOf(fogBoard([], false));
    for (const d of [at(4, 5), at(6, 2)]) expect(revealGain(cc, cc.mine.find((u) => u.type === 'wasp')!, d)).toBe(0);
  });

  it('known-bad twin: with fog down nothing is unseen, so the scout moves exactly as a strike unit does', () => {
    const s = fogBoard([], false);
    expect(choose(s, WASP, SCOUT).key).toBe(choose(s, WASP, DEF).key);
    expect(changedGroups(s, SCOUT)).toEqual([]);
  });

  it('never peeks: a hidden enemy planted in the dark changes nothing either unit of mine decides', () => {
    const s = fogBoard();
    const hidden = fogBoard([unit('wasp', 1, 7, 1)]);
    expect(canSeeUnit(hidden, 0, unitAt(hidden, 6)), 'the planted wasp really is unseen').toBe(false);
    for (const o of [SCOUT, DEF]) {
      for (const id of [1, 2, 3, 4]) expect(choose(hidden, id, o).key, `unit ${id}`).toBe(choose(s, id, o).key);
    }
  });

  describe('takes only the fights it wins outright', () => {
    const duel = (hp: number) => mk(base(), [unit('wasp', 0, 9, 0), unit('mule', 1, 12, 0, hp), FOE()]);

    it('a full-HP mule would survive the strike: by default the wasp attacks it, the scout does not', () => {
      const s = duel(10);
      expect(choose(s, 1, DEF).then).toBe('attack');
      expect(choose(s, 1, SCOUT).then).not.toBe('attack');
    });

    it('known-bad twin: a mule the strike is sure to destroy is a fight it wins outright, so the scout takes it, as the default does', () => {
      const s = duel(5);
      expect(choose(s, 1, SCOUT).key).toBe('move:1>11,0:attack@12,0');
      expect(choose(s, 1, DEF).key).toBe('move:1>11,0:attack@12,0');
    });
  });
});

// ---------------------------------------------------------------- pressure

describe('pressure leaves guardBase and stayBack units where they are', () => {
  // an army worth 29,000 (a trooper, a lancer, a bastion, a mule) against one enemy trooper: clearly ahead
  const ahead = (extra: Partial<CreateGameOptions> = {}) => mk(base(), [unit('trooper', 0, 3, 0), unit('lancer', 0, 6, 0), unit('bastion', 0, 8, 0), unit('mule', 0, 10, 0), unit('trooper', 1, 26, 0)], extra);

  it('the setup: Doctrine is ahead (by its lead, not by the cap) and so presses', () => {
    expect(pressureOf(ctxOf(ahead()))).toMatchObject({ on: true, reason: 'ahead' });
  });

  it('PRESSURE_EXEMPT_MISSIONS is exactly guardBase and stayBack', () => {
    expect([...PRESSURE_EXEMPT_MISSIONS].sort()).toEqual(['guardBase', 'stayBack']);
  });

  it('pressesType: on for every mission but those two while pressure is on, and off for every mission while it is off', () => {
    const on = ahead();
    const off = ahead({ fog: true }); // no army is "ahead" under fog
    expect(pressureOf(ctxOf(off)).on).toBe(false);
    let checked = 0;
    for (const g of UNIT_GROUPS) {
      for (const mission of GROUP_MISSIONS[g]) {
        const o = withGroup(g, { mission });
        expect(pressesType(ctxOf(on, o), GROUP_MEMBERS[g][0]), `${g} ${mission}`).toBe(mission !== 'guardBase' && mission !== 'stayBack');
        expect(pressesType(ctxOf(off, o), GROUP_MEMBERS[g][0]), `${g} ${mission} with no pressure`).toBe(false);
        checked++;
      }
    }
    expect(checked).toBe(UNIT_GROUPS.reduce((n, g) => n + GROUP_MISSIONS[g].length, 0));
    // a type's own mission decides for that type, not its group's
    const o = orders({ groups: { armour: { mission: 'guardBase' } }, types: { lancer: { mission: 'frontline' } } });
    expect(pressesType(ctxOf(on, o), 'lancer')).toBe(true);
    expect(pressesType(ctxOf(on, o), 'bastion')).toBe(false);
  });

  it('under pressure the plain lancer and bastion march out; told to guard the base they stay inside the leash', () => {
    const s = ahead();
    const guard = withGroup('armour', { mission: 'guardBase' });
    for (const id of [2, 3]) {
      expect(distanceToBase(s, choose(s, id, DEF).end), `unit ${id} by default`).toBeGreaterThan(BASE_LEASH);
      expect(distanceToBase(s, choose(s, id, guard).end), `unit ${id} on guard`).toBeLessThanOrEqual(BASE_LEASH);
    }
    expect(changedGroups(s, guard)).toEqual(['armour']);
  });

  it('the guard keeps the ordered posture, not the pressed one: it does not hop to a tile worth a star more that only the pressed posture counts', () => {
    // a trooper on flats (1 star) with a canopy tile (2 stars) beside it, inside the leash, the spire and the fabricator held by my own units.
    // A Hold the Line trooper values the extra star at 12 funds, below the 20 it takes to act; pressed (Advance) it would value it at 5, above
    // the 2 that pressure asks. Nothing else is in play.
    const board = (extra: Partial<CreateGameOptions> = {}) => mk(base({ 4: 'f' }), [unit('trooper', 0, 3, 0), unit('lancer', 0, 0, 0), unit('bastion', 0, 1, 0), unit('trooper', 1, 26, 0)], extra);
    const s = board();
    expect(pressureOf(ctxOf(s)).on).toBe(true);
    const guard = withGroup('infantry', { mission: 'guardBase' });
    expect(choose(s, 1, guard).key, 'on guard, pressure moves it nowhere').toBe('idle');
    // known-bad twin: the same trooper told to fight is pressed, and does move
    expect(choose(s, 1, withGroup('infantry', { mission: 'fight' })).key).not.toBe('idle');
    // and with no pressure at all (fog) the guard does what it did
    expect(choose(board({ fog: true }), 1, guard).key).toBe('idle');
  });

  it('a mule told to stay back is not drawn forward either', () => {
    const s = ahead();
    const stay = withGroup('transports', { mission: 'stayBack' });
    expect(distanceToBase(s, choose(s, 4, stay).end)).toBeLessThanOrEqual(BASE_LEASH);
    expect(changedGroups(s, stay)).toEqual(['transports']);
  });

  it('known-bad twin: the rest of the army presses exactly as before: an explicit default mission changes nothing under pressure', () => {
    expect(changedGroups(ahead(), orders({ groups: { armour: { mission: 'frontline' } } }))).toEqual([]);
    expect(changedGroups(ahead(), orders({ groups: { infantry: { mission: 'capture' }, air: { mission: 'strike' } } }))).toEqual([]);
  });
});

// ---------------------------------------------------------------- fog honesty (D-016) for every mission

describe('fog honesty: no order reads what the player cannot see', () => {
  const MISSIONS_ON_BOARD: [string, StandingOrders][] = [
    ['infantry fight', withGroup('infantry', { mission: 'fight' })],
    ['infantry guardBase', withGroup('infantry', { mission: 'guardBase' })],
    ['armour escort', withGroup('armour', { mission: 'escort' })],
    ['armour guardBase', withGroup('armour', { mission: 'guardBase' })],
    ['artillery guardBase', withGroup('artillery', { mission: 'guardBase' })],
    ['air scout', withGroup('air', { mission: 'scout' })],
    ['air escort', withGroup('air', { mission: 'escort' })],
    ['air guardBase', withGroup('air', { mission: 'guardBase' })],
    ['transports stayBack', withGroup('transports', { mission: 'stayBack' })],
    ['every group at once', orders({
      groups: {
        infantry: { mission: 'guardBase', retreatAtHp: 5 }, armour: { mission: 'escort', posture: 'advance' }, artillery: { mission: 'guardBase' },
        air: { mission: 'scout', targetPriority: ['weakest'] }, transports: { mission: 'stayBack' },
      },
      types: { lancer: { posture: 'fallBack' } },
    })],
  ];

  /** Fog up, enemies out of sight: one is added in the dark beside my units, and the whole turn is played with and without it. */
  function board(extra: FixtureUnit[]): GameState {
    const rows = grid(20, 9);
    rows[4] = `HF${'.'.repeat(5)}C${'.'.repeat(11)}H`;
    const own = grid(20, 9);
    own[4] = `00${'.'.repeat(17)}1`;
    return fixtureGame(rows, [
      unit('trooper', 0, 4, 4), unit('lancer', 0, 3, 3), unit('arc', 0, 2, 5), unit('wasp', 0, 5, 6), unit('mule', 0, 3, 5), unit('colossus', 1, 19, 0), ...extra,
    ], { owners: own, fog: true });
  }

  it('every unit of mine decides the same with hidden enemies planted next to the army as without them, under each mission', () => {
    // (the same STATE, so a unit that walked into a planted enemy and was ambushed cannot make the later decisions differ)
    const plain = board([]);
    const planted = board([unit('lancer', 1, 8, 1), unit('trooper', 1, 11, 7), unit('wasp', 1, 7, 8)]);
    for (const u of planted.units.filter((x) => x.owner === 1)) expect(canSeeUnit(planted, 0, u), `${u.type} at ${u.x},${u.y} is hidden`).toBe(false);
    let compared = 0;
    for (const [label, o] of MISSIONS_ON_BOARD) {
      for (const u of plain.units.filter((x) => x.owner === 0)) {
        expect(choose(planted, u.id, o).key, `${label}: ${u.type} #${u.id}`).toBe(choose(plain, u.id, o).key);
        compared++;
      }
      expect(decide(planted, 0, o), `${label}: the first decision of the turn`).toEqual(decide(plain, 0, o));
    }
    expect(compared).toBe(MISSIONS_ON_BOARD.length * 5);
  });

  it('the orders change what the army does on this board (so the equality above is not a row of idle units)', () => {
    const plain = board([]);
    const mine = plain.units.filter((x) => x.owner === 0);
    const differing = MISSIONS_ON_BOARD.filter(([, o]) => mine.some((u) => choose(plain, u.id, o).key !== choose(plain, u.id, DEF).key));
    expect(differing.length).toBeGreaterThanOrEqual(7);
    expect(mine.filter((u) => choose(plain, u.id, DEF).key !== 'idle').length, 'most of the army has something to do').toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------- nothing changes without group orders

const roster = Object.values(COMMANDERS).filter((c) => c.playable && c.faction).sort((a, b) => (a.id < b.id ? -1 : 1));

/** The seats of scripts/balance.mjs's game `g`: commanders rotated through the seats, free-for-all teams. */
function seatsFor(players: number, g: number): PlayerSetup[] {
  const pool = Array.from({ length: players }, (_, i) => roster[(Math.floor(g / players) * players + i) % roster.length]);
  return Array.from({ length: players }, (_, seat) => {
    const c = pool[(seat + g) % players];
    return { faction: c.faction as FactionId, commander: c.id, controller: 'ai', team: seat };
  });
}

function recorded(mapId: string, g: number, seed: number, o: StandingOrders | StandingOrders[] = DEF) {
  const map = MAPS[mapId];
  const rec = map.recommended ?? {};
  const r = playDoctrine(
    { map, players: seatsFor(map.players, g), fog: !!rec.fog, weather: rec.weather ?? 'clear', startFunds: rec.startFunds ?? 0, seed },
    o, { maxCycles: 40 },
  );
  return { actions: r.actions.length, cycles: r.cycles, winner: r.winnerTeam, state: stateHash(r.state), log: fnv1a64(canonicalJson(r.actions)) };
}

describe('DEFAULT_ORDERS: every decision, every recorded match is what it was before M3.4', () => {
  // Taken from the code as it stood on main BEFORE this change (7e14b32): three seeded games with DEFAULT_ORDERS in every seat, the same
  // seats and settings scripts/balance.mjs uses for its games 0, 1 and 2 (calder-fields, canopy-highlands under fog, glass-waste with three
  // players), cap 40 cycles. Each hash is over the whole action list (log) and over the final state (state). A change to how Doctrine plays
  // WITH DEFAULT_ORDERS makes these fail on purpose: it is then a change of behaviour that needs its own decision and new numbers.
  const GOLDEN = [
    { map: 'calder-fields', g: 0, seed: 1000, actions: 362, cycles: 18, winner: 0, state: 'a082caf1d5fa172d', log: 'c43a0818984ae41b' },
    { map: 'canopy-highlands', g: 1, seed: 1001, actions: 750, cycles: 25, winner: 1, state: '00a709eb33d387c2', log: 'ad306bf8415f70b0' },
    { map: 'glass-waste', g: 2, seed: 1002, actions: 1626, cycles: 31, winner: 1, state: '0aa671b39954834b', log: '7a3a4320ab4f368f' },
  ];

  for (const { map, g, seed, ...want } of GOLDEN) {
    it(`${map} (game ${g}, seed ${seed}): the recorded match has the hash it had before, with DEFAULT_ORDERS`, () => {
      expect(recorded(map, g, seed)).toEqual(want);
    });
  }

  it('and the same with orders that say nothing new (empty tables, the posture that is the default)', () => {
    const { map, g, seed, ...want } = GOLDEN[0];
    expect(recorded(map, g, seed, orders({ groups: {}, types: {}, posture: 'holdTheLine' }))).toEqual(want);
  });

  it('known-bad twin: a group order does change a recorded match, so the hash would have caught a change', () => {
    const g = GOLDEN[0];
    const fight = recorded(g.map, g.g, g.seed, withGroup('infantry', { mission: 'fight' }));
    expect(fight.log).not.toBe(g.log);
    expect(fight.state).not.toBe(g.state);
  });
});

// ---------------------------------------------------------------- legality with orders for every group

describe('every action under group orders is one the agent was offered, and the engine accepts it', () => {
  const A = orders({
    groups: {
      infantry: { mission: 'guardBase' }, armour: { mission: 'escort' }, artillery: { mission: 'guardBase' },
      air: { mission: 'scout' }, navy: { mission: 'escort' }, transports: { mission: 'stayBack' },
    },
  });
  const B = orders({
    groups: {
      infantry: { mission: 'fight', retreatAtHp: 6 }, armour: { mission: 'guardBase', targetPriority: ['weakest'] }, artillery: { posture: 'advance' },
      air: { mission: 'escort', posture: 'fallBack' }, navy: { mission: 'guardBase' }, transports: { mission: 'ferry' },
    },
    types: { lancer: { posture: 'advance' }, wasp: { mission: 'strike' } },
  });

  const plan: [string, number, boolean, number][] = [
    ['calder-fields', 1, false, 7], ['saltglass-bay', 1, false, 6], ['canopy-highlands', 1, true, 6], ['tether-ridges', 2, true, 6], ['glass-waste', 1, false, 4],
  ];
  for (const [id, seed, fog, cap] of plan) {
    it(`${id}${fog ? ' under fog' : ''}, seed ${seed}: orders A against orders B, then B against A`, () => {
      const map = MAPS[id];
      for (const swap of [false, true]) {
        const per = Array.from({ length: map.players }, (_, i) => ((i % 2 === 0) !== swap ? A : B));
        let state = createGame({ map, players: seatsFor(map.players, seed), fog, startFunds: map.recommended?.startFunds ?? 2000, seed, turnLimit: cap });
        let n = 0;
        while (state.winnerTeam === null && state.cycle <= cap) {
          if (++n > cap * state.players.length * 400) throw new Error(`${id}: the game does not end`);
          const p = state.current;
          const a = decide(state, p, per[p]);
          expect(agentActions(state, p).some((x) => actionKey(x) === actionKey(a)), `${id} cycle ${state.cycle}: ${actionKey(a)} is offered`).toBe(true);
          state = applyAction(state, a).state; // throws if the engine refuses it
          const seen = new Set<string>();
          for (const u of state.units) {
            expect(seen.has(`${u.x},${u.y}`), `${id}: two units on ${u.x},${u.y}`).toBe(false);
            seen.add(`${u.x},${u.y}`);
          }
        }
      }
    });
  }

  it('the same state and orders give the same action, twice and from a copy', () => {
    const map = MAPS['calder-fields'];
    const states: GameState[] = [];
    let n = 0;
    playDoctrine({ map, players: seatsFor(2, 3), startFunds: 3000, seed: 5 }, [A, B], { maxCycles: 5, onStep: (_b, _a, after) => { if (n++ % 9 === 4) states.push(after); } });
    expect(states.length).toBeGreaterThan(5);
    for (const s of states) {
      for (const o of [A, B]) {
        const x = JSON.stringify(decide(s, s.current, o));
        expect(JSON.stringify(decide(s, s.current, o))).toBe(x);
        expect(JSON.stringify(decide(structuredClone(s), s.current, o))).toBe(x);
      }
    }
  });
});



// ---------------------------------------------------------------- scripts/balance.mjs --orders

describe('scripts/balance.mjs --orders presets', () => {
  interface Metric { kind: string; group?: string; label: string }
  const load = async (): Promise<{ PRESETS: Record<string, object>; METRICS: Record<string, Metric> }> => {
    const path = '../../../scripts/balance.mjs'; // a variable, so tsc does not look for a declaration file of a script
    return import(/* @vite-ignore */ path);
  };

  it('every preset is a set of orders validateOrders accepts, that says something, and has exactly one metric', async () => {
    const { PRESETS, METRICS } = await load();
    expect(Object.keys(PRESETS).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(METRICS).sort()).toEqual(Object.keys(PRESETS).sort());
    for (const [name, preset] of Object.entries(PRESETS)) {
      const v = validateOrders(preset);
      expect(v.groups, name).toBeDefined();
      expect(canonicalJson(v), `${name} changes the orders`).not.toBe(canonicalJson(DEFAULT_ORDERS));
      const m = METRICS[name];
      expect(['captures', 'revealed', 'baseDist', 'escortDist'], name).toContain(m.kind);
      if (m.group) expect(UNIT_GROUPS as readonly string[], `${name} metric group`).toContain(m.group);
    }
  });

  it('the presets the order names are there: infantry-fight, air-scout, armour-escort', async () => {
    const { PRESETS } = await load();
    expect(PRESETS['infantry-fight']).toEqual({ groups: { infantry: { mission: 'fight' } } });
    expect(PRESETS['air-scout']).toEqual({ groups: { air: { mission: 'scout' } } });
    expect(PRESETS['armour-escort']).toEqual({ groups: { armour: { mission: 'escort' } } });
  });

  it('known-bad twin: a preset with a mission from the wrong group would be refused, not ignored', async () => {
    expect(() => validateOrders({ groups: { armour: { mission: 'scout' } } })).toThrow(/mission/);
  });
});
