// The per-viewer event filter (D-016, the second half): viewEvents(before, after, events, viewer) gives a player only the events of a
// step that the player's team could have seen. Rules (see the table at the top of view-events.ts):
//   (a) a friend's events are kept in full        (b) an enemy move keeps only its visible tiles      (c) combat: ours kept, a hidden shooter redacted
//   (d) an enemy build / capture / join / load / unload / supply is kept on a visible tile only         (e) public events are always kept
//   (f) an ambush or a blocked drop reveals the blocker
// Four groups of tests:
//   1. hand-built positions, one or more per rule, with literal expected answers worked out from the rules and the map, never read back
//      from view-events.ts; and events handed in by hand, for the cases the engine's geometry never produces;
//   2. properties over seeded fog self-play (sim.ts, shipped maps, every player as the viewer):
//        SOUND         every kept enemy event refers only to tiles and units that observe() shows the viewer, or that rule (c) / (f) reveals;
//        COMPLETE      a friend's events and the public ones come through verbatim, and so does every enemy event that was fully in sight
//                      (so "return nothing" cannot pass);
//        INDISTINGUISHABLE  hidden enemies planted where the viewer cannot see them change nothing it is shown -- while they stand, and
//                      while they MOVE, BUILD, CAPTURE or FIRE: a fully hidden act yields no event, a half-seen move yields exactly its seen part;
//        FOG OFF       the input comes back unchanged;
//   3. known-bad filters (keep everything, drop everything, never redact, never trim, keep every build) run through the same checkers,
//      which must refuse each;
//   4. the filter is a function of (before, after, events) alone: replayed states (replay.ts) give the same answer.
// Planted units take a high id and leave `nextUnitId` alone, so the ids of units built afterwards do not shift (see NOTES: unit ids are
// the engine's counter and a gap in them is a hint neither this filter nor observe() hides).
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { MAPS } from '../../content/maps';
import { TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import { IllegalActionError, applyAction, canSeeUnit, createGame, isLegal, reachable, visibility } from './index';
import type { CreateGameOptions, PlayerSetup } from './index';
import { buildActions, destinationActions } from './legal';
import { canStandOn } from './movement';
import { observe } from './observe';
import { replay, stateHash } from './replay';
import { simulate } from './sim';
import type { SimPolicy, SimStep } from './sim';
import { fixtureGame, fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import { UNSEEN_UNIT, isAmbushView, viewEvents } from './view-events';
import type { Action, Coord, FactionId, GameEvent, GameState, PlayerIndex, Then, Unit, UnitTypeId } from './types';

// ---------------------------------------------------------------- helpers

type Ev<K extends GameEvent['kind']> = Extract<GameEvent, { kind: K }>;
const at = (x: number, y: number): Coord => ({ x, y });
const mv = (unitId: number, path: [number, number][], then: Then = { kind: 'wait' }): Action => ({
  kind: 'move', unitId, path: path.map(([x, y]) => at(x, y)), then,
});
const unit = (type: UnitTypeId, owner: number, x: number, y: number, hp?: number): FixtureUnit => ({ type, owner, x, y, ...(hp ? { hp } : {}) });
const unitOf = (s: GameState, id: number): Unit => s.units.find((u) => u.id === id)!;
const json = (v: unknown): string => JSON.stringify(v);
const endTurn: Action = { kind: 'endTurn' };

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

const patchUnit = (s: GameState, id: number, patch: Partial<Unit>): GameState => ({ ...s, units: s.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
const patchPlayer = (s: GameState, p: number, patch: Partial<GameState['players'][number]>): GameState => ({ ...s, players: s.players.map((q) => (q.index === p ? { ...q, ...patch } : q)) });
const withCapture = (s: GameState, x: number, y: number, capture: number): GameState => ({
  ...s, tiles: s.tiles.map((row, ry) => (ry === y ? row.map((t, rx) => (rx === x ? { ...t, capture } : t)) : row)),
});

/** The state with the units `cargoIds` (currently on the map) moved inside the transport `transportId`. */
function loadInto(s: GameState, transportId: number, cargoIds: number[]): GameState {
  const t = unitOf(s, transportId);
  const cargo = s.units.filter((u) => cargoIds.includes(u.id)).map((u) => ({ ...u, x: t.x, y: t.y }));
  return { ...s, units: s.units.filter((u) => !cargoIds.includes(u.id)).map((u) => (u.id === transportId ? { ...u, cargo } : u)) };
}

/** Passes turns until it is `p`'s. */
function toTurn(s: GameState, p: number): GameState {
  let cur = s;
  for (let i = 0; cur.current !== p && i < 10; i++) cur = applyAction(cur, endTurn).state;
  expect(cur.current, 'setup: reached the turn').toBe(p);
  return cur;
}

const COVERED = new Set<GameEvent['kind']>();

/** One step, with its inputs and outputs frozen: a filter that writes into any of them throws. */
interface Step { before: GameState; after: GameState; events: GameEvent[] }
function stepOf(before: GameState, action: Action): Step {
  deepFreeze(before);
  const r = applyAction(before, action);
  deepFreeze(r.state);
  deepFreeze(r.events);
  for (const e of r.events) COVERED.add(e.kind);
  return { before, after: r.state, events: r.events };
}
const vw = (st: Step, viewer: number): GameEvent[] => viewEvents(st.before, st.after, st.events, viewer);

/** A two-player fog game on a fixture map with money to spend. */
const mk = (rows: string[], units: FixtureUnit[], extra: Partial<CreateGameOptions> & { owners?: string[] } = {}): GameState =>
  fixtureGame(rows, units, { fog: true, startFunds: 10000, ...extra });

/** A game of three players; `teams` says who is allied with whom (default: three separate teams). */
function gameOf(
  rows: string[], units: FixtureUnit[], opts: { teams?: number[]; commanders?: string[] } = {}, extra: Partial<CreateGameOptions> = {},
): GameState {
  const teams = opts.teams ?? [0, 1, 2];
  const factions: FactionId[] = ['helion', 'tidewell', 'verdant'];
  const players: PlayerSetup[] = teams.map((team, i) => ({
    faction: factions[i % 3], commander: opts.commanders?.[i] ?? 'none', controller: 'ai', team, funds: 10000,
  }));
  return createGame({ map: fixtureMap(rows, units), players, seed: 1, fog: true, ...extra });
}

const TEN = ['..........', '..........']; // two rows of ten flats: our trooper at (0,0) sees (0..2,0), (0..1,1) and (0,2) only

// ---------------------------------------------------------------- 1. hand-built, rule by rule

describe('rule (a): events about the viewer\'s own and allied units are kept in full', () => {
  // Players 0 and 2 are one team. Their troopers stand five tiles apart, and player 1's is out of sight of both.
  const s = () => gameOf(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 1), unit('trooper', 2, 5, 0)], { teams: [0, 1, 0] });

  it('a unit that moves is shown to its owner, to its ally (whom it cannot see) and not to the enemy', () => {
    const st = stepOf(s(), mv(1, [[0, 0], [1, 0]]));
    expect(st.events).toEqual([{ kind: 'moved', unitId: 1, path: [at(0, 0), at(1, 0)] }]);
    expect(vw(st, 0)).toEqual(st.events);
    expect(vw(st, 2), 'the ally is five tiles from it and still sees all of it').toEqual(st.events);
    expect(vw(st, 1), 'the enemy sees nothing of it').toEqual([]);
    expect(vw(st, 0)[0], 'a copy: the result shares nothing with the input').not.toBe(st.events[0]);
  });

  it('the ally\'s own turn reads the same way from the other side', () => {
    const st = stepOf(toTurn(s(), 2), mv(3, [[5, 0], [6, 0], [7, 0]]));
    expect(vw(st, 0)).toEqual(st.events);
    expect(vw(st, 2)).toEqual(st.events);
    expect(vw(st, 1), 'the enemy trooper at (9,1) is four tiles from (7,0)').toEqual([]);
  });

  it('a friend\'s build and capture come through whole even with no enemy in sight', () => {
    const g = mk(['..C..F....', '..........'], [unit('trooper', 0, 2, 0), unit('trooper', 1, 9, 1)], { owners: ['.....0....', '..........'] });
    const cap = stepOf(g, mv(1, [[2, 0]], { kind: 'capture' }));
    expect(cap.events.map((e) => e.kind)).toEqual(['moved', 'captureProgress']);
    expect(vw(cap, 0)).toEqual(cap.events);
    const built = stepOf(g, { kind: 'build', at: at(5, 0), unitType: 'trooper' });
    expect(vw(built, 0)).toEqual(built.events);
    expect(built.events[0]).toMatchObject({ kind: 'built', owner: 0, at: at(5, 0) });
  });
});

describe('rule (b): an enemy unit\'s movement is kept only where it was seen, trimmed to the tiles we see', () => {
  const field = (units: FixtureUnit[]) => toTurn(mk(TEN, units), 1);
  const ours = unit('trooper', 0, 0, 0);

  it('a path that walks into sight is cut to the tiles inside it', () => {
    const st = stepOf(field([ours, unit('trooper', 1, 4, 0)]), mv(2, [[4, 0], [3, 0], [2, 0], [1, 0]]));
    expect(st.events).toEqual([{ kind: 'moved', unitId: 2, path: [at(4, 0), at(3, 0), at(2, 0), at(1, 0)] }]);
    expect(vw(st, 0)).toEqual([{ kind: 'moved', unitId: 2, path: [at(2, 0), at(1, 0)] }]);
    expect(vw(st, 1), 'the mover itself keeps all of it').toEqual(st.events);
  });

  it('a move wholly out of sight is dropped', () => {
    const st = stepOf(field([ours, unit('trooper', 1, 9, 1)]), mv(2, [[9, 1], [8, 1], [7, 1]]));
    expect(st.events).toHaveLength(1);
    expect(vw(st, 0)).toEqual([]);
  });

  it('a move wholly in sight is kept as it is', () => {
    const st = stepOf(field([ours, unit('trooper', 1, 2, 0)]), mv(2, [[2, 0], [1, 0]]));
    expect(vw(st, 0)).toEqual(st.events);
  });

  it('sight that the step itself takes away still counts: what we saw before our unit fell is shown', () => {
    // Our one-HP trooper at (0,0) is killed by an enemy that walks (3,0) -> (1,0). Our other unit is at (9,1), so after the step
    // nothing near (0,0) is in sight; before it, (2,0) and (1,0) were, and (3,0) was not.
    const s = field([unit('trooper', 0, 0, 0, 1), unit('trooper', 0, 9, 1), unit('trooper', 1, 3, 0)]);
    const st = stepOf(s, mv(3, [[3, 0], [2, 0], [1, 0]], { kind: 'attack', target: at(0, 0) }));
    expect(st.events.map((e) => e.kind)).toEqual(['moved', 'attacked', 'destroyed']);
    expect(vw(st, 0)).toEqual([{ kind: 'moved', unitId: 3, path: [at(2, 0), at(1, 0)] }, st.events[1], st.events[2]]);
  });

  it('a unit that is seen, lost and seen again keeps the two stretches it was seen on', () => {
    // Our troopers at (0,0) and (6,0) see x <= 2 and x >= 4 on row 0; the middle of the road, (3,0), is in nobody's sight.
    const st = stepOf(field([ours, unit('trooper', 0, 6, 0), unit('trooper', 1, 2, 0)]), mv(3, [[2, 0], [3, 0], [4, 0]]));
    expect(vw(st, 0)).toEqual([{ kind: 'moved', unitId: 3, path: [at(2, 0), at(4, 0)] }]);
  });

  it('a unit that acts where it stands is kept when its tile is seen and dropped when it is not', () => {
    const near = stepOf(field([ours, unit('trooper', 1, 2, 0)]), mv(2, [[2, 0]]));
    expect(vw(near, 0)).toEqual(near.events);
    const far = stepOf(field([ours, unit('trooper', 1, 8, 0)]), mv(2, [[8, 0]]));
    expect(vw(far, 0)).toEqual([]);
  });
});

describe('rule (c): combat that involves one of our units is kept; a shooter we cannot see is redacted', () => {
  // A row of flats. Our trooper (unit 1, vision 2) stands at (3,0).
  const row = (...units: FixtureUnit[]) => toTurn(mk(TEN, [unit('trooper', 0, 3, 0), ...units]), 1);

  it('an arc battery out of our sight fires on us: the strike is shown, the shooter is not', () => {
    // Enemy trooper 2 at (5,0) sees our trooper; the arc (unit 3, vision 1) at (0,0), three tiles from its target, fires on what 2 sees.
    const s = row(unit('trooper', 1, 5, 0), unit('arc', 1, 0, 0));
    expect(canSeeUnit(s, 0, unitOf(s, 3)), 'setup: we cannot see the arc').toBe(false);
    const st = stepOf(s, mv(3, [[0, 0]], { kind: 'attack', target: at(3, 0) }));
    expect(st.events.map((e) => e.kind)).toEqual(['moved', 'attacked']);
    const raw = st.events[1] as Ev<'attacked'>;
    expect(raw).toMatchObject({ attackerId: 3, defenderId: 1, counter: 0, attackerHp: 100 });
    expect(raw.damage).toBeGreaterThan(0);
    const out = vw(st, 0);
    expect(out, 'the arc\'s own move is dropped; the strike stays, minus who and how healthy').toEqual([
      { kind: 'attacked', attackerId: UNSEEN_UNIT, defenderId: 1, damage: raw.damage, counter: 0, attackerHp: UNSEEN_UNIT, defenderHp: raw.defenderHp },
    ]);
    expect(vw(st, 1), 'the arc\'s own side sees all of it').toEqual(st.events);
  });

  it('an attacker we can see is named in full, counter-strike and all', () => {
    const st = stepOf(row(unit('trooper', 1, 4, 0)), mv(2, [[4, 0]], { kind: 'attack', target: at(3, 0) }));
    const raw = st.events[1] as Ev<'attacked'>;
    expect(raw.counter, 'setup: our trooper hits back').toBeGreaterThan(0);
    expect(vw(st, 0)).toEqual(st.events);
  });

  it('our own attack is kept whole, including the death it causes', () => {
    const s = mk(TEN, [unit('trooper', 0, 3, 0), unit('trooper', 1, 4, 0, 1), unit('trooper', 1, 9, 1)]); // a second enemy keeps the game going
    const st = stepOf(s, mv(1, [[3, 0]], { kind: 'attack', target: at(4, 0) }));
    expect(st.events.map((e) => e.kind)).toEqual(['moved', 'attacked', 'destroyed']);
    expect(vw(st, 0)).toEqual(st.events);
    expect(vw(st, 1), 'the one who lost the unit sees it all too').toEqual(st.events);
  });

  it('an attack that closes in on a target we could not see before is shown, and so is the death it causes', () => {
    // Our trooper at (0,0) sees to (2,0). It walks to (2,0) and strikes the one-HP enemy at (3,0), which only that step brings into sight.
    const s = mk(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 3, 0, 1), unit('trooper', 1, 9, 1)]);
    expect(canSeeUnit(s, 0, unitOf(s, 2)), 'setup: unseen when the order is given').toBe(false);
    const st = stepOf(s, mv(1, [[0, 0], [1, 0], [2, 0]], { kind: 'attack', target: at(3, 0) }));
    expect(st.events.map((e) => e.kind)).toEqual(['moved', 'attacked', 'destroyed']);
    expect(vw(st, 0)).toEqual(st.events);
  });

  it('a fight between two other sides is dropped when we see neither, and redacted when we see only the defender', () => {
    // Player 1 (arc 3 at (6,0), spotter 4 at (8,0)) fires on player 2's trooper 2 at (9,0), a one-HP unit that is player 2's last:
    // it dies, and player 2 with it. Player 0 is the viewer.
    const fight = (ours: FixtureUnit) => toTurn(
      gameOf(TEN, [ours, unit('trooper', 2, 9, 0, 1), unit('arc', 1, 6, 0), unit('trooper', 1, 8, 0)]), 1,
    );
    const dark = stepOf(fight(unit('trooper', 0, 0, 0)), mv(3, [[6, 0]], { kind: 'attack', target: at(9, 0) }));
    expect(dark.events.map((e) => e.kind)).toEqual(['moved', 'attacked', 'destroyed', 'playerDefeated']);
    expect(vw(dark, 0), 'two enemies of ours fighting and dying in the dark: only the defeat, which is public').toEqual([dark.events[3]]);
    const watched = stepOf(fight(unit('trooper', 0, 9, 1)), mv(3, [[6, 0]], { kind: 'attack', target: at(9, 0) }));
    const raw = watched.events[1] as Ev<'attacked'>;
    expect(vw(watched, 0), 'our trooper at (9,1) sees the defender at (9,0) but not the arc at (6,0)').toEqual([
      { ...raw, attackerId: UNSEEN_UNIT, attackerHp: UNSEEN_UNIT }, watched.events[2], watched.events[3],
    ]);
  });
});

describe('rule (d): an enemy build, capture, join, load, unload or supply is kept on a visible tile only', () => {
  // Our trooper (vision 2) at (0,0). Row 0 tiles (1,0) and (2,0) are in sight; (3,0) and everything from (4,0) on is not.
  const BUILD_ROWS = ['..F.....F.', '..........'];
  const BUILD_OWNERS = ['..1.....1.', '..........'];
  const ours = unit('trooper', 0, 0, 0);

  it('a build on a visible property is shown; one far away is not', () => {
    const s = toTurn(mk(BUILD_ROWS, [ours, unit('trooper', 1, 9, 1)], { owners: BUILD_OWNERS }), 1);
    const near = stepOf(s, { kind: 'build', at: at(2, 0), unitType: 'trooper' });
    expect(near.events).toEqual([{ kind: 'built', unitId: 3, type: 'trooper', at: at(2, 0), owner: 1, cost: UNIT_TYPES.trooper.cost }]);
    expect(vw(near, 0)).toEqual(near.events);
    const far = stepOf(s, { kind: 'build', at: at(8, 0), unitType: 'trooper' });
    expect(far.events).toHaveLength(1);
    expect(vw(far, 0)).toEqual([]);
    expect(vw(far, 1), 'its builder is told').toEqual(far.events);
  });

  it('a capture under way is shown on a visible tile and not elsewhere; the change of owner is public either way', () => {
    const cities = ['..C.....C.', '..........'];
    const s = toTurn(mk(cities, [ours, unit('trooper', 1, 2, 0), unit('trooper', 1, 8, 0)]), 1);
    const near = stepOf(s, mv(2, [[2, 0]], { kind: 'capture' }));
    expect(near.events.map((e) => e.kind)).toEqual(['moved', 'captureProgress']);
    expect(vw(near, 0)).toEqual(near.events);
    const far = stepOf(s, mv(3, [[8, 0]], { kind: 'capture' }));
    expect(far.events.map((e) => e.kind)).toEqual(['moved', 'captureProgress']);
    expect(vw(far, 0), 'no progress report from a tile we cannot see').toEqual([]);
    const taken = stepOf(withCapture(s, 8, 0, 5), mv(3, [[8, 0]], { kind: 'capture' }));
    expect(taken.events.map((e) => e.kind)).toEqual(['moved', 'captured']);
    expect(vw(taken, 0), 'only the new owner of the property is told').toEqual([
      { kind: 'captured', at: at(8, 0), terrain: 'arcology', by: 1, from: null },
    ]);
  });

  it('a join is shown on a visible tile and not elsewhere', () => {
    // Two wounded enemy troopers: unit 3 (4 HP) joins unit 2 (5 HP).
    const near = stepOf(toTurn(mk(TEN, [ours, unit('trooper', 1, 1, 0, 5), unit('trooper', 1, 2, 0, 4)]), 1), mv(3, [[2, 0], [1, 0]], { kind: 'join' }));
    expect(near.events.map((e) => e.kind)).toEqual(['moved', 'joined']);
    expect(vw(near, 0)).toEqual(near.events);
    const far = stepOf(toTurn(mk(TEN, [ours, unit('trooper', 1, 9, 0, 5), unit('trooper', 1, 8, 0, 4)]), 1), mv(3, [[8, 0], [9, 0]], { kind: 'join' }));
    expect(far.events.map((e) => e.kind)).toEqual(['moved', 'joined']);
    expect(vw(far, 0)).toEqual([]);
  });

  it('a load is shown on a visible tile and not elsewhere', () => {
    const near = stepOf(toTurn(mk(TEN, [ours, unit('mule', 1, 1, 0), unit('trooper', 1, 2, 0)]), 1), mv(3, [[2, 0], [1, 0]], { kind: 'load' }));
    expect(near.events.map((e) => e.kind)).toEqual(['moved', 'loaded']);
    expect(vw(near, 0)).toEqual(near.events);
    const far = stepOf(toTurn(mk(TEN, [ours, unit('mule', 1, 9, 0), unit('trooper', 1, 8, 0)]), 1), mv(3, [[8, 0], [9, 0]], { kind: 'load' }));
    expect(far.events.map((e) => e.kind)).toEqual(['moved', 'loaded']);
    expect(vw(far, 0)).toEqual([]);
  });

  it('an unload is shown when its landing tile is seen; the transport\'s id stays back when its own tile is not', () => {
    const drop = (muleX: number, to: [number, number]) => stepOf(
      toTurn(loadInto(mk(TEN, [ours, unit('mule', 1, muleX, 0), unit('trooper', 1, 9, 1)]), 2, [3]), 1),
      mv(2, [[muleX, 0]], { kind: 'unload', drops: [{ cargoIndex: 0, to: at(...to) }] }),
    );
    const whole = drop(1, [1, 1]); // the mule at (1,0) and the landing at (1,1): both in sight
    expect(whole.events.map((e) => e.kind)).toEqual(['moved', 'unloaded']);
    expect(vw(whole, 0)).toEqual(whole.events);
    const half = drop(3, [2, 0]); // the mule at (3,0) is out of sight, the landing at (2,0) is not
    expect(half.events.map((e) => e.kind)).toEqual(['moved', 'unloaded']);
    expect(vw(half, 0), 'the trooper appears at (2,0); the mule that set it down stays unnamed').toEqual([
      { kind: 'unloaded', unitId: 3, transportId: UNSEEN_UNIT, to: at(2, 0) },
    ]);
    const none = drop(3, [4, 0]); // both tiles out of sight
    expect(vw(none, 0)).toEqual([]);
  });

  it('a supply is shown on a visible tile, with only the units we can see among those supplied', () => {
    // The supplier's own turn start would top them up, so they are emptied after it.
    const dry = (ids: number[], s: GameState) => ids.reduce((acc, id) => patchUnit(acc, id, { ammo: 2 }), toTurn(s, 1));
    // Mule 2 at (1,1) (in sight) with arc 3 at (1,0) (in sight) and arc 4 at (2,1) (three tiles from our trooper: not).
    const s = dry([3, 4], mk(TEN, [ours, unit('mule', 1, 1, 1), unit('arc', 1, 1, 0), unit('arc', 1, 2, 1)]));
    const st = stepOf(s, mv(2, [[1, 1]], { kind: 'supply' }));
    expect(st.events).toEqual([
      { kind: 'moved', unitId: 2, path: [at(1, 1)] },
      { kind: 'supplied', byId: 2, unitIds: [3, 4] },
    ]);
    expect(vw(st, 0)).toEqual([st.events[0], { kind: 'supplied', byId: 2, unitIds: [3] }]);
    // Everyone supplied is out of sight: no supplied event at all (its existence would tell us a hidden unit was there).
    const hiddenOnly = dry([4], mk(TEN, [ours, unit('mule', 1, 1, 1), unit('arc', 1, 2, 1)]));
    const st2 = stepOf(hiddenOnly, mv(2, [[1, 1]], { kind: 'supply' }));
    expect(st2.events.map((e) => e.kind)).toEqual(['moved', 'supplied']);
    expect(vw(st2, 0)).toEqual([st2.events[0]]);
    // A mule out of sight is not named, even though the unit beside it, at (2,0), is in sight.
    const muleHidden = dry([3], mk(TEN, [ours, unit('mule', 1, 3, 0), unit('arc', 1, 2, 0)]));
    const st3 = stepOf(muleHidden, mv(2, [[3, 0]], { kind: 'supply' }));
    expect(st3.events).toEqual([{ kind: 'moved', unitId: 2, path: [at(3, 0)] }, { kind: 'supplied', byId: 2, unitIds: [3] }]);
    expect(vw(st3, 0)).toEqual([]);
    // A mule out of sight, nothing of it shown.
    const far = dry([4], mk(TEN, [ours, unit('mule', 1, 8, 1), unit('arc', 1, 9, 1)]));
    expect(vw(stepOf(far, mv(2, [[8, 1]], { kind: 'supply' })), 0)).toEqual([]);
  });

  it('the start of the enemy\'s turn: a repair is shown on a visible tile, a crash likewise, and neither is shown elsewhere', () => {
    const cities = ['.C......C.', '..........'];
    const owned = ['.1......1.', '..........'];
    // Wounded enemy troopers on their own cities at (1,0) (in sight) and (8,0), and out-of-fuel wasps beside each.
    const s0 = mk(cities, [ours, unit('trooper', 1, 1, 0, 5), unit('trooper', 1, 8, 0, 5), unit('wasp', 1, 1, 1), unit('wasp', 1, 9, 1)], { owners: owned });
    const st = stepOf(patchUnit(patchUnit(s0, 4, { charge: 0 }), 5, { charge: 0 }), endTurn);
    expect(st.events.map((e) => e.kind)).toEqual(['turnEnded', 'repaired', 'repaired', 'crashed', 'crashed', 'turnStarted']);
    expect(vw(st, 0).map((e) => e.kind), 'we are shown the repair at (1,0), the crash at (1,1) and the turn change').toEqual(['turnEnded', 'repaired', 'crashed', 'turnStarted']);
    const kept = vw(st, 0);
    expect(kept[1]).toMatchObject({ kind: 'repaired', unitId: 2 });
    expect(kept[2]).toMatchObject({ kind: 'crashed', unitId: 4, at: at(1, 1) });
  });
});

describe('rule (e): public events are kept for everyone', () => {
  it('turn changes, a surrender and the victory it brings reach a viewer who sees nothing of the enemy', () => {
    const s = mk(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 1)]);
    const turn = stepOf(s, endTurn);
    expect(turn.events.map((e) => e.kind)).toEqual(['turnEnded', 'turnStarted']);
    expect(vw(turn, 0)).toEqual(turn.events);
    expect(vw(turn, 1)).toEqual(turn.events);
    const quit = stepOf(toTurn(s, 1), { kind: 'resign' });
    expect(quit.events).toEqual([{ kind: 'playerDefeated', player: 1, reason: 'resign' }, { kind: 'victory', team: 0 }]);
    expect(vw(quit, 0)).toEqual(quit.events);
  });

  it('a power is announced to all; what it did to hidden units is not', () => {
    // Player 1 is Rook: Jury-Rig heals every unit it has. One is in our sight at (1,0), one is at (8,0).
    const s = patchPlayer(toTurn(gameOf(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 1, 0), unit('trooper', 1, 8, 0)], { teams: [0, 1], commanders: ['rook', 'rook'] }), 1), 1, { power: 1e6 });
    expect(COMMANDERS.rook.surge?.effects[0]).toMatchObject({ kind: 'heal' });
    const st = stepOf(s, { kind: 'power', level: 'surge' });
    expect(st.events).toEqual([
      { kind: 'powerActivated', player: 1, level: 'surge', commander: 'rook' },
      { kind: 'powerEffect', player: 1, description: '+2 HP and full resupply', affected: [at(1, 0), at(8, 0)] },
    ]);
    expect(vw(st, 0)).toEqual([st.events[0], { ...st.events[1], affected: [at(1, 0)] }]);
    expect(vw(st, 1), 'its owner is shown all of it').toEqual(st.events);
  });

  it('a count of hidden units in a power\'s text is blanked, and the owner still reads it', () => {
    // Player 1 is Juno: Hivemind lets up to three acted air units act again. Two wasps have acted: one in sight, one not.
    const s0 = toTurn(gameOf(TEN, [unit('trooper', 0, 0, 0), unit('wasp', 1, 1, 0), unit('wasp', 1, 8, 0)], { teams: [0, 1], commanders: ['juno', 'juno'] }), 1);
    const s = patchPlayer(patchUnit(patchUnit(s0, 2, { acted: true }), 3, { acted: true }), 1, { power: 1e6 });
    const st = stepOf(s, { kind: 'power', level: 'overclock' });
    expect(st.events[1]).toEqual({ kind: 'powerEffect', player: 1, description: '2 units may act again', affected: [at(1, 0), at(8, 0)] });
    expect(vw(st, 0)[1]).toEqual({ kind: 'powerEffect', player: 1, description: 'units may act again', affected: [at(1, 0)] });
    expect(vw(st, 1)[1]).toEqual(st.events[1]);
  });

  it('an ally\'s power is read in full, a count of units included', () => {
    // Players 0 and 2 are one team; player 2 is Juno and its two wasps, one far from every unit of ours, may act again.
    const s0 = toTurn(gameOf(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 1), unit('wasp', 2, 1, 0), unit('wasp', 2, 7, 0)], { teams: [0, 1, 0], commanders: ['none', 'none', 'juno'] }), 2);
    const s = patchPlayer(patchUnit(patchUnit(s0, 3, { acted: true }), 4, { acted: true }), 2, { power: 1e6 });
    const st = stepOf(s, { kind: 'power', level: 'overclock' });
    expect(st.events[1]).toEqual({ kind: 'powerEffect', player: 2, description: '2 units may act again', affected: [at(1, 0), at(7, 0)] });
    expect(vw(st, 0), 'player 0 is its ally').toEqual(st.events);
    expect(vw(st, 1)[1], 'player 1 is not').toEqual({ kind: 'powerEffect', player: 2, description: 'units may act again', affected: [] });
  });

  it('weather changes are public, and a storm that raises fog on a clear game changes nothing for the viewer', () => {
    const storm = (fog: boolean) => patchPlayer(toTurn(gameOf(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 1)], { teams: [0, 1], commanders: ['sable', 'sable'] }, { fog }), 1), 1, { power: 1e6 });
    expect(COMMANDERS.sable.surge?.effects[0]).toMatchObject({ kind: 'weather', weather: 'ionstorm' });
    const foggy = stepOf(storm(true), { kind: 'power', level: 'surge' });
    expect(foggy.events.map((e) => e.kind)).toEqual(['powerActivated', 'weather', 'powerEffect']);
    expect(vw(foggy, 0)).toEqual(foggy.events);
    const clear = stepOf(storm(false), { kind: 'power', level: 'surge' });
    expect(clear.after.weather).toBe('ionstorm');
    expect(vw(clear, 0), 'the step began with no fog: every tile was in sight').toEqual(clear.events);
  });
});

describe('rule (f): an ambush or a blocked drop reveals the blocker', () => {
  it('our trooper walks into a hidden enemy: the ambush is shown and says where the blocker stands', () => {
    // As in observe.test: an enemy trooper (unit 2) on canopy two tiles from ours.
    const s = mk(['..f...', '......'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)]);
    expect(canSeeUnit(s, 0, unitOf(s, 2)), 'setup: hidden').toBe(false);
    const st = stepOf(s, mv(1, [[0, 0], [1, 0], [2, 0]]));
    expect(st.events).toEqual([
      { kind: 'moved', unitId: 1, path: [at(0, 0), at(1, 0)] },
      { kind: 'ambushed', unitId: 1, at: at(1, 0), by: 2 },
    ]);
    const out = vw(st, 0);
    expect(out).toEqual([st.events[0], { kind: 'ambushed', unitId: 1, at: at(1, 0), by: 2, blockerAt: at(2, 0) }]);
    expect(isAmbushView(out[1])).toBe(true);
    expect(isAmbushView(st.events[1]), 'the raw event has no blockerAt').toBe(false);
  });

  it('the side that sprang the trap sees the enemy stop in front of it, and where its own blocker is', () => {
    const s = mk(['..f...', '......'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)]);
    const st = stepOf(s, mv(1, [[0, 0], [1, 0], [2, 0]]));
    expect(vw(st, 1)).toEqual([st.events[0], { ...st.events[1], blockerAt: at(2, 0) }]);
  });

  it('a trap between two other sides is dropped for a viewer who sees neither', () => {
    // Player 1's trooper 2 at (6,0) walks toward player 2's trooper 3 at (9,0), which it cannot see from there, and is stopped at (8,0).
    // Player 0 is far away at (0,0).
    const s = toTurn(gameOf(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 6, 0), unit('trooper', 2, 9, 0)]), 1);
    const st = stepOf(s, mv(2, [[6, 0], [7, 0], [8, 0], [9, 0]]));
    expect(st.events.map((e) => e.kind)).toEqual(['moved', 'ambushed']);
    expect(vw(st, 0)).toEqual([]);
  });

  it('a blocked drop is shown to the transport\'s side, `at` being the blocker\'s tile', () => {
    // As in observe.test rule B: a barge with two troops lands on a shoal; an enemy trooper (unit 4) waits at (4,0).
    const map = ['......', '~~~~s.', '......'];
    const s = loadInto(mk(map, [unit('barge', 0, 0, 1), unit('trooper', 0, 0, 0), unit('breacher', 0, 1, 0), unit('trooper', 1, 4, 0)]), 1, [2, 3]);
    const path: [number, number][] = [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]];
    const st = stepOf(s, mv(1, path, { kind: 'unload', drops: [{ cargoIndex: 0, to: at(4, 0) }, { cargoIndex: 1, to: at(5, 1) }] }));
    expect(st.events.map((e) => e.kind)).toEqual(['moved', 'dropBlocked', 'unloaded']);
    expect(st.events[1]).toEqual({ kind: 'dropBlocked', transportId: 1, cargoId: 2, at: at(4, 0), by: 4 });
    expect(vw(st, 0), 'all of it, the blocker included').toEqual(st.events);
    // The blocker's own side sees the barge arrive beside it and the unload that did land.
    expect(vw(st, 1).map((e) => e.kind)).toEqual(['moved', 'dropBlocked', 'unloaded']);
  });
});

describe('events handed in by hand: the contract does not depend on the engine producing them', () => {
  // Our trooper 1 at (0,0); enemy mule 2 at (8,0) and enemy trooper 3 at (9,1), both far outside sight; player 2's trooper 4 at (9,0).
  const base = () => { const s = gameOf(TEN, [unit('trooper', 0, 0, 0), unit('mule', 1, 8, 0), unit('trooper', 1, 9, 1), unit('trooper', 2, 9, 0)]); deepFreeze(s); return s; };
  const through = (events: GameEvent[], viewer = 0) => { const s = base(); deepFreeze(events); return viewEvents(s, s, events, viewer); };

  it('an enemy stopped by one of our units is shown only where we can see it stop', () => {
    expect(through([{ kind: 'ambushed', unitId: 3, at: at(5, 1), by: 1 }])).toEqual([]);
    expect(through([{ kind: 'ambushed', unitId: 3, at: at(1, 0), by: 1 }])).toEqual([{ kind: 'ambushed', unitId: 3, at: at(1, 0), by: 1, blockerAt: at(0, 0) }]);
  });

  it('a drop blocked by our unit is not shown when the transport that tried it is out of sight; between two other sides it needs the blocker in sight', () => {
    expect(through([{ kind: 'dropBlocked', transportId: 2, cargoId: 77, at: at(0, 0), by: 1 }])).toEqual([]);
    expect(through([{ kind: 'dropBlocked', transportId: 2, cargoId: 77, at: at(9, 0), by: 4 }])).toEqual([]);
  });

  it('a drop between two other sides is shown only when the transport and the blocker are both in sight', () => {
    // A second enemy mule, unit 5, stands at (1,0) in plain view; player 2's trooper 4 is at (9,0), unseen.
    const s = gameOf(TEN, [unit('trooper', 0, 0, 0), unit('mule', 1, 8, 0), unit('trooper', 1, 9, 1), unit('trooper', 2, 9, 0), unit('mule', 1, 1, 0)]);
    deepFreeze(s);
    expect(viewEvents(s, s, [{ kind: 'dropBlocked', transportId: 5, cargoId: 77, at: at(9, 0), by: 4 }], 0), 'the blocker is out of sight').toEqual([]);
    const seenBoth: GameEvent = { kind: 'dropBlocked', transportId: 5, cargoId: 77, at: at(2, 0), by: 4 };
    expect(viewEvents(s, s, [seenBoth], 0), 'both in sight').toEqual([seenBoth]);
  });

  it('a trap on one of our own units is shown with the blocker\'s real tile even when no unit of ours is near it', () => {
    const e: GameEvent = { kind: 'ambushed', unitId: 1, at: at(0, 0), by: 3 };
    expect(through([e])).toEqual([{ ...e, blockerAt: at(9, 1) }]);
  });

  it('what refers to a unit the game never had is dropped: the filter fails toward showing less', () => {
    expect(through([
      { kind: 'repaired', unitId: 999, amount: 20, cost: 100 }, { kind: 'loaded', unitId: 998, transportId: 999 },
      { kind: 'joined', unitId: 998, intoId: 999, refund: 0 }, { kind: 'captureProgress', unitId: 999, at: at(9, 0), remaining: 5 },
      { kind: 'attacked', attackerId: 999, defenderId: 998, damage: 5, counter: 0, attackerHp: 95, defenderHp: 95 },
    ])).toEqual([]);
  });

  it('the same events reach their own side whole, and no one else', () => {
    const events: GameEvent[] = [{ kind: 'repaired', unitId: 2, amount: 20, cost: 100 }, { kind: 'captureProgress', unitId: 3, at: at(9, 1), remaining: 5 }];
    expect(through(events, 1)).toEqual(events);
    expect(through(events, 0)).toEqual([]);
  });
});

describe('a known limit, pinned so that it goes red the day it is closed', () => {
  // Unit ids are the engine's counter (nextUnitId). A hidden unit that has taken an id leaves a gap: the next unit anyone builds is
  // numbered one higher, and the viewer sees that number on its own `built` event. Neither this filter nor observe() hides the gap.
  // `it.fails` is an assertion that the two streams ARE the same; it holds only the day ids stop depending on hidden units.
  it.fails('a hidden unit that consumed an id changes the id of the unit we build next', () => {
    const base = mk(['..F.....', '........'], [unit('trooper', 0, 3, 0), unit('trooper', 1, 7, 1)], { owners: ['..0.....', '........'] });
    const taker: Unit = { id: base.nextUnitId, type: 'trooper', owner: 1, x: 7, y: 0, hp: 100, charge: 99, ammo: 0, acted: false, cargo: [] };
    const withHidden: GameState = { ...base, units: [...base.units, taker], nextUnitId: base.nextUnitId + 1 };
    const build = (s: GameState) => vw(stepOf(s, { kind: 'build', at: at(2, 0), unitType: 'trooper' }), 0);
    expect(build(withHidden)).toEqual(build(base));
  });
});

describe('fog off, a viewer who sees everything, and bad input', () => {
  const FOG_OFF = () => mk(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 1)], { fog: false });

  it('with fog off the events come back as they are: the same array', () => {
    const st = stepOf(toTurn(FOG_OFF(), 1), mv(2, [[9, 1], [8, 1]]));
    expect(vw(st, 0)).toBe(st.events);
    expect(vw(st, 1)).toBe(st.events);
  });

  it('a team whose \'reveal\' power has lifted the fog is shown everything', () => {
    const s = patchPlayer(toTurn(mk(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 1)]), 1), 0, { revealTurns: 2 });
    const st = stepOf(s, mv(2, [[9, 1], [8, 1]]));
    expect(vw(st, 0), 'player 0 sees every tile: nothing is trimmed or dropped').toEqual(st.events);
    expect(vw(st, 1), 'player 1 is not revealed, but the move is its own').toEqual(st.events);
    const st2 = stepOf(patchPlayer(toTurn(mk(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 1)]), 1), 1, { revealTurns: 2 }), mv(2, [[9, 1], [8, 1]]));
    expect(vw(st2, 0), 'with the fog up for player 0 the same move is hidden').toEqual([]);
  });

  it('refuses a viewer who is not in the game', () => {
    const st = stepOf(mk(TEN, [unit('trooper', 0, 0, 0), unit('trooper', 1, 9, 1)]), endTurn);
    for (const bad of [-1, 2, 0.5, NaN]) expect(() => vw(st, bad), String(bad)).toThrow(RangeError);
  });

  it('every kind of event the engine can emit was exercised above', () => {
    const all: Record<GameEvent['kind'], true> = {
      moved: true, ambushed: true, dropBlocked: true, attacked: true, destroyed: true, captureProgress: true, captured: true, loaded: true,
      unloaded: true, joined: true, supplied: true, built: true, powerActivated: true, powerEffect: true, turnEnded: true, turnStarted: true,
      repaired: true, crashed: true, weather: true, playerDefeated: true, victory: true,
    };
    expect([...COVERED].sort()).toEqual(Object.keys(all).sort());
  });
});

// ---------------------------------------------------------------- 2. properties over seeded fog self-play

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

/** Plays every shipped field with both policies and hands each step (frozen) to `onStep`. */
function playFields(fog: boolean, seeds: number[], maxCycles: number, onStep: (st: SimStep, label: string) => void): number {
  let games = 0;
  for (const field of FIELDS) {
    for (const policy of ['random', 'greedy'] as SimPolicy[]) {
      for (const seed of seeds) {
        games++;
        const label = `${field.map}/${policy}/seed ${seed}`;
        simulate({
          setup: setupFor(field, fog, seed), seed, maxCycles, policy,
          onStart: (s) => deepFreeze(s),
          onStep: (st) => {
            deepFreeze(st.after);
            deepFreeze(st.events);
            onStep(st, label);
          },
        });
      }
    }
  }
  return games;
}

type Filter = (before: GameState, after: GameState, events: GameEvent[], viewer: PlayerIndex) => GameEvent[];

// ---- the facts of one step, worked out here from the true states -----------------------------------------------------------------

interface Facts {
  before: GameState;
  after: GameState;
  events: GameEvent[];
  owner: Map<number, number>;
  posBefore: Map<number, Coord>;
  posAfter: Map<number, Coord>;
  /** Every tile a unit moved through in this step's events (a unit that moves and then dies is in neither state where it fought). */
  trail: Map<number, Coord[]>;
}

function factsOf(before: GameState, after: GameState, events: GameEvent[]): Facts {
  const owner = new Map<number, number>();
  const posBefore = new Map<number, Coord>();
  const posAfter = new Map<number, Coord>();
  const walk = (u: Unit, into: Map<number, Coord>): void => {
    owner.set(u.id, u.owner);
    into.set(u.id, at(u.x, u.y));
    u.cargo.forEach((c) => walk(c, into));
  };
  before.units.forEach((u) => walk(u, posBefore));
  after.units.forEach((u) => walk(u, posAfter));
  const trail = new Map<number, Coord[]>();
  for (const e of events) {
    if (e.kind === 'built') owner.set(e.unitId, e.owner);
    if (e.kind === 'moved') trail.set(e.unitId, [...(trail.get(e.unitId) ?? []), ...e.path]);
  }
  return { before, after, events, owner, posBefore, posAfter, trail };
}

/** What a viewer's team can see at either end of the step, from the engine's public visibility() grid. */
function sightOf(f: Facts, viewer: number): (c: Coord | undefined) => boolean {
  const b = visibility(f.before, viewer);
  const a = visibility(f.after, viewer);
  return (c) => !!c && c.y >= 0 && c.y < f.before.height && c.x >= 0 && c.x < f.before.width && (b[c.y][c.x] || a[c.y][c.x]);
}

const isFriend = (f: Facts, viewer: number) => (id: number): boolean =>
  f.owner.has(id) && f.before.players[f.owner.get(id)!].team === f.before.players[viewer].team;
const isFriendPlayer = (f: Facts, viewer: number) => (p: number): boolean => f.before.players[p].team === f.before.players[viewer].team;

const redact = (e: Ev<'attacked'>): Ev<'attacked'> => ({ ...e, attackerId: UNSEEN_UNIT, attackerHp: UNSEEN_UNIT });

/**
 * What the rules say must come through VERBATIM for this event (JSON), or null when the result depends on more than a yes/no
 * (trimmed, redacted, or a judgement call). Used for the COMPLETE check.
 */
function mustKeep(f: Facts, viewer: number, e: GameEvent): string | null {
  const friend = isFriend(f, viewer);
  const friendP = isFriendPlayer(f, viewer);
  const sees = sightOf(f, viewer);
  const here = (id: number): Coord | undefined => f.posAfter.get(id) ?? f.posBefore.get(id);
  switch (e.kind) {
    case 'moved': return friend(e.unitId) || e.path.every((c) => sees(c)) ? json(e) : null;
    case 'ambushed': {
      const by = f.posBefore.get(e.by);
      return by && (friend(e.unitId) || (friend(e.by) && sees(e.at))) ? json({ ...e, blockerAt: by }) : null;
    }
    case 'dropBlocked': return friend(e.transportId) ? json(e) : null;
    case 'attacked': {
      if (friend(e.attackerId)) return json(e);
      if (!friend(e.defenderId) || !f.posAfter.has(e.attackerId)) return null;
      return sees(here(e.attackerId)) ? json(e) : json(redact(e));
    }
    case 'destroyed': return friendP(e.owner) || sees(e.at) ? json(e) : null;
    case 'captureProgress': return friend(e.unitId) || sees(e.at) ? json(e) : null;
    case 'captured': return json(e);
    case 'loaded': return friend(e.transportId) || sees(here(e.transportId)) ? json(e) : null;
    case 'unloaded': return friend(e.transportId) ? json(e) : null;
    case 'joined': return friend(e.intoId) || sees(here(e.intoId)) ? json(e) : null;
    case 'supplied': return friend(e.byId) ? json(e) : null;
    case 'built': return friendP(e.owner) || sees(e.at) ? json(e) : null;
    case 'repaired': return friend(e.unitId) || sees(here(e.unitId)) ? json(e) : null;
    case 'crashed': return friend(e.unitId) || sees(e.at) ? json(e) : null;
    case 'powerEffect': return friendP(e.player) ? json(e) : null;
    case 'powerActivated': case 'turnStarted': case 'turnEnded': case 'weather': case 'playerDefeated': case 'victory': return json(e);
  }
}

/**
 * Everything wrong with `out` as what `viewer` is shown for this step: SOUND (nothing it should not know) and COMPLETE (what the rules say
 * is kept, is). The visible world is observe()'s, as the order says. Empty = fine.
 */
function problemsWith(f: Facts, viewer: number, out: GameEvent[]): string[] {
  const problems: string[] = [];
  const friend = isFriend(f, viewer);
  const friendP = isFriendPlayer(f, viewer);
  // Soundness is judged against observe(): which tiles it marks visible and which unit ids it lists, before or after the step.
  let obs: ReturnType<typeof observe>[] | null = null;
  const views = () => (obs ??= [observe(f.before, viewer), observe(f.after, viewer)]);
  const tileSeen = (c: Coord): boolean => views().some((o) => o.visible[c.y]?.[c.x] === true);
  const listed = new Set<number>();
  let listedBuilt = false;
  const known = (id: number): boolean => {
    if (!listedBuilt) {
      listedBuilt = true;
      const walk = (u: Unit): void => { listed.add(u.id); u.cargo.forEach(walk); };
      views().forEach((o) => o.units.forEach(walk));
    }
    return listed.has(id);
  };
  /** The viewer could have seen this unit: it is a friend, observe() lists it, or it stood on a tile in sight. */
  const unitOk = (id: number): boolean =>
    friend(id) || known(id) || [f.posBefore.get(id), f.posAfter.get(id), ...(f.trail.get(id) ?? [])].some((c) => !!c && tileSeen(c));
  const tileOk = (c: Coord): boolean => tileSeen(c);
  const bad = (e: GameEvent, why: string) => problems.push(`${e.kind}: ${why} -- ${json(e)}`);

  for (const e of out) {
    switch (e.kind) {
      case 'moved':
        if (!friend(e.unitId) && !e.path.every(tileOk)) bad(e, 'a path tile the viewer cannot see');
        if (!e.path.length) bad(e, 'an empty path');
        break;
      case 'ambushed': {
        const blocker = f.posBefore.get(e.by);
        if (!isAmbushView(e)) bad(e, 'no blockerAt');
        else if (!blocker || json(e.blockerAt) !== json(blocker)) bad(e, 'blockerAt is not where the blocker stood');
        if (!friend(e.unitId) && !tileOk(e.at)) bad(e, 'an enemy mover stopped where the viewer cannot see');
        if (!friend(e.unitId) && !friend(e.by) && !unitOk(e.by)) bad(e, 'a blocker between two others who is not seen');
        break;
      }
      case 'dropBlocked':
        if (!friend(e.transportId) && !unitOk(e.transportId)) bad(e, 'an enemy transport that is not seen');
        if (!friend(e.transportId) && !friend(e.by) && !tileOk(e.at)) bad(e, 'a blocker between two others who is not seen');
        break;
      case 'attacked':
        if (e.attackerId === UNSEEN_UNIT) {
          if (e.attackerHp !== UNSEEN_UNIT) bad(e, 'a redacted shooter with an HP');
          if (friend(e.attackerId)) bad(e, 'a friend redacted');
        } else if (!friend(e.attackerId) && !unitOk(e.attackerId)) bad(e, 'the shooter is named and the viewer cannot see it');
        if (e.attackerId !== UNSEEN_UNIT && e.attackerHp === UNSEEN_UNIT) bad(e, 'an HP redacted on a named shooter');
        if (!friend(e.attackerId) && !friend(e.defenderId) && !unitOk(e.defenderId)) bad(e, 'a fight between others, defender not seen');
        break;
      case 'destroyed':
        if (!friendP(e.owner) && !tileOk(e.at)) bad(e, 'a death the viewer cannot see');
        break;
      case 'captureProgress':
        if (!friend(e.unitId) && !tileOk(e.at)) bad(e, 'progress on a tile the viewer cannot see');
        break;
      case 'captured':
        if (!TERRAIN_TYPES[f.after.tiles[e.at.y][e.at.x].terrain].property && !TERRAIN_TYPES[f.before.tiles[e.at.y][e.at.x].terrain].property) bad(e, 'not a property');
        break;
      case 'loaded':
        if (!friend(e.transportId) && !unitOk(e.transportId)) bad(e, 'an enemy transport that is not seen');
        break;
      case 'unloaded':
        if (!friend(e.transportId)) {
          if (!tileOk(e.to)) bad(e, 'a landing the viewer cannot see');
          if (e.transportId !== UNSEEN_UNIT && !unitOk(e.transportId)) bad(e, 'a transport named that is not seen');
        }
        break;
      case 'joined':
        if (!friend(e.intoId) && !unitOk(e.intoId)) bad(e, 'a unit not seen');
        break;
      case 'supplied':
        if (!friend(e.byId) && !unitOk(e.byId)) bad(e, 'a supplier not seen');
        if (!friend(e.byId) && !e.unitIds.every(unitOk)) bad(e, 'a unit supplied that is not seen');
        if (!friend(e.byId) && !e.unitIds.length) bad(e, 'an empty supply report');
        break;
      case 'built':
        if (!friendP(e.owner) && !tileOk(e.at)) bad(e, 'a build the viewer cannot see');
        break;
      case 'repaired':
        if (!friend(e.unitId) && !unitOk(e.unitId)) bad(e, 'a unit not seen');
        break;
      case 'crashed':
        if (!friend(e.unitId) && !tileOk(e.at)) bad(e, 'a crash the viewer cannot see');
        break;
      case 'powerEffect':
        if (!friendP(e.player)) {
          if (!e.affected.every(tileOk)) bad(e, 'an affected tile the viewer cannot see');
          if (/\b\d+ units?\b/.test(e.description)) bad(e, 'a unit count');
        }
        break;
      case 'powerActivated': case 'turnStarted': case 'turnEnded': case 'weather': case 'playerDefeated': case 'victory':
        break;
    }
  }

  // COMPLETE: every event the rules say must pass verbatim is there, once for each time it was emitted.
  const have = new Map<string, number>();
  for (const e of out) have.set(json(e), (have.get(json(e)) ?? 0) + 1);
  for (const e of f.events) {
    const want = mustKeep(f, viewer, e);
    if (want === null) continue;
    const n = have.get(want) ?? 0;
    if (n === 0) problems.push(`${e.kind}: missing from what the viewer is shown -- ${want}`);
    else have.set(want, n - 1);
  }
  if (out.length > f.events.length) problems.push(`${out.length} events out of ${f.events.length} in`);
  return problems;
}

// ---- the known-bad filters --------------------------------------------------------------------------------------------------------

const BAD_FILTERS: Record<string, Filter> = {
  // keeps everything: the leak this order exists to close
  'keep everything': (_b, _a, events) => events,
  // drops everything: sound and useless
  'drop everything': () => [],
  // filters, but hands back the raw combat events: a hidden shooter is named
  'never redact a shooter': (b, a, events, v) => {
    const out = viewEvents(b, a, events, v);
    const raw = events.filter((e) => e.kind === 'attacked');
    let i = 0;
    return out.map((e) => (e.kind === 'attacked' ? raw[i++] ?? e : e));
  },
  // keeps an enemy move whole once any tile of it is in sight: the hidden stretch of the road leaks
  'never trim a path': (b, a, events, v) => {
    const out = viewEvents(b, a, events, v);
    const rawMoves = events.filter((e): e is Ev<'moved'> => e.kind === 'moved');
    return out.map((e) => (e.kind === 'moved' ? rawMoves.find((m) => m.unitId === e.unitId) ?? e : e));
  },
  // keeps every enemy build, wherever it is: the hidden factory leaks
  'keep every build': (b, a, events, v) => {
    const out = viewEvents(b, a, events, v);
    const built = events.filter((e) => e.kind === 'built');
    return events.filter((e) => e.kind === 'built' ? built.includes(e) : out.some((o) => json(o) === json(e)));
  },
};

// ---- planting hidden units ------------------------------------------------------------------------------------------------------------

const PLANTABLE: UnitTypeId[] = ['trooper', 'wasp', 'picket'];
const HIDDEN_ID = 1_000_000;

/** The state with one more unit. The id is high and `nextUnitId` is left alone, so units built afterwards keep the ids they would have had. */
function plant(s: GameState, type: UnitTypeId, owner: number, c: Coord, k = 0): GameState {
  const t = UNIT_TYPES[type];
  const u: Unit = { id: HIDDEN_ID + k, type, owner, x: c.x, y: c.y, hp: 100, charge: t.charge, ammo: t.ammo ?? 0, acted: false, cargo: [] };
  return { ...s, units: [...s.units, u] };
}

/** Free tiles the viewer cannot see, those nearest to the viewer's team first (then reading order). */
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
  found.sort((p, q) => p.d - q.d || p.c.y - q.c.y || p.c.x - q.c.x);
  return found.map((x) => x.c);
}

/** A planted unit the viewer's team cannot see, of the first type that fits the terrain; null if none fits or it would be seen after all. */
function plantHidden(s: GameState, viewer: number, owner: number, c: Coord, k = 0, types: UnitTypeId[] = PLANTABLE): GameState | null {
  const terrain = s.tiles[c.y][c.x].terrain;
  const type = types.find((t) => canStandOn(terrain, UNIT_TYPES[t].moveType));
  if (!type) return null;
  const p = plant(s, type, owner, c, k);
  return canSeeUnit(p, viewer, p.units[p.units.length - 1]) ? null : p;
}

/**
 * The simple kinds, answered straight from the rules and the visibility grid: a friend's event whole, an enemy move cut to the tiles in
 * sight, a capture report and a build on a visible tile, a change of owner always. null when the step holds any other kind.
 */
function simpleAnswer(f: Facts, viewer: number): GameEvent[] | null {
  const friend = isFriend(f, viewer);
  const friendP = isFriendPlayer(f, viewer);
  const sees = sightOf(f, viewer);
  const out: GameEvent[] = [];
  for (const e of f.events) {
    if (e.kind === 'moved') {
      if (friend(e.unitId)) out.push(e);
      else {
        const path = e.path.filter((c) => sees(c));
        if (path.length) out.push({ kind: 'moved', unitId: e.unitId, path });
      }
    } else if (e.kind === 'captureProgress') {
      if (friend(e.unitId) || sees(e.at)) out.push(e);
    } else if (e.kind === 'captured') out.push(e);
    else if (e.kind === 'built') {
      if (friendP(e.owner) || sees(e.at)) out.push(e);
    } else return null;
  }
  return out;
}

interface Tally {
  games: number; steps: number; viewerChecks: number; rawEvents: number; kept: number; modified: number; dropped: number;
  redactedShots: number; ambushViews: number; trimmedMoves: number; trimmedSupplies: number; trimmedEffects: number;
  simpleChecks: number; simpleHidden: number; teamPairs: number;
  plantings: number; plantedUnits: number; bystanderCompared: number; bystanderSkipped: number;
  plantedActs: number; plantedActsHidden: number; plantedActsPartial: number; plantedSkipped: number;
  plantedShots: number; builds: number; buildsHidden: number; realFoeSteps: number;
  badChecks: number; badCaught: Record<string, number>;
}
const newTally = (): Tally => ({
  games: 0, steps: 0, viewerChecks: 0, rawEvents: 0, kept: 0, modified: 0, dropped: 0, redactedShots: 0, ambushViews: 0, trimmedMoves: 0,
  trimmedSupplies: 0, trimmedEffects: 0, simpleChecks: 0, simpleHidden: 0, teamPairs: 0, plantings: 0, plantedUnits: 0, bystanderCompared: 0,
  bystanderSkipped: 0, plantedActs: 0, plantedActsHidden: 0, plantedActsPartial: 0, plantedSkipped: 0, plantedShots: 0, builds: 0, buildsHidden: 0,
  realFoeSteps: 0, badChecks: 0, badCaught: Object.fromEntries(Object.keys(BAD_FILTERS).map((k) => [k, 0])),
});

/** One viewer's view of one step, checked against everything: the rules' answers, the soundness and completeness checkers, the bad filters. */
function audit(f: Facts, viewer: number, tally: Tally, label: string, problems: string[]): GameEvent[] {
  const out = viewEvents(f.before, f.after, f.events, viewer);
  tally.viewerChecks++;
  for (const p of problemsWith(f, viewer, out)) problems.push(`${label} (viewer ${viewer}): ${p}`);
  // Each event maps to one event or none: tally what happened to them.
  const rawJson = new Map<string, number>();
  for (const e of f.events) rawJson.set(json(e), (rawJson.get(json(e)) ?? 0) + 1);
  for (const o of out) {
    const n = rawJson.get(json(o)) ?? 0;
    if (n > 0) { tally.kept++; rawJson.set(json(o), n - 1); } else tally.modified++;
    if (o.kind === 'attacked' && o.attackerId === UNSEEN_UNIT) tally.redactedShots++;
    if (isAmbushView(o)) tally.ambushViews++;
  }
  tally.rawEvents += f.events.length;
  tally.dropped += f.events.length - out.length;
  const rawMoves = f.events.filter((e): e is Ev<'moved'> => e.kind === 'moved');
  for (const o of out) if (o.kind === 'moved' && rawMoves.some((m) => m.unitId === o.unitId && m.path.length > o.path.length)) tally.trimmedMoves++;
  for (const o of out) if (o.kind === 'supplied' && f.events.some((e) => e.kind === 'supplied' && e.byId === o.byId && e.unitIds.length > o.unitIds.length)) tally.trimmedSupplies++;
  for (const o of out) if (o.kind === 'powerEffect' && f.events.some((e) => e.kind === 'powerEffect' && e.player === o.player && e.affected.length > o.affected.length)) tally.trimmedEffects++;
  // The rules' own answer for the simple kinds.
  const simple = simpleAnswer(f, viewer);
  if (simple) {
    tally.simpleChecks++;
    if (!simple.length && f.events.length) tally.simpleHidden++;
    if (json(simple) !== json(out)) problems.push(`${label} (viewer ${viewer}): expected ${json(simple)}, got ${json(out)}`);
  }
  // The known-bad filters must each be refused by the same checkers somewhere in the sample.
  if (tally.viewerChecks % 4 === 0) {
    tally.badChecks++;
    for (const [name, bad] of Object.entries(BAD_FILTERS)) {
      if (problemsWith(f, viewer, bad(f.before, f.after, f.events, viewer)).length) tally.badCaught[name]++;
    }
  }
  return out;
}

const report = (t: Tally) =>
  `${t.games} games, ${t.steps} steps, ${t.viewerChecks} viewer checks; events ${t.rawEvents} in -> ${t.kept} kept as they were, ${t.modified} changed ` +
  `(${t.trimmedMoves} paths trimmed, ${t.trimmedSupplies} supply lists trimmed, ${t.trimmedEffects} power effects trimmed, ${t.redactedShots} shooters redacted, ${t.ambushViews} ambushes revealed), ` +
  `${t.dropped} dropped; rules' own answer checked on ${t.simpleChecks} steps (${t.simpleHidden} entirely hidden)`;

describe('SOUND, COMPLETE and INDISTINGUISHABLE over seeded fog self-play', () => {
  it('holds for every player on every step of every game, with the planted hidden units standing, moving, building, capturing and firing', () => {
    const tally = newTally();
    const problems: string[] = [];
    const rand = lcg(2026);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];

    tally.games = playFields(true, [1, 2], 8, (st, label) => {
      const f = factsOf(st.before, st.after, st.events);
      tally.steps++;
      const here = `${label}, step ${st.index} ${st.action.kind}`;
      const players = st.before.players;

      // 1. every viewer: the checkers, the rules' answers, the bad filters; teammates are shown the same thing.
      const outs = new Map<number, string>();
      for (const p of players) outs.set(p.index, json(audit(f, p.index, tally, here, problems)));
      for (const p of players) {
        for (const q of players) {
          if (q.index <= p.index || q.team !== p.team) continue;
          tally.teamPairs++;
          if (outs.get(p.index) !== outs.get(q.index)) problems.push(`${here}: allies ${p.index} and ${q.index} are shown different things`);
        }
      }

      // 2. a hidden enemy planted where the viewer cannot see it changes nothing it is shown, when the step does not reach it.
      if (st.index % 3 === 0) {
        for (const p of players) {
          const owner = players.find((q) => q.team !== p.team && !q.defeated)?.index;
          const free = unseenFreeTiles(st.before, p.index);
          if (owner === undefined || !free.length) continue;
          const planted = plantHidden(st.before, p.index, owner, pick(free.slice(0, 12)));
          if (!planted) continue;
          tally.plantings++;
          tally.plantedUnits++;
          let applied: ReturnType<typeof applyAction>;
          try {
            applied = applyAction(planted, st.action);
          } catch (err) {
            if (!(err instanceof IllegalActionError)) throw err;
            tally.bystanderSkipped++;
            continue;
          }
          if (json(applied.events) !== json(st.events)) { tally.bystanderSkipped++; continue; } // it reached the unit: a legitimate reveal
          tally.bystanderCompared++;
          const without = json(viewEvents(st.before, st.after, st.events, p.index));
          const withIt = json(viewEvents(planted, applied.state, applied.events, p.index));
          if (without !== withIt) problems.push(`${here}: viewer ${p.index} is shown something different when a hidden unit stands at (${planted.units[planted.units.length - 1].x},${planted.units[planted.units.length - 1].y})`);
        }
      }

      // 3. the foe to move, with hidden units that act: a move, a capture, a build, a shot.
      const mover = st.after.current;
      if (st.index % 6 === 1 && st.after.winnerTeam === null) {
        for (const p of players) {
          if (p.team === players[mover].team || p.defeated) continue;
          const s = st.after;
          const free = unseenFreeTiles(s, p.index);
          const tiles = free.length ? [free[0], pick(free)] : [];
          let k = 0;
          for (const c of tiles) {
            const planted = plantHidden(s, p.index, mover, c, k++);
            if (!planted) continue;
            tally.plantings++;
            tally.plantedUnits++;
            const u = planted.units[planted.units.length - 1];
            const entries = [...reachable(planted, u.id).values()];
            const chosen = entries.filter((_, i) => i % Math.max(1, Math.floor(entries.length / 3)) === 0).slice(0, 3);
            for (const entry of chosen) {
              for (const a of destinationActions(planted, u, entry)) {
                if (a.kind !== 'move' || (a.then.kind !== 'wait' && a.then.kind !== 'capture')) continue;
                const r = applyAction(planted, a);
                deepFreeze(r.state);
                deepFreeze(r.events);
                const pf = factsOf(planted, r.state, r.events);
                tally.plantedActs++;
                if (simpleAnswer(pf, p.index) === null) { tally.plantedSkipped++; continue; }
                const out = audit(pf, p.index, tally, `${here}, planted ${u.type} -> ${a.then.kind}`, problems);
                if (!out.length) tally.plantedActsHidden++;
                else if (out.some((e) => e.kind === 'moved' && r.events.some((m) => m.kind === 'moved' && m.path.length > e.path.length))) tally.plantedActsPartial++;
              }
            }
          }
          // Builds by the foe: the viewer is told of those on tiles in sight, and of nothing else.
          const builds = buildActions(s);
          for (const b of builds.filter((_, i) => i % Math.max(1, Math.floor(builds.length / 4)) === 0).slice(0, 4)) {
            const r = applyAction(s, b);
            deepFreeze(r.state);
            deepFreeze(r.events);
            tally.builds++;
            const out = audit(factsOf(s, r.state, r.events), p.index, tally, `${here}, foe builds`, problems);
            if (!out.length) tally.buildsHidden++;
          }
          tally.realFoeSteps++;
        }
      }

      // 4. a hidden artillery piece fires on a unit of the viewer's that the foe can see: the strike is shown, the shooter is not.
      if (st.index % 5 === 2 && st.after.winnerTeam === null) {
        const s = st.after;
        const foe = s.current;
        for (const p of players) {
          if (p.team === players[foe].team || p.defeated) continue;
          const seenByFoe = visibility(s, foe);
          const free = unseenFreeTiles(s, p.index).filter((c) => s.tiles[c.y][c.x].terrain !== 'canopy');
          let done = false;
          for (const target of s.units.filter((u) => players[u.owner].team === p.team && seenByFoe[u.y][u.x])) {
            for (const c of free) {
              const d = Math.abs(c.x - target.x) + Math.abs(c.y - target.y);
              if (d < 2 || d > 3) continue;
              const planted = plantHidden(s, p.index, foe, c, 7, ['arc']);
              if (!planted) continue;
              const shot = mv(HIDDEN_ID + 7, [[c.x, c.y]], { kind: 'attack', target: at(target.x, target.y) });
              if (!isLegal(planted, shot)) continue;
              const r = applyAction(planted, shot);
              deepFreeze(r.state);
              deepFreeze(r.events);
              tally.plantedUnits++;
              tally.plantedShots++;
              const raw = r.events.find((e): e is Ev<'attacked'> => e.kind === 'attacked')!;
              const out = audit(factsOf(planted, r.state, r.events), p.index, tally, `${here}, hidden arc fires`, problems);
              const shown = out.find((e): e is Ev<'attacked'> => e.kind === 'attacked');
              if (json(shown) !== json(redact(raw))) problems.push(`${here}: the hidden arc's shot is shown as ${json(shown)}, not ${json(redact(raw))}`);
              if (out.some((e) => e.kind === 'moved' && e.unitId === HIDDEN_ID + 7)) problems.push(`${here}: the hidden arc's move is shown`);
              done = true;
              break;
            }
            if (done) break;
          }
        }
      }
    });

    console.log(`view-events: ${report(tally)}`);
    console.log(`view-events: planted ${tally.plantedUnits} hidden units in ${tally.plantings} plantings: ${tally.bystanderCompared} bystander steps compared (${tally.bystanderSkipped} reached the unit, skipped), ` +
      `${tally.plantedActs} moves/captures by planted units (${tally.plantedActsHidden} left no trace, ${tally.plantedActsPartial} showed only their seen part, ${tally.plantedSkipped} not in the simple kinds), ` +
      `${tally.plantedShots} shots by hidden artillery, ${tally.builds} foe builds (${tally.buildsHidden} hidden), ${tally.teamPairs} ally pairs compared`);
    console.log(`view-events: known-bad filters refused, of ${tally.badChecks} viewer checks they were run on: ${json(tally.badCaught)}`);

    expect(problems.slice(0, 12), `${problems.length} problems`).toEqual([]);
    // Not vacuous: each kind of thing the filter does happened, and the planted units took part.
    expect(tally.steps).toBeGreaterThanOrEqual(1500);
    expect(tally.kept).toBeGreaterThanOrEqual(3000);
    expect(tally.dropped).toBeGreaterThanOrEqual(1000);
    expect(tally.trimmedMoves).toBeGreaterThanOrEqual(20);
    expect(tally.simpleHidden).toBeGreaterThanOrEqual(200);
    expect(tally.teamPairs).toBeGreaterThanOrEqual(50);
    expect(tally.plantedUnits).toBeGreaterThanOrEqual(300);
    expect(tally.bystanderCompared).toBeGreaterThanOrEqual(200);
    expect(tally.plantedActsHidden, 'hidden units moved and nothing was shown').toBeGreaterThanOrEqual(100);
    expect(tally.plantedActsPartial, 'hidden units walked partly into sight and exactly that part was shown').toBeGreaterThanOrEqual(10);
    expect(tally.buildsHidden, 'builds out of sight were not shown').toBeGreaterThanOrEqual(50);
    expect(tally.plantedShots, 'hidden artillery fired').toBeGreaterThanOrEqual(10);
    expect(tally.redactedShots).toBeGreaterThanOrEqual(10);
    // The checkers have teeth: every known-bad filter was refused somewhere.
    for (const [name, n] of Object.entries(tally.badCaught)) expect(n, `the checkers must refuse "${name}"`).toBeGreaterThanOrEqual(10);
  }, 600_000);
});

describe('FOG OFF: the input comes back unchanged, on every step of games played without fog', () => {
  it('returns the very same array for every viewer, and never touches it', () => {
    let steps = 0;
    let viewerChecks = 0;
    let events = 0;
    playFields(false, [1, 2], 6, (st) => {
      steps++;
      for (const p of st.before.players) {
        const out = viewEvents(st.before, st.after, st.events, p.index);
        viewerChecks++;
        events += st.events.length;
        expect(out).toBe(st.events);
      }
    });
    console.log(`view-events: fog off: ${steps} steps, ${viewerChecks} viewer checks, ${events} events returned unchanged`);
    expect(steps).toBeGreaterThanOrEqual(800);
    expect(events).toBeGreaterThanOrEqual(2000);
  }, 300_000);
});

describe('the filter is a function of (before, after, events) alone: it gives the same answer from replayed states', () => {
  it('replay(setup, actions) rebuilds the states and the filtered stream is the same', () => {
    const field = FIELDS[0];
    const setup = setupFor(field, true, 4);
    const seen: { index: number; before: GameState; events: GameEvent[]; outs: string[] }[] = [];
    const result = simulate({
      setup, seed: 4, maxCycles: 5, policy: 'greedy',
      onStep: (st) => {
        if (st.index % 9 === 4) seen.push({ index: st.index, before: st.before, events: st.events, outs: st.before.players.map((p) => json(viewEvents(st.before, st.after, st.events, p.index))) });
      },
    });
    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (const s of seen) {
      const a = replay(setup, result.actions.slice(0, s.index), { hashes: false }).state;
      const b = replay(setup, result.actions.slice(0, s.index + 1), { hashes: false });
      expect(stateHash(a), `step ${s.index}: the replayed state before it`).toBe(stateHash(s.before));
      const last = replay(setup, result.actions.slice(0, s.index + 1)).events.slice(replay(setup, result.actions.slice(0, s.index)).events.length);
      expect(json(last)).toBe(json(s.events));
      expect(s.before.players.map((p) => json(viewEvents(a, b.state, last, p.index)))).toEqual(s.outs);
    }
  }, 120_000);
});
