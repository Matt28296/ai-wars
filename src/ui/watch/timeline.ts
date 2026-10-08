// The timeline model of the watch-only battle viewer (M5.0).
//
// A match is recorded once (every GameState along the way, and the raw events of every action), and then each VIEWER gets
// its own timeline over it:
//   - a player viewer sees ONLY observe(state, viewer) for its frames and ONLY viewEvents(before, after, events, viewer)
//     for its events (D-016). Nothing in a player's timeline is read from the true state except through those two doors.
//   - 'all' is the omniscient post-match view: the true state and the raw events.
//
// The engine's replay() returns only the final state, so the per-step states are produced by the same two primitives it
// uses (createGame, then applyAction per action). timeline.test.ts checks the result against replay() itself.
import { IllegalActionError, applyAction, createGame } from '../../game/aw';
import type { Action, CreateGameOptions, GameEvent, GameState, PlayerIndex, Unit } from '../../game/aw';
import { observe } from '../../game/aw/observe';
import type { Observation, ObservedPlayer, ObservedTile } from '../../game/aw/observe';
import { viewEvents } from '../../game/aw/view-events';

/** A player index, or 'all' for the omniscient post-match view. */
export type Viewer = PlayerIndex | 'all';

/** What one viewer knows of the battle at one moment: an Observation, or the whole truth for 'all'. */
export type ViewFrame = Omit<Observation, 'viewer'> & { viewer: Viewer };

/** Everything that happened in a match, kept once and shared by every viewer's timeline. */
export interface MatchRecord {
  setup: CreateGameOptions;
  actions: Action[];
  /** states[0] is the start (after the first turn's start-of-turn); states[i + 1] is the state after actions[i]. */
  states: GameState[];
  /** rawEvents[i] are ALL the events of actions[i], hidden units included. Never hand these to a player viewer. */
  rawEvents: GameEvent[][];
}

export interface TimelineStep {
  /** 0 is the start of the match; step i is the state after action i - 1. */
  index: number;
  /** The action that led here (null at step 0). Informational only: a player view never reads who or what it names. */
  action: Action | null;
  frame: ViewFrame;
  /** The events of the transition INTO this step that this viewer may see (viewEvents; the raw events for 'all'). */
  events: GameEvent[];
  /** Power activations so far, per player. Counted from `powerActivated`, which every viewer receives. */
  powerUses: number[];
}

export interface Timeline {
  viewer: Viewer;
  steps: TimelineStep[];
  /** The index of the last step (= the number of actions). */
  last: number;
}

/** Plays `actions` from `setup`, keeping every state and every action's raw events. An illegal action throws, naming its position. */
export function recordMatch(setup: CreateGameOptions, actions: Action[]): MatchRecord {
  let state = createGame(setup);
  const states: GameState[] = [state];
  const rawEvents: GameEvent[][] = [];
  for (let i = 0; i < actions.length; i++) {
    try {
      const result = applyAction(state, actions[i]);
      state = result.state;
      rawEvents.push(result.events);
    } catch (err) {
      if (err instanceof IllegalActionError) {
        throw new IllegalActionError(`recordMatch: action #${i} (${actions[i]?.kind}) is illegal: ${err.message}`);
      }
      throw err;
    }
    states.push(state);
  }
  return { setup, actions: actions.slice(), states, rawEvents };
}

/** The omniscient frame: the true state, every tile in sight. Used for the 'all' viewer only. */
export function omniscientFrame(state: GameState): ViewFrame {
  const tiles: ObservedTile[][] = state.tiles.map((row) => row.map((t) => ({ terrain: t.terrain, owner: t.owner, capture: t.capture })));
  const players: ObservedPlayer[] = state.players.map((p) => ({
    index: p.index, faction: p.faction, commander: p.commander, team: p.team,
    funds: p.funds, power: p.power, powerState: p.powerState, defeated: p.defeated,
  }));
  const frame: ViewFrame = {
    viewer: 'all',
    mapId: state.mapId, width: state.width, height: state.height,
    tiles,
    visible: state.tiles.map((row) => row.map(() => true)),
    // The omniscient view sees every cargo, so `loaded` is simply whether the list is non-empty (observe.ts ObservedUnit).
    units: state.units.map((u) => ({ ...u, loaded: u.cargo.length > 0 })),
    players,
    cycle: state.cycle, current: state.current, weather: state.weather,
    fog: state.fog, fogActive: false,
    objective: state.objective,
    winnerTeam: state.winnerTeam,
  };
  if (state.deadline) frame.deadline = state.deadline;
  if (state.turnLimit !== undefined) frame.turnLimit = state.turnLimit;
  return frame;
}

function frameFor(state: GameState, viewer: Viewer): ViewFrame {
  if (viewer === 'all') return omniscientFrame(state);
  return observe(state, viewer);
}

function checkViewer(record: MatchRecord, viewer: Viewer): void {
  if (viewer === 'all') return;
  const n = record.states[0].players.length;
  if (!Number.isInteger(viewer) || viewer < 0 || viewer >= n) throw new RangeError(`no viewer ${String(viewer)} in a ${n}-player match`);
}

/** The timeline one viewer sees over a recorded match. */
export function viewTimeline(record: MatchRecord, viewer: Viewer): Timeline {
  checkViewer(record, viewer);
  const players = record.states[0].players.length;
  const steps: TimelineStep[] = [];
  let uses: number[] = new Array<number>(players).fill(0);
  steps.push({ index: 0, action: null, frame: frameFor(record.states[0], viewer), events: [], powerUses: uses });
  for (let i = 0; i < record.actions.length; i++) {
    const before = record.states[i];
    const after = record.states[i + 1];
    const raw = record.rawEvents[i];
    const events = viewer === 'all' ? raw : viewEvents(before, after, raw, viewer);
    uses = uses.slice();
    for (const e of events) if (e.kind === 'powerActivated') uses[e.player] += 1;
    steps.push({ index: i + 1, action: record.actions[i], frame: frameFor(after, viewer), events, powerUses: uses });
  }
  return { viewer, steps, last: steps.length - 1 };
}

/** Finds a unit in a frame by id, loaded cargo included. */
export function findUnit(frame: ViewFrame, id: number): Unit | undefined {
  const search = (list: Unit[]): Unit | undefined => {
    for (const u of list) {
      if (u.id === id) return u;
      const inside = search(u.cargo);
      if (inside) return inside;
    }
    return undefined;
  };
  return search(frame.units);
}

/** Every unit id in a frame, loaded cargo included. */
export function unitIdsIn(frame: ViewFrame): Set<number> {
  const ids = new Set<number>();
  const walk = (list: Unit[]): void => {
    for (const u of list) {
      ids.add(u.id);
      walk(u.cargo);
    }
  };
  walk(frame.units);
  return ids;
}

/** How many units a player has in this frame, cargo counted; null when the viewer cannot know (an enemy under fog). */
export function knownUnitCount(frame: ViewFrame, player: PlayerIndex): number | null {
  const me = frame.players[player];
  if (!me) return null;
  const viewer = frame.viewer;
  const friend = viewer === 'all' || frame.players[viewer]?.team === me.team;
  if (!friend && frame.fogActive) return null;
  let n = 0;
  for (const u of frame.units) if (u.owner === player) n += 1 + u.cargo.length;
  return n;
}
