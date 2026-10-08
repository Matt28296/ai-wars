// Shared helpers: static data access, geometry, read-only queries and the copy-on-write draft
// that every state transition runs on.
import { TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import type { Coord, GameEvent, GameState, Player, PlayerIndex, TerrainType, Tile, Unit, UnitType, UnitTypeId } from './types';

export const CAPTURE_POINTS = 20;
export const MAX_HP = 100;

export function unitType(id: UnitTypeId): UnitType {
  return UNIT_TYPES[id];
}

export function displayHp(hp: number): number {
  return hp <= 0 ? 0 : Math.ceil(hp / 10);
}

export const keyOf = (x: number, y: number) => `${x},${y}`;
export const manhattan = (a: Coord, b: Coord) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y;
export const DIRS: readonly Coord[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function inBounds(state: GameState, c: Coord): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < state.width && c.y < state.height;
}

export function neighbours(state: GameState, c: Coord): Coord[] {
  const out: Coord[] = [];
  for (const d of DIRS) {
    const n = { x: c.x + d.x, y: c.y + d.y };
    if (inBounds(state, n)) out.push(n);
  }
  return out;
}

export function tileAt(state: GameState, c: Coord): Tile {
  const row = state.tiles[c.y];
  const t = row ? row[c.x] : undefined;
  if (!t) throw new RangeError(`tile (${c.x},${c.y}) is outside the ${state.width}×${state.height} map`);
  return t;
}

/** Current terrain (tiles hold the effective terrain; terrainOverrides keep the originals for reverting). */
export function terrainAt(state: GameState, c: Coord): TerrainType {
  return TERRAIN_TYPES[tileAt(state, c).terrain];
}

export function unitAt(state: GameState, c: Coord): Unit | undefined {
  for (const u of state.units) if (u.x === c.x && u.y === c.y) return u;
  return undefined;
}

/** Finds a unit by id, including units loaded in transports. */
export function unitById(state: GameState, id: number): Unit | undefined {
  for (const u of state.units) {
    if (u.id === id) return u;
    for (const c of u.cargo) if (c.id === id) return c;
  }
  return undefined;
}

export function isTopLevel(state: GameState, unit: Unit): boolean {
  return state.units.some((u) => u.id === unit.id);
}

export function teamOf(state: GameState, p: PlayerIndex): number {
  return state.players[p]?.team ?? -1;
}

export function areEnemies(state: GameState, a: PlayerIndex, b: PlayerIndex): boolean {
  return a !== b && teamOf(state, a) !== teamOf(state, b);
}

export function isIndirectType(t: UnitType): boolean {
  return !!t.range && t.range[0] > 1;
}

/** Units of a player, including cargo. */
export function unitCount(state: GameState, p: PlayerIndex): number {
  let n = 0;
  for (const u of state.units) if (u.owner === p) n += 1 + u.cargo.length;
  return n;
}

export function forEachUnit(state: GameState, fn: (u: Unit, carrier: Unit | null) => void): void {
  for (const u of state.units) {
    fn(u, null);
    for (const c of u.cargo) fn(c, u);
  }
}

// ---------- per-tiles memo (property counts, uplink boosts, base income) ----------
export interface PropIndex { props: number[]; boost: number[]; income: number[] }
const propCache = new WeakMap<Tile[][], PropIndex>();

/** Per-player property count, uplink firepower boost and base income (before incomePercent). Memoised per tiles array. */
export function propertyIndex(state: GameState): PropIndex {
  let idx = propCache.get(state.tiles);
  if (idx) return idx;
  const n = state.players.length;
  idx = { props: new Array(n).fill(0), boost: new Array(n).fill(0), income: new Array(n).fill(0) };
  for (const row of state.tiles) {
    for (const tile of row) {
      if (tile.owner === null || tile.owner < 0 || tile.owner >= n) continue;
      const tt = TERRAIN_TYPES[tile.terrain];
      if (!tt.property) continue;
      idx.props[tile.owner] += 1;
      idx.boost[tile.owner] += tt.boost ?? 0;
      const base = tt.income ?? 0;
      idx.income[tile.owner] += base > 0 ? (state.incomePerProperty ?? base) : 0;
    }
  }
  propCache.set(state.tiles, idx);
  return idx;
}

// ---------- draft (copy-on-write) ----------

/** A mutable working copy of a state. Units and players are cloned up front (cheap, ~100 objects);
 *  tile rows are copied lazily on first write. The input state is never touched. */
export interface Ctx {
  s: GameState;
  events: GameEvent[];
  rows: Set<number>;
}

export function cloneUnit(u: Unit): Unit {
  return { ...u, cargo: u.cargo.length ? u.cargo.map(cloneUnit) : [] };
}

function clonePlayer(p: Player): Player {
  const c: Player = { ...p, stats: { ...p.stats } };
  if (p.moveEffects) c.moveEffects = p.moveEffects.map((e) => ({ ...e }));
  return c;
}

export function draft(state: GameState): Ctx {
  const s: GameState = {
    ...state,
    tiles: state.tiles.slice(),
    units: state.units.map(cloneUnit),
    players: state.players.map(clonePlayer),
    terrainOverrides: state.terrainOverrides.map((o) => ({ ...o })),
  };
  return { s, events: [], rows: new Set() };
}

export function writableTile(ctx: Ctx, x: number, y: number): Tile {
  propCache.delete(ctx.s.tiles);
  if (!ctx.rows.has(y)) {
    ctx.s.tiles[y] = ctx.s.tiles[y].map((t) => ({ ...t }));
    ctx.rows.add(y);
  }
  return ctx.s.tiles[y][x];
}

export function emit(ctx: Ctx, e: GameEvent): void {
  ctx.events.push(e);
}

/** Remove a top-level unit from the board (does not record stats). */
export function removeUnit(ctx: Ctx, id: number): Unit | undefined {
  const i = ctx.s.units.findIndex((u) => u.id === id);
  if (i < 0) return undefined;
  const [u] = ctx.s.units.splice(i, 1);
  return u;
}

/** Reset an in-progress capture on the tile a unit is leaving (or dying on). */
export function resetCapture(ctx: Ctx, c: Coord): void {
  const t = ctx.s.tiles[c.y][c.x];
  if (t.capture !== CAPTURE_POINTS) writableTile(ctx, c.x, c.y).capture = CAPTURE_POINTS;
}
