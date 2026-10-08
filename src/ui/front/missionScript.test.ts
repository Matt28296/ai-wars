// The mission's script: when does each authored event fire? Every expectation here is worked out by hand from the hand-built matches
// below (which step holds which event), never read back from missionScript.ts. Each trigger kind has a known-bad twin that must NOT fire.
import { describe, expect, it } from 'vitest';
import type { DialogueLine, Mission, MissionTrigger } from '../../content/types';
import type { Action, GameEvent, TerrainId } from '../../game/aw';
import { endTurn, fieldSetup, pt } from '../watch/testing';
import { recordMatch, viewTimeline } from '../watch/timeline';
import { beatsOf, evaluateScript, outcomeOf, scriptFor } from './missionScript';
import type { ScriptMatch, ScriptMission } from './missionScript';

// ---------------------------------------------------------------- hand-built matches

const at = { x: 0, y: 0 };
const destroyed = (owner: number, unitId = 1): GameEvent => ({ kind: 'destroyed', unitId, at, type: 'trooper', owner });
const captured = (by: number, terrain: TerrainId, from: number | null = null): GameEvent => ({ kind: 'captured', at, terrain, by, from });
const power = (player: number): GameEvent => ({ kind: 'powerActivated', player, level: 'surge', commander: 'rook' });
const crashed: GameEvent = { kind: 'crashed', unitId: 9, at };
const quiet: GameEvent = { kind: 'turnEnded', player: 0 };

interface StepSpec { cycle?: number; events?: GameEvent[] }

/** A match from step specs: spec 0 is the start; spec i holds the events of the action that led to step i. The winner is set on the last state only. */
function match(steps: StepSpec[], winnerTeam: number | null = null): ScriptMatch {
  let cycle = steps[0]?.cycle ?? 1;
  const states = steps.map((s, i) => {
    cycle = s.cycle ?? cycle;
    return { cycle, winnerTeam: i === steps.length - 1 ? winnerTeam : null };
  });
  return { states, rawEvents: steps.slice(1).map((s) => s.events ?? []) };
}

const line = (text: string): DialogueLine => ({ speaker: 'narrator', text });
const players = (teams: number[]): Mission['players'] => teams.map((team) => ({ faction: 'helion', commander: 'agent', controller: 'human', team }));
/** A mission with one authored event per trigger given; its lines say "<index>". */
function missionOf(triggers: { trigger: MissionTrigger; once?: boolean }[], teams = [0, 0, 1]): ScriptMission {
  return { players: players(teams), events: triggers.map((t, i) => ({ ...t, lines: [line(String(i))] })) };
}
const stepsOf = (m: ScriptMission, mt: ScriptMatch): { event: number; step: number }[] => evaluateScript(m, mt);
const only = (trigger: MissionTrigger, mt: ScriptMatch, once?: boolean, teams?: number[]): number[] =>
  stepsOf(missionOf([{ trigger, ...(once === undefined ? {} : { once }) }], teams), mt).map((f) => f.step);

describe('start and cycle', () => {
  const m = match([{ cycle: 1 }, {}, {}, { cycle: 2 }, {}, { cycle: 3 }]); // steps 0..5

  it('fires start at step 0, even in a match with no actions', () => {
    expect(only({ kind: 'start' }, m)).toEqual([0]);
    expect(only({ kind: 'start' }, match([{}]))).toEqual([0]);
  });

  it('fires a cycle event at the step where that cycle begins', () => {
    expect(only({ kind: 'cycle', cycle: 2 }, m)).toEqual([3]);
    expect(only({ kind: 'cycle', cycle: 3 }, m)).toEqual([5]);
    expect(only({ kind: 'cycle', cycle: 1 }, m)).toEqual([0]);
  });

  it('never fires a cycle the match did not reach (known-bad: cycle 4 of a 3-cycle match), nor a cycle below 1', () => {
    expect(only({ kind: 'cycle', cycle: 4 }, m)).toEqual([]);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(only({ kind: 'cycle', cycle: bad }, m), String(bad)).toEqual([]);
  });

  it('fires a cycle that was skipped over at the first state past it', () => {
    expect(only({ kind: 'cycle', cycle: 2 }, match([{ cycle: 1 }, {}, { cycle: 3 }]))).toEqual([2]);
  });

  it('fires a cycle event once even with once:false (a cycle begins once)', () => {
    expect(only({ kind: 'cycle', cycle: 2 }, m, false)).toEqual([3]);
  });
});

describe('unitDestroyed', () => {
  // step 1: one of player 2's units; step 2: one of player 0's; step 3: TWO of player 2's; step 4: a crash; step 5: one more of player 2's.
  const m = match([{}, { events: [destroyed(2)] }, { events: [destroyed(0)] }, { events: [destroyed(2, 2), destroyed(2, 3)] }, { events: [crashed] }, { events: [destroyed(2, 4)] }]);

  it('fires when the owner loses its first unit by default, and counts only that owner\'s units', () => {
    expect(only({ kind: 'unitDestroyed', owner: 2 }, m)).toEqual([1]);
    expect(only({ kind: 'unitDestroyed', owner: 0 }, m)).toEqual([2]);
  });

  it('does not fire for an owner who lost nothing (known-bad: the wrong owner)', () => {
    expect(only({ kind: 'unitDestroyed', owner: 1 }, m)).toEqual([]);
  });

  it('waits for the third unit when the count is 3: the third falls at step 3, in the same step as the second', () => {
    expect(only({ kind: 'unitDestroyed', owner: 2, count: 3 }, m)).toEqual([3]);
    expect(only({ kind: 'unitDestroyed', owner: 2, count: 4 }, m)).toEqual([5]);
  });

  it('does not fire a count that was not reached (known-bad: count 3 with only two losses)', () => {
    const two = match([{}, { events: [destroyed(2)] }, { events: [quiet] }, { events: [destroyed(2, 2)] }]);
    expect(only({ kind: 'unitDestroyed', owner: 2, count: 3 }, two)).toEqual([]);
    expect(only({ kind: 'unitDestroyed', owner: 2, count: 2 }, two)).toEqual([3]);
  });

  it('does not count a crash as a destruction', () => {
    const crashOnly = match([{}, { events: [crashed] }]);
    expect(only({ kind: 'unitDestroyed', owner: 2 }, crashOnly)).toEqual([]);
  });

  it('fires only once by default, and fires again with once:false: every loss at count 1, every second at count 2', () => {
    expect(only({ kind: 'unitDestroyed', owner: 2 }, m, true)).toEqual([1]);
    expect(only({ kind: 'unitDestroyed', owner: 2 }, m, false)).toEqual([1, 3, 5]); // a step with two losses is one firing
    // totals for player 2 after each step: 1, 1, 3, 3, 4. Multiples of 2 are crossed at step 3 (2 within 3) and step 5 (4).
    expect(only({ kind: 'unitDestroyed', owner: 2, count: 2 }, m, false)).toEqual([3, 5]);
  });
});

describe('propertyCaptured', () => {
  // step 1: player 1 takes an arcology; step 2: player 0 takes a fabricator; step 3: quiet; step 4: player 0 takes an arcology from player 1.
  const m = match([{}, { events: [captured(1, 'arcology')] }, { events: [captured(0, 'fabricator')] }, { events: [quiet] }, { events: [captured(0, 'arcology', 1)] }]);

  it('fires for the named player and terrain, and not for the same terrain taken by someone else (known-bad: wrong capturer)', () => {
    expect(only({ kind: 'propertyCaptured', by: 0, terrain: 'arcology' }, m)).toEqual([4]);
    expect(only({ kind: 'propertyCaptured', by: 1, terrain: 'arcology' }, m)).toEqual([1]);
  });

  it('does not fire for a terrain the player never took (known-bad: wrong terrain)', () => {
    expect(only({ kind: 'propertyCaptured', by: 1, terrain: 'fabricator' }, m)).toEqual([]);
    expect(only({ kind: 'propertyCaptured', by: 0, terrain: 'dock' }, m)).toEqual([]);
  });

  it('fires at the first capture of any terrain when none is named, and at each of them with once:false', () => {
    expect(only({ kind: 'propertyCaptured', by: 0 }, m)).toEqual([2]);
    expect(only({ kind: 'propertyCaptured', by: 0 }, m, false)).toEqual([2, 4]);
    expect(only({ kind: 'propertyCaptured', by: 2 }, m)).toEqual([]);
  });
});

describe('powerUsed', () => {
  const m = match([{}, {}, { events: [power(0)] }, {}, { events: [power(2)] }, { events: [power(2)] }]);

  it('fires at the step the named player activates a power, and not for another player\'s (known-bad)', () => {
    expect(only({ kind: 'powerUsed', player: 2 }, m)).toEqual([4]);
    expect(only({ kind: 'powerUsed', player: 0 }, m)).toEqual([2]);
    expect(only({ kind: 'powerUsed', player: 1 }, m)).toEqual([]);
  });

  it('fires on each activation with once:false', () => {
    expect(only({ kind: 'powerUsed', player: 2 }, m, false)).toEqual([4, 5]);
    expect(only({ kind: 'powerUsed', player: 2 }, m, true)).toEqual([4]);
  });
});

describe('victory and defeat, from player 0\'s side', () => {
  const steps: StepSpec[] = [{}, { events: [quiet] }, { events: [quiet] }];

  it('fires victory, and not defeat, at the final step when player 0\'s team won', () => {
    const won = match(steps, 0);
    expect(only({ kind: 'victory' }, won)).toEqual([2]);
    expect(only({ kind: 'defeat' }, won)).toEqual([]);
  });

  it('fires defeat, and not victory, when another team won', () => {
    const lost = match(steps, 1);
    expect(only({ kind: 'defeat' }, lost)).toEqual([2]);
    expect(only({ kind: 'victory' }, lost)).toEqual([]);
  });

  it('fires neither when nobody had won: an undecided battle is not a result', () => {
    const open = match(steps, null);
    expect(only({ kind: 'victory' }, open)).toEqual([]);
    expect(only({ kind: 'defeat' }, open)).toEqual([]);
  });

  it('reads "player 0\'s side" from the mission, never the number 0 (known-bad: a mission whose player 0 is on team 1)', () => {
    const team1Won = match(steps, 1);
    expect(only({ kind: 'victory' }, team1Won, undefined, [1, 0])).toEqual([2]);
    expect(only({ kind: 'defeat' }, team1Won, undefined, [1, 0])).toEqual([]);
    expect(only({ kind: 'defeat' }, match(steps, 0), undefined, [1, 0])).toEqual([2]);
  });

  it('names the outcome of a match the same way', () => {
    expect(outcomeOf(0, 0)).toBe('victory');
    expect(outcomeOf(0, 1)).toBe('defeat');
    expect(outcomeOf(0, null)).toBe('undecided');
    expect(outcomeOf(2, 2)).toBe('victory');
    expect(outcomeOf(2, 0)).toBe('defeat');
  });
});

describe('the whole script', () => {
  const m = match([{ cycle: 1 }, { events: [destroyed(2)] }, { cycle: 2, events: [destroyed(2, 2), captured(0, 'arcology')] }, { events: [power(0)] }], 0);
  const mission = missionOf([
    { trigger: { kind: 'victory' } },                                          // event 0, authored first, fires last
    { trigger: { kind: 'propertyCaptured', by: 0, terrain: 'arcology' } },     // event 1: step 2
    { trigger: { kind: 'start' } },                                            // event 2: step 0
    { trigger: { kind: 'cycle', cycle: 2 } },                                  // event 3: step 2, the same step as event 1
    { trigger: { kind: 'unitDestroyed', owner: 2 } },                          // event 4: step 1
    { trigger: { kind: 'cycle', cycle: 7 } },                                  // event 5: never
  ]);

  it('lists the firings in step order, authoring order within a step, and leaves out what never fires', () => {
    expect(evaluateScript(mission, m)).toEqual([
      { event: 2, step: 0 }, { event: 4, step: 1 }, { event: 1, step: 2 }, { event: 3, step: 2 }, { event: 0, step: 3 },
    ]);
  });

  it('groups events that meet at one step into one beat, their lines in authoring order', () => {
    const beats = scriptFor(mission, m);
    expect(beats.map((b) => b.step)).toEqual([0, 1, 2, 3]);
    expect(beats[2].events).toEqual([1, 3]);
    expect(beats[2].lines.map((l) => l.text)).toEqual(['1', '3']);
    expect(beats[0].lines.map((l) => l.text)).toEqual(['2']);
    expect(beats[3].lines.map((l) => l.text)).toEqual(['0']);
  });

  it('does not share its lines with the mission: a beat can be changed without changing the authored script', () => {
    const beats = beatsOf(mission, [{ event: 2, step: 0 }]);
    beats[0].lines.push(line('extra'));
    expect(mission.events[2].lines).toHaveLength(1);
  });

  it('treats once as true unless the mission says false', () => {
    const e = match([{}, { events: [destroyed(2)] }, { events: [destroyed(2, 2)] }]);
    const t: MissionTrigger = { kind: 'unitDestroyed', owner: 2 };
    expect(evaluateScript(missionOf([{ trigger: t }]), e)).toHaveLength(1);
    expect(evaluateScript(missionOf([{ trigger: t, once: true }]), e)).toHaveLength(1);
    expect(evaluateScript(missionOf([{ trigger: t, once: false }]), e)).toHaveLength(2);
  });
});

describe('refusing a broken recording', () => {
  const mission = missionOf([{ trigger: { kind: 'start' } }]);

  it('refuses events that do not line up with the states, rather than answering "nothing to say"', () => {
    expect(() => evaluateScript(mission, { states: [{ cycle: 1, winnerTeam: null }, { cycle: 1, winnerTeam: null }], rawEvents: [] })).toThrow(/event lists/);
    expect(() => evaluateScript(mission, { states: [{ cycle: 1, winnerTeam: null }], rawEvents: [[]] })).toThrow(/event lists/);
  });

  it('refuses a recording with no states and a mission with no player 0', () => {
    expect(() => evaluateScript(mission, { states: [], rawEvents: [] })).toThrow(/no states/);
    expect(() => evaluateScript({ players: [], events: mission.events }, match([{}]))).toThrow(/no player 0/);
  });
});

// ---------------------------------------------------------------- the true events, on a real fogged match

describe('the script reads the true events, whoever is watching', () => {
  // Three sides on an open field, fog on. Player 0 (Helion) stands at x=0 and sees only x<=2. Player 1 (Tidewell, x=8) kills player 2's
  // last-breath trooper (x=9, one display HP) on its turn: far out of player 0's sight.
  const players3 = [
    { faction: 'helion' as const, commander: 'rook', controller: 'ai' as const, team: 0 },
    { faction: 'tidewell' as const, commander: 'sefa', controller: 'ai' as const, team: 1 },
    { faction: 'kestrel' as const, commander: 'corvin', controller: 'ai' as const, team: 2 },
  ];
  const setup = fieldSetup(
    [{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 8, y: 1 }, { type: 'trooper', owner: 2, x: 9, y: 1, hp: 1 }],
    { fog: true, players: players3 },
  );
  const actions: Action[] = [
    endTurn,                                                                                 // step 1: Helion passes
    { kind: 'move', unitId: 2, path: [pt(8)], then: { kind: 'attack', target: pt(9) } },     // step 2: Tidewell kills Kestrel's trooper
  ];
  const rec = recordMatch(setup, actions);
  const mission = missionOf([{ trigger: { kind: 'unitDestroyed', owner: 2 } }], [0, 1, 2]);

  it('fires when the unit falls, though player 0 never saw it fall', () => {
    expect(rec.rawEvents[1].some((e) => e.kind === 'destroyed' && e.owner === 2)).toBe(true);
    expect(evaluateScript(mission, rec)).toEqual([{ event: 0, step: 2 }]);
    // the viewer's own timeline has no such event at that step (the fog filter drops it), and the omniscient one has it
    expect(viewTimeline(rec, 0).steps[2].events.some((e) => e.kind === 'destroyed')).toBe(false);
    expect(viewTimeline(rec, 'all').steps[2].events.some((e) => e.kind === 'destroyed')).toBe(true);
  });

  it('does not move when the viewer changes: the steps are the same for every viewer', () => {
    const lens = [0, 1, 2, 'all' as const].map((v) => viewTimeline(rec, v).steps.length);
    expect(new Set(lens).size).toBe(1);
    expect(lens[0]).toBe(actions.length + 1);
  });
});
