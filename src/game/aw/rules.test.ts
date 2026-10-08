// M1.6a rules integration: D-015 (charge per tile, ion storm, the 50-unit cap, nested transports, turn-start rout),
// D-013 (the campaign deadline) and fog/canopy consistency. Spec: docs/delivery/DECISIONS.md and docs/research/mechanics.md.
// Every expected number is computed here from the unit data and the rule text, never copied from what the engine printed.
// Each rule is driven through createGame / applyAction / isLegal / reachable / thenOptions / buildOptions.
import { describe, expect, it } from 'vitest';
import { TERRAIN_TYPES, UNIT_LIST, UNIT_TYPES } from '../../data';
import { destroyUnit } from './combat';
import { canSeeUnit as canSeeUnitFromFog } from './fog';
import {
  DEFAULT_PAR, IllegalActionError, MAX_UNITS_PER_PLAYER, applyAction, attackTargets, buildOptions, canSeeUnit, createGame,
  effectiveMove, effectiveVision, forecast, isLegal, reachable, thenOptions, visibility,
} from './index';
import type { PlayerSetup } from './index';
import { canLoadInto } from './movement';
import { DEFAULT_PAR as DEFAULT_PAR_FROM_SCORE } from './score';
import { draft, unitCount } from './state';
import { fixtureGame, fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import type { Action, Coord, GameEvent, GameState, Then, Unit, UnitTypeId } from './types';

// ---------------------------------------------------------------- helpers

const END: Action = { kind: 'endTurn' };
const WAIT: Then = { kind: 'wait' };
const unit = (type: UnitTypeId, owner: number, x: number, y: number): FixtureUnit => ({ type, owner, x, y });
const at = (x: number, y: number): Coord => ({ x, y });
const kinds = (events: GameEvent[]) => events.map((e) => e.kind);
const count = (events: GameEvent[], kind: GameEvent['kind']) => events.filter((e) => e.kind === kind).length;
const flatRow = (w: number) => '.'.repeat(w);

const move = (unitId: number, path: [number, number][], then: Then = WAIT): Action => ({
  kind: 'move', unitId, path: path.map(([x, y]) => ({ x, y })), then,
});
const build = (x: number, y: number, unitType: UnitTypeId): Action => ({ kind: 'build', at: at(x, y), unitType });

/** The first unit of this owner (and type) in the state, as the engine holds it. */
function find(s: GameState, owner: number, type?: UnitTypeId): Unit {
  const u = s.units.find((v) => v.owner === owner && (type === undefined || v.type === type));
  if (!u) throw new Error(`no ${type ?? 'unit'} for player ${owner}`);
  return u;
}
/** Test-owned edit of one unit (the engine never mutates, so a spread copy is a fresh position). */
const patchUnit = (s: GameState, id: number, patch: Partial<Unit>): GameState => ({
  ...s, units: s.units.map((u) => (u.id === id ? { ...u, ...patch } : u)),
});

/** Plays the actions in order, returning the last state and every event emitted along the way. */
function play(start: GameState, ...actions: Action[]): { state: GameState; events: GameEvent[] } {
  let state = start;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = applyAction(state, a);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}
const ends = (n: number): Action[] => Array.from({ length: n }, () => END);

const team = (n: number, faction: PlayerSetup['faction'] = 'helion'): PlayerSetup => ({ faction, commander: 'none', controller: 'ai', team: n });
const THREE_TEAMS: PlayerSetup[] = [team(0), team(1, 'tidewell'), team(2, 'verdant')];
function threeTeams(terrain: string[], units: FixtureUnit[], extra: Partial<Parameters<typeof createGame>[0]> = {}): GameState {
  return createGame({ map: fixtureMap(terrain, units), players: THREE_TEAMS, seed: 1, ...extra });
}

// ---------------------------------------------------------------- D-015.1: charge is spent per tile moved

describe('D-015.1 charge is spent per tile moved, not per cost point', () => {
  // A warden (treads, move 6, charge 60) crossing three canopy tiles: each costs 2 move points, so 6 points but 3 tiles.
  const unitData = UNIT_TYPES.warden;
  const canopyCost = TERRAIN_TYPES.canopy.cost.tread!;
  const s0 = fixtureGame(['.fff....'], [unit('warden', 0, 0, 0), unit('trooper', 1, 7, 0)]);
  const warden = find(s0, 0);
  const CROSS: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0]];

  it('premise: canopy costs treads more than one point, so tiles and points differ', () => {
    expect(canopyCost).toBeGreaterThan(1);
    expect(unitData.moveType).toBe('tread');
    expect(unitData.charge).toBeGreaterThanOrEqual(10);
  });

  it('spends 3 charge for 3 canopy tiles (not 6), the same as 3 flat tiles', () => {
    const over = play(s0, move(warden.id, CROSS)).state;
    expect(find(over, 0).x).toBe(3);
    expect(find(over, 0).charge).toBe(unitData.charge - 3);
    expect(find(over, 0).charge).not.toBe(unitData.charge - 3 * canopyCost); // the per-cost-point answer is wrong
    const flat = fixtureGame(['........'], [unit('warden', 0, 0, 0), unit('trooper', 1, 7, 0)]);
    expect(find(play(flat, move(find(flat, 0).id, CROSS)).state, 0).charge).toBe(unitData.charge - 3);
  });

  it('lets a unit with 3 charge cross 3 canopy tiles (6 move points) and refuses a fourth tile', () => {
    const low = patchUnit(s0, warden.id, { charge: 3 });
    const reach = reachable(low, warden.id);
    expect(reach.get('3,0')?.cost).toBe(3 * canopyCost);
    expect(reach.get('3,0')?.path).toHaveLength(4); // 3 tiles moved
    expect(find(play(low, move(warden.id, CROSS)).state, 0).charge).toBe(0);
    // Known-bad: 2 charge cannot reach the third tile, whatever the terrain costs.
    const lower = patchUnit(s0, warden.id, { charge: 2 });
    expect(reachable(lower, warden.id).has('3,0')).toBe(false);
    expect(reachable(lower, warden.id).has('2,0')).toBe(true);
    expect(isLegal(lower, move(warden.id, CROSS))).toBe(false);
    expect(() => applyAction(lower, move(warden.id, CROSS))).toThrow(IllegalActionError);
  });
});

// ---------------------------------------------------------------- D-015.2: ion storm

describe('D-015.2 ion storm', () => {
  const furthest = (keys: Iterable<string>) => Math.max(...[...keys].map((k) => Number(k.split(',')[0])));
  const lane = (weather?: 'ionstorm', type: UnitTypeId = 'wasp') =>
    fixtureGame([flatRow(14)], [unit(type, 0, 0, 0), unit('trooper', 1, 13, 0)], weather ? { weather } : {});

  it('takes 1 tile off every air unit\'s move and leaves ground units alone, as reachable() shows', () => {
    for (const type of ['wasp', 'raptor', 'anvil'] as const) {
      const move0 = UNIT_TYPES[type].move;
      const clear = lane(undefined, type);
      const storm = lane('ionstorm', type);
      expect(furthest(reachable(clear, find(clear, 0).id).keys()), `${type} clear`).toBe(move0);
      expect(furthest(reachable(storm, find(storm, 0).id).keys()), `${type} storm`).toBe(move0 - 1);
      expect(effectiveMove(storm, find(storm, 0))).toBe(move0 - 1);
    }
    const trooperStorm = lane('ionstorm', 'trooper');
    expect(furthest(reachable(trooperStorm, find(trooperStorm, 0).id).keys())).toBe(UNIT_TYPES.trooper.move);
  });

  it('never takes an air unit\'s move below 1', () => {
    const storm = lane('ionstorm');
    const wasp = find(storm, 0);
    // 6 - 5 (debuff) - 1 (storm) = 0 -> floor 1, so the wasp still moves one tile and no further.
    const slowed: GameState = { ...storm, players: storm.players.map((p, i) => (i === 0 ? { ...p, moveEffects: [{ delta: -5, turnsLeft: 2 }] } : p)) };
    expect(effectiveMove(slowed, wasp)).toBe(1);
    expect([...reachable(slowed, wasp.id).keys()].sort()).toEqual(['0,0', '1,0']);
  });

  it('takes 1 tile off every unit\'s vision (floor 1), and fog.ts agrees with effectiveVision for all 16 types', () => {
    for (const t of UNIT_LIST) {
      const ground = t.domain === 'sea' ? '~' : '.';
      for (const weather of ['clear', 'ionstorm'] as const) {
        // Fog is on in both cases, so the clear one measures the radius that the storm one shrinks.
        const s = fixtureGame([ground.repeat(16)], [{ type: t.id, owner: 0, x: 0, y: 0 }], { fog: true, weather });
        let far = -1;
        visibility(s, 0)[0].forEach((v, x) => { if (v) far = x; });
        const expected = Math.max(1, t.vision - (weather === 'ionstorm' ? 1 : 0));
        expect(far, `${t.id} ${weather}`).toBe(expected);
        expect(effectiveVision(s, find(s, 0)), `${t.id} ${weather} effectiveVision`).toBe(expected);
      }
    }
  });

  it('stacks the ridge bonus (+3 for foot/exo only) with the storm', () => {
    const radius = (type: UnitTypeId, weather: 'clear' | 'ionstorm') => {
      const s = fixtureGame(['^' + flatRow(15)], [unit(type, 0, 0, 0)], { fog: true, weather });
      let far = -1;
      visibility(s, 0)[0].forEach((v, x) => { if (v) far = x; });
      return far;
    };
    expect(radius('trooper', 'clear')).toBe(UNIT_TYPES.trooper.vision + 3);
    expect(radius('trooper', 'ionstorm')).toBe(UNIT_TYPES.trooper.vision + 3 - 1);
    expect(radius('breacher', 'ionstorm')).toBe(UNIT_TYPES.breacher.vision + 3 - 1); // exo
    expect(radius('colossus', 'ionstorm')).toBe(Math.max(1, UNIT_TYPES.colossus.vision - 1)); // walkers get no ridge bonus
  });
});

// ---------------------------------------------------------------- D-015.3: 50 units per player, cargo included

describe('D-015.3 the 50-unit cap', () => {
  const W = 10;
  const H = 12;
  const cell = (i: number): [number, number] => [i % W, Math.floor(i / W)]; // row-major, fills rows 0..4 for 50 units
  /**
   * Player 0 owns fabricators at (8,11) and (9,11), player 1 at (0,11) and (1,11). Player 0's units fill the map from the
   * top; player 1's from row 6. `mule` swaps player 0's LAST unit for a Mule (at the end of the row-major fill).
   */
  function crowd(n0: number, n1: number, opts: { mule?: boolean } = {}): GameState {
    const terrain = Array.from({ length: H }, (_, y) => (y === 11 ? 'FF' + '.'.repeat(6) + 'FF' : flatRow(W)));
    const owners = Array.from({ length: H }, (_, y) => (y === 11 ? '11' + '.'.repeat(6) + '00' : '.'.repeat(W)));
    const units: FixtureUnit[] = [];
    for (let i = 0; i < n0; i++) {
      const [x, y] = cell(i);
      units.push(unit(opts.mule && i === n0 - 1 ? 'mule' : 'trooper', 0, x, y));
    }
    for (let i = 0; i < n1; i++) {
      const [x, y] = cell(i);
      units.push(unit('trooper', 1, x, y + 6));
    }
    return fixtureGame(terrain, units, { owners, startFunds: 1_000_000 });
  }
  const onMap = (s: GameState, owner: number) => s.units.filter((u) => u.owner === owner).length;

  it('has a cap of 50', () => {
    expect(MAX_UNITS_PER_PLAYER).toBe(50);
  });

  it('allows a build at 49 and refuses the next one at 50', () => {
    const s49 = crowd(49, 1);
    expect(unitCount(s49, 0)).toBe(49);
    expect(isLegal(s49, build(8, 11, 'trooper'))).toBe(true);
    const s50 = applyAction(s49, build(8, 11, 'trooper')).state;
    expect(unitCount(s50, 0)).toBe(50);
    // Known-bad: the very same player, with money and a free site, is now refused.
    expect(isLegal(s50, build(9, 11, 'trooper'))).toBe(false);
    expect(() => applyAction(s50, build(9, 11, 'trooper'))).toThrow(IllegalActionError);
    expect(() => applyAction(s50, build(9, 11, 'trooper'))).toThrow(/cap/);
    expect(unitCount(s50, 0)).toBe(50); // the refused build changed nothing
  });

  it('refuses at 50 from the start, whatever the unit type', () => {
    const s = crowd(50, 1);
    expect(unitCount(s, 0)).toBe(50);
    expect(isLegal(s, build(8, 11, 'trooper'))).toBe(false);
    expect(isLegal(s, build(8, 11, 'mule'))).toBe(false);
  });

  it('counts cargo: a loaded trooper takes the 50th place even though only 49 units are on the map', () => {
    const start = crowd(50, 1, { mule: true }); // 49 troopers + 1 mule
    expect(onMap(start, 0)).toBe(50);
    const mule = find(start, 0, 'mule');
    const rider = start.units.find((u) => u.owner === 0 && u.type === 'trooper' && Math.abs(u.x - mule.x) + Math.abs(u.y - mule.y) === 1)!;
    const loaded = play(start, move(rider.id, [[rider.x, rider.y], [mule.x, mule.y]], { kind: 'load' })).state;
    expect(onMap(loaded, 0)).toBe(49); // one fewer on the map ...
    expect(find(loaded, 0, 'mule').cargo).toHaveLength(1);
    expect(unitCount(loaded, 0)).toBe(50); // ... and still 50 in the army
    expect(isLegal(loaded, build(8, 11, 'trooper'))).toBe(false);
    // Control: 49 units in all (one fewer trooper), the same mule, nothing loaded: the build is allowed.
    const control = crowd(49, 1, { mule: true });
    expect(unitCount(control, 0)).toBe(49);
    expect(isLegal(control, build(8, 11, 'trooper'))).toBe(true);
  });

  it('keeps the cap per player: the other side at 50 does not block a small army, and it blocks itself', () => {
    const s = crowd(3, 50);
    expect(isLegal(s, build(8, 11, 'trooper'))).toBe(true);
    const theirTurn = play(s, END).state;
    expect(theirTurn.current).toBe(1);
    expect(isLegal(theirTurn, build(0, 11, 'trooper'))).toBe(false);
  });

  it('keeps listing every type at the cap, each unavailable with the reason "cap"', () => {
    const s = crowd(50, 1);
    const options = buildOptions(s, at(8, 11));
    expect(options.map((o) => o.type)).toEqual(UNIT_LIST.filter((u) => u.domain === 'ground').map((u) => u.id));
    expect(options.every((o) => !o.affordable && o.reason === 'cap')).toBe(true);
    // The price is still shown, and funds are plentiful: the cap alone is what greys them out.
    expect(options.map((o) => o.cost)).toEqual(UNIT_LIST.filter((u) => u.domain === 'ground').map((u) => u.cost));
    expect(options.every((o) => o.cost <= s.players[0].funds)).toBe(true);
  });

  it('marks options available (no reason) below the cap and "funds" when only money is short', () => {
    const s = crowd(49, 1);
    expect(buildOptions(s, at(8, 11)).every((o) => o.affordable && o.reason === undefined)).toBe(true);
    const poor: GameState = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, funds: 5000 } : p)) };
    const poorOptions = buildOptions(poor, at(8, 11));
    for (const o of poorOptions) {
      expect(o.affordable, o.type).toBe(o.cost <= 5000);
      expect(o.reason, o.type).toBe(o.cost <= 5000 ? undefined : 'funds');
    }
    expect(poorOptions.some((o) => o.reason === 'funds')).toBe(true);
    // At the cap AND broke, the cap is the reason given (it is the one money cannot fix).
    const capped = crowd(50, 1);
    const cappedBroke: GameState = { ...capped, players: capped.players.map((p, i) => (i === 0 ? { ...p, funds: 0 } : p)) };
    expect(buildOptions(cappedBroke, at(8, 11)).every((o) => !o.affordable && o.reason === 'cap')).toBe(true);
  });
});

// ---------------------------------------------------------------- D-015.4: a loaded transport cannot board another

describe('D-015.4 a transport carrying cargo cannot board another transport', () => {
  // `..s.....` : trooper (0,0) boards the Mule (1,0); the Barge waits on the shoal at (2,0). The same with a dock at (2,0).
  const row = (tile: string) => `..${tile}.....`;
  const setup = (tile: string, withRider: boolean) =>
    fixtureGame([row(tile)], [
      ...(withRider ? [unit('trooper', 0, 0, 0)] : []),
      unit('mule', 0, 1, 0), unit('barge', 0, 2, 0), unit('trooper', 1, 7, 0),
    ]);

  for (const [name, tile] of [['a shoal', 's'], ['a dock', 'D']] as const) {
    it(`refuses a loaded Mule next to a Barge on ${name}, and allows the same Mule empty`, () => {
      const start = setup(tile, true);
      const rider = find(start, 0, 'trooper');
      const loaded = play(start, move(rider.id, [[0, 0], [1, 0]], { kind: 'load' })).state;
      const mule = find(loaded, 0, 'mule');
      const barge = find(loaded, 0, 'barge');
      expect(mule.cargo).toHaveLength(1);
      const ride = (muleId: number): Action => move(muleId, [[1, 0], [2, 0]], { kind: 'load' });

      expect(canLoadInto(mule, barge)).toBe(false);
      expect(thenOptions(loaded, mule.id, at(2, 0))).toEqual([]);
      expect(thenOptions(loaded, mule.id, at(2, 0))).not.toContain('load');
      expect(reachable(loaded, mule.id).has('2,0')).toBe(false);
      expect(isLegal(loaded, ride(mule.id))).toBe(false);
      expect(() => applyAction(loaded, ride(mule.id))).toThrow(IllegalActionError);

      // Known-good: the same Mule with nothing inside boards the same Barge.
      const empty = setup(tile, false);
      const emptyMule = find(empty, 0, 'mule');
      expect(canLoadInto(emptyMule, find(empty, 0, 'barge'))).toBe(true);
      expect(thenOptions(empty, emptyMule.id, at(2, 0))).toEqual(['load']);
      expect(reachable(empty, emptyMule.id).has('2,0')).toBe(true);
      const boarded = play(empty, ride(emptyMule.id)).state;
      expect(find(boarded, 0, 'barge').cargo.map((c) => c.type)).toEqual(['mule']);
    });
  }

  it('still lets a trooper board a Barge directly (only nested boarding is refused)', () => {
    const s = fixtureGame(['..s.....'], [unit('trooper', 0, 1, 0), unit('barge', 0, 2, 0), unit('trooper', 1, 7, 0)]);
    const t = find(s, 0, 'trooper');
    expect(thenOptions(s, t.id, at(2, 0))).toEqual(['load']);
    expect(isLegal(s, move(t.id, [[1, 0], [2, 0]], { kind: 'load' }))).toBe(true);
  });

  it('destroys everything inside a transport, nested or not, as a defence', () => {
    const s = fixtureGame(['..s.....'], [unit('trooper', 0, 3, 0), unit('mule', 0, 4, 0), unit('barge', 0, 2, 0), unit('trooper', 1, 7, 0)]);
    const barge = find(s, 0, 'barge');
    const mule = find(s, 0, 'mule');
    const rider = find(s, 0, 'trooper');
    // The action API can no longer build this stack, so the test builds it by hand.
    const nested: Unit = { ...barge, cargo: [{ ...mule, cargo: [{ ...rider }] }] };
    const stacked: GameState = { ...s, units: [nested, find(s, 1)] };
    const ctx = draft(stacked);
    destroyUnit(ctx, ctx.s.units[0], 1);
    expect(ctx.s.units.some((u) => u.owner === 0)).toBe(false);
    expect(count(ctx.events, 'destroyed')).toBe(3);
    expect(ctx.events.filter((e) => e.kind === 'destroyed').map((e) => (e as { type: UnitTypeId }).type).sort()).toEqual(['barge', 'mule', 'trooper']);
    expect(ctx.s.players[0].stats.unitsLost).toBe(3);
    expect(ctx.s.players[1].stats.unitsDestroyed).toBe(3);
  });
});

// ---------------------------------------------------------------- D-015.5: rout at turn start

describe('D-015.5 a player who loses their last unit during turn start is defeated at once', () => {
  it('2 players: the starting player\'s only unit crashes, the other team wins, and no turn starts for the loser', () => {
    // The wasp burns its drain (2) on the first turn of cycle 2 and reaches 0 charge.
    const s = fixtureGame([flatRow(6)], [unit('wasp', 0, 0, 0), unit('trooper', 1, 5, 0)]);
    const wasp = find(s, 0);
    const primed = patchUnit(s, wasp.id, { charge: UNIT_TYPES.wasp.drain! });
    const afterP0 = play(primed, END).state;
    expect(afterP0.winnerTeam).toBeNull();
    const r = applyAction(afterP0, END); // player 1 ends: cycle 2 opens on player 0
    expect(r.state.players[0].defeated).toBe(true);
    expect(r.state.winnerTeam).toBe(1);
    expect(kinds(r.events)).toEqual(['turnEnded', 'crashed', 'playerDefeated', 'victory']);
    expect(r.events).toContainEqual({ kind: 'playerDefeated', player: 0, reason: 'rout' });
    expect(r.events).toContainEqual({ kind: 'victory', team: 1 });
    expect(isLegal(r.state, END)).toBe(false); // the game is over
  });

  it('3 teams: player 1\'s only unit crashes at their turn start; they are out, play passes to player 2, nobody has won', () => {
    const s = threeTeams([flatRow(8)], [unit('trooper', 0, 0, 0), unit('wasp', 1, 3, 0), unit('trooper', 2, 7, 0)]);
    const primed = patchUnit(s, find(s, 1).id, { charge: 0 });
    const r = applyAction(primed, END); // player 0 ends -> player 1's turn starts
    expect(r.state.players[1].defeated).toBe(true);
    expect(r.state.current).toBe(2);
    expect(r.state.cycle).toBe(1);
    expect(r.state.winnerTeam).toBeNull();
    expect(r.state.players[0].defeated).toBe(false);
    expect(r.state.players[2].defeated).toBe(false);
    expect(kinds(r.events)).toEqual(['turnEnded', 'crashed', 'playerDefeated', 'turnStarted']);
    expect(r.events[3]).toMatchObject({ kind: 'turnStarted', player: 2, cycle: 1 });
    expect(r.events).toContainEqual({ kind: 'playerDefeated', player: 1, reason: 'rout' });
    // The game goes on without player 1: player 2 plays, then the cycle wraps back to player 0.
    const next = applyAction(r.state, END).state;
    expect(next.current).toBe(0);
    expect(next.cycle).toBe(2);
    expect(next.players[1].defeated).toBe(true);
  });

  it('keeps the cycle counter right when the routed player is the last of the cycle (the skip crosses the wrap)', () => {
    const s = threeTeams([flatRow(8)], [unit('trooper', 0, 0, 0), unit('trooper', 1, 3, 0), unit('wasp', 2, 7, 0)]);
    const primed = patchUnit(s, find(s, 2).id, { charge: 0 });
    const afterP0 = play(primed, END).state;
    expect(afterP0.cycle).toBe(1);
    const r = applyAction(afterP0, END); // player 1 ends -> player 2 starts, is routed, the cycle closes, player 0 opens cycle 2
    expect(r.state.players[2].defeated).toBe(true);
    expect(r.state.cycle).toBe(2);
    expect(r.state.current).toBe(0);
    expect(r.state.winnerTeam).toBeNull();
    expect(r.events.filter((e) => e.kind === 'turnStarted')).toEqual([{ kind: 'turnStarted', player: 0, cycle: 2, income: 0 }]);
    // And the cycle that just closed is still judged: a one-cycle turn limit ends the game right there on the standings.
    const limited = threeTeams([flatRow(8)], [unit('lancer', 0, 0, 0), unit('trooper', 1, 3, 0), unit('wasp', 2, 7, 0)], { turnLimit: 1 });
    const done = play(patchUnit(limited, find(limited, 2).id, { charge: 0 }), END, END);
    expect(done.state.winnerTeam).toBe(0); // lancer (7000 x 10 HP) outweighs the trooper
    expect(done.state.cycle).toBe(1);
  });

  it('checks victory after each turn-start loss: two routs in a row leave the last team standing', () => {
    const s = threeTeams([flatRow(8)], [unit('trooper', 0, 0, 0), unit('wasp', 1, 3, 0), unit('wasp', 2, 7, 0)]);
    const primed = patchUnit(patchUnit(s, find(s, 1).id, { charge: 0 }), find(s, 2).id, { charge: 0 });
    const r = applyAction(primed, END);
    expect(r.state.players[1].defeated).toBe(true);
    expect(r.state.players[2].defeated).toBe(true);
    expect(r.state.winnerTeam).toBe(0);
    expect(count(r.events, 'victory')).toBe(1);
    expect(count(r.events, 'turnStarted')).toBe(0);
  });

  it('still never routes a player who started with no units and built none (D-012.4)', () => {
    const s = fixtureGame([flatRow(4)], [unit('trooper', 0, 0, 0)]);
    const r = applyAction(s, END);
    expect(r.state.current).toBe(1);
    expect(r.state.players[1].defeated).toBe(false);
    expect(r.state.winnerTeam).toBeNull();
    expect(kinds(r.events)).toEqual(['turnEnded', 'turnStarted']);
  });
});

// ---------------------------------------------------------------- D-013: the campaign deadline

describe('D-013 deadline', () => {
  /** Two armies too far apart to meet, so only the clock can end the game. */
  const duel = (extra: Partial<Parameters<typeof createGame>[0]> = {}, a: UnitTypeId = 'trooper', b: UnitTypeId = 'trooper') =>
    createGame({ map: fixtureMap([flatRow(8)], [unit(a, 0, 0, 0), unit(b, 1, 7, 0)]), players: [team(0), team(1, 'tidewell')], seed: 1, ...extra });

  it('is copied to the state by createGame, and absent when not given', () => {
    const given = { team: 0, cycles: 3 };
    const s = duel({ deadline: given });
    expect(s.deadline).toEqual({ team: 0, cycles: 3 });
    expect(s.deadline).not.toBe(given); // a copy, not the caller's object
    expect('deadline' in duel()).toBe(false);
  });

  it('refuses a deadline that could never behave as written', () => {
    expect(() => duel({ deadline: { team: 0, cycles: 0 } })).toThrow(/deadline/);
    expect(() => duel({ deadline: { team: 0, cycles: 1.5 } })).toThrow(/deadline/);
    expect(() => duel({ deadline: { team: 7, cycles: 3 } })).toThrow(/deadline/);
  });

  it('defeats the deadline team when its cycle ends without a win, and the other side wins', () => {
    const s = duel({ deadline: { team: 0, cycles: 2 } });
    const afterCycle1 = play(s, ...ends(2)).state;
    expect(afterCycle1.cycle).toBe(2);
    expect(afterCycle1.winnerTeam).toBeNull(); // cycle 1 ending does not trigger a cycle-2 deadline
    const midCycle2 = play(afterCycle1, END).state;
    expect(midCycle2.winnerTeam).toBeNull(); // not before the cycle has ended
    const r = applyAction(midCycle2, END);
    expect(r.state.winnerTeam).toBe(1);
    expect(r.state.players[0].defeated).toBe(true);
    expect(r.state.players[1].defeated).toBe(false);
    expect(r.state.units.some((u) => u.owner === 0)).toBe(false);
    expect(r.events).toContainEqual({ kind: 'playerDefeated', player: 0, reason: 'rout' });
    expect(r.events).toContainEqual({ kind: 'victory', team: 1 });
    // Known-bad control: the same clock with no deadline ends nothing.
    expect(play(duel(), ...ends(4)).state.winnerTeam).toBeNull();
  });

  it('works for either team: a deadline on team 1 hands the game to team 0', () => {
    const r = play(duel({ deadline: { team: 1, cycles: 1 } }), ...ends(2));
    expect(r.state.winnerTeam).toBe(0);
    expect(r.state.players[1].defeated).toBe(true);
  });

  it('never fires once the team has won: a rout inside the deadline cycle keeps the win', () => {
    // Player 0's lancer destroys player 1's last unit in cycle 2, the deadline cycle, before the cycle ends.
    const s = createGame({
      map: fixtureMap([flatRow(5)], [unit('lancer', 0, 0, 0), { type: 'trooper', owner: 1, x: 4, y: 0, hp: 1 }]),
      players: [team(0), team(1, 'tidewell')], seed: 1, deadline: { team: 0, cycles: 2 },
    });
    // Both sides pass cycle 1 (player 1's lone trooper stays put), then the lancer closes in and fires in cycle 2.
    const inCycle2 = play(s, ...ends(2)).state;
    const r = applyAction(inCycle2, move(find(inCycle2, 0).id, [[0, 0], [1, 0], [2, 0], [3, 0]], { kind: 'attack', target: at(4, 0) }));
    expect(r.state.winnerTeam).toBe(0);
    expect(r.state.cycle).toBe(2);
    expect(r.state.players[0].defeated).toBe(false);
    expect(r.events).not.toContainEqual({ kind: 'playerDefeated', player: 0, reason: 'rout' });
  });

  it('lets a survive objective met on the deadline cycle count as meeting it', () => {
    const base = { objective: { kind: 'survive', cycles: 2 } as const };
    const met = play(duel({ ...base, deadline: { team: 0, cycles: 2 } }), ...ends(4));
    expect(met.state.winnerTeam).toBe(0);
    expect(met.state.players[0].defeated).toBe(false);
    expect(count(met.events, 'playerDefeated')).toBe(0);
  });

  it('ends the game on the deadline when a turn limit ends on the same cycle (the deadline is applied first)', () => {
    // Team 0 fields a lancer against a trooper, so on the standings it wins the turn limit.
    const limitOnly = play(duel({ turnLimit: 2 }, 'lancer', 'trooper'), ...ends(4)).state;
    expect(limitOnly.winnerTeam).toBe(0);
    // The same game with a deadline on team 0 for the same cycle: the deadline fires first and team 0 loses.
    const both = play(duel({ turnLimit: 2, deadline: { team: 0, cycles: 2 } }, 'lancer', 'trooper'), ...ends(4));
    expect(both.state.winnerTeam).toBe(1);
    expect(both.state.players[0].defeated).toBe(true);
    expect(both.events).toContainEqual({ kind: 'playerDefeated', player: 0, reason: 'rout' });
  });

  it('lets a turn limit that ends earlier decide, so a later deadline never fires', () => {
    const r = play(duel({ turnLimit: 1, deadline: { team: 0, cycles: 3 } }, 'lancer', 'trooper'), ...ends(2));
    expect(r.state.winnerTeam).toBe(0);
    expect(r.state.cycle).toBe(1);
    expect(count(r.events, 'playerDefeated')).toBe(0);
  });

  it('hands play to the next player who is still in the game when the deadline defeats the player due next', () => {
    // Three teams, deadline on team 0 at the end of cycle 1: player 0 is out, so cycle 2 opens on player 1, not player 0.
    const s = threeTeams([flatRow(9)], [unit('trooper', 0, 0, 0), unit('trooper', 1, 4, 0), unit('trooper', 2, 8, 0)], { deadline: { team: 0, cycles: 1 } });
    const r = play(s, ...ends(3));
    expect(r.state.players[0].defeated).toBe(true);
    expect(r.state.winnerTeam).toBeNull(); // two teams remain
    expect(r.state.cycle).toBe(2);
    expect(r.state.current).toBe(1);
    expect(r.events.filter((e) => e.kind === 'turnStarted').pop()).toMatchObject({ player: 1, cycle: 2 });
    expect(r.state.units.some((u) => u.owner === 0)).toBe(false);
  });

  it('defeats every player on the deadline team, not only the first', () => {
    const fourPlayers = [team(0), team(1, 'tidewell'), team(0, 'verdant'), team(1, 'kestrel')];
    const s = createGame({
      map: fixtureMap([flatRow(9)], [unit('trooper', 0, 0, 0), unit('trooper', 1, 3, 0), unit('trooper', 2, 6, 0), unit('trooper', 3, 8, 0)]),
      players: fourPlayers, seed: 1, deadline: { team: 0, cycles: 1 },
    });
    const r = play(s, ...ends(4));
    expect(r.state.players.map((p) => p.defeated)).toEqual([true, false, true, false]);
    expect(r.state.winnerTeam).toBe(1);
    expect(count(r.events, 'playerDefeated')).toBe(2);
  });
});

// ---------------------------------------------------------------- fog and canopy consistency

describe('fog and canopy consistency', () => {
  /**
   * An arc battery (range 2-3) at (0,0) and a friendly trooper at (1,1) watch an enemy trooper at (2,0). The enemy is
   * 2 tiles from the trooper (inside its vision 2) and from the arc, but no friendly unit is next to it.
   */
  const watch = (tile: string, opts: { fog?: boolean } = {}) =>
    fixtureGame([`..${tile}...`, flatRow(6)], [unit('arc', 0, 0, 0), unit('trooper', 0, 1, 1), unit('trooper', 1, 2, 0)], { fog: opts.fog ?? true });

  it('hides a ground unit in canopy from attackTargets and ambushes a move into its tile', () => {
    const s = watch('f');
    const arc = find(s, 0, 'arc');
    const scout = find(s, 0, 'trooper');
    const enemy = find(s, 1);
    // Not targetable: not by the list, not by an attack action, not by a forecast.
    expect(canSeeUnit(s, 0, enemy)).toBe(false);
    expect(attackTargets(s, arc.id, at(0, 0))).toEqual([]);
    expect(isLegal(s, move(arc.id, [[0, 0]], { kind: 'attack', target: at(2, 0) }))).toBe(false);
    // Moving into its tile is an ambush: the scout stops one tile short and the enemy is revealed.
    const r = applyAction(s, move(scout.id, [[1, 1], [1, 0], [2, 0]]));
    expect(r.events).toContainEqual({ kind: 'ambushed', unitId: scout.id, at: at(1, 0), by: enemy.id });
    expect(find(r.state, 0, 'trooper')).toMatchObject({ x: 1, y: 0, charge: UNIT_TYPES.trooper.charge - 1 });
    expect(canSeeUnit(r.state, 0, find(r.state, 1))).toBe(true); // now next to a friendly unit
  });

  it('shows the same enemy on open ground: targetable, and a move through it is blocked, not an ambush', () => {
    const s = watch('.');
    const arc = find(s, 0, 'arc');
    const scout = find(s, 0, 'trooper');
    expect(canSeeUnit(s, 0, find(s, 1))).toBe(true);
    expect(attackTargets(s, arc.id, at(0, 0))).toEqual([at(2, 0)]);
    expect(isLegal(s, move(arc.id, [[0, 0]], { kind: 'attack', target: at(2, 0) }))).toBe(true);
    expect(isLegal(s, move(scout.id, [[1, 1], [1, 0], [2, 0]]))).toBe(false);
    // And with fog off the canopy hides nothing.
    const clear = watch('f', { fog: false });
    expect(attackTargets(clear, find(clear, 0, 'arc').id, at(0, 0))).toEqual([at(2, 0)]);
  });

  it('lists a canopy unit once a friendly unit stands next to it', () => {
    const s = fixtureGame(['..f...'], [unit('arc', 0, 0, 0), unit('trooper', 0, 1, 0), unit('trooper', 1, 2, 0)], { fog: true });
    expect(attackTargets(s, find(s, 0, 'arc').id, at(0, 0))).toEqual([at(2, 0)]);
  });

  it('sees and targets an air unit over canopy, while a ground unit on the same tile stays hidden', () => {
    // Distance 2 from the friendly trooper: inside its vision, not adjacent.
    const air = fixtureGame(['..f...'], [unit('trooper', 0, 0, 0), unit('wasp', 1, 2, 0)], { fog: true });
    const ground = fixtureGame(['..f...'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)], { fog: true });
    expect(canSeeUnit(air, 0, find(air, 1))).toBe(true);
    expect(canSeeUnit(ground, 0, find(ground, 1))).toBe(false);
    // Targetable: an anti-air warden beside the wasp has it on its list and may fire.
    const adjacent = fixtureGame(['.f....'], [unit('warden', 0, 0, 0), unit('wasp', 1, 1, 0)], { fog: true });
    const warden = find(adjacent, 0);
    expect(attackTargets(adjacent, warden.id, at(0, 0))).toEqual([at(1, 0)]);
    expect(isLegal(adjacent, move(warden.id, [[0, 0]], { kind: 'attack', target: at(1, 0) }))).toBe(true);
  });

  it('delegates to canSeeUnit, so a stealth unit is only targetable from next to it, fog or no fog', () => {
    const base = fixtureGame(['....', flatRow(4)], [unit('arc', 0, 0, 0), unit('trooper', 1, 2, 0)]);
    const stealth = patchUnit(base, find(base, 1).id, { hidden: true });
    expect(attackTargets(base, find(base, 0).id, at(0, 0))).toEqual([at(2, 0)]); // visible without the flag
    expect(attackTargets(stealth, find(stealth, 0).id, at(0, 0))).toEqual([]);
    // A friendly unit next to it uncovers it.
    const spotted = fixtureGame(['....', flatRow(4)], [unit('arc', 0, 0, 0), unit('trooper', 0, 2, 1), unit('trooper', 1, 2, 0)]);
    const spottedStealth = patchUnit(spotted, find(spotted, 1).id, { hidden: true });
    expect(attackTargets(spottedStealth, find(spottedStealth, 0, 'arc').id, at(0, 0))).toEqual([at(2, 0)]);
  });

  it('forecast refuses an unseen target the way it refuses an empty tile, and prices a seen one', () => {
    const hidden = watch('f');
    const arc = find(hidden, 0, 'arc');
    const refused = forecast(hidden, arc.id, at(0, 0), at(2, 0));
    expect(refused).toEqual({ damage: [0, 0], counter: null });
    expect(refused).toEqual(forecast(hidden, arc.id, at(0, 0), at(5, 1))); // same answer as an empty tile: nothing leaks
    // Known-good: on open ground the same shot is priced. Spec formula, base 90 (arc vs trooper), full HP, flats stars.
    const stars = TERRAIN_TYPES.flats.def;
    const price = (luck: number) => Math.floor(((90 * 100 + 100 * luck) * 10 * (200 - 100 - stars * 10)) / 100000);
    const seen = watch('.');
    expect(forecast(seen, find(seen, 0, 'arc').id, at(0, 0), at(2, 0))).toEqual({ damage: [price(0), price(9)], counter: null });
    expect(price(0)).toBeGreaterThan(0);
  });

  it('measures vision for a forecast from the tile the attacker would fire from', () => {
    // From (0,0) the canopy enemy is unseen; from the adjacent tile (1,0) it is seen and the same shot is priced.
    const s = fixtureGame(['..f...'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)], { fog: true });
    const attacker = find(s, 0);
    expect(forecast(s, attacker.id, at(0, 0), at(2, 0))).toEqual({ damage: [0, 0], counter: null });
    const stars = TERRAIN_TYPES.canopy.def;
    const price = (luck: number) => Math.floor(((55 * 100 + 100 * luck) * 10 * (200 - 100 - stars * 10)) / 100000); // trooper vs trooper 55
    const near = forecast(s, attacker.id, at(1, 0), at(2, 0));
    expect(near.damage).toEqual([price(0), price(9)]);
    expect(price(0)).toBeGreaterThan(0);
    expect(near.counter).not.toBeNull(); // adjacent direct fire is answered
  });
});

// ---------------------------------------------------------------- public exports

describe('index exports', () => {
  it('re-exports DEFAULT_PAR and canSeeUnit from their modules', () => {
    expect(DEFAULT_PAR).toBe(DEFAULT_PAR_FROM_SCORE);
    expect(DEFAULT_PAR).toEqual({ cycles: 10, power: 2 });
    expect(canSeeUnit).toBe(canSeeUnitFromFog);
  });
});
