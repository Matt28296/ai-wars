// The briefing scene's logic (G9), pure: what each line looks like, and the little machine that walks a mission's briefing.
//
// The source games' signature scene: a dialogue box over the mission's map, the speaker's portrait on the side the line names, text
// that types itself, and a press that first completes the line and then advances it. After the last line comes the objective card.
// quality-bar.md 17.7: typewriter at about 30 characters a second, the first press completes, the next advances, Skip jumps ahead.
import type { DialogueLine, Mission, Mood } from '../../content/types';
import { speakerOf } from './people';
import type { Person } from './people';

export const CHARS_PER_SECOND = 30;

/** How a line is shown. `side` is null for the narrator, who has no portrait and speaks from the middle of the box. */
export interface LineView {
  person: Person;
  side: 'left' | 'right' | null;
  mood: Mood;
  channel?: string;
  text: string;
}

export function lineView(line: DialogueLine): LineView {
  const person = speakerOf(line.speaker);
  const narrator = person.kind === 'narrator';
  return {
    person,
    side: narrator ? null : line.side ?? 'left',
    mood: line.mood ?? 'neutral',
    ...(line.channel ? { channel: line.channel } : {}),
    text: line.text,
  };
}

/** The length of a line in characters as a reader counts them (a code point is one). */
export const lengthOf = (text: string): number => Array.from(text).length;
/** The first `shown` characters of a line. */
export const revealed = (text: string, shown: number): string => Array.from(text).slice(0, Math.max(0, shown)).join('');
/** How many characters have appeared `elapsedMs` after the line began. */
export const charsAfter = (elapsedMs: number, cps = CHARS_PER_SECOND): number => Math.floor((Math.max(0, elapsedMs) / 1000) * cps);

export type BriefingPhase = 'dialogue' | 'objective';

export interface BriefingState {
  phase: BriefingPhase;
  /** The line on screen (always a valid index while the phase is 'dialogue'). */
  index: number;
  /** Characters of that line showing. */
  shown: number;
}

export type BriefingAction =
  | { type: 'tick'; shown: number }   // the typewriter has reached this many characters
  | { type: 'complete' }              // show the whole line at once (reduced motion)
  | { type: 'confirm' }               // click, Space or Enter
  | { type: 'skip' }                  // straight to the objective card
  | { type: 'restart' };              // back to the first line

export function initialBriefing(lines: readonly DialogueLine[]): BriefingState {
  return lines.length ? { phase: 'dialogue', index: 0, shown: 0 } : { phase: 'objective', index: 0, shown: 0 };
}

export function stepBriefing(state: BriefingState, action: BriefingAction, lines: readonly DialogueLine[]): BriefingState {
  if (action.type === 'restart') return initialBriefing(lines);
  if (action.type === 'skip') return { phase: 'objective', index: Math.max(0, lines.length - 1), shown: lines.length ? lengthOf(lines[lines.length - 1].text) : 0 };
  if (state.phase === 'objective') return state;
  const len = lengthOf(lines[state.index].text);
  switch (action.type) {
    case 'tick': {
      const shown = Math.min(len, Math.max(state.shown, action.shown));
      return shown === state.shown ? state : { ...state, shown };
    }
    case 'complete': return state.shown === len ? state : { ...state, shown: len };
    case 'confirm':
      if (state.shown < len) return { ...state, shown: len };
      if (state.index + 1 < lines.length) return { phase: 'dialogue', index: state.index + 1, shown: 0 };
      return { phase: 'objective', index: state.index, shown: len };
  }
}

// ---------------------------------------------------------------- the objective card

export interface ObjectiveChip { label: string; tone: 'plain' | 'warn' }

/** The facts under the objective: how long, what the eye can see, what the sky is doing. */
export function objectiveChips(m: Mission): ObjectiveChip[] {
  const chips: ObjectiveChip[] = [];
  if (m.turnLimit !== undefined) chips.push({ label: `Limit ${m.turnLimit} cycles`, tone: 'warn' });
  chips.push({ label: m.fog ? 'Fog of war' : 'Clear sight', tone: 'plain' });
  chips.push(m.weather === 'ionstorm' ? { label: 'Ion storm', tone: 'warn' } : { label: 'Clear skies', tone: 'plain' });
  return chips;
}
