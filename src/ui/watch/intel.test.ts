// The intel card's model and markup. The fog tests plant an enemy the viewer cannot see and check that it never reaches the card, then
// check the same enemy DOES reach the omniscient viewer's card (so the planted enemy is real and the test would notice a leak).
// Numbers on the card are checked against the engine's own state and against literal values in src/data.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { FACTIONS, MOVE_TYPE_NAMES, TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import { displayHp } from '../../game/aw';
import type { GameEvent } from '../../game/aw';
import { fixtureMap } from '../../game/aw/testing';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import { IntelCardView } from './IntelCard';
import { actingUnitId, intelAt, intelReasonLabel, struckUnitId } from './intel';
import type { IntelModel } from './intel';
import { recordMatch, viewTimeline } from './timeline';
import type { TimelineStep, ViewFrame } from './timeline';
import { PLAYERS, endTurn, fieldSetup, pt, walk } from './testing';

type UnitModel = Extract<IntelModel, { kind: 'unit' }>;
const asUnit = (m: IntelModel): UnitModel => {
  if (m.kind !== 'unit') throw new Error(`expected a unit card, got: ${m.message}`);
  return m;
};

// ---------------------------------------------------------------- which unit: the fog tests

// Our trooper (id 1) walks to x=3 and sees as far as x=5. The enemy trooper (id 2) then walks 9 -> 6: it never comes into sight.
const scouting = recordMatch(
  fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true }),
  [walk(1, [0, 1, 2, 3]), endTurn, walk(2, [9, 8, 7, 6])],
);

describe('the card names the unit the step is about', () => {
  const tl = viewTimeline(scouting, 0);

  it('shows nothing at the start of the match, and says so quietly', () => {
    const m = intelAt(tl.steps, 0);
    expect(m.kind).toBe('empty');
    expect(m.kind === 'empty' && m.message.length).toBeGreaterThan(10);
  });

  it('shows the unit that acted, as the viewer knows it: our trooper after its walk', () => {
    const m = asUnit(intelAt(tl.steps, 1));
    expect(m.reason).toBe('acting');
    expect(m.fromStep).toBe(1);
    expect(m.unit).toMatchObject({ id: 1, type: 'trooper', name: UNIT_TYPES.trooper.name, owner: 0, faction: 'helion', factionName: FACTIONS.helion.name });
    expect(intelReasonLabel(m)).toBe('Acting now');
  });

  it('keeps the last unit that acted while nobody visible acts (the end of a turn)', () => {
    const m = asUnit(intelAt(tl.steps, 2));
    expect(m).toMatchObject({ reason: 'last', fromStep: 1 });
    expect(m.unit.id).toBe(1);
    expect(intelReasonLabel(m)).toBe('Last to act, step 1');
  });

  it('NEVER shows the planted enemy that walked in the dark: step 3 still shows our own unit (known-bad: unit 2)', () => {
    const m = asUnit(intelAt(tl.steps, 3));
    expect(m.unit.id).not.toBe(2);
    expect(m.unit.owner).toBe(0);
    expect(m).toMatchObject({ reason: 'last', fromStep: 1 });
    // the enemy really is hidden: not in the viewer's frame at any step
    for (const s of tl.steps) expect(s.frame.units.map((u) => u.id)).not.toContain(2);
  });

  it('shows the same planted enemy to the omniscient viewer (known-positive: the test would see a leak)', () => {
    const all = viewTimeline(scouting, 'all');
    const m = asUnit(intelAt(all.steps, 3));
    expect(m).toMatchObject({ reason: 'acting', fromStep: 3 });
    expect(m.unit).toMatchObject({ id: 2, owner: 1, faction: 'tidewell', name: 'Trooper' });
  });

  it('on every step, a fogged viewer\'s card holds only a unit that is in that viewer\'s own frame', () => {
    for (const viewer of [0, 1] as const) {
      const t = viewTimeline(scouting, viewer);
      for (const s of t.steps) {
        const m = intelAt(t.steps, s.index);
        if (m.kind === 'unit') expect(s.frame.units.map((u) => u.id), `viewer ${viewer} step ${s.index}`).toContain(m.unit.id);
      }
    }
  });

  it('is empty, not an enemy, when the only thing that ever acted was in the dark', () => {
    const dark = recordMatch(
      fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true }),
      [endTurn, walk(2, [9, 8, 7, 6])],
    );
    const fogged = viewTimeline(dark, 0);
    expect(intelAt(fogged.steps, 2).kind).toBe('empty');
    expect(asUnit(intelAt(viewTimeline(dark, 'all').steps, 2)).unit.id).toBe(2);
  });
});

// The enemy starts in sight (x=5, two tiles from our trooper at x=3) and walks out of it (to x=8). The viewer is still TOLD the first
// tile of that walk, so the unit's id is in the viewer's events, but the unit is in no frame the viewer has from then on.
describe('an enemy that walks out of sight', () => {
  const rec = recordMatch(
    fieldSetup([{ type: 'trooper', owner: 0, x: 3, y: 1 }, { type: 'trooper', owner: 1, x: 5, y: 1 }], { fog: true }),
    [endTurn, walk(2, [5, 6, 7, 8])],
  );
  const t = viewTimeline(rec, 0);

  it('is named in the viewer\'s own events (so the test is real) but is not in its frame', () => {
    expect(t.steps[1].frame.units.map((u) => u.id)).toContain(2); // in sight before it walks
    const walked = t.steps[2].events.find((e) => e.kind === 'moved');
    expect(walked).toMatchObject({ kind: 'moved', unitId: 2 });
    expect(t.steps[2].frame.units.map((u) => u.id)).not.toContain(2);
  });

  it('never reaches the card afterwards (known-bad: unit 2), and the omniscient viewer\'s card does show it', () => {
    expect(actingUnitId(t.steps[2].events, t.steps[2].frame)).toBeNull();
    const m = intelAt(t.steps, 2);
    expect(m.kind === 'unit' ? m.unit.id : null).not.toBe(2);
    expect(asUnit(intelAt(viewTimeline(rec, 'all').steps, 2)).unit.id).toBe(2);
  });
});

// A hidden Tidewell Arc Battery (id 2) fires from x=6 at our trooper (id 1) at x=3; a skimmer spots for it (the same setup format.test.ts uses).
describe('a shot from a unit the viewer was never shown', () => {
  const rec = recordMatch(
    fieldSetup([{ type: 'trooper', owner: 0, x: 3, y: 1 }, { type: 'arc', owner: 1, x: 6, y: 1 }, { type: 'skimmer', owner: 1, x: 8, y: 1 }], { fog: true }),
    [endTurn, walk(2, [6], { kind: 'attack', target: pt(3) })],
  );

  it('shows the unit that was struck, hurt as the engine says, and not the hidden shooter', () => {
    const t = viewTimeline(rec, 0);
    const m = asUnit(intelAt(t.steps, 2));
    expect(m.reason).toBe('struck');
    expect(m.unit.id).toBe(1);
    expect(intelReasonLabel(m)).toBe('Under fire');
    const truth = rec.states[2].units.find((u) => u.id === 1)!;
    expect(m.unit.hp).toBe(displayHp(truth.hp));
    expect(m.unit.hp).toBeLessThan(10);
    const shot = t.steps[2].events.find((e): e is Extract<GameEvent, { kind: 'attacked' }> => e.kind === 'attacked')!;
    expect(shot.attackerId).toBe(UNSEEN_UNIT); // the shooter really was redacted
  });

  it('shows the shooter, by name and with its real ammo, to the omniscient viewer', () => {
    const m = asUnit(intelAt(viewTimeline(rec, 'all').steps, 2));
    expect(m.reason).toBe('acting');
    expect(m.unit).toMatchObject({ id: 2, name: 'Arc Battery', faction: 'tidewell' });
    expect(m.unit.ammo).toEqual({ value: rec.states[2].units.find((u) => u.id === 2)!.ammo, max: UNIT_TYPES.arc.ammo, low: false });
  });
});

describe('actingUnitId and struckUnitId, on events written by hand', () => {
  const frame = viewTimeline(scouting, 'all').steps[0].frame;
  const moved = (unitId: number): GameEvent => ({ kind: 'moved', unitId, path: [pt(0), pt(1)] });

  it('picks the first acting event whose unit is in the frame', () => {
    expect(actingUnitId([moved(1)], frame)).toBe(1);
    expect(actingUnitId([moved(77), moved(2)], frame)).toBe(2); // 77 is not in the frame: skipped
    expect(actingUnitId([{ kind: 'attacked', attackerId: 2, defenderId: 1, damage: 10, counter: 0, attackerHp: 100, defenderHp: 90 }], frame)).toBe(2);
    expect(actingUnitId([{ kind: 'supplied', byId: 1, unitIds: [2] }], frame)).toBe(1);
  });

  it('refuses an unseen shooter, an unknown id and an empty list (known-bad inputs)', () => {
    expect(actingUnitId([{ kind: 'attacked', attackerId: UNSEEN_UNIT, defenderId: 1, damage: 10, counter: 0, attackerHp: UNSEEN_UNIT, defenderHp: 90 }], frame)).toBeNull();
    expect(actingUnitId([moved(77)], frame)).toBeNull();
    expect(actingUnitId([moved(UNSEEN_UNIT)], frame)).toBeNull();
    expect(actingUnitId([moved(1.5)], frame)).toBeNull();
    expect(actingUnitId([], frame)).toBeNull();
    expect(actingUnitId([{ kind: 'turnEnded', player: 0 }, { kind: 'repaired', unitId: 1, amount: 20, cost: 100 }], frame)).toBeNull(); // not actors
  });

  it('treats the redaction marker as nobody, even if a frame held a unit that carried it (defence in depth)', () => {
    const marked: ViewFrame = { ...frame, units: [...frame.units, { ...frame.units[0], id: UNSEEN_UNIT }] };
    const shot: GameEvent = { kind: 'attacked', attackerId: UNSEEN_UNIT, defenderId: UNSEEN_UNIT, damage: 10, counter: 0, attackerHp: UNSEEN_UNIT, defenderHp: UNSEEN_UNIT };
    expect(actingUnitId([shot], marked)).toBeNull();
    expect(struckUnitId([shot], marked)).toBeNull();
    expect(actingUnitId([moved(UNSEEN_UNIT)], marked)).toBeNull();
  });

  it('names the defender of a shot only when the defender is in the frame', () => {
    const hit = (defenderId: number): GameEvent => ({ kind: 'attacked', attackerId: UNSEEN_UNIT, defenderId, damage: 10, counter: 0, attackerHp: UNSEEN_UNIT, defenderHp: 90 });
    expect(struckUnitId([hit(1)], frame)).toBe(1);
    expect(struckUnitId([hit(77)], frame)).toBeNull();
    expect(struckUnitId([hit(UNSEEN_UNIT)], frame)).toBeNull();
  });
});

describe('the last unit that acted is looked up in the CURRENT frame', () => {
  it('skips one that has since left the viewer\'s sight or died, and takes the one before it', () => {
    const all = viewTimeline(scouting, 'all');
    const f = all.steps[0].frame;
    const without2: ViewFrame = { ...f, units: f.units.filter((u) => u.id !== 2) };
    const steps: Pick<TimelineStep, 'index' | 'frame' | 'events'>[] = [
      { index: 0, frame: without2, events: [] },
      { index: 1, frame: without2, events: [{ kind: 'moved', unitId: 1, path: [pt(0), pt(1)] }] },
      { index: 2, frame: without2, events: [{ kind: 'moved', unitId: 2, path: [pt(9), pt(8)] }] }, // 2 acted later, but is not in the frame now
      { index: 3, frame: without2, events: [{ kind: 'turnEnded', player: 1 }] },
    ];
    const m = asUnit(intelAt(steps, 3));
    expect(m).toMatchObject({ reason: 'last', fromStep: 1 });
    expect(m.unit.id).toBe(1);
  });

  it('clamps a step out of range and survives an empty timeline (known-bad input)', () => {
    const tl = viewTimeline(scouting, 0);
    expect(intelAt(tl.steps, 999).kind).toBe('unit');
    expect(intelAt(tl.steps, -5).kind).toBe('empty');
    expect(intelAt(tl.steps, Number.NaN).kind).toBe('empty');
    expect(intelAt([], 0).kind).toBe('empty');
  });
});

// ---------------------------------------------------------------- what the card says about the unit and its ground

// Row 1: flats, canopy, ridge, maglev, flats, arcology (owned by Tidewell, player 1). Units: lancer (id 1), trooper (2), wasp (3), arc (4),
// breacher (5), all Helion, then an enemy trooper (6) and a Helion mule (7). Every number the card shows must match src/data and the engine's state, never be typed here from the card.
const terrain = fixtureMap(
  ['..........', '.f^=.C....', '..........'],
  [
    { type: 'lancer', owner: 0, x: 1, y: 1, hp: 3 },
    { type: 'trooper', owner: 0, x: 2, y: 1 },
    { type: 'wasp', owner: 0, x: 2, y: 0 },
    { type: 'arc', owner: 0, x: 0, y: 2 },
    { type: 'breacher', owner: 0, x: 5, y: 1, hp: 4 },
    { type: 'trooper', owner: 1, x: 9, y: 2 },
    { type: 'mule', owner: 0, x: 3, y: 2 },
  ],
  ['..........', '.....1....', '..........'],
  'intel-fixture',
);
const world = recordMatch({ map: terrain, players: PLAYERS, fog: false, seed: 1, startFunds: 0 }, []);
const frame0 = viewTimeline(world, 'all').steps[0].frame;

/** The card for `unitId` as if it had just moved, on a copy of the frame that `edit` may change. */
function cardFor(unitId: number, edit?: (f: ViewFrame) => ViewFrame): UnitModel {
  const f = edit ? edit(structuredClone(frame0)) : frame0;
  const steps: Pick<TimelineStep, 'index' | 'frame' | 'events'>[] = [
    { index: 0, frame: f, events: [] },
    { index: 1, frame: f, events: [{ kind: 'moved', unitId, path: [pt(0), pt(1)] }] },
  ];
  return asUnit(intelAt(steps, 1));
}

describe('the unit and the tile it stands on', () => {
  it('reads the terrain\'s name and defense stars from src/data (canopy 2, ridge 4, flats 1, maglev 0)', () => {
    expect(TERRAIN_TYPES.canopy.def).toBe(2);
    expect(TERRAIN_TYPES.ridge.def).toBe(4);
    expect(TERRAIN_TYPES.flats.def).toBe(1);
    expect(TERRAIN_TYPES.maglev.def).toBe(0);
    const lancerOnCanopy = cardFor(1).tile; // lancer at (1,1): canopy
    expect(lancerOnCanopy).toMatchObject({ terrain: 'canopy', name: TERRAIN_TYPES.canopy.name, stars: 2, terrainStars: 2, note: TERRAIN_TYPES.canopy.note, property: false, owner: null, capture: null });
    expect(cardFor(2).tile).toMatchObject({ terrain: 'ridge', stars: 4, terrainStars: 4 }); // trooper at (2,1): ridge
    expect(cardFor(4).tile).toMatchObject({ terrain: 'flats', stars: 1 }); // arc at (0,2): flats
  });

  it('gives an air unit no cover: the wasp over the ridge tile of row 0 gets 0 stars, though the terrain has 4', () => {
    const wasp = cardFor(3, (f) => {
      f.tiles[0][2] = { ...f.tiles[0][2], terrain: 'ridge' };
      return f;
    });
    expect(wasp.unit.airborne).toBe(true);
    expect(wasp.tile).toMatchObject({ terrain: 'ridge', terrainStars: 4, stars: 0 });
    expect(cardFor(2).unit.airborne).toBe(false); // known-bad counterpart: the trooper on the same kind of tile keeps its 4
  });

  it('names a property\'s owner and its capture progress, and only below 20', () => {
    const onArcology = (capture: number | undefined) => cardFor(5, (f) => {
      f.tiles[1][5] = { ...f.tiles[1][5], capture } as ViewFrame['tiles'][number][number];
      return f;
    }).tile;
    expect(onArcology(12)).toMatchObject({ terrain: 'arcology', name: 'Arcology', property: true, owner: 'tidewell', capture: 12, stars: TERRAIN_TYPES.arcology.def });
    expect(onArcology(20).capture).toBeNull();
    expect(onArcology(undefined).capture).toBeNull(); // a tile whose progress the viewer was not told
    expect(cardFor(1).tile.capture).toBeNull(); // canopy is no property
  });

  it('reads name, role, move type and gauges from src/data and the unit\'s own state', () => {
    const m = cardFor(1).unit;
    const state = world.states[0].units.find((u) => u.id === 1)!;
    expect(m).toMatchObject({
      name: UNIT_TYPES.lancer.name, role: UNIT_TYPES.lancer.role, moveTypeName: MOVE_TYPE_NAMES.hover,
      charge: state.charge, chargeMax: UNIT_TYPES.lancer.charge, drains: false,
    });
    expect(m.ammo).toEqual({ value: state.ammo, max: UNIT_TYPES.lancer.ammo, low: false });
    expect(m.commanderName).toBe(COMMANDERS.rook.name);
    // known-bad: a commander the table does not have is never invented, and a prototype key is not a commander
    for (const bad of ['nobody', '__proto__', 'toString']) {
      expect(cardFor(1, (f) => { f.players[0].commander = bad; return f; }).unit.commanderName, bad).toBe('Commander');
    }
  });

  it('shows HP as x/10 by display HP, critical at 3 or less (the fixture: 3, 4 and full)', () => {
    expect(cardFor(1).unit).toMatchObject({ hp: 3, hpCritical: true });
    expect(cardFor(5).unit).toMatchObject({ hp: 4, hpCritical: false });
    expect(cardFor(2).unit).toMatchObject({ hp: 10, hpCritical: false });
  });

  it('rounds internal HP up to display HP exactly as the engine does (1 -> 1, 30 -> 3, 31 -> 4, 91 -> 10, 100 -> 10)', () => {
    const at = (hp: number) => cardFor(2, (f) => { f.units.find((u) => u.id === 2)!.hp = hp; return f; }).unit;
    for (const [internal, shown] of [[1, 1], [10, 1], [11, 2], [30, 3], [31, 4], [91, 10], [100, 10]] as const) {
      expect(at(internal).hp, `hp ${internal}`).toBe(shown);
      expect(at(internal).hp).toBe(displayHp(internal));
      expect(at(internal).hpCritical).toBe(shown <= 3);
    }
  });

  it('flags low charge at a fifth of the full charge or less, and low ammo at one round or none (both sides of each line)', () => {
    const wasp = UNIT_TYPES.wasp;
    const line = Math.round(wasp.charge * 0.2);
    const withCharge = (c: number) => cardFor(3, (f) => { f.units.find((u) => u.id === 3)!.charge = c; return f; }).unit;
    expect(withCharge(line)).toMatchObject({ chargeLow: true, drains: true, charge: line });
    expect(withCharge(line + 1).chargeLow).toBe(false);
    const withAmmo = (a: number) => cardFor(4, (f) => { f.units.find((u) => u.id === 4)!.ammo = a; return f; }).unit.ammo!;
    expect(withAmmo(1)).toEqual({ value: 1, max: UNIT_TYPES.arc.ammo, low: true });
    expect(withAmmo(0).low).toBe(true);
    expect(withAmmo(2).low).toBe(false);
  });

  it('has no ammo gauge for a type with no limited primary weapon (trooper), and does for one that has (breacher)', () => {
    expect(UNIT_TYPES.trooper.ammo).toBeNull();
    expect(cardFor(2).unit.ammo).toBeNull();
    expect(cardFor(5).unit.ammo).toEqual({ value: UNIT_TYPES.breacher.ammo, max: UNIT_TYPES.breacher.ammo, low: false });
  });

  it('says in words what a unit with no ammo gauge fights with: a weapon that never runs dry, or none (mule)', () => {
    expect(UNIT_TYPES.trooper.range).not.toBeNull();
    expect(UNIT_TYPES.mule.range).toBeNull();
    expect(cardFor(2).unit.weapon).toBe('unlimited');
    expect(cardFor(7).unit.weapon).toBe('unarmed');
    expect(cardFor(5).unit.weapon).toBe('limited');
  });

  it('tells an enemy transport\'s cargo only as "carries something", never what', () => {
    const t = cardFor(2, (f) => {
      const u = f.units.find((x) => x.id === 2)!;
      u.loaded = true;
      u.cargo = [];
      return f;
    });
    expect(t.unit.loaded).toBe(true);
    expect(cardFor(2).unit.loaded).toBe(false);
  });
});

// ---------------------------------------------------------------- markup

describe('the card\'s markup', () => {
  it('draws the unit, its HP as x/10, the gauges, the warnings and the tile with its defense stars', () => {
    const m = cardFor(1); // Helion lancer at 3 HP on canopy
    const html = renderToStaticMarkup(createElement(IntelCardView, { model: m }));
    expect(html).toContain(UNIT_TYPES.lancer.name);
    expect(html).toContain('3/10');
    expect(html).toContain('Critical');
    expect(html).toContain('Canopy');
    expect(html).toContain('Defense 2 of 4');
    expect(html).toContain(`${m.unit.charge}/${m.unit.chargeMax}`);
    expect(html).toContain('data-intel="unit"');
    expect(html).toContain(FACTIONS.helion.name);
    // known-bad counterpart: a full-health unit raises no critical chip
    expect(renderToStaticMarkup(createElement(IntelCardView, { model: cardFor(2) }))).not.toContain('Critical');
  });

  it('draws no ammo row for a trooper or a mule, and an ammo row with rounds for a breacher', () => {
    const trooper = renderToStaticMarkup(createElement(IntelCardView, { model: cardFor(2) }));
    const mule = renderToStaticMarkup(createElement(IntelCardView, { model: cardFor(7) }));
    const breacher = renderToStaticMarkup(createElement(IntelCardView, { model: cardFor(5) }));
    for (const html of [trooper, mule]) {
      expect(html).not.toContain('rounds"');
      expect(html).not.toContain('>Ammo<');
    }
    expect(trooper).toContain('No ammo limit');
    expect(mule).toContain('Unarmed');
    expect(breacher).toContain('>Ammo<');
    expect(breacher).toContain(`${UNIT_TYPES.breacher.ammo} of ${UNIT_TYPES.breacher.ammo} rounds`);
    expect(breacher).not.toContain('No ammo limit');
  });

  it('says an air unit takes no cover', () => {
    const m = cardFor(3, (f) => { f.tiles[0][2] = { ...f.tiles[0][2], terrain: 'ridge' }; return f; });
    const html = renderToStaticMarkup(createElement(IntelCardView, { model: m }));
    expect(html).toContain('Air units take no cover');
    expect(html).toContain('Defense 0 of 4');
  });

  it('is never blank: with nothing to show it says so, in a card of the same kind', () => {
    const empty = renderToStaticMarkup(createElement(IntelCardView, { model: intelAt(viewTimeline(scouting, 0).steps, 0) }));
    expect(empty).toContain('data-intel="empty"');
    expect(empty).toContain('Nothing has acted yet');
    expect(empty).toContain('Unit intel');
  });

  it('shows a fogged viewer no trace of the planted enemy, and the omniscient viewer all of it', () => {
    const fog = renderToStaticMarkup(createElement(IntelCardView, { model: intelAt(viewTimeline(scouting, 0).steps, 3) }));
    const all = renderToStaticMarkup(createElement(IntelCardView, { model: intelAt(viewTimeline(scouting, 'all').steps, 3) }));
    expect(fog).not.toContain(FACTIONS.tidewell.name);
    expect(fog).toContain(FACTIONS.helion.name);
    expect(all).toContain(FACTIONS.tidewell.name);
  });
});
