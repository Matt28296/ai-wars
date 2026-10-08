// The live feed (A1, A1b): the match as it happens, for the browser's battle screen (G17).
//
//   GET /live     Server-Sent Events. `setup`, then every step in order starting at step 0 (`step`), then `result`, then `record`.
//                 A viewer that connects late is sent everything so far first, so every stream starts with `setup`. Starting a mission again
//                 begins a new stream (`match` + 1).
//   GET /record   the whole truth (setup and every action) as one JSON object: 409 until the match is over, then 200.
//
// D-016, WHILE THE MATCH RUNS: the feed is the player's own view and nothing else (src/agent/live.ts). Claude Code agents have a shell, so
// anything this port serves is something the agent can read. The feed is never GIVEN the truth until the match is over: `begin` and `step`
// take only what the agent's side sees, and `finish` is the first call that carries the full record. Until then there is nothing in this
// process's feed to leak, and /record answers 409.
//
// Nothing else is served and nothing can be written: other methods are refused, other paths are 404.
// Bound to 127.0.0.1 only, on a free port the OS picks. Two checks against a web page that is not ours:
//   - CORS: Access-Control-Allow-Origin is sent only to http://127.0.0.1:* and http://localhost:* origins (echoed, with Vary: Origin). Any other
//     Origin gets the response with no CORS header, so a browser will not let that page read it.
//   - Host: a request whose Host header is not 127.0.0.1:<port> or localhost:<port> is refused (DNS rebinding makes a hostile name resolve
//     to this socket; the Host header still names the hostile name).
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Action, CreateGameOptions, PlayerIndex } from '../game/aw';
import type { LiveMessage, LiveRecord, LiveStep } from './live';
import type { MatchResult } from './match';

export const FEED_HOST = '127.0.0.1';
/** The origins a browser page may read the feed from: the local game (vite dev or preview, or the built game served locally). */
export const ALLOWED_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/;
const PING_MS = 15_000;

export interface Feed {
  /** 'http://127.0.0.1:<port>/live' */
  readonly liveUrl: string;
  /** 'http://127.0.0.1:<port>/record' */
  readonly recordUrl: string;
  readonly port: number;
  /** The socket's own address as the OS reports it: always 127.0.0.1, IPv4. */
  readonly bound: { address: string; family: string; port: number };
  /** A new match: clears the stream and tells every viewer (they get a fresh `setup`, then `first`). Only what the agent's side sees. */
  begin(info: { mission: string; seat: PlayerIndex; cycleCap: number }, first: LiveStep): void;
  /** The next step, as the agent's side sees it. */
  step(step: LiveStep): void;
  /** The match is over: sends `result`, then the whole record, and from now on /record answers it. The first call that carries the truth. */
  finish(result: MatchResult, record: { setup: CreateGameOptions; actions: Action[] }): void;
  /** The whole record once the match is over; null while it runs or before any match. */
  record(): LiveRecord | null;
  close(): Promise<void>;
}

const frame = (m: LiveMessage): string => `event: ${m.type}\ndata: ${JSON.stringify(m)}\n\n`;

/** Starts the feed on a free port of 127.0.0.1. Resolves when it is listening. */
export async function startFeed(): Promise<Feed> {
  let match = 0;
  let current: { mission: string; seat: PlayerIndex; cycleCap: number } | null = null;
  let over: LiveRecord | null = null;
  let steps = 0;
  let frames: string[] = [];
  const clients = new Set<ServerResponse>();
  let port = 0;

  const hostOk = (req: IncomingMessage): boolean => {
    const h = req.headers.host;
    return h === `${FEED_HOST}:${port}` || h === `localhost:${port}`;
  };
  const corsHeaders = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && ALLOWED_ORIGIN.test(origin)) return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    return { Vary: 'Origin' };
  };
  const plain = (res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(`${text}\n`);
  };

  const server: Server = createServer((req, res) => {
    if (!hostOk(req)) return plain(res, 403, 'forbidden');
    let path: string;
    try {
      path = new URL(req.url ?? '/', `http://${FEED_HOST}:${port}`).pathname;
    } catch {
      return plain(res, 400, 'bad request');
    }
    if (path !== '/live' && path !== '/record') return plain(res, 404, 'not found');
    const cors = corsHeaders(req);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Last-Event-ID, Cache-Control', Allow: 'GET, OPTIONS' });
      return void res.end();
    }
    if (req.method !== 'GET') return plain(res, 405, 'method not allowed', { ...cors, Allow: 'GET, OPTIONS' });

    if (path === '/record') {
      const json = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors };
      if (!over) {
        // The whole truth is not served while the match runs (nor before any match): the feed does not even hold it yet.
        res.writeHead(409, json);
        return void res.end(JSON.stringify({ error: 'match-not-over', message: 'The whole record is served when the match is over.' }));
      }
      res.writeHead(200, json);
      return void res.end(JSON.stringify(over));
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...cors });
    res.write('retry: 2000\n\n');
    for (const f of frames) res.write(f);
    clients.add(res);
    req.on('close', () => { clients.delete(res); });
  });

  const publish = (m: LiveMessage): void => {
    const f = frame(m);
    frames.push(f);
    for (const c of clients) c.write(f);
  };

  const ping = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, PING_MS);
  ping.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, FEED_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const bound = server.address() as AddressInfo;
  port = bound.port;

  return {
    liveUrl: `http://${FEED_HOST}:${port}/live`,
    recordUrl: `http://${FEED_HOST}:${port}/record`,
    port,
    bound: { address: bound.address, family: String(bound.family), port: bound.port },
    begin(info, first) {
      frames = [];
      over = null;
      steps = 0;
      match += 1;
      current = { mission: info.mission, seat: info.seat, cycleCap: info.cycleCap };
      publish({ type: 'setup', match, mission: info.mission, seat: info.seat, cycleCap: info.cycleCap });
      publish({ type: 'step', match, step: first });
      steps = 1;
    },
    step(step) {
      if (!current || over) return;
      publish({ type: 'step', match, step });
      steps += 1;
    },
    finish(result, record) {
      if (!current || over) return;
      over = { match, mission: current.mission, seat: current.seat, cycleCap: current.cycleCap, setup: record.setup, actions: structuredClone(record.actions), result: { ...result } };
      publish({ type: 'result', match, steps, result: over.result });
      publish({ type: 'record', match, record: over });
    },
    record: () => (over ? structuredClone(over) : null),
    close() {
      clearInterval(ping);
      for (const c of clients) c.end();
      clients.clear();
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
