// ORDER G8a: a property under a unit shows its LOW FORM. In node (no GPU): the kit's state, the real merged geometry and the vertex shader's
// arithmetic run on the CPU over it (`debug.extentAt`); the GPU side is proven by screenshots of the gallery and the real watch view.
import { BufferAttribute, Mesh, ShaderLib, type Material, type Object3D, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { PlayerIndex } from '../../../game/aw';
import type { TerrainView } from '../contract';
import { createTerrainKit, type TerrainKit } from './index';
import { LOW_EASE_SEC, LOW_FORM, lowFormY } from './shading';
import { boardInput, stressRows } from './testing';

// All six property types, three owned by each of two players, on a small island: (x, y) of every property and what it is.
const ROWS = ['~~~~~~~', '~C.F.A~', '~.....~', '~D.U.H~', '~~~~~~~'];
const OWNERS: Record<string, PlayerIndex> = { '1,1': 0, '3,1': 1, '5,1': 0, '1,3': 1, '3,3': 0, '5,3': 1 };
const PROPS: [number, number, string][] = [[1, 1, 'arcology'], [3, 1, 'fabricator'], [5, 1, 'skyport'], [1, 3, 'dock'], [3, 3, 'uplink'], [5, 3, 'spire']];
const make = (): TerrainKit => createTerrainKit(boardInput(ROWS, OWNERS));
const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => { if (o instanceof Mesh) out.push(o); });
  return out;
};
const key = (x: number, y: number): string => `${x},${y}`;
/** Run the view for `sec` seconds in 60 Hz frames, the way the stage does. */
const run = (v: TerrainView, sec: number): void => { for (let i = 0; i < Math.round(sec * 60); i++) v.update(1 / 60, i / 60); };

/**
 * What the order asks of any implementation, on the real kit's own readings: exactly the occupied property tiles are low (all the way, once
 * eased), every other tile is untouched, and the parts that stay (pad, owner band, banner, sigil) are exactly where they were. `view` is
 * what the stage would call; `kit` is the same kit's debug readings, so a stub for `view` is judged by what it did NOT change.
 */
function assertLowersExactly(view: TerrainView, kit: TerrainKit, free: TerrainKit, occupied: Set<string>): void {
  view.setOccupied((x, y) => occupied.has(key(x, y)));
  run(view, 0.3);
  for (let y = 0; y < kit.board.height; y++) {
    for (let x = 0; x < kit.board.width; x++) {
      const want = occupied.has(key(x, y)) && kit.board.at(x, y).property ? 1 : 0;
      expect(kit.debug.lowAt(x, y), `low at ${x},${y}`).toBe(want);
    }
  }
  for (const [x, y, id] of PROPS) {
    const now = kit.debug.extentAt(x, y)!;
    const was = free.debug.extentAt(x, y)!;
    expect(now.stays, `${id} pad, band, banner`).toEqual(was.stays);
    if (occupied.has(key(x, y))) {
      expect(now.sinks!.maxY, `${id} is lower than its full form`).toBeLessThan(was.sinks!.maxY - 0.05);
    } else {
      expect(now.sinks, `${id} stays full`).toEqual(was.sinks);
    }
  }
}

describe('setOccupied lowers the properties under units', () => {
  it('lowers exactly the occupied property tiles and leaves every other tile alone', () => {
    const kit = make();
    const free = make();
    // Three properties occupied, three free, plus a flats tile and a sea tile that are "occupied" but have nothing to lower.
    const occupied = new Set([key(1, 1), key(5, 1), key(3, 3), key(2, 2), key(0, 0)]);
    assertLowersExactly(kit, kit, free, occupied);
    expect(kit.debug.lowAt(3, 1)).toBe(0); // the fabricator has no unit
    expect(kit.debug.extentAt(2, 2)).toBeNull(); // flats have no property parts at all
    kit.dispose();
    free.dispose();
  });

  it('every property type sinks its tall parts to a quarter of their height above the pad, from the geometry the GPU gets', () => {
    expect(LOW_FORM).toBe(0.25);
    const kit = make();
    const free = make();
    kit.setOccupied(() => true);
    run(kit, 0.3);
    for (const [x, y, id] of PROPS) {
      const full = free.debug.extentAt(x, y)!;
      const low = kit.debug.extentAt(x, y)!;
      const pad = full.pad;
      expect(full.sinks!.maxY - pad, `${id} has something tall to lower`).toBeGreaterThan(0.25);
      // The tallest part of the low form is a quarter of the tallest part of the full form, measured from the pad, answers computed here.
      expect(low.sinks!.maxY - pad, `${id} low height`).toBeCloseTo((full.sinks!.maxY - pad) * 0.25, 4);
      expect(low.sinks!.minY, `${id} lowest sinking vertex`).toBeCloseTo(pad + (full.sinks!.minY - pad) * 0.25, 4);
      // The unit stands on the pad: the pad's own top is where it always was.
      expect(kit.heightAt(x, y)).toBe(free.heightAt(x, y));
    }
    kit.dispose();
    free.dispose();
  });

  it('the pad, owner band, banner and sigil keep their full size and colour; the capture ring is untouched', () => {
    const kit = make();
    const free = make();
    kit.setCapture((x, y) => (x === 1 && y === 1 ? 0.5 : 0));
    free.setCapture((x, y) => (x === 1 && y === 1 ? 0.5 : 0));
    kit.setOccupied(() => true);
    run(kit, 0.3);
    for (const [x, y, id] of PROPS) {
      const now = kit.debug.extentAt(x, y)!;
      const was = free.debug.extentAt(x, y)!;
      expect(now.stays, id).toEqual(was.stays);
      // The banner pole is the tallest thing that stays, so it is really in the group that stays (the check is not vacuous).
      expect(now.stays!.maxY - now.pad, `${id} banner stands up`).toBeGreaterThan(0.3);
      expect(kit.debug.paintAt(x, y), `${id} owner colour`).toBe(free.debug.paintAt(x, y));
      expect(kit.debug.factionAt(x, y), `${id} owner`).toBe(free.debug.factionAt(x, y));
      expect(kit.debug.sigilAt(x, y), `${id} sigil cell`).toBe(free.debug.sigilAt(x, y));
      for (const [a, b] of [[0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.5, 0.25]]) expect(kit.debug.sigilSample(x, y, a, b), `${id} sigil at ${a},${b}`).toBe(free.debug.sigilSample(x, y, a, b));
    }
    // The ring: same progress, same mesh, same vertices, and a material that never reads the low map.
    expect(kit.debug.captureAt(1, 1)).toBe(128);
    const ring = (k: TerrainKit): Mesh => meshesOf(k.group).find((m) => m.name === 'terrain:capture-rings')!;
    const a = ring(kit).geometry.getAttribute('position') as BufferAttribute;
    const b = ring(free).geometry.getAttribute('position') as BufferAttribute;
    expect(Array.from(a.array)).toEqual(Array.from(b.array));
    const mat = ring(kit).material as ShaderMaterial;
    expect(mat.vertexShader.includes('aSink') || mat.vertexShader.includes('uOccMap')).toBe(false);
    kit.dispose();
    free.dispose();
  });

  it('what stays and what sinks are told apart per vertex: the banner and the pad stay, towers and masts sink, and the horizontal plan never moves', () => {
    const kit = make();
    const free = make();
    kit.setOccupied(() => true);
    run(kit, 0.3);
    const flag = (k: TerrainKit, bucket: string): BufferAttribute | null => meshesOf(k.group).find((m) => m.name === `terrain:${bucket}`)?.geometry.getAttribute('aSink') as BufferAttribute | null ?? null;
    let sinking = 0;
    let staying = 0;
    for (const bucket of ['solid', 'glossy', 'windows', 'glow', 'decal']) {
      const f = flag(kit, bucket); // (no glass on this island, so no glossy bucket)
      if (!f) continue;
      for (let i = 0; i < f.count; i++) { if (f.getX(i) > 0.5) sinking++; else staying++; }
    }
    expect(sinking).toBeGreaterThan(500);
    expect(staying).toBeGreaterThan(500);
    // The pivot of every sinking vertex is the pad top of the tile it stands on.
    for (const [x, y] of PROPS) {
      const pad = free.heightAt(x, y);
      const mesh = meshesOf(kit.group).find((m) => m.name === 'terrain:solid')!;
      const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
      const f = mesh.geometry.getAttribute('aSink') as BufferAttribute;
      let seen = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.floor(pos.getX(i)) !== x || Math.floor(pos.getZ(i)) !== y || f.getX(i) < 0.5) continue;
        expect(f.getY(i)).toBeCloseTo(pad, 6);
        seen++;
      }
      expect(seen, `sinking vertices of ${x},${y}`).toBeGreaterThan(20);
    }
    kit.dispose();
    free.dispose();
  });
});

describe('the low form eases over a quarter of a second', () => {
  it('starts at the full form, is partway while easing, and is all the way down within 0.25 s', () => {
    expect(LOW_EASE_SEC).toBe(0.25);
    const kit = make();
    kit.setOccupied((x, y) => x === 1 && y === 1);
    expect(kit.debug.lowAt(1, 1)).toBe(0); // nothing moves until the stage's own update drives it
    const seen: number[] = [];
    for (let i = 0; i < 15; i++) {
      kit.update(1 / 60, i / 60);
      seen.push(kit.debug.lowAt(1, 1));
    }
    // 15 frames of 1/60 s are 0.25 s: partway on the way, and there at the end.
    expect(seen[2]).toBeGreaterThan(0);
    expect(seen[2]).toBeLessThan(0.5);
    for (let i = 1; i < seen.length; i++) expect(seen[i], `frame ${i}`).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen.some((v) => v > 0.3 && v < 0.7), 'it passes through the middle, it does not pop').toBe(true);
    expect(seen[14]).toBe(1);
    // Other tiles never moved.
    for (const [x, y] of PROPS) if (x !== 1 || y !== 1) expect(kit.debug.lowAt(x, y)).toBe(0);
    kit.dispose();
  });

  it('a huge dt (scrubbing) jumps straight to the target, up and down; a bad dt does nothing', () => {
    const kit = make();
    const some = (x: number, y: number): boolean => (x + y) % 4 === 2; // (1,1) (3,3) (5,1) ... a mix of tiles
    kit.setOccupied(some);
    kit.update(100, 0);
    for (const [x, y] of PROPS) expect(kit.debug.lowAt(x, y), `${x},${y} down`).toBe(some(x, y) ? 1 : 0);
    kit.setOccupied(() => false);
    kit.update(1e9, 0);
    for (const [x, y] of PROPS) expect(kit.debug.lowAt(x, y), `${x},${y} back up`).toBe(0);
    kit.setOccupied(() => true);
    kit.update(Infinity, 0);
    for (const [x, y] of PROPS) expect(kit.debug.lowAt(x, y), `${x},${y} infinity`).toBe(1);
    // NaN and negative steps leave everything where it is, and throw nothing.
    kit.setOccupied(() => false);
    expect(() => { kit.update(Number.NaN, 0); kit.update(-5, 0); kit.update(0, 0); }).not.toThrow();
    for (const [x, y] of PROPS) expect(kit.debug.lowAt(x, y)).toBe(1);
    kit.dispose();
  });

  it('a free property rises back, over the same quarter of a second, and ends exactly as it began', () => {
    const kit = make();
    const free = make();
    kit.setOccupied((x, y) => x === 5 && y === 3);
    run(kit, 0.3);
    expect(kit.debug.lowAt(5, 3)).toBe(1);
    kit.setOccupied(() => false);
    kit.update(0.06, 0);
    const mid = kit.debug.lowAt(5, 3);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.5); // still mostly down a few frames in: it eases, it does not snap
    run(kit, 0.25);
    expect(kit.debug.lowAt(5, 3)).toBe(0);
    expect(kit.debug.extentAt(5, 3)).toEqual(free.debug.extentAt(5, 3));
    // Changing its mind halfway (a unit leaves, another arrives) turns around from where it is, with no jump.
    kit.setOccupied((x, y) => x === 5 && y === 3);
    kit.update(0.1, 0);
    const up = kit.debug.lowAt(5, 3);
    kit.setOccupied(() => false);
    kit.update(0.02, 0);
    expect(kit.debug.lowAt(5, 3)).toBeLessThan(up);
    expect(kit.debug.lowAt(5, 3)).toBeGreaterThan(0);
    kit.dispose();
    free.dispose();
  });
});

describe('the low form costs no geometry and no draw calls', () => {
  it('setOccupied and update touch one tiny texture: no mesh, no draw call, no vertex buffer changes', () => {
    const kit = createTerrainKit(boardInput(stressRows(25, 19)));
    const meshes = meshesOf(kit.group);
    const calls = kit.stats.drawCalls;
    const children = kit.group.children.length;
    // Today's draw calls on the 25 x 19 stress board (shadow pass included), measured before this change: 16.
    expect(calls).toBe(16);
    const versions = meshes.map((m) => Object.values(m.geometry.attributes).map((a) => (a as BufferAttribute).version));
    const uuids = meshes.map((m) => m.geometry.uuid);
    const occ = kit.debug.uniforms().occMap;
    const occVersion = occ.version;
    for (let i = 0; i < 30; i++) {
      kit.setOccupied((x, y) => (x + y + i) % 3 === 0);
      kit.update(1 / 60, i / 60);
    }
    expect(kit.stats.drawCalls).toBe(calls);
    expect(kit.group.children.length).toBe(children);
    expect(meshesOf(kit.group).map((m) => m.geometry.uuid)).toEqual(uuids);
    expect(meshes.map((m) => Object.values(m.geometry.attributes).map((a) => (a as BufferAttribute).version))).toEqual(versions);
    expect(occ.version, 'the low map is what changed').toBeGreaterThan(occVersion);
    // Every merged prop that casts a shadow draws it with the sinking depth material, so the shadow shrinks with the building.
    for (const m of meshes) {
      if (['terrain:solid', 'terrain:glossy', 'terrain:windows'].includes(m.name)) expect(m.customDepthMaterial, m.name).toBe(kit.debug.materials().sinkDepth);
    }
    kit.dispose();
  });

  it('the draw calls on every shipped board are the same with a unit on every property as with none', () => {
    const kit = createTerrainKit(boardInput(stressRows(25, 19)));
    const before = kit.stats.drawCalls;
    kit.setOccupied(() => true);
    run(kit, 0.3);
    expect(kit.stats.drawCalls).toBe(before);
    expect(kit.stats.meshes).toBe(meshesOf(kit.group).length);
    kit.dispose();
  });
});

describe('the shader arithmetic', () => {
  it('lowFormY squashes only what sinks, toward the pad, by exactly the low form', () => {
    expect(lowFormY(1.06, 1, 0.06, 0)).toBe(1.06);
    expect(lowFormY(1.06, 1, 0.06, 1)).toBeCloseTo(0.06 + 1.0 * 0.25, 9);
    expect(lowFormY(0.56, 1, 0.06, 0.5)).toBeCloseTo(0.06 + 0.5 * (1 - 0.75 * 0.5), 9);
    expect(lowFormY(1.06, 0, 0.06, 1)).toBe(1.06); // a part that stays does not move
    expect(lowFormY(0.06, 1, 0.06, 1)).toBe(0.06); // and the pad's own top is a fixed point
  });

  it('the GLSL carries the same numbers, so the mirror cannot drift from what the GPU runs', () => {
    const kit = make();
    const solid = kit.debug.materials().solid;
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
    solid.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('attribute vec2 aSink;');
    expect(shader.vertexShader).toContain('texture2D( uOccMap, transformed.xz / uOccSize ).r');
    expect(shader.vertexShader).toContain(`( 1.0 - ${(1 - LOW_FORM).toFixed(2)} * trnLow )`);
    expect(shader.uniforms.uOccSize.value).toBeDefined();
    kit.dispose();
  });
});

describe('known-bad: implementations that must fail', () => {
  it('a stub that ignores setOccupied fails the lowering check', () => {
    const kit = make();
    const free = make();
    const stub: TerrainView = { ...kit, setOccupied: () => undefined };
    expect(() => assertLowersExactly(stub, kit, free, new Set([key(1, 1), key(5, 3)]))).toThrow();
    // ... and the real one, run through the very same check, passes it.
    const real = make();
    expect(() => assertLowersExactly(real, real, free, new Set([key(1, 1), key(5, 3)]))).not.toThrow();
    kit.dispose();
    free.dispose();
    real.dispose();
  });

  it('a stub that lowers every property, whoever stands there, fails the "leaves the others alone" check', () => {
    const kit = make();
    const free = make();
    const stub: TerrainView = { ...kit, setOccupied: () => kit.setOccupied(() => true) };
    expect(() => assertLowersExactly(stub, kit, free, new Set([key(1, 1)]))).toThrow();
    kit.dispose();
    free.dispose();
  });

  it('a lowering that also sinks the banner and the pad fails the "stays" check', () => {
    const free = make();
    const kit = make();
    // Sabotage: mark every vertex of the solid bucket as sinking, so the pad and the banner pole sink with the towers.
    const solid = meshesOf(kit.group).find((m) => m.name === 'terrain:solid')!;
    const f = solid.geometry.getAttribute('aSink') as BufferAttribute;
    for (let i = 0; i < f.count; i++) f.setXY(i, 1, 0.06);
    expect(() => assertLowersExactly(kit, kit, free, new Set([key(1, 1)]))).toThrow();
    kit.dispose();
    free.dispose();
  });
});

describe('the other tiles and views', () => {
  it('a board with no properties accepts setOccupied and does nothing', () => {
    const kit = createTerrainKit(boardInput(['.f^', '=#r', '~sg']));
    expect(() => { kit.setOccupied(() => true); kit.update(1, 0); }).not.toThrow();
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) expect(kit.debug.lowAt(x, y)).toBe(0);
    kit.dispose();
  });

  it('an occupied property is still a property: owner change and capture keep working while it is low', () => {
    const kit = make();
    kit.setOccupied((x, y) => x === 1 && y === 1);
    run(kit, 0.3);
    kit.setOwners((x, y) => (x === 1 && y === 1 ? 4 : null));
    expect(kit.debug.factionAt(1, 1)).toBe('choir');
    kit.setCapture((x, y) => (x === 1 && y === 1 ? 1 : 0));
    expect(kit.debug.captureAt(1, 1)).toBe(255);
    expect(kit.debug.lowAt(1, 1)).toBe(1);
    kit.dispose();
  });

  it('dispose frees the extra depth material and the low map with everything else', () => {
    const kit = make();
    const mats: Material[] = Object.values(kit.debug.materials());
    expect(mats).toContain(kit.debug.materials().sinkDepth);
    kit.dispose();
    expect(kit.live()).toEqual({ geometries: 0, materials: 0, textures: 0 });
  });
});
