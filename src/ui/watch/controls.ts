// Playback controls and nothing else: this viewer has no way to move, attack, build or select a unit (D-004, D-007). The human
// watches, then adjusts doctrine elsewhere. Pure state machine, keyboard mapping and URL-hash parsing, so all of it is testable.
import { isSpeed } from './timing';
import type { Speed } from './timing';
import type { Viewer } from './timeline';

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
  /** The timeline changed (another viewer): keep the position, clamp it to the new length. */
  | { type: 'newTimeline'; last: number };

export function initialPlayback(last: number, opts: { step?: number; speed?: Speed; playing?: boolean } = {}): PlaybackState {
  const step = Math.max(0, Math.min(last, Math.trunc(opts.step ?? 0)));
  return { step, last, playing: opts.playing === true && step < last, speed: opts.speed ?? 1, animate: false };
}

const clampStep = (n: number, last: number): number => Math.max(0, Math.min(last, Math.trunc(Number.isFinite(n) ? n : 0)));

export function playbackReducer(s: PlaybackState, a: PlaybackAction): PlaybackState {
  switch (a.type) {
    case 'toggle':
      return s.playing ? { ...s, playing: false } : playbackReducer(s, { type: 'play' });
    case 'play':
      // Playing from the end starts the match again.
      if (s.step >= s.last) return s.last > 0 ? { ...s, step: 0, playing: true, animate: false } : s;
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
      return step === s.step ? s : { ...s, step, animate: false, playing: s.playing && step < s.last };
    }
    case 'speed':
      return a.speed === s.speed ? s : { ...s, speed: a.speed };
    case 'advance': {
      if (!s.playing || s.step >= s.last) return { ...s, playing: false };
      const step = s.step + 1;
      return { ...s, step, animate: true, playing: step < s.last };
    }
    case 'newTimeline': {
      const step = clampStep(s.step, a.last);
      return { ...s, last: a.last, step, animate: false, playing: s.playing && step < a.last };
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
