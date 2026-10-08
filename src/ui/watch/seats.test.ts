// G15: how the watch view names the players. The pure helpers, then each place that names a seat (the log, the panels, the toggle, the
// intel card, the banner), on a three-player fixture shaped like mission 1: the player's agent and Rook, both Helion, against drones whose
// nation the story has not named. Every expectation is a literal worked out by hand from the fixture, never read back from the code.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FactionId, GameEvent, PlayerSetup } from '../../game/aw';
import { ViewerToggle } from './Controls';
import { buildLog, formatEvent, makeFormatContext } from './format';
import { Hud } from './Hud';
import { intelAt } from './intel';
import { playerPanels } from './hud';
import { TurnBanner } from './kit';
import { VictoryChip } from './VictoryChip';
import { SeatsContext } from './seatsContext';
import type { SeatBook } from './seatsContext';
import {
  MASKED_NATION_TEXT, bannerSeatOf, isMasked, labelOf, nationTextOf, ownerOf, seatIndexOf, subjectOf, uniqueLabels,
} from './seats';
import type { SeatPresentation } from './seats';
import { endTurn, fieldSetup, walk } from './testing';
import { recordMatch, viewTimeline } from './timeline';

// The mission's own words, as src/ui/front/seats.ts writes them for mission 1 (its test checks that builder against the briefing).
const SEATS: SeatPresentation[] = [
  { name: 'Your agent', label: 'You', nation: 'shown', portrait: 'agent', log: { subject: 'Your agent', owner: 'Your' } },
  { name: 'Rook Okafor', label: 'Rook', nation: 'shown', portrait: 'commander', log: { subject: 'Rook', owner: "Rook's" } },
  { name: 'Unmarked drones', label: 'Unmarked', nation: 'masked', portrait: 'unmarked', log: { subject: 'Unmarked', owner: 'Unmarked' } },
];

const THREE: PlayerSetup[] = [
  { faction: 'helion', commander: 'agent', controller: 'human', team: 0 },
  { faction: 'helion', commander: 'rook', controller: 'ai', team: 0 },
  { faction: 'choir', commander: 'none', controller: 'ai', team: 1 },
];

// Units 1, 2, 3 are the agent's, Rook's and the drones' troopers, in the order listed. Players take turns 0, 1, 2.
const setup = fieldSetup(
  [{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 3, y: 1 }, { type: 'trooper', owner: 2, x: 9, y: 1 }],
  { fog: false, players: THREE },
);
const record = recordMatch(setup, [walk(1, [0, 1, 2]), endTurn, walk(2, [3, 4]), endTurn, walk(3, [9, 8, 7, 6]), endTurn]);
const all = viewTimeline(record, 'all');

describe('the words a seat is named by', () => {
  it('a seat is its label, its log subject and its log owner word; with no list it is its nation, as before', () => {
    expect(labelOf(SEATS, 0, 'helion')).toBe('You');
    expect(subjectOf(SEATS, 0, 'helion')).toBe('Your agent');
    expect(ownerOf(SEATS, 0, 'helion')).toBe('Your');
    expect(ownerOf(SEATS, 1, 'helion')).toBe("Rook's");
    expect(subjectOf(SEATS, 2, 'choir')).toBe('Unmarked');
    expect(labelOf(undefined, 0, 'helion')).toBe('Helion');
    expect(subjectOf(undefined, 2, 'choir')).toBe('Choir');
    expect(ownerOf(undefined, 2, 'choir')).toBe('Choir');
    expect(labelOf(undefined, 4, undefined)).toBe('Player 5');
  });

  it('a seat with no entry is named the old way, and the log words default to the label', () => {
    const partial: (SeatPresentation | undefined)[] = [undefined, { name: 'Rook Okafor', label: 'Rook', nation: 'shown', portrait: 'commander' }];
    expect(labelOf(partial, 0, 'helion')).toBe('Helion');
    expect(subjectOf(partial, 1, 'helion')).toBe('Rook');
    expect(ownerOf(partial, 1, 'helion')).toBe('Rook');
    expect(isMasked(partial, 0)).toBe(false);
  });

  it('a masked seat prints no nation: the nation line is the briefing\'s own "No nation named"', () => {
    expect(isMasked(SEATS, 2)).toBe(true);
    expect(isMasked(SEATS, 0)).toBe(false);
    expect(nationTextOf(SEATS, 2, 'choir')).toBe(MASKED_NATION_TEXT);
    expect(MASKED_NATION_TEXT).toBe('No nation named');
    expect(nationTextOf(SEATS, 0, 'helion')).toBe('Helion Accord');
    expect(nationTextOf(undefined, 2, 'choir')).toBe('The Hollow Choir');
    expect(bannerSeatOf(SEATS, 2, 'choir')).toEqual({ name: 'Unmarked drones', caption: 'No nation named', masked: true });
    expect(bannerSeatOf(SEATS, 1, 'helion')).toEqual({ name: 'Rook Okafor', caption: 'Helion Accord', masked: false });
    expect(bannerSeatOf(undefined, 1, 'helion')).toBeUndefined();
  });
});

describe('uniqueLabels', () => {
  it('numbers a label two seats share, and leaves a label that stands alone exactly as it is', () => {
    expect(uniqueLabels(['Helion', 'Helion', 'Choir'])).toEqual(['Helion 1', 'Helion 2', 'Choir']);
    expect(uniqueLabels(['You', 'Rook', 'Unmarked'])).toEqual(['You', 'Rook', 'Unmarked']);
    expect(uniqueLabels(['A', 'B', 'A', 'B', 'C'])).toEqual(['A 1', 'B 2', 'A 3', 'B 4', 'C']);
    expect(uniqueLabels([])).toEqual([]);
  });
});

describe('seatIndexOf: which seat a banner means, from the nation and the commander\'s name', () => {
  const keys = [
    { faction: 'helion' as const, commanderName: 'Commander' },
    { faction: 'helion' as const, commanderName: 'Rook Okafor' },
    { faction: 'choir' as const, commanderName: 'Commander' },
  ];
  it('tells two seats of one nation apart by the commander\'s name', () => {
    expect(seatIndexOf(keys, 'helion', 'Commander', 0)).toBe(0);
    expect(seatIndexOf(keys, 'helion', 'Rook Okafor', 0)).toBe(1);
    expect(seatIndexOf(keys, 'choir', 'Commander', 0)).toBe(2);
  });
  it('lets the seat whose turn it is settle a tie, and answers -1 for a nation nobody plays', () => {
    const twins = [{ faction: 'helion' as const, commanderName: 'Commander' }, { faction: 'helion' as const, commanderName: 'Commander' }];
    expect(seatIndexOf(twins, 'helion', 'Commander', 1)).toBe(1);
    expect(seatIndexOf(twins, 'helion', 'Commander', 0)).toBe(0);
    expect(seatIndexOf(keys, 'kestrel', 'Commander', 0)).toBe(-1);
    expect(seatIndexOf(keys, 'helion', 'Somebody Else', 0)).toBe(-1);
  });
});

describe('the event log names seats by their own words', () => {
  const texts = (seats?: typeof SEATS): string[] => buildLog(all.steps, seats).map((l) => l.text);

  it('says "Your agent", "Rook" and "Unmarked", and "Your Trooper", "Rook\'s Trooper", "Unmarked Trooper" for their units', () => {
    expect(texts(SEATS)).toEqual([
      'Your Trooper moves 2 tiles',
      'Your agent ends the turn',
      'Cycle 01: Rook\'s turn, income 0 CR',
      "Rook's Trooper moves 1 tile",
      'Rook ends the turn',
      'Cycle 01: Unmarked turn, income 0 CR',
      'Unmarked Trooper moves 3 tiles',
      'Unmarked ends the turn',
      'Cycle 02: Your turn, income 0 CR',
    ]);
  });

  it('is the nation\'s name, twice over, with no seats: "Helion Trooper" is two different units and "Choir" is the drones', () => {
    expect(texts()).toEqual([
      'Helion Trooper moves 2 tiles',
      'Helion ends the turn',
      'Cycle 01: Helion turn, income 0 CR',
      'Helion Trooper moves 1 tile',
      'Helion ends the turn',
      'Cycle 01: Choir turn, income 0 CR',
      'Choir Trooper moves 3 tiles',
      'Choir ends the turn',
      'Cycle 02: Helion turn, income 0 CR',
    ]);
  });

  it('marks the lines about a masked seat, so the log draws the unmarked mark beside them and no other', () => {
    const lines = buildLog(all.steps, SEATS);
    const masked = lines.filter((l) => l.masked).map((l) => l.text);
    expect(masked).toEqual(['Cycle 01: Unmarked turn, income 0 CR', 'Unmarked Trooper moves 3 tiles', 'Unmarked ends the turn']);
    expect(buildLog(all.steps).some((l) => l.masked)).toBe(false);
  });

  it('names every kind of sentence about a side by the seat: its subject, its owner word, a team, a victory', () => {
    const ctx = makeFormatContext(all.steps[0].frame, all.steps[1].frame, [], SEATS);
    const say = (e: GameEvent): string => formatEvent(e, ctx).text;
    expect(ctx.teamName(0)).toBe('Your agent and Rook');
    expect(ctx.teamName(1)).toBe('Unmarked');
    expect(say({ kind: 'victory', team: 0 })).toBe('Victory: Your agent and Rook');
    expect(say({ kind: 'playerDefeated', player: 2, reason: 'rout' })).toBe('Unmarked is defeated: routed');
    expect(say({ kind: 'built', unitId: 9, type: 'lancer', at: { x: 2, y: 1 }, owner: 0, cost: 7000 })).toBe('Your agent builds a Lancer: 7,000 CR');
    expect(say({ kind: 'destroyed', unitId: 3, at: { x: 9, y: 1 }, type: 'trooper', owner: 2 })).toBe('Unmarked Trooper is destroyed');
    expect(say({ kind: 'destroyed', unitId: 1, at: { x: 0, y: 1 }, type: 'trooper', owner: 0 })).toBe('Your Trooper is destroyed');
    expect(say({ kind: 'captured', at: { x: 3, y: 1 }, terrain: 'arcology', by: 1, from: 2 })).toBe('Rook takes the Flats from Unmarked');
    expect(say({ kind: 'captured', at: { x: 3, y: 1 }, terrain: 'arcology', by: 0, from: null })).toBe('Your agent claims the unowned Flats');
    expect(say({ kind: 'attacked', attackerId: 3, defenderId: 1, damage: 40, counter: 10, attackerHp: 90, defenderHp: 60 })).toBe('Unmarked Trooper hits Your Trooper: 40%, counter 10%');
    expect(say({ kind: 'turnStarted', player: 1, cycle: 4, income: 3000 })).toBe("Cycle 04: Rook's turn, income 3,000 CR");
  });
});

describe('the player panels', () => {
  const step = all.steps[0];
  it('are headed by the seat\'s name, with the nation line the nation or "No nation named", and a face that matches the seat', () => {
    const panels = playerPanels(step, SEATS);
    expect(panels.map((p) => p.title)).toEqual(['Your agent', 'Rook Okafor', 'Unmarked drones']);
    expect(panels.map((p) => p.nationText)).toEqual(['Helion Accord', 'Helion Accord', 'No nation named']);
    expect(panels.map((p) => p.masked)).toEqual([false, false, true]);
    expect(panels.map((p) => p.portrait)).toEqual(['agent', 'commander', 'unmarked']);
    expect(panels.map((p) => p.initials)).toEqual(['CO', 'RO', '??']);
  });
  it('are headed by the commander\'s name, "Commander" twice, and the nation, with no seats: the old way', () => {
    const panels = playerPanels(step);
    expect(panels.map((p) => p.title)).toEqual(['Commander', 'Rook Okafor', 'Commander']);
    expect(panels.map((p) => p.nationText)).toEqual(['Helion Accord', 'Helion Accord', 'The Hollow Choir']);
    expect(panels.every((p) => !p.masked && p.portrait === 'commander')).toBe(true);
  });
  it('draw the names, and the hollow choir nowhere, in the markup', () => {
    const html = renderToStaticMarkup(createElement(Hud, { step, seats: SEATS }));
    for (const s of ['Your agent', 'Rook Okafor', 'Unmarked drones', 'No nation named']) expect(html, s).toContain(s);
    expect(html).not.toMatch(/hollow choir/i);
    expect(html.match(/aw-sigil--unmarked/g)?.length, 'the unmarked mark is the nation line\'s sigil, and the portrait\'s').toBe(2);
    // known-bad twin: with no seats the same panels name the nation
    const old = renderToStaticMarkup(createElement(Hud, { step }));
    expect(old).toContain('The Hollow Choir');
    expect(old).not.toContain('Your agent');
  });
  it('are drawn tight when three or more share the column, scroll the column from four, and are left alone when two do', () => {
    expect(renderToStaticMarkup(createElement(Hud, { step }))).toContain('class="aww-huds aww-huds--tight"');
    const five = recordMatch(
      fieldSetup(
        [0, 1, 2, 3, 4].map((owner) => ({ type: 'trooper' as const, owner, x: owner * 2, y: 1 })),
        { fog: false, players: [...THREE, { faction: 'verdant', commander: 'juno', controller: 'ai', team: 0 }, { faction: 'kestrel', commander: 'corvin', controller: 'ai', team: 0 }] },
      ),
      [],
    );
    expect(renderToStaticMarkup(createElement(Hud, { step: viewTimeline(five, 'all').steps[0] }))).toContain('class="aww-huds aww-huds--tight aww-huds--many"');
    const two = recordMatch(fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: false }), []);
    const html = renderToStaticMarkup(createElement(Hud, { step: viewTimeline(two, 'all').steps[0] }));
    expect(html).toContain('class="aww-huds"');
    expect(html).not.toContain('--tight');
  });
});

describe('the victory chip', () => {
  const frame = all.steps[0].frame;
  const chip = (winnerTeam: number | null, seats?: typeof SEATS): string =>
    renderToStaticMarkup(createElement(VictoryChip, { frame: { ...frame, winnerTeam }, seats }));
  it('is not drawn while nobody has won', () => {
    expect(chip(null, SEATS)).toBe('');
  });
  it('names the winning team by its seats\' labels: "You and Rook", where it used to say "Helion and Helion"', () => {
    expect(chip(0, SEATS).replace(/<[^>]*>/g, '')).toBe('Victory: You and Rook');
    expect(chip(0).replace(/<[^>]*>/g, '')).toBe('Victory: Helion and Helion');
  });
  it('draws the unmarked mark, and not the nation\'s sigil, when the winner is the masked seat', () => {
    const html = chip(1, SEATS);
    expect(html.replace(/<[^>]*>/g, '')).toBe('Victory: Unmarked');
    expect(html).toContain('aw-sigil--unmarked');
    expect(chip(1)).not.toContain('aw-sigil--unmarked');
  });
});

describe('the viewer toggle', () => {
  const frame = all.steps[0].frame;
  const labelsOf = (html: string): string[] => [...html.matchAll(/role="radio"[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]*>/g, ''));
  it('offers one button per seat by its label, and no two share a word', () => {
    const labels = labelsOf(renderToStaticMarkup(createElement(ViewerToggle, { frame, viewer: 0, onChange: () => {}, seats: SEATS })));
    expect(labels).toEqual(['You', 'Rook', 'Unmarked', 'All']);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('numbers two seats of one nation when it was given no seats, instead of offering "Helion" twice', () => {
    const labels = labelsOf(renderToStaticMarkup(createElement(ViewerToggle, { frame, viewer: 0, onChange: () => {} })));
    expect(labels).toEqual(['Helion 1', 'Helion 2', 'Choir', 'All']);
  });
  it('draws the unmarked mark on the masked seat\'s button, and titles it with the seat\'s name', () => {
    const html = renderToStaticMarkup(createElement(ViewerToggle, { frame, viewer: 2, onChange: () => {}, seats: SEATS }));
    expect(html.match(/aw-sigil--unmarked/g)?.length).toBe(1);
    expect(html).toContain('title="Watching as Unmarked drones"');
    expect(html).not.toMatch(/choir/i);
  });
});

describe('the unit intel owner line', () => {
  // After the first walk the agent's trooper (id 1) is the unit that acted.
  const stepOf = (i: number) => intelAt(all.steps, i, SEATS);
  it('names the unit\'s side by the seat: "Your agent · Helion Accord", "Rook Okafor · Helion Accord", "Unmarked drones" with no nation', () => {
    const own = stepOf(1);
    const rook = stepOf(3);
    const drones = stepOf(5);
    if (own.kind !== 'unit' || rook.kind !== 'unit' || drones.kind !== 'unit') throw new Error('every one of these steps has a unit acting');
    expect([own.unit.ownerName, own.unit.ownerNation, own.unit.masked]).toEqual(['Your agent', 'Helion Accord', false]);
    expect([rook.unit.ownerName, rook.unit.ownerNation, rook.unit.masked]).toEqual(['Rook Okafor', 'Helion Accord', false]);
    expect([drones.unit.ownerName, drones.unit.ownerNation, drones.unit.masked]).toEqual(['Unmarked drones', null, true]);
    expect([own.unit.ownerWord, rook.unit.ownerWord, drones.unit.ownerWord]).toEqual(['Your', "Rook's", 'Unmarked']);
  });
  it('names the nation and a commander called "Commander" with no seats: the old way', () => {
    const drones = intelAt(all.steps, 5);
    if (drones.kind !== 'unit') throw new Error('a unit acts at step 5');
    expect([drones.unit.ownerName, drones.unit.seated, drones.unit.masked, drones.unit.ownerNation]).toEqual(['The Hollow Choir', false, false, null]);
  });
});

describe('the turn banner', () => {
  const book: SeatBook = {
    seats: SEATS,
    keys: [{ faction: 'helion', commanderName: 'Commander' }, { faction: 'helion', commanderName: 'Rook Okafor' }, { faction: 'choir', commanderName: 'Commander' }],
    current: 0,
  };
  const banner = (faction: FactionId, commander: string, withBook: boolean): string => {
    const el = createElement(TurnBanner, { cycle: 2, faction, commander });
    return renderToStaticMarkup(withBook ? createElement(SeatsContext.Provider, { value: book }, el) : el);
  };
  it('inside a view that names its seats asks the view who it is for, so the 3D stage\'s own banner names them too', () => {
    const drones = banner('choir', 'Commander', true);
    expect(drones).toContain('Unmarked drones');
    expect(drones).toContain('No nation named');
    expect(drones).not.toMatch(/hollow choir/i);
    expect(drones).toContain('aw-sigil--unmarked');
    expect(banner('helion', 'Rook Okafor', true)).toContain('Rook Okafor');
    expect(banner('helion', 'Commander', true)).toContain('Your agent');
  });
  it('is the nation and "<commander> commanding" on its own, as ever', () => {
    const plain = banner('choir', 'Commander', false);
    expect(plain).toContain('The Hollow Choir');
    expect(plain).toContain('Commander commanding');
    expect(plain).not.toContain('aw-sigil--unmarked');
  });
  it('does not guess for a nation the view has no seat for', () => {
    expect(banner('kestrel', 'Commander', true)).toContain('Kestrel Dominion');
  });
});
