// The shared, reference-counted resources behind the unit views: the merged model geometry per (type, faction), the materials
// per faction, the chip textures and the focus ring. Forty units cost a few dozen of these, not forty sets. A resource is
// disposed when its last user disposes, and built again if someone asks for it later.
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, AdditiveBlending } from 'three';
import type { BufferGeometry, Material, SpriteMaterial, Texture } from 'three';
import type { FactionId, UnitTypeId } from '../../../game/aw';
import { buildChip } from './chips';
import type { ChipKey } from './chips';
import type { Slot } from './kit';
import { MODELS } from './models';
import { FACTION_ACCENT, FACTION_COLOR, UI } from '../palette';
import type { Recipe } from './recipe';

interface Counted<T> { value: T; refs: number }

function take<T>(map: Map<string, Counted<T>>, key: string, make: () => T): T {
  const hit = map.get(key);
  if (hit) {
    hit.refs += 1;
    return hit.value;
  }
  const value = make();
  map.set(key, { value, refs: 1 });
  return value;
}

function drop<T>(map: Map<string, Counted<T>>, key: string, dispose: (value: T) => void): void {
  const hit = map.get(key);
  if (!hit) return;
  hit.refs -= 1;
  if (hit.refs > 0) return;
  map.delete(key);
  dispose(hit.value);
}

// ---------------------------------------------------------------- model geometry

const recipes = new Map<string, Counted<Recipe>>();
const recipeKey = (type: UnitTypeId, faction: FactionId) => `${type}:${faction}`;

export function acquireRecipe(type: UnitTypeId, faction: FactionId): Recipe {
  return take(recipes, recipeKey(type, faction), () => MODELS[type](faction));
}

export function releaseRecipe(type: UnitTypeId, faction: FactionId): void {
  drop(recipes, recipeKey(type, faction), (r) => {
    for (const n of r.nodes) for (const g of Object.values(n.geo)) g?.dispose();
  });
}

// ---------------------------------------------------------------- materials

/** Gunmetal: the secondary colour of every faction. The Choir's obsidian paint would swallow it, so its steel runs a step lighter. */
export const GUNMETAL = 0x3a414d;
export const CHOIR_STEEL = 0x5b6379;
/** How much of the paint's saturation a spent unit keeps, and how much of its trim glow. */
export const SPENT_SATURATION = 0.4;
export const SPENT_TRIM = 0.3;
const TRIM_EMISSIVE = 1.0;

export type SlotMaterials = Record<Slot, Material>;
export interface MaterialSet { normal: SlotMaterials; spent: SlotMaterials }

/** Desaturate a colour to `keep` of its saturation (and a touch darker), keeping its hue. */
export function desaturated(hex: number, keep: number): Color {
  const hsl = { h: 0, s: 0, l: 0 };
  new Color(hex).getHSL(hsl);
  return new Color().setHSL(hsl.h, hsl.s * keep, hsl.l * 0.92);
}

const std = (color: Color | number, extra: { roughness: number; metalness: number; emissive?: Color | number; emissiveIntensity?: number }) =>
  new MeshStandardMaterial({ color, flatShading: true, ...extra });

interface FactionMaterials { paint: Material; dark: Material; trim: Material; paintSpent: Material; darkSpent: Material; trimSpent: Material }
interface SharedMaterials { glass: Material; blur: Material; glassSpent: Material }

const factionMats = new Map<string, Counted<FactionMaterials>>();
const sharedMats: { value: SharedMaterials | null; refs: number } = { value: null, refs: 0 };

function makeFaction(faction: FactionId): FactionMaterials {
  const accent = FACTION_ACCENT[faction];
  const choir = faction === 'choir';
  const trimColor = new Color(accent).multiplyScalar(0.12);
  const steel = choir ? CHOIR_STEEL : GUNMETAL;
  // obsidian is nearly black under any light: a faint cool glow of its own keeps the facets readable
  const lift = choir ? { emissive: 0x151826, emissiveIntensity: 1 } : {};
  return {
    paint: std(FACTION_COLOR[faction], { roughness: choir ? 0.3 : 0.5, metalness: choir ? 0.15 : 0.2, ...lift }),
    dark: std(steel, { roughness: 0.5, metalness: choir ? 0.35 : 0.5 }),
    darkSpent: std(desaturated(steel, SPENT_SATURATION), { roughness: 0.5, metalness: choir ? 0.35 : 0.5 }),
    trim: std(trimColor, { roughness: 0.4, metalness: 0, emissive: accent, emissiveIntensity: TRIM_EMISSIVE }),
    paintSpent: std(desaturated(FACTION_COLOR[faction], SPENT_SATURATION), { roughness: choir ? 0.3 : 0.5, metalness: choir ? 0.15 : 0.2, ...lift }),
    // dimmed to 30%: both the glow and the base colour
    trimSpent: std(trimColor.clone().multiplyScalar(SPENT_TRIM), { roughness: 0.4, metalness: 0, emissive: accent, emissiveIntensity: TRIM_EMISSIVE * SPENT_TRIM }),
  };
}

function makeShared(): SharedMaterials {
  return {
    glass: std(0x9ad7ea, { roughness: 0.15, metalness: 0.5, emissive: 0x1d5d73, emissiveIntensity: 0.6 }),
    blur: new MeshBasicMaterial({ color: 0xdfe9f2, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide }),
    glassSpent: std(desaturated(0x9ad7ea, SPENT_SATURATION), { roughness: 0.15, metalness: 0.5, emissive: 0x1d5d73, emissiveIntensity: 0.6 * SPENT_TRIM }),
  };
}

export function acquireMaterials(faction: FactionId): MaterialSet {
  const f = take(factionMats, faction, () => makeFaction(faction));
  if (!sharedMats.value) sharedMats.value = makeShared();
  sharedMats.refs += 1;
  const s = sharedMats.value;
  return {
    normal: { paint: f.paint, dark: f.dark, trim: f.trim, glass: s.glass, blur: s.blur },
    spent: { paint: f.paintSpent, dark: f.darkSpent, trim: f.trimSpent, glass: s.glassSpent, blur: s.blur },
  };
}

export function releaseMaterials(faction: FactionId): void {
  drop(factionMats, faction, (f) => {
    for (const m of [f.paint, f.dark, f.trim, f.paintSpent, f.darkSpent, f.trimSpent]) m.dispose();
  });
  sharedMats.refs -= 1;
  if (sharedMats.refs <= 0 && sharedMats.value) {
    const s = sharedMats.value;
    for (const m of [s.glass, s.blur, s.glassSpent]) m.dispose();
    sharedMats.value = null;
    sharedMats.refs = 0;
  }
}

// ---------------------------------------------------------------- chips

const chips = new Map<string, Counted<{ texture: Texture; material: SpriteMaterial }>>();

export function acquireChip(key: ChipKey): SpriteMaterial {
  return take(chips, key, () => buildChip(key)).material;
}

export function releaseChip(key: ChipKey): void {
  drop(chips, key, (c) => {
    c.material.dispose();
    c.texture.dispose();
  });
}

// ---------------------------------------------------------------- the focus ring

export interface RingSet { glow: { geometry: BufferGeometry; material: Material }; edge: { geometry: BufferGeometry; material: Material } }
const ring: { value: RingSet | null; refs: number } = { value: null, refs: 0 };

export function acquireRing(): RingSet {
  if (!ring.value) {
    ring.value = {
      glow: {
        geometry: new RingGeometry(0.28, 0.42, 24),
        material: new MeshBasicMaterial({ color: UI.signal, transparent: true, opacity: 0.22, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }),
      },
      edge: {
        geometry: new RingGeometry(0.37, 0.41, 24),
        material: new MeshBasicMaterial({ color: UI.signal, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }),
      },
    };
  }
  ring.refs += 1;
  return ring.value;
}

export function releaseRing(): void {
  ring.refs -= 1;
  if (ring.refs > 0 || !ring.value) return;
  for (const part of [ring.value.glow, ring.value.edge]) {
    part.geometry.dispose();
    part.material.dispose();
  }
  ring.value = null;
  ring.refs = 0;
}

// ---------------------------------------------------------------- accounting

export interface ResourceStats {
  /** Distinct model geometries alive (one per node and paint slot, per live (type, faction)). */
  geometries: number;
  materials: number;
  textures: number;
  /** Distinct (type, faction) looks alive. */
  looks: number;
}

/** What the caches hold right now. All zero when every view has been disposed. */
export function resourceStats(): ResourceStats {
  let geometries = 0;
  for (const r of recipes.values()) for (const n of r.value.nodes) geometries += Object.keys(n.geo).length;
  let materials = factionMats.size * 6 + (sharedMats.value ? 3 : 0);
  let textures = chips.size;
  if (ring.value) {
    geometries += 2;
    materials += 2;
  }
  return { geometries, materials, textures, looks: recipes.size };
}
