#!/usr/bin/env node
// Balance runs: Doctrine vs Doctrine with DEFAULT_ORDERS on the six skirmish maps, N mirrored games per map (default 20), sides swapped
// between games, no turn limit so a stalemate shows up as "undecided at the cap". Heavy: it is NOT part of `pnpm test`; run it with
// `pnpm balance` (options: --games N, --cap CYCLES, --maps a,b, --commanders none, --verbose).
//
// Mirroring: the commanders of a game are rotated through the seats, so with two seats game 2k has commanders (A, B) in seats (0, 1)
// and game 2k+1 has (B, A); every commander sits in every seat equally often. `--commanders none` plays every seat without a commander
// instead (no passives, no powers): the cleanest read of the map and of who moves first. Each game's luck is seeded from its number,
// and each map is played with its own recommended fog and starting funds. Three- and four-player maps are free-for-all.
//
// Every result is tied to the code that produced it by a source hash: FNV-1a (64 bit) over the files src/game/**/*.ts and
// src/content/**/*.ts in sorted path order, each as `path NUL contents NUL`.
//
// TypeScript is loaded through vite's own SSR loader (vite is already a dependency), so nothing needs installing.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const out = { games: 20, cap: 40, maps: null, commanders: 'rotate', verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--games') out.games = Number(next());
    else if (a === '--cap') out.cap = Number(next());
    else if (a === '--maps') out.maps = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--commanders') out.commanders = next();
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!Number.isInteger(out.games) || out.games < 1) throw new Error('--games must be a whole number >= 1');
  if (!Number.isInteger(out.cap) || out.cap < 1) throw new Error('--cap must be a whole number >= 1');
  if (!['rotate', 'none'].includes(out.commanders)) throw new Error('--commanders must be rotate or none');
  return out;
}

// ---------------------------------------------------------------- the source hash

function listTs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listTs(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 64-bit FNV-1a over bytes, as 16 hex digits. */
export function fnv1a64(bytes) {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

export function sourceHash(root = ROOT) {
  const files = [...listTs(join(root, 'src/game')), ...listTs(join(root, 'src/content'))]
    .map((p) => relative(root, p).split(sep).join('/'))
    .sort();
  const parts = [];
  for (const f of files) parts.push(Buffer.from(`${f}\0`), readFileSync(join(root, f)), Buffer.from('\0'));
  return { hash: fnv1a64(Buffer.concat(parts)), files: files.length };
}

// ---------------------------------------------------------------- the games

function rosterOf(COMMANDERS) {
  return Object.values(COMMANDERS)
    .filter((c) => c.playable && c.faction)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function playersFor(map, game, roster, mode) {
  const n = map.players;
  const players = [];
  const pool = [];
  for (let i = 0; i < n; i++) pool.push(roster[(Math.floor(game / n) * n + i) % roster.length]);
  for (let seat = 0; seat < n; seat++) {
    const c = mode === 'none' ? null : pool[(seat + game) % n];
    players.push({
      faction: c ? c.faction : ['helion', 'tidewell', 'verdant', 'kestrel'][(seat + game) % 4],
      commander: c ? c.id : 'none',
      controller: 'ai',
      team: seat, // free-for-all; with two seats this is a plain duel
    });
  }
  return players;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: pnpm balance [-- --games N] [--cap CYCLES] [--maps a,b] [--commanders rotate|none] [--verbose]');
    return;
  }
  const server = await createServer({
    root: ROOT, configFile: false, appType: 'custom', logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { playDoctrine, DEFAULT_ORDERS } = await server.ssrLoadModule('/src/game/doctrine/index.ts');
    const { MAPS } = await server.ssrLoadModule('/src/content/maps.ts');
    const { COMMANDERS } = await server.ssrLoadModule('/src/content/commanders.ts');
    const roster = rosterOf(COMMANDERS);
    const ids = args.maps ?? Object.keys(MAPS);
    for (const id of ids) if (!MAPS[id]) throw new Error(`unknown map ${id} (maps: ${Object.keys(MAPS).join(', ')})`);

    const { hash, files } = sourceHash();
    const rows = [];
    const started = Date.now();
    for (const id of ids) {
      const map = MAPS[id];
      const rec = map.recommended ?? {};
      const wins = new Array(map.players).fill(0);
      let undecided = 0;
      const cycles = [];
      const t0 = Date.now();
      for (let g = 0; g < args.games; g++) {
        const setup = {
          map, players: playersFor(map, g, roster, args.commanders), fog: !!rec.fog, weather: rec.weather ?? 'clear',
          startFunds: rec.startFunds ?? 0, seed: 1000 + g,
        };
        const r = playDoctrine(setup, DEFAULT_ORDERS, { maxCycles: args.cap });
        cycles.push(r.cycles);
        if (r.winnerTeam === null) undecided++;
        else wins[r.winnerTeam]++; // team = seat here
        if (args.verbose) console.log(`  ${id} game ${g}: ${r.winnerTeam === null ? 'undecided' : `seat ${r.winnerTeam} won`} in ${r.cycles} cycles, ${r.actions.length} actions`);
      }
      rows.push({ id, games: args.games, wins, undecided, mean: cycles.reduce((a, b) => a + b, 0) / cycles.length, median: median(cycles), secs: (Date.now() - t0) / 1000 });
    }

    const w = (s, n) => String(s).padEnd(n);
    const r = (s, n) => String(s).padStart(n);
    console.log(`Doctrine vs Doctrine, DEFAULT_ORDERS (posture ${DEFAULT_ORDERS.posture}), cap ${args.cap} cycles, commanders ${args.commanders}, ${args.games} games per map`);
    console.log(`${w('map', 18)}${r('games', 6)}${r('side-0 wins', 13)}${r('side-1 wins', 13)}${r('side-2 wins', 13)}${r('side-3 wins', 13)}${r('undecided', 11)}${r('mean cycles', 13)}${r('secs', 7)}`);
    for (const row of rows) {
      const side = (i) => (i < row.wins.length ? row.wins[i] : '-');
      console.log(`${w(row.id, 18)}${r(row.games, 6)}${r(side(0), 13)}${r(side(1), 13)}${r(side(2), 13)}${r(side(3), 13)}${r(row.undecided, 11)}${r(row.mean.toFixed(1), 13)}${r(row.secs.toFixed(1), 7)}`);
    }
    console.log(`source hash ${hash} (FNV-1a 64 over ${files} files in src/game and src/content), total ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await server.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`balance: ${err.stack ?? err.message}`);
    process.exit(1);
  });
}
