// The orders card is saved per mission (G14), so the orders a player set come back the next time they open that mission. The browser's
// localStorage may be missing, full, blocked or throw on touch (a private window, a sandboxed frame, a test), so every read and write is
// in a try/catch, and the page keeps its own copy for the length of the visit: the orders set on the objective screen still reach Deploy
// when nothing can be stored. What comes back is always run through `validateOrders` (D-005): a stored value with a made-up key or an
// out-of-range number is refused, and the orders are then the defaults.
import type { StandingOrders } from '../../game/doctrine';
import { validateOrders } from '../../game/doctrine';
import { freshOrders, isDefaultOrders } from './ordersModel';

export const ordersKey = (missionId: string): string => `aw.orders.${missionId}`;

/** The page's own copy for this visit, as the JSON text that would have been stored. */
const memory = new Map<string, string>();

/** The browser's storage, or null where there is none or touching it throws. */
export function storageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The orders saved for a mission: this visit's copy, else the stored one, else the defaults. Never throws. */
export function loadOrders(missionId: string, storage: Pick<Storage, 'getItem'> | null = storageOrNull()): StandingOrders {
  const key = ordersKey(missionId);
  let raw: string | null | undefined = memory.get(key);
  if (raw === undefined) {
    try {
      raw = storage?.getItem(key);
    } catch {
      raw = undefined;
    }
  }
  if (raw === undefined || raw === null) return freshOrders();
  try {
    return validateOrders(JSON.parse(raw));
  } catch {
    return freshOrders();
  }
}

/** Saves the orders for a mission (the defaults are saved as nothing). Refuses orders `validateOrders` refuses. Storage failing is not an error. */
export function saveOrders(missionId: string, orders: StandingOrders, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = storageOrNull()): void {
  const o = validateOrders(orders);
  const key = ordersKey(missionId);
  if (isDefaultOrders(o)) {
    memory.delete(key);
    try { storage?.removeItem(key); } catch { /* nothing to do: the defaults are what comes back anyway */ }
    return;
  }
  const raw = JSON.stringify(o);
  memory.set(key, raw);
  try { storage?.setItem(key, raw); } catch { /* kept for this visit */ }
}

/** Forgets this visit's copy (tests). */
export function forgetVisit(): void {
  memory.clear();
}
