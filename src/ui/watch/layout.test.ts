// Board layout math, against hand-worked numbers and a brute-force check of the tile chooser.
import { describe, expect, it } from 'vitest';
import {
  CAMERA_MARGIN_TILES, MIN_TILE, TILE_SIZES, boardPixelSize, cameraScroll, chooseTileSize, headingOfPath, pathTiles, pointAlongPath,
  tileAtPoint, tileCenter, tileOrigin,
} from './layout';

describe('chooseTileSize', () => {
  it('takes the largest tile at which the whole board fits', () => {
    expect(chooseTileSize(1000, 700, 14, 10)).toBe(64);  // 896 x 640 fits
    expect(chooseTileSize(900, 560, 14, 10)).toBe(48);   // 64 would be 640 tall: too tall; 48 is 672 x 480
    expect(chooseTileSize(672, 480, 14, 10)).toBe(48);   // exact fit counts
    expect(chooseTileSize(671, 480, 14, 10)).toBe(32);   // one pixel short at 48: down a size
  });

  it('falls back to the smallest tile when nothing fits, and the board scrolls inside its frame', () => {
    expect(chooseTileSize(358, 600, 14, 10)).toBe(MIN_TILE); // a phone: 14 x 32 = 448 > 358
    expect(chooseTileSize(0, 0, 14, 10)).toBe(MIN_TILE);
  });

  it('agrees with a brute-force search over many sizes (known-bad: a chooser that ignored the height would fail)', () => {
    for (let w = 100; w <= 1100; w += 37) {
      for (let h = 100; h <= 800; h += 53) {
        const fits = TILE_SIZES.filter((t) => 22 * t <= w && 14 * t <= h);
        const expected = fits.length ? Math.max(...fits) : MIN_TILE;
        expect(chooseTileSize(w, h, 22, 14), `${w}x${h}`).toBe(expected);
      }
    }
    // wide enough for 64 but too short: must not pick 64
    expect(chooseTileSize(2000, 500, 14, 10)).toBe(48);
  });
});

describe('pixel positions', () => {
  it('sizes the board and places tiles from their coordinates', () => {
    expect(boardPixelSize(14, 10, 48)).toEqual({ width: 672, height: 480 });
    expect(tileOrigin({ x: 3, y: 2 }, 48)).toEqual({ left: 144, top: 96 });
    expect(tileCenter({ x: 3, y: 2 }, 48)).toEqual({ x: 168, y: 120 });
    expect(tileOrigin({ x: 1.5, y: 0 }, 32)).toEqual({ left: 48, top: 0 }); // mid-glide
  });

  it('finds the tile under a point, and null off the board', () => {
    expect(tileAtPoint(0, 0, 48, 14, 10)).toEqual({ x: 0, y: 0 });
    expect(tileAtPoint(47, 47, 48, 14, 10)).toEqual({ x: 0, y: 0 });
    expect(tileAtPoint(48, 0, 48, 14, 10)).toEqual({ x: 1, y: 0 });
    expect(tileAtPoint(671, 479, 48, 14, 10)).toEqual({ x: 13, y: 9 });
    expect(tileAtPoint(672, 0, 48, 14, 10)).toBeNull();
    expect(tileAtPoint(0, 480, 48, 14, 10)).toBeNull();
    expect(tileAtPoint(-1, 5, 48, 14, 10)).toBeNull();
  });
});

describe('paths', () => {
  const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }];

  it('counts the tiles walked (a path of one tile acted where it stood)', () => {
    expect(pathTiles(path)).toBe(3);
    expect(pathTiles([{ x: 4, y: 4 }])).toBe(0);
    expect(pathTiles([])).toBe(0);
  });

  it('walks at a constant pace per tile and reports the horizontal direction of the segment', () => {
    const at = (p: number, x: number, y: number, dx: number): void => {
      const r = pointAlongPath(path, p);
      expect(r.x, `x at ${p}`).toBeCloseTo(x, 9);
      expect(r.y, `y at ${p}`).toBeCloseTo(y, 9);
      expect(r.dx, `dx at ${p}`).toBe(dx);
    };
    at(0, 0, 0, 1);
    at(1 / 3, 1, 0, 1);
    at(0.5, 1.5, 0, 1);
    at(5 / 6, 2, 0.5, 0); // on the last, vertical segment
    at(1, 2, 1, 0);
    at(7, 2, 1, 0); // clamped
    at(-1, 0, 0, 1);
  });

  it('stands still on a one-tile path and copes with an empty one', () => {
    expect(pointAlongPath([{ x: 4, y: 2 }], 0.7)).toEqual({ x: 4, y: 2, dx: 0 });
    expect(pointAlongPath([], 0.5)).toEqual({ x: 0, y: 0, dx: 0 });
  });

  it('faces the last horizontal step, or nothing when the path never goes sideways', () => {
    expect(headingOfPath([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe('right');
    expect(headingOfPath([{ x: 3, y: 0 }, { x: 2, y: 0 }])).toBe('left');
    expect(headingOfPath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])).toBe('right'); // the vertical tail does not turn it
    expect(headingOfPath([{ x: 2, y: 0 }, { x: 2, y: 1 }])).toBeUndefined();
    expect(headingOfPath([{ x: 2, y: 0 }])).toBeUndefined();
  });
});

describe('cameraScroll', () => {
  const tile = 32;
  const board = { width: 448, height: 320 }; // 14 x 10 at 32 px
  const view = { width: 200, height: 320 };    // a phone-sized frame: scrolls sideways, fits vertically

  it('keeps two tiles between the action and the viewport edge, moving as little as it can', () => {
    expect(CAMERA_MARGIN_TILES).toBe(2);
    // focus x=10 spans 320..352; far edge + 64 margin = 416, so the viewport must start at 416 - 200 = 216
    expect(cameraScroll({ left: 0, top: 0 }, view, board, tile, { x: 10, y: 5 })).toEqual({ left: 216, top: 0 });
    // already comfortably in view (viewport 90..290, tile 160..192): no move
    expect(cameraScroll({ left: 90, top: 0 }, view, board, tile, { x: 5, y: 5 })).toEqual({ left: 90, top: 0 });
    // too close to the left edge: tile 160 is only 60 px in, margin wants 64
    expect(cameraScroll({ left: 100, top: 0 }, view, board, tile, { x: 5, y: 5 })).toEqual({ left: 96, top: 0 });
  });

  it('never scrolls past the board\'s own edges', () => {
    expect(cameraScroll({ left: 0, top: 0 }, view, board, tile, { x: 13, y: 0 }).left).toBe(448 - 200); // 248, the far edge of the board
    expect(cameraScroll({ left: 100, top: 0 }, view, board, tile, { x: 0, y: 0 }).left).toBe(0);
  });

  it('does not scroll on an axis where the board fits the viewport (known-bad: a camera that always chased the focus would move)', () => {
    const out = cameraScroll({ left: 0, top: 0 }, { width: 500, height: 400 }, board, tile, { x: 13, y: 9 });
    expect(out).toEqual({ left: 0, top: 0 });
  });

  it('shrinks its margin in a tiny viewport so the focus can always be placed', () => {
    const out = cameraScroll({ left: 0, top: 0 }, { width: 100, height: 320 }, board, tile, { x: 8, y: 0 });
    // margin = min(64, (100 - 32) / 2 = 34) = 34: tile 256..288 centred-ish in a 100 px frame
    expect(out.left).toBe(288 + 34 - 100);
    expect(out.left).toBeLessThanOrEqual(256 - 34);
  });
});
