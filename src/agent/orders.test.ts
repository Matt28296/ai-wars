// G19 (D-022, D-025): the person changes the connected agent's orders, and leaves it a note, from the page: `PUT /orders` on the agent's local server.
// Real sockets and the real session, feed and match. Three claims, each with a planted twin that must fail the same check:
//   1. the route (feed.ts): every wrong request is refused with a fixed word and changes nothing, and a good one is accepted;
//   2. the timing (D-022): a change counts from the agent's NEXT turn start, never sooner, and the record says from which action;
//   3. the note (D-025): the agent's own get_orders returns it, and nothing else holds it (not Doctrine's inputs, the match record, the stream).
import { afterEach, describe, expect, it } from 'vitest';
import { MISSIONS } from '../content/missions';
import type { Action, GameState } from '../game/aw';
import { stateHash } from '../game/aw/replay';
import { DEFAULT_ORDERS, decide, validateOrders } from '../game/doctrine';
import type { StandingOrders } from '../game/doctrine';
import { recordMatch } from '../ui/watch/timeline';
import { ORDERS_BODY_MAX, checkOrdersBody, startFeed } from './feed';
import type { Feed } from './feed';
import { NOTE_MAX, cleanNote, noteLength } from './live';
import type { LiveOrdersMessage, LiveRecord } from './live';
import { AgentMatch } from './match';
import type { MatchHost } from './match';
import { AgentSession, DESCRIPTIONS } from './tools';
import { call, connect, firstLegalId, httpRequest, playWithChanges, putOrders, streamOfFinishedMatch } from './testkit';
import type { Connected } from './testkit';

const AT = '2026-10-09T12:00:00.000Z';
/** A string no game text, order or id contains. Planted in a note, it is found wherever the note went. */
const MARK = 'NOTE-MARKER-9f2c7a';
const json = <T,>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;
const DEFAULTS = (): StandingOrders => validateOrders(DEFAULT_ORDERS);
const ARMOUR_ADVANCE = (): StandingOrders => validateOrders({ groups: { armour: { posture: 'advance' } } });
const SAVE_POWER = (): StandingOrders => validateOrders({ ...ARMOUR_ADVANCE(), powerPolicy: 'saveForOverclock' });
const valid = (): { orders: StandingOrders } => ({ orders: ARMOUR_ADVANCE() });

const feeds: Feed[] = [];
const open: Connected[] = [];
afterEach(async () => {
  for (const c of open.splice(0)) await c.close();
  for (const f of feeds.splice(0)) await f.close();
});

interface Rig { feed: Feed; session: AgentSession; host: () => AgentMatch; put: (body: unknown, over?: Parameters<typeof putOrders>[2]) => ReturnType<typeof putOrders> }

/** A feed and a session over it. `driver` plays the other seats (default Doctrine on the default orders); `maxCycles` shortens the match. */
async function rig(opts: { maxCycles?: number; driver?: (state: GameState, seat: number) => Action; wrapFeed?: (f: Feed) => Feed; defaultHost?: boolean } = {}): Promise<Rig> {
  const feed = await startFeed({ site: null });
  feeds.push(feed);
  let host!: AgentMatch;
  const session = new AgentSession({
    feed: opts.wrapFeed ? opts.wrapFeed(feed) : feed,
    clock: () => AT,
    ...(opts.defaultHost ? {} : { makeHost: (m) => (host = new AgentMatch(m, { ...(opts.maxCycles ? { maxCycles: opts.maxCycles } : {}), ...(opts.driver ? { driver: opts.driver } : {}) })) }),
  });
  return { feed, session, host: () => host, put: (body, over) => putOrders(feed.port, body, over) };
}

const orders = (s: AgentSession): Record<string, any> => s.getOrders().data;

// ================================================================ 1. the route

describe('PUT /orders: the one write route', () => {
  it('accepts a valid body and says a change waits; the answer is { pending } and nothing else', async () => {
    const r = await rig();
    r.session.startMission('first-light');
    const ok = await r.put({ orders: ARMOUR_ADVANCE() });
    expect(ok.status).toBe(200);
    expect(ok.body).toBe('{"pending":true}');
    expect(ok.headers['content-type']).toContain('application/json');
    expect(orders(r.session).pending).toStrictEqual(ARMOUR_ADVANCE());
    // the same orders again, with a note: nothing new waits for the orders, and the answer is still the one shape
    const again = await r.put({ orders: ARMOUR_ADVANCE(), note: 'hello' });
    expect(again.status).toBe(200);
    expect(JSON.parse(again.body)).toStrictEqual({ pending: true });
    // `orders` alone is a full body (`note` is optional), and a charset on the content type is allowed
    expect((await r.put({ orders: DEFAULTS() }, { type: 'application/json; charset=utf-8' })).status).toBe(200);
    expect(JSON.parse((await r.put({ orders: DEFAULTS() })).body)).toStrictEqual({ pending: false });
    expect(orders(r.session).pending).toBeNull();
  });

  /** One refused request: how to send it, what must come back, and a marker that must not. */
  interface Refusal { name: string; send: (r: Rig) => ReturnType<typeof putOrders>; status: number; error?: string }
  const big = (n: number): string => JSON.stringify({ orders: DEFAULTS(), pad: 'x'.repeat(n) });
  const refusals: Refusal[] = [
    { name: 'a foreign Host', send: (r) => r.put(valid(), { host: 'evil.example' }), status: 403 },
    { name: 'a foreign Host with this port', send: (r) => r.put(valid(), { host: `evil.example:${r.feed.port}` }), status: 403 },
    { name: 'a foreign Origin', send: (r) => r.put(valid(), { origin: 'http://evil.example' }), status: 403, error: 'forbidden-origin' },
    { name: 'a local Origin on another port', send: (r) => r.put(valid(), { origin: `http://127.0.0.1:${r.feed.port + 1}` }), status: 403, error: 'forbidden-origin' },
    { name: 'a local Origin with the right port over https', send: (r) => r.put(valid(), { origin: `https://127.0.0.1:${r.feed.port}` }), status: 403, error: 'forbidden-origin' },
    { name: 'a look-alike Origin', send: (r) => r.put(valid(), { origin: `http://127.0.0.1:${r.feed.port}.evil.example` }), status: 403, error: 'forbidden-origin' },
    { name: 'the Origin "null"', send: (r) => r.put(valid(), { origin: 'null' }), status: 403, error: 'forbidden-origin' },
    { name: 'a local Origin with no port', send: (r) => r.put(valid(), { origin: 'http://127.0.0.1' }), status: 403, error: 'forbidden-origin' },
    { name: 'a missing Origin', send: (r) => r.put(valid(), { origin: null }), status: 403, error: 'forbidden-origin' },
    { name: 'the content type text/plain', send: (r) => r.put(valid(), { type: 'text/plain' }), status: 415, error: 'content-type-not-json' },
    { name: 'a form content type', send: (r) => r.put(valid(), { type: 'application/x-www-form-urlencoded' }), status: 415, error: 'content-type-not-json' },
    { name: 'no content type', send: (r) => r.put(valid(), { type: null }), status: 415, error: 'content-type-not-json' },
    { name: 'a look-alike content type', send: (r) => r.put(valid(), { type: 'application/jsonp' }), status: 415, error: 'content-type-not-json' },
    { name: 'another charset', send: (r) => r.put(valid(), { type: 'application/json; charset=latin1' }), status: 415, error: 'content-type-not-json' },
    { name: 'a body one byte over 8 KB', send: (r) => r.put(null, { raw: big(ORDERS_BODY_MAX - big(0).length + 1) }), status: 413, error: 'body-too-large' },
    { name: 'a body of 100 KB', send: (r) => r.put(null, { raw: big(100_000) }), status: 413, error: 'body-too-large' },
    { name: 'a free-text field beside the orders', send: (r) => r.put({ ...valid(), [`field-${MARK}`]: `say ${MARK}` }), status: 400, error: 'unknown-field' },
    { name: 'a free-text "message" field', send: (r) => r.put({ ...valid(), message: MARK }), status: 400, error: 'unknown-field' },
    { name: 'free text inside the orders', send: (r) => r.put({ orders: { ...DEFAULTS(), note: MARK } }), status: 400, error: 'bad-orders' },
    { name: 'free text as the posture', send: (r) => r.put({ orders: { posture: MARK } }), status: 400, error: 'bad-orders' },
    { name: 'a mission from the wrong group', send: (r) => r.put({ orders: { groups: { infantry: { mission: 'escort' } } } }), status: 400, error: 'bad-orders' },
    { name: 'a retreat that is not a whole number', send: (r) => r.put({ orders: { retreatAtHp: 2.5 } }), status: 400, error: 'bad-orders' },
    { name: 'orders that are not an object', send: (r) => r.put({ orders: MARK }), status: 400, error: 'bad-orders' },
    { name: 'a note that is not text', send: (r) => r.put({ ...valid(), note: 7 }), status: 400, error: 'bad-note' },
    { name: 'a note that is null', send: (r) => r.put({ ...valid(), note: null }), status: 400, error: 'bad-note' },
    { name: 'a note of 281 characters', send: (r) => r.put({ ...valid(), note: `${MARK}${'a'.repeat(NOTE_MAX + 1 - MARK.length)}` }), status: 400, error: 'note-too-long' },
    { name: 'text that is not JSON', send: (r) => r.put(null, { raw: `orders=${MARK}` }), status: 400, error: 'bad-json' },
    { name: 'an empty body', send: (r) => r.put(null, { raw: '' }), status: 400, error: 'bad-json' },
    { name: 'a list', send: (r) => r.put(null, { raw: `["${MARK}"]` }), status: 400, error: 'bad-body' },
    { name: 'null', send: (r) => r.put(null, { raw: 'null' }), status: 400, error: 'bad-body' },
    { name: 'a body with a note and no orders', send: (r) => r.put({ note: MARK }), status: 400, error: 'bad-body' },
  ];

  it.each(refusals.map((c) => [c.name, c] as const))('refuses %s with a fixed word, echoes nothing, and changes nothing', async (_name, c) => {
    const r = await rig();
    r.session.startMission('first-light');
    const res = await c.send(r);
    expect(res.status).toBe(c.status);
    // a fixed reason, never the body: the marker the request carried is nowhere in the reply
    expect(res.body).not.toContain(MARK);
    if (c.error) expect(res.body).toBe(JSON.stringify({ error: c.error }));
    // no CORS header on any answer of this route
    for (const h of Object.keys(res.headers)) expect(h, `${c.name}: ${h}`).not.toMatch(/^access-control-/);
    // and nothing was taken
    const o = orders(r.session);
    expect(o.pending).toBeNull();
    expect(o.note).toBeNull();
    expect(o.orders).toStrictEqual(DEFAULTS());
  });

  it('accepts a body of exactly 8 KB (the limit is 8192 bytes) and refuses the next byte', async () => {
    const r = await rig();
    r.session.startMission('first-light');
    const exact = `${JSON.stringify({ orders: DEFAULTS() })}${' '.repeat(ORDERS_BODY_MAX - JSON.stringify({ orders: DEFAULTS() }).length)}`;
    expect(Buffer.byteLength(exact)).toBe(ORDERS_BODY_MAX);
    expect((await r.put(null, { raw: exact })).status).toBe(200);
    expect((await r.put(null, { raw: `${exact} ` })).status).toBe(413);
  });

  it('refuses a body over 8 KB that declares no length (sent in chunks), without reading it all', async () => {
    const r = await rig();
    r.session.startMission('first-light');
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`http://127.0.0.1:${r.feed.port}/orders`, { method: 'PUT', headers: { Origin: `http://127.0.0.1:${r.feed.port}`, 'Content-Type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', (e) => { if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET' && (e as NodeJS.ErrnoException).code !== 'EPIPE') reject(e); });
      req.write('{"orders":{},"pad":"');
      for (let i = 0; i < 5; i++) req.write('x'.repeat(2000));
      req.end('"}');
    });
    expect(status).toBe(413);
    expect(orders(r.session).pending).toBeNull();
  });

  it('answers 409 when no match is running: before a mission, and after the match is over', async () => {
    const r = await rig({ maxCycles: 1 });
    const before = await r.put({ orders: ARMOUR_ADVANCE() });
    expect(before.status).toBe(409);
    expect(before.body).toBe('{"error":"no-match"}');
    r.session.startMission('first-light');
    while (!r.host().result()) {
      const id = firstLegalId(r.session);
      if (id) r.session.act(id);
      r.session.endTurn();
    }
    const after = await r.put({ orders: ARMOUR_ADVANCE() });
    expect(after.status).toBe(409);
    expect(after.body).toBe('{"error":"no-match"}');
    expect(r.host().pendingOrders()).toBeNull();
  });

  it('is PUT only: every other method is 405 with Allow: PUT, and the preflight a browser sends for a cross-origin page is refused with no CORS header', async () => {
    const r = await rig();
    r.session.startMission('first-light');
    for (const method of ['GET', 'HEAD', 'POST', 'DELETE', 'PATCH', 'OPTIONS']) {
      for (const origin of [`http://127.0.0.1:${r.feed.port}`, 'http://evil.example', null]) {
        const res = await r.put(valid(), { method, origin });
        expect(res.status, `${method} from ${String(origin)}`).toBe(405);
        expect(res.headers.allow).toBe('PUT');
        for (const h of Object.keys(res.headers)) expect(h, `${method}: ${h}`).not.toMatch(/^access-control-/);
      }
    }
    // a GET with the page's own headers is not a way to read anything either
    expect((await httpRequest(`http://127.0.0.1:${r.feed.port}/orders`)).body).toBe('{"error":"method-not-allowed"}');
    expect(orders(r.session).pending).toBeNull();
  });

  it('sends no CORS header on a good answer either, even to a local origin (the page is same-origin and needs none)', async () => {
    const r = await rig();
    r.session.startMission('first-light');
    const res = await r.put({ orders: ARMOUR_ADVANCE() });
    expect(res.status).toBe(200);
    for (const h of Object.keys(res.headers)) expect(h).not.toMatch(/^access-control-/);
  });

  it('checkOrdersBody: the pure check says each refusal by its own word, and a known-good body passes with the note cleaned', () => {
    expect(checkOrdersBody({ orders: ARMOUR_ADVANCE(), note: '  go  \n north \u0007' })).toStrictEqual({ ok: true, put: { orders: ARMOUR_ADVANCE(), note: 'go north' } });
    expect(checkOrdersBody({ orders: {} })).toMatchObject({ ok: true });
    expect(checkOrdersBody({ orders: ARMOUR_ADVANCE(), note: '' })).toStrictEqual({ ok: true, put: { orders: ARMOUR_ADVANCE(), note: '' } });
    expect(checkOrdersBody({ orders: {}, note: 5 })).toStrictEqual({ ok: false, reason: 'bad-note' });
    expect(checkOrdersBody({ orders: {}, extra: 1 })).toStrictEqual({ ok: false, reason: 'unknown-field' });
    expect(checkOrdersBody({ orders: { posture: 'x' } })).toStrictEqual({ ok: false, reason: 'bad-orders' });
    expect(checkOrdersBody([])).toStrictEqual({ ok: false, reason: 'bad-body' });
    // the orders come back as the validator's own copy, never the caller's object
    const mine = { posture: 'advance' };
    const checked = checkOrdersBody({ orders: mine });
    expect(checked.ok && checked.put.orders).not.toBe(mine);
  });
});

// ================================================================ 2. the timing (D-022)

describe('a change counts from the agent\'s NEXT turn start (D-022)', () => {
  /**
   * The whole claim as one probe, so a planted host can be run through it. The agent reads its orders, the person changes them DURING the agent\'s
   * turn, and the agent's turn goes on under the old orders: only at the start of its next turn do they change, and end_turn says so exactly once.
   */
  async function timingProbe(wrap: (real: AgentMatch) => MatchHost): Promise<void> {
    const feed = await startFeed({ site: null });
    feeds.push(feed);
    const s = new AgentSession({ feed, clock: () => AT, makeHost: (m) => wrap(new AgentMatch(m, { maxCycles: 3 })) });
    s.startMission('first-light');
    expect(orders(s).orders).toStrictEqual(DEFAULTS());
    const res = await putOrders(feed.port, { orders: ARMOUR_ADVANCE() });
    expect(res.status).toBe(200);
    // during the agent's own turn: what is in force is what it was, and the new set waits
    expect(orders(s).orders, 'orders in force during the turn the change was made in').toStrictEqual(DEFAULTS());
    expect(orders(s).pending).toStrictEqual(ARMOUR_ADVANCE());
    const id = firstLegalId(s);
    if (id) s.act(id);
    expect(orders(s).orders, 'orders in force after the agent acted').toStrictEqual(DEFAULTS());
    const first = s.endTurn();
    expect(first.data.ordersChanged, 'the turn the new orders come into force').toBe(true);
    expect(orders(s).orders).toStrictEqual(ARMOUR_ADVANCE());
    expect(orders(s).pending).toBeNull();
    const second = s.endTurn();
    expect(second.data.ordersChanged, 'once only').toBe(false);
    expect(orders(s).orders).toStrictEqual(ARMOUR_ADVANCE());
  }

  it('a change made during the agent\'s own turn leaves get_orders.orders unchanged until its next turn, and end_turn says ordersChanged once', async () => {
    await timingProbe((real) => real);
  });

  it('PLANTED: a host that applies the change immediately fails the same check', async () => {
    const immediately = (real: AgentMatch): MatchHost => new Proxy(real, {
      get: (t, k) => (k === 'orders' ? () => t.pendingOrders() ?? t.orders() : typeof t[k as keyof AgentMatch] === 'function' ? (t[k as keyof AgentMatch] as () => unknown).bind(t) : t[k as keyof AgentMatch]),
    }) as unknown as MatchHost;
    await expect(timingProbe(immediately)).rejects.toThrow();
  });

  it('a change made during Doctrine\'s turns applies at the agent\'s next turn, in the same end_turn that hands the turn back', async () => {
    let fired = 0;
    let during: StandingOrders | null = null;
    let r!: Rig;
    r = await rig({
      driver: (state, seat) => {
        if (fired === 0) {
          fired = 1;
          // the person's page writes while Doctrine plays the other seats: the agent's orders in force have not moved
          during = r.host().orders();
          expect(r.session.putOrders({ orders: ARMOUR_ADVANCE() })).toStrictEqual({ pending: true });
          expect(r.host().orders()).toStrictEqual(DEFAULTS());
        }
        return decide(state, seat, DEFAULT_ORDERS);
      },
    });
    r.session.startMission('first-light');
    const id = firstLegalId(r.session);
    if (id) r.session.act(id);
    const before = r.host().record().actions.length;
    const e = r.session.endTurn();
    expect(fired).toBe(1);
    expect(during).toStrictEqual(DEFAULTS());
    expect(e.data.ordersChanged).toBe(true);
    expect(orders(r.session).orders).toStrictEqual(ARMOUR_ADVANCE());
    expect(orders(r.session).pending).toBeNull();
    // the record says it applies from the first action of this new turn, which is by the agent
    const changes = r.host().orderChanges();
    expect(changes).toHaveLength(2);
    expect(changes[1].from).toBe(r.host().record().actions.length);
    expect(changes[1].from).toBeGreaterThan(before);
    expect(r.host().trueState().current).toBe(0);
    expect(changes[1].cycle).toBe(r.host().trueState().cycle);
  });

  it('two changes before the next turn: the later one wins; setting the orders back to what is in force takes the waiting set back', async () => {
    const r = await rig();
    r.session.startMission('first-light');
    await r.put({ orders: ARMOUR_ADVANCE() });
    await r.put({ orders: SAVE_POWER() });
    expect(orders(r.session).pending).toStrictEqual(SAVE_POWER());
    expect(JSON.parse((await r.put({ orders: DEFAULTS() })).body)).toStrictEqual({ pending: false });
    expect(orders(r.session).pending).toBeNull();
    // nothing waits, so the turn ends with no change and the record has only its first entry
    expect(r.session.endTurn().data.ordersChanged).toBe(false);
    expect(r.host().orderChanges()).toStrictEqual([{ from: 0, cycle: 1, orders: DEFAULTS() }]);
  });

  it('a new start_mission starts from the last orders the person set for that mission, and any other mission from the defaults', async () => {
    const r = await rig({ defaultHost: true });
    r.session.startMission('first-light');
    await r.put({ orders: SAVE_POWER() });
    expect(orders(r.session).orders).toStrictEqual(DEFAULTS());
    r.session.startMission('first-light');
    expect(orders(r.session).orders, 'in force from the first turn of the next match').toStrictEqual(SAVE_POWER());
    expect(orders(r.session).pending).toBeNull();
    expect(r.session.current()!.orderChanges()).toStrictEqual([{ from: 0, cycle: 1, orders: SAVE_POWER() }]);
    r.session.startMission(MISSIONS[1].id);
    expect(orders(r.session).orders).toStrictEqual(DEFAULTS());
    r.session.startMission('first-light');
    expect(orders(r.session).orders).toStrictEqual(SAVE_POWER());
  });

  it('the record carries each change with the action index it applies from; a replay from it is exact', async () => {
    const r = await rig({ maxCycles: 4 });
    r.session.startMission('first-light');
    const replies = await playWithChanges(r.feed.port, r.session, [ARMOUR_ADVANCE(), SAVE_POWER(), null, null]);
    expect(replies.map((x) => x.status)).toStrictEqual([200, 200]);
    const rec = r.host().record();
    const truth = recordMatch(rec.setup, rec.actions);
    // the first action of each of the agent's turns, from the engine's own states
    const starts = truth.states.map((_, i) => i).filter((i) => truth.states[i].current === 0 && (i === 0 || truth.states[i - 1].current !== 0));
    const served = JSON.parse((await httpRequest(r.feed.recordUrl)).body) as LiveRecord;
    expect(served.orderChanges).toStrictEqual([
      { from: 0, cycle: 1, orders: json(DEFAULTS()) },
      { from: starts[1], cycle: truth.states[starts[1]].cycle, orders: json(ARMOUR_ADVANCE()) },
      { from: starts[2], cycle: truth.states[starts[2]].cycle, orders: json(SAVE_POWER()) },
    ]);
    expect(r.host().orderChanges()).toStrictEqual(served.orderChanges);
    for (const c of served.orderChanges.slice(1)) expect(truth.states[c.from].current, 'a change begins on the agent\'s own turn').toBe(0);
    // a replay of the record alone reaches the very state the match ended in
    expect(stateHash(truth.states[truth.states.length - 1])).toBe(r.host().trueStateHash());
    const short = recordMatch(rec.setup, rec.actions.slice(0, -1));
    expect(stateHash(short.states[short.states.length - 1]), 'planted: a record missing its last action ends elsewhere').not.toBe(r.host().trueStateHash());
  }, 60_000);
});

// ================================================================ the `orders` message

describe('the `orders` message carries the agent\'s own seat\'s orders, and only those', () => {
  /** True when the message is exactly { type, match, orders, pending } with both sets valid orders. */
  const clean = (m: unknown): boolean => {
    const o = m as Record<string, unknown>;
    if (JSON.stringify(Object.keys(o).sort()) !== JSON.stringify(['match', 'orders', 'pending', 'type'])) return false;
    try {
      validateOrders(o.orders);
      if (o.pending !== null) validateOrders(o.pending);
    } catch {
      return false;
    }
    return true;
  };

  it('is sent after the setup and at each change: when a set waits and when it comes into force', async () => {
    const r = await rig({ maxCycles: 3 });
    r.session.startMission('first-light');
    await playWithChanges(r.feed.port, r.session, [ARMOUR_ADVANCE(), null, null]);
    const frames = await streamOfFinishedMatch(r.feed.liveUrl);
    const sent = frames.filter((f) => f.event === 'orders').map((f) => f.message as LiveOrdersMessage);
    expect(frames[1].event).toBe('orders');
    expect(sent.map((m) => ({ orders: m.orders, pending: m.pending }))).toStrictEqual([
      { orders: json(DEFAULTS()), pending: null },
      { orders: json(DEFAULTS()), pending: json(ARMOUR_ADVANCE()) },
      { orders: json(ARMOUR_ADVANCE()), pending: null },
    ]);
    for (const m of sent) expect(clean(m), JSON.stringify(m)).toBe(true);
    // the change in force follows the step that began the agent's turn, never one before it
    const at = frames.findIndex((f) => f.event === 'orders' && (f.message as LiveOrdersMessage).pending === null && JSON.stringify((f.message as LiveOrdersMessage).orders) === JSON.stringify(ARMOUR_ADVANCE()));
    expect(frames[at - 1].event).toBe('step');
    // a viewer that joins late is sent the same history
    const late = await streamOfFinishedMatch(r.feed.liveUrl);
    expect(late.filter((f) => f.event === 'orders')).toHaveLength(3);
  }, 60_000);

  it('PLANTED: a message that carries a note, a second seat\'s orders or a made-up key fails the check that passes the real ones', () => {
    const real = { type: 'orders', match: 1, orders: DEFAULTS(), pending: null };
    expect(clean(real)).toBe(true);
    expect(clean({ ...real, note: MARK })).toBe(false);
    expect(clean({ ...real, seat1: DEFAULTS() })).toBe(false);
    expect(clean({ ...real, orders: { ...DEFAULTS(), note: MARK } })).toBe(false);
    expect(clean({ ...real, pending: { posture: MARK } })).toBe(false);
  });

  it('is not sent for a change that changes nothing (a note alone says nothing on the stream)', async () => {
    const r = await rig({ maxCycles: 1 });
    r.session.startMission('first-light');
    await r.put({ orders: DEFAULTS(), note: `look ${MARK}` });
    await r.put({ orders: DEFAULTS() });
    while (!r.host().result()) {
      const id = firstLegalId(r.session);
      if (id) r.session.act(id);
      r.session.endTurn();
    }
    const frames = await streamOfFinishedMatch(r.feed.liveUrl);
    expect(frames.filter((f) => f.event === 'orders')).toHaveLength(1);
  });
});

// ================================================================ 3. the note (D-025)

describe('a typed note reaches the player\'s own agent and nowhere else (D-025)', () => {
  it('get_orders returns { text, from: "your commander", at }; the newest replaces the last; an empty one clears it; leaving it out keeps it', async () => {
    const r = await rig();
    r.session.startMission('first-light');
    expect(orders(r.session).note).toBeNull();
    await r.put({ orders: DEFAULTS(), note: 'Take the north bridge first.' });
    expect(orders(r.session).note).toStrictEqual({ text: 'Take the north bridge first.', from: 'your commander', at: AT });
    await r.put({ orders: ARMOUR_ADVANCE() });
    expect(orders(r.session).note?.text, 'a change of orders alone keeps the note').toBe('Take the north bridge first.');
    await r.put({ orders: DEFAULTS(), note: 'Hold the river instead.' });
    expect(orders(r.session).note?.text).toBe('Hold the river instead.');
    await r.put({ orders: DEFAULTS(), note: '   ' });
    expect(orders(r.session).note).toBeNull();
  });

  it('is plain text of at most 280 characters: controls are stripped, 280 is taken, 281 is refused, and a character is a code point', async () => {
    const r = await rig();
    r.session.startMission('first-light');
    await r.put({ orders: DEFAULTS(), note: '\u0007Hold\u0000 the\nline\r\n\tnow‮​' });
    expect(orders(r.session).note?.text).toBe('Hold the line now​');
    expect((await r.put({ orders: DEFAULTS(), note: 'a'.repeat(NOTE_MAX) })).status).toBe(200);
    expect((await r.put({ orders: DEFAULTS(), note: 'a'.repeat(NOTE_MAX + 1) })).status).toBe(400);
    expect(noteLength(orders(r.session).note!.text)).toBe(NOTE_MAX);
    // 280 emoji are 560 UTF-16 units and 280 characters
    const emoji = '\u{1F6E1}'.repeat(NOTE_MAX);
    expect(emoji.length).toBe(NOTE_MAX * 2);
    expect((await r.put({ orders: DEFAULTS(), note: emoji })).status).toBe(200);
    expect((await r.put({ orders: DEFAULTS(), note: `${emoji}\u{1F6E1}` })).status).toBe(400);
    expect(cleanNote('  a \n b  ')).toBe('a b');
  });

  it('a new match starts with no note, and no note is held when no match runs', async () => {
    const r = await rig({ defaultHost: true });
    r.session.startMission('first-light');
    await r.put({ orders: DEFAULTS(), note: MARK });
    expect(orders(r.session).note?.text).toBe(MARK);
    r.session.startMission('first-light');
    expect(orders(r.session).note).toBeNull();
  });

  /**
   * Plays a short match with a note set, and says where the marker was found: in what Doctrine was handed, the match's record, the whole record
   * the feed serves, the stream, and the answers of the other tools. The agent's own get_orders must hold it (and only there).
   */
  async function whereIsTheNote(plant: { doctrine?: boolean; stream?: boolean; record?: boolean } = {}): Promise<{ found: string[]; inGetOrders: number }> {
    const handed: string[] = [];
    let r!: Rig;
    r = await rig({
      maxCycles: 2,
      driver: (state, seat) => {
        // what Doctrine is given: the state and the seat (and the orders it plays under); a planted leak hands it the agent's note as well
        handed.push(JSON.stringify({ state, seat, ...(plant.doctrine ? { note: orders(r.session).note } : {}) }));
        return decide(state, seat, DEFAULT_ORDERS);
      },
      wrapFeed: (f) => ({
        ...f,
        orders: (o) => f.orders(plant.stream ? ({ ...o, orders: { ...o.orders, note: orders(r.session).note?.text } }) as never : o),
        finish: (res, rec) => f.finish(res, plant.record ? ({ ...rec, orderChanges: rec.orderChanges?.map((c) => ({ ...c, note: orders(r.session).note?.text })) }) as never : rec),
      }),
    });
    r.session.startMission('first-light');
    await r.put({ orders: ARMOUR_ADVANCE(), note: MARK });
    const answers: string[] = [JSON.stringify(r.session.observe().data), JSON.stringify(r.session.legalActions().data), JSON.stringify(r.session.listMissions().data)];
    const inGetOrders = JSON.stringify(r.session.getOrders().data).split(MARK).length - 1;
    while (!r.host().result()) {
      const id = firstLegalId(r.session);
      if (id) answers.push(JSON.stringify(r.session.act(id).data));
      answers.push(JSON.stringify(r.session.endTurn().data));
    }
    const frames = await streamOfFinishedMatch(r.feed.liveUrl);
    const hay: Record<string, string> = {
      'what Doctrine was handed': handed.join('\n'),
      'the match record': JSON.stringify(r.host().recordWithOrders()),
      'the match order log': JSON.stringify(r.host().orderChanges()),
      '/record': (await httpRequest(r.feed.recordUrl)).body,
      'the stream': JSON.stringify(frames.map((f) => f.message)),
      'the answers of observe, legal_actions, list_missions, act, end_turn': answers.join('\n'),
    };
    expect(handed.length, 'setup: Doctrine played').toBeGreaterThan(10);
    expect(frames.length, 'setup: the stream held a whole match').toBeGreaterThan(20);
    return { found: Object.entries(hay).filter(([, text]) => text.includes(MARK)).map(([where]) => where), inGetOrders };
  }

  it('the marker is in get_orders and in no other place: not Doctrine\'s inputs, the match record, /record, the stream or any other tool', async () => {
    const run = await whereIsTheNote();
    expect(run.inGetOrders).toBe(1);
    expect(run.found).toStrictEqual([]);
  }, 60_000);

  it('PLANTED: the same scan finds a note handed to Doctrine, put on the stream, and put in the record', async () => {
    expect((await whereIsTheNote({ doctrine: true })).found).toStrictEqual(['what Doctrine was handed']);
    expect((await whereIsTheNote({ stream: true })).found).toStrictEqual(['the stream']);
    const rec = await whereIsTheNote({ record: true });
    expect(rec.found).toContain('/record');
    expect(rec.found).toContain('the stream');
  }, 120_000);

  it('Doctrine plays the same match with and without a note: the note changes no move (it is not an input)', async () => {
    const play = async (note: string | undefined): Promise<string> => {
      const r = await rig({ maxCycles: 2 });
      r.session.startMission('first-light');
      await r.put({ orders: DEFAULTS(), ...(note ? { note } : {}) });
      while (!r.host().result()) {
        const id = firstLegalId(r.session);
        if (id) r.session.act(id);
        r.session.endTurn();
      }
      return r.host().trueStateHash();
    };
    expect(await play(MARK)).toBe(await play(undefined));
  }, 60_000);
});

// ================================================================ the tools say so

describe('the tools describe the new orders and note to the agent', () => {
  it('get_orders and end_turn say what pending, note and ordersChanged mean, in one line each; the note is its human\'s direction within the game\'s rules', async () => {
    const r = await rig();
    const c = await connect(r.session);
    open.push(c);
    const tools = (await c.client.listTools()).tools;
    const desc = (n: string): string => tools.find((t) => t.name === n)!.description!;
    expect(desc('get_orders')).toBe(DESCRIPTIONS.get_orders);
    for (const word of ['pending', 'next turn starts', 'note', 'your commander', 'within the game\'s rules', 'human']) expect(desc('get_orders'), word).toContain(word);
    expect(desc('get_orders')).not.toMatch(/\n/);
    expect(desc('end_turn')).toContain('ordersChanged');
    expect(desc('end_turn')).not.toMatch(/\n/);
    // D-005 for the inputs is untouched: no tool takes text
    for (const t of tools) expect(JSON.stringify(t.inputSchema), t.name).not.toContain('"note"');
    // and over the protocol the note arrives as the object it is
    await call(c.client, 'start_mission', { mission: 'first-light' });
    await r.put({ orders: ARMOUR_ADVANCE(), note: 'Keep the lancers back.' });
    const got = await call(c.client, 'get_orders');
    expect(got.data.note).toStrictEqual({ text: 'Keep the lancers back.', from: 'your commander', at: AT });
    expect(got.data.pending).toStrictEqual(json(ARMOUR_ADVANCE()));
    expect(got.data.orders).toStrictEqual(json(DEFAULTS()));
    const e = await call(c.client, 'end_turn');
    expect(e.data.ordersChanged).toBe(true);
    expect((await call(c.client, 'get_orders')).data.orders).toStrictEqual(json(ARMOUR_ADVANCE()));
  }, 60_000);

  it('the time of a note defaults to now, as an ISO 8601 UTC string', async () => {
    const feed = await startFeed({ site: null });
    feeds.push(feed);
    const s = new AgentSession({ feed });
    s.startMission('first-light');
    await putOrders(feed.port, { orders: DEFAULTS(), note: 'now' });
    expect((s.getOrders().data.note as { at: string }).at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
