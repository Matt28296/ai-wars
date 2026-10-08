// Playback controls: the reducer, the keyboard mapping and the URL hash. And a guard that this viewer has no unit control at all.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import type { GameEvent } from '../../game/aw';
import { Controls } from './Controls';
import { cycleOfStep, formatHash, fractionOfStep, initialPlayback, keyToAction, parseHash, playbackReducer, scrubTip, stepAtPointer, timelineMarks } from './controls';
import type { PlaybackAction, PlaybackState } from './controls';
import { buildDemoMatch } from './demo';
import { powerNameOf } from './format';
import { recordMatch, viewTimeline } from './timeline';
import type { Timeline } from './timeline';
import { endTurn, fieldSetup, walk } from './testing';

const run = (s: PlaybackState, ...actions: PlaybackAction[]): PlaybackState => actions.reduce(playbackReducer, s);

describe('playbackReducer', () => {
  const start = initialPlayback(10);

  it('starts at step 0, paused, 1x, not animating', () => {
    expect(start).toEqual({ step: 0, last: 10, playing: false, speed: 1, animate: false });
  });

  it('honours the initial step, speed and autoplay, clamped to the timeline', () => {
    expect(initialPlayback(10, { step: 4, speed: 2, playing: true })).toEqual({ step: 4, last: 10, playing: true, speed: 2, animate: false });
    expect(initialPlayback(10, { step: 99 }).step).toBe(10);
    expect(initialPlayback(10, { step: -3 }).step).toBe(0);
    expect(initialPlayback(10, { step: 10, playing: true }).playing).toBe(false); // nothing left to play
  });

  it('steps forward one at a time, animating, and stepping by hand pauses playback', () => {
    const s = run(start, { type: 'forward' }, { type: 'forward' }, { type: 'forward' });
    expect(s.step).toBe(3);
    expect(s.animate).toBe(true);
    expect(s.playing).toBe(false);
    expect(run({ ...start, playing: true }, { type: 'forward' }).playing).toBe(false);
  });

  it('steps back without animating, and stops at the start', () => {
    const s = run(start, { type: 'seek', step: 3 }, { type: 'forward' }, { type: 'back' });
    expect(s.step).toBe(3);
    expect(s.animate).toBe(false);
    expect(run(start, { type: 'back' }).step).toBe(0);
  });

  it('stops at the end: forward past the last step goes nowhere', () => {
    const end = run(start, { type: 'seek', step: 10 });
    expect(end.step).toBe(10);
    expect(run(end, { type: 'forward' }).step).toBe(10);
    expect(run(end, { type: 'forward' }).playing).toBe(false);
  });

  it('seeks to any step, clamped, and snaps rather than animates', () => {
    expect(run(start, { type: 'seek', step: 7 })).toMatchObject({ step: 7, animate: false });
    expect(run(start, { type: 'seek', step: -5 }).step).toBe(0);
    expect(run(start, { type: 'seek', step: 99 }).step).toBe(10);
    expect(run(start, { type: 'seek', step: NaN }).step).toBe(0);
    expect(run(start, { type: 'seek', step: 2.9 }).step).toBe(2);
  });

  it('plays: advance moves on one step, animating, until the last step stops it', () => {
    let s = run(initialPlayback(3), { type: 'play' });
    expect(s.playing).toBe(true);
    s = run(s, { type: 'advance' });
    expect(s).toMatchObject({ step: 1, animate: true, playing: true });
    s = run(s, { type: 'advance' }, { type: 'advance' });
    expect(s).toMatchObject({ step: 3, playing: false });
    expect(run(s, { type: 'advance' }).step).toBe(3);
  });

  it('ignores an advance that arrives after a pause (a stale timer must not move a paused viewer)', () => {
    const s = run(initialPlayback(5), { type: 'play' }, { type: 'pause' }, { type: 'advance' });
    expect(s.step).toBe(0);
    expect(s.playing).toBe(false);
  });

  it('toggles play and pause, and playing from the end starts the match again', () => {
    expect(run(start, { type: 'toggle' }).playing).toBe(true);
    expect(run(start, { type: 'toggle' }, { type: 'toggle' }).playing).toBe(false);
    const replayed = run(start, { type: 'seek', step: 10 }, { type: 'toggle' });
    expect(replayed).toMatchObject({ step: 0, playing: true, animate: false });
  });

  it('changes speed without moving', () => {
    const s = run(start, { type: 'seek', step: 4 }, { type: 'speed', speed: 4 });
    expect(s).toMatchObject({ step: 4, speed: 4 });
  });

  it('keeps its position when the timeline changes, clamped to the new length', () => {
    const s = run(start, { type: 'seek', step: 8 }, { type: 'newTimeline', last: 5 });
    expect(s).toMatchObject({ step: 5, last: 5, animate: false, playing: false });
    expect(run(start, { type: 'seek', step: 8 }, { type: 'newTimeline', last: 10 }).step).toBe(8);
  });

  it('keeps 0 <= step <= last and never plays at the end, whatever the sequence of actions (property)', () => {
    const kinds: PlaybackAction[] = [
      { type: 'toggle' }, { type: 'play' }, { type: 'pause' }, { type: 'forward' }, { type: 'back' }, { type: 'advance' },
      { type: 'seek', step: -4 }, { type: 'seek', step: 3 }, { type: 'seek', step: 999 }, { type: 'speed', speed: 2 }, { type: 'newTimeline', last: 6 }, { type: 'newTimeline', last: 12 },
    ];
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let trial = 0; trial < 200; trial++) {
      let s = initialPlayback(9);
      for (let i = 0; i < 60; i++) {
        s = playbackReducer(s, kinds[next() % kinds.length]);
        expect(s.step).toBeGreaterThanOrEqual(0);
        expect(s.step).toBeLessThanOrEqual(s.last);
        if (s.step >= s.last) expect(s.playing).toBe(false);
      }
    }
  });
});

describe('there is no unit control in this viewer', () => {
  // A Record over the action union: adding an action type without listing it here is a compile error, so this list cannot go stale.
  const TYPES: Record<PlaybackAction['type'], true> = {
    toggle: true, play: true, pause: true, forward: true, back: true, seek: true, speed: true, advance: true, newTimeline: true,
  };

  it('has playback actions only: nothing that selects, orders, moves, attacks, builds or captures', () => {
    const names = Object.keys(TYPES);
    expect(names).toHaveLength(9);
    for (const n of names) expect(n, n).not.toMatch(/unit|select|order|command|attack|capture|build|take|control|click|target/i);
  });

  it('maps only Space, Left and Right (and refuses every other key, including Enter and the arrows up and down)', () => {
    const mapped = [' ', 'ArrowLeft', 'ArrowRight'];
    for (const k of mapped) expect(keyToAction({ key: k }), k).not.toBeNull();
    for (const k of ['Enter', 'ArrowUp', 'ArrowDown', 'a', 'w', 's', 'd', 'z', 'x', 'Escape', 'Tab', 'q', 'e', '1']) {
      expect(keyToAction({ key: k }), k).toBeNull();
    }
  });
});

describe('keyToAction', () => {
  it('Space plays and pauses, Left steps back, Right steps forward', () => {
    expect(keyToAction({ key: ' ' })).toEqual({ type: 'toggle' });
    expect(keyToAction({ key: 'Spacebar' })).toEqual({ type: 'toggle' });
    expect(keyToAction({ key: 'ArrowLeft' })).toEqual({ type: 'back' });
    expect(keyToAction({ key: 'ArrowRight' })).toEqual({ type: 'forward' });
  });

  it('ignores a key held with Ctrl, Meta or Alt (browser shortcuts)', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(keyToAction({ key: 'ArrowLeft', [mod]: true })).toBeNull();
      expect(keyToAction({ key: ' ', [mod]: true })).toBeNull();
    }
  });

  it('keeps Space as play/pause even when a button has focus (the page stops the button pressing itself)', () => {
    expect(keyToAction({ key: ' ' }, { tag: 'button' })).toEqual({ type: 'toggle' });
    expect(keyToAction({ key: 'ArrowRight' }, { tag: 'button' })).toEqual({ type: 'forward' });
    expect(keyToAction({ key: ' ' }, { tag: 'a' })).toBeNull(); // a link keeps its own Space
  });

  it('leaves a focused slider, field or menu its own arrow keys, but Space still plays from the slider', () => {
    expect(keyToAction({ key: 'ArrowRight' }, { tag: 'input', type: 'range' })).toBeNull();
    expect(keyToAction({ key: 'ArrowLeft' }, { tag: 'input', type: 'range' })).toBeNull();
    expect(keyToAction({ key: ' ' }, { tag: 'input', type: 'range' })).toEqual({ type: 'toggle' });
    expect(keyToAction({ key: ' ' }, { tag: 'input', type: 'checkbox' })).toBeNull();
    expect(keyToAction({ key: ' ' }, { tag: 'textarea' })).toBeNull();
    expect(keyToAction({ key: 'ArrowLeft' }, { tag: 'select' })).toBeNull();
  });
});

describe('URL hash', () => {
  it('reads step, viewer, speed and play', () => {
    expect(parseHash('#step=40')).toEqual({ step: 40 });
    expect(parseHash('#step=40&viewer=1&speed=2&play')).toEqual({ step: 40, viewer: 1, speed: 2, play: true });
    expect(parseHash('step=7&viewer=all')).toEqual({ step: 7, viewer: 'all' });
    expect(parseHash('#play=0')).toEqual({ play: false });
    expect(parseHash('')).toEqual({});
    expect(parseHash('#')).toEqual({});
  });

  it('ignores anything malformed instead of throwing (known-bad input)', () => {
    expect(parseHash('#step=abc')).toEqual({});
    expect(parseHash('#step=-1')).toEqual({});
    expect(parseHash('#step=40;drop')).toEqual({});
    expect(parseHash('#step=99999999')).toEqual({});
    expect(parseHash('#viewer=7')).toEqual({});          // not a player in a two-player match
    expect(parseHash('#viewer=-1')).toEqual({});
    expect(parseHash('#viewer=everyone')).toEqual({});
    expect(parseHash('#speed=3')).toEqual({});
    expect(parseHash('#speed=0')).toEqual({});
    expect(parseHash('#&&=&step')).toEqual({});
    expect(parseHash('#viewer=2', 3)).toEqual({ viewer: 2 }); // a third player exists in a 3-player match
  });

  it('writes a hash that reads back, omitting the default speed', () => {
    expect(formatHash({ step: 40, viewer: 1, speed: 2 })).toBe('#step=40&viewer=1&speed=2');
    expect(formatHash({ step: 0, viewer: 'all', speed: 1 })).toBe('#step=0&viewer=all');
    expect(formatHash({})).toBe('');
    const h = { step: 12, viewer: 'all' as const, speed: 4 as const };
    expect(parseHash(formatHash(h))).toEqual(h);
  });
});

// ---------------------------------------------------------------- the scrubber: cycle ticks, power markers, the cycle under the thumb

describe('the scrubber\'s ticks and markers', () => {
  const demo = buildDemoMatch();
  const rec = recordMatch(demo.setup, demo.actions);
  const powerEvents = (events: GameEvent[]) => events.filter((e): e is Extract<GameEvent, { kind: 'powerActivated' }> => e.kind === 'powerActivated');
  const everyPower = rec.rawEvents.flatMap((evs, i) => powerEvents(evs).map((e) => ({ step: i + 1, e })));

  it('ticks the start of each cycle, one per cycle, at the first step that reads the new cycle number', () => {
    for (const viewer of [0, 1, 'all'] as const) {
      const tl = viewTimeline(rec, viewer);
      const m = timelineMarks(tl.steps);
      // the engine's own cycle numbers: state.cycle after each action, computed here from the recorded states
      const expected: { step: number; cycle: number }[] = [{ step: 0, cycle: rec.states[0].cycle }];
      for (let i = 1; i < rec.states.length; i++) if (rec.states[i].cycle !== rec.states[i - 1].cycle) expected.push({ step: i, cycle: rec.states[i].cycle });
      expect(m.cycles.map((t) => ({ step: t.step, cycle: t.cycle })), `viewer ${viewer}`).toEqual(expected);
      expect(m.cycles.length).toBeGreaterThan(5);
      expect(m.cycles[0]).toMatchObject({ step: 0, cycle: 1, major: true });
      expect(m.last).toBe(tl.last);
    }
  });

  it('draws every fifth cycle taller, so the ticks can be counted', () => {
    const m = timelineMarks(viewTimeline(rec, 'all').steps);
    for (const t of m.cycles) expect(t.major, `cycle ${t.cycle}`).toBe(t.cycle === 1 || t.cycle % 5 === 0);
    expect(m.cycles.filter((t) => t.major).length).toBeGreaterThan(1);
    expect(m.cycles.filter((t) => !t.major).length).toBeGreaterThan(m.cycles.filter((t) => t.major).length);
  });

  it('marks each power activation at its own step, in the activating side\'s faction, and none that did not happen', () => {
    expect(everyPower.length).toBeGreaterThanOrEqual(2); // the demo has real activations to mark
    for (const viewer of [0, 1, 'all'] as const) {
      const tl = viewTimeline(rec, viewer); // an activation is public: a fogged viewer's scrubber marks the enemy's too
      const m = timelineMarks(tl.steps);
      expect(m.powers.map((p) => ({ step: p.step, player: p.player, level: p.level })), `viewer ${viewer}`)
        .toEqual(everyPower.map(({ step, e }) => ({ step, player: e.player, level: e.level })));
      for (const p of m.powers) {
        const truth = rec.states[p.step].players[p.player];
        expect(p.faction).toBe(truth.faction);
        expect(p.commander).toBe(truth.commander);
        expect(p.label).toBe(`${COMMANDERS[truth.commander].name}: ${powerNameOf(truth.commander, p.level)}`);
      }
    }
  });

  it('has no power marker for a match without a power, and one tick for a match that never leaves cycle 1 (known-bad: no invented marks)', () => {
    const quiet = recordMatch(fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true }), [walk(1, [0, 1, 2, 3])]);
    const m = timelineMarks(viewTimeline(quiet, 0).steps);
    expect(m.powers).toEqual([]);
    expect(m.cycles).toEqual([{ step: 0, cycle: 1, major: true }]);
    // an end of turn passes play to the other player but starts no new cycle until both have moved
    const half = timelineMarks(viewTimeline(recordMatch(fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true }), [endTurn]), 0).steps);
    expect(half.cycles).toHaveLength(1);
    const full = timelineMarks(viewTimeline(recordMatch(fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true }), [endTurn, endTurn]), 0).steps);
    expect(full.cycles.map((t) => [t.step, t.cycle])).toEqual([[0, 1], [2, 2]]);
  });

  it('survives an empty timeline', () => {
    expect(timelineMarks([])).toEqual({ last: 0, cycles: [], powers: [] });
    expect(cycleOfStep({ last: 0, cycles: [], powers: [] }, 5)).toBe(1);
  });

  it('names the cycle under a step: the latest tick at or before it', () => {
    const m = timelineMarks(viewTimeline(rec, 0).steps);
    for (let i = 0; i < m.cycles.length; i++) {
      const t = m.cycles[i];
      expect(cycleOfStep(m, t.step)).toBe(t.cycle);
      const before = t.step - 1;
      if (before >= 0) expect(cycleOfStep(m, before)).toBe(m.cycles[i - 1].cycle);
    }
    for (let s = 0; s <= m.last; s++) expect(cycleOfStep(m, s)).toBe(rec.states[s].cycle); // against the engine, at every step
  });

  it('writes the tooltip as "Cycle 04 · step 40", adding the power activated at that step', () => {
    const m = timelineMarks(viewTimeline(rec, 0).steps);
    expect(scrubTip(m, 40)).toBe(`Cycle ${String(rec.states[40].cycle).padStart(2, '0')} · step 40`);
    const first = m.powers[0];
    expect(scrubTip(m, first.step)).toBe(`Cycle ${String(rec.states[first.step].cycle).padStart(2, '0')} · step ${first.step} · ${first.label} (${first.level === 'surge' ? 'Surge' : 'Overclock'})`);
    expect(scrubTip(m, first.step + 1)).not.toContain(first.label); // the step after is only a step
  });

  it('puts a mark where the thumb\'s centre stops: 0 at the start, 1 at the end, never outside (known-bad input)', () => {
    expect(fractionOfStep(0, 280)).toBe(0);
    expect(fractionOfStep(280, 280)).toBe(1);
    expect(fractionOfStep(70, 280)).toBe(0.25);
    expect(fractionOfStep(-5, 280)).toBe(0);
    expect(fractionOfStep(999, 280)).toBe(1);
    expect(fractionOfStep(3, 0)).toBe(0);
  });

  it('turns a pointer position into the step under it, with the thumb\'s half width at each end', () => {
    const track = { left: 100, width: 216 }; // a 16 px thumb: its centre runs 108 .. 308, 200 px
    expect(stepAtPointer(108, track, 16, 100)).toBe(0);
    expect(stepAtPointer(308, track, 16, 100)).toBe(100);
    expect(stepAtPointer(208, track, 16, 100)).toBe(50);
    expect(stepAtPointer(0, track, 16, 100)).toBe(0); // left of the track: clamped
    expect(stepAtPointer(999, track, 16, 100)).toBe(100);
    expect(stepAtPointer(209, track, 16, 100)).toBe(51); // 0.5 px per step: rounds to the nearest
    expect(stepAtPointer(150, { left: 100, width: 16 }, 16, 100)).toBe(0); // a track no wider than its thumb
    expect(stepAtPointer(150, track, 16, 0)).toBe(0); // a timeline with one step
  });
});

describe('the scrubber\'s markup', () => {
  const demo = buildDemoMatch();
  const rec = recordMatch(demo.setup, demo.actions);
  const tl: Timeline = viewTimeline(rec, 0);
  const html = (timeline: Timeline | undefined, step = 40) =>
    renderToStaticMarkup(createElement(Controls, { state: initialPlayback(tl.last, { step }), dispatch: () => undefined, timeline }));

  it('draws one tick per cycle and one marker per power activation, at the right places along the track', () => {
    const marks = timelineMarks(tl.steps);
    const out = html(tl);
    expect((out.match(/class="aww-tick/g) ?? []).length).toBe(marks.cycles.length);
    expect((out.match(/class="aww-pmark/g) ?? []).length).toBe(marks.powers.length);
    expect((out.match(/aww-pmark--surge/g) ?? []).length).toBe(marks.powers.filter((p) => p.level === 'surge').length);
    expect((out.match(/aww-pmark--overclock/g) ?? []).length).toBe(marks.powers.filter((p) => p.level === 'overclock').length);
    expect((out.match(/aww-tick--major/g) ?? []).length).toBe(marks.cycles.filter((t) => t.major).length);
    // positions: the second cycle's tick is where its step sits on the 0..1 track
    const second = marks.cycles[1];
    expect(out).toContain(`style="--p:${second.step / tl.last}" data-cycle="${second.cycle}"`);
  });

  it('shows the cycle under the thumb in the tooltip and in the slider\'s spoken value', () => {
    const marks = timelineMarks(tl.steps);
    const cycle = cycleOfStep(marks, 40);
    const out = html(tl);
    expect(out).toContain(`Cycle ${String(cycle).padStart(2, '0')} · step 40`);
    expect(out).toContain(`aria-valuetext="Step 40 of ${tl.last}, cycle ${cycle}"`);
    expect(out).toContain('class="aww-track-tip');
  });

  it('is a plain slider, with no ticks, markers or tooltip, when it has no timeline to read (known-bad: nothing invented)', () => {
    const out = html(undefined);
    expect(out).not.toContain('aww-tick');
    expect(out).not.toContain('aww-pmark');
    expect(out).not.toContain('aww-track-tip');
    expect(out).toContain('type="range"');
    expect(out).toContain(`aria-valuetext="Step 40 of ${tl.last}"`);
  });
});
