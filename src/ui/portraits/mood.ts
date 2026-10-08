// Which mood a portrait shows, decided in one place so the HUD and the cut-in cannot disagree.
import type { Mood } from './types';

/** Commanders who do not gloat: Ilse, Sefa and Maru wear a grim face for a power, not a shout or a smirk. */
export const STOIC: ReadonlySet<string> = new Set(['ilse', 'sefa', 'maru']);

/** The HUD face: neutral, grim once the player is defeated, happy while their power is active. */
export function hudMood(state: { defeated: boolean; active: 'surge' | 'overclock' | null }): Mood {
  if (state.defeated) return 'grim';
  if (state.active) return 'happy';
  return 'neutral';
}

/** The cut-in face: angry for an Overclock, smug for a Surge, except the stoic three, who go grim for both. */
export function cutInMood(commander: string, level: 'surge' | 'overclock'): Mood {
  if (STOIC.has(commander)) return 'grim';
  return level === 'overclock' ? 'angry' : 'smug';
}
