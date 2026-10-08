import { createContext, useContext, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { ART } from '../../data';
import type { FactionId, TerrainId, UnitTypeId } from '../../engine/types';
import { cx, inkOf, markOf, onOf, type FactionOrEcho } from './util';

type PathSpec = string | { d: string; evenodd?: boolean };
const SIGILS = ART.sigils as unknown as Record<string, PathSpec[]>;

export function Paths({ list, color, transform }: { list: readonly PathSpec[]; color: string; transform?: string }) {
  return (
    <g transform={transform} style={{ fill: color }}>
      {list.map((p, i) =>
        typeof p === 'string' ? <path key={i} d={p} /> : <path key={i} d={p.d} fillRule={p.evenodd ? 'evenodd' : undefined} />,
      )}
    </g>
  );
}

export type SigilTone = 'ink' | 'fill' | 'on' | 'current';
/** Faction sigil. Faction colour is never shown without it. faction null = ECHO. */
export function Sigil({ faction, size = 24, tone = 'ink', title }: { faction: FactionOrEcho; size?: number; tone?: SigilTone; title?: string }) {
  const key = faction || 'echo';
  const color = tone === 'fill' ? markOf(faction) : tone === 'on' ? onOf(faction) : tone === 'current' ? 'currentColor' : inkOf(faction);
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg className="aw-sigil" width={size} height={size} viewBox="0 0 24 24" {...a11y}>
      <Paths list={SIGILS[key] || []} color={color} />
    </svg>
  );
}

export const ICONS = {
  bolt: 'M7 1 2 7h3.5L4.5 11 10 5H6.5z',
  ammo: 'M4 1h4v2.5l1 1V11H3V4.5l1-1z',
  flag: 'M2.5 1H4v10H2.5zM4 1.5h6L8.5 4 10 6.5H4z',
  cargo: 'M1.5 3.5h9v7h-9zM4 3.5V1.5h4v2z',
  diamond: 'M6 .8 11.2 6 6 11.2.8 6z',
  cross: 'M2.5 1 6 4.5 9.5 1 11 2.5 7.5 6 11 9.5 9.5 11 6 7.5 2.5 11 1 9.5 4.5 6 1 2.5z',
  dot: 'M6 2a4 4 0 1 1 0 8 4 4 0 1 1 0-8z',
  star: 'M6 .6l1.6 3.6 3.9.4-2.9 2.6.8 3.9L6 9.1l-3.4 2 .8-3.9L.5 4.6l3.9-.4z',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 12, color = 'currentColor' }: { name: IconName; size?: number; color?: string }) {
  return (
    <svg className="aw-icon" width={size} height={size} viewBox="0 0 12 12" aria-hidden>
      <path d={ICONS[name]} style={{ fill: color }} />
    </svg>
  );
}

export interface FrameProps extends HTMLAttributes<HTMLElement> {
  size?: 'sm' | 'md';
  raised?: boolean;
  floating?: boolean;
  as?: ElementType;
  innerClassName?: string;
  innerStyle?: CSSProperties;
}
/** The chamfered panel: top-left + bottom-right cut, 1px line-strong edge. */
export function Frame({ size, raised, floating, className, children, as: As = 'div', innerClassName, innerStyle, ...rest }: FrameProps) {
  return (
    <As className={cx('aw-frame', size === 'sm' && 'aw-frame--sm', raised && 'aw-frame--raised', floating && 'aw-float', className)} {...rest}>
      <div className={cx('aw-frame-in', innerClassName)} style={innerStyle}>
        {children}
      </div>
    </As>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <div className="aw-kicker label">{children}</div>;
}

export function Diamonds({ value, total = 4, label }: { value: number; total?: number; label?: string }) {
  return (
    <span className="aw-diamonds" role="img" aria-label={label || `${value} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx('aw-diamond', i < value && 'aw-diamond--on')} />
      ))}
    </span>
  );
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: 'warn' | 'signal' | 'danger' }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0)) * 100;
  return (
    <span className={cx('aw-meter', tone && `aw-meter--${tone}`)} aria-hidden>
      <span style={{ width: pct + '%' }} />
    </span>
  );
}

// ---------- art provider ----------
// Screens that have richer art (src/art) can hand it to every kit component through this context;
// without it the kit draws the design-system glyph plates, terrain tiles and initials portraits.
export interface KitArt {
  unit?: (p: { type: UnitTypeId; faction: FactionId; size: number; facing: 'left' | 'right'; hp?: number; spent?: boolean }) => ReactNode;
  terrain?: (p: { terrain: TerrainId; owner: FactionOrEcho; size: number }) => ReactNode;
  portrait?: (p: { commander: string; faction: FactionOrEcho; size: number; mood?: string }) => ReactNode;
}
export const KitArtContext = createContext<KitArt>({});
export const useKitArt = () => useContext(KitArtContext);
