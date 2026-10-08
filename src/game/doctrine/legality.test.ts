// (a) Legality fuzz: Doctrine against Doctrine with DEFAULT_ORDERS on every skirmish map (missions.test.ts does the Act I missions; some
// games run under fog). After every decision:
//   - the action is one of the actions the agent is offered (agentActions, compared by actionKey),
//   - it applies on the TRUE state without the engine refusing it,
//   - the board stays sane (one unit per tile, cargo rides with its carrier).
// and every game ends within the cycle cap (the cap is also the turn limit, so the engine itself ends a stalemate with a winner).
// The runs are short on purpose (CI budget); the heavy runs are scripts/balance.mjs. A tally at the end proves the runs used the
// rules they claim to check: attacks, captures, builds, powers, transports, repairs.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { MAPS } from '../../content/maps';
import type { MapDef } from '../../content/types';
import { applyAction, createGame } from '../aw';
import type { CreateGameOptions, PlayerSetup } from '../aw';
import { actionKey } from '../aw/legal';
import { agentActions } from '../aw/observe';
import type { Action, FactionId, GameEvent, GameState } from '../aw/types';
import { DEFAULT_ORDERS, decide } from './index';

interface Tally {
  games: number;
  actions: number;
  finished: number;
  kinds: Record<string, number>;
  events: Record<string, number>;
}

const newTally = (): Tally => ({ games: 0, actions: 0, finished: 0, kinds: {}, events: {} });
const bump = (r: Record<string, number>, k: string, n = 1) => { r[k] = (r[k] ?? 0) + n; };

function checkBoard(s: GameState): string | null {
  const seen = new Set<string>();
  for (const u of s.units) {
    const k = `${u.x},${u.y}`;
    if (seen.has(k)) return `two units on (${k})`;
    seen.add(k);
    for (const c of u.cargo) if (c.x !== u.x || c.y !== u.y) return `cargo ${c.id} is not with its carrier ${u.id}`;
    if (u.hp < 1 || u.hp > 100) return `unit ${u.id} has hp ${u.hp}`;
  }
  return null;
}

/** Plays one game to its end or the cap. Throws on the first action that is not on the agent's list or that the engine refuses. */
function fuzzGame(label: string, setup: CreateGameOptions, cap: number, tally: Tally): GameState {
  let state = createGame({ ...setup, turnLimit: setup.objective?.kind === 'survive' ? undefined : cap });
  const limit = cap * state.players.length * 400;
  let n = 0;
  tally.games++;
  while (state.winnerTeam === null && state.cycle <= cap) {
    if (++n > limit) throw new Error(`${label}: ${n} actions without the game ending (cycle ${state.cycle})`);
    const player = state.current;
    const action = decide(state, player, DEFAULT_ORDERS);
    const offered = agentActions(state, player);
    if (!offered.some((a) => actionKey(a) === actionKey(action))) {
      throw new Error(`${label}: cycle ${state.cycle}, player ${player}: ${actionKey(action)} is not on the agent's list`);
    }
    let result: { state: GameState; events: GameEvent[] };
    try {
      result = applyAction(state, action);
    } catch (err) {
      throw new Error(`${label}: cycle ${state.cycle}, player ${player}: the engine refused ${actionKey(action)}: ${(err as Error).message}`);
    }
    const bad = checkBoard(result.state);
    if (bad) throw new Error(`${label}: after ${actionKey(action)}: ${bad}`);
    tally.actions++;
    bump(tally.kinds, kindOf(action));
    for (const e of result.events) bump(tally.events, e.kind);
    state = result.state;
  }
  if (state.winnerTeam !== null) tally.finished++;
  return state;
}

const kindOf = (a: Action): string => (a.kind === 'move' ? `move/${a.then.kind}` : a.kind);

/** Rotating commanders (the ones with powers) through the seats, free-for-all unless `teams` says otherwise. */
function seats(n: number, game: number, teams?: number[]): PlayerSetup[] {
  const roster = Object.values(COMMANDERS).filter((c) => c.playable && c.faction).sort((a, b) => (a.id < b.id ? -1 : 1));
  return Array.from({ length: n }, (_, i) => {
    const c = roster[(game * 3 + i * 2) % roster.length];
    return { faction: c.faction as FactionId, commander: c.id, controller: 'ai', team: teams ? teams[i] : i } satisfies PlayerSetup;
  });
}

/** Short games: two seeds on the duel maps, one on the three- and four-player maps (their turns are long). */
const PLAN: Record<string, { seeds: number[]; cap: number }> = {
  'calder-fields': { seeds: [1, 2], cap: 7 },
  'saltglass-bay': { seeds: [1, 2], cap: 6 },
  'canopy-highlands': { seeds: [1, 2], cap: 6 },
  'tether-ridges': { seeds: [1, 2], cap: 6 },
  'glass-waste': { seeds: [1], cap: 5 },
  'arcology-coast': { seeds: [1], cap: 4 },
};

describe('(a) legality fuzz: skirmish maps', () => {
  const tally = newTally();

  for (const [id, map] of Object.entries(MAPS) as [string, MapDef][]) {
    const { seeds, cap } = PLAN[id];
    it(`${id}: ${map.players} players, ${seeds.length} seeded game${seeds.length > 1 ? 's' : ''}, every action offered and accepted, each game ends by cycle ${cap}`, () => {
      for (const seed of seeds) {
        const fog = id === 'canopy-highlands' ? true : seed === 2 && map.players === 2;
        const end = fuzzGame(`${id}/seed ${seed}${fog ? '/fog' : ''}`, {
          map, players: seats(map.players, seed), fog, startFunds: map.recommended?.startFunds ?? 2000, seed,
        }, cap, tally);
        expect(end.winnerTeam, `${id} seed ${seed}: the game is decided by the cap`).not.toBeNull();
      }
    });
  }

  it('together the runs used the rules they claim to check', () => {
    console.log(`(a) skirmish: ${tally.games} games, ${tally.actions} decisions, all offered and accepted; ` +
      `actions ${JSON.stringify(tally.kinds)}; events ${JSON.stringify(tally.events)}`);
    expect(tally.games).toBe(10);
    expect(tally.finished).toBe(10);
    expect(tally.events.attacked ?? 0, 'attacks').toBeGreaterThanOrEqual(30);
    expect(tally.events.captured ?? 0, 'captures').toBeGreaterThanOrEqual(30);
    expect(tally.events.built ?? 0, 'builds').toBeGreaterThanOrEqual(80);
    expect(tally.events.destroyed ?? 0, 'kills').toBeGreaterThanOrEqual(5);
    expect(tally.kinds.endTurn ?? 0, 'turns ended').toBeGreaterThanOrEqual(40);
  });
});

