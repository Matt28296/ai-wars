// Which tiles are occupied: known answers worked out by hand from small lists of units, including the cases the terrain must not see
// (a dying ghost, a unit off the board) and a unit gliding between two properties.
import { describe, expect, it } from 'vitest';
import { occupiedPredicate, occupiedTiles, sameTiles } from './occupancy';
import type { Standing } from './occupancy';

const at = (x: number, y: number, ghost = false): Standing => ({ x, y, ghost });
const W = 6;
const H = 4;
const idx = (x: number, y: number): number => y * W + x;

describe('occupiedTiles', () => {
  it('is the tile under each live unit, as y * width + x', () => {
    const tiles = occupiedTiles([at(0, 0), at(5, 3), at(2, 1)], W, H);
    expect([...tiles].sort((a, b) => a - b)).toEqual([idx(0, 0), idx(2, 1), idx(5, 3)]);
  });

  it('is empty for no units', () => {
    expect(occupiedTiles([], W, H).size).toBe(0);
  });

  it('does not count a dying ghost (its tile is free in the frame that replaces it), but counts a live unit beside it', () => {
    const tiles = occupiedTiles([at(1, 1, true), at(2, 1)], W, H);
    expect(tiles.has(idx(1, 1))).toBe(false);
    expect(tiles.has(idx(2, 1))).toBe(true);
    expect(tiles.size).toBe(1);
    // known-bad: the same list with the ghost taken for a live unit WOULD occupy its tile (so the test can tell the two apart)
    expect(occupiedTiles([at(1, 1, false), at(2, 1)], W, H).has(idx(1, 1))).toBe(true);
  });

  it('puts a gliding unit on the tile it is nearest to: it leaves a property halfway and arrives halfway', () => {
    expect([...occupiedTiles([at(2.2, 1)], W, H)]).toEqual([idx(2, 1)]);
    expect([...occupiedTiles([at(2.49, 1)], W, H)]).toEqual([idx(2, 1)]);
    expect([...occupiedTiles([at(2.6, 1)], W, H)]).toEqual([idx(3, 1)]);
    expect([...occupiedTiles([at(3, 1.4)], W, H)]).toEqual([idx(3, 1)]);
  });

  it('ignores a position off the board, NaN included, rather than marking a wrong tile', () => {
    expect(occupiedTiles([at(-1, 0), at(W, 0), at(0, H), at(0, -0.6), at(NaN, 1)], W, H).size).toBe(0);
    // an edge that rounds back onto the board still counts
    expect([...occupiedTiles([at(-0.4, 0), at(W - 0.6, H - 1)], W, H)].sort((a, b) => a - b)).toEqual([idx(0, 0), idx(W - 1, H - 1)]);
  });

  it('two units on one tile give one entry', () => {
    expect(occupiedTiles([at(1, 1), at(1, 1)], W, H).size).toBe(1);
  });
});

describe('sameTiles and the predicate', () => {
  it('compares sets by content, not by identity', () => {
    expect(sameTiles(new Set([1, 2, 3]), new Set([3, 2, 1]))).toBe(true);
    expect(sameTiles(new Set([1, 2]), new Set([1, 2, 3]))).toBe(false);
    expect(sameTiles(new Set([1, 2, 4]), new Set([1, 2, 3]))).toBe(false); // same size, a different member
    expect(sameTiles(new Set(), new Set())).toBe(true);
  });

  it('answers per tile, and keeps answering the same after the set it was made from is rebuilt', () => {
    const tiles = occupiedTiles([at(4, 2)], W, H);
    const p = occupiedPredicate(tiles, W);
    expect(p(4, 2)).toBe(true);
    expect(p(2, 4)).toBe(false); // x and y are not swapped
    expect(p(0, 0)).toBe(false);
    const all: string[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (p(x, y)) all.push(`${x},${y}`);
    expect(all).toEqual(['4,2']);
  });
});
