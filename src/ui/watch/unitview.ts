// How a unit is drawn, as pure functions of what the viewer was told: status chip, spent state, facing, and the units that just acted.
// Everything is read from a ViewFrame (an observation, or the omniscient frame) and from the viewer's filtered events.
import { CAPTURE_POINTS, displayHp } from '../../game/aw';
import type { Coord, GameEvent, Unit } from '../../game/aw';
import { UNIT_TYPES } from '../../data';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import type { ViewFrame } from './timeline';

export type UnitStatusKind = 'capturing' | 'low-charge' | 'low-ammo' | 'loaded';

/**
 * The one status chip a unit shows, by priority: capturing, then low charge, then low ammo, then loaded.
 * Low means the UnitCard rule: charge at or under a fifth of the unit's full charge, or one round (or none) left.
 */
export function unitStatus(frame: ViewFrame, unit: Unit): UnitStatusKind | undefined {
  const t = UNIT_TYPES[unit.type];
  const tile = frame.tiles[unit.y]?.[unit.x];
  if (t.captures && tile && tile.capture !== undefined && tile.capture < CAPTURE_POINTS) return 'capturing';
  if (unit.charge <= Math.round(t.charge * 0.2)) return 'low-charge';
  if (t.ammo !== null && unit.ammo <= 1) return 'low-ammo';
  if (unit.cargo.length > 0) return 'loaded';
  return undefined;
}

/** A unit shows as spent (greyed) only on its owner's own turn, after it has acted: the flag resets when the turn comes round. */
export function isSpent(frame: ViewFrame, unit: Unit): boolean {
  return unit.acted && unit.owner === frame.current;
}

export function unitDisplayHp(unit: Unit): number {
  return Math.max(1, displayHp(unit.hp));
}

export type Facing = 'left' | 'right';

/**
 * The side each player's army starts on, read from the tiles it owns at the start (ownership is public, so a fogged viewer can
 * compute it for both sides). The left half of a map faces right and the right half faces left; the players are split by the
 * mean column of their property, and a player with none falls back to its index (even = left).
 */
export function homeFacings(frame0: ViewFrame): Facing[] {
  const sum: number[] = frame0.players.map(() => 0);
  const count: number[] = frame0.players.map(() => 0);
  frame0.tiles.forEach((row) => row.forEach((t, x) => {
    if (t.owner !== null && sum[t.owner] !== undefined) {
      sum[t.owner] += x;
      count[t.owner] += 1;
    }
  }));
  const mid = (frame0.width - 1) / 2;
  return frame0.players.map((_, i): Facing => {
    if (count[i] > 0) {
      const mean = sum[i] / count[i];
      if (mean !== mid) return mean < mid ? 'right' : 'left';
    }
    return i % 2 === 0 ? 'right' : 'left';
  });
}

/** Ids of the units that acted in this step, from the events the viewer was given (never from the action itself). */
export function actorIds(events: GameEvent[]): Set<number> {
  const ids = new Set<number>();
  for (const e of events) {
    switch (e.kind) {
      case 'moved': if (e.path.length > 1) ids.add(e.unitId); break;
      case 'attacked': if (e.attackerId !== UNSEEN_UNIT) ids.add(e.attackerId); break;
      case 'captureProgress': ids.add(e.unitId); break;
      case 'supplied': ids.add(e.byId); break;
      case 'unloaded': if (e.transportId !== UNSEEN_UNIT) ids.add(e.transportId); break;
      default: break;
    }
  }
  return ids;
}

/** The tile the step's action centres on, for the camera and the cursor; undefined when the viewer saw nothing happen anywhere. */
export function focusOf(events: GameEvent[], frame: ViewFrame): Coord | undefined {
  const where = new Map<number, Coord>();
  for (const u of frame.units) where.set(u.id, { x: u.x, y: u.y });
  let focus: Coord | undefined;
  for (const e of events) {
    switch (e.kind) {
      case 'moved': if (e.path.length) focus = e.path[e.path.length - 1]; break;
      case 'attacked': focus = where.get(e.defenderId) ?? focus; break;
      case 'destroyed': case 'crashed': case 'captured': case 'built': case 'ambushed': focus = e.at; break;
      case 'unloaded': focus = e.to; break;
      case 'captureProgress': focus = e.at; break;
      default: break;
    }
  }
  return focus;
}
