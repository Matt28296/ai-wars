// The boards the front door shows (G9): a title skirmish (here) and a mission's own map (missionScene.ts, which carries the campaign's
// data and so stays out of the title's first load). Pure data, no three.js, so the lazy 3D preview, the tile still and the tests all
// read the same thing.
import { MAPS } from '../../content/maps';
import type { MapDef } from '../../content/types';
import { TERRAIN_CODES } from '../../data';
import type { FactionId, TerrainId, UnitTypeId, Weather } from '../../game/aw';

export interface PreviewUnit {
  type: UnitTypeId;
  faction: FactionId;
  x: number;
  y: number;
  /** Radians; 0 faces east (+X), PI/2 faces south (+Z) (src/ui/board3d/contract.ts). Always a multiple of PI/2: formations face square. */
  heading: number;
}

export interface PreviewScene {
  id: string;
  width: number;
  height: number;
  terrain: TerrainId[][];
  /** The player owning each property tile, or null. */
  owners: (number | null)[][];
  /** The faction of each player slot. */
  factions: (FactionId | null)[];
  weather: Weather;
  units: PreviewUnit[];
}

const QUARTER = Math.PI / 2;

/** Heading toward a point, snapped to the four compass directions (a column on parade does not face north-north-east). */
export function headingToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : Math.PI;
  return dy >= 0 ? QUARTER : -QUARTER;
}

const centroid = (pts: { x: number; y: number }[]): { x: number; y: number } => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/** Each unit faces the nearest other owner's centre of mass; with only one owner on the map they all face east. */
export function faceTheEnemy(units: { owner: number; x: number; y: number }[]): number[] {
  const owners = [...new Set(units.map((u) => u.owner))];
  const centre = new Map(owners.map((o) => [o, centroid(units.filter((u) => u.owner === o))] as const));
  return units.map((u) => {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const o of owners) {
      if (o === u.owner) continue;
      const c = centre.get(o)!;
      const d = Math.hypot(c.x - u.x, c.y - u.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best ? headingToward(u, best) : 0;
  });
}

/** A scene from a map definition. A unit whose owner has no faction in `factions` is left out. */
export function sceneFromMap(map: MapDef, factions: (FactionId | null)[], weather: Weather = 'clear'): PreviewScene {
  const terrain = map.terrain.map((row, y) => [...row].map((ch, x) => {
    const t = TERRAIN_CODES[ch];
    if (!t) throw new Error(`scene ${map.id}: unknown terrain code '${ch}' at (${x},${y})`);
    return t;
  }));
  const owners = map.owners.map((row) => [...row].map((ch) => (ch === '.' ? null : Number(ch))));
  const placed = map.units.filter((u) => factions[u.owner]);
  const headings = faceTheEnemy(placed);
  return {
    id: map.id,
    width: map.terrain[0].length,
    height: map.terrain.length,
    terrain,
    owners,
    factions,
    weather,
    units: placed.map((u, i) => ({ type: u.type, faction: factions[u.owner]!, x: u.x, y: u.y, heading: headings[i] })),
  };
}

/**
 * The title's board: Calder Fields (the demo's own map) with a skirmish drawn up on it. Helion holds the west facing east and Tidewell the
 * east facing west; a Kestrel pair stands off the south flank and a Verdant pair off the north, both turned in on the middle, so all four
 * colours are in the shot and the formation reads as a crossfire. Every unit stands on ground it can cross (scene.test.ts checks).
 */
export function titleScene(): PreviewScene {
  const map = MAPS['calder-fields'];
  if (!map) throw new Error('title: map calder-fields is missing');
  const base = sceneFromMap({ ...map, units: [] }, ['helion', 'tidewell']);
  const line = (faction: FactionId, heading: number, ...u: [UnitTypeId, number, number][]): PreviewUnit[] =>
    u.map(([type, x, y]) => ({ type, faction, x, y, heading }));
  const units: PreviewUnit[] = [
    ...line('helion', 0, ['lancer', 5, 4], ['lancer', 5, 5], ['trooper', 4, 3], ['trooper', 4, 5], ['arc', 3, 4], ['wasp', 5, 2]),
    ...line('tidewell', Math.PI, ['lancer', 8, 4], ['lancer', 8, 5], ['trooper', 9, 4], ['trooper', 9, 6], ['salvo', 10, 5], ['raptor', 9, 3]),
    ...line('kestrel', -Math.PI / 2, ['colossus', 6, 6], ['skimmer', 5, 6]),
    ...line('verdant', Math.PI / 2, ['warden', 6, 2], ['skimmer', 7, 2]),
  ];
  return { ...base, id: 'title-skirmish', units };
}
