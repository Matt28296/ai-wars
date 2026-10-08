// Board layout math for the viewer: tile sizes, pixel positions, hit-testing, path interpolation and the camera.
// Everything here is pure so it can be tested without a DOM.
import type { Coord } from '../../game/aw';

/** Tile sizes the board may use, in px. 48 is the design system's tile; 32 is its small tile; 64 is the step up for big screens. */
export const TILE_SIZES = [32, 48, 64] as const;
export const MIN_TILE: number = TILE_SIZES[0];

/** The largest tile size at which the whole board fits the space; else the smallest, and the board scrolls inside its frame. */
export function chooseTileSize(availWidth: number, availHeight: number, cols: number, rows: number): number {
  let best: number = MIN_TILE;
  for (const t of TILE_SIZES) if (cols * t <= availWidth && rows * t <= availHeight) best = t;
  return best;
}

export function boardPixelSize(cols: number, rows: number, tile: number): { width: number; height: number } {
  return { width: cols * tile, height: rows * tile };
}

/** Top-left corner of a tile, in px from the board's top-left. Fractional tile coordinates are allowed (mid-glide). */
export function tileOrigin(c: Coord, tile: number): { left: number; top: number } {
  return { left: c.x * tile, top: c.y * tile };
}

/** Centre of a tile, in px. */
export function tileCenter(c: Coord, tile: number): { x: number; y: number } {
  return { x: c.x * tile + tile / 2, y: c.y * tile + tile / 2 };
}

/** The tile under a point (px from the board's top-left), or null when it is off the board. */
export function tileAtPoint(px: number, py: number, tile: number, cols: number, rows: number): Coord | null {
  if (px < 0 || py < 0) return null;
  const x = Math.floor(px / tile);
  const y = Math.floor(py / tile);
  return x < cols && y < rows ? { x, y } : null;
}

/** Number of tiles walked along a path (a path of length 1 is 0 tiles: the unit acted where it stood). */
export function pathTiles(path: readonly Coord[]): number {
  return Math.max(0, path.length - 1);
}

export interface PathPoint { x: number; y: number; dx: number }

/**
 * Where a unit is, in tile units, when it has walked fraction p (0..1) of the path by distance. The path is walked at a
 * constant pace; `dx` is the horizontal direction of the segment it is on (-1, 0 or 1), for facing.
 */
export function pointAlongPath(path: readonly Coord[], p: number): PathPoint {
  if (path.length === 0) return { x: 0, y: 0, dx: 0 };
  if (path.length === 1) return { x: path[0].x, y: path[0].y, dx: 0 };
  const segs = path.length - 1;
  const q = Math.max(0, Math.min(1, p)) * segs;
  const i = Math.min(segs - 1, Math.floor(q));
  const k = q - i;
  const a = path[i];
  const b = path[i + 1];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: Math.sign(b.x - a.x) };
}

/** The facing a path ends with: its last horizontal step, or undefined when it never moves sideways. */
export function headingOfPath(path: readonly Coord[]): 'left' | 'right' | undefined {
  for (let i = path.length - 1; i > 0; i--) {
    const dx = path[i].x - path[i - 1].x;
    if (dx !== 0) return dx > 0 ? 'right' : 'left';
  }
  return undefined;
}

export interface Scroll { left: number; top: number }
export interface Size { width: number; height: number }

/** Distance from the viewport edge, in tiles, inside which the camera moves (quality-bar 2.4: 2 tiles). */
export const CAMERA_MARGIN_TILES = 2;

/**
 * The scroll offsets that keep `focus` at least CAMERA_MARGIN_TILES tiles from the viewport edge, moving as little as it can, and
 * never past the board's own edges. A board that fits the viewport on an axis does not scroll on it.
 */
export function cameraScroll(current: Scroll, viewport: Size, board: Size, tile: number, focus: Coord): Scroll {
  const axis = (cur: number, view: number, total: number, tileIndex: number): number => {
    if (total <= view) return 0;
    const margin = Math.min(CAMERA_MARGIN_TILES * tile, Math.max(0, (view - tile) / 2));
    const lo = tileIndex * tile - margin; // the tile's near edge must stay at least `margin` inside the viewport
    const hi = (tileIndex + 1) * tile + margin - view; // and its far edge too
    let next = cur;
    if (next > lo) next = lo;
    if (next < hi) next = hi;
    return Math.max(0, Math.min(total - view, next));
  };
  return {
    left: axis(current.left, viewport.width, board.width, focus.x),
    top: axis(current.top, viewport.height, board.height, focus.y),
  };
}
