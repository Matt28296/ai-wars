// What the story shows while the battle plays (G13), pure: which beat of the mission's script is open, and which have been seen.
//
// The watch view reports the step on screen (its `onStep`); this machine answers with the beat to show, if any. Its rules:
//   - A beat opens only when the step moves FORWARD onto or past it. Reaching a step that holds a beat opens it, and the watch holds
//     playback until it is closed.
//   - Moving BACK never opens anything, and a beat that was shown is never shown again in this viewing: scrub back over a moment and
//     forward again, and it stays quiet. ("Watch again" is a new viewing: the screen starts a fresh machine.)
//   - Jumping forward past several beats shows only the most recent one, never a queue. The ones jumped over were not shown, so they are
//     not marked seen: a viewer who rewinds and plays through them still gets them.
//   - Any change of step closes the beat that was open. The dialogue belongs to the moment it fired in.
import type { StoryBeat } from './missionScript';

export interface StoryState {
  /** The step on screen; -1 before the watch has reported one. */
  step: number;
  /** Indexes into the beat list of the beats already shown. */
  seen: readonly number[];
  /** The beat on screen now (an index into the beat list), or null. */
  open: number | null;
  /** The debrief's lines were read to the end in this viewing, so coming back to the final step goes straight to the card. */
  debriefRead: boolean;
}

export type StoryAction =
  | { type: 'step'; step: number }
  | { type: 'close' }
  | { type: 'debriefRead' };

/** The state before the watch has reported anything. */
export const STORY_START: StoryState = { step: -1, seen: [], open: null, debriefRead: false };

/** The state at the watch's first step: step 0's beat (the mission's `start`) is already open on the first paint. */
export function initialStory(beats: readonly StoryBeat[], firstStep = 0): StoryState {
  return storyReducer(STORY_START, { type: 'step', step: firstStep }, beats);
}

export function storyReducer(state: StoryState, action: StoryAction, beats: readonly StoryBeat[]): StoryState {
  switch (action.type) {
    case 'close':
      return state.open === null ? state : { ...state, open: null };
    case 'debriefRead':
      return state.debriefRead ? state : { ...state, debriefRead: true };
    case 'step': {
      const to = action.step;
      if (to === state.step) return state;
      let open: number | null = null;
      let seen = state.seen;
      if (to > state.step) {
        // The most recent beat in (from, to]: the one a viewer who jumped actually arrives at.
        let pick = -1;
        beats.forEach((b, i) => { if (b.step > state.step && b.step <= to) pick = i; });
        if (pick >= 0 && !seen.includes(pick)) {
          open = pick;
          seen = [...seen, pick];
        }
      }
      return { ...state, step: to, open, seen };
    }
  }
}

/** Whether the watch should hold its own playback: a beat is open, so the story is talking. */
export const holdsPlayback = (state: StoryState): boolean => state.open !== null;

/** What the overlay shows for a state: the beat's dialogue, the debrief at the final step, or nothing. */
export type StoryView = { kind: 'none' } | { kind: 'beat'; index: number } | { kind: 'debrief' };

/** The debrief takes the final step once its beat (the victory or defeat line) is closed. */
export function viewOf(state: StoryState, last: number): StoryView {
  if (state.open !== null) return { kind: 'beat', index: state.open };
  if (state.step >= 0 && state.step === last) return { kind: 'debrief' };
  return { kind: 'none' };
}
