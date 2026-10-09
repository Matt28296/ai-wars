// The battle's command buttons (G19, D-025): what each does to a set of standing orders, which one is in force, the words, and the row as the page draws it.
// Expected answers are written here from the spec (every group Advance; infantry capture and armour escort; one power toggle) and from the engine's own
// reading of orders (`ordersFor`, `validateOrders`), never from commands.ts read back. Each claim has a known-bad twin.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NOTE_MAX } from '../../agent/live';
import { DEFAULT_ORDERS, GROUPED_TYPES, GROUP_MEMBERS, UNIT_GROUPS, ordersFor, validateOrders } from '../../game/doctrine';
import type { StandingOrders } from '../../game/doctrine';
import { CommandBar } from './CommandBar';
import {
  COMMAND_TEXT, POSTURE_COMMANDS, POWER_TEXT, activePosture, applyPosture, applyTakeBases, press, takeBasesInForce, togglePower,
} from './commands';
import type { CommandId } from './commands';
import { describeChange, freshOrders, notesOf, sameOrders, setMission, setPosture, setRetreat, setTargets, summariseOrders } from './ordersModel';

const ALL: readonly CommandId[] = ['charge', 'hold', 'fallBack', 'takeBases', 'power'];
const json = <T,>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;
const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');

/** Orders with something set in every field the commands must leave alone. */
const BUSY = (): StandingOrders => {
  let o = freshOrders();
  o = setRetreat(o, { group: 'armour' }, 6);
  o = setTargets(o, { group: 'armour' }, ['weakest', 'transports']);
  o = setMission(o, { group: 'air' }, 'scout');
  o = setRetreat(o, { group: 'infantry' }, 0);
  return validateOrders({ ...o, retreatAtHp: 4, composition: { infantry: 9, vehicles: 1, indirect: 0, air: 0, naval: 0 } });
};

describe('the posture commands: Charge, Hold, Fall back', () => {
  const posture = { charge: 'advance', hold: 'holdTheLine', fallBack: 'fallBack' } as const;

  it('set every group\'s posture, and every unit type resolves to it', () => {
    for (const c of POSTURE_COMMANDS) {
      const o = press(BUSY(), c) ?? BUSY();
      for (const g of UNIT_GROUPS) expect(o.groups?.[g]?.posture ?? o.posture, `${c} ${g}`).toBe(posture[c]);
      for (const t of GROUPED_TYPES) expect(ordersFor(o, t).posture, `${c} ${t}`).toBe(posture[c]);
    }
  });

  it('leave each group\'s mission, retreat and targets as they were, and the army-wide fields too', () => {
    const before = BUSY();
    for (const c of POSTURE_COMMANDS) {
      const after = applyPosture(before, posture[c]);
      for (const t of GROUPED_TYPES) {
        const a = ordersFor(after, t);
        const b = ordersFor(before, t);
        expect({ mission: a.mission, retreatAtHp: a.retreatAtHp, targetPriority: a.targetPriority }, `${c} ${t}`).toStrictEqual({ mission: b.mission, retreatAtHp: b.retreatAtHp, targetPriority: b.targetPriority });
      }
      expect(after.retreatAtHp).toBe(before.retreatAtHp);
      expect(after.powerPolicy).toBe(before.powerPolicy);
      expect(after.composition).toStrictEqual(before.composition);
      expect(after.targetPriority).toStrictEqual(before.targetPriority);
    }
    // a known answer: Charge on the defaults is exactly six groups at Advance, and nothing else
    expect(json(applyPosture(freshOrders(), 'advance'))).toStrictEqual({
      ...json<Record<string, unknown>>(DEFAULT_ORDERS),
      groups: Object.fromEntries(UNIT_GROUPS.map((g) => [g, { posture: 'advance' }])),
    });
  });

  it('Hold after Charge is the default orders again: a group that says what the army says says nothing', () => {
    expect(sameOrders(applyPosture(applyPosture(freshOrders(), 'advance'), 'holdTheLine'), DEFAULT_ORDERS)).toBe(true);
    // and the known-bad twin: Charge is not the default
    expect(sameOrders(applyPosture(freshOrders(), 'advance'), DEFAULT_ORDERS)).toBe(false);
  });

  it('drop the posture a single unit type was given, and only that field of it', () => {
    let o = setPosture(freshOrders(), { type: 'breacher' }, 'fallBack');
    o = setRetreat(o, { type: 'breacher' }, 1);
    expect(ordersFor(o, 'breacher').posture).toBe('fallBack');
    const charged = applyPosture(o, 'advance');
    expect(ordersFor(charged, 'breacher').posture).toBe('advance');
    expect(ordersFor(charged, 'breacher').retreatAtHp, 'its own retreat stays').toBe(1);
    expect(charged.types?.breacher).toStrictEqual({ retreatAtHp: 1 });
    // a type with only a posture of its own leaves no empty entry behind
    expect(applyPosture(setPosture(freshOrders(), { type: 'wasp' }, 'advance'), 'holdTheLine').types).toBeUndefined();
  });

  it('are in force when EVERY unit type resolves to the posture, and show none pressed once orders changed through More leave no command matching', () => {
    expect(activePosture(freshOrders()), 'the defaults are Hold').toBe('hold');
    expect(activePosture(applyPosture(freshOrders(), 'advance'))).toBe('charge');
    expect(activePosture(applyPosture(freshOrders(), 'fallBack'))).toBe('fallBack');
    const charged = applyPosture(freshOrders(), 'advance');
    expect(activePosture(setPosture(charged, { group: 'air' }, 'holdTheLine')), 'one group differs').toBeNull();
    expect(activePosture(setPosture(charged, { type: 'wasp' }, 'fallBack')), 'one unit type differs').toBeNull();
    // the other fields do not change which command is pressed
    expect(activePosture(setMission(setRetreat(charged, { group: 'armour' }, 2), { group: 'infantry' }, 'fight'))).toBe('charge');
  });

  it('a press that changes nothing sends nothing (null), and anything else returns the new orders', () => {
    expect(press(freshOrders(), 'hold')).toBeNull();
    expect(press(applyPosture(freshOrders(), 'advance'), 'charge')).toBeNull();
    const o = press(freshOrders(), 'charge');
    expect(o).not.toBeNull();
    expect(activePosture(o!)).toBe('charge');
  });
});

describe('Take bases', () => {
  it('sets the infantry mission to Capture and the armour mission to Escort, and nothing else of anyone\'s', () => {
    const before = BUSY();
    const after = applyTakeBases(before);
    for (const t of GROUP_MEMBERS.infantry) expect(ordersFor(after, t).mission).toBe('capture');
    for (const t of GROUP_MEMBERS.armour) expect(ordersFor(after, t).mission).toBe('escort');
    for (const t of GROUPED_TYPES) {
      const a = ordersFor(after, t);
      const b = ordersFor(before, t);
      expect({ posture: a.posture, retreatAtHp: a.retreatAtHp, targetPriority: a.targetPriority }, t).toStrictEqual({ posture: b.posture, retreatAtHp: b.retreatAtHp, targetPriority: b.targetPriority });
    }
    // the other groups' missions are untouched
    expect(ordersFor(after, 'wasp').mission).toBe('scout');
    expect(ordersFor(after, 'arc').mission).toBe(ordersFor(before, 'arc').mission);
    expect(after.powerPolicy).toBe(before.powerPolicy);
  });

  it('is in force when every infantry type captures and every armour type escorts; not before, and not after More changes either', () => {
    expect(takeBasesInForce(freshOrders()), 'armour holds the front line by default').toBe(false);
    const on = applyTakeBases(freshOrders());
    expect(takeBasesInForce(on)).toBe(true);
    expect(takeBasesInForce(setMission(on, { group: 'armour' }, 'guardBase'))).toBe(false);
    expect(takeBasesInForce(setMission(on, { group: 'infantry' }, 'fight'))).toBe(false);
    expect(takeBasesInForce(setMission(on, { type: 'lancer' }, 'frontline'))).toBe(false);
    expect(press(on, 'takeBases'), 'already in force: nothing to send').toBeNull();
  });

  it('drops the missions single infantry and armour types were given, so the command is true of them too', () => {
    let o = setMission(freshOrders(), { type: 'breacher' }, 'fight');
    o = setMission(o, { type: 'lancer' }, 'guardBase');
    o = setRetreat(o, { type: 'lancer' }, 8);
    expect(takeBasesInForce(o)).toBe(false);
    const on = applyTakeBases(o);
    expect(takeBasesInForce(on)).toBe(true);
    expect(on.types?.breacher).toBeUndefined();
    expect(on.types?.lancer).toStrictEqual({ retreatAtHp: 8 });
  });

  it('leaves the postures alone, so Charge and Take bases can be on together', () => {
    const both = applyTakeBases(applyPosture(freshOrders(), 'advance'));
    expect(activePosture(both)).toBe('charge');
    expect(takeBasesInForce(both)).toBe(true);
    expect(activePosture(applyPosture(both, 'holdTheLine'))).toBe('hold');
    expect(takeBasesInForce(applyPosture(both, 'holdTheLine'))).toBe(true);
  });
});

describe('the one power toggle', () => {
  it('flips between Power now (when ready) and Save power (save for Overclock), and from any other policy goes to when ready', () => {
    const o = freshOrders();
    expect(o.powerPolicy).toBe('whenReady');
    expect(POWER_TEXT[o.powerPolicy].label).toBe('Power now');
    const saved = togglePower(o);
    expect(saved.powerPolicy).toBe('saveForOverclock');
    expect(POWER_TEXT[saved.powerPolicy].label).toBe('Save power');
    expect(togglePower(saved).powerPolicy).toBe('whenReady');
    expect(togglePower(validateOrders({ powerPolicy: 'defensive' })).powerPolicy).toBe('whenReady');
    expect(POWER_TEXT.defensive.label, 'a policy set through More still says what is in force').toBe('Power held');
  });

  it('changes only the policy', () => {
    const before = BUSY();
    const after = togglePower(before);
    expect({ ...after, powerPolicy: before.powerPolicy }).toStrictEqual(before);
  });
});

describe('every button only produces orders the validator accepts (D-005)', () => {
  /** A seeded walk over edits through the orders model, so the buttons meet many shapes of orders. */
  const lcg = (seed: number) => {
    let x = seed;
    return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296;
  };
  const wander = (seed: number): StandingOrders => {
    const rnd = lcg(seed);
    let o = freshOrders();
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
    for (let i = 0; i < 12; i++) {
      const g = pick(UNIT_GROUPS);
      const t = pick(GROUP_MEMBERS[g]);
      const level = rnd() < 0.5 ? { group: g } : { type: t };
      o = setPosture(o, level, pick(['advance', 'holdTheLine', 'fallBack'] as const));
      o = setRetreat(o, level, Math.floor(rnd() * 10));
    }
    return o;
  };

  it('two hundred shapes of orders by every button: the result is valid, a fixed point for the postures and bases, and a toggle for power', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const start = wander(seed);
      for (const id of ALL) {
        const next = press(start, id);
        if (next === null) {
          expect(id === 'power', `${id} never presses to nothing for power (seed ${seed})`).toBe(false);
          continue;
        }
        expect(() => validateOrders(next), `${id} seed ${seed}`).not.toThrow();
        expect(sameOrders(next, validateOrders(next))).toBe(true);
        if (id === 'power') expect(sameOrders(press(next, 'power')!, start)).toBe(true);
        else expect(press(next, id), `${id} twice, seed ${seed}`).toBeNull();
      }
    }
  });

  it('known-bad twin: the validator refuses a mission from the wrong group and free text, so a button could not smuggle one in', () => {
    expect(() => validateOrders({ groups: { infantry: { mission: 'escort' } } })).toThrow(TypeError);
    expect(() => validateOrders({ groups: { armour: { mission: 'capture' } } })).toThrow(TypeError);
    expect(() => validateOrders({ ...DEFAULT_ORDERS, note: 'charge!' })).toThrow(TypeError);
    expect(() => setMission(freshOrders(), { group: 'armour' }, 'capture' as never)).toThrow(TypeError);
  });
});

describe('the words', () => {
  it('each button has a short label and a one-line hint; the labels are the ones in the spec', () => {
    expect(POSTURE_COMMANDS.map((c) => COMMAND_TEXT[c].label)).toStrictEqual(['Charge', 'Hold', 'Fall back']);
    expect(COMMAND_TEXT.takeBases.label).toBe('Take bases');
    const hints = [...POSTURE_COMMANDS.map((c) => COMMAND_TEXT[c].hint), COMMAND_TEXT.takeBases.hint, ...Object.values(POWER_TEXT).map((p) => p.hint)];
    for (const h of hints) {
      expect(h.length, h).toBeLessThan(50);
      expect(h).not.toMatch(/\n/);
    }
  });

  it('a command logs as one line: "All groups: Advance" once, not six; Take bases names the armour change', () => {
    const charge = describeChange(freshOrders(), applyPosture(freshOrders(), 'advance'));
    expect(charge).toStrictEqual(['All groups: Advance']);
    expect(notesOf([{ from: 0, cycle: 1, orders: freshOrders() }, { from: 31, cycle: 3, orders: applyPosture(freshOrders(), 'advance') }])).toStrictEqual([{ step: 31, text: 'Cycle 3 · All groups: Advance' }]);
    expect(describeChange(freshOrders(), applyTakeBases(freshOrders()))).toStrictEqual(['Armour: Escort capturers']);
    expect(describeChange(freshOrders(), togglePower(freshOrders()))).toStrictEqual(['Powers: Save for Overclock']);
    // not every group: the old per-group lines stand
    expect(describeChange(freshOrders(), setPosture(freshOrders(), { group: 'air' }, 'advance'))).toStrictEqual(['Air: Advance']);
    expect(summariseOrders([{ from: 0, cycle: 1, orders: freshOrders() }, { from: 31, cycle: 3, orders: applyPosture(freshOrders(), 'advance') }]).line).toBe('All groups: Advance from cycle 3');
  });
});

describe('the row as the page draws it', () => {
  const draw = (props: Partial<Parameters<typeof CommandBar>[0]> = {}): string =>
    bare(renderToStaticMarkup(createElement(CommandBar, { orders: freshOrders(), pending: false, onChange: () => {}, ...props })));
  const pressed = (h: string, id: string): string => new RegExp(`data-command="${id}"[^>]*aria-pressed="(true|false)"`).exec(h)?.[1] ?? 'missing';
  /** What a screen reader says for a button: its full label (a phone-width row draws a short word beside it, hidden from assistive tech). */
  const labelOf = (h: string, id: string): string => {
    const inner = new RegExp(`data-command="${id}"[^>]*>([\\s\\S]*?)</button>`).exec(h)?.[1] ?? '';
    return /awf-cmd-full">([^<]*)</.exec(inner)?.[1] ?? inner.replace(/<[^>]*>/g, '');
  };
  const shortOf = (h: string, id: string): string | null => {
    const inner = new RegExp(`data-command="${id}"[^>]*>([\\s\\S]*?)</button>`).exec(h)?.[1] ?? '';
    return /awf-cmd-short" aria-hidden="true">([^<]*)</.exec(inner)?.[1] ?? null;
  };

  it('is one row: Charge, Hold, Fall back, Take bases, the power toggle, then More', () => {
    const h = draw();
    expect([...h.matchAll(/data-command="(\w+)"/g)].map((m) => m[1])).toStrictEqual(['charge', 'hold', 'fallBack', 'takeBases', 'power']);
    expect(['charge', 'hold', 'fallBack', 'takeBases', 'power'].map((id) => labelOf(h, id))).toStrictEqual(['Charge', 'Hold', 'Fall back', 'Take bases', 'Power now']);
    // a phone-width row has a short word for the two long ones, beside the label, so the six buttons stay one row there
    expect(['charge', 'hold', 'fallBack', 'takeBases', 'power'].map((id) => shortOf(h, id))).toStrictEqual([null, null, null, 'Bases', 'Power']);
    expect(h.indexOf('data-command="power"')).toBeLessThan(h.indexOf('data-action="orders"'));
    expect(h).toMatch(/data-action="orders"[^>]*>\s*<span class="aw-btn-label">More<\/span>/);
    expect(h.match(/class="awf-cmd-row"/g)).toHaveLength(1);
  });

  it('shows which is in force: Hold on the defaults; Charge after Charge; the power button names its policy; none pressed after More leaves no match', () => {
    expect([pressed(draw(), 'hold'), pressed(draw(), 'charge'), pressed(draw(), 'fallBack'), pressed(draw(), 'takeBases')]).toStrictEqual(['true', 'false', 'false', 'false']);
    const charged = applyTakeBases(applyPosture(freshOrders(), 'advance'));
    const h = draw({ orders: charged });
    expect([pressed(h, 'hold'), pressed(h, 'charge'), pressed(h, 'fallBack'), pressed(h, 'takeBases')]).toStrictEqual(['false', 'true', 'false', 'true']);
    const mixed = draw({ orders: setPosture(charged, { group: 'air' }, 'holdTheLine') });
    expect(['charge', 'hold', 'fallBack'].map((c) => pressed(mixed, c))).toStrictEqual(['false', 'false', 'false']);
    expect(labelOf(draw({ orders: togglePower(freshOrders()) }), 'power')).toBe('Save power');
    expect(shortOf(draw({ orders: togglePower(freshOrders()) }), 'power')).toBe('Save');
    expect(draw({ orders: togglePower(freshOrders()) })).toContain('data-policy="saveForOverclock"');
  });

  it('says a change waits, in the words it is given, and says nothing when nothing waits', () => {
    expect(draw({ pending: true })).toMatch(/<p class="awf-cmd-line caption"[^>]*data-line="yes">From your next turn<\/p>/);
    expect(draw({ pending: true, pendingText: 'From your agent\'s next turn' })).toContain('>From your agent&#x27;s next turn</p>');
    expect(draw({ pending: false })).toMatch(/data-line="no"><\/p>/);
    expect(draw({ pending: true, notice: 'Not sent.' })).toContain('>Not sent.</p>');
    expect(draw()).toContain('data-pending="no"');
    expect(draw({ pending: true })).toContain('data-pending="yes"');
  });

  it('has the note box only when given one (the live view with a connected agent); never on Deploy', () => {
    const none = draw();
    expect(none).not.toContain('awf-cmd-note');
    expect(none).not.toContain('<input');
    expect(none).not.toContain('Tell your agent');
    const withBox = draw({ note: { onSend: () => {} } });
    expect(withBox).toContain('data-note="yes"');
    expect(withBox).toMatch(/<input[^>]*placeholder="Tell your agent…"/);
    expect(withBox).toContain(`maxLength="${NOTE_MAX}"`);
    expect(withBox).toMatch(/type="submit"[^>]*disabled=""/);
    expect(withBox.match(/<input/g)).toHaveLength(1);
    // the row is the same row with a box beside it
    expect(withBox.replace(/<form class="awf-cmd-note"[\s\S]*?<\/form>/, '').replace(' data-note="yes"', ' data-note="no"')).toBe(none);
  });

  it('opens the orders panel (More) on request, and the panel says what the row says about waiting', () => {
    const h = draw({ initialOpen: true, pending: true, pendingText: 'From your agent\'s next turn' });
    expect(h).toContain('awf-orders-pop');
    expect(h).toContain('role="status" data-pending="yes">From your agent&#x27;s next turn</span>');
  });
});
