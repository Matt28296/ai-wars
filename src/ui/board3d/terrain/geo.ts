// Geometry assembly for the terrain kit. Props are built from three.js primitives (box, cylinder, cone, sphere, icosahedron) placed
// by matrix, given a baked vertex colour, and merged per "bucket" (one draw call each). Parts that take the owner's paint are
// remembered as vertex ranges, so a capture recolours a few hundred floats instead of rebuilding anything.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Euler, IcosahedronGeometry, Matrix4,
  PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** solid: lit props. glossy: dark shiny shards. windows: towers with the lit-window texture. glow: emissive rails, beacons, cracks. decal: sigils. */
export type Bucket = 'solid' | 'glossy' | 'windows' | 'glow' | 'decal';
export const BUCKETS: readonly Bucket[] = ['solid', 'glossy', 'windows', 'glow', 'decal'];
/** paint: the owner's colour. accent: the owner's bright trim (emissive in the glow bucket). ink: the sigil colour. */
export type Role = 'paint' | 'accent' | 'ink';

export interface PartRecord {
  tile: number;
  role: Role;
  bucket: Bucket;
  /** First vertex of the part inside its bucket's merged geometry, and how many. */
  start: number;
  count: number;
  /** HDR multiplier baked into the colour (glow parts). */
  mult: number;
  /** Decals only: the plane's own 0..1 UVs, so an owner change can re-point them into the atlas. */
  baseUv?: Float32Array;
}

export interface PartOpts {
  color: number;
  bucket?: Bucket;
  role?: Role;
  mult?: number;
  /** Rotation about Y (radians), applied inside the tile frame, before the frame rotation. */
  ry?: number;
  rx?: number;
  rz?: number;
  /** Turn the part inside out (reverse winding, negate normals): a bowl seen from inside, such as a dish. */
  inside?: boolean;
  /** Boxes in the windows bucket: window texture offset (in patches), so neighbouring towers do not repeat each other. */
  winOffset?: [number, number];
}

/**
 * Per-vertex attribute of every merged prop: x is 1 for a part that sinks when a unit stands on its property (the tall parts: towers,
 * stacks, cranes, masts, roofs and everything riding on them) and 0 for a part that stays (the pad, its owner band, the bay, the
 * banner, the landing disc); y is the height the sinking parts shrink toward, the top of the property's pad.
 */
export const SINK_ATTR = 'aSink';

/** One window-texture patch covers this many world units (the texture is 4 x 4 windows). */
export const WINDOW_PATCH = 0.5;
/** A UV that lands on a plain-wall texel of the window texture. */
export const WALL_UV = 0.5 / 32;

const col = new Color();
const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpP = new Vector3();
const tmpS = new Vector3();

let unitBox: BufferGeometry | null = null;
let unitIco: BufferGeometry | null = null;
const getUnitBox = (): BufferGeometry => (unitBox ??= new BoxGeometry(1, 1, 1).toNonIndexed());
const getUnitIco = (): BufferGeometry => (unitIco ??= new IcosahedronGeometry(1, 0));

function turnInsideOut(g: BufferGeometry): void {
  const pos = g.getAttribute('position') as BufferAttribute;
  const nrm = g.getAttribute('normal') as BufferAttribute;
  const uv = g.getAttribute('uv') as BufferAttribute | undefined;
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of [pos, nrm, ...(uv ? [uv] : [])]) {
      const x = a.getX(i + 1); const y = a.getY(i + 1);
      if (a.itemSize === 3) {
        const z = a.getZ(i + 1);
        a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
        a.setXYZ(i + 2, x, y, z);
      } else {
        a.setXY(i + 1, a.getX(i + 2), a.getY(i + 2));
        a.setXY(i + 2, x, y);
      }
    }
  }
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
}

interface Chunk { geos: BufferGeometry[]; verts: number }

export class PartSet {
  private chunks: Record<Bucket, Chunk> = {
    solid: { geos: [], verts: 0 }, glossy: { geos: [], verts: 0 }, windows: { geos: [], verts: 0 }, glow: { geos: [], verts: 0 }, decal: { geos: [], verts: 0 },
  };
  readonly records: PartRecord[] = [];
  private ox = 0;
  private oz = 0;
  private tile = -1;
  private rot = 0;
  /** Pad-top height the following parts sink toward when their property is occupied, or null for parts that stay put. */
  private sinkBase: number | null = null;

  /** Start placing parts for a tile: local coordinates are tile-local (0..1 across, y up in world units). */
  begin(tile: number, x: number, y: number): this {
    this.tile = tile;
    this.ox = x;
    this.oz = y;
    this.rot = 0;
    this.sinkBase = null;
    return this;
  }

  /**
   * Mark every following part as one that sinks toward `base` (the top of the pad) while a unit stands on the property, or, with null,
   * as one that stays. A property model turns this on after `begin` and wraps its pad, bay, banner and landing disc in `fixed`.
   */
  sinking(base: number | null): this {
    this.sinkBase = base;
    return this;
  }

  /** Run `place` with sinking off (parts that stay), then restore what was set before. */
  fixed(place: () => void): void {
    const was = this.sinkBase;
    this.sinkBase = null;
    place();
    this.sinkBase = was;
  }

  /** Rotate every following part about the tile centre by `r` quarter-turns clockwise (seen from above). */
  frame(r: number): this {
    this.rot = ((r % 4) + 4) % 4;
    return this;
  }

  /** Where a tile-local point lands in the world, after the frame rotation. */
  private place(lx: number, lz: number): [number, number] {
    let x = lx - 0.5;
    let z = lz - 0.5;
    for (let i = 0; i < this.rot; i++) { const nx = -z; z = x; x = nx; }
    return [this.ox + 0.5 + x, this.oz + 0.5 + z];
  }

  add(src: BufferGeometry, lx: number, ly: number, lz: number, scale: [number, number, number], o: PartOpts): void {
    const g = src.index ? src.toNonIndexed() : src.clone();
    const [wx, wz] = this.place(lx, lz);
    tmpE.set(o.rx ?? 0, (o.ry ?? 0) - (this.rot * Math.PI) / 2, o.rz ?? 0, 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpP.set(wx, ly, wz);
    tmpS.set(scale[0], scale[1], scale[2]);
    tmpM.compose(tmpP, tmpQ, tmpS);
    g.applyMatrix4(tmpM);
    if (o.inside) turnInsideOut(g);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    const n = g.getAttribute('position').count;
    if (!g.getAttribute('uv')) g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2).fill(WALL_UV), 2));
    const bucket = o.bucket ?? 'solid';
    const mult = o.mult ?? 1;
    col.setHex(o.color);
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r * mult; c[i * 3 + 1] = col.g * mult; c[i * 3 + 2] = col.b * mult; }
    g.setAttribute('color', new BufferAttribute(c, 3));
    const sk = new Float32Array(n * 2);
    if (this.sinkBase !== null) for (let i = 0; i < n; i++) { sk[i * 2] = 1; sk[i * 2 + 1] = this.sinkBase; }
    g.setAttribute(SINK_ATTR, new BufferAttribute(sk, 2));
    const chunk = this.chunks[bucket];
    if (o.role) {
      const rec: PartRecord = { tile: this.tile, role: o.role, bucket, start: chunk.verts, count: n, mult };
      if (bucket === 'decal') rec.baseUv = new Float32Array((g.getAttribute('uv') as BufferAttribute).array);
      this.records.push(rec);
    }
    chunk.geos.push(g);
    chunk.verts += n;
  }

  /** A box centred at (lx, ly, lz) of size (sx, sy, sz). */
  box(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, o: PartOpts): void {
    const g = getUnitBox().clone();
    const uv = g.getAttribute('uv') as BufferAttribute;
    const win = (o.bucket ?? 'solid') === 'windows';
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z; six vertices per face once non-indexed.
    const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    const off = o.winOffset ?? [0, 0];
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 6; k++) {
        const i = f * 6 + k;
        if (win && (f === 2 || f === 3)) uv.setXY(i, WALL_UV, WALL_UV);
        else if (win) uv.setXY(i, (uv.getX(i) * dims[f][0]) / WINDOW_PATCH + off[0], (uv.getY(i) * dims[f][1]) / WINDOW_PATCH + off[1]);
        else uv.setXY(i, WALL_UV, WALL_UV);
      }
    }
    this.add(g, lx, ly, lz, [sx, sy, sz], o);
    g.dispose();
  }

  /** A cylinder (or truncated cone) centred at (lx, ly, lz). */
  cyl(lx: number, ly: number, lz: number, rTop: number, rBottom: number, h: number, seg: number, o: PartOpts): void {
    const g = new CylinderGeometry(rTop, rBottom, h, seg, 1);
    this.add(g, lx, ly, lz, [1, 1, 1], o);
    g.dispose();
  }

  /** A cone centred at (lx, ly, lz). */
  cone(lx: number, ly: number, lz: number, r: number, h: number, seg: number, o: PartOpts): void {
    const g = new ConeGeometry(r, h, seg, 1);
    this.add(g, lx, ly, lz, [1, 1, 1], o);
    g.dispose();
  }

  sphere(
    lx: number, ly: number, lz: number, rx: number, ry: number, rz: number, wSeg: number, hSeg: number, o: PartOpts,
    thetaStart = 0, thetaLen = Math.PI,
  ): void {
    const g = new SphereGeometry(1, wSeg, hSeg, 0, Math.PI * 2, thetaStart, thetaLen);
    this.add(g, lx, ly, lz, [rx, ry, rz], o);
    g.dispose();
  }

  /** A flat-shaded icosahedron (20 faces): boulders, pebbles, canopy blobs. */
  ico(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, o: PartOpts): void {
    this.add(getUnitIco(), lx, ly, lz, [sx, sy, sz], o);
  }

  /** A sigil decal: a unit plane facing up or toward the camera (south), with a role so an owner change can re-point it. */
  decal(lx: number, ly: number, lz: number, w: number, h: number, facing: 'up' | 'south', o: PartOpts): void {
    const g = new PlaneGeometry(1, 1);
    // A sigil always reads upright from the camera, whatever the frame rotation did to the building around it.
    this.add(g, lx, ly, lz, [w, h, 1], { ...o, bucket: 'decal', role: 'ink', rx: facing === 'up' ? -Math.PI / 2 : 0, ry: (this.rot * Math.PI) / 2 });
    g.dispose();
  }

  /** Merge each bucket into one geometry (null when empty). The temporaries are disposed. */
  finish(): Record<Bucket, BufferGeometry | null> {
    const out = {} as Record<Bucket, BufferGeometry | null>;
    for (const b of BUCKETS) {
      const { geos } = this.chunks[b];
      out[b] = geos.length ? mergeGeometries(geos, false) : null;
      for (const g of geos) g.dispose();
      geos.length = 0;
    }
    return out;
  }
}
