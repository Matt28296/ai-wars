// M1.9 the map checker. One pure function the shipped maps are tested with and the future Design Room reuses, so a map a
// player draws is held to the same rules as the six we ship. An empty list means the map is valid.
// Spec: MapDef and the tile legend in src/content/types.ts, the terrain table in src/data (codes, move costs, which
// terrains are properties), docs/research/mechanics.md §5 (capture), §6 (income) and §13 (victory: capture a spire).
// Reachability is a plain breadth-first search over tiles a FOOT unit can enter, using the engine's own terrainMoveCost,
// so a map the checker passes is a map troopers can actually walk (and capture) across.
import { TERRAIN_CODES, TERRAIN_TYPES, UNIT_TYPES } from '../data';
import { canStandOn, terrainMoveCost } from '../game/aw/movement';
import type { TerrainId } from '../game/aw/types';
import type { MapDef } from './types';

export interface MapIssue { rule: string; message: string; at?: { x: number; y: number } }

/** Owner rows use '0'..'4'; MapDef never has more slots than that. */
export const MAX_PLAYERS = 5;

const OWNER_DIGITS = '01234';
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export interface CheckMapOptions {
  /** Default true: every player must own exactly one command spire and at least one fabricator. A tutorial map with no
   *  production passes `false`, which skips the `spire` and `fabricator` rules only; every other rule still runs, and the
   *  reach rules still measure from whatever spires the map has. */
  requireBases?: boolean;
}

/** Every broken rule in the map. Rule names: shape, players, code, owner-property, owner-range, spire, fabricator,
 *  unit-type, unit-owner, unit-bounds, unit-terrain, unit-overlap, reach-base, reach-neutral. */
export function checkMap(map: MapDef, opts?: CheckMapOptions): MapIssue[] {
  const requireBases = opts?.requireBases ?? true;
  const issues: MapIssue[] = [];
  const add = (rule: string, message: string, at?: { x: number; y: number }) => {
    issues.push(at ? { rule, message, at } : { rule, message });
  };

  // ---- players
  const players = map.players;
  if (!Number.isInteger(players) || players < 2 || players > MAX_PLAYERS) {
    add('players', `players is ${String(players)}; a map needs 2 to ${MAX_PLAYERS} player slots`);
  }

  // ---- shape: rows rectangular, terrain and owners the same size. Later rules need a grid, so stop here if it is not.
  const height = map.terrain.length;
  const width = height ? map.terrain[0].length : 0;
  if (!height || !width) add('shape', 'the map has no tiles');
  if (map.owners.length !== height) add('shape', `terrain has ${height} rows but owners has ${map.owners.length}`);
  for (let y = 0; y < height; y++) {
    if (map.terrain[y].length !== width) add('shape', `terrain row ${y} is ${map.terrain[y].length} wide, expected ${width}`, { x: 0, y });
    if (y < map.owners.length && map.owners[y].length !== map.terrain[y].length) {
      add('shape', `owners row ${y} is ${map.owners[y].length} wide, terrain row ${y} is ${map.terrain[y].length}`, { x: 0, y });
    }
  }
  if (issues.some((i) => i.rule === 'shape')) return issues;

  const playerSlots = Number.isInteger(players) && players >= 1 ? players : 0;

  // ---- codes, owners
  const terrainAt = (x: number, y: number): TerrainId | undefined => TERRAIN_CODES[map.terrain[y][x]];
  const ownerAt = (x: number, y: number): number | null => {
    const o = map.owners[y][x];
    return OWNER_DIGITS.includes(o) && o !== '' ? Number(o) : null;
  };
  const isProperty = (t: TerrainId | undefined) => !!t && !!TERRAIN_TYPES[t].property;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = map.terrain[y][x];
      const t = TERRAIN_CODES[ch];
      if (!t) add('code', `terrain character '${ch}' is not a legal code`, { x, y });
      const o = map.owners[y][x];
      if (o === '.') continue;
      if (!OWNER_DIGITS.includes(o)) { add('code', `owner character '${o}' is not '.' or a digit 0-4`, { x, y }); continue; }
      if (t && !isProperty(t)) add('owner-property', `${t} at this tile is not a property, so it cannot have an owner`, { x, y });
      if (Number(o) >= playerSlots) add('owner-range', `owner ${o} is not a player slot (the map has ${playerSlots})`, { x, y });
    }
  }

  // ---- each player owns exactly one command spire and at least one fabricator
  const spires: { x: number; y: number; owner: number }[] = [];
  const fabricators: { x: number; y: number; owner: number }[] = [];
  const spireCount = new Array<number>(playerSlots).fill(0);
  const fabCount = new Array<number>(playerSlots).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = terrainAt(x, y);
      if (t !== 'spire' && t !== 'fabricator') continue;
      const owner = ownerAt(x, y);
      if (owner === null || owner >= playerSlots) {
        if (t === 'spire' && requireBases) add('spire', 'a command spire must belong to a player slot', { x, y });
        continue;
      }
      if (t === 'spire') { spires.push({ x, y, owner }); spireCount[owner]++; }
      else { fabricators.push({ x, y, owner }); fabCount[owner]++; }
    }
  }
  if (requireBases) {
    for (let p = 0; p < playerSlots; p++) {
      if (spireCount[p] !== 1) add('spire', `player ${p} owns ${spireCount[p]} command spires, needs exactly 1`);
      if (fabCount[p] < 1) add('fabricator', `player ${p} owns no fabricator, needs at least 1`);
    }
  }

  // ---- units
  const seen = new Map<string, number>();
  map.units.forEach((u, i) => {
    const at = { x: u.x, y: u.y };
    const ut = UNIT_TYPES[u.type];
    if (!ut) add('unit-type', `unit ${i} has unknown type '${String(u.type)}'`, at);
    if (!Number.isInteger(u.owner) || u.owner < 0 || u.owner >= playerSlots) add('unit-owner', `unit ${i} (${u.type}) has owner ${u.owner}, outside the ${playerSlots} player slots`, at);
    if (!Number.isInteger(u.x) || !Number.isInteger(u.y) || u.x < 0 || u.y < 0 || u.x >= width || u.y >= height) {
      add('unit-bounds', `unit ${i} (${u.type}) is at (${u.x},${u.y}), off the ${width}x${height} map`, at);
      return;
    }
    const t = terrainAt(u.x, u.y);
    if (ut && t && !canStandOn(t, ut.moveType)) add('unit-terrain', `unit ${i} (${u.type}, ${ut.moveType}) cannot stand on ${t}`, at);
    const key = `${u.x},${u.y}`;
    if (seen.has(key)) add('unit-overlap', `units ${seen.get(key)} and ${i} share tile (${u.x},${u.y})`, at);
    else seen.set(key, i);
  });

  // ---- reachability on foot (breadth-first over tiles a foot unit can enter)
  const floodFrom = (sx: number, sy: number): boolean[][] => {
    const seenTile = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
    const queue: [number, number][] = [[sx, sy]];
    seenTile[sy][sx] = true;
    for (let head = 0; head < queue.length; head++) {
      const [cx, cy] = queue[head];
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seenTile[ny][nx]) continue;
        const t = terrainAt(nx, ny);
        if (!t || terrainMoveCost(t, 'foot') === null) continue;
        seenTile[ny][nx] = true;
        queue.push([nx, ny]);
      }
    }
    return seenTile;
  };
  const floods = spires.map((s) => floodFrom(s.x, s.y));

  for (const target of [...spires, ...fabricators]) {
    spires.forEach((from, i) => {
      if (from.owner === target.owner || floods[i][target.y][target.x]) return;
      const what = terrainAt(target.x, target.y) === 'spire' ? 'command spire' : 'fabricator';
      add('reach-base', `player ${target.owner}'s ${what} at (${target.x},${target.y}) cannot be reached on foot from player ${from.owner}'s spire`, { x: target.x, y: target.y });
    });
  }

  const isLanding = (x: number, y: number): boolean => {
    const here = terrainAt(x, y);
    if (here === 'dock' || here === 'shoal') return true;
    return DIRS.some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      const t = terrainAt(nx, ny);
      return t === 'shoal' || t === 'dock';
    });
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isProperty(terrainAt(x, y)) || ownerAt(x, y) !== null) continue;
      if (floods.some((f) => f[y][x]) || isLanding(x, y)) continue;
      add('reach-neutral', `neutral ${terrainAt(x, y)} at (${x},${y}) cannot be reached on foot from any spire and has no shoal or dock to land beside`, { x, y });
    }
  }

  return issues;
}

export type Symmetry = 'rot180' | 'mirrorX' | 'mirrorY' | 'rot90' | 'none';

type Transform = (x: number, y: number, w: number, h: number) => [number, number];
// Strongest first: a rot90 map is also rot180, and a map that is both mirrors is also rot180.
// mirrorX flips left-right (x -> w-1-x), mirrorY flips top-bottom (y -> h-1-y), rot90 turns clockwise (square maps only).
const TRANSFORMS: { name: Exclude<Symmetry, 'none'>; squareOnly?: boolean; at: Transform }[] = [
  { name: 'rot90', squareOnly: true, at: (x, y, _w, h) => [h - 1 - y, x] },
  { name: 'rot180', at: (x, y, w, h) => [w - 1 - x, h - 1 - y] },
  { name: 'mirrorX', at: (x, y, w) => [w - 1 - x, y] },
  { name: 'mirrorY', at: (x, y, _w, h) => [x, h - 1 - y] },
];

/** The strongest symmetry the map has: terrain equal under the transform, owners equal under ONE consistent permutation
 *  of the player slots (player 0's half may belong to player 1 in the image), and starting units equal too. 'none' for a
 *  map with no symmetry, or one too malformed to compare. */
export function symmetryOf(map: MapDef): Symmetry {
  const h = map.terrain.length;
  const w = h ? map.terrain[0].length : 0;
  if (!h || !w || map.owners.length !== h) return 'none';
  for (let y = 0; y < h; y++) if (map.terrain[y].length !== w || map.owners[y].length !== w) return 'none';
  for (const tf of TRANSFORMS) {
    if (tf.squareOnly && w !== h) continue;
    if (symmetricUnder(map, w, h, tf.at)) return tf.name;
  }
  return 'none';
}

function symmetricUnder(map: MapDef, w: number, h: number, at: Transform): boolean {
  const perm = new Map<string, string>();
  const used = new Set<string>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [tx, ty] = at(x, y, w, h);
      if (map.terrain[y][x] !== map.terrain[ty][tx]) return false;
      const a = map.owners[y][x];
      const b = map.owners[ty][tx];
      if ((a === '.') !== (b === '.')) return false;
      if (a === '.') continue;
      const known = perm.get(a);
      if (known === undefined) {
        if (used.has(b)) return false; // two owners cannot map to one
        perm.set(a, b);
        used.add(b);
      } else if (known !== b) return false;
    }
  }
  // Units: the multiset of (type, mapped owner, hp, mapped position) must equal the multiset of what is there.
  const ownerKey = (o: number) => perm.get(String(o)) ?? String(o);
  const here = map.units.map((u) => `${u.type}|${u.owner}|${u.hp ?? 10}|${u.x},${u.y}`).sort();
  const image = map.units.map((u) => {
    const [tx, ty] = at(u.x, u.y, w, h);
    return `${u.type}|${ownerKey(u.owner)}|${u.hp ?? 10}|${tx},${ty}`;
  }).sort();
  return here.length === image.length && here.every((v, i) => v === image[i]);
}
