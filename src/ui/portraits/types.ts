// The shapes of the portrait system. A portrait is TS data (path strings), composed to one SVG text by compose.ts.
import type { FactionId } from '../../game/aw/types';
import type { Mood } from '../../content/types';

export type { Mood };

/** All six moods, in the order the gallery shows them. */
export const MOODS: readonly Mood[] = ['neutral', 'happy', 'angry', 'grim', 'surprised', 'smug'];

/** One material in exactly three tones: shadow, base, light. Every shape of a material uses only these. */
export type Tones = readonly [shadow: string, base: string, light: string];

/**
 * One cel-shaded shape: an outline filled with the material's base tone, a hard-edged shadow region and a hard-edged light region.
 * `s` and `l` are drawn clipped to `d`, so they can be rough: only their edge inside the outline matters.
 */
export interface ShadedPart {
  /** The outline, SVG path data. */
  d: string;
  /** Material key into PortraitArt.tones. */
  m: string;
  /** Shadow region(s), path data. The key light is upper left, so the shadow side is the viewer's right. */
  s?: string;
  /** Light region(s), path data. */
  l?: string;
  /** The shape is not part of the outer silhouette (no rim light on it). */
  noRim?: boolean;
}

/** A hand-written SVG fragment (details, lenses, lattice rings); `rim` is the path data it adds to the silhouette, if any. */
export interface RawPart {
  raw: string;
  rim?: string;
}

/** Where the mood's expression layer is drawn in the stack. */
export interface FacePart {
  face: true;
}

export type Part = ShadedPart | RawPart | FacePart;

export interface PortraitArt {
  id: string;
  /** The faction whose ground colour, accent and sigil frame the portrait; null is ECHO, painted in the signal colour. */
  faction: FactionId | null;
  tones: Readonly<Record<string, Tones>>;
  /** Back to front. Exactly one FacePart. */
  parts: readonly Part[];
  /** The expression layer for a mood: brows, eyes and mouth, or the slit, iris and ring angle, or the waveform. */
  expression: (mood: Mood) => string;
  /** Feature colours the raw fragments and the expression use beyond the material tones (eye white, iris, lens glass ...). */
  extra: readonly string[];
  /** Drawn on the ground, behind the figure and its rim (ECHO's cone of light): not part of the silhouette. */
  backdrop?: string;
  /** Where the eyes sit in the art's own coordinates; the composer shifts the figure by RIM_SHIFT, so the eye line lands near y = 100. */
  eyeY: number;
}

export interface ComposeOptions {
  /** Draw the ground (vignette + sigil). False leaves the figure on transparent, for the gallery's silhouette row. */
  ground?: boolean;
}
