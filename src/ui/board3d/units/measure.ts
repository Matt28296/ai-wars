// Measurements over a unit view, for the tests and the gallery: triangles, footprint, silhouette, squad size, saturation.
// They read the scene graph the way a renderer would (visible meshes, world matrices, the skeleton's current pose), never the recipes.
import { Box3, Color, Matrix4, Mesh, SkinnedMesh, Vector3 } from 'three';
import type { BufferGeometry, Material, MeshStandardMaterial, Object3D } from 'three';
import type { UnitView } from '../contract';

/** The miniature itself (without chips or the focus ring). */
export function modelOf(view: UnitView): Object3D {
  const m = view.object.getObjectByName('model');
  if (!m) throw new Error(`unit ${view.type} has no model group`);
  return m;
}

/** Triangles of every visible mesh under `root`. */
export function visibleTriangles(root: Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if (o instanceof Mesh) {
      const g = o.geometry;
      n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
  });
  return n;
}

/** Draw calls the unit costs: visible meshes plus visible chip sprites. */
export function visibleDrawCalls(view: UnitView): number {
  let n = 0;
  view.object.traverseVisible((o) => {
    if (o instanceof Mesh || (o as { isSprite?: boolean }).isSprite) n += 1;
  });
  return n;
}

const mm = new Matrix4();

/**
 * Where every vertex of a mesh is in world space right now, packed x, y, z. A skinned mesh is read through its bones (each bone's current
 * matrix against its bind matrix, once per call, not once per vertex), so a spinning rotor, a stepping leg and a recoiling gun are where
 * the renderer puts them. `only` keeps the vertices skinned to that bone (the others stay NaN).
 */
export function worldPositions(mesh: Mesh, only?: number): Float32Array {
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  const v = new Vector3();
  if (!(mesh instanceof SkinnedMesh)) {
    for (let i = 0; i < pos.count; i += 1) v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).toArray(out, i * 3);
    return out;
  }
  const { skeleton, bindMatrix, bindMatrixInverse } = mesh;
  // world = mesh * bindInverse * (bone * boneInverse) * bind, applied to the vertex
  const bones = skeleton.bones.map((bone, i) => {
    mm.multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[i]);
    return new Matrix4().copy(mesh.matrixWorld).multiply(bindMatrixInverse).multiply(mm).multiply(bindMatrix);
  });
  const index = mesh.geometry.getAttribute('skinIndex');
  const weight = mesh.geometry.getAttribute('skinWeight');
  const acc = new Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    acc.set(0, 0, 0);
    let skip = only !== undefined;
    for (let k = 0; k < 4; k += 1) {
      const w = weight.getComponent(i, k);
      if (w === 0) continue;
      const bone = index.getComponent(i, k);
      if (only === bone) skip = false;
      acc.addScaledVector(v.fromBufferAttribute(pos, i).applyMatrix4(bones[bone]), w);
    }
    if (skip) acc.set(NaN, NaN, NaN);
    acc.toArray(out, i * 3);
  }
  return out;
}

/** The exact box of the miniature in world space (vertex-precise, so a spinning rotor does not inflate it). */
export function footprint(view: UnitView): Box3 {
  view.object.updateMatrixWorld(true);
  const box = new Box3();
  const v = new Vector3();
  modelOf(view).traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const p = worldPositions(o);
    for (let i = 0; i < p.length; i += 3) box.expandByPoint(v.set(p[i], p[i + 1], p[i + 2]));
  });
  return box;
}

/** The box of the vertices skinned to one bone (a weapon, a rotor, a leg), in world space right now. Empty if nothing is skinned to it. */
export function boneFootprint(bone: Object3D): Box3 {
  let root: Object3D = bone;
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
  const box = new Box3();
  const v = new Vector3();
  root.traverse((o) => {
    if (!(o instanceof SkinnedMesh)) return;
    const at = o.skeleton.bones.indexOf(bone as never);
    if (at < 0) return;
    const p = worldPositions(o, at);
    for (let i = 0; i < p.length; i += 3) if (!Number.isNaN(p[i])) box.expandByPoint(v.set(p[i], p[i + 1], p[i + 2]));
  });
  return box;
}

/** The skinned meshes of a view (the miniature: one, or one per squad figure). */
export function skinMeshes(view: UnitView): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  modelOf(view).traverse((o) => { if (o instanceof SkinnedMesh) out.push(o); });
  return out;
}

/** The material a view's miniature is painted with right now. */
export function paintMaterial(view: UnitView): MeshStandardMaterial {
  const [first] = skinMeshes(view);
  if (!first) throw new Error(`unit ${view.type} has no skinned mesh`);
  return first.material as MeshStandardMaterial;
}

/** One vertex attribute of a view's first skinned mesh, as rows of numbers. */
export function vertexRows(geometry: BufferGeometry, name: string): number[][] {
  const a = geometry.getAttribute(name);
  const rows: number[][] = [];
  for (let i = 0; i < a.count; i += 1) rows.push(Array.from({ length: a.itemSize }, (_, k) => a.getComponent(i, k)));
  return rows;
}

/** True when the box fits a tile footprint: at most `limit` wide in X and Z, and centred in the tile within `slack`. */
export function fitsTile(box: Box3, limit = 0.8, slack = 0.1): boolean {
  const size = box.getSize(new Vector3());
  const c = box.getCenter(new Vector3());
  return size.x <= limit && size.z <= limit && Math.abs(c.x) <= slack && Math.abs(c.z) <= slack;
}

/** How many squad figures show. */
export function visibleFigures(view: UnitView): number {
  return modelOf(view).children.filter((c) => c.name.startsWith('figure') && c.visible).length;
}

/** HSL saturation of a colour (0..1), in sRGB. */
export function saturation(c: Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.s;
}

export function lightness(c: Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.l;
}

export const GRID = 16;

/** A coarse occupancy bitmap of the model seen from above (x, z) and from the side (x, y): GRID x GRID cells each, 0.8 tile square. */
export function silhouette(view: UnitView): { plan: Uint8Array; side: Uint8Array } {
  view.object.updateMatrixWorld(true);
  const plan = new Uint8Array(GRID * GRID);
  const side = new Uint8Array(GRID * GRID);
  const span = 0.84;
  const p = new Vector3();
  const cell = (v: number, lo: number) => Math.min(GRID - 1, Math.max(0, Math.floor(((v - lo) / span) * GRID)));
  modelOf(view).traverseVisible((o) => {
    if (!(o instanceof Mesh) || o.userData.slot === 'blur') return;
    const w = worldPositions(o);
    const index = o.geometry.index;
    const count = (index ? index.count : w.length / 3) / 3;
    const at = (t: number, k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k) * 3;
    for (let t = 0; t < count; t += 1) {
      const [a, b, c] = [at(t, 0), at(t, 1), at(t, 2)];
      const N = 6;
      for (let i = 0; i <= N; i += 1) {
        for (let j = 0; j <= N - i; j += 1) {
          const u = i / N;
          const v = j / N;
          const k = 1 - u - v;
          p.set(w[a] * k + w[b] * u + w[c] * v, w[a + 1] * k + w[b + 1] * u + w[c + 1] * v, w[a + 2] * k + w[b + 2] * u + w[c + 2] * v);
          plan[cell(p.z, -span / 2) * GRID + cell(p.x, -span / 2)] = 1;
          side[cell(span - p.y, 0) * GRID + cell(p.x, -span / 2)] = 1;
        }
      }
    }
  });
  return { plan, side };
}

/** Fraction of cells (of the larger of the two filled areas' union) in which two bitmaps differ. */
export function bitmapDistance(x: Uint8Array, y: Uint8Array): number {
  let diff = 0;
  let union = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] || y[i]) union += 1;
    if (x[i] !== y[i]) diff += 1;
  }
  return union === 0 ? 0 : diff / union;
}

/** A cheap signature of all the geometry a view shows: triangle count and a position checksum, in world space, skeleton pose included. */
export function geometrySignature(view: UnitView): string {
  view.object.updateMatrixWorld(true);
  let sum = 0;
  let tris = 0;
  modelOf(view).traverseVisible((o) => {
    if (!(o instanceof Mesh)) return;
    const w = worldPositions(o);
    tris += w.length / 9;
    for (let i = 0; i < w.length; i += 3) sum += w[i] * 1.3 + w[i + 1] * 2.7 + w[i + 2] * 3.9;
  });
  return `${tris}:${sum.toFixed(4)}`;
}

/** Every geometry, material and texture a view's scene graph uses (the chips and ring included), each once. */
export function resourcesOf(view: UnitView): { geometries: Set<object>; materials: Set<Material>; textures: Set<object> } {
  const geometries = new Set<object>();
  const materials = new Set<Material>();
  const textures = new Set<object>();
  view.object.traverse((o) => {
    // a Sprite's quad is three's own shared geometry, not ours
    if (o instanceof Mesh) geometries.add(o.geometry);
    const material = (o as Mesh).material as Material | Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      materials.add(m);
      const map = (m as { map?: object | null }).map;
      if (map) textures.add(map);
    }
  });
  return { geometries, materials, textures };
}
