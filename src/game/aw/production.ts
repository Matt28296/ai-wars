// Production: an owned, empty fabricator / skyport / dock builds units of its domain. New units start acted.
import { TERRAIN_TYPES, UNIT_LIST } from '../../data';
import { illegal } from './errors';
import { unitCost } from './modifiers';
import { emit, inBounds, unitAt, unitType } from './state';
import type { Ctx } from './state';
import type { Coord, GameState, UnitTypeId } from './types';

export function buildOptions(state: GameState, at: Coord): { type: UnitTypeId; cost: number; affordable: boolean }[] {
  if (state.winnerTeam !== null || !inBounds(state, at)) return [];
  const tile = state.tiles[at.y][at.x];
  const domain = TERRAIN_TYPES[tile.terrain].builds;
  if (!domain || tile.owner !== state.current || unitAt(state, at)) return [];
  const funds = state.players[state.current].funds;
  return UNIT_LIST.filter((u) => u.domain === domain).map((u) => {
    const cost = unitCost(state, state.current, u, at);
    return { type: u.id, cost, affordable: cost <= funds };
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
