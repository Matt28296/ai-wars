// G18 (D-023, "a very clean interface"): the battle screen is the board, ONE slim bar, ONE row of playback, and one drawer the viewer opens.
// What is tested, in node (no DOM): the drawer's model (open, close, tabs, the count of new log lines, its keys), the bar's numbers read against the
// engine's own state, the page's markup (what the bar holds, what the closed drawer leaves out, that the drawer adds nothing to the board), the View
// menu's wiring (the same switches, the same callbacks) and, planted, that a drawer handed the all-seeing timeline for a fogged viewer is caught.
// What needs a browser (focus moving into the drawer and back, the key handler on the window, pixels) was run in one: see the order's receipt.
import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RendererToggle } from '../board3d/stage/RendererToggle';
import { FACTIONS } from '../../data';
import { DetailsButton } from './Bar';
import { ViewerToggle } from './Controls';
import { buildDemoMatch } from './demo';
import { Drawer } from './Drawer';
import {
  DRAWER_TABS, countLabel, countLogLines, drawerReducer, escapeTarget, initialDrawer, keyToDrawerAction, routeKey, tabAfterKey, unreadLines,
} from './drawer';
import type { DrawerState, DrawerTab } from './drawer';
import { barModel } from './bar';
import { buildLog, mergeNotes } from './format';
import type { LogLine } from './format';
import { intelAt } from './intel';
import { ViewPanel } from './ViewMenu';
import { WatchView } from './WatchView';
import type { WatchViewProps } from './WatchView';
import { knownUnitCount, recordMatch, viewTimeline } from './timeline';
import type { Timeline, Viewer } from './timeline';
import { endTurn, fieldSetup, walk } from './testing';

const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');
const decode = (s: string): string => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const textOf = (html: string): string => decode(bare(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
/** The first element that starts with `open` (a tag's opening text), as a string, found by balancing the tags of its own name. */
function element(html: string, open: string): string {
  const start = html.indexOf(open);
  if (start < 0) return '';
  const tag = /^<(\w+)/.exec(open)![1];
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`unbalanced ${open}`);
}
const pad2 = (n: number): string => String(n).padStart(2, '0');
const barOfHtml = (html: string): string => /<header class="aww-bar"[\s\S]*?<\/header>/.exec(html)![0];

// The watch board lays itself out in a layout effect, which React warns about on the server. That is the old view's own habit, not news.
beforeAll(() => {
  const error = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
    error(...args);
  });
});
afterAll(() => vi.restoreAllMocks());

// ---------------------------------------------------------------- the drawer's model

describe('the drawer model: shut by default, opened and closed, with a count of new log lines', () => {
  const toggle = (s: DrawerState, lines: number): DrawerState => drawerReducer(s, { type: 'toggle', lines });

  it('starts shut on the Players tab, or open on the tab it was asked for', () => {
    expect(initialDrawer(0)).toEqual({ open: false, tab: 'players', seen: 0 });
    expect(initialDrawer(7, 'log')).toEqual({ open: true, tab: 'log', seen: 7 });
    expect(DRAWER_TABS.map((t) => t.tab)).toEqual(['players', 'intel', 'log']);
  });

  it('opens by toggle and open, shuts by toggle and close, and the tab it was on is the tab it opens on', () => {
    let s = initialDrawer(0);
    s = toggle(s, 0);
    expect(s.open).toBe(true);
    s = drawerReducer(s, { type: 'tab', tab: 'intel' });
    s = toggle(s, 0);
    expect(s).toMatchObject({ open: false, tab: 'intel' });
    expect(drawerReducer(s, { type: 'open' })).toMatchObject({ open: true, tab: 'intel' });
    expect(drawerReducer(s, { type: 'open', tab: 'log' })).toMatchObject({ open: true, tab: 'log' });
    // shutting a shut drawer, opening an open one on its own tab, and picking the tab it is on: the same state object, nothing happens
    expect(drawerReducer(s, { type: 'close', lines: 3 })).toBe(s);
    const open = drawerReducer(s, { type: 'open' });
    expect(drawerReducer(open, { type: 'open' })).toBe(open);
    expect(drawerReducer(open, { type: 'tab', tab: 'intel' })).toBe(open);
  });

  it('counts the lines that arrive while it is shut, clears the count when it opens, and counts again only from the lines read when it was shut', () => {
    // worked by hand: the view mounts on a log of 4 lines
    let s = initialDrawer(4);
    expect(unreadLines(s, 4)).toBe(0);
    expect(unreadLines(s, 9)).toBe(5);
    s = toggle(s, 9); // opens: nothing is unread, and stays so while lines arrive
    expect(unreadLines(s, 9)).toBe(0);
    expect(unreadLines(s, 12)).toBe(0);
    s = toggle(s, 12); // shut again at 12 lines: those are read
    expect(unreadLines(s, 12)).toBe(0);
    expect(unreadLines(s, 15)).toBe(3);
    // the scrubber goes back to 7 lines and forward again: only lines past the 12 that were read are new
    expect(unreadLines(s, 7)).toBe(0);
    expect(unreadLines(s, 14)).toBe(2);
    // another viewer's log is another log: its lines count as read
    s = drawerReducer(s, { type: 'rebase', lines: 30 });
    expect(unreadLines(s, 30)).toBe(0);
    expect(unreadLines(s, 31)).toBe(1);
  });

  it('counts the lines the log shows by default: not the moves behind "Show moves", and the orders changes of the player\'s agent (G14) included', () => {
    const tone = (t: LogLine['tone']): Pick<LogLine, 'tone'> => ({ tone: t });
    expect(countLogLines([tone('combat'), tone('quiet'), tone('quiet'), tone('info'), tone('alert'), tone('economy'), tone('power')])).toBe(5);
    expect(countLogLines([])).toBe(0);
    // on a real log: every `moved` line is quiet and so is not counted; a note about the orders is
    const demo = buildDemoMatch();
    const tl = viewTimeline(recordMatch(demo.setup, demo.actions.slice(0, 60)), 0);
    const log = buildLog(tl.steps);
    const moves = log.filter((l) => l.kind === 'moved');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((l) => l.tone === 'quiet')).toBe(true);
    const shown = log.filter((l) => l.kind !== 'moved' && l.tone !== 'quiet').length;
    expect(countLogLines(log)).toBe(shown);
    expect(shown).toBeLessThan(log.length);
    const withNote = mergeNotes(log, [{ step: 30, text: 'Cycle 2 · Armour: Advance' }]);
    expect(withNote.some((l) => l.kind === 'orders')).toBe(true);
    expect(countLogLines(withNote)).toBe(shown + 1);
  });

  it('writes the count small: nothing for none, the number, and 99+ for a flood', () => {
    expect([0, -3, 1, 12, 99, 100, 4000].map(countLabel)).toEqual(['', '', '1', '12', '99', '99+', '99+']);
  });
});

describe('the drawer\'s keys: D opens and closes it, Escape shuts it', () => {
  const k = (key: string, extra: Record<string, unknown> = {}) => ({ key, ...extra });

  it('D, either case, toggles it, wherever focus is but in a text field', () => {
    for (const key of ['d', 'D']) {
      expect(keyToDrawerAction(k(key))).toEqual({ type: 'toggle' });
      expect(keyToDrawerAction(k(key), { tag: 'button' })).toEqual({ type: 'toggle' });
      expect(keyToDrawerAction(k(key), { tag: 'input', type: 'range' })).toEqual({ type: 'toggle' }); // the scrubber
      expect(keyToDrawerAction(k(key), { tag: 'input', type: 'checkbox' })).toEqual({ type: 'toggle' }); // "Show moves"
    }
  });

  it('leaves D to a text box, a text area, a menu and an editable element (known-bad: a letter typed in a field)', () => {
    for (const target of [{ tag: 'input', type: 'text' }, { tag: 'input' }, { tag: 'textarea' }, { tag: 'select' }, { tag: 'div', editable: true }]) {
      expect(keyToDrawerAction(k('d'), target), JSON.stringify(target)).toBeNull();
    }
  });

  it('is not a shortcut with a modifier, and does not repeat while the key is held', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey']) expect(keyToDrawerAction(k('d', { [mod]: true })), mod).toBeNull();
    expect(keyToDrawerAction(k('d', { repeat: true }))).toBeNull();
  });

  it('Escape shuts an open drawer and means nothing when nothing is open', () => {
    expect(keyToDrawerAction(k('Escape'), {}, true)).toEqual({ type: 'close' });
    expect(keyToDrawerAction(k('Escape'), {}, false)).toBeNull();
    for (const other of ['x', ' ', 'ArrowLeft', 'Enter', 'o']) expect(keyToDrawerAction(k(other), {}, true), other).toBeNull();
  });

  it('shuts one thing at a time, the View menu first, and routes D to the drawer whatever is open', () => {
    const none = { menu: false, drawer: false };
    expect(escapeTarget({ menu: true, drawer: true })).toBe('menu');
    expect(escapeTarget({ menu: false, drawer: true })).toBe('drawer');
    expect(escapeTarget(none)).toBeNull();
    expect(routeKey(k('Escape'), {}, { menu: true, drawer: true })).toBe('close-menu');
    expect(routeKey(k('Escape'), {}, { menu: false, drawer: true })).toBe('close-drawer');
    expect(routeKey(k('Escape'), {}, { menu: true, drawer: false })).toBe('close-menu');
    expect(routeKey(k('Escape'), {}, none)).toBeNull();
    expect(routeKey(k('d'), {}, { menu: true, drawer: false })).toBe('toggle-drawer');
    expect(routeKey(k('d'), { tag: 'input', type: 'text' }, none)).toBeNull();
    expect(routeKey(k(' '), {}, none)).toBeNull(); // playback's keys are not these
  });

  it('plays a sequence on the model: D opens, D shuts, D opens, Escape shuts; Space and the arrows never touch it', () => {
    let s = initialDrawer(0);
    const press = (key: string, menu = false): void => {
      const route = routeKey(k(key), {}, { menu, drawer: s.open });
      if (route === 'toggle-drawer') s = drawerReducer(s, { type: 'toggle', lines: 0 });
      else if (route === 'close-drawer') s = drawerReducer(s, { type: 'close', lines: 0 });
    };
    press('d');
    expect(s.open).toBe(true);
    press(' ');
    press('ArrowRight');
    expect(s.open).toBe(true);
    press('d');
    expect(s.open).toBe(false);
    press('D');
    expect(s.open).toBe(true);
    press('Escape', true); // a menu is open: Escape is the menu's, the drawer stays
    expect(s.open).toBe(true);
    press('Escape');
    expect(s.open).toBe(false);
  });

  it('moves between the tabs with the arrows, wrapping, and Home and End', () => {
    expect(tabAfterKey('players', 'ArrowRight')).toBe('intel');
    expect(tabAfterKey('log', 'ArrowRight')).toBe('players');
    expect(tabAfterKey('players', 'ArrowLeft')).toBe('log');
    expect(tabAfterKey('intel', 'Home')).toBe('players');
    expect(tabAfterKey('intel', 'End')).toBe('log');
    expect(tabAfterKey('intel', 'Enter')).toBeNull();
  });
});

// ---------------------------------------------------------------- the bar's numbers

describe('the bar says the cycle, whose turn it is and the viewer\'s own funds, as the engine has them', () => {
  const demo = buildDemoMatch();
  const rec = recordMatch(demo.setup, demo.actions);

  it('reads the cycle, the side whose turn it is and the viewer\'s funds from the true state at every step (viewers 0 and 1)', () => {
    for (const viewer of [0, 1] as const) {
      const tl = viewTimeline(rec, viewer);
      for (const step of tl.steps) {
        const truth = rec.states[step.index];
        const m = barModel(step.frame);
        expect(m.cycle, `viewer ${viewer} step ${step.index}`).toBe(truth.cycle);
        expect(m.turn.player).toBe(truth.current);
        expect(m.turn.faction).toBe(truth.players[truth.current].faction);
        expect(m.turn.label).toBe(FACTIONS[truth.players[truth.current].faction].short);
        expect(m.funds).toBe(truth.players[viewer].funds);
      }
    }
  });

  it('shows no funds in the omniscient view: it has no "your side" (known-bad: reading one side\'s funds off it)', () => {
    const all = viewTimeline(rec, 'all');
    for (const step of all.steps) expect(barModel(step.frame).funds).toBeNull();
    expect(barModel(all.steps[40].frame).fundsOf).toBeNull();
    // the demo's funds really do move, so a bar that showed a constant would be caught
    const funds = viewTimeline(rec, 0).steps.map((s) => barModel(s.frame).funds);
    expect(new Set(funds).size).toBeGreaterThan(2);
  });

  it('names the seat the way the view names its seats: "You", "Rook", "Unmarked", and the unmarked mark for a nation nobody named', () => {
    const seats = [
      { name: 'Your agent', label: 'You', nation: 'shown' as const, portrait: 'agent' as const, log: { subject: 'Your agent', owner: 'Your' } },
      { name: 'Unmarked drones', label: 'Unmarked', nation: 'masked' as const, portrait: 'unmarked' as const, log: { subject: 'Unmarked', owner: 'Unmarked' } },
    ];
    const tl = viewTimeline(rec, 0);
    const first = tl.steps.find((s) => s.frame.current === 0)!;
    const second = tl.steps.find((s) => s.frame.current === 1)!;
    expect(barModel(first.frame, seats).turn).toMatchObject({ label: 'You', owner: 'Your', masked: false });
    expect(barModel(second.frame, seats).turn).toMatchObject({ label: 'Unmarked', owner: 'Unmarked', masked: true });
    expect(barModel(first.frame, seats).fundsOf).toMatchObject({ label: 'You', masked: false });
  });
});

// ---------------------------------------------------------------- the page

describe('the battle screen: the board, one bar, one row of playback, a drawer that is not there until it is opened', () => {
  const demo = buildDemoMatch();
  const rec = recordMatch(demo.setup, demo.actions);
  const STEP = 40;
  const render = (extra: Partial<WatchViewProps> = {}): string =>
    bare(renderToString(createElement(WatchView, { setup: demo.setup, actions: demo.actions, viewer: 0, initialStep: STEP, ...extra } as WatchViewProps)));
  const lead = createElement('a', { id: 'lead-probe', href: '#/' }, 'Back probe');
  const orders = createElement('button', { id: 'orders-probe', type: 'button' }, 'Orders probe');
  const barOf = (html: string): string => /<header class="aww-bar"[\s\S]*?<\/header>/.exec(html)![0];
  /** The bar as a viewer sees it: what is in it, less the View menu's panel, which is hidden until the menu is opened. */
  const visibleBar = (html: string): string => barOf(html).replace(element(barOf(html), '<div class="aww-viewpop"'), '');
  const DRAWER_PARTS = ['aww-huds', 'aww-intel', 'aww-log', 'aria-label="Players"', 'aria-label="Unit intel"', 'aria-label="Battle events"'];

  it('has one bar above the board, and nothing about the old layout: no banner row, no toolbar over the board, no side column', () => {
    const h = render({ lead, ordersSlot: orders, onViewerChange: () => {} });
    expect(h.match(/<header class="aww-bar"/g)).toHaveLength(1);
    expect(h.indexOf('<header class="aww-bar"')).toBeLessThan(h.indexOf('class="aww-main"'));
    expect(h.indexOf('class="aww-main"')).toBeLessThan(h.indexOf('class="aww-stage"'));
    for (const gone of ['aww-banner-row', 'aww-chips', 'aww-toolbar"', 'aww-side', 'aw-banner']) expect(h, gone).not.toContain(gone);
  });

  it('holds in the bar only: the screen\'s back link, the cycle, whose turn, the viewer\'s funds, Orders, Details and View', () => {
    const h = render({ lead, ordersSlot: orders, onViewerChange: () => {} });
    const bar = visibleBar(h);
    // the interactive items, in order: the lead's link, then Orders, Details and View
    expect([...bar.matchAll(/<(a|button)\b[^>]*?(?: id="([\w-]+)")?[^>]*>/g)].map((m) => m[0].replace(/\s+(class|href|type|title|aria-[\w-]+|data-[\w-]+)="[^"]*"/g, '').trim())).toEqual([
      '<a id="lead-probe">', '<button id="orders-probe">', '<button>', '<button>',
    ]);
    expect(bar).toContain('data-action="details"');
    expect(bar).toContain('data-action="view"');
    expect(bar.indexOf('lead-probe')).toBeLessThan(bar.indexOf('aww-turn'));
    expect(bar.indexOf('aww-funds')).toBeLessThan(bar.indexOf('orders-probe'));
    expect(bar.indexOf('orders-probe')).toBeLessThan(bar.indexOf('data-action="details"'));
    expect(bar.indexOf('data-action="details"')).toBeLessThan(bar.indexOf('data-action="view"'));
    // and what it says is the engine's: the cycle, the turn's side and the viewer's funds at the step on screen
    const truth = rec.states[STEP];
    const cycle = /<span class="aww-turn-cycle[^"]*"[^>]*>([\s\S]*?)<\/span><span class="aww-turn-who/.exec(bar)![1];
    expect(textOf(cycle)).toBe(`Cycle ${pad2(truth.cycle)}`);
    expect(textOf(/<span class="aww-turn-who[\s\S]*?<\/span>(?=<\/div>)/.exec(bar)![0])).toBe(FACTIONS[truth.players[truth.current].faction].short);
    expect(/data-funds="(\d+)"/.exec(bar)![1]).toBe(String(truth.players[0].funds));
    expect(textOf(/<span class="stat-sm aww-funds-num"[^>]*>([\s\S]*?)<\/span>/.exec(bar)![1])).toBe(truth.players[0].funds.toLocaleString('en-US'));
    // none of what moved to the drawer, or to the playback row, is in the bar
    for (const part of [...DRAWER_PARTS, 'aww-controls', 'role="radio"', 'Watching as', 'Board view', 'Fog of war', 'No fog']) expect(bar, part).not.toContain(part);
  });

  it('has the funds in the bar for a player, and none for the omniscient view', () => {
    expect(visibleBar(render({ viewer: 1 }))).toContain(`data-funds="${rec.states[STEP].players[1].funds}"`);
    expect(visibleBar(render({ viewer: 'all' }))).not.toContain('aww-funds');
    expect(visibleBar(render({ viewer: 'all' }))).toContain('aww-turn');
  });

  it('keeps the drawer out of the page until it is opened: nothing of Players, Unit intel or the log is drawn, and the button says it is shut', () => {
    const h = render();
    expect(h).toContain('data-drawer="closed"');
    expect(h).not.toContain('aww-drawer');
    for (const part of DRAWER_PARTS) expect(h, part).not.toContain(part);
    expect(h).toMatch(/<button[^>]*aria-expanded="false"[^>]*data-action="details"/);
    // known-positive twin: opened, the same parts are there, and they are in the drawer, after the bar and the board
    const open = render({ initialDrawer: 'players' });
    for (const part of DRAWER_PARTS) expect(open, part).toContain(part);
    expect(open.indexOf('class="aww-drawer"')).toBeGreaterThan(open.indexOf('class="aww-stage"'));
    expect(open.indexOf('aww-huds')).toBeGreaterThan(open.indexOf('class="aww-drawer"'));
    expect(open.indexOf('class="aww-drawer"')).toBeLessThan(open.indexOf('class="aww-bottom"'));
    expect(barOf(open)).not.toContain('aww-huds');
  });

  it('opens on the tab it is asked for, with the other two panels there and hidden, and "Details" saying it is open', () => {
    for (const tab of ['players', 'intel', 'log'] as DrawerTab[]) {
      const h = render({ initialDrawer: tab });
      expect(h).toContain(`data-drawer="${tab}"`);
      expect(h).toMatch(/<button[^>]*aria-expanded="true"[^>]*data-action="details"/);
      const drawer = element(h, '<aside class="aww-drawer"');
      expect(drawer).toContain(`data-tab="${tab}"`);
      const panels = [...drawer.matchAll(/<div class="aww-drawer-panel"([^>]*)>/g)].map((m) => ({ panel: /data-panel="(\w+)"/.exec(m[1])![1], hidden: /\bhidden=""/.test(m[1]) }));
      expect(panels).toEqual(DRAWER_TABS.map((t) => ({ panel: t.tab, hidden: t.tab !== tab })));
      // three tabs, one selected: the open one
      const tabs = [...drawer.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
      expect(tabs).toHaveLength(3);
      expect(tabs.filter((t) => t.includes('aria-selected="true"'))).toHaveLength(1);
      expect(tabs.find((t) => t.includes('aria-selected="true"'))).toContain(`data-tab="${tab}"`);
      expect(drawer).toContain('aria-label="Close details"');
    }
  });

  it('does not resize the board for the drawer: the page with it open is the page without it, less the drawer and the one attribute that says so', () => {
    const shut = render({ onViewerChange: () => {} });
    const open = render({ onViewerChange: () => {}, initialDrawer: 'log' });
    const drawer = element(open, '<aside class="aww-drawer"');
    const rest = open.replace(drawer, '').replace('data-drawer="log"', 'data-drawer="closed"').replace('aria-expanded="true"', 'aria-expanded="false"').replace(/ aria-controls="[^"]*"/, '');
    expect(rest).toBe(shut);
  });

  it('has the playback bar as the one row under the board, with the controls and the scrubber and nothing else', () => {
    const h = render();
    const bottom = element(h, '<div class="aww-bottom"');
    expect(bottom).toContain('aria-label="Playback controls"');
    expect(bottom.match(/<input type="range"/g)).toHaveLength(1);
    expect([...bottom.matchAll(/<button\b/g)]).toHaveLength(6); // back, play, forward, 1x, 2x, 4x
    expect(textOf(bottom)).toContain(`${STEP}/${rec.actions.length}`);
    expect(bottom).not.toContain('aw-key'); // the key caps are a hover hint now
    expect(bottom).toContain('title="Play (Space)"');
    expect(h.indexOf('class="aww-bottom"')).toBeGreaterThan(h.indexOf('class="aww-stage"'));
  });

  it('draws no turn banner anywhere in the page (the bar\'s chip is the banner, small); the cycle cut-in and the attack camera are the stage\'s own and are not in the markup at rest', () => {
    const h = render({ initialDrawer: 'players' });
    expect(h).not.toContain('aw-banner');
    expect(h).not.toContain('aww-sweep');
    expect(h).not.toContain('aww-cutin');
  });

  it('keeps the orders slot in the bar (G14): once, after the funds and before Details, and nowhere else', () => {
    const h = render({ ordersSlot: orders, initialDrawer: 'players' });
    expect(h.split('orders-probe').length - 1).toBe(1);
    expect(barOf(h)).toContain('orders-probe');
    expect(render({})).not.toContain('Orders');
  });

  it('offers the viewer switch only when asked: not at all when the screen gives no callback (a fogged battle that is live; the live view before the record)', () => {
    expect(render({ onViewerChange: () => {} })).toContain('aria-label="Watching as"');
    expect(render({})).not.toContain('aria-label="Watching as"');
    expect(render({ onViewerChange: undefined, initialDrawer: 'log' })).not.toContain('Watching as');
    // and when it is offered it is in the View menu's panel, inside the bar, and hidden until the menu is opened
    const pop = element(barOf(render({ onViewerChange: () => {} })), '<div class="aww-viewpop"');
    expect(pop).toContain('aria-label="Watching as"');
    expect(pop).toMatch(/^<div class="aww-viewpop" id="[^"]*" role="group" aria-label="View" hidden="">/);
  });
});

describe('the Details button', () => {
  const render = (unread: number, open = false): string => renderToStaticMarkup(createElement(DetailsButton, { open, unread, controls: 'drawer-id', onClick: () => {} }));

  it('says nothing but its word while nothing is new, and a small count when lines have arrived', () => {
    expect(render(0)).not.toContain('aww-count');
    expect(render(0)).toContain('data-unread="0"');
    const h = render(3);
    expect(h).toContain('>3<');
    expect(h).toContain('aria-label="3 new log lines"');
    expect(render(1)).toContain('aria-label="1 new log line"');
    expect(render(250)).toContain('>99+<');
    expect(textOf(render(0))).toBe('Details D');
  });

  it('calls what it was given when it is pressed (the page gives it the drawer\'s toggle: the button opens it and shuts it)', () => {
    let pressed = 0;
    const el = DetailsButton({ open: false, unread: 0, onClick: () => { pressed++; } });
    (el.props as { onClick: () => void }).onClick();
    (el.props as { onClick: () => void }).onClick();
    expect(pressed).toBe(2);
    expect((el.props as { 'data-action': string })['data-action']).toBe('details');
  });

  it('points at the drawer only while it is open, and never says it is a toast (it is a button with a number)', () => {
    expect(render(0, true)).toContain('aria-controls="drawer-id"');
    expect(render(0, true)).toContain('aria-expanded="true"');
    expect(render(0, false)).not.toContain('aria-controls');
    expect(render(5)).not.toContain('role="alert"');
    expect(render(5)).not.toContain('aria-live');
  });
});

// ---------------------------------------------------------------- the View menu

/** Every React element in a tree, depth first. */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => elements(n, out));
  else if (isValidElement(node)) {
    out.push(node);
    elements((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

describe('the View menu holds the old switches, wired to the same callbacks', () => {
  const demo = buildDemoMatch();
  const rec = recordMatch(demo.setup, demo.actions);
  const tl = viewTimeline(rec, 0);
  const frame = tl.steps[40].frame;
  const base = { timeline: tl, frame, viewer: 0 as Viewer, webgl2: true, renderer: '3d' as const };

  it('is the very same viewer switch and 3D / 2D switch the page had, byte for byte, and the fog chip', () => {
    const html = renderToStaticMarkup(createElement(ViewPanel, { ...base, onViewerChange: () => {}, onRendererChange: () => {} }));
    expect(html).toContain(renderToStaticMarkup(createElement(ViewerToggle, { frame: tl.steps[0].frame, viewer: 0, onChange: () => {} })));
    expect(html).toContain(renderToStaticMarkup(createElement(RendererToggle, { mode: '3d', onChange: () => {} })));
    expect(html).toContain('data-fog="on"');
    expect(textOf(html)).toContain('Fog of war');
  });

  it('calls the viewer callback with the seat that was picked, and the renderer callback with the board that was picked', () => {
    const viewerPicked: Viewer[] = [];
    const rendererPicked: string[] = [];
    const panel = ViewPanel({ ...base, onViewerChange: (v) => viewerPicked.push(v), onRendererChange: (m) => rendererPicked.push(m) });
    const found = elements(panel);
    const viewerSwitch = found.find((e) => e.type === ViewerToggle)!;
    const rendererSwitch = found.find((e) => e.type === RendererToggle)!;
    expect(viewerSwitch).toBeDefined();
    expect(rendererSwitch).toBeDefined();
    // click the buttons the switches themselves draw: the second seat, then All, then the first seat; then 2D and 3D
    const buttons = (el: ReactElement): ReactElement[] => elements((el.type as (p: unknown) => ReactElement)(el.props)).filter((e) => e.type === 'button');
    const [seat0, seat1, all, ...more] = buttons(viewerSwitch);
    expect(more).toHaveLength(0); // a button per seat, and All
    (seat1.props as { onClick: () => void }).onClick();
    (all.props as { onClick: () => void }).onClick();
    (seat0.props as { onClick: () => void }).onClick();
    expect(viewerPicked).toEqual([1, 'all', 0]);
    const [three, two] = buttons(rendererSwitch);
    (two.props as { onClick: () => void }).onClick();
    (three.props as { onClick: () => void }).onClick();
    expect(rendererPicked).toEqual(['2d', '3d']);
  });

  it('offers no viewer switch without a callback and no 3D / 2D switch where 3D cannot be drawn (known-bad twin)', () => {
    const none = ViewPanel({ ...base, onViewerChange: undefined, webgl2: false, onRendererChange: () => {} });
    const found = elements(none);
    expect(found.some((e) => e.type === ViewerToggle)).toBe(false);
    expect(found.some((e) => e.type === RendererToggle)).toBe(false);
    expect(renderToStaticMarkup(none)).not.toContain('radiogroup');
    expect(textOf(renderToStaticMarkup(none))).toBe('Fog of war');
  });

  it('says what the fog is for the frame on screen: fog up, no fog, and the omniscient view', () => {
    const chip = (f: typeof frame, tlx: Timeline = tl): string => textOf(/<span class="aww-chip[^"]*"[^>]*>[\s\S]*?<\/span>/.exec(renderToStaticMarkup(ViewPanel({ ...base, timeline: tlx, frame: f, onRendererChange: () => {} })))![0]);
    expect(chip(frame)).toBe('Fog of war');
    expect(chip({ ...frame, fogActive: false })).toBe('No fog');
    const all = viewTimeline(rec, 'all');
    expect(chip(all.steps[40].frame, all)).toBe('Omniscient view');
  });
});

// ---------------------------------------------------------------- fog: the bar and the drawer show only what the viewer's timeline shows

describe('D-016: a viewer\'s drawer and bar show no unit and no funds figure that viewer\'s own timeline does not show', () => {
  // Our trooper (id 1) walks to x=3 and sees as far as x=5. The enemy trooper (id 2) walks 9 -> 6, never into sight (intel.test.ts's own fixture).
  const scouting = recordMatch(
    fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true }),
    [walk(1, [0, 1, 2, 3]), endTurn, walk(2, [9, 8, 7, 6])],
  );
  const own = viewTimeline(scouting, 0);
  const everything = viewTimeline(scouting, 'all');

  const drawerHtml = (timeline: Timeline, step: number): string => {
    const lines = buildLog(timeline.steps).filter((l) => l.step <= step);
    return bare(renderToStaticMarkup(createElement(Drawer, { id: 'd', timeline, step, lines, tab: 'players', onTab: () => {}, onClose: () => {} })));
  };

  /**
   * What the drawer shows that `viewer`'s own timeline, at `step`, does not: the unit counts and funds on the Players tab, and the unit on the intel
   * card. Empty means nothing. The expected answers are read off the viewer's own frames and the engine's true state.
   */
  function leaks(html: string, viewer: Timeline, step: number, truth = scouting): string[] {
    const found: string[] = [];
    const frame = viewer.steps[step].frame;
    const counts = [...html.matchAll(/aria-label="(\d+|unknown) units/g)].map((m) => m[1]);
    const expectedCounts = frame.players.map((p) => { const n = knownUnitCount(frame, p.index); return n === null ? 'unknown' : String(n); });
    if (counts.join() !== expectedCounts.join()) found.push(`unit counts ${counts.join()} but the viewer's timeline shows ${expectedCounts.join()}`);
    const funds = [...html.matchAll(/<span class="stat"[^>]*>([^<]*)<\/span><span class="label aw-muted">CR<\/span>/g)].map((m) => m[1]);
    const expectedFunds = frame.players.map((p) => p.funds.toLocaleString('en-US'));
    if (funds.join() !== expectedFunds.join()) found.push(`funds ${funds.join()} but the viewer's timeline shows ${expectedFunds.join()}`);
    // the same figures, from the engine's own state, are the ones the viewer may know (funds are a public line of every player)
    if (expectedFunds.join() !== truth.states[step].players.map((p) => p.funds.toLocaleString('en-US')).join()) found.push('the viewer\'s funds differ from the engine\'s');
    const card = intelAt(viewer.steps, step);
    const owner = /class="caption aww-muted aww-intel-owner"[^>]*>[\s\S]*?<span>([^<]*)<\/span>/.exec(html)?.[1];
    if (card.kind === 'unit') {
      if (owner !== card.unit.factionName) found.push(`intel owner ${String(owner)} but the viewer's card is ${card.unit.factionName}`);
    } else if (owner !== undefined) found.push(`intel shows a unit (${owner}) where the viewer's card is empty`);
    return found;
  }

  it('the enemy that walked in the dark is hidden from the viewer\'s timeline and present in the all-seeing one (the planted case is real)', () => {
    for (const s of own.steps) expect(s.frame.units.map((u) => u.id)).not.toContain(2);
    expect(everything.steps[3].frame.units.map((u) => u.id)).toContain(2);
    expect(knownUnitCount(own.steps[3].frame, 1)).toBeNull();
    expect(knownUnitCount(everything.steps[3].frame, 1)).toBe(1);
  });

  it('shows the viewer\'s drawer at every step with nothing the viewer\'s own timeline does not show (viewers 0 and 1)', () => {
    for (const viewer of [0, 1] as const) {
      const tl = viewTimeline(scouting, viewer);
      for (const s of tl.steps) expect(leaks(drawerHtml(tl, s.index), tl, s.index), `viewer ${viewer} step ${s.index}`).toEqual([]);
    }
    // by hand, at step 3: viewer 0 counts its own one trooper and "unknown" for the enemy's
    expect([...drawerHtml(own, 3).matchAll(/aria-label="(\d+|unknown) units/g)].map((m) => m[1])).toEqual(['1', 'unknown']);
  });

  it('PLANTED: the drawer reading the all-seeing timeline for a fogged viewer fails the check, on the unit count and on the intel card', () => {
    const planted = drawerHtml(everything, 3);
    expect([...planted.matchAll(/aria-label="(\d+|unknown) units/g)].map((m) => m[1])).toEqual(['1', '1']);
    const found = leaks(planted, own, 3);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join(' ')).toMatch(/unit counts 1,1 but the viewer's timeline shows 1,unknown/);
    expect(found.join(' ')).toMatch(/intel owner/);
    // and the right drawer at the same step passes
    expect(leaks(drawerHtml(own, 3), own, 3)).toEqual([]);
  });

  it('shows the viewer\'s whole page, drawer open on each tab, with nothing the viewer does not know', () => {
    for (const tab of ['players', 'intel', 'log'] as DrawerTab[]) {
      for (const viewer of [0, 1] as const) {
        const tl = viewTimeline(scouting, viewer);
        for (const step of [0, 1, 3]) {
          const html = bare(renderToString(createElement(WatchView, { setup: scouting.setup, actions: scouting.actions, viewer, initialStep: step, initialDrawer: tab })));
          const drawer = element(html, '<aside class="aww-drawer"');
          expect(leaks(drawer, tl, step), `${tab}, viewer ${viewer}, step ${step}`).toEqual([]);
          // and the bar's funds are the viewer's own, from the engine's own state
          expect(barOfHtml(html)).toContain(`data-funds="${scouting.states[step].players[viewer].funds}"`);
        }
      }
    }
  });

  it('PLANTED: a bar built from the all-seeing frame has no funds where the viewer\'s has them, so a bar reading the wrong timeline is caught', () => {
    const demo = buildDemoMatch();
    const rec = recordMatch(demo.setup, demo.actions);
    const mine = viewTimeline(rec, 0).steps[40];
    const theirs = viewTimeline(rec, 'all').steps[40];
    expect(barModel(mine.frame).funds).toBe(rec.states[40].players[0].funds);
    expect(barModel(theirs.frame).funds).not.toBe(rec.states[40].players[0].funds);
    expect(barModel(theirs.frame).funds).toBeNull();
  });
});

