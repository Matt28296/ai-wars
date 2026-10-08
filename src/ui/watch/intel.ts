// The intel card's model (the source games' unit and terrain panel): WHICH unit the current step is about, and what the viewer may be
// told of it and of the tile it stands on. Pure, and built only from the viewer's own timeline: the frames and filtered events a
// fogged viewer was given (D-016). A unit that is not in the viewer's CURRENT frame is never chosen, however it was named by an event,
// so an enemy in the dark cannot reach the card through a trimmed move, a redacted shot or an old step.
//
// Which unit: the one that ACTED in this step (its first acting event the viewer saw); failing that, the unit the step struck (a shot
// from an unseen shooter still tells the viewer whose unit was hit); failing that, the last unit that acted in an earlier step and is
// still in sight. With none of those, the card says so quietly.
import { COMMANDERS } from '../../content/commanders';
import { FACTIONS, MOVE_TYPE_NAMES, TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import { CAPTURE_POINTS } from '../../game/aw';
import type { FactionId, GameEvent, PlayerIndex, TerrainId, UnitTypeId } from '../../game/aw';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import { findUnit } from './timeline';
import type { TimelineStep, ViewFrame } from './timeline';
import { isSpent, unitDisplayHp, unitStatus } from './unitview';
import type { UnitStatusKind } from './unitview';

/** Why this unit is on the card. */
export type IntelReason = 'acting' | 'struck' | 'last';

export interface IntelAmmo {
  value: number;
  max: number;
  /** One round or none left. */
  low: boolean;
}

export interface IntelUnit {
  id: number;
  type: UnitTypeId;
  name: string;
  role: string;
  /** "Hover", "Tread" ... from the data. */
  moveTypeName: string;
  owner: PlayerIndex;
  faction: FactionId;
  factionName: string;
  commanderName: string;
  /** Display HP, 1 to 10. */
  hp: number;
  /** Three or less. */
  hpCritical: boolean;
  charge: number;
  chargeMax: number;
  /** A fifth of the full charge or less (the UnitCard rule, as unitview.ts's status chip). */
  chargeLow: boolean;
  /** Air and sea units burn charge each turn; ground units never do, so their number is only ever the full one. */
  drains: boolean;
  /** null for a type with no limited primary weapon: the card has no ammo gauge for it. */
  ammo: IntelAmmo | null;
  /** In words, for the card's weapon row when there is no ammo gauge: its weapon never runs dry, or it has none at all. */
  weapon: 'limited' | 'unlimited' | 'unarmed';
  /** An air unit: terrain gives it no defense. */
  airborne: boolean;
  /** Greyed on the board: it has acted on its owner's turn. */
  spent: boolean;
  /** The one status chip the board draws on it. */
  status: UnitStatusKind | undefined;
  /** Units aboard (public for the viewer's own side, and a count only for an enemy transport). */
  loaded: boolean;
}

export interface IntelTile {
  terrain: TerrainId;
  name: string;
  /** The data's one-line rules hint. */
  note: string;
  /** The stars this unit actually gets here: 0 for an air unit, which takes no cover. */
  stars: number;
  /** The terrain's own stars, from the data. */
  terrainStars: number;
  property: boolean;
  /** Short name of the property's owner; null when it is unowned or not a property. */
  owner: FactionId | null;
  /** Capture points left on a property being taken (below 20), else null. */
  capture: number | null;
}

export type IntelModel =
  | { kind: 'unit'; reason: IntelReason; /** The step whose event chose this unit. */ fromStep: number; unit: IntelUnit; tile: IntelTile }
  | { kind: 'empty'; message: string };

const SEEN = (id: number): boolean => Number.isInteger(id) && id !== UNSEEN_UNIT;

/**
 * The unit an event list shows ACTING, in event order, skipping any id the frame does not hold. Only events the viewer was given are
 * passed in, so a unit it was never shown cannot be named here, and the frame check drops one that has since left its sight.
 */
export function actingUnitId(events: readonly GameEvent[], frame: ViewFrame): number | null {
  for (const e of events) {
    let id: number | undefined;
    switch (e.kind) {
      case 'moved': case 'ambushed': case 'captureProgress': case 'loaded': case 'built':
        id = e.unitId; break;
      case 'attacked': id = e.attackerId; break;
      case 'supplied': id = e.byId; break;
      case 'unloaded': case 'dropBlocked': id = e.transportId; break;
      case 'joined': id = e.intoId; break;
      default: break;
    }
    if (id !== undefined && SEEN(id) && findUnit(frame, id)) return id;
  }
  return null;
}

/** The unit the step struck, when no acting unit is in sight: the defender of a shot from an unseen (or since destroyed) shooter. */
export function struckUnitId(events: readonly GameEvent[], frame: ViewFrame): number | null {
  for (const e of events) if (e.kind === 'attacked' && SEEN(e.defenderId) && findUnit(frame, e.defenderId)) return e.defenderId;
  return null;
}

function tileModel(frame: ViewFrame, unit: { x: number; y: number; type: UnitTypeId }): IntelTile {
  const t = frame.tiles[unit.y]?.[unit.x];
  const terrain: TerrainId = t?.terrain ?? 'flats';
  const def = TERRAIN_TYPES[terrain] ?? TERRAIN_TYPES.flats;
  const airborne = UNIT_TYPES[unit.type].domain === 'air';
  const owner = def.property && t && t.owner !== null ? frame.players[t.owner]?.faction ?? null : null;
  return {
    terrain: def.id,
    name: def.name,
    note: def.note ?? '',
    stars: airborne ? 0 : def.def,
    terrainStars: def.def,
    property: def.property === true,
    owner,
    capture: def.property && t?.capture !== undefined && t.capture < CAPTURE_POINTS ? t.capture : null,
  };
}

function unitModel(frame: ViewFrame, id: number): { unit: IntelUnit; tile: IntelTile } | null {
  const u = findUnit(frame, id);
  if (!u) return null;
  const type = UNIT_TYPES[u.type];
  const owner = frame.players[u.owner];
  if (!type || !owner) return null;
  const commander = Object.prototype.hasOwnProperty.call(COMMANDERS, owner.commander) ? COMMANDERS[owner.commander] : undefined;
  const hp = unitDisplayHp(u);
  const top = frame.units.find((x) => x.id === id); // a unit carried aboard is not top level; an enemy transport says only THAT it carries
  const ammo: IntelAmmo | null = type.ammo === null ? null : { value: u.ammo, max: type.ammo, low: u.ammo <= 1 };
  const unit: IntelUnit = {
    id: u.id,
    type: u.type,
    name: type.name,
    role: type.role,
    moveTypeName: MOVE_TYPE_NAMES[type.moveType] ?? type.moveType,
    owner: u.owner,
    faction: owner.faction,
    factionName: FACTIONS[owner.faction].name,
    commanderName: commander?.name ?? 'Commander',
    hp,
    hpCritical: hp <= 3,
    charge: u.charge,
    chargeMax: type.charge,
    chargeLow: u.charge <= Math.round(type.charge * 0.2),
    drains: (type.drain ?? 0) > 0,
    airborne: type.domain === 'air',
    ammo,
    weapon: ammo ? 'limited' : type.range === null ? 'unarmed' : 'unlimited',
    spent: isSpent(frame, u),
    status: unitStatus(frame, u),
    loaded: top ? top.loaded : u.cargo.length > 0,
  };
  return { unit, tile: tileModel(frame, u) };
}

/** What the card shows at timeline step `index`. Reads only `steps`, which is one viewer's timeline. */
export function intelAt(steps: readonly Pick<TimelineStep, 'index' | 'frame' | 'events'>[], index: number): IntelModel {
  const at = Math.max(0, Math.min(steps.length - 1, Math.trunc(Number.isFinite(index) ? index : 0)));
  const step = steps[at];
  if (!step) return { kind: 'empty', message: 'Nothing has acted yet.' };
  const frame = step.frame;
  const make = (id: number, reason: IntelReason, fromStep: number): IntelModel | null => {
    const m = unitModel(frame, id);
    return m ? { kind: 'unit', reason, fromStep, unit: m.unit, tile: m.tile } : null;
  };

  const acting = actingUnitId(step.events, frame);
  if (acting !== null) {
    const m = make(acting, 'acting', step.index);
    if (m) return m;
  }
  const struck = struckUnitId(step.events, frame);
  if (struck !== null) {
    const m = make(struck, 'struck', step.index);
    if (m) return m;
  }
  // The last unit that acted before this step and is still in the viewer's current frame.
  for (let s = at - 1; s >= 1; s--) {
    const past = steps[s];
    if (!past) continue;
    const id = actingUnitId(past.events, frame);
    if (id === null) continue;
    const m = make(id, 'last', past.index);
    if (m) return m;
  }
  return {
    kind: 'empty',
    message: at === 0 ? 'Nothing has acted yet. Intel appears when a unit moves.' : 'No unit in sight has acted. Intel appears when one does.',
  };
}

/** The caption beside the card's kicker. */
export function intelReasonLabel(m: Extract<IntelModel, { kind: 'unit' }>): string {
  return m.reason === 'acting' ? 'Acting now' : m.reason === 'struck' ? 'Under fire' : `Last to act, step ${m.fromStep}`;
}
