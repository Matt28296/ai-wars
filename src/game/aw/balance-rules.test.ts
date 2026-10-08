// M3.2: the rules the balance run exposed (docs/delivery/DECISIONS.md D-004, D-012-D-016; docs/research/mechanics.md 2, 4.8, 6, 12).
//   1. forecast() answers "no attack" for a target the attacker cannot strike from the tile it is asked about (out of range, no weapon),
//      the same answer it gives for an unseen target, so it neither invents damage nor tells a fogged player anything.
//   2. observe() and observedState() hide what an ENEMY transport carries (cargo: []) and say only whether it carries anything (`loaded`).
//   3. createGame's `firstMoverRule` pays the player who moves first back: 'none' (the old rule), 'noFirstIncome', 'gradedFirstIncome' (M3.3),
//      'secondBonus'. A game that names no rule gets the default for its player count (M3.3: defaultFirstMoverRule).
// Expected answers are worked out here from the rules and the damage chart, never read back from the code under test. Every check has
// a known-bad twin: the position or the checker with the one thing that matters taken away, where it must fail.
import { afterEach, describe, expect, it } from 'vitest';
import type { CommanderDef } from '../../content/types';
import { TERRAIN_TYPES } from '../../data';
import { DAMAGE } from '../../data/damage';
import {
  DEFAULT_FIRST_MOVER_RULE, FIRST_MOVER_RULES, SECOND_BONUS_PER_SEAT, applyAction, canSeeUnit, createGame, defaultFirstMoverRule, forecast,
  gradedFirstIncomeShare, resetCommanderRegistry, setCommanderRegistry,
} from './index';
import type { CreateGameOptions, FirstMoverRule, PlayerSetup } from './index';
import { observe, observedState } from './observe';
import type { ObservedUnit } from './observe';
import { fixtureGame, fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import type { Coord, GameState, Modifier, Unit, UnitTypeId } from './types';

// ---------------------------------------------------------------- helpers

const at = (x: number, y: number): Coord => ({ x, y });
const unit = (type: UnitTypeId, owner: number, x: number, y: number, hp?: number): FixtureUnit => ({ type, owner, x, y, ...(hp ? { hp } : {}) });
const row = (n: number, tile = '.') => tile.repeat(n);
const NONE = { damage: [0, 0], counter: null };

const chart = (a: UnitTypeId, d: UnitTypeId): number => {
  const v = DAMAGE[a].primary?.[d];
  if (v === undefined) throw new Error(`no primary ${a} vs ${d}`);
  return v;
};
/** Spec 4.1 in integer form for a full-HP attacker and defender on one tile type, at the bottom and top of the default luck range 0..9. */
function damageRange(base: number, tile: keyof typeof TERRAIN_TYPES): [number, number] {
  const stars = TERRAIN_TYPES[tile].def;
  const hit = (luck: number) => Math.floor(((base * 100 + 100 * luck) * 10 * (200 - (100 + stars * 10))) / 100_000);
  return [hit(0), hit(9)];
}

function useCommander(id: string, mods: Modifier[]): void {
  const def: CommanderDef = {
    id, name: id, initials: 'T', faction: null, title: 'test', pronouns: 'they/them', bio: '', voice: '',
    passive: { name: 'test', description: '', modifiers: mods }, surge: null, overclock: null,
    lines: { select: '', victory: '', defeat: '' }, playable: false,
  };
  setCommanderRegistry({ [id]: def });
}
afterEach(() => resetCommanderRegistry());

// ---------------------------------------------------------------- 1. forecast respects range and weapons

describe('forecast: a target the attacker cannot strike from that tile gets the "no attack" answer', () => {
  // An arc (indirect, range 2-3) at (0,0); a lancer on the same flat row at distance `d`.
  const arcVsLancer = (d: number, extra: FixtureUnit[] = []) => fixtureGame([row(9)], [unit('arc', 0, 0, 0), unit('lancer', 1, d, 0), ...extra]);
  const arcForecast = (d: number) => forecast(arcVsLancer(d), 1, at(0, 0), at(d, 0));

  it('the premise: the chart gives the arc a real weapon against a lancer, so zero is the range talking', () => {
    expect(chart('arc', 'lancer')).toBe(70);
    expect(damageRange(70, 'flats')).toEqual([63, 71]); // the figures the old forecast returned for an arc six tiles away
  });

  it('an arc six tiles from a lancer: no damage, no counter (it used to answer 63-71)', () => {
    expect(arcForecast(6)).toEqual(NONE);
  });

  it('control, in range: at distance 2 and 3 the forecast is the full chart damage', () => {
    const expected = damageRange(chart('arc', 'lancer'), 'flats');
    expect(arcForecast(2).damage).toEqual(expected);
    expect(arcForecast(3).damage).toEqual(expected);
    expect(arcForecast(3).counter, 'an indirect strike is never countered').toBeNull();
  });

  it('the edges of the band: one tile too far (4) and one tile too close (1) are both "no attack"', () => {
    expect(arcForecast(4)).toEqual(NONE);
    expect(arcForecast(1)).toEqual(NONE);
  });

  it('a direct unit (range 1) two tiles away has nothing to strike with', () => {
    const s = fixtureGame([row(5)], [unit('lancer', 0, 0, 0), unit('lancer', 1, 2, 0)]);
    expect(forecast(s, 1, at(0, 0), at(2, 0))).toEqual(NONE);
    const adjacent = fixtureGame([row(5)], [unit('lancer', 0, 0, 0), unit('lancer', 1, 1, 0)]);
    expect(forecast(adjacent, 1, at(0, 0), at(1, 0)).damage, 'control: adjacent is in range').toEqual(damageRange(chart('lancer', 'lancer'), 'flats'));
  });

  it('the range is measured from the tile asked about, not from where the unit stands now', () => {
    const s = fixtureGame([row(9)], [unit('lancer', 0, 0, 0), unit('lancer', 1, 6, 0)]);
    expect(forecast(s, 1, at(0, 0), at(6, 0)), 'from where it stands: six tiles').toEqual(NONE);
    expect(forecast(s, 1, at(5, 0), at(6, 0)).damage, 'from the tile it could move to: adjacent').toEqual(damageRange(chart('lancer', 'lancer'), 'flats'));
  });

  it('a commander range bonus counts: with +1 max range an arc reaches four tiles, and not five', () => {
    useCommander('longarm', [{ rangeMax: 1 }]);
    const boosted = (d: number) => {
      const s = createGame({
        map: fixtureMap([row(9)], [unit('arc', 0, 0, 0), unit('lancer', 1, d, 0)]),
        players: [
          { faction: 'helion', commander: 'longarm', controller: 'ai', team: 0 },
          { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
        ],
        seed: 1,
      });
      return forecast(s, 1, at(0, 0), at(d, 0));
    };
    expect(boosted(4).damage, 'distance 4 is now in range').toEqual(damageRange(chart('arc', 'lancer'), 'flats'));
    expect(boosted(5)).toEqual(NONE);
  });

  it('no usable weapon: a unit with no weapon at all, a dry gun with no secondary, a gun with nothing against that target', () => {
    // the mule has an empty chart row
    expect(forecast(fixtureGame([row(3)], [unit('mule', 0, 0, 0), unit('lancer', 1, 1, 0)]), 1, at(0, 0), at(1, 0))).toEqual(NONE);
    // the arc out of ammo, and the arc has no secondary weapon
    expect(DAMAGE.arc.secondary).toBeUndefined();
    const dry = fixtureGame([row(5)], [unit('arc', 0, 0, 0), unit('lancer', 1, 2, 0)]);
    const emptied = { ...dry, units: dry.units.map((u) => (u.type === 'arc' ? { ...u, ammo: 0 } : u)) };
    expect(forecast(emptied, 1, at(0, 0), at(2, 0))).toEqual(NONE);
    expect(forecast(dry, 1, at(0, 0), at(2, 0)).damage, 'control: with ammo it is a strike').toEqual(damageRange(chart('arc', 'lancer'), 'flats'));
    // a lancer next to a wasp: no weapon in its chart reaches air except the weak secondary; a warden-less colossus has none either way
    const air = fixtureGame([row(3)], [unit('bastion', 0, 0, 0), unit('raptor', 1, 1, 0)]);
    expect(DAMAGE.bastion.primary?.raptor).toBeUndefined();
    expect(DAMAGE.bastion.secondary?.raptor).toBeUndefined();
    expect(forecast(air, 1, at(0, 0), at(1, 0))).toEqual(NONE);
  });

  it('it is the SAME answer the forecast gives for a target the attacker cannot see (nothing is revealed by a range refusal)', () => {
    // Fog: our arc sees two tiles. An enemy lancer on canopy two tiles away is hidden (canopy hides a unit from anyone not adjacent).
    const fogged = fixtureGame(['..f......'], [unit('arc', 0, 0, 0), unit('lancer', 1, 2, 0)], { fog: true });
    const hiddenLancer = fogged.units.find((u) => u.type === 'lancer')!;
    expect(canSeeUnit(fogged, 0, hiddenLancer), 'the premise: our side cannot see it').toBe(false);
    const unseen = forecast(fogged, 1, at(0, 0), at(2, 0));
    const outOfRange = forecast(arcVsLancer(6), 1, at(0, 0), at(6, 0));
    expect(unseen).toEqual(outOfRange);
    expect(unseen).toEqual(NONE);
    // and the empty tile answers the same
    expect(forecast(arcVsLancer(6), 1, at(0, 0), at(5, 0))).toEqual(NONE);
  });
});

// ---------------------------------------------------------------- 2. an enemy transport's cargo is not public

describe('observe: an enemy transport shows cargo [] and a boolean `loaded`', () => {
  const withCargo = (s: GameState, transportId: number, cargo: Unit[]): GameState => ({
    ...s,
    units: s.units.map((u) => (u.id === transportId ? { ...u, cargo: cargo.map((c) => ({ ...c, x: u.x, y: u.y })) } : u)),
  });
  const passenger = (s: GameState, type: UnitTypeId, owner: number): Unit => ({
    id: s.nextUnitId + 50, type, owner, x: 0, y: 0, hp: 100, charge: 0, ammo: 0, acted: false, cargo: [],
  });
  const find = (units: ObservedUnit[], id: number): ObservedUnit => units.find((u) => u.id === id)!;

  // ids follow the fixture order: 1 = our trooper, 2 = our mule, 3 = enemy mule, 4 = enemy trooper
  const board = (): GameState => fixtureGame([row(8)], [unit('trooper', 0, 0, 0), unit('mule', 0, 1, 0), unit('mule', 1, 3, 0), unit('trooper', 1, 5, 0)]);

  it('an enemy mule carrying a trooper: cargo is empty and loaded is true; the state itself is untouched', () => {
    const base = board();
    const s = withCargo(base, 3, [passenger(base, 'trooper', 1)]);
    const o = observe(s, 0);
    const shown = find(o.units, 3);
    expect(shown.cargo).toEqual([]);
    expect(shown.loaded).toBe(true);
    expect(s.units.find((u) => u.id === 3)!.cargo, 'observe never edits the state').toHaveLength(1);
  });

  it('an empty enemy transport reads loaded false, and every unit that cannot carry reads loaded false', () => {
    const o = observe(board(), 0);
    expect(find(o.units, 3).loaded).toBe(false);
    expect(find(o.units, 4).loaded).toBe(false);
    expect(find(o.units, 1).loaded).toBe(false);
    for (const u of o.units) expect(typeof u.loaded, `unit ${u.id}`).toBe('boolean');
  });

  it('the viewer\'s own transport keeps its full cargo, and says loaded', () => {
    const base = board();
    const p = passenger(base, 'breacher', 0);
    const s = withCargo(base, 2, [p]);
    const mine = find(observe(s, 0).units, 2);
    expect(mine.cargo).toHaveLength(1);
    expect(mine.cargo[0]).toMatchObject({ id: p.id, type: 'breacher', owner: 0 });
    expect(mine.loaded).toBe(true);
  });

  it('an ALLIED transport keeps its full cargo; the enemy of that same viewer does not', () => {
    // three players: 0 and 1 are one team, 2 is the enemy
    const players: PlayerSetup[] = [
      { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
      { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
      { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
    ];
    const g = createGame({ map: fixtureMap([row(8)], [unit('trooper', 0, 0, 0), unit('mule', 1, 1, 0), unit('mule', 2, 3, 0)]), players, seed: 1 });
    const loadedBoth = withCargo(withCargo(g, 2, [passenger(g, 'trooper', 1)]), 3, [passenger(g, 'trooper', 2)]);
    const o = observe(loadedBoth, 0);
    expect(find(o.units, 2).cargo, 'the ally\'s mule').toHaveLength(1);
    expect(find(o.units, 2).loaded).toBe(true);
    expect(find(o.units, 3).cargo, 'the enemy\'s mule').toEqual([]);
    expect(find(o.units, 3).loaded).toBe(true);
  });

  it('what is inside is not leaked even by its identity: the observation is the same whether the enemy mule carries a trooper or a breacher', () => {
    const base = board();
    const a = observe(withCargo(base, 3, [passenger(base, 'trooper', 1)]), 0);
    const b = observe(withCargo(base, 3, [passenger(base, 'breacher', 1)]), 0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('observedState, the copy the agent runs its queries on, hides it too', () => {
    const base = board();
    const s = withCargo(base, 3, [passenger(base, 'trooper', 1)]);
    const view = observedState(s, 0);
    expect(view.units.find((u) => u.id === 3)!.cargo).toEqual([]);
    expect(s.units.find((u) => u.id === 3)!.cargo, 'the true state keeps it').toHaveLength(1);
  });

  it('known-bad twin: a leaky observation (the raw state\'s units) is caught by the same check, so a green result means something', () => {
    const base = board();
    const s = withCargo(base, 3, [passenger(base, 'trooper', 1)]);
    const leaksEnemyCargo = (units: Unit[], state: GameState, viewer: number) =>
      units.some((u) => state.players[u.owner].team !== state.players[viewer].team && u.cargo.length > 0);
    expect(leaksEnemyCargo(s.units, s, 0), 'the raw units leak').toBe(true);
    expect(leaksEnemyCargo(observe(s, 0).units, s, 0), 'the observation does not').toBe(false);
    expect(leaksEnemyCargo(observedState(s, 0).units, s, 0)).toBe(false);
  });

  it('hidden enemies stay indistinguishable: a transport loaded or not out of sight changes nothing the viewer is told', () => {
    // fog on, the enemy mule two tiles away on canopy, out of sight
    const fogged = fixtureGame(['...f....'], [unit('trooper', 0, 0, 0), unit('mule', 1, 3, 0)], { fog: true });
    expect(canSeeUnit(fogged, 0, fogged.units.find((u) => u.type === 'mule')!), 'the premise: it is hidden').toBe(false);
    const loaded = withCargo(fogged, 2, [passenger(fogged, 'trooper', 1)]);
    expect(JSON.stringify(observe(loaded, 0))).toBe(JSON.stringify(observe(fogged, 0)));
    expect(observe(fogged, 0).units.map((u) => u.id)).toEqual([1]);
  });
});

// ---------------------------------------------------------------- 3. first-mover compensation

describe('createGame firstMoverRule', () => {
  // Each player owns one fabricator (income 1000 each); the rest is flats.
  const START = 1500;
  const OWN3 = ['0.1.2', '.....'];
  const players = (n: number): PlayerSetup[] =>
    Array.from({ length: n }, (_, i) => ({ faction: 'helion' as const, commander: 'none', controller: 'ai' as const, team: i }));
  const game = (n: number, rule?: FirstMoverRule, extra: Partial<CreateGameOptions> = {}): GameState => {
    const owners = n === 2 ? ['0...1', '.....'] : OWN3;
    const terrain = n === 2 ? ['F...F', '.....'] : ['F.F.F', '.....'];
    return createGame({
      map: fixtureMap(terrain, [], owners), players: players(n), seed: 1, startFunds: START,
      ...(rule ? { firstMoverRule: rule } : {}), ...extra,
    });
  };
  const funds = (s: GameState) => s.players.map((p) => p.funds);
  const endTurn = (s: GameState) => applyAction(s, { kind: 'endTurn' }).state;

  it('the premise: a fabricator pays 1000', () => {
    expect(TERRAIN_TYPES.fabricator.income).toBe(1000);
  });

  it("'none' is the old rule: player 0 collects cycle-1 income, nobody gets a bonus", () => {
    const s = game(2, 'none');
    expect(funds(s)).toEqual([START + 1000, START]);
    expect(funds(game(3, 'none'))).toEqual([START + 1000, START, START]);
  });

  it("'noFirstIncome': player 0 collects nothing on cycle 1, and everyone else is untouched", () => {
    const s = game(2, 'noFirstIncome');
    expect(funds(s)).toEqual([START, START]);
    expect(s.cycle).toBe(1);
    // player 1 is paid at THEIR first start of turn as usual
    const afterP0 = endTurn(s);
    expect(afterP0.current).toBe(1);
    expect(funds(afterP0)).toEqual([START, START + 1000]);
    // and player 0 is paid again from cycle 2: the rule skips one payment, once
    const cycle2 = endTurn(afterP0);
    expect(cycle2.cycle).toBe(2);
    expect(funds(cycle2)).toEqual([START + 1000, START + 1000]);
  });

  it("'secondBonus': seat k starts with 1000 x k more; player 0 still collects cycle-1 income", () => {
    expect(SECOND_BONUS_PER_SEAT).toBe(1000);
    expect(funds(game(2, 'secondBonus'))).toEqual([START + 1000, START + 1000]);
    expect(funds(game(3, 'secondBonus'))).toEqual([START + 1000, START + 1000, START + 2000]);
    const four = createGame({
      map: fixtureMap(['F.F.F.F'], [], ['0.1.2.3']), players: players(4), seed: 1, startFunds: START, firstMoverRule: 'secondBonus',
    });
    expect(funds(four)).toEqual([START + 1000, START + 1000, START + 2000, START + 3000]);
  });

  it("'secondBonus' adds to a player's own starting funds, and the bonus is paid once", () => {
    const custom = createGame({
      map: fixtureMap(['F...F'], [], ['0...1']),
      players: [
        { faction: 'helion', commander: 'none', controller: 'ai', team: 0, funds: 100 },
        { faction: 'helion', commander: 'none', controller: 'ai', team: 1, funds: 200 },
      ],
      seed: 1, firstMoverRule: 'secondBonus',
    });
    expect(funds(custom)).toEqual([100 + 1000, 200 + 1000]);
    const afterP0 = endTurn(game(2, 'secondBonus'));
    expect(funds(afterP0), 'player 1 then collects their income on top of the bonus').toEqual([START + 1000, START + 1000 + 1000]);
  });

  // Seat 0 owns three fabricators (income 3000), every other seat owns one (1000), so a share of seat 0's income is worked out by hand.
  const FAB = 1000;
  const richGame = (n: number, rule?: FirstMoverRule, extra: Partial<CreateGameOptions> = {}): GameState => {
    const terrain = ['FFF' + 'F'.repeat(n - 1), '.'.repeat(n + 2)];
    const owners = ['000' + Array.from({ length: n - 1 }, (_, i) => String(i + 1)).join(''), '.'.repeat(n + 2)];
    return createGame({
      map: fixtureMap(terrain, [], owners), players: players(n), seed: 1, startFunds: START,
      ...(rule ? { firstMoverRule: rule } : {}), ...extra,
    });
  };

  it("'gradedFirstIncome': player 0 collects (n - 2) / (n - 1) of its first income -- none with two players, half with three, two thirds with four", () => {
    const income = 3 * FAB;
    expect(funds(richGame(2, 'gradedFirstIncome')), 'two players: the same as noFirstIncome').toEqual([START, START]);
    expect(funds(richGame(3, 'gradedFirstIncome')), 'three players: half of 3000').toEqual([START + income / 2, START, START]);
    expect(funds(richGame(4, 'gradedFirstIncome')), 'four players: two thirds of 3000').toEqual([START + (2 * income) / 3, START, START, START]);
    // known-bad twins: the whole income ('none') and no income ('noFirstIncome') are different amounts again
    expect(funds(richGame(3, 'none'))).toEqual([START + income, START, START]);
    expect(funds(richGame(3, 'noFirstIncome'))).toEqual([START, START, START]);
  });

  it("'gradedFirstIncome' is paid in whole hundreds, never a fraction of a fund", () => {
    const one = richGame(4, 'gradedFirstIncome', { map: fixtureMap(['F.', '..'], [], ['0.', '..']) });
    // one fabricator, four players: 2/3 of 1000 is 666.67, which rounds to 700
    expect(one.players[0].funds - START).toBe(700);
    expect(Number.isInteger(one.players[0].funds / 100)).toBe(true);
  });

  it("'gradedFirstIncome' touches player 0's first start of turn only: the others are paid in full at theirs, and player 0 is paid in full from cycle 2", () => {
    const s = richGame(3, 'gradedFirstIncome');
    const afterP0 = endTurn(s);
    expect(funds(afterP0), 'player 1 collects its 1000 as usual').toEqual([START + 1500, START + FAB, START]);
    const afterP1 = endTurn(afterP0);
    expect(funds(afterP1)).toEqual([START + 1500, START + FAB, START + FAB]);
    const cycle2 = endTurn(afterP1);
    expect(cycle2.cycle).toBe(2);
    expect(funds(cycle2), 'player 0: the rest of the income arrives in full, 3000, on top of the half').toEqual([START + 1500 + 3 * FAB, START + FAB, START + FAB]);
  });

  it('gradedFirstIncomeShare: 0 for two players and rising towards 1 as the table fills; a lone seat is not fined', () => {
    expect([2, 3, 4, 5].map(gradedFirstIncomeShare)).toEqual([0, 1 / 2, 2 / 3, 3 / 4]);
    expect(gradedFirstIncomeShare(1)).toBe(1);
  });

  it('every rule leaves the board, units and turn order alone', () => {
    const none = game(2, 'none');
    for (const rule of FIRST_MOVER_RULES) {
      const s = game(2, rule);
      expect(s.tiles).toEqual(none.tiles);
      expect(s.units).toEqual(none.units);
      expect([s.current, s.cycle]).toEqual([0, 1]);
    }
  });

  it('an unknown rule is refused, not played as some other rule', () => {
    expect(() => game(2, 'bonusForEveryone' as FirstMoverRule)).toThrow(/firstMoverRule/);
  });

  it('with no rule named, createGame plays the default for its player count exactly, and each default is one of the named rules', () => {
    for (const n of [2, 3, 4]) {
      expect(FIRST_MOVER_RULES, `${n} players`).toContain(defaultFirstMoverRule(n));
      expect(richGame(n), `${n} players`).toEqual(richGame(n, defaultFirstMoverRule(n)));
    }
    expect(DEFAULT_FIRST_MOVER_RULE, 'the two-player default is the exported constant').toBe(defaultFirstMoverRule(2));
  });

  it("two players default to 'noFirstIncome' (the rule `pnpm balance` found nearest to a fair seat): a game that names no rule pays player 0 nothing on cycle 1", () => {
    expect(DEFAULT_FIRST_MOVER_RULE).toBe('noFirstIncome');
    expect(defaultFirstMoverRule(2)).toBe('noFirstIncome');
    expect(funds(game(2))).toEqual([START, START]);
    expect(funds(game(2, 'none')), 'known-bad twin: the old rule, asked for by name, still pays it').toEqual([START + 1000, START]);
  });

  it("three and four players default to 'gradedFirstIncome', not 'noFirstIncome' (M3.3): player 0 keeps part of its first income there", () => {
    for (const n of [3, 4]) {
      expect(defaultFirstMoverRule(n), `${n} players`).toBe('gradedFirstIncome');
      const share = gradedFirstIncomeShare(n);
      expect(share, `${n} players`).toBeGreaterThan(0);
      const s = richGame(n);
      expect(s.players[0].funds, `${n} players: a share of 3000, in whole hundreds`).toBe(START + Math.round((3000 * share) / 100) * 100);
      expect(s.players[0].funds, 'known-bad twin: not the whole income (that is none)').toBeLessThan(START + 3000);
      expect(s.players[0].funds, 'known-bad twin: not nothing (that is noFirstIncome)').toBeGreaterThan(START);
    }
    expect(richGame(3).players[0].funds).not.toBe(richGame(3, 'noFirstIncome').players[0].funds);
  });

  it('an explicit rule beats the player-count default, in every size of game', () => {
    for (const n of [2, 3, 4]) {
      for (const rule of FIRST_MOVER_RULES) {
        const named = richGame(n, rule);
        const expected = rule === 'gradedFirstIncome' ? START + Math.round((3000 * gradedFirstIncomeShare(n)) / 100) * 100
          : rule === 'none' ? START + 3000 : START;
        expect(named.players[0].funds, `${n} players, ${rule}`).toBe(expected + (rule === 'secondBonus' ? 3000 : 0));
      }
    }
    // known-bad twin: naming 'none' on a three-player game is not the default
    expect(richGame(3, 'none').players[0].funds).not.toBe(richGame(3).players[0].funds);
  });

  it('the rules differ from each other where they should (a rule that changed nothing would fail here)', () => {
    // three players: with two, gradedFirstIncome pays nothing and so reads the same as noFirstIncome, by design
    const f = (r: FirstMoverRule) => JSON.stringify(funds(richGame(3, r)));
    expect(new Set(FIRST_MOVER_RULES.map(f)).size).toBe(FIRST_MOVER_RULES.length);
    expect(JSON.stringify(funds(richGame(2, 'gradedFirstIncome')))).toBe(JSON.stringify(funds(richGame(2, 'noFirstIncome'))));
  });
});
