// Portrait colours that come from the design system rather than from a person: the faction accent that rims every figure, and the
// faction ground the radial vignette is made of. The accents mirror FACTION_ACCENT in src/ui/board3d/palette.ts (which are the
// tokens.css `-ink` colours, and the Choir's red signal); palette.test.ts reads tokens.css and fails if either drifts.
import type { FactionId } from '../../game/aw/types';
import { mix } from './geom';

/** The bright accent of each faction: the one rim light on the upper-left edge of a figure. */
export const ACCENT: Readonly<Record<FactionId, string>> = {
  helion: '#ffa95c',
  tidewell: '#8ab6ff',
  verdant: '#5fd49b',
  kestrel: '#efd77a',
  choir: '#ff4d63',
};

/** ECHO belongs to no nation: it is painted in the interface's signal cyan. */
export const SIGNAL = '#5ce1ff';

/** The faction fills of tokens.css (--helion ... --choir). */
export const FILL: Readonly<Record<FactionId, string>> = {
  helion: '#f28c28',
  tidewell: '#2f6fd8',
  verdant: '#2ea36a',
  kestrel: '#e6c95e',
  choir: '#1c1b23',
};

export interface Ground {
  /** The vignette's centre (behind the head) and its edge. */
  centre: string;
  edge: string;
  /** The sigil watermark tint. */
  mark: string;
}

/** The ground of a faction: its fill, lifted behind the head and darkened at the rim. The Choir and ECHO are dark by design. */
export function groundOf(faction: FactionId | null): Ground {
  if (faction === null) return { centre: '#0f4558', edge: '#03161d', mark: '#5ce1ff' };
  if (faction === 'choir') return { centre: '#3b3750', edge: '#121118', mark: '#ff4d63' };
  const fill = FILL[faction];
  return { centre: mix(fill, '#ffffff', 0.26), edge: mix(fill, '#000000', 0.3), mark: mix(fill, '#ffffff', 0.55) };
}

/** Feature colours shared by every human face, so eyes and teeth match across the cast. */
export const FACE = {
  white: '#f3efe6',
  ink: '#1b1219',
  teeth: '#f6f1e7',
  mouthIn: '#3b1822',
  tongue: '#c25560',
} as const;
