// M1.3 turn economy: start-of-turn order, income, repair, resupply, charge drain, capture and production.
// Spec: docs/research/mechanics.md §2.1, §5-§8 and docs/delivery/DECISIONS.md D-012. Every expected number is computed
// here from the unit data and the rule text, never copied from what the engine printed.
import { afterEach, describe, expect, it } from 'vitest';
import type { CommanderDef } from '../../content/types';
import { UNIT_LIST, UNIT_TYPES } from '../../data';
import { applyCapture } from './capture';
import { IllegalActionError } from './errors';
import {
  applyAction, buildOptions, canCaptureHere, incomeOf, isLegal, propertyCount, resetCommanderRegistry,
  setCommanderRegistry, thenOptions, unitAt,
} from './index';
import type { PlayerSetup } from './index';
import { draft } from './state';
import { fixtureGame } from './testing';
import type { FixtureUnit } from './testing';
import { REPAIR_HP, repairsDomain } from './turn';
import type {
  Action, Domain, FactionId, GameEvent, GameState, Modifier, Player, TerrainId, Then, Unit, UnitTypeId,
} from './types';

// ---------------------------------------------------------------- helpers

const END: Action = { kind: 'endTurn' };
const CAPTURE: Then = { kind: 'capture' };
const price = (t: UnitTypeId) => UNIT_TYPES[t].cost;
const byId = (s: GameState, id: number): Unit | undefined => s.units.find((u) => u.id === id);
const kinds = (events: GameEvent[]) => events.map((e) => e.kind);
/** An enemy unit parked out of the way, so player 1 is never routed when a test runs into cycle 2. */
const decoy = (x: number, y: number): FixtureUnit => ({ type: 'trooper', owner: 1, x, y });

const move = (unitId: number, path: [number, number][], then: Then = { kind: 'wait' }): Action => ({
  kind: 'move', unitId, path: path.map(([x, y]) => ({ x, y })), then,
});
const capture = (unitId: number, x: number, y: number): Action => move(unitId, [[x, y]], CAPTURE);

const patchUnit = (s: GameState, id: number, patch: Partial<Unit>): GameState => ({
  ...s, units: s.units.map((u) => (u.id === id ? { ...u, ...patch } : u)),
});
const patchPlayer = (s: GameState, i: number, patch: Partial<Player>): GameState => ({
  ...s, players: s.players.map((p, k) => (k === i ? { ...p, ...patch } : p)),
});

/** Ends turns until `player` is up (at least one), returning the final state and every event on the way. */
function toTurnOf(s: GameState, player: number): { state: GameState; events: GameEvent[] } {
  let state = s;
  const events: GameEvent[] = [];
  do {
    const r = applyAction(state, END);
    state = r.state;
    events.push(...r.events);
  } while (state.current !== player);
  return { state, events };
}

const setup = (team: number, commander = 'none', faction: FactionId = 'helion'): PlayerSetup => ({
  faction, commander, controller: 'ai', team,
});
const duo = (c0 = 'none', c1 = 'none'): PlayerSetup[] => [setup(0, c0), setup(1, c1, 'tidewell')];

/** A commander with only the modifiers a test names. */
function testCommander(id: string, passive: Modifier[], surge?: Modifier[]): CommanderDef {
  return {
    id, name: id, initials: 'TC', faction: null, title: 'test', pronouns: 'they/them', bio: '', voice: '',
    passive: { name: 'passive', description: '', modifiers: passive },
    surge: surge ? { name: 'surge', stars: 1, quote: '', description: '', modifiers: surge, effects: [] } : null,
    overclock: null, lines: { select: '', victory: '', defeat: '' }, playable: false,
  };
}
const registry = (...defs: CommanderDef[]) => setCommanderRegistry(Object.fromEntries(defs.map((d) => [d.id, d])));

afterEach(() => resetCommanderRegistry());

// ---------------------------------------------------------------- start-of-turn order (§2.1)

describe('start of turn', () => {
  it('runs in the §2.1 order: timed effects, un-act, income, repair, mule resupply, drain/crash, banner', () => {
    const s0 = fixtureGame(
      ['C....', '.....', '.....'],
      [
        { type: 'trooper', owner: 0, x: 0, y: 0 }, // 1: on its own arcology
        { type: 'mule', owner: 0, x: 2, y: 1 },    // 2
        { type: 'wasp', owner: 0, x: 3, y: 1 },    // 3: beside the mule
        { type: 'raptor', owner: 0, x: 4, y: 2 },  // 4: nothing resupplies it
        decoy(4, 0),                               // 5
      ],
      { owners: ['0....', '.....', '.....'] },
    );
    let s = patchUnit(s0, 1, { hp: 50, acted: true });
    s = patchUnit(s, 3, { charge: 50 });
    s = patchUnit(s, 4, { charge: UNIT_TYPES.raptor.drain ?? 0 }); // exactly one day's drain left
    s = patchPlayer(s, 0, { funds: 0 }); // the repair can only be paid from this turn's income
    s = { ...s, weather: 'ionstorm', weatherTurnsLeft: 1, weatherOwner: 0 };

    // Player 1's turn begins: player 0's weather is not theirs to count down and player 0's units stay acted.
    const mid = applyAction(s, END);
    expect(kinds(mid.events)).toEqual(['turnEnded', 'turnStarted']);
    expect(mid.state.weather).toBe('ionstorm');
    expect(byId(mid.state, 1)?.acted).toBe(true);

    const { state, events } = applyAction(mid.state, END);
    expect(kinds(events)).toEqual(['turnEnded', 'weather', 'repaired', 'supplied', 'crashed', 'turnStarted']);
    const income = 1000; // one arcology
    const repairCost = (2 * price('trooper')) / 10;
    expect(events[2]).toEqual({ kind: 'repaired', unitId: 1, amount: 20, cost: repairCost });
    expect(events[3]).toEqual({ kind: 'supplied', byId: 2, unitIds: [3] });
    expect(events[4]).toEqual({ kind: 'crashed', unitId: 4, at: { x: 4, y: 2 } });
    expect(events[5]).toEqual({ kind: 'turnStarted', player: 0, cycle: 2, income });
    expect(state.weather).toBe('clear');
    expect(state.players[0].funds).toBe(income - repairCost);
    expect(byId(state, 1)).toMatchObject({ hp: 70, acted: false });
    expect(byId(state, 3)?.charge).toBe(UNIT_TYPES.wasp.charge);
    expect(byId(state, 4)).toBeUndefined();
    expect(state.players[0].stats.unitsLost).toBe(1);
  });

  it("ends last turn's power before income is read (a +100% income surge pays once, not twice)", () => {
    registry(testCommander('surger', [], [{ incomePercent: 100 }]));
    let s = fixtureGame(['C..'], [{ type: 'trooper', owner: 0, x: 1, y: 0 }, decoy(2, 0)], {
      owners: ['0..'], players: duo('surger'),
    });
    s = patchPlayer(s, 0, { power: 1_000_000 });
    s = applyAction(s, { kind: 'power', level: 'surge' }).state;
    expect(s.players[0].powerState).toBe('surge');
    expect(incomeOf(s, 0)).toBe(2000); // the modifier is live while the power is up
    const before = s.players[0].funds;
    const { state } = toTurnOf(s, 0);
    expect(state.players[0].powerState).toBe('none');
    expect(state.players[0].funds - before).toBe(1000); // base income only; the power ended first
  });
});

// ---------------------------------------------------------------- income (§6)

describe('income', () => {
  // p0 owns arcology, fabricator, uplink; p1 owns skyport, dock, spire; the uplink pays nothing.
  const terrain = ['CFAD', 'UH..'];
  const owners = ['0011', '01..'];
  const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 2, y: 1 }, decoy(3, 1)];

  it('pays 1000 per income property at every start of turn, nothing for an uplink, and only the owner', () => {
    const s = fixtureGame(terrain, units, { owners });
    expect(propertyCount(s, 0)).toBe(3);
    expect(propertyCount(s, 1)).toBe(3);
    expect(s.players[0].funds).toBe(2 * 1000); // cycle 1 already pays player 0
    expect(s.players[1].funds).toBe(0);
    const next = applyAction(s, END).state;
    expect(next.players[1].funds).toBe(3 * 1000);
    expect(next.players[0].funds).toBe(2 * 1000); // player 1's income never reaches player 0
  });

  it('uses the incomePerProperty override for income properties only, including a literal 0', () => {
    const half = fixtureGame(terrain, units, { owners, incomePerProperty: 500 });
    expect(half.players[0].funds).toBe(2 * 500);
    expect(incomeOf(half, 1)).toBe(3 * 500);
    const none = fixtureGame(terrain, units, { owners, incomePerProperty: 0 });
    expect(none.players[0].funds).toBe(0); // 0 means zero, not "use the default"
  });

  it('applies the owner\'s incomePercent modifier to the total and never pays a negative amount', () => {
    registry(testCommander('rich', [{ incomePercent: 50 }]), testCommander('poor', [{ incomePercent: -150 }]));
    const s = fixtureGame(terrain, units, { owners, players: duo('rich', 'poor') });
    expect(s.players[0].funds).toBe(Math.floor((2 * 1000 * (100 + 50)) / 100));
    expect(incomeOf(s, 1)).toBe(0);
    expect(applyAction(s, END).state.players[1].funds).toBe(0);
  });
});

// ---------------------------------------------------------------- repair and resupply (§7)

describe('repair', () => {
  it('repairsDomain maps each property to the domain it services', () => {
    const services: [TerrainId, Domain[]][] = [
      ['arcology', ['ground']], ['fabricator', ['ground']], ['spire', ['ground']],
      ['skyport', ['air']], ['dock', ['sea']], ['uplink', []], ['flats', []], ['sea', []],
    ];
    for (const [terrain, domains] of services) {
      for (const d of ['ground', 'air', 'sea'] as Domain[]) {
        expect(repairsDomain(terrain, d), `${terrain} / ${d}`).toBe(domains.includes(d));
      }
    }
  });

  // [unit, terrain code, owner char, repaired?, income it pays player 0]
  const cases: [UnitTypeId, string, string, boolean, number][] = [
    ['lancer', 'C', '0', true, 1000], ['lancer', 'F', '0', true, 1000], ['lancer', 'H', '0', true, 1000],
    ['wasp', 'A', '0', true, 1000], ['picket', 'D', '0', true, 1000],
    ['lancer', 'A', '0', false, 1000], ['lancer', 'D', '0', false, 1000], ['lancer', 'U', '0', false, 0],
    ['wasp', 'C', '0', false, 1000], ['wasp', 'F', '0', false, 1000], ['wasp', 'D', '0', false, 1000],
    ['lancer', 'C', '1', false, 0], ['lancer', 'C', '.', false, 0],
  ];
  it.each(cases)('%s on %s owned by %s: repaired=%s', (type, code, owner, repaired, income) => {
    const startFunds = 50_000;
    const s = fixtureGame([`${code}.`], [{ type, owner: 0, x: 0, y: 0, hp: 5 }, decoy(1, 0)], {
      owners: [`${owner}.`], startFunds,
    });
    const u = byId(s, 1)!;
    if (repaired) {
      expect(u.hp).toBe((5 + REPAIR_HP) * 10);
      // 10% of the unit's price per display HP restored.
      expect(s.players[0].funds).toBe(startFunds + income - (REPAIR_HP * price(type)) / 10);
    } else {
      expect(u.hp).toBe(50);
      expect(s.players[0].funds).toBe(startFunds + income);
    }
  });

  it('rounds to whole display HP: 57 internal HP (shown 6) becomes 80, and never passes 10', () => {
    const s0 = fixtureGame(['C.'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }, decoy(1, 0)], { owners: ['0.'] });
    const a = toTurnOf(patchPlayer(patchUnit(s0, 1, { hp: 57 }), 0, { funds: 10_000 }), 0).state;
    expect(byId(a, 1)?.hp).toBe(80);
    expect(a.players[0].funds).toBe(10_000 + 1000 - (2 * price('lancer')) / 10);
    // Shown 9: only one display HP can be restored, so only one is paid for.
    const b = toTurnOf(patchPlayer(patchUnit(s0, 1, { hp: 85 }), 0, { funds: 10_000 }), 0).state;
    expect(byId(b, 1)?.hp).toBe(100);
    expect(b.players[0].funds).toBe(10_000 + 1000 - price('lancer') / 10);
  });

  it('tops up a unit shown as 10 but below 100 internal HP for free, and leaves a full unit alone', () => {
    const s0 = fixtureGame(['C.'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }, decoy(1, 0)], { owners: ['0.'] });
    const { state, events } = toTurnOf(patchUnit(s0, 1, { hp: 95 }), 0);
    expect(byId(state, 1)?.hp).toBe(100);
    expect(events.filter((e) => e.kind === 'repaired')).toEqual([{ kind: 'repaired', unitId: 1, amount: 5, cost: 0 }]);
    const full = toTurnOf(s0, 0);
    expect(full.events.some((e) => e.kind === 'repaired')).toBe(false);
  });

  it('repairs 1 display HP when funds cover only that, and nothing when broke (resupply is still free)', () => {
    const s0 = fixtureGame(['C.'], [{ type: 'lancer', owner: 0, x: 0, y: 0, hp: 5 }, decoy(1, 0)], {
      owners: ['0.'], startFunds: 0,
    });
    // Funds at repair time = 0 + 1000 income: enough for one HP of a lancer (700) but not two (1400).
    const base = patchPlayer(patchUnit(s0, 1, { hp: 50 }), 0, { funds: 0 });
    const one = toTurnOf(base, 0).state;
    expect(byId(one, 1)?.hp).toBe(60);
    expect(one.players[0].funds).toBe(1000 - price('lancer') / 10);

    // A bastion costs 1600 per HP, which the 1000 of income cannot buy: no repair, but the tanks are filled.
    const b0 = fixtureGame(['C.'], [{ type: 'bastion', owner: 0, x: 0, y: 0, hp: 5 }, decoy(1, 0)], { owners: ['0.'] });
    const broke = toTurnOf(patchPlayer(patchUnit(b0, 1, { hp: 50, charge: 3, ammo: 0 }), 0, { funds: 0 }), 0).state;
    expect(price('bastion') / 10).toBeGreaterThan(1000);
    expect(byId(broke, 1)).toMatchObject({ hp: 50, charge: UNIT_TYPES.bastion.charge, ammo: UNIT_TYPES.bastion.ammo });
    expect(broke.players[0].funds).toBe(1000);
  });

  it('repairs in row-major order, so a short purse always pays for the unit nearest the top', () => {
    const s0 = fixtureGame(
      ['...C', 'C...'],
      [{ type: 'lancer', owner: 0, x: 0, y: 1, hp: 5 }, { type: 'lancer', owner: 0, x: 3, y: 0, hp: 5 }, decoy(2, 1)],
      { owners: ['...0', '0...'] },
    );
    // Unit 1 is the lower row but has the lower id. Funds at repair time: 2000 income, enough for one 2-HP repair (1400).
    const s = toTurnOf(patchPlayer(patchUnit(patchUnit(s0, 1, { hp: 50 }), 2, { hp: 50 }), 0, { funds: 0 }), 0).state;
    expect(byId(s, 2)?.hp).toBe(70);
    expect(byId(s, 1)?.hp).toBe(50);
    expect(s.players[0].funds).toBe(2000 - (2 * price('lancer')) / 10);
  });

  it('adds repairBonus for matching units only, and prices repair at the CO-modified cost', () => {
    registry(
      testCommander('medic', [{ repairBonus: 1, filter: { domains: ['ground'] } }]),
      testCommander('bargain', [{ costPercent: -50 }]),
    );
    const layout = ['CA.'];
    const owners = ['00.'];
    const units: FixtureUnit[] = [
      { type: 'lancer', owner: 0, x: 0, y: 0, hp: 4 }, { type: 'wasp', owner: 0, x: 1, y: 0, hp: 4 }, decoy(2, 0),
    ];
    const medic = fixtureGame(layout, units, { owners, players: duo('medic'), startFunds: 50_000 });
    expect(byId(medic, 1)?.hp).toBe((4 + REPAIR_HP + 1) * 10); // ground: +2 and the bonus
    expect(byId(medic, 2)?.hp).toBe((4 + REPAIR_HP) * 10);     // air: the filter keeps the bonus off
    expect(medic.players[0].funds).toBe(50_000 + 2000 - (3 * price('lancer')) / 10 - (2 * price('wasp')) / 10);

    const bargain = fixtureGame(layout, units, { owners, players: duo('bargain'), startFunds: 50_000 });
    const half = (t: UnitTypeId) => (price(t) * 50) / 100;
    expect(bargain.players[0].funds).toBe(50_000 + 2000 - (2 * half('lancer')) / 10 - (2 * half('wasp')) / 10);
  });
});

describe('resupply', () => {
  it('refills charge and ammo on an own property that services the unit, and nowhere else', () => {
    const s0 = fixtureGame(
      ['CA.'],
      [{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'lancer', owner: 0, x: 1, y: 0 }, decoy(2, 0)],
      { owners: ['00.'] },
    );
    let s = patchUnit(s0, 1, { charge: 3, ammo: 0 });
    s = patchUnit(s, 2, { charge: 3, ammo: 0 }); // on a skyport: a ground unit is not serviced there
    const { state } = toTurnOf(s, 0);
    expect(byId(state, 1)).toMatchObject({ charge: UNIT_TYPES.lancer.charge, ammo: UNIT_TYPES.lancer.ammo });
    expect(byId(state, 2)).toMatchObject({ charge: 3, ammo: 0 });
  });

  it('lets an own mule resupply orthogonal neighbours only, never repairing and never helping the enemy', () => {
    const s0 = fixtureGame(
      ['.....', '.....', '.....'],
      [
        { type: 'mule', owner: 0, x: 2, y: 1 },     // 1
        { type: 'lancer', owner: 0, x: 2, y: 0 },   // 2: north of the mule
        { type: 'wasp', owner: 0, x: 3, y: 1 },     // 3: east of the mule
        { type: 'wasp', owner: 0, x: 3, y: 2 },     // 4: diagonal
        { type: 'mule', owner: 1, x: 0, y: 0 },     // 5: enemy mule
        { type: 'lancer', owner: 0, x: 0, y: 1 },   // 6: south of the enemy mule
      ],
    );
    let s = patchUnit(s0, 2, { charge: 5, ammo: 0, hp: 50 });
    s = patchUnit(s, 3, { charge: 10 });
    s = patchUnit(s, 4, { charge: 10 });
    s = patchUnit(s, 6, { charge: 5, ammo: 0 });
    const { state, events } = toTurnOf(s, 0);
    expect(byId(state, 2)).toMatchObject({ charge: UNIT_TYPES.lancer.charge, ammo: UNIT_TYPES.lancer.ammo, hp: 50 });
    expect(byId(state, 3)?.charge).toBe(UNIT_TYPES.wasp.charge);
    expect(byId(state, 4)?.charge).toBe(10 - (UNIT_TYPES.wasp.drain ?? 0)); // diagonal: not supplied, so it drains
    expect(byId(state, 6)).toMatchObject({ charge: 5, ammo: 0 });
    const supplied = events.filter((e) => e.kind === 'supplied');
    expect(supplied).toHaveLength(1);
    const first = supplied[0];
    expect(first.kind === 'supplied' && first.byId).toBe(1);
    expect(first.kind === 'supplied' && [...first.unitIds].sort()).toEqual([2, 3]);
  });
});

// ---------------------------------------------------------------- charge drain, crash and sink (§8, D-012)

describe('charge drain', () => {
  // D-012 (1): wasp 2, raptor 5, anvil 5, picket / dreadnought / barge 1, ground 0.
  const drains: [UnitTypeId, number][] = [
    ['wasp', 2], ['raptor', 5], ['anvil', 5], ['picket', 1], ['dreadnought', 1], ['barge', 1], ['trooper', 0], ['lancer', 0],
  ];
  const row = ['~..']; // sea at (0,0): air flies over it, ships float on it

  it.each(drains)('%s burns %i charge per own turn from cycle 2', (type, drain) => {
    const s0 = fixtureGame(UNIT_TYPES[type].domain === 'ground' ? ['...'] : row, [
      { type, owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }, decoy(2, 0),
    ]);
    expect(byId(s0, 1)?.charge).toBe(UNIT_TYPES[type].charge); // cycle 1: nothing burns
    const { state } = toTurnOf(s0, 0);
    expect(state.cycle).toBe(2);
    expect(byId(state, 1)?.charge).toBe(UNIT_TYPES[type].charge - drain);
  });

  it('drains only the owner\'s units on the owner\'s turn, and not at all during cycle 1', () => {
    const s0 = fixtureGame(row, [
      { type: 'trooper', owner: 0, x: 1, y: 0 }, { type: 'picket', owner: 1, x: 0, y: 0 }, decoy(2, 0),
    ]);
    const p1First = applyAction(s0, END).state; // player 1's first turn is still cycle 1
    expect(byId(p1First, 2)?.charge).toBe(UNIT_TYPES.picket.charge);
    const p0Second = applyAction(p1First, END).state; // player 0 starts cycle 2: player 1's ship is not theirs to drain
    expect(byId(p0Second, 2)?.charge).toBe(UNIT_TYPES.picket.charge);
    const p1Second = applyAction(p0Second, END).state;
    expect(byId(p1Second, 2)?.charge).toBe(UNIT_TYPES.picket.charge - 1);
  });

  // [unit, charge at the start of its owner's turn, survives?]. Drain taking an air or sea unit to 0 destroys it.
  const fates: [UnitTypeId, number, boolean][] = [
    ['raptor', 5, false], ['raptor', 6, true], ['anvil', 5, false], ['wasp', 2, false], ['wasp', 3, true],
    ['picket', 1, false], ['picket', 2, true], ['dreadnought', 1, false], ['barge', 1, false], ['barge', 2, true],
  ];
  it.each(fates)('%s with %i charge left: survives=%s', (type, charge, survives) => {
    const s0 = fixtureGame(row, [
      { type, owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }, decoy(2, 0),
    ]);
    const { state, events } = toTurnOf(patchUnit(s0, 1, { charge }), 0);
    const unit = byId(state, 1);
    if (survives) {
      expect(unit?.charge).toBe(charge - (UNIT_TYPES[type].drain ?? 0));
      expect(state.players[0].stats.unitsLost).toBe(0);
      expect(kinds(events)).not.toContain('crashed');
    } else {
      expect(unit).toBeUndefined();
      expect(state.players[0].stats.unitsLost).toBe(1);
      expect(state.players[1].stats.unitsDestroyed).toBe(0); // running dry is nobody's kill
      expect(events.filter((e) => e.kind === 'crashed')).toEqual([{ kind: 'crashed', unitId: 1, at: { x: 0, y: 0 } }]);
      expect(kinds(events)).not.toContain('destroyed');
    }
  });

  it('never crashes a ground unit, even at 0 charge', () => {
    const s0 = fixtureGame(row, [{ type: 'lancer', owner: 0, x: 1, y: 0 }, decoy(2, 0)]);
    const { state } = toTurnOf(patchUnit(s0, 1, { charge: 0 }), 0);
    expect(byId(state, 1)).toMatchObject({ charge: 0 });
    expect(state.players[0].stats.unitsLost).toBe(0);
  });

  it('exempts units resupplied that turn: on an own matching port, beside an own mule, but not on a foreign or wrong one', () => {
    const own = fixtureGame(['A..'], [
      { type: 'raptor', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }, decoy(2, 0),
    ], { owners: ['0..'] });
    const ownResult = toTurnOf(patchUnit(own, 1, { charge: 5 }), 0).state;
    expect(byId(ownResult, 1)?.charge).toBe(UNIT_TYPES.raptor.charge); // refilled, not drained to 0 and crashed

    const dock = fixtureGame(['D..'], [
      { type: 'picket', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }, decoy(2, 0),
    ], { owners: ['0..'] });
    expect(byId(toTurnOf(patchUnit(dock, 1, { charge: 1 }), 0).state, 1)?.charge).toBe(UNIT_TYPES.picket.charge);

    const mule = fixtureGame(['...'], [
      { type: 'wasp', owner: 0, x: 0, y: 0 }, { type: 'mule', owner: 0, x: 1, y: 0 }, decoy(2, 0),
    ]);
    expect(byId(toTurnOf(patchUnit(mule, 1, { charge: 2 }), 0).state, 1)?.charge).toBe(UNIT_TYPES.wasp.charge);

    // Known-bad inputs: an enemy skyport, a neutral skyport, and an own dock for an air unit all leave the unit to drain.
    for (const [code, owner, type] of [['A', '1', 'raptor'], ['A', '.', 'raptor'], ['D', '0', 'wasp']] as const) {
      const g = fixtureGame([`${code}..`], [
        { type, owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }, decoy(2, 0),
      ], { owners: [`${owner}..`] });
      const r = toTurnOf(patchUnit(g, 1, { charge: UNIT_TYPES[type].drain ?? 0 }), 0).state;
      expect(byId(r, 1), `${type} on ${code} owned by ${owner}`).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------- capture (§5)

describe('capture', () => {
  const field = ['.C..', '....'];
  const mk = (hp = 10, owners = ['....', '....']) => fixtureGame(
    field, [{ type: 'trooper', owner: 0, x: 1, y: 0, hp }, decoy(3, 1)], { owners },
  );

  it('subtracts the capturer\'s display HP from 20 and reports the progress', () => {
    const s = mk(7);
    expect(thenOptions(s, 1, { x: 1, y: 0 })).toContain('capture');
    const { state, events } = applyAction(s, capture(1, 1, 0));
    expect(state.tiles[0][1]).toMatchObject({ owner: null, capture: 20 - 7 });
    expect(events.find((e) => e.kind === 'captureProgress')).toEqual({
      kind: 'captureProgress', unitId: 1, at: { x: 1, y: 0 }, remaining: 13,
    });
  });

  it('takes a 5-HP capturer four turns, then hands over, resets to 20 and reports it', () => {
    let s = mk(5);
    const left: number[] = [];
    for (let turn = 1; turn <= 3; turn++) {
      s = applyAction(s, capture(1, 1, 0)).state;
      left.push(s.tiles[0][1].capture);
      expect(s.tiles[0][1].owner, `turn ${turn}`).toBeNull();
      s = toTurnOf(s, 0).state;
    }
    expect(left).toEqual([20 - 5, 20 - 10, 20 - 15]);
    const last = applyAction(s, capture(1, 1, 0));
    expect(last.state.tiles[0][1]).toMatchObject({ owner: 0, capture: 20 });
    expect(last.events.find((e) => e.kind === 'captured')).toEqual({
      kind: 'captured', at: { x: 1, y: 0 }, terrain: 'arcology', by: 0, from: null,
    });
  });

  it('takes an enemy property and removes it from their income at once', () => {
    const s = mk(10, ['.1..', '....']);
    expect(incomeOf(s, 1)).toBe(1000);
    expect(incomeOf(s, 0)).toBe(0);
    const r1 = applyAction(s, capture(1, 1, 0)).state;
    expect(incomeOf(r1, 1)).toBe(1000); // not yet
    const r2 = applyAction(toTurnOf(r1, 0).state, capture(1, 1, 0));
    expect(r2.state.tiles[0][1].owner).toBe(0);
    expect(r2.events.find((e) => e.kind === 'captured')).toMatchObject({ by: 0, from: 1 });
    expect(incomeOf(r2.state, 1)).toBe(0);
    expect(incomeOf(r2.state, 0)).toBe(1000);
  });

  it('refuses own, allied and non-capturable targets (known-bad inputs)', () => {
    const three: PlayerSetup[] = [setup(0), setup(1, 'none', 'tidewell'), setup(0, 'none', 'verdant')]; // 2 is 0's ally
    const g = (owner: string, type: UnitTypeId) => fixtureGame(
      ['C..'], [{ type, owner: 0, x: 0, y: 0 }, decoy(2, 0), { type: 'trooper', owner: 2, x: 1, y: 0 }],
      { owners: [`${owner}..`], players: three },
    );
    expect(canCaptureHere(g('.', 'trooper'), byId(g('.', 'trooper'), 1)!)).toBe(true);  // neutral
    expect(canCaptureHere(g('1', 'trooper'), byId(g('1', 'trooper'), 1)!)).toBe(true);  // enemy
    expect(canCaptureHere(g('0', 'trooper'), byId(g('0', 'trooper'), 1)!)).toBe(false); // own
    expect(canCaptureHere(g('2', 'trooper'), byId(g('2', 'trooper'), 1)!)).toBe(false); // ally
    expect(canCaptureHere(g('.', 'lancer'), byId(g('.', 'lancer'), 1)!)).toBe(false);   // cannot capture
    const flats = fixtureGame(['...'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, decoy(2, 0)]);
    expect(canCaptureHere(flats, byId(flats, 1)!)).toBe(false); // not a property
    // The same refusals through the action path and through applyCapture itself.
    for (const owner of ['0', '2']) {
      const s = g(owner, 'trooper');
      expect(isLegal(s, capture(1, 0, 0)), `owner ${owner}`).toBe(false);
      expect(() => applyCapture(draft(s), byId(s, 1)!)).toThrow(IllegalActionError);
    }
    expect(isLegal(g('.', 'lancer'), capture(1, 0, 0))).toBe(false);
  });

  it('defeats a player whose Command Spire falls, turning it into an arcology and passing on their properties', () => {
    const three: PlayerSetup[] = [setup(0), setup(1, 'none', 'tidewell'), setup(2, 'none', 'verdant')];
    const s0 = fixtureGame(
      ['.HC.'], [
        { type: 'trooper', owner: 0, x: 1, y: 0, hp: 10 }, { type: 'trooper', owner: 1, x: 0, y: 0 },
        { type: 'trooper', owner: 2, x: 3, y: 0 },
      ],
      { owners: ['.11.'], players: three },
    );
    const first = applyAction(s0, capture(1, 1, 0)).state;
    expect(first.players[1].defeated).toBe(false);
    const { state, events } = applyAction(toTurnOf(first, 0).state, capture(1, 1, 0));
    expect(state.players[1].defeated).toBe(true);
    expect(events.find((e) => e.kind === 'playerDefeated')).toEqual({ kind: 'playerDefeated', player: 1, reason: 'hq' });
    expect(state.tiles[0][1]).toMatchObject({ terrain: 'arcology', owner: 0 });
    expect(state.tiles[0][2].owner).toBe(0); // their other property goes to the captor
    expect(byId(state, 2)).toBeUndefined();  // their units are gone
    expect(state.winnerTeam).toBeNull();     // player 2 is still in the game
  });

  it('checks the capture objective when a property changes hands', () => {
    const s0 = fixtureGame(
      ['CC.'], [{ type: 'trooper', owner: 0, x: 1, y: 0, hp: 10 }, decoy(2, 0)],
      { owners: ['0..'], objective: { kind: 'capture', properties: 2 } },
    );
    const first = applyAction(s0, capture(1, 1, 0));
    expect(first.state.winnerTeam).toBeNull();
    const { state, events } = applyAction(toTurnOf(first.state, 0).state, capture(1, 1, 0));
    expect(propertyCount(state, 0)).toBe(2);
    expect(state.winnerTeam).toBe(0);
    expect(events.find((e) => e.kind === 'victory')).toEqual({ kind: 'victory', team: 0 });
    // The default objective does not end the game on a property count.
    const rout = fixtureGame(['CC.'], [{ type: 'trooper', owner: 0, x: 1, y: 0, hp: 10 }, decoy(2, 0)], { owners: ['0..'] });
    const r = applyAction(toTurnOf(applyAction(rout, capture(1, 1, 0)).state, 0).state, capture(1, 1, 0)).state;
    expect(propertyCount(r, 0)).toBe(2);
    expect(r.winnerTeam).toBeNull();
  });
});

// ---------------------------------------------------------------- production (§6)

describe('production', () => {
  // Row 0: own fabricator, skyport, dock, arcology, flats, own fabricator (occupied). Row 1: enemy F/A/D, flats, neutral F.
  const terrain = ['FADC.F', 'FAD..F'];
  const owners = ['0000.0', '111...'];
  const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 5, y: 0 }, decoy(4, 1)];
  const game = (extra: Parameters<typeof fixtureGame>[2] = {}) => fixtureGame(terrain, units, { owners, startFunds: 0, ...extra });
  const build = (x: number, y: number, unitType: UnitTypeId): Action => ({ kind: 'build', at: { x, y }, unitType });

  it('has the funds it expects: five own properties pay 5000 and nothing else is in the bank', () => {
    expect(game().players[0].funds).toBe(5 * 1000);
  });

  it('builds only at an own, empty fabricator/skyport/dock, for that building\'s domain', () => {
    const s = patchPlayer(game(), 0, { funds: 100_000 }); // rich, so a refusal below is never about money
    const legal: [number, number, UnitTypeId][] = [[0, 0, 'trooper'], [1, 0, 'wasp'], [2, 0, 'picket'], [2, 0, 'barge']];
    for (const [x, y, t] of legal) expect(isLegal(s, build(x, y, t)), `${t} at ${x},${y}`).toBe(true);

    const refused: [number, number, UnitTypeId, RegExp][] = [
      [0, 0, 'wasp', /cannot build air/], [0, 0, 'picket', /cannot build sea/],
      [1, 0, 'trooper', /cannot build ground/], [2, 0, 'trooper', /cannot build ground/],
      [3, 0, 'trooper', /cannot build units/], [4, 0, 'trooper', /do not own/], // an own arcology, then bare ground
      [0, 1, 'trooper', /do not own/], [5, 1, 'trooper', /do not own/], // enemy and neutral fabricators
      [5, 0, 'trooper', /occupied/],
      [9, 9, 'trooper', /off the map/], [-1, 0, 'trooper', /off the map/], [0.5, 0, 'trooper', /off the map/],
      [0, 0, 'zeppelin' as UnitTypeId, /unknown unit type/],
    ];
    for (const [x, y, t, why] of refused) {
      expect(() => applyAction(s, build(x, y, t)), `${t} at ${x},${y}`).toThrow(why);
      expect(isLegal(s, build(x, y, t))).toBe(false);
    }
  });

  it('needs the full price: exactly enough builds, one short is refused', () => {
    const s = game();
    expect(s.players[0].funds).toBe(price('mule'));
    expect(isLegal(s, build(0, 0, 'mule'))).toBe(true);
    expect(() => applyAction(s, build(0, 0, 'lancer'))).toThrow(/not enough funds/);
    const short = patchPlayer(s, 0, { funds: price('mule') - 1 });
    expect(() => applyAction(short, build(0, 0, 'mule'))).toThrow(/not enough funds/);
  });

  it('pays the price, creates a full-strength acted unit and records the build', () => {
    const s = patchPlayer(game(), 0, { funds: 20_000 });
    const t = UNIT_TYPES.lancer;
    const { state, events } = applyAction(s, build(0, 0, 'lancer'));
    expect(state.players[0].funds).toBe(20_000 - t.cost);
    expect(state.players[0].stats.unitsBuilt).toBe(1);
    expect(state.nextUnitId).toBe(s.nextUnitId + 1);
    expect(unitAt(state, { x: 0, y: 0 })).toEqual({
      id: s.nextUnitId, type: 'lancer', owner: 0, x: 0, y: 0, hp: 100, charge: t.charge, ammo: t.ammo ?? 0, acted: true, cargo: [],
    });
    expect(events).toEqual([{ kind: 'built', unitId: s.nextUnitId, type: 'lancer', at: { x: 0, y: 0 }, owner: 0, cost: t.cost }]);
    expect(s.players[0].stats.unitsBuilt).toBe(0); // the input state is untouched
    // The new unit cannot act until its owner's next turn, and the tile is taken.
    expect(isLegal(state, move(s.nextUnitId, [[0, 0], [0, 1]]))).toBe(false);
    expect(isLegal(state, build(0, 0, 'trooper'))).toBe(false);
    const next = toTurnOf(state, 0).state;
    expect(byId(next, s.nextUnitId)?.acted).toBe(false);
  });

  it('applies costPercent to the price paid and to the build list, only for the units it names', () => {
    registry(testCommander('cheap', [{ costPercent: -20, filter: { domains: ['ground'] } }]));
    const s = patchPlayer(game({ players: duo('cheap') }), 0, { funds: 20_000 });
    const discounted = Math.round((price('lancer') * 80) / 100);
    expect(discounted).toBeLessThan(price('lancer'));
    expect(applyAction(s, build(0, 0, 'lancer')).state.players[0].funds).toBe(20_000 - discounted);
    expect(buildOptions(s, { x: 0, y: 0 }).find((o) => o.type === 'lancer')?.cost).toBe(discounted);
    // Air units are outside the filter: full price.
    expect(applyAction(s, build(1, 0, 'wasp')).state.players[0].funds).toBe(20_000 - price('wasp'));
    expect(buildOptions(s, { x: 1, y: 0 }).find((o) => o.type === 'wasp')?.cost).toBe(price('wasp'));
  });

  it('lists the domain\'s units with cost and affordability, and nothing at a site that cannot build', () => {
    const funds = 6000;
    const s = patchPlayer(game(), 0, { funds });
    const expectFor = (domain: Domain) => UNIT_LIST.filter((u) => u.domain === domain)
      .map((u) => (u.cost <= funds ? { type: u.id, cost: u.cost, affordable: true } : { type: u.id, cost: u.cost, affordable: false, reason: 'funds' }));
    expect(buildOptions(s, { x: 0, y: 0 })).toEqual(expectFor('ground'));
    expect(buildOptions(s, { x: 1, y: 0 })).toEqual(expectFor('air'));
    expect(buildOptions(s, { x: 2, y: 0 })).toEqual(expectFor('sea'));
    expect(buildOptions(s, { x: 0, y: 0 }).some((o) => o.affordable)).toBe(true);
    expect(buildOptions(s, { x: 0, y: 0 }).some((o) => !o.affordable)).toBe(true);
    for (const [x, y] of [[3, 0], [4, 0], [5, 0], [0, 1], [5, 1], [9, 9], [-1, 0], [0.5, 0]]) {
      expect(buildOptions(s, { x, y }), `${x},${y}`).toEqual([]);
    }
  });
});
