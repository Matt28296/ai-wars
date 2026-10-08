// G7: the merged unit miniatures. A unit is one skinned mesh over its animated nodes, painted by vertex data and one shared material.
// Node environment (no DOM, no GPU): the shader patches are run against three.js's own templates, and the skin is read the way the
// renderer reads it. Every expected value is computed here, from the palette, the old measurement or the geometry, never copied out of the kit.
import { Color, Mesh, ShaderLib, Sphere, SkinnedMesh, Vector3 } from 'three';
import type { Material } from 'three';
import { describe, expect, it } from 'vitest';
import type { FactionId, UnitTypeId } from '../../../game/aw';
import type { UnitLook, UnitView } from '../contract';
import { FACTION_ACCENT, FACTION_COLOR } from '../palette';
import { FACTION_IDS, UNIT_IDS, createUnitView, createUnitViewWithPhase, resourceStats } from './index';
import { boneFootprint, footprint, modelOf, paintMaterial, skinMeshes, vertexRows, visibleDrawCalls, worldPositions } from './measure';
import { swap } from './shading';
import { restTransforms } from './skin';
import { acquireRecipe, releaseRecipe } from './resources';

const look = (over: Partial<UnitLook> = {}): UnitLook => ({ hp: 10, spent: false, heading: 0, status: null, focused: false, ...over });
const FOOT: UnitTypeId[] = ['trooper', 'breacher'];

/** The G2 builder's measurement: two armies of 20, Helion against Tidewell, the 16 types round-robin, HP and status mixed, a few spent. */
function fortyUnits(): UnitView[] {
  const views: UnitView[] = [];
  for (let i = 0; i < 40; i += 1) {
    const faction: FactionId = i % 2 === 0 ? 'helion' : 'tidewell';
    const v = createUnitView(UNIT_IDS[i % 16], faction);
    v.setLook(look({ hp: 1 + (i % 10), spent: i % 5 === 0, status: i % 7 === 0 ? 'low-ammo' : i % 11 === 0 ? 'loaded' : null, focused: i === 3 }));
    views.push(v);
  }
  return views;
}

/** The four paint classes of a vertex, by its colour: what the old design kept as four separate material slots. */
function paintClass(c: Color, faction: FactionId): 'paint' | 'dark' | 'trim' | 'glass' | 'unknown' {
  const steel = faction === 'choir' ? 0x5b6379 : 0x3a414d;
  const trim = new Color(FACTION_ACCENT[faction]).multiplyScalar(0.12);
  if (c.getHex() === FACTION_COLOR[faction]) return 'paint';
  if (c.getHex() === steel) return 'dark';
  if (c.getHex() === 0x9ad7ea) return 'glass';
  if (Math.abs(c.r - trim.r) + Math.abs(c.g - trim.g) + Math.abs(c.b - trim.b) < 1e-6) return 'trim';
  return 'unknown';
}

/**
 * What a unit would cost drawn the OLD way: one mesh per (node, paint class) it has vertices in, plus the rotor blur, plus the chips and
 * ring that are showing. This is the G2 design, rebuilt from the merged geometry, so the budget check can be shown to fail on it.
 */
function unmergedDrawCalls(view: UnitView, faction: FactionId): number {
  let n = 0;
  for (const skin of skinMeshes(view)) {
    let shown = true;
    for (let o: typeof skin.parent = skin; o; o = o.parent) if (!o.visible) shown = false;
    if (!shown) continue;
    const geo = skin.geometry;
    const bone = geo.getAttribute('skinIndex');
    const colors = vertexRows(geo, 'color');
    const parts = new Set<string>();
    colors.forEach((row, i) => parts.add(`${bone.getX(i)}:${paintClass(new Color().fromArray(row), faction)}`));
    n += parts.size;
  }
  view.object.traverseVisible((o) => {
    if ((o instanceof Mesh && o.userData.slot === 'blur') || (o as { isSprite?: boolean }).isSprite || o.name === 'ring') n += o.name === 'ring' ? 2 : 1;
  });
  return n;
}

describe('the draw-call budget', () => {
  it('forty units cost at most 120 draw calls (the G2 design cost 363), and a vehicle at most 3 meshes on average', () => {
    const views = fortyUnits();
    const drawCalls = views.reduce((n, v) => n + visibleDrawCalls(v), 0);
    const vehicles = views.filter((v) => !FOOT.includes(v.type));
    const meshesOf = (v: UnitView) => {
      let n = 0;
      modelOf(v).traverseVisible((o) => { if (o instanceof Mesh) n += 1; });
      return n;
    };
    const avg = vehicles.reduce((n, v) => n + meshesOf(v), 0) / vehicles.length;
    let sprites = 0;
    for (const v of views) v.object.traverseVisible((o) => { if ((o as { isSprite?: boolean }).isSprite) sprites += 1; });
    // eslint-disable-next-line no-console
    console.info(`[units] G7: 40 units cost ${drawCalls} draw calls (was 363): ${drawCalls - sprites - 2} model meshes, ${sprites} chips, 2 ring; ${avg.toFixed(2)} meshes per vehicle view on average`);
    expect(drawCalls).toBeLessThanOrEqual(120);
    expect(avg).toBeLessThanOrEqual(3);
    for (const v of vehicles) expect(meshesOf(v), `${v.type}`).toBeLessThanOrEqual(3);
    for (const v of views) v.dispose();
  });

  it('known-bad: the same forty units drawn un-merged (a mesh per node and paint class) are refused by the same budget', () => {
    const views = fortyUnits();
    const unmerged = views.reduce((n, v, i) => n + unmergedDrawCalls(v, i % 2 === 0 ? 'helion' : 'tidewell'), 0);
    // eslint-disable-next-line no-console
    console.info(`[units] G7: the same 40 units un-merged would cost ${unmerged} draw calls`);
    expect(unmerged).toBeGreaterThan(120);
    // and the emulation agrees with what G2 measured on these very units, so it is the old design it refuses
    expect(unmerged).toBe(363);
    for (const v of views) v.dispose();
  });

  it('a foot squad is one skinned mesh per figure shown, and every other type is one skinned mesh', () => {
    for (const type of UNIT_IDS) {
      const v = createUnitView(type, 'verdant');
      v.setLook(look());
      expect(skinMeshes(v).length, type).toBe(FOOT.includes(type) ? 3 : 1);
      // only the rotor blur is a second mesh, and only wasp and anvil have it
      let plain = 0;
      modelOf(v).traverse((o) => { if (o instanceof Mesh && !(o instanceof SkinnedMesh)) plain += 1; });
      expect(plain, type).toBe(type === 'wasp' || type === 'anvil' ? 1 : 0);
      v.dispose();
    }
  });
});

describe('the paint is in the vertices', () => {
  it('vertex colours carry paint, gunmetal and trim, and nothing else but the canopy glass', () => {
    for (const type of UNIT_IDS) {
      for (const faction of FACTION_IDS) {
        const v = createUnitView(type, faction);
        const colors = vertexRows(skinMeshes(v)[0].geometry, 'color').map((r) => new Color().fromArray(r));
        const seen = new Map<string, number>();
        for (const c of colors) seen.set(paintClass(c, faction), (seen.get(paintClass(c, faction)) ?? 0) + 1);
        expect(seen.get('unknown') ?? 0, `${type}/${faction}`).toBe(0);
        for (const cls of ['paint', 'dark', 'trim'] as const) expect(seen.get(cls) ?? 0, `${type}/${faction} ${cls}`).toBeGreaterThan(0);
        v.dispose();
      }
    }
  });

  it('the emissive weight is 1 on trim and 0 elsewhere', () => {
    for (const type of UNIT_IDS) {
      for (const faction of ['helion', 'choir'] as const) {
        const v = createUnitView(type, faction);
        const geo = skinMeshes(v)[0].geometry;
        const colors = vertexRows(geo, 'color').map((r) => new Color().fromArray(r));
        const glow = vertexRows(geo, 'aGlow').map((r) => r[0]);
        let trim = 0;
        colors.forEach((c, i) => {
          const cls = paintClass(c, faction);
          expect(glow[i], `${type}/${faction} vertex ${i} (${cls})`).toBe(cls === 'trim' ? 1 : 0);
          if (cls === 'trim') trim += 1;
        });
        expect(trim, `${type}/${faction} has trim to glow`).toBeGreaterThan(0);
        v.dispose();
      }
    }
  });

  it('known-bad: a model whose trim does not glow, or whose paint does, is caught by the same check', () => {
    const v = createUnitView('lancer', 'helion');
    const geo = skinMeshes(v)[0].geometry;
    const glow = geo.getAttribute('aGlow');
    const colors = vertexRows(geo, 'color').map((r) => new Color().fromArray(r));
    const wrong = (set: (i: number) => void) => {
      const saved = Array.from({ length: glow.count }, (_, i) => glow.getX(i));
      for (let i = 0; i < glow.count; i += 1) set(i);
      const bad = colors.some((c, i) => glow.getX(i) !== (paintClass(c, 'helion') === 'trim' ? 1 : 0));
      saved.forEach((g, i) => glow.setX(i, g));
      return bad;
    };
    expect(wrong((i) => { if (paintClass(colors[i], 'helion') === 'trim') glow.setX(i, 0); })).toBe(true);
    expect(wrong((i) => { if (paintClass(colors[i], 'helion') === 'paint') glow.setX(i, 1); })).toBe(true);
    expect(wrong(() => {})).toBe(false);
    v.dispose();
  });

  it('every vertex belongs to exactly one bone, and a bone at rest moves nothing', () => {
    for (const type of UNIT_IDS) {
      const recipe = acquireRecipe(type, 'helion');
      const geo = recipe.geometry;
      const index = geo.getAttribute('skinIndex');
      const weight = geo.getAttribute('skinWeight');
      for (let i = 0; i < index.count; i += 1) {
        expect(weight.getX(i), `${type} vertex ${i}`).toBe(1);
        expect(weight.getY(i) + weight.getZ(i) + weight.getW(i)).toBe(0);
        expect(index.getX(i)).toBeLessThan(recipe.nodes.length);
      }
      // bone * boneInverse is the identity at the rest pose
      const rest = restTransforms(recipe.nodes);
      rest.forEach((m, i) => {
        const id = m.clone().multiply(recipe.boneInverses[i]);
        for (let k = 0; k < 16; k += 1) expect(id.elements[k], `${type} bone ${i} element ${k}`).toBeCloseTo(k % 5 === 0 ? 1 : 0, 6);
      });
      releaseRecipe(type, 'helion');
    }
  });
});

describe('the skeleton animates the parts that move, and only them', () => {
  it('a spinning rotor turns its own vertices and leaves the hull alone', () => {
    const v = createUnitViewWithPhase('wasp', 'helion', 0);
    v.setLook(look());
    const boxAt = (name: string, t: number) => {
      v.update(0.016, t);
      return boneFootprint(v.object.getObjectByName(name) as never).getSize(new Vector3());
    };
    // at 26 rad/s a blade of a 0.2-long rotor goes from lying along X to lying along Z within a quarter turn: its box changes shape
    const sizes = [0, 0.03, 0.06, 0.09, 0.12].map((t) => boxAt('rotor0', t));
    expect(Math.max(...sizes.map((s) => s.x)) - Math.min(...sizes.map((s) => s.x)), 'rotor box changes as it turns').toBeGreaterThan(0.02);
    // the hull is rigid under the same skeleton: its box keeps one size (the idle bob only carries it)
    const hull = [0, 0.03, 0.06, 0.09, 0.12].map((t) => boxAt('body', t));
    for (const s of hull) expect(s.x).toBeCloseTo(hull[0].x, 3);
    v.dispose();
  });

  it('a weapon recoils out of the hull: its vertices slide back, and the hull does not', () => {
    for (const type of ['lancer', 'dreadnought', 'bastion'] as const) {
      const v = createUnitView(type, 'tidewell');
      v.setLook(look());
      const gun = v.object.getObjectByName('gun') as never;
      const body = v.object.getObjectByName('body') as never;
      const [g0, b0] = [boneFootprint(gun), boneFootprint(body)];
      v.setPose('fire', 0.15);
      const [g1, b1] = [boneFootprint(gun), boneFootprint(body)];
      expect(g0.max.x - g1.max.x, `${type} gun slides back`).toBeGreaterThan(0.025);
      // the pose group kicks the whole unit back a hair (0.012); the hull moves with it and no more
      expect(Math.abs(b0.max.x - b1.max.x), `${type} hull`).toBeLessThan(0.0125);
      v.dispose();
    }
  });

  it('the skin never leaves its culling sphere, at any pose or time (no unit pops out at the screen edge)', () => {
    for (const type of UNIT_IDS) {
      const v = createUnitView(type, 'kestrel');
      v.setLook(look());
      for (const [pose, t] of [['idle', 0], ['fire', 0.15], ['hit', 0.2], ['move', 0.5]] as const) {
        for (const time of [0, 0.9, 2.1, 3.7]) {
          v.update(0.016, time);
          v.setPose(pose, t);
          v.object.updateMatrixWorld(true);
          for (const skin of skinMeshes(v)) {
            const sphere = (skin.boundingSphere as Sphere).clone().applyMatrix4(skin.matrixWorld);
            const p = worldPositions(skin);
            const c = new Vector3();
            let far = 0;
            for (let i = 0; i < p.length; i += 3) far = Math.max(far, sphere.center.distanceTo(c.set(p[i], p[i + 1], p[i + 2])));
            expect(far, `${type} ${pose} t=${time}`).toBeLessThanOrEqual(sphere.radius + 1e-6);
          }
        }
      }
      v.dispose();
    }
  });

  it('the skin follows the object: moving and scaling the unit moves every vertex with it', () => {
    const v = createUnitView('colossus', 'helion');
    v.setLook(look());
    const base = footprint(v);
    v.object.position.set(5.5, 0.3, 7.5);
    v.object.scale.setScalar(0.5);
    const moved = footprint(v);
    expect(moved.getSize(new Vector3()).x).toBeCloseTo(base.getSize(new Vector3()).x * 0.5, 4);
    expect(moved.getCenter(new Vector3()).x).toBeCloseTo(5.5 + base.getCenter(new Vector3()).x * 0.5, 4);
    v.dispose();
  });
});

describe('the shared material and its shader patch', () => {
  const template = () => ({ uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader });
  const run = (m: Material, vertexShader: string, fragmentShader: string) => {
    const shader = { ...template(), vertexShader, fragmentShader };
    m.onBeforeCompile(shader as never, {} as never);
    return shader;
  };

  it('one material per faction and one spent variant serve every type; paint never changes the material', () => {
    const views = UNIT_IDS.map((t) => createUnitView(t, 'verdant'));
    const mats = new Set<Material>();
    for (const v of views) for (const s of skinMeshes(v)) mats.add(s.material as Material);
    expect(mats.size, 'sixteen types, one material').toBe(1);
    for (const v of views) v.setLook(look({ spent: true }));
    const spentMats = new Set<Material>();
    for (const v of views) for (const s of skinMeshes(v)) spentMats.add(s.material as Material);
    expect(spentMats.size).toBe(1);
    expect([...spentMats][0]).not.toBe([...mats][0]);
    for (const v of views) v.dispose();
    expect(resourceStats()).toEqual({ geometries: 0, materials: 0, textures: 0, looks: 0 });
  });

  it('the patch reads the real three.js shader template: baked paint, trim glow, surface and a rim in the accent colour', () => {
    const v = createUnitView('lancer', 'tidewell');
    const m = paintMaterial(v);
    const shader = run(m, template().vertexShader, template().fragmentShader);
    expect(shader.vertexShader).toContain('aSpent');
    expect(shader.vertexShader).toContain('mix( vColor.rgb, aSpent, uSpent )');
    expect(shader.fragmentShader).toContain('roughnessFactor = vSurface.x');
    expect(shader.fragmentShader).toContain('metalnessFactor = vSurface.y');
    // the weight gates the trim's glow, and the rim is added as emitted light, so it does not depend on which side the sun is on
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance = totalEmissiveRadiance * vGlow + vAmbient');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uRimColor');
    // a lit surface's own colour never decides the rim: nothing reads the light there
    expect(shader.fragmentShader.split('totalEmissiveRadiance += uRimColor')[1].split('\n')[0]).not.toMatch(/directLight|irradiance|reflectedLight/);
    const u = shader.uniforms as Record<string, { value: unknown }>;
    expect(u.uRim.value).toBeCloseTo(0.25, 9);
    expect(u.uSpent.value).toBe(0);
    expect((u.uRimColor.value as Color).getHex()).toBe(FACTION_ACCENT.tidewell);
    v.setLook(look({ spent: true }));
    const spent = run(paintMaterial(v), template().vertexShader, template().fragmentShader).uniforms;
    // a spent unit keeps the rim at 40%
    expect(spent.uRim.value as number).toBeCloseTo(0.25 * 0.4, 9);
    expect(spent.uSpent.value).toBe(1);
    v.dispose();
  });

  it('every faction patches the template, and the programs are shared (the cache key is the same for all)', () => {
    const keys = new Set<string>();
    for (const faction of FACTION_IDS) {
      const v = createUnitView('bastion', faction);
      for (const spent of [false, true]) {
        v.setLook(look({ spent }));
        const m = paintMaterial(v);
        const shader = run(m, template().vertexShader, template().fragmentShader);
        expect((shader.uniforms.uRimColor.value as Color).getHex(), `${faction} rim colour`).toBe(FACTION_ACCENT[faction]);
        keys.add(m.customProgramCacheKey());
      }
      v.dispose();
    }
    expect(keys.size).toBe(1);
  });

  it('a template missing an anchor is refused loudly, never patched halfway (known-bad)', () => {
    const v = createUnitView('lancer', 'helion');
    const m = paintMaterial(v);
    const t = template();
    for (const anchor of ['#include <color_vertex>']) expect(() => run(m, t.vertexShader.replace(anchor, ''), t.fragmentShader)).toThrow(anchor);
    for (const anchor of ['#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>', '#include <emissivemap_fragment>']) {
      expect(() => run(m, t.vertexShader, t.fragmentShader.replace(anchor, ''))).toThrow(anchor);
    }
    // both shaders need the common chunk
    expect(() => run(m, t.vertexShader.replace('#include <common>', ''), t.fragmentShader)).toThrow(/common/);
    expect(() => run(m, t.vertexShader, t.fragmentShader.replace('#include <common>', ''))).toThrow(/common/);
    expect(() => swap('void main() {}', '#include <nothing>', 'x', 'test')).toThrow(/not found/);
    expect(swap('a #include <x> b', '#include <x>', 'y', 'test')).toBe('a y b');
    v.dispose();
  });

  it('spent never mutates a shared material: every property of the shared one is unchanged after a neighbour goes spent and back', () => {
    const a = createUnitView('arc', 'choir');
    const b = createUnitView('salvo', 'choir');
    const shared = paintMaterial(b);
    const snap = () => JSON.stringify({
      color: shared.color, emissive: shared.emissive, i: shared.emissiveIntensity, r: shared.roughness, m: shared.metalness, v: shared.version,
      u: shared.userData.uniforms, key: shared.customProgramCacheKey(), vc: shared.vertexColors, flat: shared.flatShading,
    });
    const before = snap();
    a.setLook(look({ spent: true }));
    expect(snap()).toBe(before);
    expect(paintMaterial(a)).not.toBe(shared);
    a.setLook(look({ spent: false }));
    expect(snap()).toBe(before);
    expect(paintMaterial(a)).toBe(shared);
    a.dispose();
    b.dispose();
  });
});
