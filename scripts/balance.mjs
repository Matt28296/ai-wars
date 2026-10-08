#!/usr/bin/env node
// Balance runs: Doctrine vs Doctrine with DEFAULT_ORDERS on the six skirmish maps, N mirrored games per map (default 20), sides swapped
// between games, no turn limit so a stalemate shows up as "undecided at the cap". Heavy: it is NOT part of `pnpm test`; run it with
// `pnpm balance` (options: --games N, --cap CYCLES, --maps a,b, --commanders none, --first-mover RULE, --seed N, --verbose).
//
// --first-mover RULE (any name in FIRST_MOVER_RULES) plays every game under that createGame `firstMoverRule` (M3.2); without it each game
// gets createGame's own default for its player count (M3.3: defaultFirstMoverRule), which is the rule the shipped game uses. The rule in
// force is printed in the first line of the report.
// --seed N is the base of the games' luck (game g is seeded N + g; default 1000). Tune on one base and report on another: a rule picked
// on the same twenty seeds it is then reported on has been fitted to them.
// "side-0 share" is side 0's wins among the DECIDED games (wins / (games - undecided)); 50% is a fair seat. Undecided games are shown
// apart, as a share of all games.
//
// Mirroring: the commanders of a game are rotated through the seats, so with two seats game 2k has commanders (A, B) in seats (0, 1)
// and game 2k+1 has (B, A); every commander sits in every seat equally often. `--commanders none` plays every seat without a commander
// instead (no passives, no powers): the cleanest read of the map and of who moves first. Each game's luck is seeded from its number,
// and each map is played with its own recommended fog and starting funds. Three- and four-player maps are free-for-all.
//
// Every result is tied to the code that produced it by a source hash: FNV-1a (64 bit) over the files src/game/**/*.ts and
// src/content/**/*.ts in sorted path order, each as `path NUL contents NUL`.
//
// --orders PRESET (M3.4) gives ONE side the named per-unit orders (PRESETS below) and the other side DEFAULT_ORDERS, and the sides are
// swapped between games (game g gives the preset to seat g mod players). The report then counts the preset side's wins, the default side's
// wins and the undecided games, and adds ONE number that shows the order did what it says, for the preset side and for the default side
// alike (see METRICS): infantry captures per game, tiles that air units newly showed per game, or the mean distance of a group's units from
// my base or from my capturers at the end of my turns. Without --orders the report is the one it always was.
//
// TypeScript is loaded through vite's own SSR loader (vite is already a dependency), so nothing needs installing.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- arguments

/** The per-unit orders a run can give one side (M3.4). Plain data: the run passes it through validateOrders, so a typo is refused, not ignored. */
export const PRESETS = {
  'infantry-fight': { groups: { infantry: { mission: 'fight' } } },
  'infantry-guard': { groups: { infantry: { mission: 'guardBase' } } },
  'armour-escort': { groups: { armour: { mission: 'escort' } } },
  'armour-guard': { groups: { armour: { mission: 'guardBase' } } },
  'armour-advance': { groups: { armour: { posture: 'advance' } } },
  'artillery-guard': { groups: { artillery: { mission: 'guardBase' } } },
  'artillery-fallback': { groups: { artillery: { posture: 'fallBack' } } },
  'air-strike-advance': { groups: { air: { posture: 'advance' } } },
  'air-scout': { groups: { air: { mission: 'scout' } } },
  'air-escort': { groups: { air: { mission: 'escort' } } },
  'air-guard': { groups: { air: { mission: 'guardBase' } } },
  'navy-escort': { groups: { navy: { mission: 'escort' } } },
  'navy-guard': { groups: { navy: { mission: 'guardBase' } } },
  'transports-stayback': { groups: { transports: { mission: 'stayBack' } } },
};

/** The one number each preset reports (see the header): what is counted, and for which group where it is a distance. */
export const METRICS = {
  'infantry-fight': { kind: 'captures', label: 'infantry captures/game' },
  'infantry-guard': { kind: 'baseDist', group: 'infantry', label: 'infantry tiles from base' },
  'armour-escort': { kind: 'escortDist', group: 'armour', label: 'armour tiles from a capturer' },
  'armour-guard': { kind: 'baseDist', group: 'armour', label: 'armour tiles from base' },
  'armour-advance': { kind: 'baseDist', group: 'armour', label: 'armour tiles from base' },
  'artillery-guard': { kind: 'baseDist', group: 'artillery', label: 'artillery tiles from base' },
  'artillery-fallback': { kind: 'baseDist', group: 'artillery', label: 'artillery tiles from base' },
  'air-strike-advance': { kind: 'baseDist', group: 'air', label: 'air tiles from base' },
  'air-scout': { kind: 'revealed', label: 'tiles air newly showed/game' },
  'air-escort': { kind: 'escortDist', group: 'air', label: 'air tiles from a capturer' },
  'air-guard': { kind: 'baseDist', group: 'air', label: 'air tiles from base' },
  'navy-escort': { kind: 'escortDist', group: 'navy', label: 'navy tiles from a capturer' },
  'navy-guard': { kind: 'baseDist', group: 'navy', label: 'navy tiles from base' },
  'transports-stayback': { kind: 'baseDist', group: 'transports', label: 'transports tiles from base' },
};

function parseArgs(argv) {
  const out = { games: 20, cap: 40, maps: null, commanders: 'rotate', firstMover: null, seed: 1000, verbose: false, orders: null };
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
    else if (a === '--first-mover') out.firstMover = next();
    else if (a === '--seed') out.seed = Number(next());
    else if (a === '--orders') out.orders = next();
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!Number.isInteger(out.games) || out.games < 1) throw new Error('--games must be a whole number >= 1');
  if (!Number.isInteger(out.cap) || out.cap < 1) throw new Error('--cap must be a whole number >= 1');
  if (!['rotate', 'none'].includes(out.commanders)) throw new Error('--commanders must be rotate or none');
  if (!Number.isInteger(out.seed)) throw new Error('--seed must be a whole number');
  if (out.orders !== null && !Object.prototype.hasOwnProperty.call(PRESETS, out.orders)) {
    throw new Error(`--orders must be one of ${Object.keys(PRESETS).join(', ')}`);
  }
  // the rule's name is checked against FIRST_MOVER_RULES once the engine is loaded (see main)
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

// ---------------------------------------------------------------- what an order did (--orders)

/**
 * Tallies one metric per owner over a game, from the steps playDoctrine reports (before, action, after). `ctx` holds what the engine
 * modules give: UNIT_TYPES, TERRAIN_TYPES, groupOf, visibility and effectiveVision.
 */
function makeTally(metric, ctx, players) {
  const { UNIT_TYPES, TERRAIN_TYPES, groupOf, visibility, effectiveVision } = ctx;
  const t = Array.from({ length: players }, () => ({ count: 0, sum: 0, n: 0 }));
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const isBase = (tile) => { const tt = TERRAIN_TYPES[tile.terrain]; return !!tt.hq || !!tt.builds; };
  const onStep = (before, action, after) => {
    if (metric.kind === 'captures' || metric.kind === 'revealed') {
      if (action.kind !== 'move') return;
      const u = before.units.find((x) => x.id === action.unitId);
      if (!u) return;
      const dest = action.path[action.path.length - 1];
      if (metric.kind === 'captures') {
        if (action.then.kind !== 'capture' || groupOf(u.type) !== 'infantry') return;
        if (before.tiles[dest.y][dest.x].owner !== u.owner && after.tiles[dest.y][dest.x].owner === u.owner) t[u.owner].count++;
      } else {
        if (UNIT_TYPES[u.type].domain !== 'air') return;
        const seen = visibility(before, u.owner);
        const v = effectiveVision(before, u, dest);
        let n = 0;
        for (let y = Math.max(0, dest.y - v); y <= Math.min(before.height - 1, dest.y + v); y++) {
          for (let x = Math.max(0, dest.x - v); x <= Math.min(before.width - 1, dest.x + v); x++) {
            if (Math.abs(x - dest.x) + Math.abs(y - dest.y) <= v && !seen[y][x]) n++;
          }
        }
        t[u.owner].count += n;
      }
      return;
    }
    // distances are sampled when a player ends the turn, from the state at that moment
    if (action.kind !== 'endTurn') return;
    const me = before.current;
    const mine = before.units.filter((u) => u.owner === me && groupOf(u.type) === metric.group);
    if (!mine.length) return;
    let goals = [];
    if (metric.kind === 'baseDist') {
      for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
        const tile = before.tiles[y][x];
        if (tile.owner === me && isBase(tile)) goals.push({ x, y });
      }
    } else {
      goals = before.units.filter((u) => u.owner === me && groupOf(u.type) === 'infantry');
    }
    if (!goals.length) return;
    for (const u of mine) {
      t[me].sum += Math.min(...goals.map((g) => manhattan(u, g)));
      t[me].n++;
    }
  };
  return { onStep, t };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: pnpm balance [-- --games N] [--cap CYCLES] [--maps a,b] [--commanders rotate|none] [--first-mover RULE] [--seed N] [--orders PRESET] [--verbose]');
    console.log(`  --orders PRESET gives one side that preset (the other side DEFAULT_ORDERS, sides swapped between games); presets: ${Object.keys(PRESETS).join(', ')}`);
    return;
  }
  const server = await createServer({
    root: ROOT, configFile: false, appType: 'custom', logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { playDoctrine, DEFAULT_ORDERS, validateOrders, groupOf } = await server.ssrLoadModule('/src/game/doctrine/index.ts');
    const { FIRST_MOVER_RULES, defaultFirstMoverRule, visibility, effectiveVision } = await server.ssrLoadModule('/src/game/aw/index.ts');
    const { UNIT_TYPES, TERRAIN_TYPES } = await server.ssrLoadModule('/src/data/index.ts');
    const preset = args.orders ? validateOrders(PRESETS[args.orders]) : null;
    const metric = args.orders ? METRICS[args.orders] : null;
    if (args.firstMover !== null && !FIRST_MOVER_RULES.includes(args.firstMover)) {
      throw new Error(`--first-mover must be one of ${FIRST_MOVER_RULES.join(', ')}`);
    }
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
      // --orders: wins and the metric by role (preset side, default side) rather than by seat
      const byRole = { presetWins: 0, defaultWins: 0, preset: { count: 0, sum: 0, n: 0 }, other: { count: 0, sum: 0, n: 0 } };
      const t0 = Date.now();
      for (let g = 0; g < args.games; g++) {
        const setup = {
          map, players: playersFor(map, g, roster, args.commanders), fog: !!rec.fog, weather: rec.weather ?? 'clear',
          startFunds: rec.startFunds ?? 0, seed: args.seed + g,
          ...(args.firstMover ? { firstMoverRule: args.firstMover } : {}),
        };
        let r;
        if (preset) {
          const seat = g % map.players;
          const tally = makeTally(metric, { UNIT_TYPES, TERRAIN_TYPES, groupOf, visibility, effectiveVision }, map.players);
          r = playDoctrine(setup, Array.from({ length: map.players }, (_, i) => (i === seat ? preset : DEFAULT_ORDERS)), { maxCycles: args.cap, onStep: tally.onStep });
          if (r.winnerTeam === seat) byRole.presetWins++;
          else if (r.winnerTeam !== null) byRole.defaultWins++;
          // the default side is every other seat: its tally is the sum over those seats
          for (let i = 0; i < map.players; i++) {
            const dst = i === seat ? byRole.preset : byRole.other;
            dst.count += tally.t[i].count;
            dst.sum += tally.t[i].sum;
            dst.n += tally.t[i].n;
          }
        } else {
          r = playDoctrine(setup, DEFAULT_ORDERS, { maxCycles: args.cap });
        }
        cycles.push(r.cycles);
        if (r.winnerTeam === null) undecided++;
        else wins[r.winnerTeam]++; // team = seat here
        if (args.verbose) console.log(`  ${id} game ${g}: ${r.winnerTeam === null ? 'undecided' : `seat ${r.winnerTeam} won`} in ${r.cycles} cycles, ${r.actions.length} actions`);
      }
      rows.push({ id, rule: args.firstMover ?? defaultFirstMoverRule(map.players), games: args.games, wins, undecided, mean: cycles.reduce((a, b) => a + b, 0) / cycles.length, median: median(cycles), secs: (Date.now() - t0) / 1000, byRole });
    }

    const w = (s, n) => String(s).padEnd(n);
    const r = (s, n) => String(s).padStart(n);
    if (preset) {
      const counted = metric.kind === 'captures' || metric.kind === 'revealed';
      const fmt = (v) => (Number.isNaN(v) ? 'n/a' : v.toFixed(2));
      console.log(`Doctrine vs Doctrine, preset ${args.orders} (${JSON.stringify(PRESETS[args.orders])}) on one side and DEFAULT_ORDERS on the other, sides swapped between games, cap ${args.cap} cycles, commanders ${args.commanders}, first-mover rule ${args.firstMover ?? 'createGame default by player count'}, ${args.games} games per map, seeds ${args.seed}..${args.seed + args.games - 1}`);
      console.log(`${w('map', 18)}${r('games', 6)}${r('preset wins', 13)}${r('default wins', 14)}${r('undecided', 11)}${r('undecided %', 13)}${r('mean cycles', 13)}${r(`${metric.label}: preset`, 44)}${r('default', 10)}${r('secs', 7)}`);
      for (const row of rows) {
        const b = row.byRole;
        const und = `${((100 * row.undecided) / row.games).toFixed(0)}%`;
        // counted metrics are per game and per side; a distance is the mean over every sample of the side
        const players = MAPS[row.id].players;
        const mean = (x, seats) => (counted ? x.count / (row.games * seats) : x.n ? x.sum / x.n : NaN);
        console.log(`${w(row.id, 18)}${r(row.games, 6)}${r(b.presetWins, 13)}${r(b.defaultWins, 14)}${r(row.undecided, 11)}${r(und, 13)}${r(row.mean.toFixed(1), 13)}${r(fmt(mean(b.preset, 1)), 44)}${r(fmt(mean(b.other, Math.max(1, players - 1))), 10)}${r(row.secs.toFixed(1), 7)}`);
      }
      console.log(`source hash ${hash} (FNV-1a 64 over ${files} files in src/game and src/content), total ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return;
    }
    console.log(`Doctrine vs Doctrine, DEFAULT_ORDERS (posture ${DEFAULT_ORDERS.posture}), cap ${args.cap} cycles, commanders ${args.commanders}, first-mover rule ${args.firstMover ?? `createGame default by player count (2p ${defaultFirstMoverRule(2)}, 3p ${defaultFirstMoverRule(3)}, 4p ${defaultFirstMoverRule(4)})`}, ${args.games} games per map, seeds ${args.seed}..${args.seed + args.games - 1}`);
    console.log(`${w('map', 18)}${r('games', 6)}${r('side-0 wins', 13)}${r('side-1 wins', 13)}${r('side-2 wins', 13)}${r('side-3 wins', 13)}${r('side-0 share', 14)}${r('undecided', 11)}${r('undecided %', 13)}${r('mean cycles', 13)}${r('secs', 7)}  rule`);
    for (const row of rows) {
      const side = (i) => (i < row.wins.length ? row.wins[i] : '-');
      const decided = row.games - row.undecided;
      const share = decided > 0 ? `${((100 * row.wins[0]) / decided).toFixed(0)}%` : 'n/a';
      const und = `${((100 * row.undecided) / row.games).toFixed(0)}%`;
      console.log(`${w(row.id, 18)}${r(row.games, 6)}${r(side(0), 13)}${r(side(1), 13)}${r(side(2), 13)}${r(side(3), 13)}${r(share, 14)}${r(row.undecided, 11)}${r(und, 13)}${r(row.mean.toFixed(1), 13)}${r(row.secs.toFixed(1), 7)}  ${row.rule}`);
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
