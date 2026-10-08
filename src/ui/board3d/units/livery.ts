// The paint of a unit, as DATA: what each paint slot becomes once a unit's parts are merged into one geometry (G7). Paint, gunmetal, trim
// and canopy glass are no longer materials; they are per-vertex values baked into the model, and one shared material per faction (and one
// "spent" variant of it) reads them. Nothing here touches three.js materials, so the numbers can be tested without a renderer.
import { Color } from 'three';
import type { FactionId } from '../../../game/aw';
import { FACTION_ACCENT, FACTION_COLOR } from '../palette';
import type { Slot } from './kit';

/** Gunmetal: the secondary colour of every faction. The Choir's obsidian paint would swallow it, so its steel runs a step lighter. */
export const GUNMETAL = 0x3a414d;
export const CHOIR_STEEL = 0x5b6379;
/** How much of the paint's saturation a spent unit keeps, and how much of its trim glow. */
export const SPENT_SATURATION = 0.4;
export const SPENT_TRIM = 0.3;
/** The trim's emissive intensity at rest. */
export const TRIM_EMISSIVE = 1.0;
/** The base colour of the trim is the accent at this fraction: the glow carries the look. */
export const TRIM_BASE = 0.12;
export const GLASS = 0x9ad7ea;
/** The canopy's own faint teal light, and the Choir's cool lift under its obsidian paint (it keeps the facets readable). */
export const GLASS_GLOW = 0x1d5d73;
export const GLASS_GLOW_K = 0.6;
export const CHOIR_LIFT = 0x151826;

/** The faction rim (readability, G7): a view-dependent fresnel in the accent colour, added as light so it shows on the shadow side too. */
export const RIM_STRENGTH = 0.25;
/** A spent unit keeps this fraction of the rim. */
export const SPENT_RIM = 0.4;
export const RIM_POWER = 2.0;

/** The slots that become vertex data. The see-through rotor blur is the one slot that cannot (it blends), so it stays its own mesh. */
export type PaintSlot = Exclude<Slot, 'blur'>;
export const PAINT_SLOTS: readonly PaintSlot[] = ['paint', 'dark', 'trim', 'glass'];

/** What one slot writes into the vertices it owns. Colours are in the working (linear) space, like every three.js colour. */
export interface SlotLook {
  /** The albedo. */
  color: Color;
  /** The albedo of a spent unit. */
  spent: Color;
  /** Emissive weight: 1 where the faction accent glows (trim), 0 elsewhere. The accent itself and its intensity are the material's. */
  glow: number;
  /** Light the surface gives off whatever the lighting: the canopy's teal, the Choir's lift. Black for the rest. */
  ambient: Color;
  /** How much of `ambient` a spent unit keeps. */
  ambientSpent: number;
  roughness: number;
  metalness: number;
}

/** Desaturate a colour to `keep` of its saturation (and a touch darker), keeping its hue. */
export function desaturated(hex: number, keep: number): Color {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(hex).getHSL(hsl);
  return new Color().setHSL(hsl.h, hsl.s * keep, hsl.l * 0.92);
}

const BLACK = new Color(0x000000);

export function liveryOf(faction: FactionId): Record<PaintSlot, SlotLook> {
  const accent = FACTION_ACCENT[faction];
  const choir = faction === 'choir';
  const steel = choir ? CHOIR_STEEL : GUNMETAL;
  const trim = new Color(accent).multiplyScalar(TRIM_BASE);
  return {
    paint: {
      color: new Color(FACTION_COLOR[faction]),
      spent: desaturated(FACTION_COLOR[faction], SPENT_SATURATION),
      glow: 0,
      // obsidian is nearly black under any light: a faint cool glow of its own keeps the facets readable (a spent unit keeps all of it)
      ambient: choir ? new Color(CHOIR_LIFT) : BLACK.clone(),
      ambientSpent: 1,
      roughness: choir ? 0.3 : 0.5,
      metalness: choir ? 0.15 : 0.2,
    },
    dark: {
      color: new Color(steel),
      spent: desaturated(steel, SPENT_SATURATION),
      glow: 0,
      ambient: BLACK.clone(),
      ambientSpent: 1,
      roughness: 0.5,
      metalness: choir ? 0.35 : 0.5,
    },
    trim: {
      color: trim,
      // dimmed to 30%: both the base colour (here) and the glow (the spent material's emissive intensity)
      spent: trim.clone().multiplyScalar(SPENT_TRIM),
      glow: 1,
      ambient: BLACK.clone(),
      ambientSpent: 1,
      roughness: 0.4,
      metalness: 0,
    },
    glass: {
      color: new Color(GLASS),
      spent: desaturated(GLASS, SPENT_SATURATION),
      glow: 0,
      ambient: new Color(GLASS_GLOW).multiplyScalar(GLASS_GLOW_K),
      ambientSpent: SPENT_TRIM,
      roughness: 0.15,
      metalness: 0.5,
    },
  };
}
