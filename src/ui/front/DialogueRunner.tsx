// A run of dialogue lines over a battle (G13): the briefing's own dialogue box, line by line, with the briefing's own state machine
// (briefing.ts): typewriter at 30 characters a second, a press completes the line and the next advances, and after the last line the
// run is done and `onDone` is called once. The parent mounts one runner per run and gives it a `key`, so a new run starts from line one.
//
// Keys: Space and Enter advance. The runner listens on the window in the CAPTURE phase and stops the key there, because the watch view
// listens on the same window and would otherwise read the same Space as "play/pause". Enter on a focused link or button still presses it,
// and a text field keeps its own keys. A held key (auto-repeat) is swallowed without advancing, so holding Space cannot skip a scene.
// A run of more than one line carries a Skip button until its last line: it ends the run, as the briefing's Skip ends the briefing.
// Under reduced motion every line appears whole, and the box does not slide (front.css).
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ReactElement } from 'react';
import type { DialogueLine } from '../../content/types';
import { CHARS_PER_SECOND, charsAfter, initialBriefing, lengthOf, lineView, stepBriefing } from './briefing';
import type { BriefingState } from './briefing';
import { DialogueBox, useNarrow } from './BriefingView';
import { useReducedMotion } from './hooks';

/** Characters of a line showing `elapsedMs` after it began: the typewriter's pace, or the whole line under reduced motion. */
export function typewriterShown(reduced: boolean, elapsedMs: number, length: number): number {
  return reduced ? length : Math.min(length, charsAfter(elapsedMs));
}

export interface DialogueRunnerProps {
  lines: readonly DialogueLine[];
  /** Called once, when the last line has been read. */
  onDone: () => void;
  compact?: boolean;
  /** Where the run starts (tests and screenshots); by default at the first line, untyped. */
  initial?: BriefingState;
  /** Leave this off in a test or screenshot that must not move on its own. */
  paused?: boolean;
}

export function DialogueRunner({ lines, onDone, compact = true, initial, paused = false }: DialogueRunnerProps): ReactElement | null {
  const reduced = useReducedMotion();
  const narrow = useNarrow();
  const [state, dispatch] = useReducer(
    (s: BriefingState, a: Parameters<typeof stepBriefing>[1]) => stepBriefing(s, a, lines),
    undefined,
    () => initial ?? initialBriefing(lines),
  );
  const len = state.phase === 'dialogue' ? lengthOf(lines[state.index].text) : 0;
  const lineDone = state.phase !== 'dialogue' || state.shown >= len;

  useEffect(() => {
    if (state.phase !== 'dialogue' || lineDone || paused) return undefined;
    if (reduced) {
      dispatch({ type: 'complete' });
      return undefined;
    }
    const began = performance.now() - (state.shown / CHARS_PER_SECOND) * 1000;
    const id = window.setInterval(() => dispatch({ type: 'tick', shown: typewriterShown(false, performance.now() - began, len) }), 33);
    return () => window.clearInterval(id);
    // `state.shown` is read only to resume where the line was; the timer is restarted by the line, not by each character.
  }, [state.phase, state.index, lineDone, reduced, paused, len]);

  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finished = useRef(false);
  useEffect(() => {
    if (state.phase === 'objective' && !finished.current) {
      finished.current = true;
      doneRef.current();
    }
  }, [state.phase]);

  const confirm = useCallback(() => dispatch({ type: 'confirm' }), []);
  const skip = useCallback(() => dispatch({ type: 'skip' }), []);

  useEffect(() => {
    let swallowSpace = false;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const space = e.key === ' ' || e.key === 'Spacebar';
      if (!space && e.key !== 'Enter') return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t?.closest('input, textarea, select')) return;
      if (e.key === 'Enter' && t?.closest('a, button')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (space) swallowSpace = true;
      if (!e.repeat) confirm();
    };
    // A focused button presses itself when Space is released; the key was ours, so it must not.
    const onKeyUp = (e: KeyboardEvent): void => {
      if (swallowSpace && (e.key === ' ' || e.key === 'Spacebar')) {
        swallowSpace = false;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [confirm]);

  if (state.phase !== 'dialogue') return null;
  return (
    <div
      className="awf-run"
      data-phase="dialogue"
      data-line={state.index}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button')) return;
        confirm();
      }}
    >
      <DialogueBox
        view={lineView(lines[state.index])}
        shown={state.shown}
        index={state.index}
        total={lines.length}
        narrow={narrow}
        compact={compact}
        onSkip={state.index + 1 < lines.length ? skip : undefined}
      />
    </div>
  );
}
