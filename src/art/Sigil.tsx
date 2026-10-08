import { ART } from '../data';
import type { ArtFaction } from './palette';

type SigilPath = { d: string; evenodd?: boolean };
const SIGILS = ART.sigils as unknown as Record<string, SigilPath[]>;

/** The faction sigil (24×24 design space) as an SVG group. faction null = ECHO's cursor mark. */
export function SigilGlyph({ faction, color, x = 0, y = 0, size = 24, opacity }: {
  faction: ArtFaction | 'echo';
  color: string;
  x?: number;
  y?: number;
  size?: number;
  opacity?: number;
}) {
  const key = faction ?? 'echo';
  const list = SIGILS[key] ?? [];
  const s = size / 24;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} style={{ fill: color }} opacity={opacity}>
      {list.map((q, i) => <path key={i} d={q.d} fillRule={q.evenodd ? 'evenodd' : undefined} />)}
    </g>
  );
}

/** Standalone sigil svg. */
export function Sigil({ faction, size = 24, color, title }: { faction: ArtFaction | 'echo'; size?: number; color?: string; title?: string }) {
  const c = color ?? (faction === 'choir' ? 'var(--on-choir)' : faction && faction !== 'echo' ? `var(--${faction})` : 'var(--signal)');
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <SigilGlyph faction={faction} color={c} />
    </svg>
  );
}
