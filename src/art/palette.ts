// Ascendant Wars — art palette.
// Every faction / terrain / interface colour comes from tokens.css via var(--token).
// Tones (shade / highlight) are derived with CSS color-mix so they follow the tokens.
// The only literal colours in the art live here: skin, hair and eye tones for the cast.
import type { FactionId } from '../engine/types';

/** A faction, or null for ECHO / the interface / neutral. */
export type ArtFaction = FactionId | null;

export const tok = (name: string) => `var(--${name})`;
export const WHITE = 'var(--map-ink)';
export const BLACK = 'var(--map-shade)';
export const SIGNAL = 'var(--signal)';
export const WARN = 'var(--warn)';
export const DANGER = 'var(--danger)';
export const RED_SIGNAL = 'var(--on-choir)';

/** color-mix(a pct%, b). */
export const mix = (a: string, b: string, pctA: number) => `color-mix(in srgb, ${a} ${pctA}%, ${b})`;
export const darken = (c: string, amt: number) => mix(c, BLACK, 100 - amt);
export const lighten = (c: string, amt: number) => mix(c, WHITE, 100 - amt);

export const factionFill = (f: ArtFaction) => (f ? `var(--${f})` : 'var(--signal)');
export const factionOn = (f: ArtFaction) => (f ? `var(--on-${f})` : 'var(--on-signal)');
export const factionInk = (f: ArtFaction) => (f ? `var(--${f}-ink)` : 'var(--signal)');
/** Sigil colour on dark chips: the fill reads on near-black for every faction except obsidian Choir. */
export const factionMark = (f: ArtFaction) => (f === 'choir' ? RED_SIGNAL : factionFill(f));

/** Body tones for vehicles / armour painted in a faction colour. */
export interface BodyTones {
  base: string;
  light: string;
  shade: string;
  deep: string;
  /** decal / marking colour on the body */
  mark: string;
  /** running lights, visors, engine glow */
  glow: string;
  /** gunmetal parts */
  metal: string;
  metalLight: string;
  metalShade: string;
  /** cockpit glass */
  glass: string;
  glassLight: string;
  /** outline */
  outline: string;
}

const METAL = mix('var(--line-strong)', 'var(--panel)', 70);
const METAL_LIGHT = mix('var(--line-strong)', 'var(--ink)', 55);
const METAL_SHADE = mix('var(--line)', BLACK, 80);

export function bodyTones(f: ArtFaction): BodyTones {
  if (f === 'choir') {
    // Obsidian: lift the near-black so the form reads, red signal for every light.
    return {
      base: mix('var(--choir)', 'var(--line-strong)', 78),
      light: mix('var(--choir)', 'var(--line-strong)', 48),
      shade: 'var(--choir)',
      deep: mix('var(--choir)', BLACK, 50),
      mark: RED_SIGNAL,
      glow: RED_SIGNAL,
      metal: mix('var(--choir)', 'var(--line-strong)', 62),
      metalLight: mix('var(--choir)', 'var(--line-strong)', 30),
      metalShade: mix('var(--choir)', BLACK, 60),
      glass: mix(RED_SIGNAL, BLACK, 55),
      glassLight: mix(RED_SIGNAL, WHITE, 70),
      outline: BLACK,
    };
  }
  const base = factionFill(f);
  return {
    base,
    light: mix(base, WHITE, 62),
    shade: mix(base, BLACK, 70),
    deep: mix(base, BLACK, 44),
    mark: factionOn(f),
    glow: SIGNAL,
    metal: METAL,
    metalLight: METAL_LIGHT,
    metalShade: METAL_SHADE,
    glass: mix('var(--signal-soft)', 'var(--signal)', 78),
    glassLight: mix(SIGNAL, WHITE, 60),
    outline: BLACK,
  };
}

/** Property tones: owner faction, or neutral structure tokens. */
export function structureTones(owner: ArtFaction | undefined) {
  if (!owner) {
    const base = 'var(--terrain-structure)';
    return { base, light: mix(base, WHITE, 60), shade: mix(base, BLACK, 74), deep: 'var(--terrain-structure-detail)', mark: 'var(--terrain-structure-detail)', glow: mix(base, WHITE, 40) };
  }
  if (owner === 'choir') {
    const base = mix('var(--choir)', 'var(--line-strong)', 72);
    return { base, light: mix('var(--choir)', 'var(--line-strong)', 42), shade: 'var(--choir)', deep: mix('var(--choir)', BLACK, 50), mark: RED_SIGNAL, glow: RED_SIGNAL };
  }
  const base = factionFill(owner);
  return { base, light: mix(base, WHITE, 60), shade: mix(base, BLACK, 72), deep: mix(base, BLACK, 45), mark: factionOn(owner), glow: mix(base, WHITE, 45) };
}

// ---------- cast palette (portraits & battle soldiers) ----------
export interface Ramp { light: string; base: string; shade: string; deep: string }

/** A modest range of skin tones, varied across the cast. */
export const SKIN = {
  umber: { light: '#a06c4a', base: '#84553a', shade: '#683f29', deep: '#472a1b' },
  fair: { light: '#f5dfcf', base: '#e7c6ae', shade: '#c9a089', deep: '#9a7461' },
  golden: { light: '#edc79e', base: '#d7a679', shade: '#b8855d', deep: '#8a6044' },
  olive: { light: '#efd2b0', base: '#d9b38e', shade: '#b78f6c', deep: '#8a674d' },
  bronze: { light: '#bd8e66', base: '#a0704d', shade: '#80553a', deep: '#5a3a27' },
  tan: { light: '#d8a275', base: '#bf865a', shade: '#9d6a44', deep: '#724a2f' },
  ruddy: { light: '#f0c9aa', base: '#dda988', shade: '#bd866a', deep: '#8d5d49' },
  pale: { light: '#f8e8dc', base: '#ecd3c3', shade: '#cbab9b', deep: '#9a7d72' },
} satisfies Record<string, Ramp>;

export const HAIR = {
  black: { light: '#4a4048', base: '#2b2429', shade: '#1b161a', deep: '#0f0c0e' },
  silver: { light: '#f1f3f6', base: '#cdd2da', shade: '#9ea6b2', deep: '#6f7784' },
  ink: { light: '#4d3a36', base: '#2e211e', shade: '#1e1513', deep: '#120c0b' },
  chestnut: { light: '#b07a49', base: '#7e4c2b', shade: '#59331c', deep: '#3a2011' },
  ash: { light: '#dddbd5', base: '#b0aea7', shade: '#85837d', deep: '#5d5c57' },
  rust: { light: '#e0773f', base: '#b44a2a', shade: '#82301c', deep: '#561d11' },
  steel: { light: '#5a5254', base: '#3c3537', shade: '#282223', deep: '#171314' },
  raven: { light: '#454b66', base: '#1d1e27', shade: '#121219', deep: '#09090d' },
} satisfies Record<string, Ramp>;

export const EYES = {
  brown: '#5a3622',
  dark: '#2e1d14',
  grey: '#6f8191',
  blue: '#3f6fa6',
  green: '#4d7f4f',
  amber: '#9a6a2a',
  hazel: '#7a6236',
};

/** Shared inks for faces. */
export const FACE_INK = '#2a1a16';
export const MOUTH_DARK = '#5b2526';
export const TEETH = '#f6f1ea';
export const SCLERA = '#f7f4ef';
