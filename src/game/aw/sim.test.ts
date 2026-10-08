// Seeded self-play (sim.ts). Two versus setups (clear, and the same battlefield under fog), ten seeds each, both
// policies, played to game over or the cycle cap. After EVERY action the state is checked against rules that must hold
// whatever the policy did, the input state is deep-frozen so any mutation throws, and every finished game is replayed
// from its action list and replayed again from its seed.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import type { MapDef } from '../../content/types';
import { UNIT_TYPES } from '../../data';
import type { CreateGameOptions, PlayerSetup } from './index';
import { isLegal } from './index';
import { legalActions } from './legal';
import { canStandOn } from './movement';
import { replay, stateHash } from './replay';
import { simulate } from './sim';
import type { SimPolicy, SimResult, SimStep } from './sim';
import { fixtureMap } from './testing';
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
  '.C.', // a neutral city in the middle of the north road
  '.f.',
  '~~~', // the lake, with a dock on each shore
  'sss', // the ford: ground armies cross here, ships cannot
  '~~~',
  '.f.',
  '.C.',
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

/** Different commanders each seed, so every Surge and Overclock in the roster gets used somewhere. */
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

/** Rules that hold in every reachable state, whatever sequence of legal actions led there. */
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
    for (const c of u.cargo) checkUnit(c, u);
  };
  for (const u of s.units) checkUnit(u, null);
  for (const p of s.players) {
    if (!(p.funds >= 0)) bad.push(`player ${p.index}: funds ${p.funds}`);
    if (!(p.power >= 0)) bad.push(`player ${p.index}: power meter ${p.power}`);
  }
  return bad;
}

const waitHere = (u: Unit): Action => ({ kind: 'move', unitId: u.id, path: [{ x: u.x, y: u.y }], then: { kind: 'wait' } });

// ---------------------------------------------------------------- the runs

interface Totals { games: number; actions: number; finished: number; capped: number; wins: [number, number]; ms: number }

describe('seeded simulations', () => {
  it(`${CONFIGS.length} setups x ${SEEDS.length} seeds x ${POLICIES.length} policies: invariants hold after every action, and every game replays and repeats`, () => {
    const started = performance.now();
    const problems: string[] = [];
    const totals: Totals = { games: 0, actions: 0, finished: 0, capped: 0, wins: [0, 0], ms: 0 };
    const note = (label: string, msg: string) => {
      if (problems.length < 40) problems.push(`${label}: ${msg}`);
    };

    for (const cfg of CONFIGS) {
      for (const policy of POLICIES) {
        for (const seed of SEEDS) {
          const label = `${cfg.name}/${policy}/seed ${seed}`;
          const setup = setupFor(cfg, seed);
          const liveHashes: string[] = [];
          const maxCycles = MAX_CYCLES[policy];
          const hashEveryStep = seed === 1 && cfg.fog;
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
                  // A unit that has just acted cannot act again: the engine itself refuses, and the list does not offer it.
                  const u = step.after.units.find((x) => x.id === a.unitId);
                  if (u && !u.acted) note(label, `${where}: unit ${u.id} is not marked acted`);
                  if (u && step.index % 15 === 0 && isLegal(step.after, waitHere(u))) note(label, `${where}: the engine lets unit ${u.id} act twice`);
                }
                if (step.index % 60 === 0) {
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
          // The same seed plays the same game.
          const again = simulate({ setup, seed, maxCycles, policy });
          if (again.hash !== result.hash || JSON.stringify(again.actions) !== JSON.stringify(result.actions)) note(label, 'a second run with the same seed played differently');
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

    totals.ms = Math.round(performance.now() - started);
    console.log(
      `sim: ${totals.games} games, ${totals.actions} actions, ${totals.finished} finished / ${totals.capped} capped (random at ${MAX_CYCLES.random} cycles, greedy at ${MAX_CYCLES.greedy}), ` +
      `wins team 0: ${totals.wins[0]}, team 1: ${totals.wins[1]}, ${totals.ms} ms`,
    );
    expect(problems).toEqual([]);
    expect(totals.games).toBe(CONFIGS.length * SEEDS.length * POLICIES.length);
  }, 120_000);
});
