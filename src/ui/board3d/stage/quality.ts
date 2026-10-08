// Quality tiers for the 3D stage (G12): what the post chain and the shadow map cost, and how the start tier is chosen and lowered. Pure
// numbers and rules, no three.js and no DOM, so the choosing is tested in node and the runtime only wires the answer to the GPU.
//
//   tier     passes (after the scene)                   shadow map   pixel ratio cap
//   high     ambient occlusion, bloom, FXAA              2048         2
//   medium   bloom, FXAA                                 1024         2
//   low      FXAA                                        1024         1
//
// Every tier also keeps the OutputPass (tone mapping and sRGB: without it the picture is wrong, not cheaper) and the light vignette
// (one tiny pass, and the picture's framing). They are the base of the chain, not features of a tier.
//
// The start tier is a guess from cheap signals; the adaptive step then corrects a guess that was too high. It only ever goes DOWN: a
// chooser that could climb back would oscillate (drop, speed up, climb, slow down, drop...), and every swap rebuilds passes and
// recompiles shaders, which is itself a stall. A guess that was too low costs a little polish for the session; one that was too high
// costs a stutter, so the start is optimistic and the correction is one-way.
import { SHADOW_MAP_SIZE } from './lighting';

export type QualityTier = 'high' | 'medium' | 'low';

/** Best first. A higher index is a cheaper tier. */
export const TIER_ORDER: readonly QualityTier[] = ['high', 'medium', 'low'];

export interface TierSpec {
  /** Ambient occlusion (GTAO) before the bloom. */
  ao: boolean;
  bloom: boolean;
  fxaa: boolean;
  /** Side of the sun's shadow map, in texels. */
  shadowMapSize: number;
  /** The most the canvas renders at per CSS pixel (device pixel ratio is capped to this). */
  maxPixelRatio: number;
}

export const TIERS: Readonly<Record<QualityTier, TierSpec>> = {
  high: { ao: true, bloom: true, fxaa: true, shadowMapSize: SHADOW_MAP_SIZE, maxPixelRatio: 2 },
  medium: { ao: false, bloom: true, fxaa: true, shadowMapSize: 1024, maxPixelRatio: 2 },
  low: { ao: false, bloom: false, fxaa: true, shadowMapSize: 1024, maxPixelRatio: 1 },
};

export const tierRank = (t: QualityTier): number => TIER_ORDER.indexOf(t);

/** The next cheaper tier, or null from the cheapest. */
export function tierBelow(t: QualityTier): QualityTier | null {
  return TIER_ORDER[tierRank(t) + 1] ?? null;
}

/** The cheaper of two tiers. */
export function cheaper(a: QualityTier, b: QualityTier): QualityTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

export function isTier(v: unknown): v is QualityTier {
  return v === 'high' || v === 'medium' || v === 'low';
}

/** The passes a tier builds after the scene, in order, by name: the tests and debug() read this, and the runtime builds exactly it. */
export function passNames(t: QualityTier): string[] {
  const s = TIERS[t];
  return ['RenderPass', ...(s.ao ? ['GTAOPass'] : []), ...(s.bloom ? ['UnrealBloomPass'] : []), 'OutputPass', ...(s.fxaa ? ['FXAA'] : []), 'Vignette'];
}

/** What the page address asks for: `?quality=high|medium|low`; anything else (or nothing) asks for nothing. */
export function qualityFromSearch(search: string): QualityTier | null {
  const q = search.startsWith('?') ? search.slice(1) : search;
  for (const part of q.split('&')) {
    const [key, value = ''] = part.split('=');
    if (key !== 'quality') continue;
    let v = value.toLowerCase();
    try {
      v = decodeURIComponent(value).toLowerCase();
    } catch {
      // a malformed escape is just not a request
    }
    if (isTier(v)) return v;
  }
  return null;
}

// ---------------------------------------------------------------- the start tier

/** What the page can tell cheaply. Any field may be missing (a browser that hides it, a test): a missing signal never lowers the tier. */
export interface QualitySignals {
  /** WEBGL_debug_renderer_info's unmasked renderer string when the browser gives it. */
  renderer?: string | null;
  /** gl.MAX_TEXTURE_SIZE. */
  maxTextureSize?: number | null;
  /** navigator.hardwareConcurrency (logical cores). */
  hardwareConcurrency?: number | null;
  devicePixelRatio?: number | null;
}

/** Renderer strings of CPU rasterisers: ANGLE's SwiftShader, Mesa's llvmpipe / softpipe / lavapipe, Windows' Basic Render Driver. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;

export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  return typeof renderer === 'string' && SOFTWARE_RENDERER.test(renderer);
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The tier to start at: the cheapest tier any signal allows, and 'high' when no signal objects.
 *   a software renderer                  -> low (a CPU cannot afford even the medium chain)
 *   MAX_TEXTURE_SIZE under 4096          -> low;  under 8192 -> medium (old and small phones; desktop GPUs say 16384 and up)
 *   2 or fewer logical cores             -> low;  4 or fewer -> medium
 *   devicePixelRatio of 3 or more        -> medium (a phone: three times the pixels per CSS pixel, and a small GPU for them)
 * `prefers-reduced-motion` is deliberately not a signal: it is about motion, not about how fast the device is.
 */
export function chooseStartTier(s: QualitySignals): QualityTier {
  let tier: QualityTier = 'high';
  if (isSoftwareRenderer(s.renderer)) tier = cheaper(tier, 'low');
  if (finite(s.maxTextureSize)) {
    if (s.maxTextureSize < 4096) tier = cheaper(tier, 'low');
    else if (s.maxTextureSize < 8192) tier = cheaper(tier, 'medium');
  }
  if (finite(s.hardwareConcurrency)) {
    if (s.hardwareConcurrency <= 2) tier = cheaper(tier, 'low');
    else if (s.hardwareConcurrency <= 4) tier = cheaper(tier, 'medium');
  }
  if (finite(s.devicePixelRatio) && s.devicePixelRatio >= 3) tier = cheaper(tier, 'medium');
  return tier;
}

/** The minimal slice of a WebGL context the signals need. */
export interface GlLike {
  getParameter(p: number): unknown;
  getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null;
  readonly RENDERER?: number;
  readonly MAX_TEXTURE_SIZE?: number;
}

/**
 * Reads the signals from a live context and the page. Each read is guarded: a context that throws, a browser that withholds the
 * renderer string, or a node test with no navigator all give a missing signal and never an exception.
 */
export function readSignals(gl: GlLike | null | undefined, page: { hardwareConcurrency?: number; devicePixelRatio?: number } = {}): QualitySignals {
  const out: QualitySignals = { hardwareConcurrency: page.hardwareConcurrency ?? null, devicePixelRatio: page.devicePixelRatio ?? null };
  if (!gl) return out;
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
    if (typeof name === 'string') out.renderer = name;
  } catch {
    // a browser that withholds it: the signal is simply missing
  }
  try {
    if (typeof gl.MAX_TEXTURE_SIZE === 'number') {
      const m = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      if (typeof m === 'number') out.maxTextureSize = m;
    }
  } catch {
    // missing
  }
  return out;
}

// ---------------------------------------------------------------- the adaptive step

export interface AdaptiveOptions {
  /** How long a slow stretch must last before it counts, in ms. */
  windowMs: number;
  /** The window's median frame time above which the tier drops, in ms. */
  slowMs: number;
  /** At least this many frames in the window (a window of three long frames is a hiccup, not a stretch). */
  minSamples: number;
  /** Frames ignored at the start and after every drop: the first frames compile shaders and upload textures. */
  warmupFrames: number;
}

export const ADAPT: Readonly<AdaptiveOptions> = { windowMs: 2000, slowMs: 24, minSamples: 8, warmupFrames: 20 };

/** The one-way adaptive step. Feed it every rendered frame's interval; it answers the new tier when it dropped. It has no way up. */
export class AdaptiveQuality {
  private current: QualityTier;
  private readonly opt: AdaptiveOptions;
  private samples: { t: number; ms: number }[] = [];
  private warm = 0;

  constructor(start: QualityTier, opt: Partial<AdaptiveOptions> = {}) {
    this.current = start;
    this.opt = { ...ADAPT, ...opt };
  }

  get tier(): QualityTier {
    return this.current;
  }

  /** The median frame interval of the current window, or null before there is one. */
  medianMs(): number | null {
    if (this.samples.length === 0) return null;
    const sorted = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * One frame took `frameMs` and ended at `nowMs`. Returns the tier it dropped to, or null. A drop needs a FULL window (the oldest frame
   * kept is at least 90% of the window old, and there are at least minSamples frames) whose median is over the limit, so one long frame
   * (a tab switch, a garbage collection, a shader compile) can never cause it; after a drop the window starts again from nothing.
   */
  push(frameMs: number, nowMs: number): QualityTier | null {
    if (!Number.isFinite(frameMs) || !Number.isFinite(nowMs) || frameMs <= 0) return null;
    if (this.warm < this.opt.warmupFrames) {
      this.warm++;
      return null;
    }
    this.samples.push({ t: nowMs, ms: frameMs });
    // keep the window's span, but never fewer than minSamples frames: a device at 2 fps would otherwise never hold enough to judge
    const cut = nowMs - this.opt.windowMs;
    while (this.samples.length > this.opt.minSamples && this.samples[0].t < cut) this.samples.shift();
    if (this.samples.length < this.opt.minSamples) return null;
    if (nowMs - this.samples[0].t < this.opt.windowMs * 0.9) return null;
    const median = this.medianMs();
    if (median === null || median <= this.opt.slowMs) return null;
    const next = tierBelow(this.current);
    if (next === null) return null;
    this.current = next;
    this.samples = [];
    this.warm = 0;
    return next;
  }
}
