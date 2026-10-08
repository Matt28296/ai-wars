// The standing orders a player gives their agent (D-005). They are STRUCTURED: fixed options and whole numbers, never free text, so no
// player-written string can reach the engine or any prompt. validateOrders is the only door: it refuses every unknown key, every value
// outside its enum or range, and every string that is not a member of its enum. The orders the brain reads are always a validated copy.
//
// Display names are for the UI; the ids are what is stored and sent. The default posture is Hold the Line (Act I mission 1 says so).

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

export interface StandingOrders {
  posture: Posture;
  /** A unit at or below this DISPLAY HP (1-9) falls back to be repaired; 0 = never retreat. */
  retreatAtHp: number;
  powerPolicy: PowerPolicy;
  /** Production weights, whole numbers 0-10 per category. 0 = never build that category. */
  composition: Composition;
  /** Which kinds of target the agent prefers, first = most wanted. No duplicates. May be empty. */
  targetPriority: TargetPriority[];
}

export const POSTURES: readonly Posture[] = ['advance', 'holdTheLine', 'fallBack'];
export const POWER_POLICIES: readonly PowerPolicy[] = ['whenReady', 'saveForOverclock', 'defensive'];
export const TARGET_PRIORITIES: readonly TargetPriority[] = ['capturers', 'indirects', 'transports', 'highestValue', 'weakest'];
export const COMPOSITION_KEYS: readonly (keyof Composition)[] = ['infantry', 'vehicles', 'indirect', 'air', 'naval'];

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
  refuseUnknownKeys(x, ['posture', 'retreatAtHp', 'powerPolicy', 'composition', 'targetPriority'], 'orders');
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

  let targetPriority: TargetPriority[] = [...d.targetPriority];
  if (has(x, 'targetPriority')) {
    const list = x.targetPriority;
    if (!Array.isArray(list)) throw new TypeError('orders.targetPriority: must be a list');
    if (list.length > TARGET_PRIORITIES.length) throw new TypeError(`orders.targetPriority: at most ${TARGET_PRIORITIES.length} entries`);
    targetPriority = Array.from(list, (v, i) => pickEnum(v, TARGET_PRIORITIES, `orders.targetPriority[${i}]`));
    if (new Set(targetPriority).size !== targetPriority.length) throw new TypeError('orders.targetPriority: no duplicates');
  }

  return { posture, retreatAtHp, powerPolicy, composition, targetPriority };
}
