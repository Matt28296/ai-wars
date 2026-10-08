// Measurements over a unit view, for the tests and the gallery: triangles, footprint, silhouette, squad size, saturation.
// They read the scene graph the way a renderer would (visible meshes, world matrices), never the recipes.
import { Box3, Color, Mesh, Vector3 } from 'three';
import type { Material, MeshStandardMaterial, Object3D } from 'three';
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

/** The exact box of the miniature in world space (vertex-precise, so a spinning rotor does not inflate it). */
export function footprint(view: UnitView): Box3 {
  view.object.updateMatrixWorld(true);
  return new Box3().setFromObject(modelOf(view), true);
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

/** The materials of a view's meshes in one paint slot. */
export function slotMaterials(view: UnitView, slot: string): MeshStandardMaterial[] {
  const out = new Set<MeshStandardMaterial>();
  modelOf(view).traverse((o) => {
    if (o instanceof Mesh && o.userData.slot === slot) out.add(o.material as MeshStandardMaterial);
  });
  return [...out];
}

/** Is `spent` the desaturated, dimmed form of `normal`? (paint at ~40% saturation, trim glow at ~30%). */
export function isSpentLook(normalPaint: MeshStandardMaterial, spentPaint: MeshStandardMaterial, normalTrim: MeshStandardMaterial, spentTrim: MeshStandardMaterial): boolean {
  const sn = saturation(normalPaint.color);
  const ss = saturation(spentPaint.color);
  const desat = sn < 0.05 ? ss <= sn + 1e-6 : Math.abs(ss / sn - 0.4) < 0.06;
  const glow = Math.abs(spentTrim.emissiveIntensity / normalTrim.emissiveIntensity - 0.3) < 0.01;
  return desat && glow && spentPaint !== normalPaint;
}

export const GRID = 16;

/** A coarse occupancy bitmap of the model seen from above (x, z) and from the side (x, y): GRID x GRID cells each, 0.8 tile square. */
export function silhouette(view: UnitView): { plan: Uint8Array; side: Uint8Array } {
  view.object.updateMatrixWorld(true);
  const plan = new Uint8Array(GRID * GRID);
  const side = new Uint8Array(GRID * GRID);
  const span = 0.84;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const p = new Vector3();
  const cell = (v: number, lo: number) => Math.min(GRID - 1, Math.max(0, Math.floor(((v - lo) / span) * GRID)));
  modelOf(view).traverseVisible((o) => {
    if (!(o instanceof Mesh) || o.userData.slot === 'blur') return;
    const pos = o.geometry.getAttribute('position');
    const index = o.geometry.index;
    const count = (index ? index.count : pos.count) / 3;
    for (let t = 0; t < count; t += 1) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      const N = 6;
      for (let i = 0; i <= N; i += 1) {
        for (let j = 0; j <= N - i; j += 1) {
          const u = i / N;
          const v = j / N;
          p.set(a.x * (1 - u - v) + b.x * u + c.x * v, a.y * (1 - u - v) + b.y * u + c.y * v, a.z * (1 - u - v) + b.z * u + c.z * v);
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

/** A cheap signature of all the geometry a view shows: triangle count and a position checksum. */
export function geometrySignature(view: UnitView): string {
  view.object.updateMatrixWorld(true);
  let sum = 0;
  let tris = 0;
  const v = new Vector3();
  modelOf(view).traverseVisible((o) => {
    if (!(o instanceof Mesh)) return;
    const pos = o.geometry.getAttribute('position');
    tris += pos.count / 3;
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      sum += v.x * 1.3 + v.y * 2.7 + v.z * 3.9;
    }
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
