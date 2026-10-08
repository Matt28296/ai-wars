// Production: an owned, empty fabricator / skyport / dock builds units of its domain. New units start acted.
// D-015.3: a player may have at most MAX_UNITS_PER_PLAYER units on the map, cargo included.
import { TERRAIN_TYPES, UNIT_LIST } from '../../data';
import { illegal } from './errors';
import { unitCost } from './modifiers';
import { emit, inBounds, unitAt, unitCount, unitType } from './state';
import type { Ctx } from './state';
import type { Coord, GameState, UnitTypeId } from './types';

/** D-015.3: the most units one player can have on the map at once (loaded cargo counts). Our rule, not a measured original. */
export const MAX_UNITS_PER_PLAYER = 50;

/** Why a build entry is unavailable: not enough funds, or the player is at the unit cap (the cap wins when both hold). */
export interface BuildOption { type: UnitTypeId; cost: number; affordable: boolean; reason?: 'funds' | 'cap' }

/** True when the player cannot field another unit (D-015.3). */
export function atUnitCap(state: GameState, p: number): boolean {
  return unitCount(state, p) >= MAX_UNITS_PER_PLAYER;
}

export function buildOptions(state: GameState, at: Coord): BuildOption[] {
  if (state.winnerTeam !== null || !Number.isInteger(at.x) || !Number.isInteger(at.y) || !inBounds(state, at)) return [];
  const tile = state.tiles[at.y][at.x];
  const domain = TERRAIN_TYPES[tile.terrain].builds;
  if (!domain || tile.owner !== state.current || unitAt(state, at)) return [];
  const funds = state.players[state.current].funds;
  const capped = atUnitCap(state, state.current);
  return UNIT_LIST.filter((u) => u.domain === domain).map((u): BuildOption => {
    const cost = unitCost(state, state.current, u, at);
    if (capped) return { type: u.id, cost, affordable: false, reason: 'cap' };
    return cost <= funds ? { type: u.id, cost, affordable: true } : { type: u.id, cost, affordable: false, reason: 'funds' };
  });
}

export function validateBuild(state: GameState, at: Coord, type: UnitTypeId): number {
  if (!at || !Number.isInteger(at.x) || !Number.isInteger(at.y) || !inBounds(state, at)) illegal('build site is off the map');
  const t = unitType(type);
  if (!t) illegal(`unknown unit type ${String(type)}`);
  const tile = state.tiles[at.y][at.x];
  const domain = TERRAIN_TYPES[tile.terrain].builds;
  if (tile.owner !== state.current) illegal('you do not own this property');
  if (!domain) illegal(`${tile.terrain} cannot build units`);
  if (domain !== t.domain) illegal(`${tile.terrain} cannot build ${t.domain} units`);
  if (unitAt(state, at)) illegal('the build site is occupied');
  if (atUnitCap(state, state.current)) illegal(`unit cap reached: ${MAX_UNITS_PER_PLAYER} units per player, cargo included`);
  const cost = unitCost(state, state.current, t, at);
  if (cost > state.players[state.current].funds) illegal('not enough funds');
  return cost;
}

export function applyBuild(ctx: Ctx, at: Coord, type: UnitTypeId): void {
  const s = ctx.s;
  const cost = validateBuild(s, at, type);
  const t = unitType(type);
  const p = s.current;
  const id = s.nextUnitId++;
  s.units.push({ id, type, owner: p, x: at.x, y: at.y, hp: 100, charge: t.charge, ammo: t.ammo ?? 0, acted: true, cargo: [] });
  s.players[p].funds -= cost;
  s.players[p].stats.unitsBuilt += 1;
  emit(ctx, { kind: 'built', unitId: id, type, at: { x: at.x, y: at.y }, owner: p, cost });
}
