// The orders card's markup (G14), rendered on the server: what is on the screen at rest, what "More" and "Unit types" hold, and the hint, the
// consequence and the pending line. Interaction (hover, press, the O key) is exercised in a real browser (see the order's receipt); what a
// press MEANS is the model's, tested in ordersModel.test.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../../content/missions';
import { GROUP_MEMBERS, GROUP_MISSIONS, GROUP_NAMES, MISSION_NAMES, POSTURES, TARGET_PRIORITY_NAMES, TARGET_PRIORITIES, UNIT_GROUPS } from '../../game/doctrine';
import { ObjectiveCard } from './BriefingView';
import { OrdersCard } from './OrdersCard';
import type { OrdersCardProps } from './OrdersCard';
import { OrdersControl } from './OrdersControl';
import { freshOrders, setMission, setPosture, setRetreat, setTargets, unitName } from './ordersModel';

const noop = (): void => {};
const html = (props: Partial<OrdersCardProps> = {}): string => renderToStaticMarkup(createElement(OrdersCard, { orders: freshOrders(), onChange: noop, ...props }));
/** The markup of one group's row (its list item). */
const row = (h: string, group: string): string => {
  const start = h.indexOf(`data-group="${group}"`);
  expect(start, group).toBeGreaterThan(-1);
  const next = h.indexOf('<li class="awf-ord', start + 10);
  return h.slice(start, next < 0 ? h.length : next);
};
const count = (h: string, needle: string): number => h.split(needle).length - 1;

describe('the orders card at rest', () => {
  const h = html();

  it('has six group rows in the order\'s order, each with its icon, its name and a three-way posture control with Hold lit', () => {
    expect([...h.matchAll(/data-group="(\w+)"/g)].map((m) => m[1])).toStrictEqual([...UNIT_GROUPS, 'powers']);
    for (const g of UNIT_GROUPS) {
      const r = row(h, g);
      expect(r).toContain(`data-icon="${g}"`);
      expect(r).toContain(`>${GROUP_NAMES[g]}<`);
      expect(count(r, 'role="radio"'), g).toBe(3);
      for (const p of POSTURES) expect(r, `${g} ${p}`).toContain(`data-value="${p}"`);
      expect(r).toMatch(/aria-checked="true"[^>]*data-value="holdTheLine"|data-value="holdTheLine"[^>]*aria-checked="true"/);
      expect(count(r, 'aria-checked="true"'), g).toBe(1);
      expect(r).toContain('data-action="more"');
      expect(r).toContain('aria-expanded="false"');
    }
  });

  it('has one Powers row with the three power policies, and the first lit', () => {
    const r = row(h, 'powers');
    expect(count(r, 'role="radio"')).toBe(3);
    for (const p of ['whenReady', 'saveForOverclock', 'defensive']) expect(r).toContain(`data-value="${p}"`);
    expect(r).toMatch(/aria-checked="true"[^>]*data-value="whenReady"|data-value="whenReady"[^>]*aria-checked="true"/);
  });

  it('shows nothing under More at rest: no mission, no retreat, no targets, no unit types', () => {
    for (const bad of ['data-field="mission"', 'data-field="retreat"', 'data-field="targets"', 'data-action="types"', 'data-type=']) expect(h, bad).not.toContain(bad);
  });

  it('has a Reset that is off while the orders are the defaults, and on once they are not', () => {
    expect(h).toMatch(/data-action="reset"[^>]*disabled=""|disabled=""[^>]*data-action="reset"/);
    expect(h).toContain('data-state="default"');
    const custom = html({ orders: setPosture(freshOrders(), { group: 'air' }, 'advance') });
    expect(custom).not.toMatch(/data-action="reset"[^>]*disabled=""|disabled=""[^>]*data-action="reset"/);
    expect(custom).toContain('data-state="custom"');
  });

  it('says nothing about costs at the defaults, and "From your next turn" only when told the orders wait', () => {
    expect(h).not.toContain('data-consequence');
    expect(h).not.toContain('From your next turn');
    expect(html({ pending: true })).toContain('From your next turn');
  });

  it('is no paragraph: the only text beside the controls is names, one-word choices and the one hint line', () => {
    const text = h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    expect(text.length).toBeLessThan(380);
  });
});

describe('More: only the group\'s own mission, its retreat and its targets', () => {
  it('lists, for each group opened, exactly that group\'s missions (never another group\'s), the retreat 0-9 control and the five target kinds', () => {
    for (const g of UNIT_GROUPS) {
      const r = row(html({ initialOpen: { more: [g] } }), g);
      const missions = [...r.matchAll(/data-field="mission"[\s\S]*?<\/div>/g)][0][0];
      const found = [...missions.matchAll(/data-value="(\w+)"/g)].map((m) => m[1]);
      expect(found, g).toStrictEqual([...GROUP_MISSIONS[g]]);
      for (const m of GROUP_MISSIONS[g]) expect(missions).toContain(`>${MISSION_NAMES[m]}<`);
      for (const other of UNIT_GROUPS.filter((x) => x !== g)) {
        for (const m of GROUP_MISSIONS[other].filter((x) => !GROUP_MISSIONS[g].includes(x))) expect(missions, `${g} must not offer ${m}`).not.toContain(`data-value="${m}"`);
      }
      expect(r).toContain('data-field="retreat"');
      expect(r).toContain('>3 HP<');
      expect(r).toContain('aria-expanded="true"');
      for (const t of TARGET_PRIORITIES) expect(r).toContain(`>${TARGET_PRIORITY_NAMES[t]}<`);
    }
  });

  it('shows the default targets in order 1, 2, 3, the lit mission, and 0 as "Never"', () => {
    const r = row(html({ initialOpen: { more: ['armour'] } }), 'armour');
    expect(r).toMatch(/data-value="capturers" data-rank="1"/);
    expect(r).toMatch(/data-value="indirects" data-rank="2"/);
    expect(r).toMatch(/data-value="highestValue" data-rank="3"/);
    expect(r).not.toMatch(/data-value="weakest" data-rank/);
    const o = setTargets(setRetreat(setMission(freshOrders(), { group: 'armour' }, 'escort'), { group: 'armour' }, 0), { group: 'armour' }, ['weakest']);
    const r2 = row(html({ orders: o, initialOpen: { more: ['armour'] } }), 'armour');
    expect(r2).toContain('>Never<');
    expect(r2).toMatch(/data-value="weakest" data-rank="1"/);
    expect(r2).toMatch(/aria-checked="true"[^>]*data-value="escort"|data-value="escort"[^>]*aria-checked="true"/);
    expect(r2, 'retreat 0 says what it costs').toContain('Never falls back to repair.');
  });

  it('says the cost of Infantry -> Fight in one line, in that row only', () => {
    const o = setMission(freshOrders(), { group: 'infantry' }, 'fight');
    const h = html({ orders: o });
    expect(row(h, 'infantry')).toContain('No captures: no new income.');
    expect(count(h, 'data-consequence'), 'no other row says anything').toBe(1);
  });
});

describe('Unit types: on demand, each following its group until changed', () => {
  it('lists the group\'s members, each reading "Follows group", with no controls of its own yet', () => {
    for (const g of UNIT_GROUPS) {
      const r = row(html({ initialOpen: { more: [g], types: [g] } }), g);
      for (const t of GROUP_MEMBERS[g]) expect(r, t).toContain(`data-type="${t}"`);
      expect(r).toContain(`>${unitName(GROUP_MEMBERS[g][0])}<`);
      expect(count(r, 'Follows group')).toBe(GROUP_MEMBERS[g].length);
      expect(r).not.toContain('Back to group');
      expect(r).not.toContain('>Posture<');
    }
  });

  it('a type with orders of its own shows the same controls and a way back to the group, and only that type does', () => {
    const o = setPosture(freshOrders(), { type: 'lancer' }, 'advance');
    const r = row(html({ orders: o, initialOpen: { more: ['armour'], types: ['armour'] } }), 'armour');
    const lancer = r.slice(r.indexOf('data-type="lancer"'), r.indexOf('data-type="bastion"'));
    expect(lancer).toContain('data-own="yes"');
    expect(lancer).toContain('Back to group');
    expect(lancer).toContain('>Posture<');
    expect(lancer).toContain('data-field="mission"');
    expect(lancer).toContain('data-field="retreat"');
    expect(lancer).toContain('data-field="targets"');
    expect(count(r, 'Back to group')).toBe(1);
    expect(count(r, 'Follows group')).toBe(GROUP_MEMBERS.armour.length - 1);
  });
});

describe('the objective screen and the battle panel', () => {
  const mission = MISSIONS[0];

  it('puts the card between the facts and Deploy, and Deploy stays the one main action', () => {
    const h = renderToStaticMarkup(createElement(ObjectiveCard, { mission, onReplay: noop }));
    expect(h).toContain('aria-label="Orders"');
    expect(h.indexOf('class="awf-chips"')).toBeLessThan(h.indexOf('class="awf-orders"'));
    expect(h.indexOf('class="awf-orders"')).toBeLessThan(h.indexOf('data-action="deploy"'));
    expect(count(h, 'aw-btn--primary')).toBe(1);
    expect(count(h, 'data-action="deploy"')).toBe(1);
    expect(h).toContain('Doctrine (local rules) on every side');
  });

  it('draws the panel closed by default, with the Orders button and its key', () => {
    const closed = renderToStaticMarkup(createElement(OrdersControl, { orders: freshOrders(), pending: false, onChange: noop }));
    expect(closed).toContain('data-action="orders"');
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('>O</kbd>');
    expect(closed).not.toContain('awf-orders-pop');
    expect(closed).not.toContain('data-pending="yes"');
    const open = renderToStaticMarkup(createElement(OrdersControl, { orders: freshOrders(), pending: true, onChange: noop, initialOpen: true }));
    expect(open).toContain('awf-orders-pop');
    expect(open).toContain('data-variant="panel"');
    expect(open).toContain('From your next turn');
    expect(open).toContain('data-pending="yes"');
    expect(open).toContain('data-action="close"');
    expect(html()).not.toContain('data-action="close"');
    expect(count(open, 'data-group='), 'six groups and powers').toBe(7);
  });
});
