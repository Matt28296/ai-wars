// The page the feed also serves (G17): the built game, as static files, on the feed's own port. Real sockets on ephemeral ports and a real folder
// on disk. What must hold: the right file with the right content type (and nosniff); nothing outside dist/ is ever served (a dot segment, an
// encoded one, a backslash, a dotfile, a symlink that leaves the folder); a foreign Host header is refused on every route (DNS rebinding); only
// GET and HEAD are answered; and while the build is missing, stale or running, the page is a tiny self-refreshing "getting ready" page, never a
// half-written dist/. The traversal paths are checked against a NAIVE resolver that really does reach the planted file, so the refusal is
// shown to be a refusal and not a path that never led anywhere.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Site, defaultSite, startFeed } from './feed';
import type { Feed } from './feed';
import { httpRequest } from './testkit';

const PARENT_MARKER = 'PARENT-PACKAGE-MARKER-7f3a';
const OUTSIDE_MARKER = 'OUTSIDE-FILE-MARKER-91c2';
const INDEX = '<!doctype html><title>Ascendant Wars</title><div id="root"></div><script type="module" src="./assets/app-1.js"></script>\n';

let root = '';
let feed: Feed | null = null;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aw-site-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ secret: PARENT_MARKER }));
  writeFileSync(join(root, 'outside.txt'), OUTSIDE_MARKER);
  writeFileSync(join(root, 'src', 'a.ts'), 'export {};\n');
  writeFileSync(join(root, 'dist', 'index.html'), INDEX);
  writeFileSync(join(root, 'dist', 'assets', 'app-1.js'), 'console.error("hi");\n');
  writeFileSync(join(root, 'dist', 'assets', 'app.css'), 'body{margin:0}\n');
  writeFileSync(join(root, 'dist', 'assets', 'font.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]));
  writeFileSync(join(root, 'dist', 'assets', 'thing.xyz'), 'opaque');
  writeFileSync(join(root, 'dist', '.secret'), 'DOTFILE-MARKER');
  symlinkSync(join(root, 'outside.txt'), join(root, 'dist', 'link-out'));
  symlinkSync(root, join(root, 'dist', 'link-dir'));
  // The sources are older than the build, so the build is current.
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(root, 'src', 'a.ts'), old, old);
});
afterEach(async () => {
  await feed?.close();
  feed = null;
  rmSync(root, { recursive: true, force: true });
});

const site = (): Site => new Site({ dir: join(root, 'dist'), srcDir: join(root, 'src') });
async function serve(s: Site | null = site()): Promise<Feed> {
  feed = await startFeed({ site: s });
  return feed;
}
const at = (f: Feed, path: string): string => `http://127.0.0.1:${f.port}${path}`;

interface Raw { status: number; headers: IncomingHttpHeaders; body: string }
/** A request with the path exactly as given: `http.request(url)` would normalise `/../x` before sending it. */
function raw(f: Feed, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: f.port, path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

describe('serving the built game', () => {
  it('answers / and /index.html with the page, and an asset with its own content type; all with nosniff', async () => {
    const f = await serve();
    for (const path of ['/', '/index.html', '/?x=1']) {
      const r = await raw(f, path);
      expect(r.status, path).toBe(200);
      expect(r.body, path).toBe(INDEX);
      expect(r.headers['content-type'], path).toBe('text/html; charset=utf-8');
      expect(r.headers['x-content-type-options'], path).toBe('nosniff');
    }
    const types: [string, string, string][] = [
      ['/assets/app-1.js', 'text/javascript; charset=utf-8', 'console.error("hi");\n'],
      ['/assets/app.css', 'text/css; charset=utf-8', 'body{margin:0}\n'],
      ['/assets/font.woff2', 'font/woff2', 'wOF2\u0000\u0001\u0002\u0003'],
      ['/assets/thing.xyz', 'application/octet-stream', 'opaque'],
    ];
    for (const [path, type, body] of types) {
      const r = await raw(f, path);
      expect(r.status, path).toBe(200);
      expect(r.headers['content-type'], path).toBe(type);
      expect(r.headers['x-content-type-options'], path).toBe('nosniff');
      expect(r.body, path).toBe(body);
    }
  });

  it('answers HEAD with the headers of the GET and no body', async () => {
    const f = await serve();
    const get = await raw(f, '/assets/app-1.js');
    const head = await raw(f, '/assets/app-1.js', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-type']).toBe(get.headers['content-type']);
    expect(head.headers['content-length']).toBe(String(Buffer.byteLength(get.body)));
    expect((await raw(f, '/', { method: 'HEAD' })).body).toBe('');
  });

  it('an asset that is not there is 404, and a folder is not a file', async () => {
    const f = await serve();
    for (const path of ['/assets/missing.js', '/assets', '/assets/', '/nope']) expect((await raw(f, path)).status, path).toBe(404);
  });

  it('the page carries no CORS header: it is for its own origin only', async () => {
    const f = await serve();
    const r = await raw(f, '/', { headers: { Origin: 'http://localhost:3000' } });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('the feed is still the feed beside it: /live is an event stream, /record is 409, and the watch link is the page at the live route', async () => {
    const f = await serve();
    expect(f.watchUrl).toBe(`http://127.0.0.1:${f.port}/#/live`);
    expect((await raw(f, '/record')).status).toBe(409);
    const live = await new Promise<string>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: f.port, path: '/live' }, (res) => { resolve(String(res.headers['content-type'])); req.destroy(); });
      req.on('error', (e) => { if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e); });
      req.end();
    });
    expect(live).toContain('text/event-stream');
  });

  it('with no site the feed serves nothing else: / is 404 (the feed alone, as before G17)', async () => {
    const f = await serve(null);
    expect((await raw(f, '/')).status).toBe(404);
    expect((await raw(f, '/index.html')).status).toBe(404);
  });

  it('the default site is this checkout\'s own dist/ beside its src/', () => {
    const d = defaultSite();
    expect(d.dir.endsWith('/dist')).toBe(true);
    expect(readFileSync(join(d.srcDir, 'agent', 'feed.ts'), 'utf8')).toContain('class Site');
    expect(defaultSite()).toBe(d);
  });
});

describe('nothing outside dist/ is served', () => {
  /** What a server that joined the path onto dist/ and read it would answer: the planted files really are reachable that way. */
  const naive = (rel: string): string | null => {
    try { return readFileSync(join(root, 'dist', decodeURIComponent(rel))).toString(); } catch { return null; }
  };
  const attacks = [
    '/../package.json', '/../outside.txt', '/assets/../../package.json', '/assets/../../outside.txt',
    '/%2e%2e/package.json', '/%2E%2E/package.json', '/..%2fpackage.json', '/%2e%2e%2fpackage.json', '/assets/%2e%2e/%2e%2e/package.json',
    '/..%5cpackage.json', '/assets/..%5c..%5cpackage.json', '/assets/./../../package.json', '/assets/%00/../../package.json',
    '/link-out', '/link-dir/package.json', '/link-dir/outside.txt', '/.secret', '/assets/../.secret', '/%2esecret',
  ];

  it('the attack paths do reach the planted files when nothing guards the path (the known-bad twin of the refusal)', () => {
    expect(naive('/../package.json')).toContain(PARENT_MARKER);
    expect(naive('/assets/../../package.json')).toContain(PARENT_MARKER);
    expect(naive('/..%2fpackage.json')).toContain(PARENT_MARKER);
    expect(naive('/link-out')).toContain(OUTSIDE_MARKER);
    expect(naive('/link-dir/package.json')).toContain(PARENT_MARKER);
    expect(naive('/.secret')).toContain('DOTFILE-MARKER');
  });

  it('refuses every one of them: a 4xx, and never the content of a file outside dist/ (or a dotfile)', async () => {
    const f = await serve();
    for (const path of attacks) {
      const r = await raw(f, path);
      expect(r.status, path).toBeGreaterThanOrEqual(400);
      expect(r.status, path).toBeLessThan(500);
      for (const marker of [PARENT_MARKER, OUTSIDE_MARKER, 'DOTFILE-MARKER']) expect(r.body, `${path} leaked ${marker}`).not.toContain(marker);
    }
  });

  it('refuses a malformed escape instead of failing on it', async () => {
    const f = await serve();
    expect((await raw(f, '/%')).status).toBe(400);
    expect((await raw(f, '/%E0%A4%A')).status).toBe(400);
    expect((await raw(f, '/')).status, 'and still answers after them').toBe(200);
  });
});

describe('only this socket\'s own host names are answered', () => {
  it('refuses a foreign Host on the page, an asset, /live and /record (DNS rebinding), and answers 127.0.0.1 and localhost', async () => {
    const f = await serve();
    for (const h of ['evil.example', `evil.example:${f.port}`, '127.0.0.1', `127.0.0.1.evil.example:${f.port}`, '192.168.1.5:80', `[::1]:${f.port}`, `localhost.evil.example:${f.port}`]) {
      for (const path of ['/', '/index.html', '/assets/app-1.js', '/live', '/record']) {
        const r = await httpRequest(at(f, path), { headers: { Host: h } });
        expect(r.status, `${h} ${path}`).toBe(403);
        expect(r.body, `${h} ${path}`).not.toContain('Ascendant Wars');
      }
    }
    for (const h of [`127.0.0.1:${f.port}`, `localhost:${f.port}`]) {
      const r = await httpRequest(at(f, '/'), { headers: { Host: h } });
      expect(r.status, h).toBe(200);
      expect(r.body).toBe(INDEX);
    }
  });
});

describe('only GET and HEAD', () => {
  it('refuses every other method on the page and on an asset, with the allowed ones named, and the POST changes nothing', async () => {
    const f = await serve();
    const before = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'TRACE', 'OPTIONS']) {
      for (const path of ['/', '/assets/app-1.js', '/nope']) {
        const r = await raw(f, path, { method, body: method === 'POST' || method === 'PUT' || method === 'PATCH' ? '{"x":1}' : undefined, headers: { Origin: 'http://localhost:3000' } });
        expect(r.status, `${method} ${path}`).toBe(405);
        expect(r.headers.allow, `${method} ${path}`).toBe('GET, HEAD');
      }
    }
    expect(readFileSync(join(root, 'dist', 'index.html'), 'utf8')).toBe(before);
    expect((await raw(f, '/')).body).toBe(INDEX);
  });
});

describe('while the build is missing, stale or running', () => {
  const READY = /Getting the battle ready/;
  const REFRESH = /<meta http-equiv="refresh" content="2">/;

  it('needsBuild: missing is yes, newer than the sources is no, an older build than any source file is yes', () => {
    const s = site();
    expect(s.needsBuild()).toBe(false);
    const future = new Date(Date.now() + 60_000);
    mkdirSync(join(root, 'src', 'deep', 'er'), { recursive: true });
    writeFileSync(join(root, 'src', 'deep', 'er', 'new.ts'), 'export {};\n');
    utimesSync(join(root, 'src', 'deep', 'er', 'new.ts'), future, future);
    expect(s.needsBuild(), 'a source file deep under src/ is newer').toBe(true);
    rmSync(join(root, 'dist', 'index.html'));
    utimesSync(join(root, 'src', 'deep', 'er', 'new.ts'), new Date(0), new Date(0));
    expect(s.needsBuild(), 'no index.html').toBe(true);
  });

  it('answers the tiny refreshing page (503) for the page route, and 503 for the rest, while dist/index.html is missing', async () => {
    rmSync(join(root, 'dist', 'index.html'));
    const f = await serve();
    for (const path of ['/', '/index.html']) {
      const r = await raw(f, path);
      expect(r.status, path).toBe(503);
      expect(r.body, path).toMatch(READY);
      expect(r.body, path).toMatch(REFRESH);
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['retry-after']).toBe('2');
      expect(r.body.length, 'tiny').toBeLessThan(900);
    }
    expect((await raw(f, '/assets/app-1.js')).status).toBe(503);
  });

  it('an out-of-date build is not served either (a stale page against a newer feed would not match)', async () => {
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(root, 'src', 'a.ts'), future, future);
    const f = await serve();
    const r = await raw(f, '/');
    expect(r.status).toBe(503);
    expect(r.body).toMatch(READY);
    expect(r.body).not.toContain('<div id="root">');
  });

  it('a running build answers the same page, once only however often it is started; when it is done the page is served', async () => {
    rmSync(join(root, 'dist', 'index.html'));
    const s = site();
    const f = await serve(s);
    let calls = 0;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const build = async (): Promise<void> => {
      calls += 1;
      await gate;
      writeFileSync(join(root, 'dist', 'index.html'), INDEX);
    };
    const a = s.startBuild(build);
    const b = s.startBuild(build);
    expect(calls, 'the second start joined the first').toBeLessThanOrEqual(1);
    expect(s.state()).toBe('preparing');
    expect((await raw(f, '/')).status).toBe(503);
    finish();
    await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(s.state()).toBe('ready');
    const r = await raw(f, '/');
    expect(r.status).toBe(200);
    expect(r.body).toBe(INDEX);
  });

  it('a source file touched while a build ran does not leave the page on a refresh loop (a successful build is current)', async () => {
    const s = site();
    rmSync(join(root, 'dist', 'index.html'));
    const f = await serve(s);
    await s.startBuild(async () => {
      writeFileSync(join(root, 'dist', 'index.html'), INDEX);
      const later = new Date(Date.now() + 60_000);
      utimesSync(join(root, 'src', 'a.ts'), later, later);
    });
    expect(s.state()).toBe('ready');
    expect((await raw(f, '/')).status).toBe(200);
    // measured again on request, the sources really are newer: the claim is the build's, not the clock's
    expect(s.needsBuild()).toBe(true);
  });

  it('while a build runs the old page is not served even though a file is there', async () => {
    const s = site();
    const f = await serve(s);
    expect((await raw(f, '/')).status).toBe(200);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const run = s.startBuild(() => gate);
    expect((await raw(f, '/')).status).toBe(503);
    expect((await raw(f, '/assets/app-1.js')).status).toBe(503);
    finish();
    await run;
    expect((await raw(f, '/')).status).toBe(200);
  });

  it('a build that fails with nothing to serve says so (503, once, no refresh loop); with an older page there, that page is served', async () => {
    const s = site();
    rmSync(join(root, 'dist', 'index.html'));
    const f = await serve(s);
    await expect(s.startBuild(async () => { throw new Error('boom'); })).resolves.toBeUndefined();
    expect(s.buildError).toBe('boom');
    expect(s.state()).toBe('failed');
    const r = await raw(f, '/');
    expect(r.status).toBe(503);
    expect(r.body).toContain('could not be built');
    expect(r.body).not.toMatch(REFRESH);
    // a build that fails at once (before any await) is not left "running" forever
    await expect(s.startBuild(() => { throw new Error('sync'); })).resolves.toBeUndefined();
    expect(s.state()).toBe('failed');

    writeFileSync(join(root, 'dist', 'index.html'), INDEX);
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(root, 'src', 'a.ts'), future, future);
    await s.startBuild(async () => { throw new Error('boom again'); });
    expect(s.state()).toBe('ready');
    expect((await raw(f, '/')).body).toBe(INDEX);
  });
});
