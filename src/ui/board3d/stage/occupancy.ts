// Which tiles have a unit standing on them, for the terrain's low form of an occupied property (TerrainView.setOccupied).
//
// It is read from the units the stage SHOWS this frame, so it follows what the viewer sees: a unit the viewer cannot see is not in the
// list (the guard removed it), a unit gliding across the board occupies the tile it is nearest to (a property lifts again about
// halfway through the glide that leaves it, and sinks halfway through the glide that arrives), and a dying "ghost" unit does not
// count, because its tile is already free in the frame it is being replaced by.

/** The part of a drawn unit the occupancy needs (a UnitState from mapping.ts has these). */
export interface Standing { x: number; y: number; ghost: boolean }

/** Tile indices (y * width + x) of every tile a live unit stands on. Positions off the board are ignored. */
export function occupiedTiles(units: readonly Standing[], width: number, height: number): Set<number> {
  const out = new Set<number>();
  for (const u of units) {
    if (u.ghost) continue;
    const x = Math.round(u.x);
    const y = Math.round(u.y);
    if (!(x >= 0 && y >= 0 && x < width && y < height)) continue;
    out.add(y * width + x);
  }
  return out;
}

export function sameTiles(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** The predicate TerrainView.setOccupied takes, over a set made by occupiedTiles. The set must not change afterwards. */
export function occupiedPredicate(tiles: ReadonlySet<number>, width: number): (x: number, y: number) => boolean {
  return (x, y) => tiles.has(y * width + x);
}

/**
 * The terrain eases a property between its full and its low form over about a quarter of a second, inside its own update(dt). After the
 * FIRST setOccupied on a board, and after every scrub or step jump, the stage calls update with this much time right behind it, so the
 * buildings are in their state at once instead of visibly sinking at load or on a scrub. In normal playback it does not: the real frame
 * dt goes through and the ease shows. (The terrain treats NaN or a negative dt as 0.)
 */
export const OCCUPIED_SNAP_DT_SEC = 10;
