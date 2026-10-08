// The shapes the live feed sends (A1b), for the browser's battle screen (G17) to read. Types and two pure builders; nothing here touches
// node, the network or a clock, so the browser can import it.
//
// D-016: WHILE A MATCH RUNS the feed is the player's own view and nothing else. Claude Code agents have a shell, so anything a local port serves
// is something the agent can read; the feed therefore sends, for each step, exactly what `viewTimeline(recordMatch(...), seat)` would give for
// that step: the ViewFrame (observe), the events the seat may see (viewEvents) and the power uses. The step's `action` is sent only when the
// seat itself took it: another side's action names units the seat may not know. The whole truth (setup and every action) is served only once
// the match is over.
import type { Action, CreateGameOptions, GameEvent, GameState, PlayerIndex } from '../game/aw';
import { observe } from '../game/aw/observe';
import type { TimelineStep } from '../ui/watch/timeline';
import type { MatchResult } from './match';

/**
 * One step of a running match, as the agent's side sees it: the same shape as a `TimelineStep` of `viewTimeline(record, seat)`.
 *   index       0 is the start of the match; step i is the state after action i - 1 (of any seat).
 *   action      the action that led here, ONLY when the seat itself took it; null for every other seat's action (and at step 0).
 *   frame       observe(state, seat): the map, the units the seat can see, the visible mask, the players' public lines.
 *   events      viewEvents(before, after, events, seat): what the seat could see happen.
 *   powerUses   power activations so far, per player (counted from `powerActivated`, which every viewer receives).
 */
export type LiveStep = TimelineStep;

/** What a step needs besides the new state: the events the seat may see and, when the seat itself acted, its action. */
export interface NextStepInput {
  /** The state after the action. */
  after: GameState;
  /** The events of the action as `viewEvents` returned them for the seat. */
  seen: readonly GameEvent[];
  /** The action, or null when another seat took it. */
  action: Action | null;
  seat: PlayerIndex;
}

/** Step 0: the start of the match, as `seat` sees it. */
export function firstLiveStep(state: GameState, seat: PlayerIndex): LiveStep {
  return { index: 0, action: null, frame: observe(state, seat), events: [], powerUses: new Array<number>(state.players.length).fill(0) };
}

/** The step after `prev`. The result shares nothing with its inputs. */
export function nextLiveStep(prev: LiveStep, input: NextStepInput): LiveStep {
  const events = structuredClone([...input.seen]);
  const powerUses = prev.powerUses.slice();
  for (const e of events) if (e.kind === 'powerActivated') powerUses[e.player] += 1;
  return {
    index: prev.index + 1,
    action: input.action ? structuredClone(input.action) : null,
    frame: observe(input.after, input.seat),
    events,
    powerUses,
  };
}

// ---------------------------------------------------------------- the messages (Server-Sent Events: `event: <type>` + `data: <json>`)

/** Sent first. Public facts only: the mission id, the seat, the cap. The map and the units come with the steps, as the seat sees them. */
export interface LiveSetupMessage {
  type: 'setup';
  /** 1 for the first match of the server process, and so on. A new `setup` means a new match: start over. */
  match: number;
  mission: string;
  seat: PlayerIndex;
  cycleCap: number;
}
/** One step, in order, starting at index 0. */
export interface LiveStepMessage {
  type: 'step';
  match: number;
  step: LiveStep;
}
/** The match is over. */
export interface LiveResultMessage {
  type: 'result';
  match: number;
  /** How many steps were sent (the start included). */
  steps: number;
  result: MatchResult;
}
/** Sent after the result, never before: the whole truth, for the post-match "All" view (`recordMatch(record.setup, record.actions)`). */
export interface LiveRecordMessage {
  type: 'record';
  match: number;
  record: LiveRecord;
}
export type LiveMessage = LiveSetupMessage | LiveStepMessage | LiveResultMessage | LiveRecordMessage;

/** The whole match: exactly what `recordMatch` takes, plus the result. Served by GET /record and by the `record` message only once the match is over. */
export interface LiveRecord {
  match: number;
  mission: string;
  seat: PlayerIndex;
  cycleCap: number;
  setup: CreateGameOptions;
  actions: Action[];
  result: MatchResult;
}
