// The quality tiers' rules, in node: what each tier is, how the start tier is chosen, what `?quality=` forces, and the one-way adaptive
// step. Expected values here are written from the spec (a software renderer starts low, a strong GPU starts high, a spike is not a
// stretch, the tier never climbs), never read back from the implementation.
import { describe, expect, it } from 'vitest';
import {
  ADAPT, AdaptiveQuality, REMEMBER_KEY, REMEMBER_MS, RENDER_SCALES, TIERS, TIER_ORDER, WIDE_CANVAS_PX, chooseStartTier, isRenderScale, isSoftwareRenderer, passNames,
  qualityFromSearch, readRemembered, readSignals, scaleBelow, scaleFloorFor, scaleFromSearch, tierBelow, writeRemembered,
} from './quality';
import type { GlLike, QualitySignals, QualityTier, StorageLike } from './quality';

const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const LLVMPIPE = 'ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)';
const BASIC = 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)';
const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
const APPLE = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';
const RADEON = 'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)';
const INTEL = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';

describe('the tiers are what the order says', () => {
  it('high is occlusion + bloom + FXAA on a 2048 shadow map; medium drops the occlusion and halves the map; low drops the bloom and caps the pixel ratio at 1', () => {
    expect(TIERS.high).toEqual({ ao: true, bloom: true, fxaa: true, shadowMapSize: 2048, maxPixelRatio: 2 });
    expect(TIERS.medium).toEqual({ ao: false, bloom: true, fxaa: true, shadowMapSize: 1024, maxPixelRatio: 2 });
    expect(TIERS.low).toEqual({ ao: false, bloom: false, fxaa: true, shadowMapSize: 1024, maxPixelRatio: 1 });
    expect([...TIER_ORDER]).toEqual(['high', 'medium', 'low']);
  });

  it('each tier lists exactly its passes, in order, and every tier keeps the output (tone mapping) and the vignette', () => {
    expect(passNames('high')).toEqual(['RenderPass', 'GTAOPass', 'UnrealBloomPass', 'OutputPass', 'FXAA', 'Vignette']);
    expect(passNames('medium')).toEqual(['RenderPass', 'UnrealBloomPass', 'OutputPass', 'FXAA', 'Vignette']);
    expect(passNames('low')).toEqual(['RenderPass', 'OutputPass', 'FXAA', 'Vignette']);
  });

  it('tierBelow steps one tier down and stops at the bottom', () => {
    expect(tierBelow('high')).toBe('medium');
    expect(tierBelow('medium')).toBe('low');
    expect(tierBelow('low')).toBeNull();
  });
});

describe('?quality= forces a tier', () => {
  it('reads high, medium and low, in any case, anywhere in the query', () => {
    expect(qualityFromSearch('?quality=high')).toBe('high');
    expect(qualityFromSearch('?quality=medium')).toBe('medium');
    expect(qualityFromSearch('quality=low')).toBe('low');
    expect(qualityFromSearch('?renderer=3d&quality=LOW&x=1')).toBe('low');
    expect(qualityFromSearch('?quality=%48igh')).toBe('high'); // percent-encoded
  });

  it('asks for nothing when it is absent, unknown, empty or malformed (known-bad: none of these is a tier)', () => {
    for (const s of ['', '?', '?renderer=2d', '?quality=', '?quality=ultra', '?quality=0', '?qualit=low', '?xquality=low', '?quality=%E0%A4%A', '?quality=high,low']) {
      expect(qualityFromSearch(s), s).toBeNull();
    }
  });
});

describe('the start tier from cheap signals', () => {
  const strong: QualitySignals = { renderer: RTX, maxTextureSize: 16384, hardwareConcurrency: 16, devicePixelRatio: 2 };

  it('a software renderer starts at low, whatever else is strong (SwiftShader, llvmpipe, the Basic Render Driver; any case)', () => {
    for (const r of [SWIFTSHADER, LLVMPIPE, BASIC, SWIFTSHADER.toUpperCase(), 'Google SwiftShader', 'softpipe', 'Apple Software Renderer']) {
      expect(isSoftwareRenderer(r), r).toBe(true);
      expect(chooseStartTier({ ...strong, renderer: r }), r).toBe('low');
    }
  });

  it('a strong GPU starts at high, and none of the real GPU strings is taken for a software renderer', () => {
    for (const r of [RTX, APPLE, RADEON, INTEL]) {
      expect(isSoftwareRenderer(r), r).toBe(false);
      expect(chooseStartTier({ ...strong, renderer: r }), r).toBe('high');
    }
  });

  it('a signal that is missing never lowers the tier: no signals at all is high', () => {
    expect(chooseStartTier({})).toBe('high');
    expect(chooseStartTier({ renderer: null, maxTextureSize: null, hardwareConcurrency: null, devicePixelRatio: null })).toBe('high');
    expect(chooseStartTier({ maxTextureSize: Number.NaN, hardwareConcurrency: Number.NaN })).toBe('high');
    expect(isSoftwareRenderer(undefined)).toBe(false);
    expect(isSoftwareRenderer('')).toBe(false);
  });

  it('a small MAX_TEXTURE_SIZE, few cores or a phone-dense screen each cap the tier (by hand-written thresholds)', () => {
    const cases: [QualitySignals, QualityTier][] = [
      [{ maxTextureSize: 16384 }, 'high'],
      [{ maxTextureSize: 8192 }, 'high'],
      [{ maxTextureSize: 4096 }, 'medium'],
      [{ maxTextureSize: 2048 }, 'low'],
      [{ hardwareConcurrency: 8 }, 'high'],
      [{ hardwareConcurrency: 6 }, 'high'],
      [{ hardwareConcurrency: 4 }, 'medium'],
      [{ hardwareConcurrency: 2 }, 'low'],
      [{ hardwareConcurrency: 1 }, 'low'],
      [{ devicePixelRatio: 1 }, 'high'],
      [{ devicePixelRatio: 2 }, 'high'],
      [{ devicePixelRatio: 3 }, 'medium'],
    ];
    for (const [s, want] of cases) expect(chooseStartTier({ ...strong, ...s }), JSON.stringify(s)).toBe(want);
  });

  it('the cheapest cap wins when several signals object', () => {
    expect(chooseStartTier({ ...strong, hardwareConcurrency: 4, maxTextureSize: 2048 })).toBe('low');
    expect(chooseStartTier({ ...strong, hardwareConcurrency: 4, devicePixelRatio: 3 })).toBe('medium');
    expect(chooseStartTier({ renderer: SWIFTSHADER, hardwareConcurrency: 64 })).toBe('low');
  });

  it('prefers-reduced-motion is not a signal: it is about motion, not speed', () => {
    const withMotion = { ...strong, prefersReducedMotion: true } as QualitySignals;
    expect(chooseStartTier(withMotion)).toBe(chooseStartTier(strong));
  });
});

describe('reading the signals off a context', () => {
  const gl = (over: Partial<GlLike> & { renderer?: string | null; max?: number | null } = {}): GlLike => ({
    MAX_TEXTURE_SIZE: 0x0d33,
    RENDERER: 0x1f01,
    getExtension: (name) => (name === 'WEBGL_debug_renderer_info' && over.renderer !== null ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
    getParameter: (p) => (p === 0x9246 ? over.renderer ?? SWIFTSHADER : p === 0x0d33 ? over.max ?? 8192 : undefined),
    ...over,
  });

  it('gives the unmasked renderer string and MAX_TEXTURE_SIZE, plus what the page offers', () => {
    expect(readSignals(gl(), { hardwareConcurrency: 8, devicePixelRatio: 2 })).toEqual({
      hardwareConcurrency: 8, devicePixelRatio: 2, renderer: SWIFTSHADER, maxTextureSize: 8192,
    });
  });

  it('copes with a browser that withholds the renderer string, a context that throws, and no context at all', () => {
    expect(readSignals(gl({ renderer: null }), {}).renderer).toBeUndefined();
    const boom = { ...gl(), getExtension: () => { throw new Error('denied'); }, getParameter: () => { throw new Error('denied'); } } as GlLike;
    expect(readSignals(boom, { hardwareConcurrency: 4 })).toEqual({ hardwareConcurrency: 4, devicePixelRatio: null });
    expect(readSignals(null, { devicePixelRatio: 1 })).toEqual({ hardwareConcurrency: null, devicePixelRatio: 1 });
    expect(chooseStartTier(readSignals(null))).toBe('high');
  });

  it('a software renderer read off a context starts low end to end', () => {
    expect(chooseStartTier(readSignals(gl({ renderer: LLVMPIPE }), { hardwareConcurrency: 16, devicePixelRatio: 1 }))).toBe('low');
    expect(chooseStartTier(readSignals(gl({ renderer: RTX, max: 16384 }), { hardwareConcurrency: 16, devicePixelRatio: 1 }))).toBe('high');
  });
});

// ---------------------------------------------------------------- the adaptive step

/** A frame-time trace: [ms, count] runs. Time starts at 1000 and each frame ends when it has taken its ms. */
type Run = [ms: number, count: number];

interface Chooser { readonly tier: QualityTier; push(frameMs: number, nowMs: number): QualityTier | null }

/** Feeds a trace to a chooser and returns the tier after every frame, with the time of every change. */
function drive(c: Chooser, trace: Run[]): { tiers: QualityTier[]; changes: { at: number; to: QualityTier }[]; end: number } {
  let now = 1000;
  const tiers: QualityTier[] = [];
  const changes: { at: number; to: QualityTier }[] = [];
  for (const [ms, count] of trace) {
    for (let i = 0; i < count; i++) {
      now += ms;
      const before = c.tier;
      c.push(ms, now);
      tiers.push(c.tier);
      if (c.tier !== before) changes.push({ at: now, to: c.tier });
    }
  }
  return { tiers, changes, end: now };
}

/** The invariant: a tier sequence never moves to a BETTER tier than it was at. */
function neverClimbs(tiers: QualityTier[]): boolean {
  const rank = (t: QualityTier): number => TIER_ORDER.indexOf(t);
  for (let i = 1; i < tiers.length; i++) if (rank(tiers[i]) < rank(tiers[i - 1])) return false;
  return true;
}

const WARM: Run = [16, ADAPT.warmupFrames]; // the warm-up frames the step ignores
const FAST = (n: number): Run => [16, n];
const SLOW = (n: number): Run => [40, n];

describe('the adaptive step drops one tier after a sustained slow stretch', () => {
  it('stays put on fast frames, however many', () => {
    const a = new AdaptiveQuality('high');
    const r = drive(a, [WARM, FAST(2000)]);
    expect(a.tier).toBe('high');
    expect(r.changes).toEqual([]);
  });

  it('drops high to medium after a 2 s stretch of 40 ms frames, and not before the stretch has lasted about 2 s', () => {
    const a = new AdaptiveQuality('high');
    const r = drive(a, [WARM, SLOW(100)]);
    const slowStart = 1000 + WARM[0] * WARM[1];
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].to).toBe('medium');
    const lasted = r.changes[0].at - slowStart;
    expect(lasted).toBeGreaterThanOrEqual(ADAPT.windowMs * 0.9); // 1.8 s of slow frames at the least
    expect(lasted).toBeLessThanOrEqual(ADAPT.windowMs + 400); // and no more than a little over the window
    // known-bad: one second of slow frames is not a stretch
    const b = new AdaptiveQuality('high');
    drive(b, [WARM, SLOW(25)]);
    expect(b.tier).toBe('high');
  });

  it('goes down one tier at a time: high to medium to low, each after its own full stretch, and then stops', () => {
    const a = new AdaptiveQuality('high');
    const r = drive(a, [WARM, SLOW(400)]);
    expect(r.changes.map((c) => c.to)).toEqual(['medium', 'low']);
    expect(r.changes[1].at - r.changes[0].at).toBeGreaterThanOrEqual(ADAPT.windowMs * 0.9); // the second needs a fresh window
    expect(a.tier).toBe('low');
    expect(a.push(500, r.end + 500)).toBeNull(); // nothing is below low
    expect(a.tier).toBe('low');
  });

  it('a single spike never drops it, nor do a few long frames in a row (a tab switch, a garbage collection, a shader compile)', () => {
    for (const spike of [[600, 1], [300, 3], [1500, 1], [5000, 1]] as Run[]) {
      const a = new AdaptiveQuality('high');
      const r = drive(a, [WARM, FAST(60), spike, FAST(200)]);
      expect(a.tier, JSON.stringify(spike)).toBe('high');
      expect(r.changes).toEqual([]);
    }
  });

  it('judges the median, not the mean: a window that is mostly fast with a heavy tail is fine, one that is mostly slow is not', () => {
    // 60% of the frames at 16 ms and 40% at 100 ms: the mean is 49.6 ms, the median is 16 ms
    const mixed: Run[] = [];
    for (let i = 0; i < 100; i++) mixed.push([16, 3], [100, 2]);
    const a = new AdaptiveQuality('high');
    drive(a, [WARM, ...mixed]);
    expect(a.tier).toBe('high');
    // 60% at 40 ms and 40% at 16 ms: the median is 40 ms
    const mostlySlow: Run[] = [];
    for (let i = 0; i < 100; i++) mostlySlow.push([40, 3], [16, 2]);
    const b = new AdaptiveQuality('high');
    drive(b, [WARM, ...mostlySlow]);
    expect(b.tier).not.toBe('high');
  });

  it('ignores the warm-up frames: a slow start (shader compiles) is not a slow device', () => {
    const a = new AdaptiveQuality('high');
    drive(a, [[200, ADAPT.warmupFrames], FAST(500)]);
    expect(a.tier).toBe('high');
  });

  it('notices a very slow device (4 fps) too: the window keeps enough frames to judge', () => {
    const a = new AdaptiveQuality('high');
    const r = drive(a, [WARM, [250, 40]]);
    expect(r.changes.length).toBeGreaterThanOrEqual(1);
    expect(r.changes[0].to).toBe('medium');
  });

  it('refuses nonsense frames (zero, negative, NaN, infinite) without a drop or a throw', () => {
    const a = new AdaptiveQuality('high');
    drive(a, [WARM]);
    for (const ms of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(a.push(ms, 5000)).toBeNull();
    expect(a.push(40, Number.NaN)).toBeNull();
    expect(a.tier).toBe('high');
  });
});

describe('it never climbs back on its own', () => {
  const oscillating: Run[] = [WARM];
  for (let i = 0; i < 6; i++) oscillating.push(SLOW(80), FAST(200)); // 3.2 s slow, then 3.2 s fast, six times

  it('after a drop, a long fast stretch leaves the tier where it is', () => {
    const a = new AdaptiveQuality('high');
    drive(a, [WARM, SLOW(100)]);
    expect(a.tier).toBe('medium');
    drive(a, [FAST(5000)]);
    expect(a.tier).toBe('medium');
  });

  it('a trace that alternates slow and fast stretches only ever moves down (no oscillation)', () => {
    const a = new AdaptiveQuality('high');
    const r = drive(a, oscillating);
    expect(neverClimbs(r.tiers)).toBe(true);
    expect(a.tier).toBe('low'); // it did react to the slow stretches
    expect(new Set(r.tiers).size).toBe(3); // high, medium and low all appeared, in that order
  });

  it('KNOWN-BAD: a planted chooser that climbs back on a fast stretch is caught by the same check', () => {
    /** The oscillating chooser the order warns about: it drops on a slow window and climbs on a fast one. */
    class Oscillating implements Chooser {
      tier: QualityTier = 'high';
      private recent: number[] = [];
      push(frameMs: number): QualityTier | null {
        this.recent.push(frameMs);
        if (this.recent.length > 30) this.recent.shift();
        if (this.recent.length < 30) return null;
        const median = [...this.recent].sort((x, y) => x - y)[15];
        const i = TIER_ORDER.indexOf(this.tier);
        if (median > ADAPT.slowMs && i < 2) this.tier = TIER_ORDER[i + 1];
        else if (median < 20 && i > 0) this.tier = TIER_ORDER[i - 1]; // the climb
        else return null;
        this.recent = [];
        return this.tier;
      }
    }
    const bad = drive(new Oscillating(), oscillating);
    expect(neverClimbs(bad.tiers)).toBe(false); // the check refuses it
    // and the check is not vacuous: it accepts the real step on the very same trace
    expect(neverClimbs(drive(new AdaptiveQuality('high'), oscillating).tiers)).toBe(true);
  });
});

// ---------------------------------------------------------------- the render scale below the lowest tier (P1)

/** Feeds a trace and returns every (tier, scale) change in order, so a drop of either kind is seen. */
function driveScale(a: AdaptiveQuality, trace: Run[], from = 1000): { states: string[]; end: number } {
  let now = from;
  const states: string[] = [];
  let last = `${a.tier}@${a.scale}`;
  for (const [ms, count] of trace) {
    for (let i = 0; i < count; i++) {
      now += ms;
      a.push(ms, now);
      const cur = `${a.tier}@${a.scale}`;
      if (cur !== last) {
        states.push(cur);
        last = cur;
      }
    }
  }
  return { states, end: now };
}

describe('the render scale is a short ladder, written out here', () => {
  it('is 1, 0.85, 0.7, 0.5, and each step down is the next number on it', () => {
    expect([...RENDER_SCALES]).toEqual([1, 0.85, 0.7, 0.5]);
    expect(scaleBelow(1)).toBe(0.85);
    expect(scaleBelow(0.85)).toBe(0.7);
    expect(scaleBelow(0.7)).toBe(0.5);
    expect(scaleBelow(0.5)).toBeNull();
    expect(scaleBelow(0.6)).toBeNull(); // not on the ladder: no step from it
    for (const v of [1, 0.85, 0.7, 0.5]) expect(isRenderScale(v), String(v)).toBe(true);
    for (const v of [0, 0.6, 2, -1, Number.NaN, '1', null]) expect(isRenderScale(v), String(v)).toBe(false);
  });
});

describe('?scale= pins the render scale', () => {
  it('reads the four scales anywhere in the query', () => {
    expect(scaleFromSearch('?scale=1')).toBe(1);
    expect(scaleFromSearch('?scale=0.85')).toBe(0.85);
    expect(scaleFromSearch('scale=0.7')).toBe(0.7);
    expect(scaleFromSearch('?quality=low&scale=0.5&probe=motion')).toBe(0.5);
    expect(scaleFromSearch('?scale=0%2E5')).toBe(0.5); // percent-encoded
  });

  it('asks for nothing when it is absent, unknown, empty or malformed (known-bad: none of these is a scale)', () => {
    for (const s of ['', '?', '?scale=', '?scale=0', '?scale=0.6', '?scale=2', '?scale=.5', '?scale=1.0', '?scale=0.50', '?scale=%201', '?scale=abc', '?scale=0.5,1', '?scal=0.5', '?xscale=0.5', '?scale=%E0%A4%A', '?scale=-1', '?scale=1e0']) {
      expect(scaleFromSearch(s), s).toBeNull();
    }
  });
});

describe('the render scale steps down only from the lowest tier, only down, and only on a full slow window', () => {
  it('a tier above low drops the TIER first: the scale stays 1 all the way down to low', () => {
    const a = new AdaptiveQuality('high');
    const r = driveScale(a, [WARM, SLOW(400)]);
    expect(r.states.slice(0, 2)).toEqual(['medium@1', 'low@1']); // tiers first, scale untouched
    expect(r.states[2]).toBe('low@0.85'); // and only then the scale
  });

  it('at low it goes 1 -> 0.85 -> 0.7 -> 0.5, each after its own full window with its own warm-up, and then stops', () => {
    const a = new AdaptiveQuality('low');
    const r = driveScale(a, [WARM, SLOW(600)]);
    expect(r.states).toEqual(['low@0.85', 'low@0.7', 'low@0.5']);
    expect(a.tier).toBe('low');
    expect(a.scale).toBe(0.5);
    expect(a.push(500, r.end + 500)).toBeNull(); // nothing is below 0.5
    expect(a.scale).toBe(0.5);
  });

  it('each scale step needs a fresh window: two slow stretches of 1 s do not add up to one of 2 s', () => {
    // a window is windowMs (2 s) long; one second of slow frames, a pause of fast ones that cuts the window, then another second
    const a = new AdaptiveQuality('low');
    driveScale(a, [WARM, SLOW(25), FAST(200), SLOW(25), FAST(200)]);
    expect(a.scale).toBe(1);
    // known-bad: the same device with a full 2 s slow stretch does step
    const b = new AdaptiveQuality('low');
    driveScale(b, [WARM, SLOW(100)]);
    expect(b.scale).toBe(0.85);
  });

  it('the first window after a step is cut off by the warm-up: a slow start after the step does not step again at once', () => {
    const a = new AdaptiveQuality('low');
    const r = driveScale(a, [WARM, SLOW(100)]);
    expect(r.states).toEqual(['low@0.85']);
    // just the warm-up frames of slow, then nothing: no second step
    driveScale(a, [[200, ADAPT.warmupFrames]]);
    expect(a.scale).toBe(0.85);
  });

  it('a single spike, a few long frames, fast frames, and nonsense frames never step it', () => {
    for (const spike of [[600, 1], [300, 3], [1500, 1], [5000, 1]] as Run[]) {
      const a = new AdaptiveQuality('low');
      driveScale(a, [WARM, FAST(60), spike, FAST(200)]);
      expect(a.scale, JSON.stringify(spike)).toBe(1);
    }
    const f = new AdaptiveQuality('low');
    driveScale(f, [WARM, FAST(2000)]);
    expect(f.scale).toBe(1);
    for (const ms of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) f.push(ms, 99_999);
    expect(f.scale).toBe(1);
  });

  it('it never climbs: a long fast stretch after the steps leaves the scale where it is', () => {
    const a = new AdaptiveQuality('low');
    driveScale(a, [WARM, SLOW(200)]);
    const at = a.scale;
    expect(at).toBeLessThan(1);
    driveScale(a, [FAST(5000)]);
    expect(a.scale).toBe(at);
    expect(a.tier).toBe('low');
  });

  it('a pinned scale is never stepped, at any tier, and the tier still drops on its own', () => {
    const low = new AdaptiveQuality('low', {}, { scale: 0.7, pinned: true });
    driveScale(low, [WARM, SLOW(600)]);
    expect(low.scale).toBe(0.7);
    const high = new AdaptiveQuality('high', {}, { scale: 1, pinned: true });
    const r = driveScale(high, [WARM, SLOW(600)]);
    expect(r.states).toEqual(['medium@1', 'low@1']);
    expect(high.scale).toBe(1);
  });

  it('an unpinned scale may start below 1 and goes on from there; one that is not on the ladder starts at 1', () => {
    const a = new AdaptiveQuality('low', {}, { scale: 0.7 });
    expect(a.scale).toBe(0.7);
    driveScale(a, [WARM, SLOW(200)]);
    expect(a.scale).toBe(0.5);
    expect(new AdaptiveQuality('low', {}, { scale: 0.6 }).scale).toBe(1);
  });

  it('answers null for a scale step (it is not a tier drop), so a caller that only reads the answer never rebuilds the passes for it', () => {
    const a = new AdaptiveQuality('low');
    const answered: (QualityTier | null)[] = [];
    let now = 1000;
    for (let i = 0; i < ADAPT.warmupFrames + 100; i++) {
      now += i < ADAPT.warmupFrames ? 16 : 40;
      answered.push(a.push(i < ADAPT.warmupFrames ? 16 : 40, now));
    }
    expect(a.scale).toBe(0.85);
    expect(answered.every((v) => v === null)).toBe(true);
  });
});

// ---------------------------------------------------------------- a phone stops at 0.7

describe('the render scale stops at 0.7 on a narrow canvas and goes on to 0.5 on a wide one', () => {
  it('the floor is 0.5 from 960 CSS px up and 0.7 below it, and an unknown width counts as wide', () => {
    expect(WIDE_CANVAS_PX).toBe(960);
    expect(scaleFloorFor(960)).toBe(0.5);
    expect(scaleFloorFor(1280)).toBe(0.5);
    expect(scaleFloorFor(959)).toBe(0.7);
    expect(scaleFloorFor(959.9)).toBe(0.7);
    expect(scaleFloorFor(390)).toBe(0.7);
    expect(scaleFloorFor(1)).toBe(0.7);
    expect(scaleFloorFor(Number.POSITIVE_INFINITY)).toBe(0.5);
    expect(scaleFloorFor(Number.NaN)).toBe(0.5);
  });

  it('a 390 px canvas (a phone) steps 1 -> 0.85 -> 0.7 and stops, however slow it stays', () => {
    const a = new AdaptiveQuality('low');
    a.setCanvasWidth(390);
    const r = driveScale(a, [WARM, SLOW(1200)]);
    expect(r.states).toEqual(['low@0.85', 'low@0.7']);
    expect(a.scale).toBe(0.7);
    expect(a.push(500, r.end + 500)).toBeNull();
    expect(a.scale).toBe(0.7);
  });

  it('a 1280 px canvas (a desktop) goes on to 0.5, and a 960 px one too; 959 does not (known-bad: the narrow rule is not a vague "small")', () => {
    for (const [px, want] of [[1280, 0.5], [960, 0.5], [959, 0.7], [600, 0.7]] as const) {
      const a = new AdaptiveQuality('low');
      a.setCanvasWidth(px);
      driveScale(a, [WARM, SLOW(1200)]);
      expect(a.scale, `${px} px`).toBe(want);
    }
  });

  it('never raises a scale already in force: a canvas that narrows after 0.5 keeps it, and one that widens after 0.7 goes on from there', () => {
    const a = new AdaptiveQuality('low');
    a.setCanvasWidth(1280);
    const first = driveScale(a, [WARM, SLOW(1200)]);
    expect(a.scale).toBe(0.5);
    a.setCanvasWidth(390);
    driveScale(a, [FAST(100), SLOW(300)], first.end);
    expect(a.scale).toBe(0.5); // one-way: not put back up to 0.7
    const b = new AdaptiveQuality('low');
    b.setCanvasWidth(390);
    const second = driveScale(b, [WARM, SLOW(1200)]);
    expect(b.scale).toBe(0.7);
    b.setCanvasWidth(1280);
    driveScale(b, [SLOW(300)], second.end);
    expect(b.scale).toBe(0.5);
  });
});

// ---------------------------------------------------------------- what the device settled on, remembered

describe('the remembered tier and scale', () => {
  const NOW = 1_800_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const store = (text: string | null): StorageLike => ({ getItem: (k) => (k === REMEMBER_KEY ? text : null), setItem: () => undefined });
  const at = (ms: number, extra: Record<string, unknown> = {}): string => JSON.stringify({ tier: 'low', scale: 0.7, at: ms, ...extra });

  it('the key is versioned and the memory lasts 7 days', () => {
    expect(REMEMBER_KEY).toBe('aw.quality.v1');
    expect(REMEMBER_MS).toBe(7 * DAY);
  });

  it('a stored state that is fresh is read back: the tier and scale, not the time', () => {
    expect(readRemembered(store(at(NOW - 1000)), NOW)).toEqual({ tier: 'low', scale: 0.7 });
    expect(readRemembered(store(at(NOW - 6 * DAY - 23 * 3600_000)), NOW)).toEqual({ tier: 'low', scale: 0.7 });
    expect(readRemembered(store(at(NOW - REMEMBER_MS + 1)), NOW)).toEqual({ tier: 'low', scale: 0.7 }); // 1 ms before it expires
    expect(readRemembered(store(JSON.stringify({ tier: 'medium', scale: 1, at: NOW })), NOW)).toEqual({ tier: 'medium', scale: 1 });
  });

  it('an expired one is not: at exactly 7 days, and after', () => {
    expect(readRemembered(store(at(NOW - REMEMBER_MS)), NOW)).toBeNull();
    expect(readRemembered(store(at(NOW - 8 * DAY)), NOW)).toBeNull();
    expect(readRemembered(store(at(NOW - 400 * DAY)), NOW)).toBeNull();
  });

  it('a time from the future (a clock that was set back) is not believed beyond a few minutes of skew', () => {
    expect(readRemembered(store(at(NOW + 60_000)), NOW)).toEqual({ tier: 'low', scale: 0.7 });
    expect(readRemembered(store(at(NOW + 6 * 60_000)), NOW)).toBeNull();
    expect(readRemembered(store(at(NOW + 30 * DAY)), NOW)).toBeNull();
  });

  it('nothing stored, no storage, and anything that is not a state read as nothing (known-bad: each of these must not become a tier)', () => {
    expect(readRemembered(store(null), NOW)).toBeNull();
    expect(readRemembered(null, NOW)).toBeNull();
    expect(readRemembered(undefined, NOW)).toBeNull();
    for (const text of [
      '', 'nope', '{', 'null', '7', '[]', '"low"', '{}',
      JSON.stringify({ tier: 'ultra', scale: 0.7, at: NOW }), JSON.stringify({ tier: 'low', scale: 0.6, at: NOW }), JSON.stringify({ tier: 'low', scale: '0.7', at: NOW }),
      JSON.stringify({ tier: 'low', scale: 0.7 }), JSON.stringify({ tier: 'low', scale: 0.7, at: 'now' }), JSON.stringify({ tier: 'low', scale: 0.7, at: null }),
      JSON.stringify({ tier: 'LOW', scale: 0.7, at: NOW }), JSON.stringify({ scale: 0.7, at: NOW }), JSON.stringify({ tier: 'low', at: NOW }),
    ]) {
      expect(readRemembered(store(text), NOW), text).toBeNull();
    }
  });

  it('storage that throws, on the read or on the lookup, reads as nothing and never throws', () => {
    const boom: StorageLike = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(readRemembered(boom, NOW)).toBeNull();
    const lying = { getItem: () => 42 } as unknown as StorageLike;
    expect(readRemembered(lying, NOW)).toBeNull();
  });

  it('writing stores the tier, the scale and the time under the key, and says whether it did; a storage that throws, or none, says false and never throws', () => {
    const kept = new Map<string, string>();
    const ok: StorageLike = { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => { kept.set(k, v); } };
    expect(writeRemembered(ok, { tier: 'low', scale: 0.5 }, NOW)).toBe(true);
    expect(JSON.parse(kept.get(REMEMBER_KEY) as string)).toEqual({ tier: 'low', scale: 0.5, at: NOW });
    expect(readRemembered(ok, NOW + DAY)).toEqual({ tier: 'low', scale: 0.5 }); // what was written is what is read
    const boom: StorageLike = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(writeRemembered(boom, { tier: 'low', scale: 0.5 }, NOW)).toBe(false);
    expect(writeRemembered(null, { tier: 'low', scale: 0.5 }, NOW)).toBe(false);
    expect(writeRemembered(undefined, { tier: 'low', scale: 0.5 }, NOW)).toBe(false);
  });
});
