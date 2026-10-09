// The battle screen in live mode (G14), rendered on the server: the Orders button and its panel, the fog rule for the viewer toggle, the log line for a
// change, and the debrief's one line of orders. A battle without `live` (every screen that existed before) is drawn as it always was.
import { createElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MISSIONS } from '../../content/missions';
import type { OrderChange } from '../../agent/match';
import { runDeploy } from './deploy';
import { resultCardOf } from './debrief';
import { MissionWatch } from './MissionWatch';
import type { LiveControl, MissionWatchProps } from './MissionWatch';
import { freshOrders, setPosture, summariseOrders } from './ordersModel';
import { recordMatch } from '../watch/timeline';
import { ResultCardView } from './StoryOverlay';
import { viewOf } from './storyState';

const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');
const mission = (id: string) => MISSIONS.find((m) => m.id === id)!;

describe('the debrief\'s line of orders', () => {
  const m = mission('first-light');
  const run = runDeploy(m);
  const card = resultCardOf(m, recordMatch(run.setup, run.actions).states);
  const render = (orders?: ReturnType<typeof summariseOrders>): string => renderToStaticMarkup(createElement(ResultCardView, { mission: m, card, orders, onWatchAgain: () => {} }));

  it('is one line: "Default orders" when nothing was changed, else the changes and the cycle each began in', () => {
    const def: OrderChange = { from: 0, cycle: 1, orders: freshOrders() };
    const h = render(summariseOrders([def]));
    expect(h).toContain('data-orders-line');
    expect(h).toMatch(/<span class="awf-result-orders-text" data-orders-line="yes">Default orders<\/span>/);
    const changed = render(summariseOrders([def, { from: 14, cycle: 6, orders: setPosture(freshOrders(), { group: 'armour' }, 'advance') }]));
    expect(changed).toMatch(/data-orders-line="yes">Armour: Advance from cycle 6<\/span>/);
    expect(changed).toContain('title="Armour: Advance from cycle 6"');
    expect(changed.match(/class="awf-result-orders /g)).toHaveLength(1);
    expect(changed).toContain('data-orders="yes"');
  });

  it('is not there at all when the card is not told the orders, and nothing else on the card moves (known-bad twin)', () => {
    const none = render();
    expect(none).not.toContain('awf-result-orders');
    expect(none).not.toContain('data-orders');
    expect(none).toBe(render(undefined));
    // with the line taken out, the card with orders is the card without
    const withLine = render(summariseOrders([{ from: 0, cycle: 1, orders: freshOrders() }]));
    const stripped = withLine.replace(/<p class="awf-result-orders[\s\S]*?<\/p>/, '').replace(' data-orders="yes"', '');
    expect(stripped).toBe(none);
  });
});

describe('the battle screen with a live battle', () => {
  beforeAll(() => {
    const error = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });
  afterAll(() => vi.restoreAllMocks());

  const canopy = mission('under-canopy'); // fog on
  const light = mission('first-light'); // no fog
  const runs = new Map<string, ReturnType<typeof runDeploy>>();
  const runOf = (m: typeof canopy): ReturnType<typeof runDeploy> => {
    if (!runs.has(m.id)) runs.set(m.id, runDeploy(m));
    return runs.get(m.id)!;
  };
  const live = (open: boolean, extra: Partial<LiveControl> = {}): LiveControl => ({ open, orders: freshOrders(), pending: false, onOrders: () => {}, onReach: () => {}, ...extra });
  const render = (m: typeof canopy, props: Partial<MissionWatchProps> = {}, take = 60): string => {
    const r = runOf(m);
    return bare(renderToString(createElement(MissionWatch, { mission: m, result: { setup: r.setup, actions: r.actions.slice(0, take) }, ...props })));
  };

  it('Deploy\'s slim bar starts with the way back to the briefing and the mission\'s name (G18), from the mission and nothing else', () => {
    for (const m of [light, canopy]) {
      const h = render(m);
      const bar = /<header class="aww-bar"[\s\S]*?<\/header>/.exec(h)![0];
      const lead = /<div class="aww-bar-lead">([\s\S]*?)<\/div><div class="aww-bar-mid">/.exec(bar)![1];
      expect(lead).toContain(`href="#/mission/${m.id}"`);
      expect(lead.replace(/<[^>]*>/g, '')).toBe(`Back to briefingMission ${String(m.order).padStart(2, '0')} · ${m.title}`);
      expect(h).not.toContain('awf-watchbar"'); // Deploy's own strip is not part of this view (it is hidden by front.css)
    }
  });

  it('a battle with no `live` has no Orders button and no live marker: the screen it always was', () => {
    const h = render(canopy);
    expect(h).not.toContain('data-action="orders"');
    expect(h).not.toContain('awf-orders');
    expect(h).not.toContain('Thinking');
    expect(h).toContain('aww-viewer');
  });

  it('a live battle has the command row as the bar\'s second row (G19), closed: Charge, Hold, Fall back, Take bases, the power toggle, then More with its key; More opens the six rows and Powers', () => {
    const h = render(light, { live: live(true) });
    const bar = /<header class="aww-bar"[\s\S]*?<\/header>/.exec(h)![0];
    expect(bar).toContain('data-commands="yes"');
    expect([...bar.matchAll(/data-command="(\w+)"/g)].map((m) => m[1])).toStrictEqual(['charge', 'hold', 'fallBack', 'takeBases', 'power']);
    expect(bar.indexOf('data-command="power"')).toBeLessThan(bar.indexOf('data-action="orders"'));
    // G19: the row is the bar's second row, after the toolbar (Details and View), and More is the old Orders button under its new word
    expect(bar.indexOf('data-action="view"')).toBeLessThan(bar.indexOf('class="awf-cmd"'));
    expect(bar).toMatch(/data-action="orders"[^>]*>\s*<span class="aw-btn-label">More<\/span>/);
    expect(bar).toContain('aria-expanded="false"');
    expect(h).not.toContain('awf-orders-pop');
    // Deploy\'s built-in commander reads no text: there is no note box on this screen
    expect(h).not.toContain('awf-cmd-note');
    expect(h).not.toContain('Tell your agent');
    const open = render(light, { live: live(true, { pending: true }), ordersOpen: true });
    expect(open).toContain('awf-orders-pop');
    expect(open).toContain('From your next turn');
    expect(open.match(/data-group="/g)).toHaveLength(7);
  });

  it('under fog the other sides\' views and the omniscient one wait until the battle is over (what is hidden cannot guide the orders); with no fog they are there', () => {
    expect(canopy.fog).toBe(true);
    expect(light.fog).toBe(false);
    expect(render(canopy, { live: live(true) })).not.toContain('aww-viewer');
    expect(render(canopy, { live: live(true) })).toContain('data-action="orders"');
    const over = render(canopy, { live: live(false) });
    expect(over).toContain('aww-viewer');
    expect(over).not.toContain('data-action="orders"');
    expect(render(light, { live: live(true) })).toContain('aww-viewer');
  });

  it('the log shows the line for a change from its step on: "Cycle 6 · Armour: Advance" under the turn that starts it', () => {
    const r = runOf(light);
    // the first turn that starts after the first cycle: find a step whose state has the player to move in cycle 2
    const rec = recordMatch(r.setup, r.actions);
    const step = rec.states.findIndex((s, i) => i > 0 && s.cycle === 2 && s.current === 0);
    expect(step, 'setup: the battle reaches cycle 2').toBeGreaterThan(0);
    const changes: OrderChange[] = [
      { from: 0, cycle: 1, orders: freshOrders() },
      { from: step, cycle: 2, orders: setPosture(freshOrders(), { group: 'armour' }, 'advance') },
    ];
    // (the log is in the drawer, G18: open on its tab)
    const at = (n: number): string => bare(renderToString(createElement(MissionWatch, { mission: light, result: { setup: r.setup, actions: r.actions, orderChanges: changes }, initialStep: n, drawerOpen: 'log' })));
    expect(at(step)).toContain('Cycle 2 · Armour: Advance');
    expect(at(step)).toContain('data-kind="orders"');
    expect(at(step - 1), 'not before the turn it starts').not.toContain('Cycle 2 · Armour: Advance');
    // known-bad twin: a battle with no changes has no such line anywhere
    expect(bare(renderToString(createElement(MissionWatch, { mission: light, result: { setup: r.setup, actions: r.actions, orderChanges: [changes[0]] }, initialStep: step, drawerOpen: 'log' })))).not.toContain('data-kind="orders"');
    // shut, the drawer holds no log at all, so the line is not in the page; the Details button is where it will be counted
    expect(bare(renderToString(createElement(MissionWatch, { mission: light, result: { setup: r.setup, actions: r.actions, orderChanges: changes }, initialStep: step })))).not.toContain('data-kind="orders"');
  });

  it('the story shows no debrief while the battle is still open (its last step is not known yet), and shows it at the last step once it is over', () => {
    const r = runOf(light);
    const n = r.actions.length;
    const state = { step: n, seen: [], open: null, debriefRead: false };
    expect(viewOf(state, Number.POSITIVE_INFINITY)).toStrictEqual({ kind: 'none' });
    expect(viewOf(state, n)).toStrictEqual({ kind: 'debrief' });
  });
});
