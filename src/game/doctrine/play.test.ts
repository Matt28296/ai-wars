// Doctrine over whole games: what the standing orders change, and that the brain beats the sim's 'random' policy.
//   (f) posture: over seeded games on one map, Advance's units are nearer the enemy spire after cycle 5 than Fall Back's;
//   (j) Doctrine with DEFAULT_ORDERS beats a random player in at least 80% of 20 seeded games on calder-fields.
// The random player here plays the way sim.ts's 'random' policy does (the same chances to end the turn, use a power and build, and a
// random reachable tile and option for a random un-acted unit); sim.ts does not export it and plays every seat with one policy, so
// it is rebuilt from the engine's own legal.ts pieces. The heavy runs live in scripts/balance.mjs.
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../content/maps';
import { applyAction, createGame, reachable } from '../aw';
import type { CreateGameOptions, PlayerSetup } from '../aw';
import { buildActions, destinationActions, powerActions } from '../aw/legal';
import { nextRandom, seedRng } from '../aw/rng';
import type { Action, Coord, GameState } from '../aw/types';
import { DEFAULT_ORDERS, decide, playDoctrine, validateOrders } from './index';

const manhattan = (a: Coord, b: Coord) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const duel = (commanders: [string, string] = ['none', 'none']): PlayerSetup[] => [
  { faction: 'helion', commander: commanders[0], controller: 'ai', team: 0 },
  { faction: 'tidewell', commander: commanders[1], controller: 'ai', team: 1 },
];

// ---------------------------------------------------------------- (f) posture

/** The tile of the spire that belongs to `player` at the start of the game. */
function spireOf(map: (typeof MAPS)[string], player: number): Coord {
  for (let y = 0; y < map.terrain.length; y++) {
    for (let x = 0; x < map.terrain[y].length; x++) {
      if (map.terrain[y][x] === 'H' && map.owners[y][x] === String(player)) return { x, y };
    }
  }
  throw new Error(`no spire for player ${player} on ${map.id}`);
}

/** The cycles after cycle 5 that are measured: the first moment each of cycles 6 to 10 starts. */
const MEASURED = [6, 7, 8, 9, 10];

interface Spread {
  /** Mean distance of all of player 0's units to player 1's spire, at each measured cycle. */
  mean: number[];
  /** Mean distance of its three nearest units, at each measured cycle. */
  vanguard: number[];
}

function spreadAfterFive(posture: 'advance' | 'holdTheLine' | 'fallBack', seed: number): Spread {
  const map = MAPS['calder-fields'];
  const target = spireOf(map, 1);
  const mine = validateOrders({ posture });
  const snaps = new Map<number, GameState>();
  playDoctrine({ map, players: duel(), startFunds: 1000, seed }, [mine, DEFAULT_ORDERS], {
    maxCycles: 10,
    onStep: (_b, _a, after) => {
      if (MEASURED.includes(after.cycle) && !snaps.has(after.cycle)) snaps.set(after.cycle, after);
    },
  });
  const out: Spread = { mean: [], vanguard: [] };
  for (const c of MEASURED) {
    const s = snaps.get(c);
    if (!s) throw new Error(`the game ended before cycle ${c}`);
    const d = s.units.filter((u) => u.owner === 0).map((u) => manhattan(u, target)).sort((a, b) => a - b);
    out.mean.push(d.reduce((n, x) => n + x, 0) / d.length);
    out.vanguard.push(d.slice(0, 3).reduce((n, x) => n + x, 0) / Math.min(3, d.length));
  }
  return out;
}

const avg = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;

describe('(f) posture changes where the army is', () => {
  const seeds = [1, 2, 3, 4];
  const rows = (posture: 'advance' | 'holdTheLine' | 'fallBack') => seeds.map((seed) => spreadAfterFive(posture, seed));
  const advance = rows('advance');
  const hold = rows('holdTheLine');
  const fall = rows('fallBack');
  const pooled = (r: Spread[], key: keyof Spread) => avg(r.flatMap((x) => x[key]));

  it('after cycle 5, Advance\'s army is nearer the enemy spire than Fall Back\'s, in every seed and on average', () => {
    console.log(`(f) mean distance to the enemy spire over cycles 6-10 on calder-fields, ${seeds.length} seeds: ` +
      `advance ${pooled(advance, 'mean').toFixed(2)}, hold the line ${pooled(hold, 'mean').toFixed(2)}, fall back ${pooled(fall, 'mean').toFixed(2)}; ` +
      `three nearest units: advance ${pooled(advance, 'vanguard').toFixed(2)}, hold ${pooled(hold, 'vanguard').toFixed(2)}, fall back ${pooled(fall, 'vanguard').toFixed(2)}`);
    expect(pooled(advance, 'mean')).toBeLessThan(pooled(fall, 'mean') - 1);
    seeds.forEach((seed, i) => expect(avg(advance[i].mean), `seed ${seed}`).toBeLessThan(avg(fall[i].mean)));
    // and cycle by cycle, not just pooled: no measured cycle has Fall Back nearer
    MEASURED.forEach((c, k) => expect(avg(advance.map((r) => r.mean[k])), `cycle ${c}`).toBeLessThan(avg(fall.map((r) => r.mean[k]))));
  });

  it('the push is visible at the front: over cycles 6-10 the three nearest units of Advance are nearer than Hold the Line\'s and Fall Back\'s', () => {
    expect(pooled(advance, 'vanguard')).toBeLessThan(pooled(hold, 'vanguard') - 0.5);
    expect(pooled(advance, 'vanguard')).toBeLessThan(pooled(fall, 'vanguard') - 1);
  });

  it('known-bad twin: with the same orders on both runs the spread is identical, so a posture that changed nothing would fail the margin above', () => {
    const again = rows('holdTheLine');
    const difference = pooled(again, 'mean') - pooled(hold, 'mean');
    expect(difference).toBe(0);
    expect(difference < -1, 'the "nearer by more than a tile" test is not met by identical runs').toBe(false);
  });

  it('the measure has room: the spires are far apart, and Fall Back keeps its army nearer its own', () => {
    const map = MAPS['calder-fields'];
    const home = spireOf(map, 0);
    const foe = spireOf(map, 1);
    expect(manhattan(home, foe)).toBeGreaterThan(10);
    expect(pooled(fall, 'mean')).toBeGreaterThan(manhattan(home, foe) / 2);
  });
});

// ---------------------------------------------------------------- (j) beats the random policy

function randomPolicy(seed: number): (s: GameState) => Action {
  let rng = seedRng(seed);
  const float = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(float() * xs.length)];
  return (state) => {
    const roll = float();
    if (roll < 0.04) return { kind: 'endTurn' };
    if (roll < 0.09) {
      const powers = powerActions(state);
      if (powers.length) return pick(powers);
    }
    const ready = state.units.filter((u) => u.owner === state.current && !u.acted);
    const unit = ready.length ? pick(ready) : undefined;
    const wantsBuild = unit ? float() < 0.3 : float() < 0.7;
    if (wantsBuild) {
      const builds = buildActions(state);
      if (builds.length) return pick(builds);
    }
    if (!unit) return { kind: 'endTurn' };
    const entries = [...reachable(state, unit.id).values()];
    for (let tries = 0; tries < 6 && entries.length; tries++) {
      const options = destinationActions(state, unit, pick(entries));
      if (options.length) return pick(options);
    }
    return { kind: 'move', unitId: unit.id, path: [{ x: unit.x, y: unit.y }], then: { kind: 'wait' } };
  };
}

describe('(j) Doctrine beats the random policy', () => {
  it('with DEFAULT_ORDERS in at least 80% of 20 seeded games on calder-fields, playing both sides of the board', () => {
    const map = MAPS['calder-fields'];
    const CAP = 40;
    let wins = 0;
    let losses = 0;
    let capped = 0;
    const cycles: number[] = [];
    for (let g = 0; g < 20; g++) {
      const doctrineSeat = g % 2; // alternate seats, so first move is not what wins
      const setup: CreateGameOptions = { map, players: duel(), startFunds: 1000, seed: 100 + g };
      const rand = randomPolicy(900 + g);
      let state = createGame(setup);
      let steps = 0;
      while (state.winnerTeam === null && state.cycle <= CAP) {
        if (++steps > 40000) throw new Error('game did not end');
        const action = state.current === doctrineSeat ? decide(state, state.current, DEFAULT_ORDERS) : rand(state);
        state = applyAction(state, action).state;
      }
      cycles.push(Math.min(state.cycle, CAP));
      if (state.winnerTeam === doctrineSeat) wins++;
      else if (state.winnerTeam === null) capped++;
      else losses++;
    }
    console.log(`(j) Doctrine vs random on calder-fields: ${wins} won, ${losses} lost, ${capped} undecided at ${CAP} cycles, mean ${(cycles.reduce((a, b) => a + b, 0) / cycles.length).toFixed(1)} cycles`);
    expect(wins).toBeGreaterThanOrEqual(16);
  });

  it('known-bad twin: the random policy does not beat itself into a lopsided result, so the 80% is the brain\'s doing', () => {
    // Two random players: the seat that moves first should not win nearly every game. A harness that handed one seat the game would show here.
    const map = MAPS['calder-fields'];
    let seat0 = 0;
    let decided = 0;
    for (let g = 0; g < 10; g++) {
      const a = randomPolicy(300 + g);
      const b = randomPolicy(700 + g);
      let state = createGame({ map, players: duel(), startFunds: 1000, seed: 50 + g });
      let steps = 0;
      while (state.winnerTeam === null && state.cycle <= 20) {
        if (++steps > 20000) throw new Error('game did not end');
        state = applyAction(state, state.current === 0 ? a(state) : b(state)).state;
      }
      if (state.winnerTeam !== null) {
        decided++;
        if (state.winnerTeam === 0) seat0++;
      }
    }
    expect(decided === 0 || seat0 / decided < 0.9, `${seat0} of ${decided} decided games went to seat 0`).toBe(true);
  });
});

