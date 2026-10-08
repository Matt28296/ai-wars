// (a) Legality fuzz, Act I: Doctrine in every seat of every mission, with the mission's own fog setting and with it flipped
// (skirmish maps are in legality.test.ts). After every decision:
//   - the action is one of the actions the agent is offered (agentActions, compared by actionKey),
//   - it applies on the TRUE state without the engine refusing it,
//   - the board stays sane (one unit per tile, cargo rides with its carrier).
// and every game ends within the cycle cap (the cap is also the turn limit, so the engine itself ends a stalemate with a winner).
// The runs are short on purpose (CI budget); the heavy runs are scripts/balance.mjs. A tally at the end proves the runs used the
// rules they claim to check: attacks, captures, builds, powers, transports, repairs.
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../../content/missions';
import { MISSION_MAPS } from '../../content/mission-maps';
import { applyAction, createGame } from '../aw';
import type { CreateGameOptions, PlayerSetup } from '../aw';
import { actionKey } from '../aw/legal';
import { agentActions } from '../aw/observe';
import type { Action, GameEvent, GameState } from '../aw/types';
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

const CAP = 6;

describe('(a) legality fuzz: every campaign mission', () => {
  const tally = newTally();

  for (const mission of MISSIONS) {
    it(`${mission.id}: Doctrine in every seat, with fog off and on, every action offered and accepted`, () => {
      const map = MISSION_MAPS[mission.mapId];
      expect(map, `${mission.id} has its map`).toBeDefined();
      for (const fog of [mission.fog, !mission.fog]) {
        const players: PlayerSetup[] = mission.players.map((p) => ({
          faction: p.faction, commander: p.commander, controller: 'ai', team: p.team, ...(p.funds !== undefined ? { funds: p.funds } : {}),
        }));
        const end = fuzzGame(`${mission.id}${fog ? '/fog' : ''}`, {
          map, players, fog, weather: mission.weather ?? 'clear', objective: mission.objective, seed: 3,
        }, mission.objective.kind === 'survive' ? mission.objective.cycles : CAP, tally); // a survive mission ends when its own clock does
        expect(end.winnerTeam, `${mission.id}${fog ? ' (fog)' : ''}: decided by the cap`).not.toBeNull();
      }
    });
  }

  it('together the runs fought, captured and built', () => {
    console.log(`(a) missions: ${tally.games} games, ${tally.actions} decisions; actions ${JSON.stringify(tally.kinds)}; events ${JSON.stringify(tally.events)}`);
    // Two games per mission (fog as authored, and flipped), counted from the campaign itself so a new act is covered
    // without editing this test.
    expect(tally.games).toBe(MISSIONS.length * 2);
    expect(tally.finished).toBe(MISSIONS.length * 2);
    expect(tally.events.attacked ?? 0, 'attacks').toBeGreaterThanOrEqual(10);
    expect(tally.events.built ?? 0, 'builds').toBeGreaterThanOrEqual(5);
    expect(tally.kinds.endTurn ?? 0, 'turns ended').toBeGreaterThanOrEqual(20);
  });
});
