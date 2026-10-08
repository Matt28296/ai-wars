// G16: a unit of a seat whose nation the mission does not name (mission 1's "Unmarked drones") carries no sigil decal. Everything else about
// it stays: its silhouette, its paint, its trim colour, its draw calls. The sigil is baked into the one merged skin of a look, so the check
// reads the geometry the renderer would draw: the triangles of a marked unit and of its unmarked twin, and what is in one and not the other.
// Every expected value is computed here from the sigil's own outline (three's triangulation of it), never copied out of the implementation.
import { Mesh, ShapeUtils, Vector2 } from 'three';
import type { BufferGeometry, Material } from 'three';
import { describe, expect, it } from 'vitest';
import type { FactionId, UnitTypeId } from '../../../game/aw';
import type { UnitLook, UnitView, UnitViewOptions } from '../contract';
import { sigilShapes } from './factions';
import { FACTION_IDS, UNIT_IDS, createUnitView as contractCreate, resourceStats } from './index';
import type { UnitKit } from './index';
import { modelOf, resourcesOf, skinMeshes, visibleDrawCalls, visibleTriangles } from './measure';

/** The page's own entry point (typed as the contract's), seen as the kit's view it really returns. */
const createUnitView = (type: UnitTypeId, faction: FactionId, opts?: UnitViewOptions): UnitKit => contractCreate(type, faction, opts) as UnitKit;
const look = (over: Partial<UnitLook> = {}): UnitLook => ({ hp: 10, spent: false, heading: 0, status: null, focused: false, ...over });
const make = (type: UnitTypeId, faction: FactionId, opts?: UnitViewOptions): UnitKit => {
  const v = createUnitView(type, faction, opts);
  v.setLook(look());
  return v;
};

/** How many skinned meshes a view draws (a squad of three figures draws the one skin three times). */
function visibleSkins(v: UnitView): number {
  let n = 0;
  modelOf(v).traverseVisible((o) => { if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) n += 1; });
  return n;
}

/** The rest-pose geometry a view is drawn with (a squad's three figures share it). */
const skinOf = (v: UnitView): BufferGeometry => {
  const [first] = skinMeshes(v);
  if (!first) throw new Error(`${v.type} has no skinned mesh`);
  return first.geometry;
};

interface Tri { key: string; glow: number; ny: number }

/** Every triangle of a non-indexed skin as a key (its nine coordinates and its bone), its emissive weight (1 = trim) and its normal's height. */
function trianglesOf(g: BufferGeometry): Tri[] {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const glow = g.getAttribute('aGlow');
  const bone = g.getAttribute('skinIndex');
  const out: Tri[] = [];
  for (let t = 0; t < p.count; t += 3) {
    const nums: string[] = [];
    for (let k = 0; k < 3; k += 1) nums.push(p.getX(t + k).toFixed(5), p.getY(t + k).toFixed(5), p.getZ(t + k).toFixed(5));
    out.push({ key: `${bone.getX(t)}|${nums.join(',')}`, glow: glow.getX(t), ny: n.getY(t) });
  }
  return out;
}

/** What `a` has that `b` lacks, as a multiset difference (a triangle that is in `a` twice and in `b` once leaves one). */
function minus(a: readonly Tri[], b: readonly Tri[]): Tri[] {
  const left = new Map<string, number>();
  for (const t of b) left.set(t.key, (left.get(t.key) ?? 0) + 1);
  const out: Tri[] = [];
  for (const t of a) {
    const have = left.get(t.key) ?? 0;
    if (have > 0) left.set(t.key, have - 1);
    else out.push(t);
  }
  return out;
}

/** How many triangles a faction's sigil makes: three's own triangulation of each piece of its outline, holes cut out. */
function sigilTriangleCount(faction: FactionId): number {
  const pts = (list: readonly (readonly [number, number])[]) => list.map((q) => new Vector2(q[0], -q[1]));
  return sigilShapes(faction).reduce((sum, piece) => sum + ShapeUtils.triangulateShape(pts(piece.outline), piece.holes.map(pts)).length, 0);
}

/** The sigil triangles a view's skin has that its twin's skin lacks, or null when the twin has something this view lacks (a different model). */
function sigilOf(view: UnitView, twin: UnitView): Tri[] | null {
  const mine = trianglesOf(skinOf(view));
  const theirs = trianglesOf(skinOf(twin));
  return minus(theirs, mine).length === 0 ? minus(mine, theirs) : null;
}

describe('an unmarked unit has no sigil decal and a marked twin still has one', () => {
  it('all 16 types in all 5 nations: the marked skin has exactly the sigil\'s triangles more than the unmarked one, and nothing else differs', () => {
    expect(UNIT_IDS).toHaveLength(16);
    for (const faction of FACTION_IDS) {
      const want = sigilTriangleCount(faction);
      expect(want, `${faction} sigil has triangles`).toBeGreaterThan(0);
      for (const type of UNIT_IDS) {
        const marked = make(type, faction);
        const bare = make(type, faction, { unmarked: true });
        const extra = sigilOf(marked, bare);
        expect(extra, `${type}/${faction}: the unmarked skin is the marked one minus the decal and nothing more`).not.toBeNull();
        expect(extra!.length, `${type}/${faction}: the decal's triangles`).toBe(want);
        // the decal is trim light, flat, and on one plane, facing up: a sticker on the deck, never a part of the shape
        for (const t of extra!) expect(t.glow, `${type}/${faction} decal is trim`).toBe(1);
        expect(new Set(extra!.map((t) => t.ny.toFixed(3))).size, `${type}/${faction} decal is flat`).toBe(1);
        expect(visibleTriangles(modelOf(marked)) - visibleTriangles(modelOf(bare)), `${type}/${faction} triangles drawn`).toBe(want * visibleSkins(marked));
        marked.dispose();
        bare.dispose();
      }
    }
    expect(resourceStats()).toEqual({ geometries: 0, materials: 0, textures: 0, looks: 0 });
  });

  it('is told by a view that always draws the sigil, and by one that never does: the checks above fail for both', () => {
    // two planted mutants of `createUnitView`: one ignores the flag (always marked), one marks everything unmarked
    const alwaysMarked = (type: UnitTypeId, faction: FactionId, _opts?: UnitViewOptions): UnitView => createUnitView(type, faction);
    const alwaysBare = (type: UnitTypeId, faction: FactionId, _opts?: UnitViewOptions): UnitView => createUnitView(type, faction, { unmarked: true });
    const decalCount = (factory: typeof alwaysMarked, type: UnitTypeId, faction: FactionId, opts?: UnitViewOptions): number => {
      const reference = createUnitView(type, faction, { unmarked: true }); // the bare skin, built by the real thing
      const v = factory(type, faction, opts);
      const n = sigilOf(v, reference)?.length ?? -1;
      v.dispose();
      reference.dispose();
      return n;
    };
    for (const [type, faction] of [['lancer', 'choir'], ['trooper', 'helion'], ['dreadnought', 'tidewell']] as const) {
      const want = sigilTriangleCount(faction);
      // the real factory: marked has the decal, unmarked has none
      expect(decalCount(createUnitView, type, faction), `${type} marked`).toBe(want);
      expect(decalCount(createUnitView, type, faction, { unmarked: true }), `${type} unmarked`).toBe(0);
      // "always unmarked" cannot show a decal when asked for one; "always marked" cannot hide it when asked to
      expect(decalCount(alwaysBare, type, faction), `${type} always-unmarked mutant, asked for marked`).not.toBe(want);
      expect(decalCount(alwaysMarked, type, faction, { unmarked: true }), `${type} always-marked mutant, asked for unmarked`).not.toBe(0);
    }
  });

  it('the option defaults to marked: an empty options object and `unmarked: false` draw the sigil, only `unmarked: true` removes it', () => {
    const bare = createUnitView('arc', 'kestrel', { unmarked: true });
    for (const opts of [undefined, {}, { unmarked: false }]) {
      const v = createUnitView('arc', 'kestrel', opts);
      expect(sigilOf(v, bare)!.length).toBe(sigilTriangleCount('kestrel'));
      expect((v as UnitKit).unmarked).toBe(false);
      v.dispose();
    }
    expect((bare as UnitKit).unmarked).toBe(true);
    bare.dispose();
  });
});

describe('colour is not a name: an unmarked unit keeps its paint, its trim colour and its silhouette', () => {
  it('every vertex of the unmarked skin is a vertex of the marked one with the very same colour, emissive weight and ambient light', () => {
    for (const type of UNIT_IDS) {
      const marked = make(type, 'choir');
      const bare = make(type, 'choir', { unmarked: true });
      const a = skinOf(marked);
      const b = skinOf(bare);
      // each vertex as one key (position, paint, emissive weight, ambient light, surface), counted: a multiset
      const colourOf = (g: BufferGeometry): Map<string, number> => {
        const count = new Map<string, number>();
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i += 1) {
          const k = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => v.toFixed(5)).concat(['color', 'aGlow', 'aAmbient', 'aSurface'].flatMap((name) => {
            const at = g.getAttribute(name);
            return Array.from({ length: at.itemSize }, (_, c) => at.getComponent(i, c).toFixed(5));
          })).join(',');
          count.set(k, (count.get(k) ?? 0) + 1);
        }
        return count;
      };
      const ma = colourOf(a);
      const mb = colourOf(b);
      for (const [k, n] of mb) expect(ma.get(k) ?? 0, `${type}: an unmarked vertex that the marked unit lacks or paints differently`).toBeGreaterThanOrEqual(n);
      // the same box, give or take the sticker's own lift off the deck (it sits 4 mm above the surface it is stuck to, so on a unit whose top
      // IS that surface the marked box is that much taller; nothing about the shape differs)
      a.computeBoundingBox();
      b.computeBoundingBox();
      const ab = a.boundingBox!;
      const bb = b.boundingBox!;
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(bb.min[axis], `${type} min ${axis}`).toBeGreaterThanOrEqual(ab.min[axis] - 1e-6);
        expect(bb.min[axis] - ab.min[axis], `${type} min ${axis}`).toBeLessThanOrEqual(0.005);
        expect(ab.max[axis] - bb.max[axis], `${type} max ${axis}`).toBeGreaterThanOrEqual(-1e-6);
        expect(ab.max[axis] - bb.max[axis], `${type} max ${axis}`).toBeLessThanOrEqual(0.005);
      }
      marked.dispose();
      bare.dispose();
    }
  });

  it('a plain trim plate in its place is NOT there either: no triangle of the unmarked skin is new', () => {
    for (const type of UNIT_IDS) {
      const marked = make(type, 'helion');
      const bare = make(type, 'helion', { unmarked: true });
      expect(minus(trianglesOf(skinOf(bare)), trianglesOf(skinOf(marked))), `${type}: triangles only the unmarked one has`).toHaveLength(0);
      marked.dispose();
      bare.dispose();
    }
  });
});

describe('unmarked units cost no draw call and no material', () => {
  /** Two armies of 20 (the stress board of the G7 budget), round-robin over the 16 types; `unmarkedOwner` draws that army without sigils. */
  function board(unmarkedOwner: 0 | 1 | null): UnitView[] {
    const views: UnitView[] = [];
    for (let i = 0; i < 40; i += 1) {
      const owner = (i % 2) as 0 | 1;
      const faction: FactionId = owner === 0 ? 'helion' : 'choir';
      const v = createUnitView(UNIT_IDS[i % 16], faction, owner === unmarkedOwner ? { unmarked: true } : undefined);
      v.setLook(look({ hp: 1 + (i % 10), spent: i % 5 === 0, status: i % 7 === 0 ? 'low-ammo' : null, focused: i === 3 }));
      views.push(v);
    }
    return views;
  }
  const measure = (views: UnitView[]) => {
    const materials = new Set<Material>();
    const geometries = new Set<object>();
    let meshes = 0;
    let drawCalls = 0;
    let tris = 0;
    for (const v of views) {
      const r = resourcesOf(v);
      r.materials.forEach((m) => materials.add(m));
      r.geometries.forEach((g) => geometries.add(g));
      v.object.traverse((o) => { if (o instanceof Mesh) meshes += 1; });
      drawCalls += visibleDrawCalls(v);
      tris += visibleTriangles(modelOf(v));
    }
    return { materials, geometries, meshes, drawCalls, tris };
  };

  it('the draw calls, meshes and materials of the forty-unit board are equal with and without an unmarked owner; only the triangles fall', () => {
    const plain = board(null); // stays alive while the others are built, so the caches hand out the same objects
    const plainStats = measure(plain);
    const plainMaterials = new Set(plainStats.materials);

    for (const owner of [0, 1] as const) {
      const masked = board(owner);
      const m = measure(masked);
      expect(m.drawCalls, `owner ${owner} unmarked: draw calls`).toBe(plainStats.drawCalls);
      expect(m.meshes, `owner ${owner} unmarked: meshes`).toBe(plainStats.meshes);
      expect(m.materials.size, `owner ${owner} unmarked: materials`).toBe(plainStats.materials.size);
      // not a new material, but the very objects the marked board used (the paint is in the vertices, not in a decal's own material)
      for (const material of m.materials) expect(plainMaterials.has(material), `a material the plain board never used: "${material.name}"`).toBe(true);
      expect(m.tris, `owner ${owner} unmarked: fewer triangles, so the board really changed`).toBeLessThan(plainStats.tris);
      // an unmarked look is a model of its own: it adds geometries (one per look), never meshes
      expect(m.geometries.size).toBeGreaterThan(0);
      masked.forEach((v) => v.dispose());
    }
    plain.forEach((v) => v.dispose());
    expect(resourceStats()).toEqual({ geometries: 0, materials: 0, textures: 0, looks: 0 });
  });

  it('a marked unit and its unmarked twin draw with the very same material objects', () => {
    for (const type of UNIT_IDS) {
      const marked = make(type, 'choir');
      const bare = make(type, 'choir', { unmarked: true });
      const a = resourcesOf(marked).materials;
      const b = resourcesOf(bare).materials;
      expect(b.size, `${type}: material count`).toBe(a.size);
      for (const m of b) expect(a.has(m), `${type}: an unmarked unit's material the marked one does not share`).toBe(true);
      marked.dispose();
      bare.dispose();
    }
  });

  it('marked and unmarked looks are separate cache entries and both are freed when their last unit goes', () => {
    const a = createUnitView('lancer', 'choir');
    const b = createUnitView('lancer', 'choir', { unmarked: true });
    const c = createUnitView('lancer', 'choir', { unmarked: true });
    expect(resourceStats().looks).toBe(2);
    a.dispose();
    expect(resourceStats().looks).toBe(1);
    b.dispose();
    expect(resourceStats().looks).toBe(1); // c still uses it
    expect(visibleTriangles(modelOf(c))).toBeGreaterThan(300);
    c.dispose();
    expect(resourceStats()).toEqual({ geometries: 0, materials: 0, textures: 0, looks: 0 });
  });
});
