// Playback controls: the reducer, the keyboard mapping and the URL hash. And a guard that this viewer has no unit control at all.
import { describe, expect, it } from 'vitest';
import { formatHash, initialPlayback, keyToAction, parseHash, playbackReducer } from './controls';
import type { PlaybackAction, PlaybackState } from './controls';

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
