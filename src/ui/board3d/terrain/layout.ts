// The terrain kit's board analysis: heights, neighbour masks and autotile pieces. PURE (no three.js, no DOM), so every rule here is
// tested in node against answers computed in the test, and every builder reads the same facts about the board.
//
// Tile (x, y) covers world x..x+1, z..z+1. Local coordinates inside a tile are (u, v) in 0..1, u toward +X (east), v toward +Z (south).
import type { TerrainId } from '../../../game/aw';
import type { TerrainInput } from '../contract';
import { hash2, smoothstep } from './rng';

// ---------------------------------------------------------------- heights (art-direction.md, "Diorama, not simulation")

/** Water surface. Sea and river beds sit at -0.15, so the surface is 0.07 above them. */
export const WATER_Y = -0.08;
/** The underside of the diorama. Walls at the board's rim run down to here. */
export const BASE_Y = -0.5;
export const H_RIDGE = 0.35;
export const H_SHOAL = -0.05;
export const H_SEA = -0.15;
/** The raised pad every property stands on, so a unit on the tile stands on the pad. */
export const PAD_H = 0.06;

/** World Y of the walkable surface at a tile's centre: what `heightAt` returns. */
export const WALK_HEIGHT: Record<TerrainId, number> = {
  flats: 0, canopy: 0, ridge: H_RIDGE, shoal: H_SHOAL, sea: H_SEA, river: H_SEA, glass: 0,
  maglev: 0.02, span: 0.05,
  arcology: PAD_H, fabricator: PAD_H, skyport: PAD_H, dock: 0.04, uplink: PAD_H, spire: PAD_H,
};

export type PropertyId = 'arcology' | 'fabricator' | 'skyport' | 'dock' | 'uplink' | 'spire';
export const PROPERTY_IDS: readonly PropertyId[] = ['arcology', 'fabricator', 'skyport', 'dock', 'uplink', 'spire'];
export const isProperty = (t: TerrainId): t is PropertyId => (PROPERTY_IDS as readonly string[]).includes(t);

// ---------------------------------------------------------------- neighbour masks and autotile pieces

export const DIRS = ['N', 'E', 'S', 'W'] as const;
export type Dir = (typeof DIRS)[number];
/** One bit per side, clockwise from north: the order rotation relies on. */
export const BIT: Record<Dir, number> = { N: 1, E: 2, S: 4, W: 8 };
export const DX: Record<Dir, number> = { N: 0, E: 1, S: 0, W: -1 };
export const DY: Record<Dir, number> = { N: -1, E: 0, S: 1, W: 0 };
/** Diagonal corners: bit order NW, NE, SE, SW. */
export const CORNER_BIT = { NW: 1, NE: 2, SE: 4, SW: 8 } as const;
export type Corner = keyof typeof CORNER_BIT;
export const CORNERS: readonly Corner[] = ['NW', 'NE', 'SE', 'SW'];
const CORNER_D: Record<Corner, [number, number]> = { NW: [-1, -1], NE: [1, -1], SE: [1, 1], SW: [-1, 1] };

export const popcount = (m: number): number => ((m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1));

/** Turn a mask a quarter-turn clockwise, `r` times: N becomes E, E becomes S, S becomes W, W becomes N. */
export function rotateMask(mask: number, r: number): number {
  const k = ((r % 4) + 4) % 4;
  return ((mask << k) | (mask >> (4 - k))) & 15;
}

export type PieceKind = 'isolated' | 'end' | 'straight' | 'corner' | 'tee' | 'cross';
export interface Piece { kind: PieceKind; rot: 0 | 1 | 2 | 3 }

/** The piece's connections when `rot` is 0. */
const CANON: Record<PieceKind, number> = {
  isolated: 0,
  end: BIT.N,
  straight: BIT.N | BIT.S,
  corner: BIT.N | BIT.E,
  tee: BIT.N | BIT.E | BIT.S,
  cross: 15,
};

/** Which piece (and quarter-turns) draws a tile whose connected sides are `mask`. */
export function pieceFor(mask: number): Piece {
  const m = mask & 15;
  const kind: PieceKind = (['isolated', 'end', 'straight', 'corner', 'tee', 'cross'] as const).find((k) => {
    for (let r = 0; r < 4; r++) if (rotateMask(CANON[k], r) === m) return true;
    return false;
  })!;
  for (let r = 0; r < 4; r++) if (rotateMask(CANON[kind], r) === m) return { kind, rot: r as 0 | 1 | 2 | 3 };
  throw new Error(`no piece for mask ${mask}`); // unreachable: every mask 0..15 is some rotation of a canonical piece
}

/** The mask a piece covers: the inverse of `pieceFor`. */
export const pieceMask = (p: Piece): number => rotateMask(CANON[p.kind], p.rot);

/** Mask of the sides of (x, y) whose neighbour satisfies `member`. A side off the map reads `outside`. */
export function neighbourMask(
  width: number, height: number, member: (x: number, y: number) => boolean, x: number, y: number, outside = false,
): number {
  let m = 0;
  for (const d of DIRS) {
    const nx = x + DX[d];
    const ny = y + DY[d];
    const inside = nx >= 0 && ny >= 0 && nx < width && ny < height;
    if (inside ? member(nx, ny) : outside) m |= BIT[d];
  }
  return m;
}

// ---------------------------------------------------------------- rivers

export const CHANNEL_HALF = 0.29;
/** Distance from the channel's centre line at which a carved bank rises through the water surface (solved from the bank profile). */
export const CHANNEL_SHORE = 0.342;

/** Distance from (u, v) to the river's centre line: the union of segments from the tile centre to each connected side's midpoint. */
export function channelDist(mask: number, u: number, v: number): number {
  let d = Math.hypot(u - 0.5, v - 0.5);
  const seg = (x1: number, y1: number): void => {
    const dx = x1 - 0.5;
    const dy = y1 - 0.5;
    const t = Math.min(1, Math.max(0, ((u - 0.5) * dx + (v - 0.5) * dy) / (dx * dx + dy * dy)));
    d = Math.min(d, Math.hypot(u - (0.5 + dx * t), v - (0.5 + dy * t)));
  };
  if (mask & BIT.N) seg(0.5, 0);
  if (mask & BIT.E) seg(1, 0.5);
  if (mask & BIT.S) seg(0.5, 1);
  if (mask & BIT.W) seg(0, 0.5);
  return d;
}

/** Ground height of a carved river tile at distance `d` from its centre line: -0.15 in the channel, 0 on the banks. */
export const bankY = (d: number): number => H_SEA * (1 - smoothstep(CHANNEL_HALF - 0.02, CHANNEL_HALF + 0.13, d));

// ---------------------------------------------------------------- the analysed board

export interface WaterInfo {
  kind: 'sea' | 'river';
  /** True when the whole tile is water (sea, a river basin, a span over open water); false for a carved channel. */
  wide: boolean;
  /** Sides the river continues through (a map edge counts as a continuation). 15 for sea. */
  mask: number;
}

export interface TileInfo {
  x: number;
  y: number;
  index: number;
  terrain: TerrainId;
  /** `heightAt`. */
  walk: number;
  /** A water plane covers this tile: sea, river, shoal and the water under a span. */
  water: WaterInfo | null;
  shoal: boolean;
  /** Maglev or span: the connected sides and the piece they make. */
  track: { mask: number; piece: Piece } | null;
  /** Sides whose neighbour is raised land, where a water tile shows foam against a wall. */
  landEdges: number;
  landCorners: number;
  /** Sides whose neighbour is a shoal (shallow water shading blends across them). */
  shoalEdges: number;
  /** Sides and corners whose neighbour is open water, where a shoal dips under the surface. */
  wetEdges: number;
  wetCorners: number;
  /** Unit vector (x, z) the water drifts along. */
  flow: [number, number];
  /** A dock's pier side (toward the water), else null. */
  dockDir: Dir | null;
  property: boolean;
}

export interface Board {
  width: number;
  height: number;
  tiles: TileInfo[];
  at(x: number, y: number): TileInfo;
  /** `at`, or null off the map. */
  maybe(x: number, y: number): TileInfo | null;
}

const isOpenWater = (t: TerrainId): boolean => t === 'sea' || t === 'river' || t === 'span';
const isRaisedLand = (t: TerrainId): boolean => !isOpenWater(t) && t !== 'shoal';
const trackMember = (t: TerrainId): boolean => t === 'maglev' || t === 'span' || isProperty(t);

export function analyseBoard(input: TerrainInput): Board {
  const { width, height } = input;
  const terr: TerrainId[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) terr.push(input.terrainAt(x, y));
  const tAt = (x: number, y: number): TerrainId => terr[y * width + x];
  const inMap = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const mask = (member: (t: TerrainId) => boolean, x: number, y: number, outside = false): number =>
    neighbourMask(width, height, (nx, ny) => member(tAt(nx, ny)), x, y, outside);
  const cornerMask = (member: (t: TerrainId) => boolean, x: number, y: number): number => {
    let m = 0;
    for (const c of CORNERS) {
      const nx = x + CORNER_D[c][0];
      const ny = y + CORNER_D[c][1];
      if (inMap(nx, ny) && member(tAt(nx, ny))) m |= CORNER_BIT[c];
    }
    return m;
  };

  const waterish = (x: number, y: number): boolean => inMap(x, y) && isOpenWater(tAt(x, y));
  const inWaterBlock = (x: number, y: number): boolean => {
    for (const ox of [-1, 0]) {
      for (const oy of [-1, 0]) {
        if (waterish(x + ox, y + oy) && waterish(x + ox + 1, y + oy) && waterish(x + ox, y + oy + 1) && waterish(x + ox + 1, y + oy + 1)) return true;
      }
    }
    return false;
  };

  const tiles: TileInfo[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const terrain = tAt(x, y);
      let water: WaterInfo | null = null;
      let track: TileInfo['track'] = null;
      let trackM = 0;

      if (terrain === 'maglev' || terrain === 'span') {
        trackM = mask(trackMember, x, y);
        if (terrain === 'span' && popcount(trackM) < 2) trackM = popcount(trackM) === 1 ? trackM | rotateMask(trackM, 2) : BIT.E | BIT.W;
        track = { mask: trackM, piece: pieceFor(trackM) };
      }

      if (terrain === 'sea') water = { kind: 'sea', wide: true, mask: 15 };
      else if (terrain === 'shoal') water = { kind: 'sea', wide: true, mask: 15 };
      else if (terrain === 'river' || terrain === 'span') {
        const seaSides = mask((t) => t === 'sea', x, y);
        if (terrain === 'span' && seaSides) water = { kind: 'sea', wide: true, mask: 15 };
        else {
          let m = mask((t) => t === 'river' || t === 'sea' || (terrain === 'river' && t === 'span'), x, y, true);
          if (m === 0 && terrain === 'span') m = trackM & (BIT.N | BIT.S) ? BIT.E | BIT.W : BIT.N | BIT.S;
          // A river two tiles wide (any 2x2 block of water) is open water; a lone reach, a bend or a junction of narrow rivers stays a channel.
          const wide = inWaterBlock(x, y);
          water = { kind: 'river', wide, mask: m };
        }
      }

      // Flow: rivers drift toward east and south by default and turn toward the sea when they meet it.
      let fx = 0;
      let fz = 0;
      if (water) {
        const m = water.mask;
        fx = ((m & BIT.E) ? 1 : 0) + ((m & BIT.W) ? 1 : 0);
        fz = ((m & BIT.S) ? 1 : 0) + ((m & BIT.N) ? 1 : 0);
        for (const d of DIRS) {
          const nx = x + DX[d];
          const ny = y + DY[d];
          if (inMap(nx, ny) && tAt(nx, ny) === 'sea' && terrain === 'river') { fx += 3 * DX[d]; fz += 3 * DY[d]; }
        }
        if (fx === 0 && fz === 0) fz = 1;
        const len = Math.hypot(fx, fz);
        fx /= len;
        fz /= len;
      }

      let dockDir: Dir | null = null;
      if (terrain === 'dock') {
        const wet = mask(isOpenWater, x, y);
        dockDir = (['N', 'E', 'W', 'S'] as const).find((d) => wet & BIT[d]) ?? null;
      }

      tiles.push({
        x, y, index: y * width + x, terrain,
        walk: WALK_HEIGHT[terrain],
        water,
        shoal: terrain === 'shoal',
        track,
        landEdges: mask(isRaisedLand, x, y),
        landCorners: cornerMask(isRaisedLand, x, y),
        shoalEdges: mask((t) => t === 'shoal', x, y),
        wetEdges: mask(isOpenWater, x, y),
        wetCorners: cornerMask(isOpenWater, x, y),
        flow: [fx, fz],
        dockDir,
        property: isProperty(terrain),
      });
    }
  }
  const at = (x: number, y: number): TileInfo => tiles[y * width + x];
  return { width, height, tiles, at, maybe: (x, y) => (inMap(x, y) ? at(x, y) : null) };
}

// ---------------------------------------------------------------- ground surface heights

const shoalDip = (t: TileInfo, u: number, v: number): number => {
  let d = 9;
  if (t.wetEdges & BIT.N) d = Math.min(d, v);
  if (t.wetEdges & BIT.E) d = Math.min(d, 1 - u);
  if (t.wetEdges & BIT.S) d = Math.min(d, 1 - v);
  if (t.wetEdges & BIT.W) d = Math.min(d, u);
  // A diagonal sea neighbour with dry sides still dips the corner.
  if (t.wetCorners & CORNER_BIT.NW) d = Math.min(d, Math.hypot(u, v));
  if (t.wetCorners & CORNER_BIT.NE) d = Math.min(d, Math.hypot(1 - u, v));
  if (t.wetCorners & CORNER_BIT.SE) d = Math.min(d, Math.hypot(1 - u, 1 - v));
  if (t.wetCorners & CORNER_BIT.SW) d = Math.min(d, Math.hypot(u, 1 - v));
  return 1 - smoothstep(0, 0.42, d);
};

/** The ground slab's top at local (u, v): the surface a tile's walls, bevel and vertex colours follow. Props stand on top of it. */
export function surfaceY(t: TileInfo, u: number, v: number): number {
  switch (t.terrain) {
    case 'ridge': {
      const rim = smoothstep(0.18, 0.46, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)));
      const jitter = (hash2(Math.round((t.x + u) * 6), Math.round((t.y + v) * 6), 91) - 0.5) * 0.09 * rim;
      return H_RIDGE + jitter - rim * 0.02;
    }
    case 'shoal':
      return H_SHOAL - 0.085 * shoalDip(t, u, v);
    case 'river':
    case 'span':
      return t.water && !t.water.wide ? bankY(channelDist(t.water.mask, u, v)) : H_SEA;
    case 'sea':
      return H_SEA;
    default:
      return 0;
  }
}

/** How deep the water over (u, v) is, measured as a distance-like "shore" value: 0 at the waterline, growing into the open. Negative where dry. */
export function shoreAt(t: TileInfo, u: number, v: number): number {
  if (t.water && !t.water.wide) return CHANNEL_SHORE - channelDist(t.water.mask, u, v);
  if (t.shoal) return (WATER_Y - surfaceY(t, u, v)) * 5.7;
  let s = 1;
  const edge = (bit: number, dist: number): void => {
    if (t.landEdges & bit) s = Math.min(s, dist);
    else if (t.shoalEdges & bit) s = Math.min(s, 0.31 + 1.2 * dist);
  };
  edge(BIT.N, v);
  edge(BIT.E, 1 - u);
  edge(BIT.S, 1 - v);
  edge(BIT.W, u);
  if (t.landCorners & CORNER_BIT.NW) s = Math.min(s, Math.hypot(u, v));
  if (t.landCorners & CORNER_BIT.NE) s = Math.min(s, Math.hypot(1 - u, v));
  if (t.landCorners & CORNER_BIT.SE) s = Math.min(s, Math.hypot(1 - u, 1 - v));
  if (t.landCorners & CORNER_BIT.SW) s = Math.min(s, Math.hypot(u, 1 - v));
  return s;
}
