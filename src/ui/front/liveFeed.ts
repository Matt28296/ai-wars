// The page's side of the agent's feed (G17), pure of React: what to do with each message, and how the link to `/live` is opened.
//
// D-016, WHILE THE MATCH RUNS the feed is the connected agent's own view and nothing else, so the page holds nothing else: no setup, no actions,
// no record. It reads `/live` only (an EventSource on this page's own origin). It never asks for `/record` (the server answers 409 until the match
// is over anyway), and nothing is built from a record until the `record` message arrives: that message is the only door to the "All" view.
//
//   setup    a new match: the view starts over (every setup does, a reconnect's replay included: the feed replays from its first message)
//   step     the next step, as the agent's side sees it. Appended in order; a repeat or a gap is ignored
//   result   the match is over
//   record   the whole truth, only now. The "All" view and the debrief are built from it
import type { LiveMessage, LiveRecord, LiveStep } from '../../agent/live';
import type { MatchResult } from '../../agent/match';
import type { PlayerIndex } from '../../game/aw';

export interface LiveViewState {
  /** 'waiting': no mission announced yet. 'playing': a match is on. 'over': the whole record has arrived. */
  phase: 'waiting' | 'playing' | 'over';
  /** How many setups have been seen. A new one starts the view over, and this number is what remounts it. */
  epoch: number;
  /** The feed's own number for the match (1 for the first of the server process), 0 before any. */
  match: number;
  mission: string | null;
  seat: PlayerIndex;
  cycleCap: number;
  /** The agent's own view of the match so far, step 0 first. A new array each time a step arrives; the steps in it are the same objects. */
  steps: readonly LiveStep[];
  result: MatchResult | null;
  /** The whole truth, after the match and not before. */
  record: LiveRecord | null;
}

export const WAITING: LiveViewState = { phase: 'waiting', epoch: 0, match: 0, mission: null, seat: 0, cycleCap: 0, steps: [], result: null, record: null };

/** The state after one message. Messages of another match than the current one are stale and change nothing. */
export function reduceLive(state: LiveViewState, msg: LiveMessage): LiveViewState {
  if (msg.type === 'setup') {
    return { phase: 'playing', epoch: state.epoch + 1, match: msg.match, mission: msg.mission, seat: msg.seat, cycleCap: msg.cycleCap, steps: [], result: null, record: null };
  }
  if (state.phase === 'waiting' || msg.match !== state.match) return state;
  switch (msg.type) {
    case 'step':
      if (state.phase === 'over' || msg.step.index !== state.steps.length) return state;
      return { ...state, steps: [...state.steps, msg.step] };
    case 'result':
      return { ...state, result: msg.result };
    case 'record':
      return { ...state, phase: 'over', result: state.result ?? msg.record.result, record: msg.record };
  }
}

const TYPES: ReadonlySet<string> = new Set(['setup', 'step', 'result', 'record']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A feed message from its JSON text, or null for anything that is not one (the page ignores what it does not understand). */
export function parseLiveMessage(text: string): LiveMessage | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(m) || typeof m.type !== 'string' || !TYPES.has(m.type) || !Number.isInteger(m.match)) return null;
  switch (m.type) {
    case 'setup':
      return typeof m.mission === 'string' && Number.isInteger(m.seat) && Number.isInteger(m.cycleCap) ? (m as unknown as LiveMessage) : null;
    case 'step': {
      const s = m.step;
      return isObj(s) && Number.isInteger(s.index) && isObj(s.frame) && Array.isArray(s.events) && Array.isArray(s.powerUses) ? (m as unknown as LiveMessage) : null;
    }
    case 'result':
      return isObj(m.result) ? (m as unknown as LiveMessage) : null;
    default: {
      const r = m.record;
      return isObj(r) && isObj(r.setup) && Array.isArray(r.actions) && isObj(r.result) ? (m as unknown as LiveMessage) : null;
    }
  }
}

// ---------------------------------------------------------------- the link

/** 'connecting': not heard yet. 'open': the feed answered. 'reconnecting': it was there and dropped. 'unavailable': there is no feed here. */
export type LinkStatus = 'connecting' | 'open' | 'reconnecting' | 'unavailable';

/** The part of the browser's EventSource this page uses, so a scripted one can stand in for it in tests. */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  addEventListener(type: string, listener: (e: { data: unknown }) => void): void;
  close(): void;
}
export type MakeEventSource = (url: string) => EventSourceLike;

/** EventSource.CLOSED. A page that is not an event stream (the dev server's index.html, a hosted copy's 404) ends up here and never retries. */
const CLOSED = 2;

export interface LiveLink {
  close(): void;
}

/**
 * Opens `/live` and reports what arrives. Before the first `open`, any error means there is no feed here ('unavailable'; the browser may keep
 * trying, and if a feed does appear the status turns 'open'). After one, an error means the link dropped and the browser is reconnecting.
 */
export function openLive(url: string, on: { message: (m: LiveMessage) => void; status: (s: LinkStatus) => void }, make: MakeEventSource = (u) => new EventSource(u) as unknown as EventSourceLike): LiveLink {
  const es = make(url);
  let everOpen = false;
  on.status('connecting');
  es.onopen = () => {
    everOpen = true;
    on.status('open');
  };
  es.onerror = () => {
    on.status(es.readyState === CLOSED ? 'unavailable' : everOpen ? 'reconnecting' : 'unavailable');
  };
  for (const type of TYPES) {
    es.addEventListener(type, (e) => {
      if (typeof e.data !== 'string') return;
      const m = parseLiveMessage(e.data);
      if (m) on.message(m);
    });
  }
  return { close: () => es.close() };
}
