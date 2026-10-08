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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const toStderr = (...args) => console.error(...args);
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
const log = (line) => console.error(`[ascendant-wars] ${line}`);

async function main() {
  const started = Date.now();
  const vite = await createServer({
    root: ROOT, configFile: false, appType: 'custom', logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  let mod;
  try {
    mod = await vite.ssrLoadModule('/src/agent/main.ts');
  } finally {
    await vite.close();
  }
  const agent = await mod.runAgentServer(log);
  log(`started in ${Date.now() - started} ms`);

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
