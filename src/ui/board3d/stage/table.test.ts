// The war-room table against known answers: at most three draw calls, a plinth that hugs the board without covering it, a trim ring whose
// area is worked out by hand, a neutral trim colour, a table that is darker than the board, a backdrop that follows the camera, and
// everything it makes is freed.
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, ShaderLib, Vector3 } from 'three';
import type { ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../content/maps';
import { FACTION_ACCENT, FACTION_COLOR, TERRAIN_COLOR } from '../palette';
import { luminanceOf, saturationOf } from './lighting';
import {
  FRAME_TOP, FRAME_WIDTH, PLATE_WIDTH, TABLE_DRAW_CALL_BUDGET, TABLE_FAR, TABLE_NEAR, TABLE_Y, TRIM_COLOR, TRIM_FROM, TRIM_TO, buildPlinth,
  countDrawCalls, createTable,
} from './table';

const BOARDS = Object.values(MAPS).map((m) => ({ id: m.id, board: { width: m.terrain[0].length, height: m.terrain.length } }));
const calder = { width: 14, height: 10 };

describe('the draw-call budget', () => {
  for (const { id, board } of BOARDS) {
    it(`${id} (${board.width}x${board.height}): the table adds at most ${TABLE_DRAW_CALL_BUDGET} draw calls, none of them multi-material, none casting a shadow`, () => {
      const t = createTable(board);
      expect(t.stats().drawCalls).toBeLessThanOrEqual(TABLE_DRAW_CALL_BUDGET);
      expect(t.stats().drawCalls).toBe(3); // plinth, tabletop, backdrop
      const meshes: Mesh[] = [];
      t.group.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
      expect(meshes).toHaveLength(3);
      for (const m of meshes) {
        expect(Array.isArray(m.material), m.name).toBe(false);
        expect(m.castShadow, m.name).toBe(false);
      }
      t.dispose();
    });
  }

  it('countDrawCalls counts what the renderer would draw: known-bad groups over the budget are counted as over it', () => {
    const g = new Group();
    const geo = new BufferGeometry();
    const mat = new MeshBasicMaterial();
    for (let i = 0; i < 4; i++) g.add(new Mesh(geo, mat));
    expect(countDrawCalls(g)).toBe(4);
    expect(countDrawCalls(g)).toBeGreaterThan(TABLE_DRAW_CALL_BUDGET);
    const multi = new Group();
    multi.add(new Mesh(geo, [mat, mat, mat]));
    expect(countDrawCalls(multi)).toBe(3); // one per material
    const hidden = new Group();
    const m = new Mesh(geo, mat);
    m.visible = false;
    hidden.add(m);
    expect(countDrawCalls(hidden)).toBe(0); // an invisible mesh costs nothing
  });
});

describe('the plinth', () => {
  const { geometry, triangles } = buildPlinth(calder);
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const glow = geometry.getAttribute('aGlow');

  it('has a vertex, a normal, a colour and a glow for every corner of every triangle', () => {
    expect(pos.count).toBe(triangles * 3);
    expect(nor.count).toBe(pos.count);
    expect(geometry.getAttribute('color').count).toBe(pos.count);
    expect(glow.count).toBe(pos.count);
    expect(triangles).toBeGreaterThan(40);
    expect(triangles).toBeLessThan(200);
  });

  it('hugs the board: nothing of it is inside the board\'s rectangle, and it reaches out exactly PLATE_WIDTH', () => {
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const z = pos.getZ(i);
      const strictlyInside = x > 1e-9 && x < calder.width - 1e-9 && z > 1e-9 && z < calder.height - 1e-9;
      expect(strictlyInside, `vertex ${i} (${x}, ${z})`).toBe(false);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    expect(minX).toBeCloseTo(-PLATE_WIDTH, 6);
    expect(maxX).toBeCloseTo(calder.width + PLATE_WIDTH, 6);
    expect(minZ).toBeCloseTo(-PLATE_WIDTH, 6);
    expect(maxZ).toBeCloseTo(calder.height + PLATE_WIDTH, 6);
  });

  it('stands on the tabletop and stays below the board\'s own surface (the tallest part is the trim, a hair above the frame)', () => {
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < pos.count; i++) { lo = Math.min(lo, pos.getY(i)); hi = Math.max(hi, pos.getY(i)); }
    expect(lo).toBeCloseTo(TABLE_Y, 6); // the buffer is 32-bit floats
    expect(hi).toBeCloseTo(FRAME_TOP + 0.004, 6);
    expect(hi).toBeLessThan(0); // below the flat ground (0) so the board's own rim reads
  });

  it('every face points away from the solid: up, or outward from the board (a flipped face would be culled and leave a hole)', () => {
    const cx = calder.width / 2; const cz = calder.height / 2;
    /** The first vertex whose normal is wrong, or -1. `sign` -1 flips every normal (the known-bad plinth). */
    const firstBad = (sign: number): number => {
      for (let i = 0; i < nor.count; i++) {
        const nx = sign * nor.getX(i); const ny = sign * nor.getY(i); const nz = sign * nor.getZ(i);
        if (Math.abs(Math.hypot(nx, ny, nz) - 1) > 1e-5) return i;
        if (ny < -1e-6) return i;
        // a wall or a chamfer must lean away from the centre in plan
        const away = nx * (pos.getX(i) - cx) + nz * (pos.getZ(i) - cz);
        if (Math.abs(ny) < 0.999 && away <= 0) return i;
      }
      return -1;
    };
    expect(firstBad(1)).toBe(-1);
    expect(firstBad(-1)).toBeGreaterThanOrEqual(0); // known-bad: every normal flipped is refused by the same check
  });

  it('has a trim ring of exactly the area the plan says, with no gap or overlap at the corners (mitred)', () => {
    // area of the ring between the loops TRIM_FROM and TRIM_TO round a w x h board: (w + 2b)(h + 2b) - (w + 2a)(h + 2a)
    const w = calder.width; const h = calder.height; const a = TRIM_FROM; const b = TRIM_TO;
    const expected = (w + 2 * b) * (h + 2 * b) - (w + 2 * a) * (h + 2 * a);
    let area = 0;
    for (let t = 0; t < pos.count; t += 3) {
      if (glow.getX(t) === 0) continue;
      const ux = pos.getX(t + 1) - pos.getX(t); const uy = pos.getY(t + 1) - pos.getY(t); const uz = pos.getZ(t + 1) - pos.getZ(t);
      const vx = pos.getX(t + 2) - pos.getX(t); const vy = pos.getY(t + 2) - pos.getY(t); const vz = pos.getZ(t + 2) - pos.getZ(t);
      area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    }
    expect(area).toBeCloseTo(expected, 4); // 32-bit positions
    expect(area).toBeGreaterThan(1.5); // not an empty ring
    // only the trim glows: every glowing vertex is at the trim's height, every other vertex does not glow
    for (let i = 0; i < pos.count; i++) {
      if (glow.getX(i) > 0) expect(pos.getY(i)).toBeCloseTo(FRAME_TOP + 0.004, 6);
      else expect(glow.getX(i)).toBe(0);
    }
  });

  it('keeps the frame narrower than the base plate, so the plate shows as a step', () => {
    expect(FRAME_WIDTH).toBeLessThan(PLATE_WIDTH);
    expect(TRIM_TO).toBeLessThan(FRAME_WIDTH);
    expect(TRIM_FROM).toBeLessThan(TRIM_TO);
  });

  it('is built for any board size from the size alone (a 1x1 board still gives a closed, well-formed plinth)', () => {
    const tiny = buildPlinth({ width: 1, height: 1 });
    expect(tiny.triangles).toBe(triangles);
    expect(tiny.geometry.getAttribute('position').count).toBe(pos.count);
  });
});

describe('the colours: furniture, not faction', () => {
  it('the trim is a NEUTRAL pale steel: low saturation and none of the faction colours or accents', () => {
    expect(saturationOf(TRIM_COLOR)).toBeLessThan(0.3);
    for (const c of [...Object.values(FACTION_COLOR), ...Object.values(FACTION_ACCENT)]) expect(c).not.toBe(TRIM_COLOR);
    // known-bad: a faction accent is far more saturated than the trim, so the measure can tell them apart
    expect(saturationOf(FACTION_ACCENT.helion)).toBeGreaterThan(0.3);
  });

  it('the table is darker than the board: even its brightest colour stays well under the darkest terrain family', () => {
    const darkestTerrain = Math.min(...Object.values(TERRAIN_COLOR).map((c) => luminanceOf(c.base)));
    expect(luminanceOf(TABLE_NEAR)).toBeLessThan(darkestTerrain * 0.5);
    expect(luminanceOf(TABLE_FAR)).toBeLessThan(luminanceOf(TABLE_NEAR)); // deep navy near, near-black far
    expect(luminanceOf(TABLE_FAR)).toBeLessThan(0.05);
    // known-bad: a light grey table would fail the same bound
    expect(luminanceOf(0x808080)).toBeGreaterThan(darkestTerrain * 0.5);
  });
});

describe('the glow patch on the standard material', () => {
  it('adds the per-vertex glow to the emissive light, and keeps every chunk it patched', () => {
    const t = createTable(calder);
    const plinth = t.group.getObjectByName('table-plinth') as Mesh;
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: ShaderLib.standard.vertexShader,
      fragmentShader: ShaderLib.standard.fragmentShader,
    };
    (plinth.material as unknown as { onBeforeCompile: (s: typeof shader) => void }).onBeforeCompile(shader);
    expect(shader.vertexShader).toContain('attribute float aGlow');
    expect(shader.vertexShader).toContain('vGlow = aGlow;');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += uTrim * vGlow;');
    expect(shader.vertexShader).toContain('#include <begin_vertex>'); // the original chunk is still there
    expect(shader.fragmentShader).toContain('#include <emissivemap_fragment>');
    expect(shader.uniforms.uTrim).toBeTruthy();
    // known-bad: the unpatched shader has none of it (so the checks above can fail)
    expect(ShaderLib.standard.fragmentShader).not.toContain('uTrim');
    t.dispose();
  });
});

describe('following the camera and the weather', () => {
  const uniformsOf = (t: ReturnType<typeof createTable>, name: string): Record<string, { value: unknown }> =>
    ((t.group.getObjectByName(name) as Mesh).material as ShaderMaterial).uniforms;

  it('the backdrop dome sits on the camera, wherever it goes', () => {
    const t = createTable(calder);
    const dome = t.group.getObjectByName('table-backdrop')!;
    t.update(new Vector3(7, 17, 25), 0, 0);
    expect(dome.position.toArray()).toEqual([7, 17, 25]);
    t.update(new Vector3(-3, 9, 40), 0, 0);
    expect(dome.position.toArray()).toEqual([-3, 9, 40]);
    expect((dome as Mesh).frustumCulled).toBe(false);
    t.dispose();
  });

  it('a storm cools the table and a lightning flash lifts it for the strike; both are bounded and a bad number does nothing', () => {
    const t = createTable(calder);
    const u = uniformsOf(t, 'table-top');
    const near0 = (u.uNear.value as { getHex(): number }).getHex();
    t.update(new Vector3(0, 10, 10), 1, 0);
    const near1 = (u.uNear.value as { getHex(): number }).getHex();
    expect(near1).not.toBe(near0);
    expect(u.uBoost.value).toBe(1);
    t.update(new Vector3(0, 10, 10), 1, 1);
    expect(u.uBoost.value as number).toBeGreaterThan(1.5);
    expect(u.uBoost.value as number).toBeLessThan(2.1);
    t.update(new Vector3(0, 10, 10), 99, -4); // out of range: clamped
    expect(u.uBoost.value).toBe(1);
    t.update(new Vector3(0, 10, 10), NaN, NaN); // NaN: treated as 0, never written into a uniform
    expect((u.uNear.value as { getHex(): number }).getHex()).toBe(near0);
    expect(u.uBoost.value).toBe(1);
    t.dispose();
  });

  it('shares its colours with the dome, so the two cannot drift apart', () => {
    const t = createTable(calder);
    expect(uniformsOf(t, 'table-backdrop').uFar).toBe(uniformsOf(t, 'table-top').uFar);
    t.dispose();
  });

  it('draws the backdrop last and at the far plane, so it fills only what nothing else covers', () => {
    const t = createTable(calder);
    const dome = t.group.getObjectByName('table-backdrop') as Mesh;
    expect(dome.renderOrder).toBeGreaterThan(0);
    expect(((dome.material) as ShaderMaterial).vertexShader).toContain('.xyww');
    expect(((dome.material) as ShaderMaterial).depthWrite).toBe(false);
    t.dispose();
  });
});

describe('disposing', () => {
  it('frees every geometry and material it made, leaves the scene, and does nothing a second time', () => {
    const scene = new Group();
    const t = createTable(calder);
    scene.add(t.group);
    expect(t.live()).toEqual({ geometries: 3, materials: 3 }); // known-bad: before dispose they are alive
    expect(scene.children).toHaveLength(1);
    t.dispose();
    expect(t.live()).toEqual({ geometries: 0, materials: 0 });
    expect(scene.children).toHaveLength(0);
    expect(t.group.children).toHaveLength(0);
    t.dispose();
    t.update(new Vector3(0, 0, 0), 1, 1); // no throw after dispose
    expect(t.live()).toEqual({ geometries: 0, materials: 0 });
  });

  it('a rebuilt table for another board does not leak the first one\'s resources', () => {
    const a = createTable(calder);
    a.dispose();
    const b = createTable({ width: 23, height: 23 });
    expect(a.live()).toEqual({ geometries: 0, materials: 0 });
    expect(b.live()).toEqual({ geometries: 3, materials: 3 });
    b.dispose();
  });
});
