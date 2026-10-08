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
// G17: the same port also serves the built game (dist/), so the one link the agent hands its person is `http://127.0.0.1:<port>/#/live`, and the page
// reads /live from the same origin. It is a static file server and nothing more (class Site): GET and HEAD only, paths resolved inside dist/ (no
// traversal, no symlink escape), nosniff and the right content type. Vite's dev middleware is NOT mounted (vite 5.4.11's dev server has a
// permissive CORS default, CVE-2025-24010). Until dist/ is built, the page answers a tiny "Getting the battle ready" page that refreshes itself.
//
// Nothing else is served and nothing can be written: other methods are refused, other paths are 404.
// Bound to 127.0.0.1 only, on a free port the OS picks. Two checks against a web page that is not ours:
//   - CORS: Access-Control-Allow-Origin is sent only to http://127.0.0.1:* and http://localhost:* origins (echoed, with Vary: Origin). Any other
//     Origin gets the response with no CORS header, so a browser will not let that page read it.
//   - Host: a request whose Host header is not 127.0.0.1:<port> or localhost:<port> is refused (DNS rebinding makes a hostile name resolve
//     to this socket; the Host header still names the hostile name).
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  /** G17: 'http://127.0.0.1:<port>/#/live', the page a person opens to watch (served by this same port). */
  readonly watchUrl: string;
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

// ---------------------------------------------------------------- the game's page (G17)

/** The content types of what a vite build writes, and a little more. Anything else is served as an opaque download. */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

const GETTING_READY = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<meta http-equiv="refresh" content="2"><title>Ascendant Wars</title>'
  + '<style>html,body{margin:0;height:100%;background:#0a0e14;color:#9aa8ba}body{display:grid;place-items:center;font:500 14px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}</style>'
  + '</head><body><p role="status">Getting the battle ready</p></body></html>\n';
const COULD_NOT_BUILD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ascendant Wars</title>'
  + '<style>html,body{margin:0;height:100%;background:#0a0e14;color:#9aa8ba}body{display:grid;place-items:center;font:500 14px/1.5 system-ui,sans-serif;text-align:center}code{color:#e8edf3}</style>'
  + '</head><body><p role="alert">The game could not be built.<br>Run <code>pnpm build</code> in the game folder.</p></body></html>\n';

export interface SiteOptions {
  /** The built game: the folder that holds index.html. Nothing outside it is ever served. */
  dir: string;
  /** The sources it is built from. The build is out of date when a file under it is newer than dist/index.html. */
  srcDir: string;
}

/** The newest modification time (ms) of any file under `dir`, or 0 when there is none. */
function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { try { newest = Math.max(newest, statSync(p).mtimeMs); } catch { /* gone while we looked */ } }
    }
  };
  walk(dir);
  return newest;
}

/**
 * The built game, served as static files (G17). Whether it needs building is a question of two timestamps; building it is somebody else's job
 * (`startBuild` is handed the function that does it, so this file needs no bundler). While it is not ready the page route answers a tiny
 * self-refreshing page, and every other route answers 503: a half-written dist/ is never served.
 */
export class Site {
  readonly dir: string;
  readonly srcDir: string;
  private building: Promise<void> | null = null;
  private failure: string | null = null;
  private fresh: boolean | null = null;

  constructor(opts: SiteOptions) {
    this.dir = resolve(opts.dir);
    this.srcDir = resolve(opts.srcDir);
  }

  private indexMtime(): number | null {
    try {
      const st = statSync(join(this.dir, 'index.html'));
      return st.isFile() ? st.mtimeMs : null;
    } catch {
      return null;
    }
  }

  /** True when dist/index.html is missing or older than the newest file under the sources. Measured now. */
  needsBuild(): boolean {
    const built = this.indexMtime();
    this.fresh = built !== null && built >= newestMtime(this.srcDir);
    return !this.fresh;
  }

  /** 'ready': serving. 'preparing': missing, out of date or being built. 'failed': the last build failed and there is nothing to serve. */
  state(): 'ready' | 'preparing' | 'failed' {
    if (this.building) return 'preparing';
    if (this.fresh === null) this.needsBuild();
    if (this.fresh) return 'ready';
    // A build that failed leaves what was there: an out-of-date page is better than none, and the person is not left on a refresh loop.
    if (this.failure !== null) return this.indexMtime() !== null ? 'ready' : 'failed';
    return 'preparing';
  }

  /** The last build's error, or null. */
  get buildError(): string | null {
    return this.failure;
  }

  /**
   * Runs `build` in the background unless one is already running. Never rejects: a failure is kept (`buildError`) and the promise resolves.
   * The function must leave a complete dist/ behind or none (the agent builds beside it and renames).
   */
  startBuild(build: () => Promise<void>): Promise<void> {
    if (this.building) return this.building;
    this.failure = null;
    // Started from a promise, not run in place: a build that fails at once must not finish before `building` is set.
    const run = Promise.resolve().then(build).catch((err: unknown) => {
      this.failure = err instanceof Error ? err.message : String(err);
    }).finally(() => {
      // A build that succeeded is current: a source file touched while it ran must not leave the page on a refresh loop that nothing would end.
      this.fresh = this.failure === null ? true : null;
      this.building = null;
    });
    this.building = run;
    return run;
  }

  /** Answers one request that is not the feed's: the page, an asset, or a refusal. */
  async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const send = (status: number, type: string, body: string, extra: Record<string, string> = {}): void => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const plain = (status: number, text: string, extra: Record<string, string> = {}): void => send(status, 'text/plain; charset=utf-8', `${text}\n`, extra);
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405, 'method not allowed', { Allow: 'GET, HEAD' });
      let rel: string;
      try {
        rel = decodeURIComponent((req.url ?? '/').split(/[?#]/, 1)[0]);
      } catch {
        return plain(400, 'bad request');
      }
      // The page route is `/` and `/index.html`; everything else is a file under dist/ or nothing. A path with a dot segment, a backslash, a NUL,
      // or a dotfile in it is refused by name (the lexical check below would catch the first; the others have no business here).
      const parts = rel.split('/');
      if (!rel.startsWith('/') || rel.includes('\0') || rel.includes('\\') || parts.some((p) => p === '..' || p === '.' || (p.startsWith('.') && p !== ''))) return plain(404, 'not found');
      const page = rel === '/' || rel === '/index.html';
      const state = this.state();
      if (state === 'failed') return send(503, 'text/html; charset=utf-8', COULD_NOT_BUILD);
      if (state === 'preparing') {
        return page ? send(503, 'text/html; charset=utf-8', GETTING_READY, { 'Retry-After': '2' }) : plain(503, 'not ready', { 'Retry-After': '2' });
      }
      const base = await realpath(this.dir);
      const target = resolve(base, `.${page ? '/index.html' : rel}`);
      if (target !== base && !target.startsWith(base + sep)) return plain(404, 'not found');
      let real: string;
      try {
        real = await realpath(target);
      } catch {
        return plain(404, 'not found');
      }
      // A symlink inside dist/ that leads out of it is not a file of the game.
      if (!real.startsWith(base + sep)) return plain(404, 'not found');
      const st = await stat(real);
      if (!st.isFile()) return plain(404, 'not found');
      res.writeHead(200, {
        'Content-Type': TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': String(st.size),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return void res.end();
      // pipeline closes the file if the browser goes away mid-way, and the response if the file fails
      pipeline(createReadStream(real), res, () => {});
    } catch {
      if (!res.headersSent) plain(500, 'server error');
      else res.destroy();
    }
  }
}

let shared: Site | undefined;
/** The game this checkout builds: dist/ beside src/. One per process, so whoever starts the build and the feed that serves it see the same state. */
export function defaultSite(): Site {
  shared ??= new Site({ dir: fileURLToPath(new URL('../../dist', import.meta.url)), srcDir: fileURLToPath(new URL('../', import.meta.url)) });
  return shared;
}

export interface FeedOptions {
  /** The built game to serve beside the feed. Default: this checkout's own (`defaultSite`). `null` serves the feed alone. */
  site?: Site | null;
}

const frame = (m: LiveMessage): string => `event: ${m.type}\ndata: ${JSON.stringify(m)}\n\n`;

/** Starts the feed on a free port of 127.0.0.1. Resolves when it is listening. */
export async function startFeed(opts: FeedOptions = {}): Promise<Feed> {
  const site = opts.site === undefined ? defaultSite() : opts.site;
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
    if (path !== '/live' && path !== '/record') {
      if (!site) return plain(res, 404, 'not found');
      void site.serve(req, res);
      return;
    }
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
    watchUrl: `http://${FEED_HOST}:${port}/#/live`,
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
