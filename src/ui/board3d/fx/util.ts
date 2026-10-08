// Small pure helpers shared by the effects kit. Nothing here allocates per call.
import { Color } from 'three';

export const TAU = Math.PI * 2;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t: number): number => {
  const u = 1 - t;
  return 1 - u * u * u;
};

/** Overshoots to about 1.1 then settles at 1: the pop of a number or a glyph. */
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};

/** A linear-light colour. May exceed 1 on purpose: HDR values are what the renderer's bloom picks up. */
export interface Rgb { r: number; g: number; b: number }

const scratch = new Color();

/** Writes the linear-light value of an sRGB hex colour (0xRRGGBB) into `out`. */
export function setHex(out: Rgb, hex: number): Rgb {
  scratch.setHex(hex);
  out.r = scratch.r;
  out.g = scratch.g;
  out.b = scratch.b;
  return out;
}

export const rgbOf = (hex: number): Rgb => setHex({ r: 0, g: 0, b: 0 }, hex);

export function mixRgb(out: Rgb, a: Rgb, b: Rgb, t: number): Rgb {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
  return out;
}
