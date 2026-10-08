// legalActions(): the full, exact list of what the current player may do. The engine is the oracle here:
//   (a) SOUND      every listed action passes isLegal and applyAction does not throw;
//   (b) COMPLETE   every candidate action isLegal accepts is in the list (random candidates on mid-game states, and
//                  EVERY candidate in a finite universe on small hand-built maps, where the two sets must be equal);
//   (c) EXACT      hand-built positions with a known action count, worked out from the rules below, not from legal.ts.
// The checkers are tested against doctored lists, so a green run cannot come from a checker that accepts anything.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import type { MapDef } from '../../content/types';
import { TERRAIN_TYPES, UNIT_LIST, UNIT_TYPES } from '../../data';
import { POWER_STAR, applyAction, attackTargets, createGame, isLegal, reachable, thenOptions } from './index';
import type { CreateGameOptions, PlayerSetup } from './index';
import { actionKey, destinationActions, legalActions, unitActions } from './legal';
import { checkPath } from './movement';
import { simulate } from './sim';
import type { SimPolicy } from './sim';
import { fixtureGame, fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import type { Action, Coord, GameState, Then, Unit, UnitTypeId } from './types';

// ---------------------------------------------------------------- helpers

const keys = (list: Action[]) => list.map(actionKey).sort();
const key = (x: number, y: number) => `${x},${y}`;
const move = (unitId: number, x: number, y: number, then: string) => `move:${unitId}>${x},${y}:${then}`;

/** The state with one unit replaced. */
const patchUnit = (s: GameState, id: number, patch: Partial<Unit>): GameState => ({
  ...s, units: s.units.map((u) => (u.id === id ? { ...u, ...patch } : u)),
});
/** Puts the unit `cargoId` (currently on the map) inside the transport `transportId`. */
function load(s: GameState, transportId: number, cargoIds: number[]): GameState {
  const t = s.units.find((u) => u.id === transportId)!;
  const cargo = s.units.filter((u) => cargoIds.includes(u.id)).map((u) => ({ ...u, x: t.x, y: t.y }));
  return { ...s, units: s.units.filter((u) => !cargoIds.includes(u.id)).map((u) => (u.id === transportId ? { ...u, cargo } : u)) };
}
const withPower = (s: GameState, p: number, power: number): GameState => ({
  ...s, players: s.players.map((pl, i) => (i === p ? { ...pl, power } : pl)),
});
function allTiles(s: GameState): Coord[] {
  const out: Coord[] = [];
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) out.push({ x, y });
  return out;
}
/** An L-shaped walk (x first, then y), used when reachable() has no path for a tile. */
function lPath(from: Coord, to: Coord): Coord[] {
  const p: Coord[] = [{ x: from.x, y: from.y }];
  let { x, y } = from;
  while (x !== to.x) { x += Math.sign(to.x - x); p.push({ x, y }); }
  while (y !== to.y) { y += Math.sign(to.y - y); p.push({ x, y }); }
  return p;
}

/** Listed actions the engine refuses (soundness). */
function unsound(state: GameState, list: Action[]): string[] {
  const bad: string[] = [];
  for (const a of list) {
    try {
      applyAction(state, a);
    } catch (err) {
      bad.push(`${actionKey(a)}: ${(err as Error).message}`);
    }
    if (!isLegal(state, a)) bad.push(`${actionKey(a)}: isLegal says no`);
  }
  return bad;
}
/** Candidates the engine accepts that the list lacks (completeness). `resign` is accepted by the engine and listed only on request. */
function missing(state: GameState, list: Action[], candidates: Action[]): string[] {
  const listed = new Set(list.map(actionKey));
  const out = new Set<string>();
  for (const c of candidates) {
    if (c.kind === 'resign') continue;
    const k = actionKey(c);
    if (!listed.has(k) && isLegal(state, c) && !ambushed(state, c)) out.add(k);
  }
  return [...out];
}
/** A move whose path crosses a hidden enemy ends early, whatever its follow-up says, so its follow-up is not a choice. */
function ambushed(state: GameState, a: Action): boolean {
  if (a.kind !== 'move') return false;
  const u = state.units.find((x) => x.id === a.unitId);
  if (!u) return false;
  try {
    return checkPath(state, u, a.path).stop < a.path.length - 1;
  } catch {
    return false;
  }
}

/** Every candidate in a finite universe: each own unit (acted or not) to each tile, with every follow-up. Small maps only. */
function universe(state: GameState): Action[] {
  const out: Action[] = [];
  const tiles = allTiles(state);
  for (const u of state.units.filter((x) => x.owner === state.current)) {
    const reach = reachable(state, u.id);
    for (const dest of tiles) {
      const e = reach.get(key(dest.x, dest.y));
      const path = e ? e.path : lPath(u, dest);
      const thens: Then[] = [{ kind: 'wait' }, { kind: 'capture' }, { kind: 'load' }, { kind: 'join' }, { kind: 'supply' }];
      for (const t of tiles) thens.push({ kind: 'attack', target: t });
      for (let i = 0; i < u.cargo.length; i++) {
        for (const t of tiles) thens.push({ kind: 'unload', drops: [{ cargoIndex: i, to: t }] });
        for (let j = i + 1; j < u.cargo.length; j++) {
          for (const a of tiles) for (const b of tiles) thens.push({ kind: 'unload', drops: [{ cargoIndex: i, to: a }, { cargoIndex: j, to: b }] });
        }
      }
      for (const then of thens) out.push({ kind: 'move', unitId: u.id, path, then });
    }
  }
  for (const t of tiles) for (const type of UNIT_LIST) out.push({ kind: 'build', at: t, unitType: type.id });
  out.push({ kind: 'power', level: 'surge' }, { kind: 'power', level: 'overclock' }, { kind: 'endTurn' });
  return out;
}

/** The engine's verdict on the whole universe, as a sorted list of keys. */
function acceptedKeys(state: GameState): string[] {
  return [...new Set(universe(state).filter((a) => isLegal(state, a) && !ambushed(state, a)).map(actionKey))].sort();
}

// ---------------------------------------------------------------- (c) hand-built positions with a known count

describe('exact action lists on hand-built positions', () => {
  it('a trooper on an open 3x3 with one enemy trooper in the far corner: 11 actions', () => {
    // Trooper (foot, move 3) at (0,0): every tile within 3 steps except the enemy's own tile (2,2, a visible enemy blocks):
    //   8 tiles, so 8 waits; it can fire (range 1, its machine gun works on a trooper) from the two tiles beside the enemy,
    //   (2,1) and (1,2): 2 attacks; and endTurn. 8 + 2 + 1 = 11.
    const s = fixtureGame(['...', '...', '...'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 1, x: 2, y: 2 },
    ]);
    const want = [
      ...[[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2]].map(([x, y]) => move(1, x, y, 'wait')),
      move(1, 2, 1, 'attack@2,2'), move(1, 1, 2, 'attack@2,2'), 'endTurn',
    ].sort();
    const list = legalActions(s);
    expect(list).toHaveLength(11);
    expect(keys(list)).toEqual(want);
    expect(acceptedKeys(s), 'the engine, asked about every candidate, agrees').toEqual(want);
  });

  it('a fabricator and 7000 funds: exactly the ground units that cost 7000 or less, and nothing from a rival property', () => {
    // Income pays 1000 first (one fabricator): 6000 + 1000. Ground units at or under 7000 are trooper 1000, breacher 3000,
    // skimmer 4000, mule 5000, arc 6000, lancer 7000: six builds, plus endTurn. The enemy fabricator at (3,0) is not ours.
    const s = fixtureGame(['F..F'], [], { owners: ['0..1'], startFunds: 6000 });
    expect(s.players[0].funds).toBe(7000);
    const affordable = UNIT_LIST.filter((u) => u.domain === 'ground' && u.cost <= 7000).map((u) => u.id);
    expect(affordable).toHaveLength(6);
    const list = legalActions(s);
    expect(keys(list)).toEqual([...affordable.map((t) => `build:0,0:${t}`), 'endTurn'].sort());
    expect(list).toHaveLength(7);
    expect(acceptedKeys(s)).toEqual(keys(list));
  });

  it('a skyport and a dock build only their own domain: 11000 funds buys one wasp and no ship', () => {
    // 9000 + 2000 income = 11000. Air units: wasp 9000 (raptor 20000, anvil 22000 are too dear). Sea units: barge 12000,
    // picket 18000, dreadnought 28000 are all too dear. One build, plus endTurn.
    const s = fixtureGame(['A.D'], [], { owners: ['0.0'], startFunds: 9000 });
    expect(s.players[0].funds).toBe(11000);
    expect(keys(legalActions(s))).toEqual(['build:0,0:wasp', 'endTurn']);
    const rich = fixtureGame(['A.D'], [], { owners: ['0.0'], startFunds: 40000 });
    const sea = legalActions(rich).filter((a) => a.kind === 'build' && a.at.x === 2).map((a) => a.kind === 'build' ? a.unitType : '');
    expect(sea.sort()).toEqual(UNIT_LIST.filter((u) => u.domain === 'sea').map((u) => u.id).sort());
  });

  it('a unit standing on the fabricator blocks building there', () => {
    const s = fixtureGame(['F..'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }], { owners: ['0..'], startFunds: 5000 });
    expect(legalActions(s).some((a) => a.kind === 'build')).toBe(false);
    const moved = applyAction(s, { kind: 'move', unitId: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], then: { kind: 'wait' } }).state;
    expect(legalActions(moved).filter((a) => a.kind === 'build').length).toBeGreaterThan(0);
  });

  it('a mule carrying a trooper on an open 3x3: 34 actions (9 waits, 24 single drops, endTurn)', () => {
    // The mule (hover, move 6) reaches all 9 tiles. At each it can wait, and unload its one passenger onto any in-bounds
    // neighbouring tile (the tile it left is free): corners have 2 neighbours, edges 3, the centre 4, so
    // 4*2 + 4*3 + 1*4 = 24 drops. The passenger is not on the map, so it has no actions of its own; no ally is beside the mule, so no supply.
    let s = fixtureGame(['...', '...', '...'], [
      { type: 'mule', owner: 0, x: 1, y: 1 },
      { type: 'trooper', owner: 0, x: 0, y: 0 },
    ]);
    s = load(s, 1, [2]);
    const want: string[] = ['endTurn'];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        want.push(move(1, x, y, 'wait'));
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < 3 && ny < 3) want.push(move(1, x, y, `unload[0>${nx},${ny}]`));
        }
      }
    }
    expect(want).toHaveLength(34);
    expect(keys(legalActions(s))).toEqual(want.sort());
    expect(acceptedKeys(s)).toEqual(want);
  });

  it('a barge with two troopers on a shoal: 8 actions, including both ways to drop the pair', () => {
    // Barge on '.s.' can only stay on its shoal (flats are not water). There: wait; drop either trooper on either bank
    // (2 x 2 = 4 single drops); drop both, one per bank (2 ways, the banks must differ); endTurn. 1 + 4 + 2 + 1 = 8.
    let s = fixtureGame(['.s.'], [
      { type: 'barge', owner: 0, x: 1, y: 0 },
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 0, x: 2, y: 0 },
    ]);
    s = load(s, 1, [2, 3]);
    const want = [
      move(1, 1, 0, 'wait'),
      move(1, 1, 0, 'unload[0>0,0]'), move(1, 1, 0, 'unload[0>2,0]'),
      move(1, 1, 0, 'unload[1>0,0]'), move(1, 1, 0, 'unload[1>2,0]'),
      move(1, 1, 0, 'unload[0>0,0+1>2,0]'), move(1, 1, 0, 'unload[0>2,0+1>0,0]'),
      'endTurn',
    ].sort();
    expect(keys(legalActions(s))).toEqual(want);
    expect(acceptedKeys(s)).toEqual(want);
  });

  it('a barge at sea cannot unload anywhere but a shoal or a dock', () => {
    let s = fixtureGame(['.~.'], [
      { type: 'barge', owner: 0, x: 1, y: 0 },
      { type: 'trooper', owner: 0, x: 0, y: 0 },
    ]);
    s = load(s, 1, [2]);
    expect(keys(legalActions(s))).toEqual([move(1, 1, 0, 'wait'), 'endTurn'].sort());
    expect(acceptedKeys(s)).toEqual(keys(legalActions(s)));
  });

  it('join, load, wait and supply on a row: 12 actions', () => {
    // Row '....': trooper A (4 HP) at 0, trooper B (5 HP) at 1, mule M at 2. Moves are 3 for a trooper, 6 for a mule.
    //   A: stay (wait), join B, load into M, step past to 3 (wait)          = 4
    //   B: join A, stay (wait), load into M, step to 3 (wait)               = 4
    //   M: it cannot stop on A or B (not a transport/same type), so: stay and either supply (B is beside it) or wait = 2,
    //      go to 3 and wait (nobody beside it there)                        = 1
    //   endTurn = 1.   4 + 4 + 3 + 1 = 12.
    const s = fixtureGame(['....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0, hp: 4 },
      { type: 'trooper', owner: 0, x: 1, y: 0, hp: 5 },
      { type: 'mule', owner: 0, x: 2, y: 0 },
    ]);
    const want = [
      move(1, 0, 0, 'wait'), move(1, 1, 0, 'join'), move(1, 2, 0, 'load'), move(1, 3, 0, 'wait'),
      move(2, 0, 0, 'join'), move(2, 1, 0, 'wait'), move(2, 2, 0, 'load'), move(2, 3, 0, 'wait'),
      move(3, 2, 0, 'supply'), move(3, 2, 0, 'wait'), move(3, 3, 0, 'wait'),
      'endTurn',
    ].sort();
    expect(want).toHaveLength(12);
    expect(keys(legalActions(s))).toEqual(want);
    expect(acceptedKeys(s)).toEqual(want);
  });

  it('capture is offered on a rival or neutral property only, and only to a unit that can capture', () => {
    // Row '.C.' (move 3, all three tiles reachable): a trooper gets 3 waits and, on the city, a capture.
    const rival = fixtureGame(['.C.'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }], { owners: ['.1.'] });
    expect(keys(legalActions(rival))).toEqual([move(1, 0, 0, 'wait'), move(1, 1, 0, 'wait'), move(1, 1, 0, 'capture'), move(1, 2, 0, 'wait'), 'endTurn'].sort());
    const neutral = fixtureGame(['.C.'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }]);
    expect(keys(legalActions(neutral))).toContain(move(1, 1, 0, 'capture'));
    const own = fixtureGame(['.C.'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }], { owners: ['.0.'] });
    expect(keys(legalActions(own)).some((k) => k.endsWith(':capture'))).toBe(false);
    const lancer = fixtureGame(['.C.'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }], { owners: ['.1.'] });
    expect(keys(legalActions(lancer)).some((k) => k.endsWith(':capture'))).toBe(false);
    for (const s of [rival, neutral, own, lancer]) expect(acceptedKeys(s)).toEqual(keys(legalActions(s)));
  });

  it('a unit that has acted is not offered again, and the others still are', () => {
    const s = fixtureGame(['....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 0, x: 3, y: 0 },
    ]);
    const before = legalActions(s);
    expect(before.filter((a) => a.kind === 'move' && a.unitId === 1).length).toBeGreaterThan(0);
    const after = applyAction(s, { kind: 'move', unitId: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], then: { kind: 'wait' } }).state;
    const list = legalActions(after);
    expect(list.some((a) => a.kind === 'move' && a.unitId === 1)).toBe(false);
    expect(list.some((a) => a.kind === 'move' && a.unitId === 2)).toBe(true);
    const done = applyAction(after, { kind: 'move', unitId: 2, path: [{ x: 3, y: 0 }], then: { kind: 'wait' } }).state;
    expect(legalActions(done)).toEqual([{ kind: 'endTurn' }]);
  });

  it('never lists the other player\'s units, and switches sides when the turn passes', () => {
    const s = fixtureGame(['....'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }]);
    expect(legalActions(s).every((a) => a.kind !== 'move' || a.unitId === 1)).toBe(true);
    const next = applyAction(s, { kind: 'endTurn' }).state;
    expect(legalActions(next).every((a) => a.kind !== 'move' || a.unitId === 2)).toBe(true);
    expect(legalActions(next).some((a) => a.kind === 'move')).toBe(true);
  });

  describe('powers', () => {
    const rook = COMMANDERS.rook;
    const setup = (): CreateGameOptions => ({
      map: fixtureMap(['..'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }]),
      players: [
        { faction: 'helion', commander: 'rook', controller: 'ai', team: 0 },
        { faction: 'tidewell', commander: 'sefa', controller: 'ai', team: 1 },
      ] satisfies PlayerSetup[],
      seed: 1,
    });
    const powers = (s: GameState) => legalActions(s).filter((a) => a.kind === 'power').map((a) => (a.kind === 'power' ? a.level : ''));
    const surge = rook.surge!.stars * POWER_STAR;
    const overclock = rook.overclock!.stars * POWER_STAR;

    it('offers Surge at its price and Overclock at its own, and neither a point short', () => {
      expect(surge).toBeLessThan(overclock);
      const s = createGame(setup());
      expect(powers(withPower(s, 0, 0))).toEqual([]);
      expect(powers(withPower(s, 0, surge - 1))).toEqual([]);
      expect(powers(withPower(s, 0, surge))).toEqual(['surge']);
      expect(powers(withPower(s, 0, overclock - 1))).toEqual(['surge']);
      expect(powers(withPower(s, 0, overclock))).toEqual(['surge', 'overclock']);
    });
    it('offers no power once one is active this turn, and none to a commander without powers', () => {
      const s = withPower(createGame(setup()), 0, overclock);
      const used = applyAction(s, { kind: 'power', level: 'surge' }).state;
      expect(powers(used)).toEqual([]);
      const none = withPower(fixtureGame(['..'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }]), 0, 10_000_000);
      expect(powers(none)).toEqual([]);
      expect(isLegal(none, { kind: 'power', level: 'surge' })).toBe(false);
    });
  });

  it('game over lists nothing; resign appears only when asked for', () => {
    const s = fixtureGame(['..'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }]);
    expect(legalActions(s).some((a) => a.kind === 'resign')).toBe(false);
    const asked = legalActions(s, { includeResign: true });
    expect(asked[asked.length - 1]).toEqual({ kind: 'resign' });
    expect(asked.slice(0, -1)).toEqual(legalActions(s));
    expect(isLegal(s, { kind: 'resign' })).toBe(true);
    const over = applyAction(s, { kind: 'resign' }).state;
    expect(over.winnerTeam).toBe(1);
    expect(legalActions(over)).toEqual([]);
    expect(legalActions(over, { includeResign: true })).toEqual([]);
  });

  it('fog: a path through a hidden enemy is listed (the player cannot know), and ends in an ambush when played', () => {
    // Row '..f...': our trooper sees two tiles but a trooper on canopy two tiles away is hidden. Moving past it is legal; the engine stops the mover beside it.
    const s = fixtureGame(['..f...'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 1, x: 2, y: 0 },
    ], { fog: true });
    const list = legalActions(s);
    // (0,0) wait. (1,0) wait, and attack (a unit beside the hidden trooper sees it). (3,0): reached only by walking through
    // the hidden trooper, so it ends in an ambush; the engine still takes the order, and from (3,0) the hidden trooper is
    // beside the destination, so the engine's own thenOptions offers wait and attack there too. The hidden tile itself
    // has no then-options, so it is not a stopping place. endTurn.
    expect(keys(list)).toEqual([
      move(1, 0, 0, 'wait'), move(1, 1, 0, 'wait'), move(1, 1, 0, 'attack@2,0'), move(1, 3, 0, 'wait'), move(1, 3, 0, 'attack@2,0'), 'endTurn',
    ].sort());
    const through = list.find((a) => a.kind === 'move' && a.then.kind === 'wait' && a.path.length === 4)!;
    const r = applyAction(s, through);
    expect(r.events.some((e) => e.kind === 'ambushed')).toBe(true);
    expect(r.state.units.find((u) => u.id === 1)).toMatchObject({ x: 1, y: 0, acted: true });
  });

  it('is deterministic and leaves its input alone', () => {
    const s = fixtureGame(['....', '....'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 1 }]);
    const snapshot = structuredClone(s);
    expect(legalActions(s)).toEqual(legalActions(s));
    expect(s).toEqual(snapshot);
  });

  it('unitActions and destinationActions are the same list cut finer, and empty for a unit that cannot act', () => {
    const s = fixtureGame(['....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0, hp: 4 },
      { type: 'trooper', owner: 0, x: 1, y: 0, hp: 5 },
      { type: 'trooper', owner: 1, x: 3, y: 0 },
    ]);
    const a = s.units[0];
    const whole = unitActions(s, a);
    const parts = [...reachable(s, a.id).values()].flatMap((e) => destinationActions(s, a, e));
    expect(whole.length).toBeGreaterThan(0);
    expect(keys(parts)).toEqual(keys(whole));
    expect(keys(legalActions(s).filter((x) => x.kind === 'move' && x.unitId === a.id))).toEqual(keys(whole));
    const spent = patchUnit(s, 1, { acted: true });
    expect(unitActions(spent, spent.units[0]), 'acted').toEqual([]);
    expect(unitActions(s, s.units[2]), 'the other side').toEqual([]);
  });
});

// ---------------------------------------------------------------- the checkers are not vacuous

describe('the soundness and completeness checkers', () => {
  const s = fixtureGame(['...', '...', '...'], [
    { type: 'trooper', owner: 0, x: 0, y: 0 },
    { type: 'trooper', owner: 1, x: 2, y: 2 },
  ]);
  const list = legalActions(s);

  it('accept the real list', () => {
    expect(unsound(s, list)).toEqual([]);
    expect(missing(s, list, universe(s))).toEqual([]);
  });
  it('catch an action the engine refuses', () => {
    const tooFar: Action = { kind: 'move', unitId: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }], then: { kind: 'wait' } };
    const wrongSide: Action = { kind: 'move', unitId: 2, path: [{ x: 2, y: 2 }], then: { kind: 'wait' } };
    expect(unsound(s, [...list, tooFar]).length).toBeGreaterThan(0);
    expect(unsound(s, [...list, wrongSide]).length).toBeGreaterThan(0);
    expect(unsound(s, [...list, { kind: 'build', at: { x: 0, y: 0 }, unitType: 'trooper' }]).length).toBeGreaterThan(0);
  });
  it('catch an action the engine accepts but the list lacks', () => {
    for (let i = 0; i < list.length; i++) {
      const thinner = list.filter((_, n) => n !== i);
      expect(missing(s, thinner, universe(s)), `dropping ${actionKey(list[i])}`).toEqual([actionKey(list[i])]);
    }
  });
  it('catch an acted unit being offered', () => {
    const acted = applyAction(s, { kind: 'move', unitId: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], then: { kind: 'wait' } }).state;
    expect(unsound(acted, list).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- (a) and (b) on mid-game states

// The same kind of battlefield sim.test.ts plays on: spires, fabricators, a skyport, docks, roads, canopy, ridges and a
// lake with a ford, both armies, 15 x 9.
const LEFT = ['.f..^.', '.F.=.C', '.H.=ff', '.A.=.D', '.F.==.', '...=.f', '.f.=^.', '.C..f.', '.f..^.'];
const CENTRE = ['...', '.C.', '.f.', '~~~', 'sss', '~~~', '.f.', '.C.', '...'];
const reverse = (x: string) => [...x].reverse().join('');
function battlefield(): MapDef {
  const terrain = LEFT.map((l, y) => l + CENTRE[y] + reverse(l));
  const owners = LEFT.map((l) => [...l].map((c) => (/[FHACDU]/.test(c) ? '0' : '.')).join('') + '...' + [...reverse(l)].map((c) => (/[FHACDU]/.test(c) ? '1' : '.')).join(''));
  const half: FixtureUnit[] = [
    { type: 'trooper', owner: 0, x: 2, y: 1 }, { type: 'trooper', owner: 0, x: 2, y: 3 }, { type: 'breacher', owner: 0, x: 2, y: 4 },
    { type: 'lancer', owner: 0, x: 3, y: 2 }, { type: 'arc', owner: 0, x: 2, y: 2 }, { type: 'mule', owner: 0, x: 2, y: 5 }, { type: 'wasp', owner: 0, x: 0, y: 3 },
  ];
  return fixtureMap(terrain, [...half, ...half.map((u) => ({ ...u, owner: 1, x: 14 - u.x }))], owners, 'battlefield');
}

/** Mid-game states from real play: three spread through each game, plus two just after the first fights (so there are fights to list). */
function sampleStates(): { label: string; state: GameState }[] {
  const out: { label: string; state: GameState }[] = [];
  const rhythm = [31, 83, 140];
  for (const fog of [false, true]) {
    for (const policy of ['random', 'greedy'] as SimPolicy[]) {
      for (const seed of [1, 2]) {
        const setup: CreateGameOptions = {
          map: battlefield(), fog, seed: 77 + seed, startFunds: 9000,
          players: [
            { faction: 'helion', commander: seed === 1 ? 'rook' : 'ilse', controller: 'ai', team: 0 },
            { faction: 'tidewell', commander: seed === 1 ? 'sefa' : 'dax', controller: 'ai', team: 1 },
          ],
        };
        const name = `${fog ? 'fog' : 'clear'}/${policy}/seed ${seed}`;
        let fights = 0;
        let lastFight = -100;
        simulate({
          setup, seed, maxCycles: 12, policy,
          onStep: (st) => {
            if (rhythm.includes(st.index)) out.push({ label: `${name}/after action ${st.index}`, state: st.after });
            if (fights < 2 && st.index - lastFight >= 12 && st.events.some((e) => e.kind === 'attacked')) {
              fights++;
              lastFight = st.index;
              out.push({ label: `${name}/fight, after action ${st.index}`, state: st.after });
            }
          },
        });
      }
    }
  }
  return out;
}

function lcg(seed: number): () => number {
  let x = (Math.imul(seed, 2654435761) + 12345) >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** Random candidates around the current player's units: some from the engine's then-options, some pure guesses. */
function candidatesFor(state: GameState, rand: () => number, count: number): Action[] {
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
  const mine = state.units.filter((u) => u.owner === state.current);
  const foes = state.units.filter((u) => u.owner !== state.current);
  const reachCache = new Map<number, ReturnType<typeof reachable>>();
  const out: Action[] = [];
  const production = allTiles(state).filter((c) => TERRAIN_TYPES[state.tiles[c.y][c.x].terrain].builds);
  const properties = allTiles(state).filter((c) => TERRAIN_TYPES[state.tiles[c.y][c.x].terrain].property);
  for (let i = 0; i < count; i++) {
    if (rand() < 0.12) {
      const type = pick(UNIT_LIST).id as UnitTypeId;
      const at = production.length && rand() < 0.8 ? pick(production) : { x: Math.floor(rand() * state.width), y: Math.floor(rand() * state.height) };
      out.push({ kind: 'build', at: { x: at.x, y: at.y }, unitType: type });
      continue;
    }
    if (!mine.length) break;
    if (rand() < 0.1) {
      // a capture attempt: a unit that can capture, a tile it can reach that is a rival or neutral property
      const takers = mine.filter((m) => UNIT_TYPES[m.type].captures);
      if (takers.length) {
        const t = pick(takers);
        let r = reachCache.get(t.id);
        if (!r) reachCache.set(t.id, (r = reachable(state, t.id)));
        const sites = [...r.values()].filter((e) => {
          const tile = state.tiles[e.y][e.x];
          return TERRAIN_TYPES[tile.terrain].property && tile.owner !== state.current;
        });
        if (sites.length) {
          out.push({ kind: 'move', unitId: t.id, path: pick(sites).path, then: { kind: 'capture' } });
          continue;
        }
      }
    }
    const u = pick(mine);
    const box = UNIT_TYPES[u.type].move + 2;
    const near = properties.filter((c) => Math.abs(c.x - u.x) <= box && Math.abs(c.y - u.y) <= box);
    const site = near.length && rand() < 0.3 ? pick(near) : null;
    const dest = site
      ? { x: site.x, y: site.y }
      : {
        x: Math.max(0, Math.min(state.width - 1, u.x + Math.floor(rand() * (2 * box + 1)) - box)),
        y: Math.max(0, Math.min(state.height - 1, u.y + Math.floor(rand() * (2 * box + 1)) - box)),
      };
    let reach = reachCache.get(u.id);
    if (!reach) reachCache.set(u.id, (reach = reachable(state, u.id)));
    const entry = reach.get(key(dest.x, dest.y));
    const path = entry ? entry.path : lPath(u, dest);
    const options = entry ? thenOptions(state, u.id, dest) : [];
    const kind = options.length && rand() < 0.6 ? pick(options) : pick(['wait', 'attack', 'capture', 'load', 'join', 'supply', 'unload'] as const);
    let then: Then;
    if (kind === 'attack') {
      const inReach = entry ? attackTargets(state, u.id, dest) : [];
      const t = inReach.length && rand() < 0.7 ? pick(inReach) : foes.length && rand() < 0.9 ? pick(foes) : dest;
      then = { kind, target: { x: t.x, y: t.y } };
    } else if (kind === 'unload') {
      const near = (): Coord => pick([{ x: dest.x + 1, y: dest.y }, { x: dest.x - 1, y: dest.y }, { x: dest.x, y: dest.y + 1 }, { x: dest.x, y: dest.y - 1 }]);
      const drops = [{ cargoIndex: Math.floor(rand() * 2), to: near() }];
      if (rand() < 0.4) drops.push({ cargoIndex: 1 - drops[0].cargoIndex, to: near() });
      then = { kind, drops };
    } else then = { kind };
    out.push({ kind: 'move', unitId: u.id, path, then });
  }
  return out;
}

describe('legalActions on states reached by real play', () => {
  // Played lazily, once, inside the first test that needs it: a fault in the engine or the enumerator fails that test, not the whole file.
  let sampled: { label: string; state: GameState }[] | null = null;
  const getStates = () => (sampled ??= sampleStates());

  it('has states to test: both fog settings, both policies, several per game', () => {
    const states = getStates();
    expect(states.length).toBeGreaterThanOrEqual(20);
    expect(states.some((s) => s.state.fog)).toBe(true);
    expect(states.some((s) => !s.state.fog)).toBe(true);
    expect(new Set(states.map((s) => s.state.current)).size, 'both sides to move').toBe(2);
  });

  it('(a) every listed action passes isLegal and applies without throwing; none is listed twice', () => {
    const states = getStates();
    let total = 0;
    for (const { label, state } of states) {
      const list = legalActions(state);
      total += list.length;
      expect(unsound(state, list), label).toEqual([]);
      expect(new Set(list.map(actionKey)).size, `${label}: duplicates`).toBe(list.length);
      expect(list[list.length - 1], label).toEqual({ kind: 'endTurn' });
      expect(list.every((a) => a.kind !== 'move' || state.units.find((u) => u.id === a.unitId)?.owner === state.current), label).toBe(true);
    }
    console.log(`legal: ${states.length} mid-game states, ${total} listed actions checked`);
    expect(total, 'lists of real size were checked').toBeGreaterThan(2500);
  });

  it('(b) every random candidate the engine accepts is in the list', () => {
    const states = getStates();
    const rand = lcg(2024);
    const accepted = { wait: 0, attack: 0, capture: 0, build: 0, other: 0 };
    let tried = 0;
    for (const { label, state } of states) {
      const list = legalActions(state);
      const candidates = candidatesFor(state, rand, 400);
      tried += candidates.length;
      expect(missing(state, list, candidates), label).toEqual([]);
      for (const c of candidates) {
        if (!isLegal(state, c) || ambushed(state, c)) continue;
        if (c.kind === 'build') accepted.build++;
        else if (c.kind === 'move' && (c.then.kind === 'wait' || c.then.kind === 'attack' || c.then.kind === 'capture')) accepted[c.then.kind]++;
        else accepted.other++;
      }
    }
    console.log(`legal fuzz: ${tried} candidates, accepted by the engine: ${JSON.stringify(accepted)}`);
    expect(tried).toBeGreaterThan(4000);
    // The candidates must include real choices, or "nothing missing" is a statement about nothing.
    expect(accepted.wait, 'accepted waits').toBeGreaterThan(300);
    expect(accepted.attack, 'accepted attacks').toBeGreaterThan(8);
    expect(accepted.capture, 'accepted captures').toBeGreaterThan(0);
    expect(accepted.build, 'accepted builds').toBeGreaterThan(15);
  });

  it('(b) the same check, exhaustively, on small maps with transports and fog: the two sets are equal', () => {
    const positions: GameState[] = [
      fixtureGame(['.....', '..f..', '.....'], [
        { type: 'mule', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 0, x: 1, y: 1, hp: 6 }, { type: 'trooper', owner: 0, x: 0, y: 0, hp: 3 },
        { type: 'lancer', owner: 1, x: 4, y: 1 }, { type: 'arc', owner: 1, x: 4, y: 2 },
      ], { fog: true }),
      fixtureGame(['.C.s.', '..~~.', '.D.s.'], [
        { type: 'barge', owner: 0, x: 3, y: 0 }, { type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'breacher', owner: 0, x: 2, y: 0 },
        { type: 'trooper', owner: 1, x: 4, y: 2 },
      ], { owners: ['.1...', '.....', '.0...'] }),
      load(fixtureGame(['.s.s.', '.....'], [
        { type: 'barge', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'breacher', owner: 0, x: 4, y: 1 }, { type: 'lancer', owner: 1, x: 3, y: 1 },
      ]), 1, [2, 3]),
    ];
    let universeSize = 0;
    for (const [i, s] of positions.entries()) {
      universeSize += universe(s).length;
      const list = legalActions(s);
      expect(unsound(s, list), `position ${i}`).toEqual([]);
      expect(keys(list.filter((a) => !ambushed(s, a))), `position ${i}`).toEqual(acceptedKeys(s));
    }
    expect(universeSize, 'the universe was big').toBeGreaterThan(1500);
  });
});
