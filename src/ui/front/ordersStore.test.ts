// The orders saved per mission (G14): they come back, they work without storage, and what comes back is always valid orders.
import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../../game/aw/replay';
import { DEFAULT_ORDERS } from '../../game/doctrine';
import { freshOrders, setPosture } from './ordersModel';
import { forgetVisit, loadOrders, ordersKey, saveOrders } from './ordersStore';

/** A storage that remembers what it is told, and can be made to throw. */
function fakeStorage(opts: { throws?: boolean } = {}) {
  const data = new Map<string, string>();
  const boom = (): never => { throw new Error('storage is blocked'); };
  return {
    data,
    getItem: (k: string): string | null => (opts.throws ? boom() : data.get(k) ?? null),
    setItem: (k: string, v: string): void => { if (opts.throws) boom(); data.set(k, v); },
    removeItem: (k: string): void => { if (opts.throws) boom(); data.delete(k); },
  };
}

const armour = () => setPosture(freshOrders(), { group: 'armour' }, 'advance');

describe('orders saved per mission', () => {
  beforeEach(forgetVisit);

  it('start as the defaults, and come back as saved, mission by mission', () => {
    const s = fakeStorage();
    expect(canonicalJson(loadOrders('first-light', s))).toBe(canonicalJson(DEFAULT_ORDERS));
    saveOrders('first-light', armour(), s);
    expect(s.data.get(ordersKey('first-light'))).toBeDefined();
    forgetVisit(); // as a new visit: only what storage holds
    expect(canonicalJson(loadOrders('first-light', s))).toBe(canonicalJson(armour()));
    expect(canonicalJson(loadOrders('calder-spire', s)), 'another mission keeps its own').toBe(canonicalJson(DEFAULT_ORDERS));
  });

  it('save the defaults as nothing, so a reset leaves no trace', () => {
    const s = fakeStorage();
    saveOrders('first-light', armour(), s);
    saveOrders('first-light', freshOrders(), s);
    expect(s.data.size).toBe(0);
    expect(canonicalJson(loadOrders('first-light', s))).toBe(canonicalJson(DEFAULT_ORDERS));
  });

  it('work with no storage at all: the orders set on one screen still reach the next, for the visit', () => {
    saveOrders('first-light', armour(), null);
    expect(canonicalJson(loadOrders('first-light', null))).toBe(canonicalJson(armour()));
    expect(canonicalJson(loadOrders('other', null))).toBe(canonicalJson(DEFAULT_ORDERS));
  });

  it('work when storage throws on every touch: nothing is thrown, and the visit still has the orders', () => {
    const s = fakeStorage({ throws: true });
    expect(() => saveOrders('first-light', armour(), s)).not.toThrow();
    expect(canonicalJson(loadOrders('first-light', s))).toBe(canonicalJson(armour()));
    forgetVisit();
    expect(canonicalJson(loadOrders('first-light', s)), 'a blocked store with nothing kept gives the defaults').toBe(canonicalJson(DEFAULT_ORDERS));
    expect(() => saveOrders('first-light', freshOrders(), s)).not.toThrow();
  });

  it('REFUSE what is not valid orders: corrupt text, a planted key, a number out of range, a wrong mission are the defaults, never an order', () => {
    const s = fakeStorage();
    const bad = [
      '{not json', 'null', '[]', '"attack"',
      JSON.stringify({ ...DEFAULT_ORDERS, note: 'attack the north gate' }),
      JSON.stringify({ ...DEFAULT_ORDERS, retreatAtHp: 40 }),
      JSON.stringify({ ...DEFAULT_ORDERS, groups: { armour: { mission: 'capture' } } }),
    ];
    for (const raw of bad) {
      s.data.set(ordersKey('first-light'), raw);
      expect(canonicalJson(loadOrders('first-light', s)), raw).toBe(canonicalJson(DEFAULT_ORDERS));
    }
  });

  it('refuse to save orders the engine refuses (nothing is stored)', () => {
    const s = fakeStorage();
    expect(() => saveOrders('first-light', { ...freshOrders(), note: 'hello' } as never, s)).toThrow(TypeError);
    expect(s.data.size).toBe(0);
  });
});
