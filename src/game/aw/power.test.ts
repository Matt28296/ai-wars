// Commander powers (M1.4): the meter, costs, activation, every InstantEffect and every Modifier / UnitFilter field.
// Expected values are computed here from the rules (docs/research/mechanics.md 4.1, 10, 14; DECISIONS D-012), never
// copied from the code under test. Commanders come from a test registry; no real roster is needed.
import { afterEach, describe, expect, it } from 'vitest';
import type { CommanderDef } from '../../content/types';
import {
  IllegalActionError, applyAction, attackTargets, createGame, forecast, incomeOf, isLegal, reachable, thenOptions, unitById,
  visibility,
} from './index';
import {
  DEFAULT_LUCK_MAX, DEFAULT_LUCK_MIN, STANDARD_POWER_MODIFIER, activeModifiers, canFireAfterMove, commanderDef, defenseBonus,
  effectiveMove, effectiveRange, effectiveVision, firepowerBonus, hasCounterFirst, ignoredMoveCosts, luckRange, matchesFilter,
  resetCommanderRegistry, setCommanderRegistry, sumField, terrainStarsFor, unitCost, unitModifiers,
} from './modifiers';
import { POWER_STAR, applyEffect, canActivatePower, gainPower, meterCap, powerCost, powerDef, powerStars, starValue } from './power';
import { displayHp, draft, unitType } from './state';
import { fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import type { Action, GameEvent, GameState, InstantEffect, Modifier, Player, PowerDef, Unit, UnitFilter, Weather } from './types';

// ---------------------------------------------------------------- fixtures

const A = 'tc-a';
const B = 'tc-b';
const NO_LUCK: Modifier = { luckMax: 0 }; // luck floor is 0, so a ceiling of 0 makes every roll 0

const mkPower = (stars: number, modifiers: Modifier[] = [], effects: InstantEffect[] = []): PowerDef => ({
  name: `power-${stars}`, stars, quote: '', description: '', modifiers, effects,
});

interface CoOpts { passive?: Modifier[]; surge?: PowerDef | null; overclock?: PowerDef | null }
const mkCo = (id: string, o: CoOpts = {}): CommanderDef => ({
  id, name: id, initials: 'TC', faction: null, title: 'test', pronouns: 'they/them', bio: '', voice: '',
  passive: { name: 'passive', description: '', modifiers: o.passive ?? [] },
  surge: o.surge === undefined ? mkPower(3) : o.surge,
  overclock: o.overclock === undefined ? mkPower(6) : o.overclock,
  lines: { select: '', victory: '', defeat: '' }, playable: false,
});

interface Setup { a?: CommanderDef; b?: CommanderDef; owners?: string[]; fog?: boolean; weather?: Weather; startFunds?: number; seed?: number }
let seq = 0;
let table: Record<string, CommanderDef> = {};
/**
 * Two players (0 = commander A, 1 = commander B) on a fixture map. Every call registers commanders under fresh ids and
 * keeps the earlier ones, so a state built earlier in a test still sees its own commanders (the registry is global).
 * The registry is set before createGame runs the first turn start.
 */
function game(terrain: string[], units: FixtureUnit[] = [], o: Setup = {}): GameState {
  seq += 1;
  const idA = `${A}-${seq}`;
  const idB = `${B}-${seq}`;
  table = { ...table, [idA]: { ...(o.a ?? mkCo(A)), id: idA }, [idB]: { ...(o.b ?? mkCo(B)), id: idB } };
  setCommanderRegistry(table);
  return createGame({
    map: fixtureMap(terrain, units, o.owners),
    players: [
      { faction: 'helion', commander: idA, controller: 'ai', team: 0 },
      { faction: 'tidewell', commander: idB, controller: 'ai', team: 1 },
    ],
    seed: o.seed ?? 1, fog: o.fog, weather: o.weather, startFunds: o.startFunds,
  });
}

afterEach(() => {
  resetCommanderRegistry();
  table = {};
});

const row = (n: number) => '.'.repeat(n);
const withPlayer = (s: GameState, i: number, patch: Partial<Player>): GameState => ({
  ...s, players: s.players.map((p) => (p.index === i ? { ...p, ...patch } : p)),
});
const withUnit = (s: GameState, id: number, patch: Partial<Unit>): GameState => ({
  ...s, units: s.units.map((u) => (u.id === id ? { ...u, ...patch } : u)),
});
const unit = (s: GameState, id: number): Unit => {
  const u = s.units.find((x) => x.id === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
};
const endTurns = (s: GameState, n: number): GameState => {
  let r = s;
  for (let i = 0; i < n; i++) r = applyAction(r, { kind: 'endTurn' }).state;
  return r;
};
/** Applies one InstantEffect for player p on a working copy; the input state is untouched. */
const run = (s: GameState, e: InstantEffect, p = 0) => {
  const ctx = draft(s);
  applyEffect(ctx, p, e);
  return { s: ctx.s, events: ctx.events };
};
const gain = (s: GameState, p: number, amount: number): number => {
  const ctx = draft(s);
  gainPower(ctx, p, amount);
  return ctx.s.players[p].power;
};
function ev<K extends GameEvent['kind']>(events: GameEvent[], kind: K): Extract<GameEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<GameEvent, { kind: K }> => e.kind === kind);
}
const attack = (unitId: number, from: [number, number], target: [number, number]): Action => ({
  kind: 'move', unitId, path: [{ x: from[0], y: from[1] }], then: { kind: 'attack', target: { x: target[0], y: target[1] } },
});
const SURGE: Action = { kind: 'power', level: 'surge' };
const OVERCLOCK: Action = { kind: 'power', level: 'overclock' };

/** mechanics.md 4.1: floor((B x ATK/100 + luck) x (AHP/10) x (200 - (DEF + stars x DHP)) / 100), in integer arithmetic. */
const dmg = (o: { base: number; stars: number; atk?: number; def?: number; ahp?: number; dhp?: number; luck?: number }): number =>
  Math.floor(((o.base * (o.atk ?? 100) + 100 * (o.luck ?? 0)) * (o.ahp ?? 10) * (200 - ((o.def ?? 100) + o.stars * (o.dhp ?? 10)))) / 100000);

// The 9000-point star scale from mechanics.md 10.2, with +20% of base per activation capped at +100% (5 uses).
const STAR_BY_USES = [9000, 10800, 12600, 14400, 16200, 18000, 18000, 18000, 18000, 18000];

// ---------------------------------------------------------------- meter

describe('power meter (mechanics 10.1)', () => {
  // An arc shells a trooper standing on maglev (0 defense stars): 90 base damage, so exactly 90 internal HP are lost.
  const arcShot = (a = mkCo(A, { passive: [NO_LUCK] }), b = mkCo(B, { passive: [NO_LUCK] })) =>
    game(['..='], [{ type: 'arc', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 2, y: 0 }], { a, b });
  const lost = dmg({ base: 90, stars: 0 });
  const value = (unitType('trooper').cost * lost) / 100; // list price x HP lost / 100

  it('charges the victim 100% and the dealer 50% of the list-price value of the HP lost', () => {
    const { state, events } = applyAction(arcShot(), attack(1, [0, 0], [2, 0]));
    expect(ev(events, 'attacked')[0].damage).toBe(lost);
    expect(lost).toBe(90);
    expect(state.players[0].power).toBe(value * 0.5);
    expect(state.players[1].power).toBe(value);
  });

  it('scales each side\'s gain by its own powerChargePercent (rounding down)', () => {
    const s = arcShot(
      mkCo(A, { passive: [NO_LUCK, { powerChargePercent: 20 }] }),
      mkCo(B, { passive: [NO_LUCK, { powerChargePercent: -50 }] }),
    );
    const { state } = applyAction(s, attack(1, [0, 0], [2, 0]));
    expect(state.players[0].power).toBe(Math.floor((value * 0.5 * 120) / 100)); // 540
    expect(state.players[1].power).toBe(Math.floor((value * 50) / 100)); // 450
  });

  it('sums powerChargePercent modifiers and floors the scaled gain', () => {
    const s = game([row(3)], [], { a: mkCo(A, { passive: [{ powerChargePercent: 10 }, { powerChargePercent: 10 }] }) });
    expect(gain(s, 0, 1000)).toBe(1200);
    const one = game([row(3)], [], { a: mkCo(A, { passive: [{ powerChargePercent: 10 }] }) });
    expect(gain(one, 0, 999)).toBe(1098); // 1098.9 rounds down
    expect(gain(game([row(3)]), 0, 999)).toBe(999);
  });

  it('never goes negative: a -100% rate stops charging', () => {
    const s = game([row(3)], [], { a: mkCo(A, { passive: [{ powerChargePercent: -100 }] }) });
    expect(gain(s, 0, 5000)).toBe(0);
    const worse = game([row(3)], [], { a: mkCo(A, { passive: [{ powerChargePercent: -300 }] }) });
    expect(gain(worse, 0, 5000)).toBe(0);
  });

  it('tops out at the Overclock cost, and the cap grows with each activation', () => {
    const s = game([row(3)]);
    expect(gain(s, 0, 10 ** 9)).toBe(6 * POWER_STAR);
    expect(gain(withPlayer(s, 0, { power: 50000 }), 0, 10 ** 9)).toBe(54000);
    const twice = withPlayer(s, 0, { powerUses: 2 });
    expect(gain(twice, 0, 10 ** 9)).toBe(6 * 12600);
  });

  it('tops out at the Surge cost when the commander has no Overclock', () => {
    const s = game([row(3)], [], { a: mkCo(A, { overclock: null }) });
    expect(meterCap(s, 0)).toBe(3 * POWER_STAR);
    expect(gain(s, 0, 10 ** 9)).toBe(27000);
  });

  it('does not charge a commander with no powers, an unknown commander, or a defeated player', () => {
    const none = game([row(3)], [], { a: mkCo(A, { surge: null, overclock: null }) });
    expect(meterCap(none, 0)).toBe(0);
    expect(gain(none, 0, 5000)).toBe(0);
    const s = game([row(3)]);
    expect(gain(withPlayer(s, 0, { defeated: true }), 0, 5000)).toBe(0);
    setCommanderRegistry({});
    expect(gain(s, 0, 5000)).toBe(0);
  });

  it('ignores zero and negative amounts', () => {
    const s = withPlayer(game([row(3)]), 0, { power: 1000 });
    expect(gain(s, 0, 0)).toBe(1000);
    expect(gain(s, 0, -500)).toBe(1000);
  });

  // A raptor against a wasp (base 100): whole display HP are lost, so the list-price value is the same however it is counted.
  const airShot = () => game(['..'], [{ type: 'raptor', owner: 0, x: 0, y: 0 }, { type: 'wasp', owner: 1, x: 1, y: 0 }],
    { a: mkCo(A, { passive: [NO_LUCK] }), b: mkCo(B, { passive: [NO_LUCK] }) });
  const waspCost = unitType('wasp').cost;

  it('does not charge the dealer while its own power is active; the victim still gets 100%', () => {
    const s = withPlayer(airShot(), 0, { powerState: 'surge' });
    const { state } = applyAction(s, attack(1, [0, 0], [1, 0]));
    const hpLost = Math.min(100, dmg({ base: 100, stars: 0, atk: 110 })); // the standard +10 firepower kills the wasp
    expect(unit(s, 2).hp).toBe(100);
    expect(hpLost).toBe(100);
    expect(state.players[0].power).toBe(0);
    expect(state.players[1].power).toBe((waspCost * hpLost) / 100);
  });

  it('does not charge the victim while its own power is active; the dealer still gets 50%', () => {
    const s = withPlayer(airShot(), 1, { powerState: 'overclock' });
    const { state, events } = applyAction(s, attack(1, [0, 0], [1, 0]));
    const hpLost = dmg({ base: 100, stars: 0, def: 110 }); // the standard +10 defense leaves the wasp at 10 HP
    expect(hpLost).toBe(90);
    expect(ev(events, 'attacked')[0].damage).toBe(hpLost);
    expect(state.players[1].power).toBe(0);
    expect(state.players[0].power).toBe(((waspCost * hpLost) / 100) * 0.5);
  });

  it('charges again once the power has ended at its owner\'s next turn start', () => {
    let s = withPlayer(arcShot(), 0, { power: 27000 });
    s = applyAction(s, SURGE).state;
    expect(gain(s, 0, 1000)).toBe(0); // active: no gain
    s = endTurns(s, 2);
    expect(s.players[0].powerState).toBe('none');
    expect(gain(s, 0, 1000)).toBe(1000);
  });

  it('is not charged by power-effect damage (damageEnemies, strike)', () => {
    const s = withPlayer(withPlayer(
      game([row(4)], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }]), 0, { power: 1234 }), 1, { power: 4321 });
    for (const e of [{ kind: 'damageEnemies', hp: 3 }, { kind: 'strike', hp: 3, radius: 1, aim: 'mostValue' }] as InstantEffect[]) {
      const r = run(s, e).s;
      expect(unit(r, 2).hp).toBeLessThan(100); // the damage really happened
      expect(r.players[0].power).toBe(1234);
      expect(r.players[1].power).toBe(4321);
    }
  });
});

// ---------------------------------------------------------------- costs

describe('power costs (mechanics 10.2, D-012.5)', () => {
  it('has a 9000-point star, and each previous activation adds 20% of base, capped at +100%', () => {
    expect(POWER_STAR).toBe(9000);
    const s = game([row(3)]);
    STAR_BY_USES.forEach((expected, uses) => {
      expect(starValue(withPlayer(s, 0, { powerUses: uses }), 0)).toBe(expected);
    });
  });

  it('prices Surge as its stars x the star value and Overclock as the FULL bar', () => {
    const s = game([row(3)]); // surge 3 stars, overclock 6 stars (small + large)
    expect(powerCost(s, 0, 'surge')).toBe(27000);
    expect(powerCost(s, 0, 'overclock')).toBe(54000);
    expect(powerCost(s, 0, 'overclock')).toBe(meterCap(s, 0)); // the full bar IS the Overclock cost
    expect(powerCost(s, 0, 'overclock')).not.toBe((3 + 6) * POWER_STAR); // small stars are not added on top
  });

  it('scales both costs with the number of activations and stops scaling at 5', () => {
    const s = game([row(3)]);
    [0, 1, 2, 3, 4, 5, 6, 12].forEach((uses) => {
      const p = withPlayer(s, 0, { powerUses: uses });
      const star = STAR_BY_USES[Math.min(uses, 9)];
      expect(powerCost(p, 0, 'surge')).toBe(3 * star);
      expect(powerCost(p, 0, 'overclock')).toBe(6 * star);
    });
    expect(powerCost(withPlayer(s, 0, { powerUses: 5 }), 0, 'surge')).toBe(powerCost(withPlayer(s, 0, { powerUses: 40 }), 0, 'surge'));
  });

  it('prices a missing power at Infinity, so it can never be afforded', () => {
    const s = game([row(3)], [], { a: mkCo(A, { overclock: null }) });
    expect(powerCost(s, 0, 'overclock')).toBe(Infinity);
    expect(powerDef(s, 0, 'overclock')).toBeNull();
    expect(canActivatePower(withPlayer(s, 0, { power: 10 ** 9 }), 'overclock')).toBe(false);
  });

  it('reports filled stars at the current star value, plus the surge and overclock star counts', () => {
    const s = game([row(3)]);
    expect(powerStars(withPlayer(s, 0, { power: 27000 }), 0)).toEqual({ filled: 3, surge: 3, overclock: 6 });
    expect(powerStars(withPlayer(s, 0, { power: 13500 }), 0).filled).toBe(1.5);
    const dearer = withPlayer(s, 0, { power: 27000, powerUses: 2 }); // star is now 12600
    expect(powerStars(dearer, 0).filled).toBeCloseTo(27000 / 12600, 10);
    expect(powerStars(dearer, 0).filled).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------- activation

describe('power activation (mechanics 10.3)', () => {
  const duel = (o: Setup = {}) => game(['....'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }], o);

  it('needs the full cost: one point short is refused, exactly the cost is accepted', () => {
    const s = duel();
    expect(canActivatePower(withPlayer(s, 0, { power: 26999 }), 'surge')).toBe(false);
    expect(canActivatePower(withPlayer(s, 0, { power: 27000 }), 'surge')).toBe(true);
    expect(() => applyAction(withPlayer(s, 0, { power: 26999 }), SURGE)).toThrow(IllegalActionError);
    expect(isLegal(withPlayer(s, 0, { power: 27000 }), SURGE)).toBe(true);
    expect(isLegal(s, SURGE)).toBe(false); // empty meter
  });

  it('empties the meter, counts the use, sets powerState and emits powerActivated before the effects', () => {
    const co = mkCo(A, { surge: mkPower(3, [], [{ kind: 'funds', amount: 500 }, { kind: 'heal', hp: 1 }]) });
    const s = withPlayer(duel({ a: co }), 0, { power: 27000 });
    const snapshot = structuredClone(s);
    const { state, events } = applyAction(s, SURGE);
    expect(state.players[0]).toMatchObject({ power: 0, powerUses: 1, powerState: 'surge' });
    expect(events.map((e) => e.kind)).toEqual(['powerActivated', 'powerEffect', 'powerEffect']);
    expect(events[0]).toEqual({ kind: 'powerActivated', player: 0, level: 'surge', commander: s.players[0].commander });
    expect(state.players[0].funds).toBe(s.players[0].funds + 500); // the effects really ran
    expect(s).toEqual(snapshot); // input state untouched
  });

  it('empties the whole meter even when it held more than the Surge cost (ORDER M1.4; mechanics 10.2 leaves carry-over open)', () => {
    const s = withPlayer(duel(), 0, { power: 40000 });
    expect(applyAction(s, SURGE).state.players[0].power).toBe(0);
  });

  it('needs the full bar for Overclock, and sets powerState overclock', () => {
    const s = duel();
    expect(canActivatePower(withPlayer(s, 0, { power: 27000 }), 'overclock')).toBe(false); // surge cost is not enough
    expect(isLegal(withPlayer(s, 0, { power: 53999 }), OVERCLOCK)).toBe(false);
    const full = withPlayer(s, 0, { power: 54000 });
    const { state, events } = applyAction(full, OVERCLOCK);
    expect(state.players[0]).toMatchObject({ power: 0, powerUses: 1, powerState: 'overclock' });
    expect(events[0]).toEqual({ kind: 'powerActivated', player: 0, level: 'overclock', commander: full.players[0].commander });
  });

  it('refuses a second power while one is active, and a level the commander does not have', () => {
    const s = duel();
    for (const active of ['surge', 'overclock'] as const) {
      const p = withPlayer(s, 0, { power: 10 ** 6, powerState: active });
      expect(canActivatePower(p, 'surge')).toBe(false);
      expect(canActivatePower(p, 'overclock')).toBe(false);
    }
    const noOverclock = duel({ a: mkCo(A, { overclock: null }) });
    expect(isLegal(withPlayer(noOverclock, 0, { power: 10 ** 6 }), OVERCLOCK)).toBe(false);
    expect(isLegal(withPlayer(noOverclock, 0, { power: 10 ** 6 }), SURGE)).toBe(true);
  });

  it('is unavailable after the game is over, to a defeated player, and when it is not your commander\'s turn', () => {
    const s = withPlayer(duel(), 0, { power: 10 ** 6 });
    expect(canActivatePower({ ...s, winnerTeam: 1 }, 'surge')).toBe(false);
    expect(canActivatePower(withPlayer(s, 0, { defeated: true }), 'surge')).toBe(false);
    // player 1 is not current: its full meter does not let player 0 (current) act with it
    expect(canActivatePower(withPlayer(duel(), 1, { power: 10 ** 6 }), 'surge')).toBe(false);
  });

  it('charges 20% more for the next power after each activation', () => {
    let s = withPlayer(duel(), 0, { power: 27000 });
    s = endTurns(applyAction(s, SURGE).state, 2);
    expect(s.players[0]).toMatchObject({ powerUses: 1, powerState: 'none' });
    expect(canActivatePower(withPlayer(s, 0, { power: 27000 }), 'surge')).toBe(false); // old price
    expect(canActivatePower(withPlayer(s, 0, { power: 32399 }), 'surge')).toBe(false);
    expect(canActivatePower(withPlayer(s, 0, { power: 32400 }), 'surge')).toBe(true); // 3 x 10800
    expect(canActivatePower(withPlayer(s, 0, { power: 32400 }), 'overclock')).toBe(false);
    expect(canActivatePower(withPlayer(s, 0, { power: 64800 }), 'overclock')).toBe(true); // 6 x 10800
    s = applyAction(withPlayer(s, 0, { power: 32400 }), SURGE).state;
    expect(s.players[0].powerUses).toBe(2);
  });

  it('stays active through the enemy turn and is cleared when its owner\'s next turn starts', () => {
    let s = withPlayer(duel(), 0, { power: 27000 });
    s = applyAction(s, SURGE).state;
    expect(s.players[0].powerState).toBe('surge');
    s = applyAction(s, { kind: 'endTurn' }).state;
    expect(s.current).toBe(1);
    expect(s.players[0].powerState).toBe('surge'); // the enemy turn: defense still applies
    expect(activeModifiers(s, 0)).toContainEqual(STANDARD_POWER_MODIFIER);
    s = applyAction(s, { kind: 'endTurn' }).state;
    expect(s.current).toBe(0);
    expect(s.players[0].powerState).toBe('none');
    expect(activeModifiers(s, 0)).not.toContainEqual(STANDARD_POWER_MODIFIER);
    expect(s.players[0].powerUses).toBe(1);
  });

  it('gives the standard +10 firepower and +10 defense for either power, and nothing when inactive', () => {
    const s = duel();
    const u0 = unit(s, 1);
    expect(STANDARD_POWER_MODIFIER).toEqual({ firepower: 10, defense: 10 });
    expect([firepowerBonus(s, u0), defenseBonus(s, u0)]).toEqual([0, 0]);
    for (const level of ['surge', 'overclock'] as const) {
      const p = withPlayer(s, 0, { powerState: level });
      expect([firepowerBonus(p, u0), defenseBonus(p, u0)]).toEqual([10, 10]);
      expect([firepowerBonus(p, unit(p, 2)), defenseBonus(p, unit(p, 2))]).toEqual([0, 0]); // the enemy gets nothing
    }
  });

  it('stacks the power\'s own modifiers on the passive and the standard bonus', () => {
    const co = mkCo(A, {
      passive: [{ firepower: 15, defense: 5 }],
      surge: mkPower(3, [{ firepower: 20, filter: { domains: ['air'] } }, { defense: 10 }]),
      overclock: mkPower(6, [{ firepower: 30 }, { defense: 25 }]),
    });
    const s = game([row(4)], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'wasp', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }], { a: co });
    const ground = unit(s, 1);
    const air = unit(s, 2);
    expect([firepowerBonus(s, ground), defenseBonus(s, ground)]).toEqual([15, 5]); // passive only
    const surge = withPlayer(s, 0, { powerState: 'surge' });
    expect(firepowerBonus(surge, ground)).toBe(15 + 10); // air-only +20 does not reach ground
    expect(firepowerBonus(surge, air)).toBe(15 + 20 + 10);
    expect(defenseBonus(surge, ground)).toBe(5 + 10 + 10);
    const over = withPlayer(s, 0, { powerState: 'overclock' });
    expect(firepowerBonus(over, ground)).toBe(15 + 30 + 10);
    expect(defenseBonus(over, air)).toBe(5 + 25 + 10); // the surge-only modifiers are gone
  });

  it('reaches combat: an active power raises damage dealt and lowers damage taken, with known-answer numbers', () => {
    const co = (extra: Modifier[]) => mkCo(A, { passive: [NO_LUCK], surge: mkPower(3, extra) });
    const flats = ['..'];
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }];
    const plain = dmg({ base: 55, stars: 1 });
    expect(plain).toBe(49);
    const s = game(flats, units, { a: co([]), b: mkCo(B, { passive: [NO_LUCK] }) });
    expect(forecast(s, 1, { x: 0, y: 0 }, { x: 1, y: 0 }).damage[0]).toBe(plain);
    // attacker's power active: +10 standard
    const boosted = withPlayer(s, 0, { powerState: 'surge' });
    expect(forecast(boosted, 1, { x: 0, y: 0 }, { x: 1, y: 0 }).damage[0]).toBe(dmg({ base: 55, stars: 1, atk: 110 })); // 54
    // attacker's power with its own +20 firepower: 100 + 20 + 10
    const strong = game(flats, units, { a: co([{ firepower: 20 }]), b: mkCo(B, { passive: [NO_LUCK] }) });
    expect(forecast(withPlayer(strong, 0, { powerState: 'surge' }), 1, { x: 0, y: 0 }, { x: 1, y: 0 }).damage[0])
      .toBe(dmg({ base: 55, stars: 1, atk: 130 })); // 64
    // defender's power active during its own enemy's turn: +10 standard defense
    const guarded = withPlayer(s, 1, { powerState: 'overclock' });
    expect(forecast(guarded, 1, { x: 0, y: 0 }, { x: 1, y: 0 }).damage[0]).toBe(dmg({ base: 55, stars: 1, def: 110 })); // 44
    expect(dmg({ base: 55, stars: 1, def: 110 })).toBeLessThan(plain);
  });

  it('applies a defender\'s power defense during the attacker\'s real attack on the enemy turn', () => {
    let s = withPlayer(game(['..'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }],
      { a: mkCo(A, { passive: [NO_LUCK] }), b: mkCo(B, { passive: [NO_LUCK] }) }), 0, { power: 27000 });
    s = applyAction(s, SURGE).state;
    s = applyAction(s, { kind: 'endTurn' }).state;
    const { events } = applyAction(s, attack(2, [1, 0], [0, 0]));
    expect(ev(events, 'attacked')[0].damage).toBe(dmg({ base: 55, stars: 1, def: 110 }));
  });
});

// ---------------------------------------------------------------- instant effects

describe('InstantEffect: heal', () => {
  const setup = () => {
    let s = game([row(6)], [
      { type: 'trooper', owner: 0, x: 0, y: 0, hp: 6 }, // 1
      { type: 'trooper', owner: 0, x: 1, y: 0, hp: 9 }, // 2
      { type: 'wasp', owner: 0, x: 2, y: 0, hp: 3 }, // 3
      { type: 'trooper', owner: 1, x: 5, y: 0, hp: 3 }, // 4 (enemy)
    ]);
    s = withUnit(s, 1, { hp: 55 }); // display 6 with a fractional part
    s = withUnit(s, 3, { charge: 10, ammo: 1 });
    return s;
  };
  it('adds display HP to every own unit, caps at 10 and leaves enemies alone', () => {
    const orig = setup();
    const { s, events } = run(orig, { kind: 'heal', hp: 2 });
    expect(unit(s, 1).hp).toBe(75); // 55 + 20, still displays 8
    expect(displayHp(unit(s, 1).hp)).toBe(8);
    expect(unit(s, 2).hp).toBe(100); // 90 + 20 capped
    expect(unit(s, 3).hp).toBe(50);
    expect(unit(s, 4).hp).toBe(30);
    expect(unit(orig, 1).hp).toBe(55); // input untouched
    expect(ev(events, 'powerEffect')[0].affected).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  });
  it('resupplies charge and ammo only when asked', () => {
    const plain = run(setup(), { kind: 'heal', hp: 1 }).s;
    expect(unit(plain, 3)).toMatchObject({ charge: 10, ammo: 1 });
    const fed = run(setup(), { kind: 'heal', hp: 1, resupply: true }).s;
    expect(unit(fed, 3)).toMatchObject({ charge: unitType('wasp').charge, ammo: unitType('wasp').ammo });
    expect(unit(fed, 4).ammo).toBe(0); // enemy trooper has no primary weapon either way
  });
  it('honours the unit filter', () => {
    const { s } = run(setup(), { kind: 'heal', hp: 2, filter: { domains: ['air'] }, resupply: true });
    expect(unit(s, 3)).toMatchObject({ hp: 50, charge: 99, ammo: 6 });
    expect(unit(s, 1).hp).toBe(55);
    expect(unit(s, 2).hp).toBe(90);
  });
});

describe('InstantEffect: damageEnemies', () => {
  const setup = () => game([row(6)], [
    { type: 'trooper', owner: 0, x: 0, y: 0 }, // 1 own
    { type: 'trooper', owner: 1, x: 3, y: 0 }, // 2
    { type: 'trooper', owner: 1, x: 4, y: 0, hp: 2 }, // 3 (display 2)
    { type: 'wasp', owner: 1, x: 5, y: 0 }, // 4
  ]);
  it('removes display HP from every enemy, never below 1 display HP, and spares own units', () => {
    const { s, events } = run(setup(), { kind: 'damageEnemies', hp: 3 });
    expect(unit(s, 2).hp).toBe(70);
    expect(unit(s, 4).hp).toBe(70);
    expect(unit(s, 3).hp).toBeGreaterThan(0);
    expect(displayHp(unit(s, 3).hp)).toBe(1); // 20 - 30 would be dead; it stays at 1 display HP
    expect(unit(s, 1).hp).toBe(100);
    expect(ev(events, 'powerEffect')[0].affected).toHaveLength(3);
  });
  it('honours the unit filter', () => {
    const { s } = run(setup(), { kind: 'damageEnemies', hp: 3, filter: { domains: ['air'] } });
    expect([unit(s, 2).hp, unit(s, 3).hp, unit(s, 4).hp]).toEqual([100, 20, 70]);
  });
});

describe('InstantEffect: strike', () => {
  // Four troopers in a row at x 0..3 and a lone bastion at x 10; an own trooper stands next to the bastion.
  const setup = () => game([row(12)], [
    { type: 'trooper', owner: 1, x: 0, y: 0 }, // 1
    { type: 'trooper', owner: 1, x: 1, y: 0 }, // 2
    { type: 'trooper', owner: 1, x: 2, y: 0 }, // 3
    { type: 'trooper', owner: 1, x: 3, y: 0 }, // 4
    { type: 'bastion', owner: 1, x: 10, y: 0 }, // 5
    { type: 'trooper', owner: 0, x: 11, y: 0 }, // 6 (own)
  ]);
  it('aim mostUnits hits the biggest cluster within the radius and nothing outside it', () => {
    const { s, events } = run(setup(), { kind: 'strike', hp: 4, radius: 1, aim: 'mostUnits' });
    // centre x=1 covers x 0..2 (three units, first found); x=3 is two tiles from the centre
    expect([1, 2, 3].map((id) => unit(s, id).hp)).toEqual([60, 60, 60]);
    expect(unit(s, 4).hp).toBe(100);
    expect(unit(s, 5).hp).toBe(100);
    expect(unit(s, 6).hp).toBe(100);
    expect(ev(events, 'powerEffect')[0].affected).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  });
  it('aim mostValue goes for the most valuable cluster instead, even if it is a single unit', () => {
    // bastion: 4 display HP x 16000 / 10 = 6400 beats three troopers at 3 x 400
    const { s } = run(setup(), { kind: 'strike', hp: 4, radius: 1, aim: 'mostValue' });
    expect(unit(s, 5).hp).toBe(60);
    expect([1, 2, 3, 4].map((id) => unit(s, id).hp)).toEqual([100, 100, 100, 100]);
    expect(unit(s, 6).hp).toBe(100); // never hits own units, even inside the radius
  });
  it('uses a Manhattan radius: radius 0 hits exactly one unit, the most valuable on a tie of counts', () => {
    const { s } = run(setup(), { kind: 'strike', hp: 4, radius: 0, aim: 'mostUnits' });
    expect(unit(s, 5).hp).toBe(60);
    expect([1, 2, 3, 4].every((id) => unit(s, id).hp === 100)).toBe(true);
  });
  it('widens with the radius', () => {
    const { s } = run(setup(), { kind: 'strike', hp: 1, radius: 3, aim: 'mostUnits' });
    expect([1, 2, 3, 4].map((id) => unit(s, id).hp)).toEqual([90, 90, 90, 90]);
    expect(unit(s, 5).hp).toBe(100);
  });
  it('never leaves a unit below 1 display HP and says so when there are no targets', () => {
    const s = game([row(4)], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0, hp: 2 }]);
    const hit = run(s, { kind: 'strike', hp: 4, radius: 1, aim: 'mostValue' }).s;
    expect(displayHp(unit(hit, 2).hp)).toBe(1);
    expect(unit(hit, 2).hp).toBeGreaterThan(0);
    const empty = game([row(4)], [{ type: 'trooper', owner: 0, x: 0, y: 0 }]);
    const r = run(empty, { kind: 'strike', hp: 4, radius: 1, aim: 'mostValue' });
    expect(ev(r.events, 'powerEffect')[0]).toMatchObject({ affected: [], description: 'Strike found no targets' });
  });
});

describe('InstantEffect: drainPower', () => {
  it('takes a percentage of every enemy meter (rounded down) and leaves your own', () => {
    const s = withPlayer(withPlayer(game([row(3)]), 1, { power: 10000 }), 0, { power: 7777 });
    expect(run(s, { kind: 'drainPower', percent: 50 }).s.players[1].power).toBe(5000);
    expect(run(withPlayer(s, 1, { power: 9999 }), { kind: 'drainPower', percent: 30 }).s.players[1].power).toBe(9999 - 2999);
    expect(run(s, { kind: 'drainPower', percent: 100 }).s.players[1].power).toBe(0);
    expect(run(s, { kind: 'drainPower', percent: 50 }).s.players[0].power).toBe(7777);
  });
});

describe('InstantEffect: funds', () => {
  const owned = (a?: CommanderDef) => game(['F.F.'], [], { owners: ['0.0.'], a });
  it('adds a flat amount, a percentage of income, or both', () => {
    const s = withPlayer(owned(), 0, { funds: 1000 });
    expect(incomeOf(s, 0)).toBe(2000);
    expect(run(s, { kind: 'funds', amount: 300 }).s.players[0].funds).toBe(1300);
    expect(run(s, { kind: 'funds', percentOfIncome: 50 }).s.players[0].funds).toBe(1000 + 1000);
    expect(run(s, { kind: 'funds', amount: 300, percentOfIncome: 25 }).s.players[0].funds).toBe(1000 + 300 + 500);
    expect(run(s, { kind: 'funds', amount: 300 }).s.players[1].funds).toBe(0);
  });
  it('takes the income modifiers into account', () => {
    const s = withPlayer(owned(mkCo(A, { passive: [{ incomePercent: 50 }] })), 0, { funds: 0 });
    expect(incomeOf(s, 0)).toBe(3000);
    expect(run(s, { kind: 'funds', percentOfIncome: 100 }).s.players[0].funds).toBe(3000);
  });
});

describe('InstantEffect: enemyFundsPercent', () => {
  it('changes every enemy\'s funds by the percentage, truncating toward zero, never below 0', () => {
    const s = withPlayer(withPlayer(game([row(3)]), 1, { funds: 1001 }), 0, { funds: 500 });
    expect(run(s, { kind: 'enemyFundsPercent', percent: -30 }).s.players[1].funds).toBe(1001 - 300);
    expect(run(s, { kind: 'enemyFundsPercent', percent: 10 }).s.players[1].funds).toBe(1001 + 100);
    expect(run(s, { kind: 'enemyFundsPercent', percent: -250 }).s.players[1].funds).toBe(0);
    expect(run(s, { kind: 'enemyFundsPercent', percent: -30 }).s.players[0].funds).toBe(500); // not yours
  });
});

describe('InstantEffect: convertTerrain', () => {
  // y0: flats, canopy, fabricator, flats, flats   y1: flats x5
  const terrain = ['.fF..', '.....'];
  const grow: InstantEffect = { kind: 'convertTerrain', from: ['flats'], to: 'canopy', adjacentTo: 'canopy', turns: 2 };
  const base = (extra: FixtureUnit[] = []) => game(terrain, [{ type: 'trooper', owner: 0, x: 4, y: 1 }, { type: 'trooper', owner: 1, x: 3, y: 1 }, ...extra]);
  const at = (s: GameState, x: number, y: number) => s.tiles[y][x].terrain;

  it('converts only the "from" tiles next to the named terrain, one ring, skipping properties', () => {
    const orig = base();
    const { s, events } = run(orig, grow);
    expect(at(s, 0, 0)).toBe('canopy');
    expect(at(s, 1, 1)).toBe('canopy');
    expect(at(s, 2, 0)).toBe('fabricator'); // a property next to canopy is never converted
    const greedy = run(base(), { ...grow, from: ['flats', 'fabricator'] }).s; // even when it is listed in "from"
    expect(at(greedy, 2, 0)).toBe('fabricator');
    expect(at(greedy, 0, 0)).toBe('canopy');
    expect(at(s, 0, 1)).toBe('flats'); // only next to a tile that BECAME canopy: no chain reaction
    expect(at(s, 3, 0)).toBe('flats');
    expect(at(orig, 0, 0)).toBe('flats'); // input untouched
    expect(ev(events, 'powerEffect')[0].affected).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(s.terrainOverrides).toEqual([
      { x: 0, y: 0, terrain: 'canopy', turnsLeft: 2, original: 'flats', owner: 0 },
      { x: 1, y: 1, terrain: 'canopy', turnsLeft: 2, original: 'flats', owner: 0 },
    ]);
  });
  it('does not convert a tile whose unit could not stand on the new terrain', () => {
    // hover units cannot enter ridge; foot units can
    const s = game(terrain, [{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 1 }]);
    const r = run(s, { kind: 'convertTerrain', from: ['flats'], to: 'ridge', adjacentTo: 'canopy', turns: 1 }).s;
    expect(at(r, 0, 0)).toBe('flats');
    expect(at(r, 1, 1)).toBe('ridge');
  });
  it('reverts after N of the OWNER\'s turn starts, not the enemy\'s', () => {
    let s = run(base(), grow).s;
    s = endTurns(s, 1); // enemy turn starts
    expect(at(s, 0, 0)).toBe('canopy');
    expect(s.terrainOverrides[0].turnsLeft).toBe(2);
    s = endTurns(s, 1); // owner's turn start #1
    expect(at(s, 0, 0)).toBe('canopy');
    expect(s.terrainOverrides[0].turnsLeft).toBe(1);
    s = endTurns(s, 2); // enemy, then owner's turn start #2
    expect(at(s, 0, 0)).toBe('flats');
    expect(at(s, 1, 1)).toBe('flats');
    expect(s.terrainOverrides).toEqual([]);
  });
  it('lasts exactly one cycle when turns is 1', () => {
    let s = run(base(), { ...grow, turns: 1 }).s;
    s = endTurns(s, 1);
    expect(at(s, 0, 0)).toBe('canopy');
    s = endTurns(s, 1);
    expect(at(s, 0, 0)).toBe('flats');
  });
});

describe('InstantEffect: weather (mechanics 14)', () => {
  const units: FixtureUnit[] = [
    { type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'wasp', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 4, y: 0 },
  ];
  const storm = (turns: number): InstantEffect => ({ kind: 'weather', weather: 'ionstorm', turns });
  it('starts an ion storm that cuts every unit\'s vision by 1 (minimum 1) and slows air units by 1', () => {
    const s = game([row(5)], units);
    const before = [effectiveVision(s, unit(s, 1)), effectiveVision(s, unit(s, 2)), effectiveMove(s, unit(s, 2)), effectiveMove(s, unit(s, 1))];
    expect(before).toEqual([2, 3, 6, 3]);
    const { s: r, events } = run(s, storm(1));
    expect(r.weather).toBe('ionstorm');
    expect(r.weatherTurnsLeft).toBe(1);
    expect(ev(events, 'weather')).toEqual([{ kind: 'weather', weather: 'ionstorm', turns: 1 }]);
    expect(ev(events, 'powerEffect')).toHaveLength(1);
    expect([effectiveVision(r, unit(r, 1)), effectiveVision(r, unit(r, 2)), effectiveMove(r, unit(r, 2)), effectiveMove(r, unit(r, 1))]).toEqual([1, 2, 5, 3]);
    const mule = game([row(5)], [{ type: 'mule', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 4, y: 0 }]);
    expect(effectiveVision(run(mule, storm(1)).s, unit(mule, 1))).toBe(1); // vision 1 does not drop to 0
  });
  it('reverts to clear when its owner\'s next turn starts, announcing it', () => {
    let s = run(game([row(5)], units), storm(1)).s;
    s = endTurns(s, 1);
    expect(s.weather).toBe('ionstorm');
    const r = applyAction(s, { kind: 'endTurn' });
    expect(r.state.weather).toBe('clear');
    expect(r.state.weatherTurnsLeft).toBe(0);
    expect(ev(r.events, 'weather')).toEqual([{ kind: 'weather', weather: 'clear', turns: 0 }]);
  });
  it('lasts N of the owner\'s turns', () => {
    let s = run(game([row(5)], units), storm(2)).s;
    s = endTurns(s, 2);
    expect(s.weather).toBe('ionstorm');
    s = endTurns(s, 2);
    expect(s.weather).toBe('clear');
  });
  it('reverts to the BASE weather, not always to clear', () => {
    let s = run(game([row(5)], units, { weather: 'ionstorm' }), { kind: 'weather', weather: 'clear', turns: 1 }).s;
    expect(s.weather).toBe('clear');
    s = endTurns(s, 2);
    expect(s.weather).toBe('ionstorm');
  });
});

describe('InstantEffect: reveal', () => {
  const setup = () => game([row(9)], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 8, y: 0 }], { fog: true });
  it('lifts fog for the user for N of its own turns', () => {
    let s = setup();
    expect(visibility(s, 0)[0][8]).toBe(false);
    s = run(s, { kind: 'reveal', turns: 1 }).s;
    expect(s.players[0].revealTurns).toBe(1);
    expect(visibility(s, 0)[0][8]).toBe(true);
    expect(visibility(s, 1)[0][0]).toBe(false); // only the user sees everything
    s = endTurns(s, 1); // the enemy turn: still lifted
    expect(visibility(s, 0)[0][8]).toBe(true);
    s = endTurns(s, 1); // the user's next turn starts
    expect(s.players[0].revealTurns).toBeUndefined();
    expect(visibility(s, 0)[0][8]).toBe(false);
  });
  it('keeps the longer of two reveals and lasts two turns when asked', () => {
    let s = run(setup(), { kind: 'reveal', turns: 2 }).s;
    expect(run(s, { kind: 'reveal', turns: 1 }).s.players[0].revealTurns).toBe(2);
    s = endTurns(s, 2);
    expect(s.players[0].revealTurns).toBe(1);
    expect(visibility(s, 0)[0][8]).toBe(true);
    s = endTurns(s, 2);
    expect(visibility(s, 0)[0][8]).toBe(false);
  });
});

describe('InstantEffect: enemyMove', () => {
  const setup = () => game([row(9)], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 7, y: 0 }]);
  it('cuts enemy movement for the enemy\'s next turn only, then expires', () => {
    let s = run(setup(), { kind: 'enemyMove', delta: -1, turns: 1 }).s;
    expect(effectiveMove(s, unit(s, 1))).toBe(3); // yours is unaffected
    expect(effectiveMove(s, unit(s, 2))).toBe(2);
    s = endTurns(s, 1); // enemy turn
    expect(s.current).toBe(1);
    expect(effectiveMove(s, unit(s, 2))).toBe(2);
    const reach = reachable(s, 2);
    expect(reach.has('5,0')).toBe(true);
    expect(reach.has('4,0')).toBe(false); // three tiles away is out of reach now
    s = endTurns(s, 1);
    expect(effectiveMove(s, unit(s, 2))).toBe(3);
    expect(reachable(endTurns(s, 1), 2).has('4,0')).toBe(true);
  });
  it('lasts N enemy turns', () => {
    let s = run(setup(), { kind: 'enemyMove', delta: -1, turns: 2 }).s;
    s = endTurns(s, 2); // after the enemy's first turn
    expect(effectiveMove(s, unit(s, 2))).toBe(2);
    s = endTurns(s, 2);
    expect(effectiveMove(s, unit(s, 2))).toBe(3);
  });
  it('stacks, and never drops a unit below 1 move', () => {
    const once = run(setup(), { kind: 'enemyMove', delta: -1, turns: 1 }).s;
    const twice = run(once, { kind: 'enemyMove', delta: -1, turns: 1 }).s;
    expect(effectiveMove(twice, unit(twice, 2))).toBe(1);
    const huge = run(setup(), { kind: 'enemyMove', delta: -9, turns: 1 }).s;
    expect(effectiveMove(huge, unit(huge, 2))).toBe(1);
    const faster = run(setup(), { kind: 'enemyMove', delta: 2, turns: 1 }).s;
    expect(effectiveMove(faster, unit(faster, 2))).toBe(5);
  });
});

describe('InstantEffect: refresh', () => {
  const setup = () => {
    let s = game([row(8)], [
      { type: 'trooper', owner: 0, x: 0, y: 0 }, // 1  cost 1000
      { type: 'lancer', owner: 0, x: 1, y: 0 }, // 2  cost 7000
      { type: 'wasp', owner: 0, x: 2, y: 0 }, // 3  cost 9000
      { type: 'bastion', owner: 0, x: 3, y: 0 }, // 4  cost 16000, has NOT acted
      { type: 'skimmer', owner: 0, x: 4, y: 0 }, // 5  cost 4000
      { type: 'trooper', owner: 1, x: 7, y: 0 }, // 6  enemy
    ]);
    for (const id of [1, 2, 3, 5, 6]) s = withUnit(s, id, { acted: true });
    return s;
  };
  const acted = (s: GameState) => [1, 2, 3, 4, 5, 6].map((id) => unit(s, id).acted);
  it('un-acts every acted own unit when no limit is given, never enemies', () => {
    const { s, events } = run(setup(), { kind: 'refresh' });
    expect(acted(s)).toEqual([false, false, false, false, false, true]);
    expect(ev(events, 'powerEffect')[0].affected).toHaveLength(4);
  });
  it('with maxUnits picks the most expensive acted units first', () => {
    expect(acted(run(setup(), { kind: 'refresh', maxUnits: 2 }).s)).toEqual([true, false, false, false, true, true]); // wasp, lancer
    expect(acted(run(setup(), { kind: 'refresh', maxUnits: 0 }).s)).toEqual([true, true, true, false, true, true]);
  });
  it('honours the filter before the limit', () => {
    const r = run(setup(), { kind: 'refresh', maxUnits: 2, filter: { domains: ['ground'] } }).s;
    expect(acted(r)).toEqual([true, false, true, false, false, true]); // lancer and skimmer, not the wasp
  });
  it('breaks a cost tie by unit id', () => {
    let s = game([row(4)], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }]);
    s = withUnit(withUnit(s, 1, { acted: true }), 2, { acted: true });
    const r = run(s, { kind: 'refresh', maxUnits: 1 }).s;
    expect([unit(r, 1).acted, unit(r, 2).acted]).toEqual([false, true]);
  });
});

describe('InstantEffect: every kind announces itself', () => {
  const EVERY: InstantEffect[] = [
    { kind: 'heal', hp: 1 }, { kind: 'damageEnemies', hp: 1 }, { kind: 'strike', hp: 1, radius: 1, aim: 'mostValue' },
    { kind: 'drainPower', percent: 10 }, { kind: 'funds', amount: 1 }, { kind: 'enemyFundsPercent', percent: -10 },
    { kind: 'convertTerrain', from: ['flats'], to: 'canopy', adjacentTo: 'canopy', turns: 1 }, { kind: 'weather', weather: 'ionstorm', turns: 1 },
    { kind: 'reveal', turns: 1 }, { kind: 'enemyMove', delta: -1, turns: 1 }, { kind: 'refresh' },
  ];
  it('covers all eleven effect kinds', () => {
    expect(new Set(EVERY.map((e) => e.kind)).size).toBe(11);
  });
  it.each(EVERY.map((e) => [e.kind, e] as const))('%s emits exactly one powerEffect for the player who used it', (_kind, effect) => {
    const s = game(['.f..'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }]);
    const { events } = run(s, effect, 0);
    const fx = ev(events, 'powerEffect');
    expect(fx).toHaveLength(1);
    expect(fx[0].player).toBe(0);
    expect(fx[0].description.length).toBeGreaterThan(0);
  });
  it('runs a power\'s effects in order when the power is activated', () => {
    const co = mkCo(A, { surge: mkPower(3, [], [{ kind: 'damageEnemies', hp: 2 }, { kind: 'funds', amount: 100 }, { kind: 'refresh' }]) });
    let s = game([row(4)], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }], { a: co });
    s = withUnit(withPlayer(s, 0, { power: 27000 }), 1, { acted: true });
    const { state, events } = applyAction(s, SURGE);
    expect(ev(events, 'powerEffect').map((e) => e.description)).toHaveLength(3);
    expect(unit(state, 2).hp).toBe(80);
    expect(state.players[0].funds).toBe(s.players[0].funds + 100);
    expect(unit(state, 1).acted).toBe(false);
  });
});

// ---------------------------------------------------------------- modifiers

describe('commander registry', () => {
  it('looks up commanders from the registry and treats an unknown id as having no modifiers', () => {
    const s = game([row(3)], [{ type: 'trooper', owner: 0, x: 0, y: 0 }], { a: mkCo(A, { passive: [{ firepower: 25 }] }) });
    const id = s.players[0].commander;
    expect(commanderDef(id)?.id).toBe(id);
    expect(firepowerBonus(s, unit(s, 1))).toBe(25);
    setCommanderRegistry({});
    expect(commanderDef(id)).toBeUndefined();
    expect(activeModifiers(s, 0)).toEqual([]);
    expect(firepowerBonus(s, unit(s, 1))).toBe(0);
    expect(powerDef(s, 0, 'surge')).toBeNull();
  });
  it('is not fooled by ids that exist on every object', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(commanderDef(id)).toBeUndefined();
    }
    setCommanderRegistry({ [A]: mkCo(A) });
    expect(commanderDef('constructor')).toBeUndefined();
    resetCommanderRegistry();
    expect(commanderDef(A)).toBeUndefined();
  });
  it('lists passive, then the active power\'s modifiers, then the standard bonus', () => {
    const co = mkCo(A, {
      passive: [{ vision: 1 }], surge: mkPower(3, [{ move: 1 }]), overclock: mkPower(6, [{ move: 2 }]),
    });
    const s = game([row(3)], [], { a: co });
    expect(activeModifiers(s, 0)).toEqual([{ vision: 1 }]);
    expect(activeModifiers(withPlayer(s, 0, { powerState: 'surge' }), 0)).toEqual([{ vision: 1 }, { move: 1 }, STANDARD_POWER_MODIFIER]);
    expect(activeModifiers(withPlayer(s, 0, { powerState: 'overclock' }), 0)).toEqual([{ vision: 1 }, { move: 2 }, STANDARD_POWER_MODIFIER]);
    expect(activeModifiers(s, 1)).toEqual([]); // the other commander has no passive modifiers
  });
});

describe('UnitFilter keys', () => {
  const t = unitType;
  it('treats a missing or empty filter as matching everything', () => {
    expect(matchesFilter(undefined, t('trooper'), undefined)).toBe(true);
    expect(matchesFilter({}, t('wasp'), 'canopy')).toBe(true);
  });
  it('domains', () => {
    const f: UnitFilter = { domains: ['air'] };
    expect(matchesFilter(f, t('wasp'), 'flats')).toBe(true);
    expect(matchesFilter(f, t('trooper'), 'flats')).toBe(false);
    expect(matchesFilter(f, t('picket'), 'sea')).toBe(false);
    expect(matchesFilter({ domains: ['ground', 'sea'] }, t('picket'), 'sea')).toBe(true);
  });
  it('types', () => {
    const f: UnitFilter = { types: ['arc', 'salvo'] };
    expect(matchesFilter(f, t('arc'), undefined)).toBe(true);
    expect(matchesFilter(f, t('salvo'), undefined)).toBe(true);
    expect(matchesFilter(f, t('warden'), undefined)).toBe(false);
  });
  it('moveTypes', () => {
    const f: UnitFilter = { moveTypes: ['hover'] };
    expect(matchesFilter(f, t('lancer'), undefined)).toBe(true);
    expect(matchesFilter(f, t('skimmer'), undefined)).toBe(true);
    expect(matchesFilter(f, t('bastion'), undefined)).toBe(false); // tread
    expect(matchesFilter(f, t('trooper'), undefined)).toBe(false); // foot
  });
  it('indirect true means range minimum above 1, indirect false means direct', () => {
    for (const id of ['arc', 'salvo', 'dreadnought'] as const) {
      expect(matchesFilter({ indirect: true }, t(id), undefined)).toBe(true);
      expect(matchesFilter({ indirect: false }, t(id), undefined)).toBe(false);
    }
    for (const id of ['trooper', 'lancer', 'wasp', 'picket'] as const) {
      expect(matchesFilter({ indirect: true }, t(id), undefined)).toBe(false);
      expect(matchesFilter({ indirect: false }, t(id), undefined)).toBe(true);
    }
  });
  it('onTerrain looks at the tile the unit stands on, and fails when the tile is unknown', () => {
    const f: UnitFilter = { onTerrain: ['canopy', 'ridge'] };
    expect(matchesFilter(f, t('trooper'), 'canopy')).toBe(true);
    expect(matchesFilter(f, t('trooper'), 'ridge')).toBe(true);
    expect(matchesFilter(f, t('trooper'), 'flats')).toBe(false);
    expect(matchesFilter(f, t('trooper'), undefined)).toBe(false);
  });
  it('requires every key to match', () => {
    const f: UnitFilter = { domains: ['ground'], indirect: true, onTerrain: ['flats'] };
    expect(matchesFilter(f, t('arc'), 'flats')).toBe(true);
    expect(matchesFilter(f, t('arc'), 'canopy')).toBe(false); // terrain fails
    expect(matchesFilter(f, t('trooper'), 'flats')).toBe(false); // indirect fails
    expect(matchesFilter(f, t('dreadnought'), 'flats')).toBe(false); // domain fails
  });
  it('unitModifiers applies filters to the unit, its owner and the tile it would stand on', () => {
    const co = mkCo(A, { passive: [{ vision: 1, filter: { types: ['trooper'] } }, { move: 1, filter: { onTerrain: ['canopy'] } }, { defense: 5 }] });
    const s = game(['.f.'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'lancer', owner: 0, x: 2, y: 0 }], { a: co });
    expect(unitModifiers(s, unit(s, 1))).toEqual([{ vision: 1, filter: { types: ['trooper'] } }, { defense: 5 }]);
    expect(unitModifiers(s, unit(s, 2))).toEqual([{ defense: 5 }]);
    expect(unitModifiers(s, unit(s, 1), { x: 1, y: 0 })).toContainEqual({ move: 1, filter: { onTerrain: ['canopy'] } }); // standing on canopy instead
  });
});

describe('Modifier fields', () => {
  const FIELDS = ['firepower', 'defense', 'move', 'rangeMax', 'vision', 'costPercent', 'terrainStars', 'repairBonus', 'incomePercent', 'powerChargePercent'] as const;
  it.each(FIELDS)('sumField adds %s across modifiers and counts a missing value as 0', (f) => {
    expect(sumField([{ [f]: 3 } as Modifier, { [f]: -1 } as Modifier, {}], f)).toBe(2);
    expect(sumField([], f)).toBe(0);
  });

  it('firepower and defense: sum the modifiers, plus owned uplinks for firepower', () => {
    const co = mkCo(A, { passive: [{ firepower: 20 }, { firepower: -5, filter: { domains: ['air'] } }, { defense: 15 }] });
    const s = game(['U..'], [{ type: 'trooper', owner: 0, x: 1, y: 0 }, { type: 'wasp', owner: 0, x: 2, y: 0 }], { a: co, owners: ['0..'] });
    expect(firepowerBonus(s, unit(s, 1))).toBe(20 + 10); // uplink gives +10
    expect(firepowerBonus(s, unit(s, 2))).toBe(20 - 5 + 10);
    expect(defenseBonus(s, unit(s, 1))).toBe(15);
    const theirs = game(['U..'], [{ type: 'trooper', owner: 1, x: 1, y: 0 }, { type: 'trooper', owner: 0, x: 2, y: 0 }], { owners: ['0..'] });
    expect(firepowerBonus(theirs, unit(theirs, 1))).toBe(0); // someone else's uplink does not help you
  });

  it('firepower, defense and terrainStars reach the damage formula (known answers)', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }];
    const cases: { name: string; a: Modifier[]; b: Modifier[]; expected: [number, number] }[] = [
      { name: 'no modifiers', a: [], b: [], expected: [dmg({ base: 55, stars: 1 }), dmg({ base: 55, stars: 1, luck: 9 })] }, // 49..57
      { name: 'firepower +20', a: [NO_LUCK, { firepower: 20 }], b: [], expected: [dmg({ base: 55, stars: 1, atk: 120 }), dmg({ base: 55, stars: 1, atk: 120 })] }, // 59
      { name: 'defense +20', a: [NO_LUCK], b: [{ defense: 20 }], expected: [dmg({ base: 55, stars: 1, def: 120 }), dmg({ base: 55, stars: 1, def: 120 })] }, // 38
      { name: 'terrainStars +1', a: [NO_LUCK], b: [{ terrainStars: 1 }], expected: [dmg({ base: 55, stars: 2 }), dmg({ base: 55, stars: 2 })] }, // 44
      { name: 'luckMax 19', a: [{ luckMax: 19 }], b: [], expected: [dmg({ base: 55, stars: 1 }), dmg({ base: 55, stars: 1, luck: 19 })] },
      { name: 'luckMin -5', a: [{ luckMin: -5 }], b: [], expected: [dmg({ base: 55, stars: 1, luck: -5 }), dmg({ base: 55, stars: 1, luck: 9 })] },
    ];
    for (const c of cases) {
      const s = game(['..'], units, { a: mkCo(A, { passive: c.a }), b: mkCo(B, { passive: c.b }) });
      expect(forecast(s, 1, { x: 0, y: 0 }, { x: 1, y: 0 }).damage, c.name).toEqual(c.expected);
    }
    expect(dmg({ base: 55, stars: 1, atk: 120 })).toBe(59);
    expect(dmg({ base: 55, stars: 2 })).toBe(44);
  });

  it('move: adds tiles for matching units and never goes below 1; an ion storm slows air only', () => {
    const co = mkCo(A, { passive: [{ move: 1, filter: { types: ['trooper'] } }, { move: -9, filter: { types: ['lancer'] } }] });
    const units: FixtureUnit[] = [
      { type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'lancer', owner: 0, x: 1, y: 0 }, { type: 'bastion', owner: 0, x: 2, y: 0 }, { type: 'trooper', owner: 1, x: 5, y: 0 },
    ];
    const s = game([row(6)], units, { a: co });
    expect(effectiveMove(s, unit(s, 1))).toBe(unitType('trooper').move + 1);
    expect(effectiveMove(s, unit(s, 2))).toBe(1);
    expect(effectiveMove(s, unit(s, 3))).toBe(unitType('bastion').move);
    expect(effectiveMove(s, unit(s, 4))).toBe(unitType('trooper').move); // other commander
    // real movement follows: the +1 trooper reaches 4 tiles over flats, an unmodified one only 3
    expect(reachable(s, 1).has('4,0')).toBe(true);
    const plain = game([row(6)], units);
    expect(reachable(plain, 1).has('3,0')).toBe(true);
    expect(reachable(plain, 1).has('4,0')).toBe(false);
  });

  it('rangeMax: widens indirect units only, never below their minimum', () => {
    const co = (n: number) => mkCo(A, { passive: [{ rangeMax: n }] });
    const units: FixtureUnit[] = [{ type: 'arc', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 4, y: 0 }];
    const plain = game([row(5)], units);
    expect(effectiveRange(plain, unit(plain, 1))).toEqual([2, 3]);
    expect(attackTargets(plain, 1, { x: 0, y: 0 })).toEqual([]); // 4 tiles away is out of range
    const wide = game([row(5)], units, { a: co(2) });
    expect(effectiveRange(wide, unit(wide, 1))).toEqual([2, 5]);
    expect(attackTargets(wide, 1, { x: 0, y: 0 })).toEqual([{ x: 4, y: 0 }]);
    expect(effectiveRange(wide, unit(wide, 2))).toEqual([1, 1]); // direct unit: untouched
    const shrunk = game([row(5)], units, { a: co(-5) });
    expect(effectiveRange(shrunk, unit(shrunk, 1))).toEqual([2, 2]);
    expect(effectiveRange(plain, unit(plain, 2))).toEqual([1, 1]);
  });

  it('vision: adds to matching units; ridge gives foot and exo +3 (D-012.2); an ion storm takes 1, minimum 1', () => {
    const co = mkCo(A, { passive: [{ vision: 1, filter: { types: ['trooper'] } }] });
    const s = game(['^^^^', '....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'breacher', owner: 0, x: 1, y: 0 }, { type: 'colossus', owner: 0, x: 2, y: 0 },
      { type: 'wasp', owner: 0, x: 3, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 1 },
    ], { a: co });
    expect(effectiveVision(s, unit(s, 1))).toBe(2 + 1 + 3); // trooper: base + modifier + ridge
    expect(effectiveVision(s, unit(s, 2))).toBe(2 + 3); // exo
    expect(effectiveVision(s, unit(s, 3))).toBe(2); // walker: no ridge bonus
    expect(effectiveVision(s, unit(s, 4))).toBe(3); // air: no ridge bonus
    expect(effectiveVision(s, unit(s, 1), { x: 0, y: 1 })).toBe(2 + 1); // the same trooper standing on flats instead
    const storm = { ...s, weather: 'ionstorm' as const };
    expect(effectiveVision(storm, unit(s, 1))).toBe(2 + 1 + 3 - 1);
    const mule = game([row(3)], [{ type: 'mule', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 2, y: 0 }], { weather: 'ionstorm' });
    expect(effectiveVision(mule, unit(mule, 1))).toBe(1);
  });

  it('ridge vision (D-012.2): a trooper and a breacher on a ridge see base + 3, a tread unit on flats gets no bonus', () => {
    const s = game(['^^..'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'breacher', owner: 0, x: 1, y: 0 }, { type: 'bastion', owner: 0, x: 2, y: 0 },
      { type: 'trooper', owner: 1, x: 3, y: 0 },
    ]);
    expect(effectiveVision(s, unit(s, 1))).toBe(unitType('trooper').vision + 3);
    expect(effectiveVision(s, unit(s, 2))).toBe(unitType('breacher').vision + 3);
    expect(effectiveVision(s, unit(s, 3))).toBe(unitType('bastion').vision); // tread, on flats: no bonus
    expect(effectiveVision(s, unit(s, 1), { x: 2, y: 0 })).toBe(unitType('trooper').vision); // same trooper off the ridge
    expect(effectiveVision(s, unit(s, 4))).toBe(unitType('trooper').vision); // enemy trooper on flats
    expect(unitType('trooper').vision + 3).not.toBe(unitType('trooper').vision + 1); // the old +1 rule is gone
  });

  it('vision on a ridge shows in the fog grid: a trooper on a ridge sees 5 tiles, one on flats only 2', () => {
    const on = (terrain: string) => game([terrain], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 5, y: 0 }], { fog: true });
    expect(visibility(on('^.....'), 0)[0][5]).toBe(true);
    expect(visibility(on('......'), 0)[0][5]).toBe(false);
  });

  it('costPercent: changes production cost for matching types and building terrain, rounded, never below 0', () => {
    const co = mkCo(A, { passive: [
      { costPercent: -20, filter: { domains: ['air'] } },
      { costPercent: 33, filter: { types: ['trooper'] } },
      { costPercent: -50, filter: { onTerrain: ['skyport'] } },
    ] });
    const s = game(['AF.'], [], { a: co, owners: ['00.'] });
    const sky = { x: 0, y: 0 };
    const fab = { x: 1, y: 0 };
    expect(unitCost(s, 0, unitType('wasp'))).toBe(7200); // -20% of 9000, no building given
    expect(unitCost(s, 0, unitType('wasp'), fab)).toBe(7200);
    expect(unitCost(s, 0, unitType('wasp'), sky)).toBe(2700); // on the skyport both apply: -20% and -50% = -70%, so 30% of 9000
    expect(unitCost(s, 0, unitType('trooper'), fab)).toBe(1330);
    expect(unitCost(s, 0, unitType('lancer'), fab)).toBe(7000);
    expect(unitCost(s, 1, unitType('wasp'))).toBe(9000); // the other commander pays list price
    const free = game(['F'], [], { a: mkCo(A, { passive: [{ costPercent: -150 }] }), owners: ['0'] });
    expect(unitCost(free, 0, unitType('trooper'))).toBe(0);
    // and a real build pays the modified price
    const buy = game(['F..'], [], { a: mkCo(A, { passive: [{ costPercent: 20 }] }), owners: ['0..'], startFunds: 5000 });
    const { state, events } = applyAction(buy, { kind: 'build', at: { x: 0, y: 0 }, unitType: 'trooper' });
    expect(ev(events, 'built')[0].cost).toBe(1200);
    expect(state.players[0].funds).toBe(buy.players[0].funds - 1200);
  });

  it('terrainStars: adds stars for ground and sea units on any terrain, never for air, never below 0', () => {
    const co = mkCo(A, { passive: [{ terrainStars: 1 }] });
    const s = game(['.f=~.'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 0, x: 2, y: 0 },
      { type: 'picket', owner: 0, x: 3, y: 0 }, { type: 'wasp', owner: 0, x: 4, y: 0 },
    ], { a: co });
    expect(terrainStarsFor(s, unit(s, 1))).toBe(1 + 1); // flats 1 + 1
    expect(terrainStarsFor(s, unit(s, 2))).toBe(2 + 1); // canopy
    expect(terrainStarsFor(s, unit(s, 3))).toBe(0 + 1); // maglev gives 0 stars; the bonus still applies
    expect(terrainStarsFor(s, unit(s, 4))).toBe(0 + 1); // sea
    expect(terrainStarsFor(s, unit(s, 5))).toBe(0); // air never gets terrain stars
    const wasp = game(['f'], [{ type: 'wasp', owner: 0, x: 0, y: 0 }], { a: mkCo(A, { passive: [{ terrainStars: 3 }] }) });
    expect(terrainStarsFor(wasp, unit(wasp, 1))).toBe(0);
    const worse = game(['.'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }], { a: mkCo(A, { passive: [{ terrainStars: -3 }] }) });
    expect(terrainStarsFor(worse, unit(worse, 1))).toBe(0); // 1 - 3 clamps at 0
    const maru = game(['f.'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }], { a: mkCo(A, { passive: [{ terrainStars: 1, filter: { onTerrain: ['canopy'] } }] }) });
    expect(terrainStarsFor(maru, unit(maru, 1))).toBe(3);
    expect(terrainStarsFor(maru, unit(maru, 2))).toBe(1);
  });

  it('luckMax / luckMin: replace the default 0..9, the widest range among modifiers wins', () => {
    const rangeOf = (mods: Modifier[]) => {
      const s = game(['..'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }], { a: mkCo(A, { passive: mods }) });
      return luckRange(s, unit(s, 1));
    };
    expect([DEFAULT_LUCK_MIN, DEFAULT_LUCK_MAX]).toEqual([0, 9]);
    expect(rangeOf([])).toEqual([0, 9]);
    expect(rangeOf([{ luckMax: 19 }])).toEqual([0, 19]);
    expect(rangeOf([{ luckMax: 0 }])).toEqual([0, 0]);
    expect(rangeOf([{ luckMax: 4 }])).toEqual([0, 4]); // lower than default: replaces it
    expect(rangeOf([{ luckMin: -10 }])).toEqual([-10, 9]);
    expect(rangeOf([{ luckMax: 14, luckMin: -4 }])).toEqual([-4, 14]);
    expect(rangeOf([{ luckMax: 14 }, { luckMax: 19 }, { luckMin: -3 }, { luckMin: -8 }])).toEqual([-8, 19]);
  });

  it('luckMax 0 removes all luck from real attacks; the default rolls vary within 0..9', () => {
    const strike = (a: CommanderDef, seed: number) => {
      const s = game(['..'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }], { a, seed });
      return ev(applyAction(s, attack(1, [0, 0], [1, 0])).events, 'attacked')[0].damage;
    };
    const flat = new Set<number>();
    const wild = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      flat.add(strike(mkCo(A, { passive: [NO_LUCK] }), seed));
      wild.add(strike(mkCo(A), seed));
    }
    expect([...flat]).toEqual([dmg({ base: 55, stars: 1 })]);
    expect(wild.size).toBeGreaterThan(1);
    for (const d of wild) {
      expect(d).toBeGreaterThanOrEqual(dmg({ base: 55, stars: 1, luck: 0 }));
      expect(d).toBeLessThanOrEqual(dmg({ base: 55, stars: 1, luck: 9 }));
    }
  });

  it('ignoreMoveCost: listed terrains cost 1 for matching units, but impassable terrain stays impassable', () => {
    const units: FixtureUnit[] = [{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 8, y: 1 }];
    const terrain = ['.fffff...', '.fffff...'];
    const plain = game(terrain, units);
    expect(reachable(plain, 1).has('2,0')).toBe(true); // canopy costs hover 3: two tiles is the limit (6)
    expect(reachable(plain, 1).has('3,0')).toBe(false);
    const co = mkCo(A, { passive: [{ ignoreMoveCost: ['canopy'], filter: { moveTypes: ['hover'] } }] });
    const s = game(terrain, units, { a: co });
    expect(ignoredMoveCosts(s, unit(s, 1))).toEqual(new Set(['canopy']));
    expect(ignoredMoveCosts(s, unit(s, 2)).size).toBe(0); // foot units are not hover
    const reach = reachable(s, 1);
    expect(reach.has('5,0')).toBe(true);
    expect(reach.has('6,0')).toBe(true);
    expect(reach.has('7,0')).toBe(false);
    // known-bad: hover cannot enter ridge at all, and "ignoring" it must not change that
    const ridge = game(['.^^..'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 4, y: 0 }], { a: mkCo(A, { passive: [{ ignoreMoveCost: ['ridge'] }] }) });
    expect(reachable(ridge, 1).has('1,0')).toBe(false);
  });

  it('counterFirst: the defender strikes first at full strength, and only while the modifier applies', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0, hp: 1 }, { type: 'trooper', owner: 1, x: 1, y: 0 }];
    const withFirst = game(['..'], units, { a: mkCo(A, { passive: [NO_LUCK] }), b: mkCo(B, { passive: [NO_LUCK, { counterFirst: true }] }) });
    expect(hasCounterFirst(withFirst, unit(withFirst, 2))).toBe(true);
    expect(hasCounterFirst(withFirst, unit(withFirst, 1))).toBe(false);
    const r = applyAction(withFirst, attack(1, [0, 0], [1, 0]));
    const hit = ev(r.events, 'attacked')[0];
    expect(hit).toMatchObject({ counterFirst: true, damage: 0, counter: 10 }); // the 1 HP attacker dies before it can strike
    expect(unitById(r.state, 1)).toBeUndefined();
    expect(unit(r.state, 2).hp).toBe(100);
    // without it, the attacker lands its (weak) blow first: 1 display HP deals floor(55 x 90 / 1000) = 4
    const normal = game(['..'], units, { a: mkCo(A, { passive: [NO_LUCK] }), b: mkCo(B, { passive: [NO_LUCK] }) });
    const h2 = ev(applyAction(normal, attack(1, [0, 0], [1, 0])).events, 'attacked')[0];
    expect(h2.damage).toBe(dmg({ base: 55, stars: 1, ahp: 1 }));
    expect(h2.damage).toBe(4);
    expect(h2.counterFirst).toBeUndefined();
    // a power's counterFirst only counts while that power is active
    const co = mkCo(B, { surge: mkPower(3, [{ counterFirst: true }]) });
    const s = game(['..'], units, { b: co });
    expect(hasCounterFirst(s, unit(s, 2))).toBe(false);
    expect(hasCounterFirst(withPlayer(s, 1, { powerState: 'surge' }), unit(s, 2))).toBe(true);
  });

  it('repairBonus: extra display HP repaired on owned properties at turn start', () => {
    const owned = (bonus: number, funds = 0) => game(['F..'], [
      { type: 'trooper', owner: 0, x: 0, y: 0, hp: 5 }, { type: 'trooper', owner: 1, x: 2, y: 0 },
    ], { a: mkCo(A, { passive: bonus ? [{ repairBonus: bonus }] : [] }), owners: ['0..'], startFunds: funds });
    const base = owned(0);
    expect(unit(base, 1).hp).toBe(50 + 2 * 10); // +2 display HP
    const plus1 = owned(1);
    expect(unit(plus1, 1).hp).toBe(50 + 3 * 10);
    expect(plus1.players[0].funds).toBe(1000 - 300); // income 1000, 3 display HP of a 1000-cost unit
    expect(sumField(unitModifiers(plus1, unit(plus1, 1)), 'repairBonus')).toBe(1);
    expect(unit(owned(3), 1).hp).toBe(100); // capped
    const filtered = game(['F..'], [{ type: 'trooper', owner: 0, x: 0, y: 0, hp: 5 }, { type: 'trooper', owner: 1, x: 2, y: 0 }],
      { a: mkCo(A, { passive: [{ repairBonus: 1, filter: { domains: ['air'] } }] }), owners: ['0..'] });
    expect(unit(filtered, 1).hp).toBe(70); // a ground unit does not get the air bonus
  });

  it('incomePercent: changes income for the owner, rounded down, never below 0', () => {
    const inc = (pct: number) => incomeOf(game(['F.F'], [], { a: mkCo(A, { passive: [{ incomePercent: pct }] }), owners: ['0.0'] }), 0);
    expect(inc(0)).toBe(2000);
    expect(inc(15)).toBe(2300);
    expect(inc(-50)).toBe(1000);
    expect(inc(-150)).toBe(0);
    const s = game(['F.F'], [], { a: mkCo(A, { passive: [{ incomePercent: 15 }] }), owners: ['0.0'] });
    expect(s.players[0].funds).toBe(2300); // paid on the first turn start
    expect(incomeOf(s, 1)).toBe(0);
    const surge = game(['F.F'], [], { a: mkCo(A, { surge: mkPower(3, [{ incomePercent: 50 }]) }), owners: ['0.0'] });
    expect(incomeOf(surge, 0)).toBe(2000);
    expect(incomeOf(withPlayer(surge, 0, { powerState: 'surge' }), 0)).toBe(3000); // power modifiers count while active
  });

  it('indirectAfterMove: lets indirect units move and fire, only the ones the filter names', () => {
    const units: FixtureUnit[] = [{ type: 'arc', owner: 0, x: 0, y: 0 }, { type: 'salvo', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 4, y: 0 }];
    const terrain = [row(5), row(5)];
    const plain = game(terrain, units);
    const dest = { x: 1, y: 0 }; // three tiles from the trooper: inside the arc's 2..3
    expect(canFireAfterMove(plain, unit(plain, 1), dest)).toBe(false);
    expect(thenOptions(plain, 1, dest)).toEqual(['wait']);
    expect(isLegal(plain, attack(1, [0, 0], [4, 0]))).toBe(false);
    const co = mkCo(A, { passive: [{ indirectAfterMove: true, filter: { types: ['arc'] } }] });
    const s = game(terrain, units, { a: co });
    expect(canFireAfterMove(s, unit(s, 1), dest)).toBe(true);
    expect(canFireAfterMove(s, unit(s, 2), { x: 1, y: 1 })).toBe(false); // the salvo is not named
    expect(thenOptions(s, 1, dest)).toEqual(['attack', 'wait']);
    const move: Action = { kind: 'move', unitId: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], then: { kind: 'attack', target: { x: 4, y: 0 } } };
    expect(isLegal(s, move)).toBe(true);
    expect(isLegal(plain, move)).toBe(false);
    // as a power: only while it is active
    const power = game(terrain, units, { a: mkCo(A, { surge: mkPower(3, [{ indirectAfterMove: true, filter: { indirect: true } }]) }) });
    expect(canFireAfterMove(power, unit(power, 1), dest)).toBe(false);
    expect(canFireAfterMove(withPlayer(power, 0, { powerState: 'surge' }), unit(power, 1), dest)).toBe(true);
  });
});

// ---------------------------------------------------------------- known divergences (code outside this order's TOUCHES)
// `it.fails` passes while the divergence exists and goes red the day it is fixed: then change it to `it`.
// The M1.2 combat change (meter from INTERNAL HP lost) makes the 10.1 test below pass: flip it to `it` when M1.2 is merged.

describe('known divergences from mechanics.md', () => {
  it.fails('10.1: the meter value uses INTERNAL HP lost (combat.ts strike() counts display HP instead)', () => {
    // arc (base 90) on a trooper standing on flats (1 star): 81 internal HP lost
    const s = game(['...'], [{ type: 'arc', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 2, y: 0 }],
      { a: mkCo(A, { passive: [NO_LUCK] }), b: mkCo(B, { passive: [NO_LUCK] }) });
    const { state, events } = applyAction(s, attack(1, [0, 0], [2, 0]));
    const lost = dmg({ base: 90, stars: 1 });
    expect(ev(events, 'attacked')[0].damage).toBe(lost);
    const value = (unitType('trooper').cost * lost) / 100; // 810
    expect(state.players[1].power).toBe(value);
    expect(state.players[0].power).toBe(value * 0.5);
  });

  // Fixed by M1.3 (turn.ts clears the power before income); now a plain regression test.
  it('2.1 step 1: the previous power is cleared BEFORE income, so it no longer shapes income', () => {
    const co = mkCo(A, { surge: mkPower(3, [{ incomePercent: 50 }]) });
    let s = game(['F.F.'], [{ type: 'trooper', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }], { a: co, owners: ['0.0.'] });
    s = applyAction(withPlayer(s, 0, { power: 27000 }), SURGE).state;
    const before = s.players[0].funds;
    s = endTurns(s, 2);
    expect(s.players[0].funds - before).toBe(2000); // plain income, not 3000 (+50% from the expired power)
  });
});
