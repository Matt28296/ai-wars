// Commander lookup and the Modifier vocabulary: which modifiers are active for a player, which apply to a
// given unit, and the derived stats (move, range, vision, firepower, defense, luck …).
import { COMMANDERS } from '../../content/commanders';
import type { CommanderDef } from '../../content/types';
import { TERRAIN_TYPES } from '../../data';
import { isIndirectType, propertyIndex, unitType } from './state';
import type { Coord, GameState, Modifier, PlayerIndex, TerrainId, Unit, UnitFilter, UnitType } from './types';

// ---------- commander registry (tests may swap it) ----------
let registry: Record<string, CommanderDef> | null = null;

/** Test hook: replace the commander table (COMMANDERS from src/content is the default). */
export function setCommanderRegistry(r: Record<string, CommanderDef>): void {
  registry = r;
}
export function resetCommanderRegistry(): void {
  registry = null;
}
export function commanderDef(id: string): CommanderDef | undefined {
  const table = registry ?? COMMANDERS;
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
}

/** Every active power also gives this. */
export const STANDARD_POWER_MODIFIER: Modifier = { firepower: 10, defense: 10 };
export const DEFAULT_LUCK_MAX = 9;
export const DEFAULT_LUCK_MIN = 0;

/** Passive + (active power modifiers + standard boost). Unknown commander = no modifiers. */
export function activeModifiers(state: GameState, p: PlayerIndex): Modifier[] {
  const pl = state.players[p];
  if (!pl) return [];
  const co = commanderDef(pl.commander);
  const out: Modifier[] = co ? [...co.passive.modifiers] : [];
  if (pl.powerState !== 'none') {
    const pw = pl.powerState === 'surge' ? co?.surge : co?.overclock;
    if (pw) out.push(...pw.modifiers);
    out.push(STANDARD_POWER_MODIFIER);
  }
  return out;
}

export function matchesFilter(f: UnitFilter | undefined, t: UnitType, terrain: TerrainId | undefined): boolean {
  if (!f) return true;
  if (f.domains && !f.domains.includes(t.domain)) return false;
  if (f.types && !f.types.includes(t.id)) return false;
  if (f.moveTypes && !f.moveTypes.includes(t.moveType)) return false;
  if (f.indirect !== undefined && isIndirectType(t) !== f.indirect) return false;
  if (f.onTerrain && (terrain === undefined || !f.onTerrain.includes(terrain))) return false;
  return true;
}

function terrainIdAt(state: GameState, at: Coord): TerrainId | undefined {
  return state.tiles[at.y]?.[at.x]?.terrain;
}

/** Modifiers of the unit's owner that apply to this unit standing at `at` (default: where it is). */
export function unitModifiers(state: GameState, unit: Unit, at: Coord = unit): Modifier[] {
  const t = unitType(unit.type);
  const terrain = terrainIdAt(state, at);
  return activeModifiers(state, unit.owner).filter((m) => matchesFilter(m.filter, t, terrain));
}

type NumField = 'firepower' | 'defense' | 'move' | 'rangeMax' | 'vision' | 'costPercent' | 'terrainStars' | 'repairBonus' | 'incomePercent' | 'powerChargePercent';
export function sumField(mods: Modifier[], field: NumField): number {
  let n = 0;
  for (const m of mods) n += m[field] ?? 0;
  return n;
}

// ---------- derived unit stats ----------

export function effectiveMove(state: GameState, unit: Unit): number {
  const t = unitType(unit.type);
  let m = t.move + sumField(unitModifiers(state, unit), 'move');
  for (const e of state.players[unit.owner]?.moveEffects ?? []) m += e.delta;
  if (state.weather === 'ionstorm' && t.domain === 'air') m -= 1;
  return Math.max(1, m);
}

export function effectiveRange(state: GameState, unit: Unit, at: Coord = unit): [number, number] | null {
  const t = unitType(unit.type);
  if (!t.range) return null;
  if (!isIndirectType(t)) return [t.range[0], t.range[1]];
  const bonus = sumField(unitModifiers(state, unit, at), 'rangeMax');
  return [t.range[0], Math.max(t.range[0], t.range[1] + bonus)];
}

export function effectiveVision(state: GameState, unit: Unit, at: Coord = unit): number {
  const t = unitType(unit.type);
  let v = t.vision + sumField(unitModifiers(state, unit, at), 'vision');
  if (terrainIdAt(state, at) === 'ridge' && (t.moveType === 'foot' || t.moveType === 'exo')) v += 1;
  if (state.weather === 'ionstorm') v -= 1;
  return Math.max(1, v);
}

/** Firepower bonus in % (modifiers + uplinks owned). ATK = 100 + this. */
export function firepowerBonus(state: GameState, unit: Unit, at: Coord = unit): number {
  return sumField(unitModifiers(state, unit, at), 'firepower') + (propertyIndex(state).boost[unit.owner] ?? 0);
}

/** Defense bonus in %. DEF = 100 + this. */
export function defenseBonus(state: GameState, unit: Unit, at: Coord = unit): number {
  return sumField(unitModifiers(state, unit, at), 'defense');
}

/** Terrain stars the unit gets at `at` (air units never get any). */
export function terrainStarsFor(state: GameState, unit: Unit, at: Coord = unit): number {
  const t = unitType(unit.type);
  if (t.domain === 'air') return 0;
  const terrain = terrainIdAt(state, at);
  const base = terrain ? TERRAIN_TYPES[terrain].def : 0;
  return Math.max(0, base + sumField(unitModifiers(state, unit, at), 'terrainStars'));
}

export function luckRange(state: GameState, unit: Unit, at: Coord = unit): [number, number] {
  let max: number | undefined;
  let min: number | undefined;
  for (const m of unitModifiers(state, unit, at)) {
    if (m.luckMax !== undefined) max = max === undefined ? m.luckMax : Math.max(max, m.luckMax);
    if (m.luckMin !== undefined) min = min === undefined ? m.luckMin : Math.min(min, m.luckMin);
  }
  const lo = min ?? DEFAULT_LUCK_MIN;
  return [lo, Math.max(lo, max ?? DEFAULT_LUCK_MAX)];
}

export function ignoredMoveCosts(state: GameState, unit: Unit): Set<TerrainId> {
  const out = new Set<TerrainId>();
  for (const m of unitModifiers(state, unit)) for (const t of m.ignoreMoveCost ?? []) out.add(t);
  return out;
}

export function hasCounterFirst(state: GameState, unit: Unit): boolean {
  return unitModifiers(state, unit).some((m) => !!m.counterFirst);
}

export function canFireAfterMove(state: GameState, unit: Unit, at: Coord = unit): boolean {
  return unitModifiers(state, unit, at).some((m) => !!m.indirectAfterMove);
}

/** Production cost after costPercent modifiers (filtered by unit type and the building's terrain). */
export function unitCost(state: GameState, p: PlayerIndex, type: UnitType, at?: Coord): number {
  const terrain = at ? terrainIdAt(state, at) : undefined;
  let pct = 0;
  for (const m of activeModifiers(state, p)) if (matchesFilter(m.filter, type, terrain)) pct += m.costPercent ?? 0;
  return Math.max(0, Math.round((type.cost * (100 + pct)) / 100));
}
