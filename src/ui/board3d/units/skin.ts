// Merges every part of a unit into ONE geometry (G7). The parts were one mesh per node and paint slot (about nine meshes a unit, up to
// fifteen for a foot squad); now a unit is one skinned mesh whose bones are the animated nodes (the body, the weapon that recoils, the
// rotors and fans that spin, the legs that step). The paint is baked into the vertices:
//   color      the albedo (paint, gunmetal, trim, canopy glass)             aSpent    the albedo of a spent unit
//   aGlow      emissive weight: 1 on trim, 0 elsewhere                      aAmbient  own light (canopy teal, Choir lift) + what spent keeps
//   aSurface   roughness and metalness of the slot they came from           skinIndex / skinWeight   the node each vertex belongs to
// The geometry is authored at the REST pose (every node at its NodeDef transform), so a bone at rest moves nothing, and it is built
// once per (type, faction) and shared by every instance of that look.
import { BufferGeometry, Euler, Float32BufferAttribute, Matrix3, Matrix4, Quaternion, Uint16BufferAttribute, Vector3 } from 'three';
import type { FactionId } from '../../../game/aw';
import type { SlotGeometry, V3 } from './kit';
import { PAINT_SLOTS, liveryOf } from './livery';

export const ATTR = { spent: 'aSpent', glow: 'aGlow', ambient: 'aAmbient', surface: 'aSurface' } as const;

export interface SkinPart {
  name: string;
  parent: string | null;
  pos: V3;
  rot: V3;
  geo: SlotGeometry;
}

export interface Skin {
  geometry: BufferGeometry;
  /** One per part, in order: the inverse of the part's rest transform in the model's frame. */
  boneInverses: Matrix4[];
  /** The see-through rotor blur of each part that has one, in the part's own frame (it blends, so it cannot join the opaque mesh). */
  blur: Map<string, BufferGeometry>;
}

const ONE = new Vector3(1, 1, 1);

/** The rest transform of every part in the model's frame: its own pos/rot on top of its parent's. */
export function restTransforms(parts: readonly { name: string; parent: string | null; pos: V3; rot: V3 }[]): Matrix4[] {
  const index = new Map<string, number>();
  const world: Matrix4[] = [];
  parts.forEach((p, i) => {
    const local = new Matrix4().compose(new Vector3(p.pos[0], p.pos[1], p.pos[2]), new Quaternion().setFromEuler(new Euler(p.rot[0], p.rot[1], p.rot[2])), ONE);
    const at = p.parent === null ? undefined : index.get(p.parent);
    if (p.parent !== null && at === undefined && parts.some((q) => q.name === p.parent)) throw new Error(`unit skin: ${p.name} is listed before its parent ${p.parent}`);
    world.push(at === undefined ? local : new Matrix4().multiplyMatrices(world[at], local));
    index.set(p.name, i);
  });
  return world;
}

export function bakeSkin(faction: FactionId, parts: readonly SkinPart[]): Skin {
  const look = liveryOf(faction);
  const world = restTransforms(parts);
  let total = 0;
  for (const part of parts) for (const slot of PAINT_SLOTS) total += part.geo[slot]?.getAttribute('position').count ?? 0;
  if (total === 0) throw new Error(`unit skin: ${faction} has no geometry`);

  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  const spent = new Float32Array(total * 3);
  const glow = new Float32Array(total);
  const ambient = new Float32Array(total * 4);
  const surface = new Float32Array(total * 2);
  const skinIndex = new Uint16Array(total * 4);
  const skinWeight = new Float32Array(total * 4);

  const v = new Vector3();
  let at = 0;
  parts.forEach((part, bone) => {
    const m = world[bone];
    const nm = new Matrix3().getNormalMatrix(m);
    for (const slot of PAINT_SLOTS) {
      const g = part.geo[slot];
      if (!g) continue;
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const s = look[slot];
      for (let i = 0; i < p.count; i += 1, at += 1) {
        v.fromBufferAttribute(p, i).applyMatrix4(m).toArray(position, at * 3);
        v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize().toArray(normal, at * 3);
        s.color.toArray(color, at * 3);
        s.spent.toArray(spent, at * 3);
        glow[at] = s.glow;
        s.ambient.toArray(ambient, at * 4);
        ambient[at * 4 + 3] = s.ambientSpent;
        surface[at * 2] = s.roughness;
        surface[at * 2 + 1] = s.metalness;
        skinIndex[at * 4] = bone;
        skinWeight[at * 4] = 1;
      }
      g.dispose();
    }
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
  geometry.setAttribute(ATTR.spent, new Float32BufferAttribute(spent, 3));
  geometry.setAttribute(ATTR.glow, new Float32BufferAttribute(glow, 1));
  geometry.setAttribute(ATTR.ambient, new Float32BufferAttribute(ambient, 4));
  geometry.setAttribute(ATTR.surface, new Float32BufferAttribute(surface, 2));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const blur = new Map<string, BufferGeometry>();
  for (const part of parts) if (part.geo.blur) blur.set(part.name, part.geo.blur);
  return { geometry, boneInverses: world.map((m) => m.clone().invert()), blur };
}
