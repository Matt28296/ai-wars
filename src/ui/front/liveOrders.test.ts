// `#/live` with orders (G19, D-022, D-025): the page reads the agent's orders from the stream, draws the command row with a box for a note, sends a
// change with PUT /orders, and shows when a change began (the log) and which orders were used (the debrief). A real short match is played through the
// real tools and feed with the person's changes PUT to the real route, and its messages are fed to the page's own reducer and screen. Expected answers
// come from the engine's own states, never from the page read back.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LiveMessage, LiveOrdersMessage } from '../../agent/live';
import { validateOrders } from '../../game/doctrine';
import type { StandingOrders } from '../../game/doctrine';
import { recordMatch } from '../watch/timeline';
import { WAITING, parseLiveMessage, putOrdersTo, reduceLive } from './liveFeed';
import type { LiveViewState } from './liveFeed';
import { scriptedMatch } from './liveTestkit';
import type { Scripted } from './liveTestkit';
import { LiveScreen } from './LiveView';
import type { Shown } from './LiveView';
import { applyPosture, applyTakeBases } from './commands';
import { freshOrders, notesOf, summariseOrders } from './ordersModel';

const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');
const json = <T,>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;
const fold = (messages: readonly LiveMessage[], reduce = reduceLive): LiveViewState => messages.reduce(reduce, WAITING);

const CHARGE = (): StandingOrders => applyPosture(freshOrders(), 'advance');
const BASES = (): StandingOrders => applyTakeBases(CHARGE());

let run: Scripted;
beforeAll(async () => {
  // turn 0: the person presses Charge (it counts from turn 1); turn 1: Take bases (from turn 2); then no change
  run = await scriptedMatch('first-light', 4, [CHARGE(), BASES(), null, null]);
  const error = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
    error(...args);
  });
}, 60_000);
afterAll(() => vi.restoreAllMocks());

const ordersAt = (msgs: readonly LiveMessage[]): LiveOrdersMessage[] => msgs.filter((m): m is LiveOrdersMessage => m.type === 'orders');

describe('the page reads the agent\'s orders from the stream', () => {
  it('the scripted match is the one the tests mean: setup, orders, steps, then an orders message when each change is made and when it comes into force', () => {
    const kinds = run.messages.map((m) => m.type);
    expect(kinds.slice(0, 2)).toStrictEqual(['setup', 'orders']);
    expect(ordersAt(run.messages).map((m) => [m.orders, m.pending])).toStrictEqual([
      [json(freshOrders()), null],
      [json(freshOrders()), json(CHARGE())],
      [json(CHARGE()), null],
      [json(CHARGE()), json(BASES())],
      [json(BASES()), null],
    ]);
  });

  it('parses an orders message from the wire, and refuses one whose orders are not orders (a free-text posture, an unknown key)', () => {
    const m = ordersAt(run.messages)[1];
    expect(parseLiveMessage(JSON.stringify(m))).toStrictEqual(json(m));
    const bad = [
      { ...m, orders: { ...m.orders, note: 'hello' } }, { ...m, orders: { posture: 'attack the north tower' } }, { ...m, pending: { retreatAtHp: 2.5 } },
      { ...m, orders: 'advance' }, { ...m, orders: undefined }, { ...m, pending: undefined }, { ...m, match: 'one' },
    ];
    for (const b of bad) expect(parseLiveMessage(JSON.stringify(b)), JSON.stringify(b).slice(0, 60)).toBeNull();
    // what comes back is a fresh copy of valid orders
    expect(parseLiveMessage(JSON.stringify({ type: 'orders', match: 1, orders: {}, pending: null }))).toStrictEqual({ type: 'orders', match: 1, orders: freshOrders(), pending: null });
  });

  it('holds the orders in force and the set that waits, and the change log: each change with the action index it applies from, as the host wrote it', () => {
    const states = run.messages.map((_, i) => fold(run.messages.slice(0, i + 1)));
    const before = states.find((s) => s.orders?.pending && s.steps.length > 1)!;
    expect(before.orders).toStrictEqual({ inForce: json(freshOrders()), pending: json(CHARGE()) });
    // before the record arrives, the page's own log of changes already equals the host's: the stream alone says where each began
    const beforeRecord = fold(run.messages.slice(0, -1));
    expect(beforeRecord.record).toBeNull();
    expect(beforeRecord.orderChanges).toStrictEqual(run.record.orderChanges);
    expect(run.record.orderChanges).toHaveLength(3);
    // and each begins on the agent's own turn, in the cycle the engine's states say
    const truth = recordMatch(run.record.setup, run.record.actions);
    for (const c of run.record.orderChanges.slice(1)) {
      expect(truth.states[c.from].current).toBe(0);
      expect(truth.states[c.from - 1].current).not.toBe(0);
      expect(c.cycle).toBe(truth.states[c.from].cycle);
    }
    // the record's own are the ones held once it is here
    expect(fold(run.messages).orderChanges).toStrictEqual(run.record.orderChanges);
  });

  it('PLANTED: a reducer that dates a change one step early or late is caught by the same comparison', () => {
    const off = (by: number): typeof reduceLive => (s, m) => {
      const next = reduceLive(s, m);
      return m.type === 'orders' && next.orderChanges.length > s.orderChanges.length && s.orderChanges.length > 0
        ? { ...next, orderChanges: next.orderChanges.map((c, i) => (i === next.orderChanges.length - 1 ? { ...c, from: c.from + by } : c)) }
        : next;
    };
    for (const by of [-1, 1]) expect(fold(run.messages.slice(0, -1), off(by)).orderChanges).not.toStrictEqual(run.record.orderChanges);
    expect(fold(run.messages.slice(0, -1), off(0)).orderChanges).toStrictEqual(run.record.orderChanges);
  });

  it('a new match starts the record of changes over; a stale orders message of another match changes nothing', () => {
    const mid = fold(run.messages.slice(0, 40));
    expect(mid.orderChanges.length).toBeGreaterThan(0);
    const fresh = reduceLive(mid, { ...run.messages[0], match: 2 } as LiveMessage);
    expect(fresh.orders).toBeNull();
    expect(fresh.orderChanges).toStrictEqual([]);
    const stale = { ...ordersAt(run.messages)[2], match: 9 } as LiveMessage;
    expect(reduceLive(mid, stale)).toBe(mid);
  });
});

describe('the screen: the command row, the note box, the log line and the debrief', () => {
  const screen = (state: LiveViewState, over: Partial<{ link: 'open' | 'unavailable' | 'connecting'; shown: Shown; send: Parameters<typeof LiveScreen>[0]['send'] }> = {}): string =>
    bare(renderToString(createElement(LiveScreen, { state, link: over.link ?? 'open', shown: over.shown, send: over.send })));
  const send = (): ReturnType<typeof putOrdersTo> => async () => true;
  /** The state after the first N steps and the messages that came before them, with the agent's orders as they were then. */
  const midway = (): LiveViewState => fold(run.messages.slice(0, run.messages.findIndex((m) => m.type === 'step' && m.step.index === 6) + 1));
  const rowOf = (h: string): string => /<div class="awf-cmd"[\s\S]*?<\/p><\/div>/.exec(h)?.[0] ?? '';

  it('draws the command row in the bar and the note box beside it, for a connected agent, while the match runs', () => {
    const h = screen(midway(), { send: send() });
    expect(h).toContain('data-commands="yes"');
    expect([...h.matchAll(/data-command="(\w+)"/g)].map((m) => m[1])).toStrictEqual(['charge', 'hold', 'fallBack', 'takeBases', 'power']);
    expect(h).toMatch(/<input[^>]*placeholder="Tell your agent…"/);
    expect(h).toContain('data-note="yes"');
    expect(rowOf(h)).toContain('awf-cmd-note');
  });

  it('shows the set the person chose while it waits, with "From your agent\'s next turn", and the set in force once it applies', () => {
    const upTo = (pick: (m: LiveOrdersMessage) => boolean): LiveViewState => fold(run.messages.slice(0, run.messages.findIndex((m) => m.type === 'orders' && pick(m)) + 1));
    // the change made in turn 0: Charge waits, the defaults are in force
    const waiting = upTo((m) => m.pending !== null);
    expect(waiting.steps.length).toBeGreaterThan(0);
    const h = screen(waiting, { send: send() });
    expect(h).toContain('data-pending="yes"');
    expect(h).toContain('>From your agent&#x27;s next turn</p>');
    expect(h).toMatch(/data-command="charge"[^>]*aria-pressed="true"/);
    expect(h).not.toContain('From your next turn<');
    // the turn it came into force in: nothing waits, and Charge is in force
    const inForce = upTo((m) => m.pending === null && JSON.stringify(m.orders) === JSON.stringify(CHARGE()));
    const settled = screen(inForce, { send: send() });
    expect(settled).toContain('data-pending="no"');
    expect(settled).not.toContain('From your agent&#x27;s next turn');
    expect(settled).toMatch(/data-command="charge"[^>]*aria-pressed="true"/);
  });

  it('has no row and no note box when the page has no way to send (no send), when the feed sent no orders (an older agent), or when the match is over', () => {
    expect(screen(midway())).not.toContain('awf-cmd');
    const noOrders = fold(run.messages.filter((m) => m.type !== 'orders').slice(0, 9));
    expect(noOrders.orders).toBeNull();
    const h = screen(noOrders, { send: send() });
    expect(h).toContain('aww-root');
    expect(h).not.toContain('awf-cmd');
    expect(h).not.toContain('data-action="orders"');
    const over = fold(run.messages);
    const done = screen(over, { send: send() });
    expect(done).not.toContain('awf-cmd');
    expect(done).not.toContain('Tell your agent');
    expect(done).not.toContain('data-action="orders"');
  });

  it('opened where there is no feed (the dev server, a hosted copy) there is no Orders button, no row and no note box: the connect steps instead', () => {
    for (const link of ['unavailable', 'connecting'] as const) {
      const h = screen(WAITING, { link, send: send() });
      expect(h).not.toContain('data-action="orders"');
      expect(h).not.toContain('data-command');
      expect(h).not.toContain('Tell your agent');
    }
    expect(screen(WAITING, { link: 'unavailable', send: send() })).toContain('data-screen="connect"');
  });

  it('the log gets one line where the orders began, from that step on, and the debrief lists the orders used', () => {
    const [, second, third] = run.record.orderChanges;
    // the log is in the drawer (G18): open on its tab at the step that starts the turn
    const state = fold(run.messages.slice(0, -1));
    const at = (step: number): string => screen(state, { send: send(), shown: { step, drawer: 'log' } });
    expect(at(second.from)).toContain(`Cycle ${second.cycle} · All groups: Advance`);
    expect(at(second.from)).toContain('data-kind="orders"');
    expect(at(second.from - 1), 'not before the turn it starts').not.toContain('All groups: Advance');
    expect(at(third.from)).toContain(`Cycle ${third.cycle} · Armour: Escort capturers`);
    expect(notesOf(run.record.orderChanges).map((n) => n.step)).toStrictEqual([second.from, third.from]);
    // after the record: the result card's one line
    const over = fold(run.messages);
    const h = screen(over, { shown: { step: run.record.actions.length, resultRead: true } });
    expect(h).toContain('data-orders-line="yes"');
    expect(h).toContain(`All groups: Advance from cycle ${second.cycle}`);
    expect(summariseOrders(run.record.orderChanges).line).toContain(`Armour: Escort capturers from cycle ${third.cycle}`);
    expect(h).toContain(`Armour: Escort capturers from cycle ${third.cycle}`);
    // known-bad twin: a match with no changes says "Default orders"
    expect(summariseOrders([run.record.orderChanges[0]]).line).toBe('Default orders');
  });
});

describe('sending: PUT /orders on the page\'s own origin', () => {
  it('sends a PUT with a JSON body of exactly { orders, note? }, and says yes only for a 200', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const put = putOrdersTo('/orders', async (url, init) => { seen.push({ url, init }); return { ok: true }; });
    expect(await put({ orders: CHARGE() })).toBe(true);
    expect(await put({ orders: CHARGE(), note: 'north bridge' })).toBe(true);
    expect(seen.map((s) => s.url)).toStrictEqual(['/orders', '/orders']);
    for (const s of seen) {
      expect(s.init.method).toBe('PUT');
      expect(s.init.headers).toStrictEqual({ 'Content-Type': 'application/json' });
    }
    expect(JSON.parse(seen[0].init.body as string)).toStrictEqual({ orders: json(CHARGE()) });
    expect(JSON.parse(seen[1].init.body as string)).toStrictEqual({ orders: json(CHARGE()), note: 'north bridge' });
    // the orders that go out are the validator's: the body has no other key
    expect(Object.keys(JSON.parse(seen[1].init.body as string)).sort()).toStrictEqual(['note', 'orders']);
    expect(() => validateOrders(JSON.parse(seen[0].init.body as string).orders)).not.toThrow();
  });

  it('is false for a refusal and for a network error, never an exception (known-bad twins)', async () => {
    expect(await putOrdersTo('/orders', async () => ({ ok: false }))({ orders: CHARGE() })).toBe(false);
    expect(await putOrdersTo('/orders', async () => { throw new TypeError('Failed to fetch'); })({ orders: CHARGE() })).toBe(false);
  });
});
