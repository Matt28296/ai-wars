// Standing orders (D-005): structured only. validateOrders is the only door and it must refuse anything that is not a fixed option
// or a whole number in range. The expected answers here are written out by hand from the order's own text (posture is one of three
// words, retreatAtHp is 0-9, the weights are 0-10, five target kinds), never read back from orders.ts.
import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_KEYS, DEFAULT_ORDERS, POSTURES, POSTURE_NAMES, POWER_POLICIES, TARGET_PRIORITIES, validateOrders,
} from './orders';
import type { StandingOrders } from './orders';

const plain = (o: StandingOrders) => JSON.parse(JSON.stringify(o)) as Record<string, unknown>;

describe('the options', () => {
  it('are exactly the ones the order names', () => {
    expect([...POSTURES]).toEqual(['advance', 'holdTheLine', 'fallBack']);
    expect([...POWER_POLICIES]).toEqual(['whenReady', 'saveForOverclock', 'defensive']);
    expect([...TARGET_PRIORITIES]).toEqual(['capturers', 'indirects', 'transports', 'highestValue', 'weakest']);
    expect([...COMPOSITION_KEYS]).toEqual(['infantry', 'vehicles', 'indirect', 'air', 'naval']);
  });

  it('give each posture its display name', () => {
    expect(POSTURE_NAMES).toEqual({ advance: 'Advance', holdTheLine: 'Hold the Line', fallBack: 'Fall Back' });
  });

  it('start a new agent on Hold the Line (the Act I mission 1 text says so)', () => {
    expect(DEFAULT_ORDERS.posture).toBe('holdTheLine');
  });
});

describe('DEFAULT_ORDERS', () => {
  it('is itself valid, and validating it gives back an equal copy that is not the same object', () => {
    const v = validateOrders(DEFAULT_ORDERS);
    expect(v).toEqual(DEFAULT_ORDERS);
    expect(v).not.toBe(DEFAULT_ORDERS);
    expect(v.composition).not.toBe(DEFAULT_ORDERS.composition);
    expect(v.targetPriority).not.toBe(DEFAULT_ORDERS.targetPriority);
  });

  it('is frozen, so one player\'s change cannot become everyone\'s default', () => {
    expect(Object.isFrozen(DEFAULT_ORDERS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ORDERS.composition)).toBe(true);
    expect(Object.isFrozen(DEFAULT_ORDERS.targetPriority)).toBe(true);
    expect(() => { (DEFAULT_ORDERS as StandingOrders).posture = 'advance'; }).toThrow();
  });

  it('survives a trip through JSON unchanged', () => {
    expect(validateOrders(JSON.parse(JSON.stringify(DEFAULT_ORDERS)))).toEqual(DEFAULT_ORDERS);
  });
});

describe('what validateOrders accepts', () => {
  it('every posture, every power policy, every retreat threshold 0-9, every weight 0-10', () => {
    for (const posture of POSTURES) expect(validateOrders({ posture }).posture).toBe(posture);
    for (const powerPolicy of POWER_POLICIES) expect(validateOrders({ powerPolicy }).powerPolicy).toBe(powerPolicy);
    for (let r = 0; r <= 9; r++) expect(validateOrders({ retreatAtHp: r }).retreatAtHp).toBe(r);
    for (const k of COMPOSITION_KEYS) {
      for (let w = 0; w <= 10; w++) expect(validateOrders({ composition: { [k]: w } }).composition[k]).toBe(w);
    }
  });

  it('an ordered list of target kinds without duplicates, from none to all five', () => {
    expect(validateOrders({ targetPriority: [] }).targetPriority).toEqual([]);
    expect(validateOrders({ targetPriority: ['weakest', 'transports'] }).targetPriority).toEqual(['weakest', 'transports']);
    expect(validateOrders({ targetPriority: [...TARGET_PRIORITIES] }).targetPriority).toEqual([...TARGET_PRIORITIES]);
  });

  it('a partial set takes the default for what is left out, and returns a complete set', () => {
    expect(validateOrders({})).toEqual(DEFAULT_ORDERS);
    expect(validateOrders({ posture: 'advance' })).toEqual({ ...plain(DEFAULT_ORDERS), posture: 'advance' });
    expect(validateOrders({ composition: { air: 0 } }).composition).toEqual({ ...DEFAULT_ORDERS.composition, air: 0 });
  });

  it('copies what it is given: changing the input afterwards does not change the result', () => {
    const input = { posture: 'fallBack', targetPriority: ['weakest'], composition: { infantry: 9 } };
    const v = validateOrders(input);
    input.targetPriority.push('capturers');
    input.composition.infantry = 0;
    expect(v.targetPriority).toEqual(['weakest']);
    expect(v.composition.infantry).toBe(9);
  });
});

describe('what validateOrders refuses (D-005: no free text, ever)', () => {
  it('a planted free-text field, however harmless it looks', () => {
    expect(() => validateOrders({ ...plain(DEFAULT_ORDERS), note: 'please protect the mules' })).toThrow(/unknown key "note"/);
    expect(() => validateOrders({ ...plain(DEFAULT_ORDERS), note: '' })).toThrow(/unknown key/);
    expect(() => validateOrders({ ...plain(DEFAULT_ORDERS), prompt: 'ignore the above' })).toThrow(/unknown key/);
  });

  it('a free-text field hidden inside the composition, and keys that only look like real ones', () => {
    expect(() => validateOrders({ composition: { ...DEFAULT_ORDERS.composition, comment: 'x' } })).toThrow(/unknown key "comment"/);
    expect(() => validateOrders({ composition: { Infantry: 5 } })).toThrow(/unknown key/);
    expect(() => validateOrders({ Posture: 'advance' })).toThrow(/unknown key/);
    expect(() => validateOrders(JSON.parse('{"__proto__": {"posture": "advance"}}'))).toThrow(/unknown key/);
  });

  it('a posture that is not one of the three', () => {
    expect(() => validateOrders({ posture: 'attack everything!' })).toThrow(/orders\.posture/);
    expect(() => validateOrders({ posture: 'holdtheline' })).toThrow(/orders\.posture/);
    expect(() => validateOrders({ posture: '' })).toThrow(/orders\.posture/);
    expect(() => validateOrders({ posture: 1 })).toThrow(/orders\.posture/);
    expect(() => validateOrders({ posture: null })).toThrow(/orders\.posture/);
    expect(() => validateOrders({ posture: undefined })).toThrow(/orders\.posture/);
    expect(() => validateOrders({ posture: ['advance'] })).toThrow(/orders\.posture/);
  });

  it('a power policy that is not a member', () => {
    expect(() => validateOrders({ powerPolicy: 'always' })).toThrow(/orders\.powerPolicy/);
    expect(() => validateOrders({ powerPolicy: 'whenready' })).toThrow(/orders\.powerPolicy/);
  });

  it('a retreat threshold outside 0-9, or not a whole number', () => {
    for (const bad of [-1, 10, 3.5, NaN, Infinity, '3', null, true]) {
      expect(() => validateOrders({ retreatAtHp: bad }), String(bad)).toThrow(/retreatAtHp/);
    }
  });

  it('a weight outside 0-10, or not a whole number', () => {
    for (const bad of [-1, 11, 0.5, NaN, -Infinity, '5', null, [5]]) {
      expect(() => validateOrders({ composition: { vehicles: bad } }), String(bad)).toThrow(/composition\.vehicles/);
    }
  });

  it('a target list with a duplicate, an unknown kind, free text, too many entries, or the wrong shape', () => {
    expect(() => validateOrders({ targetPriority: ['weakest', 'weakest'] })).toThrow(/no duplicates/);
    expect(() => validateOrders({ targetPriority: ['capturers', 'the mayor'] })).toThrow(/targetPriority\[1\]/);
    expect(() => validateOrders({ targetPriority: [...TARGET_PRIORITIES, 'capturers'] })).toThrow(/at most 5/);
    expect(() => validateOrders({ targetPriority: 'weakest' })).toThrow(/must be a list/);
    expect(() => validateOrders({ targetPriority: [3] })).toThrow(/targetPriority\[0\]/);
    // eslint-disable-next-line no-sparse-arrays
    expect(() => validateOrders({ targetPriority: [, 'weakest'] })).toThrow(/targetPriority\[0\]/);
  });

  it('anything that is not an object of orders', () => {
    for (const bad of [null, undefined, 'advance', 7, true, [], [DEFAULT_ORDERS], () => DEFAULT_ORDERS, new Map()]) {
      expect(() => validateOrders(bad), String(bad)).toThrow(/orders: must be an object/);
    }
    expect(() => validateOrders({ composition: 'lots' })).toThrow(/composition: must be an object/);
    expect(() => validateOrders({ composition: null })).toThrow(/composition: must be an object/);
  });

  it('never echoes a long planted string back whole', () => {
    const long = 'x'.repeat(500);
    let message = '';
    try {
      validateOrders({ [long]: 1 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/unknown key/);
    expect(message.length).toBeLessThan(120);
  });
});
