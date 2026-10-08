// The mission's own script (G13), pure: given a mission and the match Deploy recorded, at which step does each authored event fire?
//
// A mission authors `events`: lines that belong to a moment (the start, a cycle, a unit lost, a property taken, a power used, the end).
// This module only decides WHEN each one fires; showing it, pausing the watch and the debrief live in the screens.
//
// WHICH EVENTS IT READS, AND WHY. It reads the match's TRUE events (MatchRecord.rawEvents), not the viewer's filtered ones, for every
// viewer. This is the mission's authored script, so it behaves as the source games' scripted dialogue does: "the first drone is down" is
// said when the first drone goes down, whether or not the player's side saw it happen. That is a deliberate choice, and it is safe for two
// reasons. The lines are written for the player, so they carry no unit positions and no coordinates, and nothing here draws on the board
// or points at a tile, so a line can never show where a hidden unit stands. And the step is the same for every viewer (a step is an
// action), so switching the viewer never moves, repeats or drops a line. What this does NOT do is feed the watch view anything: the
// board, the log and the HUD still read only their own viewer's frames (D-016).
//
// THE TRIGGER KINDS (src/content/types.ts MissionTrigger), each as one step per occurrence:
//   start                          step 0.
//   cycle N                        the first step whose state is in cycle N or later (the step where cycle N begins). N < 1 never fires.
//   unitDestroyed owner, count     the step where `owner` has lost `count` units (default 1) to a `destroyed` event, counted over the whole
//                                  match, cargo included. A unit that crashes out of charge emits `crashed`, not `destroyed`, and does
//                                  not count. With once:false it fires again each time the running total reaches another multiple of
//                                  `count`, so count 1 fires on every step that destroys one, and count 3 on the 3rd, 6th, 9th.
//   propertyCaptured by, terrain   a step with a `captured` event taken by `by`, of that terrain when one is named.
//   powerUsed player               a step with a `powerActivated` event by `player` (either power).
//   victory / defeat               the final step, from player 0's side: victory when player 0's team won, defeat when another team won.
//                                  A match nobody won (Deploy stops at the cycle cap) fires neither: that is UNDECIDED, and the honest
//                                  answer is to say so rather than invent a result.
// `once` defaults to true: only the first occurrence fires. A step fires an event at most once even if it holds several occurrences.
import type { DialogueLine, Mission, MissionTrigger } from '../../content/types';
import type { GameEvent } from '../../game/aw';

/** What the evaluator reads of a recorded match. A watch-view `MatchRecord` satisfies it; tests may hand-build one. */
export interface ScriptMatch {
  /** states[i] is the state at step i (so there is one more of them than there are actions). Only these two fields are read. */
  states: readonly { readonly cycle: number; readonly winnerTeam: number | null }[];
  /** rawEvents[i] are the TRUE events of the action that led to step i + 1. */
  rawEvents: readonly (readonly GameEvent[])[];
}

/** What the evaluator reads of a mission: its events and its sides (player 0's team is the viewer's). */
export type ScriptMission = Pick<Mission, 'events' | 'players'>;

/** One authored event firing at one step. `event` indexes `mission.events`. */
export interface ScriptFire {
  event: number;
  step: number;
}

/** The events that fire at one step, in authoring order, as one run of lines. */
export interface StoryBeat {
  step: number;
  /** Indexes into `mission.events`, in authoring order. */
  events: number[];
  lines: DialogueLine[];
}

export type Outcome = 'victory' | 'defeat' | 'undecided';

/** How a match ended for player 0's team. `winnerTeam` null means nobody had won when the recording stopped. */
export function outcomeOf(team0: number, winnerTeam: number | null): Outcome {
  if (winnerTeam === null) return 'undecided';
  return winnerTeam === team0 ? 'victory' : 'defeat';
}

/** The steps of a match where `trigger`'s condition occurs, ascending, each step once. */
function occurrences(trigger: MissionTrigger, match: ScriptMatch, team0: number): number[] {
  const last = match.states.length - 1;
  const stepsWith = (has: (e: GameEvent) => boolean): number[] => {
    const out: number[] = [];
    match.rawEvents.forEach((events, i) => { if (events.some(has)) out.push(i + 1); });
    return out;
  };
  switch (trigger.kind) {
    case 'start':
      return [0];
    case 'cycle': {
      if (!Number.isInteger(trigger.cycle) || trigger.cycle < 1) return [];
      const at = match.states.findIndex((s) => s.cycle >= trigger.cycle);
      return at < 0 ? [] : [at];
    }
    case 'unitDestroyed': {
      const every = Math.max(1, Math.trunc(trigger.count ?? 1));
      const out: number[] = [];
      let total = 0;
      match.rawEvents.forEach((events, i) => {
        const before = total;
        for (const e of events) if (e.kind === 'destroyed' && e.owner === trigger.owner) total++;
        if (Math.floor(total / every) > Math.floor(before / every)) out.push(i + 1);
      });
      return out;
    }
    case 'propertyCaptured':
      return stepsWith((e) => e.kind === 'captured' && e.by === trigger.by && (trigger.terrain === undefined || e.terrain === trigger.terrain));
    case 'powerUsed':
      return stepsWith((e) => e.kind === 'powerActivated' && e.player === trigger.player);
    case 'victory':
      return outcomeOf(team0, match.states[last].winnerTeam) === 'victory' ? [last] : [];
    case 'defeat':
      return outcomeOf(team0, match.states[last].winnerTeam) === 'defeat' ? [last] : [];
  }
}

/**
 * The step at which each of the mission's events fires, in step order (authoring order within a step). An event that never fires is
 * absent. A recording with no states, or whose events do not line up with its states, is refused: a script run over a broken record
 * would come back empty and read as "this mission has nothing to say".
 */
export function evaluateScript(mission: ScriptMission, match: ScriptMatch): ScriptFire[] {
  if (match.states.length < 1) throw new RangeError('evaluateScript: the match has no states');
  if (match.rawEvents.length !== match.states.length - 1) {
    throw new RangeError(`evaluateScript: ${match.states.length} states need ${match.states.length - 1} event lists, got ${match.rawEvents.length}`);
  }
  const team0 = mission.players[0]?.team;
  if (team0 === undefined) throw new RangeError('evaluateScript: the mission has no player 0');
  const fires: ScriptFire[] = [];
  mission.events.forEach((ev, event) => {
    const steps = occurrences(ev.trigger, match, team0);
    for (const step of ev.once === false ? steps : steps.slice(0, 1)) fires.push({ event, step });
  });
  return fires.sort((a, b) => a.step - b.step || a.event - b.event);
}

/** Groups the fires by step: all the events that fire together are one run of lines, so one pause, however many events met there. */
export function beatsOf(mission: Pick<Mission, 'events'>, fires: readonly ScriptFire[]): StoryBeat[] {
  const beats: StoryBeat[] = [];
  for (const f of fires) {
    const at = beats[beats.length - 1];
    if (at && at.step === f.step) {
      at.events.push(f.event);
      at.lines.push(...mission.events[f.event].lines);
    } else {
      beats.push({ step: f.step, events: [f.event], lines: [...mission.events[f.event].lines] });
    }
  }
  return beats;
}

/** The mission's beats for a recorded match: evaluate, then group. */
export function scriptFor(mission: ScriptMission, match: ScriptMatch): StoryBeat[] {
  return beatsOf(mission, evaluateScript(mission, match));
}
