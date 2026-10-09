// The battle's command buttons (G19, D-025), pure of React: what each button does to a set of standing orders, which of them is in force, and the
// words for them.
//
// D-005 / D-025: a button only sets standing orders from the fixed options and numbers, and every result ends in `validateOrders` (the engine's only
// door), so a button can only ever produce orders that door accepts. D-022: a change counts from the player's next turn; the page says so and the log
// notes it when it applies, exactly as for any other order change (ordersModel.ts).
//
// A POSTURE command (Charge, Hold, Fall back) sets the posture of every group and leaves each group's other fields (mission, retreat, targets) as they
// are. A unit type that was given a posture of its own (under "More") would still hold the old one, and "every group Advance" would not be true of it,
// so a posture command also drops the type's own posture, and only that field. Take bases sets the infantry mission to Capture and the armour mission
// to Escort, and in the same way drops the missions that the unit types of those two groups were given. The pressed state is read from the orders back
// the same way (every unit type, resolved), so orders changed through More, so that no command matches, show none pressed.
import { GROUP_MEMBERS, GROUPED_TYPES, UNIT_GROUPS, ordersFor, validateOrders } from '../../game/doctrine';
import type { Posture, PowerPolicy, StandingOrders } from '../../game/doctrine';
import { sameOrders, setMission, setPosture, setPowerPolicy } from './ordersModel';

/** The three posture commands, in the order the row shows them. */
export const POSTURE_COMMANDS = ['charge', 'hold', 'fallBack'] as const;
export type PostureCommand = (typeof POSTURE_COMMANDS)[number];

export const POSTURE_OF: Readonly<Record<PostureCommand, Posture>> = { charge: 'advance', hold: 'holdTheLine', fallBack: 'fallBack' };

/** The missions Take bases gives: infantry take properties, armour escorts the capturers. */
export const TAKE_BASES = { infantry: 'capture', armour: 'escort' } as const;

/** What the row says on each button, and the one line shown on hover or focus. None runs past one line. */
export const COMMAND_TEXT: Readonly<Record<PostureCommand | 'takeBases', { label: string; hint: string }>> = {
  charge: { label: 'Charge', hint: 'Every group presses the enemy and takes ground.' },
  hold: { label: 'Hold', hint: 'Every group keeps its line and trades only when it pays.' },
  fallBack: { label: 'Fall back', hint: 'Every group gives ground and stays near your base.' },
  takeBases: { label: 'Take bases', hint: 'Infantry capture properties; armour escorts them.' },
};

/** The power button names the policy in force (it is one toggle), and its hint says what pressing it does. */
export const POWER_TEXT: Readonly<Record<PowerPolicy, { label: string; hint: string }>> = {
  whenReady: { label: 'Power now', hint: 'Powers are used the turn they are ready. Press to save them.' },
  saveForOverclock: { label: 'Save power', hint: 'The meter is saved for Overclock. Press to use powers when ready.' },
  defensive: { label: 'Power held', hint: 'Powers wait until the army is under pressure. Press to use them when ready.' },
};

export const MORE_HINT = 'Missions, retreat, targets and single unit types.';

/** Every group's posture set to `posture`, and the postures of single unit types dropped (they would otherwise still stand). Other fields untouched. */
export function applyPosture(orders: StandingOrders, posture: Posture): StandingOrders {
  let next = validateOrders(orders);
  for (const group of UNIT_GROUPS) next = setPosture(next, { group }, posture);
  if (next.types) {
    const copy = structuredClone(next);
    const types = copy.types ?? {};
    for (const [id, own] of Object.entries(types)) {
      if (!own) continue;
      delete own.posture;
      if (Object.keys(own).length === 0) delete (types as Record<string, unknown>)[id];
    }
    if (Object.keys(types).length === 0) delete copy.types;
    next = validateOrders(copy);
  }
  return next;
}

/** The posture command for `command`. */
export const applyPostureCommand = (orders: StandingOrders, command: PostureCommand): StandingOrders => applyPosture(orders, POSTURE_OF[command]);

/** Infantry take properties and armour escorts them; the missions single infantry and armour types were given are dropped. Other fields untouched. */
export function applyTakeBases(orders: StandingOrders): StandingOrders {
  let next = validateOrders(orders);
  next = setMission(next, { group: 'infantry' }, TAKE_BASES.infantry);
  next = setMission(next, { group: 'armour' }, TAKE_BASES.armour);
  if (next.types) {
    const copy = structuredClone(next);
    const types = copy.types ?? {};
    for (const group of ['infantry', 'armour'] as const) {
      for (const id of GROUP_MEMBERS[group]) {
        const own = types[id];
        if (!own) continue;
        delete own.mission;
        if (Object.keys(own).length === 0) delete types[id];
      }
    }
    if (Object.keys(types).length === 0) delete copy.types;
    next = validateOrders(copy);
  }
  return next;
}

/** The one power toggle: use powers when ready, or save the meter for Overclock. From any other policy it goes to "when ready". */
export const togglePower = (orders: StandingOrders): StandingOrders => setPowerPolicy(orders, orders.powerPolicy === 'whenReady' ? 'saveForOverclock' : 'whenReady');

/** Which posture command is in force: the one whose posture EVERY unit type resolves to, else none. */
export function activePosture(orders: StandingOrders): PostureCommand | null {
  const o = validateOrders(orders);
  const first = ordersFor(o, GROUPED_TYPES[0]).posture;
  if (!GROUPED_TYPES.every((t) => ordersFor(o, t).posture === first)) return null;
  return POSTURE_COMMANDS.find((c) => POSTURE_OF[c] === first) ?? null;
}

/** Take bases is in force when every infantry unit type captures and every armour unit type escorts. */
export function takeBasesInForce(orders: StandingOrders): boolean {
  const o = validateOrders(orders);
  return GROUP_MEMBERS.infantry.every((t) => ordersFor(o, t).mission === TAKE_BASES.infantry) && GROUP_MEMBERS.armour.every((t) => ordersFor(o, t).mission === TAKE_BASES.armour);
}

/** Every command button, as the row draws them. */
export type CommandId = PostureCommand | 'takeBases' | 'power';

/**
 * What pressing a button does to the orders shown: the new orders, or null when they would be the same (a command already in force stays in force,
 * and a press then sends nothing). The result is always something `validateOrders` accepts.
 */
export function press(orders: StandingOrders, id: CommandId): StandingOrders | null {
  const next = id === 'takeBases' ? applyTakeBases(orders) : id === 'power' ? togglePower(orders) : applyPostureCommand(orders, id);
  return sameOrders(orders, next) ? null : next;
}
