// The match host (A1): one campaign mission, played by a CONNECTED AGENT (seat 0, D-007) against Doctrine (local rules) in every other seat.
// Pure: no I/O, no clock, no randomness of its own. The game's luck is the setup's seed, so a record (setup + actions) replays exactly.
//
// The setup is the one Deploy plays (`deploySetup`: the mission's seed, `firstMoverRule: 'none'`, D-019), under the same 30-cycle cap
// (`DEPLOY_MAX_CYCLES`). The agent acts through two doors only, and both are fog-honest (D-016):
//   what it is TOLD   observation()  = observe(state, seat); legal() = agentActions(state, seat); events = viewEvents(before, after, events, seat)
//   what it may DO    act(id)        = one action whose id (actionKey) is in the current legal list; endTurn()
// The true state never leaves this class except through `trueState()`, which exists for tests and is documented as such.
//
// Ending the agent's turn plays the other seats with Doctrine until it is the agent's turn again, the game is decided, the agent's seat is
// out, or the cap is reached. Every applied action, the agent's and Doctrine's, is announced to subscribers in order, then the result.
//
// G14: the browser's Deploy plays seat 0 with Doctrine too, under the orders the player has set (`playOwnTurn(orders)`). The orders in force
// at the start of each of seat 0's turns are kept with the index of the action they start at (`orderChanges()`), so the record says which
// orders each action was chosen under and a replay stays exact (D-022). `continueAfterDefeat` plays on when only the agent's seat is out,
// as Deploy always has. None of this is reachable through the MCP tools: they never call playOwnTurn and never set the option.
//
// G19 (D-022): the person can change the connected agent's orders at any time (`setOrders`). The change WAITS (`pendingOrders`) and comes into
// force when the agent's next turn starts, which is the moment `endTurn` hands the turn back (`ordersChanged`). `orders()` is always the set in
// force for the turn now being played, so a change made during the agent's own turn, or during Doctrine's, is never seen sooner. The match
// keeps the same `orderChanges()` log the browser's Deploy does, so a record says which orders each of the agent's turns was played under.
// The typed note (D-025) is not here: a match holds orders and nothing a person wrote.
import type { Mission } from '../content/types';
import { IllegalActionError, applyAction, buildOptions, createGame, powerCost, resolvedSetup, unitAt } from '../game/aw';
import type { Action, Coord, CreateGameOptions, GameEvent, GameState, PlayerIndex, UnitTypeId } from '../game/aw';
import { actionKey } from '../game/aw/legal';
import { agentActions, observe, observedState } from '../game/aw/observe';
import type { Observation } from '../game/aw/observe';
import { canonicalJson, stateHash } from '../game/aw/replay';
import { viewEvents } from '../game/aw/view-events';
import { DEFAULT_ORDERS, decide, validateOrders } from '../game/doctrine';
import type { StandingOrders } from '../game/doctrine';
import { DEPLOY_MAX_CYCLES, deploySetup } from '../ui/front/deploy';
import { firstLiveStep, nextLiveStep } from './live';
import type { LiveStep } from './live';

/** The seat the connected agent plays (D-007: the player's agent is the first slot of every mission). */
export const AGENT_SEAT: PlayerIndex = 0;
/** The match stops at this cycle if nobody has won, the same cap a deployed mission has. */
export const AGENT_CYCLE_CAP = DEPLOY_MAX_CYCLES;
/** Doctrine plays at most this many actions in one agent turn: a runaway loop throws instead of hanging the server. */
const MAX_DOCTRINE_STEPS = 6000;

export type Mover = 'agent' | 'doctrine';

export interface MatchResult {
  /** 'victory': a team won. 'defeat': the agent's seat is out and nobody has won. 'cap': the cycle cap stopped the match. */
  reason: 'victory' | 'defeat' | 'cap';
  winnerTeam: number | null;
  /** From the agent's side: won, lost, or undecided (the cap). */
  outcome: 'won' | 'lost' | 'undecided';
  /** The cycle the match ended in, or the cap when the cap stopped it (as playDoctrine reports it). */
  cycles: number;
}

/**
 * What subscribers are told, in order, for each applied action: `action` (the TRUE action, with the seat and who chose it: for the match's
 * own bookkeeping and tests, never to be forwarded to a viewer), then `step` (the same step as the agent's side sees it: safe to show), and
 * after the last one, at most one `result`.
 */
export type MatchEvent =
  | { type: 'action'; index: number; seat: PlayerIndex; by: Mover; action: Action }
  | { type: 'step'; step: LiveStep }
  | { type: 'result'; result: MatchResult };

export type LegalKind = 'wait' | 'attack' | 'capture' | 'load' | 'join' | 'supply' | 'unload' | 'build' | 'power';

/** One thing the agent may do now, described from what it knows. `id` is the action's actionKey. */
export interface LegalEntry {
  id: string;
  action: Action;
  kind: LegalKind;
  /** The acting unit (moves) and where it stands. */
  unit?: number;
  from?: Coord;
  /** Where the move ends, or the build site. */
  to?: Coord;
  /** attack: the tile and the visible enemy unit on it. */
  target?: { x: number; y: number; unit: number };
  /** load / join: the friendly unit at the destination. */
  withUnit?: number;
  /** unload: which cargo goes where. `unit` is the cargo unit's id. */
  drops?: { cargo: number; unit: number; to: Coord }[];
  /** build */
  unitType?: UnitTypeId;
  cost?: number;
  /** power */
  level?: 'surge' | 'overclock';
}

export type RefusalReason = 'game-over' | 'not-your-turn' | 'unknown-action' | 'rejected';
export interface Refusal { ok: false; reason: RefusalReason; message: string }
export type ActOutcome = { ok: true; id: string; events: GameEvent[] } | Refusal;
/** `played` is how many actions Doctrine took for the other seats. */
export type EndTurnOutcome = { ok: true; events: GameEvent[]; played: number; ordersChanged?: boolean } | Refusal;

export interface AgentRecord {
  setup: CreateGameOptions;
  actions: Action[];
  result: MatchResult | null;
}

/**
 * The orders seat 0 played under, from one of its turns on (G14, D-022). `from` is the index of the first action of that turn (the number
 * of actions applied before it); `cycle` is the cycle it was played in. The first entry is always `from: 0`, and a later one is written only
 * when the orders differ from the entry before it. Orders are the validated copy.
 */
export interface OrderChange {
  from: number;
  cycle: number;
  orders: StandingOrders;
}

/** The record with the orders each of seat 0's turns was played under. `record()` itself is unchanged: the MCP feed serves that one. */
export interface OrderedRecord extends AgentRecord {
  orderChanges: OrderChange[];
}

/** What the tools need from a match. AgentMatch is the real one; tests substitute leaky ones to prove the checks catch a leak. */
export interface MatchHost {
  readonly mission: Mission;
  readonly seat: PlayerIndex;
  readonly cap: number;
  readonly setup: CreateGameOptions;
  observation(): Observation;
  /** The latest step as the agent's side sees it (index 0 before any action): safe to hand to a viewer while the match runs. */
  latestStep(): LiveStep;
  /** The agent's own meter costs for Surge and Overclock; null where its commander has no such power. */
  powerCosts(): { surge: number | null; overclock: number | null };
  legal(): readonly LegalEntry[];
  act(id: string): ActOutcome;
  endTurn(): EndTurnOutcome;
  result(): MatchResult | null;
  /** The orders in force for the turn being played now. */
  orders(): StandingOrders;
  /** G19: the orders waiting for the agent's next turn, or null. */
  pendingOrders(): StandingOrders | null;
  /**
   * G19 (D-022): the person's new orders. They are validated (TypeError otherwise) and wait for the agent's next turn; setting orders equal to the
   * ones in force takes the waiting set back. Returns whether a set now waits.
   */
  setOrders(next: unknown): { pending: boolean };
  /** G19: the orders each of the agent's turns was played under, each with the action index it applies from (a copy). */
  orderChanges(): OrderChange[];
  record(): AgentRecord;
  subscribe(listener: (e: MatchEvent) => void): () => void;
}

export interface MatchOptions {
  /** Stop at this cycle (default AGENT_CYCLE_CAP). */
  maxCycles?: number;
  /**
   * The game's luck seed. Default: the mission's Deploy seed, so tests and replays are fixed. The real server passes a fresh random one per
   * match: with a known seed, an agent with a shell could replay the match offline from the open engine and see through fog.
   */
  seed?: number;
  /** The agent's standing orders as the orders screen set them (G14); validated. Default DEFAULT_ORDERS. */
  orders?: StandingOrders;
  /** Plays a non-agent seat: its next action for `state.current`. Default: Doctrine with DEFAULT_ORDERS. */
  driver?: (state: GameState, seat: PlayerIndex) => Action;
  /** Told when a subscriber throws. A failing subscriber never stops a match. */
  onSubscriberError?: (err: unknown) => void;
  /**
   * G14: do not end the match when the agent's seat alone is out and nobody has won; play the others on to a winner or the cap, as Deploy
   * (playDoctrine) does when an ally still stands. Default false: the MCP match ends as a defeat.
   */
  continueAfterDefeat?: boolean;
}

const refuse = (reason: RefusalReason, message: string): Refusal => ({ ok: false, reason, message });
const copyCoord = (c: Coord): Coord => ({ x: c.x, y: c.y });

export class AgentMatch implements MatchHost {
  readonly mission: Mission;
  readonly seat: PlayerIndex = AGENT_SEAT;
  readonly cap: number;
  /** The setup as played, first-mover rule written in: what `recordMatch` and `replay` take. */
  readonly setup: CreateGameOptions;

  private state: GameState;
  private readonly actions: Action[] = [];
  private finished: MatchResult | null = null;
  private lastStep: LiveStep;
  private inForce: StandingOrders;
  /** G19: the person's latest orders when they differ from the ones in force; read at the start of the agent's next turn. */
  private waiting: StandingOrders | null = null;
  private readonly driver: (state: GameState, seat: PlayerIndex) => Action;
  private readonly continueAfterDefeat: boolean;
  private readonly orderLog: OrderChange[] = [];
  private readonly listeners = new Set<(e: MatchEvent) => void>();
  private readonly onSubscriberError: (err: unknown) => void;
  private cache: { state: GameState; entries: LegalEntry[]; byId: Map<string, LegalEntry> } | null = null;

  constructor(mission: Mission, opts: MatchOptions = {}) {
    const cap = opts.maxCycles ?? AGENT_CYCLE_CAP;
    if (!Number.isInteger(cap) || cap < 1) throw new RangeError(`maxCycles must be a whole number >= 1, got ${String(cap)}`);
    this.mission = mission;
    this.cap = cap;
    if (opts.seed !== undefined && !Number.isSafeInteger(opts.seed)) throw new RangeError(`seed must be a whole number, got ${String(opts.seed)}`);
    this.setup = resolvedSetup({ ...deploySetup(mission), ...(opts.seed !== undefined ? { seed: opts.seed } : {}) });
    this.inForce = validateOrders(opts.orders ?? DEFAULT_ORDERS);
    this.driver = opts.driver ?? ((state, seat) => decide(state, seat, DEFAULT_ORDERS));
    this.onSubscriberError = opts.onSubscriberError ?? (() => {});
    this.continueAfterDefeat = opts.continueAfterDefeat === true;
    this.state = createGame(this.setup);
    this.lastStep = firstLiveStep(this.state, this.seat);
    this.logOrders(this.inForce);
    this.settle();
  }

  // ------------------------------------------------------------ what the agent is told

  /** The agent's view: observe(state, seat). Never the true state (D-016). */
  observation(): Observation {
    return observe(this.state, this.seat);
  }

  /** The agent's own meter costs (its own commander and activations: nothing about anybody else). */
  powerCosts(): { surge: number | null; overclock: number | null } {
    const cost = (level: 'surge' | 'overclock'): number | null => {
      const c = powerCost(this.state, this.seat, level);
      return Number.isFinite(c) ? c : null; // Infinity = this commander has no such power
    };
    return { surge: cost('surge'), overclock: cost('overclock') };
  }

  /** The agent's legal actions, each with a stable id (actionKey). `endTurn` is not in the list: it is the end_turn tool. Empty when it is not the agent's turn or the match is over. */
  legal(): readonly LegalEntry[] {
    return this.legalIndex().entries;
  }

  latestStep(): LiveStep {
    return this.lastStep;
  }

  result(): MatchResult | null {
    return this.finished ? { ...this.finished } : null;
  }

  orders(): StandingOrders {
    return structuredClone(this.inForce);
  }

  pendingOrders(): StandingOrders | null {
    return this.waiting ? structuredClone(this.waiting) : null;
  }

  setOrders(next: unknown): { pending: boolean } {
    const o = validateOrders(next);
    this.waiting = canonicalJson(o) === canonicalJson(this.inForce) ? null : o;
    return { pending: this.waiting !== null };
  }

  /** The record so far: the setup and every applied action in order (a copy), and the result once there is one. */
  record(): AgentRecord {
    return { setup: this.setup, actions: structuredClone(this.actions), result: this.result() };
  }

  /**
   * The orders seat 0's turns were played under, turn by turn (a copy): the first entry is the orders the match began with (from 0), and a later
   * one is written only when the orders of a turn differ from the turn before (the agent's, when it takes the turn that changed them; or
   * `playOwnTurn`'s).
   */
  orderChanges(): OrderChange[] {
    return structuredClone(this.orderLog);
  }

  /** `record()` plus `orderChanges()`: what the browser's Deploy hands the debrief and a replay. */
  recordWithOrders(): OrderedRecord {
    return { ...this.record(), orderChanges: this.orderChanges() };
  }

  /** Told of each applied action as it happens, then the result. Returns the way to unsubscribe. */
  subscribe(listener: (e: MatchEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ------------------------------------------------------------ what the agent may do

  /** Applies the legal action with this id, and nothing else. Anything else is refused with a reason. */
  act(id: string): ActOutcome {
    if (this.finished) return refuse('game-over', 'The match is over. Call start_mission to play again.');
    if (this.state.current !== this.seat) return refuse('not-your-turn', 'It is not your seat\'s turn.');
    const entry = this.legalIndex().byId.get(id);
    if (!entry) return refuse('unknown-action', 'That action id is not in the current legal list. Call legal_actions and copy an id exactly.');
    try {
      return { ok: true, id, events: this.step(entry.action, 'agent') };
    } catch (err) {
      // The legal list is sound (observe.test.ts property b), so this should not happen; if it does, say nothing the engine knows and the agent does not.
      if (err instanceof IllegalActionError) return refuse('rejected', 'The engine refused that action. Call legal_actions again.');
      throw err;
    }
  }

  /** Ends the agent's turn, then plays the other seats with Doctrine until it is the agent's turn again or the match is over. */
  endTurn(): EndTurnOutcome {
    if (this.finished) return refuse('game-over', 'The match is over. Call start_mission to play again.');
    if (this.state.current !== this.seat) return refuse('not-your-turn', 'It is not your seat\'s turn.');
    const events = this.step({ kind: 'endTurn' }, 'agent');
    const played = this.playOthers(events);
    return { ok: true, events, played, ordersChanged: this.beginTurn() };
  }

  /**
   * G14: plays the agent's seat's whole turn with Doctrine under `orders` (default: the orders the match was made with), then the other
   * seats as `endTurn` does. The orders are the ones in force for this turn only; they are written to `orderChanges()` when they differ from
   * the turn before. `played` counts every action Doctrine took, the agent's seat included. Refused like `endTurn` when it is not the turn.
   */
  playOwnTurn(orders?: StandingOrders): EndTurnOutcome {
    if (this.finished) return refuse('game-over', 'The match is over. Call start_mission to play again.');
    if (this.state.current !== this.seat) return refuse('not-your-turn', 'It is not your seat\'s turn.');
    const o = validateOrders(orders ?? this.inForce);
    this.logOrders(o);
    const events: GameEvent[] = [];
    let own = 0;
    while (!this.finished && this.state.current === this.seat) {
      if (own >= MAX_DOCTRINE_STEPS) throw new Error(`doctrine took ${own} actions in one turn without ending it`);
      for (const e of this.step(decide(this.state, this.seat, o), 'doctrine')) events.push(e);
      own++;
    }
    return { ok: true, events, played: own + this.playOthers(events) };
  }

  /**
   * The agent's turn has just started (or the match ended): the orders the person left waiting come into force now, and never sooner (D-022).
   * Returns true when that changed the orders in force.
   */
  private beginTurn(): boolean {
    const next = this.waiting;
    if (!next || this.finished || this.state.current !== this.seat) return false;
    this.waiting = null;
    this.inForce = next;
    this.logOrders(next);
    return true;
  }

  /**
   * Writes down the orders the turn starting now is played under: nothing when they are the ones the turn before had, a replacement when the log
   * already holds an entry from this very action (the match's first orders, then `playOwnTurn`'s for the first turn), else a new entry.
   */
  private logOrders(o: StandingOrders): void {
    const last = this.orderLog[this.orderLog.length - 1];
    const at = this.actions.length;
    const entry: OrderChange = { from: at, cycle: this.state.cycle, orders: structuredClone(o) };
    if (!last) this.orderLog.push(entry);
    else if (canonicalJson(last.orders) === canonicalJson(o)) return;
    else if (last.from === at) this.orderLog[this.orderLog.length - 1] = entry;
    else this.orderLog.push(entry);
  }

  /** Plays the other seats with Doctrine until it is the agent's turn again or the match is over; returns how many actions it took. */
  private playOthers(events: GameEvent[]): number {
    let played = 0;
    while (!this.finished && this.state.current !== this.seat) {
      if (played >= MAX_DOCTRINE_STEPS) throw new Error(`doctrine took ${played} actions in one turn without handing the turn back`);
      for (const e of this.step(this.driver(this.state, this.state.current), 'doctrine')) events.push(e);
      played++;
    }
    return played;
  }

  // ------------------------------------------------------------ for tests only

  /** THE TRUE STATE, hidden units included. For tests that check the agent was told no more than it may know. Never send it anywhere. */
  trueState(): GameState {
    return this.state;
  }

  /** stateHash of the true state, to compare with a replay of the record. */
  trueStateHash(): string {
    return stateHash(this.state);
  }

  // ------------------------------------------------------------ internals

  private emit(e: MatchEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e);
      } catch (err) {
        this.onSubscriberError(err);
      }
    }
  }

  /** Applies one action to the true state, records and announces it, and returns the events the AGENT may see (viewEvents). */
  private step(action: Action, by: Mover): GameEvent[] {
    const before = this.state;
    const seat = before.current;
    const { state: after, events } = applyAction(before, action);
    const seen = [...viewEvents(before, after, events, this.seat)];
    this.state = after;
    this.cache = null;
    const index = this.actions.length;
    this.actions.push(structuredClone(action));
    // The live step carries the action only when the agent's own seat took it: another seat's action names units the agent may not know.
    this.lastStep = nextLiveStep(this.lastStep, { after, seen, action: seat === this.seat ? action : null, seat: this.seat });
    this.emit({ type: 'action', index, seat, by, action: structuredClone(action) });
    this.emit({ type: 'step', step: this.lastStep });
    this.settle();
    return seen;
  }

  /** Ends the match when it has ended: a winner, the agent's seat out, or the cycle cap. Announces the result once. */
  private settle(): void {
    if (this.finished) return;
    const s = this.state;
    let reason: MatchResult['reason'];
    if (s.winnerTeam !== null) reason = 'victory';
    else if (s.players[this.seat].defeated && !this.continueAfterDefeat) reason = 'defeat';
    else if (s.cycle > this.cap) reason = 'cap';
    else return;
    const mine = s.players[this.seat].team;
    const outcome: MatchResult['outcome'] = s.winnerTeam === null
      ? (reason === 'defeat' ? 'lost' : 'undecided')
      : (s.winnerTeam === mine ? 'won' : 'lost');
    this.finished = { reason, winnerTeam: s.winnerTeam, outcome, cycles: Math.min(s.cycle, this.cap) };
    this.emit({ type: 'result', result: { ...this.finished } });
  }

  private legalIndex(): { entries: LegalEntry[]; byId: Map<string, LegalEntry> } {
    if (this.cache && this.cache.state === this.state) return this.cache;
    const entries: LegalEntry[] = [];
    const byId = new Map<string, LegalEntry>();
    if (!this.finished && this.state.current === this.seat) {
      const view = observedState(this.state, this.seat);
      for (const a of agentActions(this.state, this.seat)) {
        if (a.kind === 'endTurn' || a.kind === 'resign') continue;
        const id = actionKey(a);
        if (byId.has(id)) continue; // two actions with one key do the same thing
        const entry = describeAction(view, id, a);
        entries.push(entry);
        byId.set(id, entry);
      }
    }
    this.cache = { state: this.state, entries, byId };
    return this.cache;
  }
}

/** Describes one legal action from the agent's knowledge. `view` is observedState: every unit named here is one the agent can see. */
function describeAction(view: GameState, id: string, a: Action): LegalEntry {
  if (a.kind === 'build') {
    const cost = buildOptions(view, a.at).find((o) => o.type === a.unitType)?.cost;
    return { id, action: a, kind: 'build', to: copyCoord(a.at), unitType: a.unitType, ...(cost !== undefined ? { cost } : {}) };
  }
  if (a.kind === 'power') return { id, action: a, kind: 'power', level: a.level };
  if (a.kind !== 'move') throw new Error(`describeAction: no description for a ${a.kind} action`);

  const mover = view.units.find((u) => u.id === a.unitId);
  if (!mover) throw new Error(`describeAction: unit ${a.unitId} is not in the agent's view`);
  const dest = a.path[a.path.length - 1];
  const base = { id, action: a, unit: mover.id, from: { x: mover.x, y: mover.y }, to: copyCoord(dest) };
  const then = a.then;
  switch (then.kind) {
    case 'attack': {
      const target = unitAt(view, then.target);
      if (!target) throw new Error('describeAction: an attack on a tile with no visible unit');
      return { ...base, kind: 'attack', target: { x: then.target.x, y: then.target.y, unit: target.id } };
    }
    case 'load':
    case 'join': {
      const other = view.units.find((u) => u.id !== mover.id && u.x === dest.x && u.y === dest.y);
      return { ...base, kind: then.kind, ...(other ? { withUnit: other.id } : {}) };
    }
    case 'unload':
      return {
        ...base, kind: 'unload',
        drops: then.drops.map((d) => ({ cargo: d.cargoIndex, unit: mover.cargo[d.cargoIndex]?.id ?? -1, to: copyCoord(d.to) })),
      };
    default:
      return { ...base, kind: then.kind };
  }
}
