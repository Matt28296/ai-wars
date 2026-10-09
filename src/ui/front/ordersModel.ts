// The orders card's model (G14), pure: what the player's controls do to a set of standing orders, and the words for it.
//
// D-005: orders are fixed options and whole numbers, never free text. Every setter here ends in `validateOrders`, the engine's only door, so
// the card can only ever produce orders that door accepts: a mission from the wrong group, a number out of range or a made-up key throws a
// TypeError instead of becoming an order.
//
// D-022: orders are given per unit group (six of them), and a single unit type may be given its own. A control sets one field at one level.
// At the GROUP level a value equal to what it would fall through to (the army-wide default) is dropped, so orders that mean the same thing
// are the same object, and untouched orders are exactly DEFAULT_ORDERS (the battle is then the one Deploy has always fought). At the TYPE
// level an explicit choice is kept even when it equals the group's: it is the player's own, and `followGroup` is how it is given up.
import { UNIT_TYPES } from '../../data';
import type { UnitTypeId } from '../../game/aw';
import { canonicalJson } from '../../game/aw/replay';
import {
  DEFAULT_ORDERS, GROUP_MEMBERS, GROUP_MISSIONS, GROUP_NAMES, MISSION_NAMES, POSTURE_NAMES, POWER_POLICIES, POWER_POLICY_NAMES, TARGET_PRIORITIES,
  TARGET_PRIORITY_NAMES, UNIT_GROUPS, defaultMission, ordersFor, validateOrders,
} from '../../game/doctrine';
import type { GroupOrders, Mission as GroupMission, Posture, PowerPolicy, StandingOrders, TargetPriority, UnitGroup, UnitOrders } from '../../game/doctrine';
import type { OrderChange } from '../../agent/match';

/** At most this many target kinds may be chosen: the first is the most wanted. */
export const MAX_TARGETS = 3;

// ---------------------------------------------------------------- the orders themselves

/** A fresh, validated copy of the default orders (DEFAULT_ORDERS itself is frozen). */
export const freshOrders = (): StandingOrders => validateOrders(DEFAULT_ORDERS);

/** True when two sets of orders mean the same thing (both are validated first, so key order and a missing-versus-default field do not matter). */
export const sameOrders = (a: unknown, b: unknown): boolean => canonicalJson(validateOrders(a)) === canonicalJson(validateOrders(b));

export const isDefaultOrders = (o: unknown): boolean => sameOrders(o, DEFAULT_ORDERS);

/** Which orders a control writes to: a whole group, or one unit type (which falls through to its group). */
export type Level = { group: UnitGroup } | { type: UnitTypeId };
const isType = (l: Level): l is { type: UnitTypeId } => 'type' in l;

/** What the level is told now: its own fields, else its group's, else the army-wide ones (a mission: else the group's default). */
export function resolve(o: StandingOrders, l: Level): UnitOrders {
  if (isType(l)) return ordersFor(o, l.type);
  const g = o.groups?.[l.group];
  return {
    posture: g?.posture ?? o.posture,
    retreatAtHp: g?.retreatAtHp ?? o.retreatAtHp,
    targetPriority: g?.targetPriority ?? o.targetPriority,
    mission: g?.mission ?? defaultMission(l.group),
  };
}

/** The fields this level sets for itself (what is not here follows the level above). */
export function ownOrders(o: StandingOrders, l: Level): GroupOrders {
  return (isType(l) ? o.types?.[l.type] : o.groups?.[l.group]) ?? {};
}

/** True when a unit type has orders of its own. */
export const hasOwnOrders = (o: StandingOrders, t: UnitTypeId): boolean => Object.keys(o.types?.[t] ?? {}).length > 0;

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Writes `patch` over the level's own fields and returns the validated result. Throws TypeError when the result is not valid orders. */
function patchLevel(orders: StandingOrders, l: Level, patch: GroupOrders): StandingOrders {
  const next = structuredClone(validateOrders(orders)) as StandingOrders;
  const merged: GroupOrders = { ...ownOrders(next, l), ...patch };
  if (!isType(l)) {
    // A group's field that says what it would say anyway is no order at all.
    const g = l.group;
    if (merged.posture === next.posture) delete merged.posture;
    if (merged.retreatAtHp === next.retreatAtHp) delete merged.retreatAtHp;
    if (merged.mission === defaultMission(g)) delete merged.mission;
    if (merged.targetPriority && sameList(merged.targetPriority, next.targetPriority)) delete merged.targetPriority;
  }
  const key = isType(l) ? l.type : l.group;
  const table = ((isType(l) ? next.types : next.groups) ?? {}) as Record<string, GroupOrders>;
  if (Object.keys(merged).length === 0) delete table[key];
  else table[key] = merged;
  if (isType(l)) {
    if (Object.keys(table).length === 0) delete next.types;
    else next.types = table as StandingOrders['types'];
  } else if (Object.keys(table).length === 0) delete next.groups;
  else next.groups = table as StandingOrders['groups'];
  return validateOrders(next);
}

export const setPosture = (o: StandingOrders, l: Level, posture: Posture): StandingOrders => patchLevel(o, l, { posture });
export const setMission = (o: StandingOrders, l: Level, mission: GroupMission): StandingOrders => patchLevel(o, l, { mission });
export const setRetreat = (o: StandingOrders, l: Level, retreatAtHp: number): StandingOrders => patchLevel(o, l, { retreatAtHp });
export const setTargets = (o: StandingOrders, l: Level, targetPriority: TargetPriority[]): StandingOrders => patchLevel(o, l, { targetPriority: [...targetPriority] });

/** The unit type goes back to following its group: its own orders are dropped. */
export function followGroup(orders: StandingOrders, t: UnitTypeId): StandingOrders {
  const next = structuredClone(validateOrders(orders)) as StandingOrders;
  if (next.types) {
    delete next.types[t];
    if (Object.keys(next.types).length === 0) delete next.types;
  }
  return validateOrders(next);
}

export function setPowerPolicy(orders: StandingOrders, powerPolicy: PowerPolicy): StandingOrders {
  return validateOrders({ ...validateOrders(orders), powerPolicy });
}

/** Choose or drop a target kind: a new one goes last, a chosen one is dropped, and a fourth is refused (the list is returned as it was). */
export function toggleTarget(list: readonly TargetPriority[], id: TargetPriority, max = MAX_TARGETS): TargetPriority[] {
  if (list.includes(id)) return list.filter((t) => t !== id);
  return list.length >= max ? [...list] : [...list, id];
}

// ---------------------------------------------------------------- the words (short: a name, a number, or one line)

export const POSTURE_SHORT: Readonly<Record<Posture, string>> = { advance: 'Advance', holdTheLine: 'Hold', fallBack: 'Fall back' };
export const POWER_SHORT: Readonly<Record<PowerPolicy, string>> = { whenReady: 'When ready', saveForOverclock: 'Overclock', defensive: 'Defensive' };

/** The unit whose picture stands for each group. */
export const GROUP_ICON_UNIT: Readonly<Record<UnitGroup, UnitTypeId>> = {
  infantry: 'trooper', armour: 'lancer', artillery: 'arc', air: 'wasp', navy: 'picket', transports: 'mule',
};

export const retreatText = (n: number): string => (n === 0 ? 'Never' : `${n} HP`);
export const unitName = (t: UnitTypeId): string => UNIT_TYPES[t].name;

/** One line per control, shown on hover or focus. Each says what the choice does, and none runs past one line. */
export const HINTS = {
  posture: {
    advance: 'Press the enemy and take ground.',
    holdTheLine: 'Keep a line and trade only when it pays.',
    fallBack: 'Give ground and stay near your base.',
  } satisfies Record<Posture, string>,
  mission: {
    capture: 'Take the properties it is sent to.',
    fight: 'Fights like armour and takes nothing.',
    guardBase: 'Stays within 3 tiles of your base.',
    frontline: 'Holds the line the posture draws.',
    escort: 'Stays within 2 tiles of a capturer.',
    support: 'Stays behind the units that fight.',
    strike: 'Hits along the line the posture draws.',
    scout: 'Hunts for unseen ground and sure fights.',
    ferry: 'Carries capturers to their targets.',
    stayBack: 'Carries no one and parks near your base.',
  } satisfies Record<GroupMission, string>,
  power: {
    whenReady: 'Uses a power the turn it is ready.',
    saveForOverclock: 'Saves the meter for Overclock.',
    defensive: 'Holds powers until the army is under pressure.',
  } satisfies Record<PowerPolicy, string>,
  retreat: 'Falls back to repair at or below this HP. Never = 0.',
  targets: 'Choose up to three. The first is wanted most.',
  types: 'Give one unit type its own orders.',
  follows: 'Follows the group until you change it.',
  back: 'Drops its own orders: it follows the group again.',
  reset: 'Back to the default orders.',
} as const;

/** The one line shown beside an order that costs something, or null. Only these orders say anything. */
export function consequenceOf(group: UnitGroup, o: UnitOrders): string | null {
  if (group === 'infantry' && o.mission === 'fight') return 'No captures: no new income.';
  if (group === 'infantry' && o.mission === 'guardBase') return 'Captures only near your base.';
  if (group === 'transports' && o.mission === 'stayBack') return 'Carries no one.';
  if (group === 'air' && o.mission === 'scout') return 'Takes only fights it wins outright.';
  if (o.retreatAtHp === 0) return 'Never falls back to repair.';
  return null;
}

/** The members of a group with their display names. */
export const membersOf = (g: UnitGroup): { id: UnitTypeId; name: string }[] => GROUP_MEMBERS[g].map((id) => ({ id, name: unitName(id) }));

// ---------------------------------------------------------------- what changed, in words

const targetsText = (list: readonly TargetPriority[]): string => (list.length ? list.map((t) => TARGET_PRIORITY_NAMES[t]).join(', ') : 'none');
const retreatWords = (n: number): string => (n === 0 ? 'never retreat' : `retreat at ${n} HP`);

type Field = 'posture' | 'mission' | 'retreatAtHp' | 'targetPriority';
const FIELDS: readonly Field[] = ['posture', 'mission', 'retreatAtHp', 'targetPriority'];

function fieldText(label: string, f: Field, to: UnitOrders): string {
  switch (f) {
    case 'posture': return `${label}: ${POSTURE_NAMES[to.posture]}`;
    case 'mission': return `${label}: ${MISSION_NAMES[to.mission]}`;
    case 'retreatAtHp': return `${label}: ${retreatWords(to.retreatAtHp)}`;
    case 'targetPriority': return `${label}: targets ${targetsText(to.targetPriority)}`;
  }
}

const differs = (f: Field, a: UnitOrders, b: UnitOrders): boolean =>
  f === 'targetPriority' ? !sameList(a.targetPriority, b.targetPriority) : a[f] !== b[f];

/**
 * What a change of orders says, one short phrase per thing that changed, groups first (in their order), then single unit types, then
 * the power policy: "Armour: Advance", "Air: retreat at 5 HP", "Trooper: Fight", "Powers: Defensive". Empty when nothing the player can
 * set differs. Each level is compared as it resolves, and a unit type says only the fields it sets for itself, so a change to a group that
 * a unit type follows is said once, at the group.
 */
export function describeChange(prev: StandingOrders, next: StandingOrders): string[] {
  const a = validateOrders(prev);
  const b = validateOrders(next);
  const out: string[] = [];
  if (a.posture !== b.posture) out.push(`Army: ${POSTURE_NAMES[b.posture]}`);
  // G19: a command button (Charge, Hold, Fall back) changes every group to one posture; that is said once, not six times.
  const toPosture = new Set(UNIT_GROUPS.map((g) => resolve(b, { group: g }).posture));
  const allGroups = toPosture.size === 1 && UNIT_GROUPS.every((g) => differs('posture', resolve(a, { group: g }), resolve(b, { group: g })));
  if (allGroups) out.push(`All groups: ${POSTURE_NAMES[[...toPosture][0]]}`);
  for (const g of UNIT_GROUPS) {
    const from = resolve(a, { group: g });
    const to = resolve(b, { group: g });
    for (const f of FIELDS) if (differs(f, from, to) && !(allGroups && f === 'posture')) out.push(fieldText(GROUP_NAMES[g], f, to));
  }
  for (const g of UNIT_GROUPS) {
    for (const t of GROUP_MEMBERS[g]) {
      const ownA = a.types?.[t];
      const ownB = b.types?.[t];
      if (!ownA && !ownB) continue;
      if (ownA && !ownB) { out.push(`${unitName(t)}: follows ${GROUP_NAMES[g]}`); continue; }
      const from = ordersFor(a, t);
      const to = ordersFor(b, t);
      for (const f of FIELDS) if ((f in (ownB ?? {}) || f in (ownA ?? {})) && differs(f, from, to)) out.push(fieldText(unitName(t), f, to));
    }
  }
  if (a.powerPolicy !== b.powerPolicy) out.push(`Powers: ${POWER_POLICY_NAMES[b.powerPolicy]}`);
  return out;
}

/** The log line for orders that took effect: "Cycle 6 · Armour: Advance". Null when the change says nothing. */
export function changeNote(cycle: number, prev: StandingOrders, next: StandingOrders): string | null {
  const lines = describeChange(prev, next);
  return lines.length === 0 ? null : `Cycle ${cycle} · ${lines.join(' · ')}`;
}

export interface OrderNote {
  /** The action index the change applies from (the log shows it from the step that starts that turn). */
  step: number;
  text: string;
}

/** The notes for the log: one for each change after the first entry (the orders the battle started with are not a change made in it). */
export function notesOf(changes: readonly OrderChange[]): OrderNote[] {
  const out: OrderNote[] = [];
  for (let i = 1; i < changes.length; i++) {
    const text = changeNote(changes[i].cycle, changes[i - 1].orders, changes[i].orders);
    if (text) out.push({ step: changes[i].from, text });
  }
  return out;
}

export interface OrdersSummary {
  /** The debrief's one line: "Default orders", or the first few changes and how many more. */
  line: string;
  /** Every change, one per entry, for a tooltip. */
  all: string[];
}

const SHOWN_CHANGES = 3;

/** The orders a battle was played under, for the debrief: "Default orders", or each change with the cycle it began in. */
export function summariseOrders(changes: readonly OrderChange[]): OrdersSummary {
  const items: string[] = [];
  let prev: StandingOrders = DEFAULT_ORDERS;
  changes.forEach((c, i) => {
    const when = i === 0 ? 'from the start' : `from cycle ${c.cycle}`;
    for (const line of describeChange(prev, c.orders)) items.push(`${line} ${when}`);
    prev = c.orders;
  });
  if (items.length === 0) return { line: 'Default orders', all: ['Default orders'] };
  const shown = items.slice(0, SHOWN_CHANGES).join(' · ');
  return { line: items.length > SHOWN_CHANGES ? `${shown} · +${items.length - SHOWN_CHANGES} more` : shown, all: items };
}

// Re-exported so the card has one import for the fixed lists it draws.
export { GROUP_MISSIONS, MISSION_NAMES, POSTURE_NAMES, POWER_POLICIES, POWER_POLICY_NAMES, TARGET_PRIORITIES, TARGET_PRIORITY_NAMES, UNIT_GROUPS, GROUP_NAMES, GROUP_MEMBERS };
