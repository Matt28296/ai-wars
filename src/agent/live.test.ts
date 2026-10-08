// The live step (A1b): the one shape the feed sends and the browser reads. Expected answers come from the engine's own player view,
// `viewTimeline(recordMatch(...), seat 0)`, and from hand-made events, never from live.ts.
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../content/missions';
import type { GameEvent } from '../game/aw';
import { recordMatch, viewTimeline } from '../ui/watch/timeline';
import { firstLiveStep, nextLiveStep } from './live';
import type { LiveStep } from './live';
import { AgentMatch } from './match';

const mission = (id: string) => MISSIONS.find((m) => m.id === id)!;

/** Plays a mission to its end (the agent ends its turn at once, or acts first when asked), collecting the steps the host announced. */
function playOut(id: string, agentActs: boolean): { host: AgentMatch; steps: LiveStep[] } {
  const host = new AgentMatch(mission(id));
  const steps: LiveStep[] = [host.latestStep()];
  host.subscribe((e) => { if (e.type === 'step') steps.push(e.step); });
  while (!host.result()) {
    if (agentActs) {
      const e = host.legal().find((x) => x.kind === 'power' || x.kind === 'attack') ?? host.legal()[0];
      if (e) { host.act(e.id); continue; }
    }
    host.endTurn();
  }
  return { host, steps };
}

describe('nextLiveStep', () => {
  it('counts power activations per player from the events the seat saw, and shares nothing with its inputs', () => {
    const host = new AgentMatch(mission('first-light'));
    const start = host.latestStep();
    const events: GameEvent[] = [
      { kind: 'powerActivated', player: 1, level: 'surge', commander: 'rook' },
      { kind: 'powerActivated', player: 1, level: 'overclock', commander: 'rook' },
      { kind: 'powerActivated', player: 0, level: 'surge', commander: 'agent' },
      { kind: 'turnEnded', player: 0 },
    ];
    const next = nextLiveStep(start, { after: host.trueState(), seen: events, action: null, seat: 0 });
    expect(next.index).toBe(1);
    expect(next.powerUses).toStrictEqual([1, 2, 0]);
    expect(start.powerUses, 'the previous step is untouched').toStrictEqual([0, 0, 0]);
    expect(next.events).toStrictEqual(events);
    (events[0] as { player: number }).player = 2;
    expect(next.events[0]).toMatchObject({ player: 1 });
    // and a step after that adds to it
    const third = nextLiveStep(next, { after: host.trueState(), seen: [{ kind: 'powerActivated', player: 2, level: 'surge', commander: 'x' }], action: null, seat: 0 });
    expect(third.powerUses).toStrictEqual([1, 2, 1]);
  });

  it('keeps an action only when it is given one, and copies it', () => {
    const host = new AgentMatch(mission('first-light'));
    const entry = host.legal()[0];
    const next = nextLiveStep(host.latestStep(), { after: host.trueState(), seen: [], action: entry.action, seat: 0 });
    expect(next.action).toStrictEqual(entry.action);
    expect(next.action).not.toBe(entry.action);
    expect(nextLiveStep(host.latestStep(), { after: host.trueState(), seen: [], action: null, seat: 0 }).action).toBeNull();
  });

  it('step 0 is the seat\'s observation with nothing yet done', () => {
    const host = new AgentMatch(mission('under-canopy'));
    const s0 = firstLiveStep(host.trueState(), 0);
    expect(s0).toMatchObject({ index: 0, action: null, events: [] });
    expect(s0.frame).toStrictEqual(host.observation());
    expect(s0.powerUses).toStrictEqual(new Array<number>(host.trueState().players.length).fill(0));
  });
});

describe('the steps a host announces', () => {
  it('are exactly viewTimeline(recordMatch(...), seat 0) over a whole match, the action kept only for seat 0, on three missions (one fogged)', () => {
    let powerSeen = 0;
    let otherActions = 0;
    for (const id of ['first-light', 'calder-spire', 'under-canopy']) {
      const { host, steps } = playOut(id, id !== 'calder-spire');
      const rec = host.record();
      const truth = recordMatch(rec.setup, rec.actions);
      const view = viewTimeline(truth, 0);
      expect(steps.length, id).toBe(view.steps.length);
      const expected = view.steps.map((st, i) => ({ ...st, action: i > 0 && truth.states[i - 1].current === 0 ? st.action : null }));
      expect(steps, id).toStrictEqual(expected);
      powerSeen += steps[steps.length - 1].powerUses.reduce((a, b) => a + b, 0);
      otherActions += view.steps.filter((st, i) => i > 0 && truth.states[i - 1].current !== 0 && st.action).length;
    }
    expect(powerSeen, 'setup: some power was activated in these matches, so the count was exercised').toBeGreaterThan(0);
    expect(otherActions, 'setup: other seats acted, so the withholding was exercised').toBeGreaterThan(0);
  }, 60_000);

  it('hold no hidden unit under fog: every frame is the seat\'s own observation, with fewer units than the truth while enemies are hidden', () => {
    const { host, steps } = playOut('under-canopy', true);
    const truth = recordMatch(host.record().setup, host.record().actions);
    let fewer = 0;
    steps.forEach((st, i) => {
      expect(st.frame.viewer, `step ${i}`).toBe(0);
      expect(st.frame.fogActive, `step ${i}`).toBe(true);
      const state = truth.states[i];
      const told = new Set(st.frame.units.map((u) => u.id));
      for (const id of told) expect(state.units.some((u) => u.id === id), `step ${i}: unit ${id} exists`).toBe(true);
      if (state.units.length > st.frame.units.length) fewer++;
    });
    // a planted omniscient step would list every unit: here the seat is told fewer than exist, step after step
    expect(fewer, 'steps where something was hidden from the seat').toBeGreaterThan(steps.length / 2);
  }, 60_000);
});
