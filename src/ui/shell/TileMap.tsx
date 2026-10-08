// One SVG for a whole tile map: terrain art from src/data (the design-system geometry) as <symbol>s, each
// tile a <use>. Owned properties take their faction fill through CSS variables. Used by the title backdrop,
// map previews (minimaps) and the campaign map of Meridia.
// TODO(integration): src/art TerrainTile adds autotiling and animation for the battlefield; the shell keeps
// this lightweight renderer for previews (hundreds of tiles per screen).
import { memo, useId, type CSSProperties, type ReactNode } from 'react';
import { ART, TERRAIN_CODES, UNIT_TYPES } from '../../data';
import type { FactionId, TerrainId, UnitTypeId } from '../../engine/types';
import { fillOf, onOf } from '../kit/util';

type PathSpec = string | { d: string; evenodd?: boolean };
const TERRAIN_ART = ART.terrain as unknown as Record<string, { base: string; shapes: { c: string; d: string }[] }>;
const GLYPHS = ART.glyphs as unknown as Record<string, PathSpec[]>;
const SIGILS = ART.sigils as unknown as Record<string, PathSpec[]>;

const T = 32; // viewBox units per tile (the art's native grid)

const role = (c: string) =>
  c === 'struct' ? 'var(--sh-struct, var(--terrain-structure))' : c === 'struct-detail' ? 'var(--sh-struct-d, var(--terrain-structure-detail))' : `var(--${c})`;

function TerrainSymbols({ prefix, animate }: { prefix: string; animate?: boolean }) {
  return (
    <defs>
      {Object.entries(TERRAIN_ART).map(([id, art]) => (
        <symbol key={id} id={`${prefix}-${id}`} viewBox="0 0 32 32" overflow="visible">
          <rect width={32} height={32} style={{ fill: role(art.base) }} />
          {art.shapes.map((s, i) => {
            const wave = animate && (id === 'sea' || id === 'river') && s.c === 'terrain-sea-detail';
            return (
              <path key={i} d={s.d} style={{ fill: role(s.c) }}>
                {wave && (
                  <animateTransform attributeName="transform" type="translate" values={id === 'sea' ? '0 0;2 0;0 0' : '0 0;0 1;0 0'}
                    dur="2.4s" calcMode="discrete" repeatCount="indefinite" />
                )}
              </path>
            );
          })}
        </symbol>
      ))}
      {/* 0.5px tile seams so the board reads as a grid at any scale */}
    </defs>
  );
}

export interface TileUnit { type: UnitTypeId; owner: number; x: number; y: number; hp?: number }

export interface TileMapProps {
  terrain: string[];
  owners?: string[];
  /** player index → faction for property fills and unit plates. */
  factions?: (FactionId | null | undefined)[];
  units?: TileUnit[];
  animate?: boolean;
  grid?: boolean;
  /** Tiles to darken (fog), as a predicate. */
  fogged?: (x: number, y: number) => boolean;
  preserveAspectRatio?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children?: ReactNode;  // extra SVG content, in tile units ×32
}

export const TileMap = memo(function TileMap({ terrain, owners, factions = [], units, animate, grid = true, fogged, preserveAspectRatio, className, style, title, children }: TileMapProps) {
  const prefix = 'tm' + useId().replace(/:/g, '');
  const h = terrain.length;
  const w = terrain[0]?.length ?? 0;
  const tiles: ReactNode[] = [];
  let fogPath = '';
  for (let y = 0; y < h; y++) {
    const row = terrain[y]!;
    for (let x = 0; x < w; x++) {
      const id: TerrainId = TERRAIN_CODES[row[x]!] ?? 'flats';
      const o = owners?.[y]?.[x];
      const f = o && o !== '.' ? factions[Number(o)] : null;
      const st = f ? ({ '--sh-struct': fillOf(f), '--sh-struct-d': onOf(f) } as CSSProperties) : undefined;
      tiles.push(<use key={x + ',' + y} href={`#${prefix}-${id}`} x={x * T} y={y * T} width={T} height={T} style={st} />);
      if (fogged?.(x, y)) fogPath += `M${x * T} ${y * T}h${T}v${T}h-${T}z`;
    }
  }
  let gridPath = '';
  if (grid) {
    for (let x = 1; x < w; x++) gridPath += `M${x * T} 0V${h * T}`;
    for (let y = 1; y < h; y++) gridPath += `M0 ${y * T}H${w * T}`;
  }
  return (
    <svg className={className} style={style} viewBox={`0 0 ${w * T} ${h * T}`} preserveAspectRatio={preserveAspectRatio}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <TerrainSymbols prefix={prefix} animate={animate} />
      <g>{tiles}</g>
      {grid && <path d={gridPath} style={{ stroke: 'var(--map-shade)', strokeOpacity: 0.22, strokeWidth: 0.6, fill: 'none' }} />}
      {units?.map((u, i) => (
        <UnitPlate key={i} type={u.type} faction={factions[u.owner] ?? null} x={u.x * T} y={u.y * T} size={T} facing={u.x > w / 2 ? 'left' : 'right'}
          bob={animate ? i : undefined} />
      ))}
      {fogPath && <path d={fogPath} style={{ fill: 'var(--overlay-fog)' }} />}
      {children}
    </svg>
  );
});

/** A unit plate (the design-system UnitToken geometry) drawn inside an SVG at (x, y). */
export function UnitPlate({ type, faction, x, y, size, facing = 'right', bob }: { type: UnitTypeId; faction: FactionId | null; x: number; y: number; size: number; facing?: 'left' | 'right'; bob?: number }) {
  const s = size / 48;
  const glyph = GLYPHS[type] ?? GLYPHS.trooper ?? [];
  const choir = faction === 'choir';
  const fill = fillOf(faction);
  const on = onOf(faction);
  const mark = choir ? 'var(--on-choir)' : fill;
  const name = UNIT_TYPES[type]?.name ?? type;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} aria-label={name}>
      <g>
        {bob != null && (
          <animateTransform attributeName="transform" type="translate" values="0 0;0 -1.5;0 0" dur="1.2s" calcMode="discrete"
            begin={`${(bob % 7) * 0.17}s`} repeatCount="indefinite" />
        )}
        <polygon points="12,6 42,6 42,36 36,42 6,42 6,12" style={{ fill, stroke: choir ? 'var(--on-choir)' : 'var(--map-shade)', strokeWidth: choir ? 1.5 : 2, strokeLinejoin: 'round' }} />
        <g transform={facing === 'left' ? 'translate(38,9) scale(-1.1667,1.1667)' : 'translate(10,9) scale(1.1667)'} style={{ fill: on }}>
          {glyph.map((p, i) => (typeof p === 'string' ? <path key={i} d={p} /> : <path key={i} d={p.d} fillRule={p.evenodd ? 'evenodd' : undefined} />))}
        </g>
        <rect x={1} y={1} width={15} height={15} rx={2} style={{ fill: 'var(--map-shade)' }} />
        <g transform="translate(2.5,2.5) scale(0.5)" style={{ fill: mark }}>
          {(SIGILS[faction ?? 'echo'] ?? []).map((p, i) => (typeof p === 'string' ? <path key={i} d={p} /> : <path key={i} d={p.d} fillRule={p.evenodd ? 'evenodd' : undefined} />))}
        </g>
      </g>
    </g>
  );
}

/** The four-bracket battlefield cursor (ECHO's mark) as SVG at tile (x, y). */
export function SvgCursor({ x, y, size = T, className }: { x: number; y: number; size?: number; className?: string }) {
  const k = size / 48;
  return (
    <g className={className} style={{ transform: `translate(${x}px, ${y}px)` }}>
      <path transform={`scale(${k})`} d="M2 13V2h11M35 2h11v11M46 35v11H35M13 46H2V35"
        style={{ fill: 'none', stroke: 'var(--signal)', strokeWidth: 3.5, strokeLinecap: 'square' }} />
    </g>
  );
}

/** Map preview: terrain + properties + starting units, with the given player factions. */
export function MapPreview({ map, factions, className, title }: {
  map: { terrain: string[]; owners: string[]; units: TileUnit[]; name?: string };
  factions: (FactionId | null | undefined)[]; className?: string; title?: string;
}) {
  return <TileMap className={className} terrain={map.terrain} owners={map.owners} units={map.units} factions={factions} title={title ?? map.name} />;
}
