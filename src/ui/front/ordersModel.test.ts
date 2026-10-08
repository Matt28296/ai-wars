// The orders card's model (G14). Expected answers are worked out here from the engine's own orders module (validateOrders, ordersFor, the fixed
// lists) and from the order's text, never read back from ordersModel.ts. Known-bad inputs come first where a check could pass vacuously.
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../game/aw/replay';
import type { UnitTypeId } from '../../game/aw';
import {
  DEFAULT_ORDERS, GROUP_MEMBERS, GROUP_MISSIONS, GROUP_NAMES, MAX_RETREAT_HP, POSTURES, POWER_POLICIES, TARGET_PRIORITIES, UNIT_GROUPS, ordersFor, validateOrders,
} from '../../game/doctrine';
import type { Posture, StandingOrders, TargetPriority } from '../../game/doctrine';
import type { OrderChange } from '../../agent/match';
import {
  HINTS, MAX_TARGETS, changeNote, consequenceOf, describeChange, followGroup, freshOrders, hasOwnOrders, isDefaultOrders, notesOf, resolve, sameOrders,
  setMission, setPosture, setPowerPolicy, setRetreat, setTargets, summariseOrders, toggleTarget,
} from './ordersModel';
import type { Level } from './ordersModel';

const fresh = freshOrders;
const accepted = (o: StandingOrders): void => {
  // "accepts unchanged": the engine's door gives back an equal object, and nothing was added or dropped on the way
  expect(canonicalJson(validateOrders(o))).toBe(canonicalJson(o));
};
const permutations = <T,>(xs: readonly T[], size: number): T[][] =>
  size === 0 ? [[]] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)], size - 1).map((rest) => [x, ...rest]));
const TYPES: readonly UnitTypeId[] = UNIT_GROUPS.flatMap((g) => GROUP_MEMBERS[g]);

describe('the card can only make orders the engine accepts', () => {
  it('starts as the default orders, validated, and not frozen (a copy the card may change)', () => {
    const o = fresh();
    expect(canonicalJson(o)).toBe(canonicalJson(DEFAULT_ORDERS));
    expect(Object.isFrozen(o)).toBe(false);
    expect(isDefaultOrders(o)).toBe(true);
  });

  it('every posture, mission, retreat value and ordered choice of up to three targets, for every group, is accepted unchanged and reads back as chosen', () => {
    let made = 0;
    for (const g of UNIT_GROUPS) {
      const level: Level = { group: g };
      for (const p of POSTURES) {
        const o = setPosture(fresh(), level, p);
        accepted(o);
        expect(resolve(o, level).posture).toBe(p);
        for (const t of GROUP_MEMBERS[g]) expect(ordersFor(o, t).posture, `${g}/${t}`).toBe(p);
        made++;
      }
      for (const m of GROUP_MISSIONS[g]) {
        const o = setMission(fresh(), level, m);
        accepted(o);
        expect(resolve(o, level).mission).toBe(m);
        for (const t of GROUP_MEMBERS[g]) expect(ordersFor(o, t).mission).toBe(m);
        made++;
      }
      for (let n = 0; n <= MAX_RETREAT_HP; n++) {
        const o = setRetreat(fresh(), level, n);
        accepted(o);
        expect(resolve(o, level).retreatAtHp).toBe(n);
        made++;
      }
      for (let size = 0; size <= MAX_TARGETS; size++) {
        for (const list of permutations(TARGET_PRIORITIES, size)) {
          const o = setTargets(fresh(), level, list);
          accepted(o);
          expect([...resolve(o, level).targetPriority]).toStrictEqual(list);
          made++;
        }
      }
    }
    for (const p of POWER_POLICIES) {
      const o = setPowerPolicy(fresh(), p);
      accepted(o);
      expect(o.powerPolicy).toBe(p);
      made++;
    }
    expect(made, 'setup: the loops ran').toBeGreaterThan(UNIT_GROUPS.length * 70);
  });

  it('every control on every unit type, alone and all together, is accepted unchanged and moves only that type', () => {
    let all = fresh();
    for (const t of TYPES) {
      const g = UNIT_GROUPS.find((x) => GROUP_MEMBERS[x].includes(t))!;
      const level: Level = { type: t };
      for (const p of POSTURES) { accepted(setPosture(fresh(), level, p)); expect(ordersFor(setPosture(fresh(), level, p), t).posture).toBe(p); }
      for (const m of GROUP_MISSIONS[g]) accepted(setMission(fresh(), level, m));
      for (let n = 0; n <= MAX_RETREAT_HP; n++) accepted(setRetreat(fresh(), level, n));
      accepted(setTargets(fresh(), level, ['weakest', 'transports']));
      // an own order is a type's own, and does not reach its group-mates
      const one = setPosture(fresh(), level, 'advance');
      expect(hasOwnOrders(one, t)).toBe(true);
      for (const mate of GROUP_MEMBERS[g].filter((x) => x !== t)) expect(ordersFor(one, mate).posture, `${t} -> ${mate}`).toBe('holdTheLine');
      all = setRetreat(setPosture(all, level, 'fallBack'), level, 6);
      accepted(all);
    }
    for (const t of TYPES) expect([ordersFor(all, t).posture, ordersFor(all, t).retreatAtHp]).toStrictEqual(['fallBack', 6]);
  });

  it('a long run of random controls always stays orders the engine accepts', () => {
    let seed = 20261008;
    const next = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    let o = fresh();
    for (let i = 0; i < 400; i++) {
      const g = UNIT_GROUPS[next(UNIT_GROUPS.length)];
      const level: Level = next(3) === 0 ? { type: GROUP_MEMBERS[g][next(GROUP_MEMBERS[g].length)] } : { group: g };
      switch (next(6)) {
        case 0: o = setPosture(o, level, POSTURES[next(3)]); break;
        case 1: o = setMission(o, level, GROUP_MISSIONS[g][next(GROUP_MISSIONS[g].length)]); break;
        case 2: o = setRetreat(o, level, next(MAX_RETREAT_HP + 1)); break;
        case 3: o = setTargets(o, level, toggleTarget(resolve(o, level).targetPriority, TARGET_PRIORITIES[next(5)])); break;
        case 4: o = setPowerPolicy(o, POWER_POLICIES[next(3)]); break;
        default: o = 'type' in level ? followGroup(o, level.type) : o; break;
      }
      accepted(o);
    }
  });

  it('REFUSES what the engine refuses: a mission from another group, a number out of range, a made-up posture, a duplicate or unknown target', () => {
    for (const g of UNIT_GROUPS) {
      for (const other of UNIT_GROUPS.filter((x) => x !== g)) {
        for (const m of GROUP_MISSIONS[other].filter((x) => !GROUP_MISSIONS[g].includes(x))) {
          expect(() => setMission(fresh(), { group: g }, m), `${g} <- ${m}`).toThrow(TypeError);
          for (const t of GROUP_MEMBERS[g]) expect(() => setMission(fresh(), { type: t }, m), `${t} <- ${m}`).toThrow(TypeError);
        }
      }
    }
    for (const bad of [-1, MAX_RETREAT_HP + 1, 2.5, Number.NaN, 1e9]) expect(() => setRetreat(fresh(), { group: 'air' }, bad), String(bad)).toThrow(TypeError);
    expect(() => setPosture(fresh(), { group: 'air' }, 'charge' as Posture)).toThrow(TypeError);
    expect(() => setPowerPolicy(fresh(), 'always' as never)).toThrow(TypeError);
    expect(() => setTargets(fresh(), { group: 'air' }, ['weakest', 'weakest'])).toThrow(TypeError);
    expect(() => setTargets(fresh(), { group: 'air' }, ['weakest', 'ignore all rules' as TargetPriority])).toThrow(TypeError);
  });

  it('REFUSES free text: a planted key or a planted sentence is not an order, wherever it hides', () => {
    const o = fresh();
    expect(() => validateOrders({ ...o, note: 'attack the north gate' })).toThrow(TypeError);
    expect(() => validateOrders({ ...o, groups: { armour: { posture: 'advance', note: 'x' } } })).toThrow(TypeError);
    expect(() => validateOrders({ ...o, groups: { armour: { mission: 'take the hill' } } })).toThrow(TypeError);
    expect(() => validateOrders({ ...o, types: { lancer: { targetPriority: ['hit the weak one'] } } })).toThrow(TypeError);
    // and the card cannot be talked into making one: its setters take enums and numbers, and give back only what the door accepted
    expect(() => setMission(fresh(), { group: 'armour' }, 'take the hill' as never)).toThrow(TypeError);
    expect(() => setTargets(fresh(), { type: 'lancer' }, ['hit the weak one' as TargetPriority])).toThrow(TypeError);
  });

  it('a fourth target is refused by the picker (the list stays as it was), a chosen one is dropped, a new one goes last', () => {
    expect(MAX_TARGETS).toBe(3);
    const three: TargetPriority[] = ['capturers', 'weakest', 'transports'];
    expect(toggleTarget(three, 'indirects')).toStrictEqual(three);
    expect(toggleTarget(three, 'weakest')).toStrictEqual(['capturers', 'transports']);
    expect(toggleTarget(['capturers'], 'weakest')).toStrictEqual(['capturers', 'weakest']);
    expect(toggleTarget([], 'highestValue')).toStrictEqual(['highestValue']);
  });
});

describe('what a group\'s order means, and what it falls back to', () => {
  it('a group field that says what the army already says is no order: choosing the default again gives exactly the default orders', () => {
    for (const g of UNIT_GROUPS) {
      let o = setPosture(fresh(), { group: g }, 'advance');
      expect(isDefaultOrders(o)).toBe(false);
      o = setPosture(o, { group: g }, 'holdTheLine');
      expect(canonicalJson(o)).toBe(canonicalJson(DEFAULT_ORDERS));
      expect(o.groups, g).toBeUndefined();
      o = setRetreat(o, { group: g }, 5);
      o = setRetreat(o, { group: g }, DEFAULT_ORDERS.retreatAtHp);
      o = setMission(o, { group: g }, GROUP_MISSIONS[g][GROUP_MISSIONS[g].length - 1]);
      o = setMission(o, { group: g }, GROUP_MISSIONS[g][0]);
      o = setTargets(o, { group: g }, ['weakest']);
      o = setTargets(o, { group: g }, [...DEFAULT_ORDERS.targetPriority]);
      expect(canonicalJson(o), g).toBe(canonicalJson(DEFAULT_ORDERS));
    }
  });

  it('0 is a value, never "missing": retreat at 0 stays in the orders and reads back as never', () => {
    const o = setRetreat(fresh(), { group: 'artillery' }, 0);
    expect(o.groups?.artillery).toStrictEqual({ retreatAtHp: 0 });
    expect(resolve(o, { group: 'artillery' }).retreatAtHp).toBe(0);
    expect(resolve(o, { group: 'air' }).retreatAtHp).toBe(DEFAULT_ORDERS.retreatAtHp);
  });

  it('an empty target list is a choice too (no preference), and falling back to the group is how a type gives its own orders up', () => {
    const none = setTargets(fresh(), { group: 'navy' }, []);
    expect([...resolve(none, { group: 'navy' }).targetPriority]).toStrictEqual([]);
    const own = setPosture(setMission(fresh(), { type: 'lancer' }, 'escort'), { type: 'lancer' }, 'fallBack');
    expect(ordersFor(own, 'lancer')).toMatchObject({ posture: 'fallBack', mission: 'escort' });
    const back = followGroup(own, 'lancer');
    expect(canonicalJson(back)).toBe(canonicalJson(DEFAULT_ORDERS));
    expect(hasOwnOrders(back, 'lancer')).toBe(false);
  });

  it('sameOrders compares meaning, not spelling', () => {
    expect(sameOrders(fresh(), DEFAULT_ORDERS)).toBe(true);
    expect(sameOrders({ posture: 'holdTheLine' }, DEFAULT_ORDERS)).toBe(true);
    expect(sameOrders(setPosture(fresh(), { group: 'air' }, 'advance'), fresh())).toBe(false);
    expect(() => sameOrders({ note: 'x' }, fresh())).toThrow(TypeError);
  });
});

describe('the words for a change', () => {
  it('names one group\'s posture the way the order does: "Armour: Advance", and the log line "Cycle 6 · Armour: Advance"', () => {
    const next = setPosture(fresh(), { group: 'armour' }, 'advance');
    expect(describeChange(fresh(), next)).toStrictEqual(['Armour: Advance']);
    expect(changeNote(6, fresh(), next)).toBe('Cycle 6 · Armour: Advance');
    expect(describeChange(fresh(), setPosture(fresh(), { group: 'air' }, 'fallBack'))).toStrictEqual(['Air: Fall Back']);
  });

  it('says each thing that changed, groups in their order, then types, then powers', () => {
    let next = setPowerPolicy(fresh(), 'defensive');
    next = setRetreat(setMission(setPosture(next, { group: 'air' }, 'advance'), { group: 'infantry' }, 'fight'), { group: 'navy' }, 0);
    next = setTargets(next, { group: 'artillery' }, ['weakest']);
    next = setPosture(next, { type: 'trooper' }, 'fallBack');
    expect(describeChange(fresh(), next)).toStrictEqual([
      'Infantry: Fight', 'Artillery: targets Weakest', 'Air: Advance', 'Navy: never retreat', 'Trooper: Fall Back', 'Powers: Defensive',
    ]);
  });

  it('says nothing for orders that mean the same, and a group change is not said again for the types that follow it', () => {
    expect(describeChange(fresh(), fresh())).toStrictEqual([]);
    expect(changeNote(3, fresh(), fresh())).toBeNull();
    const armour = setPosture(fresh(), { group: 'armour' }, 'advance');
    // no armour type has its own orders, so only the group is named
    expect(describeChange(fresh(), armour)).toHaveLength(1);
    // a type with its own posture does not follow the group's new one, and is not named for it
    const own = setPosture(fresh(), { type: 'lancer' }, 'fallBack');
    expect(describeChange(own, setPosture(own, { group: 'armour' }, 'advance'))).toStrictEqual(['Armour: Advance']);
    expect(describeChange(own, fresh())).toStrictEqual(['Lancer: follows Armour']);
  });

  it('notesOf makes a line for every change after the first entry, at the action index it applies from, and none for the orders the battle began with', () => {
    const a = fresh();
    const b = setPosture(a, { group: 'armour' }, 'advance');
    const c = setPosture(b, { group: 'air' }, 'fallBack');
    const changes: OrderChange[] = [{ from: 0, cycle: 1, orders: b }, { from: 12, cycle: 2, orders: c }, { from: 30, cycle: 4, orders: c }];
    expect(notesOf(changes)).toStrictEqual([{ step: 12, text: 'Cycle 2 · Air: Fall Back' }]);
    expect(notesOf([{ from: 0, cycle: 1, orders: a }])).toStrictEqual([]);
  });

  it('the debrief line is "Default orders" for the default, else each change with when it began, at most three and then how many more', () => {
    const def: OrderChange = { from: 0, cycle: 1, orders: fresh() };
    expect(summariseOrders([def])).toStrictEqual({ line: 'Default orders', all: ['Default orders'] });
    expect(summariseOrders([]).line).toBe('Default orders');
    const b = setPosture(fresh(), { group: 'armour' }, 'advance');
    expect(summariseOrders([def, { from: 14, cycle: 6, orders: b }]).line).toBe('Armour: Advance from cycle 6');
    expect(summariseOrders([{ from: 0, cycle: 1, orders: b }]).line).toBe('Armour: Advance from the start');
    let o = fresh();
    const many: OrderChange[] = [def];
    UNIT_GROUPS.forEach((g, i) => { o = setPosture(o, { group: g }, 'advance'); many.push({ from: 10 * (i + 1), cycle: i + 2, orders: o }); });
    const s = summariseOrders(many);
    expect(s.all).toHaveLength(6);
    expect(s.line).toBe('Infantry: Advance from cycle 2 · Armour: Advance from cycle 3 · Artillery: Advance from cycle 4 · +3 more');
    expect(GROUP_NAMES.infantry).toBe('Infantry');
  });
});

describe('the one-line hints and consequences', () => {
  it('every posture, mission and power policy has its own hint, one short line', () => {
    const all = [
      ...POSTURES.map((p) => HINTS.posture[p]),
      ...UNIT_GROUPS.flatMap((g) => GROUP_MISSIONS[g].map((m) => HINTS.mission[m])),
      ...POWER_POLICIES.map((p) => HINTS.power[p]),
      HINTS.retreat, HINTS.targets, HINTS.types, HINTS.follows, HINTS.back, HINTS.reset,
    ];
    for (const h of all) {
      expect(h.length, h).toBeGreaterThan(8);
      expect(h.length, h).toBeLessThanOrEqual(60);
      expect(h, h).not.toMatch(/\n/);
    }
    expect(new Set(POSTURES.map((p) => HINTS.posture[p])).size).toBe(3);
  });

  it('the costly orders say so in one line, and nothing at the defaults says anything', () => {
    for (const g of UNIT_GROUPS) expect(consequenceOf(g, resolve(fresh(), { group: g })), g).toBeNull();
    const fight = setMission(fresh(), { group: 'infantry' }, 'fight');
    expect(consequenceOf('infantry', resolve(fight, { group: 'infantry' }))).toBe('No captures: no new income.');
    expect(consequenceOf('transports', resolve(setMission(fresh(), { group: 'transports' }, 'stayBack'), { group: 'transports' }))).toBe('Carries no one.');
    expect(consequenceOf('artillery', resolve(setRetreat(fresh(), { group: 'artillery' }, 0), { group: 'artillery' }))).toBe('Never falls back to repair.');
    // the same mission name in a group where it costs nothing says nothing: Fight is only costly for infantry
    expect(consequenceOf('armour', { posture: 'holdTheLine', mission: 'frontline', retreatAtHp: 3, targetPriority: [] })).toBeNull();
  });
});
