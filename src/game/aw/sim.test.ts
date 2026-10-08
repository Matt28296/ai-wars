// Seeded self-play (sim.ts). Two versus setups (clear, and the same battlefield under fog), ten seeds each, both
// policies, played to game over or the cycle cap. After EVERY action the state is checked against rules that must hold
// whatever the policy did, the input state is deep-frozen so any mutation throws, and every game is replayed from its
// action list and run again from its seed. The checkers are tested against planted violations, so a green run means
// something. Expected answers are computed here from the rules, never read back from sim.ts.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import type { MapDef } from '../../content/types';
import { TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import type { CreateGameOptions, PlayerSetup } from './index';
import { applyAction, createGame, isLegal } from './index';
import { legalActions } from './legal';
import { canCarryType, canStandOn } from './movement';
import { replay, stateHash } from './replay';
import { simulate } from './sim';
import type { SimPolicy, SimResult, SimStep } from './sim';
import { TWO_PLAYERS, fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import type { Action, FactionId, GameState, Unit } from './types';

// ---------------------------------------------------------------- the battlefield

// Left half, centre strip, right half is the left half mirrored. 15 x 9.
//   H spire (HQ)   F fabricator   A skyport   D dock   C city   = road   f canopy   ^ ridge   ~ sea   s shoal (the ford)
const LEFT = [
  '.f..^.',
  '.F.=.C',
  '.H.=ff',
  '.A.=.D',
  '.F.==.',
  '...=.f',
  '.f.=^.',
  '.C..f.',
  '.f..^.',
];
const CENTRE = [
  '...',
  '.C.', // a neutral city on the north road
  '.f.',
  '~~~', // the lake, with a dock on each shore
  'sss', // the ford: ground armies cross here, ships cannot
  '~~~',
  '.f.',
  '.C.', // and one on the south road
  '...',
];
const PROPERTY = /[FHACDU]/;
const reverse = (s: string) => [...s].reverse().join('');

function versusMap(): MapDef {
  const terrain = LEFT.map((l, y) => l + CENTRE[y] + reverse(l));
  const owners = LEFT.map((l) => [...l].map((c) => (PROPERTY.test(c) ? '0' : '.')).join('') + '...' + [...reverse(l)].map((c) => (PROPERTY.test(c) ? '1' : '.')).join(''));
  const half: FixtureUnit[] = [
    { type: 'trooper', owner: 0, x: 2, y: 1 },
    { type: 'trooper', owner: 0, x: 2, y: 3 },
    { type: 'breacher', owner: 0, x: 2, y: 4 },
    { type: 'lancer', owner: 0, x: 3, y: 2 },
    { type: 'arc', owner: 0, x: 2, y: 2 },
    { type: 'mule', owner: 0, x: 2, y: 5 },
    { type: 'wasp', owner: 0, x: 0, y: 3 },
  ];
  const mirrored = half.map((u) => ({ ...u, owner: 1, x: terrain[0].length - 1 - u.x }));
  return fixtureMap(terrain, [...half, ...mirrored], owners, 'versus');
}

const COMMANDER_IDS = Object.keys(COMMANDERS);

function player(commander: string, team: number): PlayerSetup {
  const faction = (COMMANDERS[commander].faction ?? 'helion') as FactionId;
  return { faction, commander, controller: 'ai', team, funds: 8000 };
}

interface Config { name: string; fog: boolean }
const CONFIGS: Config[] = [{ name: 'clear', fog: false }, { name: 'fog', fog: true }];
const POLICIES: SimPolicy[] = ['random', 'greedy'];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Random play rarely ends a game, so it gets a shorter leash; greedy play usually finishes well inside its cap. */
const MAX_CYCLES: Record<SimPolicy, number> = { random: 14, greedy: 30 };

/** Different commanders each seed, so most Surges and Overclocks in the roster get used somewhere. */
function setupFor(cfg: Config, seed: number): CreateGameOptions {
  const a = COMMANDER_IDS[(seed * 2 + (cfg.fog ? 1 : 0)) % COMMANDER_IDS.length];
  const b = COMMANDER_IDS[(seed * 3 + 5) % COMMANDER_IDS.length];
  return { map: versusMap(), players: [player(a, 0), player(b, 1)], fog: cfg.fog, seed: 1000 + seed };
}

// ---------------------------------------------------------------- invariants

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const v of Object.values(value as object)) deepFreeze(v);
}

/** Rules that hold in every reachable state, whatever sequence of legal actions led there. Empty = all hold. */
function invariantProblems(s: GameState): string[] {
  const bad: string[] = [];
  const tiles = new Map<string, number>();
  const ids = new Set<number>();
  const checkUnit = (u: Unit, carrier: Unit | null) => {
    const t = UNIT_TYPES[u.type];
    const who = `${u.type}#${u.id}`;
    if (ids.has(u.id)) bad.push(`${who}: id appears twice`);
    ids.add(u.id);
    if (!(u.hp >= 1 && u.hp <= 100)) bad.push(`${who}: hp ${u.hp} outside 1..100`);
    if (!(u.ammo >= 0 && u.ammo <= (t.ammo ?? 0))) bad.push(`${who}: ammo ${u.ammo} outside 0..${t.ammo ?? 0}`);
    if (!(u.charge >= 0 && u.charge <= t.charge)) bad.push(`${who}: charge ${u.charge} outside 0..${t.charge}`);
    if (carrier) {
      if (u.x !== carrier.x || u.y !== carrier.y) bad.push(`${who}: cargo at (${u.x},${u.y}) but its carrier is at (${carrier.x},${carrier.y})`);
      return;
    }
    if (u.x < 0 || u.y < 0 || u.x >= s.width || u.y >= s.height) {
      bad.push(`${who}: off the map at (${u.x},${u.y})`);
      return;
    }
    const k = `${u.x},${u.y}`;
    if (tiles.has(k)) bad.push(`${who}: shares (${k}) with unit #${tiles.get(k)}`);
    tiles.set(k, u.id);
    const terrain = s.tiles[u.y][u.x].terrain;
    if (!canStandOn(terrain, t.moveType)) bad.push(`${who}: a ${t.moveType} unit stands on ${terrain} at (${k})`);
    if (u.cargo.length > (t.carries ?? 0)) bad.push(`${who}: carries ${u.cargo.length}, capacity ${t.carries ?? 0}`);
    for (const c of u.cargo) {
      if (!canCarryType(t, UNIT_TYPES[c.type])) bad.push(`${who}: carries a ${c.type}, which it cannot`);
      checkUnit(c, u);
    }
  };
  for (const u of s.units) {
    if (!s.players[u.owner]) bad.push(`${u.type}#${u.id}: owner ${u.owner} is not a player`);
    else if (s.players[u.owner].defeated) bad.push(`${u.type}#${u.id}: still on the map after player ${u.owner} was defeated`);
    if (u.id >= s.nextUnitId) bad.push(`${u.type}#${u.id}: id is not below nextUnitId ${s.nextUnitId}`);
    checkUnit(u, null);
  }
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const tile = s.tiles[y][x];
      if (!(tile.capture >= 1 && tile.capture <= 20)) bad.push(`tile (${x},${y}): capture points ${tile.capture} outside 1..20`);
      if (tile.owner !== null && !TERRAIN_TYPES[tile.terrain].property) bad.push(`tile (${x},${y}): ${tile.terrain} has an owner`);
      if (tile.owner !== null && s.players[tile.owner]?.defeated) bad.push(`tile (${x},${y}): still owned by defeated player ${tile.owner}`);
    }
  }
  for (const p of s.players) {
    if (!(p.funds >= 0)) bad.push(`player ${p.index}: funds ${p.funds}`);
    if (!(p.power >= 0)) bad.push(`player ${p.index}: power meter ${p.power}`);
  }
  const alive = new Set(s.players.filter((p) => !p.defeated).map((p) => p.team));
  if (s.winnerTeam === null && alive.size < 2) bad.push(`no winner, but ${alive.size} teams are still standing`);
  if (s.winnerTeam !== null && !alive.has(s.winnerTeam)) bad.push(`team ${s.winnerTeam} won with every one of its players defeated`);
  if (s.winnerTeam === null && s.players[s.current]?.defeated) bad.push(`it is defeated player ${s.current}'s turn`);
  return bad;
}

const waitHere = (u: Unit): Action => ({ kind: 'move', unitId: u.id, path: [{ x: u.x, y: u.y }], then: { kind: 'wait' } });

// ---------------------------------------------------------------- the runs

interface Totals { games: number; actions: number; finished: number; capped: number; wins: [number, number] }

describe('seeded simulations', () => {
  it(`${CONFIGS.length} setups x ${SEEDS.length} seeds x ${POLICIES.length} policies: invariants hold after every action, and every game replays and repeats`, () => {
    const started = performance.now();
    const problems: string[] = [];
    const totals: Totals = { games: 0, actions: 0, finished: 0, capped: 0, wins: [0, 0] };
    const note = (label: string, msg: string) => {
      if (problems.length < 40) problems.push(`${label}: ${msg}`);
    };

    for (const cfg of CONFIGS) {
      for (const policy of POLICIES) {
        for (const seed of SEEDS) {
          const label = `${cfg.name}/${policy}/seed ${seed}`;
          const setup = setupFor(cfg, seed);
          const maxCycles = MAX_CYCLES[policy];
          const liveHashes: string[] = [];
          const hashEveryStep = seed === 1 && cfg.fog; // hashing a state costs ~0.4 ms: do it every step for two games only
          let result: SimResult;
          try {
            result = simulate({
              setup, seed, maxCycles, policy,
              onStart: (state) => {
                deepFreeze(state); // an applyAction that writes to its input now throws
                if (hashEveryStep) liveHashes.push(stateHash(state));
              },
              onStep: (step: SimStep) => {
                deepFreeze(step.after);
                if (hashEveryStep) liveHashes.push(stateHash(step.after));
                const where = `action #${step.index} ${JSON.stringify(step.action)}`;
                for (const p of invariantProblems(step.after)) note(label, `${where}: ${p}`);
                const a = step.action;
                if (a.kind === 'move') {
                  // A unit that has just acted cannot act again: it is marked, the engine refuses it, and the list does not offer it.
                  const u = step.after.units.find((x) => x.id === a.unitId);
                  if (u && !u.acted) note(label, `${where}: unit ${u.id} is not marked acted`);
                  if (u && step.index % 15 === 0 && isLegal(step.after, waitHere(u))) note(label, `${where}: the engine lets unit ${u.id} act twice`);
                }
                if (step.index % 90 === 0) {
                  for (const o of legalActions(step.after)) {
                    if (o.kind !== 'move') continue;
                    const u = step.after.units.find((x) => x.id === o.unitId);
                    if (!u || u.acted || u.owner !== step.after.current) note(label, `${where}: offered an acted or foreign unit ${o.unitId}`);
                  }
                }
              },
            });
          } catch (err) {
            note(label, `threw ${(err as Error).name}: ${(err as Error).message}`);
            continue;
          }

          totals.games++;
          totals.actions += result.actions.length;
          if (result.winnerTeam !== null) {
            totals.finished++;
            totals.wins[result.winnerTeam]++;
          } else totals.capped++;

          // Replay: the action list alone reproduces the game.
          const rep = replay(setup, result.actions, { hashes: hashEveryStep });
          if (stateHash(rep.state) !== result.hash) note(label, `replay ends at ${stateHash(rep.state)}, live play at ${result.hash}`);
          if (JSON.stringify(rep.events) !== JSON.stringify(result.events)) note(label, 'replay produced different events from live play');
          if (hashEveryStep && JSON.stringify(rep.hashes) !== JSON.stringify(liveHashes)) {
            const i = rep.hashes.findIndex((h, n) => h !== liveHashes[n]);
            note(label, `replay hashes diverge from live play at state ${i}`);
          }
          // The same seed plays the same game (checked on half the seeds: a second full run costs as much as the first).
          if (seed % 2 === 1) {
            const again = simulate({ setup, seed, maxCycles, policy });
            if (again.hash !== result.hash || JSON.stringify(again.actions) !== JSON.stringify(result.actions)) note(label, 'a second run with the same seed played differently');
          }
          // The ending is honest.
          const left = legalActions(result.state);
          if (result.winnerTeam !== null) {
            if (left.length !== 0) note(label, `game over (team ${result.winnerTeam} won) but ${left.length} actions are still listed`);
          } else {
            if (result.cycles !== maxCycles) note(label, `capped game reports ${result.cycles} cycles, expected ${maxCycles}`);
            if (!left.some((a) => a.kind === 'endTurn')) note(label, 'unfinished game does not offer endTurn');
          }
        }
      }
    }

    console.log(
      `sim: ${totals.games} games, ${totals.actions} actions, ${totals.finished} finished / ${totals.capped} capped ` +
      `(random at ${MAX_CYCLES.random} cycles, greedy at ${MAX_CYCLES.greedy}), wins team 0: ${totals.wins[0]}, team 1: ${totals.wins[1]}, ` +
      `${Math.round(performance.now() - started)} ms`,
    );
    expect(problems).toEqual([]);
    expect(totals.games).toBe(CONFIGS.length * SEEDS.length * POLICIES.length);
    // The runs must actually reach the interesting states, or "all invariants hold" is a statement about nothing.
    expect(totals.finished, 'some games end in a win').toBeGreaterThan(5);
    expect(totals.capped, 'some games run into the cycle cap').toBeGreaterThan(5);
    expect(totals.wins[0] + totals.wins[1]).toBe(totals.finished);
  }, 120_000);
});

describe('the run covers the rules it claims to check', () => {
  it('uses powers, captures, builds, fights, transports and repairs somewhere in the runs', () => {
    const seen = new Set<string>();
    for (const cfg of CONFIGS) {
      for (const policy of POLICIES) {
        for (const seed of SEEDS.slice(0, 4)) {
          const r = simulate({ setup: setupFor(cfg, seed), seed, maxCycles: MAX_CYCLES[policy], policy });
          for (const e of r.events) seen.add(e.kind);
        }
      }
    }
    for (const kind of ['attacked', 'destroyed', 'captureProgress', 'captured', 'built', 'powerActivated', 'repaired', 'loaded', 'unloaded', 'turnEnded', 'victory'] as const) {
      expect(seen.has(kind), `no '${kind}' event in 16 games`).toBe(true);
    }
  });
});

describe('the invariant checker', () => {
  const healthy = () => createGame(setupFor(CONFIGS[0], 1));
  const planted: [string, (s: GameState) => GameState, RegExp][] = [
    ['two units on one tile', (s) => ({ ...s, units: s.units.map((u, i) => (i === 1 ? { ...u, x: s.units[0].x, y: s.units[0].y } : u)) }), /shares/],
    ['hp 0', (s) => ({ ...s, units: s.units.map((u, i) => (i === 0 ? { ...u, hp: 0 } : u)) }), /hp 0 outside/],
    ['hp 101', (s) => ({ ...s, units: s.units.map((u, i) => (i === 0 ? { ...u, hp: 101 } : u)) }), /hp 101 outside/],
    ['more ammo than the type holds', (s) => ({ ...s, units: s.units.map((u) => (u.type === 'lancer' ? { ...u, ammo: 10 } : u)) }), /ammo 10 outside/],
    ['negative charge', (s) => ({ ...s, units: s.units.map((u, i) => (i === 0 ? { ...u, charge: -1 } : u)) }), /charge -1 outside/],
    ['a hover unit on the sea', (s) => ({ ...s, units: s.units.map((u) => (u.type === 'lancer' ? { ...u, x: 7, y: 3 } : u)) }), /hover unit stands on sea/],
    ['negative funds', (s) => ({ ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, funds: -5 } : p)) }), /funds -5/],
    ['a mule carrying two units', (s) => ({ ...s, units: s.units.map((u) => (u.type === 'mule' ? { ...u, cargo: [s.units[0], s.units[1]].map((c) => ({ ...c, x: u.x, y: u.y })) } : u)) }), /capacity 1/],
    ['capture points at zero', (s) => ({ ...s, tiles: s.tiles.map((row, y) => (y === 2 ? row.map((t, x) => (x === 1 ? { ...t, capture: 0 } : t)) : row)) }), /capture points 0/],
    ['one team left, no winner', (s) => ({ ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, defeated: true } : p)) }), /no winner/],
    ['a defeated player to move', (s) => ({ ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, defeated: true } : p)) }), /defeated player 0's turn/],
  ];

  it('passes a fresh game', () => {
    expect(invariantProblems(healthy())).toEqual([]);
  });
  it.each(planted)('flags %s', (_name, plant, pattern) => {
    const problems = invariantProblems(plant(healthy()));
    expect(problems.some((p) => pattern.test(p)), problems.join(' | ')).toBe(true);
  });
  it('deepFreeze makes any write into a state throw, however deep, and leaves reads alone', () => {
    const s = healthy();
    deepFreeze(s);
    expect(() => { s.units[0].hp = 5; }).toThrow(TypeError);
    expect(() => { s.tiles[0][0].owner = 1; }).toThrow(TypeError);
    expect(() => { s.players[0].stats.damageDealt += 1; }).toThrow(TypeError);
    expect(() => { s.units.push(s.units[0]); }).toThrow(TypeError);
    expect(s.units[0].hp).toBe(100);
  });
  it('the engine accepts a frozen state and leaves it as it was', () => {
    const s = healthy();
    const before = JSON.stringify(s);
    deepFreeze(s);
    for (const a of legalActions(s).slice(0, 80)) applyAction(s, a);
    expect(JSON.stringify(s)).toBe(before);
  });
});

// ---------------------------------------------------------------- the policies, on positions with one right answer

/** The first action `policy` plays from this setup. */
function firstAction(setup: CreateGameOptions, policy: SimPolicy, seed = 1): Action {
  let first: Action | undefined;
  simulate({ setup, seed, maxCycles: 1, policy, onStep: (s) => { first ??= s.action; } });
  return first!;
}

const duel = (terrain: string[], units: FixtureUnit[], owners?: string[]): CreateGameOptions => ({
  map: fixtureMap(terrain, units, owners), players: TWO_PLAYERS, seed: 1,
});

describe('greedy policy', () => {
  it('strikes the target worth the most, not the first or the nearest', () => {
    // A lancer in the middle with a cheap trooper on its left and a dear mule above it. Both are adjacent.
    const setup = duel(['.....', '.....', '.....'], [
      { type: 'lancer', owner: 0, x: 2, y: 1 },
      { type: 'trooper', owner: 1, x: 1, y: 1 },
      { type: 'mule', owner: 1, x: 2, y: 0 },
    ]);
    const a = firstAction(setup, 'greedy');
    expect(a).toMatchObject({ kind: 'move', unitId: 1, then: { kind: 'attack', target: { x: 2, y: 0 } } });
  });
  it('captures a property it stands on rather than wandering off', () => {
    // The enemy is out of reach (a trooper moves 3 and strikes adjacent), so there is nothing to shoot.
    const setup = duel(['.C.....'], [
      { type: 'trooper', owner: 0, x: 1, y: 0 },
      { type: 'trooper', owner: 1, x: 6, y: 0 },
    ]);
    const a = firstAction(setup, 'greedy');
    expect(a).toMatchObject({ kind: 'move', unitId: 1, path: [{ x: 1, y: 0 }], then: { kind: 'capture' } });
  });
  it('walks toward the nearest enemy property as far as its legs go', () => {
    // Nothing to shoot, nothing to capture within reach: a trooper (move 3) on an open row heads for the enemy city.
    const setup = duel(['........C'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }], ['........1']);
    const a = firstAction(setup, 'greedy');
    expect(a).toMatchObject({ kind: 'move', unitId: 1, then: { kind: 'wait' } });
    if (a.kind === 'move') expect(a.path[a.path.length - 1]).toEqual({ x: 3, y: 0 });
  });
  it('builds with spare funds once its units have acted', () => {
    const setup: CreateGameOptions = {
      map: fixtureMap(['F...H'], [{ type: 'trooper', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 4, y: 0 }], ['0...1']),
      players: [player('rook', 0), player('sefa', 1)], seed: 1, startFunds: 20000,
    };
    const actions = simulate({ setup, seed: 1, maxCycles: 1, policy: 'greedy' }).actions;
    const firstBuild = actions.findIndex((a) => a.kind === 'build');
    expect(firstBuild, 'builds at its fabricator').toBeGreaterThan(-1);
    expect(firstBuild, 'only after the unit it already had has moved').toBeGreaterThan(actions.findIndex((a) => a.kind === 'move'));
  });
});

describe('simulate', () => {
  const setup = () => setupFor(CONFIGS[0], 3);

  it('is a function of its seed: same seed same game, other seed other game', () => {
    const a = simulate({ setup: setup(), seed: 7, maxCycles: 5, policy: 'random' });
    const b = simulate({ setup: setup(), seed: 7, maxCycles: 5, policy: 'random' });
    const c = simulate({ setup: setup(), seed: 8, maxCycles: 5, policy: 'random' });
    expect(b.actions).toEqual(a.actions);
    expect(b.hash).toBe(a.hash);
    expect(c.actions).not.toEqual(a.actions);
    expect(c.hash).not.toBe(a.hash);
  });
  it('keeps its own RNG apart from the game luck: another luck seed changes the dice, not the policy first move', () => {
    const luck = (seed: number) => simulate({ setup: { ...setup(), seed }, seed: 5, maxCycles: 6, policy: 'greedy' });
    const a = luck(11);
    const b = luck(12);
    expect(a.actions[0]).toEqual(b.actions[0]);
    expect(a.state.rng).not.toBe(b.state.rng);
  });
  it('stops at the cycle cap with no winner, and reports the cap', () => {
    for (const cap of [1, 3]) {
      const r = simulate({ setup: setup(), seed: 2, maxCycles: cap, policy: 'random' });
      expect(r.winnerTeam).toBeNull();
      expect(r.cycles).toBe(cap);
      expect(r.state.cycle).toBe(cap + 1);
    }
    expect(simulate({ setup: setup(), seed: 2, maxCycles: 0, policy: 'random' }).actions).toEqual([]);
  });
  it('hands every state to the hooks in order, and each step starts where the last one ended', () => {
    let starts = 0;
    let prev: GameState | null = null;
    const steps: number[] = [];
    const r = simulate({
      setup: setup(), seed: 4, maxCycles: 3, policy: 'greedy',
      onStart: (s) => { starts++; prev = s; },
      onStep: (s) => {
        expect(s.before).toBe(prev);
        expect(s.after).not.toBe(s.before);
        steps.push(s.index);
        prev = s.after;
      },
    });
    expect(starts).toBe(1);
    expect(steps).toEqual(r.actions.map((_, i) => i));
    expect(prev).toBe(r.state);
  });
  it('plays only legal actions: replaying its record never throws, and an edited record does', () => {
    const r = simulate({ setup: setup(), seed: 9, maxCycles: 4, policy: 'random' });
    expect(() => replay(setup(), r.actions)).not.toThrow();
    const bad: Action[] = [{ kind: 'move', unitId: 9999, path: [{ x: 0, y: 0 }], then: { kind: 'wait' } }, ...r.actions];
    expect(() => replay(setup(), bad)).toThrow(/action #0/);
  });
});

// ---------------------------------------------------------------- bugs the simulations found

describe('engine bugs found by the simulations', () => {
  // BUG-1. Found in three-player free-for-all games (about one game in five with random play): a player whose last unit
  // dies to a counter-attack on their own turn is defeated at once (checkRout in applyAction's afterAction), but the turn
  // does not pass. `current` stays on the defeated player until someone sends endTurn for them, and 'turnEnded' is
  // emitted for a defeated player. The resign path (applyAction) and the turn-start path (D-015.5) both pass the turn on.
  // Two-player games are not affected: the other player wins on the spot. This test passes while the bug exists and goes
  // red when it is fixed; then change it.fails to it.
  it.fails('BUG-1: a player routed on their own turn keeps the turn in a three-player game', () => {
    const players: PlayerSetup[] = [
      { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
      { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
      { faction: 'verdant', commander: 'none', controller: 'ai', team: 2 },
    ];
    // Player 0 holds a trooper; player 1 a bastion; player 2 a single 1-HP trooper next to player 1's bastion.
    const map = fixtureMap(['....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 2, x: 2, y: 0, hp: 1 },
      { type: 'bastion', owner: 1, x: 3, y: 0 },
    ]);
    let s = createGame({ map, players, seed: 1 });
    s = applyAction(s, { kind: 'endTurn' }).state; // player 0 passes
    s = applyAction(s, { kind: 'endTurn' }).state; // player 1 passes
    expect(s.current).toBe(2);
    // The doomed trooper attacks the bastion, takes the counter, and is destroyed: player 2 has no units left.
    s = applyAction(s, { kind: 'move', unitId: 2, path: [{ x: 2, y: 0 }], then: { kind: 'attack', target: { x: 3, y: 0 } } }).state;
    expect(s.players[2].defeated).toBe(true);
    expect(s.winnerTeam).toBeNull();
    // Expected: play has passed to the next undefeated player. Actual: current is still 2.
    expect(s.players[s.current].defeated, `it is player ${s.current}'s turn and they are defeated`).toBe(false);
  });
});
