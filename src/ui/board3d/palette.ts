// The design-system colours as numbers for three.js materials. These mirror src/styles/tokens.css exactly; palette.test.ts
// reads the CSS and fails if the two ever drift. Owner colour is never the only cue (colour-blind safe): every owned unit
// and property also carries its faction sigil.
import type { FactionId, TerrainId } from '../../game/aw';

export const FACTION_COLOR: Record<FactionId, number> = {
  helion: 0xf28c28,
  tidewell: 0x2f6fd8,
  verdant: 0x2ea36a,
  kestrel: 0xe6c95e,
  choir: 0x1c1b23,
};

/** The bright accent of each faction (trim, emissive lights). The Choir's is its red signal. */
export const FACTION_ACCENT: Record<FactionId, number> = {
  helion: 0xffa95c,
  tidewell: 0x8ab6ff,
  verdant: 0x5fd49b,
  kestrel: 0xefd77a,
  choir: 0xff4d63,
};

export const NEUTRAL_COLOR = 0x9ba4af;

/** Base and detail colour per terrain token family. Properties share the structure colours. */
export const TERRAIN_COLOR: Record<'flats' | 'canopy' | 'ridge' | 'sea' | 'shoal' | 'maglev' | 'glass' | 'structure', { base: number; detail: number }> = {
  flats: { base: 0x86a86c, detail: 0x6f9258 },
  canopy: { base: 0x2f6a46, detail: 0x4c9262 },
  ridge: { base: 0x857a6d, detail: 0xbdb19f },
  sea: { base: 0x1d4a73, detail: 0x3a76a6 },
  shoal: { base: 0xcbb98b, detail: 0xcbb98b },
  maglev: { base: 0x59626f, detail: 0xb8e9f5 },
  glass: { base: 0xa9bcc2, detail: 0xe0ebee },
  structure: { base: 0x9ba4af, detail: 0x5f6976 },
};

/** Which colour family a terrain uses. */
export function terrainFamily(t: TerrainId): keyof typeof TERRAIN_COLOR {
  switch (t) {
    case 'flats': return 'flats';
    case 'canopy': return 'canopy';
    case 'ridge': return 'ridge';
    case 'sea': case 'river': return 'sea';
    case 'shoal': return 'shoal';
    case 'maglev': case 'span': return 'maglev';
    case 'glass': return 'glass';
    default: return 'structure';
  }
}

export const UI = { void: 0x0a0e14, signal: 0x5ce1ff, warn: 0xffc44d, danger: 0xff7070 };
