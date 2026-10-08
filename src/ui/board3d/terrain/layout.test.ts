// Autotile masks, pieces and heights, against answers computed here from geometry (not copied from the implementation).
import { describe, expect, it } from 'vitest';
import type { TerrainId } from '../../../game/aw';
import {
  BIT, CHANNEL_SHORE, H_RIDGE, H_SEA, H_SHOAL, WALK_HEIGHT, WATER_Y, analyseBoard, channelDist, neighbourMask, pieceFor, pieceMask, popcount, rotateMask,
  shoreAt, surfaceY, type Dir, type Piece, type PieceKind,
} from './layout';
import { boardInput } from './testing';

// ---- an independent oracle: directions as screen vectors (x east, y south), rotated by quarter-turns clockwise.
type V = [number, number];
const VEC: Record<Dir, V> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const rotV = (v: V, r: number): V => { let [x, y] = v; for (let i = 0; i < r; i++) [x, y] = [-y, x]; return [x, y]; };
const bitOfVec = (v: V): number => (['N', 'E', 'S', 'W'] as Dir[]).reduce((m, d) => (VEC[d][0] === v[0] && VEC[d][1] === v[1] ? BIT[d] : m), 0);
const CANON_VECS: Record<PieceKind, V[]> = {
  isolated: [],
  end: [VEC.N],
  straight: [VEC.N, VEC.S],
  corner: [VEC.N, VEC.E],
  tee: [VEC.N, VEC.E, VEC.S],
  cross: [VEC.N, VEC.E, VEC.S, VEC.W],
};
const maskOfRotated = (kind: PieceKind, r: number): number => CANON_VECS[kind].reduce((m, v) => m | bitOfVec(rotV(v, r)), 0);

function expectedKind(mask: number): PieceKind {
  const n = popcount(mask);
  if (n === 0) return 'isolated';
  if (n === 1) return 'end';
  if (n === 2) return (mask & 5) === 5 || (mask & 10) === 10 ? 'straight' : 'corner';
  return n === 3 ? 'tee' : 'cross';
}

describe('autotile pieces', () => {
  it('every one of the 16 masks is drawn by the right piece, turned the right way', () => {
    for (let mask = 0; mask < 16; mask++) {
      const piece = pieceFor(mask);
      expect(piece.kind, `kind of ${mask}`).toBe(expectedKind(mask));
      // Turning the canonical piece by `rot` quarter-turns must land exactly on this mask...
      expect(maskOfRotated(piece.kind, piece.rot), `orientation of ${mask}`).toBe(mask);
      // ...and no smaller turn may do (the first matching turn is the one reported).
      for (let r = 0; r < piece.rot; r++) expect(maskOfRotated(piece.kind, r)).not.toBe(mask);
      expect(pieceMask(piece)).toBe(mask);
    }
  });

  it('names the five shapes: straight, corner, tee, cross and end', () => {
    const seen = new Set<PieceKind>();
    for (let m = 0; m < 16; m++) seen.add(pieceFor(m).kind);
    expect([...seen].sort()).toEqual(['corner', 'cross', 'end', 'isolated', 'straight', 'tee']);
    expect(pieceFor(BIT.N | BIT.S).kind).toBe('straight');
    expect(pieceFor(BIT.E | BIT.W)).toEqual({ kind: 'straight', rot: 1 });
    expect(pieceFor(BIT.S | BIT.W)).toEqual({ kind: 'corner', rot: 2 });
    expect(pieceFor(BIT.N | BIT.E | BIT.W).kind).toBe('tee');
  });

  it('rotates masks clockwise: north becomes east', () => {
    expect(rotateMask(BIT.N, 1)).toBe(BIT.E);
    expect(rotateMask(BIT.W, 1)).toBe(BIT.N);
    expect(rotateMask(BIT.N | BIT.E, 2)).toBe(BIT.S | BIT.W);
    expect(rotateMask(7, 4)).toBe(7);
    expect(rotateMask(3, -1)).toBe(rotateMask(3, 3));
  });

  it('a wrong neighbour mask is caught: swapping east and west changes the piece and fails the check', () => {
    const rows = ['.....', '..=..', '..==.', '..=..', '.....']; // a tee: the centre line has N, S and E
    const input = boardInput(rows);
    const board = analyseBoard(input);
    const t = board.at(2, 2);
    expect(t.track!.mask).toBe(BIT.N | BIT.E | BIT.S);
    const check = (mask: number, want: Piece): void => {
      const got = pieceFor(mask);
      if (got.kind !== want.kind || got.rot !== want.rot) throw new Error(`piece ${got.kind}/${got.rot} is not ${want.kind}/${want.rot}`);
    };
    const right: Piece = { kind: 'tee', rot: 0 };
    expect(() => check(t.track!.mask, right)).not.toThrow();
    const swappedEW = (m: number) => (m & (BIT.N | BIT.S)) | (m & BIT.E ? BIT.W : 0) | (m & BIT.W ? BIT.E : 0);
    expect(swappedEW(t.track!.mask)).not.toBe(t.track!.mask);
    expect(() => check(swappedEW(t.track!.mask), right)).toThrow();
  });
});

describe('every neighbour case, on the real board analysis', () => {
  // A 3x3 board whose centre is `centre` and whose four sides are `member` where the mask says so and flats elsewhere.
  const around = (centre: string, member: string, mask: number): string[] => {
    const at = (bit: number): string => (mask & bit ? member : '.');
    return [`.${at(BIT.N)}.`, `${at(BIT.W)}${centre}${at(BIT.E)}`, `.${at(BIT.S)}.`];
  };
  it('maglev: all 16 neighbour cases give the right mask and the right piece', () => {
    for (let mask = 0; mask < 16; mask++) {
      const t = analyseBoard(boardInput(around('=', '=', mask))).at(1, 1);
      expect(t.track!.mask, `maglev ${mask}`).toBe(mask);
      expect(t.track!.piece.kind, `maglev ${mask}`).toBe(expectedKind(mask));
      expect(maskOfRotated(t.track!.piece.kind, t.track!.piece.rot), `maglev ${mask}`).toBe(mask);
    }
  });
  it('river: all 16 neighbour cases give the right mask and the right piece (a plus of rivers stays a channel)', () => {
    for (let mask = 0; mask < 16; mask++) {
      const t = analyseBoard(boardInput(around('r', 'r', mask))).at(1, 1);
      expect(t.water!.mask, `river ${mask}`).toBe(mask);
      expect(t.water!.wide, `river ${mask}`).toBe(false);
      expect(pieceFor(t.water!.mask).kind, `river ${mask}`).toBe(expectedKind(mask));
    }
  });
  it('bridges and properties count as track neighbours; a river or sea neighbour does not', () => {
    for (const other of ['#', 'C', 'H', 'D']) {
      expect(analyseBoard(boardInput(around('=', other, BIT.N | BIT.S))).at(1, 1).track!.piece).toEqual({ kind: 'straight', rot: 0 });
    }
    for (const other of ['r', '~', 's', 'f', '^']) {
      expect(analyseBoard(boardInput(around('=', other, BIT.N | BIT.S))).at(1, 1).track!.piece).toEqual({ kind: 'isolated', rot: 0 });
    }
  });
});

describe('neighbour masks from a real grid', () => {
  const rows = [
    '.=.',
    '===', // a cross at the centre
    '.=.',
  ];
  it('the centre of a plus is a cross, each arm tip an end pointing at the centre', () => {
    const b = analyseBoard(boardInput(rows));
    expect(b.at(1, 1).track).toEqual({ mask: 15, piece: { kind: 'cross', rot: 0 } });
    expect(b.at(1, 0).track!.mask).toBe(BIT.S);
    expect(b.at(1, 2).track!.mask).toBe(BIT.N);
    expect(b.at(0, 1).track!.mask).toBe(BIT.E);
    expect(b.at(2, 1).track!.mask).toBe(BIT.W);
    expect(b.at(1, 0).track!.piece).toEqual({ kind: 'end', rot: 2 });
    expect(b.at(0, 0).track).toBeNull();
  });
  it('a map edge reads the `outside` value', () => {
    const member = (x: number, y: number): boolean => x === 1 && y === 1;
    expect(neighbourMask(3, 3, member, 0, 0)).toBe(0);
    expect(neighbourMask(3, 3, member, 1, 0)).toBe(BIT.S);
    expect(neighbourMask(3, 3, () => false, 0, 0, true)).toBe(BIT.N | BIT.W);
    expect(neighbourMask(3, 3, () => false, 1, 1, true)).toBe(0);
  });
  it('a line of track ending against a property connects to it, and track turns a corner with an arc piece', () => {
    const b = analyseBoard(boardInput(['C=.', '.=.', '.==']));
    expect(b.at(1, 0).track!.mask).toBe(BIT.W | BIT.S);
    expect(b.at(1, 0).track!.piece.kind).toBe('corner');
    expect(b.at(1, 1).track!.piece.kind).toBe('straight');
    expect(b.at(1, 2).track!.mask).toBe(BIT.N | BIT.E);
  });
});

describe('rivers and bridges', () => {
  it('a lone river reach is a carved channel; more water beside it makes it a wide river', () => {
    const narrow = analyseBoard(boardInput(['.r.', '.r.', '.r.']));
    expect(narrow.at(1, 1).water).toEqual({ kind: 'river', wide: false, mask: BIT.N | BIT.S });
    const wide = analyseBoard(boardInput(['.rr.', '.rr.', '.rr.']));
    expect(wide.at(1, 1).water!.wide).toBe(true);
    // A junction of narrow rivers is still a channel (a plus-shaped river has no 2x2 block of water).
    const junction = analyseBoard(boardInput(['.r.', 'rrr', '.r.']));
    expect(junction.at(1, 1).water).toEqual({ kind: 'river', wide: false, mask: 15 });
    // A river beside sea, a lake or a bridge-and-river pair is open water wherever a 2x2 block forms.
    const lake = analyseBoard(boardInput(['.r.', 'rr.', '~~.']));
    expect(lake.at(1, 1).water!.wide).toBe(true);
    expect(lake.at(1, 0).water!.wide).toBe(false);
  });
  it('a two-tile-wide river with a bridge across it is open water under the whole bridge', () => {
    const b = analyseBoard(boardInput(['rrr#rr', 'rrr#rr', '..=.==']));
    expect(b.at(3, 0).water!.wide).toBe(true);
    expect(b.at(3, 1).water!.wide).toBe(true);
    expect(b.at(3, 0).track!.mask & (BIT.S)).toBe(BIT.S);
  });
  it('a river that runs off the map edge continues, a spring ends in a pond', () => {
    const b = analyseBoard(boardInput(['.r.', '.r.', '...']));
    expect(b.at(1, 0).water!.mask & BIT.N).toBe(BIT.N);
    expect(b.at(1, 1).water!.mask).toBe(BIT.N);
    expect(pieceFor(b.at(1, 1).water!.mask).kind).toBe('end');
  });
  it('a span carries track over the river: the rails run along the bridge, the water runs under it', () => {
    const b = analyseBoard(boardInput(['.r.', '=#=', '.r.']));
    const s = b.at(1, 1);
    expect(s.track).toEqual({ mask: BIT.E | BIT.W, piece: { kind: 'straight', rot: 1 } });
    expect(s.water).toEqual({ kind: 'river', wide: false, mask: BIT.N | BIT.S });
    expect(s.walk).toBe(0.05);
  });
  it('a span over open sea has full-tile water; a span with no neighbours still has two rail ends', () => {
    expect(analyseBoard(boardInput(['~~~', '=#=', '~~~'])).at(1, 1).water).toEqual({ kind: 'sea', wide: true, mask: 15 });
    const lone = analyseBoard(boardInput(['...', '.#.', '...'])).at(1, 1);
    expect(popcount(lone.track!.mask)).toBe(2);
  });
  it('the channel distance is zero on the centre line and grows with the distance from it', () => {
    expect(channelDist(BIT.N | BIT.S, 0.5, 0.2)).toBeCloseTo(0, 6);
    expect(channelDist(BIT.N | BIT.S, 0.8, 0.5)).toBeCloseTo(0.3, 6);
    expect(channelDist(BIT.N | BIT.E, 0.5, 0.5)).toBeCloseTo(0, 6);
    expect(channelDist(0, 0.9, 0.5)).toBeCloseTo(0.4, 6);
    // Only the connected sides have a channel: a point on a closed side is far from the line.
    expect(channelDist(BIT.N, 0.5, 0.9)).toBeCloseTo(0.4, 6);
  });
});

describe('heights', () => {
  // The art direction: ridge +0.35, flats and canopy floor 0, shoal -0.05, sea and river -0.15 (water surface -0.08).
  const EXPECT: Partial<Record<TerrainId, number>> = {
    flats: 0, canopy: 0, ridge: 0.35, shoal: -0.05, sea: -0.15, river: -0.15, glass: 0,
  };
  it('walkable heights follow the art direction', () => {
    for (const [t, h] of Object.entries(EXPECT)) expect(WALK_HEIGHT[t as TerrainId], t).toBe(h);
    expect(H_RIDGE).toBe(0.35);
    expect(H_SHOAL).toBe(-0.05);
    expect(H_SEA).toBe(-0.15);
    expect(WATER_Y).toBe(-0.08);
    // Properties and track stand a little proud of the ground so a unit on them stands on the pad or the rails' bed.
    for (const p of ['arcology', 'fabricator', 'skyport', 'uplink', 'spire'] as TerrainId[]) expect(WALK_HEIGHT[p]).toBeGreaterThan(0);
    expect(WALK_HEIGHT.span).toBeGreaterThan(WALK_HEIGHT.maglev);
  });
  it('the ground surface agrees with the walk height at the centre of every tile', () => {
    const rows = ['.f^=#', 'rs~g.', 'CFADU', 'H....'];
    const b = analyseBoard(boardInput(rows));
    for (const t of b.tiles) {
      const ground = surfaceY(t, 0.5, 0.5);
      if (t.property || t.terrain === 'maglev' || t.terrain === 'span') {
        // Props sit on the ground slab: the walk height is the slab (0) plus the pad or bed.
        if (t.terrain !== 'span') expect(t.walk, t.terrain).toBeGreaterThanOrEqual(ground);
      } else {
        expect(t.walk, `${t.terrain} at ${t.x},${t.y}`).toBeCloseTo(ground, 6);
      }
    }
  });
  it('the water surface covers sea and river beds and the shoal dips under it only at its wet edge', () => {
    const b = analyseBoard(boardInput(['s~', '~~']));
    const shoal = b.at(0, 0);
    expect(surfaceY(shoal, 0.5, 0.5)).toBeCloseTo(H_SHOAL, 3); // centre: dry sand
    expect(surfaceY(shoal, 0.99, 0.5)).toBeLessThan(WATER_Y); // wet edge: under water
    expect(shoreAt(shoal, 0.5, 0.5)).toBeLessThan(0); // dry
    expect(shoreAt(shoal, 0.99, 0.5)).toBeGreaterThan(0); // shallow
  });
  it('shore values are positive over water and negative over dry bank, in a river channel as on a shoal', () => {
    const river = analyseBoard(boardInput(['.r.', '.r.', '.r.'])).at(1, 1);
    expect(river.water!.wide).toBe(false);
    expect(shoreAt(river, 0.5, 0.5)).toBeGreaterThan(0.3); // the middle of the channel
    expect(shoreAt(river, 0.5, 0.5)).toBeGreaterThan(shoreAt(river, 0.7, 0.5)); // growing toward the middle
    expect(shoreAt(river, 0.95, 0.5)).toBeLessThan(0); // the dry bank
    // The waterline sits where the bank rises through the water surface: the bank profile must agree with CHANNEL_SHORE.
    expect(surfaceY(river, 0.5 + CHANNEL_SHORE, 0.5)).toBeCloseTo(WATER_Y, 2);
    expect(shoreAt(river, 0.5 + CHANNEL_SHORE, 0.5)).toBeCloseTo(0, 6);
  });
  it('a ridge plateau is exactly 0.35 at its centre and its rim never rises above its shoulder', () => {
    const b = analyseBoard(boardInput(['^^^', '^^^', '^^^']));
    const t = b.at(1, 1);
    expect(surfaceY(t, 0.5, 0.5)).toBe(0.35);
    for (let i = 0; i <= 8; i++) expect(surfaceY(t, 0.035 + (i / 8) * 0.93, 0.035)).toBeLessThanOrEqual(0.35 + 0.05);
  });
});

describe('water tiles know where land is', () => {
  it('a sea tile marks the sides and corners that touch raised land (foam), but not shoal or other water', () => {
    const b = analyseBoard(boardInput(['.~s', '~~~', '~~~']));
    const sea = b.at(1, 1);
    expect(sea.landEdges).toBe(0);
    const edge = b.at(1, 0);
    expect(edge.terrain).toBe('sea');
    expect(edge.landEdges).toBe(BIT.W); // the flats to the west
    expect(edge.shoalEdges).toBe(BIT.E); // the shoal to the east
    expect(b.at(0, 1).landCorners).toBe(0);
    expect(b.at(1, 1).landCorners).toBe(1); // NW corner touches the flats at (0,0)
  });
});
