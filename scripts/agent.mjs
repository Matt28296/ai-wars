#!/usr/bin/env node
// `pnpm agent`: the game as an MCP server over stdio, for the player's own AI agent (A1, docs/AGENT.md).
//
// STDOUT CARRIES MCP MESSAGES ONLY. Nothing may print to it before the client's handshake or after it, so:
//   - every console.log / info / debug is sent to stderr (a dependency that logs cannot break the protocol);
//   - vite's own logger is set to errors only, and errors go to stderr.
// pnpm itself prints a banner on stdout when it runs a script, so a client should start this as `pnpm --silent --dir <path> agent`
// (or `node <path>/scripts/agent.mjs`); docs/AGENT.md gives the exact line.
//
// TypeScript is loaded through vite's SSR loader, as scripts/balance.mjs does, so there is no build step. The vite server is closed as
// soon as the modules are loaded: the game and the MCP server then run on their own.
//
// G17: the feed's port also serves the game's page (dist/), so a person has one link to open. If dist/index.html is missing or older than the
// newest file under src/, it is built IN THE BACKGROUND, after the client's handshake (the start itself stays under 5 s). The build goes to a
// staging folder and is renamed over dist/ only when complete, so a session that ends mid-build never leaves a half-written dist/. Vite's own
// dev server is never mounted for this (vite 5.4.11's dev server has a permissive CORS default, CVE-2025-24010): the page is the built files.
// AW_AGENT_NO_BUILD=1 turns the background build off (the tests that start this script do not need a page, and kill it mid-way).
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const toStderr = (...args) => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
const log = (line) => console.error(`[ascendant-wars] ${line}`);

/** Builds the game into a staging folder beside dist/ and swaps it in whole. Vite logs errors only, and to stderr (console.error). */
async function buildSite(dir) {
  const staging = join(ROOT, 'node_modules', '.cache', `aw-site-${process.pid}`);
  mkdirSync(dirname(staging), { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  // the session may end mid-build (the client closes stdin): a staging folder must not outlive the process
  process.once('exit', () => rmSync(staging, { recursive: true, force: true }));
  try {
    await build({
      root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'error', clearScreen: false,
      build: { outDir: staging, emptyOutDir: true, reportCompressedSize: false },
    });
    if (!existsSync(join(staging, 'index.html'))) throw new Error('the build wrote no index.html');
    rmSync(dir, { recursive: true, force: true });
    renameSync(staging, dir);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Calls `fn` once the client has finished its handshake (its `initialized` notification), or after `fallbackMs` if it never does. */
function afterHandshake(fn, fallbackMs) {
  let done = false;
  let tail = '';
  const go = () => {
    if (done) return;
    done = true;
    process.stdin.off('data', onData);
    clearTimeout(timer);
    // a turn of the event loop, so the handshake's own reply has left before the build starts
    setImmediate(fn);
  };
  const onData = (chunk) => {
    tail = (tail + chunk.toString('utf8')).slice(-4096);
    if (tail.includes('notifications/initialized')) go();
  };
  const timer = setTimeout(go, fallbackMs);
  timer.unref();
  process.stdin.on('data', onData);
}

async function main() {
  const started = Date.now();
  const vite = await createServer({
    root: ROOT, configFile: false, appType: 'custom', logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  let mod;
  let feedMod;
  try {
    mod = await vite.ssrLoadModule('/src/agent/main.ts');
    // the same module main.ts imports (one instance per vite server), so the site the feed serves is the one built here
    feedMod = await vite.ssrLoadModule('/src/agent/feed.ts');
  } finally {
    await vite.close();
  }
  const agent = await mod.runAgentServer(log);
  log(`started in ${Date.now() - started} ms`);

  const site = feedMod.defaultSite();
  if (process.env.AW_AGENT_NO_BUILD !== '1') afterHandshake(() => {
    if (!site.needsBuild()) return;
    log('building the game page in the background (dist/ is missing or out of date)');
    const t0 = Date.now();
    void site.startBuild(() => buildSite(site.dir)).then(() => {
      if (site.buildError) log(`the game page could not be built: ${site.buildError}`);
      else log(`the game page is built (${Date.now() - t0} ms)`);
    });
  }, 10_000);

  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    await agent.close();
    process.exit(0);
  };
  process.stdin.on('end', stop);
  process.stdin.on('close', stop);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(`[ascendant-wars] could not start: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
