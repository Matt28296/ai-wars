// Commander portraits: original vector busts, composed from TS data (no .svg files, no images), six moods each.
// portraitSvg is pure and deterministic; portraitUrl wraps it as a data URL for an <img>.
import { composeSvg } from './compose';
import { ARTS } from './registry';
import { MOODS } from './types';
import type { ComposeOptions, Mood } from './types';

export { MOODS } from './types';
export type { Mood } from './types';
export { cutInMood, hudMood, STOIC } from './mood';
export { MAX_SVG_BYTES, checkPortraitSvg } from './svgcheck';

/** The commanders with a portrait: the ten named people and ECHO, in the order of src/content/commanders.ts. */
export const PORTRAIT_IDS: readonly string[] = ['rook', 'ilse', 'sefa', 'dax', 'maru', 'juno', 'corvin', 'sable', 'cantor', 'vesper', 'echo'];

export function hasPortrait(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ARTS, id);
}

const cache = new Map<string, string>();

/** The full SVG text of a portrait. An unknown mood is drawn neutral; an unknown id throws. */
export function portraitSvg(id: string, mood: Mood = 'neutral', opts: ComposeOptions = {}): string {
  if (!hasPortrait(id)) throw new Error(`no portrait for "${id}"`);
  const m: Mood = MOODS.includes(mood) ? mood : 'neutral';
  const key = `${id}|${m}|${opts.ground === false ? 0 : 1}`;
  let svg = cache.get(key);
  if (svg === undefined) {
    svg = composeSvg(ARTS[id], m, opts);
    cache.set(key, svg);
  }
  return svg;
}

/** An image/svg+xml data URL for an <img src>. */
export function portraitUrl(id: string, mood: Mood = 'neutral'): string {
  return `data:image/svg+xml,${encodeURIComponent(portraitSvg(id, mood))}`;
}
