// Capture: units with `captures` subtract their display HP from the tile's 20 points; at ≤ 0 the property
// changes hands and resets to 20. Capturing a player's spire defeats them (the spire becomes an arcology).
import { TERRAIN_TYPES } from '../../data';
import { CAPTURE_POINTS, areEnemies, displayHp, emit, unitType, writableTile } from './state';
import type { Ctx } from './state';
import { checkCaptureObjective, defeatPlayer } from './victory';
import type { GameState, Unit } from './types';

export function canCaptureHere(state: GameState, unit: Unit, x = unit.x, y = unit.y): boolean {
  if (!unitType(unit.type).captures) return false;
  const tile = state.tiles[y]?.[x];
  if (!tile || !TERRAIN_TYPES[tile.terrain].property) return false;
  return tile.owner === null || areEnemies(state, unit.owner, tile.owner);
}

export function applyCapture(ctx: Ctx, unit: Unit): void {
  const tile = writableTile(ctx, unit.x, unit.y);
  const terrain = tile.terrain;
  tile.capture -= displayHp(unit.hp);
  const at = { x: unit.x, y: unit.y };
  if (tile.capture > 0) {
    emit(ctx, { kind: 'captureProgress', unitId: unit.id, at, remaining: tile.capture });
    return;
  }
  const from = tile.owner;
  tile.owner = unit.owner;
  tile.capture = CAPTURE_POINTS;
  emit(ctx, { kind: 'captured', at, terrain, by: unit.owner, from });
  if (TERRAIN_TYPES[terrain].hq) {
    tile.terrain = 'arcology'; // a captured spire is just a city to its new owner
    if (from !== null) defeatPlayer(ctx, from, 'hq', unit.owner);
  }
  checkCaptureObjective(ctx, unit.owner);
}
