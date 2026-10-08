import { memo } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { ART, TERRAIN_TYPES } from '../../../data';
import type { TerrainId } from '../../../game/aw';
import { cx, factionName, fillOf, onOf } from './roles';
import type { Faction } from './roles';

export interface MapTileProps extends HTMLAttributes<HTMLDivElement> {
  terrain: TerrainId;
  /** Property owner; unowned properties are neutral grey. */
  owner?: Faction;
  overlay?: 'move' | 'attack';
  cursor?: 'select' | 'target';
  fog?: boolean;
  size?: number;
  /** A UnitToken standing on the tile. */
  children?: ReactNode;
  /** Accessible name override (defaults to terrain + owner). */
  label?: string;
  /** A viewer draws 140 of these: hide them from assistive tech and skip the hover title. */
  decorative?: boolean;
}

interface TerrainShape { c: string; d: string }
interface TerrainArt { base: string; shapes: readonly TerrainShape[] }
const TERRAIN_ART = ART.terrain as unknown as Record<string, TerrainArt>;

function Cursor({ kind }: { kind: 'select' | 'target' }): ReactElement {
  const target = kind === 'target';
  return (
    <svg className={cx('aw-cursor', target && 'aw-cursor--target')} viewBox="0 0 48 48" aria-hidden>
      <path d="M2 13V2h11M35 2h11v11M46 35v11H35M13 46H2V35" />
      {target && <path d="M24 14v6M24 28v6M14 24h6M28 24h6" />}
    </svg>
  );
}

/** One square of the battlefield: terrain art, owner tint, range overlay, fog and the cursor, with an optional unit on top. */
export const MapTile = memo(function MapTile({
  terrain = 'flats', owner, overlay, cursor, fog, size = 48, children, label, className, decorative, ...rest
}: MapTileProps): ReactElement {
  const art = TERRAIN_ART[terrain] ?? TERRAIN_ART.flats;
  const t = TERRAIN_TYPES[terrain] ?? TERRAIN_TYPES.flats;
  const role = (c: string): string =>
    c === 'struct' ? (owner ? fillOf(owner) : 'var(--terrain-structure)')
      : c === 'struct-detail' ? (owner ? onOf(owner) : 'var(--terrain-structure-detail)')
        : `var(--${c})`;
  const name = label ?? `${t.name}${t.property ? (owner ? `, ${factionName(owner)}` : ', neutral') : ''}`;
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': name };
  return (
    <div className={cx('aw-tile', className)} style={{ width: size, height: size }} data-terrain={terrain} title={decorative ? undefined : name} {...rest}>
      <svg className="aw-tile-art" viewBox="0 0 32 32" width={size} height={size} {...a11y}>
        <rect width={32} height={32} style={{ fill: role(art.base) }} />
        {art.shapes.map((s, i) => (
          <path key={i} d={s.d} style={{ fill: role(s.c) }} />
        ))}
        <rect className="aw-tile-grid" x={0.25} y={0.25} width={31.5} height={31.5} />
      </svg>
      {overlay && <div className={`aw-tile-overlay aw-tile-overlay--${overlay}`} aria-hidden />}
      {fog && <div className="aw-tile-fog" aria-hidden />}
      {children && <div className="aw-tile-unit">{children}</div>}
      {cursor && <Cursor kind={cursor} />}
    </div>
  );
});
