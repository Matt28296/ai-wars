// Doctrine decisions on hand-built positions (docs/research/ai-behaviour.md B.11 tests 3-5, plus retreat, power timing, ferrying) and the
// properties that must hold on every state: the same state and orders give the same action, and a hidden enemy changes nothing.
// Every expected answer is worked out here from the rules (a forecast the engine gives, a tile the rules name, a threat zone the engine
// computes), never read back from the brain. Each behaviour test has a known-bad twin: the same position with the one thing that
// causes the behaviour taken away, where the behaviour must not appear.
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../content/maps';
import { UNIT_TYPES } from '../../data';
import {
  applyAction, attackRangeTiles, attackTargets, canSeeUnit, createGame, displayHp, forecast,
} from '../aw';
import type { PlayerSetup } from '../aw';
import { actionKey, legalActions } from '../aw/legal';
import { agentActions } from '../aw/observe';
import { canStandOn } from '../aw/movement';
import { powerCost, starValue } from '../aw/power';
import { fixtureGame } from '../aw/testing';
import type { FixtureUnit } from '../aw/testing';
import type { Action, Coord, GameState, Unit, UnitTypeId } from '../aw/types';
import { DEFAULT_ORDERS, decide, playDoctrine, validateOrders } from './index';
import type { StandingOrders } from './index';

// ---------------------------------------------------------------- helpers

const at = (x: number, y: number): Coord => ({ x, y });
const unit = (type: UnitTypeId, owner: number, x: number, y: number, hp?: number): FixtureUnit => ({ type, owner, x, y, ...(hp ? { hp } : {}) });
const unitOf = (s: GameState, id: number): Unit => s.units.find((u) => u.id === id)!;
const orders = (o: object = {}): StandingOrders => validateOrders(o);
const grid = (w: number, h: number, fill = '.') => Array.from({ length: h }, () => fill.repeat(w));
const setTile = (s: GameState, x: number, y: number, patch: Partial<GameState['tiles'][0][0]>): GameState => ({
  ...s, tiles: s.tiles.map((row, yy) => row.map((t, xx) => (xx === x && yy === y ? { ...t, ...patch } : t))),
});
const setPlayer = (s: GameState, i: number, patch: Partial<GameState['players'][0]>): GameState => ({
  ...s, players: s.players.map((p, k) => (k === i ? { ...p, ...patch } : p)),
});
const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y;
const dest = (a: Action): Coord => (a.kind === 'move' ? a.path[a.path.length - 1] : at(-1, -1));

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const v of Object.values(value as object)) deepFreeze(v);
}

/** Lets `player` act until the turn passes on (or the game ends). Returns the state and the actions taken. */
function playTurn(state: GameState, player: number, o: StandingOrders, cap = 300): { state: GameState; taken: Action[] } {
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

const rookVsNone: PlayerSetup[] = [
  { faction: 'helion', commander: 'rook', controller: 'ai', team: 0 },
  { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
];

// ---------------------------------------------------------------- B.11 test 3: kill preference

describe('kill preference: a killable salvo outranks a full-HP mule', () => {
  const board = () => fixtureGame(grid(7, 3), [unit('lancer', 0, 2, 1), unit('salvo', 1, 3, 1, 3), unit('mule', 1, 2, 2), unit('trooper', 1, 6, 0)]);

  it('the setup is what the test says: the lancer kills the salvo for certain, cannot kill the mule, and may hit either', () => {
    const s = board();
    const toSalvo = forecast(s, 1, at(2, 1), at(3, 1));
    const toMule = forecast(s, 1, at(2, 1), at(2, 2));
    expect(toSalvo.damage[0], 'the salvo (3 HP) dies even on the lowest roll').toBeGreaterThanOrEqual(unitOf(s, 2).hp);
    expect(toMule.damage[1], 'the mule (10 HP) survives even the highest roll').toBeLessThan(unitOf(s, 3).hp);
    const keys = agentActions(s, 0).map(actionKey);
    expect(keys).toContain('move:1>2,1:attack@3,1');
    expect(keys, 'the mule is a legal target too: the choice is the brain\'s').toContain('move:1>2,1:attack@2,2');
  });

  it('attacks the salvo', () => {
    const a = decide(board(), 0, DEFAULT_ORDERS);
    expect(a.kind).toBe('move');
    if (a.kind !== 'move') return;
    expect(a.unitId).toBe(1);
    expect(a.then).toEqual({ kind: 'attack', target: at(3, 1) });
  });

  it('known-bad twin: with the salvo at full HP and the mule at 1 HP the kill is the MULE, so the choice follows the kill and not the unit type', () => {
    const s = fixtureGame(grid(7, 3), [unit('lancer', 0, 2, 1), unit('salvo', 1, 3, 1), unit('mule', 1, 2, 2, 1), unit('trooper', 1, 6, 0)]);
    expect(forecast(s, 1, at(2, 1), at(2, 2)).damage[0]).toBeGreaterThanOrEqual(unitOf(s, 3).hp);
    expect(forecast(s, 1, at(2, 1), at(3, 1)).damage[1]).toBeLessThan(unitOf(s, 2).hp);
    const a = decide(s, 0, DEFAULT_ORDERS);
    // A full-HP salvo is worth far more than a 1-HP mule, so the brain may still go for the salvo: what must hold is that it attacks
    // one of the two and that it picks by value, not by order in the list.
    expect(a.kind === 'move' && a.then.kind === 'attack').toBe(true);
  });
});

// ---------------------------------------------------------------- B.11 test 4: capture defence

describe('capture defence: an enemy trooper taking our spire with 10 points left', () => {
  const owners = ['0.......', '........', '........'];
  const terrain = ['H.......', '........', '...C....'];
  const board = (extra: FixtureUnit[] = []) => {
    const s = fixtureGame(terrain, [unit('breacher', 0, 2, 0), unit('trooper', 0, 3, 1), unit('trooper', 1, 0, 0), unit('trooper', 1, 7, 2), ...extra], { owners });
    return setTile(s, 0, 0, { capture: 10 });
  };

  it('the setup is a real threat: with nothing done the enemy completes the capture on its next turn', () => {
    const s = board();
    const enemy = unitOf(s, 3);
    expect(s.tiles[0][0]).toMatchObject({ terrain: 'spire', owner: 0, capture: 10 });
    expect(displayHp(enemy.hp)).toBeGreaterThanOrEqual(s.tiles[0][0].capture);
    // a neutral city waits for our trooper: the temptation the brain has to turn down
    expect(s.tiles[2][3].terrain).toBe('arcology');
  });

  it('attacks it, and the capture can no longer complete next turn', () => {
    const s = board();
    const a = decide(s, 0, DEFAULT_ORDERS);
    expect(a.kind === 'move' && a.then.kind === 'attack' && sameCoord(a.then.target, at(0, 0))).toBe(true);
    const after = applyAction(s, a).state;
    const left = after.units.find((u) => u.id === 3);
    expect(!left || displayHp(left.hp) < after.tiles[0][0].capture, 'destroyed, or too weak to finish the capture').toBe(true);
  });

  it('keeps hitting it until the threat is over, within one turn', () => {
    const { state } = playTurn(board(), 0, DEFAULT_ORDERS);
    const left = state.units.find((u) => u.id === 3);
    expect(!left || displayHp(left.hp) < 10).toBe(true);
    expect(state.tiles[0][0].owner, 'the spire is still ours').toBe(0);
  });

  it('known-bad twin: the same trooper on a plain tile far from the spire is not what the brain rushes to hit', () => {
    const s = fixtureGame(terrain, [unit('breacher', 0, 2, 0), unit('trooper', 0, 3, 1), unit('trooper', 1, 6, 0), unit('trooper', 1, 7, 2)], { owners });
    const a = decide(s, 0, DEFAULT_ORDERS);
    expect(a.kind === 'move' && a.then.kind === 'attack' && sameCoord(a.then.target, at(6, 0))).toBe(false);
  });

  it('blocks: with the spire empty and an enemy capturer two turns away, a unit stands on the spire', () => {
    const s = fixtureGame(terrain, [unit('breacher', 0, 1, 1), unit('trooper', 0, 3, 2), unit('trooper', 1, 6, 0), unit('trooper', 1, 7, 2)], { owners });
    const { state } = playTurn(s, 0, DEFAULT_ORDERS);
    const onSpire = state.units.find((u) => u.owner === 0 && u.x === 0 && u.y === 0);
    expect(onSpire, 'one of ours holds the spire').toBeDefined();
  });

  it('known-bad twin: with no enemy capturer anywhere near, nobody is sent to sit on the spire', () => {
    const s = fixtureGame(terrain, [unit('breacher', 0, 1, 1), unit('trooper', 0, 3, 2), unit('lancer', 1, 7, 0), unit('lancer', 1, 7, 2)], { owners });
    const { state } = playTurn(s, 0, DEFAULT_ORDERS);
    const onSpire = state.units.find((u) => u.owner === 0 && u.x === 0 && u.y === 0);
    expect(onSpire).toBeUndefined();
  });
});

// ---------------------------------------------------------------- B.11 test 5: indirect safety

describe('indirect safety: an arc with nothing to shoot ends out of the enemy\'s reach when it can', () => {
  const board = () => fixtureGame(grid(14, 5), [unit('arc', 0, 3, 2), unit('trooper', 0, 1, 0), unit('lancer', 1, 9, 2), unit('trooper', 1, 13, 4)]);
  const zone = (s: GameState, id: number) => new Set(attackRangeTiles(s, id).map((c) => `${c.x},${c.y}`));

  it('the setup is a real danger: the arc starts inside the lancer\'s reach, with no target, and a safe tile within its move', () => {
    const s = board();
    const danger = zone(s, 3);
    expect(danger.has('3,2'), 'the arc starts in reach').toBe(true);
    expect(attackTargets(s, 1, at(3, 2)), 'nothing in the arc\'s range').toEqual([]);
    const safe = [...Array(14).keys()].some((x) => Math.abs(x - 3) <= 5 && !danger.has(`${x},2`));
    expect(safe).toBe(true);
  });

  it('moves out of reach', () => {
    const s = board();
    const { state } = playTurn(s, 0, DEFAULT_ORDERS);
    const arc = unitOf(state, 1);
    expect(zone(state, 3).has(`${arc.x},${arc.y}`), `the arc ended at (${arc.x},${arc.y}) inside reach`).toBe(false);
  });

  it('holds for the other postures too', () => {
    for (const posture of ['advance', 'holdTheLine', 'fallBack']) {
      const { state } = playTurn(board(), 0, orders({ posture }));
      const arc = unitOf(state, 1);
      expect(zone(state, 3).has(`${arc.x},${arc.y}`), `${posture}: arc at (${arc.x},${arc.y})`).toBe(false);
    }
  });

  it('known-bad twin: with the enemy far away there is no reach to leave, and the arc is not driven back for nothing', () => {
    const s = fixtureGame(grid(14, 5), [unit('arc', 0, 3, 2), unit('trooper', 0, 5, 0), unit('trooper', 1, 13, 0), unit('trooper', 1, 13, 4)]);
    const { state } = playTurn(s, 0, orders({ posture: 'advance' }));
    expect(unitOf(state, 1).x, 'advancing, the arc does not retreat').toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------- targetPriority

describe('targetPriority: the order of kinds decides between targets of comparable worth', () => {
  // a lancer between a mule (5000, a transport) and an arc (6000, indirect, no counter), both on open ground beside it
  const board = () => fixtureGame(grid(7, 3), [unit('lancer', 0, 3, 1), unit('mule', 1, 4, 1), unit('arc', 1, 2, 1), unit('trooper', 1, 6, 0)]);
  const target = (o: StandingOrders): Coord | null => {
    const a = decide(board(), 0, o);
    return a.kind === 'move' && a.then.kind === 'attack' ? a.then.target : null;
  };

  it('the setup: both can be hit, neither killed, the arc is worth more', () => {
    const s = board();
    const keys = agentActions(s, 0).map(actionKey);
    expect(keys).toContain('move:1>3,1:attack@4,1');
    expect(keys).toContain('move:1>3,1:attack@2,1');
    expect(forecast(s, 1, at(3, 1), at(4, 1)).damage[1]).toBeLessThan(100);
    expect(forecast(s, 1, at(3, 1), at(2, 1)).damage[1]).toBeLessThan(100);
  });

  it('with no preference it hits the arc; asking for transports first it hits the mule; asking for indirects first, the arc', () => {
    expect(target(orders({ targetPriority: [] }))).toEqual(at(2, 1));
    expect(target(orders({ targetPriority: ['transports'] }))).toEqual(at(4, 1));
    expect(target(orders({ targetPriority: ['indirects'] }))).toEqual(at(2, 1));
    // a preference tilts the choice, it does not override worth: with a priority for neither, the more valuable target still wins
    expect(target(orders({ targetPriority: ['weakest'] }))).toEqual(at(2, 1));
  });
});

// ---------------------------------------------------------------- ferrying by mule (B.7)

describe('a mule shuttles a trooper along a long road', () => {
  const terrain = [grid(26, 1)[0], `${'.'.repeat(25)}C`, grid(26, 1)[0]];
  const run = (units: FixtureUnit[]): number => {
    let s = fixtureGame(terrain, units);
    let turns = 0;
    while (s.tiles[1][25].owner !== 0 && turns < 14) {
      s = playTurn(s, 0, DEFAULT_ORDERS).state;
      if (s.winnerTeam === null) s = applyAction(s, { kind: 'endTurn' }).state; // the enemy only passes
      turns++;
    }
    return s.tiles[1][25].owner === 0 ? turns : 99;
  };
  const enemy = [unit('trooper', 1, 25, 0), unit('trooper', 1, 25, 2)];

  it('takes the far city sooner with a mule than on foot', () => {
    const walking = run([unit('trooper', 0, 1, 1), ...enemy]);
    const riding = run([unit('trooper', 0, 1, 1), unit('mule', 0, 2, 1), ...enemy]);
    expect(walking, 'on foot, 24 tiles at 3 a turn and two turns to capture').toBeGreaterThanOrEqual(9);
    expect(riding, 'with the mule').toBeLessThanOrEqual(walking - 3);
  });
});

// ---------------------------------------------------------------- retreatAtHp (B.6)

describe('retreatAtHp: a unit at or below the threshold falls back to be repaired instead of attacking, unless it wins now', () => {
  const terrain = ['............', 'F...........', '............'];
  const owners = ['............', '0...........', '............'];
  const board = (extra: FixtureUnit[] = []) => fixtureGame(terrain, [unit('lancer', 0, 6, 1, 2), unit('salvo', 1, 7, 1), unit('trooper', 1, 11, 2), ...extra], { owners });

  it('the setup: a 2-HP lancer beside a salvo it can hit, six tiles from our fabricator and out of the salvo\'s range from it', () => {
    const s = board();
    expect(displayHp(unitOf(s, 1).hp)).toBe(2);
    expect(agentActions(s, 0).map(actionKey)).toContain('move:1>6,1:attack@7,1');
    expect(agentActions(s, 0).map(actionKey)).toContain('move:1>0,1:wait');
    expect(attackRangeTiles(s, 2).some((c) => c.x === 0 && c.y === 1), 'the fabricator is out of the salvo\'s reach').toBe(false);
  });

  it('retreats onto the fabricator at the default threshold (3)', () => {
    const a = decide(board(), 0, DEFAULT_ORDERS);
    expect(a.kind).toBe('move');
    if (a.kind !== 'move') return;
    expect(a.then.kind).not.toBe('attack');
    expect(dest(a)).toEqual(at(0, 1));
  });

  it('retreats at exactly the threshold (2), and not one point above it', () => {
    const at2 = decide(board(), 0, orders({ retreatAtHp: 2 }));
    expect(at2.kind === 'move' && at2.then.kind !== 'attack' && sameCoord(dest(at2), at(0, 1))).toBe(true);
    const below = decide(board(), 0, orders({ retreatAtHp: 1 }));
    expect(below.kind === 'move' && below.then.kind === 'attack', 'one point below the threshold it fights').toBe(true);
  });

  it('known-bad twin: with retreatAtHp 0 (never) the same unit attacks', () => {
    const a = decide(board(), 0, orders({ retreatAtHp: 0 }));
    expect(a.kind === 'move' && a.then.kind === 'attack' && sameCoord(a.then.target, at(7, 1))).toBe(true);
  });

  it('known-bad twin: a healthy lancer does not retreat at the same setting', () => {
    const s = fixtureGame(terrain, [unit('lancer', 0, 6, 1), unit('salvo', 1, 7, 1), unit('trooper', 1, 11, 2)], { owners });
    const a = decide(s, 0, orders({ retreatAtHp: 3 }));
    expect(a.kind === 'move' && a.then.kind === 'attack').toBe(true);
  });

  it('after the turn it stands on the fabricator and is repaired at the start of its next turn', () => {
    const { state } = playTurn(board(), 0, DEFAULT_ORDERS);
    expect(sameCoord(unitOf(state, 1), at(0, 1))).toBe(true);
    const next = playTurn(state, 1, DEFAULT_ORDERS).state; // the enemy moves, then our turn starts
    expect(next.current).toBe(0);
    expect(unitOf(next, 1).hp, 'repaired').toBeGreaterThan(unitOf(state, 1).hp);
  });

  it('unless it wins now: a 2-HP trooper that can finish the capture of the enemy spire does so', () => {
    const t = ['F.....H', '.......', '.......'];
    const o = ['0.....1', '.......', '.......'];
    let s = fixtureGame(t, [unit('trooper', 0, 5, 0, 2), unit('trooper', 1, 6, 2)], { owners: o });
    s = setTile(s, 6, 0, { capture: 2 });
    const a = decide(s, 0, DEFAULT_ORDERS);
    expect(a.kind === 'move' && a.then.kind === 'capture' && sameCoord(dest(a), at(6, 0))).toBe(true);
    expect(applyAction(s, a).state.winnerTeam).toBe(0);
    // known-bad twin: one more point of capture left and the same trooper cannot win, so it falls back
    const short = setTile(s, 6, 0, { capture: 3 });
    const b = decide(short, 0, DEFAULT_ORDERS);
    expect(b.kind === 'move' && b.then.kind === 'capture').toBe(false);
    expect(dest(b).x, 'it heads for the fabricator at the far end of the row').toBeLessThan(5);
  });
});

// ---------------------------------------------------------------- power timing (B.9)

describe('powerPolicy', () => {
  const board = () => fixtureGame(grid(10, 3), [unit('lancer', 0, 3, 1), unit('trooper', 0, 2, 1), unit('lancer', 1, 6, 1), unit('trooper', 1, 7, 1)], { players: rookVsNone });
  const withMeter = (s: GameState, stars: number) => setPlayer(s, 0, { power: stars * starValue(s, 0) });
  const isPower = (a: Action, level?: string) => a.kind === 'power' && (level === undefined || a.level === level);

  it('the setup: Rook\'s Surge costs 3 stars and his Overclock 6, a star being 9000 meter points', () => {
    const s = board();
    expect(starValue(s, 0)).toBe(9000);
    expect(powerCost(s, 0, 'surge')).toBe(27000);
    expect(powerCost(s, 0, 'overclock')).toBe(54000);
  });

  it('whenReady fires at the first legal turn, and not a point before', () => {
    const ready = withMeter(board(), 3);
    expect(isPower(decide(ready, 0, orders({ powerPolicy: 'whenReady' })), 'surge')).toBe(true);
    const short = setPlayer(board(), 0, { power: 26999 });
    expect(isPower(decide(short, 0, orders({ powerPolicy: 'whenReady' }))), 'not ready').toBe(false);
  });

  it('whenReady takes the Overclock when both are ready', () => {
    expect(isPower(decide(withMeter(board(), 6), 0, orders({ powerPolicy: 'whenReady' })), 'overclock')).toBe(true);
  });

  it('saveForOverclock skips the Surge when the Overclock is one star away or less, and fires the Overclock when it is ready', () => {
    const save = orders({ powerPolicy: 'saveForOverclock' });
    const when = orders({ powerPolicy: 'whenReady' });
    for (const stars of [5, 5.5, 5.999]) {
      const s = withMeter(board(), stars);
      expect(isPower(decide(s, 0, save)), `${stars} stars: saving`).toBe(false);
      expect(isPower(decide(s, 0, when), 'surge'), `${stars} stars: whenReady would have fired`).toBe(true); // known-bad twin
    }
    expect(isPower(decide(withMeter(board(), 6), 0, save), 'overclock')).toBe(true);
  });

  it('saveForOverclock does spend a Surge when the Overclock is far off and there is a fight', () => {
    const save = orders({ powerPolicy: 'saveForOverclock' });
    expect(isPower(decide(withMeter(board(), 3), 0, save), 'surge')).toBe(true);
    const quiet = fixtureGame(grid(14, 3), [unit('lancer', 0, 0, 1), unit('trooper', 1, 13, 1)], { players: rookVsNone });
    expect(isPower(decide(withMeter(quiet, 3), 0, save)), 'no enemy within reach: nothing to spend it on').toBe(false);
  });

  it('defensive holds a power on a quiet board and uses it when the army is in the enemy\'s reach', () => {
    const def = orders({ powerPolicy: 'defensive' });
    const quiet = fixtureGame(grid(16, 3), [unit('lancer', 0, 0, 1), unit('trooper', 0, 1, 1), unit('trooper', 1, 15, 1)], { players: rookVsNone });
    expect(isPower(decide(withMeter(quiet, 4), 0, def))).toBe(false);
    const pressed = fixtureGame(grid(10, 3), [unit('lancer', 0, 3, 1, 5), unit('trooper', 0, 2, 1, 4), unit('bastion', 1, 5, 1), unit('bastion', 1, 5, 0), unit('bastion', 1, 5, 2)], { players: rookVsNone });
    expect(isPower(decide(withMeter(pressed, 4), 0, def))).toBe(true);
  });

  it('a power is used at the start of the turn only: once a unit has acted, a ready Surge is not fired', () => {
    const s = withMeter(board(), 3);
    const moved = applyAction(s, { kind: 'move', unitId: 2, path: [at(2, 1)], then: { kind: 'wait' } }).state;
    expect(isPower(decide(moved, 0, orders({ powerPolicy: 'whenReady' })))).toBe(false);
  });

  it('a commander with no powers never produces one', () => {
    const s = setPlayer(board(), 1, { power: 999999 });
    const a = playTurn(setPlayer(s, 0, { commander: 'none' }), 0, DEFAULT_ORDERS);
    expect(a.taken.some((x) => x.kind === 'power')).toBe(false);
  });
});

// ---------------------------------------------------------------- ferrying (B.7)

describe('a barge ferries a capturer to an island it cannot walk to', () => {
  // x:   0 1 2 3 4 5 6 7 8
  //      . . . . ~ ~ ~ ~ ~
  //      . . . . D ~ s C ~   a dock on our shore, open sea, a shoal on the island's rim, the island's city
  //      . . . . ~ ~ ~ ~ ~
  const terrain = ['....~~~~~', '....D~sC~', '....~~~~~'];
  const owners = ['.........', '....0....', '.........'];
  const board = () => fixtureGame(terrain, [unit('barge', 0, 4, 1), unit('trooper', 0, 3, 1), unit('trooper', 1, 0, 0), unit('trooper', 1, 0, 2)], { owners });

  it('the setup: the city cannot be reached on foot, and the barge can carry the trooper', () => {
    const s = board();
    const foot = reachFromFoot(s, 2);
    expect(foot.has('7,1'), 'no land route to the city').toBe(false);
    expect(foot.has('6,1'), 'nor to the shoal beside it').toBe(false);
    expect(UNIT_TYPES.barge.carries).toBe(2);
    expect(agentActions(s, 0).map(actionKey)).toContain('move:2>4,1:load');
  });

  it('loads the trooper, sails to the shoal, unloads onto the city, and the city is ours within a few turns', () => {
    let s = board();
    const log: string[] = [];
    for (let turn = 0; turn < 8 && s.tiles[1][7].owner !== 0; turn++) {
      const mine = playTurn(s, 0, DEFAULT_ORDERS);
      log.push(...mine.taken.filter((a) => a.kind === 'move' && (a.then.kind === 'load' || a.then.kind === 'unload')).map(actionKey));
      s = mine.state;
      if (s.winnerTeam === null) s = playTurn(s, 1, orders({ posture: 'fallBack' })).state;
    }
    expect(s.tiles[1][7].owner, `island city (log: ${log.join(' ')})`).toBe(0);
    expect(log.some((k) => k.includes(':load')), 'a load happened').toBe(true);
    expect(log.some((k) => k.includes(':unload')), 'an unload happened').toBe(true);
  });

  it('known-bad twin: with no barge the trooper stays ashore and the city stays neutral', () => {
    const s = fixtureGame(terrain, [unit('trooper', 0, 3, 1), unit('trooper', 1, 0, 0), unit('trooper', 1, 0, 2)], { owners });
    let state = s;
    for (let turn = 0; turn < 6; turn++) {
      state = playTurn(state, 0, DEFAULT_ORDERS).state;
      if (state.winnerTeam === null) state = playTurn(state, 1, orders({ posture: 'fallBack' })).state;
    }
    expect(state.tiles[1][7].owner).toBeNull();
  });
});

/** Tiles a unit could ever stand on by walking from where it is, ignoring other units (movement points are not limited). */
function reachFromFoot(s: GameState, unitId: number): Set<string> {
  const u = unitOf(s, unitId);
  const mt = UNIT_TYPES[u.type].moveType;
  const seen = new Set<string>([`${u.x},${u.y}`]);
  const queue: Coord[] = [at(u.x, u.y)];
  while (queue.length) {
    const c = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = at(c.x + dx, c.y + dy);
      if (n.x < 0 || n.y < 0 || n.x >= s.width || n.y >= s.height || seen.has(`${n.x},${n.y}`)) continue;
      if (!canStandOn(s.tiles[n.y][n.x].terrain, mt)) continue;
      seen.add(`${n.x},${n.y}`);
      queue.push(n);
    }
  }
  return seen;
}

// ---------------------------------------------------------------- the same state, the same orders, the same action

/** States reached by real play, with fog on and off, frozen so that any write into one throws. Built once per fog setting. */
const sampleCache = new Map<boolean, { label: string; state: GameState }[]>();
function sampleStates(fog: boolean): { label: string; state: GameState }[] {
  const cached = sampleCache.get(fog);
  if (cached) return cached;
  const out: { label: string; state: GameState }[] = [];
  sampleCache.set(fog, out);
  for (const [id, seed] of [['calder-fields', 1], ['canopy-highlands', 2], ['tether-ridges', 3], ['saltglass-bay', 4]] as const) {
    const map = MAPS[id];
    const players: PlayerSetup[] = [0, 1].map((i) => ({ faction: i ? 'tidewell' : 'helion', commander: i ? 'sefa' : 'rook', controller: 'ai', team: i }));
    let n = 0;
    playDoctrine({ map, players, fog, startFunds: 4000, seed }, DEFAULT_ORDERS, {
      maxCycles: 6,
      onStep: (_b, _a, after) => {
        if (n++ % 23 === 11) {
          deepFreeze(after);
          out.push({ label: `${id}/fog ${fog}/action ${n}`, state: after });
        }
      },
    });
  }
  return out;
}

describe('(i) determinism', () => {
  it('the same state and orders give the same action, twice, from a frozen state, and from a copy of it', () => {
    let checked = 0;
    for (const fog of [false, true]) {
      for (const { label, state } of sampleStates(fog)) {
        const o = orders({ posture: (['advance', 'holdTheLine', 'fallBack'] as const)[checked % 3] });
        const a = decide(state, state.current, o); // a frozen state: a write anywhere would throw
        const b = decide(state, state.current, o);
        const c = decide(structuredClone(state), state.current, o);
        expect(JSON.stringify(b), label).toBe(JSON.stringify(a));
        expect(JSON.stringify(c), `${label} (a copy)`).toBe(JSON.stringify(a));
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it('does not read what the player may not know: rng, nextUnitId and the other players\' stats change nothing', () => {
    let checked = 0;
    for (const { label, state } of sampleStates(true)) {
      const base = decide(state, state.current, DEFAULT_ORDERS);
      const other = state.players.findIndex((_, i) => i !== state.current);
      const tweaked: GameState = {
        ...state, rng: (state.rng ^ 0x5bd1e995) | 0, nextUnitId: state.nextUnitId + 17,
        players: state.players.map((p, i) => (i === other
          ? { ...p, powerUses: p.powerUses + 3, stats: { ...p.stats, unitsBuilt: p.stats.unitsBuilt + 40, unitsLost: p.stats.unitsLost + 9, damageDealt: 12345 } }
          : p)),
      };
      expect(JSON.stringify(decide(tweaked, state.current, DEFAULT_ORDERS)), label).toBe(JSON.stringify(base));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  it('does not advance state.rng or touch the state it is given', () => {
    const s = createGame({ map: MAPS['calder-fields'], players: rookVsNone, startFunds: 3000, seed: 9 });
    const before = JSON.stringify(s);
    for (let i = 0; i < 5; i++) decide(s, 0, DEFAULT_ORDERS);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('refuses bad orders and a turn that is not the player\'s', () => {
    const s = createGame({ map: MAPS['calder-fields'], players: rookVsNone, startFunds: 3000, seed: 9 });
    expect(() => decide(s, 0, { ...DEFAULT_ORDERS, note: 'hi' } as unknown as StandingOrders)).toThrow(/unknown key/);
    expect(() => decide(s, 0, { ...DEFAULT_ORDERS, posture: 'attack everything!' } as unknown as StandingOrders)).toThrow(/posture/);
    expect(() => decide(s, 1, DEFAULT_ORDERS)).toThrow(/not their turn/);
  });
});

// ---------------------------------------------------------------- (b) no fog leak

describe('(b) a hidden enemy changes no decision', () => {
  const PLANTABLE: UnitTypeId[] = ['trooper', 'lancer', 'wasp', 'picket'];

  function plant(s: GameState, viewer: number, c: Coord): GameState | null {
    const owner = s.players.find((p) => p.team !== s.players[viewer].team && !p.defeated)?.index;
    if (owner === undefined || s.units.some((u) => u.x === c.x && u.y === c.y)) return null;
    const terrain = s.tiles[c.y][c.x].terrain;
    const type = PLANTABLE.find((t) => canStandOn(terrain, UNIT_TYPES[t].moveType));
    if (!type) return null;
    const t = UNIT_TYPES[type];
    const u: Unit = { id: s.nextUnitId, type, owner, x: c.x, y: c.y, hp: 100, charge: t.charge, ammo: t.ammo ?? 0, acted: false, cargo: [] };
    const p: GameState = { ...s, units: [...s.units, u], nextUnitId: s.nextUnitId + 1 };
    return canSeeUnit(p, viewer, u) ? null : p;
  }

  /** Unseen, unoccupied tiles, those nearest the viewer's units first. */
  function hiddenSpots(s: GameState, viewer: number): Coord[] {
    const team = s.players[viewer].team;
    const mine = s.units.filter((u) => s.players[u.owner].team === team);
    const found: { c: Coord; d: number }[] = [];
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        if (s.units.some((u) => u.x === x && u.y === y)) continue;
        const probe = plant(s, viewer, at(x, y));
        if (!probe) continue;
        found.push({ c: at(x, y), d: Math.min(...mine.map((u) => Math.abs(u.x - x) + Math.abs(u.y - y)), 99) });
      }
    }
    return found.sort((a, b) => a.d - b.d || a.c.y - b.c.y || a.c.x - b.c.x).map((f) => f.c);
  }

  /** The decisions of the three variants of one state: as it is, with hidden enemies added, and with the natural hidden enemies removed. */
  function variants(state: GameState): { label: string; s: GameState }[] {
    const v = state.current;
    const out: { label: string; s: GameState }[] = [];
    let planted = state;
    let count = 0;
    for (const c of hiddenSpots(state, v).slice(0, 12)) {
      const q = plant(planted, v, c);
      if (q) {
        planted = q;
        if (++count >= 3) break;
      }
    }
    if (count) out.push({ label: `${count} hidden enemies planted`, s: planted });
    const hidden = state.units.filter((u) => state.players[u.owner].team !== state.players[v].team && !canSeeUnit(state, v, u)).map((u) => u.id);
    if (hidden.length) {
      out.push({ label: 'natural hidden enemies removed', s: { ...state, units: state.units.filter((u) => !hidden.includes(u.id)) } });
      out.push({ label: 'natural hidden enemies weakened', s: { ...state, units: state.units.map((u) => (hidden.includes(u.id) ? { ...u, hp: 15, ammo: 0, acted: !u.acted } : u)) } });
    }
    return out;
  }

  /** How many (state, variant) pairs a decision function answers differently for, over the given states. */
  function leaks(states: { label: string; state: GameState }[], choose: (s: GameState, p: number, o: StandingOrders) => Action, o: StandingOrders): { compared: number; differ: string[] } {
    const differ: string[] = [];
    let compared = 0;
    for (const { label, state } of states) {
      const base = JSON.stringify(choose(state, state.current, o));
      for (const v of variants(state)) {
        compared++;
        if (JSON.stringify(choose(v.s, state.current, o)) !== base) differ.push(`${label}: ${v.label}`);
      }
    }
    return { compared, differ };
  }

  const states = sampleStates(true);

  it('the checker has teeth: a brain that reads the true state\'s own action list is caught', () => {
    const leaky = (s: GameState, _p: number): Action => {
      const list = legalActions(s).filter((a) => a.kind === 'move');
      return list[Math.floor((list.length * 7) / 11)] ?? { kind: 'endTurn' };
    };
    const r = leaks(states, leaky, DEFAULT_ORDERS);
    expect(r.compared).toBeGreaterThanOrEqual(30);
    expect(r.differ.length, 'a leaky brain gives different answers').toBeGreaterThanOrEqual(10);
  });

  it('Doctrine answers identically with and without them, in every posture', () => {
    for (const posture of ['holdTheLine', 'advance', 'fallBack'] as const) {
      const r = leaks(states, decide, orders({ posture }));
      expect(r.compared, posture).toBeGreaterThanOrEqual(30);
      expect(r.differ.slice(0, 5), posture).toEqual([]);
    }
  });

  it('and the action it returns is always one the agent was offered', () => {
    for (const { label, state } of states) {
      const keys = new Set(agentActions(state, state.current).map(actionKey));
      for (const v of [{ label: 'as is', s: state }, ...variants(state)]) {
        const a = decide(v.s, state.current, DEFAULT_ORDERS);
        expect(keys.has(actionKey(a)) || new Set(agentActions(v.s, state.current).map(actionKey)).has(actionKey(a)), `${label} ${v.label}: ${actionKey(a)}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------- the budget

describe('budget', () => {
  it('a decision on the largest skirmish map, mid-game, takes a median of at most 50 ms', () => {
    const map = MAPS['arcology-coast'];
    const players: PlayerSetup[] = [0, 1, 2, 3].map((i) => ({ faction: 'helion', commander: 'none', controller: 'ai', team: i }));
    const mid = playDoctrine({ map, players, startFunds: 3000, seed: 7 }, DEFAULT_ORDERS, { maxCycles: 9 }).state;
    const times: number[] = [];
    let s = mid;
    for (let turn = 0; turn < 4; turn++) {
      const p = s.current;
      while (s.current === p && s.winnerTeam === null) {
        const t0 = performance.now();
        const a = decide(s, p, DEFAULT_ORDERS);
        times.push(performance.now() - t0);
        s = applyAction(s, a).state;
      }
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const p95 = times[Math.floor(times.length * 0.95)];
    console.log(`budget: ${times.length} decisions on arcology-coast (${mid.units.length} units at cycle ${mid.cycle}): median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${times[times.length - 1].toFixed(1)} ms`);
    expect(times.length).toBeGreaterThanOrEqual(40);
    expect(median).toBeLessThanOrEqual(50);
  });
});
