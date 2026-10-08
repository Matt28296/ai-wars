// The ground: one merged mesh of bevelled tiles. Every tile is a slab whose top follows `surfaceY` (flat, a faceted ridge plateau, a
// shoal dipping into the sea, a river channel carved between banks), with a 45-degree chamfer around the top, so tiles read as separate
// pieces of a table-top diorama, and side walls wherever a neighbour is lower (down to the board's underside at the rim).
// Colour is baked into vertices: a two-octave noise on the grass, strata on the rock, a soft darkening toward every tile edge.
import { BufferAttribute, BufferGeometry, Color } from 'three';
import { TERRAIN_COLOR } from '../palette';
import { fbm, hash2, smoothstep } from './rng';
import { glassGlow } from './flora';
import { BASE_Y, CHANNEL_HALF, DX, DY, channelDist, surfaceY, type Board, type Dir, type TileInfo } from './layout';

export const BEVEL = 0.035;
/** Wall bottoms dip this far below a lower neighbour's chamfer so no hairline gap can show between them. */
const SKIRT = 0.012;

const fam = (t: keyof typeof TERRAIN_COLOR) => ({ base: new Color(TERRAIN_COLOR[t].base), detail: new Color(TERRAIN_COLOR[t].detail) });
const GRASS = fam('flats');
const FOREST = fam('canopy');
const ROCK = fam('ridge');
const SAND = fam('shoal');
const TRACK = fam('maglev');
const GLASS = fam('glass');
const STRUCT = fam('structure');
const SEA = fam('sea');
const MUD = new Color(0x6a6a4e);
const WET_SAND = new Color(0x8fa88a);
const SHALLOW = new Color(0x6fc3bd);
const SOIL_TOP = new Color(0x6b5a45);
const SOIL_BOT = new Color(0x2b241b);
const SAND_LIGHT = new Color(0xe3d3a4);
const TRACK_DARK = new Color(0x444c57);
const CRACK = new Color(0x59656e);
const EMBER = new Color(0xc2606c);
const RIVER_BED = new Color(0x2c4a5a);
const SEA_BED = new Color(SEA.base).multiplyScalar(0.7);

const WALL_DARK = { sea: new Color(0x0e1a24), shoal: new Color(0x40382b), glass: new Color(0x1d2429), maglev: new Color(0x1d2127) };

interface Vtx { x: number; y: number; z: number; c: Color }

/** Number of cells across the top of a tile: enough for the colour noise and the shape, no more. */
function gridN(t: TileInfo): number {
  if (t.terrain === 'river' || t.terrain === 'span') return t.water && !t.water.wide ? 8 : 1;
  switch (t.terrain) {
    case 'sea': return 1;
    case 'ridge': return 4;
    case 'shoal': return 4;
    case 'flats': case 'canopy': return 3;
    case 'glass': return 6;
    default: return 2;
  }
}

function topColor(t: TileInfo, u: number, v: number, out: Color): Color {
  const wx = t.x + u;
  const wz = t.y + v;
  const n = fbm(wx * 2.2, wz * 2.2, 3);
  const fine = fbm(wx * 7.1, wz * 7.1, 5);
  let bright = 0.93 + 0.14 * fine;
  switch (t.terrain) {
    case 'flats':
      out.copy(GRASS.base).lerp(GRASS.detail, smoothstep(0.25, 0.8, n));
      break;
    case 'canopy':
      out.copy(FOREST.base).lerp(FOREST.detail, smoothstep(0.35, 0.9, n) * 0.55);
      bright *= 0.82 + 0.35 * smoothstep(0.5, 0.9, fbm(wx * 5.3, wz * 5.3, 11)); // dark leaf litter, lighter dapples
      break;
    case 'ridge': {
      const top = smoothstep(0.1, 0.45, 0.5 - Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 0.9);
      out.copy(ROCK.base).lerp(ROCK.detail, 0.25 + 0.55 * n * (0.4 + 0.6 * top));
      bright *= 0.95 + 0.1 * hash2(Math.round(wx * 6), Math.round(wz * 6), 12);
      break;
    }
    case 'shoal': {
      out.copy(SAND.base).lerp(SAND_LIGHT, 0.4 * n);
      const wet = smoothstep(-0.052, -0.11, surfaceY(t, u, v));
      out.lerp(SHALLOW, wet * 0.55);
      break;
    }
    case 'maglev':
      out.copy(TRACK.base).lerp(TRACK_DARK, 0.35 + 0.3 * n);
      break;
    case 'glass': {
      const crack = smoothstep(0.42, 0.5, Math.abs(fbm(wx * 4.2, wz * 4.2, 17) - 0.5) + 0.42);
      out.copy(GLASS.base).lerp(GLASS.detail, 0.4 * n).lerp(CRACK, 0.45 * (1 - crack) + 0.15).lerp(EMBER, 0.55 * glassGlow(t, u, v));
      break;
    }
    case 'sea':
      out.copy(SEA_BED);
      break;
    case 'river':
    case 'span': {
      if (t.water && !t.water.wide) {
        const d = channelDist(t.water.mask, u, v);
        out.copy(GRASS.base).lerp(GRASS.detail, smoothstep(0.25, 0.8, n));
        out.lerp(MUD, smoothstep(CHANNEL_HALF + 0.16, CHANNEL_HALF + 0.04, d));
        out.lerp(WET_SAND, smoothstep(CHANNEL_HALF + 0.12, CHANNEL_HALF + 0.02, d) * 0.4);
        out.lerp(RIVER_BED, smoothstep(CHANNEL_HALF + 0.02, CHANNEL_HALF - 0.12, d));
        if (t.terrain === 'span') out.multiplyScalar(0.85);
      } else {
        out.copy(SEA_BED);
      }
      break;
    }
    default: // properties: paved ground
      out.copy(STRUCT.detail).lerp(STRUCT.base, 0.2 + 0.25 * n).multiplyScalar(0.92);
      break;
  }
  if ((t.x + t.y) & 1) bright *= 0.972; // faint chequer so the grid reads at a glance
  const edge = Math.min(u, 1 - u, v, 1 - v);
  bright *= 1 - 0.2 * (1 - smoothstep(0, 0.2, edge)); // baked occlusion toward the tile edge
  return out.multiplyScalar(bright);
}

function wallColor(t: TileInfo, wx: number, wz: number, y: number, depthFrac: number, out: Color): Color {
  switch (t.terrain) {
    case 'ridge': {
      // Strata: bands of lighter and darker rock that wobble with position.
      const band = 0.5 + 0.5 * Math.sin(y * 42 + wx * 5.1 + wz * 3.7 + fbm(wx * 3, wz * 3, 21) * 6);
      out.copy(ROCK.base).multiplyScalar(0.62).lerp(ROCK.detail, 0.18 + 0.3 * band).multiplyScalar(1 - 0.45 * depthFrac);
      return out;
    }
    case 'sea': case 'river': case 'span':
      out.set(0x1f3445).lerp(WALL_DARK.sea, depthFrac);
      return out;
    case 'shoal':
      out.set(0xa8996f).lerp(WALL_DARK.shoal, depthFrac);
      return out;
    case 'glass':
      out.set(0x56666d).lerp(WALL_DARK.glass, depthFrac);
      return out;
    case 'maglev':
      out.set(0x4b525c).lerp(WALL_DARK.maglev, depthFrac);
      return out;
    default:
      out.copy(SOIL_TOP).lerp(SOIL_BOT, depthFrac).multiplyScalar(0.92 + 0.16 * hash2(Math.round(wx * 10), Math.round(wz * 10), 31));
      return out;
  }
}

class Soup {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  tris = 0;
  vert(v: Vtx, nx: number, ny: number, nz: number): void {
    this.pos.push(v.x, v.y, v.z);
    this.nrm.push(nx, ny, nz);
    this.col.push(v.c.r, v.c.g, v.c.b);
  }
  /** A triangle with a flat normal. The winding is flipped if needed so the face looks along `hint`. */
  flat(a: Vtx, b: Vtx, c: Vtx, hx: number, hy: number, hz: number): void {
    const ux = b.x - a.x; const uy = b.y - a.y; const uz = b.z - a.z;
    const vx = c.x - a.x; const vy = c.y - a.y; const vz = c.z - a.z;
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    if (nx * hx + ny * hy + nz * hz < 0) { this.flat(a, c, b, hx, hy, hz); return; }
    this.vert(a, nx, ny, nz); this.vert(b, nx, ny, nz); this.vert(c, nx, ny, nz);
    this.tris++;
  }
  /** A triangle with the given vertex normals; flipped if it faces down (the geometric normal's Y is the winding test). */
  smooth(a: Vtx, na: number[], b: Vtx, nb: number[], c: Vtx, nc: number[]): void {
    const ux = b.x - a.x; const uz = b.z - a.z;
    const vx = c.x - a.x; const vz = c.z - a.z;
    const gy = uz * vx - ux * vz;
    if (Math.abs(gy) < 1e-12) return;
    if (gy < 0) { this.smooth(a, na, c, nc, b, nb); return; }
    this.vert(a, na[0], na[1], na[2]); this.vert(b, nb[0], nb[1], nb[2]); this.vert(c, nc[0], nc[1], nc[2]);
    this.tris++;
  }
}

export interface GroundBuild { geometry: BufferGeometry; triangles: number }

export function buildGround(board: Board): GroundBuild {
  const soup = new Soup();
  const tmp = new Color();
  const eps = 0.01;

  for (const t of board.tiles) {
    const n = gridN(t);
    const flatTop = t.terrain === 'ridge';
    const inset = (i: number): number => BEVEL + ((1 - 2 * BEVEL) * i) / n;

    // Top grid.
    const P: Vtx[] = [];
    const N: number[][] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const u = inset(i);
        const v = inset(j);
        const y = surfaceY(t, u, v);
        P.push({ x: t.x + u, y, z: t.y + v, c: topColor(t, u, v, new Color()) });
        const gx = (surfaceY(t, u + eps, v) - surfaceY(t, u - eps, v)) / (2 * eps);
        const gz = (surfaceY(t, u, v + eps) - surfaceY(t, u, v - eps)) / (2 * eps);
        const l = Math.hypot(gx, 1, gz);
        N.push([-gx / l, 1 / l, -gz / l]);
      }
    }
    const idx = (i: number, j: number): number => j * (n + 1) + i;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const A = idx(i, j); const B = idx(i + 1, j); const C = idx(i + 1, j + 1); const D = idx(i, j + 1);
        if (flatTop) {
          // Faceted: alternate the diagonal so the rock does not read as a regular lattice.
          if ((i + j + t.x + t.y) & 1) { soup.flat(P[A], P[D], P[C], 0, 1, 0); soup.flat(P[A], P[C], P[B], 0, 1, 0); }
          else { soup.flat(P[A], P[D], P[B], 0, 1, 0); soup.flat(P[B], P[D], P[C], 0, 1, 0); }
        } else {
          soup.smooth(P[A], N[A], P[D], N[D], P[C], N[C]);
          soup.smooth(P[A], N[A], P[C], N[C], P[B], N[B]);
        }
      }
    }

    // Perimeter of the top grid, clockwise from the north-west corner, and the matching points on the tile's outline one bevel lower.
    const ring: [number, number][] = [];
    for (let i = 0; i < n; i++) ring.push([i, 0]);
    for (let j = 0; j < n; j++) ring.push([n, j]);
    for (let i = n; i > 0; i--) ring.push([i, n]);
    for (let j = n; j > 0; j--) ring.push([0, j]);
    const outer: Vtx[] = ring.map(([i, j]) => {
      const p = P[idx(i, j)];
      const ox = i === 0 ? 0 : i === n ? 1 : p.x - t.x;
      const oz = j === 0 ? 0 : j === n ? 1 : p.z - t.y;
      const c = tmp.copy(p.c).multiplyScalar(0.78);
      return { x: t.x + ox, y: p.y - BEVEL, z: t.y + oz, c: new Color().copy(c) };
    });
    for (let k = 0; k < ring.length; k++) {
      const k2 = (k + 1) % ring.length;
      const [ai, aj] = ring[k];
      const a = P[idx(ai, aj)];
      const b = P[idx(ring[k2][0], ring[k2][1])];
      const hx = (outer[k].x + outer[k2].x) / 2 - (a.x + b.x) / 2;
      const hz = (outer[k].z + outer[k2].z) / 2 - (a.z + b.z) / 2;
      soup.flat(a, outer[k], outer[k2], hx, 1, hz);
      soup.flat(a, outer[k2], b, hx, 1, hz);
    }

    // Walls on each side where the neighbour is lower (or the board ends).
    for (const d of ['N', 'E', 'S', 'W'] as Dir[]) {
      const nb = board.maybe(t.x + DX[d], t.y + DY[d]);
      const samples: { q: Vtx; floor: number }[] = [];
      for (let s = 0; s <= n; s++) {
        let i: number; let j: number;
        if (d === 'N') { i = s; j = 0; } else if (d === 'S') { i = s; j = n; } else if (d === 'E') { i = n; j = s; } else { i = 0; j = s; }
        const p = P[idx(i, j)];
        const u = p.x - t.x;
        const v = p.z - t.y;
        const q: Vtx = {
          x: t.x + (d === 'E' ? 1 : d === 'W' ? 0 : u),
          y: p.y - BEVEL,
          z: t.y + (d === 'S' ? 1 : d === 'N' ? 0 : v),
          c: new Color().copy(p.c).multiplyScalar(0.78),
        };
        let floor = BASE_Y;
        if (nb) {
          const nu = d === 'E' ? BEVEL : d === 'W' ? 1 - BEVEL : u;
          const nv = d === 'S' ? BEVEL : d === 'N' ? 1 - BEVEL : v;
          floor = Math.max(BASE_Y, surfaceY(nb, nu, nv) - BEVEL - SKIRT);
        }
        samples.push({ q, floor });
      }
      const hx = DX[d]; const hz = DY[d];
      for (let s = 0; s < n; s++) {
        const a = samples[s]; const b = samples[s + 1];
        if (a.q.y <= a.floor + 1e-4 && b.q.y <= b.floor + 1e-4) continue;
        const wall = (sm: { q: Vtx; floor: number }, top: boolean): Vtx => {
          const y = top ? sm.q.y : Math.min(sm.floor, sm.q.y);
          const frac = Math.min(1, Math.max(0, (sm.q.y - y) / Math.max(0.05, sm.q.y - BASE_Y)));
          const c = wallColor(t, sm.q.x, sm.q.z, y, top ? 0 : 0.15 + 0.85 * frac, new Color());
          return { x: sm.q.x, y, z: sm.q.z, c };
        };
        const at = wall(a, true); const bt = wall(b, true); const ab = wall(a, false); const bb = wall(b, false);
        soup.flat(at, ab, bb, hx, 0, hz);
        soup.flat(at, bb, bt, hx, 0, hz);
      }
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(soup.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(soup.nrm), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(soup.col), 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { geometry: g, triangles: soup.tris };
}
