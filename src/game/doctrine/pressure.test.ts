// Doctrine closes out won games (M3.2). Two causes switch it into "pressure": its side's visible army value is at least AHEAD_RATIO times
// the strongest single enemy's, or its units are within CAP_MARGIN of the 50-unit cap. In pressure it plays the Advance posture whatever
// the orders say, sends a capturer for the enemy spire even while a unit stands on it, prefers attacks that clear that tile, and stops
// building once it fields PRESSURE_BUILD_LIMIT units. Not ahead and not at the cap, the standing orders decide exactly as before.
// Expected answers come from unit costs in the data and the rules, never from the brain. Each behaviour has a known-bad twin: the same
// board with the one thing that causes it taken away, where the behaviour must not appear.
import { describe, expect, it } from 'vitest';
import { UNIT_TYPES } from '../../data';
import { MAX_UNITS_PER_PLAYER, applyAction, attackRangeTiles, createGame, forecast } from '../aw';
import type { PlayerSetup } from '../aw';
import { agentActions, observe, observedState } from '../aw/observe';
import { fixtureGame, fixtureMap } from '../aw/testing';
import type { FixtureUnit } from '../aw/testing';
import type { Action, Coord, GameState, UnitTypeId } from '../aw/types';
import { AHEAD_MIN_VALUE, AHEAD_RATIO, CAP_MARGIN, PRESSURE_BUILD_LIMIT, buildCtx, pressureOf } from './eval';
import { DEFAULT_ORDERS, decide, validateOrders } from './index';
import type { StandingOrders } from './index';

// ---------------------------------------------------------------- helpers

const at = (x: number, y: number): Coord => ({ x, y });
const manhattan = (a: Coord, b: Coord) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const unit = (type: UnitTypeId, owner: number, x: number, y: number, hp?: number): FixtureUnit => ({ type, owner, x, y, ...(hp ? { hp } : {}) });
const grid = (w: number, h: number, fill = '.') => Array.from({ length: h }, () => fill.repeat(w));
const orders = (o: object = {}): StandingOrders => validateOrders(o);

/** `n` units of one type in the next free tiles of a block, row by row from (x0, y0), `perRow` to a row. */
function block(type: UnitTypeId, owner: number, n: number, x0: number, y0: number, perRow: number): FixtureUnit[] {
  return Array.from({ length: n }, (_, i) => unit(type, owner, x0 + (i % perRow), y0 + Math.floor(i / perRow)));
}

const pressureFor = (s: GameState, player = 0) =>
  pressureOf(buildCtx(observedState(s, player), observe(s, player), player, DEFAULT_ORDERS as StandingOrders));

const value = (type: UnitTypeId, n = 1) => UNIT_TYPES[type].cost * n; // full-HP direct units: cost x 10/10

/** The state with every unit but `ids` already acted, so the brain can only move those. */
const onlyThese = (s: GameState, ids: number[]): GameState => ({ ...s, units: s.units.map((u) => (ids.includes(u.id) ? u : { ...u, acted: true })) });

/** Lets `player` act until the turn passes on. */
function playTurn(state: GameState, player: number, o: StandingOrders, cap = 400): { state: GameState; taken: Action[] } {
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

// ---------------------------------------------------------------- when pressure is on

describe('pressureOf: ahead means a clear margin over the strongest single enemy', () => {
  const flat = (mine: FixtureUnit[], foe: FixtureUnit[]) => fixtureGame(grid(24, 6), [...mine, ...foe]);

  it('the constants say what the test assumes', () => {
    expect(AHEAD_RATIO).toBeGreaterThan(1);
    expect(UNIT_TYPES.trooper.cost).toBe(1000);
    expect(value('trooper', 8)).toBeGreaterThanOrEqual(AHEAD_MIN_VALUE);
  });

  it('exactly at the margin it is on, and one unit short of it it is off', () => {
    // 8 troopers (8000) against 5 (5000) is 1.6; 7 against 5 is 1.4
    const edge = AHEAD_RATIO * value('trooper', 5);
    expect(value('trooper', 8)).toBeGreaterThanOrEqual(edge);
    expect(value('trooper', 7)).toBeLessThan(edge);
    const on = pressureFor(flat(block('trooper', 0, 8, 0, 0, 4), block('trooper', 1, 5, 20, 0, 4)));
    expect(on).toMatchObject({ on: true, reason: 'ahead' });
    expect(on.ratio).toBeCloseTo(1.6, 10);
    const off = pressureFor(flat(block('trooper', 0, 7, 0, 0, 4), block('trooper', 1, 5, 20, 0, 4)));
    expect(off).toMatchObject({ on: false, reason: null });
    expect(off.ratio).toBeCloseTo(1.4, 10);
  });

  it('is measured against hit points, not unit counts: five full-HP troopers are not outweighed by eight at a quarter HP', () => {
    const quarter = Array.from({ length: 8 }, (_, i) => unit('trooper', 0, i % 4, Math.floor(i / 4), 3));
    expect(pressureFor(flat(quarter, block('trooper', 1, 5, 20, 0, 4)))).toMatchObject({ on: false });
  });

  it('what is compared is the STRONGEST single enemy, not all of them together', () => {
    const three = (second: number): GameState => createGame({
      map: fixtureMap(grid(24, 6), [...block('trooper', 0, 8, 0, 0, 4), ...block('trooper', 1, 5, 20, 0, 4), ...block('trooper', 2, second, 12, 3, 4)]),
      players: [0, 1, 2].map((i): PlayerSetup => ({ faction: 'helion', commander: 'none', controller: 'ai', team: i })),
      seed: 1,
    });
    expect(pressureFor(three(5)), '8 against 5 and 5: ahead of each of them, behind their sum').toMatchObject({ on: true, reason: 'ahead' });
    expect(pressureFor(three(6)), 'a sixth trooper makes the strongest enemy 6, and 8 against 6 is not the margin').toMatchObject({ on: false });
  });

  it('a teammate\'s army counts as mine', () => {
    const team = (withAlly: boolean): GameState => createGame({
      map: fixtureMap(grid(24, 6), [...block('trooper', 0, 4, 0, 0, 4), ...(withAlly ? block('trooper', 1, 4, 0, 3, 4) : []), ...block('trooper', 2, 5, 20, 0, 4)]),
      players: [
        { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
        { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
        { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
      ],
      seed: 1,
    });
    expect(pressureFor(team(true))).toMatchObject({ on: true, reason: 'ahead' });
    expect(pressureFor(team(false)), 'known-bad twin: without the ally 4 against 5 is behind').toMatchObject({ on: false });
  });

  it('a lead over next to nothing is not a lead: one trooper against a trooper at 1 HP is off, because my army is under AHEAD_MIN_VALUE', () => {
    expect(value('trooper', 1)).toBeLessThan(AHEAD_MIN_VALUE);
    const s = flat([unit('trooper', 0, 0, 0)], [unit('trooper', 1, 20, 0, 1)]);
    const p = pressureFor(s);
    expect(p.ratio, 'the ratio alone is far above the margin').toBeGreaterThan(AHEAD_RATIO);
    expect(p.on).toBe(false);
  });

  it('under fog nobody is "ahead": what is seen is a floor under what the enemy has, so the ratio is reported but never switches pressure on', () => {
    const fogged = (foe: FixtureUnit[], mine = 8) => fixtureGame(grid(24, 6), [...block('trooper', 0, mine, 0, 0, 4), ...foe], { fog: true });
    expect(pressureFor(fogged([unit('trooper', 1, 23, 5)]))).toMatchObject({ on: false, ratio: 0 });
    // three of five enemy troopers in a column beside ours are in view (vision 2); the other two are not
    const seen = pressureFor(fogged(block('trooper', 1, 5, 4, 0, 1)));
    expect(seen.ratio, 'the visible ratio is far above the margin').toBeCloseTo(8 / 3, 10);
    expect(seen).toMatchObject({ on: false, reason: null });
    // known-bad twin: the same two armies with the fog down are ahead
    const clear = pressureFor(fixtureGame(grid(24, 6), [...block('trooper', 0, 8, 0, 0, 4), ...block('trooper', 1, 5, 4, 0, 1)]));
    expect(clear).toMatchObject({ on: true, reason: 'ahead' });
    expect(clear.ratio).toBeCloseTo(8 / 5, 10);
  });

  it('an ion storm raises fog too: the same armies, no fog game, a storm raging, are not "ahead"', () => {
    const storm = fixtureGame(grid(24, 6), [...block('trooper', 0, 8, 0, 0, 4), ...block('trooper', 1, 5, 4, 0, 1)], { weather: 'ionstorm' });
    expect(pressureFor(storm).on).toBe(false);
  });

  it('the cap does not care about fog: a full army presses in the dark too', () => {
    const dark = fixtureGame(grid(20, 14), [...block('trooper', 0, MAX_UNITS_PER_PLAYER - CAP_MARGIN, 0, 0, 20), unit('trooper', 1, 19, 13)], { fog: true });
    expect(pressureFor(dark)).toMatchObject({ on: true, reason: 'cap' });
  });
});

describe('pressureOf: at the cap means within CAP_MARGIN of it, whoever is ahead', () => {
  const cap = MAX_UNITS_PER_PLAYER;
  const full = (n: number): GameState => fixtureGame(grid(20, 14), [...block('trooper', 0, n, 0, 0, 20), ...block('trooper', 1, n, 0, 8, 20)]);

  it('the constants say what the test assumes', () => {
    expect(cap).toBe(50);
    expect(CAP_MARGIN).toBeGreaterThanOrEqual(0);
    expect(PRESSURE_BUILD_LIMIT).toBeLessThan(cap - CAP_MARGIN);
  });

  it('even armies: on at cap - CAP_MARGIN, off one unit below it', () => {
    const on = pressureFor(full(cap - CAP_MARGIN));
    expect(on).toMatchObject({ on: true, reason: 'cap', units: cap - CAP_MARGIN });
    expect(on.ratio, 'nobody is ahead: the cap is the reason').toBeCloseTo(1, 10);
    const off = pressureFor(full(cap - CAP_MARGIN - 1));
    expect(off).toMatchObject({ on: false, reason: null, units: cap - CAP_MARGIN - 1 });
  });

  it('cargo counts toward the cap, as it does for the build rule', () => {
    const base = full(cap - CAP_MARGIN - 2);
    const mule = base.units.find((u) => u.owner === 0)!;
    const loaded: GameState = {
      ...base,
      units: base.units.map((u) => (u.id === mule.id
        ? { ...u, type: 'mule' as const, cargo: [{ ...u, id: 9001, cargo: [] }, { ...u, id: 9002, cargo: [] }] }
        : u)),
    };
    expect(pressureFor(loaded)).toMatchObject({ units: cap - CAP_MARGIN, on: true, reason: 'cap' });
  });
});

// ---------------------------------------------------------------- what it does

/** A tall strip: my spire at the left end of the top row, the enemy's at the right; an enemy trooper stands on it. A neutral city sits behind
 *  the capturer, the easier prize. The far corner (row 13) holds whatever army decides who is ahead; it is out of everybody's reach, so it
 *  changes the count and nothing else. */
const terrain = ['H...C..........H', ...grid(16, 13)];
const owners = ['0..............1', ...grid(16, 13)];
const ENEMY_SPIRE = at(15, 0);
const corner = (type: UnitTypeId, owner: number, n: number) => block(type, owner, n, 0, 13, 6);

describe('pressure sends a capturer for the guarded enemy spire; without pressure it does not', () => {
  // The capturer (id 1) starts mid-board. Only it can act: every other unit is already acted, so the answer is its alone.
  const capturerX = 8;
  const board = (cornerOwner: number | null, n = 6): GameState =>
    onlyThese(
      fixtureGame(terrain, [
        unit('trooper', 0, capturerX, 0), unit('trooper', 1, ENEMY_SPIRE.x, ENEMY_SPIRE.y), ...(cornerOwner === null ? [] : corner('lancer', cornerOwner, n)),
      ], { owners }),
      [1],
    );
  const after = (s: GameState, o: StandingOrders) => playTurn(s, 0, o).state.units.find((u) => u.id === 1)!;
  const before = manhattan(at(capturerX, 0), ENEMY_SPIRE);

  it('the setup: the spire is guarded, the capturer is mid-board, and only the first board has me ahead', () => {
    const ahead = board(0);
    expect(ahead.units.find((u) => u.x === ENEMY_SPIRE.x && u.y === ENEMY_SPIRE.y)).toMatchObject({ owner: 1, type: 'trooper' });
    expect(pressureFor(ahead)).toMatchObject({ on: true, reason: 'ahead' });
    expect(pressureFor(board(1))).toMatchObject({ on: false });
    expect(pressureFor(board(null))).toMatchObject({ on: false });
    expect(agentActions(ahead, 0).filter((a) => a.kind === 'move' && a.unitId === 1).length, 'the capturer has moves').toBeGreaterThan(0);
  });

  it('ahead: the capturer moves toward the enemy spire, in every posture (pressure overrides the orders)', () => {
    for (const posture of ['holdTheLine', 'fallBack', 'advance'] as const) {
      expect(manhattan(after(board(0), orders({ posture })), ENEMY_SPIRE), posture).toBeLessThan(before);
    }
  });

  it('known-bad twin: behind (the army in the corner is theirs), the same capturer on the same tile does not go toward the spire', () => {
    for (const posture of ['holdTheLine', 'fallBack'] as const) {
      expect(manhattan(after(board(1), orders({ posture })), ENEMY_SPIRE), posture).toBeGreaterThanOrEqual(before);
    }
  });

  it('the neutral city behind it is the easier prize, and it goes for the guarded spire anyway: it was not a tie', () => {
    const behind = after(board(1), orders({ posture: 'holdTheLine' }));
    expect(manhattan(behind, at(4, 0)), 'not ahead: it heads for the city').toBeLessThan(manhattan(at(capturerX, 0), at(4, 0)));
    const ahead = after(board(0), orders({ posture: 'holdTheLine' }));
    expect(manhattan(ahead, at(4, 0)), 'ahead: it leaves the city for the spire').toBeGreaterThan(manhattan(at(capturerX, 0), at(4, 0)));
  });

  it('with escorts: it does not step onto a tile the guard can strike unless an armed unit of mine is within two tiles of it', () => {
    const lone = board(0);
    const guard = lone.units.find((u) => u.id === 2)!;
    const struck = new Set(attackRangeTiles({ ...lone, units: [guard] }, guard.id).map((c) => `${c.x},${c.y}`));
    const furthest = at(capturerX + 3, 0); // its full move along the top row
    expect(struck.has(`${furthest.x},${furthest.y}`), 'the premise: the guard can strike the far end of its move').toBe(true);
    expect(struck.has(`${furthest.x - 1},${furthest.y}`), 'and not the tile before it').toBe(false);
    const landing = (s: GameState) => after(s, orders({ posture: 'holdTheLine' }));
    expect(struck.has(`${landing(lone).x},${landing(lone).y}`), 'alone, it stops short of the guard\'s reach').toBe(false);
    expect(landing(lone).x, 'but it has advanced').toBeGreaterThan(capturerX);
    // the same board with an armed unit of mine (already acted, so it stays) two tiles from the far end
    const escorted: GameState = { ...lone, units: [...lone.units, { ...lone.units.find((u) => u.id === 1)!, id: 900, type: 'lancer', x: furthest.x - 1, y: 1, hp: 100, acted: true }] };
    expect(landing(escorted).x, 'with the escort it goes on to the far end').toBe(furthest.x);
    // another capturer is no escort: it cannot fight a guard off
    const mate: GameState = { ...escorted, units: escorted.units.map((u) => (u.id === 900 ? { ...u, type: 'trooper' as const } : u)) };
    expect(landing(mate).x).toBeLessThan(furthest.x);
    // a wounded escort does not count (40 internal HP is the floor)
    const weak: GameState = { ...escorted, units: escorted.units.map((u) => (u.id === 900 ? { ...u, hp: 30 } : u)) };
    expect(landing(weak).x).toBeLessThan(furthest.x);
  });

  it('known-bad twin: even armies (one lancer each in the corner), a guarded spire, Hold the Line: it does not go either', () => {
    const even = onlyThese(
      fixtureGame(terrain, [unit('trooper', 0, capturerX, 0), unit('trooper', 1, ENEMY_SPIRE.x, ENEMY_SPIRE.y), ...corner('lancer', 0, 1), ...corner('lancer', 1, 1).map((u) => ({ ...u, x: u.x + 3 }))], { owners }),
      [1],
    );
    expect(pressureFor(even).on).toBe(false);
    expect(manhattan(after(even, orders({ posture: 'holdTheLine' })), ENEMY_SPIRE)).toBeGreaterThanOrEqual(before);
  });
});

describe('pressure overrides the standing posture: a unit ordered to Fall Back leaves home when its side is far ahead', () => {
  // A lancer six tiles out from my spire, fifteen from theirs. Fall Back keeps units within three tiles of home; ahead, Doctrine presses.
  const board = (cornerOwner: number): GameState => onlyThese(
    fixtureGame(terrain, [unit('lancer', 0, 6, 0), unit('trooper', 1, ENEMY_SPIRE.x, ENEMY_SPIRE.y), ...corner('lancer', cornerOwner, 6)], { owners }),
    [1],
  );
  const x = (s: GameState) => playTurn(s, 0, orders({ posture: 'fallBack' })).state.units.find((u) => u.id === 1)!.x;

  it('ahead, Fall Back goes forward; behind, the same order brings it back toward home', () => {
    expect(pressureFor(board(0)).on).toBe(true);
    expect(pressureFor(board(1)).on).toBe(false);
    expect(x(board(0)), 'ahead').toBeGreaterThan(6);
    expect(x(board(1)), 'behind').toBeLessThan(6);
  });
});

describe('pressure keeps its own fighters off the enemy spire, which its capturers need', () => {
  // The enemy spire is empty; a lancer of mine stands three tiles from it and could end its move ON it, and a trooper is on the way.
  const board = (cornerOwner: number): GameState => onlyThese(
    fixtureGame(terrain, [unit('lancer', 0, 12, 0), unit('trooper', 0, 8, 1), ...corner('lancer', cornerOwner, 6)], { owners }),
    [1],
  );
  const lancerAfter = (s: GameState, posture: 'holdTheLine' | 'advance') => playTurn(s, 0, orders({ posture })).state.units.find((u) => u.id === 1)!;

  it('the setup: the spire is empty and the lancer can reach it', () => {
    const s = board(0);
    expect(s.units.some((u) => u.x === ENEMY_SPIRE.x && u.y === ENEMY_SPIRE.y)).toBe(false);
    const reach = agentActions(s, 0).filter((a) => a.kind === 'move' && a.unitId === 1).map((a) => (a.kind === 'move' ? a.path[a.path.length - 1] : at(-1, -1)));
    expect(reach.some((c) => c.x === ENEMY_SPIRE.x && c.y === ENEMY_SPIRE.y)).toBe(true);
    expect(pressureFor(s).on).toBe(true);
  });

  it('ahead, the lancer closes to the tile beside the spire and does not stand on it', () => {
    for (const posture of ['holdTheLine', 'advance'] as const) {
      const after = lancerAfter(board(0), posture);
      expect(manhattan(after, ENEMY_SPIRE), posture).toBe(1);
    }
  });
});

describe('pressure prefers the attack that clears the spire', () => {
  // Two enemy troopers a lancer can reach: a healthy one on the enemy spire, and a 3-HP one on open ground that the lancer kills for sure.
  // The same two stand in both boards; only the army in the far corner (out of reach of everything) changes hands, and with it who is ahead.
  const wide = ['....H..', ...grid(7, 13)];
  const wideOwners = ['....1..', ...grid(7, 13)];
  const board = (cornerOwner: number): GameState => onlyThese(
    fixtureGame(wide, [unit('lancer', 0, 3, 1), unit('trooper', 1, 4, 0), unit('trooper', 1, 2, 1, 3), ...block('lancer', cornerOwner, 5, 0, 13, 5)], { owners: wideOwners }),
    [1],
  );
  const target = (s: GameState) => {
    const a = decide(s, 0, orders({ posture: 'holdTheLine', targetPriority: [] }));
    return a.kind === 'move' && a.then.kind === 'attack' ? a.then.target : null;
  };

  it('the setup: both troopers are legal targets of the lancer, one stands on the enemy spire; only the first board has me ahead', () => {
    const keys = agentActions(board(0), 0)
      .filter((a) => a.kind === 'move' && a.unitId === 1 && a.then.kind === 'attack')
      .map((a) => (a.kind === 'move' && a.then.kind === 'attack' ? `${a.then.target.x},${a.then.target.y}` : ''));
    expect(keys).toContain('4,0');
    expect(keys).toContain('2,1');
    expect(pressureFor(board(0)).on).toBe(true);
    expect(pressureFor(board(1)).on).toBe(false);
  });

  it('the setup: the weak trooper is a certain kill and the one on the spire is not', () => {
    const s = board(0);
    const weak = forecast(s, 1, at(3, 1), at(2, 1));
    const guard = forecast(s, 1, at(3, 1), at(4, 0));
    expect(weak.damage[0], 'dies even on the lowest roll').toBeGreaterThanOrEqual(s.units.find((u) => u.id === 3)!.hp);
    expect(guard.damage[1], 'survives even the highest roll').toBeLessThan(s.units.find((u) => u.id === 2)!.hp);
  });

  it('ahead, the lancer strikes the trooper on the spire, and leaves the sure kill', () => {
    expect(target(board(0))).toEqual(at(4, 0));
  });

  it('known-bad twin: not ahead, with the same two targets, it takes the sure kill and leaves the spire\'s guard', () => {
    expect(target(board(1))).toEqual(at(2, 1));
  });
});

describe('pressure stops building once the army is crowded', () => {
  // A fabricator of mine, plenty of money, a roomy board. `n` troopers of mine, `m` of theirs.
  const build = (n: number, m: number): GameState => {
    const s = fixtureGame(
      ['F' + '.'.repeat(19), ...grid(20, 9)],
      [...block('trooper', 0, n, 1, 1, 19), ...block('trooper', 1, m, 0, 6, 20)],
      { owners: ['0' + '.'.repeat(19), ...grid(20, 9)] },
    );
    return { ...s, players: s.players.map((p) => (p.index === 0 ? { ...p, funds: 50000 } : p)) };
  };
  const builds = (s: GameState) => agentActions(s, 0).some((a) => a.kind === 'build');
  const buildsOrEnd = (s: GameState) => {
    // let every unit be done so the build decision is reached
    const done: GameState = { ...s, units: s.units.map((u) => ({ ...u, acted: true })) };
    return decide(done, 0, DEFAULT_ORDERS).kind;
  };

  it('the setup: both boards offer a build, and the crowded one is ahead of the enemy by value', () => {
    const crowded = build(PRESSURE_BUILD_LIMIT, 4);
    const sparse = build(PRESSURE_BUILD_LIMIT - 1, 4);
    expect(builds(crowded)).toBe(true);
    expect(builds(sparse)).toBe(true);
    expect(pressureFor(crowded)).toMatchObject({ on: true, reason: 'ahead' });
  });

  it('ahead with PRESSURE_BUILD_LIMIT units, it builds nothing and ends the turn', () => {
    expect(buildsOrEnd(build(PRESSURE_BUILD_LIMIT, 4))).toBe('endTurn');
  });

  it('known-bad twin: one unit fewer, it still builds', () => {
    expect(buildsOrEnd(build(PRESSURE_BUILD_LIMIT - 1, 4))).toBe('build');
  });

  it('known-bad twin: the same crowded army, but not ahead (the enemy is as big), still builds', () => {
    const s = build(PRESSURE_BUILD_LIMIT, PRESSURE_BUILD_LIMIT);
    expect(pressureFor(s).on).toBe(false);
    expect(buildsOrEnd(s)).toBe('build');
  });
});
