// Procedural terrain for the shell: the title backdrop (a drifting field of Meridia) and the campaign map
// (the continent, its five regions and where each mission sits). Deterministic: same seed, same land.
import type { FactionId, UnitTypeId } from '../../engine/types';
import type { TileUnit } from './TileMap';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise2(seed: number) {
  const rnd = mulberry32(seed);
  const N = 64;
  const g = Array.from({ length: N * N }, () => rnd());
  const at = (x: number, y: number) => g[(((y % N) + N) % N) * N + (((x % N) + N) % N)]!;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const v = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = sm(x - xi), ty = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  return (x: number, y: number) => (v(x, y) * 0.6 + v(x * 2.1 + 17, y * 2.1 + 9) * 0.3 + v(x * 4.3 + 3, y * 4.3 + 41) * 0.1);
}

const FACTIONS: FactionId[] = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'];

export interface GenMap { terrain: string[]; owners: string[]; units: TileUnit[]; factions: FactionId[] }

/** A wide field of mixed terrain with scattered owned properties and idle units, for the title backdrop. */
export function genBackdrop(w: number, h: number, seed = 104): GenMap {
  const elev = noise2(seed), wet = noise2(seed + 1), glass = noise2(seed + 2);
  const rnd = mulberry32(seed + 3);
  const grid: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const e = elev(x / 7, y / 7), m = wet(x / 6, y / 6), gl = glass(x / 9, y / 9);
      let c = '.';
      if (e < 0.33) c = '~';
      else if (e < 0.38) c = 's';
      else if (gl > 0.68) c = 'g';
      else if (e > 0.7) c = '^';
      else if (m > 0.58) c = 'f';
      row.push(c);
    }
    grid.push(row);
  }
  // Maglev lines along two rows, bridged over water.
  for (const ry of [Math.floor(h * 0.3), Math.floor(h * 0.72)]) {
    for (let x = 0; x < w; x++) {
      const c = grid[ry]![x]!;
      grid[ry]![x] = c === '~' || c === 's' ? '#' : c === '^' ? '^' : '=';
    }
  }
  // Properties: owner by broad band so colours cluster like front lines.
  const owners = grid.map((r) => r.map(() => '.'));
  const units: TileUnit[] = [];
  const unitTypes: UnitTypeId[] = ['trooper', 'lancer', 'arc', 'skimmer', 'bastion', 'mule', 'warden', 'breacher'];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y]![x]!;
      if (c !== '.' && c !== 'f') continue;
      const r = rnd();
      const band = Math.min(FACTIONS.length - 1, Math.floor(((x / w) * 0.75 + (y / h) * 0.25 + elev(x / 3, y / 3) * 0.3) * FACTIONS.length * 0.9));
      if (r < 0.045) {
        const p = rnd();
        grid[y]![x] = p < 0.4 ? 'C' : p < 0.65 ? 'F' : p < 0.8 ? 'A' : p < 0.92 ? 'U' : 'H';
        owners[y]![x] = rnd() < 0.8 ? String(band) : '.';
      } else if (r < 0.075) {
        units.push({ type: unitTypes[Math.floor(rnd() * unitTypes.length)]!, owner: band, x, y });
      }
    }
  }
  return { terrain: grid.map((r) => r.join('')), owners: owners.map((r) => r.join('')), units, factions: FACTIONS };
}

// ---------------------------------------------------------------- Meridia
export const MERIDIA_W = 44;
export const MERIDIA_H = 28;

export interface Region { faction: FactionId; name: string; label: [number, number] }
export const REGIONS: Region[] = [
  { faction: 'kestrel', name: 'The Tether Ridges', label: [27, 2.6] },
  { faction: 'helion', name: 'The Sunward Plains', label: [38.2, 8.2] },
  { faction: 'verdant', name: 'The Canopy Highlands', label: [15, 25.4] },
  { faction: 'tidewell', name: 'The Arcology Coast', label: [6.2, 6.4] },
  { faction: 'choir', name: 'The Glass Waste', label: [22, 10.2] },
];

/** Mission node positions on the Meridia grid, by campaign order (1-based). */
export const NODE_POS: Record<number, [number, number]> = {
  1: [38, 15], 2: [36, 11], 3: [32, 19], 4: [28, 22],
  5: [23, 20], 6: [18, 22], 7: [12, 19],
  8: [26, 6], 9: [19, 5], 10: [23, 3], 11: [5, 14],
  12: [33, 13], 13: [27, 15], 14: [22, 14],
};
export function nodePos(order: number, i: number): [number, number] {
  return NODE_POS[order] ?? [6 + ((i * 7) % 32), 6 + ((i * 5) % 16)];
}

export interface Meridia extends GenMap { regionAt: (x: number, y: number) => FactionId | null }

/** The continent of Meridia: Glass Waste in the centre, the four nations around it, sea beyond. */
export function genMeridia(seed = 2241): Meridia {
  const W = MERIDIA_W, H = MERIDIA_H;
  const coastN = noise2(seed), mix = noise2(seed + 5), jit = noise2(seed + 9);
  const rnd = mulberry32(seed + 7);
  const cx = W / 2, cy = H / 2;
  const region: (FactionId | null)[][] = [];
  const grid: string[][] = [];
  for (let y = 0; y < H; y++) {
    const rr: (FactionId | null)[] = [];
    const row: string[] = [];
    for (let x = 0; x < W; x++) {
      const nx = (x + 0.5 - cx) / 19.5, ny = (y + 0.5 - cy) / 12;
      const d = Math.hypot(nx, ny);
      let coast = d + (coastN(x / 4, y / 4) - 0.5) * 0.5;
      // Saltglass Bay (south-east) and the Tidewell gulf (west).
      if (Math.hypot(x - 33.5, y - 22) < 3.2) coast = 2;
      if (Math.hypot(x - 2.5, y - 11) < 2.6) coast = 2;
      if (coast >= 0.98) { rr.push(null); row.push('~'); continue; }
      let a = (Math.atan2(ny, nx) * 180) / Math.PI + (jit(x / 5, y / 5) - 0.5) * 40;
      if (a < -180) a += 360;
      if (a > 180) a -= 360;
      const inner = d + (jit(x / 3 + 30, y / 3) - 0.5) * 0.18 < 0.38;
      const f: FactionId = inner ? 'choir' : a > -135 && a <= -45 ? 'kestrel' : a > -45 && a <= 45 ? 'helion' : a > 45 && a <= 135 ? 'verdant' : 'tidewell';
      rr.push(f);
      const m = mix(x / 3, y / 3);
      let c = '.';
      switch (f) {
        case 'choir': c = m > 0.72 ? '^' : 'g'; break;
        case 'kestrel': c = m > 0.45 ? '^' : m > 0.32 ? '.' : 'f'; break;
        case 'helion': c = m > 0.66 ? 'f' : m < 0.22 ? '^' : '.'; break;
        case 'verdant': c = m > 0.3 ? 'f' : '.'; break;
        case 'tidewell': c = m > 0.7 ? 'f' : '.'; break;
      }
      row.push(c);
    }
    region.push(rr);
    grid.push(row);
  }
  // Coastline: land next to open sea becomes shoal (mostly).
  const isSea = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || grid[y]![x] === '~';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y]![x] === '~') continue;
    if ((isSea(x - 1, y) || isSea(x + 1, y) || isSea(x, y - 1) || isSea(x, y + 1)) && rnd() < 0.75 && region[y]![x] !== 'choir') grid[y]![x] = 's';
  }
  // A river from the ridges to Saltglass Bay, and the old maglev from Calder to the coast.
  for (let x = 25; x <= 31; x++) { const y = Math.round(8 + (x - 25) * 1.7); if (grid[y]?.[x] && grid[y]![x] !== '~') grid[y]![x] = 'r'; }
  for (let x = 7; x <= 37; x++) {
    const y = 12;
    const c = grid[y]![x]!;
    if (c === '~') continue;
    if (region[y]![x] === 'choir') continue;
    grid[y]![x] = c === 'r' ? '#' : '=';
  }
  const owners = grid.map((r) => r.map(() => '.'));
  const put = (x: number, y: number, c: string, f: FactionId | null) => {
    if (!grid[y]?.[x] || grid[y]![x] === '~') return;
    grid[y]![x] = c;
    owners[y]![x] = f ? String(FACTIONS.indexOf(f)) : '.';
  };
  // Capitals (Command Spires) and their cities.
  put(36, 11, 'H', 'helion'); put(38, 10, 'C', 'helion'); put(35, 9, 'F', 'helion'); put(39, 13, 'A', 'helion'); put(34, 16, 'C', 'helion');
  put(6, 10, 'H', 'tidewell'); put(4, 8, 'C', 'tidewell'); put(5, 13, 'F', 'tidewell'); put(4, 16, 'D', 'tidewell'); put(8, 7, 'C', 'tidewell'); put(3, 18, 'C', 'tidewell');
  put(19, 23, 'H', 'verdant'); put(16, 21, 'C', 'verdant'); put(22, 24, 'C', 'verdant'); put(13, 22, 'F', 'verdant');
  put(23, 4, 'H', 'kestrel'); put(20, 3, 'C', 'kestrel'); put(27, 4, 'U', 'kestrel'); put(30, 6, 'A', 'kestrel');
  put(22, 14, 'H', 'choir'); put(20, 13, 'F', 'choir'); put(25, 15, 'F', 'choir');
  put(29, 11, 'U', null); put(14, 15, 'C', null); put(31, 20, 'D', null); put(10, 5, 'C', null);
  const regionAt = (x: number, y: number) => region[y]?.[x] ?? null;
  return { terrain: grid.map((r) => r.join('')), owners: owners.map((r) => r.join('')), units: [], factions: FACTIONS, regionAt };
}
