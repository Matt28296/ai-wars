// The effects kit, tested against known answers computed here: determinism and scrubbing, the edges of progress, the shell's arc,
// the debris count and ballistics, pooling, the light cap, hiding, dispose, and the number billboards (with a stub canvas).
// Everything runs in node: the kit builds geometry and materials without a GL context, and canvas use is guarded.
import { AdditiveBlending, BufferGeometry, Group, InstancedBufferGeometry, InterleavedBufferAttribute, Mesh, NormalBlending, PointLight, ShaderMaterial, Sprite, Vector3 } from 'three';
import type { Material, Texture } from 'three';
import v8 from 'node:v8';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fx3dKind, FxItem, FxView, NumberItem } from '../contract';
import { createFx, createFxKit, MAX_EFFECTS, MAX_LIGHTS, mulberry32, NUMBER_HEIGHT, numberPose, Rng, shellApex, shellPoint } from './index';
import type { FxKit } from './index';
import { SHAPE } from './shaders';

const KINDS: readonly Fx3dKind[] = ['muzzle', 'tracer', 'shell', 'hit', 'explosion', 'pulse', 'ambush', 'spawn'];
/** A progress at which each kind is at its brightest. */
const PEAK: Record<Fx3dKind, number> = { muzzle: 0.08, tracer: 0.4, shell: 0.5, hit: 0.08, explosion: 0.15, pulse: 0.5, ambush: 0.4, spawn: 0.35 };
const STRIDE = 16;
const ALPHA = 11;
const SHAPE_COL = 12;

const item = (kind: Fx3dKind, progress: number, seed = 7, color?: number): FxItem => ({
  kind,
  at: new Vector3(2, 0.3, 3),
  to: kind === 'muzzle' || kind === 'tracer' || kind === 'shell' ? new Vector3(5, 0.2, 1.5) : undefined,
  progress,
  seed,
  color,
});

type Batch = Mesh<InstancedBufferGeometry, ShaderMaterial>;
const batch = (view: FxView, name: string): Batch => view.group.getObjectByName(name) as Batch;

/** The instances a batch will draw this frame (a copy of the used front of its buffer). */
function used(view: FxView, name: string): Float32Array {
  const mesh = batch(view, name);
  const attr = mesh.geometry.getAttribute(name === 'fx-debris' ? 'iPos' : 'iA') as InterleavedBufferAttribute;
  return Float32Array.from((attr.data.array as Float32Array).subarray(0, mesh.geometry.instanceCount * STRIDE));
}

interface Snap { glow: Float32Array; smoke: Float32Array; debris: Float32Array; lights: number[] }
function snap(view: FxView): Snap {
  const lights: number[] = [];
  for (const o of view.group.children) {
    if (o instanceof PointLight) lights.push(o.position.x, o.position.y, o.position.z, o.color.r, o.color.g, o.color.b, o.intensity);
  }
  return { glow: used(view, 'fx-glow'), smoke: used(view, 'fx-smoke'), debris: used(view, 'fx-debris'), lights };
}

const finite = (a: ArrayLike<number>): boolean => {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
};
const maxAlpha = (a: Float32Array): number => {
  let m = 0;
  for (let i = ALPHA; i < a.length; i += STRIDE) m = Math.max(m, a[i]);
  return m;
};
const sumAlpha = (a: Float32Array): number => {
  let s = 0;
  for (let i = ALPHA; i < a.length; i += STRIDE) s += a[i];
  return s;
};
const maxColour = (a: Float32Array): number => {
  let m = 0;
  for (let i = 0; i < a.length; i += STRIDE) m = Math.max(m, a[i + 8], a[i + 9], a[i + 10]);
  return m;
};
const meshes = (view: FxView): Mesh[] => view.group.children.filter((o): o is Mesh => (o as Mesh).isMesh === true);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the seeded generator', () => {
  it('matches the published mulberry32 stream (known answers computed independently in Python)', () => {
    const one = mulberry32(1);
    expect([one(), one(), one(), one(), one()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849]);
    const b = mulberry32(12345);
    expect([b(), b(), b(), b(), b()]).toEqual([0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203, 0.5094283693470061]);
  });
  it('the reusable Rng gives the same stream, and resetting restarts it', () => {
    const r = new Rng();
    for (const seed of [0, 1, 7, 12345, 0xffffffff, -5]) {
      r.reset(seed);
      const ref = mulberry32(seed);
      for (let i = 0; i < 200; i++) expect(r.next()).toBe(ref());
    }
    r.reset(9);
    const first = [r.next(), r.next()];
    r.reset(9);
    expect([r.next(), r.next()]).toEqual(first);
  });
  it('stays inside [0, 1) and different seeds give different streams', () => {
    const r = new Rng().reset(3);
    for (let i = 0; i < 5000; i++) {
      const v = r.next();
      expect(v >= 0 && v < 1).toBe(true);
    }
    expect(new Rng().reset(1).next()).not.toBe(new Rng().reset(2).next());
  });
});

describe('determinism and scrubbing', () => {
  it('the same (kind, progress, seed) gives identical buffers on two separate kits', () => {
    const a = createFxKit();
    const b = createFxKit();
    for (const kind of KINDS) {
      for (const p of [0, 0.1, 0.35, 0.5, 0.8, 1]) {
        for (const seed of [1, 99]) {
          a.draw([item(kind, p, seed)]);
          b.draw([item(kind, p, seed)]);
          expect(snap(a), `${kind} p=${p} seed=${seed}`).toEqual(snap(b));
        }
      }
    }
  });
  it('scrubbing backwards shows exactly what going forwards showed at the same progress', () => {
    const kit = createFxKit();
    for (const kind of KINDS) {
      kit.draw([item(kind, 0.6, 5)]);
      const forward = snap(kit);
      kit.draw([item(kind, 0.1, 5)]);
      kit.draw([item(kind, 0.95, 5)]);
      kit.draw([item(kind, 0.6, 5)]);
      expect(snap(kit), kind).toEqual(forward);
    }
  });
  it('an effect does not depend on its neighbours in the list', () => {
    const kit = createFxKit();
    for (const kind of KINDS) {
      kit.draw([item(kind, PEAK[kind], 4)]);
      const alone = snap(kit);
      kit.draw([item(kind, PEAK[kind], 4), item('explosion', 0.3, 9), item('hit', 0.2, 3)]);
      const withOthers = snap(kit);
      // it was drawn first, so its instances are the front of every batch
      expect(withOthers.glow.subarray(0, alone.glow.length), kind).toEqual(alone.glow);
      expect(withOthers.smoke.subarray(0, alone.smoke.length), kind).toEqual(alone.smoke);
      expect(withOthers.debris.subarray(0, alone.debris.length), kind).toEqual(alone.debris);
    }
  });
  it('update() carries no state: calling it with any clock changes nothing', () => {
    const kit = createFxKit();
    kit.draw([item('explosion', 0.4, 2), item('shell', 0.5, 2)]);
    const before = snap(kit);
    kit.update(0.016, 1);
    kit.update(5, 12345);
    kit.draw([item('explosion', 0.4, 2), item('shell', 0.5, 2)]);
    expect(snap(kit)).toEqual(before);
  });
  it('different seeds scatter differently, the same seed always scatters the same', () => {
    const kit = createFxKit();
    for (const kind of ['muzzle', 'tracer', 'shell', 'hit', 'explosion', 'pulse', 'spawn'] as const) {
      kit.draw([item(kind, PEAK[kind], 1)]);
      const one = snap(kit);
      kit.draw([item(kind, PEAK[kind], 2)]);
      expect(snap(kit), kind).not.toEqual(one);
      kit.draw([item(kind, PEAK[kind], 1)]);
      expect(snap(kit), kind).toEqual(one);
    }
  });

  /** The determinism check itself: draw, move the wall clock and the random stream, draw again, compare. */
  function isDeterministic(make: () => FxView, items: FxItem[]): boolean {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, 100));
    const view = make();
    view.draw(items);
    const first = snap(view);
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0, 777));
    view.update(0.016, 99);
    view.draw(items);
    const second = snap(view);
    return JSON.stringify([Array.from(first.glow), first.lights]) === JSON.stringify([Array.from(second.glow), second.lights]);
  }
  const items = [item('explosion', 0.3, 3), item('hit', 0.2, 4), item('muzzle', 0.1, 5)];

  it('the check passes the real kit', () => {
    expect(isDeterministic(() => createFxKit(), items)).toBe(true);
  });
  it('KNOWN-BAD: an effect that reads the wall clock fails the determinism check', () => {
    const clockKit = (): FxView => {
      const inner = createFxKit();
      const data = (batch(inner, 'fx-glow').geometry.getAttribute('iA') as InterleavedBufferAttribute).data.array as Float32Array;
      return {
        ...inner,
        draw(list) {
          inner.draw(list);
          data[0] += (Date.now() % 1000) / 1000;
        },
      };
    };
    expect(isDeterministic(clockKit, items)).toBe(false);
  });
  it('KNOWN-BAD: an effect that uses Math.random fails the determinism check', () => {
    const randomKit = (): FxView => {
      const inner = createFxKit();
      const data = (batch(inner, 'fx-glow').geometry.getAttribute('iA') as InterleavedBufferAttribute).data.array as Float32Array;
      return {
        ...inner,
        draw(list) {
          inner.draw(list);
          data[1] += Math.random();
        },
      };
    };
    expect(isDeterministic(randomKit, items)).toBe(false);
  });
});

describe('the edges of progress', () => {
  it('every buffer is finite at progress 0, 1 and in between', () => {
    const kit = createFxKit();
    for (const kind of KINDS) {
      for (let i = 0; i <= 20; i++) {
        kit.draw([item(kind, i / 20, i)]);
        const s = snap(kit);
        expect(finite(s.glow) && finite(s.smoke) && finite(s.debris) && finite(s.lights), `${kind} p=${i / 20}`).toBe(true);
      }
    }
  });
  it('nothing is left at progress 1: no instance, no light, for every kind (the explosion smoke has faded to 0 alpha)', () => {
    const kit = createFxKit();
    for (const kind of KINDS) {
      for (const seed of [1, 2, 3, 40]) {
        kit.draw([item(kind, 1, seed)]);
        const s = snap(kit);
        expect(maxAlpha(s.glow), `${kind} glow`).toBe(0);
        expect(maxAlpha(s.smoke), `${kind} smoke`).toBe(0);
        expect(s.debris.length, `${kind} debris`).toBe(0);
        for (let i = 6; i < s.lights.length; i += 7) expect(s.lights[i], `${kind} light`).toBe(0);
        expect(kit.stats().instances).toEqual({ glow: 0, smoke: 0, debris: 0 });
      }
    }
  });
  it('the explosion smoke lingers late and fades to nothing exactly at progress 1', () => {
    const kit = createFxKit();
    kit.draw([item('explosion', 0.7, 2)]);
    const at70 = sumAlpha(snap(kit).smoke);
    kit.draw([item('explosion', 0.95, 2)]);
    const late = snap(kit);
    const at95 = sumAlpha(late.smoke);
    expect(at70).toBeGreaterThan(0.5);
    expect(at95).toBeGreaterThan(0);
    expect(at95).toBeLessThan(at70 * 0.3);
    expect(maxAlpha(late.glow)).toBe(0); // the fire is long gone while the smoke is still there
    kit.draw([item('explosion', 1, 2)]);
    expect(sumAlpha(snap(kit).smoke)).toBe(0);
  });
  it('the effects that start bright are already there at progress 0', () => {
    const kit = createFxKit();
    for (const kind of ['muzzle', 'tracer', 'shell', 'hit', 'explosion'] as const) {
      kit.draw([item(kind, 0, 1)]);
      expect(kit.stats().instances.glow, kind).toBeGreaterThan(0);
    }
  });
  it('every kind draws something at its peak', () => {
    const kit = createFxKit();
    for (const kind of KINDS) {
      kit.draw([item(kind, PEAK[kind], 1)]);
      expect(kit.stats().instances.glow, kind).toBeGreaterThan(0);
    }
  });
  it('progress outside 0..1, or not a number, draws nothing and is counted as skipped', () => {
    const kit = createFxKit();
    for (const p of [-0.01, 1.0000001, 2, NaN, Infinity]) {
      kit.draw([item('explosion', p)]);
      const st = kit.stats();
      expect(st.effects, `p=${p}`).toBe(0);
      expect(st.skipped).toBe(1);
      expect(st.instances).toEqual({ glow: 0, smoke: 0, debris: 0 });
    }
  });
  it('a tracer or shell with no end point draws nothing and does not throw', () => {
    const kit = createFxKit();
    for (const kind of ['tracer', 'shell'] as const) {
      const it: FxItem = { kind, at: new Vector3(1, 0, 1), progress: 0.5, seed: 1 };
      expect(() => kit.draw([it])).not.toThrow();
      expect(kit.stats().instances.glow).toBe(0);
    }
  });
  it('an unknown kind draws nothing and does not throw', () => {
    const kit = createFxKit();
    const bad = { ...item('hit', 0.3), kind: 'laser' } as unknown as FxItem;
    expect(() => kit.draw([bad])).not.toThrow();
    expect(kit.stats().instances).toEqual({ glow: 0, smoke: 0, debris: 0 });
  });
});

describe('the shell', () => {
  const A = new Vector3(1, 0.3, 1);
  const B = new Vector3(6, 0.1, 3);
  const dist = A.distanceTo(B);
  const out = { x: 0, y: 0, z: 0 };
  const at = (u: number): { x: number; y: number; z: number } => shellPoint(A.x, A.y, A.z, B.x, B.y, B.z, u, out);

  /** The property under test: the path rises clear above the straight line from start to end at every interior sample. */
  function arcsAbove(path: (u: number) => { x: number; y: number; z: number }, clearance: number): boolean {
    for (let u = 0.1; u < 0.95; u += 0.1) {
      const chord = A.y + (B.y - A.y) * u;
      if (!(path(u).y > chord + clearance)) return false;
    }
    return true;
  }

  it('starts at `at`, lands exactly on `to`, and arcs above the straight line between', () => {
    expect(at(0)).toEqual({ x: 1, y: 0.3, z: 1 });
    expect(at(1)).toEqual({ x: 6, y: 0.1, z: 3 });
    expect(arcsAbove(at, 0.3)).toBe(true);
    const mid = at(0.5);
    expect(mid.x).toBeCloseTo(3.5, 9);
    expect(mid.z).toBeCloseTo(2, 9);
    expect(mid.y).toBeGreaterThan((A.y + B.y) / 2 + shellApex(dist) * 0.99);
  });
  it('KNOWN-BAD: a straight-line path does not pass the arc check', () => {
    const straight = (u: number): { x: number; y: number; z: number } => ({ x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u, z: A.z + (B.z - A.z) * u });
    expect(arcsAbove(straight, 0.3)).toBe(false);
  });
  it('the apex grows with the distance of the shot and is capped', () => {
    expect(shellApex(2)).toBeLessThan(shellApex(4));
    expect(shellApex(4)).toBeLessThan(shellApex(8));
    expect(shellApex(1000)).toBe(shellApex(5000));
    expect(shellApex(1000)).toBeLessThan(4);
  });
  it('the drawn projectile follows that path: high at mid-flight, on `to` at the end, gone at 1', () => {
    const kit = createFxKit();
    const head = (p: number): { x: number; y: number; z: number } | null => {
      kit.draw([{ kind: 'shell', at: A, to: B, progress: p, seed: 3 }]);
      const g = used(kit, 'fx-glow');
      for (let i = 0; i < g.length; i += STRIDE) {
        if (g[i + SHAPE_COL] === SHAPE.CORE && g[i + 3] === Math.fround(0.075)) return { x: g[i], y: g[i + 1], z: g[i + 2] };
      }
      return null;
    };
    const mid = head(0.5);
    expect(mid).not.toBeNull();
    expect(mid!.y).toBeGreaterThan((A.y + B.y) / 2 + shellApex(dist) * 0.99);
    const late = head(0.97);
    expect(late).not.toBeNull();
    expect(Math.hypot(late!.x - B.x, late!.y - B.y, late!.z - B.z)).toBeLessThan(0.35);
    expect(head(1)).toBeNull();
  });
  it('the smoke trail stays on the arc behind the projectile', () => {
    const kit = createFxKit();
    kit.draw([{ kind: 'shell', at: A, to: B, progress: 0.6, seed: 3 }]);
    const s = used(kit, 'fx-smoke');
    expect(s.length / STRIDE).toBeGreaterThan(5);
    for (let i = 0; i < s.length; i += STRIDE) {
      expect(s[i]).toBeGreaterThanOrEqual(A.x - 0.5);
      expect(s[i]).toBeLessThan(A.x + (B.x - A.x) * 0.6); // x only advances: every puff is behind the head
    }
  });
});

describe('the explosion debris', () => {
  const debrisCount = (seed: number, density = false): number => {
    const kit = createFxKit();
    kit.setReducedMotion(density);
    kit.draw([item('explosion', 0.3, seed)]);
    return kit.stats().instances.debris;
  };
  it('throws 8 to 14 chunks, and both ends of that range occur', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) seen.add(debrisCount(seed));
    expect(Math.min(...seen)).toBe(8);
    expect(Math.max(...seen)).toBe(14);
  });
  it('reduced motion throws fewer chunks (never fewer than 5)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const full = debrisCount(seed);
      const reduced = debrisCount(seed, true);
      expect(reduced).toBeLessThanOrEqual(full);
      expect(reduced).toBeGreaterThanOrEqual(5);
    }
    expect(debrisCount(1, true)).toBeLessThan(debrisCount(1));
  });
  it('chunks fly on ballistic paths: a constant downward acceleration, never below the ground', () => {
    const kit = createFxKit();
    const heights = (p: number): number[] => {
      kit.draw([item('explosion', p, 11)]);
      const d = used(kit, 'fx-debris');
      const ys: number[] = [];
      for (let i = 0; i < d.length; i += STRIDE) ys.push(d[i + 1]);
      return ys;
    };
    const y1 = heights(0.1);
    const y2 = heights(0.2);
    const y3 = heights(0.3);
    expect(y1.length).toBe(y2.length);
    expect(y1.length).toBeGreaterThanOrEqual(8);
    const G = 7.5; // the kit's gravity, in height per progress squared; the second difference of a parabola is -G * dp^2
    for (let i = 0; i < y1.length; i++) {
      expect(y1[i] + y3[i] - 2 * y2[i]).toBeCloseTo(-G * 0.01, 4);
    }
    for (const p of [0, 0.15, 0.4, 0.6, 0.7]) for (const y of heights(p)) expect(y).toBeGreaterThanOrEqual(0.3);
  });
  it('a straight-line (non-ballistic) path would have no second difference, so the test above can tell', () => {
    const line = [0.1, 0.2, 0.3].map((p) => 2 + 3 * p);
    expect(line[0] + line[2] - 2 * line[1]).toBeCloseTo(0, 9);
    expect(Math.abs(line[0] + line[2] - 2 * line[1] + 7.5 * 0.01)).toBeGreaterThan(0.05);
  });
});

describe('look: additive, emissive, bloom-ready', () => {
  it('the glow batch is additive and does not write depth; smoke blends normally; debris is opaque', () => {
    const kit = createFxKit();
    const glow = batch(kit, 'fx-glow').material;
    expect(glow.blending).toBe(AdditiveBlending);
    expect(glow.depthWrite).toBe(false);
    expect(glow.transparent).toBe(true);
    expect(batch(kit, 'fx-smoke').material.blending).toBe(NormalBlending);
    expect(batch(kit, 'fx-debris').material.transparent).toBe(false);
  });
  it('every kind reaches an emissive colour above 1 (what the bloom pass picks up) at its peak', () => {
    const kit = createFxKit();
    for (const kind of KINDS) {
      kit.draw([item(kind, PEAK[kind], 1)]);
      expect(maxColour(used(kit, 'fx-glow')), kind).toBeGreaterThan(1);
    }
  });
  it('a tint changes the colours, and the default is kept when there is none', () => {
    const kit = createFxKit();
    kit.draw([item('muzzle', 0.1)]);
    const plain = used(kit, 'fx-glow');
    kit.draw([item('muzzle', 0.1, 7, 0x2f6fd8)]);
    const tinted = used(kit, 'fx-glow');
    expect(tinted).not.toEqual(plain);
    kit.draw([item('muzzle', 0.1)]);
    expect(used(kit, 'fx-glow')).toEqual(plain);
  });
});

describe('performance shape: pools, draw calls and the light cap', () => {
  const mixed = (n: number, seedBase = 0): FxItem[] => {
    const list: FxItem[] = [];
    for (let i = 0; i < n; i++) list.push(item(KINDS[(i + seedBase) % KINDS.length], 0.1 + ((i * 7 + seedBase) % 8) * 0.1, i + seedBase));
    return list;
  };
  const numbersList = (n: number, p: number): NumberItem[] =>
    Array.from({ length: n }, (_, i) => ({ at: new Vector3(i, 0.3, 1), text: i % 2 ? '+2' : '-42%', tone: i % 2 ? 'heal' : 'damage', progress: p }) as NumberItem);

  it('ten mixed effects draw through at most three instanced meshes, whatever they are', () => {
    const kit = createFxKit();
    kit.draw(mixed(10));
    const visible = meshes(kit).filter((m) => m.visible);
    expect(visible.length).toBeLessThanOrEqual(3);
    expect(kit.stats().drawCalls).toBeLessThanOrEqual(3);
    expect(kit.stats().instances.glow).toBeGreaterThan(50);
  });
  it('thirty effects fit in the batches with nothing dropped, even thirty explosions', () => {
    const kit = createFxKit();
    kit.draw(mixed(30));
    expect(kit.stats().dropped).toBe(0);
    kit.draw(Array.from({ length: 30 }, (_, i) => item('explosion', 0.2 + (i % 5) * 0.1, i)));
    const st = kit.stats();
    expect(st.effects).toBe(30);
    expect(st.dropped).toBe(0);
    expect(st.drawCalls).toBeLessThanOrEqual(3);
  });
  it('more than the cap are skipped and counted, never overflowing a buffer', () => {
    const kit = createFxKit();
    kit.draw(Array.from({ length: MAX_EFFECTS + 8 }, (_, i) => item('explosion', 0.3, i)));
    const st = kit.stats();
    expect(st.effects).toBe(MAX_EFFECTS);
    expect(st.skipped).toBe(8);
    expect(st.dropped).toBe(0);
  });
  it('pools do not grow after warm-up: same children, same buffers, same sprites, same lights', () => {
    const kit = createFxKit();
    const bufs = (): unknown[] => ['fx-glow', 'fx-smoke', 'fx-debris'].map((n) => (batch(kit, n).geometry.getAttribute(n === 'fx-debris' ? 'iPos' : 'iA') as InterleavedBufferAttribute).data.array);
    kit.draw(mixed(30));
    kit.numbers(numbersList(12, 0.4));
    const warm = { children: kit.group.children.length, pooled: kit.stats().pooled, bufs: bufs() };
    expect(warm.pooled.lights).toBe(MAX_LIGHTS);
    for (let f = 0; f < 300; f++) {
      kit.draw(mixed(1 + (f % 30), f));
      kit.numbers(numbersList(f % 13, (f % 10) / 10));
      expect(kit.group.children.length).toBe(warm.children);
    }
    expect(kit.stats().pooled).toEqual(warm.pooled);
    const after = bufs();
    warm.bufs.forEach((b, i) => expect(after[i]).toBe(b));
  });
  it('a long run retains nothing: heap after thousands of frames is where it started (and the known-bad leaker is caught)', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc') as () => void;
    const kit = createFxKit();
    const list = mixed(30);
    const nums = numbersList(8, 0.5);
    const retained = (frame: () => void): number => {
      for (let i = 0; i < 500; i++) frame();
      gc();
      const total = (): number => {
        const m = process.memoryUsage();
        return m.heapUsed + m.external; // typed-array backing stores live outside the JS heap
      };
      const before = total();
      for (let i = 0; i < 5000; i++) frame();
      gc();
      return total() - before;
    };
    const frame = (): void => {
      kit.draw(list);
      kit.numbers(nums);
    };
    const hoard: unknown[] = [];
    const leaky = (): void => {
      frame();
      hoard.push(new Float32Array(256)); // keeps a kilobyte a frame forever: the known-bad
    };
    expect(retained(frame)).toBeLessThan(400_000);
    expect(retained(leaky)).toBeGreaterThan(1_000_000);
  });
  it('the light pool holds four lights and keeps the four strongest pops when more are offered', () => {
    const kit = createFxKit();
    const power = (p: number): number => {
      kit.draw([item('muzzle', p, 1)]);
      return snap(kit).lights[6];
    };
    const progresses = [0.02, 0.05, 0.08, 0.12, 0.2, 0.3, 0.45, 0.6, 0.8, 0.9];
    const singles = progresses.map((p) => power(p)).sort((a, b) => b - a);
    kit.draw(progresses.map((p) => item('muzzle', p, 1)));
    const lights = snap(kit).lights;
    const got: number[] = [];
    for (let i = 6; i < lights.length; i += 7) got.push(lights[i]);
    expect(kit.group.children.filter((o) => o instanceof PointLight).length).toBe(4);
    expect(kit.stats().lights).toBe(4);
    expect(got.sort((a, b) => b - a)).toEqual(singles.slice(0, 4));
    expect(got.every((v) => v > 0)).toBe(true);
  });
  it('lights stay in the scene at intensity 0 when idle (so a first shot never recompiles the scene)', () => {
    const kit = createFxKit();
    kit.draw([item('muzzle', 0.08, 1)]);
    kit.draw([]);
    const lights = kit.group.children.filter((o): o is PointLight => o instanceof PointLight);
    expect(lights.length).toBe(4);
    for (const l of lights) {
      expect(l.visible).toBe(true);
      expect(l.intensity).toBe(0);
    }
  });
  it('a hundred frames of thirty effects take a small fraction of a frame budget each (a generous bound, not a benchmark)', () => {
    const kit = createFxKit();
    const list = mixed(30);
    for (let i = 0; i < 50; i++) kit.draw(list);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) kit.draw(list);
    expect((performance.now() - t0) / 100).toBeLessThan(5);
  });
});

describe('an empty list hides everything', () => {
  it('draw([]) hides every batch, zeroes every light and reports nothing drawn', () => {
    const kit = createFxKit();
    kit.draw([item('explosion', 0.3, 1), item('muzzle', 0.1, 2), item('pulse', 0.5, 3)]);
    expect(meshes(kit).some((m) => m.visible)).toBe(true);
    kit.draw([]);
    for (const m of meshes(kit)) {
      expect(m.visible).toBe(false);
      expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(0);
    }
    for (const o of kit.group.children) if (o instanceof PointLight) expect(o.intensity).toBe(0);
    const st = kit.stats();
    expect(st.effects).toBe(0);
    expect(st.drawCalls).toBe(0);
    expect(st.instances).toEqual({ glow: 0, smoke: 0, debris: 0 });
  });
  it('numbers([]) hides every number sprite', () => {
    const kit = createFxKit();
    kit.numbers([{ at: new Vector3(0, 0, 0), text: '-42%', tone: 'damage', progress: 0.5 }]);
    expect(kit.group.children.filter((o) => o instanceof Sprite && o.visible).length).toBe(1);
    kit.numbers([]);
    expect(kit.group.children.filter((o) => o instanceof Sprite && o.visible).length).toBe(0);
    expect(kit.stats().numbers).toBe(0);
  });
});

describe('dispose', () => {
  it('frees every geometry, material and texture the kit made, and empties the group', () => {
    const kit = createFxKit();
    kit.draw([item('explosion', 0.3, 1)]);
    kit.numbers([{ at: new Vector3(0, 0, 0), text: '+2', tone: 'heal', progress: 0.5 }]);
    const geos = new Set<BufferGeometry>();
    const mats = new Set<Material>();
    const texs = new Set<Texture>();
    kit.group.traverse((o) => {
      const m = o as Mesh | Sprite;
      if ((m as Mesh).isMesh) geos.add((m as Mesh).geometry);
      if (m.material) {
        mats.add(m.material as Material);
        const map = (m.material as unknown as { map?: Texture | null }).map;
        if (map) texs.add(map);
      }
    });
    expect(geos.size).toBe(3);
    expect(mats.size).toBeGreaterThanOrEqual(4);
    expect(texs.size).toBeGreaterThanOrEqual(1);
    const freed = new Set<unknown>();
    for (const r of [...geos, ...mats, ...texs]) r.addEventListener('dispose', () => freed.add(r));
    const lights = kit.group.children.filter((o): o is PointLight => o instanceof PointLight);
    expect(lights.length).toBe(4);
    kit.dispose();
    expect(freed.size).toBe(geos.size + mats.size + texs.size);
    expect(kit.group.children.length).toBe(0);
    // a disposed kit is inert: drawing into it neither throws nor revives anything
    expect(() => {
      kit.draw([item('hit', 0.3)]);
      kit.numbers([{ at: new Vector3(), text: '-1%', tone: 'damage', progress: 0.5 }]);
      kit.dispose();
    }).not.toThrow();
    expect(kit.group.children.length).toBe(0);
  });
});

describe('damage and heal numbers', () => {
  it('pop, rise and fade from progress alone: invisible at both ends, overshoots early, rises, fades late', () => {
    const o = { scale: 0, rise: 0, alpha: 0 };
    expect(numberPose(0, o).alpha).toBe(0);
    expect(numberPose(1, o).alpha).toBe(0);
    expect(numberPose(0.5, o).alpha).toBe(1);
    let peak = 0;
    for (let p = 0; p <= 0.3; p += 0.01) peak = Math.max(peak, numberPose(p, o).scale);
    expect(peak).toBeGreaterThan(1.02);
    expect(peak).toBeLessThan(1.25);
    expect(numberPose(0.3, o).scale).toBeCloseTo(1, 6);
    let last = -1;
    for (let p = 0; p <= 1; p += 0.05) {
      const r = numberPose(p, o).rise;
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
    last = 2;
    for (let p = 0.62; p <= 1; p += 0.05) {
      const a = numberPose(p, o).alpha;
      expect(a).toBeLessThanOrEqual(last);
      last = a;
    }
  });
  it('sprites rise and fade as their progress advances, and a number outside 0..1 is not shown', () => {
    const kit = createFxKit();
    const y = (p: number): { y: number; opacity: number; shown: number } => {
      kit.numbers([{ at: new Vector3(1, 0.5, 1), text: '-42%', tone: 'damage', progress: p }]);
      const s = kit.group.children.find((o): o is Sprite => o instanceof Sprite && o.visible);
      return { y: s ? s.position.y : NaN, opacity: s ? s.material.opacity : 0, shown: kit.stats().numbers };
    };
    const early = y(0.2);
    const late = y(0.8);
    expect(late.y).toBeGreaterThan(early.y);
    expect(early.opacity).toBe(1);
    expect(late.opacity).toBeLessThan(early.opacity);
    expect(y(1).shown).toBe(0);
    expect(y(0).shown).toBe(0);
    expect(y(-0.1).shown).toBe(0);
    expect(y(1.2).shown).toBe(0);
    expect(y(NaN).shown).toBe(0);
    expect(y(0.5).shown).toBe(1);
  });
  it('numbers are tall enough to read at the default zoom', () => {
    const kit = createFxKit();
    kit.numbers([{ at: new Vector3(), text: '-42%', tone: 'damage', progress: 0.4 }]);
    const s = kit.group.children.find((o): o is Sprite => o instanceof Sprite && o.visible)!;
    expect(s.scale.y).toBeCloseTo(NUMBER_HEIGHT, 6);
    expect(NUMBER_HEIGHT).toBeGreaterThanOrEqual(0.4);
  });

  /** A stub DOM with a recording 2D canvas, so the text path can run in node. */
  function stubCanvas(): { calls: string[]; created: () => number } {
    const calls: string[] = [];
    let made = 0;
    const ctx = {
      font: '', textAlign: '', textBaseline: '', lineJoin: '', miterLimit: 0, lineWidth: 0, strokeStyle: '', fillStyle: '' as unknown,
      measureText: (t: string) => ({ width: t.length * 30 }),
      strokeText: (t: string) => calls.push(`stroke:${t}:${ctx.lineWidth}:${ctx.strokeStyle}`),
      fillText: (t: string) => calls.push(`fill:${t}`),
      createLinearGradient: () => ({ addColorStop: (_o: number, c: string) => calls.push(`stop:${c}`) }),
    };
    vi.stubGlobal('document', { createElement: () => { made++; return { width: 0, height: 0, getContext: () => ctx }; } });
    return { calls, created: () => made };
  }

  it('draws dark-outlined text in red for damage and green for heal, outline first, and sizes the sprite to the text', () => {
    const stub = stubCanvas();
    const kit = createFxKit();
    kit.numbers([{ at: new Vector3(), text: '-42%', tone: 'damage', progress: 0.4 }, { at: new Vector3(), text: '+2', tone: 'heal', progress: 0.4 }]);
    const c = stub.calls;
    const strokeAt = c.findIndex((s) => s.startsWith('stroke:-42%'));
    const fillAt = c.findIndex((s) => s === 'fill:-42%');
    expect(strokeAt).toBeGreaterThanOrEqual(0);
    expect(strokeAt).toBeLessThan(fillAt);
    expect(c[strokeAt]).toMatch(/:rgba\(7,9,15,0\.9\d*\)$/); // dark
    expect(Number(c[strokeAt].split(':')[2])).toBeGreaterThanOrEqual(12); // a thick outline
    expect(c).toContain('stop:#ff3a3a');
    expect(c).toContain('stop:#2fe083');
    const sprites = kit.group.children.filter((o): o is Sprite => o instanceof Sprite && o.visible);
    const widthPx = Math.max(64, 4 * 30 + 52); // the stub measures 30 px a character; the layer pads 26 px each side; the canvas is 112 px tall
    expect(sprites[0].scale.x / sprites[0].scale.y).toBeCloseTo(widthPx / 112, 6);
    expect(sprites[0].material.map).not.toBe(sprites[1].material.map);
  });
  it('caches one texture per text and tone: repeating draws makes no new canvas', () => {
    const stub = stubCanvas();
    const kit = createFxKit();
    const n = (text: string, tone: 'damage' | 'heal'): NumberItem => ({ at: new Vector3(), text, tone, progress: 0.4 });
    for (let i = 0; i < 20; i++) kit.numbers([n('-42%', 'damage'), n('+2', 'heal'), n('-42%', 'damage')]);
    expect(kit.stats().pooled.numberTextures).toBe(2);
    expect(stub.created()).toBe(2);
    kit.numbers([n('-42%', 'heal')]);
    expect(kit.stats().pooled.numberTextures).toBe(3);
  });
  it('long text is cut to eight characters', () => {
    const stub = stubCanvas();
    const kit = createFxKit();
    kit.numbers([{ at: new Vector3(), text: '-123456789012', tone: 'damage', progress: 0.4 }]);
    expect(stub.calls.some((s) => s.startsWith('fill:-1234567:') || s === 'fill:-1234567')).toBe(true);
    expect(stub.calls.some((s) => s.includes('012'))).toBe(false);
  });
  it('the texture cache is bounded: old text is evicted and its texture disposed', () => {
    stubCanvas();
    const kit = createFxKit();
    const seen = new Set<Texture>();
    let freed = 0;
    for (let i = 0; i < 90; i++) {
      kit.numbers([{ at: new Vector3(), text: `n${i}`, tone: 'damage', progress: 0.4 }]);
      const s = kit.group.children.find((o): o is Sprite => o instanceof Sprite && o.visible)!;
      const map = s.material.map!;
      if (!seen.has(map)) {
        seen.add(map);
        map.addEventListener('dispose', () => { freed++; });
      }
    }
    expect(seen.size).toBe(90);
    expect(kit.stats().pooled.numberTextures).toBeLessThanOrEqual(64);
    expect(freed).toBe(90 - kit.stats().pooled.numberTextures);
  });
  it('dispose frees the cached text textures too', () => {
    stubCanvas();
    const kit = createFxKit();
    const textures: Texture[] = [];
    for (const [text, tone] of [['-1%', 'damage'], ['+3', 'heal']] as const) {
      kit.numbers([{ at: new Vector3(), text, tone, progress: 0.4 }]);
      textures.push(kit.group.children.find((o): o is Sprite => o instanceof Sprite && o.visible)!.material.map!);
    }
    let freed = 0;
    for (const t of textures) t.addEventListener('dispose', () => { freed++; });
    kit.dispose();
    expect(freed).toBe(2);
  });
});

describe('the contract', () => {
  it('createFx returns the FxView the renderer core draws with', () => {
    const fx = createFx();
    expect(fx.group).toBeInstanceOf(Group);
    expect(fx.group.name).toBe('fx');
    expect(typeof fx.draw).toBe('function');
    expect(typeof fx.numbers).toBe('function');
    expect(typeof fx.update).toBe('function');
    expect(typeof fx.dispose).toBe('function');
    fx.draw([item('hit', 0.3)]);
    fx.dispose();
  });
  it('reduced motion draws fewer particles in total, with the same shapes', () => {
    const kit: FxKit = createFxKit();
    kit.draw([item('explosion', 0.3, 5)]);
    const full = kit.stats().instances;
    kit.setReducedMotion(true);
    kit.draw([item('explosion', 0.3, 5)]);
    const reduced = kit.stats().instances;
    expect(reduced.glow).toBeLessThan(full.glow);
    expect(reduced.smoke).toBeLessThan(full.smoke);
    expect(reduced.glow).toBeGreaterThan(0);
    kit.setReducedMotion(false);
    kit.draw([item('explosion', 0.3, 5)]);
    expect(kit.stats().instances).toEqual(full);
  });
});
