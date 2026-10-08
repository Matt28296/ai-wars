// The standing orders a player gives their agent (D-005). They are STRUCTURED: fixed options and whole numbers, never free text, so no
// player-written string can reach the engine or any prompt. validateOrders is the only door: it refuses every unknown key, every value
// outside its enum or range, and every string that is not a member of its enum. The orders the brain reads are always a validated copy.
//
// Display names are for the UI; the ids are what is stored and sent. The default posture is Hold the Line (Act I mission 1 says so).
//
// M3.4: the army-wide orders can be refined per KIND of unit. Six unit groups (infantry, armour, artillery, air, navy, transports) each take
// a GroupOrders entry (`groups`), and a single unit type may take its own (`types`). Each field of a GroupOrders falls through when it is
// missing: the unit type's entry, then its group's, then the army-wide orders (`ordersFor`). `mission` is a fixed per-group list of jobs
// (GROUP_MISSIONS), and a mission from another group is refused, so no order can name a job the group has no meaning for. Still no free
// text anywhere (D-005). A set of orders with no `groups` and no `types` is exactly what it was before M3.4.
import type { UnitTypeId } from '../aw/types';

export type Posture = 'advance' | 'holdTheLine' | 'fallBack';
export type PowerPolicy = 'whenReady' | 'saveForOverclock' | 'defensive';
export type TargetPriority = 'capturers' | 'indirects' | 'transports' | 'highestValue' | 'weakest';

/** The five army categories the production weights are given in. Infantry: Trooper, Breacher. Vehicles: Skimmer, Lancer, Bastion,
 *  Colossus, Warden, Mule. Indirect: Arc, Salvo. Air: Wasp, Raptor, Anvil. Naval: Picket, Dreadnought, Barge. */
export interface Composition {
  infantry: number;
  vehicles: number;
  indirect: number;
  air: number;
  naval: number;
}

export type UnitGroup = 'infantry' | 'armour' | 'artillery' | 'air' | 'navy' | 'transports';
/** What a group is told to do (M3.4). Each group allows only its own missions (GROUP_MISSIONS); the first one listed is the default. */
export type Mission =
  | 'capture' | 'fight'                    // infantry
  | 'frontline'                            // armour and navy
  | 'support'                              // artillery
  | 'strike' | 'scout'                     // air
  | 'ferry' | 'stayBack'                   // transports
  | 'escort'                               // armour, air and navy
  | 'guardBase';                           // every group but transports

/** Orders for one group or one unit type. Every field is optional; a missing field falls through to the next level (see ordersFor). */
export interface GroupOrders {
  posture?: Posture;
  /** 0-9, as the army-wide field. */
  retreatAtHp?: number;
  targetPriority?: TargetPriority[];
  mission?: Mission;
}

export interface StandingOrders {
  posture: Posture;
  /** A unit at or below this DISPLAY HP (1-9) falls back to be repaired; 0 = never retreat. */
  retreatAtHp: number;
  powerPolicy: PowerPolicy;
  /** Production weights, whole numbers 0-10 per category. 0 = never build that category. */
  composition: Composition;
  /** Which kinds of target the agent prefers, first = most wanted. No duplicates. May be empty. */
  targetPriority: TargetPriority[];
  /** M3.4: orders per group of units. Absent (not empty) when no group has any. */
  groups?: Partial<Record<UnitGroup, GroupOrders>>;
  /** M3.4: orders per unit type, over its group's. Absent (not empty) when no type has any. */
  types?: Partial<Record<UnitTypeId, GroupOrders>>;
}

export const POSTURES: readonly Posture[] = ['advance', 'holdTheLine', 'fallBack'];
export const POWER_POLICIES: readonly PowerPolicy[] = ['whenReady', 'saveForOverclock', 'defensive'];
export const TARGET_PRIORITIES: readonly TargetPriority[] = ['capturers', 'indirects', 'transports', 'highestValue', 'weakest'];
export const COMPOSITION_KEYS: readonly (keyof Composition)[] = ['infantry', 'vehicles', 'indirect', 'air', 'naval'];

export const UNIT_GROUPS: readonly UnitGroup[] = deepFreeze<UnitGroup[]>(['infantry', 'armour', 'artillery', 'air', 'navy', 'transports']);

/** The members of each group: every unit type is in exactly one (unit-orders.test.ts checks this against the unit list). Frozen. */
export const GROUP_MEMBERS: Readonly<Record<UnitGroup, readonly UnitTypeId[]>> = deepFreeze<Record<UnitGroup, UnitTypeId[]>>({
  infantry: ['trooper', 'breacher'],
  armour: ['skimmer', 'lancer', 'bastion', 'colossus', 'warden'],
  artillery: ['arc', 'salvo'],
  air: ['wasp', 'raptor', 'anvil'],
  navy: ['picket', 'dreadnought'],
  transports: ['mule', 'barge'],
});

/** Every unit type that has a group, in group order. */
export const GROUPED_TYPES: readonly UnitTypeId[] = UNIT_GROUPS.flatMap((g) => GROUP_MEMBERS[g]);

const GROUP_OF = new Map<UnitTypeId, UnitGroup>(UNIT_GROUPS.flatMap((g) => GROUP_MEMBERS[g].map((t): [UnitTypeId, UnitGroup] => [t, g])));

export function groupOf(t: UnitTypeId): UnitGroup {
  const g = GROUP_OF.get(t);
  if (!g) throw new RangeError(`groupOf: no group for unit type ${String(t)}`);
  return g;
}

/**
 * The missions each group may be given, the first being its default (what Doctrine did before M3.4):
 *   infantry     capture (take the properties it is assigned) | fight (no capture; fights like armour) | guardBase (within 3 tiles of my
 *                base, capturing only there)
 *   armour, navy frontline (the posture's line) | escort (within 2 tiles of a friendly capturer that has a property to take) | guardBase
 *   artillery    support (behind the direct units) | guardBase
 *   air          strike (the posture's line) | escort | scout (fog: ends of move that show the most unseen tiles; takes only fights it wins
 *                outright) | guardBase
 *   transports   ferry (carry capturers) | stayBack (carries no one; parks within 3 tiles of my base)
 * "My base" is my spire and every production property I hold (fabricator, skyport, dock): eval.ts baseTiles. Distances are Manhattan.
 * Frozen.
 */
export const GROUP_MISSIONS: Readonly<Record<UnitGroup, readonly Mission[]>> = deepFreeze<Record<UnitGroup, Mission[]>>({
  infantry: ['capture', 'fight', 'guardBase'],
  armour: ['frontline', 'escort', 'guardBase'],
  artillery: ['support', 'guardBase'],
  air: ['strike', 'escort', 'scout', 'guardBase'],
  navy: ['frontline', 'escort', 'guardBase'],
  transports: ['ferry', 'stayBack'],
});

export const defaultMission = (g: UnitGroup): Mission => GROUP_MISSIONS[g][0];

export const GROUP_NAMES: Readonly<Record<UnitGroup, string>> = {
  infantry: 'Infantry',
  armour: 'Armour',
  artillery: 'Artillery',
  air: 'Air',
  navy: 'Navy',
  transports: 'Transports',
};

export const MISSION_NAMES: Readonly<Record<Mission, string>> = {
  capture: 'Capture',
  fight: 'Fight',
  guardBase: 'Guard the base',
  frontline: 'Front line',
  escort: 'Escort capturers',
  support: 'Support',
  strike: 'Strike',
  scout: 'Scout',
  ferry: 'Ferry',
  stayBack: 'Stay back',
};

export const POSTURE_NAMES: Readonly<Record<Posture, string>> = {
  advance: 'Advance',
  holdTheLine: 'Hold the Line',
  fallBack: 'Fall Back',
};
export const POWER_POLICY_NAMES: Readonly<Record<PowerPolicy, string>> = {
  whenReady: 'When ready',
  saveForOverclock: 'Save for Overclock',
  defensive: 'Defensive',
};
export const TARGET_PRIORITY_NAMES: Readonly<Record<TargetPriority, string>> = {
  capturers: 'Capturers',
  indirects: 'Indirect-fire units',
  transports: 'Transports',
  highestValue: 'Highest value',
  weakest: 'Weakest',
};

export const MAX_RETREAT_HP = 9;
export const MAX_WEIGHT = 10;

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

/** The orders a new agent starts with: Hold the Line, retreat at 3 HP, use a power as soon as it is ready, a balanced army, and the
 *  targets a careful commander wants first. Frozen: copy it before changing it. */
export const DEFAULT_ORDERS: Readonly<StandingOrders> = deepFreeze<StandingOrders>({
  posture: 'holdTheLine',
  retreatAtHp: 3,
  powerPolicy: 'whenReady',
  composition: { infantry: 5, vehicles: 5, indirect: 3, air: 2, naval: 2 },
  targetPriority: ['capturers', 'indirects', 'highestValue'],
});

const isPlainObject = (x: unknown): x is Record<string, unknown> => {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function refuseUnknownKeys(o: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new TypeError(`${where}: unknown key "${k.length > 40 ? `${k.slice(0, 40)}...` : k}"`);
  }
}

function pickEnum<T extends string>(value: unknown, members: readonly T[], where: string): T {
  if (typeof value !== 'string' || !(members as readonly string[]).includes(value)) {
    throw new TypeError(`${where}: must be one of ${members.join(', ')}`);
  }
  return value as T;
}

function pickInt(value: unknown, min: number, max: number, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${where}: must be a whole number from ${min} to ${max}`);
  }
  return value;
}

/**
 * Checks an unknown value and returns the orders it describes, as a fresh object the caller may keep. Throws TypeError for a value that
 * is not an object of exactly these keys: any unknown key (a free-text "note", say), a posture or policy that is not an enum member,
 * a number that is not a whole number in range, a duplicate or unknown target priority. A key that is left out takes its default, so
 * `{ posture: 'advance' }` is a complete set of orders; a key that is present must be valid.
 */
export function validateOrders(x: unknown): StandingOrders {
  if (!isPlainObject(x)) throw new TypeError('orders: must be an object');
  refuseUnknownKeys(x, ['posture', 'retreatAtHp', 'powerPolicy', 'composition', 'targetPriority', 'groups', 'types'], 'orders');
  const d = DEFAULT_ORDERS;

  const posture = has(x, 'posture') ? pickEnum(x.posture, POSTURES, 'orders.posture') : d.posture;
  const retreatAtHp = has(x, 'retreatAtHp') ? pickInt(x.retreatAtHp, 0, MAX_RETREAT_HP, 'orders.retreatAtHp') : d.retreatAtHp;
  const powerPolicy = has(x, 'powerPolicy') ? pickEnum(x.powerPolicy, POWER_POLICIES, 'orders.powerPolicy') : d.powerPolicy;

  const composition: Composition = { ...d.composition };
  if (has(x, 'composition')) {
    const c = x.composition;
    if (!isPlainObject(c)) throw new TypeError('orders.composition: must be an object');
    refuseUnknownKeys(c, COMPOSITION_KEYS, 'orders.composition');
    for (const k of COMPOSITION_KEYS) {
      if (has(c, k)) composition[k] = pickInt(c[k], 0, MAX_WEIGHT, `orders.composition.${k}`);
    }
  }

  const targetPriority: TargetPriority[] = has(x, 'targetPriority') ? pickTargets(x.targetPriority, 'orders.targetPriority') : [...d.targetPriority];

  const out: StandingOrders = { posture, retreatAtHp, powerPolicy, composition, targetPriority };
  // The two per-unit tables are left OUT when they hold nothing, so orders that mean the same thing validate to the same object (and
  // Doctrine's tie-break seed, which hashes the orders, is the one it was before M3.4).
  const groups = has(x, 'groups') ? pickTable(x.groups, UNIT_GROUPS, (k) => k, 'orders.groups') : undefined;
  if (groups) out.groups = groups;
  const types = has(x, 'types') ? pickTable(x.types, GROUPED_TYPES, groupOf, 'orders.types') : undefined;
  if (types) out.types = types;
  return out;
}

function pickTargets(list: unknown, where: string): TargetPriority[] {
  if (!Array.isArray(list)) throw new TypeError(`${where}: must be a list`);
  if (list.length > TARGET_PRIORITIES.length) throw new TypeError(`${where}: at most ${TARGET_PRIORITIES.length} entries`);
  const out = Array.from(list, (v, i) => pickEnum(v, TARGET_PRIORITIES, `${where}[${i}]`));
  if (new Set(out).size !== out.length) throw new TypeError(`${where}: no duplicates`);
  return out;
}

/** One GroupOrders: only its four keys, each a member of its enum or a whole number in range, a mission of THIS group only. */
function pickGroupOrders(x: unknown, group: UnitGroup, where: string): GroupOrders {
  if (!isPlainObject(x)) throw new TypeError(`${where}: must be an object`);
  refuseUnknownKeys(x, ['posture', 'retreatAtHp', 'targetPriority', 'mission'], where);
  const out: GroupOrders = {};
  if (has(x, 'posture')) out.posture = pickEnum(x.posture, POSTURES, `${where}.posture`);
  if (has(x, 'retreatAtHp')) out.retreatAtHp = pickInt(x.retreatAtHp, 0, MAX_RETREAT_HP, `${where}.retreatAtHp`);
  if (has(x, 'targetPriority')) out.targetPriority = pickTargets(x.targetPriority, `${where}.targetPriority`);
  if (has(x, 'mission')) out.mission = pickEnum(x.mission, GROUP_MISSIONS[group], `${where}.mission`);
  return out;
}

/** A table of GroupOrders keyed by group or by unit type. Entries that say nothing are dropped; a table that says nothing is `undefined`. */
function pickTable<K extends string>(
  x: unknown, keys: readonly K[], groupFor: (k: K) => UnitGroup, where: string,
): Partial<Record<K, GroupOrders>> | undefined {
  if (!isPlainObject(x)) throw new TypeError(`${where}: must be an object`);
  refuseUnknownKeys(x, keys, where);
  const out: Partial<Record<K, GroupOrders>> = {};
  let any = false;
  for (const k of keys) {
    if (!has(x, k)) continue;
    const g = pickGroupOrders(x[k], groupFor(k), `${where}.${k}`);
    if (Object.keys(g).length === 0) continue;
    out[k] = g;
    any = true;
  }
  return any ? out : undefined;
}

/** What one unit type is actually told: every field resolved type, then group, then the army-wide orders (the mission: type, group, then the group's default). */
export interface UnitOrders {
  posture: Posture;
  retreatAtHp: number;
  targetPriority: readonly TargetPriority[];
  mission: Mission;
}

/** The orders in force for a unit of this type. `orders` is a validated set. With no `groups` and no `types` it is the army-wide orders. */
export function ordersFor(orders: StandingOrders, type: UnitTypeId): UnitOrders {
  const group = groupOf(type);
  const own = orders.types?.[type];
  const grp = orders.groups?.[group];
  return {
    posture: own?.posture ?? grp?.posture ?? orders.posture,
    retreatAtHp: own?.retreatAtHp ?? grp?.retreatAtHp ?? orders.retreatAtHp,
    targetPriority: own?.targetPriority ?? grp?.targetPriority ?? orders.targetPriority,
    mission: own?.mission ?? grp?.mission ?? defaultMission(group),
  };
}
