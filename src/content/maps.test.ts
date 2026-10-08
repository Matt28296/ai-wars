// M1.9 the map checker and the six shipped maps. Spec: MapDef and the tile legend in src/content/types.ts, the terrain table in
// src/data (codes, move costs, properties), docs/research/mechanics.md §5 capture, §6 income (1000 per property, uplinks 0), §13
// victory. Every expectation is computed here from the rule text or from a small hand-drawn map, never copied from maps.ts or
// map-check.ts. Known-bad inputs: each checkMap rule has a planted map that must fail with that rule's name, symmetryOf has maps
// that must read 'none', and the shipped maps are re-measured by a second, independent oracle (own BFS, own transforms).
import { describe, expect, it } from 'vitest';
import { FACTION_LIST, TERRAIN_CODES, TERRAIN_TYPES } from '../data';
import { createGame } from '../game/aw';
import type { PlayerSetup } from '../game/aw';
import type { MoveType } from '../game/aw/types';
import { MAX_PLAYERS, checkMap, symmetryOf } from './map-check';
import type { Symmetry } from './map-check';
import { MAPS } from './maps';
import type { MapDef } from './types';

// The repo guard owns the list of names that must never ship; reuse it rather than copy it. The specifier is built at run time
// because scripts/guard.mjs has no type declarations.
const guardUrl = new URL('../../scripts/guard.mjs', import.meta.url).href;
const guard: { DENYLIST: string[]; scanText: (path: string, text: string) => { rule: string; match: string }[] } = await import(/* @vite-ignore */ guardUrl);

// ---------------------------------------------------------------- helpers (independent of the code under test)

const PROPERTY_CODES = 'CFADUH';
const INCOME_CODES = 'CFADH'; // mechanics.md §6: every property pays 1000 except uplinks (0)
const ids = Object.keys(MAPS);

const clone = (m: MapDef): MapDef => JSON.parse(JSON.stringify(m)) as MapDef;
const setCell = (rows: string[], x: number, y: number, ch: string) => {
  rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
};
const rulesOf = (m: MapDef) => [...new Set(checkMap(m).map((i) => i.rule))].sort();
const cell = (m: MapDef, x: number, y: number) => m.terrain[y][x];
const tilesOf = (m: MapDef, pred: (ch: string, owner: string, x: number, y: number) => boolean) => {
  const out: { x: number; y: number }[] = [];
  m.terrain.forEach((row, y) => [...row].forEach((ch, x) => { if (pred(ch, m.owners[y][x], x, y)) out.push({ x, y }); }));
  return out;
};
const countOf = (m: MapDef, ch: string, owner?: string) => tilesOf(m, (c, o) => c === ch && (owner === undefined || o === owner)).length;

/** Steps from `from` over tiles `passable` says a unit may enter (4-neighbour); -1 where it cannot get. */
function distances(m: MapDef, from: { x: number; y: number }, passable: (ch: string) => boolean): number[][] {
  const h = m.terrain.length;
  const w = m.terrain[0].length;
  const d = Array.from({ length: h }, () => new Array<number>(w).fill(-1));
  d[from.y][from.x] = 0;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || d[ny][nx] !== -1 || !passable(m.terrain[ny][nx])) continue;
      d[ny][nx] = d[y][x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return d;
}
const costFor = (mt: MoveType) => (ch: string) => TERRAIN_TYPES[TERRAIN_CODES[ch]].cost[mt] !== null;
const onFoot = costFor('foot');
const spiresOf = (m: MapDef) => tilesOf(m, (c) => c === 'H').map((t) => ({ ...t, owner: Number(m.owners[t.y][t.x]) }));

// A 9x5 two-player map drawn by hand and symmetric under rot180: spires in opposite corners, one fabricator each, a road across
// the middle, four neutral arcologies, one canopy stand each, a trooper each. The valid known-answer for checkMap, the base every
// planted bad map below is cut from.
const FIX: MapDef = {
  id: 'fixture', name: 'Fixture', description: 'A hand-drawn test map.', players: 2,
  terrain: [
    'HF...f...',
    '.===...C.',
    '..C.=.C..',
    '.C...===.',
    '...f...FH',
  ],
  owners: [
    '00.......',
    '.........',
    '.........',
    '.........',
    '.......11',
  ],
  units: [{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 8, y: 3 }],
};

describe('checkMap: the valid known-answer', () => {
  it('passes the hand-drawn fixture with no issues', () => {
    expect(checkMap(FIX)).toEqual([]);
  });
  it('passes every shipped map', () => {
    for (const id of ids) expect(checkMap(MAPS[id]), id).toEqual([]);
  });
  it('does not change the map it is given', () => {
    const before = JSON.stringify(FIX);
    checkMap(FIX);
    expect(JSON.stringify(FIX)).toBe(before);
  });
});

describe('checkMap: every rule fails on its own planted bad map', () => {
  it('shape: a ragged terrain row', () => {
    const m = clone(FIX);
    m.terrain[2] = m.terrain[2].slice(0, 8);
    expect(rulesOf(m)).toEqual(['shape']);
  });
  it('shape: owners with a different number of rows', () => {
    const m = clone(FIX);
    m.owners.pop();
    expect(rulesOf(m)).toEqual(['shape']);
  });
  it('shape: an owners row that is not as wide as its terrain row', () => {
    const m = clone(FIX);
    m.owners[3] = m.owners[3] + '.';
    expect(rulesOf(m)).toEqual(['shape']);
  });
  it('shape: no tiles at all', () => {
    expect(rulesOf({ ...clone(FIX), terrain: [], owners: [], units: [] })).toContain('shape');
  });
  it('players: fewer than two slots, or more than five', () => {
    expect(rulesOf({ ...clone(FIX), players: 1 })).toContain('players');
    expect(rulesOf({ ...clone(FIX), players: MAX_PLAYERS + 1 })).toContain('players');
  });
  it('code: an unknown terrain character, with its position', () => {
    const m = clone(FIX);
    setCell(m.terrain, 4, 3, 'Z');
    expect(rulesOf(m)).toEqual(['code']);
    expect(checkMap(m)[0].at).toEqual({ x: 4, y: 3 });
  });
  it('code: an owner character that is neither "." nor a digit 0-4', () => {
    const m = clone(FIX);
    setCell(m.owners, 2, 2, 'x');
    expect(rulesOf(m)).toEqual(['code']);
  });
  it('owner-property: an owner on flats', () => {
    const m = clone(FIX);
    setCell(m.owners, 1, 1, '0');
    expect(rulesOf(m)).toEqual(['owner-property']);
    expect(checkMap(m)[0].at).toEqual({ x: 1, y: 1 });
  });
  it('owner-range: an owner index beyond the player slots', () => {
    const m = clone(FIX);
    setCell(m.owners, 2, 2, '2'); // the map has slots 0 and 1
    expect(rulesOf(m)).toEqual(['owner-range']);
  });
  it('spire: a player with no spire, a player with two, and a spire nobody owns', () => {
    const none = clone(FIX);
    setCell(none.terrain, 8, 4, '.');
    setCell(none.owners, 8, 4, '.');
    expect(rulesOf(none)).toEqual(['spire']);
    const two = clone(FIX);
    setCell(two.terrain, 4, 2, 'H');
    setCell(two.owners, 4, 2, '0');
    expect(rulesOf(two)).toEqual(['spire']);
    const unowned = clone(FIX);
    setCell(unowned.terrain, 4, 2, 'H');
    expect(rulesOf(unowned)).toEqual(['spire']);
  });
  it('fabricator: a player who owns none', () => {
    const m = clone(FIX);
    setCell(m.terrain, 7, 4, '.');
    setCell(m.owners, 7, 4, '.');
    expect(rulesOf(m)).toEqual(['fabricator']);
  });
  it('unit-type, unit-owner, unit-bounds: an unknown type, a stray owner, an off-map unit', () => {
    const type = clone(FIX);
    type.units.push({ type: 'dragon' as never, owner: 0, x: 2, y: 0 });
    expect(rulesOf(type)).toEqual(['unit-type']);
    const owner = clone(FIX);
    owner.units.push({ type: 'trooper', owner: 2, x: 2, y: 0 });
    expect(rulesOf(owner)).toEqual(['unit-owner']);
    const bounds = clone(FIX);
    bounds.units.push({ type: 'trooper', owner: 0, x: 9, y: 0 });
    expect(rulesOf(bounds)).toEqual(['unit-bounds']);
    const negative = clone(FIX);
    negative.units.push({ type: 'trooper', owner: 0, x: 3, y: -1 });
    expect(rulesOf(negative)).toEqual(['unit-bounds']);
  });
  it('unit-terrain: a trooper on sea is refused, a skimmer on a ridge is refused, a barge on a shoal is fine', () => {
    const sea = clone(FIX);
    setCell(sea.terrain, 0, 2, '~');
    sea.units.push({ type: 'trooper', owner: 0, x: 0, y: 2 });
    expect(rulesOf(sea)).toEqual(['unit-terrain']);
    const ridge = clone(FIX);
    setCell(ridge.terrain, 4, 0, '^');
    ridge.units.push({ type: 'skimmer', owner: 0, x: 4, y: 0 }); // hover units cannot enter ridges
    expect(rulesOf(ridge)).toEqual(['unit-terrain']);
    const shoal = clone(FIX);
    setCell(shoal.terrain, 4, 0, 's');
    shoal.units.push({ type: 'barge', owner: 0, x: 4, y: 0 });
    expect(rulesOf(shoal)).toEqual([]);
  });
  it('unit-overlap: two units on one tile', () => {
    const m = clone(FIX);
    m.units.push({ type: 'trooper', owner: 0, x: 0, y: 1 });
    expect(rulesOf(m)).toEqual(['unit-overlap']);
  });
  it('reach-base: a wall of sea between the spires', () => {
    const m = clone(FIX);
    for (let x = 0; x < 9; x++) setCell(m.terrain, x, 2, '~');
    expect(rulesOf(m)).toEqual(['reach-base']);
  });
  it('reach-base: an enemy fabricator behind water counts too, not only the enemy spire', () => {
    const m = clone(FIX);
    // Wall player 1's spire and fabricator off together: sea at (6,4) and (7,3), and (8,3), where its trooper stood.
    for (const [x, y] of [[6, 4], [7, 3], [8, 3]]) setCell(m.terrain, x, y, '~');
    m.units = m.units.filter((u) => u.owner === 0);
    const issues = checkMap(m);
    expect([...new Set(issues.map((i) => i.rule))]).toEqual(['reach-base']);
    // Seen from player 0's spire: player 1's fabricator and spire are both cut off. Seen from player 1's: so are player 0's.
    for (const [x, y] of [[7, 4], [8, 4], [0, 0], [1, 0]]) expect(issues.some((i) => i.at?.x === x && i.at.y === y), `(${x},${y})`).toBe(true);
  });
  it('reach-neutral: a city with sea on its four sides is flagged even though land touches it diagonally', () => {
    const m = clone(FIX);
    for (const [x, y] of [[7, 0], [6, 1], [8, 1], [7, 2]]) setCell(m.terrain, x, y, '~');
    expect(rulesOf(m)).toEqual(['reach-neutral']);
    expect(checkMap(m)[0].at).toEqual({ x: 7, y: 1 });
  });
  it('reach-neutral: the same city is fine when a shoal (a landing) sits beside it, or when it is a dock', () => {
    const shoal = clone(FIX);
    for (const [x, y] of [[7, 0], [6, 1], [7, 2], [8, 0], [8, 2]]) setCell(shoal.terrain, x, y, '~');
    setCell(shoal.terrain, 8, 1, 's'); // the city's east neighbour; the shoal itself is cut off on foot
    expect(rulesOf(shoal)).toEqual([]);
    const dock = clone(FIX);
    for (const [x, y] of [[7, 0], [6, 1], [8, 1], [7, 2]]) setCell(dock.terrain, x, y, '~');
    setCell(dock.terrain, 7, 1, 'D');
    expect(rulesOf(dock)).toEqual([]);
  });
  it('reach-neutral: an uplink or skyport out of reach is held to the same rule', () => {
    const m = clone(FIX);
    for (const [x, y] of [[7, 0], [6, 1], [8, 1], [7, 2]]) setCell(m.terrain, x, y, '~');
    setCell(m.terrain, 7, 1, 'U');
    expect(rulesOf(m)).toEqual(['reach-neutral']);
  });
});

// ---------------------------------------------------------------- symmetry

const SQUARE_4P: MapDef = {
  id: 'pinwheel', name: 'Pinwheel', description: 'A 3x3 test map.', players: 4,
  terrain: ['HFH', 'F.F', 'HFH'],
  // Clockwise: player 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left; each fabricator belongs to the corner before it.
  owners: ['001', '3.1', '322'],
  units: [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 2, y: 0 }, { type: 'trooper', owner: 2, x: 2, y: 2 }, { type: 'trooper', owner: 3, x: 0, y: 2 }],
};
const MIRROR_X: MapDef = {
  id: 'mx', name: 'mx', description: 'test', players: 2,
  terrain: ['HF.FH', '.C.C.'], owners: ['00.11', '.....'], units: [],
};
const MIRROR_Y: MapDef = {
  id: 'my', name: 'my', description: 'test', players: 2,
  terrain: ['H.', 'F.', '..', 'F.', 'H.'], owners: ['0.', '0.', '..', '1.', '1.'], units: [],
};

describe('symmetryOf', () => {
  it('names each transform on a hand-drawn map', () => {
    expect(symmetryOf(FIX)).toBe('rot180');
    expect(symmetryOf(MIRROR_X)).toBe('mirrorX');
    expect(symmetryOf(MIRROR_Y)).toBe('mirrorY');
    expect(symmetryOf(SQUARE_4P)).toBe('rot90'); // also rot180, but the strongest wins
  });
  it('reads a planted asymmetric map as none: one tile different', () => {
    const m = clone(FIX);
    setCell(m.terrain, 5, 0, '.'); // the canopy stand at (5,0) loses its twin at (3,4)
    expect(symmetryOf(m)).toBe('none');
    const q = clone(SQUARE_4P);
    setCell(q.terrain, 1, 0, 'A'); // one edge differs
    expect(symmetryOf(q)).toBe('none');
  });
  it('reads a map as none when the owners do not follow one consistent player permutation', () => {
    const m = clone(FIX);
    setCell(m.owners, 7, 4, '0'); // player 1's fabricator now belongs to player 0, but 0 -> 1 everywhere else
    expect(symmetryOf(m)).toBe('none');
    const lopsided = clone(FIX);
    setCell(lopsided.owners, 1, 0, '.'); // a neutral fabricator facing an owned one
    expect(symmetryOf(lopsided)).toBe('none');
  });
  it('reads a map as none when only the starting units are asymmetric', () => {
    const extra = clone(FIX);
    extra.units.push({ type: 'trooper', owner: 0, x: 1, y: 2 });
    expect(symmetryOf(extra)).toBe('none');
    const hurt = clone(FIX);
    hurt.units[0].hp = 5;
    expect(symmetryOf(hurt)).toBe('none');
    const swappedOwner = clone(FIX);
    swappedOwner.units[1].owner = 0; // the twin of player 0's trooper must belong to player 1
    expect(symmetryOf(swappedOwner)).toBe('none');
  });
  it('does not call a rectangle rot90, and tolerates a ragged map', () => {
    expect(symmetryOf({ ...clone(FIX), terrain: ['H.', '..', '.H'], owners: ['0.', '..', '.1'], units: [] })).toBe('rot180');
    expect(symmetryOf({ ...clone(FIX), terrain: ['HF', 'F'], owners: ['00', '1'], units: [] })).toBe('none');
    expect(symmetryOf({ ...clone(FIX), terrain: [], owners: [], units: [] })).toBe('none');
  });
});

// ---------------------------------------------------------------- the shipped maps

const DECLARED: Record<string, { symmetry: Symmetry; players: number; width: number; height: number }> = {
  'calder-fields': { symmetry: 'rot180', players: 2, width: 14, height: 10 },
  'saltglass-bay': { symmetry: 'mirrorX', players: 2, width: 22, height: 14 },
  'canopy-highlands': { symmetry: 'rot180', players: 2, width: 18, height: 14 },
  'tether-ridges': { symmetry: 'mirrorY', players: 2, width: 18, height: 16 },
  'glass-waste': { symmetry: 'mirrorX', players: 3, width: 25, height: 15 }, // player 0 on the axis, players 1 and 2 mirrored
  'arcology-coast': { symmetry: 'rot90', players: 4, width: 23, height: 23 },
};

// The independent oracle: where each transform sends a tile, and the owner each rotation hands the tile to.
const IMAGE: Record<Exclude<Symmetry, 'none'>, (x: number, y: number, w: number, h: number) => [number, number]> = {
  rot180: (x, y, w, h) => [w - 1 - x, h - 1 - y],
  mirrorX: (x, y, w) => [w - 1 - x, y],
  mirrorY: (x, y, _w, h) => [x, h - 1 - y],
  rot90: (x, y, _w, h) => [h - 1 - y, x],
};
// Player permutation of each declared map: 2-player maps swap, rot90 turns 0->1->2->3->0, the 3-player map swaps 1 and 2.
const PERMUTATION: Record<string, number[]> = {
  'calder-fields': [1, 0], 'saltglass-bay': [1, 0], 'canopy-highlands': [1, 0], 'tether-ridges': [1, 0],
  'glass-waste': [0, 2, 1], 'arcology-coast': [1, 2, 3, 0],
};

describe('the six maps', () => {
  it('ships exactly the six, with unique kebab-case ids that match their keys', () => {
    expect([...ids].sort()).toEqual(Object.keys(DECLARED).sort());
    for (const [key, m] of Object.entries(MAPS)) {
      expect(m.id, key).toBe(key);
      expect(m.id, key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(new Set(Object.values(MAPS).map((m) => m.id)).size).toBe(6);
    expect(new Set(Object.values(MAPS).map((m) => m.name)).size).toBe(6);
  });
  it('has the player counts and sizes it was drawn with', () => {
    for (const [id, want] of Object.entries(DECLARED)) {
      const m = MAPS[id];
      expect(m.players, id).toBe(want.players);
      expect(m.terrain.length, id).toBe(want.height);
      expect(m.terrain[0].length, id).toBe(want.width);
    }
    expect(Object.values(MAPS).filter((m) => m.players === 2)).toHaveLength(4);
    expect(Object.values(MAPS).filter((m) => m.players === 3)).toHaveLength(1);
    expect(Object.values(MAPS).filter((m) => m.players === 4)).toHaveLength(1);
  });
  it('is named for our setting, in one plain sentence each', () => {
    const setting = ['Calder Fields', 'Saltglass Bay', 'Canopy Highlands', 'Tether Ridges', 'Glass Waste', 'Arcology Coast'];
    expect(Object.values(MAPS).map((m) => m.name).sort()).toEqual([...setting].sort());
    for (const m of Object.values(MAPS)) {
      expect(m.description, m.id).toMatch(/^[A-Z][^.!?]*\.$/); // starts a sentence, ends with its only full stop
      expect(m.description.length, m.id).toBeLessThan(200);
    }
  });
  it('carries none of the names the repo guard denies (the originality list), and the detector would catch one', () => {
    expect(guard.DENYLIST.length).toBeGreaterThan(10);
    for (const bad of guard.DENYLIST.slice(0, 5)) {
      expect(guard.scanText('src/content/maps.ts', `name: '${bad}'`).map((f) => f.rule), bad).toContain('originality');
    }
    for (const m of Object.values(MAPS)) {
      const text = [m.id, m.name, m.author ?? '', m.description].join('\n');
      expect(guard.scanText('src/content/maps.ts', text), m.id).toEqual([]);
    }
  });
  it('is exactly as symmetric as declared, by two independent measurements', () => {
    for (const [id, want] of Object.entries(DECLARED)) {
      const m = MAPS[id];
      expect(symmetryOf(m), id).toBe(want.symmetry);
      // The oracle: apply the transform to every tile by hand. Terrain must match and the owner must be perm[owner].
      const perm = PERMUTATION[id];
      const w = want.width;
      const h = want.height;
      const image = IMAGE[want.symmetry as Exclude<Symmetry, 'none'>];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const [tx, ty] = image(x, y, w, h);
          expect(m.terrain[ty][tx], `${id} terrain (${x},${y})`).toBe(m.terrain[y][x]);
          const o = m.owners[y][x];
          expect(m.owners[ty][tx], `${id} owner (${x},${y})`).toBe(o === '.' ? '.' : String(perm[Number(o)]));
        }
      }
      for (const u of m.units) {
        const [tx, ty] = image(u.x, u.y, w, h);
        expect(m.units.some((v) => v.x === tx && v.y === ty && v.type === u.type && v.owner === perm[u.owner]), `${id} unit (${u.x},${u.y})`).toBe(true);
      }
    }
    for (const id of ids.filter((k) => MAPS[k].players !== 3)) expect(symmetryOf(MAPS[id]), id).not.toBe('none');
  });
  it('gives every player the same properties, counted by type', () => {
    for (const m of Object.values(MAPS)) {
      const byPlayer = Array.from({ length: m.players }, (_, p) => [...PROPERTY_CODES].map((ch) => countOf(m, ch, String(p))).join(','));
      expect(new Set(byPlayer).size, `${m.id}: ${byPlayer.join(' | ')}`).toBe(1);
    }
  });
  it('gives each side one spire, two or three fabricators, a skyport on most maps, and a dock on the naval map', () => {
    let withSkyports = 0;
    for (const m of Object.values(MAPS)) {
      let allSkyport = true;
      for (let p = 0; p < m.players; p++) {
        expect(countOf(m, 'H', String(p)), `${m.id} p${p} spires`).toBe(1);
        const fabs = countOf(m, 'F', String(p));
        expect(fabs, `${m.id} p${p} fabricators`).toBeGreaterThanOrEqual(2);
        expect(fabs, `${m.id} p${p} fabricators`).toBeLessThanOrEqual(3);
        if (countOf(m, 'A', String(p)) < 1) allSkyport = false;
        expect(countOf(m, 'U', String(p)), `${m.id} p${p} owns an uplink at the start`).toBe(0);
      }
      if (allSkyport) withSkyports++;
    }
    expect(withSkyports).toBeGreaterThanOrEqual(5);
    const bay = MAPS['saltglass-bay'];
    for (let p = 0; p < bay.players; p++) {
      const docks = tilesOf(bay, (c, o) => c === 'D' && o === String(p));
      expect(docks.length, `bay p${p} docks`).toBeGreaterThanOrEqual(1);
      for (const d of docks) { // a dock only builds ships if a ship can leave it
        const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => cell(bay, d.x + dx, d.y + dy) === '~');
        expect(open, `dock (${d.x},${d.y}) touches the sea`).toBe(true);
      }
    }
  });
  it('has 8 to 20 neutral arcologies per player, and every shipped neutral property is neutral', () => {
    for (const m of Object.values(MAPS)) {
      const neutralCities = countOf(m, 'C', '.');
      expect(neutralCities / m.players, `${m.id}: ${neutralCities} neutral arcologies for ${m.players} players`).toBeGreaterThanOrEqual(8);
      expect(neutralCities / m.players, m.id).toBeLessThanOrEqual(20);
      // Whole halves too: on a 2-player map each half holds 8..20, counted by tiles on each side of the symmetry.
      if (m.players === 2) {
        const side = DECLARED[m.id].symmetry;
        const half = (x: number, y: number) => {
          const w = m.terrain[0].length;
          const h = m.terrain.length;
          return side === 'mirrorX' ? x < w / 2 : y < h / 2; // left half, or top half for mirrorY and rot180
        };
        const mine = tilesOf(m, (c, o, x, y) => c === 'C' && o === '.' && half(x, y)).length;
        expect(mine, `${m.id} first half`).toBeGreaterThanOrEqual(8);
        expect(mine, `${m.id} first half`).toBeLessThanOrEqual(20);
        expect(neutralCities - mine, `${m.id} second half`).toBe(mine);
      }
    }
  });
  it('puts uplinks in dispute: none on the first skirmish, one or two (all neutral) on every larger map', () => {
    expect(countOf(MAPS['calder-fields'], 'U')).toBe(0);
    for (const id of ids.filter((k) => k !== 'calder-fields')) {
      const n = countOf(MAPS[id], 'U');
      expect(n, id).toBeGreaterThanOrEqual(1);
      expect(n, id).toBeLessThanOrEqual(2);
      expect(countOf(MAPS[id], 'U', '.'), id).toBe(n);
    }
  });
  it('lays maglev between the bases, and a rougher way round that skips the road', () => {
    const isRoad = (ch: string) => ch === '=' || ch === '#' || PROPERTY_CODES.includes(ch);
    const rough = (ch: string) => ch !== '=' && ch !== '#' && onFoot(ch);
    for (const m of Object.values(MAPS)) {
      expect(countOf(m, '='), `${m.id} maglev`).toBeGreaterThanOrEqual(10);
      const spires = spiresOf(m);
      for (const from of spires) {
        const road = distances(m, from, isRoad);
        const offRoad = distances(m, from, rough);
        for (const to of spires) {
          if (to === from) continue;
          expect(road[to.y][to.x], `${m.id}: road ${from.owner}->${to.owner}`).toBeGreaterThan(0);
          expect(offRoad[to.y][to.x], `${m.id}: off-road ${from.owner}->${to.owner}`).toBeGreaterThan(0);
        }
      }
    }
  });
  it('recommends a start fund on every map, and fog only on the canopy map', () => {
    for (const m of Object.values(MAPS)) {
      const funds = m.recommended?.startFunds;
      expect(Number.isInteger(funds) && (funds as number) > 0, `${m.id} startFunds`).toBe(true);
      expect(m.recommended?.fog === true, m.id).toBe(m.id === 'canopy-highlands');
    }
  });
  it('starts units as troopers only', () => {
    for (const m of Object.values(MAPS)) {
      for (const u of m.units) expect(u.type, m.id).toBe('trooper');
      for (let p = 0; p < m.players; p++) expect(m.units.filter((u) => u.owner === p).length, `${m.id} p${p}`).toBe(m.units.filter((u) => u.owner === 0).length);
    }
  });
});

describe('what each map is about', () => {
  it('Calder Fields is the small no-fog skirmish with a forward fabricator each and a crossing at the centre', () => {
    const m = MAPS['calder-fields'];
    expect(m.terrain[0].length * m.terrain.length).toBeLessThanOrEqual(15 * 11);
    expect(countOf(m, 'F', '0')).toBe(2); // one home, one forward
    expect(countOf(m, 'F', '1')).toBe(2);
    // The forward fabricator is nearer the other spire than the home one is.
    const from = spiresOf(m)[1];
    const d = distances(m, from, onFoot);
    const fabs = tilesOf(m, (c, o) => c === 'F' && o === '0');
    expect(Math.min(...fabs.map((f) => d[f.y][f.x]))).toBeLessThan(Math.max(...fabs.map((f) => d[f.y][f.x])));
    expect(m.recommended?.fog).not.toBe(true);
  });
  it('Saltglass Bay is a bay: sea and shoals in the middle, islet cities reachable only by landing, and a long walk round', () => {
    const m = MAPS['saltglass-bay'];
    expect(countOf(m, '~')).toBeGreaterThan(40);
    expect(countOf(m, 's')).toBeGreaterThanOrEqual(10);
    const [a, b] = spiresOf(m);
    const walk = distances(m, a, onFoot)[b.y][b.x];
    expect(walk, 'the only foot route round the bay').toBeGreaterThan(1.5 * (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)));
    // Some neutral city can only be taken by sea: no foot path from either spire.
    const fromA = distances(m, a, onFoot);
    const fromB = distances(m, b, onFoot);
    const seaOnly = tilesOf(m, (c, o, x, y) => c === 'C' && o === '.' && fromA[y][x] === -1 && fromB[y][x] === -1);
    expect(seaOnly.length).toBeGreaterThanOrEqual(4);
  });
  it('Canopy Highlands is over half canopy, with ridges to see from, and asks for fog', () => {
    const m = MAPS['canopy-highlands'];
    const total = m.terrain.length * m.terrain[0].length;
    expect(countOf(m, 'f') / total).toBeGreaterThan(0.45);
    expect(countOf(m, '^')).toBeGreaterThanOrEqual(8);
    expect(m.recommended?.fog).toBe(true);
  });
  it('Tether Ridges has a river only the spans cross for tread units, each span between ridges', () => {
    const m = MAPS['tether-ridges'];
    const riverRows = m.terrain.map((row, y) => ({ row, y })).filter(({ row }) => row.includes('r'));
    expect(riverRows).toHaveLength(2);
    const spanColumns = [...riverRows[0].row].flatMap((ch, x) => (ch === '#' ? [x] : []));
    expect(spanColumns).toHaveLength(3);
    for (const { row } of riverRows) expect([...row].every((ch, x) => ch === 'r' || (ch === '#') === spanColumns.includes(x))).toBe(true);
    const [a, b] = spiresOf(m);
    const treadWithSpans = distances(m, a, costFor('tread'));
    expect(treadWithSpans[b.y][b.x], 'tanks cross on the spans').toBeGreaterThan(0);
    const treadNoSpans = distances(m, a, (ch) => ch !== '#' && costFor('tread')(ch));
    expect(treadNoSpans[b.y][b.x], 'with the spans gone the river stops them').toBe(-1);
    for (const x of spanColumns) { // ridges stand beside the approach to every span, on both banks
      const banks = [riverRows[0].y - 1, riverRows[0].y - 2, riverRows[1].y + 1, riverRows[1].y + 2];
      const ridges = banks.flatMap((y) => [cell(m, x - 1, y), cell(m, x + 1, y)]).filter((ch) => ch === '^');
      expect(ridges.length, `ridges beside span ${x}`).toBeGreaterThanOrEqual(2);
    }
  });
  it('Glass Waste has glass round a single uplink at its heart, and every spire 20 steps from the others', () => {
    const m = MAPS['glass-waste'];
    expect(countOf(m, 'g')).toBeGreaterThan(40);
    const [u] = tilesOf(m, (c) => c === 'U');
    expect(countOf(m, 'U')).toBe(1);
    let glass = 0;
    let all = 0;
    for (let y = u.y - 3; y <= u.y + 3; y++) for (let x = u.x - 3; x <= u.x + 3; x++) { all++; if (cell(m, x, y) === 'g') glass++; }
    expect(glass / all).toBeGreaterThan(0.4);
    expect(Math.abs(u.x - (m.terrain[0].length - 1) / 2)).toBe(0); // on the axis
    const spires = spiresOf(m);
    const pair = new Set<number>();
    for (const a of spires) for (const b of spires) if (a.owner < b.owner) pair.add(distances(m, a, onFoot)[b.y][b.x]);
    expect(pair.size, `spire-to-spire steps ${[...pair]}`).toBe(1);
  });
  it('Glass Waste is fair by measurement: equal property counts and the same walk from each spire to its nearest neutral arcology', () => {
    const m = MAPS['glass-waste'];
    const nearest = spiresOf(m).map((s) => {
      const d = distances(m, s, onFoot);
      const steps = tilesOf(m, (c, o) => c === 'C' && o === '.').map((t) => d[t.y][t.x]).filter((v) => v > 0);
      return Math.min(...steps);
    });
    expect(nearest).toHaveLength(3);
    expect(new Set(nearest).size, `nearest neutral arcology by steps: ${nearest}`).toBe(1);
    const props = [0, 1, 2].map((p) => tilesOf(m, (c, o) => PROPERTY_CODES.includes(c) && o === String(p)).length);
    expect(new Set(props).size).toBe(1);
  });
  it('Arcology Coast is a lagoon ring: a ring of sea, an island uplink at the exact centre, and a dock on the lagoon for each player', () => {
    const m = MAPS['arcology-coast'];
    const centre = (m.terrain.length - 1) / 2;
    expect(cell(m, centre, centre)).toBe('U');
    expect(countOf(m, 'U')).toBe(1);
    expect(countOf(m, '~')).toBeGreaterThan(50);
    // The island is ringed by shoal, and by nothing a trooper can walk across: it can only be taken by landing.
    const d = distances(m, spiresOf(m)[0], onFoot);
    expect(d[centre][centre]).toBe(-1);
    expect(cell(m, centre - 1, centre)).toBe('s');
    for (let p = 0; p < 4; p++) {
      const docks = tilesOf(m, (c, o) => c === 'D' && o === String(p));
      expect(docks.length, `p${p} docks`).toBe(1);
      expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => cell(m, docks[0].x + dx, docks[0].y + dy) === '~')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- the engine accepts every map

function setupFor(count: number): PlayerSetup[] {
  return Array.from({ length: count }, (_, i) => ({
    faction: FACTION_LIST[i % FACTION_LIST.length].id, commander: 'none', controller: 'ai' as const, team: i,
  }));
}
const incomeFor = (m: MapDef, player: number) => 1000 * tilesOf(m, (c, o) => INCOME_CODES.includes(c) && o === String(player)).length;

describe('createGame on the shipped maps', () => {
  it('builds each map with commander-less players and pays player 0 exactly 1000 per income property on turn one', () => {
    for (const m of Object.values(MAPS)) {
      const startFunds = m.recommended?.startFunds ?? 0;
      const s = createGame({ map: m, players: setupFor(m.players), seed: 1, startFunds, fog: m.recommended?.fog });
      expect(s.mapId, m.id).toBe(m.id);
      expect(s.width, m.id).toBe(m.terrain[0].length);
      expect(s.height, m.id).toBe(m.terrain.length);
      expect(s.players, m.id).toHaveLength(m.players);
      expect(s.units, m.id).toHaveLength(m.units.length);
      expect(s.fog, m.id).toBe(m.recommended?.fog === true);
      expect(s.players[0].funds, `${m.id}: ${startFunds} start + income`).toBe(startFunds + incomeFor(m, 0));
      for (let p = 1; p < m.players; p++) expect(s.players[p].funds, `${m.id} player ${p} has not started a turn`).toBe(startFunds);
      // Every property the map owns arrived owned, and every owner row survived the trip.
      m.owners.forEach((row, y) => [...row].forEach((o, x) => {
        expect(s.tiles[y][x].owner, `${m.id} (${x},${y})`).toBe(o === '.' ? null : Number(o));
        expect(s.tiles[y][x].terrain, `${m.id} (${x},${y})`).toBe(TERRAIN_CODES[m.terrain[y][x]]);
      }));
    }
  });
  it('would notice an uplink being paid for: a planted owned uplink adds nothing to the expected income', () => {
    const m = clone(FIX);
    setCell(m.terrain, 4, 2, 'U');
    setCell(m.owners, 4, 2, '0');
    const s = createGame({ map: m, players: setupFor(2), seed: 1, startFunds: 0 });
    expect(incomeFor(m, 0)).toBe(2000); // spire + fabricator; the uplink pays 0
    expect(s.players[0].funds).toBe(2000);
    expect(s.players[0].funds).not.toBe(3000);
  });
  it('refuses a map the checker refuses (the engine throws on the same planted fault)', () => {
    const m = clone(FIX);
    setCell(m.owners, 1, 1, '0'); // an owner on flats
    expect(rulesOf(m)).toContain('owner-property');
    expect(() => createGame({ map: m, players: setupFor(2), seed: 1 })).toThrow(/owner on non-property/);
  });
});

describe('distance helper (the test oracle itself)', () => {
  const grid = (terrain: string[]): MapDef => ({ ...clone(FIX), terrain, owners: terrain.map((r) => '.'.repeat(r.length)), units: [] });
  it('walks round a wall of sea, and cannot enter sea', () => {
    const d = distances(grid(['..~..', '..~..', '.....']), { x: 0, y: 0 }, onFoot);
    expect(d[0][4]).toBe(8); // down 2, across 4, up 2
    expect(d[0][2]).toBe(-1);
  });
  it('is stopped by a full wall, and a span or a river changes the answer by move type', () => {
    expect(distances(grid(['..~..', '..~..', '..~..']), { x: 0, y: 1 }, onFoot)[1][4]).toBe(-1);
    const bridged = grid(['..~..', '..#..', '..~..']);
    expect(distances(bridged, { x: 0, y: 1 }, onFoot)[1][4]).toBe(4);
    expect(distances(bridged, { x: 0, y: 1 }, costFor('tread'))[1][4]).toBe(4);
    const forded = grid(['..r..', '..r..', '..r..']);
    expect(distances(forded, { x: 0, y: 1 }, onFoot)[1][4]).toBe(4); // foot wades a river
    expect(distances(forded, { x: 0, y: 1 }, costFor('tread'))[1][4]).toBe(-1); // treads do not
  });
});
