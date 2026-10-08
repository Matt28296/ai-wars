// Playback controls and nothing else: this viewer has no way to move, attack, build or select a unit (D-004, D-007). The human
// watches, then adjusts doctrine elsewhere. Pure state machine, keyboard mapping and URL-hash parsing, so all of it is testable.
import type { CommanderId, FactionId, PlayerIndex } from '../../game/aw';
import { commanderNameOf, pad2, powerNameOf } from './format';
import { isSpeed } from './timing';
import type { Speed } from './timing';
import type { TimelineStep, Viewer } from './timeline';

export interface PlaybackState {
  /** The timeline step on screen. */
  step: number;
  /** The last step of the timeline. */
  last: number;
  playing: boolean;
  speed: Speed;
  /** True when the step was reached by moving forward one, so its transition should animate. Jumps and rewinds snap. */
  animate: boolean;
}

export type PlaybackAction =
  | { type: 'toggle' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'forward' }
  | { type: 'back' }
  | { type: 'seek'; step: number }
  | { type: 'speed'; speed: Speed }
  /** The auto-player moving on after a step's animation and pause. */
  | { type: 'advance' }
  /**
   * The timeline changed (another viewer): keep the position, clamp it to the new length. With `grow` (G14: the same viewer's timeline,
   * longer because the match is still being computed) only the length changes: not the position, not an animation in flight.
   */
  | { type: 'newTimeline'; last: number; grow?: boolean };

export function initialPlayback(last: number, opts: { step?: number; speed?: Speed; playing?: boolean } = {}): PlaybackState {
  const step = Math.max(0, Math.min(last, Math.trunc(opts.step ?? 0)));
  return { step, last, playing: opts.playing === true && step < last, speed: opts.speed ?? 1, animate: false };
}

const clampStep = (n: number, last: number): number => Math.max(0, Math.min(last, Math.trunc(Number.isFinite(n) ? n : 0)));

export function playbackReducer(s: PlaybackState, a: PlaybackAction): PlaybackState {
  return reduce(s, a, false);
}

/**
 * G14: the reducer for a match that is still being computed. The end of its timeline is only the end of what is computed so far, so
 * playback that runs out of steps keeps its place and keeps `playing` (it waits for more) instead of stopping, and Play at that end does
 * not start the match over. Everything else is `playbackReducer`. Once the match is whole, use `playbackReducer` again.
 */
export function livePlaybackReducer(s: PlaybackState, a: PlaybackAction): PlaybackState {
  return reduce(s, a, true);
}

function reduce(s: PlaybackState, a: PlaybackAction, open: boolean): PlaybackState {
  switch (a.type) {
    case 'toggle':
      return s.playing ? { ...s, playing: false } : reduce(s, { type: 'play' }, open);
    case 'play':
      // Playing from the end starts the match again. A match still being computed has no end to start again from: it waits.
      if (s.step >= s.last) {
        if (open) return s.playing ? s : { ...s, playing: true };
        return s.last > 0 ? { ...s, step: 0, playing: true, animate: false } : s;
      }
      return { ...s, playing: true };
    case 'pause':
      return { ...s, playing: false };
    case 'forward':
      // Stepping by hand pauses playback: the viewer asked to look at this step.
      return s.step >= s.last ? { ...s, playing: false } : { ...s, step: s.step + 1, playing: false, animate: true };
    case 'back':
      return s.step <= 0 ? s : { ...s, step: s.step - 1, playing: false, animate: false };
    case 'seek': {
      const step = clampStep(a.step, s.last);
      return step === s.step ? s : { ...s, step, animate: false, playing: s.playing && (step < s.last || open) };
    }
    case 'speed':
      return a.speed === s.speed ? s : { ...s, speed: a.speed };
    case 'advance': {
      if (!s.playing) return { ...s, playing: false };
      if (s.step >= s.last) return open ? s : { ...s, playing: false };
      const step = s.step + 1;
      return { ...s, step, animate: true, playing: step < s.last || open };
    }
    case 'newTimeline': {
      if (a.grow) return a.last === s.last ? s : { ...s, last: a.last };
      const step = clampStep(s.step, a.last);
      return { ...s, last: a.last, step, animate: false, playing: s.playing && (step < a.last || open) };
    }
    default:
      return s;
  }
}

// ---------------------------------------------------------------- keyboard

export interface KeyTarget {
  /** Lower-case tag name of the focused element, if any. */
  tag?: string;
  /** The `type` of an input element. */
  type?: string;
}

export interface KeyInfo {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * The playback action a key press means, or null to leave it alone. Space plays and pauses, Left and Right step. Space means
 * play/pause wherever focus is, even on a button the viewer just clicked (the page stops that button pressing itself, so it never
 * fires twice; Enter still presses a focused button). A focused text field, checkbox or menu keeps its own Space, and a focused
 * slider, field or menu keeps its own arrow keys.
 */
export function keyToAction(k: KeyInfo, target: KeyTarget = {}): PlaybackAction | null {
  if (k.ctrlKey || k.metaKey || k.altKey) return null;
  const tag = (target.tag ?? '').toLowerCase();
  const typing = tag === 'textarea' || tag === 'select' || (tag === 'input' && target.type !== 'range');
  switch (k.key) {
    case ' ':
    case 'Spacebar':
      if (tag === 'a' || typing) return null;
      return { type: 'toggle' };
    case 'ArrowLeft':
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return null;
      return { type: 'back' };
    case 'ArrowRight':
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return null;
      return { type: 'forward' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- URL hash

export interface HashState {
  step?: number;
  viewer?: Viewer;
  speed?: Speed;
  play?: boolean;
}

/** Parses `#step=40&viewer=1&speed=2&play`; anything malformed is ignored, never thrown. */
export function parseHash(hash: string, players = 2): HashState {
  const out: HashState = {};
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    if (!part) continue;
    const [key, value = ''] = part.split('=');
    switch (key) {
      case 'step': {
        if (/^\d{1,6}$/.test(value)) out.step = Number(value);
        break;
      }
      case 'viewer': {
        if (value === 'all') out.viewer = 'all';
        else if (/^\d{1,2}$/.test(value) && Number(value) < players) out.viewer = Number(value);
        break;
      }
      case 'speed': {
        const n = Number(value);
        if (isSpeed(n)) out.speed = n;
        break;
      }
      case 'play':
        out.play = value !== '0';
        break;
      default:
        break;
    }
  }
  return out;
}

export function formatHash(h: HashState): string {
  const parts: string[] = [];
  if (h.step !== undefined) parts.push(`step=${h.step}`);
  if (h.viewer !== undefined) parts.push(`viewer=${h.viewer}`);
  if (h.speed !== undefined && h.speed !== 1) parts.push(`speed=${h.speed}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

// ---------------------------------------------------------------- the scrubber's marks

/** A tick where a cycle begins. */
export interface CycleTick {
  step: number;
  cycle: number;
  /** Cycle 1 and every fifth one: drawn taller, so the ticks can be counted. */
  major: boolean;
}

/** A marker where a commander's power was activated. */
export interface PowerMark {
  step: number;
  player: PlayerIndex;
  level: 'surge' | 'overclock';
  faction: FactionId;
  commander: CommanderId;
  /** "Rook Okafor: Surge name", for the tooltip and the screen reader. */
  label: string;
}

export interface TimelineMarks {
  last: number;
  cycles: CycleTick[];
  powers: PowerMark[];
}

/**
 * The ticks and markers a viewer's scrubber shows. A cycle starts at the first step whose frame reads a new cycle number (step 0 starts
 * the first); a power marker sits at the step whose events hold a `powerActivated`, which every viewer receives, so the markers say
 * nothing a fogged viewer's log does not.
 */
export function timelineMarks(steps: readonly Pick<TimelineStep, 'index' | 'frame' | 'events'>[]): TimelineMarks {
  const cycles: CycleTick[] = [];
  const powers: PowerMark[] = [];
  steps.forEach((s, i) => {
    const cycle = s.frame.cycle;
    if (i === 0 || cycle !== steps[i - 1].frame.cycle) cycles.push({ step: s.index, cycle, major: cycle === 1 || cycle % 5 === 0 });
    for (const e of s.events) {
      if (e.kind !== 'powerActivated') continue;
      const faction = s.frame.players[e.player]?.faction;
      if (faction === undefined) continue;
      powers.push({ step: s.index, player: e.player, level: e.level, faction, commander: e.commander, label: `${commanderNameOf(e.commander)}: ${powerNameOf(e.commander, e.level)}` });
    }
  });
  return { last: Math.max(0, steps.length - 1), cycles, powers };
}

/** The cycle a step belongs to: the number of the latest tick at or before it. */
export function cycleOfStep(marks: TimelineMarks, step: number): number {
  let cycle = marks.cycles[0]?.cycle ?? 1;
  for (const t of marks.cycles) {
    if (t.step > step) break;
    cycle = t.cycle;
  }
  return cycle;
}

/** The scrubber's tooltip: "Cycle 04 · step 40", and the power activated at that step, if any. */
export function scrubTip(marks: TimelineMarks, step: number): string {
  const power = marks.powers.filter((p) => p.step === step).map((p) => `${p.label} (${p.level === 'surge' ? 'Surge' : 'Overclock'})`);
  return [`Cycle ${pad2(cycleOfStep(marks, step))} · step ${step}`, ...power].join(' · ');
}

/** Where a step sits along the track, 0 to 1. */
export const fractionOfStep = (step: number, last: number): number => (last > 0 ? Math.max(0, Math.min(1, step / last)) : 0);

/** The step under a pointer: `thumb` is the slider thumb's width, whose centre travels the track less one thumb. */
export function stepAtPointer(clientX: number, track: { left: number; width: number }, thumb: number, last: number): number {
  const run = track.width - thumb;
  if (!(run > 0) || last <= 0) return 0;
  const f = (clientX - track.left - thumb / 2) / run;
  return Math.round(Math.max(0, Math.min(1, f)) * last);
}
