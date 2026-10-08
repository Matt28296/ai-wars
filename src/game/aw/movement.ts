// Movement: terrain costs, reachable tiles (Dijkstra over move points with a charge/step budget) and
// explicit path validation for applyAction. Allies are passable but not stoppable (except to load into a
// transport or join a damaged unit of the same type); visible enemies block. Whether the mover sees an enemy is
// canSeeUnit's answer (fog.ts), the same rule attackTargets uses: canopy hides ground units from non-adjacent
// observers, air units over canopy stay visible. Unseen enemies (fog) do not block reachable(): applyAction stops
// the unit before them ("ambushed").
import { TERRAIN_TYPES } from '../../data';
import { illegal } from './errors';
import { canSeeUnit, fogActive, visionGrid } from './fog';
import { effectiveMove, ignoredMoveCosts } from './modifiers';
import { areEnemies, displayHp, inBounds, keyOf, unitById, unitType } from './state';
import type { Coord, GameState, MoveType, TerrainId, Unit, UnitType } from './types';

export interface ReachEntry { x: number; y: number; cost: number; path: Coord[] }

/**
 * Does the mover see this enemy, so that it blocks the way? With fog off every enemy is seen (the future stealth flag
 * `hidden` is deliberately not consulted here, M1.6a); with fog on it is canSeeUnit, fed the grid computed once per call.
 */
function seesEnemy(state: GameState, owner: number, enemy: Unit, fog: boolean, grid: Uint8Array | null): boolean {
  return !fog || canSeeUnit(state, owner, enemy, grid);
}

/** Cost for a move type to enter a terrain (null = impassable); `ignore` terrains cost 1. */
export function terrainMoveCost(t: TerrainId, moveType: MoveType, ignore?: Set<TerrainId>): number | null {
  const c = TERRAIN_TYPES[t].cost[moveType];
  if (c === null || c === undefined) return null;
  return ignore && ignore.has(t) ? 1 : c;
}

export function canStandOn(t: TerrainId, moveType: MoveType): boolean {
  const c = TERRAIN_TYPES[t].cost[moveType];
  return c !== null && c !== undefined;
}

/** Mule-class (land) transports carry foot/exo; sea transports carry any ground unit. */
export function canCarryType(transport: UnitType, cargo: UnitType): boolean {
  if (!transport.carries) return false;
  if (transport.domain === 'sea') return cargo.domain === 'ground';
  return cargo.moveType === 'foot' || cargo.moveType === 'exo';
}

export function canLoadInto(mover: Unit, transport: Unit): boolean {
  if (transport.id === mover.id || transport.owner !== mover.owner) return false;
  const tt = unitType(transport.type);
  if (!tt.carries || transport.cargo.length >= tt.carries) return false;
  if (mover.cargo.length > 0) return false;
  return canCarryType(tt, unitType(mover.type));
}

export function canJoinInto(mover: Unit, target: Unit): boolean {
  return (
    target.id !== mover.id &&
    target.owner === mover.owner &&
    target.type === mover.type &&
    displayHp(target.hp) < 10 &&
    mover.cargo.length === 0 &&
    target.cargo.length === 0
  );
}

function isTopLevelUnit(state: GameState, unit: Unit): boolean {
  for (const u of state.units) if (u === unit) return true;
  return false;
}

/** Every tile the unit can stop on this turn (ignores `acted`), keyed `${x},${y}`. Includes its own tile. */
export function reachable(state: GameState, unitId: number): Map<string, ReachEntry> {
  const out = new Map<string, ReachEntry>();
  const unit = unitById(state, unitId);
  if (!unit || !isTopLevelUnit(state, unit)) return out;
  const W = state.width;
  const N = W * state.height;
  const mt = unitType(unit.type).moveType;
  const mp = effectiveMove(state, unit);
  const ignore = ignoredMoveCosts(state, unit);

  // Per-tile entry cost (-1 = impassable / blocked by a visible enemy).
  const cost = new Int8Array(N);
  const memo = new Map<TerrainId, number>();
  for (let y = 0; y < state.height; y++) {
    const row = state.tiles[y];
    for (let x = 0; x < W; x++) {
      const t = row[x].terrain;
      let c = memo.get(t);
      if (c === undefined) {
        c = terrainMoveCost(t, mt, ignore) ?? -1;
        memo.set(t, c);
      }
      cost[y * W + x] = c;
    }
  }
  const fog = fogActive(state);
  const grid = fog ? visionGrid(state, unit.owner) : null;
  const occ = new Int32Array(N).fill(-1);
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    const idx = u.y * W + u.x;
    occ[idx] = i;
    if (areEnemies(state, unit.owner, u.owner) && seesEnemy(state, unit.owner, u, fog, grid)) cost[idx] = -1;
  }

  const start = unit.y * W + unit.x;
  const best = new Int16Array(N).fill(32767);
  let pathTo: (i: number) => Coord[];

  if (unit.charge >= mp) {
    // Dial's algorithm (bucketed Dijkstra): steps ≤ cost ≤ mp ≤ charge, so charge never binds.
    const parent = new Int32Array(N).fill(-1);
    const buckets: number[][] = [];
    for (let c = 0; c <= mp; c++) buckets.push([]);
    best[start] = 0;
    buckets[0].push(start);
    for (let c = 0; c <= mp; c++) {
      const b = buckets[c];
      for (let k = 0; k < b.length; k++) {
        const i = b[k];
        if (best[i] !== c) continue;
        const x = i % W;
        for (let d = 0; d < 4; d++) {
          let n: number;
          if (d === 0) n = i - W;
          else if (d === 1) n = x + 1 < W ? i + 1 : -1;
          else if (d === 2) n = i + W;
          else n = x > 0 ? i - 1 : -1;
          if (n < 0 || n >= N) continue;
          const tc = cost[n];
          if (tc < 0) continue;
          const nd = c + tc;
          if (nd <= mp && nd < best[n]) {
            best[n] = nd;
            parent[n] = i;
            buckets[nd].push(n);
          }
        }
      }
    }
    pathTo = (i) => {
      const p: Coord[] = [];
      for (let j = i; j !== -1; j = parent[j]) p.push({ x: j % W, y: Math.floor(j / W) });
      return p.reverse();
    };
  } else {
    // Low charge: layered search over (steps, tile) so a cheaper-but-longer path cannot hide a valid one.
    const S = Math.max(0, unit.charge);
    const dist = new Int16Array((S + 1) * N).fill(32767);
    const parent = new Int32Array((S + 1) * N).fill(-1);
    const bestLayer = new Int32Array(N).fill(-1);
    dist[start] = 0;
    best[start] = 0;
    bestLayer[start] = 0;
    for (let s = 0; s < S; s++) {
      const base = s * N;
      for (let i = 0; i < N; i++) {
        const d0 = dist[base + i];
        if (d0 > mp) continue;
        const x = i % W;
        for (let d = 0; d < 4; d++) {
          let n: number;
          if (d === 0) n = i - W;
          else if (d === 1) n = x + 1 < W ? i + 1 : -1;
          else if (d === 2) n = i + W;
          else n = x > 0 ? i - 1 : -1;
          if (n < 0 || n >= N) continue;
          const tc = cost[n];
          if (tc < 0) continue;
          const nd = d0 + tc;
          const li = base + N + n;
          if (nd <= mp && nd < dist[li]) {
            dist[li] = nd;
            parent[li] = base + i;
            if (nd < best[n]) {
              best[n] = nd;
              bestLayer[n] = s + 1;
            }
          }
        }
      }
    }
    pathTo = (i) => {
      const p: Coord[] = [];
      for (let j = bestLayer[i] * N + i; j !== -1; j = parent[j]) {
        const t = j % N;
        p.push({ x: t % W, y: Math.floor(t / W) });
      }
      return p.reverse();
    };
  }

  for (let i = 0; i < N; i++) {
    const c = best[i];
    if (c > mp) continue;
    const o = occ[i];
    if (o >= 0 && i !== start) {
      const other = state.units[o];
      // Unseen enemies look like empty tiles; allies only if we can load / join.
      if (!areEnemies(state, unit.owner, other.owner) && !canLoadInto(unit, other) && !canJoinInto(unit, other)) continue;
    }
    const x = i % W;
    const y = (i - x) / W;
    out.set(keyOf(x, y), { x, y, cost: c, path: pathTo(i) });
  }
  return out;
}

export interface PathCheck {
  /** move points of the whole submitted path (checked against the unit's move); an ambushed unit stops at `stop` and is charged only for those steps */
  cost: number;
  /** index of the last path tile the unit actually reaches (path.length - 1 unless ambushed) */
  stop: number;
  ambusher: Unit | null;
}

/** Validates an explicit path from the mover's point of view (throws IllegalActionError). */
export function checkPath(state: GameState, unit: Unit, path: Coord[]): PathCheck {
  if (!Array.isArray(path) || path.length === 0) illegal('path must contain at least the starting tile');
  // A hole in the path (null from a malformed action) must be an illegal action, not a TypeError that escapes isLegal.
  if (!path[0] || path[0].x !== unit.x || path[0].y !== unit.y) illegal('path must start at the unit');
  const mt = unitType(unit.type).moveType;
  const ignore = ignoredMoveCosts(state, unit);
  const fog = fogActive(state);
  const grid = fog ? visionGrid(state, unit.owner) : null;
  const seen = new Set<number>([unit.y * state.width + unit.x]);
  let cost = 0;
  let ambushIndex = -1;
  let ambusher: Unit | null = null;
  for (let i = 1; i < path.length; i++) {
    const c = path[i];
    const prev = path[i - 1];
    if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y) || !inBounds(state, c)) illegal('path leaves the map');
    if (Math.abs(c.x - prev.x) + Math.abs(c.y - prev.y) !== 1) illegal('path steps must be orthogonally adjacent');
    const idx = c.y * state.width + c.x;
    if (seen.has(idx)) illegal('path may not revisit a tile');
    seen.add(idx);
    const tc = terrainMoveCost(state.tiles[c.y][c.x].terrain, mt, ignore);
    if (tc === null) illegal(`${unit.type} cannot enter ${state.tiles[c.y][c.x].terrain}`);
    cost += tc;
    for (const o of state.units) {
      if (o.x !== c.x || o.y !== c.y || o.id === unit.id) continue;
      if (areEnemies(state, unit.owner, o.owner)) {
        if (seesEnemy(state, unit.owner, o, fog, grid)) illegal('path is blocked by an enemy unit');
        if (ambushIndex < 0) {
          ambushIndex = i;
          ambusher = o;
        }
      }
    }
  }
  if (cost > effectiveMove(state, unit)) illegal('not enough move points');
  if (path.length - 1 > unit.charge) illegal('not enough charge');
  let stop = path.length - 1;
  if (ambushIndex >= 0) {
    stop = ambushIndex - 1;
    // Never end on top of another unit: back up to the last free tile (the start is always free).
    while (stop > 0 && state.units.some((o) => o.id !== unit.id && o.x === path[stop].x && o.y === path[stop].y)) stop--;
  }
  return { cost, stop, ambusher };
}
