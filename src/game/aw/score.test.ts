import { describe, expect, it } from 'vitest';
import { applyAction, scoreCard } from './index';
import { DEFAULT_PAR } from './score';
import { fixtureGame } from './testing';
import type { GameState, Player } from './types';

type Stats = Partial<Player['stats']>;

/** A finished-looking game: player 0 has the given stats and the game stands in the given cycle. */
function game(cycle: number, stats: Stats = {}, other: Stats = {}): GameState {
  const s = fixtureGame(['..'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }]);
  const patch = (p: Player, extra: Stats): Player => ({ ...p, stats: { ...p.stats, unitsStarted: 0, ...extra } });
  return { ...s, cycle, players: s.players.map((p) => (p.index === 0 ? patch(p, stats) : patch(p, other))) };
}

describe('Speed', () => {
  const speed = (cycle: number, par = 10) => scoreCard(game(cycle), 0, { cycles: par, power: 2 }).speed;

  it('is 100 at or under par, then falls 100/par per cycle over, to a floor of 0', () => {
    expect(speed(1)).toBe(100);
    expect(speed(10)).toBe(100);
    expect(speed(11)).toBe(90); // 100 - 100 x 1/10
    expect(speed(15)).toBe(50); // 100 - 100 x 5/10
    expect(speed(20)).toBe(0); // twice par
    expect(speed(35)).toBe(0); // never negative
  });

  it('rounds to the nearest whole point', () => {
    expect(speed(4, 3)).toBe(67); // 100 - 100 x 1/3 = 66.67
    expect(speed(5, 3)).toBe(33); // 100 - 100 x 2/3 = 33.33
    expect(speed(9, 8)).toBe(88); // 100 - 12.5 = 87.5 rounds up
  });
});

describe('Power', () => {
  const power = (destroyed: number, lost: number, parPower = 2) =>
    scoreCard(game(1, { unitsDestroyed: destroyed, unitsLost: lost }), 0, { cycles: 10, power: parPower }).power;

  it('is kills per own loss measured against par, capped at 100', () => {
    expect(power(4, 2)).toBe(100); // ratio 2 against par 2
    expect(power(3, 2)).toBe(75); // ratio 1.5 -> 75% of par
    expect(power(1, 2)).toBe(25);
    expect(power(0, 5)).toBe(0);
    expect(power(40, 2)).toBe(100); // far above par is still 100
  });

  it('treats having lost nothing as one loss, so a clean win is not a divide by zero', () => {
    expect(power(1, 0)).toBe(50); // 1 kill / 1 = ratio 1 against par 2
    expect(power(2, 0)).toBe(100);
    expect(power(0, 0)).toBe(0);
  });

  it('moves with par: a harder par lowers the same performance', () => {
    expect(power(6, 2, 3)).toBe(100);
    expect(power(6, 2, 6)).toBe(50);
  });
});

describe('Technique', () => {
  const technique = (lost: number, built: number, started: number) =>
    scoreCard(game(1, { unitsLost: lost, unitsBuilt: built, unitsStarted: started }), 0, { cycles: 10, power: 2 }).technique;

  it('is 100 when losing 10% or less, 80 at 20%, and 0 from 60% up', () => {
    expect(technique(0, 4, 6)).toBe(100); // lost none
    expect(technique(1, 4, 6)).toBe(100); // 1 of 10 = 10%: exactly the free allowance
    expect(technique(2, 4, 6)).toBe(80); // 20%
    expect(technique(3, 4, 6)).toBe(60); // 30%
    expect(technique(6, 4, 6)).toBe(0); // 60%
    expect(technique(9, 4, 6)).toBe(0); // never negative
  });

  it('counts built units and starting units together as the units fielded', () => {
    expect(technique(2, 0, 10)).toBe(80); // 2 of 10
    expect(technique(2, 10, 0)).toBe(80); // 2 of 10
    expect(technique(2, 5, 5)).toBe(80); // 2 of 10
    expect(technique(2, 0, 5)).toBe(40); // 2 of 5 = 40% lost: 120 - 80
  });

  it('copes with a player who fielded nothing', () => {
    expect(technique(0, 0, 0)).toBe(100);
    expect(technique(1, 0, 0)).toBe(0); // 1 lost over max(1, 0)
  });

  it('treats a missing unitsStarted (older saves) as none', () => {
    const s = game(1, { unitsLost: 2, unitsBuilt: 10 });
    const bare = { ...s, players: s.players.map((p) => (p.index === 0 ? { ...p, stats: { ...p.stats, unitsStarted: undefined } } : p)) };
    expect(scoreCard(bare, 0, { cycles: 10, power: 2 }).technique).toBe(80);
  });
});

describe('total and rank', () => {
  // Each row builds exact sub-scores by hand, then checks the sum and the letter. par = { cycles: 5, power: 2 } unless noted.
  //   Speed 100 whenever cycle <= 5.  Power 100 when kills / max(1, lost) = 2.  Technique = 120 - 200 x lost / (built + started).
  const rows: { name: string; cycle: number; par: { cycles: number; power: number }; stats: Stats; expected: [number, number, number, number, string] }[] = [
    // lost 2 of 10 -> Technique 120 - 40 = 80; kills 4 / lost 2 = 2 -> Power 100
    { name: '280 is S', cycle: 5, par: { cycles: 5, power: 2 }, stats: { unitsLost: 2, unitsStarted: 6, unitsBuilt: 4, unitsDestroyed: 4 }, expected: [100, 100, 80, 280, 'S'] },
    // lost 41 of 200 -> Technique 120 - 41 = 79; kills 82 / 41 = 2 -> Power 100
    { name: '279 is A', cycle: 5, par: { cycles: 5, power: 2 }, stats: { unitsLost: 41, unitsStarted: 150, unitsBuilt: 50, unitsDestroyed: 82 }, expected: [100, 100, 79, 279, 'A'] },
    // lost 7 of 20 -> Technique 120 - 70 = 50; kills 14 / 7 = 2 -> Power 100
    { name: '250 is A', cycle: 5, par: { cycles: 5, power: 2 }, stats: { unitsLost: 7, unitsStarted: 12, unitsBuilt: 8, unitsDestroyed: 14 }, expected: [100, 100, 50, 250, 'A'] },
    // lost 71 of 200 -> Technique 120 - 71 = 49; kills 142 / 71 = 2 -> Power 100
    { name: '249 is B', cycle: 5, par: { cycles: 5, power: 2 }, stats: { unitsLost: 71, unitsStarted: 100, unitsBuilt: 100, unitsDestroyed: 142 }, expected: [100, 100, 49, 249, 'B'] },
    // lost 6 of 10 -> Technique 120 - 120 = 0; kills 12 / 6 = 2 -> Power 100
    { name: '200 is B', cycle: 5, par: { cycles: 5, power: 2 }, stats: { unitsLost: 6, unitsStarted: 5, unitsBuilt: 5, unitsDestroyed: 12 }, expected: [100, 100, 0, 200, 'B'] },
    // par.power 50: kills 297 / 6 = 49.5 -> 100 x 49.5 / 50 = 99
    { name: '199 is C', cycle: 5, par: { cycles: 5, power: 50 }, stats: { unitsLost: 6, unitsStarted: 5, unitsBuilt: 5, unitsDestroyed: 297 }, expected: [100, 99, 0, 199, 'C'] },
    // Speed can be the point that decides it: cycle 6 against par 5 -> 100 - 20 = 80, so 80 + 100 + 100 = 280 again
    { name: 'a late finish costs Speed', cycle: 6, par: { cycles: 5, power: 2 }, stats: { unitsLost: 0, unitsStarted: 10, unitsDestroyed: 4 }, expected: [80, 100, 100, 280, 'S'] },
    { name: 'a perfect game is 300', cycle: 1, par: { cycles: 5, power: 2 }, stats: { unitsLost: 0, unitsStarted: 3, unitsDestroyed: 9 }, expected: [100, 100, 100, 300, 'S'] },
    { name: 'a worst game is 0', cycle: 40, par: { cycles: 5, power: 2 }, stats: { unitsLost: 9, unitsStarted: 3, unitsDestroyed: 0 }, expected: [0, 0, 0, 0, 'C'] },
  ];

  it.each(rows)('$name', ({ cycle, par, stats, expected }) => {
    const card = scoreCard(game(cycle, stats), 0, par);
    expect([card.speed, card.power, card.technique, card.total, card.rank]).toEqual(expected);
    expect(card.total).toBe(card.speed + card.power + card.technique);
  });

  it('keeps every part inside 0-100 for odd input', () => {
    for (const stats of [{ unitsLost: 999 }, { unitsDestroyed: 999, unitsStarted: 1 }, { unitsBuilt: 50, unitsLost: 0 }]) {
      for (const cycle of [1, 7, 500]) {
        const c = scoreCard(game(cycle, stats), 0, { cycles: 7, power: 1.5 });
        for (const part of [c.speed, c.power, c.technique]) {
          expect(Number.isInteger(part)).toBe(true);
          expect(part).toBeGreaterThanOrEqual(0);
          expect(part).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('arguments', () => {
  it('uses the default par when none is given', () => {
    const s = game(14, { unitsDestroyed: 3, unitsLost: 2, unitsStarted: 5, unitsBuilt: 5 });
    expect(scoreCard(s, 0)).toEqual(scoreCard(s, 0, DEFAULT_PAR));
    expect(DEFAULT_PAR.cycles).toBeGreaterThan(0);
    expect(DEFAULT_PAR.power).toBeGreaterThan(0);
    const c = scoreCard(s, 0);
    expect(c.speed).toBeLessThan(100); // 14 cycles is over any sensible default
    expect(c.speed).toBeGreaterThan(0);
  });

  it('refuses a par that would read as unlimited or is not a number, and a player that does not exist', () => {
    const s = game(3);
    expect(() => scoreCard(s, 0, { cycles: 0, power: 2 })).toThrow(RangeError);
    expect(() => scoreCard(s, 0, { cycles: 5, power: 0 })).toThrow(RangeError);
    expect(() => scoreCard(s, 0, { cycles: -1, power: 2 })).toThrow(RangeError);
    expect(() => scoreCard(s, 0, { cycles: Number.NaN, power: 2 })).toThrow(RangeError);
    expect(() => scoreCard(s, 0, { cycles: 5, power: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => scoreCard(s, 2)).toThrow(RangeError);
    expect(() => scoreCard(s, -1)).toThrow(RangeError);
  });

  it('scores the player it is asked about', () => {
    const s = game(3, { unitsDestroyed: 4, unitsLost: 0, unitsStarted: 4 }, { unitsDestroyed: 0, unitsLost: 4, unitsStarted: 4 });
    const par = { cycles: 5, power: 2 };
    expect(scoreCard(s, 0, par)).toMatchObject({ power: 100, technique: 100 });
    expect(scoreCard(s, 1, par)).toMatchObject({ power: 0, technique: 0 });
  });
});

describe('with the real engine', () => {
  it('scores a short game from the stats the engine itself kept', () => {
    const s = fixtureGame(['...'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 2, y: 0, hp: 1 }]);
    const { state } = applyAction(s, {
      kind: 'move', unitId: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], then: { kind: 'attack', target: { x: 2, y: 0 } },
    });
    expect(state.winnerTeam).toBe(0);
    const par = { cycles: 5, power: 4 };
    // Winner: finished in cycle 1 (Speed 100), 1 kill / max(1, 0 lost) = 1 against par 4 (Power 25), lost 0 of 1 (Technique 100).
    expect(scoreCard(state, 0, par)).toEqual({ speed: 100, power: 25, technique: 100, total: 225, rank: 'B' });
    // Loser: no kills (Power 0), lost its only unit: 120 - 200 x 1/1 < 0, floored to 0. Speed is the game's, not the player's.
    expect(scoreCard(state, 1, par)).toEqual({ speed: 100, power: 0, technique: 0, total: 100, rank: 'C' });
  });
});
