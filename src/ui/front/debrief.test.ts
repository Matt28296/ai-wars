// The debrief: how a battle ended, the result card's numbers, the rank rule at its boundaries and what is read over the card. Expected
// answers are worked out here from the formulas in docs/research/quality-bar.md 15.3 and from the stats written into each state.
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../../content/missions';
import type { Mission } from '../../content/types';
import { createGame } from '../../game/aw';
import type { GameState, PlayerSetup } from '../../game/aw';
import { fixtureMap } from '../../game/aw/testing';
import { POWER_RULE, RANK_FLOORS, RANK_RULE, SPEED_RULE, VERDICTS, debriefLines, nextMissionOf, rankOf, resultCardOf } from './debrief';
import type { Rank } from './debrief';

// ---------------------------------------------------------------- states with the stats written in

const FACTIONS = ['helion', 'tidewell', 'verdant', 'kestrel'] as const;

interface StateSpec {
  /** One team number per player. */
  teams: number[];
  /** [units lost, units destroyed] per player. */
  stats: [number, number][];
  cycle: number;
  winnerTeam: number | null;
}

/** A real state (createGame) with the cycle, winner and stats overwritten. */
function stateOf(spec: StateSpec): GameState {
  const players: PlayerSetup[] = spec.teams.map((team, i) => ({ faction: FACTIONS[i], commander: 'none', controller: 'ai', team }));
  const base = createGame({ map: fixtureMap(['....', '....'], [], undefined, 'debrief-fixture'), players, seed: 1 });
  return {
    ...base, cycle: spec.cycle, winnerTeam: spec.winnerTeam,
    players: base.players.map((p, i) => ({ ...p, stats: { ...p.stats, unitsLost: spec.stats[i][0], unitsDestroyed: spec.stats[i][1] } })),
  };
}
const two = (cycle: number, lost: number, destroyed: number, winnerTeam: number | null = 0): GameState =>
  stateOf({ teams: [0, 1], stats: [[lost, destroyed], [destroyed, lost]], cycle, winnerTeam });

const par = (cycles: number, power: number) => ({ par: { cycles, power }, players: [{ faction: 'helion', commander: 'agent', controller: 'human', team: 0 }] satisfies Mission['players'] });
const PAR_6_3 = par(6, 3);

describe('the card\'s numbers', () => {
  it('takes cycles, units lost and units destroyed from the final state, and Speed and Power from the quality-bar formulas', () => {
    // cycles 5 <= par 6: Speed 100. 3 destroyed per 1 lost against par 3: Power 100 x (3 / 1) / 3 = 100.
    expect(resultCardOf(PAR_6_3, [two(5, 1, 3)])).toMatchObject({ cycles: 5, parCycles: 6, lost: 1, destroyed: 3, ratio: 3, parPower: 3, speed: 100, power: 100, outcome: 'victory' });
  });

  it('scores Speed 100 at par exactly, and one point less for each 1% of par over it, never below 0', () => {
    const speed = (cycles: number): number => resultCardOf(PAR_6_3, [two(cycles, 1, 3)]).speed;
    expect(speed(6)).toBe(100);
    expect(speed(7)).toBe(83);  // 100 - 100 x 1 / 6 = 83.3
    expect(speed(9)).toBe(50);  // 100 - 100 x 3 / 6
    expect(speed(12)).toBe(0);  // 100 - 100 x 6 / 6
    expect(speed(40)).toBe(0);  // floored
  });

  it('scores Power as kills per loss against par, capped at 100, and treats no losses as one loss', () => {
    const power = (lost: number, destroyed: number): number => resultCardOf(PAR_6_3, [two(6, lost, destroyed)]).power;
    expect(power(2, 3)).toBe(50);   // 1.5 per loss against par 3
    expect(power(1, 1)).toBe(33);   // 1 / 3 = 33.3
    expect(power(0, 1)).toBe(33);   // no losses: the divisor is 1, not 0
    expect(power(0, 9)).toBe(100);  // 9 / 3 = 300, capped
    expect(power(4, 0)).toBe(0);
    expect(resultCardOf(PAR_6_3, [two(6, 0, 0)]).ratio).toBe(0); // 0 / max(1, 0): defined, not NaN
  });

  it('pools the agent\'s whole side: player 0 and every ally on its team, and never the enemy\'s numbers', () => {
    // team 0: players 0 and 1 (lost 1 + 3, destroyed 2 + 4); team 1: player 2 (lost 6, destroyed 4)
    const s = stateOf({ teams: [0, 0, 1], stats: [[1, 2], [3, 4], [6, 4]], cycle: 6, winnerTeam: 0 });
    const card = resultCardOf(PAR_6_3, [s]);
    expect(card.lost).toBe(4);
    expect(card.destroyed).toBe(6);
    expect(card.ratio).toBe(1.5);
    expect(card.power).toBe(50); // 1.5 / 3
    // known-bad: player 0 alone would have read 2 destroyed per 1 lost, a Power of 67
    expect(card.power).not.toBe(67);
  });

  it('reads "the side" from the mission\'s player 0, so a mission whose agent is on team 1 pools team 1', () => {
    const s = stateOf({ teams: [1, 0], stats: [[2, 5], [5, 2]], cycle: 6, winnerTeam: 1 });
    const mission = { par: { cycles: 6, power: 3 }, players: [{ faction: 'helion', commander: 'agent', controller: 'human', team: 1 }] satisfies Mission['players'] };
    expect(resultCardOf(mission, [s])).toMatchObject({ lost: 2, destroyed: 5, outcome: 'victory' });
  });

  it('counts the cycle of the LAST ACTION as the cycles taken: a battle stopped at the cap read 30, not the 31 the final state shows', () => {
    // states: the start (cycle 1), the last action's state (cycle 30), and the end turn that began cycle 31 (final)
    const states = [two(1, 0, 0, null), two(30, 0, 0, null), two(31, 0, 0, null)];
    expect(resultCardOf(PAR_6_3, states).cycles).toBe(30);
    // a decided battle: the final action is in the cycle the final state reads, so the two agree
    expect(resultCardOf(PAR_6_3, [two(1, 0, 0), two(5, 1, 3), two(5, 1, 3)]).cycles).toBe(5);
    // a recording with a single state has no earlier one to read
    expect(resultCardOf(PAR_6_3, [two(4, 0, 0)]).cycles).toBe(4);
  });

  it('refuses a recording with no states, a mission whose side has no players, and a par that is not a positive number', () => {
    expect(() => resultCardOf(PAR_6_3, [])).toThrow(/no states/);
    expect(() => resultCardOf({ ...PAR_6_3, players: [{ ...PAR_6_3.players[0], team: 9 }] }, [two(5, 1, 3)])).toThrow(/no player is on team 9/);
    expect(() => resultCardOf(par(0, 3), [two(5, 1, 3)])).toThrow(RangeError);
    expect(() => resultCardOf(par(6, 0), [two(5, 1, 3)])).toThrow(RangeError);
  });
});

describe('the rank rule', () => {
  const rank = (speed: number, power: number): Rank | null => rankOf(speed, power, 'victory');

  it('adds Speed and Power and ranks them S from 180, A from 150, B from 100, C below, at each boundary', () => {
    expect(rank(100, 100)).toBe('S');
    expect(rank(90, 90)).toBe('S');   // 180 exactly
    expect(rank(90, 89)).toBe('A');   // 179
    expect(rank(100, 50)).toBe('A');  // 150 exactly
    expect(rank(100, 49)).toBe('B');  // 149
    expect(rank(50, 50)).toBe('B');   // 100 exactly
    expect(rank(50, 49)).toBe('C');   // 99
    expect(rank(0, 0)).toBe('C');
    expect(rank(0, 100)).toBe('B');   // one score alone can still carry a B, never an S
    expect(rank(100, 0)).toBe('B');
  });

  it('gives a rank to a victory only: a fast defeat and a full-marks undecided battle get none (known-bad)', () => {
    for (const outcome of ['defeat', 'undecided'] as const) expect(rankOf(100, 100, outcome), outcome).toBeNull();
    expect(resultCardOf(PAR_6_3, [two(3, 0, 9, 1)]).rank).toBeNull();     // Speed 100 and Power 100, but team 1 won: a defeat
    expect(resultCardOf(PAR_6_3, [two(3, 0, 9, null)]).rank).toBeNull();  // the same numbers with nobody having won
    expect(resultCardOf(PAR_6_3, [two(3, 0, 9, 0)]).rank).toBe('S');
  });

  it('puts the rank on the card from the two scores the card shows', () => {
    // cycles 9 against par 6: Speed 50. 3 destroyed, 2 lost against par 3: Power 50. 100 in all: a B.
    expect(resultCardOf(PAR_6_3, [two(9, 2, 3)])).toMatchObject({ speed: 50, power: 50, rank: 'B' });
    // cycles 7: Speed 83. Power 100 (3 per loss against par 3). 183: an S.
    expect(resultCardOf(PAR_6_3, [two(7, 1, 3)])).toMatchObject({ speed: 83, power: 100, rank: 'S' });
  });

  it('states the rule it applies: the floors in the text are the floors in the code', () => {
    for (const [r, floor] of RANK_FLOORS) expect(RANK_RULE, r).toContain(`${r} from ${floor}`);
    expect(RANK_RULE).toMatch(/C below/);
    expect(RANK_RULE).toMatch(/victory/);
    expect(SPEED_RULE).toMatch(/par/);
    expect(POWER_RULE).toMatch(/par/);
    expect(RANK_FLOORS.map(([r]) => r)).toEqual(['S', 'A', 'B']);
  });
});

describe('how a battle ended', () => {
  it('is a victory when player 0\'s team won, a defeat when another did, and undecided at the cap', () => {
    expect(resultCardOf(PAR_6_3, [two(5, 1, 3, 0)]).outcome).toBe('victory');
    expect(resultCardOf(PAR_6_3, [two(5, 1, 3, 1)]).outcome).toBe('defeat');
    expect(resultCardOf(PAR_6_3, [two(30, 1, 3, null)]).outcome).toBe('undecided');
  });

  it('has a heading for each: Victory, Defeat, Undecided', () => {
    expect(VERDICTS).toEqual({ victory: 'Victory', defeat: 'Defeat', undecided: 'Undecided' });
  });
});

describe('what is read over the card', () => {
  const first = MISSIONS[0];

  it('reads the mission\'s own debrief for a victory', () => {
    expect(debriefLines(first, { outcome: 'victory', cycles: 5 })).toEqual(first.debrief);
    expect(first.debrief.length).toBeGreaterThan(0);
  });

  it('reads one short neutral line for a defeat, and none of the mission\'s debrief', () => {
    const lines = debriefLines(first, { outcome: 'defeat', cycles: 3 });
    expect(lines).toHaveLength(1);
    expect(lines[0].speaker).toBe('narrator');
    expect(lines[0].text).toMatch(/lost/i);
    for (const d of first.debrief) expect(lines.map((l) => l.text)).not.toContain(d.text);
  });

  it('reads one short neutral line for an undecided battle, and says at which cycle the recording stopped', () => {
    const lines = debriefLines(first, { outcome: 'undecided', cycles: 30 });
    expect(lines).toHaveLength(1);
    expect(lines[0].speaker).toBe('narrator');
    expect(lines[0].text).toContain('cycle 30');
    expect(lines[0].text).toMatch(/undecided/i);
    expect(debriefLines(first, { outcome: 'undecided', cycles: 17 })[0].text).toContain('cycle 17');
  });

  it('names nothing in the neutral lines, for any mission: no later act\'s reveal can reach a defeat or an undecided battle', () => {
    const reveals = /vesper|lattice|\bmira\b|\bcantor\b|choir|echo|rook|ilse|sefa|dax|juno|maru|corvin|sable/i;
    for (const m of MISSIONS) {
      for (const outcome of ['defeat', 'undecided'] as const) {
        for (const l of debriefLines(m, { outcome, cycles: 30 })) expect(l.text, `${m.id} ${outcome}`).not.toMatch(reveals);
      }
    }
    // the scanner can fail: a planted line is caught
    expect('VESPER was listening').toMatch(reveals);
  });
});

describe('the next mission', () => {
  it('is the mission one place later in the campaign, for every mission but the last, which has none', () => {
    const byOrder = [...MISSIONS].sort((a, b) => a.order - b.order);
    expect(byOrder.length).toBeGreaterThan(1);
    byOrder.forEach((m, i) => {
      const want = byOrder[i + 1];
      expect(nextMissionOf(m)?.id, m.id).toBe(want?.id);
    });
    expect(nextMissionOf(byOrder[byOrder.length - 1])).toBeUndefined();
  });

  it('finds the next whatever order the missions are listed in, and has none for a mission past the end (known-bad)', () => {
    const shuffled = [MISSIONS[2], MISSIONS[0], MISSIONS[1]];
    expect(nextMissionOf(MISSIONS[0], shuffled)?.id).toBe(MISSIONS[1].id);
    expect(nextMissionOf({ order: 99 })).toBeUndefined();
    expect(nextMissionOf({ order: 0 })?.id).toBe(MISSIONS.find((m) => m.order === 1)?.id);
  });
});
