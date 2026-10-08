import { describe, expect, it } from 'vitest';
import { applyAction, createGame, IllegalActionError, isLegal, propertyCount } from './index';
import type { PlayerSetup } from './index';
import { checkGameOver, checkRout, declareWinner, defeatPlayer } from './victory';
import { draft } from './state';
import { fixtureGame, fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import type { Action, GameEvent, GameState, Objective, Then, Tile, Unit, UnitTypeId } from './types';

const END: Action = { kind: 'endTurn' };
const wait: Then = { kind: 'wait' };
const move = (unitId: number, path: [number, number][], then: Then = wait): Action => ({
  kind: 'move', unitId, path: path.map(([x, y]) => ({ x, y })), then,
});
const attack = (unitId: number, path: [number, number][], target: [number, number]): Action =>
  move(unitId, path, { kind: 'attack', target: { x: target[0], y: target[1] } });
const unit = (type: UnitTypeId, owner: number, x: number, y: number, hp?: number): FixtureUnit => ({ type, owner, x, y, ...(hp !== undefined ? { hp } : {}) });

/** Plays the actions in order and returns the last state with every event that was emitted along the way. */
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
const endTurns = (n: number): Action[] => Array.from({ length: n }, () => END);
const count = (events: GameEvent[], kind: GameEvent['kind']) => events.filter((e) => e.kind === kind).length;

// Test-owned edits to a state (the engine never mutates, so a spread copy is a fresh game position).
const mapUnits = (s: GameState, f: (u: Unit) => Unit): GameState => ({ ...s, units: s.units.map(f) });
const patchTile = (s: GameState, x: number, y: number, patch: Partial<Tile>): GameState => ({
  ...s, tiles: s.tiles.map((row, ty) => (ty === y ? row.map((t, tx) => (tx === x ? { ...t, ...patch } : t)) : row)),
});
const patchStats = (s: GameState, p: number, patch: Partial<GameState['players'][number]['stats']>): GameState => ({
  ...s, players: s.players.map((pl) => (pl.index === p ? { ...pl, stats: { ...pl.stats, ...patch } } : pl)),
});

/** Three players, three teams, so one defeat does not end the game. */
const THREE_TEAMS: PlayerSetup[] = [
  { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
  { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
  { faction: 'verdant', commander: 'none', controller: 'ai', team: 2 },
];
function threeTeams(terrain: string[], units: FixtureUnit[], owners: string[], objective?: Objective): GameState {
  return createGame({ map: fixtureMap(terrain, units, owners), players: THREE_TEAMS, seed: 1, ...(objective ? { objective } : {}) });
}

describe('rout (D-012.4)', () => {
  it('defeats a player the moment their last unit is destroyed, even on cycle 1, and the other team wins', () => {
    const s = fixtureGame(['...'], [unit('lancer', 0, 0, 0), unit('trooper', 1, 2, 0, 1)]);
    expect(s.cycle).toBe(1);
    const { state, events } = play(s, attack(1, [[0, 0], [1, 0]], [2, 0]));
    expect(state.cycle).toBe(1);
    expect(state.players[1].defeated).toBe(true);
    expect(state.units.filter((u) => u.owner === 1)).toHaveLength(0);
    expect(events).toContainEqual({ kind: 'playerDefeated', player: 1, reason: 'rout' });
    expect(state.winnerTeam).toBe(0);
    expect(count(events, 'victory')).toBe(1);
  });

  it('does not rout a player who still has a unit, and routs them when the last one falls', () => {
    const s = fixtureGame(['.....'], [unit('lancer', 0, 0, 0), unit('trooper', 1, 2, 0, 1), unit('trooper', 1, 4, 0, 1)]);
    const first = play(s, attack(1, [[0, 0], [1, 0]], [2, 0])).state;
    expect(first.players[1].defeated).toBe(false);
    expect(first.winnerTeam).toBeNull();
    expect(first.units.filter((u) => u.owner === 1)).toHaveLength(1);
    const second = play(s, attack(1, [[0, 0], [1, 0]], [2, 0]), END, END, attack(1, [[1, 0], [2, 0], [3, 0]], [4, 0])).state;
    expect(second.players[1].defeated).toBe(true);
    expect(second.winnerTeam).toBe(0);
  });

  it('counts units in cargo: a transport shot down with its passenger leaves the player with nothing', () => {
    const start = fixtureGame(['.....'], [unit('lancer', 0, 0, 0), unit('mule', 1, 3, 0), unit('trooper', 1, 4, 0)]);
    // p0 passes, p1 loads the trooper into the mule, p1 passes: it is cycle 2 and p0 has the move.
    const loaded = play(start, END, move(3, [[4, 0], [3, 0]], { kind: 'load' }), END).state;
    expect(loaded.units.find((u) => u.id === 2)?.cargo).toHaveLength(1);
    expect(loaded.players[1].defeated).toBe(false);
    const weak = mapUnits(loaded, (u) => (u.id === 2 ? { ...u, hp: 10 } : u));
    const { state } = play(weak, attack(1, [[0, 0], [1, 0], [2, 0]], [3, 0]));
    expect(state.players[1].stats.unitsLost).toBe(2); // the mule and the trooper inside it
    expect(state.players[1].defeated).toBe(true);
    expect(state.winnerTeam).toBe(0);
  });

  it('never routs a player who started with no units and has built none, on cycle 1, 2 or later', () => {
    const s = fixtureGame(['..F'], [unit('lancer', 0, 0, 0)], { owners: ['..1'] });
    expect(s.players[1].stats.unitsStarted).toBe(0);
    // Cycle 1: p0 passes, p1 passes (builds nothing). Cycle 2: p0 acts. Cycle 3 likewise.
    const c2 = play(s, END, END, move(1, [[0, 0], [1, 0]])).state;
    expect(c2.cycle).toBe(2);
    expect(c2.players[1].defeated).toBe(false);
    expect(c2.winnerTeam).toBeNull();
    const c3 = play(c2, END, END, move(1, [[1, 0], [0, 0]])).state;
    expect(c3.cycle).toBe(3);
    expect(c3.players[1].defeated).toBe(false);
    expect(c3.winnerTeam).toBeNull();
  });

  it('routs a player who built a unit and then lost it (having had a unit is what counts)', () => {
    const s = fixtureGame(['..F'], [unit('lancer', 0, 0, 0)], { owners: ['..1'] });
    const built = play(s, END, { kind: 'build', at: { x: 2, y: 0 }, unitType: 'trooper' }).state; // p1 pays its first income, builds
    expect(built.players[1].stats.unitsBuilt).toBe(1);
    expect(built.players[1].defeated).toBe(false);
    const wounded = mapUnits(built, (u) => (u.owner === 1 ? { ...u, hp: 10 } : u));
    const { state, events } = play(wounded, END, attack(1, [[0, 0], [1, 0]], [2, 0]));
    expect(state.cycle).toBe(2);
    expect(events).toContainEqual({ kind: 'playerDefeated', player: 1, reason: 'rout' });
    expect(state.winnerTeam).toBe(0);
  });

  it('routs, in the very next check, an empty-handed player whose record shows they had units', () => {
    const none = fixtureGame(['...'], [unit('lancer', 0, 0, 0)]);
    const hadOne = patchStats(none, 1, { unitsStarted: 1 });
    expect(play(none, END).state.players[1].defeated).toBe(false); // known-bad twin: nothing was ever owned, nothing to lose
    expect(play(hadOne, END).state.players[1].defeated).toBe(true);
    const lostOne = patchStats(none, 1, { unitsStarted: undefined, unitsLost: 1 }); // older saves lack unitsStarted
    expect(play(lostOne, END).state.players[1].defeated).toBe(true);
  });

  it('leaves checkRout idle once the game has a winner', () => {
    const over = fixtureGame(['...'], [unit('lancer', 0, 0, 0), unit('trooper', 1, 2, 0, 1)]);
    const ctx = draft(patchStats({ ...over, winnerTeam: 0 }, 1, { unitsStarted: 1 }));
    ctx.s.units = ctx.s.units.filter((u) => u.owner === 0);
    checkRout(ctx);
    expect(ctx.s.players[1].defeated).toBe(false);
    expect(ctx.events).toHaveLength(0);
  });
});

describe('defeat', () => {
  const field = ['.....', 'F...H'];
  const owners = ['.....', '1...1'];
  const units = [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0), unit('trooper', 2, 4, 0)];

  it('removes the units and frees the properties of a resigned player, spire turning into a city; the rest play on', () => {
    const s = threeTeams(field, units, owners);
    const { state, events } = play(s, END, { kind: 'resign' });
    expect(state.players[1].defeated).toBe(true);
    expect(state.units.map((u) => u.owner).sort()).toEqual([0, 2]);
    expect(state.tiles[1][0]).toMatchObject({ terrain: 'fabricator', owner: null, capture: 20 }); // neutral, not handed to anyone
    expect(state.tiles[1][4]).toMatchObject({ terrain: 'arcology', owner: null, capture: 20 });
    expect(events).toContainEqual({ kind: 'playerDefeated', player: 1, reason: 'resign' });
    expect(state.winnerTeam).toBeNull();
    expect(state.current).toBe(2); // play passes to the next undefeated player
  });

  it('ends the game when the second-to-last team resigns, with one victory event', () => {
    const s = threeTeams(field, units, owners);
    const { state, events } = play(s, END, { kind: 'resign' }, { kind: 'resign' });
    expect(state.winnerTeam).toBe(0);
    expect(count(events, 'victory')).toBe(1);
    expect(events).toContainEqual({ kind: 'victory', team: 0 });
  });

  it('gives the loser a resignation defeat in a two-player game: the other side wins', () => {
    const s = fixtureGame(['...'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)]);
    const { state, events } = play(s, { kind: 'resign' });
    expect(state.players[0].defeated).toBe(true);
    expect(state.winnerTeam).toBe(1);
    expect(events.map((e) => e.kind).filter((k) => k === 'playerDefeated' || k === 'victory')).toEqual(['playerDefeated', 'victory']);
  });

  it('is a no-op for a player who is already defeated', () => {
    const s = threeTeams(field, units, owners);
    const ctx = draft(s);
    defeatPlayer(ctx, 1, 'resign');
    defeatPlayer(ctx, 1, 'rout');
    expect(ctx.events.filter((e) => e.kind === 'playerDefeated')).toHaveLength(1);
  });
});

describe('command spire capture', () => {
  it('defeats the owner, hands their other properties to the captor and turns the spire into the captor\'s city', () => {
    const owners = ['.1.', '1..'];
    const s0 = threeTeams(['.H.', 'F..'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 1), unit('trooper', 2, 2, 0)], owners);
    const s = patchTile(s0, 1, 0, { capture: 10 }); // a full-health trooper takes 10 points: one capture finishes it
    expect(propertyCount(s, 0)).toBe(0);
    const { state, events } = play(s, move(1, [[0, 0], [1, 0]], { kind: 'capture' }));
    expect(events.some((e) => e.kind === 'captured')).toBe(true);
    expect(events).toContainEqual({ kind: 'playerDefeated', player: 1, reason: 'hq' });
    expect(state.players[1].defeated).toBe(true);
    expect(state.units.some((u) => u.owner === 1)).toBe(false);
    expect(state.tiles[0][1]).toMatchObject({ terrain: 'arcology', owner: 0, capture: 20 });
    expect(state.tiles[1][0]).toMatchObject({ terrain: 'fabricator', owner: 0 }); // transferred, not neutral
    expect(propertyCount(state, 0)).toBe(2);
    expect(state.winnerTeam).toBeNull(); // team 2 is still in the game
  });

  it('leaves the owner standing when the capture is only part way', () => {
    const s = fixtureGame(['.H.'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)], { owners: ['.1.'] });
    const { state } = play(s, move(1, [[0, 0], [1, 0]], { kind: 'capture' }));
    expect(state.tiles[0][1].capture).toBe(10);
    expect(state.players[1].defeated).toBe(false);
    expect(state.winnerTeam).toBeNull();
  });
});

describe('mission objectives', () => {
  const duel = (objective: Objective, extra: Parameters<typeof fixtureGame>[2] = {}) =>
    fixtureGame(['.....'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 4, 0)], { objective, ...extra });

  it('survive N: player 0\'s team wins when cycle N ends, not before', () => {
    const s = duel({ kind: 'survive', cycles: 2 });
    const c1 = play(s, END, END).state; // cycle 1 over
    expect(c1.cycle).toBe(2);
    expect(c1.winnerTeam).toBeNull();
    const mid = play(c1, END).state; // player 0 finishes cycle 2; player 1 still has to move
    expect(mid.winnerTeam).toBeNull();
    const { state, events } = play(mid, END);
    expect(state.winnerTeam).toBe(0);
    expect(state.cycle).toBe(2); // it ended inside cycle 2
    expect(count(events, 'victory')).toBe(1);
  });

  it('survive N: is not won by a team that has already been wiped out', () => {
    const s = threeTeams(['.....'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0), unit('trooper', 2, 4, 0)], ['.....'], { kind: 'survive', cycles: 1 });
    const { state } = play(s, { kind: 'resign' }, END, END); // p0 resigns, p1 and p2 finish cycle 1
    expect(state.players[0].defeated).toBe(true);
    expect(state.cycle).toBe(2);
    expect(state.winnerTeam).toBeNull();
  });

  it('capture N: wins when a player owns N properties, counting the ones they began with', () => {
    const terrain = ['C.C', '...'];
    const owners = ['0..', '...'];
    const units = [unit('trooper', 0, 1, 0), unit('trooper', 1, 2, 1)];
    // The neutral arcology at (2,0) is 10 points from changing hands, so one capture by a full-health trooper finishes it.
    const ready = (properties: number) =>
      patchTile(fixtureGame(terrain, units, { owners, objective: { kind: 'capture', properties } }), 2, 0, { capture: 10 });
    const two = play(ready(2), move(1, [[1, 0], [2, 0]], { kind: 'capture' }));
    expect(propertyCount(two.state, 0)).toBe(2);
    expect(two.state.winnerTeam).toBe(0);
    expect(count(two.events, 'victory')).toBe(1);
    const three = play(ready(3), move(1, [[1, 0], [2, 0]], { kind: 'capture' }));
    expect(propertyCount(three.state, 0)).toBe(2); // known-bad: two properties do not satisfy a target of three
    expect(three.state.winnerTeam).toBeNull();
  });

  it('capture N: the other team wins if it gets there first', () => {
    const terrain = ['C.C', '...'];
    const s0 = fixtureGame(terrain, [unit('trooper', 0, 0, 1), unit('trooper', 1, 1, 0)], { owners: ['1..', '...'], objective: { kind: 'capture', properties: 2 } });
    const s = patchTile(s0, 2, 0, { capture: 10 });
    const { state } = play(s, END, move(2, [[1, 0], [2, 0]], { kind: 'capture' }));
    expect(state.winnerTeam).toBe(1);
  });
});

describe('turn limit', () => {
  // Two arcologies on a strip; owners and units decide who is ahead when cycle 2 ends.
  const limited = (owners: string, units: FixtureUnit[]) =>
    fixtureGame(['C.C.C'], units, { owners: [owners], turnLimit: 2 });
  const throughCycle = (s: GameState, cycles: number) => play(s, ...endTurns(2 * cycles));
  const base = [unit('trooper', 0, 1, 0), unit('trooper', 1, 3, 0)];

  it('does nothing before the limit and ends the game when cycle N ends', () => {
    const s = limited('0.0.1', base);
    expect(throughCycle(s, 1).state.winnerTeam).toBeNull();
    expect(throughCycle(s, 2).state.winnerTeam).not.toBeNull();
  });

  it('gives the win to the team with the most properties, whichever side that is', () => {
    expect(throughCycle(limited('0.0.1', base), 2).state.winnerTeam).toBe(0);
    expect(throughCycle(limited('0.1.1', base), 2).state.winnerTeam).toBe(1);
  });

  it('ranks properties above unit value', () => {
    // Team 0 holds two properties and a trooper (1000); team 1 holds one property and a lancer (7000).
    const s = limited('0.0.1', [unit('trooper', 0, 1, 0), unit('lancer', 1, 3, 0)]);
    expect(throughCycle(s, 2).state.winnerTeam).toBe(0);
  });

  it('breaks a property tie by the worth of the units each team still has', () => {
    const richer = [unit('trooper', 0, 1, 0), unit('lancer', 1, 3, 0)]; // 1000 against 7000
    expect(throughCycle(limited('0...1', richer), 2).state.winnerTeam).toBe(1);
    const swapped = [unit('lancer', 0, 1, 0), unit('trooper', 1, 3, 0)];
    expect(throughCycle(limited('0...1', swapped), 2).state.winnerTeam).toBe(0);
    const wounded = [unit('lancer', 0, 1, 0, 4), unit('lancer', 1, 3, 0, 9)]; // value is cost x display HP
    expect(throughCycle(limited('0...1', wounded), 2).state.winnerTeam).toBe(1);
  });

  it('gives a complete tie to the team that moves later in the cycle', () => {
    expect(throughCycle(limited('0...1', base), 2).state.winnerTeam).toBe(1);
  });
});

describe('the game ends once', () => {
  const finished = () => {
    const s0 = fixtureGame(['.H.'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)], { owners: ['.1.'] });
    return play(patchTile(s0, 1, 0, { capture: 10 }), move(1, [[0, 0], [1, 0]], { kind: 'capture' }));
  };

  it('emits exactly one victory and refuses every action afterwards', () => {
    const { state, events } = finished();
    expect(state.winnerTeam).toBe(0);
    expect(count(events, 'victory')).toBe(1);
    expect(count(events, 'playerDefeated')).toBe(1);
    for (const a of [END, { kind: 'resign' } as Action, { kind: 'build', at: { x: 0, y: 0 }, unitType: 'trooper' } as Action, move(1, [[1, 0]])]) {
      expect(isLegal(state, a), a.kind).toBe(false);
    }
    expect(() => applyAction(state, END)).toThrow(IllegalActionError);
    expect(() => applyAction(state, END)).toThrow(/game is over/);
  });

  it('keeps the first winner when declareWinner is called again, and checkGameOver stays quiet', () => {
    const ctx = draft(fixtureGame(['...'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 2, 0)]));
    declareWinner(ctx, 1);
    declareWinner(ctx, 0);
    checkGameOver(ctx);
    expect(ctx.s.winnerTeam).toBe(1);
    expect(ctx.events).toEqual([{ kind: 'victory', team: 1 }]);
  });

  it('declares a winner only when exactly one team is left standing', () => {
    const three = draft(threeTeams(['...'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 1, 0), unit('trooper', 2, 2, 0)], ['...']));
    checkGameOver(three);
    expect(three.s.winnerTeam).toBeNull(); // known-bad: three teams still play
    defeatPlayer(three, 1, 'resign');
    expect(three.s.winnerTeam).toBeNull();
    checkGameOver(three);
    expect(three.s.winnerTeam).toBeNull();
    defeatPlayer(three, 2, 'resign');
    checkGameOver(three);
    expect(three.s.winnerTeam).toBe(0);
  });
});
