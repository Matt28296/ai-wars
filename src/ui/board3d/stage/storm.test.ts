// The ion-storm static against known answers: the same seed gives the same flecks, the wrap is exact, the count halves under reduced
// motion, it is one draw call and only while the storm shows, and everything it makes is freed. The shader's placement rule is tested
// through `fleckAt`, which is that rule in plain maths (the picture is checked by the screenshots).
import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import {
  STORM_MAX, STORM_MIN, STORM_REDUCED_DENSITY, createStormStatic, fleck, fleckAt, stormBox, stormCount,
} from './storm';
import type { Fleck, StormBox } from './storm';

const board = { width: 14, height: 10 };
const box = stormBox(board);

describe('the flecks', () => {
  it('are a pure function of (seed, index): the same inputs give the same fleck, other inputs give another', () => {
    expect(fleck(7, 3, box)).toEqual(fleck(7, 3, box));
    expect(fleck(7, 3, box)).not.toEqual(fleck(8, 3, box)); // another seed
    expect(fleck(7, 3, box)).not.toEqual(fleck(7, 4, box)); // another fleck
    const a: Fleck[] = []; const b: Fleck[] = [];
    for (let i = 0; i < 50; i++) { a.push(fleck(123, i, box)); b.push(fleck(123, i, box)); }
    expect(a).toEqual(b);
  });

  it('start inside the box, with sizes and phases in range', () => {
    for (let i = 0; i < 300; i++) {
      const f = fleck(99, i, box);
      expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x).toBeLessThan(box.size.x);
      expect(f.y).toBeGreaterThanOrEqual(0); expect(f.y).toBeLessThan(box.size.y);
      expect(f.z).toBeGreaterThanOrEqual(0); expect(f.z).toBeLessThan(box.size.z);
      expect(f.phase).toBeGreaterThanOrEqual(0); expect(f.phase).toBeLessThan(1);
      expect(f.size).toBeGreaterThan(0.01); expect(f.size).toBeLessThan(0.1);
    }
  });

  it('are spread over the box, not clumped (a quarter of them in each half of x)', () => {
    let west = 0;
    for (let i = 0; i < 800; i++) if (fleck(5, i, box).x < box.size.x / 2) west++;
    expect(west).toBeGreaterThan(300);
    expect(west).toBeLessThan(500);
  });
});

describe('where a fleck is at a time (the shader\'s rule, in plain maths)', () => {
  const tiny: StormBox = { min: { x: -1, y: 0, z: -1 }, size: { x: 10, y: 4, z: 8 } };
  const f: Fleck = { x: 1, y: 3.5, z: 7, vx: 0.5, vy: 0.25, vz: -1, phase: 0, size: 0.05 };

  it('is the start plus the drift times the time, wrapped into the box, worked out by hand', () => {
    // t = 0: the start, offset by the box origin
    expect(fleckAt(f, tiny, 0)).toEqual({ x: 0, y: 3.5, z: 6 });
    // t = 30: x 1 + 15 = 16 -> 6 (wrapped once), y 3.5 + 7.5 = 11 -> 3, z 7 - 30 = -23 -> 1 (wrapped from below)
    const p = fleckAt(f, tiny, 30);
    expect(p.x).toBeCloseTo(-1 + 6, 12);
    expect(p.y).toBeCloseTo(0 + 3, 12);
    expect(p.z).toBeCloseTo(-1 + 1, 12);
  });

  it('never leaves the box, at any time, including negative and enormous ones', () => {
    for (let i = 0; i < 100; i++) {
      const g = fleck(11, i, box);
      for (const t of [0, 0.016, 1, 17.3, 999.9, 86400, -5, -1234.5]) {
        const p = fleckAt(g, box, t);
        expect(p.x).toBeGreaterThanOrEqual(box.min.x - 1e-9); expect(p.x).toBeLessThan(box.min.x + box.size.x + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(box.min.y - 1e-9); expect(p.y).toBeLessThan(box.min.y + box.size.y + 1e-9);
        expect(p.z).toBeGreaterThanOrEqual(box.min.z - 1e-9); expect(p.z).toBeLessThan(box.min.z + box.size.z + 1e-9);
      }
    }
  });

  it('drifts: it moves with the clock, the same clock gives the same place, and a bad clock gives the start', () => {
    const g = fleck(11, 2, box);
    const a = fleckAt(g, box, 4);
    expect(fleckAt(g, box, 4)).toEqual(a);
    expect(fleckAt(g, box, 5)).not.toEqual(a);
    expect(fleckAt(g, box, NaN)).toEqual(fleckAt(g, box, 0));
  });

  it('holds still with the motion off (reduced motion), wherever the clock is', () => {
    const g = fleck(11, 2, box);
    expect(fleckAt(g, box, 0, 0)).toEqual(fleckAt(g, box, 1234, 0));
    expect(fleckAt(g, box, 0, 0)).toEqual(fleckAt(g, box, 0, 1));
    expect(fleckAt(g, box, 1234, 1)).not.toEqual(fleckAt(g, box, 0, 1)); // known-bad: with the motion on it does move
  });
});

describe('how many', () => {
  it('scales with the board between the bounds', () => {
    expect(stormCount({ width: 14, height: 10 })).toBe(700); // 140 tiles x 5
    expect(stormCount({ width: 2, height: 2 })).toBe(STORM_MIN);
    expect(stormCount({ width: 23, height: 23 })).toBe(STORM_MAX);
    expect(stormCount({ width: 25, height: 15 })).toBe(STORM_MAX);
  });

  it('the box is the board plus its reach, above the ground', () => {
    expect(box.min.x).toBeLessThan(0);
    expect(box.size.x).toBeGreaterThan(board.width);
    expect(box.size.z).toBeGreaterThan(board.height);
    expect(box.min.y).toBeGreaterThan(0);
  });
});

describe('createStormStatic', () => {
  it('is deterministic: the same seed gives identical buffers, another seed gives other ones', () => {
    const a = createStormStatic(board, 42);
    const b = createStormStatic(board, 42);
    const c = createStormStatic(board, 43);
    const arr = (s: ReturnType<typeof createStormStatic>, name: string): number[] => [...(s.points.geometry.getAttribute(name).array as Float32Array)];
    for (const name of ['position', 'aDrift', 'aFleck']) expect(arr(a, name)).toEqual(arr(b, name));
    expect(arr(a, 'position')).not.toEqual(arr(c, 'position'));
    for (const s of [a, b, c]) s.dispose();
  });

  it('puts fleck() in its buffers, so the CPU rule and the GPU rule read the same numbers', () => {
    const s = createStormStatic(board, 42);
    const pos = s.points.geometry.getAttribute('position');
    const drift = s.points.geometry.getAttribute('aDrift');
    const info = s.points.geometry.getAttribute('aFleck');
    for (const i of [0, 1, 17, 350, 699]) {
      const f = fleck(42, i, box);
      expect([pos.getX(i), pos.getY(i), pos.getZ(i)]).toEqual([f.x, f.y, f.z].map(Math.fround));
      expect([drift.getX(i), drift.getY(i), drift.getZ(i)]).toEqual([f.vx, f.vy, f.vz].map(Math.fround));
      expect([info.getX(i), info.getY(i)]).toEqual([f.phase, f.size].map(Math.fround));
    }
    expect(pos.count).toBe(stormCount(board));
    s.dispose();
  });

  it('is ONE draw call while the storm shows, and none while it does not', () => {
    const s = createStormStatic(board, 1);
    expect(s.stats()).toMatchObject({ visible: false, drawCalls: 0, drawn: 0 }); // before the first update: nothing
    s.update(1, 0, false);
    expect(s.points.visible).toBe(false); // no storm: not drawn at all
    expect(s.stats().drawCalls).toBe(0);
    s.update(1, 0.5, false);
    expect(s.points.visible).toBe(true);
    expect(s.stats().drawCalls).toBe(1);
    expect(s.points.isPoints).toBe(true);
    expect(Array.isArray(s.points.material)).toBe(false); // one material: one call
    s.update(1, 0, false);
    expect(s.stats().drawCalls).toBe(0);
    s.dispose();
  });

  it('draws half the flecks under reduced motion, all of them otherwise (known-bad: the two are not the same count)', () => {
    const s = createStormStatic(board, 1);
    const n = stormCount(board);
    s.update(2, 1, false);
    expect(s.stats().drawn).toBe(n);
    expect(s.points.geometry.drawRange.count).toBe(n);
    s.update(2, 1, true);
    expect(STORM_REDUCED_DENSITY).toBe(0.5);
    expect(s.stats().drawn).toBe(Math.floor(n / 2));
    expect(s.points.geometry.drawRange.count).toBe(Math.floor(n / 2));
    expect(s.stats().drawn).toBeLessThan(n);
    s.update(2, 1, false); // and it follows the setting back
    expect(s.points.geometry.drawRange.count).toBe(n);
    s.dispose();
  });

  it('runs on the clock it is given: the time uniform follows, and reduced motion stops the drift and the flicker', () => {
    const s = createStormStatic(board, 1);
    const u = (s.points.material as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    s.update(3.25, 1, false);
    expect(u.uTime.value).toBe(3.25);
    expect(u.uMotion.value).toBe(1);
    s.update(9, 1, true);
    expect(u.uMotion.value).toBe(0);
    expect(u.uStrength.value).toBe(1);
    s.update(9, 0.4, false);
    expect(u.uStrength.value).toBeCloseTo(0.4, 12);
    s.update(9, NaN, false); // a bad strength draws nothing rather than everything
    expect(s.points.visible).toBe(false);
    s.update(9, 7, false); // and a strength over 1 is 1
    expect(u.uStrength.value).toBe(1);
    s.dispose();
  });

  it('sizes the flecks from the viewport: a taller picture asks for more pixels per world unit', () => {
    const s = createStormStatic(board, 1);
    const u = (s.points.material as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
    s.update(0, 1, false, 600, 30);
    const small = u.uPxPerWorld.value;
    s.update(0, 1, false, 1200, 30);
    expect(u.uPxPerWorld.value).toBeCloseTo(small * 2, 9);
    expect(small).toBeCloseTo(600 / (2 * Math.tan((15 * Math.PI) / 180)), 9);
    s.dispose();
  });

  it('is never frustum-culled (the shader moves the flecks) and blends additively without writing depth', () => {
    const s = createStormStatic(board, 1);
    expect(s.points.frustumCulled).toBe(false);
    const m = s.points.material as unknown as { depthWrite: boolean; transparent: boolean };
    expect(m.depthWrite).toBe(false);
    expect(m.transparent).toBe(true);
    s.dispose();
  });

  it('frees its geometry and material, and leaves its parent, when disposed; and does nothing after', () => {
    const s = createStormStatic(board, 1);
    let geometryFreed = 0;
    let materialFreed = 0;
    s.points.geometry.addEventListener('dispose', () => { geometryFreed++; });
    (s.points.material as unknown as { addEventListener(t: string, f: () => void): void }).addEventListener('dispose', () => { materialFreed++; });
    const parent = new Group();
    parent.add(s.points);
    expect(geometryFreed + materialFreed).toBe(0); // known-bad: nothing is freed before dispose
    expect(parent.children).toHaveLength(1);
    s.dispose();
    s.dispose();
    expect(geometryFreed).toBe(1);
    expect(materialFreed).toBe(1);
    expect(parent.children).toHaveLength(0);
    s.update(1, 1, false); // after dispose: no throw and no revival
    expect(s.points.visible).toBe(false);
  });
});
