// Shared pieces of the ported design-system kit (design-system/tools/bundle.src.js): colour roles and the small drawing primitives.
// Ported to typed TSX with the same look, sizes and tokens; the art data comes from src/data (the generated copy of design-system's ART).
import type { CSSProperties, ReactElement } from 'react';
import { FACTIONS } from '../../../data';
import type { FactionId } from '../../../game/aw';

/** A nation, or null for ECHO / the interface itself (painted in the signal colour). */
export type Faction = FactionId;

export const cx = (...a: (string | false | null | undefined)[]): string => a.filter(Boolean).join(' ');

export const fillOf = (f: Faction | null | undefined): string => (f ? `var(--${f})` : 'var(--signal)');
export const onOf = (f: Faction | null | undefined): string => (f ? `var(--on-${f})` : 'var(--on-signal)');
export const inkOf = (f: Faction | null | undefined): string => (f ? `var(--${f}-ink)` : 'var(--signal)');
/** Sigils on map-shade chips: the fill reads on near-black for every faction except obsidian Choir. */
export const markOf = (f: Faction | null | undefined): string => (f === 'choir' ? 'var(--on-choir)' : fillOf(f));
export const factionName = (f: Faction | null | undefined): string => (f ? FACTIONS[f].name : 'ECHO');
export const factionShort = (f: Faction | null | undefined): string => (f ? FACTIONS[f].short : 'ECHO');
export const pad2 = (n: number): string => String(n).padStart(2, '0');
export const creditsText = (n: number): string => Number(n).toLocaleString('en-US');

/** One shape of an art glyph: a path string, or a path with an evenodd fill rule. */
export type PathSpec = string | { d: string; evenodd?: boolean };

export function Paths(props: { list: readonly PathSpec[]; color: string; transform?: string }): ReactElement {
  const style: CSSProperties = { fill: props.color };
  return (
    <g transform={props.transform} style={style}>
      {props.list.map((p, i) =>
        typeof p === 'string' ? <path key={i} d={p} /> : <path key={i} d={p.d} fillRule={p.evenodd ? 'evenodd' : undefined} />,
      )}
    </g>
  );
}

/** Three bars, the last two cut short: the mark of a side with no name (the briefing's unmarked plate draws the same bars). */
export const UNMARKED_PATH = 'M4 6h16v3H4zM4 10.5h11v3H4zM4 15h16v3H4z';

/** The chamfered corner cut as a clip-path (top-left and bottom-right), for banners and portraits. */
export const CHAMFER = (c: string): string =>
  `polygon(${c} 0, 100% 0, 100% calc(100% - ${c}), calc(100% - ${c}) 100%, 0 100%, 0 ${c})`;

export const ICONS = {
  bolt: 'M7 1 2 7h3.5L4.5 11 10 5H6.5z',
  ammo: 'M4 1h4v2.5l1 1V11H3V4.5l1-1z',
  flag: 'M2.5 1H4v10H2.5zM4 1.5h6L8.5 4 10 6.5H4z',
  cargo: 'M1.5 3.5h9v7h-9zM4 3.5V1.5h4v2z',
  diamond: 'M6 .8 11.2 6 6 11.2.8 6z',
  cross: 'M2.5 1 6 4.5 9.5 1 11 2.5 7.5 6 11 9.5 9.5 11 6 7.5 2.5 11 1 9.5 4.5 6 1 2.5z',
  dot: 'M6 2a4 4 0 1 1 0 8 4 4 0 1 1 0-8z',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon(props: { name: IconName; size?: number; color?: string }): ReactElement {
  const size = props.size ?? 12;
  return (
    <svg className="aw-icon" width={size} height={size} viewBox="0 0 12 12" aria-hidden>
      <path d={ICONS[props.name]} style={{ fill: props.color ?? 'currentColor' }} />
    </svg>
  );
}
