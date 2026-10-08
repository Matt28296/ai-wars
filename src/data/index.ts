import type { FactionId, MoveType, TerrainId, TerrainType, UnitType, UnitTypeId } from '../engine/types';
import { ART, COMMANDER_BASE, FACTIONS as RAW_FACTIONS, MOVE_TYPES, TERRAIN as RAW_TERRAIN, UNITS as RAW_UNITS } from './base.generated';

export interface Faction { id: FactionId; name: string; short: string; motto: string; home: string }

export const UNIT_LIST = RAW_UNITS as unknown as UnitType[];
export const UNIT_TYPES = Object.fromEntries(UNIT_LIST.map((u) => [u.id, u])) as Record<UnitTypeId, UnitType>;
export const TERRAIN_LIST = RAW_TERRAIN as unknown as TerrainType[];
export const TERRAIN_TYPES = Object.fromEntries(TERRAIN_LIST.map((t) => [t.id, t])) as Record<TerrainId, TerrainType>;
export const FACTION_LIST = RAW_FACTIONS as unknown as Faction[];
export const FACTIONS = Object.fromEntries(FACTION_LIST.map((f) => [f.id, f])) as Record<FactionId, Faction>;
export const MOVE_TYPE_NAMES = MOVE_TYPES as Record<MoveType, string>;
export { ART, COMMANDER_BASE };

// Map character codes (see src/content/types.ts MapDef).
export const TERRAIN_CODES: Record<string, TerrainId> = {
  '.': 'flats', f: 'canopy', '^': 'ridge', '=': 'maglev', '#': 'span', r: 'river', '~': 'sea', s: 'shoal', g: 'glass',
  C: 'arcology', F: 'fabricator', A: 'skyport', D: 'dock', U: 'uplink', H: 'spire',
};

export const isIndirect = (u: UnitType) => !!u.range && u.range[0] > 1;
