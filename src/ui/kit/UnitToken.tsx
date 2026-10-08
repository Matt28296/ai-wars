import type { HTMLAttributes, ReactNode } from 'react';
import { ART, TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import type { FactionId, TerrainId, UnitTypeId } from '../../engine/types';
import { ICONS, Paths } from './primitives';
import { cx, factionName, fillOf, markOf, onOf, type FactionOrEcho } from './util';

type PathSpec = string | { d: string; evenodd?: boolean };
const GLYPHS = ART.glyphs as unknown as Record<string, PathSpec[]>;
const SIGILS = ART.sigils as unknown as Record<string, PathSpec[]>;
const TERRAIN_ART = ART.terrain as unknown as Record<string, { base: string; shapes: { c: string; d: string }[] }>;

export type UnitStatus = 'low-charge' | 'low-ammo' | 'capturing' | 'loaded';
const STATUS_ICON: Record<UnitStatus, [keyof typeof ICONS, string]> = {
  'low-charge': ['bolt', 'var(--warn)'],
  'low-ammo': ['ammo', 'var(--warn)'],
  capturing: ['flag', 'var(--signal)'],
  loaded: ['cargo', 'var(--map-ink)'],
};
const STATUS_WORD: Record<UnitStatus, string> = { 'low-charge': 'low charge', 'low-ammo': 'low ammo', capturing: 'capturing', loaded: 'carrying cargo' };

export interface UnitTokenProps {
  unit: UnitTypeId;
  faction?: FactionId;
  hp?: number; // display HP 0–10
  spent?: boolean;
  selected?: boolean;
  facing?: 'left' | 'right';
  size?: number;
  status?: UnitStatus;
  decorative?: boolean;
  className?: string;
  /** Hide the corner chips (sigil/HP/status), e.g. when the map draws its own. */
  bare?: boolean;
}

/** The design-system unit plate: faction fill + glyph, sigil chip top-left, HP chip bottom-right below 10. */
export function UnitToken({ unit, faction = 'helion', hp = 10, spent, selected, facing = 'right', size = 48, status, decorative, className, bare }: UnitTokenProps) {
  const u = UNIT_TYPES[unit] || UNIT_TYPES.trooper;
  const hpShown = Math.max(0, Math.min(10, Math.ceil(hp)));
  const choir = faction === 'choir';
  const label = `${factionName(faction)} ${u.name}, ${hpShown} HP${spent ? ', has acted' : ''}${status ? ', ' + STATUS_WORD[status] : ''}`;
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': label };
  const st = status && STATUS_ICON[status];
  return (
    <svg className={cx('aw-unit', spent && 'aw-unit--spent', selected && 'aw-unit--selected', className)} width={size} height={size} viewBox="0 0 48 48" {...a11y}>
      <g className="aw-unit-body">
        <polygon
          points="12,6 42,6 42,36 36,42 6,42 6,12"
          style={{ fill: fillOf(faction), stroke: choir ? 'var(--on-choir)' : 'var(--map-shade)', strokeWidth: choir ? 1.5 : 2, strokeLinejoin: 'round' }}
        />
        <Paths list={GLYPHS[u.id] || []} color={onOf(faction)} transform={facing === 'left' ? 'translate(38,9) scale(-1.1667,1.1667)' : 'translate(10,9) scale(1.1667)'} />
      </g>
      {selected && <polygon className="aw-unit-ring" points="11,3.5 44.5,3.5 44.5,37 37,44.5 3.5,44.5 3.5,11" />}
      {!bare && (
        <>
          <rect x={1} y={1} width={15} height={15} rx={2} style={{ fill: 'var(--map-shade)' }} />
          <g transform="translate(2.5,2.5) scale(0.5)">
            <Paths list={SIGILS[faction] || []} color={markOf(faction)} />
          </g>
          {st && (
            <g>
              <rect x={32} y={1} width={15} height={15} rx={2} style={{ fill: 'var(--map-shade)' }} />
              <path d={ICONS[st[0]]} transform="translate(33.5,2.5)" style={{ fill: st[1] }} />
            </g>
          )}
          {hpShown < 10 && (
            <g>
              <rect x={31} y={31} width={16} height={16} rx={2} style={{ fill: 'var(--map-shade)' }} />
              <text x={39} y={43.6} textAnchor="middle" className="aw-unit-hp" style={{ fill: hpShown <= 3 ? 'var(--danger)' : 'var(--map-ink)' }}>
                {hpShown}
              </text>
            </g>
          )}
        </>
      )}
    </svg>
  );
}

export function Cursor({ kind = 'select' }: { kind?: 'select' | 'target' }) {
  const target = kind === 'target';
  return (
    <svg className={cx('aw-cursor', target && 'aw-cursor--target')} viewBox="0 0 48 48" aria-hidden>
      <path d="M2 13V2h11M35 2h11v11M46 35v11H35M13 46H2V35" />
      {target && <path d="M24 14v6M24 28v6M14 24h6M28 24h6" />}
    </svg>
  );
}

/** Colour role of a terrain-art shape: struct/struct-detail follow the owner. */
export function terrainRole(c: string, owner: FactionOrEcho | 'neutral') {
  const o = owner === 'neutral' ? null : owner;
  if (c === 'struct') return o ? fillOf(o) : 'var(--terrain-structure)';
  if (c === 'struct-detail') return o ? onOf(o) : 'var(--terrain-structure-detail)';
  return `var(--${c})`;
}

/** Raw 32×32 terrain art as SVG children (no <svg> wrapper) — for drawing many tiles in one SVG. */
export function TerrainArt({ terrain, owner }: { terrain: TerrainId; owner: FactionOrEcho }) {
  const art = TERRAIN_ART[terrain] || TERRAIN_ART.flats;
  return (
    <>
      <rect width={32} height={32} style={{ fill: terrainRole(art.base, owner) }} />
      {art.shapes.map((s, i) => (
        <path key={i} d={s.d} style={{ fill: terrainRole(s.c, owner) }} />
      ))}
    </>
  );
}

export interface MapTileProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  terrain?: TerrainId;
  owner?: FactionOrEcho;
  overlay?: 'move' | 'attack';
  cursor?: 'select' | 'target';
  fog?: boolean;
  size?: number;
  label?: string;
  children?: ReactNode;
}
export function MapTile({ terrain = 'flats', owner, overlay, cursor, fog, size = 48, children, label, className, ...rest }: MapTileProps) {
  const t = TERRAIN_TYPES[terrain] || TERRAIN_TYPES.flats;
  const name = label || `${t.name}${t.property ? (owner ? `, ${factionName(owner)}` : ', neutral') : ''}`;
  return (
    <div className={cx('aw-tile', className)} style={{ width: size, height: size }} data-terrain={terrain} title={name} {...rest}>
      <svg className="aw-tile-art" viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={name}>
        <TerrainArt terrain={terrain} owner={owner} />
        <rect className="aw-tile-grid" x={0.25} y={0.25} width={31.5} height={31.5} />
      </svg>
      {overlay && <div className={`aw-tile-overlay aw-tile-overlay--${overlay}`} aria-hidden />}
      {fog && <div className="aw-tile-fog" aria-hidden />}
      {children && <div className="aw-tile-unit">{children}</div>}
      {cursor && <Cursor kind={cursor} />}
    </div>
  );
}
