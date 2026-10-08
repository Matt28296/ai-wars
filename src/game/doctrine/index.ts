// Doctrine (local rules): the in-battle brain of the player's agent (D-004, D-005). A deterministic rules engine shaped by the player's
// standing orders, with no model call: it costs nothing and has no prompt for player text to reach.
//
//   decide(state, player, orders) -> the one action the agent takes next.
//
// It is called again with the new state until it returns `endTurn`. It reads ONLY what the player may know (D-016):
//   observe(state, player)       the fog-filtered observation (also what the tie-break seed is hashed from),
//   observedState(state, player) the same knowledge as a GameState, for engine queries (forecast, reachable, attackRangeTiles ...),
//   agentActions(state, player)  the legal actions, on that knowledge.
// Every action it returns is an element of that list. It never applies an action, never reads the true state's rng, nextUnitId or
// the other players' stats, and never advances state.rng: ties are broken by a local generator seeded from a hash of the observation
// and the orders, so the same state and orders always give the same action, and the same decision is made with or without enemy
// units the player cannot see.
//
// Termination: every call acts with an un-acted unit, builds (spending funds on a free production tile), uses a power (once, since it
// then reads as active), or ends the turn. Un-acted units with nothing worth doing are simply not acted.
import { applyAction, createGame } from '../aw';
import type { CreateGameOptions } from '../aw';
import { agentActions, observe, observedState } from '../aw/observe';
import { canonicalJson, fnv1a64 } from '../aw/replay';
import { nextRandom, seedRng } from '../aw/rng';
import type { Action, GameState, PlayerIndex } from '../aw/types';
import { buildCtx } from './eval';
import type { Ctx } from './eval';
import { validateOrders } from './orders';
import type { StandingOrders } from './orders';
import { bestUnitAction, groupByUnit } from './plan';
import { choosePower } from './power';
import { chooseBuild } from './production';

export * from './orders';

/** A deterministic picker: `pick(n)` is an integer in [0, n), from a generator seeded (on first use) by `seed()`. */
function makePicker(seed: () => number): (n: number) => number {
  let s: number | null = null;
  return (n) => {
    if (s === null) s = seedRng(seed());
    const [f, next] = nextRandom(s);
    s = next;
    return Math.floor(f * n);
  };
}

/** The seed: a hash of what the player sees plus the orders. Nothing hidden is in it (not rng, nextUnitId or enemy stats). */
function seedFrom(ctx: Ctx): number {
  const o = ctx.obs;
  const digest = {
    viewer: o.viewer, cycle: o.cycle, current: o.current, map: o.mapId, units: o.units, players: o.players,
    props: ctx.props, orders: ctx.orders,
  };
  return parseInt(fnv1a64(canonicalJson(digest)).slice(0, 8), 16) | 0;
}

/**
 * The next action for `player` in `state`, shaped by `orders`. Throws TypeError when the orders are not valid (see validateOrders)
 * and RangeError when it is not that player's turn (or the game is over): there is then no action to return.
 */
export function decide(state: GameState, player: PlayerIndex, orders: StandingOrders): Action {
  const o = validateOrders(orders);
  const actions = agentActions(state, player);
  if (!actions.length) throw new RangeError(`decide: player ${player} has no action (it is not their turn, or the game is over)`);
  const obs = observe(state, player);
  const view = observedState(state, player);
  const ctx = buildCtx(view, obs, player, o);
  const pick = makePicker(() => seedFrom(ctx));

  const start = choosePower(ctx, actions, 'start');
  if (start) return start;
  const unit = bestUnitAction(ctx, groupByUnit(actions), pick);
  if (unit) return unit.action;
  const end = choosePower(ctx, actions, 'end');
  if (end) return end;
  const build = chooseBuild(ctx, actions, pick);
  if (build) return build;
  return actions.find((a) => a.kind === 'endTurn') ?? { kind: 'endTurn' };
}

// ---------------------------------------------------------------- playing whole games with Doctrine

export interface PlayOptions {
  /** Stop when this many cycles have been played without a winner. */
  maxCycles: number;
  /** Called after every action with the state it was applied to, the action and the state after it. */
  onStep?: (before: GameState, action: Action, after: GameState) => void;
}

export interface PlayResult {
  state: GameState;
  actions: Action[];
  /** The cycle the game ended in, or maxCycles when the cap stopped it. */
  cycles: number;
  winnerTeam: number | null;
}

/**
 * Plays a game with Doctrine in every seat. `orders` is one set for everybody, or one per player (index = player). The game's luck
 * comes from the setup's seed, so the same setup and orders replay the same game.
 */
export function playDoctrine(setup: CreateGameOptions, orders: StandingOrders | StandingOrders[], opts: PlayOptions): PlayResult {
  let state = createGame(setup);
  const actions: Action[] = [];
  const cap = Math.max(1, opts.maxCycles) * state.players.length * 400;
  while (state.winnerTeam === null && state.cycle <= opts.maxCycles) {
    if (actions.length >= cap) throw new Error(`playDoctrine: ${actions.length} actions without reaching cycle ${opts.maxCycles + 1}`);
    const mine = Array.isArray(orders) ? orders[state.current] : orders;
    const action = decide(state, state.current, mine);
    const after = applyAction(state, action).state;
    actions.push(action);
    opts.onStep?.(state, action, after);
    state = after;
  }
  return { state, actions, cycles: Math.min(state.cycle, opts.maxCycles), winnerTeam: state.winnerTeam };
}
