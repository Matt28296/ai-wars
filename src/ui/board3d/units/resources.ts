// The shared, reference-counted resources behind the unit views: the one merged model geometry per (type, faction), the two materials
// per faction (normal and spent), the chip textures and the focus ring. Forty units cost a few dozen of these, not forty sets. A resource
// is disposed when its last user disposes, and built again if someone asks for it later.
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, RingGeometry, AdditiveBlending } from 'three';
import type { BufferGeometry, Material, SpriteMaterial, Texture } from 'three';
import type { FactionId, UnitTypeId } from '../../../game/aw';
import { buildChip } from './chips';
import type { ChipKey } from './chips';
import { RIM_STRENGTH, SPENT_RIM, SPENT_TRIM, TRIM_EMISSIVE } from './livery';
import { MODELS } from './models';
import { FACTION_ACCENT, UI } from '../palette';
import type { Recipe } from './recipe';
import { patchUnitMaterial } from './shading';
import type { UnitUniforms } from './shading';

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
    r.geometry.dispose();
    for (const n of r.nodes) n.blur?.dispose();
  });
}

// ---------------------------------------------------------------- materials

export { CHOIR_STEEL, GUNMETAL, SPENT_SATURATION, SPENT_TRIM, desaturated } from './livery';

/** The look of a faction's units: one material, and its spent variant. Both read the paint from the vertices, so every unit type shares them. */
export interface MaterialSet { normal: MeshStandardMaterial; spent: MeshStandardMaterial; blur: Material }

/** Rim strength of the materials built from now on (the gallery turns it off for a before-and-after look). */
let rimStrength = RIM_STRENGTH;
export function setRimStrength(strength: number): void {
  rimStrength = Math.max(0, strength);
}

function makeUnitMaterial(faction: FactionId, spent: boolean): MeshStandardMaterial {
  const accent = FACTION_ACCENT[faction];
  // roughness and metalness are per vertex (aSurface); these two are only the defaults a patched shader overrides
  const m = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.5,
    metalness: 0.2,
    emissive: accent,
    // the trim glow: 30% of it on a spent unit
    emissiveIntensity: spent ? TRIM_EMISSIVE * SPENT_TRIM : TRIM_EMISSIVE,
  });
  const uniforms: UnitUniforms = {
    uSpent: { value: spent ? 1 : 0 },
    uRim: { value: rimStrength * (spent ? SPENT_RIM : 1) },
    uRimColor: { value: new Color(accent) },
  };
  patchUnitMaterial(m, uniforms, 'skin');
  m.name = `unit:${faction}:${spent ? 'spent' : 'normal'}`;
  m.userData.uniforms = uniforms;
  return m;
}

const factionMats = new Map<string, Counted<{ normal: MeshStandardMaterial; spent: MeshStandardMaterial }>>();
const blurMat: { value: Material | null; refs: number } = { value: null, refs: 0 };

export function acquireMaterials(faction: FactionId): MaterialSet {
  const f = take(factionMats, faction, () => ({ normal: makeUnitMaterial(faction, false), spent: makeUnitMaterial(faction, true) }));
  // the see-through rotor blur blends, so it cannot join the opaque mesh: one shared material for all of it
  blurMat.value ??= new MeshBasicMaterial({ color: 0xdfe9f2, transparent: true, opacity: 0.16, depthWrite: false, side: DoubleSide });
  blurMat.refs += 1;
  return { normal: f.normal, spent: f.spent, blur: blurMat.value };
}

export function releaseMaterials(faction: FactionId): void {
  drop(factionMats, faction, (f) => {
    f.normal.dispose();
    f.spent.dispose();
  });
  blurMat.refs -= 1;
  if (blurMat.refs <= 0 && blurMat.value) {
    blurMat.value.dispose();
    blurMat.value = null;
    blurMat.refs = 0;
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
  /** Distinct model geometries alive: one merged skin per live (type, faction), plus the rotor blur of the types that have one. */
  geometries: number;
  materials: number;
  textures: number;
  /** Distinct (type, faction) looks alive. */
  looks: number;
}

/** What the caches hold right now. All zero when every view has been disposed. */
export function resourceStats(): ResourceStats {
  let geometries = 0;
  for (const r of recipes.values()) geometries += 1 + r.value.nodes.filter((n) => n.blur).length;
  let materials = factionMats.size * 2 + (blurMat.value ? 1 : 0);
  const textures = chips.size;
  if (ring.value) {
    geometries += 2;
    materials += 2;
  }
  return { geometries, materials, textures, looks: recipes.size };
}
