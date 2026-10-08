import { useId, type CSSProperties } from 'react';
import type { FactionId } from '../engine/types';
import type { Mood } from '../content/types';
import { SigilGlyph } from './Sigil';
import { BLACK, WHITE, factionFill, factionOn, mix, type ArtFaction } from './palette';
import { CAST, generic } from './portrait/cast';

export type { Mood };
export const MOODS: Mood[] = ['neutral', 'happy', 'angry', 'grim', 'surprised', 'smug'];
export const PORTRAIT_COMMANDERS = ['ren', 'ilse', 'sefa', 'dax', 'maru', 'juno', 'corvin', 'sable', 'cantor', 'vesper', 'echo'] as const;

/** Home faction of each portrait (ECHO = null → signal colours). */
export const PORTRAIT_FACTION: Record<string, ArtFaction> = {
  ren: 'helion', ilse: 'helion', sefa: 'tidewell', dax: 'tidewell', maru: 'verdant', juno: 'verdant',
  corvin: 'kestrel', sable: 'kestrel', cantor: 'choir', vesper: 'choir', echo: null,
};

export interface PortraitProps {
  /** commander id (see docs/STORY.md); unknown ids draw a generic silhouette */
  commander: string;
  mood?: Mood;
  /** px, square. Default 96. */
  size?: number;
  /** faction backdrop with the sigil faint behind (default true). false = transparent bust only. */
  backdrop?: boolean;
  /** override the backdrop faction (default: the commander's home faction) */
  faction?: FactionId | null;
  /** mirror horizontally (e.g. right-hand speaker in dialogue) */
  flip?: boolean;
  /** accessible name; omitted = decorative */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

const FRAME = 'M11 0H100V89L89 100H0V11Z';

function Backdrop({ faction, uid }: { faction: ArtFaction; uid: string }) {
  const fill = faction === 'choir' ? mix('var(--choir)', 'var(--line-strong)', 88) : faction ? factionFill(faction) : 'var(--signal-soft)';
  const on = faction === 'choir' ? 'var(--on-choir)' : faction ? factionOn(faction) : 'var(--signal)';
  const top = faction === 'choir' ? mix('var(--choir)', 'var(--line-strong)', 70) : faction ? mix(fill, WHITE, 80) : mix('var(--signal-soft)', 'var(--signal)', 82);
  const bottom = faction === 'choir' ? mix('var(--choir)', BLACK, 60) : mix(fill, BLACK, 52);
  const g = `${uid}-bg`;
  return (
    <g>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" style={{ stopColor: top }} />
          <stop offset="0.55" style={{ stopColor: fill }} />
          <stop offset="1" style={{ stopColor: bottom }} />
        </linearGradient>
      </defs>
      <path d={FRAME} style={{ fill: `url(#${g})` }} />
      {/* angular light bands */}
      <path d="M58 0H78L28 100H8Z" style={{ fill: WHITE }} opacity={faction === 'choir' || !faction ? 0.04 : 0.1} />
      <path d="M84 0H90L40 100H34Z" style={{ fill: WHITE }} opacity={faction === 'choir' || !faction ? 0.03 : 0.08} />
      <SigilGlyph faction={faction ?? 'echo'} color={on} x={30} y={8} size={84} opacity={faction === 'choir' ? 0.22 : 0.16} />
    </g>
  );
}

/** Commander bust portrait. 3/4 view looking toward the viewer's right (use flip for the right-hand side). */
export function Portrait({ commander, mood = 'neutral', size = 96, backdrop = true, faction, flip, title, className, style }: PortraitProps) {
  const uid = 'pt' + useId().replace(/:/g, '');
  const draw = CAST[commander] ?? generic;
  const fac = faction !== undefined ? faction : PORTRAIT_FACTION[commander] ?? null;
  const clip = `${uid}-clip`;
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} style={style} {...a11y}>
      <defs>
        <clipPath id={clip}><path d={backdrop ? FRAME : 'M0 0H100V100H0Z'} /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {backdrop && <Backdrop faction={fac} uid={uid} />}
        <g transform={flip ? 'translate(100 0) scale(-1 1)' : undefined}>{draw(mood, uid)}</g>
      </g>
      {backdrop && <path d={FRAME} style={{ fill: 'none', stroke: fac === 'choir' ? 'var(--on-choir)' : BLACK, strokeWidth: fac === 'choir' ? 1.2 : 1.6 }} opacity={fac === 'choir' ? 0.8 : 0.45} />}
    </svg>
  );
}
