// The campaign map's model, against the mission data read straight from the content files. Every mission must be on the map exactly
// once, every one must build a valid game, and Act I must never name the Choir.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { MISSION_MAPS } from '../../content/mission-maps';
import { CAMPAIGN_ACTS, MISSIONS } from '../../content/missions';
import { createGame } from '../../game/aw';
import { hasPortrait } from '../portraits';
import { campaignModel, goalOf, missionById, teamGroups } from './campaign';
import { deploySetup } from './deploy';
import { sidePerson, speakerOf } from './people';

describe('the campaign map', () => {
  const acts = campaignModel();
  const cards = acts.flatMap((a) => a.cards);

  it('has the four acts of the campaign, with their own titles and taglines, in order', () => {
    expect(acts.map((a) => a.act)).toEqual([1, 2, 3, 4]);
    expect(acts.map((a) => a.numeral)).toEqual(['I', 'II', 'III', 'IV']);
    expect(acts.map((a) => a.title)).toEqual(CAMPAIGN_ACTS.map((a) => a.title));
    expect(acts.map((a) => a.tagline)).toEqual(CAMPAIGN_ACTS.map((a) => a.tagline));
    for (const a of acts) expect(a.title.length, `act ${a.act}`).toBeGreaterThan(0);
  });

  it('shows every mission exactly once, in campaign order, under the act it belongs to', () => {
    expect(cards.map((c) => c.id)).toEqual(MISSIONS.map((m) => m.id));
    expect(new Set(cards.map((c) => c.id)).size).toBe(14);
    expect(cards.map((c) => Number(c.number))).toEqual(MISSIONS.map((_, i) => i + 1));
    for (const a of acts) for (const c of a.cards) expect(c.mission.act, `${c.id} under act ${a.act}`).toBe(a.act);
  });

  it('gives each card its order, title, place, summary, fog and weather straight from the mission', () => {
    for (const c of cards) {
      const m = MISSIONS.find((x) => x.id === c.id)!;
      expect([c.title, c.location, c.summary]).toEqual([m.title, m.location, m.summary]);
      expect(c.fogLabel).toBe(m.fog ? 'Fog of war' : 'Clear sight');
      expect(c.weatherLabel).toBe(m.weather === 'ionstorm' ? 'Ion storm' : 'Clear skies');
    }
    // known answers from the data: mission 9 is the ion storm in fog, mission 1 is clear and open
    expect(cards.find((c) => c.id === 'night-wing')).toMatchObject({ fogLabel: 'Fog of war', weatherLabel: 'Ion storm' });
    expect(cards.find((c) => c.id === 'first-light')).toMatchObject({ fogLabel: 'Clear sight', weatherLabel: 'Clear skies' });
  });

  it('draws only Act IV dark', () => {
    expect(acts.map((a) => a.dark)).toEqual([false, false, false, true]);
    expect(acts[3].mark).toBe('choir');
  });

  it('puts every player of a mission on its card, the agent\'s team first, and the hostile teams after', () => {
    for (const c of cards) {
      const m = c.mission;
      const slots = c.groups.flatMap((g) => g.sides.map((s) => s.slot)).sort();
      expect(slots, c.id).toEqual(m.players.map((_, i) => i));
      expect(c.groups[0].yours, c.id).toBe(true);
      expect(c.groups[0].sides.map((s) => s.slot), c.id).toContain(0);
      expect(c.groups.slice(1).every((g) => !g.yours && g.team !== m.players[0].team), c.id).toBe(true);
      for (const g of c.groups) expect(g.sides.every((s) => s.team === g.team)).toBe(true);
    }
    // the four-nation mission and the three-sided duel, counted by hand from the data
    expect(cards.find((c) => c.id === 'null-spire')!.groups.map((g) => g.sides.length)).toEqual([4, 1]);
    expect(cards.find((c) => c.id === 'duel-at-ashgrave')!.groups.map((g) => g.sides.length)).toEqual([2, 1, 1]);
  });

  it('states what wins each mission from its objective', () => {
    expect(goalOf({ kind: 'rout' })).toBe('Rout the enemy');
    expect(goalOf({ kind: 'hq' })).toBe('Seize the Spire');
    expect(goalOf({ kind: 'survive', cycles: 8 })).toBe('Hold 8 cycles');
    expect(goalOf({ kind: 'capture', properties: 7 })).toBe('Own 7 properties');
    expect(cards.find((c) => c.id === 'tidebreak')!.goal).toBe('Hold 8 cycles');
    expect(cards.find((c) => c.id === 'root-and-branch')!.goal).toBe('Own 7 properties');
  });

  it('finds a mission by id and says so when there is none', () => {
    expect(missionById('requiem')?.order).toBe(13);
    expect(missionById('nope')).toBeUndefined();
    expect(missionById('')).toBeUndefined();
  });
});

describe('every mission builds a valid game', () => {
  for (const m of MISSIONS) {
    it(`${m.id}: its map exists, its setup creates a game with its players`, () => {
      const map = MISSION_MAPS[m.mapId];
      expect(map, 'map').toBeDefined();
      const setup = deploySetup(m);
      expect(setup.map).toBe(map);
      const state = createGame(setup);
      expect(state.players.map((p) => p.faction)).toEqual(m.players.map((p) => p.faction));
      expect(state.players.map((p) => p.team)).toEqual(m.players.map((p) => p.team));
      expect(state.units.length).toBe(map.units.length);
    });
  }
});

describe('who is shown', () => {
  it('shows no late reveal anywhere in the map\'s text: act titles, taglines, mission titles, places and summaries', () => {
    // The map shows every act at once (no progress yet), so its text must be safe for a player who has not started.
    const LATE = /vesper|\bcantor\b|\bmira\b|lattice core/i;
    const text = campaignModel().flatMap((a) => [a.title, a.tagline, ...a.cards.flatMap((c) => [c.title, c.location, c.summary])]);
    for (const t of text) expect(t, t).not.toMatch(LATE);
  });
  it('withholds the Choir\'s voices (Cantor, VESPER) on the campaign map, and names them in the mission\'s own briefing', () => {
    const cards = campaignModel().flatMap((a) => a.cards);
    const shown = JSON.stringify(cards.flatMap((c) => c.groups.flatMap((g) => g.sides.map((s) => s.person))));
    expect(shown).not.toMatch(/cantor|vesper/i);
    // The same missions do field them: the objective card (the briefing, opened by the player) still names them.
    const named = MISSIONS.flatMap((m) => teamGroups(m).flatMap((g) => g.sides.map((s) => s.person.name)));
    expect(named.some((n) => /cantor/i.test(n))).toBe(true);
    expect(named.some((n) => /vesper/i.test(n))).toBe(true);
  });
  it('shows the Choir\'s drones as unmarked, with no nation, through all of Act I', () => {
    let seen = 0;
    for (const m of MISSIONS.filter((x) => x.act === 1)) {
      for (const [i, p] of m.players.entries()) {
        if (p.faction !== 'choir') continue;
        seen += 1;
        const person = sidePerson(p, m.act);
        expect(person.kind, `${m.id} slot ${i}`).toBe('unmarked');
        expect(person.faction).toBeNull();
        expect(person.name).not.toMatch(/choir/i);
      }
      for (const g of teamGroups(m)) for (const s of g.sides) expect(s.person.faction, `${m.id}`).not.toBe('choir');
    }
    expect(seen, 'Act I has at least one drone side to check').toBeGreaterThan(0);
  });

  it('names the Choir\'s drones from Act II on', () => {
    const m = MISSIONS.find((x) => x.id === 'pollen-count')!;
    const drones = m.players.find((p) => p.faction === 'choir')!;
    expect(sidePerson(drones, m.act)).toMatchObject({ kind: 'drones', faction: 'choir', name: 'Hollow Choir drones' });
  });

  it('shows the agent as the Commanding Officer, never as a named commander', () => {
    const p = MISSIONS[0].players[0];
    expect(p.commander).toBe('agent');
    expect(sidePerson(p, 1)).toMatchObject({ kind: 'agent', name: 'Your agent', initials: 'CO', faction: 'helion' });
  });

  it('gives a portrait to every named commander that has one, and a plate to a voice that is a place', () => {
    for (const m of MISSIONS) for (const p of m.players) {
      const person = sidePerson(p, m.act);
      if (person.kind === 'commander') expect(person.portraitId, `${m.id} ${p.commander}`).toBe(hasPortrait(p.commander) ? p.commander : undefined);
    }
    expect(speakerOf('rook')).toMatchObject({ kind: 'commander', name: COMMANDERS.rook.name, portraitId: 'rook', faction: 'helion' });
    expect(speakerOf('echo')).toMatchObject({ kind: 'commander', faction: null, portraitId: 'echo' });
    expect(speakerOf('Calder Watch')).toMatchObject({ kind: 'station', name: 'Calder Watch', initials: 'CW' });
    expect(speakerOf('narrator').kind).toBe('narrator');
    // a name that is not a commander never borrows a commander's face, whatever it is called
    expect(speakerOf('constructor').kind).toBe('station');
    expect(speakerOf('toString').kind).toBe('station');
  });
});
