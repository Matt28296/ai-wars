// Lighting numbers for the 3D stage, as pure functions (art-direction.md "Lighting and post").
//
//   hemisphere   sky #cfe3ff over ground #5b4a3a                       (the cool fill)
//   key          a directional sun from the north-west at about 50 degrees, warm, with soft shadows on a 2048 map fitted to the board
//   ion storm    cooler, desaturated, dimmer light, and RARE lightning flashes (never strobing; none under reduced motion)
//
// Light units: since three r155 lights are physical, so a directional light of intensity I on a white matte surface facing it gives
// radiance I / pi. The art direction's "hemisphere about 0.6" is a ratio against a key of 1.0, so both are scaled by KEY_LUX here;
// the hemisphere:key ratio is the 0.6 the art direction asks for.
import type { Weather } from '../../../game/aw';
import { TILE } from '../contract';

export const SKY = 0xcfe3ff;
export const GROUND = 0x5b4a3a;
export const SUN_WARM = 0xfff0d6;
/** Intensity of the key light in three's physical units. The hemisphere is 0.6 of it. */
export const KEY_LUX = 2.3;
export const HEMI_RATIO = 0.6;
export const SUN_ELEVATION_DEG = 50;
export const EXPOSURE = 1.0;
export const SHADOW_MAP_SIZE = 2048;

const RAD = Math.PI / 180;

/** The direction FROM the scene TO the sun: north-west (-X, -Z) and 50 degrees up. Unit length. */
export function sunDirection(elevationDeg = SUN_ELEVATION_DEG): { x: number; y: number; z: number } {
  const e = elevationDeg * RAD;
  const h = Math.cos(e) / Math.SQRT2;
  return { x: -h, y: Math.sin(e), z: -h };
}

// ---------------------------------------------------------------- colours

const channels = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const pack = (r: number, g: number, b: number): number =>
  (Math.round(Math.max(0, Math.min(255, r))) << 16) | (Math.round(Math.max(0, Math.min(255, g))) << 8) | Math.round(Math.max(0, Math.min(255, b)));

/** Blend two 0xRRGGBB colours (in sRGB, which is plenty for a light tint). */
export function mixColor(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return pack(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

/** Pull a colour toward its own grey by `amount` (0 keeps it, 1 is grey). */
export function desaturate(hex: number, amount: number): number {
  const [r, g, b] = channels(hex);
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  return mixColor(hex, pack(grey, grey, grey), amount);
}

/** Saturation of a colour as (max - min) / max, 0 for black. */
export function saturationOf(hex: number): number {
  const [r, g, b] = channels(hex);
  const mx = Math.max(r, g, b);
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
}

export function luminanceOf(hex: number): number {
  const [r, g, b] = channels(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ---------------------------------------------------------------- weather

export interface LightingParams {
  sky: number;
  ground: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  exposure: number;
  /** The colour behind the table. */
  background: number;
}

const STORM_TINT = 0x6f8fb4;

/**
 * The light for a storm mix in 0..1 (0 clear, 1 ion storm) plus a lightning flash in 0..1. A storm is cooler (tinted toward blue),
 * desaturated and dimmer; a flash briefly lifts the fill and turns the key blue-white.
 */
export function lightingFor(stormMix: number, flash = 0): LightingParams {
  const s = Math.max(0, Math.min(1, stormMix));
  const f = Math.max(0, Math.min(1, flash));
  const cool = (hex: number, tint: number): number => desaturate(mixColor(hex, STORM_TINT, tint * s), 0.5 * s);
  const sky = mixColor(cool(SKY, 0.35), 0xe6f0ff, f * 0.6);
  const ground = cool(GROUND, 0.3);
  const sun = mixColor(cool(SUN_WARM, 0.55), 0xdfeaff, f);
  return {
    sky,
    ground,
    hemiIntensity: KEY_LUX * HEMI_RATIO * (1 - 0.18 * s) + f * KEY_LUX * 0.9,
    sun,
    sunIntensity: KEY_LUX * (1 - 0.42 * s) + f * KEY_LUX * 0.35,
    exposure: EXPOSURE * (1 - 0.06 * s),
    background: mixColor(0x0a0e14, 0x0f1a28, s + f * 0.5),
  };
}

export function stormMixFor(weather: Weather): number {
  return weather === 'ionstorm' ? 1 : 0;
}

// ---------------------------------------------------------------- lightning

/** Seconds between lightning windows. At most ONE flash per window, so it can never strobe. */
export const LIGHTNING_WINDOW_S = 11;
/** Chance that a window holds a flash at all. */
export const LIGHTNING_CHANCE = 0.4;

/** A small deterministic hash of an integer to [0, 1). */
export function hash01(n: number): number {
  let x = (Math.trunc(n) ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

const tri = (x: number, centre: number, half: number): number => Math.max(0, 1 - Math.abs(x - centre) / half);

/**
 * Lightning flash strength in 0..1 at `timeSec`. Deterministic in the time, so a recorded frame always looks the same. Zero unless
 * `enabled` (ion storm, no reduced motion). A flash is one quick strike with a softer afterglow, about a quarter of a second long and
 * never returning to black in between, so it is a single flash and not a flicker.
 */
export function lightningFlash(timeSec: number, enabled: boolean): number {
  if (!enabled || !Number.isFinite(timeSec) || timeSec < 0) return 0;
  const win = Math.floor(timeSec / LIGHTNING_WINDOW_S);
  if (hash01(win * 2 + 1) >= LIGHTNING_CHANCE) return 0;
  const start = 1.5 + hash01(win * 2 + 2) * (LIGHTNING_WINDOW_S - 4);
  const tau = timeSec - win * LIGHTNING_WINDOW_S - start;
  if (tau < 0 || tau > 0.4) return 0;
  return Math.max(tri(tau, 0.04, 0.05), 0.65 * tri(tau, 0.14, 0.14));
}

// ---------------------------------------------------------------- shadow camera

export interface ShadowFit {
  /** Where the light sits (world) and what it looks at. */
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
}

/**
 * An orthographic shadow camera fitted to the board: the box of the board (from just under the water to the tallest tower, plus a
 * margin) is projected onto the light's own axes, and the frustum is that box's bounds. Nothing on the board falls outside it.
 */
export function fitShadow(board: { width: number; height: number }, maxHeight = 2.2, margin = 0.6, elevationDeg = SUN_ELEVATION_DEG): ShadowFit {
  const dir = sunDirection(elevationDeg);
  const cx = (board.width * TILE) / 2;
  const cz = (board.height * TILE) / 2;
  const target = { x: cx, y: 0, z: cz };
  const dist = Math.hypot(board.width, board.height) * TILE + 12;
  const position = { x: cx + dir.x * dist, y: dir.y * dist, z: cz + dir.z * dist };
  // The light looks along -dir. Its right axis is dir x up (normalised); its up axis is right x (-dir).
  let rx = dir.z; // dir x up = (dir.y*0 - dir.z*1, dir.z*0 - dir.x*0, dir.x*1 - dir.y*0) -> (-dir.z, 0, dir.x); negate for a right-handed view
  let rz = -dir.x;
  const rl = Math.hypot(rx, rz);
  rx /= rl;
  rz /= rl;
  // up = right x forward, forward = -dir
  const fx = -dir.x;
  const fy = -dir.y;
  const fz = -dir.z;
  const ux = 0 * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - 0 * fx;
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  let near = Infinity;
  let far = -Infinity;
  for (const x of [-margin, board.width * TILE + margin]) {
    for (const y of [-0.5, maxHeight]) {
      for (const z of [-margin, board.height * TILE + margin]) {
        const px = x - position.x;
        const py = y - position.y;
        const pz = z - position.z;
        const lx = px * rx + pz * rz;
        const ly = px * ux + py * uy + pz * uz;
        const lz = px * fx + py * fy + pz * fz; // depth along the light's forward axis
        left = Math.min(left, lx);
        right = Math.max(right, lx);
        bottom = Math.min(bottom, ly);
        top = Math.max(top, ly);
        near = Math.min(near, lz);
        far = Math.max(far, lz);
      }
    }
  }
  return { position, target, left, right, top, bottom, near: Math.max(0.1, near - 1), far: far + 1 };
}
