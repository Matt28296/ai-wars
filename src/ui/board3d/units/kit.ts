// Procedural modelling kit for the unit miniatures (D-018). Every model is built from primitives and convex hulls, then merged
// per paint slot, so one unit costs a handful of meshes and its geometry can be shared by every instance of the same look.
// Model space: origin at the feet, +X forward (heading 0), +Y up, +Z to the right of the unit.
import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Euler, Matrix4, Quaternion, RingGeometry, Shape, ShapeGeometry, SphereGeometry, Vector2, Vector3,
} from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Paint slots: faction paint, dark gunmetal, emissive trim, canopy glass and the see-through rotor blur. */
export type Slot = 'paint' | 'dark' | 'trim' | 'glass' | 'blur';
export const SLOTS: readonly Slot[] = ['paint', 'dark', 'trim', 'glass', 'blur'];
export type V3 = readonly [number, number, number];
export type P2 = readonly [number, number];
export type SlotGeometry = Partial<Record<Slot, BufferGeometry>>;

const ZERO: V3 = [0, 0, 0];
const ONE: V3 = [1, 1, 1];
const Y_AXIS = new Vector3(0, 1, 0);

function matrix(pos: V3, rot: V3, scale: V3): Matrix4 {
  return new Matrix4().compose(new Vector3(pos[0], pos[1], pos[2]), new Quaternion().setFromEuler(new Euler(rot[0], rot[1], rot[2])), new Vector3(scale[0], scale[1], scale[2]));
}

/** The 24 points of a box whose twelve edges are cut back by `c` (a cheap bevelled hull: 44 triangles). */
export function chamferPoints(size: V3, c: number): V3[] {
  const [w, h, d] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const out: V3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.push([sx * (w - c), sy * (h - c), sz * d], [sx * (w - c), sy * h, sz * (d - c)], [sx * w, sy * (h - c), sz * (d - c)]);
      }
    }
  }
  return out;
}

/** The 8 corners of a frustum: bottom rectangle (w0 x d0) and top rectangle (w1 x d1) shifted forward by `dx`, height h, centred on y = 0. */
export function taperPoints(w0: number, d0: number, w1: number, d1: number, h: number, dx = 0): V3[] {
  const out: V3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push([sx * w0 / 2, -h / 2, sz * d0 / 2], [dx + sx * w1 / 2, h / 2, sz * d1 / 2]);
  return out;
}

export class Kit {
  private readonly parts: Record<Slot, BufferGeometry[]> = { paint: [], dark: [], trim: [], glass: [], blur: [] };

  /** Add any geometry under a transform. The source geometry is consumed (disposed). */
  add(slot: Slot, g: BufferGeometry, pos: V3 = ZERO, rot: V3 = ZERO, scale: V3 = ONE): this {
    return this.addMatrix(slot, g, matrix(pos, rot, scale));
  }

  addMatrix(slot: Slot, g: BufferGeometry, m: Matrix4): this {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    for (const name of Object.keys(flat.attributes)) if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
    if (!flat.getAttribute('normal')) flat.computeVertexNormals();
    flat.applyMatrix4(m);
    this.parts[slot].push(flat);
    return this;
  }

  /** Merge another kit (built in its own local frame) into this one under a transform. The other kit is consumed. */
  addKit(sub: Kit, pos: V3 = ZERO, rot: V3 = ZERO, scale: V3 = ONE): this {
    const m = matrix(pos, rot, scale);
    for (const slot of SLOTS) {
      for (const g of sub.parts[slot]) this.addMatrix(slot, g, m);
      sub.parts[slot] = [];
    }
    return this;
  }

  box(slot: Slot, size: V3, pos: V3, rot: V3 = ZERO): this {
    return this.add(slot, new BoxGeometry(size[0], size[1], size[2]), pos, rot);
  }

  /** The convex hull of a point cloud (wedges, frustums, swept plates, hulls). */
  hull(slot: Slot, pts: readonly V3[], pos: V3 = ZERO, rot: V3 = ZERO): this {
    return this.add(slot, new ConvexGeometry(pts.map((p) => new Vector3(p[0], p[1], p[2]))), pos, rot);
  }

  chamfer(slot: Slot, size: V3, c: number, pos: V3, rot: V3 = ZERO): this {
    return this.hull(slot, chamferPoints(size, c), pos, rot);
  }

  /** A cylinder whose axis is Y. */
  cyl(slot: Slot, rTop: number, rBot: number, h: number, seg: number, pos: V3, rot: V3 = ZERO): this {
    return this.add(slot, new CylinderGeometry(rTop, rBot, h, seg, 1), pos, rot);
  }

  /** A cylinder whose axis is Z (a wheel seen from the side). */
  wheel(slot: Slot, r: number, width: number, seg: number, pos: V3): this {
    return this.add(slot, new CylinderGeometry(r, r, width, seg, 1), pos, [Math.PI / 2, 0, 0]);
  }

  /** A barrel along +X from x0 (radius r0) to x1 (radius r1) at height y, offset z. */
  barrel(slot: Slot, r0: number, r1: number, x0: number, x1: number, y: number, z: number, seg = 6): this {
    return this.add(slot, new CylinderGeometry(r1, r0, x1 - x0, seg, 1), [(x0 + x1) / 2, y, z], [0, 0, -Math.PI / 2]);
  }

  /** An ellipsoid with the given radii. */
  sphere(slot: Slot, radii: V3, pos: V3, wSeg = 6, hSeg = 4, rot: V3 = ZERO): this {
    return this.add(slot, new SphereGeometry(1, wSeg, hSeg), pos, rot, radii);
  }

  /** A short cylinder along X, centred at (x, y, z) (muzzle collars, coils, thrusters). */
  axial(slot: Slot, r: number, len: number, seg: number, pos: V3): this {
    return this.add(slot, new CylinderGeometry(r, r, len, seg, 1), pos, [0, 0, -Math.PI / 2]);
  }

  /** A cone pointing +X (its base at x - h/2, its tip at x + h/2). */
  cone(slot: Slot, r: number, h: number, seg: number, pos: V3): this {
    return this.add(slot, new ConeGeometry(r, h, seg, 1), pos, [0, 0, -Math.PI / 2]);
  }

  /** A tapered cylinder between two points, `rA` at `a` and `rB` at `b` (legs, arms, struts, rotor arms). Open at the ends: joints cover them. */
  limb(slot: Slot, a: V3, b: V3, rA: number, rB: number, seg = 6, closed = false): this {
    const dir = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    const q = new Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize());
    const m = new Matrix4().compose(new Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new Vector3(1, 1, 1));
    return this.addMatrix(slot, new CylinderGeometry(rB, rA, len, seg, 1, !closed), m);
  }

  /** A single-sided, up-facing polygon in the XZ plane at height y (decals, stripes). Outline is (x, z); holes likewise. */
  flat(slot: Slot, outline: readonly P2[], y: number, holes: readonly (readonly P2[])[] = [], pos: V3 = ZERO, scale: number | P2 = 1): this {
    const [sx, sz] = typeof scale === 'number' ? [scale, scale] : scale;
    const pts = (list: readonly P2[]) => list.map((p) => new Vector2(p[0] * sx, -p[1] * sz));
    const shape = new Shape(pts(outline));
    shape.holes = holes.map((h) => new Shape(pts(h)));
    return this.add(slot, new ShapeGeometry(shape), [pos[0], pos[1] + y, pos[2]], [-Math.PI / 2, 0, 0]);
  }

  /** A flat strip between two plan points, `width` wide, at height y. */
  line(slot: Slot, a: P2, b: P2, width: number, y: number): this {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    return this.flat(slot, [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], y);
  }

  /** A flat, up-facing ring in the XZ plane. */
  ring(slot: Slot, rIn: number, rOut: number, seg: number, pos: V3): this {
    return this.add(slot, new RingGeometry(rIn, rOut, seg), pos, [-Math.PI / 2, 0, 0]);
  }

  /** Merge each slot's pieces into one geometry. The kit is empty afterwards. */
  build(): SlotGeometry {
    const out: SlotGeometry = {};
    for (const slot of SLOTS) {
      const list = this.parts[slot];
      if (list.length === 0) continue;
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!g) throw new Error(`unit kit: cannot merge the ${slot} pieces (attribute mismatch)`);
      if (list.length > 1) for (const p of list) p.dispose();
      g.computeBoundingBox();
      g.computeBoundingSphere();
      out[slot] = g;
      this.parts[slot] = [];
    }
    return out;
  }
}

/** Triangles in a geometry (non-indexed or indexed). */
export function triangleCount(g: BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}
