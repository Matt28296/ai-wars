// Combat tests (docs/research/mechanics.md section 4 and 10.1). Expected numbers are computed here from the DAMAGE chart and the
// spec's formula, or written out by hand from the worked examples. Nothing below calls the code under test to get its answer.
import { afterEach, describe, expect, it } from 'vitest';
import type { CommanderDef } from '../../content/types';
import { DAMAGE } from '../../data/damage';
import { canCounter, damageValue, destroyUnit, resolveAttack, weaponAgainst } from './combat';
import {
  applyAction, attackRangeTiles, attackTargets, createGame, forecast, IllegalActionError, isLegal, resetCommanderRegistry,
  setCommanderRegistry, thenOptions, unitAt, unitById,
} from './index';
import { randomInt } from './rng';
import { draft } from './state';
import { fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import type { Action, Coord, GameEvent, GameState, Modifier, PowerDef, PowerState, Unit, UnitTypeId, Weather } from './types';

// ---------------------------------------------------------------- reference formula and data

/** The chart value for one matchup; throws when the chart has no entry, so a test never runs on a hole in the data. */
function chart(attacker: UnitTypeId, defender: UnitTypeId, weapon: 'primary' | 'secondary' = 'primary'): number {
  const v = DAMAGE[attacker][weapon]?.[defender];
  if (v === undefined) throw new Error(`DAMAGE has no ${weapon} entry for ${attacker} vs ${defender}`);
  return v;
}

const displayHp = (hp: number) => Math.ceil(hp / 10);

/** Spec 4.1 in its integer form, written out from the document (ahp and dhp are DISPLAY HP). */
function expectDamage(o: { b: number; luck: number; ahp: number; dhp: number; stars: number; atk?: number; def?: number }): number {
  const atk = o.atk ?? 100;
  const def = o.def ?? 100;
  const defenseTerm = Math.max(0, 200 - (def + o.stars * o.dhp));
  return Math.floor(((o.b * atk + 100 * o.luck) * o.ahp * defenseTerm) / 100_000);
}

/** The damage a full-HP attacker deals a full-HP defender, at the bottom and the top of the default luck range. */
const range = (o: Omit<Parameters<typeof expectDamage>[0], 'luck'>, luckMin = 0, luckMax = 9): [number, number] =>
  [expectDamage({ ...o, luck: luckMin }), expectDamage({ ...o, luck: luckMax })];

// ---------------------------------------------------------------- fixtures

const u = (type: UnitTypeId, owner: number, x: number, y: number, hp?: number): FixtureUnit => ({ type, owner, x, y, ...(hp ? { hp } : {}) });
const at = (x: number, y: number): Coord => ({ x, y });

interface Setup { co?: [string, string]; owners?: string[]; fog?: boolean; seed?: number; weather?: Weather }

/** A two-player game on a fixture map (player 0 is current). Commanders default to 'none' (no modifiers, no powers). */
function game(rows: string[], units: FixtureUnit[], o: Setup = {}): GameState {
  return createGame({
    map: fixtureMap(rows, units, o.owners),
    players: [
      { faction: 'helion', commander: o.co?.[0] ?? 'none', controller: 'ai', team: 0 },
      { faction: 'tidewell', commander: o.co?.[1] ?? 'none', controller: 'ai', team: 1 },
    ],
    seed: o.seed ?? 1, fog: o.fog, weather: o.weather,
  });
}

/** Players 0 and 1 are teammates; player 2 is the enemy. */
function game3(rows: string[], units: FixtureUnit[]): GameState {
  return createGame({
    map: fixtureMap(rows, units),
    players: [
      { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
      { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
      { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
    ],
  });
}

const patchUnit = (s: GameState, id: number, patch: Partial<Unit>): GameState =>
  ({ ...s, units: s.units.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
const setPower = (s: GameState, player: number, powerState: PowerState): GameState =>
  ({ ...s, players: s.players.map((p) => (p.index === player ? { ...p, powerState } : p)) });
const withCapture = (s: GameState, x: number, y: number, capture: number): GameState =>
  ({ ...s, tiles: s.tiles.map((row, ry) => (ry === y ? row.map((t, rx) => (rx === x ? { ...t, capture } : t)) : row)) });
/** Puts the unit `cargoId` aboard `transportId` (carrying whatever it already carries). */
function load(s: GameState, cargoId: number, transportId: number): GameState {
  const cargo = s.units.find((x) => x.id === cargoId)!;
  return {
    ...s,
    units: s.units.filter((x) => x.id !== cargoId).map((x) => (x.id === transportId ? { ...x, cargo: [...x.cargo, { ...cargo, x: x.x, y: x.y }] } : x)),
  };
}

const unit = (s: GameState, id: number): Unit => {
  const found = unitById(s, id);
  if (!found) throw new Error(`no unit ${id}`);
  return found;
};

const POWER = (stars: number): PowerDef => ({ name: 'test power', stars, quote: '', description: '', modifiers: [], effects: [] });
/** A test commander. With `powers` it has a 3-star Surge and a 6-star Overclock, so its meter can fill (cap 54000). */
function co(id: string, mods: Modifier[] = [], powers = false): CommanderDef {
  return {
    id, name: id, initials: 'T', faction: null, title: 'test', pronouns: 'they/them', bio: '', voice: '',
    passive: { name: 'test', description: '', modifiers: mods },
    surge: powers ? POWER(3) : null, overclock: powers ? POWER(6) : null,
    lines: { select: '', victory: '', defeat: '' }, playable: false,
  };
}
function useCos(...defs: CommanderDef[]): void {
  setCommanderRegistry(Object.fromEntries(defs.map((d) => [d.id, d])));
}
afterEach(() => resetCommanderRegistry());

const attackedEvent = (events: GameEvent[]) => {
  const e = events.find((x) => x.kind === 'attacked');
  if (!e || e.kind !== 'attacked') throw new Error('no attacked event');
  return e;
};
const kinds = (events: GameEvent[]) => events.map((e) => e.kind);
const keys = (cs: Coord[]) => cs.map((c) => `${c.x},${c.y}`).sort();

/** Resolves one attack on a draft of `s` (attacker already in place). */
function fight(s: GameState, attackerId: number, target: Coord) {
  const ctx = draft(s);
  resolveAttack(ctx, unit(ctx.s, attackerId), target);
  return { s: ctx.s, events: ctx.events };
}

/** The first seed whose first two luck draws (0..9) differ, so tests can tell the attack's draw from the counter's. */
function distinctSeed(): number {
  for (let seed = 1; seed < 100; seed++) {
    const [a, next] = randomInt(seed | 0, 0, 9);
    const [b] = randomInt(next, 0, 9);
    if (a !== b) return seed;
  }
  throw new Error('no seed with distinct draws');
}
const SEED = distinctSeed();
/** The luck values the next two draws of an int32 generator state yield over [lo, hi], and the state after them. */
function draws(rng: number, lo = 0, hi = 9) {
  const [first, r1] = randomInt(rng, lo, hi);
  const [second, r2] = randomInt(r1, lo, hi);
  return { first, second, after: r2 };
}

const LANCERS = [u('lancer', 0, 0, 0), u('lancer', 1, 1, 0)];

// ================================================================ 1. the damage formula

describe('damage formula: the worked examples of spec 4.2', () => {
  it('lancer vs lancer on flats: 55 x 1.0 x 0.90 = 49 to 57', () => {
    const s = game(['..'], LANCERS);
    const expected = range({ b: chart('lancer', 'lancer'), ahp: 10, dhp: 10, stars: 1 });
    expect(expected, 'spec 4.2 row 1').toEqual([49, 57]);
    expect(forecast(s, 1, at(0, 0), at(1, 0)).damage).toEqual(expected);
  });

  it('the counter from the 6-HP survivor (51 hp) is 29 to 34, and the next attack after 49 damage leaves exactly that HP', () => {
    const s = game(['..'], LANCERS);
    const [a, d] = s.units;
    expect(100 - 49).toBe(51);
    expect(displayHp(51)).toBe(6);
    const counter = [0, 9].map((luck) => damageValue(s, d, d, 51, a, a, 100, luck, chart('lancer', 'lancer')));
    expect(counter, 'spec 4.2 row 2').toEqual([29, 34]);
    expect(counter).toEqual(range({ b: 55, ahp: 6, dhp: 10, stars: 1 }));
  });

  it('trooper vs trooper on a ridge (4 stars): 33 to 38', () => {
    const s = game(['.^'], [u('trooper', 0, 0, 0), u('trooper', 1, 1, 0)]);
    const expected = range({ b: chart('trooper', 'trooper', 'secondary'), ahp: 10, dhp: 10, stars: 4 });
    expect(expected, 'spec 4.2 row 3').toEqual([33, 38]);
    expect(forecast(s, 1, at(0, 0), at(1, 0)).damage).toEqual(expected);
  });

  it('trooper vs a 5-HP trooper on a ridge: 44 to 51 (a star is worth less to a hurt defender)', () => {
    const s = game(['.^'], [u('trooper', 0, 0, 0), u('trooper', 1, 1, 0, 5)]);
    const expected = range({ b: 55, ahp: 10, dhp: 5, stars: 4 });
    expect(expected, 'spec 4.2 row 4').toEqual([44, 51]);
    expect(forecast(s, 1, at(0, 0), at(1, 0)).damage).toEqual(expected);
  });

  it('arc vs bastion on an arcology (3 stars): 31 to 37', () => {
    const s = game(['..C'], [u('arc', 0, 0, 0), u('bastion', 1, 2, 0)]);
    const expected = range({ b: chart('arc', 'bastion'), ahp: 10, dhp: 10, stars: 3 });
    expect(expected, 'spec 4.2 row 5').toEqual([31, 37]);
    expect(forecast(s, 1, at(0, 0), at(2, 0)).damage).toEqual(expected);
  });

  it('bastion vs lancer at ATK 140 (passive 20 + one uplink 10 + active power 10): 107 and a kill', () => {
    useCos(co('fp20', [{ firepower: 20 }]));
    const rows = ['..U'];
    const units = [u('bastion', 0, 0, 0), u('lancer', 1, 1, 0)];
    const full = setPower(game(rows, units, { co: ['fp20', 'none'], owners: ['..0'] }), 0, 'surge');
    const expected = range({ b: chart('bastion', 'lancer'), atk: 140, ahp: 10, dhp: 10, stars: 1 });
    expect(expected[0], 'spec 4.2 row 6').toBe(107);
    expect(expected[1]).toBeGreaterThanOrEqual(100);
    expect(forecast(full, 1, at(0, 0), at(1, 0)).damage).toEqual(expected);
    // Each of the three components is needed: drop one and the number moves.
    const noPower = game(rows, units, { co: ['fp20', 'none'], owners: ['..0'] });
    const noUplink = setPower(game(rows, units, { co: ['fp20', 'none'] }), 0, 'surge');
    const noPassive = setPower(game(rows, units, { owners: ['..0'] }), 0, 'surge');
    for (const [s, atk] of [[noPower, 130], [noUplink, 130], [noPassive, 120]] as const) {
      expect(forecast(s, 1, at(0, 0), at(1, 0)).damage).toEqual(range({ b: 85, atk, ahp: 10, dhp: 10, stars: 1 }));
    }
  });

  it('warden vs a wasp hovering over canopy: 120 and a kill, because air units get no terrain stars', () => {
    const s = game(['.f'], [u('warden', 0, 0, 0), u('wasp', 1, 1, 0)]);
    const expected = range({ b: chart('warden', 'wasp'), ahp: 10, dhp: 10, stars: 0 });
    expect(expected[0], 'spec 4.2 row 7').toBe(120);
    expect(forecast(s, 1, at(0, 0), at(1, 0)).damage).toEqual(expected);
  });
});

describe('damage formula: each term', () => {
  it('air defenders get no stars on any terrain, ground defenders on canopy do', () => {
    const wasp = (tile: string) => forecast(game(['.' + tile], [u('warden', 0, 0, 0), u('wasp', 1, 1, 0)]), 1, at(0, 0), at(1, 0)).damage;
    const air = range({ b: 120, ahp: 10, dhp: 10, stars: 0 });
    expect([wasp('.'), wasp('f'), wasp('^')]).toEqual([air, air, air]);
    const trooper = forecast(game(['.f'], [u('warden', 0, 0, 0), u('trooper', 1, 1, 0)]), 1, at(0, 0), at(1, 0)).damage;
    expect(trooper).toEqual(range({ b: chart('warden', 'trooper'), ahp: 10, dhp: 10, stars: 2 }));
  });

  it('attacker damage scales with DISPLAY HP, rounded up (hp 51 and 60 both count as 6)', () => {
    const s = game(['..'], LANCERS);
    const [a, d] = s.units;
    const hit = (aHp: number) => damageValue(s, a, a, aHp, d, d, 100, 0, 55);
    // 5500 x AHP x 90 / 100000 for AHP = 10, 7, 6, 6, 5, 1
    expect([100, 61, 60, 51, 50, 1].map(hit)).toEqual([49, 34, 29, 29, 24, 4]);
    expect([100, 61, 60, 51, 50, 1].map((hp) => expectDamage({ b: 55, luck: 0, ahp: displayHp(hp), dhp: 10, stars: 1 }))).toEqual([49, 34, 29, 29, 24, 4]);
  });

  it('terrain stars are weighted by the defender DISPLAY HP', () => {
    const s = game(['.^'], [u('trooper', 0, 0, 0), u('trooper', 1, 1, 0)]);
    const [a, d] = s.units;
    const hit = (dHp: number) => damageValue(s, a, a, 100, d, d, dHp, 0, 55);
    // 5500 x 10 x (200 - (100 + 4 x DHP)) / 100000 for DHP = 10, 6, 6, 5, 1
    expect([100, 60, 51, 50, 10].map(hit)).toEqual([33, 41, 41, 44, 52]);
  });

  it('a firepower modifier raises and a defense modifier lowers the damage, additively in percent', () => {
    useCos(co('fp20', [{ firepower: 20 }]), co('def20', [{ defense: 20 }]), co('def-10', [{ defense: -10 }]));
    const first = (a: string, d: string) => forecast(game(['..'], LANCERS, { co: [a, d] }), 1, at(0, 0), at(1, 0)).damage;
    // luck 0: 6600 x 10 x 90 / 1e5 = 59.4;  5500 x 10 x 70 / 1e5 = 38.5;  6600 x 10 x 70 / 1e5 = 46.2;  5500 x 10 x 100 / 1e5 = 55
    expect(first('fp20', 'none')[0]).toBe(59);
    expect(first('none', 'def20')[0]).toBe(38);
    expect(first('fp20', 'def20')[0]).toBe(46);
    expect(first('none', 'def-10')[0]).toBe(55);
    expect(first('fp20', 'def20')).toEqual(range({ b: 55, atk: 120, def: 120, ahp: 10, dhp: 10, stars: 1 }));
  });

  it('luck is added after the firepower multiplier, not multiplied by it', () => {
    useCos(co('fp40', [{ firepower: 40 }]));
    const s = game(['..'], [u('bastion', 0, 0, 0), u('lancer', 1, 1, 0)], { co: ['fp40', 'none'] });
    const [, hi] = forecast(s, 1, at(0, 0), at(1, 0)).damage;
    // (85 x 1.4 + 9) x 10 x 90 / 1000 = 115.2 -> 115. Multiplying luck too would give (85 + 9) x 1.4 -> 118.
    expect(hi).toBe(115);
  });

  it('a modifier with a unit filter applies only to matching units', () => {
    useCos(co('bastions', [{ filter: { types: ['bastion'] }, firepower: 50 }]));
    const lancer = forecast(game(['..'], LANCERS, { co: ['bastions', 'none'] }), 1, at(0, 0), at(1, 0)).damage;
    expect(lancer).toEqual(range({ b: 55, ahp: 10, dhp: 10, stars: 1 }));
    const bastion = forecast(game(['..'], [u('bastion', 0, 0, 0), u('lancer', 1, 1, 0)], { co: ['bastions', 'none'] }), 1, at(0, 0), at(1, 0)).damage;
    expect(bastion).toEqual(range({ b: 85, atk: 150, ahp: 10, dhp: 10, stars: 1 }));
  });

  it('terrain-conditional modifiers read the defender tile and the attacker FIRING tile', () => {
    useCos(co('ridge-wall', [{ filter: { onTerrain: ['ridge'] }, defense: 30 }]), co('ridge-gun', [{ filter: { onTerrain: ['ridge'] }, firepower: 50 }]));
    const wall = (tile: string) => forecast(game(['.' + tile], [u('trooper', 0, 0, 0), u('trooper', 1, 1, 0)], { co: ['none', 'ridge-wall'] }), 1, at(0, 0), at(1, 0)).damage;
    expect(wall('^')).toEqual(range({ b: 55, def: 130, ahp: 10, dhp: 10, stars: 4 }));
    expect(wall('.')).toEqual(range({ b: 55, ahp: 10, dhp: 10, stars: 1 }));
    // The gunner is on flats now, but forecast from the ridge tile it would move to.
    const s = game(['.^', '..'], [u('trooper', 0, 0, 0), u('trooper', 1, 1, 1)], { co: ['ridge-gun', 'none'] });
    expect(forecast(s, 1, at(1, 0), at(1, 1)).damage).toEqual(range({ b: 55, atk: 150, ahp: 10, dhp: 10, stars: 1 }));
    expect(forecast(s, 1, at(0, 1), at(1, 1)).damage).toEqual(range({ b: 55, ahp: 10, dhp: 10, stars: 1 }));
    // And the real attack, after the move, uses the bonus.
    const moved = applyAction(s, { kind: 'move', unitId: 1, path: [at(0, 0), at(1, 0)], then: { kind: 'attack', target: at(1, 1) } });
    const [lo, hi] = range({ b: 55, atk: 150, ahp: 10, dhp: 10, stars: 1 });
    expect(attackedEvent(moved.events).damage).toBeGreaterThanOrEqual(lo);
    expect(attackedEvent(moved.events).damage).toBeLessThanOrEqual(hi);
  });

  it('the terrainStars modifier adds stars to ground defenders and never to air defenders', () => {
    useCos(co('dig-in', [{ terrainStars: 1 }]));
    const ground = forecast(game(['..'], LANCERS, { co: ['none', 'dig-in'] }), 1, at(0, 0), at(1, 0)).damage;
    expect(ground).toEqual(range({ b: 55, ahp: 10, dhp: 10, stars: 2 }));
    const air = forecast(game(['..'], [u('warden', 0, 0, 0), u('wasp', 1, 1, 0)], { co: ['none', 'dig-in'] }), 1, at(0, 0), at(1, 0)).damage;
    expect(air).toEqual(range({ b: 120, ahp: 10, dhp: 10, stars: 0 }));
  });

  it('each owned uplink adds 10 firepower; an enemy-owned or neutral uplink adds nothing', () => {
    const run = (owners: string) => forecast(game(['..UU'], LANCERS, { owners: [owners] }), 1, at(0, 0), at(1, 0)).damage;
    expect(run('..00')).toEqual(range({ b: 55, atk: 120, ahp: 10, dhp: 10, stars: 1 })); // [59, 67]
    expect(run('..0.')).toEqual(range({ b: 55, atk: 110, ahp: 10, dhp: 10, stars: 1 })); // [54, 62]
    expect(run('..11')).toEqual(range({ b: 55, ahp: 10, dhp: 10, stars: 1 }));           // [49, 57]
    expect(run('....')).toEqual([49, 57]);
    expect(run('..00')).toEqual([59, 67]);
  });

  it('an active power gives its owner +10 firepower when attacking and +10 defense when defending', () => {
    const rows = ['..'];
    const f = (s: GameState) => forecast(s, 1, at(0, 0), at(1, 0)).damage;
    const base = game(rows, LANCERS);
    expect(f(setPower(base, 0, 'surge'))).toEqual(range({ b: 55, atk: 110, ahp: 10, dhp: 10, stars: 1 })); // [54, 62]
    expect(f(setPower(base, 1, 'overclock'))).toEqual(range({ b: 55, def: 110, ahp: 10, dhp: 10, stars: 1 })); // [44, 51]
    expect(f(setPower(setPower(base, 0, 'overclock'), 1, 'surge'))).toEqual([48, 55]);
    expect(f(base)).toEqual([49, 57]);
  });

  it('damage is never negative: huge defense and strongly negative luck both floor at 0', () => {
    useCos(co('wall', [{ defense: 200 }]), co('cursed', [{ luckMin: -100, luckMax: -50 }]));
    expect(forecast(game(['..'], LANCERS, { co: ['none', 'wall'] }), 1, at(0, 0), at(1, 0)).damage).toEqual([0, 0]);
    // luck -100 gives a negative offense (0 damage); luck -50 gives 500 x 10 x 90 / 1e5 = 4.5 -> 4.
    expect(forecast(game(['..'], LANCERS, { co: ['cursed', 'none'] }), 1, at(0, 0), at(1, 0)).damage).toEqual([0, 4]);
  });

  it('an entry of 1 still chips through luck (trooper vs bastion on flats: 0 to 9)', () => {
    const s = game(['..'], [u('trooper', 0, 0, 0), u('bastion', 1, 1, 0)]);
    expect(chart('trooper', 'bastion', 'secondary')).toBe(1);
    expect(forecast(s, 1, at(0, 0), at(1, 0)).damage).toEqual([0, 9]);
  });
});

// ================================================================ 2. luck

describe('luck', () => {
  it('is drawn from state.rng: the attack draws first, the counter second, and the generator advances by exactly those two draws', () => {
    const s = game(['..'], LANCERS, { seed: SEED });
    const { first, second, after } = draws(s.rng);
    expect(first).not.toBe(second);
    const r = fight(s, 1, at(1, 0));
    const hit = attackedEvent(r.events);
    const dmg = expectDamage({ b: 55, luck: first, ahp: 10, dhp: 10, stars: 1 });
    const counter = expectDamage({ b: 55, luck: second, ahp: displayHp(100 - dmg), dhp: 10, stars: 1 });
    expect([hit.damage, hit.counter]).toEqual([dmg, counter]);
    expect(r.s.rng).toBe(after);
    expect(r.s.rng).not.toBe(s.rng);
  });

  it('one strike draws once: a counterless attack advances the generator by one draw', () => {
    const s = game(['...'], [u('arc', 0, 0, 0), u('lancer', 1, 2, 0)], { seed: SEED });
    const r = fight(s, 1, at(2, 0));
    expect(r.s.rng).toBe(randomInt(s.rng, 0, 9)[1]);
    expect(attackedEvent(r.events).counter).toBe(0);
  });

  it('the same seed gives the same result and different seeds give different damage inside the forecast', () => {
    const run = (seed: number) => fight(game(['..'], LANCERS, { seed }), 1, at(1, 0));
    expect(run(7)).toEqual(run(7));
    const [lo, hi] = forecast(game(['..'], LANCERS), 1, at(0, 0), at(1, 0)).damage;
    const damages = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const d = attackedEvent(run(seed).events).damage;
      expect(d).toBeGreaterThanOrEqual(lo);
      expect(d).toBeLessThanOrEqual(hi);
      damages.add(d);
    }
    expect(damages.size).toBeGreaterThan(3);
  });

  it('luckMax / luckMin modifiers change the range that is drawn, forecast and rolled', () => {
    useCos(co('lucky', [{ luckMax: 19 }]), co('shaky', [{ luckMin: -5 }]), co('steady', [{ luckMin: 9, luckMax: 9 }]), co('cold', [{ luckMax: 3 }]));
    const f = (c: string) => forecast(game(['..'], LANCERS, { co: [c, 'none'] }), 1, at(0, 0), at(1, 0)).damage;
    const flat = { b: 55, ahp: 10, dhp: 10, stars: 1 };
    expect(f('lucky')).toEqual(range(flat, 0, 19)); // [49, 66]
    expect(f('shaky')).toEqual(range(flat, -5, 9)); // [45, 57]
    expect(f('steady')).toEqual([57, 57]);
    expect(f('cold')).toEqual(range(flat, 0, 3));   // [49, 52]
    // The rolled luck follows the same range: first draw over 0..19 decides the damage.
    const s = game(['..'], LANCERS, { co: ['lucky', 'none'], seed: SEED });
    expect(attackedEvent(fight(s, 1, at(1, 0)).events).damage).toBe(expectDamage({ ...flat, luck: draws(s.rng, 0, 19).first }));
    // Over many seeds a 0..19 luck beats the default ceiling, and a 9..9 luck is never anything but 57.
    let beyond = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const d = attackedEvent(fight(game(['..'], LANCERS, { co: ['lucky', 'none'], seed }), 1, at(1, 0)).events).damage;
      expect(d).toBeLessThanOrEqual(66);
      if (d > 57) beyond++;
      expect(attackedEvent(fight(game(['..'], LANCERS, { co: ['steady', 'none'], seed }), 1, at(1, 0)).events).damage).toBe(57);
    }
    expect(beyond).toBeGreaterThan(0);
  });

  it('a defender CO with a luck modifier changes only its own counter', () => {
    useCos(co('lucky', [{ luckMax: 19 }]));
    const noMod = forecast(game(['..'], LANCERS), 1, at(0, 0), at(1, 0));
    const withMod = forecast(game(['..'], LANCERS, { co: ['none', 'lucky'] }), 1, at(0, 0), at(1, 0));
    expect(withMod.damage).toEqual(noMod.damage);
    expect(withMod.counter![1]).toBeGreaterThan(noMod.counter![1]);
    expect(withMod.counter![0]).toBe(noMod.counter![0]);
  });
});

// ================================================================ 3. weapons and ammo

describe('weapons and ammo', () => {
  it('weaponAgainst: primary with ammo, else secondary, else nothing', () => {
    expect(weaponAgainst('lancer', 'lancer', 9)).toEqual({ base: chart('lancer', 'lancer'), primary: true });
    expect(weaponAgainst('lancer', 'lancer', 1)).toEqual({ base: 55, primary: true });
    expect(weaponAgainst('lancer', 'lancer', 0)).toEqual({ base: chart('lancer', 'lancer', 'secondary'), primary: false });
    expect(weaponAgainst('lancer', 'trooper', 9)).toEqual({ base: chart('lancer', 'trooper', 'secondary'), primary: false }); // no primary entry
    expect(weaponAgainst('trooper', 'wasp', 0)).toEqual({ base: chart('trooper', 'wasp', 'secondary'), primary: false });
    expect(weaponAgainst('warden', 'raptor', 9)).toEqual({ base: chart('warden', 'raptor'), primary: true });
    // No secondary: out of ammo means no weapon.
    expect(weaponAgainst('arc', 'lancer', 0)).toBeNull();
    expect(weaponAgainst('warden', 'raptor', 0)).toBeNull();
    // No entry at all.
    expect(weaponAgainst('lancer', 'raptor', 9)).toBeNull();
    expect(weaponAgainst('raptor', 'lancer', 9)).toBeNull();
    expect(weaponAgainst('mule', 'trooper', 9)).toBeNull();
    expect(weaponAgainst('barge', 'trooper', 9)).toBeNull();
  });

  it('a primary shot costs 1 ammo, counters included; a secondary shot costs none', () => {
    const duel = fight(game(['..'], LANCERS), 1, at(1, 0));
    expect([unit(duel.s, 1).ammo, unit(duel.s, 2).ammo]).toEqual([8, 8]); // attacked with the primary, countered with the primary
    const mg = fight(game(['..'], [u('lancer', 0, 0, 0), u('trooper', 1, 1, 0)], { seed: SEED }), 1, at(1, 0));
    expect(unit(mg.s, 1).ammo).toBe(9); // lancer vs trooper is its secondary
    const ev = attackedEvent(mg.events);
    expect(ev.damage).toBe(expectDamage({ b: chart('lancer', 'trooper', 'secondary'), luck: draws(game(['..'], LANCERS, { seed: SEED }).rng).first, ahp: 10, dhp: 10, stars: 1 }));
    expect(unit(mg.s, 2).ammo).toBe(0); // the trooper has no primary to spend
  });

  it('a unit out of ammo fires its secondary, and does not spend ammo it does not have', () => {
    const s = patchUnit(game(['..'], LANCERS, { seed: SEED }), 1, { ammo: 0 });
    expect(keys(attackTargets(s, 1, at(0, 0)))).toEqual(['1,0']);
    expect(forecast(s, 1, at(0, 0), at(1, 0)).damage).toEqual(range({ b: chart('lancer', 'lancer', 'secondary'), ahp: 10, dhp: 10, stars: 1 }));
    const r = fight(s, 1, at(1, 0));
    expect(attackedEvent(r.events).damage).toBe(expectDamage({ b: 6, luck: draws(s.rng).first, ahp: 10, dhp: 10, stars: 1 }));
    expect(unit(r.s, 1).ammo).toBe(0);
  });

  it('a unit out of ammo with no secondary cannot attack: no targets, no Fire option, the action is refused', () => {
    const s = patchUnit(game(['...'], [u('arc', 0, 0, 0), u('trooper', 1, 2, 0)]), 1, { ammo: 0 });
    expect(attackTargets(s, 1, at(0, 0))).toEqual([]);
    expect(thenOptions(s, 1, at(0, 0))).toEqual(['wait']);
    const attack: Action = { kind: 'move', unitId: 1, path: [at(0, 0)], then: { kind: 'attack', target: at(2, 0) } };
    expect(isLegal(s, attack)).toBe(false);
    expect(() => applyAction(s, attack)).toThrow(IllegalActionError);
    expect(() => fight(s, 1, at(2, 0))).toThrow(IllegalActionError);
    // The same arc with ammo is legal, so the refusal is about the ammo.
    expect(isLegal(patchUnit(s, 1, { ammo: 1 }), attack)).toBe(true);
  });

  it('a matchup with no chart entry cannot be attacked: lancer vs an air unit, raptor vs a ground unit, mule vs anything', () => {
    const lancerAir = game(['...'], [u('lancer', 0, 1, 0), u('raptor', 1, 0, 0), u('trooper', 1, 2, 0)]);
    expect(keys(attackTargets(lancerAir, 1, at(1, 0)))).toEqual(['2,0']); // the trooper, not the raptor
    expect(forecast(lancerAir, 1, at(1, 0), at(0, 0))).toEqual({ damage: [0, 0], counter: null });
    expect(() => fight(lancerAir, 1, at(0, 0))).toThrow(IllegalActionError);
    const raptorGround = game(['..'], [u('raptor', 0, 0, 0), u('lancer', 1, 1, 0)]);
    expect(attackTargets(raptorGround, 1, at(0, 0))).toEqual([]);
    expect(isLegal(raptorGround, { kind: 'move', unitId: 1, path: [at(0, 0)], then: { kind: 'attack', target: at(1, 0) } })).toBe(false);
    const mule = game(['..'], [u('mule', 0, 0, 0), u('trooper', 1, 1, 0)]);
    expect(attackTargets(mule, 1, at(0, 0))).toEqual([]);
    expect(attackRangeTiles(mule, 1)).toEqual([]);
  });
});

// ================================================================ 4. counterattacks

describe('counterattacks', () => {
  it('a survivor counters at its post-damage HP, against the attacker\'s tile stars, with the second luck draw', () => {
    // The trooper attacks from a ridge (4 stars) at full HP; the defender on flats survives and strikes back.
    const s = game(['.^'], [u('trooper', 0, 1, 0), u('trooper', 1, 0, 0)], { seed: SEED });
    const { first, second } = draws(s.rng);
    const dmg = expectDamage({ b: 55, luck: first, ahp: 10, dhp: 10, stars: 1 });
    const counter = expectDamage({ b: 55, luck: second, ahp: displayHp(100 - dmg), dhp: 10, stars: 4 });
    const r = fight(s, 1, at(0, 0));
    const hit = attackedEvent(r.events);
    expect([hit.damage, hit.counter]).toEqual([dmg, counter]);
    expect(unit(r.s, 2).hp).toBe(100 - dmg);
    expect(unit(r.s, 1).hp).toBe(100 - counter);
  });

  it('no counter when the defender is destroyed, and the dead defender spends no ammo', () => {
    const s = game(['..'], [u('bastion', 0, 0, 0), u('lancer', 1, 1, 0, 1)]);
    const r = fight(s, 1, at(1, 0));
    const hit = attackedEvent(r.events);
    expect([hit.damage, hit.counter, hit.defenderHp, hit.attackerHp]).toEqual([10, 0, 0, 100]);
    expect(unit(r.s, 1).hp).toBe(100);
    expect(r.s.units.map((x) => x.id)).toEqual([1]);
    expect(canCounter({ ...unit(s, 2), hp: 0 }, unit(s, 1), 1)).toBe(false);
  });

  it('canCounter needs adjacency: a direct defender answers at distance 1 and at no other distance', () => {
    const s = game(['..'], LANCERS);
    const [a, d] = s.units;
    expect([0, 1, 2, 3].map((distance) => canCounter(d, a, distance))).toEqual([false, true, false, false]);
  });

  it('indirect attackers are never countered, even by a direct unit that could have', () => {
    const s = game(['...'], [u('arc', 0, 0, 0), u('lancer', 1, 2, 0)]);
    const r = fight(s, 1, at(2, 0));
    expect(attackedEvent(r.events).counter).toBe(0);
    expect(unit(r.s, 1).hp).toBe(100);
    expect(unit(r.s, 2).ammo).toBe(9);
    expect(canCounter(unit(s, 2), unit(s, 1), 2)).toBe(false);
    expect(canCounter(unit(s, 2), unit(s, 1), 1)).toBe(false); // an indirect attacker, even if it somehow stood adjacent
    expect(forecast(s, 1, at(0, 0), at(2, 0)).counter).toBeNull();
    // A direct unit with the same weapon matchup in the same spot would have been countered.
    expect(canCounter(unit(s, 2), { ...unit(s, 1), type: 'bastion' }, 1)).toBe(true);
  });

  it('indirect defenders never counter, not even point blank', () => {
    const s = game(['..'], [u('lancer', 0, 0, 0), u('arc', 1, 1, 0)]);
    expect(weaponAgainst('arc', 'lancer', 9)).not.toBeNull(); // it has a weapon against the lancer
    expect(canCounter(unit(s, 2), unit(s, 1), 1)).toBe(false);
    const r = fight(s, 1, at(1, 0));
    const hit = attackedEvent(r.events);
    expect(hit.counter).toBe(0);
    expect(hit.damage).toBeGreaterThan(0);
    expect(unit(r.s, 2).ammo).toBe(9);
    const ship = game(['~~'], [u('picket', 0, 0, 0), u('dreadnought', 1, 1, 0)]);
    expect(canCounter(unit(ship, 2), unit(ship, 1), 1)).toBe(false);
  });

  it('a defender with no weapon against the attacker does not counter (no entry, or no ammo and no secondary)', () => {
    const sea = game(['~~'], [u('picket', 0, 0, 0), u('barge', 1, 1, 0)]);
    expect(canCounter(unit(sea, 2), unit(sea, 1), 1)).toBe(false);
    const hit = attackedEvent(fight(sea, 1, at(1, 0)).events);
    expect(hit.damage).toBeGreaterThan(0);
    expect(hit.counter).toBe(0);
    expect(forecast(sea, 1, at(0, 0), at(1, 0)).counter).toBeNull();

    const dry = patchUnit(game(['..'], [u('lancer', 0, 0, 0), u('warden', 1, 1, 0)]), 2, { ammo: 0 });
    expect(canCounter(unit(dry, 2), unit(dry, 1), 1)).toBe(false);
    const loaded = game(['..'], [u('lancer', 0, 0, 0), u('warden', 1, 1, 0)]);
    expect(canCounter(unit(loaded, 2), unit(loaded, 1), 1)).toBe(true); // same pair, ammo is the difference
    const dryHit = attackedEvent(fight(dry, 1, at(1, 0)).events);
    expect([dryHit.counter, dryHit.defenderHp > 0]).toEqual([0, true]);
  });

  it('a defender out of ammo with a secondary counters with the secondary and keeps its 0 ammo', () => {
    const s = patchUnit(game(['..'], LANCERS, { seed: SEED }), 2, { ammo: 0 });
    const { first, second } = draws(s.rng);
    const dmg = expectDamage({ b: 55, luck: first, ahp: 10, dhp: 10, stars: 1 });
    const r = fight(s, 1, at(1, 0));
    const hit = attackedEvent(r.events);
    expect(hit.counter).toBe(expectDamage({ b: 6, luck: second, ahp: displayHp(100 - dmg), dhp: 10, stars: 1 }));
    expect(unit(r.s, 2).ammo).toBe(0);
    expect(unit(r.s, 1).ammo).toBe(8);
  });

  it('counterFirst: the defender strikes first at full HP, then the weakened attacker strikes', () => {
    useCos(co('ambusher', [{ counterFirst: true }]));
    const s = game(['..'], LANCERS, { co: ['none', 'ambusher'], seed: SEED });
    const { first, second } = draws(s.rng);
    const counter = expectDamage({ b: 55, luck: first, ahp: 10, dhp: 10, stars: 1 });
    const dmg = expectDamage({ b: 55, luck: second, ahp: displayHp(100 - counter), dhp: 10, stars: 1 });
    const r = fight(s, 1, at(1, 0));
    const hit = attackedEvent(r.events);
    expect(hit.counterFirst).toBe(true);
    expect([hit.damage, hit.counter]).toEqual([dmg, counter]);
    expect([unit(r.s, 1).hp, unit(r.s, 2).hp]).toEqual([100 - counter, 100 - dmg]);
    expect(dmg).toBeLessThan(expectDamage({ b: 55, luck: second, ahp: 10, dhp: 10, stars: 1 })); // it really did hit while hurt
    expect([unit(r.s, 1).ammo, unit(r.s, 2).ammo]).toEqual([8, 8]);
  });

  it('counterFirst can kill the attacker before it fires: no damage dealt, the attacker is destroyed, the defender is untouched', () => {
    useCos(co('ambusher', [{ counterFirst: true }]));
    const s = game(['..'], [u('lancer', 0, 0, 0, 1), u('lancer', 1, 1, 0)], { co: ['none', 'ambusher'] });
    const r = fight(s, 1, at(1, 0));
    const hit = attackedEvent(r.events);
    expect([hit.damage, hit.counter, hit.attackerHp, hit.defenderHp, hit.counterFirst]).toEqual([0, 10, 0, 100, true]);
    expect(kinds(r.events)).toEqual(['attacked', 'destroyed']);
    expect(r.s.units.map((x) => x.id)).toEqual([2]);
    expect(unit(r.s, 2).ammo).toBe(8);
    expect(r.s.rng).toBe(randomInt(s.rng, 0, 9)[1]); // the attacker never rolled
  });

  it('counterFirst does nothing when the defender cannot counter (indirect), and the order stays attacker first', () => {
    useCos(co('ambusher', [{ counterFirst: true }]));
    const s = game(['..'], [u('lancer', 0, 0, 0), u('arc', 1, 1, 0)], { co: ['none', 'ambusher'] });
    const hit = attackedEvent(fight(s, 1, at(1, 0)).events);
    expect(hit.counterFirst).toBeUndefined();
    expect(hit.counter).toBe(0);
    expect(forecast(s, 1, at(0, 0), at(1, 0)).counter).toBeNull();
  });
});

// ================================================================ 5. attackTargets and attackRangeTiles

describe('attackTargets', () => {
  it('direct units hit only the adjacent enemies, indirect units only inside [min, max]', () => {
    const lancer = game(['.....', '.....', '.....'], [
      u('lancer', 0, 2, 1), u('trooper', 0, 1, 1),
      u('trooper', 1, 2, 0), u('trooper', 1, 3, 1), u('trooper', 1, 1, 0), u('trooper', 1, 4, 1),
    ]);
    // adjacent enemies: (2,0) and (3,1). (1,0) is diagonal (distance 2), (4,1) is 2 away, (1,1) is a friend.
    expect(keys(attackTargets(lancer, 1, at(2, 1)))).toEqual(['2,0', '3,1']);

    const arc = game(['.......'], [u('arc', 0, 0, 0), u('trooper', 1, 1, 0), u('trooper', 1, 2, 0), u('trooper', 1, 3, 0), u('trooper', 1, 4, 0)]);
    expect(keys(attackTargets(arc, 1, at(0, 0)))).toEqual(['2,0', '3,0']); // not 1 (too close), not 4 (too far)
  });

  it('is measured from the position given, not from where the unit stands now', () => {
    const s = game(['....'], [u('lancer', 0, 0, 0), u('trooper', 1, 3, 0)]);
    expect(attackTargets(s, 1, at(0, 0))).toEqual([]);
    expect(attackTargets(s, 1, at(2, 0))).toEqual([at(3, 0)]);
  });

  it('never lists own units or teammates; an enemy team is listed', () => {
    const s = game3(['...', '...'], [u('lancer', 0, 1, 0), u('trooper', 0, 0, 0), u('trooper', 1, 2, 0), u('trooper', 2, 1, 1)]);
    // (0,0) is the lancer's own unit, (2,0) belongs to a teammate (player 1, team 0), (1,1) is the only enemy.
    expect(attackTargets(s, 1, at(1, 0))).toEqual([at(1, 1)]);
  });

  it('in fog, only enemies the team can see are targets (spotters count, canopy hides from afar)', () => {
    const arcAndFoe = [u('arc', 0, 0, 0), u('trooper', 1, 3, 0)];
    expect(keys(attackTargets(game(['.....'], arcAndFoe), 1, at(0, 0)))).toEqual(['3,0']);
    expect(attackTargets(game(['.....'], arcAndFoe, { fog: true }), 1, at(0, 0))).toEqual([]); // the arc sees 1 tile
    const spotted = game(['.....'], [...arcAndFoe, u('trooper', 0, 2, 0)], { fog: true });
    expect(keys(attackTargets(spotted, 1, at(0, 0)))).toEqual(['3,0']); // the trooper at (2,0) sees it
    // On canopy the foe is hidden from a spotter two tiles away, visible from one tile away.
    const farSpotter = game(['...f.'], [...arcAndFoe, u('trooper', 0, 1, 0)], { fog: true });
    expect(attackTargets(farSpotter, 1, at(0, 0))).toEqual([]);
    const nearSpotter = game(['...f.'], [...arcAndFoe, u('trooper', 0, 2, 0)], { fog: true });
    expect(keys(attackTargets(nearSpotter, 1, at(0, 0)))).toEqual(['3,0']);
  });

  it('in fog, what a unit can see is judged from the tile it would fire from', () => {
    const s = game(['........'], [u('lancer', 0, 0, 0), u('trooper', 1, 6, 0)], { fog: true });
    expect(attackTargets(s, 1, at(0, 0))).toEqual([]);
    expect(attackTargets(s, 1, at(5, 0))).toEqual([at(6, 0)]);
  });

  it('indirect units cannot move and fire, unless a modifier says so', () => {
    useCos(co('mobile-guns', [{ indirectAfterMove: true }]));
    const units = [u('arc', 0, 0, 0), u('trooper', 1, 4, 0)];
    const base = game(['.....'], units);
    expect(attackTargets(base, 1, at(1, 0))).toEqual([]);                  // moved 1 tile: the foe would be at distance 3
    expect(attackTargets(base, 1, at(0, 0))).toEqual([]);                  // not moving, but distance 4 is out of range
    expect(thenOptions(base, 1, at(1, 0))).toEqual(['wait']);
    const mobile = game(['.....'], units, { co: ['mobile-guns', 'none'] });
    expect(attackTargets(mobile, 1, at(1, 0))).toEqual([at(4, 0)]);
    expect(attackTargets(mobile, 1, at(0, 0))).toEqual([]);
    expect(thenOptions(mobile, 1, at(1, 0))).toEqual(['attack', 'wait']);
  });

  it('a rangeMax modifier extends an indirect unit\'s reach and leaves a direct unit alone', () => {
    useCos(co('long-guns', [{ rangeMax: 1 }]));
    const units = [u('arc', 0, 0, 0), u('trooper', 1, 4, 0), u('lancer', 0, 0, 1)];
    const s = game(['.....', '.....'], units, { co: ['long-guns', 'none'] });
    expect(attackTargets(s, 1, at(0, 0))).toEqual([at(4, 0)]);
    expect(attackTargets(game(['.....', '.....'], units), 1, at(0, 0))).toEqual([]);
    expect(attackTargets(s, 3, at(0, 1))).toEqual([]); // the lancer (direct) keeps range 1
  });
});

describe('attackRangeTiles', () => {
  const diamond = (w: number, h: number, c: Coord, min: number, max: number): string[] => {
    const out: string[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.abs(x - c.x) + Math.abs(y - c.y);
      if (d >= min && d <= max) out.push(`${x},${y}`);
    }
    return out.sort();
  };
  const open = (n: number) => Array.from({ length: n }, () => '.'.repeat(n));

  it('a direct unit threatens everything within move + 1', () => {
    const s = game(open(7), [u('trooper', 0, 3, 3)]);
    expect(keys(attackRangeTiles(s, 1))).toEqual(diamond(7, 7, at(3, 3), 0, 3 + 1));
  });

  it('a direct unit\'s threat stops where terrain or a visible enemy stops its movement', () => {
    const wall = game(['.~.....'], [u('trooper', 0, 0, 0)]);
    expect(attackRangeTiles(wall, 1)).toEqual([at(1, 0)]); // it cannot cross the sea, so it only reaches next to itself
    const blocked = game(['.....'], [u('trooper', 0, 0, 0), u('trooper', 1, 1, 0)]);
    expect(attackRangeTiles(blocked, 1)).toEqual([at(1, 0)]);
  });

  it('an indirect unit threatens only its [min, max] ring around where it stands', () => {
    const s = game(open(7), [u('arc', 0, 3, 3)]);
    expect(keys(attackRangeTiles(s, 1))).toEqual(diamond(7, 7, at(3, 3), 2, 3));
    const salvo = game(open(9), [u('salvo', 0, 4, 4)]);
    expect(keys(attackRangeTiles(salvo, 1))).toEqual(diamond(9, 9, at(4, 4), 3, 5));
  });

  it('an indirect unit with indirectAfterMove covers move + fire', () => {
    useCos(co('mobile-guns', [{ indirectAfterMove: true }]));
    const still = game(open(7), [u('arc', 0, 3, 3)]);
    const mobile = game(open(7), [u('arc', 0, 3, 3)], { co: ['mobile-guns', 'none'] });
    expect(keys(attackRangeTiles(still, 1))).not.toContain('0,0');
    expect(keys(attackRangeTiles(mobile, 1))).toContain('0,0');
    for (const k of keys(attackRangeTiles(still, 1))) expect(keys(attackRangeTiles(mobile, 1))).toContain(k);
  });

  it('a unit with no weapon it could fire threatens nothing', () => {
    const dry = patchUnit(game(open(5), [u('arc', 0, 2, 2)]), 1, { ammo: 0 });
    expect(attackRangeTiles(dry, 1)).toEqual([]);
    const withSecondary = patchUnit(game(open(5), [u('lancer', 0, 2, 2)]), 1, { ammo: 0 });
    expect(attackRangeTiles(withSecondary, 1).length).toBeGreaterThan(0);
    expect(attackRangeTiles(game(open(5), [u('mule', 0, 2, 2)]), 1)).toEqual([]);
    expect(attackRangeTiles(game(open(5), [u('trooper', 0, 2, 2)]), 99)).toEqual([]);
  });
});

// ================================================================ 6. forecast

describe('forecast', () => {
  it('gives [min, max] damage over the luck range at the attacker\'s and defender\'s CURRENT HP', () => {
    const full = game(['..'], LANCERS);
    expect(forecast(full, 1, at(0, 0), at(1, 0)).damage).toEqual([49, 57]);
    const hurt = game(['.^'], [u('trooper', 0, 0, 0, 6), u('trooper', 1, 1, 0, 5)]);
    expect(forecast(hurt, 1, at(0, 0), at(1, 0)).damage).toEqual(range({ b: 55, ahp: 6, dhp: 5, stars: 4 }));
    const bruised = patchUnit(full, 1, { hp: 51 });
    expect(forecast(bruised, 1, at(0, 0), at(1, 0)).damage).toEqual(range({ b: 55, ahp: 6, dhp: 10, stars: 1 }));
  });

  it('computes the counter from the defender HP after the max and the min damage', () => {
    const s = game(['..'], LANCERS);
    const f = forecast(s, 1, at(0, 0), at(1, 0));
    expect(f.damage).toEqual([49, 57]);
    // After 57 the defender has 43 hp (display 5), rolling its lowest luck; after 49 it has 51 (display 6), rolling its highest.
    expect(f.counter).toEqual([expectDamage({ b: 55, luck: 0, ahp: 5, dhp: 10, stars: 1 }), expectDamage({ b: 55, luck: 9, ahp: 6, dhp: 10, stars: 1 })]);
    expect(f.counter).toEqual([24, 34]);
  });

  it('the counter uses the stars of the tile the attacker would fire from', () => {
    const s = game(['.^', '..'], [u('trooper', 0, 0, 0), u('trooper', 1, 1, 1)]);
    const fromRidge = forecast(s, 1, at(1, 0), at(1, 1)).counter!;
    const fromFlats = forecast(s, 1, at(0, 1), at(1, 1)).counter!;
    expect(fromRidge).toEqual([expectDamage({ b: 55, luck: 0, ahp: 5, dhp: 10, stars: 4 }), expectDamage({ b: 55, luck: 9, ahp: 6, dhp: 10, stars: 4 })]);
    expect(fromFlats).toEqual([24, 34]);
    expect(fromRidge[1]).toBeLessThan(fromFlats[1]);
  });

  it('the counter is null when no counter is possible', () => {
    const indirectAttacker = game(['...'], [u('arc', 0, 0, 0), u('lancer', 1, 2, 0)]);
    expect(forecast(indirectAttacker, 1, at(0, 0), at(2, 0)).counter).toBeNull();
    const indirectDefender = game(['..'], [u('lancer', 0, 0, 0), u('arc', 1, 1, 0)]);
    expect(forecast(indirectDefender, 1, at(0, 0), at(1, 0)).counter).toBeNull();
    const noWeapon = game(['~~'], [u('picket', 0, 0, 0), u('barge', 1, 1, 0)]);
    expect(forecast(noWeapon, 1, at(0, 0), at(1, 0)).counter).toBeNull();
    const dry = patchUnit(game(['..'], [u('lancer', 0, 0, 0), u('warden', 1, 1, 0)]), 2, { ammo: 0 });
    expect(forecast(dry, 1, at(0, 0), at(1, 0)).counter).toBeNull();
  });

  it('the counter is null when the defender dies even at minimum damage, and starts at 0 when it only dies at maximum', () => {
    useCos(co('fp20', [{ firepower: 20 }]));
    const overkill = setPower(game(['..U'], [u('bastion', 0, 0, 0), u('lancer', 1, 1, 0)], { co: ['fp20', 'none'], owners: ['..0'] }), 0, 'surge');
    const f = forecast(overkill, 1, at(0, 0), at(1, 0));
    expect(f.damage[0]).toBeGreaterThanOrEqual(100);
    expect(f.counter).toBeNull();
    // 6-HP lancer (60 hp): the minimum hit is 51 (it survives on 9), the maximum is 60 (it dies).
    const edge = game(['..'], [u('lancer', 0, 0, 0), u('lancer', 1, 1, 0, 6)]);
    const e = forecast(edge, 1, at(0, 0), at(1, 0));
    expect(e.damage).toEqual(range({ b: 55, ahp: 10, dhp: 6, stars: 1 }));
    expect(e.damage[0]).toBeLessThan(60);
    expect(e.damage[1]).toBeGreaterThanOrEqual(60);
    expect(e.counter).toEqual([0, expectDamage({ b: 55, luck: 9, ahp: displayHp(60 - e.damage[0]), dhp: 10, stars: 1 })]);
  });

  it('with counterFirst, the counter comes first at full HP and the damage is computed from the weakened attacker', () => {
    useCos(co('ambusher', [{ counterFirst: true }]));
    const s = game(['..'], LANCERS, { co: ['none', 'ambusher'] });
    const f = forecast(s, 1, at(0, 0), at(1, 0));
    expect(f.counter).toEqual([49, 57]);
    // Worst case the attacker is hit for 57 (43 hp, display 5) and rolls 0; best case it is hit for 49 (display 6) and rolls 9.
    expect(f.damage).toEqual([expectDamage({ b: 55, luck: 0, ahp: 5, dhp: 10, stars: 1 }), expectDamage({ b: 55, luck: 9, ahp: 6, dhp: 10, stars: 1 })]);
    expect(f.damage).toEqual([24, 34]);
  });

  it('returns no damage and no counter for a target that is not a valid enemy with a weapon matchup', () => {
    const s = game(['...'], [u('lancer', 0, 0, 0), u('lancer', 0, 1, 0), u('raptor', 1, 2, 0)]);
    const none = { damage: [0, 0], counter: null };
    expect(forecast(s, 1, at(0, 0), at(1, 0))).toEqual(none); // a friend
    expect(forecast(s, 1, at(0, 0), at(2, 0))).toEqual(none); // an air unit the lancer has no weapon against
    expect(forecast(s, 1, at(0, 0), at(5, 5))).toEqual(none); // empty
    expect(forecast(s, 99, at(0, 0), at(2, 0))).toEqual(none); // no such attacker
  });

  it('every real outcome lies inside the forecast, for attack and counter, across seeds and with counterFirst', () => {
    useCos(co('ambusher', [{ counterFirst: true }]));
    for (const setup of [{}, { co: ['none', 'ambusher'] as [string, string] }]) {
      let sawCounter = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const s = game(['..'], LANCERS, { ...setup, seed });
        const f = forecast(s, 1, at(0, 0), at(1, 0));
        const { events } = applyAction(s, { kind: 'move', unitId: 1, path: [at(0, 0)], then: { kind: 'attack', target: at(1, 0) } });
        const hit = attackedEvent(events);
        expect(hit.damage).toBeGreaterThanOrEqual(f.damage[0]);
        expect(hit.damage).toBeLessThanOrEqual(f.damage[1]);
        expect(f.counter).not.toBeNull();
        expect(hit.counter).toBeGreaterThanOrEqual(f.counter![0]);
        expect(hit.counter).toBeLessThanOrEqual(f.counter![1]);
        sawCounter += hit.counter > 0 ? 1 : 0;
      }
      expect(sawCounter).toBeGreaterThan(0);
    }
  });
});

// ================================================================ 7. resolution

describe('resolveAttack and destroyUnit', () => {
  it('updates both HPs, the attacked event and both players\' stats when nobody dies', () => {
    const s = game(['..'], LANCERS, { seed: SEED });
    const { first, second } = draws(s.rng);
    const dmg = expectDamage({ b: 55, luck: first, ahp: 10, dhp: 10, stars: 1 });
    const counter = expectDamage({ b: 55, luck: second, ahp: displayHp(100 - dmg), dhp: 10, stars: 1 });
    const r = fight(s, 1, at(1, 0));
    expect(r.events).toEqual([{ kind: 'attacked', attackerId: 1, defenderId: 2, damage: dmg, counter, attackerHp: 100 - counter, defenderHp: 100 - dmg }]);
    expect([unit(r.s, 1).hp, unit(r.s, 2).hp]).toEqual([100 - counter, 100 - dmg]);
    expect(r.s.players[0].stats).toMatchObject({ damageDealt: dmg, damageTaken: counter, unitsLost: 0, unitsDestroyed: 0 });
    expect(r.s.players[1].stats).toMatchObject({ damageDealt: counter, damageTaken: dmg, unitsLost: 0, unitsDestroyed: 0 });
    expect(s.units.map((x) => x.hp)).toEqual([100, 100]); // the input state is untouched
  });

  it('a real attack applies the formula at the CURRENT HP of both sides (attacker scaling, defender stars x display HP)', () => {
    const s = game(['.^'], [u('trooper', 0, 0, 0, 7), u('trooper', 1, 1, 0, 8)], { seed: SEED });
    const { first, second } = draws(s.rng);
    const dmg = expectDamage({ b: 55, luck: first, ahp: 7, dhp: 8, stars: 4 }); // 5500 x 7 x 68 / 1e5 and up
    const counter = expectDamage({ b: 55, luck: second, ahp: displayHp(80 - dmg), dhp: 7, stars: 1 });
    const hit = attackedEvent(fight(s, 1, at(1, 0)).events);
    expect([hit.damage, hit.counter]).toEqual([dmg, counter]);
    expect(dmg).toBeLessThan(80); // not clipped by the defender's HP, so the formula itself is what is checked
  });

  it('a kill removes the defender, emits attacked then destroyed, and counts the loss and the kill', () => {
    const s = game(['..'], [u('bastion', 0, 0, 0), u('lancer', 1, 1, 0, 1)]);
    const r = fight(s, 1, at(1, 0));
    expect(r.events).toEqual([
      { kind: 'attacked', attackerId: 1, defenderId: 2, damage: 10, counter: 0, attackerHp: 100, defenderHp: 0 },
      { kind: 'destroyed', unitId: 2, at: at(1, 0), type: 'lancer', owner: 1 },
    ]);
    expect(unitAt(r.s, at(1, 0))).toBeUndefined();
    expect(r.s.players[0].stats).toMatchObject({ damageDealt: 10, damageTaken: 0, unitsDestroyed: 1, unitsLost: 0 });
    expect(r.s.players[1].stats).toMatchObject({ damageDealt: 0, damageTaken: 10, unitsLost: 1, unitsDestroyed: 0 });
  });

  it('an attacker killed by the counter is removed after the attacked event', () => {
    const s = game(['..'], [u('lancer', 0, 0, 0, 1), u('bastion', 1, 1, 0)], { seed: SEED });
    const { first, second } = draws(s.rng);
    const dmg = expectDamage({ b: chart('lancer', 'bastion'), luck: first, ahp: 1, dhp: 10, stars: 1 });
    const r = fight(s, 1, at(1, 0));
    expect(kinds(r.events)).toEqual(['attacked', 'destroyed']);
    const hit = attackedEvent(r.events);
    expect([hit.damage, hit.counter, hit.attackerHp]).toEqual([dmg, 10, 0]);
    expect(expectDamage({ b: chart('bastion', 'lancer'), luck: second, ahp: displayHp(100 - dmg), dhp: 1, stars: 1 })).toBeGreaterThanOrEqual(10);
    expect(r.events[1]).toEqual({ kind: 'destroyed', unitId: 1, at: at(0, 0), type: 'lancer', owner: 0 });
    expect(r.s.units.map((x) => x.id)).toEqual([2]);
    expect(r.s.players[0].stats).toMatchObject({ unitsLost: 1, unitsDestroyed: 0 });
    expect(r.s.players[1].stats).toMatchObject({ unitsLost: 0, unitsDestroyed: 1, damageDealt: 10, damageTaken: dmg });
  });

  it('destroying a transport destroys its cargo with it, and counts every unit as lost', () => {
    let s = game(['...', '...'], [u('bastion', 0, 0, 0), u('mule', 1, 1, 0, 1), u('trooper', 1, 2, 1)]);
    s = load(s, 3, 2);
    expect(unit(s, 2).cargo.map((c) => c.id)).toEqual([3]);
    const r = fight(s, 1, at(1, 0));
    expect(kinds(r.events)).toEqual(['attacked', 'destroyed', 'destroyed']);
    expect(r.events.filter((e) => e.kind === 'destroyed').map((e) => (e.kind === 'destroyed' ? e.unitId : -1))).toEqual([2, 3]);
    expect(r.s.units.map((x) => x.id)).toEqual([1]);
    expect(r.s.players[1].stats.unitsLost).toBe(2);
    expect(r.s.players[0].stats.unitsDestroyed).toBe(2);
  });

  it('destroys nested cargo too (a barge carrying a loaded mule)', () => {
    let s = game(['~~', '..'], [u('picket', 0, 0, 0), u('barge', 1, 1, 0, 1), u('mule', 1, 0, 1), u('trooper', 1, 1, 1)]);
    s = load(load(s, 4, 3), 3, 2);
    expect(unit(s, 2).cargo[0].cargo.map((c) => c.id)).toEqual([4]);
    const r = fight(s, 1, at(1, 0));
    expect(r.events.filter((e) => e.kind === 'destroyed').map((e) => (e.kind === 'destroyed' ? [e.unitId, e.type] : []))).toEqual([[2, 'barge'], [3, 'mule'], [4, 'trooper']]);
    expect(r.s.players[1].stats.unitsLost).toBe(3);
    expect(r.s.players[0].stats.unitsDestroyed).toBe(3);
    expect(r.s.units.map((x) => x.id)).toEqual([1]);
  });

  it('a crash removes the unit and its cargo with crashed events, counts a loss, and credits nobody', () => {
    const s = game(['..'], [u('wasp', 0, 0, 0), u('lancer', 1, 1, 0)]);
    const ctx = draft(s);
    destroyUnit(ctx, unit(ctx.s, 1), null, 'crashed');
    expect(ctx.events).toEqual([{ kind: 'crashed', unitId: 1, at: at(0, 0) }]);
    expect(ctx.s.units.map((x) => x.id)).toEqual([2]);
    expect(ctx.s.players[0].stats).toMatchObject({ unitsLost: 1, unitsDestroyed: 0 });
    expect(ctx.s.players[1].stats).toMatchObject({ unitsLost: 0, unitsDestroyed: 0 });
  });

  it('a unit that dies on a half-captured tile resets that capture; a unit that is only hurt does not', () => {
    const rows = ['.C'];
    const base = withCapture(game(rows, [u('lancer', 1, 0, 0), u('trooper', 0, 1, 0)]), 1, 0, 10);
    expect(base.tiles[0][1].capture).toBe(10);
    // Hurt: a trooper hits a trooper and the capturer survives; progress stays (spec 5: damage does not reset it).
    const hurt = withCapture(game(rows, [u('trooper', 1, 0, 0), u('trooper', 0, 1, 0)]), 1, 0, 10);
    const survivor = fight(hurt, 1, at(1, 0));
    expect(unit(survivor.s, 2).hp).toBeLessThan(100);
    expect(survivor.s.tiles[0][1].capture).toBe(10);
    // Killed: the dying capturer's tile goes back to 20.
    const weak = withCapture(game(rows, [u('lancer', 1, 0, 0), u('trooper', 0, 1, 0, 1)]), 1, 0, 10);
    const killed = fight(weak, 1, at(1, 0));
    expect(unitAt(killed.s, at(1, 0))).toBeUndefined();
    expect(killed.s.tiles[0][1].capture).toBe(20);
    expect(weak.tiles[0][1].capture).toBe(10); // and the input was not touched
  });

  it('refuses a missing target, a friendly target and a matchup with no weapon, changing nothing', () => {
    const s = game(['...'], [u('lancer', 0, 0, 0), u('lancer', 0, 1, 0), u('raptor', 1, 2, 0)]);
    const ctx = draft(s);
    const before = structuredClone(ctx.s);
    expect(() => resolveAttack(ctx, unit(ctx.s, 1), at(2, 2))).toThrow(IllegalActionError);
    expect(() => resolveAttack(ctx, unit(ctx.s, 1), at(1, 0))).toThrow(IllegalActionError);
    expect(() => resolveAttack(ctx, unit(ctx.s, 1), at(2, 0))).toThrow(IllegalActionError);
    expect(ctx.s).toEqual(before);
    expect(ctx.events).toEqual([]);
  });

  it('through applyAction: moved, attacked, destroyed in that order, and the input state is not modified', () => {
    const s = game(['...'], [u('bastion', 0, 0, 0), u('lancer', 1, 2, 0, 1)]);
    const snapshot = structuredClone(s);
    const r = applyAction(s, { kind: 'move', unitId: 1, path: [at(0, 0), at(1, 0)], then: { kind: 'attack', target: at(2, 0) } });
    expect(kinds(r.events)).toEqual(['moved', 'attacked', 'destroyed']);
    expect(unitAt(r.state, at(2, 0))).toBeUndefined();
    expect(s).toEqual(snapshot);
  });
});

// ================================================================ 7b. the power meter hook (spec 10.1)

describe('combat feeds the power meter', () => {
  // Value of a hit = list cost x internal HP lost / 100. The victim's owner gets all of it, the dealer's owner half.
  // Meters are checked against that spec formula; their caps and scaling belong to power.ts.
  it('a counterless hit charges the victim twice what it charges the dealer, from the internal HP lost', () => {
    useCos(co('meter', [], true));
    const s = game(['...'], [u('arc', 0, 0, 0), u('lancer', 1, 2, 0)], { co: ['meter', 'meter'], seed: SEED });
    const r = fight(s, 1, at(2, 0));
    const lost = attackedEvent(r.events).damage;
    expect(lost).toBeGreaterThan(0);
    const value = (unitCost('lancer') * lost) / 100;
    expect(r.s.players[1].power).toBe(value);
    expect(r.s.players[0].power).toBe(value / 2);
    expect(r.s.players[1].power).toBe(2 * r.s.players[0].power);
    expect([s.players[0].power, s.players[1].power]).toEqual([0, 0]);
  });

  it('counts internal HP, not display HP: a 9-point hit that leaves the display HP at 10 still charges', () => {
    useCos(co('steady-9', [{ luckMin: 9, luckMax: 9 }], true), co('meter', [], true));
    const s = game(['..'], [u('trooper', 0, 0, 0), u('bastion', 1, 1, 0)], { co: ['steady-9', 'meter'], seed: SEED });
    const r = fight(s, 1, at(1, 0));
    const hit = attackedEvent(r.events);
    expect(hit.damage).toBe(9);
    expect(displayHp(unit(r.s, 2).hp)).toBe(10);
    const counterValue = (unitCost('trooper') * hit.counter) / 100;
    // The trooper's owner dealt 9 hp to a 16000 unit (value 1440, half to it) and took the counter (all of it).
    expect(r.s.players[0].power).toBe(1440 / 2 + counterValue);
    expect(r.s.players[1].power).toBe(1440 + counterValue / 2);
  });

  it('charges nothing to a player whose own power is active, and still charges its opponent', () => {
    useCos(co('meter', [], true));
    const s = setPower(game(['...'], [u('arc', 0, 0, 0), u('lancer', 1, 2, 0)], { co: ['meter', 'meter'], seed: SEED }), 0, 'surge');
    const r = fight(s, 1, at(2, 0));
    const lost = attackedEvent(r.events).damage;
    expect(r.s.players[0].power).toBe(0);
    expect(r.s.players[1].power).toBe((unitCost('lancer') * lost) / 100);
  });

  it('a transport kill charges for the transport only, never for the cargo, and a crash charges nothing', () => {
    useCos(co('meter', [], true));
    let s = game(['...', '...'], [u('bastion', 0, 0, 0), u('mule', 1, 1, 0, 1), u('trooper', 1, 2, 1), u('wasp', 1, 2, 0)], { co: ['meter', 'meter'] });
    s = load(s, 3, 2);
    const r = fight(s, 1, at(1, 0));
    expect(attackedEvent(r.events).damage).toBe(10);
    expect(r.s.players[1].power).toBe((unitCost('mule') * 10) / 100); // 500, the mule's lost HP only
    expect(r.s.players[0].power).toBe(r.s.players[1].power / 2);
    const crash = draft(s);
    destroyUnit(crash, unit(crash.s, 4), null, 'crashed');
    expect([crash.s.players[0].power, crash.s.players[1].power]).toEqual([0, 0]);
  });

  it('a commander with no powers has no meter to fill', () => {
    const r = fight(game(['...'], [u('arc', 0, 0, 0), u('lancer', 1, 2, 0)]), 1, at(2, 0));
    expect([r.s.players[0].power, r.s.players[1].power]).toEqual([0, 0]);
  });
});

/** List price from the spec's unit table (section 1). */
function unitCost(type: UnitTypeId): number {
  const prices: Partial<Record<UnitTypeId, number>> = { trooper: 1000, lancer: 7000, bastion: 16000, mule: 5000, arc: 6000 };
  const price = prices[type];
  if (price === undefined) throw new Error(`no price for ${type}`);
  return price;
}
