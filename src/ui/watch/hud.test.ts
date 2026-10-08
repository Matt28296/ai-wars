// The HUD's numbers. The star meter is checked against the engine's own powerStars() on a real state, not against hud.ts itself.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { POWER_STAR, createGame, powerStars } from '../../game/aw';
import type { GameEvent, GameState } from '../../game/aw';
import { observe } from '../../game/aw/observe';
import { buildDemoMatch } from './demo';
import { playerPanels, starMeter, starValueAfter } from './hud';
import { recordMatch, viewTimeline } from './timeline';
import { endTurn, fieldSetup, walk } from './testing';

describe('starValueAfter', () => {
  it('prices a star at the base value, then 20% dearer per activation, capped at double', () => {
    expect(POWER_STAR).toBe(9000);
    expect(starValueAfter(0)).toBe(9000);
    expect(starValueAfter(1)).toBeCloseTo(10800, 6);
    expect(starValueAfter(3)).toBeCloseTo(14400, 6);
    expect(starValueAfter(5)).toBeCloseTo(18000, 6);
    expect(starValueAfter(9)).toBeCloseTo(18000, 6); // the cap
  });
});

describe('starMeter agrees with the engine', () => {
  const setup = fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true });
  const withMeter = (power: number, uses: number): GameState => {
    const s = createGame(setup);
    return { ...s, players: s.players.map((p) => (p.index === 0 ? { ...p, power, powerUses: uses } : p)) };
  };

  it('fills the same fraction of a star as powerStars(), for any number of previous activations', () => {
    for (const [power, uses] of [[0, 0], [13500, 0], [13500, 1], [20000, 2], [40000, 7], [54000, 0]] as const) {
      const state = withMeter(power, uses);
      const seen = observe(state, 1).players[0]; // as an ENEMY sees it, through the observation only
      const m = starMeter(seen, uses);
      const engine = powerStars(state, 0);
      const expected = Math.min(engine.overclock, engine.filled);
      expect(m.value, `${power}/${uses}`).toBeCloseTo(expected, 9);
      expect(m.surge).toBe(engine.surge);
      expect(m.max).toBe(engine.overclock);
    }
  });

  it('reads the commander\'s costs from the commander table: Rook buys Surge at 3 stars and Overclock at 6', () => {
    expect(COMMANDERS.rook.surge!.stars).toBe(3);
    const m = starMeter(observe(withMeter(0, 0), 0).players[0], 0);
    expect(m).toEqual({ value: 0, surge: 3, max: 6 });
  });

  it('is empty for a commander the table does not have, and never above the bar (known-bad inputs)', () => {
    const p = observe(withMeter(10, 0), 0).players[0];
    expect(starMeter({ ...p, commander: 'nobody' }, 0)).toEqual({ value: 0, surge: 0, max: 0 });
    expect(starMeter({ ...p, power: 10_000_000 }, 0).value).toBe(6);
  });
});

describe('playerPanels', () => {
  const rec = recordMatch(fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true }), [walk(1, [0, 1, 2, 3]), endTurn]);

  it('shows both commanders, factions and funds from the viewer\'s frame, and marks whose turn it is', () => {
    const [a, b] = playerPanels(viewTimeline(rec, 0).steps[0]);
    expect(a).toMatchObject({ index: 0, faction: 'helion', commanderName: COMMANDERS.rook.name, initials: COMMANDERS.rook.initials, funds: 0, isCurrent: true, defeated: false });
    expect(b).toMatchObject({ index: 1, faction: 'tidewell', commanderName: COMMANDERS.sefa.name, isCurrent: false });
    const after = playerPanels(viewTimeline(rec, 0).steps[2]);
    expect(after.map((p) => p.isCurrent)).toEqual([false, true]);
  });

  it('counts its own units and shows "?" (null) for the enemy under fog, but the true count to an omniscient viewer', () => {
    const fog = playerPanels(viewTimeline(rec, 0).steps[2]);
    expect(fog.map((p) => p.units)).toEqual([1, null]);
    const all = playerPanels(viewTimeline(rec, 'all').steps[2]);
    expect(all.map((p) => p.units)).toEqual([1, 1]);
  });

  it('reports a running power from the observation, with the meter emptied by the activation', () => {
    const demo = buildDemoMatch();
    const demoRec = recordMatch(demo.setup, demo.actions);
    const tl = viewTimeline(demoRec, 0);
    const first = tl.steps.find((s) => s.events.some((e) => e.kind === 'powerActivated'))!;
    const who = first.events.find((e): e is Extract<GameEvent, { kind: 'powerActivated' }> => e.kind === 'powerActivated');
    expect(who).toBeDefined();
    const player = who!.player;
    const truth = demoRec.states[first.index].players[player];
    const panel = playerPanels(first)[player];
    expect(truth.powerState).not.toBe('none');
    expect(panel.active).toBe(truth.powerState);
    expect(panel.meter.value).toBe(0); // D-014: activating empties the whole meter
    expect(first.powerUses[player]).toBe(truth.powerUses);
    // and the step before it showed no power running
    expect(playerPanels(tl.steps[first.index - 1])[player].active).toBeNull();
  });
});
