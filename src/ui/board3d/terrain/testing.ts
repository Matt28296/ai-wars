// Test helpers for the terrain kit (no test runner imports here, so tests can share them).
import { TERRAIN_CODES } from '../../../data';
import type { FactionId, PlayerIndex } from '../../../game/aw';
import type { TerrainInput } from '../contract';

export const FACTIONS: readonly FactionId[] = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'];

/** A terrain input from map-code rows ('.' flats, '=' maglev, 'r' river, ...), with owners given as `"x,y" -> player`. */
export function boardInput(rows: string[], owners: Record<string, PlayerIndex> = {}, weather: 'clear' | 'ionstorm' = 'clear'): TerrainInput {
  return {
    width: rows[0].length,
    height: rows.length,
    terrainAt: (x, y) => {
      const t = TERRAIN_CODES[rows[y][x]];
      if (!t) throw new Error(`bad terrain code ${rows[y][x]}`);
      return t;
    },
    ownerAt: (x, y) => owners[`${x},${y}`] ?? null,
    factionOf: (p) => FACTIONS[p] ?? null,
    weather,
  };
}

/** A deterministic busy board of the given size: every terrain code, clustered the way real maps cluster them. Used for the worst-case budgets. */
export function stressRows(width: number, height: number): string[] {
  const rows: string[] = [];
  const codes = '..ff^^==rr~~sg..CFADUH';
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const n = Math.sin(x * 1.7 + y * 0.9) + Math.sin(x * 0.6 - y * 2.1) + Math.sin((x + y) * 0.45);
      const i = Math.floor(((n + 3) / 6) * codes.length + ((x * 7 + y * 13) % 5) * 0.4) % codes.length;
      row += codes[i];
    }
    rows.push(row);
  }
  return rows;
}
