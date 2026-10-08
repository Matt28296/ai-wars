// The fog-honest agent view (D-016, M3.0): observe(), observedState(), agentActions(), and the two engine rules that make a hidden
// enemy invisible to the player's list of options.
//   RULE A  a move whose destination holds an enemy the mover's team cannot see is legal and ends in an ambush on the tile before it;
//   RULE B  an unload onto a tile holding such an enemy fails: that cargo stays aboard, 'dropBlocked', the other drop still happens.
// Four properties, each over seeded mid-game states (sim.ts self-play, fog on, shipped maps):
//   (a) INDISTINGUISHABLE  plant a hidden enemy: the player's observation and action list are identical with and without it;
//   (b) SOUND              every action the agent is offered is accepted by the TRUE state (it may ambush, or block a drop);
//   (c) COMPLETE           with fog off the agent's list is exactly legalActions;
//   (d) hand-built positions for both rules, with the refusals that must keep refusing.
// Expected answers are worked out in the tests from the rules in docs/research/mechanics.md section 9 and D-016, never read back from
// observe.ts. Every checker is run against a planted violation first, so a green property is not a checker that accepts anything.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { MAPS } from '../../content/maps';
import { UNIT_TYPES } from '../../data';
import {
  IllegalActionError, applyAction, canSeeUnit, createGame, isLegal, reachable, thenOptions, unloadTargets, visibility,
} from './index';
import type { CreateGameOptions, PlayerSetup } from './index';
import { actionKey, legalActions } from './legal';
import { canStandOn, checkPath } from './movement';
import { agentActions, observe, observedState } from './observe';
import { simulate } from './sim';
import type { SimPolicy } from './sim';
import { fixtureGame } from './testing';
import type { FixtureUnit } from './testing';
import type { Action, Coord, FactionId, GameEvent, GameState, Then, Unit, UnitTypeId } from './types';

// ---------------------------------------------------------------- helpers

const at = (x: number, y: number): Coord => ({ x, y });
const mv = (unitId: number, path: [number, number][], then: Then = { kind: 'wait' }): Action => ({
  kind: 'move', unitId, path: path.map(([x, y]) => at(x, y)), then,
});
const unit = (type: UnitTypeId, owner: number, x: number, y: number, hp?: number): FixtureUnit => ({ type, owner, x, y, ...(hp ? { hp } : {}) });
const unitOf = (s: GameState, id: number): Unit => s.units.find((u) => u.id === id)!;
/** A unit as observe() lists it for a viewer who may see it in full: the engine's unit plus `loaded` (M3.2). */
const withLoaded = (u: Unit) => ({ ...u, loaded: u.cargo.length > 0 });
const keysOf = (list: Action[]): string[] => list.map(actionKey);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const v of Object.values(value as object)) deepFreeze(v);
}

/** A tiny seeded generator (the engine's own RNG is not for tests to spend). */
function lcg(seed: number): () => number {
  let x = (Math.imul(seed, 2654435761) + 12345) >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** The state with the units `cargoIds` (currently on the map) moved inside the transport `transportId`. */
function loadInto(s: GameState, transportId: number, cargoIds: number[]): GameState {
  const t = unitOf(s, transportId);
  const cargo = s.units.filter((u) => cargoIds.includes(u.id)).map((u) => ({ ...u, x: t.x, y: t.y }));
  return { ...s, units: s.units.filter((u) => !cargoIds.includes(u.id)).map((u) => (u.id === transportId ? { ...u, cargo } : u)) };
}

/** The state with one more enemy unit. Ids follow the engine: the unit takes nextUnitId, which moves on. */
function planted(s: GameState, type: UnitTypeId, owner: number, x: number, y: number): GameState {
  const t = UNIT_TYPES[type];
  const u: Unit = { id: s.nextUnitId, type, owner, x, y, hp: 100, charge: t.charge, ammo: t.ammo ?? 0, acted: false, cargo: [] };
  return { ...s, units: [...s.units, u], nextUnitId: s.nextUnitId + 1 };
}

const without = (s: GameState, ids: number[]): GameState => ({ ...s, units: s.units.filter((u) => !ids.includes(u.id)) });
/** The state with one unit standing somewhere else. */
const relocated = (s: GameState, id: number, x: number, y: number): GameState => ({ ...s, units: s.units.map((u) => (u.id === id ? { ...u, x, y } : u)) });

// ---------------------------------------------------------------- RULE A: a move onto a hidden enemy

describe('rule A: a move whose destination holds a hidden enemy is accepted and ends in an ambush on the tile before it', () => {
  // Row '..f...': our trooper (vision 2) stands at (0,0). An enemy trooper on canopy two tiles away, with no friendly unit beside it, is hidden.
  const row = (tile: string, extra: FixtureUnit[] = [], fog = true) =>
    fixtureGame([`..${tile}...`, '......'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0), ...extra], { fog });
  const ONTO: [number, number][] = [[0, 0], [1, 0], [2, 0]];

  it('reachable() offers the tile, checkPath() stops one tile short and names the enemy, and applyAction() plays exactly that', () => {
    const s = row('f');
    expect(canSeeUnit(s, 0, unitOf(s, 2)), 'setup: the enemy is hidden').toBe(false);
    const entry = reachable(s, 1).get('2,0');
    expect(entry, 'reachable lists the hidden enemy tile').toBeDefined();
    expect(entry!.path).toEqual(ONTO.map(([x, y]) => at(x, y)));
    expect(checkPath(s, unitOf(s, 1), entry!.path)).toMatchObject({ stop: 1, ambusher: { id: 2 } });
    const r = applyAction(s, mv(1, ONTO));
    expect(r.events).toEqual([
      { kind: 'moved', unitId: 1, path: [at(0, 0), at(1, 0)] },
      { kind: 'ambushed', unitId: 1, at: at(1, 0), by: 2 },
    ]);
    expect(unitOf(r.state, 1)).toMatchObject({ x: 1, y: 0, acted: true, charge: UNIT_TYPES.trooper.charge - 1 }); // charge for the one tile entered
    expect(unitOf(r.state, 2), 'the enemy is untouched').toEqual(unitOf(s, 2));
  });

  it('drops any follow-up but wait: the same order with any then gives the same events and the same state', () => {
    const s = row('f');
    const wait = applyAction(s, mv(1, ONTO));
    const thens: Then[] = [
      { kind: 'capture' }, { kind: 'attack', target: at(2, 0) }, { kind: 'attack', target: at(5, 1) }, { kind: 'load' }, { kind: 'join' },
      { kind: 'supply' }, { kind: 'unload', drops: [{ cargoIndex: 0, to: at(1, 1) }] },
    ];
    for (const then of thens) {
      const r = applyAction(s, mv(1, ONTO, then));
      expect(r.events, then.kind).toEqual(wait.events);
      expect(r.state, then.kind).toEqual(wait.state);
    }
    // Known-bad: with no enemy on the tile the very same orders are refused, so the acceptance above comes from the hidden enemy.
    const empty = relocated(s, 2, 5, 1);
    expect(isLegal(empty, mv(1, ONTO, { kind: 'wait' }))).toBe(true);
    for (const then of thens) expect(isLegal(empty, mv(1, ONTO, then)), `${then.kind} onto an empty tile`).toBe(false);
  });

  it('is on the engine\'s own list: thenOptions offers an empty tile\'s menu, and legalActions lists the move', () => {
    const s = row('f');
    expect(thenOptions(s, 1, at(2, 0))).toEqual(['wait']);
    expect(keysOf(legalActions(s))).toContain('move:1>2,0:wait');
    expect(keysOf(agentActions(s, 0))).toContain('move:1>2,0:wait');
  });

  it('is offered exactly as it is with no enemy there: the agent cannot tell the tile from a free one', () => {
    const s = row('f');
    expect(agentActions(s, 0)).toEqual(agentActions(without(s, [2]), 0));
  });

  it('offers capture on a hidden city like on an empty one, and drops it: no capture progress', () => {
    // City at (3,0), three tiles away from the trooper (vision 2): the enemy standing on it is unseen. A trooper moves 3, so it can try.
    const s = fixtureGame(['...C....', '........'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 3, 0)], { fog: true });
    const away = relocated(s, 2, 7, 1); // the same game with the enemy somewhere else
    expect(canSeeUnit(s, 0, unitOf(s, 2))).toBe(false);
    const list = agentActions(s, 0);
    expect(keysOf(list)).toContain('move:1>3,0:capture');
    expect(list).toEqual(agentActions(away, 0));
    const order = list.find((a) => actionKey(a) === 'move:1>3,0:capture')!;
    const r = applyAction(s, order);
    expect(r.events.map((e) => e.kind)).toEqual(['moved', 'ambushed']);
    expect(unitOf(r.state, 1)).toMatchObject({ x: 2, y: 0 });
    expect(r.state.tiles[0][3]).toMatchObject({ owner: null, capture: 20 });
    // The same order with the enemy elsewhere is a real capture attempt that makes progress.
    const free = applyAction(away, order);
    expect(free.events.map((e) => e.kind)).toEqual(['moved', 'captureProgress']);
    expect(free.state.tiles[0][3].capture).toBeLessThan(20);
  });

  const visibleCases: [string, () => GameState][] = [
    ['open ground within vision', () => row('.')],
    ['canopy, but a friendly unit stands beside it', () => row('f', [unit('trooper', 0, 2, 1)])],
    ['canopy with fog off', () => row('f', [], false)],
    ['an air unit over canopy within vision', () => fixtureGame(['..f...'], [unit('trooper', 0, 0, 0), unit('wasp', 1, 2, 0)], { fog: true })],
  ];
  it.each(visibleCases)('a VISIBLE enemy stays a wall (%s): not reachable, the order is refused, the list has no such move', (_name, make) => {
    const s = make();
    const enemy = s.units.find((u) => u.owner === 1)!;
    expect(enemy.x === 2 && enemy.y === 0).toBe(true);
    if (s.fog) expect(canSeeUnit(s, 0, enemy), 'setup: the enemy is visible').toBe(true);
    expect(reachable(s, 1).has('2,0')).toBe(false);
    expect(isLegal(s, mv(1, ONTO))).toBe(false);
    expect(() => applyAction(s, mv(1, ONTO))).toThrow(IllegalActionError);
    expect(() => applyAction(s, mv(1, ONTO))).toThrow(/blocked by an enemy/);
    expect(() => checkPath(s, unitOf(s, 1), ONTO.map(([x, y]) => at(x, y)))).toThrow(/blocked by an enemy/);
    expect(keysOf(legalActions(s)).filter((k) => k.includes('>2,0:'))).toEqual([]);
    expect(keysOf(agentActions(s, 0)).filter((k) => k.includes('>2,0:'))).toEqual([]);
  });
});

// ---------------------------------------------------------------- RULE B: an unload onto a hidden enemy

describe('rule B: an unload onto a tile holding a hidden enemy fails, the cargo stays aboard, and the other drop still happens', () => {
  // A barge (vision 1) starts at (0,1) in open water with two troops aboard. The shoal at (4,1) is its landing: land to the north,
  // east and south of it. An enemy trooper at (4,0) is four tiles from the barge, so it is unseen when the order is given.
  const MAP = ['......', '~~~~s.', '......'];
  const barge = (extra: FixtureUnit[], fog = true, map = MAP): GameState =>
    loadInto(fixtureGame(map, [unit('barge', 0, 0, 1), unit('trooper', 0, 0, 0), unit('breacher', 0, 1, 0), ...extra], { fog }), 1, [2, 3]);
  const PATH: [number, number][] = [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]];
  const drops = (...d: [number, number, number][]): Then => ({ kind: 'unload', drops: d.map(([cargoIndex, x, y]) => ({ cargoIndex, to: at(x, y) })) });

  it('blocks the drop onto the hidden enemy and lands the other: moved, dropBlocked, unloaded', () => {
    const s = barge([unit('trooper', 1, 4, 0)]); // the enemy is unit 4
    expect(canSeeUnit(s, 0, unitOf(s, 4)), 'setup: hidden when the order is given').toBe(false);
    const r = applyAction(s, mv(1, PATH, drops([0, 4, 0], [1, 5, 1])));
    expect(r.events).toEqual([
      { kind: 'moved', unitId: 1, path: PATH.map(([x, y]) => at(x, y)) },
      { kind: 'dropBlocked', transportId: 1, cargoId: 2, at: at(4, 0), by: 4 },
      { kind: 'unloaded', unitId: 3, transportId: 1, to: at(5, 1) },
    ]);
    expect(unitOf(r.state, 1)).toMatchObject({ x: 4, y: 1, acted: true });
    expect(unitOf(r.state, 1).cargo.map((c) => c.id), 'the blocked cargo stays aboard').toEqual([2]);
    expect(unitOf(r.state, 3)).toMatchObject({ x: 5, y: 1, acted: true });
    expect(unitOf(r.state, 4), 'the enemy is untouched').toEqual(unitOf(s, 4));
    expect(r.state.units.filter((u) => u.x === 4 && u.y === 0)).toHaveLength(1);
    // After the move the barge is next to the enemy and sees it: the block was decided by what the player knew when ordering.
    expect(canSeeUnit(r.state, 0, unitOf(r.state, 4))).toBe(true);
  });

  it('with the enemy absent the very same order drops both, so the block comes from the hidden unit', () => {
    const s = barge([unit('trooper', 1, 5, 2)]); // far from the drops
    const r = applyAction(s, mv(1, PATH, drops([0, 4, 0], [1, 5, 1])));
    expect(r.events.map((e) => e.kind)).toEqual(['moved', 'unloaded', 'unloaded']);
    expect(unitOf(r.state, 1).cargo).toEqual([]);
  });

  it('a single drop onto the hidden enemy: the cargo stays, nothing is unloaded, and the transport has still acted', () => {
    const s = barge([unit('trooper', 1, 4, 0)]);
    const r = applyAction(s, mv(1, PATH, drops([1, 4, 0])));
    expect(r.events.map((e) => e.kind)).toEqual(['moved', 'dropBlocked']);
    expect(r.events[1]).toEqual({ kind: 'dropBlocked', transportId: 1, cargoId: 3, at: at(4, 0), by: 4 });
    expect(unitOf(r.state, 1)).toMatchObject({ x: 4, y: 1, acted: true });
    expect(unitOf(r.state, 1).cargo.map((c) => c.id)).toEqual([2, 3]);
    expect(isLegal(r.state, mv(1, [[4, 1]]))).toBe(false); // acted
  });

  it('both drops onto hidden enemies: both blocked, both cargo aboard', () => {
    const s = barge([unit('trooper', 1, 4, 0), unit('trooper', 1, 5, 1)]);
    expect(canSeeUnit(s, 0, unitOf(s, 5))).toBe(false);
    const r = applyAction(s, mv(1, PATH, drops([0, 4, 0], [1, 5, 1])));
    expect(r.events.map((e) => e.kind)).toEqual(['moved', 'dropBlocked', 'dropBlocked']);
    expect(r.events.slice(1)).toEqual([
      { kind: 'dropBlocked', transportId: 1, cargoId: 2, at: at(4, 0), by: 4 },
      { kind: 'dropBlocked', transportId: 1, cargoId: 3, at: at(5, 1), by: 5 },
    ]);
    expect(unitOf(r.state, 1).cargo).toHaveLength(2);
  });

  it('what counts is what the player knew when ordering: a unit that is seen by then still refuses the drop', () => {
    // A friendly trooper at (5,2) sees (4,2) (one tile away) but not (4,0) (three tiles away).
    const s = barge([unit('trooper', 1, 4, 0), unit('trooper', 1, 4, 2), unit('trooper', 0, 5, 2)]); // enemies 4 and 5, scout 6
    expect(canSeeUnit(s, 0, unitOf(s, 4))).toBe(false);
    expect(canSeeUnit(s, 0, unitOf(s, 5))).toBe(true);
    expect(() => applyAction(s, mv(1, PATH, drops([0, 4, 2])))).toThrow(IllegalActionError);
    expect(() => applyAction(s, mv(1, PATH, drops([0, 4, 2])))).toThrow(/cannot be dropped/);
    expect(applyAction(s, mv(1, PATH, drops([0, 4, 0]))).events.map((e) => e.kind)).toEqual(['moved', 'dropBlocked']);
  });

  it('with fog off the tile is visible, so the drop stays illegal as it always was', () => {
    const s = barge([unit('trooper', 1, 4, 0)], false);
    expect(() => applyAction(s, mv(1, PATH, drops([0, 4, 0])))).toThrow(IllegalActionError);
    expect(() => applyAction(s, mv(1, PATH, drops([0, 4, 0])))).toThrow(/cannot be dropped/);
    expect(unloadTargets(s, 1, at(4, 1), 0).map((c) => `${c.x},${c.y}`).sort()).toEqual(['5,1', '4,2'].sort());
    expect(keysOf(legalActions(s)).filter((k) => k.includes('>4,0'))).toEqual([]);
  });

  it('still refuses what it always refused: a drop twice, two cargo onto one tile, a tile the cargo cannot enter, a tile that is not beside the landing', () => {
    const s = barge([unit('trooper', 1, 4, 0)]);
    for (const then of [drops([0, 5, 1], [0, 4, 0]), drops([0, 5, 1], [1, 5, 1]), drops([0, 3, 1]), drops([0, 5, 0]), drops([2, 5, 1])]) {
      expect(() => applyAction(s, mv(1, PATH, then)), JSON.stringify(then)).toThrow(IllegalActionError);
    }
  });

  it('the order-time rule is in the query too: an unload menu built for a move hides the enemy, one built where the barge already stands does not', () => {
    const s = barge([unit('trooper', 1, 4, 0)]);
    const key = (cs: Coord[]) => cs.map((c) => `${c.x},${c.y}`).sort();
    // Ordering from (0,1): the enemy at (4,0) is unseen, so (4,0) looks free (with (4,2) and (5,1)).
    expect(key(unloadTargets(s, 1, at(4, 1), 0))).toEqual(['4,0', '4,2', '5,1']);
    // A barge that is ALREADY at (4,1) sees its neighbour: the enemy is known, and the tile is not offered.
    const there = barge([unit('trooper', 1, 4, 0)]);
    const parked = { ...there, units: there.units.map((u) => (u.id === 1 ? { ...u, x: 4, y: 1, cargo: u.cargo.map((c) => ({ ...c, x: 4, y: 1 })) } : u)) };
    expect(key(unloadTargets(parked, 1, at(4, 1), 0))).toEqual(['4,2', '5,1']);
  });

  it('when the hidden enemy\'s tile is the only landing, unload is still offered (an absent option would give it away)', () => {
    // Shoal at (4,1) with sea north and south: (5,1) is the one land tile beside it.
    const s = loadInto(fixtureGame(['~~~~~.', '~~~~s.', '~~~~~.'], [unit('barge', 0, 0, 1), unit('trooper', 0, 5, 0), unit('trooper', 1, 5, 1)], { fog: true }), 1, [2]);
    expect(canSeeUnit(s, 0, unitOf(s, 3)), 'setup: hidden').toBe(false);
    expect(thenOptions(s, 1, at(4, 1))).toContain('unload');
    const key = 'move:1>4,1:unload[0>5,1]';
    expect(keysOf(legalActions(s))).toContain(key);
    expect(keysOf(agentActions(s, 0))).toContain(key);
    // The same game with the enemy parked out of the way (on the one other land tile, far from the landing): same list, other outcome.
    const away = relocated(s, 3, 5, 2);
    expect(canSeeUnit(away, 0, unitOf(away, 3)), 'setup: still hidden').toBe(false);
    expect(agentActions(s, 0)).toEqual(agentActions(away, 0));
    const order = agentActions(s, 0).find((a) => actionKey(a) === key)!;
    expect(applyAction(s, order).events.map((e) => e.kind)).toEqual(['moved', 'dropBlocked']);
    expect(keysOf(agentActions(away, 0))).toContain(key);
  });
});


// ---------------------------------------------------------------- seeded mid-game states

const COMMANDER_IDS = Object.keys(COMMANDERS);

interface Battlefield { map: string; teams: number[] }
/** Shipped maps with water, canopy and ridges; the last has two allied pairs, so teammates share sight there. */
const FIELDS: Battlefield[] = [
  { map: 'calder-fields', teams: [0, 1] },
  { map: 'saltglass-bay', teams: [0, 1] },
  { map: 'canopy-highlands', teams: [0, 1] },
  { map: 'tether-ridges', teams: [0, 1] },
  { map: 'arcology-coast', teams: [0, 0, 1, 1] },
];

function setupFor(field: Battlefield, fog: boolean, seed: number): CreateGameOptions {
  const players: PlayerSetup[] = field.teams.map((team, i) => {
    const commander = COMMANDER_IDS[(seed * 3 + i * 5 + team) % COMMANDER_IDS.length];
    const faction = (COMMANDERS[commander].faction ?? 'helion') as FactionId;
    return { faction, commander, controller: 'ai', team, funds: 7000 };
  });
  return { map: MAPS[field.map], players, fog, seed: 500 + seed };
}

interface Sample { label: string; state: GameState }

/** States reached by real self-play (sim.ts, both policies), frozen so that any write into one throws. */
function sampleStates(fog: boolean, seeds: number[], perGame: number): Sample[] {
  const out: Sample[] = [];
  const enough = new Error('enough states from this game'); // stops simulate() once the game has given what is wanted
  for (const field of FIELDS) {
    for (const policy of ['random', 'greedy'] as SimPolicy[]) {
      for (const seed of seeds) {
        let taken = 0;
        try {
          simulate({
            setup: setupFor(field, fog, seed), seed, maxCycles: 9, policy,
            onStep: (st) => {
              if (st.index % 41 !== 30) return;
              taken++;
              deepFreeze(st.after);
              out.push({ label: `${field.map}/${policy}/seed ${seed}/after action ${st.index}`, state: st.after });
              if (taken >= perGame) throw enough;
            },
          });
        } catch (err) {
          if (err !== enough) throw err;
        }
      }
    }
  }
  return out;
}

let fogCache: Sample[] | null = null;
let clearCache: Sample[] | null = null;
const fogStates = () => (fogCache ??= sampleStates(true, [1, 2, 3], 2));
const clearStates = () => (clearCache ??= sampleStates(false, [1, 2], 2));

const PLANTABLE: UnitTypeId[] = ['trooper', 'wasp', 'picket'];

function foeOf(s: GameState, viewer: number): number | null {
  const p = s.players.find((q) => q.team !== s.players[viewer].team && !q.defeated);
  return p ? p.index : null;
}

/** Free tiles the viewer cannot see, those nearest to the viewer's team first (then reading order): where hidden enemies matter most. */
function unseenFreeTiles(s: GameState, viewer: number): Coord[] {
  const mask = visibility(s, viewer);
  const team = s.players[viewer].team;
  const taken = new Set(s.units.map((u) => `${u.x},${u.y}`));
  const mine = s.units.filter((u) => s.players[u.owner].team === team);
  const found: { c: Coord; d: number }[] = [];
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (mask[y][x] || taken.has(`${x},${y}`)) continue;
      found.push({ c: at(x, y), d: Math.min(...mine.map((u) => Math.abs(u.x - x) + Math.abs(u.y - y)), 99) });
    }
  }
  found.sort((a, b) => a.d - b.d || a.c.y - b.c.y || a.c.x - b.c.x);
  return found.map((f) => f.c);
}

/** Puts an enemy of `viewer` on the tile. null when no unit type fits the terrain, or the viewer would see that unit after all. */
function plantHidden(s: GameState, viewer: number, c: Coord): GameState | null {
  const owner = foeOf(s, viewer);
  if (owner === null || s.units.some((u) => u.x === c.x && u.y === c.y)) return null;
  const terrain = s.tiles[c.y][c.x].terrain;
  const type = PLANTABLE.find((t) => canStandOn(terrain, UNIT_TYPES[t].moveType));
  if (!type) return null;
  const p = planted(s, type, owner, c.x, c.y);
  return canSeeUnit(p, viewer, p.units[p.units.length - 1]) ? null : p;
}

/** What an agent is shown, as two functions, so the checks can be run on the real views and on deliberately leaky ones. */
interface Views { observe: (s: GameState, v: number) => unknown; actions: (s: GameState, v: number) => Action[] }
const REAL: Views = { observe, actions: agentActions };

/** The same views, remembering the answer for each (state, player): the unchanged base state is asked about again and again. */
function memoized(views: Views): Views {
  const memo = <T,>(fn: (s: GameState, v: number) => T) => {
    const seen = new WeakMap<GameState, Map<number, T>>();
    return (s: GameState, v: number): T => {
      let byPlayer = seen.get(s);
      if (!byPlayer) seen.set(s, (byPlayer = new Map()));
      if (!byPlayer.has(v)) byPlayer.set(v, fn(s, v));
      return byPlayer.get(v)!;
    };
  };
  return { observe: memo(views.observe), actions: memo(views.actions) };
}

/** Everything that differs in what player `v` is shown between `base` and the same game with extra hidden units. Empty = indistinguishable. */
function viewDifferences(base: GameState, extra: GameState, v: number, views: Views): string[] {
  const out: string[] = [];
  if (!sameJson(views.observe(base, v), views.observe(extra, v))) out.push('the observation differs');
  const a = views.actions(base, v);
  const b = views.actions(extra, v);
  const ka = new Set(keysOf(a));
  const kb = new Set(keysOf(b));
  for (const k of kb) if (!ka.has(k)) out.push(`action ${k} is listed only with the unit`);
  for (const k of ka) if (!kb.has(k)) out.push(`action ${k} is listed only without the unit`);
  if (!out.length && !sameJson(a, b)) out.push('the action lists hold the same keys but differ in paths or order');
  return out;
}

/** The bug D-016 names: the engine's list on the true state, minus every move that ends on a tile with a unit on it. */
const withoutMovesOntoUnits = (s: GameState, list: Action[]): Action[] =>
  list.filter((a) => {
    if (a.kind !== 'move') return true;
    const end = a.path[a.path.length - 1];
    return !s.units.some((u) => u.id !== a.unitId && u.x === end.x && u.y === end.y);
  });
const leakyActions = (s: GameState, v: number): Action[] => (s.current !== v ? [] : withoutMovesOntoUnits(s, legalActions(s)));
/** The other way to leak: hand the agent the raw units. */
const leakyObserve = (s: GameState, v: number): unknown => ({ ...observe(s, v), units: s.units });

// ---------------------------------------------------------------- (a) indistinguishable

describe('(a) a hidden enemy changes nothing the player is shown', () => {
  it('the checker sees the two leaks D-016 names, on a hand-built position', () => {
    const base = fixtureGame(['..f...', '......'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 5, 1)], { fog: true });
    const extra = planted(base, 'trooper', 1, 2, 0); // on the canopy two tiles from our trooper
    expect(canSeeUnit(extra, 0, unitOf(extra, 3))).toBe(false);
    expect(viewDifferences(base, extra, 0, REAL)).toEqual([]);
    // The raw list on the true state leaks both ways: the hidden tile's own move is missing, and a move that ends beside the
    // enemy offers an attack on it (a unit that has arrived there sees it). The agent's list has neither.
    const leaked = viewDifferences(base, extra, 0, { ...REAL, actions: leakyActions });
    expect(leaked).toContain('action move:1>2,0:wait is listed only without the unit');
    expect(leaked).toContain('action move:1>1,0:attack@2,0 is listed only with the unit');
    expect(viewDifferences(base, extra, 0, { ...REAL, actions: (s, v) => (s.current === v ? legalActions(s) : []) })).not.toEqual([]);
    expect(viewDifferences(base, extra, 0, { ...REAL, observe: leakyObserve })).toEqual(['the observation differs']);
    // And it is quiet when nothing differs: the same state twice.
    expect(viewDifferences(base, base, 0, { observe: leakyObserve, actions: leakyActions })).toEqual([]);
  });

  it('holds for hidden units planted on many seeded mid-game states, for every player who cannot see them', () => {
    const rand = lcg(4242);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
    const n = { states: 0, plantings: 0, plantedUnits: 0, comparisons: 0, viewers: 0, onReach: 0, rawChanged: 0, listerLeakCaught: 0, obsLeakCaught: 0, toMove: 0 };
    const problems: string[] = [];
    const real = memoized(REAL);
    for (const { label, state } of fogStates()) {
      n.states++;
      const cur = state.current;
      const reachKeys = new Set<string>();
      for (const u of state.units) if (u.owner === cur && !u.acted) for (const k of reachable(state, u.id).keys()) reachKeys.add(k);
      const rawBaseList = legalActions(state);
      const rawBase = keysOf(rawBaseList).sort();
      // Plant against the player to move (3 ways: the nearest unseen tile, a random one, and the three nearest at once) and, more lightly,
      // against the next player, whose observation is checked too.
      for (const v of new Set([cur, (cur + 1) % state.players.length])) {
        const free = unseenFreeTiles(state, v);
        if (!free.length) continue;
        const near = free.slice(0, 3);
        const variants: Coord[][] = v === cur ? [[near[0]], [pick(free)], near] : [[near[0]]];
        for (const tiles of variants) {
          let p = state;
          let count = 0;
          for (const c of tiles) {
            const q = plantHidden(p, v, c);
            if (q) { p = q; count++; }
          }
          if (!count) continue;
          const added = p.units.slice(state.units.length);
          n.plantings++;
          n.plantedUnits += count;
          if (added.some((u) => reachKeys.has(`${u.x},${u.y}`))) n.onReach++;
          const rawP = v === cur ? legalActions(p) : null;
          if (rawP && !sameJson(rawBase, keysOf(rawP).sort())) n.rawChanged++;
          // Every player who cannot see any of the new units (and is not on their side) must be shown exactly what it was shown before.
          for (const w of state.players) {
            if (w.index !== v && w.team !== state.players[v].team) continue;
            if (added.some((u) => canSeeUnit(p, w.index, u) || p.players[u.owner].team === w.team)) continue;
            n.viewers++;
            if (w.index === cur) n.toMove++;
            n.comparisons += 2; // the observation and the action list
            const diff = viewDifferences(state, p, w.index, real);
            if (diff.length) problems.push(`${label}, viewer ${w.index}, units at ${added.map((u) => `${u.x},${u.y}`).join(' ')}: ${diff.slice(0, 3).join('; ')}`);
            // The same plantings against the two leaky views: the checker must catch them.
            if (w.index === cur && rawP) {
              const was = keysOf(withoutMovesOntoUnits(state, rawBaseList)).sort();
              const now = keysOf(withoutMovesOntoUnits(p, rawP)).sort();
              if (!sameJson(was, now)) n.listerLeakCaught++;
            }
            if (viewDifferences(state, p, w.index, { ...real, observe: leakyObserve }).length) n.obsLeakCaught++;
          }
        }
      }
    }
    console.log(
      `(a) ${n.states} fog states, ${n.plantings} plantings (${n.plantedUnits} hidden units planted), ${n.viewers} viewer checks (${n.comparisons} comparisons: observation + action list; ${n.toMove} for the player to move), ` +
      `${n.onReach} plantings on a tile some unit of the player to move could reach, ${n.rawChanged} where the engine's raw list on the true state changed, ` +
      `${n.listerLeakCaught} caught by the D-016 lister leak and ${n.obsLeakCaught} by the raw-units leak`,
    );
    expect(problems.slice(0, 5)).toEqual([]);
    // The check ran on real material: many states, many units, tiles the player could walk onto, and the leaks it must catch were caught.
    expect(n.states).toBeGreaterThanOrEqual(50);
    expect(n.plantedUnits).toBeGreaterThanOrEqual(200);
    expect(n.onReach).toBeGreaterThanOrEqual(30);
    expect(n.rawChanged, 'the planted units do change what the raw engine list says').toBeGreaterThanOrEqual(20);
    expect(n.listerLeakCaught, 'the lister leak is caught on real states').toBeGreaterThanOrEqual(10);
    expect(n.obsLeakCaught, 'the raw-units leak is caught every time').toBe(n.viewers);
  }, 120_000);

  it('also holds when the hidden units are already there: removing them, or changing their hp, ammo, charge or acted flag, changes nothing', () => {
    let statesWithHidden = 0;
    let hiddenUnits = 0;
    const problems: string[] = [];
    const real = memoized(REAL);
    for (const { label, state } of fogStates()) {
      for (const v of new Set([state.current, (state.current + 1) % state.players.length])) {
        const hidden = state.units.filter((u) => state.players[u.owner].team !== state.players[v].team && !canSeeUnit(state, v, u));
        if (!hidden.length) continue;
        if (v === state.current) { statesWithHidden++; hiddenUnits += hidden.length; }
        const ids = hidden.map((u) => u.id);
        const gone = without(state, ids);
        const tweaked: GameState = {
          ...state,
          units: state.units.map((u) => (ids.includes(u.id) ? { ...u, hp: 1, ammo: 0, charge: 0, acted: !u.acted } : u)),
        };
        for (const [what, other] of [['removed', gone], ['tweaked', tweaked]] as const) {
          const diff = viewDifferences(state, other, v, real);
          if (diff.length) problems.push(`${label}, viewer ${v}, hidden units ${what}: ${diff.slice(0, 3).join('; ')}`);
        }
      }
    }
    console.log(`(a) natural hidden units: ${statesWithHidden} states had ${hiddenUnits} enemy units unseen by the player to move; removing or tweaking them changed nothing`);
    expect(problems.slice(0, 5)).toEqual([]);
    expect(statesWithHidden).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------- (b) sound

/** Enemies of `mover`'s team that the mover's team cannot see in `s`, by tile. */
function hiddenEnemies(s: GameState, mover: number): Map<string, Unit> {
  const out = new Map<string, Unit>();
  for (const u of s.units) {
    if (s.players[u.owner].team !== s.players[mover].team && !canSeeUnit(s, mover, u)) out.set(`${u.x},${u.y}`, u);
  }
  return out;
}

interface Tally { applied: number; ambushes: number; blockedDrops: number; unloadedDrops: number; unloadOrders: number; moveOrders: number }
const newTally = (): Tally => ({ applied: 0, ambushes: 0, blockedDrops: 0, unloadedDrops: 0, unloadOrders: 0, moveOrders: 0 });

/**
 * Applies every action in `list` to `state` and checks what came out against the rules written down in mechanics.md 9.4 and D-016, worked
 * out here and not read from the engine: a path that runs into an enemy the mover could not see stops on the last free tile before the
 * first such enemy and the unit has acted; a drop onto a hidden enemy is blocked and the cargo stays aboard; everything else lands.
 * Returns the problems, empty when the true state accepted every action and did what the rules say.
 */
function applyAndCheck(state: GameState, list: Action[], tally: Tally): string[] {
  const problems: string[] = [];
  const note = (a: Action, msg: string) => { if (problems.length < 25) problems.push(`${actionKey(a)}: ${msg}`); };
  const hidden = hiddenEnemies(state, state.current);
  for (const a of list) {
    let r: { state: GameState; events: GameEvent[] };
    try {
      r = applyAction(state, a);
    } catch (err) {
      note(a, `the true state refused it: ${(err as Error).message}`);
      continue;
    }
    tally.applied++;
    const after = r.state;
    // The board stays sane: one unit per tile, cargo rides with its carrier.
    const seen = new Set<string>();
    for (const u of after.units) {
      const k = `${u.x},${u.y}`;
      if (seen.has(k)) note(a, `two units on (${k})`);
      seen.add(k);
      for (const c of u.cargo) if (c.x !== u.x || c.y !== u.y) note(a, `cargo ${c.id} is not with its carrier ${u.id}`);
    }
    if (a.kind !== 'move') continue;
    tally.moveOrders++;
    const mover = unitOf(state, a.unitId);
    const path = a.path;
    const firstHidden = path.findIndex((c, i) => i > 0 && hidden.has(`${c.x},${c.y}`));
    const ambushed = r.events.find((e): e is Extract<GameEvent, { kind: 'ambushed' }> => e.kind === 'ambushed');
    if (firstHidden >= 0) {
      tally.ambushes++;
      let stop = firstHidden - 1;
      while (stop > 0 && state.units.some((o) => o.id !== mover.id && o.x === path[stop].x && o.y === path[stop].y)) stop--;
      const by = hidden.get(`${path[firstHidden].x},${path[firstHidden].y}`)!;
      if (!ambushed) { note(a, `ran into the hidden ${by.type} #${by.id} and was not ambushed`); continue; }
      if (ambushed.by !== by.id || ambushed.at.x !== path[stop].x || ambushed.at.y !== path[stop].y) {
        note(a, `ambush by #${ambushed.by} at (${ambushed.at.x},${ambushed.at.y}), expected by #${by.id} at (${path[stop].x},${path[stop].y})`);
      }
      const now = unitOf(after, mover.id);
      if (now.x !== path[stop].x || now.y !== path[stop].y || !now.acted) note(a, `the ambushed unit stands at (${now.x},${now.y}) acted=${now.acted}`);
      if (r.events.some((e) => e.kind === 'attacked' || e.kind === 'captureProgress' || e.kind === 'unloaded' || e.kind === 'dropBlocked' || e.kind === 'loaded')) {
        note(a, 'the follow-up was not dropped after the ambush');
      }
      continue;
    }
    if (ambushed) { note(a, 'ambushed with no hidden enemy on the path'); continue; }
    if (a.then.kind === 'unload') {
      tally.unloadOrders++;
      const blocked = r.events.filter((e): e is Extract<GameEvent, { kind: 'dropBlocked' }> => e.kind === 'dropBlocked');
      const unloaded = r.events.filter((e): e is Extract<GameEvent, { kind: 'unloaded' }> => e.kind === 'unloaded');
      tally.blockedDrops += blocked.length;
      tally.unloadedDrops += unloaded.length;
      if (blocked.length + unloaded.length !== a.then.drops.length) note(a, `${a.then.drops.length} drops gave ${unloaded.length} unloaded + ${blocked.length} dropBlocked`);
      for (const d of a.then.drops) {
        const cargo = mover.cargo[d.cargoIndex];
        const enemy = hidden.get(`${d.to.x},${d.to.y}`);
        const b = blocked.find((e) => e.cargoId === cargo.id);
        const u = unloaded.find((e) => e.unitId === cargo.id);
        if (enemy) {
          if (!b || b.by !== enemy.id || b.at.x !== d.to.x || b.at.y !== d.to.y) note(a, `the drop onto hidden #${enemy.id} at (${d.to.x},${d.to.y}) was not blocked`);
          if (u || !unitOf(after, mover.id).cargo.some((c) => c.id === cargo.id)) note(a, 'blocked cargo did not stay aboard');
        } else if (b || !u || u.to.x !== d.to.x || u.to.y !== d.to.y) note(a, `the drop at (${d.to.x},${d.to.y}) was not unloaded`);
      }
      if (!unitOf(after, mover.id).acted) note(a, 'the transport has not acted');
    }
  }
  return problems;
}

describe('(b) every action the agent is offered is accepted by the true state, and does what the rules say', () => {
  it('the checker refuses a doctored list: a move onto a visible enemy, and an outcome that breaks the rules', () => {
    const s = fixtureGame(['..f...'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 1, 0)], { fog: true }); // the enemy is beside us: visible
    const bogus = mv(1, [[0, 0], [1, 0]]);
    expect(isLegal(s, bogus)).toBe(false);
    expect(applyAndCheck(s, [...agentActions(s, 0), bogus], newTally())).toEqual([expect.stringContaining('the true state refused it')]);
    expect(applyAndCheck(s, agentActions(s, 0), newTally())).toEqual([]);
    // A hidden enemy on the path: the checker expects the ambush. Hand it a list whose order walks through it, and it is satisfied; the
    // oracle itself is exercised by every ambush in the runs below (it recomputes where the unit must stop).
    const hiddenOne = fixtureGame(['..f...'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)], { fog: true });
    const t = newTally();
    expect(applyAndCheck(hiddenOne, [mv(1, [[0, 0], [1, 0], [2, 0]]), mv(1, [[0, 0], [1, 0], [2, 0], [3, 0]])], t)).toEqual([]);
    expect(t.ambushes).toBe(2);
  });

  it('applies every action offered on seeded mid-game fog states to the true state: none is refused, every outcome follows the rules', () => {
    const t = newTally();
    const problems: string[] = [];
    let states = 0;
    let withHidden = 0;
    for (const { label, state } of fogStates()) {
      const list = agentActions(state, state.current);
      states++;
      if (hiddenEnemies(state, state.current).size) withHidden++;
      for (const p of applyAndCheck(state, list, t)) problems.push(`${label}: ${p}`);
    }
    console.log(`(b) ${states} fog states (${withHidden} with enemies hidden from the player to move): ${t.applied} agent actions applied to the true state, ${t.moveOrders} of them moves, ${t.ambushes} ended in an ambush, ${t.unloadOrders} unload orders`);
    expect(problems.slice(0, 5)).toEqual([]);
    expect(t.applied).toBeGreaterThanOrEqual(4000);
  });

  it('does the same with three hidden enemies planted on the nearest unseen tiles, which is where the ambushes are', () => {
    const t = newTally();
    const problems: string[] = [];
    let plantings = 0;
    let units = 0;
    for (const { label, state } of fogStates()) {
      const cur = state.current;
      const near = unseenFreeTiles(state, cur).slice(0, 3); // three hidden enemies at once, on the unseen tiles nearest the player's units
      let p = state;
      let count = 0;
      for (const c of near) {
        const q = plantHidden(p, cur, c);
        if (q) { p = q; count++; }
      }
      if (!count) continue;
      plantings++;
      units += count;
      for (const m of applyAndCheck(p, agentActions(p, cur), t)) problems.push(`${label} + ${count} hidden: ${m}`);
    }
    console.log(`(b) ${plantings} plantings (${units} hidden units): ${t.applied} agent actions applied, ${t.ambushes} ambushes, ${t.unloadOrders} unload orders`);
    expect(problems.slice(0, 5)).toEqual([]);
    expect(t.applied).toBeGreaterThanOrEqual(4000);
    expect(t.ambushes, 'the planted units were walked into').toBeGreaterThanOrEqual(150);
  });

  it('and with a loaded transport next to hidden enemies: the drops onto them are blocked, the rest land, and the list never changes', () => {
    const rand = lcg(99);
    const t = newTally();
    const problems: string[] = [];
    let bases = 0;
    let plantings = 0;
    let units = 0;
    const real = memoized(REAL);
    for (const { label, state } of fogStates()) {
      const cur = state.current;
      const rider = state.units.find((u) => u.owner === cur && !u.acted && ['foot', 'exo'].includes(UNIT_TYPES[u.type].moveType) && u.cargo.length === 0
        && canStandOn(state.tiles[u.y][u.x].terrain, 'hover'));
      if (!rider) continue;
      // A mule appears under the rider with the rider inside: a real position, a loaded transport somewhere in the game.
      const mule: Unit = { id: state.nextUnitId, type: 'mule', owner: cur, x: rider.x, y: rider.y, hp: 100, charge: UNIT_TYPES.mule.charge, ammo: 0, acted: false, cargo: [{ ...rider }] };
      const base: GameState = { ...state, units: [...state.units.filter((u) => u.id !== rider.id), mule], nextUnitId: state.nextUnitId + 1 };
      bases++;
      // Unseen tiles beside tiles the mule could stop on: where a drop could land on a hidden enemy.
      const mask = visibility(base, cur);
      const taken = new Set(base.units.map((u) => `${u.x},${u.y}`));
      const beside = new Map<string, Coord>();
      for (const e of reachable(base, mule.id).values()) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = e.x + dx;
          const y = e.y + dy;
          if (x < 0 || y < 0 || x >= base.width || y >= base.height || mask[y][x] || taken.has(`${x},${y}`)) continue;
          beside.set(`${x},${y}`, at(x, y));
        }
      }
      const spots = [...beside.values()];
      if (!spots.length) continue;
      const pickSpots = (n: number): Coord[] => {
        const chosen = new Map<string, Coord>();
        for (let i = 0; i < n * 3 && chosen.size < n; i++) {
          const c = spots[Math.floor(rand() * spots.length)];
          chosen.set(`${c.x},${c.y}`, c);
        }
        return [...chosen.values()];
      };
      for (const tiles of [pickSpots(1), pickSpots(3)]) {
        let p = base;
        let count = 0;
        for (const c of tiles) {
          const q = plantHidden(p, cur, c);
          if (q) { p = q; count++; }
        }
        if (!count) continue;
        plantings++;
        units += count;
        const diff = viewDifferences(base, p, cur, real);
        if (diff.length) problems.push(`${label} + mule: ${diff[0]}`);
        // Every order of the mule that has anything to do with a planted tile (its path crosses one, or a drop lands on one), and one in
        // five of the rest: the mule has hundreds of orders and the point is the ones beside the hidden units.
        const planted = new Set(p.units.slice(base.units.length).map((u) => `${u.x},${u.y}`));
        const mine = agentActions(p, cur).filter((a, i) => a.kind === 'move' && a.unitId === mule.id && (
          i % 5 === 0 || a.path.some((c) => planted.has(`${c.x},${c.y}`)) || (a.then.kind === 'unload' && a.then.drops.some((d) => planted.has(`${d.to.x},${d.to.y}`)))));
        for (const m of applyAndCheck(p, mine, t)) problems.push(`${label} + mule + ${count} hidden: ${m}`);
      }
    }
    console.log(`(b) loaded transports: ${bases} states with a mule carrying a trooper, ${plantings} plantings (${units} hidden units) beside its stopping places, ${t.applied} mule orders applied: ${t.unloadOrders} unloads, ${t.blockedDrops} drops blocked by a hidden enemy, ${t.unloadedDrops} landed, ${t.ambushes} ambushes; the agent's list was the same with and without the hidden units every time`);
    expect(problems.slice(0, 5)).toEqual([]);
    expect(t.unloadOrders).toBeGreaterThanOrEqual(100);
    expect(t.blockedDrops, 'drops onto hidden enemies happened').toBeGreaterThanOrEqual(20);
    expect(t.unloadedDrops).toBeGreaterThanOrEqual(100);
  }, 120_000);
});

// ---------------------------------------------------------------- (c) complete for visible play

describe('(c) with fog off the agent is told everything and offered exactly what the engine lists', () => {
  it('agentActions equals legalActions, observe shows every unit, observedState is the whole state', () => {
    const states = clearStates();
    let actions = 0;
    let unitsShown = 0;
    for (const { label, state } of states) {
      expect(state.fog, label).toBe(false);
      const list = agentActions(state, state.current);
      expect(list, label).toEqual(legalActions(state));
      actions += list.length;
      for (const p of state.players) {
        if (p.index !== state.current) expect(agentActions(state, p.index), `${label}: not player ${p.index}'s turn`).toEqual([]);
        const o = observe(state, p.index);
        expect(o.units.map((u) => u.id), label).toEqual(state.units.map((u) => u.id));
        expect(o.units, label).toEqual(state.units.map(withLoaded));
        expect(o.visible.every((row) => row.every(Boolean)), label).toBe(true);
        expect(o.fogActive, label).toBe(false);
        unitsShown += o.units.length;
      }
      const seen = observedState(state, state.current);
      expect(seen, label).toEqual(state);
      expect(seen, label).not.toBe(state);
    }
    console.log(`(c) ${states.length} fog-off states: ${actions} actions, agentActions equals legalActions in every one; ${unitsShown} units shown across all players`);
    expect(states.length).toBeGreaterThanOrEqual(30);
    expect(actions).toBeGreaterThanOrEqual(3000);
  });

  it('the same comparison is not trivially true: with fog on the two lists differ on real states, and match where nothing is hidden', () => {
    let differ = 0;
    let nothingHidden = 0;
    for (const { label, state } of fogStates()) {
      const agent = keysOf(agentActions(state, state.current)).sort();
      const raw = keysOf(legalActions(state)).sort();
      if (hiddenEnemies(state, state.current).size === 0) {
        nothingHidden++;
        expect(agent, `${label}: no enemy is hidden`).toEqual(raw);
      } else if (!sameJson(agent, raw)) differ++;
    }
    console.log(`(c) fog on: the agent's list differs from the engine's raw list in ${differ} states, equals it in the ${nothingHidden} where no enemy is hidden`);
    expect(differ, 'the wrapper does something under fog').toBeGreaterThanOrEqual(8);
    expect(nothingHidden).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------- what the agent is told

describe('observe(): the Observation', () => {
  // Three players, two teams: players 0 and 1 are allies, player 2 is the enemy. A strip of open ground, ten tiles long.
  const players: PlayerSetup[] = [
    { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
    { faction: 'tidewell', commander: 'none', controller: 'ai', team: 0 },
    { faction: 'verdant', commander: 'none', controller: 'ai', team: 1 },
  ];
  const strip = (units: FixtureUnit[], extra: Partial<CreateGameOptions> = {}): GameState =>
    createGame({
      map: { id: 'strip', name: 'strip', description: 'test', players: 3, terrain: ['..........', '..........'], owners: ['..........', '..........'], units },
      players, seed: 1, fog: true, ...extra,
    });
  // ids 1..4 in this order: our trooper, our ally's trooper far away, an enemy trooper alone in the middle, an enemy lancer beside the ally.
  const field = () => strip([unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 0), unit('trooper', 2, 4, 0), unit('lancer', 2, 9, 1)]);
  const ids = (o: { units: Unit[] }) => o.units.map((u) => u.id);

  it('shows own and allied units in full, and enemies only where the team can see them (an ally\'s sight counts)', () => {
    const s = field();
    // Player 0: own trooper 1; ally's trooper 2 (far away, still shown); the enemy lancer 4 stands beside that ally; the enemy trooper 3 is alone in the fog.
    expect(canSeeUnit(s, 0, unitOf(s, 3))).toBe(false);
    expect(canSeeUnit(s, 0, unitOf(s, 4))).toBe(true);
    const o = observe(s, 0);
    expect(ids(o)).toEqual([1, 2, 4]);
    expect(o.units[0]).toEqual(withLoaded(unitOf(s, 1)));
    expect(o.units[1]).toEqual(withLoaded(unitOf(s, 2))); // allied: in full
    expect(o.units[2]).toEqual(withLoaded(unitOf(s, 4))); // a visible enemy: hp, charge, ammo and all
    // The ally sees what player 0 sees: the same team, the same picture.
    expect(observe(s, 1).units).toEqual(o.units);
    // Player 2 (the enemy) sees its own two units and, through the lancer, the ally trooper beside it. Not our trooper at (0,0).
    expect(ids(observe(s, 2))).toEqual([2, 3, 4]);
  });

  it('carries the public line of every player and nothing else about them', () => {
    const s0 = field();
    const s: GameState = { ...s0, players: s0.players.map((p) => (p.index === 2 ? { ...p, funds: 1234, power: 777, powerState: 'surge' as const, powerUses: 3, revealTurns: 2 } : p)) };
    const o = observe(s, 0);
    expect(o.players).toHaveLength(3);
    for (const p of o.players) expect(Object.keys(p).sort()).toEqual(['commander', 'defeated', 'faction', 'funds', 'index', 'power', 'powerState', 'team']);
    expect(o.players[2]).toEqual({ index: 2, faction: 'verdant', commander: 'none', team: 1, funds: 1234, power: 777, powerState: 'surge', defeated: false });
    expect(o.players[0].team).toBe(0);
  });

  it('carries the public facts of the battle', () => {
    const s = strip([unit('trooper', 0, 0, 0), unit('trooper', 2, 9, 0)], {
      weather: 'ionstorm', objective: { kind: 'survive', cycles: 6 }, turnLimit: 12, deadline: { team: 0, cycles: 8 },
    });
    const o = observe(s, 1);
    expect(o).toMatchObject({
      viewer: 1, mapId: 'strip', width: 10, height: 2, cycle: 1, current: 0, weather: 'ionstorm', fog: true, fogActive: true,
      objective: { kind: 'survive', cycles: 6 }, turnLimit: 12, deadline: { team: 0, cycles: 8 }, winnerTeam: null,
    });
    const plain = observe(strip([unit('trooper', 0, 0, 0), unit('trooper', 2, 9, 0)]), 0);
    expect(plain.turnLimit).toBeUndefined();
    expect('turnLimit' in plain && 'deadline' in plain, 'absent options are absent, not undefined').toBe(false);
  });

  it('gives the visible-tile mask, and the mask is the engine\'s: a tile is true where a unit standing on it would be seen', () => {
    const s = field();
    const o = observe(s, 0);
    expect(o.visible).toEqual(visibility(s, 0));
    expect(o.visible[0][2], 'two tiles from our trooper (vision 2)').toBe(true);
    expect(o.visible[0][4], 'where the lone enemy stands').toBe(false);
    expect(o.visible[1][9], 'beside the ally').toBe(true);
    expect(o.visible.every((row) => row.length === 10) && o.visible.length === 2).toBe(true);
  });

  it('shows terrain and owner of every tile, and capture progress only where the player sees or owns', () => {
    // y0 '.C....C..C'  (1,0) our city, (6,0) a far neutral city, (9,0) our city far from our units;  y1 '.C......C.'  (1,1) a near neutral city, (8,1) the enemy's.
    const s0 = fixtureGame(['.C....C..C', '.C......C.'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 1)], {
      fog: true, owners: ['.0.......0', '........1.'],
    });
    const progress: [number, number, number][] = [[1, 0, 12], [1, 1, 14], [6, 0, 13], [8, 1, 7], [9, 0, 18]];
    const s: GameState = { ...s0, tiles: s0.tiles.map((row, y) => row.map((t, x) => ({ ...t, capture: progress.find(([px, py]) => px === x && py === y)?.[2] ?? t.capture }))) };
    const o = observe(s, 0);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 10; x++) {
        expect(o.tiles[y][x].terrain).toBe(s.tiles[y][x].terrain);
        expect(o.tiles[y][x].owner, `owner at ${x},${y} is public`).toBe(s.tiles[y][x].owner);
      }
    }
    expect(o.tiles[0][1].capture, 'ours and in sight').toBe(12);
    expect(o.tiles[1][1].capture, 'a neutral city we can see').toBe(14);
    expect(o.tiles[0][9].capture, 'ours, far away: an owned property sees its own tile').toBe(18);
    expect('capture' in o.tiles[0][6], 'a far neutral city: unseen').toBe(false);
    expect('capture' in o.tiles[1][8], 'the enemy\'s far city: unseen').toBe(false);
    // The enemy, who sees its own city and (9,1) but not the others, is told the mirror image.
    const e = observe(s, 1);
    expect(e.tiles[1][8].capture).toBe(7);
    expect('capture' in e.tiles[0][1]).toBe(false);
  });

  it('with fog off shows every unit and every tile\'s progress; an ion storm raises the fog even when the game has none', () => {
    const s = createGame({
      map: { id: 'strip', name: 'strip', description: 'test', players: 2, terrain: ['..........'], owners: ['..........'], units: [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 0)] },
      players: players.slice(0, 2).map((p, i) => ({ ...p, team: i })), seed: 1, fog: false,
    });
    const clear = observe(s, 0);
    expect(ids(clear)).toEqual([1, 2]);
    expect(clear).toMatchObject({ fog: false, fogActive: false });
    expect(clear.visible[0].every(Boolean)).toBe(true);
    expect(clear.tiles[0].every((t) => t.capture === 20)).toBe(true);
    const storm: GameState = { ...s, weather: 'ionstorm' };
    expect(observe(storm, 0)).toMatchObject({ fog: false, fogActive: true });
    expect(ids(observe(storm, 0))).toEqual([1]);
  });

  it('lifts the fog while a reveal power is active', () => {
    const s = field();
    const seen = { ...s, players: s.players.map((p) => (p.index === 0 ? { ...p, revealTurns: 1 } : p)) };
    expect(ids(observe(seen, 0))).toEqual([1, 2, 3, 4]);
    expect(ids(observe(s, 0))).toEqual([1, 2, 4]);
  });

  it('is JSON-safe, shares nothing with the state, and leaves a frozen state alone', () => {
    const s = field();
    deepFreeze(s);
    const o = observe(s, 0);
    expect(JSON.parse(JSON.stringify(o))).toStrictEqual(o);
    const before = JSON.stringify(s);
    o.units[0].hp = 1;
    o.units[0].cargo.push(o.units[0]);
    o.tiles[0][0].terrain = 'sea';
    o.players[0].funds = -1;
    expect(JSON.stringify(s)).toBe(before);
    expect(() => observedState(s, 0)).not.toThrow();
    expect(() => agentActions(s, 0)).not.toThrow();
  });

  it('refuses a player that does not exist', () => {
    const s = field();
    for (const bad of [-1, 3, 1.5, Number.NaN]) {
      expect(() => observe(s, bad), String(bad)).toThrow(RangeError);
      expect(() => observedState(s, bad), String(bad)).toThrow(RangeError);
      expect(() => agentActions(s, bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe('observedState(): the state as the player knows it', () => {
  it('removes the enemy units the player cannot see, keeps everything else, and resets hidden capture progress', () => {
    const s0 = fixtureGame(['.C....C...', '.C........'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 6, 0), unit('lancer', 1, 9, 1)], { fog: true, owners: ['.0........', '..........'] });
    const s: GameState = { ...s0, tiles: s0.tiles.map((row, y) => row.map((t, x) => ({ ...t, capture: (x === 6 && y === 0) ? 5 : (x === 1 && y === 1) ? 9 : t.capture }))) };
    deepFreeze(s);
    const e = observedState(s, 0);
    expect(e.units.map((u) => u.id)).toEqual([1]);
    expect(e.tiles[0][6].capture, 'an enemy is capturing a far city: the progress is not known').toBe(20);
    expect(e.tiles[1][1].capture, 'a near city keeps its progress').toBe(9);
    expect(e.tiles.map((row) => row.map((t) => [t.terrain, t.owner]))).toEqual(s.tiles.map((row) => row.map((t) => [t.terrain, t.owner])));
    expect(e.players).toEqual(s.players);
    // A copy that shares nothing with the input.
    expect(e).not.toBe(s);
    expect(e.units[0]).not.toBe(s.units[0]);
    expect(e.tiles[0]).not.toBe(s.tiles[0]);
    expect(Object.isFrozen(e)).toBe(false);
    e.units[0].hp = 3;
    expect(s.units[0].hp).toBe(100);
    // Enemy sight works the other way round: player 1 sees its own units, not our trooper.
    expect(observedState(s, 1).units.map((u) => u.id)).toEqual([2, 3]);
  });

  it('agentActions is the engine\'s list on that state when it is the player\'s turn, and nothing otherwise', () => {
    const s = fixtureGame(['..f...'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)], { fog: true });
    expect(agentActions(s, 0)).toEqual(legalActions(observedState(s, 0)));
    expect(agentActions(s, 1), 'not player 1\'s turn').toEqual([]);
    expect(agentActions(s, 0).some((a) => a.kind === 'resign')).toBe(false);
    const over = applyAction(s, { kind: 'resign' }).state;
    expect(over.winnerTeam).toBe(1);
    expect(agentActions(over, over.current)).toEqual([]);
    expect(agentActions(over, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------- rule A on seeded states: reachable() and checkPath() agree

describe('rule A: reachable() and checkPath() agree about an enemy on the destination, on seeded fog states', () => {
  it('a visible enemy\'s tile is never reachable; a hidden enemy\'s tile is, and checkPath ends the move short of it', () => {
    const tally = { states: 0, entries: 0, hiddenTiles: 0, visibleEnemyTiles: 0, hiddenOnPath: 0 };
    const problems: string[] = [];
    const key = (c: Coord) => `${c.x},${c.y}`;
    const examine = (label: string, s: GameState) => {
      const cur = s.current;
      const hidden = hiddenEnemies(s, cur);
      const enemies = s.units.filter((u) => s.players[u.owner].team !== s.players[cur].team);
      tally.states++;
      for (const u of s.units) {
        if (u.owner !== cur) continue;
        const reach = reachable(s, u.id);
        for (const e of enemies) {
          if (hidden.has(key(e))) continue;
          tally.visibleEnemyTiles++;
          if (reach.has(key(e))) problems.push(`${label}: unit ${u.id} can reach the visible enemy #${e.id} at ${key(e)}`);
        }
        for (const entry of reach.values()) {
          tally.entries++;
          const walked = entry.path.slice(1);
          const crossesHidden = walked.some((c) => hidden.has(key(c)));
          let check: ReturnType<typeof checkPath>;
          try {
            check = checkPath(s, u, entry.path);
          } catch (err) {
            problems.push(`${label}: checkPath refuses reachable()'s own path to ${key(entry)}: ${(err as Error).message}`);
            continue;
          }
          if (crossesHidden) {
            tally.hiddenOnPath++;
            if (!(check.stop < entry.path.length - 1) || check.ambusher === null) problems.push(`${label}: unit ${u.id}'s path to ${key(entry)} crosses a hidden enemy but is not cut short`);
            else if (!hidden.has(key(check.ambusher))) problems.push(`${label}: unit ${u.id} is ambushed by a unit that was visible`);
          } else if (check.stop !== entry.path.length - 1 || check.ambusher !== null) {
            problems.push(`${label}: unit ${u.id}'s clear path to ${key(entry)} is cut short`);
          }
          if (hidden.has(key(entry))) {
            tally.hiddenTiles++;
            if (!crossesHidden) problems.push(`${label}: ${key(entry)} holds a hidden enemy but is not counted as an ambush`);
          }
        }
      }
    };
    for (const { label, state } of fogStates()) {
      examine(label, state);
      let p = state;
      for (const c of unseenFreeTiles(state, state.current).slice(0, 3)) p = plantHidden(p, state.current, c) ?? p;
      if (p !== state) examine(`${label} + hidden`, p);
    }
    console.log(`(A) ${tally.states} states: ${tally.entries} reachable tiles checked against checkPath, ${tally.hiddenTiles} of them holding a hidden enemy, ${tally.hiddenOnPath} paths crossing one; ${tally.visibleEnemyTiles} visible-enemy tiles, none reachable`);
    expect(problems.slice(0, 5)).toEqual([]);
    expect(tally.hiddenTiles, 'destinations with a hidden enemy on them were met').toBeGreaterThanOrEqual(30);
    expect(tally.visibleEnemyTiles).toBeGreaterThanOrEqual(20);
  });
});
