// The timeline model: per-step frames and filtered events, per viewer, over one recorded match.
// Known answers are worked out here from the fixture's geometry (vision radii, positions), never read back from timeline.ts.
import { describe, expect, it } from 'vitest';
import { IllegalActionError, applyAction, createGame, defaultFirstMoverRule } from '../../game/aw';
import type { Action, GameState } from '../../game/aw';
import { observe } from '../../game/aw/observe';
import { replay, stateHash } from '../../game/aw/replay';
import { buildDemoMatch } from './demo';
import { knownUnitCount, omniscientFrame, recordMatch, unitIdsIn, viewTimeline } from './timeline';
import type { Timeline, Viewer } from './timeline';
import { endTurn, fieldSetup, pt, walk } from './testing';

// Open ground, columns 0..9 on row 1. A Helion trooper (id 1) at x=0 and a Tidewell trooper (id 2) at x=9. Trooper vision is 2 and
// its move 3, so: after Helion walks to x=3 it sees x<=5, and the Tidewell trooper at x=9, then x=6, stays out of sight until it
// steps to x=4.
const SCOUTS = [
  { type: 'trooper' as const, owner: 0, x: 0, y: 1 },
  { type: 'trooper' as const, owner: 1, x: 9, y: 1 },
];
const STALK: Action[] = [
  walk(1, [0, 1, 2, 3]),      // step 1: Helion to x=3
  endTurn,                    // step 2
  walk(2, [9, 8, 7, 6]),      // step 3: Tidewell to x=6 -- entirely in the dark for Helion
  endTurn,                    // step 4
  endTurn,                    // step 5: Helion passes
  walk(2, [6, 5, 4], { kind: 'attack', target: pt(3) }), // step 6: Tidewell steps into sight and fires
];

const ids = (units: { id: number }[]): number[] => units.map((u) => u.id).sort((a, b) => a - b);

describe('recordMatch', () => {
  const setup = fieldSetup(SCOUTS, { fog: true });
  const rec = recordMatch(setup, STALK);

  it('keeps the start, every state after an action, and every action\'s raw events', () => {
    expect(rec.states).toHaveLength(STALK.length + 1);
    expect(rec.rawEvents).toHaveLength(STALK.length);
    expect(rec.states[1].units.find((u) => u.id === 1)).toMatchObject({ x: 3, y: 1 });
    expect(rec.states[3].units.find((u) => u.id === 2)).toMatchObject({ x: 6, y: 1 });
    expect(rec.states[6].units.find((u) => u.id === 2)).toMatchObject({ x: 4, y: 1 });
  });

  it('keeps its setup with the first-mover rule written in, so it replays the same under a later default (D-019)', () => {
    expect(setup.firstMoverRule, 'the fixture names no rule').toBeUndefined();
    expect(rec.setup.firstMoverRule).toBe(defaultFirstMoverRule(setup.players.length));
    expect(stateHash(replay(rec.setup, STALK).state)).toBe(stateHash(rec.states[rec.states.length - 1]));
    expect(recordMatch({ ...setup, firstMoverRule: 'none' }, STALK).setup.firstMoverRule, 'a named rule is kept').toBe('none');
  });

  it('agrees with the engine\'s own replay(): same final state, same events in order', () => {
    const r = replay(setup, STALK);
    expect(stateHash(rec.states[rec.states.length - 1])).toBe(stateHash(r.state));
    expect(rec.rawEvents.flat()).toEqual(r.events);
    // and the in-between states are the ones replay() reaches after each prefix of the actions
    for (const n of [1, 3, 6]) expect(stateHash(rec.states[n])).toBe(stateHash(replay(setup, STALK.slice(0, n)).state));
  });

  it('refuses an illegal action list, naming the position of the bad action (known-bad input)', () => {
    const bad: Action[] = [walk(1, [0, 1, 2, 3]), walk(1, [3, 4, 5])]; // the second moves a unit that has already acted
    expect(() => recordMatch(setup, bad)).toThrow(IllegalActionError);
    expect(() => recordMatch(setup, bad)).toThrow(/action #1/);
  });
});

describe('viewTimeline: what each viewer is shown', () => {
  const rec = recordMatch(fieldSetup(SCOUTS, { fog: true }), STALK);
  const helion = viewTimeline(rec, 0);
  const tidewell = viewTimeline(rec, 1);
  const all = viewTimeline(rec, 'all');

  it('has one step per action plus the start, with matching indexes and `last`', () => {
    for (const tl of [helion, tidewell, all]) {
      expect(tl.steps).toHaveLength(STALK.length + 1);
      expect(tl.last).toBe(STALK.length);
      tl.steps.forEach((s, i) => expect(s.index).toBe(i));
      expect(tl.steps[0].action).toBeNull();
      expect(tl.steps[0].events).toEqual([]);
      expect(tl.steps[3].action).toEqual(STALK[2]);
    }
  });

  it('shows each player only its own army at the start, and the omniscient view both', () => {
    expect(ids(helion.steps[0].frame.units)).toEqual([1]);
    expect(ids(tidewell.steps[0].frame.units)).toEqual([2]);
    expect(ids(all.steps[0].frame.units)).toEqual([1, 2]);
  });

  it('keeps the enemy out of Helion\'s frames while it is dark, and brings it in the moment it is seen', () => {
    // Tidewell sits at x=9, then x=6: both beyond the x<=5 that a trooper at x=3 sees.
    for (const i of [1, 2, 3, 4, 5]) expect(ids(helion.steps[i].frame.units), `step ${i}`).toEqual([1]);
    expect(ids(helion.steps[6].frame.units)).toEqual([1, 2]);
    expect(helion.steps[6].frame.units.find((u) => u.id === 2)).toMatchObject({ x: 4, y: 1 });
    // the omniscient view always had both
    for (const s of all.steps) expect(ids(s.frame.units)).toEqual([1, 2]);
  });

  it('filters events with viewEvents: a move wholly in the dark is not in Helion\'s step, a half-seen one is trimmed', () => {
    const moved = (tl: Timeline, step: number) => tl.steps[step].events.filter((e) => e.kind === 'moved');
    expect(moved(helion, 3)).toEqual([]);                                   // x=9 -> 6: nothing visible
    expect(moved(tidewell, 3)).toEqual([{ kind: 'moved', unitId: 2, path: [pt(9), pt(8), pt(7), pt(6)] }]);
    expect(moved(all, 3)).toEqual([{ kind: 'moved', unitId: 2, path: [pt(9), pt(8), pt(7), pt(6)] }]);
    // x=6 -> 5 -> 4: Helion sees x=5 and x=4 only
    expect(moved(helion, 6)).toEqual([{ kind: 'moved', unitId: 2, path: [pt(5), pt(4)] }]);
  });

  it('never gives a player a raw event list: the omniscient timeline is the only one that carries hidden moves', () => {
    const hiddenMove = (tl: Timeline) => tl.steps.some((s) => s.events.some((e) => e.kind === 'moved' && e.unitId === 2 && e.path.length === 4));
    expect(hiddenMove(all)).toBe(true);
    expect(hiddenMove(tidewell)).toBe(true);
    expect(hiddenMove(helion)).toBe(false);
  });

  it('counts power activations from the events every viewer receives', () => {
    expect(helion.steps.every((s) => s.powerUses.length === 2 && s.powerUses.every((n) => n === 0))).toBe(true);
  });

  it('refuses a viewer that is not in the match (known-bad input)', () => {
    expect(() => viewTimeline(rec, 2)).toThrow(RangeError);
    expect(() => viewTimeline(rec, -1)).toThrow(RangeError);
    expect(() => viewTimeline(rec, 0.5)).toThrow(RangeError);
  });
});

/** Enemy units a frame shows that observe() does not: must be none for a player viewer. */
function leaks(frame: { units: { id: number; owner: number }[] }, state: GameState, viewer: number): number {
  const allowed = new Set(observe(state, viewer).units.map((u) => u.id));
  const team = state.players[viewer].team;
  return frame.units.filter((u) => state.players[u.owner].team !== team && !allowed.has(u.id)).length;
}

describe('a viewer\'s timeline contains no enemy unit that observe() does not show', () => {
  const rec = recordMatch(fieldSetup(SCOUTS, { fog: true }), STALK);

  it('holds on every step of the hand-built match, for both players', () => {
    for (const viewer of [0, 1]) {
      const tl = viewTimeline(rec, viewer);
      tl.steps.forEach((s, i) => expect(leaks(s.frame, rec.states[i], viewer), `viewer ${viewer} step ${i}`).toBe(0));
    }
  });

  it('the check can fail: the omniscient frame handed to a fogged player leaks the hidden trooper (known-bad)', () => {
    // step 3: Tidewell stands at x=6, out of Helion's sight
    expect(leaks(omniscientFrame(rec.states[3]), rec.states[3], 0)).toBe(1);
    expect(leaks(viewTimeline(rec, 0).steps[3].frame, rec.states[3], 0)).toBe(0);
  });

  it('holds on every step of the seeded demo match (fog, calder-fields), for both players, and is not vacuous', () => {
    const demo = buildDemoMatch();
    const demoRec = recordMatch(demo.setup, demo.actions);
    let hiddenEnemySteps = 0;
    for (const viewer of [0, 1]) {
      const tl = viewTimeline(demoRec, viewer);
      tl.steps.forEach((s, i) => {
        expect(leaks(s.frame, demoRec.states[i], viewer), `viewer ${viewer} step ${i}`).toBe(0);
        // the frame IS the observation: same units, same fog mask
        const obs = observe(demoRec.states[i], viewer);
        expect(ids(s.frame.units)).toEqual(ids(obs.units));
        expect(s.frame.visible).toEqual(obs.visible);
        const trueEnemies = demoRec.states[i].units.filter((u) => demoRec.states[i].players[u.owner].team !== demoRec.states[i].players[viewer].team);
        if (trueEnemies.some((u) => !unitIdsIn(s.frame).has(u.id))) hiddenEnemySteps++;
      });
    }
    // across the two viewers there are many steps where an enemy really was out of sight
    expect(hiddenEnemySteps).toBeGreaterThan(40);
  });

  it('the omniscient frame of the demo carries exactly the true state\'s units on every step', () => {
    const demo = buildDemoMatch();
    const demoRec = recordMatch(demo.setup, demo.actions);
    const tl = viewTimeline(demoRec, 'all');
    tl.steps.forEach((s, i) => expect(ids(s.frame.units)).toEqual(ids(demoRec.states[i].units)));
  });
});

describe('unit counts for the HUD', () => {
  const fogRec = recordMatch(fieldSetup(SCOUTS, { fog: true }), STALK);
  const clearRec = recordMatch(fieldSetup(SCOUTS, { fog: false }), STALK);

  it('counts the viewer\'s own side and says "unknown" (null) for an enemy under fog', () => {
    const f = viewTimeline(fogRec, 0).steps[3].frame; // Tidewell is in the dark here
    expect(knownUnitCount(f, 0)).toBe(1);
    expect(knownUnitCount(f, 1)).toBeNull();
  });

  it('counts every side with fog off, and every side for the omniscient viewer', () => {
    expect(knownUnitCount(viewTimeline(clearRec, 0).steps[3].frame, 1)).toBe(1);
    expect(knownUnitCount(viewTimeline(fogRec, 'all').steps[3].frame, 1)).toBe(1);
  });

  it('does not let a seen enemy unit make the count known: under fog it stays unknown (known-bad: a count of 1 would leak the army size)', () => {
    const f = viewTimeline(fogRec, 0).steps[6].frame; // the Tidewell trooper is in view, but it may not be the whole army
    expect(ids(f.units)).toEqual([1, 2]);
    expect(knownUnitCount(f, 1)).toBeNull();
  });
});

describe('viewer type', () => {
  it('accepts player indexes and the string "all" only', () => {
    const rec = recordMatch(fieldSetup(SCOUTS, { fog: true }), STALK);
    const viewers: Viewer[] = [0, 1, 'all'];
    for (const v of viewers) expect(viewTimeline(rec, v).viewer).toBe(v);
  });
});

describe('createGame/applyAction are what recordMatch plays (guard against a silent drift from the engine)', () => {
  it('reproduces the engine step by step', () => {
    const setup = fieldSetup(SCOUTS, { fog: true });
    let s = createGame(setup);
    const rec = recordMatch(setup, STALK);
    expect(stateHash(rec.states[0])).toBe(stateHash(s));
    STALK.forEach((a, i) => {
      s = applyAction(s, a).state;
      expect(stateHash(rec.states[i + 1])).toBe(stateHash(s));
    });
  });
});
