// The live feed (A1, A1b): bound to 127.0.0.1 on a free port, a fog-honest stream while the match runs, the whole record only when it is over,
// CORS for the local game origins only, and nothing writable. Real sockets on ephemeral ports. The steps it sends are compared with
// `viewTimeline(recordMatch(...), seat 0)`, the engine's own player view; the fog oracle over the feed is in server.test.ts.
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { MISSIONS } from '../content/missions';
import { stateHash } from '../game/aw/replay';
import { recordMatch, viewTimeline } from '../ui/watch/timeline';
import { ALLOWED_ORIGIN, startFeed } from './feed';
import type { Feed } from './feed';
import type { LiveRecord, LiveResultMessage, LiveSetupMessage, LiveStepMessage } from './live';
import { AgentMatch } from './match';
import { AgentSession } from './tools';
import { httpRequest, openSse } from './testkit';
import type { SseStream } from './testkit';

const FIRST_LIGHT = MISSIONS[0];
const UNDER_CANOPY = MISSIONS.find((m) => m.id === 'under-canopy')!;

let feed: Feed | null = null;
const streams: SseStream[] = [];
afterEach(async () => {
  for (const s of streams.splice(0)) s.close();
  await feed?.close();
  feed = null;
});

// These tests are about the feed. The page it also serves (G17) has its own tests (feedSite.test.ts), so here the feed runs alone.
async function fresh(): Promise<Feed> {
  feed = await startFeed({ site: null });
  return feed;
}
const open = async (url: string): Promise<SseStream> => {
  const s = await openSse(url);
  streams.push(s);
  return s;
};
const json = <T,>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;
const kinds = (st: SseStream): string[] => st.frames.map((f) => f.event);

/** A session wired to the feed, and the match it started. */
function play(f: Feed, maxCycles?: number): { s: AgentSession; host: () => AgentMatch } {
  let host!: AgentMatch;
  const s = new AgentSession({ feed: f, makeHost: (m) => (host = new AgentMatch(m, maxCycles ? { maxCycles } : {})) });
  return { s, host: () => host };
}
/** The first legal action, or the end of the turn when none is left (the same walk as the tool tests). */
function step(s: AgentSession): void {
  const l = s.legalActions().data as { units: { actions: { id: string }[] }[]; builds: { id: string }[] };
  const id = [...l.units.flatMap((u) => u.actions.map((a) => a.id)), ...l.builds.map((b) => b.id)][0];
  if (id) s.act(id);
  else s.endTurn();
}

describe('where the feed listens', () => {
  it('is bound to 127.0.0.1 (IPv4 loopback) on a free port, and says where', async () => {
    const f = await fresh();
    expect(f.bound.address).toBe('127.0.0.1');
    expect(f.bound.family).toMatch(/^(IPv4|4)$/);
    expect(f.port).toBeGreaterThan(0);
    expect(f.bound.port).toBe(f.port);
    expect(f.liveUrl).toBe(`http://127.0.0.1:${f.port}/live`);
    expect(f.recordUrl).toBe(`http://127.0.0.1:${f.port}/record`);
  });

  it('picks a different port for each start (it is not a fixed number)', async () => {
    const a = await startFeed();
    const b = await startFeed();
    try {
      expect(a.port).not.toBe(b.port);
    } finally {
      await a.close();
      await b.close();
    }
  });
});

describe('/live while the match runs shows only the player\'s own view', () => {
  it('sends the setup with public facts only (no map, no units, no actions), then step 0', async () => {
    const f = await fresh();
    const live = await open(f.liveUrl);
    const { s } = play(f);
    s.startMission('under-canopy');
    await live.waitFor(2);
    const setup = live.frames[0].message as LiveSetupMessage;
    expect(Object.keys(setup).sort()).toStrictEqual(['cycleCap', 'match', 'mission', 'seat', 'type']);
    expect(setup).toMatchObject({ type: 'setup', match: 1, mission: 'under-canopy', seat: 0, cycleCap: 30 });
    const first = (live.frames[1].message as LiveStepMessage).step;
    expect(first).toMatchObject({ index: 0, action: null, events: [] });
    expect(first.powerUses).toStrictEqual(new Array<number>(first.frame.players.length).fill(0));
    expect(first.frame.viewer).toBe(0);
  });

  it('the steps are exactly the engine\'s player view: viewTimeline(recordMatch(...), seat 0), with the action kept only for the seat\'s own turns', async () => {
    for (const [mission, id] of [[FIRST_LIGHT, 'first-light'], [UNDER_CANOPY, 'under-canopy']] as const) {
      const f = await startFeed();
      try {
        const { s, host } = play(f, 3);
        s.startMission(id);
        while (!host().result()) step(s);
        const rec = host().record();
        const truth = recordMatch(rec.setup, rec.actions);
        const view = viewTimeline(truth, 0);
        expect(view.steps.length).toBe(rec.actions.length + 1);
        // Everything but `action` is the timeline's step; `action` is the timeline's only where seat 0 acted.
        const expected = view.steps.map((st, i) => ({ ...st, action: i > 0 && truth.states[i - 1].current === 0 ? st.action : null }));
        const live = await openSse(f.liveUrl);
        streams.push(live);
        await live.waitFor(1 + expected.length + 2);
        const sent = live.frames.filter((x) => x.event === 'step').map((x) => (x.message as LiveStepMessage).step);
        expect(sent, mission.id).toStrictEqual(json(expected));
        // the planted differences: the other seats' actions exist and are withheld, and seat 0's are sent
        const others = view.steps.filter((st, i) => i > 0 && truth.states[i - 1].current !== 0 && st.action);
        const mine = view.steps.filter((_, i) => i > 0 && truth.states[i - 1].current === 0);
        expect(others.length, `${mission.id}: setup: other seats acted`).toBeGreaterThan(0);
        expect(mine.length, `${mission.id}: setup: seat 0 acted`).toBeGreaterThan(0);
        expect(sent.filter((_, i) => i > 0 && truth.states[i - 1].current !== 0).every((st) => st.action === null)).toBe(true);
        expect(sent.filter((_, i) => i > 0 && truth.states[i - 1].current === 0).every((st) => st.action !== null)).toBe(true);
      } finally {
        for (const x of streams.splice(0)) x.close();
        await f.close();
      }
    }
  });

  it('streams setup, steps 0..n in order, then the result, then the record; /record is 409 until then and the whole truth after', async () => {
    const f = await fresh();
    const live = await open(f.liveUrl);
    const { s, host } = play(f, 2);
    s.startMission('first-light');
    // mid-game
    for (let i = 0; i < 6; i++) step(s);
    expect(host().result()).toBeNull();
    const midSteps = host().record().actions.length + 1;
    const mid = await httpRequest(f.recordUrl);
    expect(mid.status).toBe(409);
    expect(JSON.parse(mid.body)).toMatchObject({ error: 'match-not-over' });
    expect(mid.body).not.toContain('"setup"');
    expect(mid.body).not.toContain('"actions"');
    expect(f.record()).toBeNull();
    await live.waitFor(1 + midSteps);
    expect(kinds(live)).toStrictEqual(['setup', ...new Array<string>(midSteps).fill('step')]);
    // to the end
    while (!host().result()) step(s);
    const rec = host().record();
    const all = 1 + (rec.actions.length + 1) + 2;
    await live.waitFor(all);
    expect(kinds(live)).toStrictEqual(['setup', ...new Array<string>(rec.actions.length + 1).fill('step'), 'result', 'record']);
    live.frames.slice(1, -2).forEach((fr, i) => expect((fr.message as LiveStepMessage).step.index, 'steps are in order').toBe(i));
    const result = live.frames[all - 2].message as LiveResultMessage;
    expect(result).toMatchObject({ type: 'result', match: 1, steps: rec.actions.length + 1, result: rec.result });
    // the record: 200 now, the same on /record and on the stream, and exactly what recordMatch takes
    const r = await httpRequest(f.recordUrl);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body) as LiveRecord;
    expect(body).toStrictEqual({ match: 1, mission: 'first-light', seat: 0, cycleCap: 2, setup: json(rec.setup), actions: json(rec.actions), result: rec.result });
    expect((live.frames[all - 1].message as { record: unknown }).record).toStrictEqual(body);
    expect(f.record()).toStrictEqual(body);
    const replayed = recordMatch(body.setup, body.actions);
    expect(stateHash(replayed.states[replayed.states.length - 1])).toBe(host().trueStateHash());
    const short = recordMatch(body.setup, body.actions.slice(0, -1));
    expect(stateHash(short.states[short.states.length - 1]), 'planted: a record missing its last action ends elsewhere').not.toBe(host().trueStateHash());
  });

  it('a viewer that connects mid-game gets the setup and the player-view steps so far, no record, and then what comes next', async () => {
    const f = await fresh();
    const { s, host } = play(f);
    s.startMission('under-canopy');
    for (let i = 0; i < 12; i++) step(s);
    const n = host().record().actions.length;
    const late = await open(f.liveUrl);
    await late.waitFor(1 + n + 1);
    expect(kinds(late)).toStrictEqual(['setup', ...new Array<string>(n + 1).fill('step')]);
    // nothing in what it was sent is the truth: no setup/map, no other seat's action, no raw record
    const text = JSON.stringify(late.frames);
    expect(text).not.toContain('"actions"');
    expect(text).not.toContain('"record"');
    expect(text).not.toContain('"rawEvents"');
    const truth = recordMatch(host().setup, host().record().actions);
    late.frames.slice(1).forEach((fr, i) => {
      const st = (fr.message as LiveStepMessage).step;
      if (i > 0 && truth.states[i - 1].current !== 0) expect(st.action, `step ${i}`).toBeNull();
    });
    step(s);
    await late.waitFor(1 + n + 2);
    expect(late.frames[late.frames.length - 1].message).toMatchObject({ type: 'step', step: { index: n + 1 } });
  });

  it('starting a mission again begins a new stream; the old record is gone and /record is 409 again', async () => {
    const f = await fresh();
    const live = await open(f.liveUrl);
    const { s, host } = play(f, 1);
    s.startMission('first-light');
    while (!host().result()) step(s);
    expect((await httpRequest(f.recordUrl)).status).toBe(200);
    s.startMission('calder-spire');
    expect((await httpRequest(f.recordUrl)).status).toBe(409);
    expect(f.record()).toBeNull();
    const fresher = await open(f.liveUrl);
    await fresher.waitFor(2);
    expect(kinds(fresher)).toStrictEqual(['setup', 'step']);
    expect(fresher.frames[0].message).toMatchObject({ match: 2, mission: 'calder-spire' });
    await live.waitFor(1);
    expect(kinds(live).filter((k) => k === 'setup')).toHaveLength(2);
  });

  it('ignores a step or a finish when no match is running or the match is over', async () => {
    const f = await fresh();
    const { s, host } = play(f, 1);
    f.step({ index: 5, action: null, frame: {} as never, events: [], powerUses: [] });
    s.startMission('first-light');
    const live = await open(f.liveUrl);
    await live.waitFor(2);
    while (!host().result()) step(s);
    await live.waitFor(1 + host().record().actions.length + 1 + 2);
    const n = live.frames.length;
    f.step({ index: 99, action: null, frame: {} as never, events: [], powerUses: [] });
    f.finish(host().result()!, host().record());
    await new Promise((r) => setTimeout(r, 30));
    expect(live.frames).toHaveLength(n);
  });
});

describe('CORS: only the local game origins may read it', () => {
  it('echoes an http://127.0.0.1:* or http://localhost:* origin, on /record and /live', async () => {
    const f = await fresh();
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:3000', 'http://localhost', 'http://127.0.0.1:8080']) {
      const r = await httpRequest(f.recordUrl, { headers: { Origin: origin } });
      expect(r.headers['access-control-allow-origin'], origin).toBe(origin);
      expect(r.headers.vary, origin).toContain('Origin');
      const live = await new Promise<IncomingHttpHeaders>((resolve, reject) => {
        const req = request(f.liveUrl, { headers: { Origin: origin } }, (res) => { resolve(res.headers); req.destroy(); });
        req.on('error', (e) => { if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e); });
        req.end();
      });
      expect(live['access-control-allow-origin'], `${origin} on /live`).toBe(origin);
    }
  });

  it('sends NO CORS header to any other origin (known-bad origins)', async () => {
    const f = await fresh();
    const bad = [
      'http://evil.example', 'https://evil.example', 'http://127.0.0.1.evil.example', 'http://localhost.evil.example:3000',
      'https://127.0.0.1:5173', 'https://localhost', 'http://127.0.0.2:5173', 'http://[::1]:5173', 'null', 'http://127.0.0.1@evil.example',
      'http://evil.example/http://127.0.0.1', 'http://localhost:99999999', 'file://', '*',
    ];
    for (const origin of bad) {
      const r = await httpRequest(f.recordUrl, { headers: { Origin: origin } });
      expect(r.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
    const noOrigin = await httpRequest(f.recordUrl);
    expect(noOrigin.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('the origin pattern accepts the local game and refuses look-alikes', () => {
    for (const ok of ['http://127.0.0.1:5173', 'http://localhost:4173', 'http://localhost']) expect(ALLOWED_ORIGIN.test(ok), ok).toBe(true);
    for (const no of ['http://127.0.0.1.evil.example', 'http://evil.example', 'https://localhost:3000', 'http://localhost:3000.evil.example', 'http://xlocalhost:3000', ' http://localhost:3000']) {
      expect(ALLOWED_ORIGIN.test(no), no).toBe(false);
    }
  });

  it('answers a preflight only for an allowed origin, and only for its two routes', async () => {
    const f = await fresh();
    const ok = await httpRequest(f.recordUrl, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } });
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-methods']).toBe('GET, OPTIONS');
    const no = await httpRequest(f.recordUrl, { method: 'OPTIONS', headers: { Origin: 'http://evil.example' } });
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
    expect((await httpRequest(`http://127.0.0.1:${f.port}/other`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:3000' } })).status).toBe(404);
  });
});

describe('nothing else is served, and nothing can be written', () => {
  it('has two routes: every other path is 404', async () => {
    const f = await fresh();
    for (const path of ['/', '/index.html', '/record/', '/record/x', '/live/x', '/state', '/observe', '/act', '/../etc/passwd', '/%2e%2e/secret', '/RECORD']) {
      const r = await httpRequest(`http://127.0.0.1:${f.port}${path}`);
      expect(r.status, path).toBe(404);
    }
  });

  it('refuses every method but GET and the preflight (no write routes)', async () => {
    const f = await fresh();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'TRACE']) {
      for (const url of [f.recordUrl, f.liveUrl]) {
        const r = await httpRequest(url, { method });
        expect(r.status, `${method} ${url}`).toBe(405);
      }
    }
    // and a POST changed nothing
    expect((await httpRequest(f.recordUrl)).status).toBe(409);
  });

  it('refuses a request whose Host is not this socket (DNS rebinding), and answers the real one', async () => {
    const f = await fresh();
    for (const h of ['evil.example', `evil.example:${f.port}`, '127.0.0.1', `127.0.0.1.evil.example:${f.port}`, '192.168.1.5:80']) {
      const r = await httpRequest(f.recordUrl, { headers: { Host: h } });
      expect(r.status, h).toBe(403);
    }
    // the real host names get the feed's own answer (409: no match yet), not the 403
    expect((await httpRequest(f.recordUrl, { headers: { Host: `localhost:${f.port}` } })).status).toBe(409);
    expect((await httpRequest(f.recordUrl)).status).toBe(409);
  });
});
