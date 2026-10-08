// Faction sigils: the colour-blind-safe second cue on every owned property (art-direction.md, "Faction design language").
// Each sigil is a shape predicate, rasterised here into a small RGBA atlas, so the decals work in the browser and in node tests alike
// (no canvas is needed) and the shapes can be compared pixel by pixel in a test.
import { DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three';
import type { FactionId } from '../../../game/aw';
import { FACTION_ACCENT, FACTION_COLOR } from '../palette';

export const SIGIL_ORDER: readonly FactionId[] = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'];
/** Atlas cell holding no sigil at all (the neutral decal). */
export const SIGIL_BLANK = SIGIL_ORDER.length;
export const ATLAS_COLS = 3;
export const ATLAS_ROWS = 2;
export const CELL = 64;

/** The atlas cell a faction's sigil lives in; neutral (null) is the blank cell. */
export const sigilCell = (faction: FactionId | null): number => (faction === null ? SIGIL_BLANK : SIGIL_ORDER.indexOf(faction));

type Shape = (x: number, y: number) => boolean;

// Each shape is drawn in [-1, 1]^2 with +y up.
const SHAPES: Record<FactionId, Shape> = {
  // Rising chevron: two stacked chevrons.
  helion: (x, y) => {
    const chev = (oy: number) => {
      const top = 0.55 - Math.abs(x) * 0.95 + oy;
      return Math.abs(x) <= 0.85 && y <= top && y >= top - 0.3;
    };
    return chev(0.2) || chev(-0.38);
  },
  // Concentric ring: a ring around a dot.
  tidewell: (x, y) => {
    const r = Math.hypot(x, y);
    return (r >= 0.62 && r <= 0.88) || r <= 0.3;
  },
  // Leaf triangle: a triangle with a vein cut up its middle.
  verdant: (x, y) => {
    const inTri = y <= 0.85 && y >= -0.7 && Math.abs(x) <= (0.85 - y) * 0.52;
    const vein = Math.abs(x) < 0.07 && y < 0.5 && y > -0.7;
    return inTri && !vein;
  },
  // Winged diamond: a diamond between two swept wings.
  kestrel: (x, y) => {
    const diamond = Math.abs(x) + Math.abs(y) <= 0.46;
    const ax = Math.abs(x);
    const wing = ax > 0.3 && ax <= 0.8 && y <= 0.12 - (ax - 0.3) * 0.35 && y >= -0.28 + (ax - 0.3) * 0.45;
    return diamond || wing;
  },
  // Broken hexagon: a hexagonal ring with a gap.
  choir: (x, y) => {
    const a = Math.atan2(y, x);
    const gap = a > 0.15 && a < 0.95;
    // Hexagon radius at this angle (flat-top hexagon of circumradius 1).
    const k = Math.PI / 3;
    const rel = ((a % k) + k) % k - k / 2;
    const hex = Math.cos(k / 2) / Math.cos(rel);
    const r = Math.hypot(x, y) / hex;
    return !gap && r >= 0.62 && r <= 0.9;
  },
};

/** Coverage of a faction's sigil at a point of the unit square [-1, 1]^2. */
export const sigilInside = (faction: FactionId, x: number, y: number): boolean => SHAPES[faction](x, y);

/** Rasterise one sigil into a CELL x CELL alpha mask (0 or 255 with 3x3 supersampling), row 0 at the top. */
export function rasterSigil(faction: FactionId | null, size = CELL): Uint8Array {
  const out = new Uint8Array(size * size);
  if (faction === null) return out;
  const sh = SHAPES[faction];
  const ss = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 2 - 1;
          const y = 1 - ((py + (sy + 0.5) / ss) / size) * 2;
          if (sh(x, y)) hit++;
        }
      }
      out[py * size + px] = Math.round((hit / (ss * ss)) * 255);
    }
  }
  return out;
}

/** The atlas: ATLAS_COLS x ATLAS_ROWS cells of white with the sigil as alpha. Linear filtering, no mipmaps. */
export function buildSigilAtlas(): DataTexture {
  const w = ATLAS_COLS * CELL;
  const h = ATLAS_ROWS * CELL;
  const data = new Uint8Array(w * h * 4);
  for (let cell = 0; cell < ATLAS_COLS * ATLAS_ROWS; cell++) {
    const faction = cell < SIGIL_ORDER.length ? SIGIL_ORDER[cell] : null;
    const mask = rasterSigil(faction);
    const cx = (cell % ATLAS_COLS) * CELL;
    // Texture row 0 is the bottom (flipY is false on a DataTexture), so cell row 0 is the TOP of the image.
    const cy = Math.floor(cell / ATLAS_COLS) * CELL;
    for (let py = 0; py < CELL; py++) {
      for (let px = 0; px < CELL; px++) {
        const o = ((h - 1 - (cy + py)) * w + cx + px) * 4;
        data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = mask[py * CELL + px];
      }
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'terrain-sigil-atlas';
  return tex;
}

/** UV rectangle [u0, v0, u1, v1] of an atlas cell (with a 1.5-texel inset so linear filtering never bleeds a neighbour). */
export function sigilUv(cell: number): [number, number, number, number] {
  const w = ATLAS_COLS * CELL;
  const h = ATLAS_ROWS * CELL;
  const col = cell % ATLAS_COLS;
  const row = Math.floor(cell / ATLAS_COLS);
  const pad = 1.5;
  return [
    (col * CELL + pad) / w, 1 - ((row + 1) * CELL - pad) / h,
    ((col + 1) * CELL - pad) / w, 1 - (row * CELL + pad) / h,
  ];
}

// ---------------------------------------------------------------- ink

const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of 0xRRGGBB. */
export function luminance(hex: number): number {
  return 0.2126 * lin((hex >> 16) & 255) + 0.7152 * lin((hex >> 8) & 255) + 0.0722 * lin(hex & 255);
}
export const contrast = (a: number, b: number): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export const INK_DARK = 0x111a26;
export const INK_LIGHT = 0xf4f7fb;

/** The colour a faction's sigil is painted in on its own paint: the Choir's red signal on obsidian, otherwise whichever of near-white and navy contrasts more. */
export function sigilInk(faction: FactionId): number {
  if (faction === 'choir') return FACTION_ACCENT.choir;
  const paint = FACTION_COLOR[faction];
  return contrast(paint, INK_LIGHT) >= contrast(paint, INK_DARK) ? INK_LIGHT : INK_DARK;
}
