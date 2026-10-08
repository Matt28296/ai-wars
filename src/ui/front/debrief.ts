// The debrief (G13), pure: how a recorded battle ended, what its result card says, and what is read over it.
//
// THE CARD. It reports the agent's SIDE: player 0 and every ally on its team (the other armies Doctrine commands beside it, STORY.md),
// because a mission is won or lost by the side, not by one detachment. Numbers come from the final state's own stats:
//   cycles taken   the cycle the last action was played in, against the mission's `par.cycles`. That is the second-to-last state's cycle,
//                  not the final state's: when Deploy stops a battle at its cycle cap, the last action is the end of turn that STARTS the
//                  next cycle, so the final state reads cycle 31 for a battle that played 30. (A decided battle reads the same either way.)
//   units lost     units the side lost, cargo included, crashes included (stats.unitsLost).
//   destroyed      enemy units the side destroyed (stats.unitsDestroyed).
//   Speed and Power are the engine's own formulas (scoreCard, docs/research/quality-bar.md 15.3), run on the side's totals, so the two
//   can never drift from what the rest of the game scores:
//     Speed = 100 at par or faster, else 100 - 100 x (cycles - par) / par, floored at 0.
//     Power = 100 x (destroyed / max(1, lost)) / par.power, capped at 100.
//
// THE RANK. Speed + Power, 0 to 200: S from 180, A from 150, B from 100, C below. Ranks go to VICTORIES only: a side that lost fast and
// killed nothing scores a full Speed, and a letter for that would be a lie, so a defeat or an undecided battle is shown unranked.
// Technique (the engine's third score) is not on this card.
//
// SPOILERS. The card holds numbers and fixed words only. The debrief's spoken lines are the mission's own (they may name what that
// mission names); the lines for any other ending are neutral and name nothing.
import type { DialogueLine, Mission } from '../../content/types';
import { scoreCard } from '../../game/aw';
import type { GameState } from '../../game/aw';
import { MISSIONS } from '../../content/missions';
import { outcomeOf } from './missionScript';
import type { Outcome } from './missionScript';

export type Rank = 'S' | 'A' | 'B' | 'C';

/** The least Speed + Power that earns each rank above C. */
export const RANK_FLOORS: readonly (readonly [Rank, number])[] = [['S', 180], ['A', 150], ['B', 100]];

export const RANK_RULE = 'Rank adds Speed and Power (0 to 100 each): S from 180, A from 150, B from 100, C below. Only a victory is ranked.';
export const SPEED_RULE = 'Speed is 100 at par or faster, and loses a point for every 1% of par you run over.';
export const POWER_RULE = 'Power is enemy units destroyed per unit lost, against par, up to 100.';

/** The rank for a battle's two scores, or null when the battle was not won. */
export function rankOf(speed: number, power: number, outcome: Outcome): Rank | null {
  if (outcome !== 'victory') return null;
  const total = speed + power;
  return RANK_FLOORS.find(([, floor]) => total >= floor)?.[0] ?? 'C';
}

export interface ResultCard {
  outcome: Outcome;
  /** The cycle the recording ended in (the last action's). */
  cycles: number;
  parCycles: number;
  /** Units the agent's side lost, and enemy units it destroyed. */
  lost: number;
  destroyed: number;
  /** destroyed / max(1, lost), unrounded. */
  ratio: number;
  parPower: number;
  speed: number;
  power: number;
  rank: Rank | null;
}

/** The card for a finished battle, from every state of its recording. Refuses a par that is not a positive number (scoreCard does). */
export function resultCardOf(mission: Pick<Mission, 'par' | 'players'>, states: readonly GameState[]): ResultCard {
  if (states.length < 1) throw new RangeError('resultCardOf: the recording has no states');
  const final = states[states.length - 1];
  const played = states[Math.max(0, states.length - 2)].cycle;
  const team0 = mission.players[0].team;
  const side = final.players.filter((p) => p.team === team0);
  if (side.length === 0) throw new RangeError(`resultCardOf: no player is on team ${team0}`);
  const lost = side.reduce((n, p) => n + p.stats.unitsLost, 0);
  const destroyed = side.reduce((n, p) => n + p.stats.unitsDestroyed, 0);
  // The engine scores one player; hand it the side's totals as that player so Speed and Power are its own formulas.
  const pooled = { ...final, cycle: played, players: [{ ...final.players[0], stats: { ...final.players[0].stats, unitsLost: lost, unitsDestroyed: destroyed } }] };
  const { speed, power } = scoreCard(pooled, 0, mission.par);
  const outcome = outcomeOf(team0, final.winnerTeam);
  return {
    outcome, cycles: played, parCycles: mission.par.cycles, lost, destroyed, ratio: destroyed / Math.max(1, lost),
    parPower: mission.par.power, speed, power, rank: rankOf(speed, power, outcome),
  };
}

export const VERDICTS: Record<Outcome, string> = { victory: 'Victory', defeat: 'Defeat', undecided: 'Undecided' };

const narrator = (text: string): DialogueLine => ({ speaker: 'narrator', text });

/**
 * What is read over the result card. A victory reads the mission's own debrief. Any other ending reads one neutral line, because the
 * debrief is written for the battle that was won and would be false over the one that was not.
 */
export function debriefLines(mission: Pick<Mission, 'debrief'>, card: Pick<ResultCard, 'outcome' | 'cycles'>): DialogueLine[] {
  switch (card.outcome) {
    case 'victory': return mission.debrief;
    case 'defeat': return [narrator('The field was lost. Change your agent\'s standing orders and deploy again.')];
    case 'undecided': return [narrator(`Neither side had won when the recording stopped at cycle ${card.cycles}. The battle is undecided.`)];
  }
}

/** The mission after this one in the campaign (by its `order`), or undefined after the last. */
export function nextMissionOf(mission: Pick<Mission, 'order'>, all: readonly Mission[] = MISSIONS): Mission | undefined {
  let next: Mission | undefined;
  for (const m of all) if (m.order > mission.order && (!next || m.order < next.order)) next = m;
  return next;
}
