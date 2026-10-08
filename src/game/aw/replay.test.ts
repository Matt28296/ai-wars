// stateHash and replay. Expected answers: the published FNV-1a test vectors and values worked out with an independent
// reference implementation (Python's big integers); canonical forms written out by hand; and live play, which is the
// oracle for replay (the same actions through applyAction, one at a time, with the states and events kept).
import { describe, expect, it } from 'vitest';
import { IllegalActionError, applyAction, createGame } from './index';
import type { CreateGameOptions } from './index';
import { legalActions } from './legal';
import { canonicalJson, fnv1a64, replay, stateHash } from './replay';
import { simulate } from './sim';
import { TWO_PLAYERS, fixtureMap } from './testing';
import type { Action, GameEvent, GameState } from './types';

// ---------------------------------------------------------------- the hash function

describe('fnv1a64', () => {
  it('matches the FNV-1a 64-bit test vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325'); // the offset basis: no bytes, no change
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });
  it('matches an independent implementation on JSON and on non-ASCII text (hashed as UTF-8)', () => {
    expect(fnv1a64('{"a":1}')).toBe('9c3e82dd6fcae8b1');
    expect(fnv1a64('héllo ✓')).toBe('cab09e47690f70e7');
  });
  it('is 16 lowercase hex digits and changes with every byte', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const h = fnv1a64(`unit ${i} hp ${100 - (i % 100)}`);
      expect(h).toMatch(/^[0-9a-f]{16}$/);
      seen.add(h);
    }
    expect(seen.size).toBe(300);
    expect(fnv1a64('ab')).not.toBe(fnv1a64('ba'));
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });
  it('treats an undefined field as absent, as JSON does, and null as itself', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({}));
  });
  it('escapes strings like JSON and keeps NaN apart from null', () => {
    expect(canonicalJson({ s: 'q"\n\\' })).toBe('{"s":"q\\"\\n\\\\"}');
    expect(canonicalJson({ n: NaN })).not.toBe(canonicalJson({ n: null }));
    expect(canonicalJson({ n: Infinity })).not.toBe(canonicalJson({ n: NaN }));
  });
  it('refuses what cannot be a game state: functions, Maps, class instances', () => {
    expect(() => canonicalJson({ f: () => 1 })).toThrow(TypeError);
    expect(() => canonicalJson({ m: new Map() })).toThrow(TypeError);
    expect(() => canonicalJson(new (class Thing { x = 1; })())).toThrow(TypeError);
    expect(() => canonicalJson({ n: 1n })).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------- stateHash

const battle = (): CreateGameOptions => ({
  map: fixtureMap(['F...H', '.f.^.', '..s..'], [
    { type: 'lancer', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'mule', owner: 0, x: 0, y: 2 },
    { type: 'trooper', owner: 1, x: 3, y: 0 }, { type: 'mule', owner: 1, x: 4, y: 1 }, { type: 'arc', owner: 1, x: 4, y: 2 },
  ], ['0...1', '.....', '.....']),
  players: TWO_PLAYERS, seed: 5, startFunds: 6000,
});

/** The same data with every object's keys inserted in the opposite (reverse sorted) order. */
function reverseKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reverseKeys) as T;
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort().reverse()) out[k] = reverseKeys((v as Record<string, unknown>)[k]);
    return out as T;
  }
  return v;
}

describe('stateHash', () => {
  it('gives equal states equal hashes: built twice, cloned, or with every key order reversed', () => {
    const a = createGame(battle());
    const b = createGame(battle());
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(structuredClone(a))).toBe(stateHash(a));
    const flipped = reverseKeys(a);
    expect(JSON.stringify(flipped)).not.toBe(JSON.stringify(a)); // the reversal really changed the key order
    expect(stateHash(flipped)).toBe(stateHash(a));
    expect(stateHash(a)).toMatch(/^[0-9a-f]{16}$/);
  });
  it('changes when a single hit point changes, whichever unit it is', () => {
    const s = createGame(battle());
    const base = stateHash(s);
    const hashes = new Set<string>([base]);
    for (const u of s.units) {
      const hurt: GameState = { ...s, units: s.units.map((x) => (x.id === u.id ? { ...x, hp: x.hp - 1 } : x)) };
      const h = stateHash(hurt);
      expect(h, `unit ${u.id}`).not.toBe(base);
      hashes.add(h);
    }
    expect(hashes.size).toBe(s.units.length + 1);
  });
  it('changes with every other kind of fact: a tile, funds, the rng, a flag, unit order, cargo, the cycle', () => {
    const s = createGame(battle());
    const base = stateHash(s);
    const variants: GameState[] = [
      { ...s, tiles: s.tiles.map((row, y) => (y === 0 ? row.map((t, x) => (x === 0 ? { ...t, capture: 19 } : t)) : row)) },
      { ...s, tiles: s.tiles.map((row, y) => (y === 0 ? row.map((t, x) => (x === 4 ? { ...t, owner: 0 } : t)) : row)) },
      { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, funds: p.funds + 1 } : p)) },
      { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, power: p.power + 1 } : p)) },
      { ...s, rng: s.rng + 1 },
      { ...s, fog: !s.fog },
      { ...s, cycle: s.cycle + 1 },
      { ...s, current: 1 },
      { ...s, units: s.units.map((u, i) => (i === 0 ? { ...u, acted: true } : u)) },
      { ...s, units: s.units.map((u, i) => (i === 0 ? { ...u, x: u.x + 1 } : u)) },
      { ...s, units: [s.units[1], s.units[0], ...s.units.slice(2)] },
      { ...s, units: s.units.map((u) => (u.type === 'mule' && u.owner === 0 ? { ...u, cargo: [{ ...s.units[1], x: u.x, y: u.y }] } : u)) },
    ];
    const all = new Set(variants.map(stateHash));
    expect(all.size).toBe(variants.length);
    expect(all.has(base)).toBe(false);
  });
});

// ---------------------------------------------------------------- replay

/** Live play: apply actions one at a time, keeping every state and every event. Prefers fighting, then building. */
function playLive(setup: CreateGameOptions, steps: number): { actions: Action[]; states: GameState[]; events: GameEvent[] } {
  let state = createGame(setup);
  const states = [state];
  const actions: Action[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < steps && state.winnerTeam === null; i++) {
    const list = legalActions(state);
    const action =
      list.find((a) => a.kind === 'move' && a.then.kind === 'attack') ??
      list.find((a) => a.kind === 'build') ??
      list.find((a) => a.kind === 'move' && a.then.kind !== 'wait') ??
      list.find((a) => a.kind === 'move' && i % 3 === 0) ??
      { kind: 'endTurn' as const };
    const r = applyAction(state, action);
    state = r.state;
    actions.push(action);
    states.push(state);
    events.push(...r.events);
  }
  return { actions, states, events };
}

describe('replay', () => {
  const setup = battle;

  it('reproduces live play exactly: final state, every event, and the state after every action', () => {
    const live = playLive(setup(), 60);
    expect(live.actions.length).toBeGreaterThan(30);
    expect(live.events.some((e) => e.kind === 'attacked'), 'the game had dice in it').toBe(true);
    const r = replay(setup(), live.actions);
    expect(stateHash(r.state)).toBe(stateHash(live.states[live.states.length - 1]));
    expect(r.state).toEqual(live.states[live.states.length - 1]);
    expect(r.events).toEqual(live.events);
    expect(r.hashes).toEqual(live.states.map(stateHash));
    expect(r.hashes).toHaveLength(live.actions.length + 1);
  });
  it('reproduces a recorded simulation, fog and powers included', () => {
    for (const policy of ['random', 'greedy'] as const) {
      const opts: CreateGameOptions = {
        ...setup(), fog: true, seed: 31, players: [
          { faction: 'helion', commander: 'rook', controller: 'ai', team: 0 },
          { faction: 'tidewell', commander: 'sefa', controller: 'ai', team: 1 },
        ],
      };
      const game = simulate({ setup: opts, seed: 3, maxCycles: 10, policy });
      expect(game.actions.length).toBeGreaterThanOrEqual(10);
      expect(game.events.some((e) => e.kind === 'attacked')).toBe(true);
      const r = replay(opts, game.actions);
      expect(stateHash(r.state)).toBe(game.hash);
      expect(r.events).toEqual(game.events);
    }
  });
  it('replays an empty list to the opening state, and can skip the per-action hashes', () => {
    const open = createGame(setup());
    const none = replay(setup(), []);
    expect(none.state).toEqual(open);
    expect(none.events).toEqual([]);
    expect(none.hashes).toEqual([stateHash(open)]);
    const live = playLive(setup(), 25);
    const cheap = replay(setup(), live.actions, { hashes: false });
    expect(cheap.hashes).toEqual([]);
    expect(stateHash(cheap.state)).toBe(stateHash(live.states[live.states.length - 1]));
  });
  it('gives another game when the record or the seed differs (a known-bad replay must not match)', () => {
    const live = playLive(setup(), 40);
    const final = stateHash(live.states[live.states.length - 1]);
    const fight = live.actions.findIndex((a) => a.kind === 'move' && a.then.kind === 'attack');
    expect(fight).toBeGreaterThanOrEqual(0);
    // an action missing from the record: it is a different game, or no longer a legal one
    const dropped = live.actions.filter((_, i) => i !== fight);
    let droppedHash: string | null;
    try {
      droppedHash = stateHash(replay(setup(), dropped).state);
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalActionError);
      droppedHash = null;
    }
    expect(droppedHash).not.toBe(final);
    // the same record under another luck seed: the dice fall differently
    const reseeded = replay({ ...setup(), seed: 6 }, live.actions);
    expect(stateHash(reseeded.state)).not.toBe(final);
    // a truncated record ends earlier
    expect(stateHash(replay(setup(), live.actions.slice(0, -1)).state)).not.toBe(final);
  });
  it('refuses an illegal action and says where it is', () => {
    const live = playLive(setup(), 12);
    const bogus: Action = { kind: 'move', unitId: 77, path: [{ x: 0, y: 0 }], then: { kind: 'wait' } };
    const edited = [...live.actions.slice(0, 5), bogus, ...live.actions.slice(5)];
    expect(() => replay(setup(), edited)).toThrow(IllegalActionError);
    expect(() => replay(setup(), edited)).toThrow(/action #5 \(move\)/);
    // the same action twice in a row: the second time the unit has already acted
    const move = live.actions.find((a) => a.kind === 'move')!;
    expect(() => replay(setup(), [move, move])).toThrow(/action #1/);
    // and an error that is not an illegal action (a malformed setup) is not dressed up as one
    expect(() => replay({ ...setup(), players: [] }, [])).toThrow(/needs at least 2 players/);
  });
  it('does not touch its setup or its action list', () => {
    const live = playLive(setup(), 20);
    const s = setup();
    const before = JSON.stringify([s, live.actions]);
    replay(s, live.actions);
    expect(JSON.stringify([s, live.actions])).toBe(before);
  });
});
