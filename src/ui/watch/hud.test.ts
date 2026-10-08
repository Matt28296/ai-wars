// The HUD's numbers. The star meter is checked against the engine's own powerStars() on a real state, not against hud.ts itself.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { POWER_STAR, createGame, powerStars, propertyCount } from '../../game/aw';
import type { GameEvent, GameState } from '../../game/aw';
import { observe } from '../../game/aw/observe';
import { buildDemoMatch } from './demo';
import { Hud } from './Hud';
import { PowerMeter } from './kit';
import {
  FUNDS_TWEEN_MS, METER_TWEEN_MS, playerPanels, prefersReducedMotion, propertiesOf, starMeter, starValueAfter, tweenAt, tweenDuration,
} from './hud';
import { recordMatch, viewTimeline } from './timeline';
import type { TimelineStep } from './timeline';
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

// ---------------------------------------------------------------- funds tick, the meter fills, a property count

/** The values a 60 fps clock would show for a tween: one per 16 ms frame up to and past the end. */
function frames(from: number, to: number, durationMs: number, round = false): number[] {
  const out: number[] = [];
  for (let t = 0; t < durationMs + 48; t += 16) {
    const v = tweenAt(from, to, t, durationMs);
    out.push(round ? Math.round(v) : v);
  }
  return out;
}

describe('the funds tween', () => {
  it('takes about 400 ms, and the power meter a little longer', () => {
    expect(FUNDS_TWEEN_MS).toBe(400);
    expect(METER_TWEEN_MS).toBeGreaterThan(FUNDS_TWEEN_MS);
    expect(METER_TWEEN_MS).toBeLessThanOrEqual(800);
  });

  it('starts at the old value, passes through values in between, and ends EXACTLY on the new one, up or down', () => {
    for (const [from, to] of [[1000, 7000], [7000, 1000], [0, 12_345], [9_000, 8_999], [100, 100]] as const) {
      expect(tweenAt(from, to, 0, FUNDS_TWEEN_MS), `${from} -> ${to} at 0`).toBe(from);
      expect(tweenAt(from, to, FUNDS_TWEEN_MS, FUNDS_TWEEN_MS), `${from} -> ${to} at the end`).toBe(to);
      expect(tweenAt(from, to, FUNDS_TWEEN_MS * 3, FUNDS_TWEEN_MS)).toBe(to);
      const shown = frames(from, to, FUNDS_TWEEN_MS, true);
      expect(shown[0]).toBe(from);
      expect(shown[shown.length - 1]).toBe(to);
      expect(Number.isInteger(shown[shown.length - 1])).toBe(true);
      // monotonic toward the target, never overshooting it
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      shown.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
        if (i > 0) expect(to >= from ? v >= shown[i - 1] : v <= shown[i - 1]).toBe(true);
      });
    }
  });

  it('is a tween, not a jump: a 6,000 CR change shows many different values on the way (known-bad: an instant change)', () => {
    const shown = frames(1000, 7000, FUNDS_TWEEN_MS, true);
    expect(new Set(shown).size).toBeGreaterThan(10);
    const halfway = tweenAt(1000, 7000, FUNDS_TWEEN_MS / 2, FUNDS_TWEEN_MS);
    expect(halfway).toBeGreaterThan(1000);
    expect(halfway).toBeLessThan(7000);
    expect(tweenAt(1000, 7000, FUNDS_TWEEN_MS / 4, FUNDS_TWEEN_MS)).toBeLessThan(7000); // 100 ms in, still on its way
  });

  it('is instant under reduced motion: no duration, so the new value on the very first read', () => {
    expect(tweenDuration(FUNDS_TWEEN_MS, true)).toBe(0);
    expect(tweenDuration(METER_TWEEN_MS, true)).toBe(0);
    expect(tweenDuration(FUNDS_TWEEN_MS, false)).toBe(FUNDS_TWEEN_MS);
    expect(tweenAt(1000, 7000, 0, tweenDuration(FUNDS_TWEEN_MS, true))).toBe(7000);
    expect(tweenAt(7000, 1000, 5, 0)).toBe(1000);
    // a duration that is not a positive number never animates either (0 means none, never "forever")
    for (const bad of [0, -1, Number.NaN]) expect(tweenDuration(bad, false), String(bad)).toBe(0);
    for (const bad of [0, -400, Number.NaN]) expect(tweenAt(1, 9, 100, bad), String(bad)).toBe(9);
  });

  it('reads the reader\'s reduced-motion setting, and is false where there is no window', () => {
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q.includes('prefers-reduced-motion: reduce') }) });
    expect(prefersReducedMotion()).toBe(true);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal('window', {});
    expect(prefersReducedMotion()).toBe(false);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('the power meter glows when a power is affordable', () => {
  const html = (p: { value: number; surge?: number; max?: number; active?: 'surge' | 'overclock' | null }) => renderToStaticMarkup(createElement(PowerMeter, { surge: 3, max: 6, ...p }));

  it('glows from the Surge price up, and while a power is running; not below (known-bad: 2.9 of 3 stars)', () => {
    expect(html({ value: 3 })).toContain('aw-power--ready');
    expect(html({ value: 6 })).toContain('aw-power--ready');
    expect(html({ value: 0, active: 'surge' })).toContain('aw-power--ready');
    expect(html({ value: 2.9 })).not.toContain('aw-power--ready');
    expect(html({ value: 0 })).not.toContain('aw-power--ready');
  });

  it('says it in words as well: Surge ready, Overclock ready, Charging', () => {
    expect(html({ value: 3 })).toContain('Surge ready');
    expect(html({ value: 6 })).toContain('Overclock ready');
    expect(html({ value: 1 })).toContain('Charging');
  });

  it('never glows for a commander with no power at all (known-bad: surge 0 must not read as affordable)', () => {
    expect(html({ value: 0, surge: 0, max: 0 })).not.toContain('aw-power--ready');
  });
});

describe('properties beside units', () => {
  const demo = buildDemoMatch();
  const rec = recordMatch(demo.setup, demo.actions);

  it('counts each side\'s properties exactly as the engine does, at every step, for a fogged viewer and an omniscient one', () => {
    for (const viewer of [0, 1, 'all'] as const) {
      const tl = viewTimeline(rec, viewer);
      let changed = false;
      tl.steps.forEach((s, i) => {
        for (const p of [0, 1] as const) {
          expect(propertiesOf(s.frame, p), `viewer ${viewer} step ${i} player ${p}`).toBe(propertyCount(rec.states[i], p));
        }
        if (i > 0 && propertiesOf(s.frame, 0) !== propertiesOf(tl.steps[i - 1].frame, 0)) changed = true;
      });
      expect(changed, 'the count really moves during the match').toBe(true);
    }
  });

  it('puts the count in each panel, public for the enemy under fog while its units stay "?"', () => {
    const step = viewTimeline(rec, 0).steps[40];
    const [mine, theirs] = playerPanels(step);
    expect(mine.properties).toBe(propertyCount(rec.states[40], 0));
    expect(theirs.properties).toBe(propertyCount(rec.states[40], 1));
    expect(theirs.units).toBeNull();
    const html = renderToStaticMarkup(createElement(Hud, { step }));
    expect(html).toContain(`aria-label="${theirs.properties} properties held"`);
    expect(html).toContain('aria-label="unknown units, hidden by fog"');
    expect(html).toContain(`aria-label="${mine.units} units"`);
  });

  it('is zero for a side with no property, and never counts a property the viewer\'s frame gives to nobody (known-bad input)', () => {
    const f = viewTimeline(rec, 'all').steps[0].frame;
    const stripped = { ...f, tiles: f.tiles.map((row) => row.map((t) => ({ ...t, owner: null }))) };
    expect(propertiesOf(stripped, 0)).toBe(0);
    expect(propertiesOf(stripped, 1)).toBe(0);
    expect(propertiesOf(f, 7)).toBe(0); // a player that does not exist
    // an owner on a tile that is not a property is not a property held
    const odd = { ...f, tiles: f.tiles.map((row) => row.map((t) => (t.terrain === 'flats' ? { ...t, owner: 0 } : t))) };
    expect(propertiesOf(odd, 0)).toBe(propertiesOf(f, 0));
  });
});

describe('a defeated side\'s panel', () => {
  const demo = buildDemoMatch();
  const step = viewTimeline(recordMatch(demo.setup, demo.actions), 'all').steps[40];
  const defeated: TimelineStep = { ...step, frame: { ...step.frame, players: step.frame.players.map((p) => (p.index === 1 ? { ...p, defeated: true } : p)) } };

  it('keeps its Defeated chip and its numbers, and is marked so the portrait can be greyed', () => {
    const html = renderToStaticMarkup(createElement(Hud, { step: defeated }));
    expect(html).toContain('aww-hud--defeated');
    expect(html).toContain('Defeated');
    expect(html).toContain(COMMANDERS.sefa.name);
    expect((html.match(/aww-hud--defeated/g) ?? []).length).toBe(1); // only the defeated side
    // known-bad counterpart: nobody defeated, nobody greyed
    const alive = renderToStaticMarkup(createElement(Hud, { step }));
    expect(alive).not.toContain('aww-hud--defeated');
    expect(alive).not.toContain('Defeated');
  });

  it('never carries the Turn marker once defeated', () => {
    const turnOnDefeated: TimelineStep = { ...defeated, frame: { ...defeated.frame, current: 1 } };
    const html = renderToStaticMarkup(createElement(Hud, { step: turnOnDefeated }));
    expect(html).not.toContain('>Turn<');
  });
});
