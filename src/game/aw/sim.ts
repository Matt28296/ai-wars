// Seeded self-play. simulate() plays every side of a game with a simple policy until someone wins or the cycle cap is
// reached, and returns the whole record (actions, events, final state and its hash). It is how rules bugs are found
// (invariants checked after every action by sim.test.ts) and, later, how balance problems are found.
//
// Two RNGs, kept apart on purpose: state.rng (seeded by setup.seed) rolls luck inside the engine, and this file's own
// generator (seeded by `seed`) makes the policy's choices. The same setup + seed + policy therefore plays the same game,
// and replay(setup, actions) reproduces it from the action list alone.
//
// Steps stay cheap: a policy asks the engine about ONE unit (its reachable tiles and what it may do at each), never for
// the full legalActions() list of the whole side.
import { TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import { applyAction, canCaptureHere, createGame, effectiveRange, forecast, reachable, unitAt } from './index';
import type { CreateGameOptions } from './index';
import { buildActions, destinationActions, powerActions } from './legal';
import { stateHash } from './replay';
import { nextRandom, seedRng } from './rng';
import { areEnemies, manhattan } from './state';
import type { Action, Coord, GameEvent, GameState, Unit } from './types';

export type SimPolicy = 'random' | 'greedy';

export interface SimStep {
  /** Position of the action in the game's action list. */
  index: number;
  before: GameState;
  action: Action;
  after: GameState;
  events: GameEvent[];
}

export interface SimOptions {
  setup: CreateGameOptions;
  /** Seed of the policy's own RNG (the game's luck is seeded by setup.seed). */
  seed: number;
  /** Stop when this many cycles have been played without a winner. */
  maxCycles: number;
  policy: SimPolicy;
  /** Called with the starting state, before the first action. */
  onStart?: (state: GameState) => void;
  /** Called after every applied action, before the next one is chosen. */
  onStep?: (step: SimStep) => void;
}

export interface SimResult {
  state: GameState;
  actions: Action[];
  events: GameEvent[];
  /** Cycles played: the cycle the game ended in, or maxCycles when the cap stopped it. */
  cycles: number;
  winnerTeam: number | null;
  /** stateHash of the final state. */
  hash: string;
}

// ---------------------------------------------------------------- the policy's own RNG

interface Rng {
  float(): number;
  below(n: number): number;
}

function makeRng(seed: number): Rng {
  let s = seedRng(seed);
  const float = () => {
    const [v, next] = nextRandom(s);
    s = next;
    return v;
  };
  return { float, below: (n) => Math.floor(float() * n) };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.below(items.length)];
}

// ---------------------------------------------------------------- shared helpers

const waitInPlace = (u: Unit): Action => ({ kind: 'move', unitId: u.id, path: [{ x: u.x, y: u.y }], then: { kind: 'wait' } });
const endTurn = (): Action => ({ kind: 'endTurn' });
const nextUnactedUnit = (state: GameState, rng?: Rng): Unit | undefined => {
  const ready = state.units.filter((u) => u.owner === state.current && !u.acted);
  if (!ready.length) return undefined;
  return rng ? pick(rng, ready) : ready[0];
};

// ---------------------------------------------------------------- random policy

/** Chance per step to end the turn early, to use a power, and to try a build. */
const END_TURN_CHANCE = 0.04;
const POWER_CHANCE = 0.05;
const BUILD_CHANCE = 0.3;
const BUILD_WHEN_IDLE_CHANCE = 0.7;

function randomUnitAction(state: GameState, unit: Unit, rng: Rng): Action {
  const entries = [...reachable(state, unit.id).values()];
  for (let tries = 0; tries < 6 && entries.length; tries++) {
    const options = destinationActions(state, unit, pick(rng, entries));
    if (options.length) return pick(rng, options);
  }
  return waitInPlace(unit); // always legal: a unit may act where it stands
}

function randomAction(state: GameState, rng: Rng): Action {
  const roll = rng.float();
  if (roll < END_TURN_CHANCE) return endTurn();
  if (roll < END_TURN_CHANCE + POWER_CHANCE) {
    const powers = powerActions(state);
    if (powers.length) return pick(rng, powers);
  }
  const unit = nextUnactedUnit(state, rng);
  const wantsBuild = unit ? rng.float() < BUILD_CHANCE : rng.float() < BUILD_WHEN_IDLE_CHANCE;
  if (wantsBuild) {
    const builds = buildActions(state);
    if (builds.length) return pick(rng, builds);
  }
  return unit ? randomUnitAction(state, unit, rng) : endTurn();
}

// ---------------------------------------------------------------- greedy policy

/** The greedy side stops building at this many units; the battle is decided by what it already has. */
const GREEDY_UNIT_CAP = 14;

/** Expected funds won by a strike: damage dealt (capped at what the target has) minus the counter taken, at list prices. */
function attackScore(state: GameState, unit: Unit, from: Coord, target: Coord): number {
  const defender = unitAt(state, target);
  if (!defender) return 0;
  const f = forecast(state, unit.id, from, target);
  const dealt = Math.min((f.damage[0] + f.damage[1]) / 2, defender.hp);
  const taken = f.counter ? Math.min((f.counter[0] + f.counter[1]) / 2, unit.hp) : 0;
  return (dealt * UNIT_TYPES[defender.type].cost - taken * UNIT_TYPES[unit.type].cost) / 100;
}

/** The nearest thing worth walking to: a capturer heads for a property it could take, everything else for an enemy unit. */
function nearestGoal(state: GameState, unit: Unit): Coord | null {
  const nearest = (cands: Coord[]): Coord | null => {
    let best: Coord | null = null;
    let bestDist = Infinity;
    for (const c of cands) {
      const d = manhattan(unit, c);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  };
  if (UNIT_TYPES[unit.type].captures) {
    const props: Coord[] = [];
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const tile = state.tiles[y][x];
        if (!TERRAIN_TYPES[tile.terrain].property) continue;
        if (tile.owner === null || areEnemies(state, unit.owner, tile.owner)) props.push({ x, y });
      }
    }
    const goal = nearest(props);
    if (goal) return goal;
  }
  return nearest(state.units.filter((e) => areEnemies(state, unit.owner, e.owner)));
}

/** The move action in `options` whose follow-up is `kind`, if any. */
function withThen(options: Action[], kind: string): Action | undefined {
  return options.find((a) => a.kind === 'move' && a.then.kind === kind);
}

/**
 * Best strike, else a capture (finishing the one underway first), else a step toward the goal, else wait.
 * Cheap on purpose: it asks the engine what a unit may do only at the few tiles that could matter (an enemy within
 * weapon reach, a property it can take, a tile nearer the goal), never at every reachable tile.
 */
function greedyUnitAction(state: GameState, unit: Unit): Action {
  const type = UNIT_TYPES[unit.type];
  const entries = [...reachable(state, unit.id).values()];
  const here = (e: Coord) => e.x === unit.x && e.y === unit.y;

  if (type.range) {
    const enemies = state.units.filter((e) => areEnemies(state, unit.owner, e.owner));
    let best: { score: number; action: Action } | null = null;
    for (const entry of entries) {
      const reach = effectiveRange(state, unit, entry);
      if (!reach || !enemies.some((e) => manhattan(entry, e) <= reach[1])) continue;
      for (const a of destinationActions(state, unit, entry)) {
        if (a.kind !== 'move' || a.then.kind !== 'attack') continue;
        const score = attackScore(state, unit, entry, a.then.target);
        if (score > 0 && (!best || score > best.score)) best = { score, action: a };
      }
    }
    if (best) return best.action;
  }

  if (type.captures) {
    const sites = entries
      .filter((e) => canCaptureHere(state, unit, e.x, e.y))
      .sort((a, b) => (here(a) ? -1 : a.cost) - (here(b) ? -1 : b.cost)); // leaving a half-taken property throws the progress away
    for (const site of sites) {
      const capture = withThen(destinationActions(state, unit, site), 'capture');
      if (capture) return capture;
    }
  }

  const goal = type.range || type.captures ? nearestGoal(state, unit) : null;
  if (goal) {
    const now = manhattan(unit, goal);
    const nearer = entries
      .map((e) => ({ e, d: manhattan(e, goal) }))
      .filter((c) => c.d < now)
      .sort((a, b) => a.d - b.d);
    for (const c of nearer.slice(0, 8)) {
      const wait = withThen(destinationActions(state, unit, c.e), 'wait');
      if (wait) return wait;
    }
  }
  if (type.supplies) {
    const own = entries.find(here);
    const supply = own && withThen(destinationActions(state, unit, own), 'supply');
    if (supply) return supply;
  }
  return waitInPlace(unit);
}

/** The most expensive armed unit it can afford, with a little variety among the top three. */
function greedyBuild(state: GameState, rng: Rng): Action | null {
  const owned = state.units.reduce((n, u) => n + (u.owner === state.current ? 1 + u.cargo.length : 0), 0);
  if (owned >= GREEDY_UNIT_CAP) return null;
  const builds = buildActions(state).filter((a) => a.kind === 'build');
  const armed = builds.filter((a) => a.kind === 'build' && !!UNIT_TYPES[a.unitType].range);
  const pool = armed.length ? armed : builds;
  if (!pool.length) return null;
  const cost = (a: Action) => (a.kind === 'build' ? UNIT_TYPES[a.unitType].cost : 0);
  const ranked = [...pool].sort((a, b) => cost(b) - cost(a));
  return ranked[rng.below(Math.min(3, ranked.length))];
}

function greedyAction(state: GameState, rng: Rng): Action {
  const powers = powerActions(state);
  if (powers.length) return powers[powers.length - 1]; // the strongest one on offer
  const unit = nextUnactedUnit(state);
  if (unit) return greedyUnitAction(state, unit);
  return greedyBuild(state, rng) ?? endTurn();
}

// ---------------------------------------------------------------- the loop

/** Plays a whole game. Throws if the policy ever picks an action the engine refuses: that is a bug in the enumerator or the engine. */
export function simulate(opts: SimOptions): SimResult {
  const { setup, seed, maxCycles, policy } = opts;
  const rng = makeRng(seed);
  const choose = policy === 'random' ? randomAction : greedyAction;
  let state = createGame(setup);
  const actions: Action[] = [];
  const events: GameEvent[] = [];
  opts.onStart?.(state);
  const actionCap = Math.max(1, maxCycles) * state.players.length * 500;
  while (state.winnerTeam === null && state.cycle <= maxCycles) {
    if (actions.length >= actionCap) throw new Error(`simulate: ${actions.length} actions without reaching cycle ${maxCycles + 1} (policy ${policy}, seed ${seed})`);
    const action = choose(state, rng);
    const before = state;
    const result = applyAction(state, action);
    state = result.state;
    actions.push(action);
    for (const e of result.events) events.push(e);
    opts.onStep?.({ index: actions.length - 1, before, action, after: state, events: result.events });
  }
  return { state, actions, events, cycles: Math.min(state.cycle, maxCycles), winnerTeam: state.winnerTeam, hash: stateHash(state) };
}
