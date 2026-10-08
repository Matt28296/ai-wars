import { describe, expect, it } from 'vitest';
import { applyAction, createGame, forecast, isLegal, IllegalActionError, thenOptions, unitAt, unloadTargets } from './index';
import { fixtureGame, fixtureMap, TWO_PLAYERS } from './testing';
import type { Action, GameState } from './types';

const wait = { kind: 'wait' } as const;
const move = (unitId: number, path: [number, number][], then: Action extends never ? never : any = wait): Action => ({
  kind: 'move', unitId, path: path.map(([x, y]) => ({ x, y })), then,
});
const at = (s: GameState, x: number, y: number) => unitAt(s, { x, y });

describe('createGame', () => {
  it('builds tiles, units and players and pays player 0 its first income', () => {
    const s = fixtureGame(['F.C.', '...F'], [{ type: 'trooper', owner: 0, x: 1, y: 0 }], { owners: ['0.0.', '...1'], firstMoverRule: 'none' });
    expect(s.width).toBe(4);
    expect(s.height).toBe(2);
    expect(s.tiles[0][0]).toEqual({ terrain: 'fabricator', owner: 0, capture: 20 });
    expect(s.units).toHaveLength(1);
    expect(s.units[0]).toMatchObject({ id: 1, type: 'trooper', hp: 100, charge: 99, ammo: 0, acted: false });
    expect(s.players[0].funds).toBe(2000);
    expect(s.players[1].funds).toBe(0);
    expect(s.current).toBe(0);
    expect(s.cycle).toBe(1);
  });
  it('rejects a unit on terrain it cannot stand on', () => {
    expect(() => fixtureGame(['~.'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }])).toThrow(/cannot stand on sea/);
  });
  it('rejects ragged rows and owners on non-properties', () => {
    expect(() => fixtureGame(['...', '..'])).toThrow(/row 1/);
    expect(() => createGame({ map: fixtureMap(['..'], [], ['0.']), players: TWO_PLAYERS })).toThrow(/non-property/);
  });
});

describe('move', () => {
  const base = () => fixtureGame(['.....', '.....'], [
    { type: 'trooper', owner: 0, x: 0, y: 0 },
    { type: 'trooper', owner: 1, x: 4, y: 1 },
  ]);
  it('moves, spends charge per step and marks the unit as acted', () => {
    const { state, events } = applyAction(base(), move(1, [[0, 0], [1, 0], [2, 0]]));
    expect(at(state, 2, 0)).toMatchObject({ id: 1, charge: 97, acted: true });
    expect(events[0]).toMatchObject({ kind: 'moved', unitId: 1 });
  });
  it('refuses a second action, an enemy unit, too long a path and a broken path', () => {
    const s = base();
    const moved = applyAction(s, move(1, [[0, 0], [1, 0]])).state;
    expect(isLegal(moved, move(1, [[1, 0], [2, 0]]))).toBe(false);
    expect(isLegal(s, move(2, [[4, 1], [3, 1]]))).toBe(false);
    expect(isLegal(s, move(1, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]))).toBe(false);
    expect(isLegal(s, move(1, [[0, 0], [2, 0]]))).toBe(false);
    expect(() => applyAction(s, move(1, [[0, 0], [2, 0]]))).toThrow(IllegalActionError);
  });
  it('never changes the input state', () => {
    const s = base();
    const snapshot = structuredClone(s);
    applyAction(s, move(1, [[0, 0], [1, 0]]));
    expect(s).toEqual(snapshot);
  });
});

describe('attack', () => {
  const duel = () => fixtureGame(['...'], [
    { type: 'lancer', owner: 0, x: 0, y: 0 },
    { type: 'trooper', owner: 1, x: 2, y: 0 },
  ]);
  it('offers Fire next to an enemy and resolves damage inside the forecast range', () => {
    const s = duel();
    expect(thenOptions(s, 1, { x: 1, y: 0 })).toEqual(['attack', 'wait']);
    const f = forecast(s, 1, { x: 1, y: 0 }, { x: 2, y: 0 });
    const { state, events } = applyAction(s, move(1, [[0, 0], [1, 0]], { kind: 'attack', target: { x: 2, y: 0 } }));
    const hit = events.find((e) => e.kind === 'attacked');
    expect(hit).toBeDefined();
    if (hit?.kind !== 'attacked') return;
    expect(hit.damage).toBeGreaterThanOrEqual(f.damage[0]);
    expect(hit.damage).toBeLessThanOrEqual(f.damage[1]);
    expect(at(state, 2, 0)?.hp).toBe(100 - hit.damage);
  });
  it('is deterministic for a seed', () => {
    const a = applyAction(duel(), move(1, [[0, 0], [1, 0]], { kind: 'attack', target: { x: 2, y: 0 } }));
    const b = applyAction(duel(), move(1, [[0, 0], [1, 0]], { kind: 'attack', target: { x: 2, y: 0 } }));
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });
  it('refuses an indirect unit that moves and fires', () => {
    // Trooper 4 tiles away: out of range (2–3) from the start, in range only after moving one tile.
    const s = fixtureGame(['.....'], [
      { type: 'arc', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 1, x: 4, y: 0 },
    ]);
    expect(thenOptions(s, 1, { x: 1, y: 0 })).toEqual(['wait']);
    expect(isLegal(s, move(1, [[0, 0], [1, 0]], { kind: 'attack', target: { x: 4, y: 0 } }))).toBe(false);
    expect(thenOptions(s, 1, { x: 0, y: 0 })).toEqual(['wait']);
    const inRange = fixtureGame(['.....'], [
      { type: 'arc', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 1, x: 2, y: 0 },
    ]);
    expect(thenOptions(inRange, 1, { x: 0, y: 0 })).toEqual(['attack', 'wait']);
  });
});

describe('build, end turn and income', () => {
  it('builds at an owned fabricator, then passes the turn and pays the next player', () => {
    const s = fixtureGame(['F..F'], [], { owners: ['0..1'], startFunds: 5000, firstMoverRule: 'none' });
    expect(s.players[0].funds).toBe(6000);
    const built = applyAction(s, { kind: 'build', at: { x: 0, y: 0 }, unitType: 'trooper' }).state;
    expect(built.players[0].funds).toBe(5000);
    expect(at(built, 0, 0)).toMatchObject({ type: 'trooper', owner: 0, acted: true });
    expect(isLegal(s, { kind: 'build', at: { x: 3, y: 0 }, unitType: 'trooper' })).toBe(false);
    const next = applyAction(built, { kind: 'endTurn' }).state;
    expect(next.current).toBe(1);
    expect(next.players[1].funds).toBe(6000);
    const wrapped = applyAction(next, { kind: 'endTurn' }).state;
    expect(wrapped.current).toBe(0);
    expect(wrapped.cycle).toBe(2);
  });
});

describe('capture and victory', () => {
  it('captures an enemy Command Spire over two turns and wins', () => {
    let s = fixtureGame(['.H.', '...'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 1, x: 2, y: 1 },
    ], { owners: ['.1.', '...'] });
    s = applyAction(s, move(1, [[0, 0], [1, 0]], { kind: 'capture' })).state;
    expect(s.tiles[0][1].capture).toBe(10);
    s = applyAction(s, { kind: 'endTurn' }).state;
    s = applyAction(s, { kind: 'endTurn' }).state;
    const { state, events } = applyAction(s, move(1, [[1, 0]], { kind: 'capture' }));
    expect(events.some((e) => e.kind === 'captured')).toBe(true);
    expect(state.winnerTeam).toBe(0);
    expect(isLegal(state, { kind: 'endTurn' })).toBe(false);
  });
});

describe('transport and join', () => {
  it('loads a trooper into a mule, carries it and unloads it', () => {
    let s = fixtureGame(['.....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'mule', owner: 0, x: 1, y: 0 },
      { type: 'trooper', owner: 1, x: 4, y: 0 },
    ]);
    expect(thenOptions(s, 1, { x: 1, y: 0 })).toEqual(['load']);
    s = applyAction(s, move(1, [[0, 0], [1, 0]], { kind: 'load' })).state;
    expect(s.units.find((u) => u.id === 2)?.cargo.map((c) => c.id)).toEqual([1]);
    expect(unloadTargets(s, 2, { x: 2, y: 0 }, 0)).toEqual([{ x: 3, y: 0 }, { x: 1, y: 0 }]);
    s = applyAction(s, move(2, [[1, 0], [2, 0]], { kind: 'unload', drops: [{ cargoIndex: 0, to: { x: 3, y: 0 } }] })).state;
    expect(at(s, 3, 0)).toMatchObject({ id: 1, acted: true });
    expect(s.units.find((u) => u.id === 2)?.cargo).toEqual([]);
  });
  it('joins two damaged units of the same type', () => {
    let s = fixtureGame(['...'], [
      { type: 'trooper', owner: 0, x: 0, y: 0, hp: 4 },
      { type: 'trooper', owner: 0, x: 1, y: 0, hp: 5 },
    ]);
    expect(thenOptions(s, 1, { x: 1, y: 0 })).toEqual(['join']);
    const r = applyAction(s, move(1, [[0, 0], [1, 0]], { kind: 'join' }));
    s = r.state;
    expect(s.units).toHaveLength(1);
    expect(at(s, 1, 0)?.hp).toBe(90);
  });
});
