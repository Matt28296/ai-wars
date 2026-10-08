// The demo match: deterministic, legal, and showing what the viewer exists to show (fog, a power cut-in, fights, a winner).
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { replay, stateHash } from '../../game/aw/replay';
import { DEMO_MAP_ID, buildDemoMatch, demoSetup } from './demo';
import { recordMatch, viewTimeline } from './timeline';

describe('the demo match', () => {
  const demo = buildDemoMatch();

  it('is calder-fields with Rook Okafor (Helion) against Sefa Tamura (Tidewell), fog on', () => {
    const s = demoSetup();
    expect(s.map.id).toBe(DEMO_MAP_ID);
    expect(s.map.id).toBe('calder-fields');
    expect(s.players.map((p) => p.commander)).toEqual([COMMANDERS.rook.id, COMMANDERS.sefa.id]);
    expect(s.players.map((p) => p.faction)).toEqual(['helion', 'tidewell']);
    expect(s.fog).toBe(true);
  });

  it('plays the same game every time: the same seeds give the same actions, so a #step link is stable', () => {
    expect(JSON.stringify(buildDemoMatch().actions)).toBe(JSON.stringify(demo.actions));
  });

  it('is a legal game: the engine replays every action and reaches a winner', () => {
    expect(demo.actions.length).toBeGreaterThan(100);
    const r = replay(demo.setup, demo.actions);
    expect(r.state.winnerTeam).not.toBeNull();
    const rec = recordMatch(demo.setup, demo.actions);
    expect(stateHash(rec.states[rec.states.length - 1])).toBe(stateHash(r.state));
  });

  it('gives a fogged watcher something to look at: a power cut-in, fights and kills it can see, and a victory', () => {
    const rec = recordMatch(demo.setup, demo.actions);
    for (const viewer of [0, 1] as const) {
      const tl = viewTimeline(rec, viewer);
      const kinds = new Set(tl.steps.flatMap((s) => s.events.map((e) => e.kind)));
      for (const k of ['powerActivated', 'attacked', 'destroyed', 'captured', 'built', 'victory'] as const) expect(kinds.has(k), `viewer ${viewer} sees ${k}`).toBe(true);
      expect(tl.steps.every((s) => s.frame.fogActive)).toBe(true);
    }
  });

  it('shows the whole story to the omniscient viewer, who sees at least everything a player sees', () => {
    const rec = recordMatch(demo.setup, demo.actions);
    const count = (v: 0 | 1 | 'all'): number => viewTimeline(rec, v).steps.reduce((n, s) => n + s.events.length, 0);
    expect(count('all')).toBeGreaterThanOrEqual(count(0));
    expect(count('all')).toBeGreaterThanOrEqual(count(1));
    expect(count('all')).toBe(rec.rawEvents.reduce((n, e) => n + e.length, 0));
  });
});
