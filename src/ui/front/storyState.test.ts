// The story's pacing: which beat opens when the battle moves, and what is never shown twice. Expected answers are worked out by hand
// from the beat steps below (0, 5, 9, 20, with the battle ending at step 30).
import { describe, expect, it } from 'vitest';
import type { StoryBeat } from './missionScript';
import { STORY_START, holdsPlayback, initialStory, storyReducer, viewOf } from './storyState';
import type { StoryAction, StoryState } from './storyState';

const beat = (step: number): StoryBeat => ({ step, events: [step], lines: [{ speaker: 'narrator', text: `beat at ${step}` }] });
const BEATS = [beat(0), beat(5), beat(9), beat(20)]; // beat indexes 0..3
const LAST = 30;

const run = (actions: StoryAction[], from: StoryState = initialStory(BEATS), beats = BEATS): StoryState => actions.reduce((s, a) => storyReducer(s, a, beats), from);
const to = (step: number): StoryAction => ({ type: 'step', step });

describe('opening', () => {
  it('opens the start beat on the first paint, before the watch has reported anything', () => {
    const s = initialStory(BEATS);
    expect(s).toMatchObject({ step: 0, open: 0, seen: [0] });
    expect(holdsPlayback(s)).toBe(true);
  });

  it('opens nothing when the mission has no beat at step 0', () => {
    const s = initialStory([beat(5)]);
    expect(s.open).toBeNull();
    expect(holdsPlayback(s)).toBe(false);
  });

  it('is not disturbed when the watch then reports the same step: the first report is not a new arrival', () => {
    const s = initialStory(BEATS);
    expect(storyReducer(s, to(0), BEATS)).toBe(s);
  });

  it('starts from a step the watch has not reported with no step at all', () => {
    expect(STORY_START).toMatchObject({ step: -1, open: null, seen: [] });
  });
});

describe('moving forward', () => {
  it('opens a beat when the battle reaches its step, and closes it when the step moves on', () => {
    let s = run([to(1), to(2), to(3), to(4)]);
    expect(s.open).toBeNull();
    s = run([to(5)], s);
    expect(s.open).toBe(1);
    expect(holdsPlayback(s)).toBe(true);
    s = run([to(6)], s);
    expect(s.open).toBeNull();
    expect(s.seen).toEqual([0, 1]);
  });

  it('closes the open beat when it is read to the end, and holds playback no longer', () => {
    const s = run([{ type: 'close' }]);
    expect(s.open).toBeNull();
    expect(holdsPlayback(s)).toBe(false);
    expect(s.seen).toEqual([0]);
  });

  it('opens the next beat at once when the step moves from one beat\'s step to another\'s', () => {
    const adjacent = [beat(0), beat(1), beat(2)];
    const s = run([to(1)], initialStory(adjacent), adjacent);
    expect(s.open).toBe(1);
    expect(run([to(2)], s, adjacent).open).toBe(2);
  });
});

describe('scrubbing backward', () => {
  it('never reopens a beat that was shown: back over a moment and forward again stays quiet', () => {
    let s = run([to(5)]);
    expect(s.open).toBe(1);
    s = run([{ type: 'close' }, to(3), to(4), to(5)], s); // back to 3, forward onto 5 again
    expect(s.open).toBeNull();
    s = run([to(2), to(8)], s);                           // back further, then jump forward past it
    expect(s.open).toBeNull();
    expect(s.seen).toEqual([0, 1]);
  });

  it('opens nothing when going backward onto a beat\'s step, even one never shown', () => {
    const s = run([to(25), { type: 'close' }, to(9)]); // 25 shows beat 3 (step 20); going back to 9 lands on beat 2, which was never shown
    expect(s.open).toBeNull();
    expect(s.seen).not.toContain(2);
  });

  it('closes an open beat when the viewer steps back', () => {
    const s = run([to(5), to(4)]);
    expect(s.open).toBeNull();
  });
});

describe('jumping forward', () => {
  it('shows only the most recent beat passed, never a queue', () => {
    const s = run([to(25)]); // from 0 to 25 passes beats at 5, 9 and 20
    expect(s.open).toBe(3);
    expect(s.seen).toEqual([0, 3]);
  });

  it('shows the most recent beat of the jump even when it is not the last of the script', () => {
    const s = run([to(12)]); // passes 5 and 9
    expect(s.open).toBe(2);
  });

  it('does not mark the beats it jumped over as seen: rewind and play through them, and they are told', () => {
    let s = run([to(25), { type: 'close' }, to(4), to(5)]);
    expect(s.open).toBe(1); // the beat at 5 was jumped over, never shown, so it is shown now
    s = run([to(9)], s);
    expect(s.open).toBe(2);
    expect(run([to(20)], s).open).toBeNull(); // the one at 20 was shown at the jump and stays quiet
  });

  it('shows nothing when the most recent beat of the jump was already shown (a viewer who has been there)', () => {
    const s = run([to(25), { type: 'close' }, to(15), to(25)]); // 25 again: window (15, 25] holds beat 3, already shown
    expect(s.open).toBeNull();
  });

  it('is told once for a jump that lands exactly on a beat, and the beat is that one', () => {
    expect(run([to(9)]).open).toBe(2);
  });
});

describe('every step change closes what was open', () => {
  it('replaces an open beat by the new moment\'s when the viewer jumps while it talks', () => {
    const s = run([to(5), to(20)]);
    expect(s.open).toBe(3);
  });

  it('keeps the same state object for a step that did not change (a viewer or speed change)', () => {
    const s = run([to(5)]);
    expect(storyReducer(s, to(5), BEATS)).toBe(s);
  });

  it('ignores a close when nothing is open', () => {
    const s = run([{ type: 'close' }]);
    expect(storyReducer(s, { type: 'close' }, BEATS)).toBe(s);
  });
});

describe('the debrief', () => {
  it('takes the final step once that step\'s beat is closed', () => {
    const withEnd = [...BEATS, beat(LAST)];
    let s = run([to(LAST)], initialStory(withEnd), withEnd);
    expect(viewOf(s, LAST)).toEqual({ kind: 'beat', index: 4 }); // the victory or defeat line is spoken first
    s = run([{ type: 'close' }], s, withEnd);
    expect(viewOf(s, LAST)).toEqual({ kind: 'debrief' });
  });

  it('takes the final step at once when it has no beat of its own (an undecided battle fires neither victory nor defeat)', () => {
    const s = run([to(LAST - 1), to(LAST)]); // played forward one step at a time: nothing at 30
    expect(s.open).toBeNull();
    expect(viewOf(s, LAST)).toEqual({ kind: 'debrief' });
  });

  it('shows the last beat passed, not the debrief, when the viewer jumps straight to the end past a beat', () => {
    const s = run([to(LAST)]); // passes the beat at 20
    expect(viewOf(s, LAST)).toEqual({ kind: 'beat', index: 3 });
    expect(viewOf(run([{ type: 'close' }], s), LAST)).toEqual({ kind: 'debrief' });
  });

  it('is there only at the final step, and gone when the viewer steps back from it', () => {
    let s = run([to(LAST - 1), to(LAST)]);
    expect(viewOf(s, LAST).kind).toBe('debrief');
    s = run([to(LAST - 1)], s);
    expect(viewOf(s, LAST).kind).toBe('none');
    expect(viewOf(run([to(7), { type: 'close' }]), LAST).kind).toBe('none'); // mid-battle, with nothing open
  });

  it('is not shown before the watch has reported a step (known-bad: a final step of -1 never matches)', () => {
    expect(viewOf(STORY_START, -1).kind).toBe('none');
    expect(viewOf(STORY_START, 0).kind).toBe('none');
  });

  it('remembers that its lines were read, so coming back to the final step goes straight to the card', () => {
    let s = run([to(LAST - 1), to(LAST), { type: 'debriefRead' }, to(10), to(LAST)]);
    expect(s.debriefRead).toBe(true);
    expect(viewOf(s, LAST).kind).toBe('debrief');
    expect(storyReducer(s, { type: 'debriefRead' }, BEATS)).toBe(s);
    s = initialStory(BEATS);
    expect(s.debriefRead).toBe(false);
  });
});
