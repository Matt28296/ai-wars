// The battlefield renderer. Layers, bottom to top: terrain · overlays (ranges, fog, path arrow) · units · fx · cursor.
// Everything is laid out in tile units and scaled by the camera's integer tile size.
import { memo, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Coord, FactionId, TerrainId, UnitTypeId } from '../../engine/types';
import { UNIT_TYPES } from '../../data';
import { Cursor, ICONS, Paths, TerrainArt, UnitToken, cx, markOf } from '../kit';
import { ART } from '../../data';
import { art } from './bridges';
import { key } from './engine';

type PathSpec = string | { d: string; evenodd?: boolean };
const SIGILS = ART.sigils as unknown as Record<string, PathSpec[]>;

// ---------------------------------------------------------------- terrain
export interface TerrainCell { terrain: TerrainId; owner: FactionId | null }

const ANIMATED: Partial<Record<TerrainId, true>> = { sea: true, river: true, shoal: true, dock: true, span: true };

/** One SVG for the whole map (design-system tiles), or the art worker's TerrainTile per cell when available. */
export const TerrainLayer = memo(function TerrainLayer({ cells, width, height, tile, frame, grid, neighbors }: {
  cells: TerrainCell[][]; width: number; height: number; tile: number; frame: number; grid: boolean; neighbors?: unknown;
}) {
  const TerrainTile = art.TerrainTile;
  const gridId = useId().replace(/:/g, '');
  if (TerrainTile) {
    const nb = neighbors as ((x: number, y: number) => unknown) | undefined;
    return (
      <div className="bs-terrain" style={{ width: width * tile, height: height * tile }}>
        {cells.map((row, y) => row.map((c, x) => (
          <div key={x + ',' + y} className="bs-terrain-cell" style={{ transform: `translate(${x * tile}px, ${y * tile}px)`, width: tile, height: tile }}>
            <TerrainTile terrain={c.terrain} owner={c.owner} size={tile} frame={ANIMATED[c.terrain] ? frame : 0} neighbors={nb ? nb(x, y) : undefined} x={x} y={y} />
          </div>
        )))}
        {grid && <GridLines width={width} height={height} tile={tile} id={gridId} />}
      </div>
    );
  }
  return (
    <svg className="bs-terrain" width={width * tile} height={height * tile} viewBox={`0 0 ${width * 32} ${height * 32}`} shapeRendering="crispEdges" aria-hidden>
      {cells.map((row, y) => row.map((c, x) => (
        <g key={x + ',' + y} transform={`translate(${x * 32} ${y * 32})`}>
          <TerrainArt terrain={c.terrain} owner={c.owner} />
          {ANIMATED[c.terrain] && frame % 2 === 1 && c.terrain !== 'span' && <rect className="bs-water-glint" x={0} y={0} width={32} height={32} />}
        </g>
      )))}
      {grid && (
        <>
          <defs>
            <pattern id={gridId} width={32} height={32} patternUnits="userSpaceOnUse">
              <path d="M32 0H0V32" className="bs-grid-line" />
            </pattern>
          </defs>
          <rect width={width * 32} height={height * 32} style={{ fill: `url(#${gridId})` }} />
        </>
      )}
    </svg>
  );
});

function GridLines({ width, height, tile, id }: { width: number; height: number; tile: number; id: string }) {
  return (
    <svg className="bs-grid" width={width * tile} height={height * tile} viewBox={`0 0 ${width * 32} ${height * 32}`} aria-hidden>
      <defs>
        <pattern id={id} width={32} height={32} patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" className="bs-grid-line" />
        </pattern>
      </defs>
      <rect width={width * 32} height={height * 32} style={{ fill: `url(#${id})` }} />
    </svg>
  );
}

// ---------------------------------------------------------------- overlays
const rectsPath = (tiles: Iterable<Coord>, inset = 0) => {
  let d = '';
  for (const t of tiles) d += `M${t.x + inset} ${t.y + inset}h${1 - 2 * inset}v${1 - 2 * inset}h${-(1 - 2 * inset)}z`;
  return d;
};

export interface OverlayProps {
  width: number; height: number; tile: number;
  move?: Coord[] | null;
  attack?: Coord[] | null;
  threat?: Coord[] | null;      // enemy threat preview (hold cancel)
  fog?: Coord[] | null;
  path?: Coord[] | null;
  targets?: Coord[] | null;
  flash?: { tiles: Coord[]; tone: 'signal' | 'danger' | 'warn'; id: number } | null;
}
export const OverlayLayer = memo(function OverlayLayer({ width, height, tile, move, attack, threat, fog, path, targets, flash }: OverlayProps) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg className="bs-overlay" width={width * tile} height={height * tile} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <pattern id={`${uid}h`} width={8 / 48} height={8 / 48} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={5 / 48} height={8 / 48} style={{ fill: 'var(--overlay-attack)' }} />
        </pattern>
      </defs>
      {fog && fog.length > 0 && <path d={rectsPath(fog)} className="bs-fog" />}
      {move && move.length > 0 && (
        <g className="bs-range bs-range--move">
          <path d={rectsPath(move)} className="bs-move-fill" />
          <path d={rectsPath(move, 0.5 / 48)} className="bs-move-edge" />
        </g>
      )}
      {attack && attack.length > 0 && (
        <g className="bs-range bs-range--attack">
          <path d={rectsPath(attack)} style={{ fill: `url(#${uid}h)` }} />
          <path d={rectsPath(attack, 0.5 / 48)} className="bs-attack-edge" />
        </g>
      )}
      {threat && threat.length > 0 && (
        <g className="bs-range bs-range--threat">
          <path d={rectsPath(threat)} style={{ fill: `url(#${uid}h)` }} />
          <path d={rectsPath(threat)} className="bs-threat-wash" />
          <path d={rectsPath(threat, 0.5 / 48)} className="bs-attack-edge" />
        </g>
      )}
      {targets && targets.length > 0 && <path d={rectsPath(targets, 0.06)} className="bs-targets" />}
      {flash && flash.tiles.length > 0 && <path key={flash.id} d={rectsPath(flash.tiles)} className={`bs-flash bs-flash--${flash.tone}`} />}
      {path && path.length > 1 && <PathArrow path={path} />}
    </svg>
  );
});

/** The movement arrow: a rounded polyline through tile centres with a head on the destination. */
function PathArrow({ path }: { path: Coord[] }) {
  const pts = path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
  const n = pts.length;
  const end = pts[n - 1], prev = pts[n - 2];
  const dx = Math.sign(end.x - prev.x), dy = Math.sign(end.y - prev.y);
  // shorten the shaft so the head sits on the destination centre
  const shaft = pts.slice(0, -1).concat([{ x: end.x - dx * 0.12, y: end.y - dy * 0.12 }]);
  const d = shaft.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('');
  const tip = { x: end.x + dx * 0.3, y: end.y + dy * 0.3 };
  const base = { x: end.x - dx * 0.14, y: end.y - dy * 0.14 };
  const w = 0.27;
  const head = `M${tip.x} ${tip.y}L${base.x - dy * w} ${base.y + dx * w}L${base.x + dy * w} ${base.y - dx * w}Z`;
  return (
    <g className="bs-arrow">
      <path d={d} className="bs-arrow-outline" />
      <path d={head} className="bs-arrow-head-outline" />
      <path d={d} className="bs-arrow-shaft" />
      <path d={head} className="bs-arrow-head" />
      <circle cx={pts[0].x} cy={pts[0].y} r={0.11} className="bs-arrow-root" />
    </g>
  );
}

// ---------------------------------------------------------------- units
export type MapStatus = 'capturing' | 'low-charge' | 'low-ammo' | 'loaded' | null;
const STATUS_ICON: Record<Exclude<MapStatus, null>, [keyof typeof ICONS, string]> = {
  'low-charge': ['bolt', 'var(--warn)'],
  'low-ammo': ['ammo', 'var(--warn)'],
  capturing: ['flag', 'var(--signal)'],
  loaded: ['cargo', 'var(--map-ink)'],
};

/** Unit art only (no chips): src/art UnitSprite when available, else the design-system plate. */
export function UnitArt({ type, faction, facing, size, frame = 0 }: { type: UnitTypeId; faction: FactionId; facing: 'left' | 'right'; size: number; frame?: 0 | 1 }) {
  const Sprite = art.UnitSprite;
  if (Sprite) return <Sprite type={type} faction={faction} facing={facing} size={size} frame={frame} />;
  return <UnitToken unit={type} faction={faction} facing={facing} size={size} bare decorative />;
}

/** Chips over a unit, in the 48-unit design grid: sigil top-left, status top-right, HP bottom-right below 10. */
export function UnitChips({ faction, hp, status }: { faction: FactionId; hp: number; status: MapStatus }) {
  const st = status && STATUS_ICON[status];
  return (
    <svg className="bs-unit-chips" viewBox="0 0 48 48" aria-hidden>
      <rect x={1} y={1} width={15} height={15} rx={2} style={{ fill: 'var(--map-shade)' }} />
      <g transform="translate(2.5,2.5) scale(0.5)"><Paths list={SIGILS[faction] || []} color={markOf(faction)} /></g>
      {st && (
        <g>
          <rect x={32} y={1} width={15} height={15} rx={2} style={{ fill: 'var(--map-shade)' }} />
          <path d={ICONS[st[0]]} transform="translate(33.5,2.5)" style={{ fill: st[1] }} />
        </g>
      )}
      {hp < 10 && (
        <g>
          <rect x={31} y={31} width={16} height={16} rx={2} style={{ fill: 'var(--map-shade)' }} />
          <text x={39} y={43.6} textAnchor="middle" className="aw-unit-hp" style={{ fill: hp <= 3 ? 'var(--danger)' : 'var(--map-ink)' }}>{hp}</text>
        </g>
      )}
    </svg>
  );
}

export interface UnitView {
  id: number; type: UnitTypeId; faction: FactionId; x: number; y: number; hp: number; // display HP
  spent: boolean; status: MapStatus; facing: 'left' | 'right'; selected?: boolean; ghost?: boolean; pop?: boolean; dim?: boolean;
}
export const MapUnit = memo(function MapUnit({ u, tile, frame }: { u: UnitView; tile: number; frame: 0 | 1 }) {
  return (
    <div
      className={cx('bs-unit', u.spent && 'bs-unit--spent', u.selected && 'bs-unit--selected', u.ghost && 'bs-unit--ghost', u.pop && 'bs-unit--pop', u.dim && 'bs-unit--dim', frame && 'bs-unit--f1')}
      style={{ width: tile, height: tile, transform: `translate3d(${u.x * tile}px, ${u.y * tile}px, 0)` }}
      data-unit={u.id}
    >
      <div className="bs-unit-art"><UnitArt type={u.type} faction={u.faction} facing={u.facing} size={tile} frame={frame} /></div>
      <UnitChips faction={u.faction} hp={u.hp} status={u.status} />
    </div>
  );
});

export interface MoveAnim {
  id: number; unit: UnitView; path: Coord[]; msPerTile: number; visible?: (c: Coord) => boolean; onDone: () => void;
}
/** Slides one unit along a path (≈ 70 ms per tile), writing transforms directly from rAF. */
export function MovingUnit({ anim, tile, frame }: { anim: MoveAnim; tile: number; frame: 0 | 1 }) {
  const ref = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { path, msPerTile } = anim;
    const segs = Math.max(1, path.length - 1);
    const total = path.length > 1 ? segs * msPerTile : 0;
    let raf = 0;
    const t0 = performance.now();
    let lastFacing = anim.unit.facing;
    const place = (t: number) => {
      const f = total ? Math.min(1, (t - t0) / total) : 1;
      const pos = f * segs;
      const i = Math.min(segs - 1, Math.floor(pos));
      const a = path[i], b = path[Math.min(path.length - 1, i + 1)];
      const k = path.length > 1 ? pos - i : 0;
      const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
      el.style.transform = `translate3d(${x * tile}px, ${y * tile}px, 0)`;
      const tileNow = { x: Math.round(x), y: Math.round(y) };
      el.style.opacity = anim.visible && !anim.visible(tileNow) ? '0' : '1';
      const dir = b.x > a.x ? 'right' : b.x < a.x ? 'left' : lastFacing;
      if (dir !== lastFacing && artRef.current) { artRef.current.dataset.facing = dir; lastFacing = dir; }
      if (f >= 1) {
        if (!done.current) { done.current = true; anim.onDone(); }
        return;
      }
      raf = requestAnimationFrame(place);
    };
    place(t0);
    return () => cancelAnimationFrame(raf);
  }, [anim, tile]);
  // facing flips via a CSS mirror (data-facing) so the art component does not re-render per tile
  return (
    <div ref={ref} className="bs-unit bs-unit--moving" style={{ width: tile, height: tile }}>
      <div ref={artRef} className="bs-unit-art" data-facing={anim.unit.facing} data-base={anim.unit.facing}>
        <UnitArt type={anim.unit.type} faction={anim.unit.faction} facing={anim.unit.facing} size={tile} frame={frame} />
      </div>
      <UnitChips faction={anim.unit.faction} hp={anim.unit.hp} status={null} />
    </div>
  );
}

// ---------------------------------------------------------------- fx
export type MapFx =
  | { id: number; kind: 'explosion'; at: Coord; big?: boolean }
  | { id: number; kind: 'popup'; at: Coord; text: string; tone: 'danger' | 'signal' | 'warn' | 'ink' }
  | { id: number; kind: 'hit'; at: Coord }
  | { id: number; kind: 'shot'; from: Coord; to: Coord }
  | { id: number; kind: 'spark'; at: Coord }
  | { id: number; kind: 'tag'; at: Coord; text: string; tone: 'danger' | 'signal' | 'warn' };

export function FxLayer({ fx, tile }: { fx: MapFx[]; tile: number }) {
  return (
    <div className="bs-fx" aria-hidden>
      {fx.map((f) => {
        if (f.kind === 'shot') {
          const x1 = (f.from.x + 0.5) * tile, y1 = (f.from.y + 0.5) * tile, x2 = (f.to.x + 0.5) * tile, y2 = (f.to.y + 0.5) * tile;
          const len = Math.hypot(x2 - x1, y2 - y1), ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
          return <div key={f.id} className="bs-fx-shot" style={{ left: x1, top: y1, width: len, transform: `rotate(${ang}deg)` }}><span /></div>;
        }
        const at = f.at;
        const style = { left: at.x * tile, top: at.y * tile, width: tile, height: tile };
        switch (f.kind) {
          case 'explosion': return <Explosion key={f.id} style={style} big={f.big} />;
          case 'hit': return <div key={f.id} className="bs-fx-hit" style={style} />;
          case 'spark': return <div key={f.id} className="bs-fx-spark" style={style}><span /><span /><span /></div>;
          case 'popup': return <div key={f.id} className={`bs-fx-popup stat-sm bs-tone--${f.tone}`} style={style}>{f.text}</div>;
          case 'tag': return <div key={f.id} className={`bs-fx-tag label bs-tone--${f.tone}`} style={style}><span>{f.text}</span></div>;
        }
        return null;
      })}
    </div>
  );
}

function Explosion({ style, big }: { style: React.CSSProperties; big?: boolean }) {
  return (
    <div className={cx('bs-fx-boom', big && 'bs-fx-boom--big')} style={style}>
      <svg viewBox="-24 -24 48 48">
        <circle className="bs-boom-flash" r={20} />
        <circle className="bs-boom-ring" r={12} />
        <g className="bs-boom-core">
          <path d="M0-16 4-6 14-9 7 0 15 8 4 6 0 16-4 6-15 8-7 0-14-9-4-6z" />
        </g>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect key={i} className="bs-boom-debris" x={-1.5} y={-1.5} width={3} height={3} style={{ ['--a' as string]: `${i * 45 + 20}deg` }} />
        ))}
        <circle className="bs-boom-smoke" r={10} />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- cursor
export function MapCursor({ at, tile, kind, hidden }: { at: Coord; tile: number; kind: 'select' | 'target'; hidden?: boolean }) {
  return (
    <div className={cx('bs-cursor', hidden && 'bs-cursor--hidden')} style={{ width: tile, height: tile, transform: `translate3d(${at.x * tile}px, ${at.y * tile}px, 0)` }}>
      <div className="bs-cursor-bob"><Cursor kind={kind} /></div>
    </div>
  );
}

// ---------------------------------------------------------------- world
export function World({ children, worldRef, width, height, tile }: { children: ReactNode; worldRef: React.RefObject<HTMLDivElement>; width: number; height: number; tile: number }) {
  return (
    <div ref={worldRef} className="bs-world" style={{ width: width * tile, height: height * tile, ['--tile' as string]: `${tile}px` }}>
      {children}
    </div>
  );
}

/** Ticks a 2-frame idle clock (and a 4-frame water clock) for sprites. */
export function useIdleFrames(enabled: boolean, onTick: (n: number) => void) {
  const cb = useRef(onTick);
  cb.current = onTick;
  useEffect(() => {
    if (!enabled) return;
    let n = 0;
    const id = window.setInterval(() => { n = (n + 1) % 4; cb.current(n); }, 520);
    return () => window.clearInterval(id);
  }, [enabled]);
}

export const unitKeyAt = (u: { x: number; y: number }) => key(u);
export const isFoot = (t: UnitTypeId) => UNIT_TYPES[t].moveType === 'foot' || UNIT_TYPES[t].moveType === 'exo';
