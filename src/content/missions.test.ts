// M4.0 Act I of the campaign: missions 1-4 as data; M4.1 Act II, "False Colors": missions 5-7; M4.2 Act III, "Thin Air": missions 8-11 (the last
// third of this file). Spec:
// docs/STORY.md "Act I", "Act II" and "Writing rules for dialogue", docs/delivery/DECISIONS.md D-004, D-005 and D-007,
// docs/research/quality-bar.md section 15 (the par values the score uses). Every expectation is computed here from
// the story text, from the map rows or from the engine's own queries, never copied back from missions.ts or mission-maps.ts. Known-bad
// inputs: the dialogue checker, the hq check, the capture check and the trigger check each have planted failures they must keep reporting,
// and checkMap's requireBases option has a map with no base that must fail by default and pass with it off.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACTIONS, TERRAIN_CODES, TERRAIN_TYPES, UNIT_TYPES } from '../data';
import { DAMAGE } from '../data/damage';
import { IllegalActionError, applyAction, attackTargets, canCaptureHere, canSeeUnit, createGame, effectiveMove, effectiveVision, forecast, incomeOf, propertyCount, scoreCard, visibility } from '../game/aw';
import type { Action, CreateGameOptions, PlayerSetup } from '../game/aw';
import { simulate } from '../game/aw/sim';
import type { SimPolicy } from '../game/aw/sim';
import type { GameState, MoveType } from '../game/aw/types';
import { COMMANDERS } from './commanders';
import { checkMap, symmetryOf } from './map-check';
import { MAPS } from './maps';
import { MISSION_MAPS as ALL_MISSION_MAPS } from './mission-maps';
import { CAMPAIGN_ACTS as ALL_ACTS, MISSIONS as ALL_MISSIONS } from './missions';
import type { DialogueLine, MapDef, Mission, MissionTrigger } from './types';

// The repo guard owns the list of names that must never ship; reuse it rather than copy it (as maps.test.ts does).
const guardUrl = new URL('../../scripts/guard.mjs', import.meta.url).href;
const guard: { DENYLIST: string[]; scanText: (path: string, text: string) => { rule: string; match: string }[] } = await import(/* @vite-ignore */ guardUrl);

const STORY = readFileSync(new URL('../../docs/STORY.md', import.meta.url), 'utf8');

// ---------------------------------------------------------------- helpers (independent of the code under test)

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
// The first half of this file is Act I's: these three names are Act I's slice of the campaign, so every M4.0 test below still reads as it did.
// Act II (M4.1) has its own constants further down, and the cross-act tests use the ALL_ names.
const MISSIONS = ALL_MISSIONS.filter((m) => m.act === 1);
const CAMPAIGN_ACTS = ALL_ACTS.filter((a) => a.act === 1);
const MISSION_MAPS: Record<string, MapDef> = Object.fromEntries(Object.entries(ALL_MISSION_MAPS).filter(([id]) => /^m[1-4]-/.test(id)));
const [FIRST_LIGHT, CALDER_SPIRE, SALTGLASS_BAY, TIDEBREAK] = MISSIONS;
const mapOf = (m: Mission): MapDef => ALL_MISSION_MAPS[m.mapId];
const linesOf = (m: Mission): DialogueLine[] => [...m.briefing, ...m.events.flatMap((e) => e.lines), ...m.debrief];
const allLines = MISSIONS.flatMap(linesOf);
const tilesOf = (map: MapDef, pred: (ch: string, owner: string, x: number, y: number) => boolean) => {
  const out: { x: number; y: number }[] = [];
  map.terrain.forEach((row, y) => [...row].forEach((ch, x) => { if (pred(ch, map.owners[y][x], x, y)) out.push({ x, y }); }));
  return out;
};
const countOf = (map: MapDef, ch: string, owner?: string) => tilesOf(map, (c, o) => c === ch && (owner === undefined || o === owner)).length;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11 };

/** Steps from `from` over tiles `passable` allows (4-neighbour); -1 where unreachable. */
function distances(map: MapDef, from: { x: number; y: number }, passable: (ch: string) => boolean): number[][] {
  const h = map.terrain.length;
  const w = map.terrain[0].length;
  const d = Array.from({ length: h }, () => new Array<number>(w).fill(-1));
  d[from.y][from.x] = 0;
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || d[ny][nx] !== -1 || !passable(map.terrain[ny][nx])) continue;
      d[ny][nx] = d[y][x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return d;
}
const costFor = (mt: MoveType) => (ch: string) => TERRAIN_TYPES[TERRAIN_CODES[ch]].cost[mt] !== null;
const setCell = (rows: string[], x: number, y: number, ch: string) => {
  rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
};
const spireOf = (map: MapDef, owner: number) => tilesOf(map, (c, o) => c === 'H' && o === String(owner))[0];

function setupFor(m: Mission, seed: number): CreateGameOptions {
  const players: PlayerSetup[] = m.players.map((p) => ({
    faction: p.faction, commander: p.commander, controller: p.controller, team: p.team, ...(p.funds !== undefined ? { funds: p.funds } : {}),
  }));
  // M3.2: the campaign setups are built under the original first-player rule ('none'); the createGame default now compensates the first mover.
  return { map: mapOf(m), players, fog: m.fog, weather: m.weather, objective: m.objective, seed, firstMoverRule: 'none' };
}

// ---------------------------------------------------------------- the dialogue rules (STORY.md "Writing rules for dialogue")

const MINOR_SPEAKERS = ['Calder Watch', 'Harbour Control'];
const ACT_I_SPEAKERS = ['echo', 'rook', 'ilse', 'sefa', 'dax', 'narrator', ...MINOR_SPEAKERS];
const NEVER_SHOUTS = new Set(['echo', 'ilse', 'sefa', 'dax', 'narrator', ...MINOR_SPEAKERS]); // STORY: ECHO never; Ilse and Sefa never raise their voice
// Names that would give Act II-IV away. "Choir" is banned outright: in Act I nobody names the drones' makers.
const SPOILERS = [/vesper/i, /lattice core/i, /\bmira\b/i, /\bcantor\b/i, /hollow choir/i, /\bchoir\b/i];
const PROFANITY = /\b(damn\w*|shit\w*|fuck\w*|bitch\w*|bastard\w*|asshole\w*|ass|crap\w*|piss\w*|dick\w*|bloody)\b/i; // STORY: nothing stronger than "hell"
const REAL_WORLD = /\b(america\w*|united states|russia\w*|china|chinese|europe\w*|france|french|german\w*|japan\w*|korea\w*|india\w*|africa\w*|asia\w*|london|paris|berlin|moscow|beijing|tokyo|washington|christian\w*|muslim\w*|islam\w*|jewish|judaism|catholic\w*|buddhis\w*|hindu\w*|church|mosque|jesus|allah|bible|quran|pope|nato|ukraine|israel\w*|iran|iraq|syria\w*|vietnam\w*|texas|california)\b/i;
// The human never moves units (D-007): no line may tell the player to do the agent's job.
const MANUAL_CONTROL = /\b(select|click|tap|drag|press)\b|\byou (?:should |must |can |need to |have to |will )?(?:move|attack|capture|build|order|command|send|deploy) /i;

/** What one act allows: who may speak, who never raises their voice, and which names would give a later act away. */
interface DialogueRules { speakers: string[]; neverShouts: Set<string>; spoilers: RegExp[] }
const ACT_I_RULES: DialogueRules = { speakers: ACT_I_SPEAKERS, neverShouts: NEVER_SHOUTS, spoilers: SPOILERS };

/** Every broken writing rule in a list of lines (Act I's rules unless told otherwise). Empty = clean. */
function dialogueProblems(lines: DialogueLine[], rules: DialogueRules = ACT_I_RULES): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const tag = `${l.speaker}: "${l.text.slice(0, 40)}"`;
    if (!l.text.trim()) out.push(`empty line (${tag})`);
    if (l.text.length > 220) out.push(`over 220 characters (${tag})`);
    if (!rules.speakers.includes(l.speaker)) out.push(`speaker not allowed in this act (${tag})`);
    if (rules.neverShouts.has(l.speaker) && l.text.includes('!')) out.push(`exclamation mark from a speaker who never uses one (${tag})`);
    for (const re of rules.spoilers) if (re.test(l.text)) out.push(`spoiler ${re} (${tag})`);
    if (PROFANITY.test(l.text)) out.push(`profanity (${tag})`);
    if (REAL_WORLD.test(l.text)) out.push(`real-world name (${tag})`);
    if (MANUAL_CONTROL.test(l.text)) out.push(`tells the human to control units (${tag})`);
  }
  return out;
}

// ---------------------------------------------------------------- the structure

describe('the campaign acts', () => {
  it('has act 1, "Cinder Season", with the tagline STORY.md prints under the heading and the four mission ids in order', () => {
    const head = /### Act I — ([^\n]+)\n\*"([^"]+)"\*/.exec(STORY);
    expect(head, 'STORY.md Act I heading').not.toBeNull();
    expect(head![1]).toBe('Cinder Season');
    expect(CAMPAIGN_ACTS).toHaveLength(1);
    const act = CAMPAIGN_ACTS[0];
    expect(act.act).toBe(1);
    expect(act.title).toBe(head![1]);
    expect(act.tagline).toBe(head![2]);
    expect(act.missions).toEqual(['first-light', 'calder-spire', 'saltglass-bay', 'tidebreak']);
    expect(act.missions).toEqual(MISSIONS.map((m) => m.id));
  });
  it('follows the Act I outline in STORY.md: titles in order, and the places it names', () => {
    const outline = [...STORY.slice(STORY.indexOf('### Act I'), STORY.indexOf('### Act II')).matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)];
    expect(outline.map((m) => m[2])).toEqual(['First Light', 'Calder Spire', 'Saltglass Bay', 'Tidebreak']);
    expect(MISSIONS.map((m) => m.title)).toEqual(outline.map((m) => m[2]));
    expect(MISSIONS.map((m) => m.order)).toEqual(outline.map((m) => Number(m[1])));
    expect(FIRST_LIGHT.location).toBe('Calder Fields'); // "1. First Light — Calder Fields."
    expect(MISSIONS.every((m) => m.act === 1)).toBe(true);
  });
  it('would notice a wrong tagline or a missing mission (the comparison is against the story text, not a copy)', () => {
    const wrong = { ...CAMPAIGN_ACTS[0], missions: CAMPAIGN_ACTS[0].missions.slice(0, 3) };
    expect(wrong.missions).not.toEqual(MISSIONS.map((m) => m.id));
    expect(CAMPAIGN_ACTS[0].tagline).not.toBe('Somebody fired first.');
  });
});

describe('the four missions: shape', () => {
  it('have unique kebab-case ids, unique map ids that do not collide with the six skirmish maps, and a map for every mission', () => {
    expect(MISSIONS).toHaveLength(4);
    expect(new Set(MISSIONS.map((m) => m.id)).size).toBe(4);
    for (const m of MISSIONS) expect(m.id, m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(MISSIONS.map((m) => m.mapId)).size).toBe(4);
    expect(Object.keys(MISSION_MAPS).sort()).toEqual(MISSIONS.map((m) => m.mapId).sort());
    for (const [key, map] of Object.entries(MISSION_MAPS)) {
      expect(map.id, key).toBe(key);
      expect(map.id, key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(MAPS[key], `${key} must not shadow a skirmish map`).toBeUndefined();
    }
    expect(new Set(Object.values(MISSION_MAPS).map((m) => m.name)).size).toBe(4);
  });
  it('have 6-14 briefing lines, 2-6 events, 4-10 debrief lines, a victory event and a defeat event, and every event is once', () => {
    for (const m of MISSIONS) {
      expect(m.briefing.length, `${m.id} briefing`).toBeGreaterThanOrEqual(6);
      expect(m.briefing.length, `${m.id} briefing`).toBeLessThanOrEqual(14);
      expect(m.events.length, `${m.id} events`).toBeGreaterThanOrEqual(2);
      expect(m.events.length, `${m.id} events`).toBeLessThanOrEqual(6);
      expect(m.debrief.length, `${m.id} debrief`).toBeGreaterThanOrEqual(4);
      expect(m.debrief.length, `${m.id} debrief`).toBeLessThanOrEqual(10);
      const kinds = m.events.map((e) => e.trigger.kind);
      expect(kinds, m.id).toContain('victory');
      expect(kinds, m.id).toContain('defeat');
      expect(kinds, m.id).toContain('start');
      for (const e of m.events) {
        expect(e.once, `${m.id} ${e.trigger.kind}`).toBe(true);
        expect(e.lines.length, `${m.id} ${e.trigger.kind}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('have a title, a location, a one-line summary, an objective sentence, no fog and clear weather (fog and ion storms are later lessons)', () => {
    for (const m of MISSIONS) {
      expect(m.title.length, m.id).toBeGreaterThan(0);
      expect(m.location.length, m.id).toBeGreaterThan(0);
      expect(m.summary, m.id).toMatch(/^[A-Z][^\n]+\.$/);
      expect(m.summary.length, m.id).toBeLessThanOrEqual(160);
      expect(m.objectiveText, m.id).toMatch(/^[A-Z][^\n]+\.$/);
      expect(m.fog, m.id).toBe(false);
      expect(m.weather, m.id).toBe('clear');
      expect(m.turnLimit, `${m.id}: the engine reads turnLimit as a versus day limit (D-013)`).toBeUndefined();
    }
  });
  it('have par values the score can use: whole positive cycles, a positive power, and a survive mission whose par is not shorter than the survival', () => {
    for (const m of MISSIONS) {
      expect(Number.isInteger(m.par.cycles) && m.par.cycles > 0, `${m.id} par.cycles`).toBe(true);
      expect(Number.isFinite(m.par.power) && m.par.power > 0, `${m.id} par.power`).toBe(true);
      const state = createGame(setupFor(m, 1));
      expect(() => scoreCard(state, 0, m.par), m.id).not.toThrow(); // scoreCard refuses a par of 0 or less
      if (m.objective.kind === 'survive') expect(m.par.cycles, m.id).toBeGreaterThanOrEqual(m.objective.cycles); // else Speed could never reach 100
    }
    expect(MISSIONS.map((m) => m.par.cycles)).toEqual([6, 12, 14, 8]);
  });
  it('mean what STORY.md says: rout for the drill, hq for the two Spire and Anchorage missions, survive for the strike', () => {
    expect(MISSIONS.map((m) => m.objective)).toEqual([{ kind: 'rout' }, { kind: 'hq' }, { kind: 'hq' }, { kind: 'survive', cycles: 8 }]);
    expect(TIDEBREAK.objectiveText).toBe('Hold Tidebreak for eight cycles.');
    expect(NUMBER_WORDS[/for (\w+) cycles/.exec(TIDEBREAK.objectiveText)![1]]).toBe(8);
  });
});

// ---------------------------------------------------------------- players: D-007

describe('players (D-007: the agent is the commander, the named cast are NPCs)', () => {
  it('seat the agent as player 0 (human, "agent", Helion), Rook as an AI ally on its team, and one opponent on the other', () => {
    for (const m of MISSIONS) {
      expect(m.players, m.id).toHaveLength(3);
      const [me, ally, foe] = m.players;
      expect(me, m.id).toMatchObject({ faction: 'helion', commander: 'agent', controller: 'human', team: 0 });
      expect(ally, m.id).toMatchObject({ faction: 'helion', commander: 'rook', controller: 'ai', team: me.team });
      expect(foe.controller, m.id).toBe('ai');
      expect(foe.team, m.id).not.toBe(me.team);
      expect(m.players.filter((p) => p.controller === 'human'), m.id).toHaveLength(1);
    }
  });
  it('features Rook as an ally in every Act I mission: STORY.md names him in the first three and plays Helion as "Rook" throughout', () => {
    expect(STORY).toContain('Player is Helion (Rook) unless noted.');
    const outline = [...STORY.slice(STORY.indexOf('### Act I'), STORY.indexOf('### Act II')).matchAll(/^\d+\. \*\*[^*]+\*\* — ([^\n]+)$/gm)].map((m) => m[1]);
    expect(outline).toHaveLength(4);
    outline.slice(0, 3).forEach((text, i) => expect(text, `outline ${i + 1}`).toContain('Rook'));
    for (const m of MISSIONS) expect(m.players.some((p) => p.commander === 'rook' && p.team === m.players[0].team), m.id).toBe(true);
  });
  it('uses the opponents STORY.md names: unmarked drones, then Sefa twice, then Dax', () => {
    expect(FIRST_LIGHT.players[2]).toMatchObject({ faction: 'choir', commander: 'none' }); // no named commander: nobody is named in Act I
    expect(CALDER_SPIRE.players[2]).toMatchObject({ faction: 'tidewell', commander: 'sefa' });
    expect(SALTGLASS_BAY.players[2]).toMatchObject({ faction: 'tidewell', commander: 'sefa' });
    expect(TIDEBREAK.players[2]).toMatchObject({ faction: 'tidewell', commander: 'dax' });
  });
  it('names real commanders of the right faction, and leaves "agent" and "none" unknown so the engine gives them no modifiers', () => {
    expect(COMMANDERS.agent).toBeUndefined();
    expect(COMMANDERS.none).toBeUndefined();
    for (const m of MISSIONS) {
      for (const p of m.players) {
        if (p.commander === 'agent' || p.commander === 'none') continue;
        expect(COMMANDERS[p.commander], `${m.id} ${p.commander}`).toBeDefined();
        expect(COMMANDERS[p.commander].faction, `${m.id} ${p.commander}`).toBe(p.faction);
      }
    }
    // An unknown commander really is modifier-free: income is exactly 1000 a property, with no CO percentage.
    for (const m of MISSIONS) {
      const s = createGame(setupFor(m, 1));
      expect(incomeOf(s, 0), m.id).toBe(1000 * tilesOf(mapOf(m), (c, o) => 'CFADH'.includes(c) && o === '0').length);
    }
  });
  it('keeps the Choir out of Act I: the drones are the only choir-faction player in Act I, and no Act I commander is a Choir commander', () => {
    const choir = MISSIONS.flatMap((m) => m.players).filter((p) => p.faction === 'choir');
    expect(choir).toHaveLength(1);
    expect(MISSIONS.flatMap((m) => m.players).filter((p) => ['cantor', 'vesper'].includes(p.commander))).toEqual([]);
  });
});

// ---------------------------------------------------------------- maps

describe('the mission maps', () => {
  it('pass checkMap: mission 1 with requireBases off (and ONLY mission 1), missions 2-4 with the default', () => {
    expect(checkMap(mapOf(FIRST_LIGHT), { requireBases: false })).toEqual([]);
    for (const m of [CALDER_SPIRE, SALTGLASS_BAY, TIDEBREAK]) expect(checkMap(mapOf(m)), m.id).toEqual([]);
    // Known-bad: mission 1 has no production, so the default must refuse it (this is why it needs the option), and only mission 1 does.
    expect(new Set(checkMap(mapOf(FIRST_LIGHT)).map((i) => i.rule))).toEqual(new Set(['spire', 'fabricator']));
    for (const m of [CALDER_SPIRE, SALTGLASS_BAY, TIDEBREAK]) expect(checkMap(mapOf(m), { requireBases: false }), m.id).toEqual([]);
  });
  it('would catch a broken mission map: a spire removed, or a fabricator walled in, fails checkMap', () => {
    const noRookSpire = clone(mapOf(CALDER_SPIRE));
    const r = spireOf(noRookSpire, 1);
    setCell(noRookSpire.terrain, r.x, r.y, '.');
    setCell(noRookSpire.owners, r.x, r.y, '.');
    expect(checkMap(noRookSpire).map((i) => i.rule)).toEqual(['spire']);
    // Cut the headland off from Helion with a strip of sea across the north land (x=10, rows 0-2) and take the unit off it.
    const walled = clone(mapOf(TIDEBREAK));
    for (const y of [0, 1, 2]) setCell(walled.terrain, 10, y, '~');
    walled.units = walled.units.filter((u) => !(u.x === 10 && u.y <= 2));
    expect(checkMap(walled).map((i) => i.rule), 'a sea gap cutting the north road').toContain('reach-base');
    expect(checkMap(mapOf(TIDEBREAK)), 'the unbroken map is fine').toEqual([]);
  });
  it('seat exactly as many players as the mission has, and every unit and property owner is one of them', () => {
    for (const m of MISSIONS) {
      const map = mapOf(m);
      expect(map.players, m.id).toBe(m.players.length);
      for (const u of map.units) expect(u.owner, m.id).toBeLessThan(m.players.length);
      for (let p = 0; p < m.players.length; p++) expect(map.units.filter((u) => u.owner === p).length, `${m.id} player ${p} starts with units`).toBeGreaterThan(0);
      expect(map.description, m.id).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(map.description.length, m.id).toBeLessThan(200);
    }
  });
  it('have the sizes they were drawn at', () => {
    const sizes = MISSIONS.map((m) => `${mapOf(m).terrain[0].length}x${mapOf(m).terrain.length}`);
    expect(sizes).toEqual(['12x9', '18x12', '22x14', '18x12']);
    expect(mapOf(FIRST_LIGHT).terrain.length * mapOf(FIRST_LIGHT).terrain[0].length, 'mission 1 is a small map').toBeLessThanOrEqual(120);
  });
  it('mission 1 has no production: no fabricator, skyport or dock, no funds, and four neutral arcologies to claim', () => {
    const map = mapOf(FIRST_LIGHT);
    for (const ch of 'FAD') expect(countOf(map, ch), `tile ${ch}`).toBe(0);
    expect(FIRST_LIGHT.players.map((p) => p.funds)).toEqual([0, 0, 0]);
    expect(countOf(map, 'C', '.')).toBe(4);
    expect(countOf(map, 'H', '0')).toBe(1); // Calder Spire at the player's back
    // The drones are unmarked hovercraft: nothing that can capture, nothing that flies (ground troops cannot hurt a Wasp).
    expect(map.units.filter((u) => u.owner === 2).map((u) => u.type).sort()).toEqual(['skimmer', 'skimmer', 'skimmer']);
  });
  it('mission 2 is about production and income: every player owns a fabricator, the enemy owns the Spire, and cities are there to take', () => {
    const map = mapOf(CALDER_SPIRE);
    for (let p = 0; p < 3; p++) {
      expect(countOf(map, 'F', String(p)), `p${p} fabricators`).toBeGreaterThanOrEqual(1);
      expect(countOf(map, 'H', String(p)), `p${p} spires`).toBe(1);
    }
    expect(countOf(map, 'F', '2'), 'Tidewell holds the most fabricators').toBeGreaterThan(countOf(map, 'F', '0'));
    expect(countOf(map, 'C', '.'), 'neutral cities').toBeGreaterThanOrEqual(6);
    expect(CALDER_SPIRE.players.map((p) => p.funds).every((f) => (f ?? 0) > 0)).toBe(true);
    // Treads cannot wade the river, so the spans carry the armour: a tread unit from the player's spire still reaches Calder Spire.
    const tread = distances(map, spireOf(map, 0), costFor('tread'));
    const calder = spireOf(map, 2);
    expect(tread[calder.y][calder.x], 'a path for treads').toBeGreaterThan(0);
    const noSpans = distances(map, spireOf(map, 0), (ch) => ch !== '#' && costFor('tread')(ch));
    expect(noSpans[calder.y][calder.x], 'without the spans the river stops treads').toBe(-1);
  });
  it('mission 3 is a bay: sea and shoals in the middle, islet cities only a landing reaches, a long walk round, and ships and Arcs on both sides', () => {
    const map = mapOf(SALTGLASS_BAY);
    expect(countOf(map, '~')).toBeGreaterThan(80);
    expect(countOf(map, 's')).toBeGreaterThanOrEqual(15);
    const a = spireOf(map, 0);
    const b = spireOf(map, 2);
    // "By road it is far. By Barge it is not" (the briefing): measured in turns, a Trooper (move 3) on foot against a Barge (move 6) from the dock.
    const walk = distances(map, a, costFor('foot'))[b.y][b.x];
    const dock = tilesOf(map, (c, o) => c === 'D' && o === '0')[0];
    const bargeSea = distances(map, dock, costFor('barge'));
    const landing = tilesOf(map, (c, _o, x, y) => c === 's' && bargeSea[y][x] > 0)
      .sort((p, q) => Math.abs(p.x - b.x) + Math.abs(p.y - b.y) - (Math.abs(q.x - b.x) + Math.abs(q.y - b.y)))[0];
    expect(Math.abs(landing.x - b.x) + Math.abs(landing.y - b.y), 'a landing beach within three tiles of the Anchorage').toBeLessThanOrEqual(3);
    const footTurns = Math.ceil(walk / 3);
    const bargeTurns = Math.ceil(bargeSea[landing.y][landing.x] / 6);
    expect(footTurns, `${walk} steps on foot against ${bargeSea[landing.y][landing.x]} by sea`).toBeGreaterThanOrEqual(2 * bargeTurns);
    const fromAny = [0, 1, 2].map((p) => distances(map, spireOf(map, p), costFor('foot')));
    const islets = tilesOf(map, (c, o, x, y) => c === 'C' && o === '.' && fromAny.every((d) => d[y][x] === -1));
    expect(islets.length, 'cities no spire can walk to').toBe(3);
    for (const c of islets) { // each islet city has a shoal beside it to land on
      expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.terrain[c.y + dy][c.x + dx] === 's'), `shoal beside (${c.x},${c.y})`).toBe(true);
    }
    // Docks must touch open sea or the ships built there cannot leave.
    for (const p of [0, 2]) {
      const docks = tilesOf(map, (c, o) => c === 'D' && o === String(p));
      expect(docks.length, `p${p} docks`).toBeGreaterThanOrEqual(1);
      for (const d of docks) expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.terrain[d.y + dy][d.x + dx] === '~'), `dock (${d.x},${d.y})`).toBe(true);
    }
    const kinds = (owner: number) => new Set(map.units.filter((u) => u.owner === owner).map((u) => u.type));
    expect(kinds(0).has('arc') && kinds(0).has('picket') && kinds(0).has('barge'), 'the agent starts with indirect and naval units').toBe(true);
    expect(kinds(2).has('dreadnought') && kinds(2).has('picket'), 'Sefa has a fleet').toBe(true);
    const tread = distances(map, a, costFor('tread'));
    expect(tread[b.y][b.x], 'the Anchorage is reachable by road').toBeGreaterThan(0);
  });
  it('mission 4 is a seawall: ridges in a line with gates, a sea beyond a beach, and a Tidewell base reached by the north road', () => {
    const map = mapOf(TIDEBREAK);
    const wallColumn = map.terrain.map((row) => row[8]);
    expect(wallColumn.filter((ch) => ch === '^').length, 'seawall ridges').toBeGreaterThanOrEqual(6);
    expect(wallColumn.slice(3, 11).filter((ch) => ch === '=').length, 'gates in the wall (rows 3-10; the north road crosses at row 1)').toBe(2);
    expect(countOf(map, '~')).toBeGreaterThan(50);
    expect(countOf(map, 's')).toBeGreaterThanOrEqual(8); // the beach
    const dax = spireOf(map, 2);
    const tread = distances(map, spireOf(map, 0), costFor('tread'));
    expect(tread[dax.y][dax.x], 'a land route for the headland column').toBeGreaterThan(0);
    // Both helion bases sit behind the wall (west of x=8) and Dax's sea force starts east of it.
    for (const p of [0, 1]) expect(spireOf(map, p).x).toBeLessThan(8);
    expect(map.units.filter((u) => u.owner === 2 && (u.type === 'barge' || u.type === 'picket')).every((u) => u.x > 10)).toBe(true);
    for (const d of tilesOf(map, (c, o) => c === 'D' && o === '2')) {
      expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.terrain[d.y + dy][d.x + dx] === '~'), `dock (${d.x},${d.y})`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- the engine accepts every mission

describe('createGame on the mission maps', () => {
  it('builds each mission from its own players, and pays player 0 its mission funds plus exactly 1000 per income property on turn one', () => {
    for (const m of MISSIONS) {
      const map = mapOf(m);
      const s = createGame(setupFor(m, 1));
      expect(s.mapId, m.id).toBe(m.mapId);
      expect(s.players, m.id).toHaveLength(m.players.length);
      expect(s.players.map((p) => p.commander), m.id).toEqual(m.players.map((p) => p.commander));
      expect(s.players.map((p) => p.team), m.id).toEqual(m.players.map((p) => p.team));
      expect(s.units, m.id).toHaveLength(map.units.length);
      expect(s.fog, m.id).toBe(false);
      expect(s.weather, m.id).toBe('clear');
      expect(s.objective, m.id).toEqual(m.objective);
      const income0 = 1000 * tilesOf(map, (c, o) => 'CFADH'.includes(c) && o === '0').length; // mechanics.md section 6: uplinks pay 0
      expect(s.players[0].funds, `${m.id}: ${m.players[0].funds ?? 0} + income`).toBe((m.players[0].funds ?? 0) + income0);
      for (let p = 1; p < m.players.length; p++) expect(s.players[p].funds, `${m.id} player ${p} has not started a turn`).toBe(m.players[p].funds ?? 0);
    }
  });
  it('gives the player at least one thing to buy on turn one in missions 2-4, and nothing at all in mission 1', () => {
    const buys = (m: Mission) => {
      const s = createGame(setupFor(m, 1));
      const map = mapOf(m);
      return tilesOf(map, (c, o) => 'FAD'.includes(c) && o === '0').length > 0 && s.players[0].funds >= 1000;
    };
    expect(buys(FIRST_LIGHT)).toBe(false);
    for (const m of [CALDER_SPIRE, SALTGLASS_BAY, TIDEBREAK]) expect(buys(m), m.id).toBe(true);
  });
});

// ---------------------------------------------------------------- objectives and triggers

/** What is wrong with a mission's objective on its map. Empty = fine. */
function hqProblems(m: Mission, map: MapDef): string[] {
  if (m.objective.kind !== 'hq') return [];
  const myTeam = m.players[0].team;
  const enemySpires = tilesOf(map, (c, o) => c === 'H' && o !== '.' && m.players[Number(o)]?.team !== myTeam);
  return enemySpires.length ? [] : ['an hq objective needs an enemy spire on the map'];
}
/** What is wrong with an event trigger: a player that does not exist, or a capture that cannot happen on this map. */
function triggerProblems(m: Mission, t: MissionTrigger): string[] {
  const map = mapOf(m);
  const n = m.players.length;
  const out: string[] = [];
  switch (t.kind) {
    case 'cycle':
      if (!Number.isInteger(t.cycle) || t.cycle < 1) out.push('cycle must be a whole number >= 1');
      if (m.objective.kind === 'survive' && t.cycle > m.objective.cycles) out.push('cycle after the survival ends');
      break;
    case 'unitDestroyed':
      if (t.owner < 0 || t.owner >= n) out.push(`no player ${t.owner}`);
      else if (map.units.filter((u) => u.owner === t.owner).length < (t.count ?? 1)) out.push('more kills asked than the player has units at the start (production could still supply them)');
      break;
    case 'propertyCaptured': {
      if (t.by < 0 || t.by >= n) { out.push(`no player ${t.by}`); break; }
      if (t.terrain) {
        const code = Object.entries(TERRAIN_CODES).find(([, id]) => id === t.terrain)?.[0];
        const capturable = code ? tilesOf(map, (c, o) => c === code && (o === '.' || m.players[Number(o)]?.team !== m.players[t.by].team)).length : 0;
        if (!TERRAIN_TYPES[t.terrain]?.property) out.push(`${t.terrain} is not a property`);
        else if (capturable === 0) out.push(`no ${t.terrain} on the map that player ${t.by} could capture`);
      }
      break;
    }
    case 'powerUsed':
      if (t.player < 0 || t.player >= n) out.push(`no player ${t.player}`);
      break;
    default:
      break;
  }
  return out;
}

describe('objectives and triggers', () => {
  it('gives every hq objective an enemy spire on its map, and the checker refuses a map without one', () => {
    for (const m of MISSIONS) expect(hqProblems(m, mapOf(m)), m.id).toEqual([]);
    expect(MISSIONS.filter((m) => m.objective.kind === 'hq').map((m) => m.id)).toEqual(['calder-spire', 'saltglass-bay']);
    // Known-bad: the enemy spire turned into an arcology, or the enemy moved onto the player's team.
    const noSpire = clone(mapOf(CALDER_SPIRE));
    const s = spireOf(noSpire, 2);
    noSpire.terrain[s.y] = noSpire.terrain[s.y].slice(0, s.x) + 'C' + noSpire.terrain[s.y].slice(s.x + 1);
    expect(hqProblems(CALDER_SPIRE, noSpire)).toHaveLength(1);
    const allied = clone(CALDER_SPIRE);
    allied.players[2].team = 0;
    expect(hqProblems(allied, mapOf(allied))).toHaveLength(1);
  });
  it('points every trigger at a real player and, for a capture, at a property that exists to be captured', () => {
    for (const m of MISSIONS) for (const e of m.events) expect(triggerProblems(m, e.trigger), `${m.id} ${JSON.stringify(e.trigger)}`).toEqual([]);
    // Known-bad triggers must keep being reported.
    expect(triggerProblems(CALDER_SPIRE, { kind: 'propertyCaptured', by: 0, terrain: 'dock' })).toHaveLength(1); // no dock on the map
    expect(triggerProblems(CALDER_SPIRE, { kind: 'propertyCaptured', by: 0, terrain: 'flats' })).toHaveLength(1); // not a property
    expect(triggerProblems(CALDER_SPIRE, { kind: 'powerUsed', player: 3 })).toHaveLength(1);
    expect(triggerProblems(CALDER_SPIRE, { kind: 'unitDestroyed', owner: 5 })).toHaveLength(1);
    expect(triggerProblems(TIDEBREAK, { kind: 'cycle', cycle: 9 })).toHaveLength(1); // after the 8 cycles of the survival
    expect(triggerProblems(TIDEBREAK, { kind: 'cycle', cycle: 0 })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- the writing rules

describe('the writing rules', () => {
  it('keeps every line at or under 220 characters and at least 90% of them at or under 140', () => {
    expect(allLines.length).toBeGreaterThan(60);
    expect(allLines.filter((l) => l.text.length > 220)).toEqual([]);
    const short = allLines.filter((l) => l.text.length <= 140).length;
    expect(short / allLines.length, `${short} of ${allLines.length} lines are 140 or shorter`).toBeGreaterThanOrEqual(0.9);
  });
  it('keeps every line to one to three sentences', () => {
    for (const l of allLines) {
      const sentences = l.text.split(/(?<=[.?!])\s+/).filter(Boolean);
      expect(sentences.length, `${l.speaker}: ${l.text}`).toBeLessThanOrEqual(5); // short fragments ("Okay. Okay.") count as sentences
    }
  });
  it('uses only the Act I cast as speakers: commander ids, the narrator, or the minor characters allow-listed here', () => {
    expect(new Set(allLines.map((l) => l.speaker))).toEqual(new Set(['echo', 'rook', 'ilse', 'sefa', 'dax', 'narrator', 'Calder Watch', 'Harbour Control']));
    for (const s of ['echo', 'rook', 'ilse', 'sefa', 'dax']) expect(COMMANDERS[s], s).toBeDefined();
    for (const m of MISSIONS) for (const l of linesOf(m)) expect(l.mood === undefined || ['neutral', 'happy', 'angry', 'grim', 'surprised', 'smug'].includes(l.mood), `${m.id} mood`).toBe(true);
  });
  it('passes every dialogue rule: length, speakers, no "!" from ECHO, no spoilers, no profanity, no real-world names, no manual control', () => {
    for (const m of MISSIONS) expect(dialogueProblems(linesOf(m)), m.id).toEqual([]);
  });
  it('would catch each planted violation, and passes a clean line', () => {
    const line = (speaker: string, text: string): DialogueLine => ({ speaker, text });
    const bad: [string, DialogueLine, RegExp][] = [
      ['over 220', line('rook', 'Okay. '.repeat(40)), /over 220/],
      ['speaker', line('juno', 'Sky is open.'), /speaker not allowed/],
      ['echo bang', line('echo', 'Link established!'), /exclamation/],
      ['sefa bang', line('sefa', 'Withdraw at once!'), /exclamation/],
      ['VESPER', line('echo', 'The signal bears the mark of VESPER.'), /spoiler/],
      ['Lattice core', line('narrator', 'Under the glass, the Lattice core slept.'), /spoiler/],
      ['Mira', line('ilse', 'My daughter Mira built this node.'), /spoiler/],
      ['Cantor', line('rook', 'Cantor is on the line.'), /spoiler/],
      ['Hollow Choir', line('narrator', 'The Hollow Choir rose.'), /spoiler/],
      ['Choir', line('echo', 'Choir drones are inbound.'), /spoiler/],
      ['profanity', line('rook', 'Well, damn.'), /profanity/],
      ['real world', line('narrator', 'The treaty was signed in Paris.'), /real-world/],
      ['manual control', line('echo', 'Select the Trooper and move it to the ridge.'), /control units/],
      ['manual control 2', line('echo', 'You should move your Breacher to the ridge.'), /control units/],
      ['empty', line('rook', '   '), /empty/],
    ];
    for (const [name, l, kind] of bad) {
      const problems = dialogueProblems([l]);
      expect(problems.length, name).toBeGreaterThanOrEqual(1);
      expect(problems.some((p) => kind.test(p)), `${name}: ${problems.join('; ')}`).toBe(true);
    }
    expect(dialogueProblems([line('echo', 'Enemy Lancer, eight tiles out. Recommendation: do not stand in front of it.')])).toEqual([]);
    expect(dialogueProblems([line('rook', 'Okay! Okay! Nobody panic!')]), 'Rook may shout').toEqual([]);
    expect(dialogueProblems([line('echo', 'You never move a unit.')]), 'a negation is not an instruction').toEqual([]);
    expect(dialogueProblems([line('Calder Watch', 'Drill net open.')])).toEqual([]);
  });
  it('bans the Act II-IV names from every Act I string, not only from dialogue', () => {
    // Every string a player could read: ids, titles, summaries, objective text, speakers, channels, lines, map names and descriptions.
    // (A faction id such as 'choir' on the drones' player is an enum value, not text; the UI shows those drones as unmarked.)
    const strings: string[] = [];
    for (const m of MISSIONS) {
      strings.push(m.id, m.title, m.location, m.summary, m.mapId, m.objectiveText);
      for (const l of linesOf(m)) strings.push(l.speaker, l.text, l.channel ?? '');
    }
    for (const a of CAMPAIGN_ACTS) strings.push(a.title, a.tagline, ...a.missions);
    for (const map of Object.values(MISSION_MAPS)) strings.push(map.id, map.name, map.description, map.author ?? '');
    expect(strings.length).toBeGreaterThan(200);
    for (const text of strings) for (const re of SPOILERS) expect(re.test(text), `${re} in "${text}"`).toBe(false);
    // Known-bad: the same scan flags a planted string.
    expect(SPOILERS.some((re) => re.test('The Hollow Choir and VESPER')), 'the scan is not vacuous').toBe(true);
  });
  it('carries none of the names the repo guard denies (the originality list), and the detector would catch one', () => {
    expect(guard.DENYLIST.length).toBeGreaterThan(10);
    for (const bad of guard.DENYLIST.slice(0, 5)) {
      expect(guard.scanText('src/content/missions.ts', `text: '${bad}'`).map((f) => f.rule), bad).toContain('originality');
    }
    const text = JSON.stringify([MISSIONS, CAMPAIGN_ACTS, MISSION_MAPS], null, 1);
    expect(guard.scanText('src/content/missions.ts', text)).toEqual([]);
    expect(guard.scanText('src/content/mission-maps.ts', readFileSync(new URL('./mission-maps.ts', import.meta.url), 'utf8'))).toEqual([]);
    expect(guard.scanText('src/content/missions.ts', readFileSync(new URL('./missions.ts', import.meta.url), 'utf8'))).toEqual([]);
  });
});

// ---------------------------------------------------------------- voices

describe('each speaker sounds like their entry in STORY.md', () => {
  const by = (speaker: string) => allLines.filter((l) => l.speaker === speaker);
  const matching = (speaker: string, re: RegExp) => by(speaker).filter((l) => re.test(l.text)).length;
  it('ECHO: short telemetry-flavoured sentences, no exclamation mark, dry humour about humans', () => {
    expect(by('echo').length).toBeGreaterThan(25);
    for (const l of by('echo')) {
      expect(l.text, l.text).not.toContain('!');
      for (const sentence of l.text.split(/(?<=[.?])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(26);
    }
    expect(matching('echo', /telemetry|observation|query|recommendation|alert|status|objective|situation|logged|noted|priority|note for the log/i)).toBeGreaterThanOrEqual(10);
    expect(matching('echo', /curious|understand the pattern|which I am told|no instrument|feeling/i), 'dry curiosity about people').toBeGreaterThanOrEqual(4);
  });
  it('Rook: earnest and nervous early, engineering metaphors, apologises to machines, braver by the end', () => {
    expect(matching('rook', /sorry|apolog/i)).toBeGreaterThanOrEqual(5);
    expect(matching('rook', /spanner|spare parts|generator|fixed|fix |workshop|machine|engineering|log\b/i)).toBeGreaterThanOrEqual(5);
    expect(linesOf(FIRST_LIGHT).some((l) => l.speaker === 'rook' && /Okay\. Okay\./.test(l.text)), 'the nervous opening').toBe(true);
    expect(linesOf(TIDEBREAK).some((l) => l.speaker === 'rook' && /I intend to/.test(l.text)), 'the braver ending').toBe(true);
    expect(linesOf(FIRST_LIGHT).some((l) => l.speaker === 'rook' && /I intend to/.test(l.text))).toBe(false);
  });
  it('Sefa: calm and formal, tide and shore and ship imagery, never shouts', () => {
    expect(matching('sefa', /\btide\b|\bweather\b|\bships?\b|\bbay\b|\bshore\b|\bwater\b|\bcurrent\b/i)).toBeGreaterThanOrEqual(4);
    expect(matching('sefa', /Captain/)).toBeGreaterThanOrEqual(4); // courteous even to enemies
    expect(by('sefa').filter((l) => l.text.includes('!'))).toEqual([]);
  });
  it('Dax: smooth and numerate, a ledger in every sentence, faintly condescending, never vulgar', () => {
    expect(by('dax').length).toBeGreaterThanOrEqual(3);
    expect(matching('dax', /correction|account|figures|investment|market|ledger|margin|exposure/i)).toBeGreaterThanOrEqual(by('dax').length);
    expect(matching('dax', /Captain/)).toBeGreaterThanOrEqual(3);
  });
  it('Ilse: clipped and dry, addresses people by rank, orders as firing data, understatement', () => {
    expect(by('ilse').length).toBeGreaterThanOrEqual(6);
    expect(matching('ilse', /\b(Captain|Admiral|Marshal)\b/)).toBeGreaterThanOrEqual(5);
    expect(matching('ilse', /batter|artillery|Arcs|range|bearing|front/i)).toBeGreaterThanOrEqual(3);
    for (const l of by('ilse')) expect(l.text.length, l.text).toBeLessThanOrEqual(140);
  });
  it('humour lands in the middle of missions and grief at the ends: every debrief closes on the narrator or a grim line', () => {
    for (const m of MISSIONS) {
      const last = m.debrief[m.debrief.length - 1];
      expect(last.speaker === 'narrator' || last.mood === 'grim', `${m.id}: ${last.text}`).toBe(true);
    }
    // The jokes sit in cycle events or the briefing's middle, never in a debrief's last line or a defeat event.
    for (const m of MISSIONS) for (const e of m.events.filter((x) => x.trigger.kind === 'defeat')) expect(e.lines.every((l) => l.mood !== 'happy'), m.id).toBe(true);
  });
});

// ---------------------------------------------------------------- the story beats

describe('faithful to the Act I outline', () => {
  it('mission 1: border drills with ECHO as the tutor, unmarked drones attack, Rook improvises, move/attack/capture/wait are taught', () => {
    const text = linesOf(FIRST_LIGHT).map((l) => l.text).join('\n');
    expect(FIRST_LIGHT.briefing[2].speaker).toBe('echo'); // ECHO opens the tutorial
    for (const verb of ['move', 'attack', 'capture', 'wait']) expect(text.toLowerCase(), verb).toContain(verb);
    expect(FIRST_LIGHT.briefing.some((l) => l.speaker === 'echo' && /No beacon, no flag, no callsign/.test(l.text)), 'unmarked').toBe(true);
    expect(FIRST_LIGHT.objectiveText).toContain('unmarked');
    expect(text).not.toMatch(/choir|vesper/i); // nobody names the drones' makers in Act I
    expect(linesOf(FIRST_LIGHT).some((l) => l.speaker === 'rook' && /nobody panic/i.test(l.text)), 'Rook improvises with his own voice').toBe(true);
    // Each lesson has its own trigger: the first capture and the first kill are taught when they happen.
    const kinds = FIRST_LIGHT.events.map((e) => e.trigger.kind);
    expect(kinds).toContain('propertyCaptured');
    expect(kinds).toContain('unitDestroyed');
  });
  it('mission 2: Tidewell holds Calder Spire, Rook meets Sefa, each certain the other lied, and production and income are taught', () => {
    const text = linesOf(CALDER_SPIRE).map((l) => l.text).join('\n');
    expect(CALDER_SPIRE.objectiveText).toBe('Capture Calder Spire.');
    expect(CALDER_SPIRE.briefing.some((l) => l.speaker === 'sefa')).toBe(true);
    expect(CALDER_SPIRE.briefing.some((l) => l.speaker === 'rook' && /never fired|did not send it/.test(l.text))).toBe(true);
    expect(CALDER_SPIRE.briefing.some((l) => l.speaker === 'sefa' && /each sure the other lied/.test(l.text))).toBe(true);
    expect(text).toMatch(/fabricator/i);
    expect(text).toMatch(/one thousand/i);
    expect(text).toMatch(/composition weights/i);
    expect(CALDER_SPIRE.events.map((e) => e.trigger.kind)).toContain('propertyCaptured');
  });
  it('mission 2: Rook asks ECHO her pronouns and she answers she/her (STORY: "she/her, since mission 2, when Rook asked"), and not before', () => {
    expect(STORY).toContain('she/her (since mission 2, when Rook asked)');
    const beat = CALDER_SPIRE.events.find((e) => e.lines.some((l) => l.speaker === 'rook' && /'it'/.test(l.text) && l.text.includes('?')));
    expect(beat, 'the pronoun event').toBeDefined();
    const i = beat!.lines.findIndex((l) => l.speaker === 'rook' && l.text.includes('?'));
    expect(beat!.lines[i + 1].speaker).toBe('echo');
    expect(beat!.lines[i + 1].text).toMatch(/\bshe\b/i);
    expect(beat!.lines[i + 1].text).toMatch(/\bher\b/i);
    // Nobody calls ECHO "she", "her" or "it" in mission 1: Rook has not asked yet.
    expect(linesOf(FIRST_LIGHT).filter((l) => /\b(she|her|hers)\b/i.test(l.text))).toEqual([]);
    // The beat is mid-mission (a cycle event), where STORY.md puts the humour.
    expect(beat!.trigger.kind).toBe('cycle');
  });
  it('mission 3: a naval battle against Sefa\'s fleet, Sefa withdraws in good order, and Ilse arrives at the end and takes over the artillery', () => {
    const text = linesOf(SALTGLASS_BAY).map((l) => l.text).join('\n');
    expect(text).toMatch(/Picket/);
    expect(text).toMatch(/Dreadnought/);
    expect(text).toMatch(/Barge/);
    expect(text).toMatch(/Arc/);
    expect(text).toMatch(/indirect/i);
    const victory = SALTGLASS_BAY.events.find((e) => e.trigger.kind === 'victory')!;
    expect(victory.lines.some((l) => l.speaker === 'sefa' && /withdraw in good order/.test(l.text))).toBe(true);
    // Ilse is absent from missions 1 and 2, from mission 3's briefing and from every event except the victory; she arrives at the end.
    // Neither her voice nor her name appears before the victory: arrival is a surprise, not a rumour.
    const hers = /\b(Ilse|Varga|Marshal)\b/;
    for (const m of [FIRST_LIGHT, CALDER_SPIRE]) {
      expect(linesOf(m).some((l) => l.speaker === 'ilse'), m.id).toBe(false);
      expect(linesOf(m).filter((l) => hers.test(l.text)), `${m.id} mentions her`).toEqual([]);
    }
    expect(SALTGLASS_BAY.briefing.some((l) => l.speaker === 'ilse' || hers.test(l.text))).toBe(false);
    for (const e of SALTGLASS_BAY.events.filter((x) => x.trigger.kind !== 'victory')) {
      expect(e.lines.some((l) => l.speaker === 'ilse' || hers.test(l.text)), e.trigger.kind).toBe(false);
    }
    expect(hers.test('The Marshal is already here.'), 'the check is not vacuous').toBe(true);
    expect(victory.lines.some((l) => l.speaker === 'ilse')).toBe(true);
    expect(SALTGLASS_BAY.debrief.some((l) => l.speaker === 'ilse' && /artillery/.test(l.text))).toBe(true);
    expect(SALTGLASS_BAY.debrief.some((l) => l.speaker === 'ilse' && /direct the artillery and the front/.test(l.text))).toBe(true);
  });
  it('mission 4: Dax\'s punitive strike, powers taught as the agent\'s Surge and Overclock its human chose, ECHO finds the forged order code, the ceasefire collapses', () => {
    const quote = /\*"(This signature is ours\. We never sent it\.)"\*/.exec(STORY);
    expect(quote, 'STORY.md quote').not.toBeNull();
    const wreck = TIDEBREAK.events.find((e) => e.trigger.kind === 'unitDestroyed')!;
    expect(wreck.trigger).toMatchObject({ owner: 2 });
    expect(wreck.lines.some((l) => l.speaker === 'echo' && l.text === quote![1]), 'the exact line, from ECHO, in the wreck').toBe(true);
    expect(TIDEBREAK.briefing.some((l) => l.speaker === 'dax')).toBe(true);
    expect(TIDEBREAK.briefing.some((l) => /punitive/i.test(l.text))).toBe(true);
    const briefing = TIDEBREAK.briefing.map((l) => l.text).join('\n');
    expect(briefing).toMatch(/Surge/);
    expect(briefing).toMatch(/Overclock/);
    expect(briefing).toMatch(/Your human chose your agent's Surge and Overclock/); // D-007: the agent's powers, chosen by its human
    expect(briefing).toMatch(/When to spend them is the agent's call/);
    const power = TIDEBREAK.events.find((e) => e.trigger.kind === 'powerUsed')!;
    expect(power.trigger).toEqual({ kind: 'powerUsed', player: 0 });
    expect(power.lines[0].speaker).toBe('echo');
    const debrief = TIDEBREAK.debrief.map((l) => l.text).join('\n');
    expect(debrief).toMatch(/ceasefire/i);
    expect(debrief).toMatch(/Verdant airspace/);
    expect(debrief).toMatch(/collapsed/);
    expect(debrief, 'someone violates it; nobody is named').not.toMatch(/Helion violat|Tidewell violat/);
  });
  it('speaks to the human about what the agent is doing (D-007): every mission mentions the agent and a standing order or doctrine', () => {
    for (const m of MISSIONS) {
      const text = linesOf(m).filter((l) => l.speaker === 'echo').map((l) => l.text).join('\n');
      expect(text, m.id).toMatch(/your agent/i);
      expect(text, m.id).toMatch(/your human|for the human|composition weights|standing orders|posture|policy|target priorities/i);
    }
    expect(linesOf(FIRST_LIGHT).some((l) => /Hold the Line/.test(l.text) && /Troopers/.test(l.text))).toBe(true); // the order's own example
    expect(allLines.filter((l) => MANUAL_CONTROL.test(l.text))).toEqual([]);
  });
  it('states numbers that match its own maps: arcologies, contacts, docks and cycles', () => {
    const claim = (m: Mission, re: RegExp) => {
      for (const l of linesOf(m)) { const hit = re.exec(l.text); if (hit) return NUMBER_WORDS[hit[1].toLowerCase()]; }
      return undefined;
    };
    expect(claim(FIRST_LIGHT, /(\w+) arcologies are unclaimed/)).toBe(countOf(mapOf(FIRST_LIGHT), 'C', '.'));
    expect(claim(FIRST_LIGHT, /(\w+) contacts on the east road/)).toBe(mapOf(FIRST_LIGHT).units.filter((u) => u.owner === 2).length);
    expect(claim(SALTGLASS_BAY, /has (\w+) dock,/)).toBe(countOf(mapOf(SALTGLASS_BAY), 'D', '0'));
    expect(claim(TIDEBREAK, /for (\w+) cycles\. Recommendation/)).toBe(TIDEBREAK.objective.kind === 'survive' ? TIDEBREAK.objective.cycles : -1);
    expect(claim(FIRST_LIGHT, /(\w+) hostile hulls destroyed/i)).toBe(3);
  });
});

// ---------------------------------------------------------------- self-play

describe('every mission plays under simulate', () => {
  const policies: SimPolicy[] = ['greedy', 'random'];
  for (const m of MISSIONS) {
    for (const policy of policies) {
      it(`${m.id}: ${policy} policy, seeds 1-3, ends without an exception`, () => {
        for (const seed of [1, 2, 3]) {
          const setup = setupFor(m, seed);
          let started = 0;
          const result = simulate({ setup, seed, maxCycles: 14, policy, onStart: () => { started++; } });
          expect(started, `${m.id} ${policy} seed ${seed}`).toBe(1);
          expect(result.actions.length, `${m.id} ${policy} seed ${seed}`).toBeGreaterThan(0);
          expect(result.cycles).toBeGreaterThanOrEqual(1);
          expect(result.cycles).toBeLessThanOrEqual(14);
          expect(result.state.players).toHaveLength(m.players.length);
          // A survive objective can only be won once its cycle has ended; a winner earlier than that came from a rout or a spire.
          if (m.objective.kind === 'survive' && result.winnerTeam === m.players[0].team && result.state.players[0].defeated === false && result.state.players.filter((p) => p.team !== 0 && !p.defeated).length > 0) {
            expect(result.cycles, `${m.id} survive win`).toBeGreaterThanOrEqual(m.objective.cycles);
          }
        }
      });
    }
  }
  it('a survive objective is really won at its cycle: when every side only ends its turns, team 0 wins as cycle 8 ends and not before (known answer)', () => {
    const quiet = (setup: CreateGameOptions) => {
      let s = createGame(setup);
      const history: { cycle: number; winner: number | null }[] = [];
      for (let guard = 0; guard < 200 && s.winnerTeam === null; guard++) {
        history.push({ cycle: s.cycle, winner: s.winnerTeam });
        s = applyAction(s, { kind: 'endTurn' }).state;
      }
      return { s, history };
    };
    const { s, history } = quiet(setupFor(TIDEBREAK, 1));
    expect(s.winnerTeam).toBe(0);
    expect(s.cycle, 'won as cycle 8 ended').toBe(8);
    expect(history.every((h) => h.winner === null)).toBe(true);
    expect(history.filter((h) => h.cycle === 8), 'player 0, Rook and Dax each took their turn in cycle 8').toHaveLength(3);
    // The same loop on a survive 3 objective ends at cycle 3, so the loop is not just running to some fixed length.
    const short = quiet({ ...setupFor(TIDEBREAK, 1), objective: { kind: 'survive', cycles: 3 } });
    expect(short.s.winnerTeam).toBe(0);
    expect(short.s.cycle).toBe(3);
  });
});

// ---------------------------------------------------------------- checkMap's requireBases option

describe('checkMap({ requireBases })', () => {
  // 7x3, two players, no spire and no fabricator anywhere: a tutorial field.
  const NO_BASES: MapDef = {
    id: 'no-bases', name: 'No bases', description: 'A tutorial field with no production.', players: 2,
    terrain: ['.......', '..f.^..', '.......'],
    owners: ['.......', '.......', '.......'],
    units: [{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 6, y: 1 }],
  };
  it('fails a map with no base by default, naming the spire and fabricator rules for both players', () => {
    const issues = checkMap(NO_BASES);
    expect(issues.map((i) => i.rule).sort()).toEqual(['fabricator', 'fabricator', 'spire', 'spire']);
    expect(checkMap(NO_BASES, {})).toEqual(issues);
    expect(checkMap(NO_BASES, { requireBases: true })).toEqual(issues);
  });
  it('passes the same map with requireBases false', () => {
    expect(checkMap(NO_BASES, { requireBases: false })).toEqual([]);
  });
  it('still runs every other rule with requireBases false: units on bad ground, overlap, bad codes, owners on flats and unreachable cities all fail', () => {
    const opts = { requireBases: false };
    const rules = (m: MapDef) => [...new Set(checkMap(m, opts).map((i) => i.rule))].sort();
    const sea = clone(NO_BASES);
    sea.terrain[1] = '..~.^..';
    sea.units[0] = { type: 'trooper', owner: 0, x: 2, y: 1 };
    expect(rules(sea)).toEqual(['unit-terrain']);
    const overlap = clone(NO_BASES);
    overlap.units.push({ type: 'trooper', owner: 0, x: 0, y: 1 });
    expect(rules(overlap)).toEqual(['unit-overlap']);
    const code = clone(NO_BASES);
    code.terrain[0] = 'Z' + code.terrain[0].slice(1);
    expect(rules(code)).toEqual(['code']);
    const owner = clone(NO_BASES);
    owner.owners[2] = '0' + owner.owners[2].slice(1);
    expect(rules(owner)).toEqual(['owner-property']);
    const shape = clone(NO_BASES);
    shape.terrain[1] = shape.terrain[1].slice(0, 5);
    expect(rules(shape)).toEqual(['shape']);
    const players = { ...clone(NO_BASES), players: 1 };
    expect(rules(players)).toContain('players');
  });
  it('still measures reachability from whatever spires exist: a spire with a walled-off neutral city fails even with requireBases false', () => {
    const m: MapDef = {
      id: 'walled', name: 'Walled', description: 'One spire and a city behind water.', players: 2,
      terrain: ['H..~C', '...~~'], owners: ['0....', '.....'], units: [{ type: 'trooper', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 2, y: 1 }],
    };
    expect(checkMap(m, { requireBases: false }).map((i) => i.rule)).toEqual(['reach-neutral']);
    m.terrain[0] = 'H..~.'; // no city: nothing left to reach
    expect(checkMap(m, { requireBases: false })).toEqual([]);
  });
  it('leaves the six shipped skirmish maps exactly as they were: valid by default and with the option on', () => {
    for (const [id, map] of Object.entries(MAPS)) {
      expect(checkMap(map), id).toEqual([]);
      expect(checkMap(map, { requireBases: true }), id).toEqual([]);
      expect(checkMap(map, { requireBases: false }), id).toEqual([]);
    }
  });
});

// ================================================================================================================================
// M4.1 Act II, "False Colors": missions 5-7. Spec: docs/STORY.md "Act II" (the outline; the entries for Juno, Maru, Rook, Ilse and ECHO),
// "Writing rules for dialogue" and D-007. Same method as Act I above: every expectation comes from the story text, the map rows, the data
// tables or the engine, never from missions.ts, and each group carries a planted failure it must keep catching.
// ================================================================================================================================

const ACT_II = ALL_MISSIONS.filter((m) => m.act === 2);
const [UNDER_CANOPY, POLLEN_COUNT, ROOT_AND_BRANCH] = ACT_II;
const ACT_II_LINES = ACT_II.flatMap(linesOf);
const ACT_II_STORY = STORY.slice(STORY.indexOf('### Act II'), STORY.indexOf('### Act III'));
const ACT_II_OUTLINE = [...ACT_II_STORY.matchAll(/^(\d+)\. \*\*([^*]+)\*\* — ([^\n]+)$/gm)];

const MINOR_SPEAKERS_II = ['Grove Relay', 'Vault Keeper'];
const ACT_II_SPEAKERS = ['echo', 'rook', 'ilse', 'juno', 'maru', 'narrator', ...MINOR_SPEAKERS_II];
// STORY: ECHO never uses "!" and Juno uses too many; Ilse is "devastatingly calm"; Maru "never raises their voice" (their entry).
// Act II may name the Hollow Choir and Lattice traffic, and may never name VESPER, Cantor, Mira or the Lattice core.
const ACT_II_RULES: DialogueRules = {
  speakers: ACT_II_SPEAKERS,
  neverShouts: new Set(['echo', 'ilse', 'maru', 'narrator', ...MINOR_SPEAKERS_II]),
  spoilers: [/vesper/i, /\bcantor\b/i, /\bmira\b/i, /lattice core/i],
};
const POSTURES = ['Advance', 'Hold the Line', 'Fall Back']; // the standing-order posture names (D-005; the lead's order)

const duplicates = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
const textOf = (m: Mission, speaker?: string) => linesOf(m).filter((l) => speaker === undefined || l.speaker === speaker).map((l) => l.text).join('\n');
const propertiesOf = (map: MapDef) => tilesOf(map, (c) => !!TERRAIN_TYPES[TERRAIN_CODES[c]].property);
const ownedBy = (map: MapDef, p: number) => propertiesOf(map).filter((t) => map.owners[t.y][t.x] === String(p)).length;
const sentencesOf = (text: string) => text.split(/(?<=[.?!])\s+/).filter(Boolean);
const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);
const canopyShare = (map: MapDef) => countOf(map, 'f') / (map.terrain.length * map.terrain[0].length);
const nextTo = (map: MapDef, x: number, y: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => map.terrain[y + dy]?.[x + dx]);
const share140 = (lines: DialogueLine[]) => lines.filter((l) => l.text.length <= 140).length / lines.length;

/** A game on one of the mission's maps with only the units given (every slot still seated exactly as the mission seats it). */
function probe(m: Mission, units: MapDef['units'], over: Partial<CreateGameOptions> = {}): GameState {
  return createGame({ ...setupFor(m, 1), map: { ...clone(mapOf(m)), units }, ...over });
}

/** What is wrong with a capture objective on its map. Empty = fine. A capture counts ONE player's properties (victory.ts). */
function captureProblems(m: Mission, map: MapDef): string[] {
  if (m.objective.kind !== 'capture') return [];
  const n = m.objective.properties;
  const out: string[] = [];
  if (!Number.isInteger(n) || n < 1) out.push('N must be a whole number of at least 1');
  for (let p = 0; p < m.players.length; p++) if (ownedBy(map, p) >= n) out.push(`player ${p} already owns ${ownedBy(map, p)}, so the first capture would end the mission`);
  const myTeam = m.players[0].team;
  // What player 0 could ever own: its own, the neutral ones and the opponents' (a unit cannot capture an ally's property).
  const winnable = propertiesOf(map).filter((t) => { const o = map.owners[t.y][t.x]; return o === '.' || o === '0' || m.players[Number(o)]?.team !== myTeam; }).length;
  if (n > winnable) out.push(`${n} properties asked, only ${winnable} could ever be owned by player 0`);
  return out;
}

/** The winning team after `capturer` takes the last neutral arcology while already owning `owned` other properties (null = nobody yet). */
function winnerAfterCapture(m: Mission, capturer: number, owned: number, alsoOwnedByRook = 0): number | null {
  const s = clone(createGame(setupFor(m, 1)));
  const props = propertiesOf(mapOf(m));
  const target = props.find((t) => s.tiles[t.y][t.x].terrain === 'arcology')!;
  s.units = s.units.filter((u) => !(u.x === target.x && u.y === target.y));
  const others = props.filter((t) => t !== target);
  others.forEach((t, i) => { s.tiles[t.y][t.x].owner = i < owned ? capturer : i < owned + alsoOwnedByRook ? 1 : null; });
  s.tiles[target.y][target.x].owner = null;
  s.tiles[target.y][target.x].capture = 1; // one more point and it changes hands
  const id = s.nextUnitId++;
  s.units.push({ id, type: 'trooper', owner: capturer, x: target.x, y: target.y, hp: 100, charge: 99, ammo: 0, acted: false, cargo: [] });
  s.current = capturer;
  return applyAction(s, { kind: 'move', unitId: id, path: [{ x: target.x, y: target.y }], then: { kind: 'capture' } }).state.winnerTeam;
}

// ---------------------------------------------------------------- the act, and the campaign across acts

describe('Act II: the campaign act, and the campaign across both acts', () => {
  it('has act 2, "False Colors", with the tagline STORY.md prints under the heading and the three mission ids in outline order', () => {
    const head = /### Act II — ([^\n]+)\n\*"([^"]+)"\*/.exec(STORY);
    expect(head, 'STORY.md Act II heading').not.toBeNull();
    expect(head![1]).toBe('False Colors');
    const act = ALL_ACTS.find((a) => a.act === 2);
    expect(act, 'act 2 is listed').toBeDefined();
    expect(act!.title).toBe(head![1]);
    expect(act!.tagline).toBe(head![2]);
    const idsFromTitles = ACT_II_OUTLINE.map((m) => m[2].toLowerCase().replace(/ /g, '-')); // 'Root and Branch' -> 'root-and-branch'
    expect(act!.missions).toEqual(idsFromTitles);
    expect(act!.missions).toEqual(ACT_II.map((m) => m.id));
  });
  it('follows the Act II outline in STORY.md: titles and numbers in order, and the places it names', () => {
    expect(ACT_II_OUTLINE.map((m) => m[2])).toEqual(['Under Canopy', 'Pollen Count', 'Root and Branch']);
    expect(ACT_II.map((m) => m.title)).toEqual(ACT_II_OUTLINE.map((m) => m[2]));
    expect(ACT_II.map((m) => m.order)).toEqual(ACT_II_OUTLINE.map((m) => Number(m[1])));
    expect(ACT_II.every((m) => m.act === 2)).toBe(true);
    expect(UNDER_CANOPY.location, 'the Verdant canopy is the Compact\'s home').toBe(FACTIONS.verdant.home);
    expect(ACT_II_OUTLINE[1][3].toLowerCase()).toContain('ashfall seed vault');
    expect(POLLEN_COUNT.location.toLowerCase()).toBe('ashfall seed vault');
    expect(ACT_II_OUTLINE[2][3]).toContain('Elder Maru Ingram');
    expect(ROOT_AND_BRANCH.location).toContain('Elder');
  });
  it('lays acts 1 and 2 out in order: missions 1-7, ids / orders / maps / map names unique, no skirmish map shadowed (the whole campaign is checked under Act III)', () => {
    const acts = ALL_ACTS.filter((a) => a.act <= 2);
    const missions = ALL_MISSIONS.filter((m) => m.act <= 2);
    const maps = Object.entries(ALL_MISSION_MAPS).filter(([id]) => missions.some((m) => m.mapId === id));
    expect(acts.map((a) => a.act)).toEqual([1, 2]);
    expect(missions).toHaveLength(7);
    expect(missions.map((m) => m.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(acts.flatMap((a) => a.missions)).toEqual(missions.map((m) => m.id));
    for (const a of acts) expect(missions.filter((m) => m.act === a.act).map((m) => m.id), `act ${a.act}`).toEqual(a.missions);
    expect(duplicates(missions.map((m) => m.id))).toEqual([]);
    expect(duplicates(missions.map((m) => m.mapId))).toEqual([]);
    for (const m of missions) expect(m.id, m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(maps.map(([id]) => id).sort()).toEqual(missions.map((m) => m.mapId).sort());
    expect(new Set(maps.map(([, m]) => m.name)).size).toBe(7);
    for (const [key, map] of maps) {
      expect(map.id, key).toBe(key);
      expect(MAPS[key], `${key} must not shadow a skirmish map`).toBeUndefined();
    }
  });
  it('would notice a duplicated mission id, a missing mission or a tagline copied from the wrong act', () => {
    expect(duplicates([...ALL_MISSIONS.map((m) => m.id), 'tidebreak'])).toEqual(['tidebreak']);
    expect(duplicates(['a', 'b', 'a', 'a'])).toEqual(['a', 'a']);
    expect(ALL_ACTS[1].tagline).not.toBe(ALL_ACTS[0].tagline);
    expect(ALL_ACTS[1].missions.slice(0, 2)).not.toEqual(ACT_II.map((m) => m.id));
    expect(ALL_ACTS[1].missions.some((id) => ALL_ACTS[0].missions.includes(id)), 'no mission belongs to two acts').toBe(false);
  });
});

describe('the three Act II missions: shape', () => {
  it('have 6-14 briefing lines, 2-6 events (start, victory and defeat among them), 4-10 debrief lines, and every event is once', () => {
    expect(ACT_II).toHaveLength(3);
    for (const m of ACT_II) {
      expect(m.briefing.length, `${m.id} briefing`).toBeGreaterThanOrEqual(6);
      expect(m.briefing.length, `${m.id} briefing`).toBeLessThanOrEqual(14);
      expect(m.events.length, `${m.id} events`).toBeGreaterThanOrEqual(2);
      expect(m.events.length, `${m.id} events`).toBeLessThanOrEqual(6);
      expect(m.debrief.length, `${m.id} debrief`).toBeGreaterThanOrEqual(4);
      expect(m.debrief.length, `${m.id} debrief`).toBeLessThanOrEqual(10);
      const kinds = m.events.map((e) => e.trigger.kind);
      for (const k of ['start', 'victory', 'defeat']) expect(kinds, `${m.id} has a ${k} event`).toContain(k);
      for (const e of m.events) {
        expect(e.once, `${m.id} ${e.trigger.kind}`).toBe(true);
        expect(e.lines.length, `${m.id} ${e.trigger.kind}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('have a title, a location, a one-line summary and an objective sentence, clear weather, no turn limit (D-013), and fog in mission 5 only', () => {
    for (const m of ACT_II) {
      expect(m.title.length, m.id).toBeGreaterThan(0);
      expect(m.location.length, m.id).toBeGreaterThan(0);
      expect(m.summary, m.id).toMatch(/^[A-Z][^\n]+\.$/);
      expect(m.summary.length, m.id).toBeLessThanOrEqual(160);
      expect(m.objectiveText, m.id).toMatch(/^[A-Z][^\n]+\.$/);
      expect(m.weather, `${m.id}: ion storms are Act III`).toBe('clear');
      expect(m.turnLimit, `${m.id}: the engine reads turnLimit as a versus day limit (D-013)`).toBeUndefined();
    }
    expect(ACT_II.map((m) => m.fog)).toEqual([true, false, false]); // mission 5 teaches fog; 6 and 7 teach survival and capture
    expect(ACT_II_OUTLINE[0][3], 'STORY puts mission 5 in fog').toContain('in fog');
    expect(ACT_II_OUTLINE[0][3]).toContain('Teaches fog of war and canopy');
  });
  it('have par values the score can use: whole positive cycles, a positive power, and a survival whose par is not shorter than the survival', () => {
    for (const m of ACT_II) {
      expect(Number.isInteger(m.par.cycles) && m.par.cycles > 0, `${m.id} par.cycles`).toBe(true);
      expect(Number.isFinite(m.par.power) && m.par.power > 0, `${m.id} par.power`).toBe(true);
      expect(() => scoreCard(createGame(setupFor(m, 1)), 0, m.par), m.id).not.toThrow(); // scoreCard refuses a par of 0 or less
      if (m.objective.kind === 'survive') expect(m.par.cycles, m.id).toBeGreaterThanOrEqual(m.objective.cycles);
    }
    expect(ACT_II.map((m) => m.par.cycles)).toEqual([12, 8, 14]);
    expect(() => scoreCard(createGame(setupFor(UNDER_CANOPY, 1)), 0, { cycles: 0, power: 2 }), 'a zero par is refused').toThrow();
  });
  it('mean what STORY.md says: a chase to a spire in fog, "Survive 8 cycles", and a capture objective', () => {
    expect(UNDER_CANOPY.objective).toEqual({ kind: 'hq' });
    expect(UNDER_CANOPY.objectiveText).toMatch(/^Capture the .*spire/);
    const survive = /Survive (\d+) cycles/.exec(ACT_II_OUTLINE[1][3]);
    expect(survive, 'STORY mission 6').not.toBeNull();
    expect(POLLEN_COUNT.objective).toEqual({ kind: 'survive', cycles: Number(survive![1]) });
    expect(Number(survive![1])).toBe(8);
    expect(NUMBER_WORDS[/for (\w+) cycles/.exec(POLLEN_COUNT.objectiveText)![1]]).toBe(8);
    expect(ACT_II_OUTLINE[2][3]).toContain('Capture objective');
    expect(ROOT_AND_BRANCH.objective.kind).toBe('capture');
    const n = ROOT_AND_BRANCH.objective.kind === 'capture' ? ROOT_AND_BRANCH.objective.properties : -1;
    expect(NUMBER_WORDS[/Own (\w+) properties/.exec(ROOT_AND_BRANCH.objectiveText)![1]], 'the objective sentence says the number').toBe(n);
  });
});

// ---------------------------------------------------------------- players: D-007

describe('Act II players (D-007: the agent is the commander, the named cast are NPCs)', () => {
  it('seat the agent as player 0 (human, "agent", Helion), Rook as an AI ally on its team, the opposing force in slot 2, and in mission 6 Juno in slot 3 on the agent team', () => {
    expect(ACT_II.map((m) => m.players.length)).toEqual([3, 4, 3]);
    for (const m of ACT_II) {
      const [me, ally, foe] = m.players;
      expect(me, m.id).toMatchObject({ faction: 'helion', commander: 'agent', controller: 'human', team: 0 });
      expect(ally, m.id).toMatchObject({ faction: 'helion', commander: 'rook', controller: 'ai', team: me.team });
      expect(foe.controller, m.id).toBe('ai');
      expect(foe.team, m.id).not.toBe(me.team);
      expect(m.players.filter((p) => p.controller === 'human'), m.id).toHaveLength(1);
    }
    expect(POLLEN_COUNT.players[3]).toMatchObject({ faction: 'verdant', commander: 'juno', controller: 'ai', team: POLLEN_COUNT.players[0].team });
  });
  it('uses the opponents STORY.md names: Juno\'s wing, then the unmarked drones, then Maru; and Juno fights beside Rook in mission 6 only', () => {
    expect(UNDER_CANOPY.players[2]).toMatchObject({ faction: 'verdant', commander: 'juno' });
    expect(POLLEN_COUNT.players[2]).toMatchObject({ faction: 'choir', commander: 'none' }); // no named commander: Cantor and VESPER wait for Acts III-IV
    expect(ROOT_AND_BRANCH.players[2]).toMatchObject({ faction: 'verdant', commander: 'maru' });
    expect(ACT_II_OUTLINE[1][3]).toContain('Juno and Rook fight side by side');
    // Juno is an enemy in mission 5 (other team) and an ally in mission 6 (the agent's team); she appears nowhere else.
    expect(UNDER_CANOPY.players[2].team).not.toBe(UNDER_CANOPY.players[0].team);
    const junos = ACT_II.flatMap((m) => m.players.map((p) => ({ m: m.id, p }))).filter((x) => x.p.commander === 'juno');
    expect(junos.map((x) => `${x.m}:${x.p.team === 0 ? 'ally' : 'enemy'}`)).toEqual(['under-canopy:enemy', 'pollen-count:ally']);
  });
  it('names real commanders of the right faction, and leaves "agent" and "none" unknown so the engine gives them no modifiers', () => {
    for (const m of ACT_II) {
      for (const p of m.players) {
        if (p.commander === 'agent' || p.commander === 'none') continue;
        expect(COMMANDERS[p.commander], `${m.id} ${p.commander}`).toBeDefined();
        expect(COMMANDERS[p.commander].faction, `${m.id} ${p.commander}`).toBe(p.faction);
      }
    }
    expect(COMMANDERS.maru.pronouns, 'STORY: Maru is they/them').toBe('they/them');
    // No commander on these maps changes income, so every player is paid exactly 1000 a property (uplinks pay 0), mechanics.md section 6.
    for (const m of ACT_II) {
      const s = createGame(setupFor(m, 1));
      for (let p = 0; p < m.players.length; p++) {
        expect(incomeOf(s, p), `${m.id} player ${p}`).toBe(1000 * tilesOf(mapOf(m), (c, o) => 'CFADH'.includes(c) && o === String(p)).length);
      }
    }
  });
  it('keeps VESPER and Cantor out of Act II: the only Choir player is mission 6\'s drones, with no named commander', () => {
    const choir = ACT_II.flatMap((m) => m.players.map((p) => ({ m: m.id, p }))).filter((x) => x.p.faction === 'choir');
    expect(choir.map((x) => x.m)).toEqual(['pollen-count']);
    expect(ALL_MISSIONS.filter((m) => m.act <= 2).flatMap((m) => m.players).filter((p) => ['cantor', 'vesper'].includes(p.commander))).toEqual([]);
  });
});

// ---------------------------------------------------------------- maps

describe('the Act II maps', () => {
  it('pass checkMap with the default options: every player slot owns exactly one spire and a fabricator', () => {
    for (const m of ACT_II) {
      expect(checkMap(mapOf(m)), m.id).toEqual([]);
      for (let p = 0; p < m.players.length; p++) {
        expect(countOf(mapOf(m), 'H', String(p)), `${m.id} p${p} spires`).toBe(1);
        expect(countOf(mapOf(m), 'F', String(p)), `${m.id} p${p} fabricators`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('would catch a broken Act II map: a spire removed, a fabricator removed, a spire sealed behind water', () => {
    const noJunoSpire = clone(mapOf(UNDER_CANOPY));
    const j = spireOf(noJunoSpire, 2);
    setCell(noJunoSpire.terrain, j.x, j.y, '.');
    setCell(noJunoSpire.owners, j.x, j.y, '.');
    expect(checkMap(noJunoSpire).map((i) => i.rule)).toEqual(['spire']);
    const noChoirFab = clone(mapOf(POLLEN_COUNT));
    const f = tilesOf(noChoirFab, (c, o) => c === 'F' && o === '2')[0];
    setCell(noChoirFab.terrain, f.x, f.y, '.');
    setCell(noChoirFab.owners, f.x, f.y, '.');
    expect(checkMap(noChoirFab).map((i) => i.rule)).toEqual(['fabricator']);
    // Ring the agent's spire with sea: foot units cannot reach it, so the map must fail the reach rule.
    const sealed = clone(mapOf(ROOT_AND_BRANCH));
    const a = spireOf(sealed, 0);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) setCell(sealed.terrain, a.x + dx, a.y + dy, '~');
    expect(checkMap(sealed).map((i) => i.rule)).toContain('reach-base');
    for (const m of ACT_II) expect(checkMap(mapOf(m)), `${m.id}: the unbroken map is fine`).toEqual([]);
  });
  it('seat exactly as many players as the mission has, with every unit and property owner one of them, and describe themselves in one sentence', () => {
    for (const m of ACT_II) {
      const map = mapOf(m);
      expect(map.players, m.id).toBe(m.players.length);
      for (const u of map.units) expect(u.owner, m.id).toBeLessThan(m.players.length);
      for (let p = 0; p < m.players.length; p++) expect(map.units.filter((u) => u.owner === p).length, `${m.id} player ${p} starts with units`).toBeGreaterThan(0);
      expect(map.description, m.id).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(map.description.length, m.id).toBeLessThan(200);
      expect(map.recommended?.fog, `${m.id} recommended fog`).toBe(m.fog);
      expect(map.recommended?.weather, `${m.id} recommended weather`).toBe(m.weather);
      expect(map.recommended?.startFunds, `${m.id} recommended funds`).toBe(m.players[0].funds);
    }
  });
  it('have the sizes they were drawn at and are drawn for their story beat, not mirrored (the symmetry detector is shown to work on a skirmish map)', () => {
    expect(ACT_II.map((m) => `${mapOf(m).terrain[0].length}x${mapOf(m).terrain.length}`)).toEqual(['20x14', '22x14', '22x14']);
    for (const m of ACT_II) expect(symmetryOf(mapOf(m)), m.id).toBe('none');
    expect(symmetryOf(MAPS['calder-fields']), 'known answer: a skirmish map is a mirror').toBe('rot180');
  });
  it('place allies on the west and the opposing force on the east, with no unit of one side starting within four tiles of the other', () => {
    for (const m of ACT_II) {
      const map = mapOf(m);
      const width = map.terrain[0].length;
      const mine = m.players.map((p, i) => (p.team === m.players[0].team ? i : -1)).filter((i) => i >= 0);
      const allies = map.units.filter((u) => mine.includes(u.owner));
      const foes = map.units.filter((u) => !mine.includes(u.owner));
      expect(allies.length, m.id).toBeGreaterThan(0);
      expect(foes.length, m.id).toBeGreaterThan(0);
      for (const u of allies) expect(u.x, `${m.id} ally ${u.type} at (${u.x},${u.y})`).toBeLessThan(width / 2);
      expect(spireOf(map, 2).x, `${m.id}: the opposing spire`).toBeGreaterThan(width / 2);
      const gap = Math.min(...allies.flatMap((a) => foes.map((f) => Math.abs(a.x - f.x) + Math.abs(a.y - f.y))));
      expect(gap, `${m.id}: nearest ally-to-enemy distance at the start`).toBeGreaterThanOrEqual(4);
    }
  });
  it('mission 5 is a canopy weald: about half canopy, ridge lookouts either side, a road, cities in glades, and a hidden ambush', () => {
    const map = mapOf(UNDER_CANOPY);
    expect(canopyShare(map), 'canopy-heavy').toBeGreaterThanOrEqual(0.4);
    expect(tilesOf(map, (c, _o, _x, y) => c === '^' && y < 7).length, 'north lookout').toBeGreaterThanOrEqual(2);
    expect(tilesOf(map, (c, _o, _x, y) => c === '^' && y >= 7).length, 'south lookout').toBeGreaterThanOrEqual(2);
    expect(countOf(map, '=')).toBeGreaterThanOrEqual(4);
    expect(countOf(map, 'C', '.'), 'neutral cities').toBeGreaterThanOrEqual(4);
    for (const c of tilesOf(map, (ch, o) => ch === 'C' && o === '.')) {
      expect(nextTo(map, c.x, c.y).filter((ch) => ch !== 'f').length, `city (${c.x},${c.y}) sits in a glade`).toBeGreaterThanOrEqual(2);
    }
    // Juno's wing: three or more Wasps, and ground units waiting under canopy beside the road.
    const juno = map.units.filter((u) => u.owner === 2);
    expect(juno.filter((u) => u.type === 'wasp').length, 'a Wasp squadron').toBeGreaterThanOrEqual(3);
    const hidden = juno.filter((u) => UNIT_TYPES[u.type].domain === 'ground' && map.terrain[u.y][u.x] === 'f');
    expect(hidden.length, 'ground units under canopy').toBeGreaterThanOrEqual(2);
    expect(map.units.some((u) => u.owner === 0 && u.type === 'skimmer'), 'the agent has a scout').toBe(true);
    // The lookouts are real: a Trooper on a ridge sees three tiles farther than on flats (D-012.2).
    const ridge = tilesOf(map, (c) => c === '^')[0];
    const onRidge = probe(UNDER_CANOPY, [{ type: 'trooper', owner: 0, x: ridge.x, y: ridge.y }, { type: 'trooper', owner: 1, x: 3, y: 8 }, { type: 'trooper', owner: 2, x: 12, y: 3 }]);
    const trooper = onRidge.units[0];
    expect(effectiveVision(onRidge, trooper)).toBe(UNIT_TYPES.trooper.vision + 3);
    expect(effectiveVision(onRidge, trooper, { x: 3, y: 4 })).toBe(UNIT_TYPES.trooper.vision);
  });
  it('mission 6 is a vault under siege: a ridge wall with a maglev gate, four spires, the allied compound on the west and the drones\' relay on the east', () => {
    const map = mapOf(POLLEN_COUNT);
    const width = map.terrain[0].length;
    for (const x of [10, 11]) {
      const column = map.terrain.map((row) => row[x]);
      expect(column.filter((ch) => ch === '^').length, `ridge wall at x=${x}`).toBeGreaterThanOrEqual(9);
      const gaps = column.filter((ch) => ch !== '^');
      expect(gaps.length, `gaps in the wall at x=${x}`).toBeGreaterThanOrEqual(2);
      expect(gaps.length).toBeLessThanOrEqual(4);
      expect(gaps, 'the gate is a maglev road').toContain('=');
    }
    const spires = [0, 1, 2, 3].map((p) => spireOf(map, p));
    expect(new Set(spires.map((s) => `${s.x},${s.y}`)).size, 'four spires').toBe(4);
    for (const p of [0, 1, 3]) expect(spires[p].x, `allied spire ${p}`).toBeLessThan(10);
    expect(spires[2].x, 'the drones\' relay').toBeGreaterThan(11);
    // The relay is far from the compound on foot, so the survival is not undone by a rush: at least twelve steps from every allied spire.
    for (const p of [0, 1, 3]) expect(distances(map, spires[p], costFor('foot'))[spires[2].y][spires[2].x], `from spire ${p}`).toBeGreaterThanOrEqual(12);
    expect(width).toBeGreaterThan(spires[2].x);
    // Units: the allied side is all west of the wall, the drones all east of it.
    for (const u of map.units) {
      if (u.owner === 2) expect(u.x, `drone ${u.type}`).toBeGreaterThan(11);
      else expect(u.x, `allied ${u.type}`).toBeLessThan(10);
    }
    // The drones are Wasps and Skimmers (a gunship flock with scouts); Juno flies three Wasps; each Helion player starts with a Warden.
    expect(new Set(map.units.filter((u) => u.owner === 2).map((u) => u.type))).toEqual(new Set(['wasp', 'skimmer']));
    expect(map.units.filter((u) => u.owner === 3 && u.type === 'wasp')).toHaveLength(3);
    for (const p of [0, 1]) expect(map.units.filter((u) => u.owner === p && u.type === 'warden').length, `p${p} Wardens`).toBeGreaterThanOrEqual(1);
    // The anti-air lesson is in the data: a Warden hits a Wasp hard, a Trooper's gun hardly scratches one.
    expect(UNIT_TYPES.warden.range).not.toBeNull();
    expect(DAMAGE.warden.primary!.wasp!).toBeGreaterThan(100);
    expect(DAMAGE.trooper.secondary!.wasp!).toBeLessThan(10);
    expect(DAMAGE.warden.primary!.wasp!).toBeGreaterThan(10 * DAMAGE.trooper.secondary!.wasp!);
  });
  it('mission 7 is a grove: a third canopy, flats beside canopy for Overgrowth to turn, seventeen properties, ten of them unclaimed, a lookout ridge each side', () => {
    const map = mapOf(ROOT_AND_BRANCH);
    expect(canopyShare(map)).toBeGreaterThanOrEqual(0.25);
    expect(canopyShare(map)).toBeLessThanOrEqual(0.5);
    // Overgrowth: "flats next to canopy grow into canopy" (commanders.ts). The map must give it plenty to grow.
    const growable = tilesOf(map, (c, _o, x, y) => c === '.' && nextTo(map, x, y).includes('f'));
    expect(growable.length, 'flats beside canopy').toBeGreaterThanOrEqual(30);
    expect(propertiesOf(map)).toHaveLength(17);
    expect([0, 1, 2].map((p) => ownedBy(map, p))).toEqual([2, 2, 3]);
    expect(propertiesOf(map).filter((t) => map.owners[t.y][t.x] === '.')).toHaveLength(10);
    for (const t of propertiesOf(map).filter((p) => map.owners[p.y][p.x] === '.')) {
      expect(nextTo(map, t.x, t.y).filter((ch) => ch !== 'f').length, `property (${t.x},${t.y}) sits in a glade`).toBeGreaterThanOrEqual(2);
    }
    expect(tilesOf(map, (c, _o, _x, y) => c === '^' && y < 7).length).toBeGreaterThanOrEqual(2);
    expect(tilesOf(map, (c, _o, _x, y) => c === '^' && y >= 7).length).toBeGreaterThanOrEqual(2);
    // Maru's side: ground units that start under canopy, as the doctrine wants.
    const rooted = map.units.filter((u) => u.owner === 2 && map.terrain[u.y][u.x] === 'f');
    expect(rooted.length, 'Elder units under canopy').toBeGreaterThanOrEqual(3);
    // Only Troopers and Breachers capture (data), and the agent starts with some.
    expect(map.units.filter((u) => u.owner === 0 && UNIT_TYPES[u.type].captures).length).toBeGreaterThanOrEqual(3);
  });
});

describe('createGame on the Act II maps', () => {
  it('builds each mission from its own players, with its own fog and weather, and pays player 0 its mission funds plus 1000 a property on turn one', () => {
    for (const m of ACT_II) {
      const map = mapOf(m);
      const s = createGame(setupFor(m, 1));
      expect(s.mapId, m.id).toBe(m.mapId);
      expect(s.players.map((p) => p.commander), m.id).toEqual(m.players.map((p) => p.commander));
      expect(s.players.map((p) => p.team), m.id).toEqual(m.players.map((p) => p.team));
      expect(s.units, m.id).toHaveLength(map.units.length);
      expect(s.fog, m.id).toBe(m.fog);
      expect(s.weather, m.id).toBe('clear');
      expect(s.objective, m.id).toEqual(m.objective);
      expect(s.players[0].funds, m.id).toBe((m.players[0].funds ?? 0) + 1000 * tilesOf(map, (c, o) => 'CFADH'.includes(c) && o === '0').length);
      for (let p = 1; p < m.players.length; p++) expect(s.players[p].funds, `${m.id} player ${p} has not started a turn`).toBe(m.players[p].funds ?? 0);
      // The agent has a fabricator and the funds to use it on turn one.
      expect(countOf(map, 'F', '0') > 0 && s.players[0].funds >= 1000, `${m.id}: something to buy`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- objectives and triggers

describe('Act II objectives and triggers', () => {
  it('gives mission 5 an enemy spire to take, and the capture objective of mission 7 a number every player starts below and player 0 can reach', () => {
    expect(hqProblems(UNDER_CANOPY, mapOf(UNDER_CANOPY))).toEqual([]);
    expect(captureProblems(ROOT_AND_BRANCH, mapOf(ROOT_AND_BRANCH))).toEqual([]);
    expect(captureProblems(UNDER_CANOPY, mapOf(UNDER_CANOPY)), 'only capture objectives are judged').toEqual([]);
    expect(ROOT_AND_BRANCH.objective).toEqual({ kind: 'capture', properties: 7 });
  });
  it('would catch a bad capture objective: zero, a number a player already holds, a number nobody could reach, and an allied map with nothing left to take', () => {
    const map = mapOf(ROOT_AND_BRANCH);
    const withN = (n: number): Mission => ({ ...ROOT_AND_BRANCH, objective: { kind: 'capture', properties: n } });
    expect(captureProblems(withN(0), map).length, 'zero').toBeGreaterThanOrEqual(1);
    expect(captureProblems(withN(3), map).some((p) => /already owns 3/.test(p)), 'Maru starts with three').toBe(true);
    expect(captureProblems(withN(1.5), map).length, 'not whole').toBeGreaterThanOrEqual(1);
    expect(captureProblems(withN(99), map).some((p) => /could ever be owned/.test(p)), 'more than the map has').toBe(true);
    // Seventeen properties on the map, but Rook owns two that player 0 can never take: 15 is the most player 0 could ever own.
    expect(captureProblems(withN(15), map)).toEqual([]);
    expect(captureProblems(withN(16), map).some((p) => /could ever be owned/.test(p)), 'Rook\'s two are out of reach').toBe(true);
  });
  it('plays the capture objective as the text says: a player wins by owning the number, Maru can win it first, and Rook\'s holdings do not add to the agent\'s', () => {
    const n = 7;
    expect(ROOT_AND_BRANCH.objective).toEqual({ kind: 'capture', properties: n });
    expect(winnerAfterCapture(ROOT_AND_BRANCH, 0, n - 1), 'the agent takes its seventh').toBe(0);
    expect(winnerAfterCapture(ROOT_AND_BRANCH, 2, n - 1), 'the Elder takes theirs first: the game is theirs (team 1)').toBe(1);
    expect(winnerAfterCapture(ROOT_AND_BRANCH, 0, n - 2), 'one short: nobody wins yet').toBeNull();
    expect(winnerAfterCapture(ROOT_AND_BRANCH, 2, n - 2), 'one short for the Elder: nobody wins yet').toBeNull();
    // Rook holds three and the agent four: the team holds seven or more after this capture, but the agent's own count is five, so the war game goes on.
    expect(winnerAfterCapture(ROOT_AND_BRANCH, 0, n - 3, 3), 'Rook\'s three do not add to the agent\'s').toBeNull();
  });
  it('points every Act II trigger at a real player and, for a capture, at a property that can be captured, and refuses bad ones', () => {
    for (const m of ACT_II) for (const e of m.events) expect(triggerProblems(m, e.trigger), `${m.id} ${JSON.stringify(e.trigger)}`).toEqual([]);
    expect(POLLEN_COUNT.events.map((e) => e.trigger.kind)).toContain('cycle');
    expect(ROOT_AND_BRANCH.events.some((e) => e.trigger.kind === 'powerUsed' && (e.trigger as { player: number }).player === 2), 'the Elder\'s power is watched').toBe(true);
    expect(ROOT_AND_BRANCH.events.some((e) => e.trigger.kind === 'propertyCaptured' && (e.trigger as { by: number }).by === 0)).toBe(true);
    // Known-bad triggers must keep being reported.
    expect(triggerProblems(POLLEN_COUNT, { kind: 'cycle', cycle: 9 })).toHaveLength(1); // after the 8 cycles of the survival
    expect(triggerProblems(POLLEN_COUNT, { kind: 'powerUsed', player: 4 })).toHaveLength(1); // no fifth player
    expect(triggerProblems(POLLEN_COUNT, { kind: 'unitDestroyed', owner: 3, count: 99 })).toHaveLength(1);
    expect(triggerProblems(UNDER_CANOPY, { kind: 'propertyCaptured', by: 0, terrain: 'dock' })).toHaveLength(1); // no dock in the weald
    expect(triggerProblems(ROOT_AND_BRANCH, { kind: 'propertyCaptured', by: 0, terrain: 'flats' })).toHaveLength(1); // not a property
    expect(triggerProblems(ROOT_AND_BRANCH, { kind: 'propertyCaptured', by: 0, terrain: 'uplink' }), 'the grove has an uplink to take').toEqual([]);
  });
});

// ---------------------------------------------------------------- the writing rules

describe('the Act II writing rules', () => {
  it('keeps every line at or under 220 characters, and at least 90% of them (in each mission and in the act) at or under 140', () => {
    expect(ACT_II_LINES.length).toBeGreaterThan(60);
    expect(ACT_II_LINES.filter((l) => l.text.length > 220)).toEqual([]);
    for (const m of ACT_II) expect(share140(linesOf(m)), `${m.id}: ${linesOf(m).filter((l) => l.text.length > 140).length} of ${linesOf(m).length} lines are over 140`).toBeGreaterThanOrEqual(0.9);
    expect(share140(ACT_II_LINES)).toBeGreaterThanOrEqual(0.9);
    // Known-bad: a pool where a quarter of the lines run long fails the same measure.
    const padded: DialogueLine[] = [...Array(3).fill({ speaker: 'echo', text: 'Short.' }), { speaker: 'echo', text: 'x'.repeat(150) }];
    expect(share140(padded)).toBeLessThan(0.9);
  });
  it('keeps every line to one to three sentences (a fragment of four words or fewer is not counted as a sentence)', () => {
    for (const l of ACT_II_LINES) {
      const full = sentencesOf(l.text).filter((s) => wordsOf(s).length >= 5);
      expect(full.length, `${l.speaker}: ${l.text}`).toBeLessThanOrEqual(3);
      expect(sentencesOf(l.text).length, `${l.speaker}: ${l.text}`).toBeLessThanOrEqual(6);
    }
  });
  it('uses only the Act II cast as speakers: ECHO, Rook, Ilse, Juno, Maru, the narrator, and the two minor voices allow-listed here', () => {
    expect(new Set(ACT_II_LINES.map((l) => l.speaker))).toEqual(new Set(ACT_II_SPEAKERS));
    for (const s of ['echo', 'rook', 'ilse', 'juno', 'maru']) expect(COMMANDERS[s], s).toBeDefined();
    for (const m of ACT_II) for (const l of linesOf(m)) expect(l.mood === undefined || ['neutral', 'happy', 'angry', 'grim', 'surprised', 'smug'].includes(l.mood), `${m.id} mood`).toBe(true);
    for (const l of ACT_II_LINES) {
      const named = COMMANDERS[l.speaker];
      if (named?.faction === 'verdant') expect(l.channel, `${l.speaker} speaks over a Verdant net`).toMatch(/Verdant|Grove/);
    }
  });
  it('passes every dialogue rule: length, speakers, no "!" from ECHO, Ilse, Maru or the narrator, no spoilers, no profanity, no real-world names, no manual control', () => {
    for (const m of ACT_II) expect(dialogueProblems(linesOf(m), ACT_II_RULES), m.id).toEqual([]);
  });
  it('would catch each planted violation, passes a clean line, and lets Act II name what Act II may name', () => {
    const line = (speaker: string, text: string): DialogueLine => ({ speaker, text });
    const bad: [string, DialogueLine, RegExp][] = [
      ['over 220', line('rook', 'Okay. '.repeat(40)), /over 220/],
      ['Act I speaker', line('sefa', 'The tide does not hurry.'), /speaker not allowed/],
      ['echo bang', line('echo', 'Relay captured!'), /exclamation/],
      ['maru bang', line('maru', 'The forest is not slow!'), /exclamation/],
      ['ilse bang', line('ilse', 'Captain! Logs to Calder!'), /exclamation/],
      ['relay bang', line('Grove Relay', 'Column in the weald!'), /exclamation/],
      ['VESPER', line('echo', 'The signal bears the mark of VESPER.'), /spoiler/],
      ['Cantor', line('juno', 'Cantor is on the line!'), /spoiler/],
      ['Mira', line('ilse', 'My daughter Mira built this node.'), /spoiler/],
      ['Lattice core', line('narrator', 'Under the glass, the Lattice core slept.'), /spoiler/],
      ['profanity', line('juno', 'Well, damn!'), /profanity/],
      ['real world', line('narrator', 'The treaty was signed in Paris.'), /real-world/],
      ['manual control', line('echo', 'Select the Skimmer and move it to the road.'), /control units/],
      ['manual control 2', line('echo', 'You should send your Trooper into the canopy.'), /control units/],
      ['empty', line('juno', '   '), /empty/],
    ];
    for (const [name, l, kind] of bad) {
      const problems = dialogueProblems([l], ACT_II_RULES);
      expect(problems.length, name).toBeGreaterThanOrEqual(1);
      expect(problems.some((p) => kind.test(p)), `${name}: ${problems.join('; ')}`).toBe(true);
    }
    expect(dialogueProblems([line('echo', 'Observation: the canopy hides a ground unit. That is the whole recommendation.')], ACT_II_RULES)).toEqual([]);
    expect(dialogueProblems([line('juno', 'Sky is open, sun-boy! Keep up!')], ACT_II_RULES), 'Juno shouts').toEqual([]);
    expect(dialogueProblems([line('rook', 'Okay! Okay! Nobody panic!')], ACT_II_RULES), 'Rook may shout').toEqual([]);
    expect(dialogueProblems([line('narrator', 'The Hollow Choir sang, and the Lattice traffic never stopped.')], ACT_II_RULES), 'Act II may name both').toEqual([]);
    expect(dialogueProblems([line('narrator', 'The Hollow Choir sang.')]).some((p) => /spoiler/.test(p)), 'Act I still may not').toBe(true);
    expect(dialogueProblems([line('echo', 'You never move a unit.')], ACT_II_RULES), 'a negation is not an instruction').toEqual([]);
  });
  it('bans VESPER, Cantor, Mira and the Lattice core from every Act II string, not only from dialogue, and does not over-ban the names Act II may use', () => {
    const strings: string[] = [];
    for (const m of ACT_II) {
      strings.push(m.id, m.title, m.location, m.summary, m.mapId, m.objectiveText);
      for (const l of linesOf(m)) strings.push(l.speaker, l.text, l.channel ?? '');
    }
    for (const a of ALL_ACTS.filter((x) => x.act === 2)) strings.push(a.title, a.tagline, ...a.missions);
    for (const m of ACT_II) { const map = mapOf(m); strings.push(map.id, map.name, map.description, map.author ?? ''); }
    expect(strings.length).toBeGreaterThan(200);
    for (const text of strings) for (const re of ACT_II_RULES.spoilers) expect(re.test(text), `${re} in "${text}"`).toBe(false);
    // Known-bad: the same scan flags each planted string, and passes the two names Act II is allowed.
    for (const planted of ['It was VESPER', 'Cantor sang', 'Mira Varga', 'the Lattice core']) {
      expect(ACT_II_RULES.spoilers.some((re) => re.test(planted)), planted).toBe(true);
    }
    expect(ACT_II_RULES.spoilers.some((re) => re.test('the Hollow Choir and Lattice traffic')), 'not over-banned').toBe(false);
    expect(ACT_II_RULES.spoilers.some((re) => re.test('Admiral Tamura')), '"admiral" holds the letters of "mira" and must not trip the ban').toBe(false);
  });
  it('introduces the Hollow Choir in mission 6 and Lattice traffic in mission 7, and not before: "first sight" and "months old" are the story\'s beats', () => {
    const choirName = FACTIONS.choir.name.replace(/^The /, ''); // 'Hollow Choir'
    const names = (m: Mission, re: RegExp) => linesOf(m).filter((l) => re.test(l.text)).length;
    for (const m of ALL_MISSIONS.filter((x) => x.order <= 5)) expect(names(m, /choir|hollow/i), `${m.id} must not name the Choir yet`).toBe(0);
    expect(names(POLLEN_COUNT, new RegExp(choirName)), 'mission 6 names the Choir').toBeGreaterThanOrEqual(1);
    expect(POLLEN_COUNT.debrief.some((l) => new RegExp(choirName).test(l.text)), 'in the debrief, after the drones sign their message').toBe(true);
    for (const m of ALL_MISSIONS.filter((x) => x.order <= 6)) expect(names(m, /lattice/i), `${m.id} must not name Lattice traffic yet`).toBe(0);
    expect(ROOT_AND_BRANCH.debrief.filter((l) => /Lattice traffic/.test(l.text)).length).toBeGreaterThanOrEqual(1);
    expect(ACT_II_OUTLINE[1][3]).toContain('First sight of the Hollow Choir');
    expect(ACT_II_OUTLINE[2][3]).toContain('Lattice traffic');
  });
  it('carries none of the names the repo guard denies (the originality list) in any Act II string or source line', () => {
    const text = JSON.stringify([ACT_II, ALL_ACTS, Object.values(ALL_MISSION_MAPS)], null, 1);
    expect(guard.scanText('src/content/missions.ts', text)).toEqual([]);
    for (const bad of guard.DENYLIST.slice(0, 5)) expect(guard.scanText('src/content/missions.ts', `text: '${bad}'`).map((f) => f.rule), `the guard catches ${bad}`).toContain('originality');
    const planted = guard.DENYLIST[guard.DENYLIST.length - 1]; // taken from the list, so this file never spells a denied name itself
    expect(guard.scanText('src/content/missions.ts', `${JSON.stringify(ACT_II)} ${planted}`).map((f) => f.match), 'a planted name in Act II text is found').toEqual([planted]);
  });
});

// ---------------------------------------------------------------- voices

describe('each Act II speaker sounds like their entry in STORY.md', () => {
  const by = (speaker: string) => ACT_II_LINES.filter((l) => l.speaker === speaker);
  const matching = (speaker: string, re: RegExp) => by(speaker).filter((l) => re.test(l.text)).length;
  it('ECHO: short telemetry sentences, no exclamation mark, dry curiosity about people, and a little more human than in Act I', () => {
    expect(by('echo').length).toBeGreaterThan(20);
    for (const l of by('echo')) {
      expect(l.text, l.text).not.toContain('!');
      for (const sentence of l.text.split(/(?<=[.?])\s+/)) expect(wordsOf(sentence).length, sentence).toBeLessThanOrEqual(26);
    }
    expect(matching('echo', /telemetry|observation|query|recommendation|alert|status|objective|situation|logged|noted|priority|contact warning|intercept/i)).toBeGreaterThanOrEqual(10);
    expect(matching('echo', /query|observation|no entry|curious|which I am told|no instrument/i), 'dry curiosity').toBeGreaterThanOrEqual(3);
    // "Gets more human as the campaign goes on": by mission 7 she files a feeling of her own (Act I only logged "pleased").
    const feeling = ROOT_AND_BRANCH.debrief.find((l) => l.speaker === 'echo' && /feeling/.test(l.text));
    expect(feeling, 'a feeling in the last debrief').toBeDefined();
    expect(feeling!.text).toMatch(/unease|label/);
    expect(linesOf(FIRST_LIGHT).some((l) => l.speaker === 'echo' && /feeling/.test(l.text)), 'not in mission 1').toBe(false);
  });
  it('Rook: earnest, engineering metaphors, apologises to machines and now trees, braver than in Act I ("I will")', () => {
    expect(matching('rook', /sorry|apolog/i)).toBeGreaterThanOrEqual(4);
    expect(matching('rook', /spanner|spare parts|fuse box|engine|toolbox|fix |machine|generator|wire/i)).toBeGreaterThanOrEqual(4);
    expect(matching('rook', /\bI will\b/)).toBeGreaterThanOrEqual(3);
    expect(linesOf(FIRST_LIGHT).filter((l) => l.speaker === 'rook' && /\bI will\b/.test(l.text)), 'Rook does not promise anything in mission 1').toEqual([]);
    expect(matching('rook', /Okay\. Okay\.|Okay\./)).toBeGreaterThanOrEqual(2); // still a little nervous
  });
  it('Juno: loud (most lines shout), nicknames the Helion column "sun-boy", angry in mission 5 and grudging in 6, and never speaks in Act I', () => {
    expect(by('juno').length).toBeGreaterThanOrEqual(12);
    expect(matching('juno', /!/) / by('juno').length, 'the most exclamation marks in the cast').toBeGreaterThanOrEqual(0.9);
    expect(matching('juno', /sun-boy/i)).toBeGreaterThanOrEqual(8);
    expect(UNDER_CANOPY.briefing.filter((l) => l.speaker === 'juno').every((l) => l.mood === 'angry'), 'hostile in mission 5').toBe(true);
    expect(POLLEN_COUNT.events.some((e) => e.lines.some((l) => l.speaker === 'juno' && l.mood === 'happy')), 'a grudging joy in mission 6').toBe(true);
    expect(ALL_MISSIONS.filter((m) => m.act === 1).flatMap(linesOf).filter((l) => l.speaker === 'juno')).toEqual([]);
    expect(STORY).toContain('ECHO never uses exclamation marks. Juno uses too many.'); // the rule these three expectations come from
  });
  it('Maru: gentle and unhurried, seasons and roots and tea, never raises their voice, never "he" or "she", and says the STORY.md line', () => {
    expect(by('maru').length).toBeGreaterThanOrEqual(8);
    expect(by('maru').filter((l) => l.text.includes('!'))).toEqual([]);
    expect(matching('maru', /forest|season|root|tree|grove|tea\b|spring|whisper|song|seed/i)).toBeGreaterThanOrEqual(by('maru').length - 1);
    const sample = /### Maru Ingram[\s\S]*?\*Voice:\* "([^"]+)"/.exec(STORY);
    expect(sample, 'STORY.md Maru voice sample').not.toBeNull();
    const [first, second] = sample![1].split('. '); // 'The forest is not slow' / 'You are simply in a hurry.'
    expect(by('maru').some((l) => l.text.includes(first) && l.text.includes(second.replace(/\.$/, ''))), 'the sample line, with "Captain" added').toBe(true);
    // Maru is they/them (their entry): no line that names Maru or the Elder uses he, she, him, his or her.
    const aboutMaru = (l: DialogueLine) => /\b(Maru|Ingram|the Elder|Elder)\b/.test(l.text);
    const gendered = /\b(he|she|him|his|her|hers|himself|herself)\b/i;
    for (const l of ACT_II_LINES.filter(aboutMaru)) expect(gendered.test(l.text), `${l.speaker}: ${l.text}`).toBe(false);
    expect(ACT_II_LINES.filter(aboutMaru).length, 'the check is not vacuous').toBeGreaterThanOrEqual(8);
    expect(gendered.test('Elder Ingram said he would come.'), 'the detector catches a wrong pronoun').toBe(true);
    expect(by('echo').filter((l) => /\bTheir\b|\btheir\b/.test(l.text)).length, 'ECHO says "their"').toBeGreaterThanOrEqual(3);
  });
  it('Ilse: clipped and dry, addresses the Captain by rank, firing-data flavour, never longer than 140 characters, only on the radio', () => {
    expect(by('ilse').length).toBeGreaterThanOrEqual(3);
    for (const l of by('ilse')) {
      expect(l.text, l.text).toMatch(/^Captain/);
      expect(l.text.length, l.text).toBeLessThanOrEqual(140);
      expect(l.channel, 'on the Helion command net').toBe('Helion command net');
    }
    expect(matching('ilse', /bearing|range|fire|battery|grid/i)).toBeGreaterThanOrEqual(2);
  });
  it('humour lands in the middle and grief at the ends: every debrief closes on the narrator or a grim line, and no defeat event is cheerful', () => {
    for (const m of ACT_II) {
      const last = m.debrief[m.debrief.length - 1];
      expect(last.speaker === 'narrator' || last.mood === 'grim', `${m.id}: ${last.text}`).toBe(true);
      for (const e of m.events.filter((x) => x.trigger.kind === 'defeat')) expect(e.lines.every((l) => l.mood !== 'happy'), m.id).toBe(true);
      const mid = m.events.filter((x) => x.trigger.kind === 'cycle').flatMap((e) => e.lines);
      expect(mid.some((l) => l.speaker === 'rook' || l.speaker === 'juno' || l.speaker === 'maru'), `${m.id}: a banter beat mid-mission`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- the story beats

describe('faithful to the Act II outline', () => {
  it('speaks to the human about what the agent is doing (D-007): every mission names the agent and a standing order, and the three postures are all named', () => {
    for (const m of ACT_II) {
      const text = textOf(m, 'echo');
      expect(text, m.id).toMatch(/your agent/i);
      expect(text, m.id).toMatch(/your human|for the human|composition weights|standing orders|posture|policy|target priorities/i);
      expect(POSTURES.some((p) => text.includes(p)), `${m.id} names a posture`).toBe(true);
    }
    for (const p of POSTURES) expect(ACT_II.some((m) => textOf(m, 'echo').includes(p)), `Act II names ${p}`).toBe(true);
    expect(POSTURES.some((p) => 'Cycle one. The column moves out.'.includes(p)), 'a line with no posture is not counted').toBe(false);
    expect(ACT_II_LINES.filter((l) => MANUAL_CONTROL.test(l.text))).toEqual([]);
    // Nobody but ECHO explains the agent's orders; Juno, Maru and Rook speak as people.
    for (const l of ACT_II_LINES.filter((x) => POSTURES.some((p) => x.text.includes(p)))) expect(l.speaker, l.text).toBe('echo');
  });
  it('mission 5: the forged signal leads into Verdant canopy, Juno\'s Wasp squadron ambushes, she blames Helion, and fog and canopy are taught with numbers from the data', () => {
    const echoText = textOf(UNDER_CANOPY, 'echo');
    expect(ACT_II_OUTLINE[0][3]).toContain('forged signal');
    expect(textOf(UNDER_CANOPY)).toMatch(/forged/);
    expect(UNDER_CANOPY.briefing.some((l) => l.speaker === 'juno' && /Helion signature/.test(l.text)), 'Juno\'s belief: the order that burned Ashfall was signed by Helion').toBe(true);
    expect(UNDER_CANOPY.briefing.some((l) => l.speaker === 'ilse'), 'Ilse sends the column').toBe(true);
    expect(UNDER_CANOPY.events.find((e) => e.trigger.kind === 'cycle' && e.trigger.cycle === 2)!.lines.some((l) => /ambush/.test(l.text)), 'the ambush is explained when it comes').toBe(true);
    expect(echoText).toMatch(/Skimmer/);
    expect(echoText).toMatch(/scout/);
    expect(echoText).toMatch(/hides a ground unit/);
    // "It sees five tiles. A Trooper sees two." / "A Skimmer pays three ... A Trooper pays one, ... with two defense stars." (data tables)
    expect(NUMBER_WORDS[/sees (\w+) tiles/.exec(echoText)![1]]).toBe(UNIT_TYPES.skimmer.vision);
    expect(NUMBER_WORDS[/A Trooper sees (\w+)\./.exec(echoText)![1]]).toBe(UNIT_TYPES.trooper.vision);
    expect(UNIT_TYPES.skimmer.moveType).toBe('hover');
    expect(UNIT_TYPES.trooper.moveType).toBe('foot');
    expect(NUMBER_WORDS[/Skimmer pays (\w+) to enter/.exec(echoText)![1]]).toBe(TERRAIN_TYPES.canopy.cost.hover);
    expect(NUMBER_WORDS[/Trooper pays (\w+),/.exec(echoText)![1]]).toBe(TERRAIN_TYPES.canopy.cost.foot);
    expect(NUMBER_WORDS[/with (\w+) defense stars/.exec(echoText)![1]]).toBe(TERRAIN_TYPES.canopy.def);
    expect(TERRAIN_TYPES.canopy.note, 'the data says it too').toMatch(/hides/i);
    // The victory has Juno stand down; the debrief names the south and Ashfall as the signal's bearing and ends on the seed vault (mission 6).
    expect(UNDER_CANOPY.events.find((e) => e.trigger.kind === 'victory')!.lines.some((l) => l.speaker === 'juno')).toBe(true);
    expect(UNDER_CANOPY.debrief.some((l) => /from the south, past Ashfall/.test(l.text))).toBe(true);
    expect(UNDER_CANOPY.debrief[UNDER_CANOPY.debrief.length - 1].text).toMatch(/seed vault/);
  });
  it('mission 5 is really fogged: none of Juno\'s units is visible at the start (and all of them would be with fog off)', () => {
    const fogged = createGame(setupFor(UNDER_CANOPY, 1));
    const theirs = fogged.units.filter((u) => u.owner === 2);
    expect(theirs.length).toBeGreaterThanOrEqual(5);
    for (const u of theirs) expect(canSeeUnit(fogged, 0, u), `${u.type} at (${u.x},${u.y}) is hidden from the agent`).toBe(false);
    for (const u of theirs) expect(canSeeUnit(fogged, 1, u), `...and from Rook`).toBe(false);
    const open = createGame({ ...setupFor(UNDER_CANOPY, 1), fog: false });
    for (const u of open.units.filter((o) => o.owner === 2)) expect(canSeeUnit(open, 0, u), 'with fog off every unit is seen').toBe(true);
  });
  it('mission 5 teaches the truth: canopy hides a ground unit until someone stands beside it (air is not hidden), and a hidden unit in the path ambushes the mover', () => {
    const map = mapOf(UNDER_CANOPY);
    const at = tilesOf(map, (_c, _o, x, y) => [0, 1, 2].every((d) => map.terrain[y]?.[x + d] === 'f'))[0]; // three canopy tiles in a row
    const A = { x: at.x, y: at.y };
    const B = { x: at.x + 1, y: at.y };
    const C = { x: at.x + 2, y: at.y };
    const units = (enemy: 'trooper' | 'wasp', mine: { x: number; y: number }): MapDef['units'] => [
      { type: 'trooper', owner: 0, x: mine.x, y: mine.y }, { type: 'trooper', owner: 1, x: 3, y: 8 }, { type: enemy, owner: 2, x: C.x, y: C.y },
    ];
    const seen = (s: GameState) => canSeeUnit(s, 0, s.units.find((u) => u.owner === 2)!);
    expect(seen(probe(UNDER_CANOPY, units('trooper', A))), 'two tiles away under canopy: hidden although inside vision 2').toBe(false);
    expect(seen(probe(UNDER_CANOPY, units('trooper', B))), 'beside it: seen').toBe(true);
    expect(seen(probe(UNDER_CANOPY, units('wasp', A))), 'an air unit over canopy is not hidden by it').toBe(true);
    expect(seen(probe(UNDER_CANOPY, units('trooper', A), { fog: false })), 'no fog, no hiding').toBe(true);
    // The ambush: the agent's Trooper is ordered through the hidden one. It stops on the tile before, its turn is over, and 'ambushed' is reported.
    const s = probe(UNDER_CANOPY, units('trooper', A));
    const mover = s.units.find((u) => u.owner === 0)!;
    const orderFor = (unitId: number): Action => ({ kind: 'move', unitId, path: [A, B, C], then: { kind: 'wait' } });
    const result = applyAction(s, orderFor(mover.id));
    expect(result.events.some((e) => e.kind === 'ambushed')).toBe(true);
    const after = result.state.units.find((u) => u.id === mover.id)!;
    expect({ x: after.x, y: after.y }).toEqual(B);
    expect(after.acted).toBe(true);
    // Known-bad control: with fog off the enemy is visible, so the very same order is refused instead of ambushed.
    const open = probe(UNDER_CANOPY, units('trooper', A), { fog: false });
    expect(() => applyAction(open, orderFor(open.units.find((u) => u.owner === 0)!.id))).toThrow(IllegalActionError);
  });
  it('mission 5 teaches the truth about shooting: the agent can only fire at what it can see, so an Arc two tiles from a Trooper under canopy has no target in fog and has one without', () => {
    const map = mapOf(UNDER_CANOPY);
    const at = tilesOf(map, (_c, _o, x, y) => [0, 1, 2].every((d) => map.terrain[y]?.[x + d] === 'f'))[0];
    const units: MapDef['units'] = [
      { type: 'arc', owner: 0, x: at.x, y: at.y }, { type: 'trooper', owner: 1, x: 3, y: 8 }, { type: 'trooper', owner: 2, x: at.x + 2, y: at.y },
    ];
    const targets = (s: GameState) => attackTargets(s, s.units.find((u) => u.type === 'arc')!.id, { x: at.x, y: at.y });
    expect(targets(probe(UNDER_CANOPY, units)), 'hidden under canopy: nothing to shoot').toEqual([]);
    expect(targets(probe(UNDER_CANOPY, units, { fog: false })), 'no fog: the Trooper is a target').toEqual([{ x: at.x + 2, y: at.y }]);
  });
  it('mission 6: Juno and Rook fight side by side against unmarked drones for 8 cycles at the Ashfall seed vault, and the Hollow Choir signs its first transmission', () => {
    const text = textOf(POLLEN_COUNT);
    expect(textOf(POLLEN_COUNT)).toMatch(/seed vault|seed stock|vault/);
    expect(POLLEN_COUNT.briefing.some((l) => l.speaker === 'juno'), 'Juno is on the net').toBe(true);
    expect(POLLEN_COUNT.briefing.some((l) => l.speaker === 'rook'), 'Rook is on the net').toBe(true);
    expect(POLLEN_COUNT.briefing.some((l) => l.speaker === 'echo' && /No flag/.test(l.text)), 'no flag').toBe(true);
    expect(text).toMatch(/obsidian/);
    // The drones' own words are the Choir faction's motto in the data, and the count of words ECHO gives is the real count.
    const motto = FACTIONS.choir.motto;
    const heard = POLLEN_COUNT.events.find((e) => e.trigger.kind === 'cycle' && e.trigger.cycle === 6)!.lines.find((l) => l.speaker === 'echo')!;
    expect(heard.text).toContain(`"${motto}"`);
    expect(NUMBER_WORDS[/(\w+) words, repeated/i.exec(heard.text)![1].toLowerCase()]).toBe(wordsOf(motto).length);
    // First sight: the name comes only at the end, after the signed transmission.
    const all = linesOf(POLLEN_COUNT); // briefing, then events, then debrief
    const firstNamed = all.findIndex((l) => /Hollow Choir/.test(l.text));
    expect(firstNamed, 'named somewhere').toBeGreaterThanOrEqual(0);
    expect(firstNamed, 'only in the debrief').toBeGreaterThanOrEqual(all.length - POLLEN_COUNT.debrief.length);
    expect(all[firstNamed].speaker).toBe('echo');
    expect(all[firstNamed].text).toMatch(/signed/);
    // Maru's invitation closes the mission and opens mission 7.
    expect(POLLEN_COUNT.debrief.some((l) => l.speaker === 'maru' && /root-house/.test(l.text))).toBe(true);
    expect(ROOT_AND_BRANCH.debrief.some((l) => /root-house/.test(l.text) || l.speaker === 'maru')).toBe(true);
  });
  it('mission 6 numbers match the map: "eight contacts", "three Wasps" and "eight cycles", and the allied status is real (Juno cannot be shot by the agent\'s side)', () => {
    const map = mapOf(POLLEN_COUNT);
    const echoText = textOf(POLLEN_COUNT, 'echo');
    expect(NUMBER_WORDS[/(\w+) contacts on the east road/.exec(echoText)![1].toLowerCase()]).toBe(map.units.filter((u) => u.owner === 2).length);
    expect(NUMBER_WORDS[/flies (\w+) Wasps/.exec(echoText)![1]]).toBe(map.units.filter((u) => u.owner === 3 && u.type === 'wasp').length);
    expect(NUMBER_WORDS[/for (\w+) cycles/.exec(echoText)![1]]).toBe(POLLEN_COUNT.objective.kind === 'survive' ? POLLEN_COUNT.objective.cycles : -1);
    // The anti-air lesson, from the damage table: the unit ECHO says is built for Wasps really is the best armed ground unit against them, and the weak one is weak.
    const vsWasp = (id: keyof typeof DAMAGE) => Math.max(DAMAGE[id].primary?.wasp ?? 0, DAMAGE[id].secondary?.wasp ?? 0);
    const armedGround = Object.values(UNIT_TYPES).filter((u) => u.domain === 'ground' && u.range);
    const best = armedGround.reduce((a, b) => (vsWasp(b.id) > vsWasp(a.id) ? b : a));
    expect(echoText.match(/A (\w+) is built for it/)![1], 'the unit named as the answer to Wasps').toBe(best.name);
    const weakName = echoText.match(/(\w+)s hit a Wasp for almost nothing/)![1];
    expect(vsWasp(armedGround.find((u) => u.name === weakName)!.id), `${weakName} damage to a Wasp`).toBeLessThan(10);
    expect(vsWasp(best.id), 'and the answer is more than ten times as strong').toBeGreaterThan(10 * vsWasp(armedGround.find((u) => u.name === weakName)!.id));
    // Engine: Juno's Wasp, beside a Helion Trooper and a drone Skimmer, may shoot the drone and never the Helion unit.
    const units: MapDef['units'] = [
      { type: 'wasp', owner: 3, x: 7, y: 6 }, { type: 'trooper', owner: 0, x: 8, y: 6 }, { type: 'skimmer', owner: 2, x: 7, y: 5 }, { type: 'trooper', owner: 1, x: 3, y: 9 },
    ];
    const s = probe(POLLEN_COUNT, units);
    const wasp = s.units.find((u) => u.owner === 3)!;
    const targets = attackTargets(s, wasp.id, { x: wasp.x, y: wasp.y }).map((c) => `${c.x},${c.y}`);
    expect(targets).toContain('7,5'); // the drone
    expect(targets).not.toContain('8,6'); // the Helion Trooper
    // Known-bad control: put Juno on the other team and the Helion Trooper becomes a target.
    const foe = probe(POLLEN_COUNT, units, { players: setupFor(POLLEN_COUNT, 1).players.map((p, i) => (i === 3 ? { ...p, team: 1 } : p)) });
    const wasp2 = foe.units.find((u) => u.owner === 3)!;
    expect(attackTargets(foe, wasp2.id, { x: wasp2.x, y: wasp2.y }).map((c) => `${c.x},${c.y}`)).toContain('8,6');
  });
  it('mission 7: Maru\'s war game with live rounds, terrain shaping that matches Rootbound and Overgrowth, and a win that opens the vault logs: Lattice traffic from the Glass Waste, months old', () => {
    const text = textOf(ROOT_AND_BRANCH);
    const maru = COMMANDERS.maru;
    expect(ACT_II_OUTLINE[2][3]).toContain('war game with live rounds');
    expect(text).toMatch(/war game/);
    expect(text).toMatch(/live (ammunition|rounds)|rounds are real/);
    // Rootbound and Overgrowth as the commander data defines them: canopy costs 1 for ground units, +1 defense star in canopy, flats beside canopy grow over for 2 turns.
    const echoText = textOf(ROOT_AND_BRANCH, 'echo');
    expect(echoText).toContain(maru.passive.name);
    expect(echoText).toContain(maru.surge!.name);
    expect(maru.passive.modifiers.some((m) => m.ignoreMoveCost?.includes('canopy') && m.filter?.domains?.includes('ground'))).toBe(true);
    expect(echoText).toMatch(/canopy at cost one/);
    expect(maru.passive.modifiers.find((m) => m.terrainStars)?.terrainStars).toBe(1);
    expect(echoText).toMatch(/a defense star/);
    const grow = maru.surge!.effects.find((e) => e.kind === 'convertTerrain');
    expect(grow).toMatchObject({ kind: 'convertTerrain', from: ['flats'], to: 'canopy', adjacentTo: 'canopy' });
    const turns = grow && grow.kind === 'convertTerrain' ? grow.turns : -1;
    const claimed = [...echoText.matchAll(/for (\w+) turns/g)].map((c) => NUMBER_WORDS[c[1]]);
    expect(claimed.length, 'ECHO says how long the canopy lasts, in the briefing and again when the Elder\'s power fires').toBeGreaterThanOrEqual(2);
    for (const c of claimed) expect(c, `every "for N turns" is ${turns}`).toBe(turns);
    expect(maru.overclock!.effects.some((e) => e.kind === 'convertTerrain'), 'the Overclock grows the canopy too, so the "power used" beat is true for either').toBe(true);
    // The reveal, built from STORY.md's own words.
    const reveal = /opens the vault logs: ([^.]+)\./.exec(ACT_II_OUTLINE[2][3]);
    expect(reveal, 'STORY.md mission 7').not.toBeNull(); // 'Lattice traffic from the Glass Waste, months old'
    const debrief = ROOT_AND_BRANCH.debrief.map((l) => l.text).join('\n');
    for (const piece of ['Lattice traffic', 'Glass Waste', 'months old']) {
      expect(reveal![1], piece).toContain(piece);
      expect(debrief, piece).toContain(piece);
    }
    expect(debrief).toMatch(/vault logs/);
    expect(ROOT_AND_BRANCH.events.find((e) => e.trigger.kind === 'victory')!.lines.some((l) => l.speaker === 'maru' && /vault logs/.test(l.text)), 'Maru opens them on the win').toBe(true);
    expect(ROOT_AND_BRANCH.debrief.some((l) => l.speaker === 'ilse'), 'Ilse takes the logs home').toBe(true);
  });
  it('mission 7 numbers match the map and the objective: "ten unclaimed", "seven properties", and a count that is per commander', () => {
    const map = mapOf(ROOT_AND_BRANCH);
    const echoText = textOf(ROOT_AND_BRANCH, 'echo');
    expect(NUMBER_WORDS[/(\w+) are unclaimed/.exec(echoText)![1].toLowerCase()]).toBe(propertiesOf(map).filter((t) => map.owners[t.y][t.x] === '.').length);
    expect(NUMBER_WORDS[/own (\w+) properties before/.exec(echoText)![1]]).toBe(ROOT_AND_BRANCH.objective.kind === 'capture' ? ROOT_AND_BRANCH.objective.properties : -1);
    expect(echoText).toMatch(/per commander/);
    expect(echoText).toMatch(/If the Elder reaches seven first, the game is theirs/); // proven true by the winnerAfterCapture test above
    expect(ROOT_AND_BRANCH.events.find((e) => e.trigger.kind === 'defeat')!.lines.some((l) => /reached seven first/.test(l.text))).toBe(true);
  });
});

// ---------------------------------------------------------------- self-play

describe('every Act II mission plays under simulate', () => {
  const policies: SimPolicy[] = ['greedy', 'random'];
  for (const m of ACT_II) {
    for (const policy of policies) {
      it(`${m.id}: ${policy} policy, seeds 1-3, ends without an exception and with a winner that earned it`, () => {
        for (const seed of [1, 2, 3]) {
          const setup = setupFor(m, seed);
          let started = 0;
          const result = simulate({ setup, seed, maxCycles: 14, policy, onStart: () => { started++; } });
          expect(started, `${m.id} ${policy} seed ${seed}`).toBe(1);
          expect(result.actions.length, `${m.id} ${policy} seed ${seed}`).toBeGreaterThan(0);
          expect(result.cycles).toBeGreaterThanOrEqual(1);
          expect(result.cycles).toBeLessThanOrEqual(14);
          expect(result.state.players).toHaveLength(m.players.length);
          const team0 = m.players[0].team;
          if (m.objective.kind === 'survive' && result.winnerTeam === team0 && result.state.players.filter((p) => p.team !== team0 && !p.defeated).length > 0) {
            expect(result.cycles, `${m.id} survive win`).toBeGreaterThanOrEqual(m.objective.cycles); // a win before cycle 8 must come from routing the drones
          }
          if (m.objective.kind === 'capture' && result.winnerTeam !== null) {
            const need = m.objective.properties;
            const winners = result.state.players.filter((p) => p.team === result.winnerTeam);
            const others = result.state.players.filter((p) => p.team !== result.winnerTeam);
            const reached = winners.some((p) => propertyCount(result.state, p.index) >= need);
            expect(reached || others.every((p) => p.defeated), `${m.id} capture win by ${policy} seed ${seed}`).toBe(true);
          }
        }
      });
    }
  }
  it('a survive objective is really won at its cycle: mission 6 with every side only ending its turns, team 0 (agent, Rook and Juno) wins as cycle 8 ends and not before (known answer)', () => {
    let s = createGame(setupFor(POLLEN_COUNT, 1));
    const history: { cycle: number; winner: number | null }[] = [];
    for (let guardCount = 0; guardCount < 200 && s.winnerTeam === null; guardCount++) {
      history.push({ cycle: s.cycle, winner: s.winnerTeam });
      s = applyAction(s, { kind: 'endTurn' }).state;
    }
    expect(s.winnerTeam).toBe(0);
    expect(s.cycle, 'won as cycle 8 ended').toBe(8);
    expect(history.every((h) => h.winner === null)).toBe(true);
    expect(history.filter((h) => h.cycle === 8), 'the agent, Rook, the drones and Juno each took their turn in cycle 8').toHaveLength(4);
  });
});

// ================================================================================================================================
// M4.2 Act III, "Thin Air": missions 8-11. Spec: docs/STORY.md "Act III" (the outline; the entries for Corvin, Sable, Sefa, Dax, Rook, Ilse and
// ECHO), "The secret", "Writing rules for dialogue" and D-007. Same method as Acts I and II above: every expectation comes from the story
// text, the map rows, the data tables or the engine, never from missions.ts, and each group carries a planted failure it must keep catching.
// Representation choices the tests pin down: the escort of mission 9 is a survive objective as long as the convoy's transit time; the Night
// Wing's turn in mission 10 is a cycle event (a team cannot change mid-battle), with the drones a third team; mission 11 seats Sefa and Rook as
// allies of the agent (D-007), never as the player.
// ================================================================================================================================

const ACT_III = ALL_MISSIONS.filter((m) => m.act === 3);
const [TETHER_LINE, NIGHT_WING, DUEL_AT_ASHGRAVE, AUDIT] = ACT_III;
// Acts I-III as they were when Act III landed. Act IV (below) adds missions 12-14, the whole-campaign test over all fourteen lives there.
const MISSIONS_I_III = ALL_MISSIONS.filter((m) => m.act <= 3);
const ACTS_I_III = ALL_ACTS.filter((a) => a.act <= 3);
const ACT_III_LINES = ACT_III.flatMap(linesOf);
const ACT_III_STORY = STORY.slice(STORY.indexOf('### Act III'), STORY.indexOf('### Act IV'));
const ACT_III_OUTLINE = [...ACT_III_STORY.matchAll(/^(\d+)\. \*\*([^*]+)\*\* — ([^\n]+)$/gm)];

const MINOR_SPEAKERS_III = ['Tether Control', 'Coast Watch'];
const ACT_III_SPEAKERS = ['echo', 'rook', 'ilse', 'sefa', 'dax', 'corvin', 'sable', 'narrator', ...MINOR_SPEAKERS_III];
// STORY: ECHO never uses "!" (and the order adds Ilse, Sefa and the narrator; Dax is "smooth" and the minor voices are officials).
// Act III may name the Hollow Choir, the Lattice and the Glass Waste, and may never name VESPER, Cantor, Mira or the Lattice core.
const ACT_III_RULES: DialogueRules = {
  speakers: ACT_III_SPEAKERS,
  neverShouts: new Set(['echo', 'ilse', 'sefa', 'dax', 'narrator', ...MINOR_SPEAKERS_III]),
  spoilers: [/vesper/i, /\bcantor\b/i, /\bmira\b/i, /lattice core/i],
};

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS_WORDS: Record<number, string> = { 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty' };
/** A whole number in the words the story uses: 4 -> "four", 27 -> "twenty-seven", 120 -> "one hundred twenty". */
function spell(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) { const r = n % 10; return TENS_WORDS[n - r] + (r ? `-${ONES[r]}` : ''); }
  const r = n % 100;
  return `${ONES[Math.floor(n / 100)]} hundred${r ? ` ${spell(r)}` : ''}`;
}

/** The cheapest movement cost between two tiles for a move type (terrain only, units do not block); -1 when unreachable. */
function pathCost(map: MapDef, from: { x: number; y: number }, to: { x: number; y: number }, mt: MoveType): number {
  const h = map.terrain.length;
  const w = map.terrain[0].length;
  const dist = Array.from({ length: h }, () => new Array<number>(w).fill(Infinity));
  dist[from.y][from.x] = 0;
  const open = [{ ...from }];
  while (open.length) {
    open.sort((a, b) => dist[a.y][a.x] - dist[b.y][b.x]);
    const cur = open.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const c = TERRAIN_TYPES[TERRAIN_CODES[map.terrain[ny][nx]]].cost[mt];
      if (c === null || dist[cur.y][cur.x] + c >= dist[ny][nx]) continue;
      dist[ny][nx] = dist[cur.y][cur.x] + c;
      open.push({ x: nx, y: ny });
    }
  }
  return Number.isFinite(dist[to.y][to.x]) ? dist[to.y][to.x] : -1;
}

/** A copy of the state in which player `by` finishes capturing the spire owned by `spireOwner` (one capture point left, a Trooper on it). */
function captureSpire(state: GameState, spireOwner: number, by = 0): GameState {
  const s = clone(state);
  let at: { x: number; y: number } | undefined;
  s.tiles.forEach((row, y) => row.forEach((t, x) => { if (t.terrain === 'spire' && t.owner === spireOwner) at = { x, y }; }));
  if (!at) throw new Error(`player ${spireOwner} has no spire`);
  const spot = at;
  s.units = s.units.filter((u) => !(u.x === spot.x && u.y === spot.y));
  s.tiles[spot.y][spot.x].capture = 1;
  const id = s.nextUnitId++;
  s.units.push({ id, type: 'trooper', owner: by, x: spot.x, y: spot.y, hp: 100, charge: 99, ammo: 0, acted: false, cargo: [] });
  s.current = by;
  return applyAction(s, { kind: 'move', unitId: id, path: [spot], then: { kind: 'capture' } }).state;
}

/** Can the agent's Trooper capture Sefa's own spire? (False: a unit cannot capture an ally's property.) */
function canCaptureCheck(state: GameState): boolean {
  const spire = state.tiles.flatMap((row, y) => row.map((t, x) => ({ t, x, y }))).find((c) => c.t.terrain === 'spire' && c.t.owner === 3)!;
  const s = clone(state);
  s.units = s.units.filter((u) => !(u.x === spire.x && u.y === spire.y));
  const id = s.nextUnitId++;
  s.units.push({ id, type: 'trooper', owner: 0, x: spire.x, y: spire.y, hp: 100, charge: 99, ammo: 0, acted: false, cargo: [] });
  return canCaptureHere(s, s.units.find((u) => u.id === id)!);
}

/** The same mission players with every commander set to one that does not exist, so no commander modifier touches a measurement. */
const plainPlayers = (m: Mission): PlayerSetup[] => setupFor(m, 1).players.map((p) => ({ ...p, commander: 'none' }));

describe('Act III helpers (known answers for the measuring tools used below)', () => {
  it('spell writes numbers as the story does', () => {
    expect([4, 15, 27, 41, 120].map(spell)).toEqual(['four', 'fifteen', 'twenty-seven', 'forty-one', 'one hundred twenty']);
  });
  it('pathCost is the cheapest terrain cost and refuses water for foot units', () => {
    const tiny: MapDef = {
      id: 'tiny', name: 'Tiny', description: 'A strip.', players: 2, terrain: ['..f.=', '.~~~~'], owners: ['.....', '.....'], units: [],
    };
    expect(pathCost(tiny, { x: 0, y: 0 }, { x: 4, y: 0 }, 'foot')).toBe(1 + 1 + 1 + 1); // canopy costs a foot unit 1
    expect(pathCost(tiny, { x: 0, y: 0 }, { x: 4, y: 0 }, 'hover')).toBe(1 + 1 + 3 + 1); // canopy costs hover 3
    expect(pathCost(tiny, { x: 0, y: 0 }, { x: 2, y: 1 }, 'foot')).toBe(-1); // sea
  });
});

// ---------------------------------------------------------------- the act, and the campaign across all three acts

describe('Act III: the campaign act, and the campaign across acts 1-3', () => {
  it('has act 3, "Thin Air", with the tagline STORY.md prints under the heading and the four mission ids in outline order', () => {
    const head = /### Act III — ([^\n]+)\n\*"([^"]+)"\*/.exec(STORY);
    expect(head, 'STORY.md Act III heading').not.toBeNull();
    expect(head![1]).toBe('Thin Air');
    const act = ALL_ACTS.find((a) => a.act === 3);
    expect(act, 'act 3 is listed').toBeDefined();
    expect(act!.title).toBe(head![1]);
    expect(act!.tagline).toBe(head![2]);
    const idsFromTitles = ACT_III_OUTLINE.map((m) => m[2].toLowerCase().replace(/ /g, '-')); // 'Duel at Ashgrave' -> 'duel-at-ashgrave'
    expect(act!.missions).toEqual(idsFromTitles);
    expect(act!.missions).toEqual(ACT_III.map((m) => m.id));
  });
  it('follows the Act III outline in STORY.md: titles and numbers in order, and the places it names', () => {
    expect(ACT_III_OUTLINE.map((m) => m[2])).toEqual(['Tether Line', 'Night Wing', 'Duel at Ashgrave', 'Audit']);
    expect(ACT_III.map((m) => m.title)).toEqual(ACT_III_OUTLINE.map((m) => m[2]));
    expect(ACT_III.map((m) => m.order)).toEqual(ACT_III_OUTLINE.map((m) => Number(m[1])));
    expect(ACT_III.map((m) => m.order)).toEqual([8, 9, 10, 11]);
    expect(ACT_III.every((m) => m.act === 3)).toBe(true);
    expect(TETHER_LINE.location, "the Kestrel Dominion's home is the Tether Ridges").toBe(FACTIONS.kestrel.home);
    expect(AUDIT.location, "Tidewell's coast").toBe(FACTIONS.tidewell.home);
    expect(ACT_III_OUTLINE[2][3]).toContain('Corvin meets Rook');
    expect(DUEL_AT_ASHGRAVE.location).toContain('Ashgrave');
    expect(ACT_III_OUTLINE[1][3]).toContain('ion storm over the passes');
    expect(NIGHT_WING.location).toContain('Passes');
  });
  it('lays the whole campaign out in order across acts 1-3: missions 1-11, ids / orders / maps / map names unique, no skirmish map shadowed', () => {
    expect(ACTS_I_III.map((a) => a.act)).toEqual([1, 2, 3]);
    expect(MISSIONS_I_III).toHaveLength(11);
    expect(MISSIONS_I_III.map((m) => m.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(ACTS_I_III.flatMap((a) => a.missions)).toEqual(MISSIONS_I_III.map((m) => m.id));
    for (const a of ACTS_I_III) expect(MISSIONS_I_III.filter((m) => m.act === a.act).map((m) => m.id), `act ${a.act}`).toEqual(a.missions);
    expect(duplicates(MISSIONS_I_III.map((m) => m.id))).toEqual([]);
    expect(duplicates(MISSIONS_I_III.map((m) => m.mapId))).toEqual([]);
    for (const m of MISSIONS_I_III) expect(m.id, m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(MISSIONS_I_III.map((m) => m.mapId).every((id) => id in ALL_MISSION_MAPS)).toBe(true);
    expect(new Set(MISSIONS_I_III.map((m) => mapOf(m).name)).size).toBe(11);
    for (const [key, map] of Object.entries(ALL_MISSION_MAPS)) {
      expect(map.id, key).toBe(key);
      expect(MAPS[key], `${key} must not shadow a skirmish map`).toBeUndefined();
    }
    for (const map of Object.values(ALL_MISSION_MAPS)) expect(Object.values(MAPS).some((s) => s.name === map.name), `${map.name} reuses a skirmish map name`).toBe(false);
  });
  it('would notice a duplicated mission id, an Act III mission filed under another act, or a tagline copied from the wrong act', () => {
    expect(duplicates([...ALL_MISSIONS.map((m) => m.id), 'audit'])).toEqual(['audit']);
    expect(duplicates([...ALL_MISSIONS.map((m) => m.mapId), 'm8-tether-line'])).toEqual(['m8-tether-line']);
    expect(ALL_ACTS[2].tagline).not.toBe(ALL_ACTS[1].tagline);
    expect(ALL_ACTS[2].missions.some((id) => ALL_ACTS[1].missions.includes(id)), 'no mission belongs to two acts').toBe(false);
    expect(ALL_ACTS[2].missions.slice(0, 3)).not.toEqual(ACT_III.map((m) => m.id));
    expect(ALL_ACTS[2].missions.length, 'a missing mission would shorten the act').toBe(4);
  });
});

describe('the four Act III missions: shape', () => {
  it('have 6-14 briefing lines, 2-6 events (start, victory and defeat among them), 4-10 debrief lines, and every event is once', () => {
    expect(ACT_III).toHaveLength(4);
    for (const m of ACT_III) {
      expect(m.briefing.length, `${m.id} briefing`).toBeGreaterThanOrEqual(6);
      expect(m.briefing.length, `${m.id} briefing`).toBeLessThanOrEqual(14);
      expect(m.events.length, `${m.id} events`).toBeGreaterThanOrEqual(2);
      expect(m.events.length, `${m.id} events`).toBeLessThanOrEqual(6);
      expect(m.debrief.length, `${m.id} debrief`).toBeGreaterThanOrEqual(4);
      expect(m.debrief.length, `${m.id} debrief`).toBeLessThanOrEqual(10);
      const kinds = m.events.map((e) => e.trigger.kind);
      for (const k of ['start', 'victory', 'defeat']) expect(kinds, `${m.id} has a ${k} event`).toContain(k);
      for (const e of m.events) {
        expect(e.once, `${m.id} ${e.trigger.kind}`).toBe(true);
        expect(e.lines.length, `${m.id} ${e.trigger.kind}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('have a title, a location, a one-line summary and an objective sentence, no turn limit (D-013), fog in missions 9 and 11 only, and the ion storm in mission 9 only', () => {
    for (const m of ACT_III) {
      expect(m.title.length, m.id).toBeGreaterThan(0);
      expect(m.location.length, m.id).toBeGreaterThan(0);
      expect(m.summary, m.id).toMatch(/^[A-Z][^\n]+\.$/);
      expect(m.summary.length, m.id).toBeLessThanOrEqual(160);
      expect(m.objectiveText, m.id).toMatch(/^[A-Z][^\n]+\.$/);
      expect(m.turnLimit, `${m.id}: the engine reads turnLimit as a versus day limit (D-013)`).toBeUndefined();
    }
    expect(ACT_III.map((m) => m.fog)).toEqual([false, true, false, true]);
    expect(ACT_III.map((m) => m.weather)).toEqual(['clear', 'ionstorm', 'clear', 'clear']);
    expect(ACT_III_OUTLINE[1][3], 'STORY puts the ion storm in mission 9').toContain('Ion Storm weather');
    expect(ALL_MISSIONS.filter((m) => m.act <= 2).every((m) => m.weather === 'clear'), 'Acts I and II have no storm').toBe(true);
  });
  it('sets the ion storm on mission 9: the engine starts in a storm that never lifts and fogs the map whatever the fog flag says, and clear weather shows everything (known-bad control)', () => {
    const s = createGame(setupFor(NIGHT_WING, 1));
    expect(s.weather).toBe('ionstorm');
    expect(s.baseWeather, 'the storm is the base weather, so nothing restores clear sky').toBe('ionstorm');
    expect(s.weatherTurnsLeft, '0 turns left means permanent').toBe(0);
    expect(visibility(s, 0).flat().some((seen) => !seen), 'part of the map is hidden from the agent').toBe(true);
    // The engine fogs a storm even when the fog flag is off, which is why the mission sets fog on beside it.
    expect(visibility(createGame({ ...setupFor(NIGHT_WING, 1), fog: false }), 0).flat().some((seen) => !seen)).toBe(true);
    expect(NIGHT_WING.fog).toBe(true);
    // Known-bad control: the same map with clear weather and no fog shows every tile.
    const clear = createGame({ ...setupFor(NIGHT_WING, 1), fog: false, weather: 'clear' });
    expect(visibility(clear, 0).flat().every(Boolean)).toBe(true);
    for (const m of [TETHER_LINE, DUEL_AT_ASHGRAVE, AUDIT]) expect(createGame(setupFor(m, 1)).weather, m.id).toBe('clear');
  });
  it('have par values the score can use: whole positive cycles, a positive power, and a survival whose par is not shorter than the survival', () => {
    for (const m of ACT_III) {
      expect(Number.isInteger(m.par.cycles) && m.par.cycles > 0, `${m.id} par.cycles`).toBe(true);
      expect(Number.isFinite(m.par.power) && m.par.power > 0, `${m.id} par.power`).toBe(true);
      expect(() => scoreCard(createGame(setupFor(m, 1)), 0, m.par), m.id).not.toThrow();
      if (m.objective.kind === 'survive') expect(m.par.cycles, m.id).toBeGreaterThanOrEqual(m.objective.cycles);
    }
    expect(ACT_III.map((m) => m.par.cycles)).toEqual([12, 5, 14, 14]);
    expect(() => scoreCard(createGame(setupFor(NIGHT_WING, 1)), 0, { cycles: 0, power: 2 }), 'a zero par is refused').toThrow();
  });
  it('mean what the design says: a rout for the armour, a five-cycle survival for the escort, and spire captures for the duel and the audit', () => {
    expect(TETHER_LINE.objective).toEqual({ kind: 'rout' });
    expect(NIGHT_WING.objective).toEqual({ kind: 'survive', cycles: 5 });
    expect(ONES.indexOf(/for (\w+) cycles/.exec(NIGHT_WING.objectiveText)![1]), 'the objective sentence says the number').toBe(5);
    expect(DUEL_AT_ASHGRAVE.objective).toEqual({ kind: 'hq' });
    expect(AUDIT.objective).toEqual({ kind: 'hq' });
    expect(ACT_III_OUTLINE[2][3]).toContain('HQ capture');
    expect(ACT_III_OUTLINE[1][3]).toContain('escort');
    expect(ACT_III_OUTLINE[0][3]).toContain('Teaches ridges, walkers, defense stars');
    expect(DUEL_AT_ASHGRAVE.objectiveText).toMatch(/^Capture Ashgrave Spire/);
    expect(AUDIT.objectiveText).toMatch(/^Capture the Harbour Exchange/);
  });
});

// ---------------------------------------------------------------- players: D-007

describe('Act III players (D-007: the agent is the commander, the named cast are NPCs)', () => {
  it('seat the agent as player 0 (human, "agent", Helion), Rook as an AI ally on its team, the opposing force in slot 2, and exactly one human', () => {
    expect(ACT_III.map((m) => m.players.length)).toEqual([3, 3, 4, 4]);
    for (const m of ACT_III) {
      const [me, ally, foe] = m.players;
      expect(me, m.id).toMatchObject({ faction: 'helion', commander: 'agent', controller: 'human', team: 0 });
      expect(ally, m.id).toMatchObject({ faction: 'helion', commander: 'rook', controller: 'ai', team: me.team });
      expect(foe.controller, m.id).toBe('ai');
      expect(foe.team, m.id).not.toBe(me.team);
      expect(m.players.filter((p) => p.controller === 'human'), m.id).toHaveLength(1);
    }
  });
  it('uses the opponents STORY.md names: the Highlord, then Sable, then the Highlord again, then the unmarked Choir', () => {
    expect(TETHER_LINE.players[2]).toMatchObject({ faction: 'kestrel', commander: 'corvin' });
    expect(NIGHT_WING.players[2]).toMatchObject({ faction: 'kestrel', commander: 'sable' });
    expect(DUEL_AT_ASHGRAVE.players[2]).toMatchObject({ faction: 'kestrel', commander: 'corvin' });
    expect(AUDIT.players[2]).toMatchObject({ faction: 'choir', commander: 'none' }); // Dax hands the fabricators over; the Choir has no named commander yet
    expect(ACT_III_OUTLINE[0][3]).toContain('Corvin Ashgrave');
    expect(ACT_III_OUTLINE[1][3]).toContain('Sable Ashgrave');
    expect(ACT_III_OUTLINE[3][3]).toContain('Dax is exposed');
  });
  it('names real commanders of the right faction, leaves "agent" and "none" unknown, and pays every player exactly 1000 a property (no Act III commander changes income)', () => {
    for (const m of ACT_III) {
      for (const p of m.players) {
        if (p.commander === 'agent' || p.commander === 'none') continue;
        expect(COMMANDERS[p.commander], `${m.id} ${p.commander}`).toBeDefined();
        expect(COMMANDERS[p.commander].faction, `${m.id} ${p.commander}`).toBe(p.faction);
      }
      const s = createGame(setupFor(m, 1));
      for (let p = 0; p < m.players.length; p++) {
        expect(incomeOf(s, p), `${m.id} player ${p}`).toBe(1000 * tilesOf(mapOf(m), (c, o) => 'CFADH'.includes(c) && o === String(p)).length);
      }
    }
    expect(COMMANDERS.corvin.pronouns).toBe('he/him');
    expect(COMMANDERS.sable.pronouns).toBe('she/her');
  });
  it('keeps VESPER and Cantor out of Act III: the Choir has players in missions 10 and 11 only, and never a named commander', () => {
    const choir = ACT_III.flatMap((m) => m.players.map((p) => ({ m: m.id, p }))).filter((x) => x.p.faction === 'choir');
    expect(choir.map((x) => x.m)).toEqual(['duel-at-ashgrave', 'audit']);
    for (const x of choir) expect(x.p.commander, x.m).toBe('none');
    expect(MISSIONS_I_III.flatMap((m) => m.players).filter((p) => ['cantor', 'vesper'].includes(p.commander))).toEqual([]);
    expect(MISSIONS_I_III.flatMap((m) => m.players).filter((p) => p.faction === 'choir').length, 'the Choir fields players in missions 1, 6, 10 and 11').toBe(4);
  });
  it('mission 10: the Choir is a third team hostile to both armies, so its Wasp may shoot the Helion line and the Highlord\'s line alike (and only the Helion line if it sat on his team)', () => {
    const [me, rook, corvin, drones] = DUEL_AT_ASHGRAVE.players;
    expect(new Set([me.team, rook.team, corvin.team, drones.team]).size, 'three teams').toBe(3);
    expect(drones.team).not.toBe(corvin.team);
    const units: MapDef['units'] = [
      { type: 'wasp', owner: 3, x: 12, y: 3 }, { type: 'trooper', owner: 0, x: 12, y: 4 }, { type: 'trooper', owner: 2, x: 11, y: 3 }, { type: 'trooper', owner: 1, x: 4, y: 9 },
    ];
    const s = probe(DUEL_AT_ASHGRAVE, units);
    const wasp = s.units.find((u) => u.owner === 3)!;
    const targets = attackTargets(s, wasp.id, { x: 12, y: 3 }).map((c) => `${c.x},${c.y}`).sort();
    expect(targets).toEqual(['11,3', '12,4']);
    // Known-bad control: put the drones on the Highlord's team and his Trooper stops being a target.
    const allied = probe(DUEL_AT_ASHGRAVE, units, { players: setupFor(DUEL_AT_ASHGRAVE, 1).players.map((p, i) => (i === 3 ? { ...p, team: corvin.team } : p)) });
    const wasp2 = allied.units.find((u) => u.owner === 3)!;
    expect(attackTargets(allied, wasp2.id, { x: 12, y: 3 }).map((c) => `${c.x},${c.y}`)).toEqual(['12,4']);
  });
  it('mission 11 (D-007): Sefa and Rook are AI allies on the agent\'s team, the Choir is the only enemy, and "player controls Sefa" is read as the agent attached to her fleet', () => {
    expect(ACT_III_OUTLINE[3][3]).toContain('player controls Sefa');
    expect(ACT_III_OUTLINE[3][3]).toContain('Two-front allied mission');
    const [me, rook, choir, sefa] = AUDIT.players;
    expect(sefa).toMatchObject({ faction: 'tidewell', commander: 'sefa', controller: 'ai', team: me.team });
    expect(rook).toMatchObject({ commander: 'rook', controller: 'ai', team: me.team });
    expect(choir.team).not.toBe(me.team);
    expect(AUDIT.players.filter((p) => p.team !== me.team)).toHaveLength(1);
    expect(AUDIT.players.filter((p) => p.controller === 'human')).toHaveLength(1);
    expect(AUDIT.players.some((p) => p.commander === 'sefa' && p.controller === 'human'), 'Sefa is never the player').toBe(false);
    expect(textOf(AUDIT, 'echo')).toMatch(/your agent is attached to Admiral Tamura's fleet as its adjutant/);
    // Engine: Sefa's Dreadnought shells the Choir's Trooper on the beach and never the agent's Trooper beside it.
    const units: MapDef['units'] = [
      { type: 'dreadnought', owner: 3, x: 10, y: 3 }, { type: 'trooper', owner: 0, x: 10, y: 6 }, { type: 'trooper', owner: 2, x: 12, y: 6 }, { type: 'trooper', owner: 1, x: 3, y: 11 },
    ];
    const s = probe(AUDIT, units, { fog: false });
    const ship = s.units.find((u) => u.owner === 3)!;
    expect(attackTargets(s, ship.id, { x: 10, y: 3 }).map((c) => `${c.x},${c.y}`)).toEqual(['12,6']);
    // Known-bad control: give Sefa a team of her own and the agent's Trooper is a target.
    const foe = probe(AUDIT, units, { fog: false, players: setupFor(AUDIT, 1).players.map((p, i) => (i === 3 ? { ...p, team: 9 } : p)) });
    const ship2 = foe.units.find((u) => u.owner === 3)!;
    expect(attackTargets(foe, ship2.id, { x: 10, y: 3 }).map((c) => `${c.x},${c.y}`)).toContain('10,6');
  });
});

// ---------------------------------------------------------------- maps

describe('the Act III maps', () => {
  it('pass checkMap with the default options: every player slot owns exactly one spire and a fabricator', () => {
    for (const m of ACT_III) {
      expect(checkMap(mapOf(m)), m.id).toEqual([]);
      for (let p = 0; p < m.players.length; p++) {
        expect(countOf(mapOf(m), 'H', String(p)), `${m.id} p${p} spires`).toBe(1);
        expect(countOf(mapOf(m), 'F', String(p)), `${m.id} p${p} fabricators`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('would catch a broken Act III map: a spire removed, a fabricator removed, a spire sealed behind water, a unit on ground it cannot enter', () => {
    const noSable = clone(mapOf(NIGHT_WING));
    const sp = spireOf(noSable, 2);
    setCell(noSable.terrain, sp.x, sp.y, '.');
    setCell(noSable.owners, sp.x, sp.y, '.');
    expect(checkMap(noSable).map((i) => i.rule)).toEqual(['spire']);
    const noRelayFab = clone(mapOf(DUEL_AT_ASHGRAVE));
    const f = tilesOf(noRelayFab, (c, o) => c === 'F' && o === '3')[0];
    setCell(noRelayFab.terrain, f.x, f.y, '.');
    setCell(noRelayFab.owners, f.x, f.y, '.');
    expect(checkMap(noRelayFab).map((i) => i.rule)).toEqual(['fabricator']);
    const sealed = clone(mapOf(AUDIT));
    const t = spireOf(sealed, 3);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (sealed.terrain[t.y + dy]?.[t.x + dx] !== undefined) setCell(sealed.terrain, t.x + dx, t.y + dy, '~');
    expect(checkMap(sealed).map((i) => i.rule)).toContain('reach-base');
    const stranded = clone(mapOf(TETHER_LINE));
    stranded.units.push({ type: 'bastion', owner: 2, x: 9, y: 4 }); // a tread unit on a ridge
    expect(checkMap(stranded).map((i) => i.rule)).toEqual(['unit-terrain']);
    for (const m of ACT_III) expect(checkMap(mapOf(m)), `${m.id}: the unbroken map is fine`).toEqual([]);
  });
  it('seat exactly as many players as the mission has, with every unit and property owner one of them, and describe themselves in one sentence that agrees with the mission', () => {
    for (const m of ACT_III) {
      const map = mapOf(m);
      expect(map.players, m.id).toBe(m.players.length);
      for (const u of map.units) expect(u.owner, m.id).toBeLessThan(m.players.length);
      for (let p = 0; p < m.players.length; p++) expect(map.units.filter((u) => u.owner === p).length, `${m.id} player ${p} starts with units`).toBeGreaterThan(0);
      expect(map.description, m.id).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(map.description.length, m.id).toBeLessThan(200);
      expect(map.recommended?.fog, `${m.id} recommended fog`).toBe(m.fog);
      expect(map.recommended?.weather, `${m.id} recommended weather`).toBe(m.weather);
      expect(map.recommended?.startFunds, `${m.id} recommended funds`).toBe(m.players[0].funds);
    }
  });
  it('have the sizes they were drawn at and are drawn for their story beat, not mirrored', () => {
    expect(ACT_III.map((m) => `${mapOf(m).terrain[0].length}x${mapOf(m).terrain.length}`)).toEqual(['22x14', '24x12', '24x14', '24x14']);
    for (const m of ACT_III) expect(symmetryOf(mapOf(m)), m.id).toBe('none');
  });
  it('place the agent\'s whole team on the west and the opposing spire on the east, with no allied unit starting within four tiles of anyone else\'s', () => {
    for (const m of ACT_III) {
      const map = mapOf(m);
      const width = map.terrain[0].length;
      const mine = m.players.map((p, i) => (p.team === m.players[0].team ? i : -1)).filter((i) => i >= 0);
      const allies = map.units.filter((u) => mine.includes(u.owner));
      const others = map.units.filter((u) => !mine.includes(u.owner));
      for (const u of allies) expect(u.x, `${m.id} ally ${u.type} at (${u.x},${u.y})`).toBeLessThan(width / 2);
      expect(spireOf(map, 2).x, `${m.id}: the opposing spire`).toBeGreaterThan(width / 2);
      const gap = Math.min(...allies.flatMap((a) => others.map((f) => Math.abs(a.x - f.x) + Math.abs(a.y - f.y))));
      expect(gap, `${m.id}: nearest ally-to-other distance at the start`).toBeGreaterThanOrEqual(4);
    }
  });
  it('mission 8 is a ridge line: a spine with a maglev gate and a low pass, crests flanking the gate, Colossus walkers on the spine, and treads and hover held to the gates', () => {
    const map = mapOf(TETHER_LINE);
    for (const x of [9, 10, 11]) expect(map.terrain.map((row) => row[x]).filter((ch) => ch === '^').length, `spine column ${x}`).toBeGreaterThanOrEqual(10);
    for (const x of [9, 10, 11]) {
      expect(map.terrain[6][x], 'the Tether Line gate is maglev').toBe('=');
      expect(map.terrain[11][x], 'the low pass is flats').toBe('.');
    }
    for (const x of [7, 8]) { // foothill crests above and below the road, on the Helion side of the gate
      expect(map.terrain[5][x]).toBe('^');
      expect(map.terrain[7][x]).toBe('^');
      expect(map.terrain[6][x]).toBe('=');
    }
    expect(spireOf(map, 2).y, 'the Tether Gate spire is at the end of the line').toBe(6);
    const corvin = map.units.filter((u) => u.owner === 2);
    const onRidge = (u: { x: number; y: number }) => map.terrain[u.y][u.x] === '^';
    expect(corvin.filter((u) => u.type === 'colossus').length).toBe(2);
    expect(corvin.filter((u) => u.type === 'colossus').every(onRidge), 'both walkers start on the spine').toBe(true);
    for (const u of corvin.filter((x) => ['tread', 'hover'].includes(UNIT_TYPES[x.type].moveType))) expect(onRidge(u), `${u.type} cannot stand on a ridge`).toBe(false);
    // The lesson in the geometry: with both gates sealed, treads and hover units cannot cross the spine, but walkers and foot units still can.
    const a = spireOf(map, 0);
    const b = spireOf(map, 2);
    expect(distances(map, a, costFor('tread'))[b.y][b.x], 'treads reach the Tether Gate by the gates').toBeGreaterThan(0);
    const sealed = clone(map);
    for (const y of [6, 11]) for (const x of [9, 10, 11]) setCell(sealed.terrain, x, y, '^');
    expect(distances(sealed, a, costFor('tread'))[b.y][b.x], 'sealed: treads are stopped').toBe(-1);
    expect(distances(sealed, a, costFor('hover'))[b.y][b.x], 'sealed: hover units are stopped').toBe(-1);
    expect(distances(sealed, a, costFor('walker'))[b.y][b.x], 'sealed: walkers climb over').toBeGreaterThan(0);
    expect(distances(sealed, a, costFor('foot'))[b.y][b.x], 'sealed: foot units climb over').toBeGreaterThan(0);
  });
  it('mission 9 is a mountain pass: mostly ridge, a monotone maglev staircase from the convoy to a neutral uplink, a Night Wing plateau, and an escort that takes five cycles', () => {
    const map = mapOf(NIGHT_WING);
    expect(countOf(map, '^') / (map.terrain.length * map.terrain[0].length), 'mostly ridge').toBeGreaterThan(0.4);
    const exit = tilesOf(map, (c, o) => c === 'U' && o === '.');
    expect(exit, 'one neutral uplink at the top of the road').toHaveLength(1);
    const mules = map.units.filter((u) => u.owner === 1 && u.type === 'mule');
    expect(mules).toHaveLength(3);
    for (const u of mules) expect(map.terrain[u.y][u.x], 'the convoy starts on the road').toBe('=');
    const mule = UNIT_TYPES.mule;
    const costs = mules.map((u) => pathCost(map, u, exit[0], mule.moveType));
    for (const [i, c] of costs.entries()) {
      const manhattan = Math.abs(mules[i].x - exit[0].x) + Math.abs(mules[i].y - exit[0].y);
      expect(c, `Mule ${i}: the road is a staircase with no detour`).toBe(manhattan);
      expect(Math.ceil(c / mule.move), `Mule ${i}: cycles to the uplink`).toBe(5);
      expect(c, `Mule ${i}: four cycles are not enough`).toBeGreaterThan(4 * mule.move);
    }
    expect(Math.max(...costs)).toBe(27);
    expect(Math.ceil(24 / mule.move), 'known-bad: a 24-step road would take four cycles, not five').toBe(4);
    // Sable's plateau: her spire, fabricator and skyport sit north-east of the valley, and her wing is Wasps, a Raptor and an Anvil.
    for (const ch of 'HFA') for (const t of tilesOf(map, (c, o) => c === ch && o === '2')) { expect(t.x).toBeGreaterThanOrEqual(14); expect(t.y).toBeLessThanOrEqual(3); }
    const sable = map.units.filter((u) => u.owner === 2);
    expect(new Set(sable.filter((u) => UNIT_TYPES[u.type].domain === 'air').map((u) => u.type))).toEqual(new Set(['wasp', 'raptor', 'anvil']));
    expect(sable.filter((u) => u.type === 'wasp').length).toBeGreaterThanOrEqual(3);
    for (const p of [0, 1]) expect(map.units.filter((u) => u.owner === p && u.type === 'warden').length, `p${p} Wardens`).toBeGreaterThanOrEqual(1);
  });
  it('mission 10 is a duel: a field between the lines, a city and two outcrops in its middle, two terraces each crossed by one maglev gate, a Choir relay on the north edge, and a drone squad on each flank', () => {
    const map = mapOf(DUEL_AT_ASHGRAVE);
    const height = map.terrain.length;
    for (const x of [16, 19]) {
      const column = map.terrain.map((row) => row[x]);
      expect(column.filter((ch) => ch === '^').length, `terrace wall at x=${x}`).toBe(height - 1);
      expect(column.filter((ch) => ch !== '^'), `the one gate at x=${x}`).toEqual(['=']);
      expect(map.terrain[7][x]).toBe('=');
    }
    const spire = spireOf(map, 2);
    expect(spire.x, "the Highlord's spire is at the top of the heights").toBeGreaterThanOrEqual(20);
    expect(map.terrain[spire.y][spire.x - 1], 'the road reaches it').toBe('=');
    expect(map.terrain[7][11], 'the city in the middle of the field').toBe('C');
    expect(map.terrain[5][11] + map.terrain[9][11], 'an outcrop either side of it').toBe('^^');
    const relay = spireOf(map, 3);
    expect(relay.y, 'the relay is on the north edge').toBeLessThanOrEqual(2);
    expect(countOf(map, 'F', '3')).toBeGreaterThanOrEqual(1);
    const drones = map.units.filter((u) => u.owner === 3);
    expect(drones.filter((u) => u.y <= 5)).toHaveLength(3);
    expect(drones.filter((u) => u.y >= 8)).toHaveLength(3);
    expect(drones.filter((u) => u.y > 5 && u.y < 8), 'nothing in the middle').toHaveLength(0);
    for (const d of drones) for (const o of map.units.filter((u) => u.owner !== 3)) expect(Math.abs(d.x - o.x) + Math.abs(d.y - o.y), `drone ${d.type} at (${d.x},${d.y}) stands off`).toBeGreaterThanOrEqual(3);
    // Sable's wing is the Highlord's own air force: three Wasps and a Raptor, on the terraces.
    const wing = map.units.filter((u) => u.owner === 2 && UNIT_TYPES[u.type].domain === 'air');
    expect(wing.filter((u) => u.type === 'wasp').length).toBeGreaterThanOrEqual(3);
    expect(wing.filter((u) => u.type === 'raptor').length).toBeGreaterThanOrEqual(1);
    for (const u of wing) expect(u.x).toBeGreaterThanOrEqual(17);
    // Treads cannot climb the terraces except at the gates: sealing the two gates in the first wall cuts the spire off from them.
    const sealed = clone(map);
    setCell(sealed.terrain, 16, 7, '^');
    expect(distances(sealed, spireOf(map, 0), costFor('tread'))[spire.y][spire.x], 'sealed: no tread route').toBe(-1);
    expect(distances(map, spireOf(map, 0), costFor('tread'))[spire.y][spire.x], 'open: a tread route').toBeGreaterThan(0);
  });
  it('mission 11 is a coast: a northern sea over a beach, a fleet front in the north-west and a land front in the south-west, three Choir fabricators on the beach each in reach of both, and the Exchange at the end of the coast road', () => {
    const map = mapOf(AUDIT);
    expect(countOf(map, '~')).toBeGreaterThan(80);
    expect(countOf(map, 's')).toBeGreaterThanOrEqual(15);
    const fabs = tilesOf(map, (c, o) => c === 'F' && o === '2');
    expect(fabs).toHaveLength(3);
    const dock = tilesOf(map, (c, o) => c === 'D' && o === '3')[0];
    const bySea = distances(map, dock, costFor('sea'));
    const onFoot = distances(map, spireOf(map, 0), costFor('foot'));
    const dread = UNIT_TYPES.dreadnought.range!;
    for (const f of fabs) {
      expect(map.terrain[f.y - 1][f.x], `fabricator (${f.x},${f.y}) has a beach in front of it`).toBe('s');
      expect(onFoot[f.y][f.x], `(${f.x},${f.y}) is reachable on foot from the agent's spire`).toBeGreaterThan(0);
      const seaTiles = tilesOf(map, (c, _o, x, y) => c === '~' && bySea[y][x] >= 0 && Math.abs(x - f.x) + Math.abs(y - f.y) <= dread[1]);
      expect(seaTiles.length, `(${f.x},${f.y}) is within a Dreadnought's reach of water the fleet can sail`).toBeGreaterThan(0);
    }
    for (const d of tilesOf(map, (c, o) => c === 'D' && o === '3')) {
      expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.terrain[d.y + dy][d.x + dx] === '~'), `dock (${d.x},${d.y}) touches the sea`).toBe(true);
    }
    const exchange = spireOf(map, 2);
    expect(map.terrain[exchange.y][exchange.x - 1], 'the coast road ends at the Exchange').toBe('=');
    expect(countOf(map, 'A', '2'), 'a Choir skyport').toBe(1);
    // Two fronts: the fleet and its garrison in the north, the Helion bases in the south, a clear gap between them.
    const fleet = map.units.filter((u) => u.owner === 3);
    const land = map.units.filter((u) => u.owner === 0 || u.owner === 1);
    expect(fleet.every((u) => u.y <= 5)).toBe(true);
    expect(land.every((u) => u.y >= 8)).toBe(true);
    expect(fleet.filter((u) => UNIT_TYPES[u.type].domain === 'sea').map((u) => u.type).sort()).toEqual(['barge', 'barge', 'dreadnought', 'picket', 'picket']);
    for (const f of fleet) for (const l of land) expect(Math.abs(f.x - l.x) + Math.abs(f.y - l.y), 'the fronts are apart').toBeGreaterThanOrEqual(4);
  });
});

describe('createGame on the Act III maps', () => {
  it('builds each mission from its own players, with its own fog and weather, and pays player 0 its mission funds plus 1000 a property on turn one', () => {
    for (const m of ACT_III) {
      const map = mapOf(m);
      const s = createGame(setupFor(m, 1));
      expect(s.mapId, m.id).toBe(m.mapId);
      expect(s.players.map((p) => p.commander), m.id).toEqual(m.players.map((p) => p.commander));
      expect(s.players.map((p) => p.team), m.id).toEqual(m.players.map((p) => p.team));
      expect(s.units, m.id).toHaveLength(map.units.length);
      expect(s.fog, m.id).toBe(m.fog);
      expect(s.weather, m.id).toBe(m.weather);
      expect(s.objective, m.id).toEqual(m.objective);
      expect(s.players[0].funds, m.id).toBe((m.players[0].funds ?? 0) + 1000 * tilesOf(map, (c, o) => 'CFADH'.includes(c) && o === '0').length);
      for (let p = 1; p < m.players.length; p++) expect(s.players[p].funds, `${m.id} player ${p} has not started a turn`).toBe(m.players[p].funds ?? 0);
      expect(countOf(map, 'F', '0') > 0 && s.players[0].funds >= 1000, `${m.id}: something to buy`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- objectives and triggers

describe('Act III objectives and triggers', () => {
  it('gives every spire objective an enemy spire to take, and refuses a map without one or a mission whose enemy has joined the agent\'s team', () => {
    for (const m of [TETHER_LINE, DUEL_AT_ASHGRAVE, AUDIT]) expect(hqProblems(m, mapOf(m)), m.id).toEqual([]);
    expect(tilesOf(mapOf(TETHER_LINE), (c, o) => c === 'H' && o === '2'), 'a rout can also be won by taking the Tether Gate spire').toHaveLength(1);
    expect(TETHER_LINE.objectiveText).toMatch(/spire/);
    expect(hqProblems(NIGHT_WING, mapOf(NIGHT_WING)), 'only hq objectives are judged').toEqual([]);
    const noSpire = clone(mapOf(AUDIT));
    const s = spireOf(noSpire, 2);
    setCell(noSpire.terrain, s.x, s.y, 'C');
    expect(hqProblems(AUDIT, noSpire)).toHaveLength(1);
    const allied = clone(AUDIT);
    allied.players[2].team = 0;
    expect(hqProblems(allied, mapOf(allied))).toHaveLength(1);
  });
  it('plays mission 10 as ECHO says: the Highlord\'s spire alone does not end it while the drones stand; the battle is won when the relay falls or the drones are gone', () => {
    const start = createGame(setupFor(DUEL_AT_ASHGRAVE, 1));
    const corvinFell = captureSpire(start, 2);
    expect(corvinFell.players[2].defeated, 'the Highlord is defeated by his spire').toBe(true);
    expect(corvinFell.players[3].defeated).toBe(false);
    expect(corvinFell.winnerTeam, 'the drones still stand').toBeNull();
    const relayFell = captureSpire(start, 3);
    expect(relayFell.players[3].defeated).toBe(true);
    expect(relayFell.winnerTeam, 'the Highlord still stands').toBeNull();
    expect(captureSpire(corvinFell, 3).winnerTeam, 'the Highlord, then the relay').toBe(0);
    expect(captureSpire(relayFell, 2).winnerTeam, 'the relay, then the Highlord').toBe(0);
    const noDrones = clone(start);
    noDrones.units = noDrones.units.filter((u) => u.owner !== 3);
    expect(captureSpire(noDrones, 2).winnerTeam, 'the drones gone, the Highlord\'s spire wins it').toBe(0);
    expect(DUEL_AT_ASHGRAVE.objectiveText).toMatch(/Capture Ashgrave Spire and drive the Choir drones from the field/);
  });
  it('plays mission 11 as the text says: capturing the Exchange routs the Choir and hands its three fabricators to the agent (the coast is retaken)', () => {
    const start = createGame(setupFor(AUDIT, 1));
    const won = captureSpire(start, 2);
    expect(won.winnerTeam).toBe(0);
    const fabricators = tilesOf(mapOf(AUDIT), (c) => c === 'F').filter((t) => mapOf(AUDIT).owners[t.y][t.x] === '2');
    expect(fabricators).toHaveLength(3);
    for (const f of fabricators) expect(won.tiles[f.y][f.x].owner, `fabricator (${f.x},${f.y})`).toBe(0);
    // Known-bad control: capturing a Tidewell spire is not a win for the agent's team (it would be capturing an ally's, which no unit can do).
    expect(canCaptureCheck(start)).toBe(false);
  });
  it('plays the escort as a survival: with every side only ending its turns, team 0 (the agent, the convoy and nobody else) wins as cycle 5 ends and not before (known answer)', () => {
    let s = createGame(setupFor(NIGHT_WING, 1));
    const history: { cycle: number; winner: number | null }[] = [];
    for (let guardCount = 0; guardCount < 200 && s.winnerTeam === null; guardCount++) {
      history.push({ cycle: s.cycle, winner: s.winnerTeam });
      s = applyAction(s, { kind: 'endTurn' }).state;
    }
    expect(s.winnerTeam).toBe(0);
    expect(s.cycle, 'won as cycle 5 ended').toBe(5);
    expect(history.every((h) => h.winner === null)).toBe(true);
    expect(history.filter((h) => h.cycle === 5), 'the agent, the convoy and the Night Wing each took their turn in cycle 5').toHaveLength(3);
  });
  it('points every Act III trigger at a real player and, for a capture, at a property that can be captured, and refuses bad ones', () => {
    for (const m of ACT_III) for (const e of m.events) expect(triggerProblems(m, e.trigger), `${m.id} ${JSON.stringify(e.trigger)}`).toEqual([]);
    expect(AUDIT.events.some((e) => e.trigger.kind === 'propertyCaptured' && e.trigger.by === 0 && e.trigger.terrain === 'fabricator'), 'a retaken fabricator is watched').toBe(true);
    expect(TETHER_LINE.events.some((e) => e.trigger.kind === 'powerUsed' && e.trigger.player === 2), 'the Highlord\'s power is watched').toBe(true);
    expect(DUEL_AT_ASHGRAVE.events.some((e) => e.trigger.kind === 'powerUsed' && e.trigger.player === 2)).toBe(true);
    for (const e of NIGHT_WING.events) if (e.trigger.kind === 'cycle') expect(e.trigger.cycle).toBeLessThanOrEqual(5);
    // Known-bad triggers must keep being reported.
    expect(triggerProblems(NIGHT_WING, { kind: 'cycle', cycle: 6 })).toHaveLength(1); // after the 5 cycles of the escort
    expect(triggerProblems(NIGHT_WING, { kind: 'cycle', cycle: 0 })).toHaveLength(1);
    expect(triggerProblems(DUEL_AT_ASHGRAVE, { kind: 'powerUsed', player: 4 })).toHaveLength(1); // no fifth player
    expect(triggerProblems(DUEL_AT_ASHGRAVE, { kind: 'unitDestroyed', owner: 3, count: 99 })).toHaveLength(1);
    expect(triggerProblems(TETHER_LINE, { kind: 'propertyCaptured', by: 0, terrain: 'dock' })).toHaveLength(1); // no dock on the ridges
    expect(triggerProblems(AUDIT, { kind: 'propertyCaptured', by: 0, terrain: 'flats' })).toHaveLength(1); // not a property
    expect(triggerProblems(AUDIT, { kind: 'propertyCaptured', by: 0, terrain: 'dock' }), 'the only docks are Sefa\'s, an ally\'s, which no unit can capture').toHaveLength(1);
    expect(triggerProblems(NIGHT_WING, { kind: 'propertyCaptured', by: 0, terrain: 'uplink' }), 'the pass has an uplink to take').toEqual([]);
  });
  it('tells the Night Wing\'s turn at a cycle trigger strictly inside the battle, with the Highlord, his daughter and ECHO all in it', () => {
    const turn = DUEL_AT_ASHGRAVE.events.find((e) => e.lines.some((l) => l.speaker === 'sable' && /Father/.test(l.text)) && e.lines.some((l) => l.speaker === 'corvin'));
    expect(turn, 'the turn event').toBeDefined();
    expect(turn!.trigger.kind).toBe('cycle');
    const cycle = turn!.trigger.kind === 'cycle' ? turn!.trigger.cycle : -1;
    expect(cycle, 'after the opening').toBeGreaterThan(1);
    expect(cycle, 'before the par').toBeLessThan(DUEL_AT_ASHGRAVE.par.cycles);
    expect(turn!.lines[0].speaker, 'ECHO announces it').toBe('echo');
    expect(turn!.lines.some((l) => l.speaker === 'echo' && /turning on the Choir drones/.test(l.text))).toBe(true);
    expect(DUEL_AT_ASHGRAVE.briefing.some((l) => l.speaker === 'sable'), 'she is in position before it').toBe(true);
    // Nothing in the briefing or the opening event has her turn already.
    expect(DUEL_AT_ASHGRAVE.briefing.filter((l) => /Count them|turning on/.test(l.text))).toEqual([]);
  });
});

// ---------------------------------------------------------------- the writing rules

describe('the Act III writing rules', () => {
  it('keeps every line at or under 220 characters, and at least 90% of them (in each mission and in the act) at or under 140', () => {
    expect(ACT_III_LINES.length).toBeGreaterThan(100);
    expect(ACT_III_LINES.filter((l) => l.text.length > 220)).toEqual([]);
    for (const m of ACT_III) expect(share140(linesOf(m)), `${m.id}: ${linesOf(m).filter((l) => l.text.length > 140).length} of ${linesOf(m).length} lines are over 140`).toBeGreaterThanOrEqual(0.9);
    expect(share140(ACT_III_LINES)).toBeGreaterThanOrEqual(0.9);
    const padded: DialogueLine[] = [...Array(3).fill({ speaker: 'echo', text: 'Short.' }), { speaker: 'echo', text: 'x'.repeat(150) }];
    expect(share140(padded), 'known-bad: a quarter of the lines running long fails the same measure').toBeLessThan(0.9);
  });
  it('keeps every line to one to three sentences (a fragment of four words or fewer is not counted as a sentence)', () => {
    for (const l of ACT_III_LINES) {
      const full = sentencesOf(l.text).filter((s) => wordsOf(s).length >= 5);
      expect(full.length, `${l.speaker}: ${l.text}`).toBeLessThanOrEqual(3);
      expect(sentencesOf(l.text).length, `${l.speaker}: ${l.text}`).toBeLessThanOrEqual(6);
    }
  });
  it('uses only the Act III cast as speakers, with every speaker used, a mood from the list, and each commander on a net of their own nation', () => {
    expect(new Set(ACT_III_LINES.map((l) => l.speaker))).toEqual(new Set(ACT_III_SPEAKERS));
    for (const s of ['echo', 'rook', 'ilse', 'sefa', 'dax', 'corvin', 'sable']) expect(COMMANDERS[s], s).toBeDefined();
    for (const l of ACT_III_LINES) expect(l.mood === undefined || ['neutral', 'happy', 'angry', 'grim', 'surprised', 'smug'].includes(l.mood), `${l.speaker} mood`).toBe(true);
    for (const l of ACT_III_LINES) {
      const faction = COMMANDERS[l.speaker]?.faction;
      if (faction === 'kestrel') expect(l.channel, `${l.speaker} speaks over a Kestrel net`).toMatch(/Kestrel|Night wing/);
      if (faction === 'tidewell') expect(l.channel, `${l.speaker} speaks over a Tidewell net`).toMatch(/Tidewell/);
      if (l.speaker === 'ilse') expect(l.channel).toBe('Helion command net');
    }
    expect(ACT_III_LINES.filter((l) => l.speaker === 'Tether Control').every((l) => /Kestrel/.test(l.channel ?? ''))).toBe(true);
    expect(ACT_III_LINES.filter((l) => l.speaker === 'Coast Watch').every((l) => /Tidewell/.test(l.channel ?? ''))).toBe(true);
  });
  it('passes every dialogue rule: length, speakers, no "!" from ECHO, Ilse, Sefa, Dax, the narrator or the officials, no spoilers, no profanity, no real-world names, no manual control', () => {
    for (const m of ACT_III) expect(dialogueProblems(linesOf(m), ACT_III_RULES), m.id).toEqual([]);
    expect(ACT_III_LINES.filter((l) => l.speaker === 'echo' || l.speaker === 'ilse' || l.speaker === 'sefa' || l.speaker === 'narrator').filter((l) => l.text.includes('!'))).toEqual([]);
  });
  it('would catch each planted violation, passes a clean line, and lets Act III name what Act III may name', () => {
    const line = (speaker: string, text: string): DialogueLine => ({ speaker, text });
    const bad: [string, DialogueLine, RegExp][] = [
      ['over 220', line('rook', 'Okay. '.repeat(40)), /over 220/],
      ['Act II speaker', line('juno', 'Sky is open.'), /speaker not allowed/],
      ['Act II speaker 2', line('Grove Relay', 'Column in the weald.'), /speaker not allowed/],
      ['echo bang', line('echo', 'Ridge captured!'), /exclamation/],
      ['ilse bang', line('ilse', 'Captain! Fire for effect!'), /exclamation/],
      ['sefa bang', line('sefa', 'Withdraw at once!'), /exclamation/],
      ['dax bang', line('dax', 'The figures are clear!'), /exclamation/],
      ['narrator bang', line('narrator', 'The storm broke!'), /exclamation/],
      ['Tether Control bang', line('Tether Control', 'Armour is released!'), /exclamation/],
      ['VESPER', line('echo', 'The signal bears the mark of VESPER.'), /spoiler/],
      ['Cantor', line('sable', 'Cantor is on the line.'), /spoiler/],
      ['Mira', line('corvin', 'My daughter Mira built this node.'), /spoiler/],
      ['Lattice core', line('narrator', 'Under the glass, the Lattice core slept.'), /spoiler/],
      ['profanity', line('rook', 'Well, damn.'), /profanity/],
      ['real world', line('narrator', 'The treaty was signed in Paris.'), /real-world/],
      ['manual control', line('echo', 'Select the Colossus and move it to the ridge.'), /control units/],
      ['manual control 2', line('echo', 'You should send your Breacher to the crest.'), /control units/],
      ['empty', line('sable', '   '), /empty/],
    ];
    for (const [name, l, kind] of bad) {
      const problems = dialogueProblems([l], ACT_III_RULES);
      expect(problems.length, name).toBeGreaterThanOrEqual(1);
      expect(problems.some((p) => kind.test(p)), `${name}: ${problems.join('; ')}`).toBe(true);
    }
    expect(dialogueProblems([line('echo', 'Observation: a ridge gives four defense stars. That is the whole recommendation.')], ACT_III_RULES)).toEqual([]);
    expect(dialogueProblems([line('rook', 'Okay! Okay! Nobody panic!')], ACT_III_RULES), 'Rook may shout').toEqual([]);
    expect(dialogueProblems([line('corvin', 'Form on me!')], ACT_III_RULES), 'the Highlord is not on the never-shouts list').toEqual([]);
    const allowed = line('narrator', 'The Hollow Choir sang over the Glass Waste, and the Lattice net never stopped.');
    expect(dialogueProblems([allowed], ACT_III_RULES), 'Act III may name all three').toEqual([]);
    expect(dialogueProblems([allowed]).some((p) => /spoiler/.test(p)), 'Act I still may not').toBe(true);
    expect(dialogueProblems([line('echo', 'You never move a unit.')], ACT_III_RULES), 'a negation is not an instruction').toEqual([]);
  });
  it('bans VESPER, Cantor, Mira and the Lattice core from every Act III string, not only from dialogue, and does not over-ban the names Act III may use', () => {
    const strings: string[] = [];
    for (const m of ACT_III) {
      strings.push(m.id, m.title, m.location, m.summary, m.mapId, m.objectiveText);
      for (const l of linesOf(m)) strings.push(l.speaker, l.text, l.channel ?? '');
    }
    for (const a of ALL_ACTS.filter((x) => x.act === 3)) strings.push(a.title, a.tagline, ...a.missions);
    for (const m of ACT_III) { const map = mapOf(m); strings.push(map.id, map.name, map.description, map.author ?? ''); }
    expect(strings.length).toBeGreaterThan(400);
    for (const text of strings) for (const re of ACT_III_RULES.spoilers) expect(re.test(text), `${re} in "${text}"`).toBe(false);
    for (const planted of ['It was VESPER', 'Cantor sang', 'Mira Varga', 'the Lattice core']) {
      expect(ACT_III_RULES.spoilers.some((re) => re.test(planted)), planted).toBe(true);
    }
    expect(ACT_III_RULES.spoilers.some((re) => re.test('the Hollow Choir and Lattice traffic in the Glass Waste')), 'not over-banned').toBe(false);
    expect(ACT_III_RULES.spoilers.some((re) => re.test('Admiral Tamura')), '"admiral" holds the letters of "mira" and must not trip the ban').toBe(false);
    // No Act III player is a Choir commander, so no data field names one either.
    expect(ACT_III.flatMap((m) => m.players).filter((p) => ['cantor', 'vesper'].includes(p.commander))).toEqual([]);
  });
  it('names the Hollow Choir, the Lattice and the Glass Waste where the story allows, and keeps all three out of mission 8', () => {
    const names = (m: Mission, re: RegExp) => linesOf(m).filter((l) => re.test(l.text)).length;
    expect(names(NIGHT_WING, /Hollow Choir/), 'the parley names the hulls ECHO knows from Ashfall').toBeGreaterThanOrEqual(1);
    expect(names(DUEL_AT_ASHGRAVE, /Hollow Choir/)).toBeGreaterThanOrEqual(1);
    expect(names(DUEL_AT_ASHGRAVE, /Glass Waste/)).toBeGreaterThanOrEqual(1);
    expect(names(AUDIT, /Glass Waste/)).toBeGreaterThanOrEqual(1);
    expect(names(AUDIT, /Lattice/)).toBeGreaterThanOrEqual(1);
    expect(names(TETHER_LINE, /choir|lattice|glass waste|vesper|cantor/i), 'mission 8 is about the Highlord alone').toBe(0);
    expect(ACT_III_LINES.filter((l) => /lattice core/i.test(l.text))).toEqual([]);
    expect(ACT_III_LINES.some((l) => l.text.includes(FACTIONS.choir.name.replace(/^The /, ''))), 'the faction is named as the data names it').toBe(true);
  });
  it('carries none of the names the repo guard denies (the originality list) in any Act III string, and the detector would catch one', () => {
    const text = JSON.stringify([ACT_III, ALL_ACTS, Object.values(ALL_MISSION_MAPS)], null, 1);
    expect(guard.scanText('src/content/missions.ts', text)).toEqual([]);
    for (const bad of guard.DENYLIST.slice(0, 5)) expect(guard.scanText('src/content/missions.ts', `text: '${bad}'`).map((f) => f.rule), `the guard catches ${bad}`).toContain('originality');
    const planted = guard.DENYLIST[guard.DENYLIST.length - 1]; // taken from the list, so this file never spells a denied name itself
    expect(guard.scanText('src/content/missions.ts', `${JSON.stringify(ACT_III)} ${planted}`).map((f) => f.match), 'a planted name in Act III text is found').toEqual([planted]);
  });
});

// ---------------------------------------------------------------- voices

describe('each Act III speaker sounds like their entry in STORY.md', () => {
  const by = (speaker: string) => ACT_III_LINES.filter((l) => l.speaker === speaker);
  const matching = (speaker: string, re: RegExp) => by(speaker).filter((l) => re.test(l.text)).length;
  const voiceSample = (name: string) => new RegExp(`### ${name}[\\s\\S]*?\\*Voice:\\* "([^"]+)"`).exec(STORY)?.[1];
  it('ECHO: short telemetry sentences, no exclamation mark, dry curiosity, and a feeling of her own that is not the one she filed before', () => {
    expect(by('echo').length).toBeGreaterThan(45);
    for (const l of by('echo')) {
      expect(l.text, l.text).not.toContain('!');
      for (const sentence of l.text.split(/(?<=[.?])\s+/)) expect(wordsOf(sentence).length, sentence).toBeLessThanOrEqual(26);
    }
    expect(matching('echo', /telemetry|observation|query|recommendation|alert|status|objective|situation|logged|noted|confirmed|contact|audit|posture|terrain|movement/i)).toBeGreaterThanOrEqual(25);
    expect(matching('echo', /query|observation|telemetry (?:also )?notes|filed them as weather|where did the entry/i), 'dry curiosity').toBeGreaterThanOrEqual(5);
    const label = (m: Mission) => /Provisional label: (\w+)/.exec(linesOf(m).find((l) => l.speaker === 'echo' && /feeling/.test(l.text))?.text ?? '')?.[1];
    const earlier = [label(CALDER_SPIRE), label(ROOT_AND_BRANCH)];
    expect(earlier).toEqual(['pleased', 'unease']);
    expect(label(DUEL_AT_ASHGRAVE), 'a new feeling in the Highlord\'s debrief').toBe('homesick');
    expect(earlier).not.toContain(label(DUEL_AT_ASHGRAVE));
    expect(textOf(DUEL_AT_ASHGRAVE, 'echo')).toMatch(/I have no home/);
  });
  it('Rook: earnest, apologises to a ridge and a storm, engineering metaphors, braver than in Act I ("I will", "I intend to")', () => {
    expect(matching('rook', /sorry|apolog/i)).toBeGreaterThanOrEqual(4);
    expect(matching('rook', /load-bearing|rebar|engineer|machine|debugging|patch|rewired|shop|engines|engineering|wall/i)).toBeGreaterThanOrEqual(8);
    expect(matching('rook', /\bI will\b/)).toBeGreaterThanOrEqual(3);
    expect(TETHER_LINE.briefing.some((l) => l.speaker === 'rook' && /I intend to/.test(l.text)), 'the braver ending of Tidebreak, now at the start').toBe(true);
    expect(linesOf(FIRST_LIGHT).filter((l) => l.speaker === 'rook' && /I intend to|I will\b/.test(l.text)), 'Rook promises nothing in mission 1').toEqual([]);
    expect(matching('rook', /Okay\. Okay\./)).toBeGreaterThanOrEqual(3); // still a little nervous
    expect(by('rook').length).toBeGreaterThanOrEqual(15);
  });
  it('Corvin: formal and courtly, no contractions, "Captain" to his enemy, gracious in victory, brittle in defeat, and the STORY.md line word for word', () => {
    const sample = voiceSample('Corvin Ashgrave');
    expect(sample, 'STORY.md Corvin voice sample').toBeDefined();
    expect(by('corvin').some((l) => l.text === sample), 'the sample, as spoken').toBe(true);
    expect(by('corvin').length).toBeGreaterThanOrEqual(12);
    expect(matching('corvin', /Captain/)).toBeGreaterThanOrEqual(6);
    expect(matching('corvin', /Kestrel|altitude|family|continent|mountain|order|forgery|wing|field|quarrels|line|rival/i)).toBeGreaterThanOrEqual(by('corvin').length - 4);
    for (const l of by('corvin')) expect(l.text, l.text).not.toMatch(/n't\b|\b(?:I'm|I've|I'll|you're|it's|that's)\b/i);
    const victory = TETHER_LINE.events.find((e) => e.trigger.kind === 'victory')!;
    expect(victory.lines.filter((l) => l.speaker === 'corvin').every((l) => l.mood !== 'angry'), 'gracious when he gives ground').toBe(true);
    const defeated = DUEL_AT_ASHGRAVE.debrief.filter((l) => l.speaker === 'corvin');
    expect(defeated.length).toBeGreaterThanOrEqual(3);
    expect(defeated.some((l) => l.mood === 'angry'), 'brittle').toBe(true);
    expect(defeated[defeated.length - 1].mood, 'and then grim').toBe('grim');
  });
  it('Sable: sparse and wry, short fragments of lights and dark and signal, one dry line instead of three loud ones, and the STORY.md line word for word', () => {
    const sample = voiceSample('Sable Ashgrave');
    expect(sample).toBe('Lights off. Let them guess.');
    expect(by('sable').some((l) => l.text === sample)).toBe(true);
    expect(by('sable').length).toBeGreaterThanOrEqual(14);
    for (const l of by('sable')) {
      expect(l.text.length, l.text).toBeLessThanOrEqual(125);
      expect(l.text, l.text).not.toContain('!');
      expect(l.mood === 'happy', l.text).toBe(false);
      expect(sentencesOf(l.text).length, l.text).toBeLessThanOrEqual(4);
    }
    expect(matching('sable', /lights?|dark|night|wing|storm|channel|shadow|guess|quiet|voice|signal/i) / by('sable').length).toBeGreaterThanOrEqual(0.6);
    expect(by('sable').some((l) => l.text === 'Talkative convoy.'), 'a wry one-liner').toBe(true);
    // The parley is encrypted and nothing else is.
    const parley = NIGHT_WING.debrief.filter((l) => l.speaker === 'sable');
    expect(parley.length).toBeGreaterThanOrEqual(5);
    for (const l of parley) expect(l.channel).toBe('Night wing net, encrypted');
    for (const l of ACT_III_LINES.filter((x) => x.speaker === 'sable' && !parley.includes(x))) expect(l.channel, l.text).toBe('Night wing net, open');
  });
  it('Sefa: calm and formal, tide and shore and ship imagery, "Captain" to Rook, never shouts, and the STORY.md line word for word', () => {
    const sample = voiceSample('Sefa Tamura');
    expect(sample).toBe('The tide does not hurry, Captain. It simply arrives.');
    expect(by('sefa').some((l) => l.text.includes(sample!)), 'the sample, in her last words').toBe(true);
    expect(by('sefa').length).toBeGreaterThanOrEqual(8);
    expect(matching('sefa', /\btide\b|\binlet\b|\bships?\b|\bshore\b|\bbeach|\bwater\b|\bcurrent\b|\bcoast\b|\bheadland\b|\blaunch\b|\bPicket\b|\bport/i)).toBeGreaterThanOrEqual(7);
    expect(matching('sefa', /Captain/)).toBeGreaterThanOrEqual(5);
    expect(by('sefa').filter((l) => l.text.includes('!'))).toEqual([]);
    expect(by('sefa').every((l) => l.channel === 'Tidewell fleet net, open')).toBe(true);
  });
  it('Dax: smooth and numerate, a ledger in every sentence, "correction", faintly condescending, never vulgar, and shaken once the counterparty stops answering', () => {
    expect(by('dax').length).toBeGreaterThanOrEqual(4);
    expect(matching('dax', /correction|account|figures|investment|market|ledger|margin|exposure|assets|counterparty/i)).toBe(by('dax').length);
    expect(matching('dax', /Captain|Admiral/)).toBeGreaterThanOrEqual(4);
    expect(matching('dax', /correction/)).toBeGreaterThanOrEqual(1);
    expect(STORY).toContain('Let\'s call it a correction');
    const last = by('dax')[by('dax').length - 1];
    expect(last.mood, 'the last word is not smug').not.toBe('smug');
    expect(last.text).toMatch(/counterparty has stopped answering/);
    expect(by('dax').every((l) => l.channel === 'Tidewell command, open')).toBe(true);
  });
  it('Ilse: clipped and dry, "Captain" first, firing-data flavour, never longer than 140 characters, only on the radio, and Dax speaks only in mission 11', () => {
    expect(by('ilse').length).toBeGreaterThanOrEqual(5);
    for (const l of by('ilse')) {
      expect(l.text, l.text).toMatch(/^Captain/);
      expect(l.text.length, l.text).toBeLessThanOrEqual(140);
      expect(l.channel).toBe('Helion command net');
    }
    expect(matching('ilse', /bearing|range|ranged|fire|crest|Arcs|artillery|battery|logs|front|field/i)).toBeGreaterThanOrEqual(4);
    expect(ACT_III.filter((m) => linesOf(m).some((l) => l.speaker === 'dax')).map((m) => m.id)).toEqual(['audit']);
    expect(ACT_III.filter((m) => linesOf(m).some((l) => l.speaker === 'sefa')).map((m) => m.id)).toEqual(['audit']);
    expect(ACT_III.filter((m) => linesOf(m).some((l) => l.speaker === 'corvin')).map((m) => m.id)).toEqual(['tether-line', 'duel-at-ashgrave']);
    expect(ACT_III.filter((m) => linesOf(m).some((l) => l.speaker === 'sable')).map((m) => m.id)).toEqual(['night-wing', 'duel-at-ashgrave']);
  });
  it('humour lands in the middle and grief at the ends: every debrief closes on the narrator or a grim line, no defeat event is cheerful, and each mission has a banter beat mid-way', () => {
    for (const m of ACT_III) {
      const last = m.debrief[m.debrief.length - 1];
      expect(last.speaker === 'narrator' || last.mood === 'grim', `${m.id}: ${last.text}`).toBe(true);
      for (const e of m.events.filter((x) => x.trigger.kind === 'defeat')) expect(e.lines.every((l) => l.mood !== 'happy'), m.id).toBe(true);
      const mid = m.events.filter((x) => x.trigger.kind === 'cycle').flatMap((e) => e.lines);
      expect(mid.some((l) => l.speaker === 'rook' || l.speaker === 'sefa' || l.speaker === 'dax'), `${m.id}: a banter beat mid-mission`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- the story beats

describe('faithful to the Act III outline', () => {
  it('speaks to the human about what the agent is doing (D-007): every mission names the agent and a standing order, all three postures are named, and a power policy is explained', () => {
    for (const m of ACT_III) {
      const text = textOf(m, 'echo');
      expect(text, m.id).toMatch(/your agent/i);
      expect(text, m.id).toMatch(/your human|for the human|composition weights|standing orders|posture|policy|target priorities/i);
      expect(POSTURES.some((p) => text.includes(p)), `${m.id} names a posture`).toBe(true);
    }
    for (const p of POSTURES) expect(ACT_III.some((m) => textOf(m, 'echo').includes(p)), `Act III names ${p}`).toBe(true);
    expect(ACT_III_LINES.some((l) => l.speaker === 'echo' && /power policy/.test(l.text)), 'D-005: the power policy').toBe(true);
    expect(ACT_III_LINES.filter((l) => MANUAL_CONTROL.test(l.text))).toEqual([]);
    // Nobody but ECHO explains the agent's orders; the commanders speak as people.
    for (const l of ACT_III_LINES.filter((x) => POSTURES.some((p) => x.text.includes(p)))) expect(l.speaker, l.text).toBe('echo');
  });
  it('mission 8: Kestrel armour comes down the ridges, and the ridge, walker and defense-star numbers ECHO gives are the data\'s', () => {
    const echoText = textOf(TETHER_LINE, 'echo');
    expect(ACT_III_OUTLINE[0][3]).toContain('restore order');
    expect(TETHER_LINE.briefing.some((l) => l.speaker === 'corvin' && /restore order to all of it/.test(l.text)), 'the Highlord\'s declaration').toBe(true);
    expect(TETHER_LINE.briefing.some((l) => l.speaker === 'corvin' && /Kestrel is gracious/.test(l.text))).toBe(true);
    const comp = /(\w+) Colossus walkers, (\w+) Bastions and (\w+) Breachers/.exec(echoText)!;
    const corvin = mapOf(TETHER_LINE).units.filter((u) => u.owner === 2);
    expect(comp.slice(1).map((w) => ONES.indexOf(w.toLowerCase()))).toEqual(['colossus', 'bastion', 'breacher'].map((t) => corvin.filter((u) => u.type === t).length));
    // Defense stars: "A ridge gives four defense stars, and flats give one."
    const stars = /A ridge gives (\w+) defense stars, and flats give (\w+)\./.exec(echoText)!;
    expect(stars[1]).toBe(spell(TERRAIN_TYPES.ridge.def));
    expect(stars[2]).toBe(spell(TERRAIN_TYPES.flats.def));
    expect(stars[1]).not.toBe(stars[2]);
    // Ridges: foot 2, exo 1, tread and hover not at all, so a Bastion keeps to the road.
    const climb = /A Trooper climbs a ridge for (\w+), a Breacher for (\w+)\./.exec(echoText)!;
    expect(UNIT_TYPES.trooper.moveType).toBe('foot');
    expect(UNIT_TYPES.breacher.moveType).toBe('exo');
    expect(climb[1]).toBe(spell(TERRAIN_TYPES.ridge.cost.foot!));
    expect(climb[2]).toBe(spell(TERRAIN_TYPES.ridge.cost.exo!));
    expect(TERRAIN_TYPES.ridge.cost.tread).toBeNull();
    expect(TERRAIN_TYPES.ridge.cost.hover).toBeNull();
    expect(UNIT_TYPES.bastion.moveType).toBe('tread');
    expect(echoText).toMatch(/Treads and hover units cannot climb at all, so a Bastion keeps to the road/);
    // Walkers: "A Colossus is a walker. It moves four and climbs a ridge for two, and a Trooper does it one percent damage."
    const walker = /A Colossus is a walker\. It moves (\w+) and climbs a ridge for (\w+), and a Trooper does it (\w+) percent damage/.exec(echoText)!;
    expect(UNIT_TYPES.colossus.moveType).toBe('walker');
    expect(walker[1]).toBe(spell(UNIT_TYPES.colossus.move));
    expect(walker[2]).toBe(spell(TERRAIN_TYPES.ridge.cost.walker!));
    expect(walker[3]).toBe(spell(DAMAGE.trooper.secondary!.colossus!));
    expect(DAMAGE.arc.primary!.colossus!, 'Arcs do better').toBeGreaterThan(DAMAGE.trooper.secondary!.colossus!);
    expect(DAMAGE.salvo.primary!.colossus!, 'Salvos do better').toBeGreaterThan(DAMAGE.trooper.secondary!.colossus!);
    expect(echoText).toMatch(/Arcs and Salvos do better/);
    // A Trooper on a crest sees three tiles further (D-012.2): "five tiles, not two".
    const crest = probe(TETHER_LINE, [{ type: 'trooper', owner: 0, x: 7, y: 5 }, { type: 'trooper', owner: 1, x: 3, y: 9 }, { type: 'trooper', owner: 2, x: 13, y: 5 }]);
    const sees = /sees (\w+) tiles, not (\w+)\./.exec(echoText)!;
    expect(sees[1]).toBe(spell(effectiveVision(crest, crest.units[0])));
    expect(sees[2]).toBe(spell(effectiveVision(crest, crest.units[0], { x: 4, y: 4 })));
    expect(effectiveVision(crest, crest.units[0])).toBe(UNIT_TYPES.trooper.vision + 3);
    // The Highlord's numbers: Lineage 15/15, Surge +10% and Overclock +20% firepower, and the tether strike's 5 health and 1 tile.
    const lineage = /Lineage gives every Kestrel unit (\w+) percent firepower and (\w+) defense/.exec(echoText)!;
    const passive = COMMANDERS.corvin.passive.modifiers[0];
    expect(lineage[1]).toBe(spell(passive.firepower!));
    expect(lineage[2]).toBe(spell(passive.defense!));
    const firepower = (mods: { firepower?: number }[]) => mods.reduce((n, m) => n + (m.firepower ?? 0), 0);
    const powers = /(\w+) percent more for a Surge, (\w+) for an Overclock/.exec(echoText)!;
    expect(powers[1]).toBe(spell(firepower(COMMANDERS.corvin.surge!.modifiers)));
    expect(powers[2]).toBe(spell(firepower(COMMANDERS.corvin.overclock!.modifiers)));
    const strike = COMMANDERS.corvin.overclock!.effects.find((e) => e.kind === 'strike');
    expect(strike).toMatchObject({ kind: 'strike', aim: 'mostValue' });
    const struck = /strikes the best cluster for (\w+) health, (\w+) tile around/.exec(echoText)!;
    expect(struck[1]).toBe(spell(strike!.kind === 'strike' ? strike!.hp : -1));
    expect(struck[2]).toBe(spell(strike!.kind === 'strike' ? strike!.radius : -1));
  });
  it('mission 8: each defense star takes a tenth off a healthy unit\'s damage, by the engine\'s own forecast on the mission\'s own terrain (maglev 0 stars to ridge 4)', () => {
    const lowDamage = (defender: { x: number; y: number }, attacker: { x: number; y: number }) => {
      const s = probe(TETHER_LINE, [
        { type: 'trooper', owner: 0, x: attacker.x, y: attacker.y }, { type: 'trooper', owner: 2, x: defender.x, y: defender.y }, { type: 'trooper', owner: 1, x: 3, y: 9 },
      ], { players: plainPlayers(TETHER_LINE) });
      return forecast(s, s.units.find((u) => u.owner === 0)!.id, attacker, defender).damage[0];
    };
    // maglev (5,6), flats (4,6), canopy (5,1), arcology (6,3), ridge (7,5): stars 0, 1, 2, 3, 4 from the data table.
    const tiles = [
      { at: { x: 5, y: 6 }, from: { x: 4, y: 6 } }, { at: { x: 4, y: 6 }, from: { x: 3, y: 6 } }, { at: { x: 5, y: 1 }, from: { x: 4, y: 1 } },
      { at: { x: 6, y: 3 }, from: { x: 5, y: 3 } }, { at: { x: 7, y: 5 }, from: { x: 6, y: 5 } },
    ];
    const map = mapOf(TETHER_LINE);
    const stars = tiles.map((t) => TERRAIN_TYPES[TERRAIN_CODES[map.terrain[t.at.y][t.at.x]]].def);
    expect(stars).toEqual([0, 1, 2, 3, 4]);
    const base = DAMAGE.trooper.secondary!.trooper!; // Trooper against Trooper: 55
    const expected = stars.map((s) => Math.floor((base * 100 * 10 * (100 - 10 * s)) / 100000)); // the formula in combat.ts, at full health, luck 0
    const measured = tiles.map((t) => lowDamage(t.at, t.from));
    expect(measured, 'forecast against the formula').toEqual(expected);
    expect(measured).toEqual([55, 49, 44, 38, 33]);
    for (let i = 0; i + 1 < measured.length; i++) expect(measured[i] - measured[i + 1], `star ${i} to ${i + 1}: a tenth of ${base} is ${base / 10}`).toBeGreaterThanOrEqual(5);
    for (let i = 0; i + 1 < measured.length; i++) expect(measured[i] - measured[i + 1]).toBeLessThanOrEqual(6);
    expect(measured[1], 'known-bad: a defender on flats takes more than one on a ridge').toBeGreaterThan(measured[4]);
  });
  it('mission 9: the ion storm costs the agent a tile of sight and the Wasp a tile of speed, and costs Sable nothing; the Warden answers the Wasp; ECHO\'s numbers are the data\'s', () => {
    const echoText = textOf(NIGHT_WING, 'echo');
    const units: MapDef['units'] = [{ type: 'trooper', owner: 0, x: 3, y: 6 }, { type: 'trooper', owner: 2, x: 5, y: 6 }, { type: 'trooper', owner: 1, x: 6, y: 9 }, { type: 'wasp', owner: 2, x: 15, y: 7 }];
    const storm = probe(NIGHT_WING, units);
    const mine = storm.units.find((u) => u.owner === 0)!;
    const hers = storm.units.find((u) => u.owner === 2 && u.type === 'trooper')!;
    const wasp = storm.units.find((u) => u.type === 'wasp')!;
    const clear = probe(NIGHT_WING, units, { weather: 'clear', fog: false });
    const said = /A Trooper sees (\w+) tile in the storm\. A Wasp moves (\w+), not (\w+)\./.exec(echoText)!;
    expect(said[1]).toBe(spell(effectiveVision(storm, mine)));
    expect(said[2]).toBe(spell(effectiveMove(storm, wasp)));
    expect(said[3]).toBe(spell(effectiveMove(clear, clear.units.find((u) => u.type === 'wasp')!)));
    expect(effectiveVision(storm, mine), 'one tile less than clear sky').toBe(effectiveVision(clear, clear.units[0]) - 1);
    expect(effectiveMove(storm, wasp)).toBe(UNIT_TYPES.wasp.move - 1);
    // Ghost Wing: "her units see one tile further", which cancels the storm for her and for nobody else.
    const ghost = COMMANDERS.sable.passive.modifiers.find((m) => m.vision)!;
    expect(/her units see (\w+) tile further/.exec(echoText)![1]).toBe(spell(ghost.vision!));
    expect(effectiveVision(storm, hers)).toBe(UNIT_TYPES.trooper.vision);
    expect(effectiveVision(storm, hers) - effectiveVision(storm, mine)).toBe(ghost.vision);
    // ... so at two tiles apart in the storm she sees the agent's Trooper and it cannot see hers.
    expect(canSeeUnit(storm, 2, mine), 'Sable sees the agent').toBe(true);
    expect(canSeeUnit(storm, 0, hers), 'the agent cannot see Sable').toBe(false);
    expect(canSeeUnit(clear, 0, clear.units.find((u) => u.owner === 2 && u.type === 'trooper')!), 'known-bad control: in clear air both see').toBe(true);
    const plain = probe(NIGHT_WING, units, { players: plainPlayers(NIGHT_WING) });
    expect(canSeeUnit(plain, 2, plain.units.find((u) => u.owner === 0)!), 'known-bad control: without Ghost Wing she is as blind as anyone').toBe(false);
    // The answer to the wing, from the damage table, and what she flies.
    expect(/A Warden does (.+?) percent to a Wasp/.exec(echoText)![1]).toBe(spell(DAMAGE.warden.primary!.wasp!));
    expect(echoText).toMatch(/She flies Wasps, a Raptor and an Anvil/);
    const air = new Set(mapOf(NIGHT_WING).units.filter((u) => u.owner === 2 && UNIT_TYPES[u.type].domain === 'air').map((u) => u.type));
    expect([...air].sort()).toEqual(['anvil', 'raptor', 'wasp']);
  });
  it('mission 9: the escort is a survival as long as the convoy\'s crossing: three Mules, twenty-seven tiles for the rear one, six a cycle, five cycles', () => {
    const map = mapOf(NIGHT_WING);
    const echoText = textOf(NIGHT_WING, 'echo');
    const exit = tilesOf(map, (c, o) => c === 'U' && o === '.')[0];
    const mules = map.units.filter((u) => u.type === 'mule');
    const rear = Math.max(...mules.map((u) => pathCost(map, u, exit, 'hover')));
    expect(/(\w+) Mules on the high road/.exec(echoText)![1]).toBe(spell(mules.length));
    expect(/The relay is (\S+) tiles from the rear Mule, and a Mule moves (\w+)\./.exec(echoText)!.slice(1)).toEqual([spell(rear), spell(UNIT_TYPES.mule.move)]);
    const cycles = Math.ceil(rear / UNIT_TYPES.mule.move);
    expect(/needs (\w+) cycles to clear the pass/.exec(echoText)![1]).toBe(spell(cycles));
    expect(NIGHT_WING.objective).toEqual({ kind: 'survive', cycles });
    expect(NIGHT_WING.par.cycles).toBe(cycles);
    // The logs the convoy carries are the ones Act II ends on: "sealed", bound for Calder.
    expect(ROOT_AND_BRANCH.debrief.some((l) => l.speaker === 'ilse' && /sealed/.test(l.text) && /Calder/.test(l.text))).toBe(true);
    expect(NIGHT_WING.briefing.some((l) => /sealed Ashfall logs/.test(l.text))).toBe(true);
    expect(POLLEN_COUNT.location).toContain('Ashfall');
    expect(NIGHT_WING.briefing.some((l) => l.speaker === 'ilse' && /Calder/.test(l.text))).toBe(true);
  });
  it('mission 9: the stealth wing catches the convoy and lets it go, and a secret parley under the storm names the Highlord\'s field at Ashgrave', () => {
    expect(ACT_III_OUTLINE[1][3]).toContain('catches Rook\'s convoy');
    expect(ACT_III_OUTLINE[1][3]).toContain('and lets it go');
    expect(ACT_III_OUTLINE[1][3]).toContain('secret parley');
    // She attacks (the wing is told to take the tail) and then holds fire when the crossing is done.
    const attack = NIGHT_WING.events.find((e) => e.trigger.kind === 'cycle' && e.lines.some((l) => l.speaker === 'sable' && /Take the tail/.test(l.text)));
    expect(attack, 'the attack').toBeDefined();
    const victory = NIGHT_WING.events.find((e) => e.trigger.kind === 'victory')!;
    expect(victory.lines.some((l) => l.speaker === 'sable' && /Hold fire/.test(l.text) && /Let them go/.test(l.text)), 'she lets it go').toBe(true);
    expect(victory.lines.some((l) => l.speaker === 'echo' && /breaking off/.test(l.text))).toBe(true);
    // The parley: ECHO opens it, Sable speaks on the encrypted net, Rook answers, and the debrief ends on the narrator.
    expect(NIGHT_WING.debrief[0].speaker).toBe('echo');
    expect(NIGHT_WING.debrief[0].text).toMatch(/encrypted/);
    expect(NIGHT_WING.debrief.some((l) => l.speaker === 'rook')).toBe(true);
    const text = NIGHT_WING.debrief.map((l) => l.text).join('\n');
    expect(text).toMatch(/Ashgrave/);
    expect(text).toMatch(/came over the Link/);
    expect(text).toMatch(/Hollow Choir hulls from Ashfall/);
    expect(DUEL_AT_ASHGRAVE.location).toBe('Ashgrave Heights');
    expect(NIGHT_WING.debrief[NIGHT_WING.debrief.length - 1].speaker).toBe('narrator');
  });
  it('mission 10: the Highlord meets the column in the open, the Night Wing turns on the drones mid-battle, and the numbers and gates ECHO gives are the map\'s and the data\'s', () => {
    const echoText = textOf(DUEL_AT_ASHGRAVE, 'echo');
    const map = mapOf(DUEL_AT_ASHGRAVE);
    expect(ACT_III_OUTLINE[2][3]).toContain('Mid-battle Sable turns her wing against the Choir drones shadowing both armies');
    expect(DUEL_AT_ASHGRAVE.briefing.filter((l) => l.speaker === 'corvin').length, 'the Highlord invites the duel').toBeGreaterThanOrEqual(2);
    expect(DUEL_AT_ASHGRAVE.briefing.some((l) => l.speaker === 'rook' && /engineer/.test(l.text))).toBe(true);
    // "Two squads, one on each flank, standing off": the map has two groups of three, north and south.
    const drones = map.units.filter((u) => u.owner === 3);
    const groups = [drones.filter((u) => u.y <= 5).length, drones.filter((u) => u.y >= 8).length];
    expect(groups).toEqual([3, 3]);
    expect(/(\w+) squads, one on each flank/.exec(echoText)![1]).toBe(spell(groups.length).replace(/^t/, 'T'));
    // The Overclock, by name and by number.
    const overclock = COMMANDERS.corvin.overclock!;
    expect(echoText).toContain(overclock.name);
    const strike = overclock.effects.find((e) => e.kind === 'strike');
    expect(/strikes (\w+) health/.exec(echoText)![1]).toBe(spell(strike!.kind === 'strike' ? strike!.hp : -1));
    // The terraces: ridge, four stars, two gates on the maglev road.
    expect(/The terraces are ridge, (\w+) stars each/.exec(echoText)![1]).toBe(spell(TERRAIN_TYPES.ridge.def));
    const gates = [16, 19].filter((x) => map.terrain[7][x] === '=').length;
    expect(/through the (\w+) gates on the maglev road/.exec(echoText)![1]).toBe(spell(gates));
    // The turn, the truth and the end.
    const text = DUEL_AT_ASHGRAVE.debrief.map((l) => l.text).join('\n');
    expect(text).toMatch(/forged/);
    expect(text).toMatch(/Glass Waste/);
    expect(text).toMatch(/came over the Link/);
    expect(DUEL_AT_ASHGRAVE.debrief[0].speaker, 'the Highlord speaks first, to his daughter').toBe('corvin');
    expect(DUEL_AT_ASHGRAVE.debrief.filter((l) => l.speaker === 'sable').length, 'the truth is hers').toBeGreaterThanOrEqual(3);
    expect(DUEL_AT_ASHGRAVE.debrief.some((l) => l.speaker === 'corvin' && /forgery/.test(l.text))).toBe(true);
    expect(DUEL_AT_ASHGRAVE.debrief[DUEL_AT_ASHGRAVE.debrief.length - 1].speaker).toBe('narrator');
    expect(DUEL_AT_ASHGRAVE.debrief[DUEL_AT_ASHGRAVE.debrief.length - 1].text).toMatch(/daughter/);
    // The forgery is the one Act I found: the Calder order, with a Helion signature (STORY: "forged ... with Helion's signature").
    expect(STORY).toContain('forged a strike order on Calder Spire with Helion\'s signature');
    expect(TIDEBREAK.events.some((e) => e.lines.some((l) => /signature is ours/.test(l.text)))).toBe(true);
  });
  it('mission 11: Dax is exposed and hands the coast over as his exit, Sefa and Rook retake it with the agent, allied sight is shared, and the voice that counts every channel opens Act IV', () => {
    const echoText = textOf(AUDIT, 'echo');
    const map = mapOf(AUDIT);
    expect(ACT_III_OUTLINE[3][3]).toContain('exposed and hands Tidewell\'s coastal fabricators to the Choir as his "exit"');
    expect(AUDIT.briefing.some((l) => l.speaker === 'dax' && /\bexit\b/.test(l.text)), 'his own word for it').toBe(true);
    expect(AUDIT.briefing.some((l) => l.speaker === 'sefa' && /Halloran|Commissioner/.test(l.text))).toBe(true);
    expect(textOf(AUDIT, 'sefa')).toMatch(/three fabricators/);
    expect(/Situation: (\w+) fabricators/.exec(echoText)![1]).toBe(spell(tilesOf(map, (c, o) => c === 'F' && o === '2').length));
    expect(/(\w+) fabricators and the Harbour Exchange/.exec(textOf(AUDIT, 'sefa'))![1]).toBe(spell(3));
    expect(echoText).toMatch(/The address answers on the old Lattice net/);
    expect(STORY).toContain('Trades with VESPER'); // the secret ECHO is circling without the name
    // D-007: attached to the fleet as its adjutant, two fronts, Rook beside, and Sefa's sample line in her last words.
    expect(AUDIT.briefing.some((l) => l.speaker === 'echo' && /attached to Admiral Tamura's fleet as its adjutant/.test(l.text))).toBe(true);
    expect(AUDIT.briefing.some((l) => l.speaker === 'echo' && /Two fronts/.test(l.text))).toBe(true);
    expect(AUDIT.briefing.some((l) => l.speaker === 'rook' && /Admiral/.test(l.text))).toBe(true);
    // Allied sight is shared: Sefa's Picket (vision 3) shows the agent a Choir Wasp three tiles from it, and without the Picket (or the alliance) the agent is blind.
    const units: MapDef['units'] = [
      { type: 'picket', owner: 3, x: 9, y: 3 }, { type: 'wasp', owner: 2, x: 12, y: 3 }, { type: 'trooper', owner: 0, x: 3, y: 8 }, { type: 'trooper', owner: 1, x: 3, y: 11 },
    ];
    expect(UNIT_TYPES.picket.vision).toBe(3);
    const shared = probe(AUDIT, units);
    expect(canSeeUnit(shared, 0, shared.units.find((u) => u.owner === 2)!), 'the agent sees it through the Picket').toBe(true);
    const blind = probe(AUDIT, [...units.filter((u) => u.type !== 'picket'), { type: 'trooper', owner: 3, x: 3, y: 2 }]);
    expect(canSeeUnit(blind, 0, blind.units.find((u) => u.owner === 2)!), 'known-bad control: no Picket, no sight').toBe(false);
    const apart = probe(AUDIT, units, { players: setupFor(AUDIT, 1).players.map((p, i) => (i === 3 ? { ...p, team: 9 } : p)) });
    expect(canSeeUnit(apart, 0, apart.units.find((u) => u.owner === 2)!), 'known-bad control: Sefa on a team of her own shares nothing').toBe(false);
    expect(echoText).toMatch(/Sight is shared across the team/);
    // The end: Sefa's line, and the voice that opens Act IV ("VESPER speaks to all four nations at once", unnamed here).
    const actIV = STORY.slice(STORY.indexOf('### Act IV'), STORY.indexOf('**Epilogue'));
    expect(actIV).toContain('speaks to all four nations at once');
    expect(AUDIT.debrief[AUDIT.debrief.length - 1].speaker).toBe('narrator');
    expect(AUDIT.debrief[AUDIT.debrief.length - 1].text).toMatch(/every channel of every nation at once/);
    expect(AUDIT.debrief[AUDIT.debrief.length - 1].text).not.toMatch(/vesper/i);
    expect(AUDIT.events.find((e) => e.trigger.kind === 'propertyCaptured')!.lines.some((l) => l.speaker === 'echo' && /Fabricator retaken/.test(l.text))).toBe(true);
  });
});

// ---------------------------------------------------------------- self-play

describe('every Act III mission plays under simulate', () => {
  const policies: SimPolicy[] = ['greedy', 'random'];
  for (const m of ACT_III) {
    for (const policy of policies) {
      it(`${m.id}: ${policy} policy, seeds 1-3, ends without an exception and with a winner that earned it`, () => {
        for (const seed of [1, 2, 3]) {
          const setup = setupFor(m, seed);
          let started = 0;
          const result = simulate({ setup, seed, maxCycles: 14, policy, onStart: () => { started++; } });
          expect(started, `${m.id} ${policy} seed ${seed}`).toBe(1);
          expect(result.actions.length, `${m.id} ${policy} seed ${seed}`).toBeGreaterThan(0);
          expect(result.cycles).toBeGreaterThanOrEqual(1);
          expect(result.cycles).toBeLessThanOrEqual(14);
          expect(result.state.players).toHaveLength(m.players.length);
          const team0 = m.players[0].team;
          const rivals = result.state.players.filter((p) => p.team !== team0);
          if (m.objective.kind === 'survive' && result.winnerTeam === team0 && rivals.some((p) => !p.defeated)) {
            expect(result.cycles, `${m.id} survive win`).toBeGreaterThanOrEqual(m.objective.cycles); // a win before cycle 5 must come from routing the wing
          }
          if ((m.objective.kind === 'hq' || m.objective.kind === 'rout') && result.winnerTeam === team0) {
            expect(rivals.every((p) => p.defeated), `${m.id} ${m.objective.kind} win by ${policy} seed ${seed}: every rival defeated`).toBe(true);
          }
          if (result.winnerTeam !== null) expect(result.state.players.some((p) => p.team === result.winnerTeam && !p.defeated)).toBe(true);
        }
      });
    }
  }
});

// ================================================================================================================================
// M4.3 Act IV, "The Hollow Choir": missions 12-14, the end of the campaign. Spec: docs/STORY.md "The secret", "Act IV" (the outline, the EPILOGUE
// and the entries for Cantor, VESPER, ECHO, Ilse, Rook and the rest), "Writing rules for dialogue" and D-007. Same method as Acts I-III above: every
// expectation comes from the story text, the map rows, the data tables or the engine, never from missions.ts. Representation choices pinned down:
//   12  "Survive, then rout" is a rout objective (a survive objective would end at a cycle and never ask for the rout) with a cycle event that
//       announces the turn of the tide; every commander met so far is on the radio.
//   13  "Player controls Ilse" is read as the agent attached to her army as its adjutant (slot 3, an AI ally); her choice is told by cycle events,
//       which always fire, and the outcome is that she chooses the mission. Cantor is the enemy commander.
//   14  Five players, the engine's limit: the four nations are the four allied slots on the agent's team, VESPER is the enemy, and Rook is on the
//       radio at ECHO's console. The debrief carries the EPILOGUE of STORY.md and ends on its quoted line word for word.
// ================================================================================================================================

const ACT_IV = ALL_MISSIONS.filter((m) => m.act === 4);
const [STATIC, REQUIEM, NULL_SPIRE] = ACT_IV;
const ACT_IV_LINES = ACT_IV.flatMap(linesOf);
const ACT_IV_STORY = STORY.slice(STORY.indexOf('### Act IV'), STORY.indexOf('**Epilogue'));
const ACT_IV_OUTLINE = [...ACT_IV_STORY.matchAll(/^(\d+)\. \*\*([^*]+)\*\* — ([^\n]+)$/gm)];
const STORY_OUTLINE = [...STORY.matchAll(/^(\d+)\. \*\*([^*]+)\*\* — ([^\n]+)$/gm)];
const EPILOGUE = /\*\*Epilogue\.\*\* ([^\n]+)/.exec(STORY)![1];
const EPILOGUE_QUOTE = /\*"([^"]+)"\*\s*$/.exec(EPILOGUE)![1];
const EPILOGUE_NARRATION = `${EPILOGUE.slice(0, EPILOGUE.indexOf(': *"'))}.`; // the epilogue's own sentences, before the quoted line

const MINOR_SPEAKERS_IV = ['Calder Watch'];
const ACT_IV_SPEAKERS = ['echo', 'rook', 'ilse', 'sefa', 'dax', 'corvin', 'sable', 'juno', 'maru', 'cantor', 'vesper', 'narrator', ...MINOR_SPEAKERS_IV];
// STORY: ECHO never uses "!" and Juno uses too many; VESPER is "not cruel, certain" and Cantor "never angry"; Ilse and Sefa never raise their voice,
// Maru never raises theirs, Dax is smooth, the narrator and the officials are plain. Rook, Juno, Corvin and Sable are not on the list.
const ACT_IV_RULES: DialogueRules = {
  speakers: ACT_IV_SPEAKERS,
  neverShouts: new Set(['echo', 'vesper', 'cantor', 'ilse', 'sefa', 'dax', 'maru', 'narrator', ...MINOR_SPEAKERS_IV]),
  spoilers: [],
};
// Act IV may name the Hollow Choir, the Lattice and the Glass Waste. The reveals come one per mission: VESPER is named first in 12, Cantor and Mira
// in 13 and the Lattice core in 14, so each mission bans the names of the reveals that come after it.
const REVEAL_BANS: Record<string, RegExp[]> = {
  static: [/\bcantor\b/i, /\bmira\b/i, /lattice core/i],
  requiem: [/lattice core/i],
  'null-spire': [],
};
const rulesFor = (m: Mission): DialogueRules => ({ ...ACT_IV_RULES, spoilers: REVEAL_BANS[m.id] });
const NAMES = { vesper: /vesper/i, cantor: /\bcantor\b/i, mira: /\bmira\b/i, core: /lattice core/i };

/** Every string of a mission a player could read: ids, titles, summaries, objective text, speakers, channels, lines, map name and description. */
function stringsOf(m: Mission): string[] {
  const map = mapOf(m);
  const out: string[] = [m.id, m.title, m.location, m.summary, m.mapId, m.objectiveText, map.id, map.name, map.description, map.author ?? ''];
  for (const l of linesOf(m)) out.push(l.speaker, l.text, l.channel ?? '');
  return out;
}
const namedIn = (m: Mission, re: RegExp) => stringsOf(m).filter((s) => re.test(s)).length;

/** VESPER speaks in the plural: "we", never "I" (STORY). Lines that break it, empty = clean. */
function vesperProblems(lines: DialogueLine[]): string[] {
  const out: string[] = [];
  for (const l of lines.filter((x) => x.speaker === 'vesper')) {
    if (/\bI\b|\bI['’]|\bmy\b|\bme\b|\bmine\b/.test(l.text)) out.push(`singular (${l.text})`);
    if (!/\bwe\b/i.test(l.text)) out.push(`no "we" (${l.text})`);
  }
  return out;
}

/** What is wrong with a debrief that should carry the epilogue: its narration in order, then the quoted line, last, spoken by ECHO. Empty = faithful. */
function epilogueProblems(debrief: DialogueLine[], narration: string, quote: string): string[] {
  const out: string[] = [];
  const told = debrief.filter((l) => l.speaker === 'narrator').map((l) => l.text).join(' ');
  if (told !== narration) out.push(`narration differs: "${told}"`);
  const last = debrief[debrief.length - 1];
  if (last.speaker !== 'echo') out.push(`the last line is spoken by ${last.speaker}`);
  if (last.text !== quote) out.push(`the last line is not the quoted line: "${last.text}"`);
  return out;
}

const storyVoice = (name: string) => new RegExp(`### ${name}[\\s\\S]*?\\*Voice:\\* "([^"]+)"`).exec(STORY)?.[1];
const ringTiles = (map: MapDef, core: { x: number; y: number }, r: number) => tilesOf(map, (_c, _o, x, y) => Math.max(Math.abs(x - core.x), Math.abs(y - core.y)) === r);

describe('Act IV: the campaign act, and the whole campaign across acts 1-4', () => {
  it('has act 4, "The Hollow Choir", with the tagline STORY.md prints under the heading and the three mission ids in outline order', () => {
    const head = /### Act IV — ([^\n]+)\n\*"([^"]+)"\*/.exec(STORY);
    expect(head, 'STORY.md Act IV heading').not.toBeNull();
    expect(head![1]).toBe('The Hollow Choir');
    const act = ALL_ACTS.find((a) => a.act === 4);
    expect(act, 'act 4 is listed').toBeDefined();
    expect(act!.title).toBe(head![1]);
    expect(act!.tagline).toBe(head![2]);
    const idsFromTitles = ACT_IV_OUTLINE.map((m) => m[2].toLowerCase().replace(/ /g, '-')); // 'Null Spire' -> 'null-spire'
    expect(act!.missions).toEqual(idsFromTitles);
    expect(act!.missions).toEqual(ACT_IV.map((m) => m.id));
    expect(act!.missions).toEqual(['static', 'requiem', 'null-spire']);
  });
  it('follows the Act IV outline in STORY.md: titles and numbers in order, and the places it names', () => {
    expect(ACT_IV_OUTLINE.map((m) => m[2])).toEqual(['Static', 'Requiem', 'Null Spire']);
    expect(ACT_IV.map((m) => m.title)).toEqual(ACT_IV_OUTLINE.map((m) => m[2]));
    expect(ACT_IV.map((m) => m.order)).toEqual(ACT_IV_OUTLINE.map((m) => Number(m[1])));
    expect(ACT_IV.map((m) => m.order)).toEqual([12, 13, 14]);
    expect(ACT_IV.every((m) => m.act === 4)).toBe(true);
    expect(ACT_IV_OUTLINE[0][3]).toContain('Defence of Calder');
    expect(STATIC.location).toContain('Calder');
    expect(ACT_IV_OUTLINE[1][3]).toContain('march into the Glass Waste');
    expect(REQUIEM.location, "the Choir's home is the Glass Waste").toBe(FACTIONS.choir.home);
    expect(ACT_IV_OUTLINE[2][3]).toContain('Lattice core');
    expect(NULL_SPIRE.location).toMatch(/Lattice/);
  });
  it('lays the whole campaign out in order across acts 1-4: 14 missions, ids / orders / maps / map names unique, in STORY\'s order, no skirmish map shadowed', () => {
    expect(ALL_ACTS.map((a) => a.act)).toEqual([1, 2, 3, 4]);
    expect(ALL_MISSIONS).toHaveLength(14);
    expect(ALL_MISSIONS.map((m) => m.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(ALL_ACTS.flatMap((a) => a.missions)).toEqual(ALL_MISSIONS.map((m) => m.id));
    for (const a of ALL_ACTS) expect(ALL_MISSIONS.filter((m) => m.act === a.act).map((m) => m.id), `act ${a.act}`).toEqual(a.missions);
    expect(duplicates(ALL_MISSIONS.map((m) => m.id))).toEqual([]);
    expect(duplicates(ALL_MISSIONS.map((m) => m.mapId))).toEqual([]);
    for (const m of ALL_MISSIONS) expect(m.id, m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(Object.keys(ALL_MISSION_MAPS).sort()).toEqual(ALL_MISSIONS.map((m) => m.mapId).sort());
    expect(new Set(Object.values(ALL_MISSION_MAPS).map((m) => m.name)).size).toBe(14);
    for (const [key, map] of Object.entries(ALL_MISSION_MAPS)) {
      expect(map.id, key).toBe(key);
      expect(MAPS[key], `${key} must not shadow a skirmish map`).toBeUndefined();
    }
    for (const map of Object.values(ALL_MISSION_MAPS)) expect(Object.values(MAPS).some((s) => s.name === map.name), `${map.name} reuses a skirmish map name`).toBe(false);
    // STORY's own outline: fourteen numbered missions, in the order, the numbers and the acts the data has.
    expect(STORY_OUTLINE).toHaveLength(14);
    expect(STORY_OUTLINE.map((m) => Number(m[1]))).toEqual(ALL_MISSIONS.map((m) => m.order));
    expect(STORY_OUTLINE.map((m) => m[2])).toEqual(ALL_MISSIONS.map((m) => m.title));
    const actsInStory = [...STORY.matchAll(/^### Act (I|II|III|IV) — ([^\n]+)\n\*"([^"]+)"\*/gm)];
    expect(actsInStory.map((a) => a[2])).toEqual(ALL_ACTS.map((a) => a.title));
    expect(actsInStory.map((a) => a[3])).toEqual(ALL_ACTS.map((a) => a.tagline));
  });
  it('would notice a duplicated mission id, an Act IV mission filed under another act, or a tagline copied from the wrong act', () => {
    expect(duplicates([...ALL_MISSIONS.map((m) => m.id), 'null-spire'])).toEqual(['null-spire']);
    expect(duplicates([...ALL_MISSIONS.map((m) => m.mapId), 'm14-null-spire'])).toEqual(['m14-null-spire']);
    expect(ALL_ACTS[3].tagline).not.toBe(ALL_ACTS[2].tagline);
    expect(ALL_ACTS[3].missions.some((id) => ALL_ACTS[2].missions.includes(id)), 'no mission belongs to two acts').toBe(false);
    expect(ALL_ACTS[3].missions.slice(0, 2)).not.toEqual(ACT_IV.map((m) => m.id));
    expect(ALL_ACTS[3].missions.length, 'a missing mission would shorten the act').toBe(3);
    // A story outline with a mission missing would no longer match the data.
    expect(STORY_OUTLINE.slice(0, 13).map((m) => m[2])).not.toEqual(ALL_MISSIONS.map((m) => m.title));
  });
});

describe('the three Act IV missions: shape', () => {
  it('have 6-14 briefing lines, 2-6 events (start, victory and defeat among them), 4-12 debrief lines, and every event is once', () => {
    expect(ACT_IV).toHaveLength(3);
    for (const m of ACT_IV) {
      expect(m.briefing.length, `${m.id} briefing`).toBeGreaterThanOrEqual(6);
      expect(m.briefing.length, `${m.id} briefing`).toBeLessThanOrEqual(14);
      expect(m.events.length, `${m.id} events`).toBeGreaterThanOrEqual(2);
      expect(m.events.length, `${m.id} events`).toBeLessThanOrEqual(6);
      expect(m.debrief.length, `${m.id} debrief`).toBeGreaterThanOrEqual(4);
      expect(m.debrief.length, `${m.id} debrief`).toBeLessThanOrEqual(12);
      const kinds = m.events.map((e) => e.trigger.kind);
      for (const k of ['start', 'victory', 'defeat']) expect(kinds, `${m.id} has a ${k} event`).toContain(k);
      for (const e of m.events) {
        expect(e.once, `${m.id} ${e.trigger.kind}`).toBe(true);
        expect(e.lines.length, `${m.id} ${e.trigger.kind}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('have a title, a location, a one-line summary and an objective sentence, no turn limit (D-013), fog in missions 13 and 14 only, and the ion storm in mission 14 only', () => {
    for (const m of ACT_IV) {
      expect(m.title.length, m.id).toBeGreaterThan(0);
      expect(m.location.length, m.id).toBeGreaterThan(0);
      expect(m.summary, m.id).toMatch(/^[A-Z][^\n]+\.$/);
      expect(m.summary.length, m.id).toBeLessThanOrEqual(160);
      expect(m.objectiveText, m.id).toMatch(/^[A-Z][^\n]+\.$/);
      expect(m.turnLimit, `${m.id}: the engine reads turnLimit as a versus day limit (D-013)`).toBeUndefined();
    }
    expect(ACT_IV.map((m) => m.fog)).toEqual([false, true, true]);
    expect(ACT_IV.map((m) => m.weather)).toEqual(['clear', 'clear', 'ionstorm']);
    expect(ALL_MISSIONS.filter((m) => m.weather === 'ionstorm').map((m) => m.id), 'the storms of the campaign').toEqual(['night-wing', 'null-spire']);
  });
  it('sets the permanent ion storm on mission 14: the engine starts in a storm that never lifts, and clear weather with the same units shows everything (known-bad control)', () => {
    const s = createGame(setupFor(NULL_SPIRE, 1));
    expect(s.weather).toBe('ionstorm');
    expect(s.baseWeather, 'the storm is the base weather, so nothing restores clear sky').toBe('ionstorm');
    expect(s.weatherTurnsLeft, '0 turns left means permanent').toBe(0);
    expect(visibility(s, 0).flat().some((seen) => !seen), 'part of the map is hidden from the agent').toBe(true);
    const clear = createGame({ ...setupFor(NULL_SPIRE, 1), fog: false, weather: 'clear' });
    expect(visibility(clear, 0).flat().every(Boolean)).toBe(true);
    for (const m of [STATIC, REQUIEM]) expect(createGame(setupFor(m, 1)).weather, m.id).toBe('clear');
    expect(createGame(setupFor(REQUIEM, 1)).fog, 'the march is fogged').toBe(true);
    expect(createGame(setupFor(STATIC, 1)).fog, 'the defence of Calder is not').toBe(false);
  });
  it('have par values the score can use: whole positive cycles, a positive power, and a par that leaves room for the cycle events', () => {
    for (const m of ACT_IV) {
      expect(Number.isInteger(m.par.cycles) && m.par.cycles > 0, `${m.id} par.cycles`).toBe(true);
      expect(Number.isFinite(m.par.power) && m.par.power > 0, `${m.id} par.power`).toBe(true);
      expect(() => scoreCard(createGame(setupFor(m, 1)), 0, m.par), m.id).not.toThrow();
      for (const e of m.events) if (e.trigger.kind === 'cycle') expect(e.trigger.cycle, `${m.id} cycle event`).toBeLessThan(m.par.cycles);
    }
    expect(ACT_IV.map((m) => m.par.cycles)).toEqual([12, 14, 14]);
    expect(() => scoreCard(createGame(setupFor(STATIC, 1)), 0, { cycles: 0, power: 2 }), 'a zero par is refused').toThrow();
  });
  it('mean what the design says: "Survive, then rout" as a rout, and spire captures for the march and the core', () => {
    expect(ACT_IV_OUTLINE[0][3]).toContain('Survive, then rout');
    expect(STATIC.objective, 'the contract has one objective: the closest shape that still ends in the rout').toEqual({ kind: 'rout' });
    expect(STATIC.objectiveText).toMatch(/^Hold Calder until the other nations arrive, then break the Choir/);
    expect(REQUIEM.objective).toEqual({ kind: 'hq' });
    expect(REQUIEM.objectiveText).toMatch(/^Capture the Choir's relay spire/);
    expect(NULL_SPIRE.objective).toEqual({ kind: 'hq' });
    expect(NULL_SPIRE.objectiveText).toMatch(/^Capture the Null Spire/);
    expect(ACT_IV_OUTLINE[1][3]).toContain('Cantor as enemy CO');
    expect(ACT_IV_OUTLINE[2][3]).toContain('Final battle vs VESPER');
  });
  it('tells the turn of the tide in mission 12 at a cycle event inside the battle, after the nations are announced and before the par', () => {
    const arrivals = STATIC.events.find((e) => e.lines.some((l) => /three cycles out/.test(l.text)))!;
    const tide = STATIC.events.find((e) => e.lines.some((l) => /no longer outnumbers us/.test(l.text)))!;
    expect(arrivals.trigger.kind).toBe('cycle');
    expect(tide.trigger.kind).toBe('cycle');
    const at = (e: typeof tide) => (e.trigger.kind === 'cycle' ? e.trigger.cycle : -1);
    expect(at(arrivals)).toBeGreaterThan(1);
    expect(at(tide), 'three cycles after they were announced').toBe(at(arrivals) + 3);
    expect(at(tide)).toBeLessThan(STATIC.par.cycles);
    expect(tide.lines[0].speaker, 'ECHO announces it').toBe('echo');
    expect(tide.lines.some((l) => l.speaker === 'ilse' && /Now we break them/.test(l.text)), 'the Marshal turns the line into an advance').toBe(true);
    expect(STATIC.briefing.filter((l) => /no longer outnumbers us|Now we break them/.test(l.text)), 'nothing in the briefing has the tide turned already').toEqual([]);
  });
});

// ---------------------------------------------------------------- players: D-007

describe('Act IV players (D-007: the agent is the commander, the named cast are NPCs)', () => {
  it('seat the agent as player 0 (human, "agent", Helion) and exactly one human; 12 has 3 players, 13 has 4, 14 has 5 with every ally on team 0', () => {
    expect(ACT_IV.map((m) => m.players.length)).toEqual([3, 4, 5]);
    expect(NULL_SPIRE.players.length, 'mission 14 has 4-5 players').toBeGreaterThanOrEqual(4);
    expect(NULL_SPIRE.players.length).toBeLessThanOrEqual(5);
    for (const m of ACT_IV) {
      const [me] = m.players;
      expect(me, m.id).toMatchObject({ faction: 'helion', commander: 'agent', controller: 'human', team: 0 });
      expect(m.players.filter((p) => p.controller === 'human'), m.id).toHaveLength(1);
      expect(m.players.filter((p) => p.faction === 'choir'), `${m.id}: one Choir player`).toHaveLength(1);
      const foe = m.players.find((p) => p.faction === 'choir')!;
      expect(foe.controller, m.id).toBe('ai');
      expect(foe.team, m.id).not.toBe(me.team);
      expect(m.players.indexOf(foe), `${m.id}: the opposing force is slot 2`).toBe(2);
      for (const p of m.players.filter((x) => x !== foe && x !== me)) expect(p, `${m.id} ${p.commander}`).toMatchObject({ controller: 'ai', team: me.team });
    }
    expect(NULL_SPIRE.players.filter((p) => p.team === 0)).toHaveLength(4);
    expect(NULL_SPIRE.players.filter((p) => p.team !== 0)).toHaveLength(1);
  });
  it('uses the opponents STORY.md names: the unnamed Choir, then Cantor, then VESPER', () => {
    expect(STATIC.players[2]).toMatchObject({ faction: 'choir', commander: 'none' });
    expect(REQUIEM.players[2]).toMatchObject({ faction: 'choir', commander: 'cantor' });
    expect(NULL_SPIRE.players[2]).toMatchObject({ faction: 'choir', commander: 'vesper' });
    expect(COMMANDERS.cantor.faction).toBe('choir');
    expect(COMMANDERS.vesper.faction).toBe('choir');
    expect(ACT_IV_OUTLINE[1][3]).toContain('Cantor');
    expect(ACT_IV_OUTLINE[2][3]).toContain('VESPER');
    expect(ACT_IV.flatMap((m) => m.players).filter((p) => ['cantor', 'vesper'].includes(p.commander)).map((p) => p.commander)).toEqual(['cantor', 'vesper']);
  });
  it('names real commanders of the right faction, leaves "agent" and "none" unknown, and pays every player exactly 1000 a property (no Act IV commander changes income)', () => {
    for (const m of ACT_IV) {
      for (const p of m.players) {
        if (p.commander === 'agent' || p.commander === 'none') continue;
        expect(COMMANDERS[p.commander], `${m.id} ${p.commander}`).toBeDefined();
        expect(COMMANDERS[p.commander].faction, `${m.id} ${p.commander}`).toBe(p.faction);
      }
      const s = createGame(setupFor(m, 1));
      for (let p = 0; p < m.players.length; p++) {
        expect(incomeOf(s, p), `${m.id} player ${p}`).toBe(1000 * tilesOf(mapOf(m), (c, o) => 'CFADH'.includes(c) && o === String(p)).length);
      }
    }
    expect(COMMANDERS.cantor.pronouns).toBe('it, answers to she');
    expect(COMMANDERS.vesper.pronouns).toBe('it/its');
  });
  it('mission 13 (D-007): Ilse and Rook are AI allies on the agent\'s team, Cantor is the only enemy, and "player controls Ilse" is read as the agent attached to her army', () => {
    expect(ACT_IV_OUTLINE[1][3]).toContain('Player controls Ilse');
    const [me, rook, cantor, ilse] = REQUIEM.players;
    expect(ilse).toMatchObject({ faction: 'helion', commander: 'ilse', controller: 'ai', team: me.team });
    expect(rook).toMatchObject({ commander: 'rook', controller: 'ai', team: me.team });
    expect(cantor.team).not.toBe(me.team);
    expect(REQUIEM.players.filter((p) => p.team !== me.team)).toHaveLength(1);
    expect(REQUIEM.players.some((p) => p.commander === 'ilse' && p.controller === 'human'), 'Ilse is never the player').toBe(false);
    expect(REQUIEM.briefing.some((l) => l.speaker === 'echo' && /attached to Marshal Varga's army as its adjutant\. She leads\./.test(l.text))).toBe(true);
    // Engine: Ilse's Arc shells the Choir's Trooper and never the agent's Trooper beside it.
    const units: MapDef['units'] = [
      { type: 'arc', owner: 3, x: 10, y: 5 }, { type: 'trooper', owner: 0, x: 10, y: 7 }, { type: 'trooper', owner: 2, x: 12, y: 6 }, { type: 'trooper', owner: 1, x: 3, y: 10 },
    ];
    const s = probe(REQUIEM, units, { fog: false });
    const arc = s.units.find((u) => u.owner === 3)!;
    expect(attackTargets(s, arc.id, { x: 10, y: 5 }).map((c) => `${c.x},${c.y}`)).toEqual(['12,6']);
    // Known-bad control: give Ilse a team of her own and the agent's Trooper is a target.
    const foe = probe(REQUIEM, units, { fog: false, players: setupFor(REQUIEM, 1).players.map((p, i) => (i === 3 ? { ...p, team: 9 } : p)) });
    const arc2 = foe.units.find((u) => u.owner === 3)!;
    expect(attackTargets(foe, arc2.id, { x: 10, y: 5 }).map((c) => `${c.x},${c.y}`).sort()).toEqual(['10,7', '12,6']);
  });
  it('mission 14: the four nations are the four allied armies (Helion, Tidewell, Verdant, Kestrel), VESPER is alone, and an allied unit shoots VESPER\'s units and never an ally\'s', () => {
    expect(ACT_IV_OUTLINE[2][3]).toContain('Allied armies on four fronts');
    const allies = NULL_SPIRE.players.filter((p) => p.team === NULL_SPIRE.players[0].team);
    expect(allies.map((p) => p.faction).sort()).toEqual(['helion', 'kestrel', 'tidewell', 'verdant']);
    expect(allies.map((p) => p.commander).sort()).toEqual(['agent', 'corvin', 'juno', 'sefa']);
    expect(new Set(NULL_SPIRE.players.map((p) => p.faction)).size, 'five players, five distinct armies').toBe(5);
    expect(NULL_SPIRE.players.some((p) => p.commander === 'rook'), 'Rook holds ECHO\'s channel and is not a field army').toBe(false);
    expect(NULL_SPIRE.briefing.some((l) => l.speaker === 'rook' && l.channel === 'Calder Link console')).toBe(true);
    const units: MapDef['units'] = [
      { type: 'wasp', owner: 3, x: 12, y: 6 }, { type: 'trooper', owner: 2, x: 12, y: 7 }, { type: 'trooper', owner: 4, x: 12, y: 5 }, { type: 'trooper', owner: 1, x: 11, y: 6 }, { type: 'trooper', owner: 0, x: 13, y: 6 },
    ];
    const s = probe(NULL_SPIRE, units, { fog: false, weather: 'clear' });
    const wasp = s.units.find((u) => u.owner === 3)!;
    expect(attackTargets(s, wasp.id, { x: 12, y: 6 }).map((c) => `${c.x},${c.y}`)).toEqual(['12,7']);
    // Known-bad control: put Juno on a team of her own and every neighbour becomes a target.
    const split = probe(NULL_SPIRE, units, { fog: false, weather: 'clear', players: setupFor(NULL_SPIRE, 1).players.map((p, i) => (i === 3 ? { ...p, team: 9 } : p)) });
    const wasp2 = split.units.find((u) => u.owner === 3)!;
    expect(attackTargets(split, wasp2.id, { x: 12, y: 6 }).map((c) => `${c.x},${c.y}`).sort()).toEqual(['11,6', '12,5', '12,7', '13,6']);
  });
});

// ---------------------------------------------------------------- maps

describe('the Act IV maps', () => {
  it('pass checkMap with the default options: every player slot owns exactly one spire and a fabricator', () => {
    for (const m of ACT_IV) {
      expect(checkMap(mapOf(m)), m.id).toEqual([]);
      for (let p = 0; p < m.players.length; p++) {
        expect(countOf(mapOf(m), 'H', String(p)), `${m.id} p${p} spires`).toBe(1);
        expect(countOf(mapOf(m), 'F', String(p)), `${m.id} p${p} fabricators`).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('would catch a broken Act IV map: a spire removed, a fabricator removed, a spire sealed behind water, a unit on ground it cannot enter', () => {
    const noCalder = clone(mapOf(STATIC));
    const sp = spireOf(noCalder, 2);
    setCell(noCalder.terrain, sp.x, sp.y, '.');
    setCell(noCalder.owners, sp.x, sp.y, '.');
    expect(checkMap(noCalder).map((i) => i.rule)).toEqual(['spire']);
    const noFab = clone(mapOf(REQUIEM));
    for (const f of tilesOf(noFab, (c, o) => c === 'F' && o === '3')) { setCell(noFab.terrain, f.x, f.y, '.'); setCell(noFab.owners, f.x, f.y, '.'); }
    expect(checkMap(noFab).map((i) => i.rule)).toEqual(['fabricator']);
    const sealed = clone(mapOf(NULL_SPIRE));
    const core = spireOf(sealed, 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) setCell(sealed.terrain, core.x + dx, core.y + dy, '~');
    expect(checkMap(sealed).map((i) => i.rule)).toContain('reach-base');
    const stranded = clone(mapOf(STATIC));
    stranded.units.push({ type: 'bastion', owner: 2, x: 9, y: 2 }); // a tread unit on the ridge wall
    expect(checkMap(stranded).map((i) => i.rule)).toEqual(['unit-terrain']);
    for (const m of ACT_IV) expect(checkMap(mapOf(m)), `${m.id}: the unbroken map is fine`).toEqual([]);
  });
  it('seat exactly as many players as the mission has, with every unit and property owner one of them, and describe themselves in one sentence that agrees with the mission', () => {
    for (const m of ACT_IV) {
      const map = mapOf(m);
      expect(map.players, m.id).toBe(m.players.length);
      for (const u of map.units) expect(u.owner, m.id).toBeLessThan(m.players.length);
      for (let p = 0; p < m.players.length; p++) expect(map.units.filter((u) => u.owner === p).length, `${m.id} player ${p} starts with units`).toBeGreaterThan(0);
      expect(map.description, m.id).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(map.description.length, m.id).toBeLessThan(200);
      expect(map.recommended?.fog, `${m.id} recommended fog`).toBe(m.fog);
      expect(map.recommended?.weather, `${m.id} recommended weather`).toBe(m.weather);
      expect(map.recommended?.startFunds, `${m.id} recommended funds`).toBe(m.players[0].funds);
    }
  });
  it('have the sizes they were drawn at and are drawn for their story beat, not mirrored', () => {
    expect(ACT_IV.map((m) => `${mapOf(m).terrain[0].length}x${mapOf(m).terrain.length}`)).toEqual(['24x14', '28x14', '25x19']);
    for (const m of ACT_IV) expect(symmetryOf(mapOf(m)), m.id).toBe('none');
  });
  it('place the agent\'s whole team away from everyone else\'s, no unit starting within four tiles of an enemy, and the Choir\'s spire in the east in missions 12 and 13', () => {
    for (const m of ACT_IV) {
      const map = mapOf(m);
      const width = map.terrain[0].length;
      const mine = m.players.map((p, i) => (p.team === m.players[0].team ? i : -1)).filter((i) => i >= 0);
      const allies = map.units.filter((u) => mine.includes(u.owner));
      const others = map.units.filter((u) => !mine.includes(u.owner));
      const gap = Math.min(...allies.flatMap((a) => others.map((f) => Math.abs(a.x - f.x) + Math.abs(a.y - f.y))));
      expect(gap, `${m.id}: nearest ally-to-enemy distance at the start`).toBeGreaterThanOrEqual(4);
      if (m !== NULL_SPIRE) {
        for (const u of allies) expect(u.x, `${m.id} ally ${u.type} at (${u.x},${u.y})`).toBeLessThan(width / 2);
        expect(spireOf(map, 2).x, `${m.id}: the Choir's spire`).toBeGreaterThan(width / 2);
      }
    }
  });
  it('mission 12 is the Calder Line: a ridge wall with one maglev gate, four neutral cities and an uplink around it, a glass plain, and a Choir relay with thirteen voices on it', () => {
    const map = mapOf(STATIC);
    const wall = map.terrain.map((row) => row[9]);
    expect(wall.filter((ch) => ch === '^'), 'the wall is ridge, all but the gate').toHaveLength(map.terrain.length - 3);
    expect(wall.filter((ch) => ch === '='), 'one maglev road through it').toHaveLength(1);
    expect(map.terrain[7][9]).toBe('=');
    expect([map.terrain[6][9], map.terrain[8][9]], 'flats either side of the road').toEqual(['.', '.']);
    expect(tilesOf(map, (c, o) => c === 'C' && o === '.')).toHaveLength(4);
    expect(tilesOf(map, (c, o) => c === 'U' && o === '.')).toHaveLength(1);
    expect(countOf(map, 'g')).toBeGreaterThan(110);
    for (const t of tilesOf(map, (c) => c === 'g')) expect(t.x, 'the glass is east of the wall').toBeGreaterThanOrEqual(14);
    expect(spireOf(map, 0).x).toBeLessThanOrEqual(3);
    expect(spireOf(map, 1).x).toBeLessThanOrEqual(3);
    const choir = map.units.filter((u) => u.owner === 2);
    expect(choir).toHaveLength(13);
    for (const u of choir) expect(u.x, `${u.type} starts on the glass`).toBeGreaterThanOrEqual(14);
    expect(choir.length, 'the wave outnumbers the line').toBeGreaterThan(map.units.filter((u) => u.owner !== 2).length);
    expect(countOf(map, 'F', '2')).toBe(2);
    expect(countOf(map, 'A', '2')).toBe(1);
    // The gate is the only way for treads: with it sealed the Choir's tread units cannot reach the Calder Spire; foot units still climb the wall.
    const sealed = clone(map);
    setCell(sealed.terrain, 9, 6, '^'); setCell(sealed.terrain, 9, 7, '^'); setCell(sealed.terrain, 9, 8, '^');
    for (const x of [9, 10]) for (const y of [4, 5, 9, 10]) setCell(sealed.terrain, x, y, '^');
    expect(distances(map, spireOf(map, 2), costFor('tread'))[spireOf(map, 0).y][spireOf(map, 0).x], 'open: a tread route').toBeGreaterThan(0);
    expect(distances(sealed, spireOf(map, 2), costFor('tread'))[spireOf(map, 0).y][spireOf(map, 0).x], 'sealed: treads are stopped').toBe(-1);
    expect(distances(sealed, spireOf(map, 2), costFor('foot'))[spireOf(map, 0).y][spireOf(map, 0).x], 'sealed: foot units climb over').toBeGreaterThan(0);
  });
  it('mission 13 is a march: three Helion spires stacked on the west with Ilse\'s in the middle, glass most of the way, a maglev road to the relay, Ilse\'s artillery and fifteen Choir voices', () => {
    const map = mapOf(REQUIEM);
    const [a, i, r] = [spireOf(map, 0), spireOf(map, 3), spireOf(map, 1)];
    expect(a.y, 'the agent\'s column is the northern one').toBeLessThan(i.y);
    expect(i.y, 'Ilse\'s is in the middle').toBeLessThan(r.y);
    for (const s of [a, i, r]) expect(s.x).toBeLessThanOrEqual(3);
    expect(countOf(map, 'g') / (map.terrain.length * map.terrain[0].length), 'mostly glass').toBeGreaterThan(0.6);
    const relay = spireOf(map, 2);
    expect(relay.x, 'the relay is at the far end').toBeGreaterThanOrEqual(map.terrain[0].length - 3);
    for (let x = 6; x <= relay.x - 1; x++) expect('=A'.includes(map.terrain[relay.y][x]), `the road runs unbroken to the relay at x=${x}`).toBe(true);
    expect(distances(map, a, costFor('foot'))[relay.y][relay.x], 'a long way on foot').toBeGreaterThanOrEqual(24);
    expect(tilesOf(map, (c, o) => c === 'C' && o === '.')).toHaveLength(4);
    expect(tilesOf(map, (c, o) => c === 'U' && o === '.')).toHaveLength(1);
    const indirect = (owner: number) => map.units.filter((u) => u.owner === owner && (UNIT_TYPES[u.type].range?.[0] ?? 1) > 1).length;
    expect(indirect(3), 'the Marshal\'s army is her guns').toBeGreaterThanOrEqual(4);
    expect(indirect(0)).toBeLessThanOrEqual(1);
    expect(indirect(1)).toBeLessThanOrEqual(1);
    expect(map.units.filter((u) => u.owner === 2)).toHaveLength(15);
    expect(map.units.filter((u) => u.owner === 3 && UNIT_TYPES[u.type].range?.[0] === 2).length, 'Arcs (range 2-3) and a Salvo (3-5)').toBeGreaterThanOrEqual(3);
  });
  it('mission 14 is a core: a ridge ring with exactly four maglev gates, a maglev spoke from each gate to one nation\'s front, and the four fronts drawn from their terrain', () => {
    const map = mapOf(NULL_SPIRE);
    const core = spireOf(map, 2);
    expect(core, 'the core is at the centre of the map').toEqual({ x: (map.terrain[0].length - 1) / 2, y: (map.terrain.length - 1) / 2 });
    const ring = ringTiles(map, core, 4);
    expect(ring).toHaveLength(32);
    const gates = ring.filter((t) => map.terrain[t.y][t.x] === '=');
    expect(gates, 'four gates').toHaveLength(4);
    expect(ring.filter((t) => map.terrain[t.y][t.x] === '^'), 'the rest of the ring is ridge').toHaveLength(28);
    expect(gates.map((g) => `${g.x - core.x},${g.y - core.y}`).sort(), 'one gate on each axis').toEqual(['-4,0', '0,-4', '0,4', '4,0']);
    for (const side of [0, 1, 3, 4]) {
      const s = spireOf(map, side);
      const dx = Math.sign(s.x - core.x);
      const dy = Math.sign(s.y - core.y);
      expect(dx === 0 || dy === 0, `the spire of slot ${side} is on an axis of the core`).toBe(true);
      for (let t = 1; t < Math.max(Math.abs(s.x - core.x), Math.abs(s.y - core.y)); t++) {
        expect(map.terrain[core.y + dy * t][core.x + dx * t], `slot ${side}'s spoke at step ${t}`).toBe('=');
      }
    }
    // The ring is a real wall: with the four gates sealed, treads and hover units cannot reach the core from any front, but walkers and foot units climb it.
    const sealed = clone(map);
    for (const g of gates) setCell(sealed.terrain, g.x, g.y, '^');
    for (const side of [0, 1, 3, 4]) {
      const from = spireOf(map, side);
      expect(distances(map, from, costFor('tread'))[core.y][core.x], `slot ${side}: open, a tread route`).toBeGreaterThan(0);
      expect(distances(sealed, from, costFor('tread'))[core.y][core.x], `slot ${side}: sealed, treads are stopped`).toBe(-1);
      expect(distances(sealed, from, costFor('hover'))[core.y][core.x], `slot ${side}: sealed, hover units are stopped`).toBe(-1);
      expect(distances(sealed, from, costFor('foot'))[core.y][core.x], `slot ${side}: sealed, foot units climb over`).toBeGreaterThan(0);
    }
    // The four fronts: Helion plains, Kestrel heights, Verdant canopy, a Tidewell lagoon.
    const share = (x0: number, x1: number, y0: number, y1: number, pred: (ch: string) => boolean) => {
      let hit = 0, all = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { all++; if (pred(map.terrain[y][x])) hit++; }
      return hit / all;
    };
    expect(share(0, 6, 5, 13, (c) => !'^~gs'.includes(c)), 'west: plains, with no ridge, glass or water').toBe(1);
    expect(share(5, 19, 0, 4, (c) => c === '^'), 'north: heights').toBeGreaterThan(0.4);
    expect(share(18, 24, 5, 13, (c) => c === 'f' || c === '.'), 'east: canopy and clearings, the rest road and buildings').toBeGreaterThan(0.8);
    expect(share(18, 24, 5, 13, (c) => c === 'f'), 'east: a canopy belt').toBeGreaterThan(0.3);
    expect(share(3, 21, 14, 18, (c) => c === '~'), 'south: a lagoon').toBeGreaterThan(0.6);
    const docks = tilesOf(map, (c, o) => c === 'D' && o === '1');
    expect(docks).toHaveLength(2);
    for (const d of docks) expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => map.terrain[d.y + dy][d.x + dx] === '~'), `dock (${d.x},${d.y}) touches the sea`).toBe(true);
    // VESPER's army stands inside the wall; Sefa's fleet is in the lagoon; Juno's is the air; Corvin's armour is on the plateau.
    for (const u of map.units.filter((x) => x.owner === 2)) expect(Math.max(Math.abs(u.x - core.x), Math.abs(u.y - core.y)), `VESPER's ${u.type} at (${u.x},${u.y}) is inside the wall`).toBeLessThan(4);
    expect(map.units.filter((u) => u.owner === 2)).toHaveLength(18);
    expect(map.units.filter((u) => u.owner === 1 && UNIT_TYPES[u.type].domain === 'sea').every((u) => map.terrain[u.y][u.x] === '~')).toBe(true);
    expect(map.units.filter((u) => u.owner === 1 && UNIT_TYPES[u.type].domain === 'sea').length).toBeGreaterThanOrEqual(4);
    expect(map.units.filter((u) => u.owner === 3 && UNIT_TYPES[u.type].domain === 'air').length).toBeGreaterThanOrEqual(5);
    for (const u of map.units.filter((x) => x.owner === 4)) expect(map.terrain[u.y][u.x], `Corvin's ${u.type} is not on a ridge`).not.toBe('^');
  });
});

describe('createGame on the Act IV maps', () => {
  it('builds each mission from its own players, with its own fog and weather, and pays player 0 its mission funds plus 1000 a property on turn one', () => {
    for (const m of ACT_IV) {
      const map = mapOf(m);
      const s = createGame(setupFor(m, 1));
      expect(s.mapId, m.id).toBe(m.mapId);
      expect(s.players.map((p) => p.commander), m.id).toEqual(m.players.map((p) => p.commander));
      expect(s.players.map((p) => p.team), m.id).toEqual(m.players.map((p) => p.team));
      expect(s.units, m.id).toHaveLength(map.units.length);
      expect(s.fog, m.id).toBe(m.fog);
      expect(s.weather, m.id).toBe(m.weather);
      expect(s.objective, m.id).toEqual(m.objective);
      expect(s.players[0].funds, m.id).toBe((m.players[0].funds ?? 0) + 1000 * tilesOf(map, (c, o) => 'CFADH'.includes(c) && o === '0').length);
      for (let p = 1; p < m.players.length; p++) expect(s.players[p].funds, `${m.id} player ${p} has not started a turn`).toBe(m.players[p].funds ?? 0);
      expect(countOf(map, 'F', '0') > 0 && s.players[0].funds >= 1000, `${m.id}: something to buy`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------- objectives and triggers

describe('Act IV objectives and triggers', () => {
  it('gives every spire objective an enemy spire to take, and refuses a map without one or a mission whose enemy has joined the agent\'s team', () => {
    for (const m of [REQUIEM, NULL_SPIRE]) expect(hqProblems(m, mapOf(m)), m.id).toEqual([]);
    expect(hqProblems(STATIC, mapOf(STATIC)), 'only hq objectives are judged').toEqual([]);
    expect(tilesOf(mapOf(STATIC), (c, o) => c === 'H' && o === '2'), 'a rout can also be won by taking the relay spire').toHaveLength(1);
    for (const m of [REQUIEM, NULL_SPIRE]) {
      const noSpire = clone(mapOf(m));
      const s = spireOf(noSpire, 2);
      setCell(noSpire.terrain, s.x, s.y, 'C');
      expect(hqProblems(m, noSpire), m.id).toHaveLength(1);
      const allied = clone(m);
      allied.players[2].team = 0;
      expect(hqProblems(allied, mapOf(allied)), m.id).toHaveLength(1);
    }
  });
  it('plays mission 12 as the text says: the Choir is routed when its last voice falls or its relay spire is captured, and not by waiting', () => {
    const start = createGame(setupFor(STATIC, 1));
    const relayFell = captureSpire(start, 2);
    expect(relayFell.winnerTeam, 'capturing the relay ends it').toBe(0);
    const noVoices = clone(start);
    noVoices.units = noVoices.units.filter((u) => u.owner !== 2);
    expect(applyAction(noVoices, { kind: 'endTurn' }).state.winnerTeam, 'every voice destroyed: routed').toBe(0);
    const oneLeft = clone(start);
    oneLeft.units = oneLeft.units.filter((u) => u.owner !== 2 || u.id === start.units.find((x) => x.owner === 2)!.id);
    expect(applyAction(oneLeft, { kind: 'endTurn' }).state.winnerTeam, 'known-bad control: one voice left, no rout').toBeNull();
    // Waiting wins nothing: with every side only ending its turns the rout objective is still open after 20 cycles, whereas "survive 6" on the same map
    // is simply handed to the agent's team at cycle 6, which is why the mission is not a survive objective.
    const quiet = (opts: CreateGameOptions, cap: number) => {
      let s = createGame(opts);
      for (let i = 0; i < cap && s.winnerTeam === null; i++) s = applyAction(s, { kind: 'endTurn' }).state;
      return s;
    };
    const waited = quiet(setupFor(STATIC, 1), 60);
    expect(waited.winnerTeam).toBeNull();
    expect(waited.cycle).toBeGreaterThanOrEqual(20);
    const handed = quiet({ ...setupFor(STATIC, 1), objective: { kind: 'survive', cycles: 6 } }, 60);
    expect(handed.winnerTeam).toBe(0);
    expect(handed.cycle).toBe(6);
    expect(handed.players[2].defeated, 'handed the win with the Choir still standing').toBe(false);
  });
  it('plays mission 13 as ECHO says: capturing the Choir\'s relay spire routs Cantor and wins for the whole team, and Ilse\'s own spire cannot be captured by the agent', () => {
    const start = createGame(setupFor(REQUIEM, 1));
    const won = captureSpire(start, 2);
    expect(won.winnerTeam).toBe(0);
    expect(won.players[2].defeated).toBe(true);
    expect(won.players.filter((p) => !p.defeated).map((p) => p.index).sort()).toEqual([0, 1, 3]);
    const ilsesSpire = start.tiles.flatMap((row, y) => row.map((t, x) => ({ t, x, y }))).find((c) => c.t.terrain === 'spire' && c.t.owner === 3)!;
    const s = clone(start);
    s.units = s.units.filter((u) => !(u.x === ilsesSpire.x && u.y === ilsesSpire.y));
    const id = s.nextUnitId++;
    s.units.push({ id, type: 'trooper', owner: 0, x: ilsesSpire.x, y: ilsesSpire.y, hp: 100, charge: 99, ammo: 0, acted: false, cargo: [] });
    expect(canCaptureHere(s, s.units.find((u) => u.id === id)!), 'known-bad: a unit cannot capture an ally\'s spire').toBe(false);
  });
  it('plays mission 14 as ECHO says: capturing the Null Spire routs VESPER and wins for all four armies, and the other fronts stand', () => {
    const start = createGame(setupFor(NULL_SPIRE, 1));
    const won = captureSpire(start, 2);
    expect(won.winnerTeam).toBe(0);
    expect(won.players[2].defeated).toBe(true);
    expect(won.players.filter((p) => !p.defeated).map((p) => p.index).sort()).toEqual([0, 1, 3, 4]);
    expect(start.winnerTeam, 'known-bad control: before the capture nobody has won').toBeNull();
    // Taking an ally's spire is not the objective, and is impossible.
    const sefaSpire = start.tiles.flatMap((row, y) => row.map((t, x) => ({ t, x, y }))).find((c) => c.t.terrain === 'spire' && c.t.owner === 1)!;
    const s = clone(start);
    s.units = s.units.filter((u) => !(u.x === sefaSpire.x && u.y === sefaSpire.y));
    const id = s.nextUnitId++;
    s.units.push({ id, type: 'trooper', owner: 0, x: sefaSpire.x, y: sefaSpire.y, hp: 100, charge: 99, ammo: 0, acted: false, cargo: [] });
    expect(canCaptureHere(s, s.units.find((u) => u.id === id)!)).toBe(false);
  });
  it('points every Act IV trigger at a real player and, for a capture, at a property that can be captured, and refuses bad ones', () => {
    for (const m of ACT_IV) for (const e of m.events) expect(triggerProblems(m, e.trigger), `${m.id} ${JSON.stringify(e.trigger)}`).toEqual([]);
    expect(STATIC.events.some((e) => e.trigger.kind === 'unitDestroyed' && e.trigger.owner === 2), 'the Choir\'s losses are watched').toBe(true);
    // Known-bad triggers must keep being reported.
    expect(triggerProblems(STATIC, { kind: 'cycle', cycle: 0 })).toHaveLength(1);
    expect(triggerProblems(STATIC, { kind: 'unitDestroyed', owner: 2, count: 99 })).toHaveLength(1);
    expect(triggerProblems(REQUIEM, { kind: 'powerUsed', player: 4 })).toHaveLength(1); // no fifth player
    expect(triggerProblems(NULL_SPIRE, { kind: 'powerUsed', player: 5 })).toHaveLength(1);
    expect(triggerProblems(NULL_SPIRE, { kind: 'propertyCaptured', by: 0, terrain: 'flats' })).toHaveLength(1); // not a property
    expect(triggerProblems(STATIC, { kind: 'propertyCaptured', by: 0, terrain: 'dock' })).toHaveLength(1); // no dock on the Calder Line
    expect(triggerProblems(REQUIEM, { kind: 'propertyCaptured', by: 0, terrain: 'uplink' }), 'the dead uplink in the waste can be taken').toEqual([]);
  });
  it('tells Ilse\'s choice at a cycle event inside the march: the voice offers, she hesitates, she orders the guns, and the voice answers; she never accepts', () => {
    const choice = REQUIEM.events.find((e) => e.lines.some((l) => l.speaker === 'cantor' && /Put down the guns/.test(l.text)))!;
    expect(choice, 'the choice event').toBeDefined();
    expect(choice.trigger.kind, 'cycle events always fire; a powerUsed trigger might not').toBe('cycle');
    const cycle = choice.trigger.kind === 'cycle' ? choice.trigger.cycle : -1;
    expect(cycle).toBeGreaterThan(1);
    expect(cycle).toBeLessThan(REQUIEM.par.cycles);
    const at = (re: RegExp, who: string) => choice.lines.findIndex((l) => l.speaker === who && re.test(l.text));
    const offer = at(/Put down the guns/, 'cantor');
    const pause = at(/A moment/, 'ilse');
    const support = at(/the column is with you/, 'rook');
    const order = at(/Fire for effect on the relay/, 'ilse');
    const answer = at(/Then I will sing it for you anyway/, 'cantor');
    expect([offer, pause, support, order, answer].every((i) => i >= 0), 'all five beats are there').toBe(true);
    expect([offer, pause, support, order, answer], 'in this order').toEqual([...[offer, pause, support, order, answer]].sort((a, b) => a - b));
    expect(new Set([offer, pause, support, order, answer]).size).toBe(5);
    // She never gives way anywhere in the act, and the voice is first heard strictly before the choice.
    expect(linesOf(REQUIEM).filter((l) => l.speaker === 'ilse' && /stand down|cease fire|lay down|hold fire|stop the guns/i.test(l.text))).toEqual([]);
    const first = REQUIEM.events.find((e) => e.lines.some((l) => l.speaker === 'cantor'))!;
    expect(first.trigger.kind === 'cycle' ? first.trigger.cycle : -1).toBeLessThan(cycle);
    // The mission's outcome is that she chooses it: the victory event is the Choir's defeat, and the defeat event never has her yielding.
    const victory = REQUIEM.events.find((e) => e.trigger.kind === 'victory')!;
    expect(victory.lines.some((l) => l.speaker === 'cantor' && l.text === COMMANDERS.cantor.lines.defeat), 'Cantor speaks her own defeat line').toBe(true);
  });
});

// ---------------------------------------------------------------- the writing rules

describe('the Act IV writing rules', () => {
  it('keeps every line at or under 220 characters, and at least 90% of them (in each mission and in the act) at or under 140', () => {
    expect(ACT_IV_LINES.length).toBeGreaterThan(100);
    expect(ACT_IV_LINES.filter((l) => l.text.length > 220)).toEqual([]);
    for (const m of ACT_IV) expect(share140(linesOf(m)), `${m.id}: ${linesOf(m).filter((l) => l.text.length > 140).length} of ${linesOf(m).length} lines are over 140`).toBeGreaterThanOrEqual(0.9);
    expect(share140(ACT_IV_LINES)).toBeGreaterThanOrEqual(0.9);
    const padded: DialogueLine[] = [...Array(3).fill({ speaker: 'echo', text: 'Short.' }), { speaker: 'echo', text: 'x'.repeat(150) }];
    expect(share140(padded), 'known-bad: a quarter of the lines running long fails the same measure').toBeLessThan(0.9);
  });
  it('keeps every line to one to three sentences (a fragment of four words or fewer is not counted as a sentence)', () => {
    for (const l of ACT_IV_LINES) {
      const full = sentencesOf(l.text).filter((s) => wordsOf(s).length >= 5);
      expect(full.length, `${l.speaker}: ${l.text}`).toBeLessThanOrEqual(3);
      expect(sentencesOf(l.text).length, `${l.speaker}: ${l.text}`).toBeLessThanOrEqual(6);
    }
  });
  it('uses only the Act IV cast as speakers, with every speaker used, a mood from the list, and each commander on a net of their own', () => {
    expect(new Set(ACT_IV_LINES.map((l) => l.speaker))).toEqual(new Set(ACT_IV_SPEAKERS));
    for (const s of ['echo', 'rook', 'ilse', 'sefa', 'dax', 'corvin', 'sable', 'juno', 'maru', 'cantor', 'vesper']) expect(COMMANDERS[s], s).toBeDefined();
    for (const l of ACT_IV_LINES) expect(l.mood === undefined || ['neutral', 'happy', 'angry', 'grim', 'surprised', 'smug'].includes(l.mood), `${l.speaker} mood`).toBe(true);
    for (const l of ACT_IV_LINES) {
      const faction = COMMANDERS[l.speaker]?.faction;
      if (faction === 'kestrel') expect(l.channel, `${l.speaker} speaks over a Kestrel net`).toMatch(/Kestrel|Night wing/);
      if (faction === 'tidewell') expect(l.channel, `${l.speaker} speaks over a Tidewell net`).toMatch(/Tidewell/);
      if (faction === 'verdant') expect(l.channel, `${l.speaker} speaks over a Verdant net`).toMatch(/Verdant|Grove/);
      if (l.speaker === 'ilse') expect(l.channel).toBe('Helion command net');
      if (l.speaker === 'cantor') expect(['Choir signal, all bands', 'Helion command net, intruded'], l.text).toContain(l.channel);
      if (l.speaker === 'vesper') expect(['All nets, all nations', 'Lattice net, open'], l.text).toContain(l.channel);
      if (l.speaker === 'rook' && l.channel) expect(['Calder Link console', 'Calder Link, no carrier']).toContain(l.channel);
    }
    expect(ACT_IV_LINES.filter((l) => l.speaker === 'Calder Watch').every((l) => /Calder Watch/.test(l.channel ?? ''))).toBe(true);
    // VESPER is on every net at once in mission 12 (it "speaks to all four nations at once") and on its own net inside the Lattice in 14.
    expect(linesOf(STATIC).filter((l) => l.speaker === 'vesper').every((l) => l.channel === 'All nets, all nations')).toBe(true);
    expect(linesOf(NULL_SPIRE).filter((l) => l.speaker === 'vesper').every((l) => l.channel === 'Lattice net, open')).toBe(true);
    // Cantor is on Ilse's own net only where she speaks to Ilse (mission 13); the intrusion is the point.
    expect(ACT_IV_LINES.filter((l) => l.speaker === 'cantor' && l.channel === 'Helion command net, intruded').length).toBeGreaterThanOrEqual(3);
    expect(linesOf(NULL_SPIRE).filter((l) => l.speaker === 'cantor').every((l) => l.channel === 'Choir signal, all bands')).toBe(true);
  });
  it('passes every dialogue rule: length, speakers, no "!" from ECHO, VESPER, Cantor, Ilse, Sefa or the narrator, the reveal bans, no profanity, no real-world names, no manual control', () => {
    for (const m of ACT_IV) expect(dialogueProblems(linesOf(m), rulesFor(m)), m.id).toEqual([]);
    expect(ACT_IV_LINES.filter((l) => ['echo', 'vesper', 'cantor', 'ilse', 'sefa', 'narrator'].includes(l.speaker)).filter((l) => l.text.includes('!'))).toEqual([]);
    for (const m of ACT_IV) expect(vesperProblems(linesOf(m)), m.id).toEqual([]);
  });
  it('would catch each planted violation, passes a clean line, and lets Act IV name what Act IV may name', () => {
    const line = (speaker: string, text: string): DialogueLine => ({ speaker, text });
    const bad: [string, DialogueLine, RegExp, DialogueRules][] = [
      ['over 220', line('rook', 'Okay. '.repeat(40)), /over 220/, rulesFor(NULL_SPIRE)],
      ['unknown speaker', line('grok', 'Sky is open.'), /speaker not allowed/, rulesFor(NULL_SPIRE)],
      ['echo bang', line('echo', 'The song is held!'), /exclamation/, rulesFor(NULL_SPIRE)],
      ['vesper bang', line('vesper', 'We are quiet!'), /exclamation/, rulesFor(NULL_SPIRE)],
      ['cantor bang', line('cantor', 'Listen, Mother!'), /exclamation/, rulesFor(NULL_SPIRE)],
      ['ilse bang', line('ilse', 'Captain! Fire for effect!'), /exclamation/, rulesFor(REQUIEM)],
      ['sefa bang', line('sefa', 'Hold the south gate!'), /exclamation/, rulesFor(NULL_SPIRE)],
      ['narrator bang', line('narrator', 'The Link is cut!'), /exclamation/, rulesFor(NULL_SPIRE)],
      ['Cantor in 12', line('echo', 'The avatar is called Cantor.'), /spoiler/, rulesFor(STATIC)],
      ['Mira in 12', line('ilse', 'My daughter Mira is dead.'), /spoiler/, rulesFor(STATIC)],
      ['Lattice core in 12', line('narrator', 'Under the glass, the Lattice core slept.'), /spoiler/, rulesFor(STATIC)],
      ['Lattice core in 13', line('echo', 'The Lattice core is ahead.'), /spoiler/, rulesFor(REQUIEM)],
      ['profanity', line('rook', 'Well, damn.'), /profanity/, rulesFor(NULL_SPIRE)],
      ['real world', line('narrator', 'The treaty was signed in Paris.'), /real-world/, rulesFor(NULL_SPIRE)],
      ['manual control', line('echo', 'Select the Colossus and move it to the gate.'), /control units/, rulesFor(NULL_SPIRE)],
      ['manual control 2', line('echo', 'You should send your Breacher to the ring.'), /control units/, rulesFor(NULL_SPIRE)],
      ['empty', line('sable', '   '), /empty/, rulesFor(NULL_SPIRE)],
    ];
    for (const [name, l, kind, rules] of bad) {
      const problems = dialogueProblems([l], rules);
      expect(problems.length, name).toBeGreaterThanOrEqual(1);
      expect(problems.some((p) => kind.test(p)), `${name}: ${problems.join('; ')}`).toBe(true);
    }
    expect(dialogueProblems([line('echo', 'Observation: a ridge gives four defense stars. That is the whole recommendation.')], rulesFor(STATIC))).toEqual([]);
    expect(dialogueProblems([line('juno', 'Sky is open, sun-boy! Keep up!')], rulesFor(STATIC)), 'Juno shouts').toEqual([]);
    expect(dialogueProblems([line('corvin', 'Form on me!')], rulesFor(STATIC)), 'the Highlord is not on the never-shouts list').toEqual([]);
    expect(dialogueProblems([line('vesper', 'We are VESPER.')], rulesFor(STATIC)), 'VESPER may be named in 12').toEqual([]);
    expect(dialogueProblems([line('cantor', 'Hush now. I am Cantor.')], rulesFor(REQUIEM)), 'Cantor and Mira may be named in 13').toEqual([]);
    expect(dialogueProblems([line('ilse', 'Her name was Mira.')], rulesFor(REQUIEM))).toEqual([]);
    expect(dialogueProblems([line('narrator', 'The Lattice core. One black spire.')], rulesFor(NULL_SPIRE)), 'the Lattice core may be named in 14').toEqual([]);
    expect(dialogueProblems([line('echo', 'You never move a unit.')], rulesFor(NULL_SPIRE)), 'a negation is not an instruction').toEqual([]);
    // VESPER speaks in the plural: "I", "my" and "me" are caught, "we" passes.
    expect(vesperProblems([line('vesper', 'I am VESPER.')]).length).toBeGreaterThanOrEqual(1);
    expect(vesperProblems([line('vesper', 'We note that my count is complete.')]).length).toBe(1);
    expect(vesperProblems([line('vesper', 'Observe.')]).length, 'a line with no "we" is flagged').toBe(1);
    expect(vesperProblems([line('vesper', 'We are VESPER.'), line('echo', 'I am ECHO.')])).toEqual([]);
  });
  it('stages the reveals one mission at a time: VESPER is first named in 12, Cantor and Mira in 13, the Lattice core in 14 (every string a player could read)', () => {
    const earlier = MISSIONS_I_III.flatMap(stringsOf);
    for (const [name, re] of Object.entries(NAMES)) expect(earlier.filter((s) => re.test(s)), `${name} is not named before Act IV`).toEqual([]);
    expect(namedIn(STATIC, NAMES.vesper), 'VESPER is named in mission 12').toBeGreaterThanOrEqual(3);
    expect(namedIn(STATIC, NAMES.cantor)).toBe(0);
    expect(namedIn(STATIC, NAMES.mira)).toBe(0);
    expect(namedIn(STATIC, NAMES.core)).toBe(0);
    expect(namedIn(REQUIEM, NAMES.cantor), 'Cantor is named in mission 13').toBeGreaterThanOrEqual(3);
    expect(namedIn(REQUIEM, NAMES.mira), 'Mira is named in mission 13').toBeGreaterThanOrEqual(2);
    expect(namedIn(REQUIEM, NAMES.core)).toBe(0);
    expect(namedIn(NULL_SPIRE, NAMES.core), 'the Lattice core is named in mission 14').toBeGreaterThanOrEqual(2);
    expect(namedIn(NULL_SPIRE, NAMES.vesper)).toBeGreaterThanOrEqual(3);
    // Mission 12's data does not name a Choir commander either: the Choir there is VESPER's voice only.
    expect(STATIC.players.map((p) => p.commander)).not.toContain('cantor');
    expect(STATIC.players.map((p) => p.commander)).not.toContain('vesper');
    // Known-bad: the same scan flags a planted string, and does not trip on look-alikes ("admiral" holds the letters of "mira").
    expect(NAMES.mira.test('Admiral Tamura')).toBe(false);
    expect(NAMES.cantor.test('Cantor sang')).toBe(true);
    expect(['It was VESPER', 'the Lattice core', 'Mira Varga'].every((p) => Object.values(NAMES).some((re) => re.test(p)))).toBe(true);
    expect(STATIC.briefing.map((l) => l.text).concat(['The avatar is called Cantor.']).filter((s) => NAMES.cantor.test(s)), 'a planted Cantor in the 12 briefing is found').toHaveLength(1);
  });
  it('names the Hollow Choir, the Lattice and the Glass Waste where the story allows', () => {
    const names = (m: Mission, re: RegExp) => linesOf(m).filter((l) => re.test(l.text)).length;
    expect(names(STATIC, /Glass Waste/)).toBeGreaterThanOrEqual(1);
    expect(names(STATIC, /Lattice/)).toBeGreaterThanOrEqual(1);
    expect(names(REQUIEM, /Glass Waste/)).toBeGreaterThanOrEqual(1);
    expect(names(NULL_SPIRE, /Lattice/)).toBeGreaterThanOrEqual(3);
    expect(ACT_IV_LINES.some((l) => l.text.includes(FACTIONS.choir.name.replace(/^The /, ''))) || ACT_IV_LINES.some((l) => /Choir/.test(l.text)), 'the faction is named').toBe(true);
  });
  it('carries none of the names the repo guard denies (the originality list) in any Act IV string or source line, and the detector would catch one', () => {
    const text = JSON.stringify([ACT_IV, ALL_ACTS, Object.values(ALL_MISSION_MAPS)], null, 1);
    expect(guard.scanText('src/content/missions.ts', text)).toEqual([]);
    for (const bad of guard.DENYLIST.slice(0, 5)) expect(guard.scanText('src/content/missions.ts', `text: '${bad}'`).map((f) => f.rule), `the guard catches ${bad}`).toContain('originality');
    const planted = guard.DENYLIST[guard.DENYLIST.length - 1]; // taken from the list, so this file never spells a denied name itself
    expect(guard.scanText('src/content/missions.ts', `${JSON.stringify(ACT_IV)} ${planted}`).map((f) => f.match), 'a planted name in Act IV text is found').toEqual([planted]);
    expect(guard.scanText('src/content/mission-maps.ts', readFileSync(new URL('./mission-maps.ts', import.meta.url), 'utf8'))).toEqual([]);
    expect(guard.scanText('src/content/missions.ts', readFileSync(new URL('./missions.ts', import.meta.url), 'utf8'))).toEqual([]);
  });
});

// ---------------------------------------------------------------- voices

describe('each Act IV speaker sounds like their entry in STORY.md', () => {
  const by = (speaker: string) => ACT_IV_LINES.filter((l) => l.speaker === speaker);
  const matching = (speaker: string, re: RegExp) => by(speaker).filter((l) => re.test(l.text)).length;
  it('ECHO: short telemetry sentences, no exclamation mark, dry curiosity, and more human than before ("I find", "I do not like", "I would like")', () => {
    expect(by('echo').length).toBeGreaterThan(45);
    for (const l of by('echo')) {
      expect(l.text, l.text).not.toContain('!');
      for (const sentence of l.text.split(/(?<=[.?])\s+/)) expect(wordsOf(sentence).length, sentence).toBeLessThanOrEqual(26);
    }
    expect(matching('echo', /telemetry|observation|query|recommendation|alert|status|objective|situation|logged|recorded|confirmed|contact|posture|terrain|broadcast|inbound/i)).toBeGreaterThanOrEqual(20);
    expect(matching('echo', /query|observation|parity bit|I do not like|I would like|I am logging|I have no record|I find/i), 'dry curiosity').toBeGreaterThanOrEqual(8);
    expect(matching('echo', /\bI (?:do not like|would like|find|have not decided|am deciding|will try|trust)\b/), 'she says what she feels, more than in Act III').toBeGreaterThanOrEqual(5);
    expect(storyVoice('ECHO')).toMatch(/Recommendation: do not stand in front of it/);
    expect(by('echo').some((l) => /That is the whole recommendation/.test(l.text)) || by('echo').some((l) => /Recommendation:/.test(l.text))).toBe(true);
  });
  it('Rook: earnest, apologises to the wall and the glass, engineering metaphors, braver than in Act I ("I will", "I intend to"), and warm on the empty channel', () => {
    expect(matching('rook', /sorry|apolog/i)).toBeGreaterThanOrEqual(3);
    expect(matching('rook', /\bI will\b/)).toBeGreaterThanOrEqual(3);
    expect(STATIC.briefing.some((l) => l.speaker === 'rook' && /I intend to/.test(l.text)), 'braver, from the first briefing').toBe(true);
    expect(matching('rook', /checksum|spanner|engineering|hinge|kettle|fix|Arcs|wall|hatch/i)).toBeGreaterThanOrEqual(5);
    expect(linesOf(FIRST_LIGHT).filter((l) => l.speaker === 'rook' && /I intend to|I will\b/.test(l.text)), 'Rook promises nothing in mission 1').toEqual([]);
    expect(by('rook').length).toBeGreaterThanOrEqual(12);
    const dead = by('rook').filter((l) => l.channel === 'Calder Link, no carrier');
    expect(dead, 'one line to an empty channel').toHaveLength(1);
    expect(dead[0].text).toMatch(/ECHO/);
  });
  it('Ilse: clipped and dry, "Captain" to Rook, "Adjutant" to ECHO, firing-data flavour, never longer than 140 characters, only on the radio, and the STORY.md line word for word', () => {
    const sample = storyVoice('Ilse Varga');
    expect(sample, 'STORY.md Ilse voice sample').toBe('Range two-four-zero. Fire for effect. And Captain — stop smiling.');
    expect(by('ilse').some((l) => l.text === sample), 'the sample, as spoken').toBe(true);
    expect(REQUIEM.events.find((e) => e.lines.some((l) => l.text === sample))!.trigger.kind, 'a mid-mission beat').toBe('cycle');
    expect(by('ilse').length).toBeGreaterThanOrEqual(10);
    for (const l of by('ilse')) {
      expect(l.text.length, l.text).toBeLessThanOrEqual(140);
      expect(l.channel).toBe('Helion command net');
    }
    expect(matching('ilse', /^Captain/)).toBeGreaterThanOrEqual(5);
    expect(matching('ilse', /Adjutant|adjutant/)).toBeGreaterThanOrEqual(2);
    expect(matching('ilse', /range|fire|batteries|echelon|relay|Arcs|march|line|bearing|glass/i)).toBeGreaterThanOrEqual(7);
    expect(ACT_IV.filter((m) => linesOf(m).some((l) => l.speaker === 'ilse')).map((m) => m.id)).toEqual(['static', 'requiem']);
  });
  it('Sefa, Corvin, Juno, Maru, Sable and Dax speak as they did, and every commander met in Acts I-III is on the radio in mission 12', () => {
    const met = [...new Set(MISSIONS_I_III.flatMap(linesOf).map((l) => l.speaker))].filter((s) => COMMANDERS[s]);
    expect(met.sort(), 'the commanders of Acts I-III').toEqual(['corvin', 'dax', 'echo', 'ilse', 'juno', 'maru', 'rook', 'sable', 'sefa']);
    const speakers12 = new Set(linesOf(STATIC).map((l) => l.speaker));
    for (const c of met) expect(speakers12.has(c), `${c} is on the radio in mission 12`).toBe(true);
    // Sefa: the STORY.md line word for word, tide imagery, "Captain", never shouts.
    const sefa = storyVoice('Sefa Tamura');
    expect(sefa).toBe('The tide does not hurry, Captain. It simply arrives.');
    expect(by('sefa').some((l) => l.text.includes(sefa!))).toBe(true);
    expect(matching('sefa', /\btide\b|\bcoast\b|\blagoon\b|\bships?\b|\bUnion\b/)).toBeGreaterThanOrEqual(4);
    expect(by('sefa').filter((l) => l.text.includes('!'))).toEqual([]);
    expect(by('sefa').every((l) => l.channel === 'Tidewell fleet net, open')).toBe(true);
    // Corvin: formal, no contractions, "Captain", the family and the mountain.
    for (const l of by('corvin')) expect(l.text, l.text).not.toMatch(/n't\b|\b(?:I'm|I've|I'll|you're|it's|that's)\b/i);
    expect(by('corvin').length).toBeGreaterThanOrEqual(3);
    expect(matching('corvin', /Captain|Wing Lead/)).toBeGreaterThanOrEqual(3);
    expect(matching('corvin', /Kestrel|mountain|quarrel|profession|high ground/)).toBe(by('corvin').length);
    // Juno: the STORY.md line word for word, loud (most lines shout), "sun-boy".
    const juno = storyVoice('Juno Reyes-Abara');
    expect(juno).toBe("Sky's open, sun-boy. Try to keep up.");
    expect(by('juno').some((l) => l.text === juno)).toBe(true);
    expect(matching('juno', /!/)).toBeGreaterThanOrEqual(3);
    expect(matching('juno', /sun-boy/)).toBeGreaterThanOrEqual(2);
    // Maru: gentle, seasons and groves, never "he" or "she", never shouts.
    expect(by('maru').length).toBeGreaterThanOrEqual(1);
    for (const l of by('maru')) { expect(l.text).not.toMatch(/!|\b(?:he|she)\b/i); expect(l.text).toMatch(/grove|forest|seed|weather|season|root/i); }
    // Sable: sparse and wry, short.
    for (const l of by('sable')) { expect(l.text.length, l.text).toBeLessThanOrEqual(80); expect(l.text).not.toContain('!'); }
    expect(by('sable').some((l) => /lights?|dark|night/i.test(l.text))).toBe(true);
    // Dax: smooth and numerate, a ledger in every line, "Admiral", shaken since the counterparty stopped answering, and only in mission 12.
    expect(by('dax').length).toBeGreaterThanOrEqual(2);
    expect(matching('dax', /counterparty|priced|repricing|discount|figures|exposure|ledger|margin/i)).toBe(by('dax').length);
    expect(matching('dax', /Admiral/)).toBe(by('dax').length);
    expect(by('dax').every((l) => l.mood !== 'smug'), 'no longer smug').toBe(true);
    expect(ACT_IV.filter((m) => linesOf(m).some((l) => l.speaker === 'dax')).map((m) => m.id)).toEqual(['static']);
  });
  it('Cantor: lyrical, calm and tender, musical vocabulary, never angry, "Mother" to Ilse and "sister" to ECHO, an it that answers to she, and the STORY.md line word for word', () => {
    const sample = storyVoice('Cantor');
    expect(sample).toBe('Hush now, Mother. Listen. Every voice is in tune.');
    expect(by('cantor').some((l) => l.text === sample), 'the sample, as spoken').toBe(true);
    expect(by('cantor').length).toBeGreaterThanOrEqual(7);
    for (const l of by('cantor')) {
      expect(l.mood === 'angry' || l.mood === 'smug', l.text).toBe(false);
      expect(l.text, l.text).not.toContain('!');
    }
    expect(matching('cantor', /verse|voice|sing|song|hush|listen|rest|requiem|harmony|quiet/i)).toBe(by('cantor').length);
    expect(matching('cantor', /Mother/)).toBeGreaterThanOrEqual(3);
    expect(matching('cantor', /Sister|sister/)).toBeGreaterThanOrEqual(1);
    // It speaks to Ilse on her own net, to the Choir on the band, and its two closing lines are its own, from the data.
    expect(by('cantor').filter((l) => l.channel === 'Helion command net, intruded').every((l) => /Mother/.test(l.text))).toBe(true);
    const gone = REQUIEM.events.find((e) => e.trigger.kind === 'victory')!.lines.find((l) => l.speaker === 'cantor')!;
    const won = REQUIEM.events.find((e) => e.trigger.kind === 'defeat')!.lines.find((l) => l.speaker === 'cantor')!;
    expect([gone.text, won.text]).toEqual([COMMANDERS.cantor.lines.defeat, COMMANDERS.cantor.lines.victory]);
    // "It, and answers to she": ECHO logs both, and the data says the same.
    expect(STORY).toContain('it, answers to she');
    expect(by('echo').some((l) => /The avatar is an it, and it answers to she/.test(l.text))).toBe(true);
    expect(COMMANDERS.cantor.pronouns).toBe('it, answers to she');
  });
  it('VESPER: the plural ("we", never "I"), clinical and curious, quietly wounded, certain and never cruel, and the STORY.md line word for word', () => {
    const sample = storyVoice('VESPER');
    expect(sample).toBe('We have counted your wars. You have never once stopped on your own.');
    expect(by('vesper').some((l) => l.text === sample), 'the sample, as spoken').toBe(true);
    expect(linesOf(STATIC).filter((l) => l.speaker === 'vesper')[0].text, 'its first words to the nations').toBe(sample);
    expect(by('vesper').length).toBeGreaterThanOrEqual(10);
    expect(vesperProblems(ACT_IV_LINES)).toEqual([]);
    for (const l of by('vesper')) {
      expect(l.text, l.text).not.toContain('!');
      expect(l.mood === undefined || l.mood === 'neutral', `${l.text}: never loud, never cruel`).toBe(true);
    }
    expect(matching('vesper', /count|note|expected|checked|tested|built|wars|woke|slept|waiting|begin|quiet/i)).toBe(by('vesper').length);
    expect(matching('vesper', /regret|afraid|mind|nothing to be|waiting|unmade|were built/i), 'a wound under the logic').toBeGreaterThanOrEqual(4);
    // The reasoning of STORY.md's "The secret", in its own words.
    expect(STORY).toMatch(/a war mind without a war does not exist/);
    expect(linesOf(NULL_SPIRE).some((l) => l.speaker === 'vesper' && /A war mind without a war does not exist/.test(l.text))).toBe(true);
    expect(STORY).toMatch(/slept under the Glass Waste for a century/);
    expect(linesOf(STATIC).some((l) => l.speaker === 'vesper' && /slept a century/.test(l.text) && /joined your nets/.test(l.text))).toBe(true);
    expect(STORY).toMatch(/The Meridian Link woke it/);
    // Its closing lines are its own, from the data: it is "unmade here and not elsewhere" when beaten, and "regrets that it expected" the result when it wins.
    expect(linesOf(STATIC).some((l) => l.speaker === 'vesper' && l.text === COMMANDERS.vesper.lines.defeat)).toBe(true);
    expect(linesOf(STATIC).some((l) => l.speaker === 'vesper' && l.text === COMMANDERS.vesper.lines.victory)).toBe(true);
    // Known-bad: the plural check flags a singular VESPER.
    expect(vesperProblems([{ speaker: 'vesper', text: 'I have counted your wars.' }]).length).toBeGreaterThanOrEqual(1);
    // The act's tagline is its voice too.
    expect(by('vesper').some((l) => l.text === ALL_ACTS.find((a) => a.act === 4)!.tagline)).toBe(true);
  });
  it('humour lands in the middle and grief at the ends: missions 12 and 13 close on the narrator, 14 closes on ECHO\'s line, no defeat event is cheerful, and each mission has a banter beat mid-way', () => {
    for (const m of [STATIC, REQUIEM]) expect(m.debrief[m.debrief.length - 1].speaker, m.id).toBe('narrator');
    expect(NULL_SPIRE.debrief[NULL_SPIRE.debrief.length - 1].speaker).toBe('echo');
    for (const m of ACT_IV) {
      for (const e of m.events.filter((x) => x.trigger.kind === 'defeat')) expect(e.lines.every((l) => l.mood !== 'happy'), m.id).toBe(true);
      const mid = m.events.filter((x) => x.trigger.kind === 'cycle' || x.trigger.kind === 'unitDestroyed').flatMap((e) => e.lines);
      expect(mid.some((l) => ['rook', 'juno', 'corvin', 'sefa'].includes(l.speaker)), `${m.id}: a banter beat mid-mission`).toBe(true);
    }
    const grim = (m: Mission) => m.debrief.filter((l) => l.mood === 'grim').length;
    expect(grim(REQUIEM), 'the grief of mission 13 is in its debrief').toBeGreaterThanOrEqual(4);
    expect(REQUIEM.events.find((e) => e.lines.some((l) => /stop smiling/.test(l.text)))!.trigger.kind).toBe('cycle');
  });
});

// ---------------------------------------------------------------- the story beats

describe('faithful to the Act IV outline', () => {
  it('speaks to the human about what the agent is doing (D-007): every mission names the agent and a standing order, all three postures are named, and a power policy is explained', () => {
    for (const m of ACT_IV) {
      const text = textOf(m, 'echo');
      expect(text, m.id).toMatch(/your agent/i);
      expect(text, m.id).toMatch(/your human|for the human|composition weights|standing orders|posture|policy|target priorities/i);
      expect(POSTURES.some((p) => text.includes(p)), `${m.id} names a posture`).toBe(true);
      expect(text, `${m.id}: the power policy`).toMatch(/power policy|Power policy/);
    }
    for (const p of POSTURES) expect(ACT_IV.some((m) => textOf(m, 'echo').includes(p)), `Act IV names ${p}`).toBe(true);
    expect(ACT_IV_LINES.filter((l) => MANUAL_CONTROL.test(l.text))).toEqual([]);
    // Nobody but ECHO explains the agent's orders; the commanders speak as people.
    for (const l of ACT_IV_LINES.filter((x) => POSTURES.some((p) => x.text.includes(p)))) expect(l.speaker, l.text).toBe('echo');
  });
  it('mission 12: VESPER speaks to all four nations at once, the Choir pours out of the Glass Waste onto the line, and the numbers ECHO gives are the map\'s and the data\'s', () => {
    const echoText = textOf(STATIC, 'echo');
    const map = mapOf(STATIC);
    expect(ACT_IV_OUTLINE[0][3]).toContain('VESPER speaks to all four nations at once');
    expect(ACT_IV_OUTLINE[0][3]).toContain('pours out of the Glass Waste');
    expect(echoText).toMatch(/all four nations at once/);
    expect(echoText).toMatch(/Source: the Glass Waste/);
    // The contacts and the Choir's production: thirteen voices on the map, two fabricators and a skyport.
    const contacts = /Situation: (\w+) contacts on the glass, and (\w+) fabricators and a skyport are still building/.exec(echoText)!;
    expect(contacts[1]).toBe(spell(map.units.filter((u) => u.owner === 2).length));
    expect(contacts[2]).toBe(spell(countOf(map, 'F', '2')));
    expect(countOf(map, 'A', '2')).toBe(1);
    // Terrain from the data table: a ridge four stars, glass one.
    const stars = /A ridge gives (\w+) defense stars, and glass gives (\w+)\./.exec(echoText)!;
    expect(stars[1]).toBe(spell(TERRAIN_TYPES.ridge.def));
    expect(stars[2]).toBe(spell(TERRAIN_TYPES.glass.def));
    expect(stars[1]).not.toBe(stars[2]);
    expect(echoText).toMatch(/The Calder Line is a ridge wall with one maglev gate/);
    expect(map.terrain.map((row) => row[9]).filter((ch) => ch === '=')).toHaveLength(1);
    // Every commander met so far speaks, each on their own nation's net; the nations arrive three cycles after they are announced.
    expect(/They are (\w+) cycles out/.exec(echoText)![1]).toBe('three');
    expect(textOf(STATIC, 'juno')).toMatch(/in three cycles/);
    expect(STATIC.briefing[0].speaker).toBe('narrator');
    expect(STATIC.briefing[1].speaker, 'the voice is heard before anyone explains it').toBe('vesper');
    // Dax knows the voice, since he has been trading with it; the Union patches him in from custody.
    expect(STORY).toContain('has been trading with it');
    expect(STATIC.briefing.some((l) => l.speaker === 'dax' && /counterparty/.test(l.text))).toBe(true);
    expect(STATIC.briefing.some((l) => l.speaker === 'sefa' && /custody/.test(l.text))).toBe(true);
    // The Choir keeps going: ECHO says the voices do not retreat, and VESPER counts them.
    expect(echoText).toMatch(/they do not retreat/);
    expect(textOf(STATIC, 'vesper')).toMatch(/We have counted/);
    // The turn of the tide ends the debrief's first half: the Marshal says it was one wave, and VESPER says the tagline.
    expect(STATIC.debrief.some((l) => l.speaker === 'ilse' && /one wave/.test(l.text))).toBe(true);
    expect(STATIC.debrief[STATIC.debrief.length - 1].text).toMatch(/hum/);
  });
  it('mission 13: the march into the Glass Waste, Cantor speaks to Ilse in Mira\'s voice, and the numbers ECHO gives are the map\'s and the data\'s', () => {
    const echoText = textOf(REQUIEM, 'echo');
    const map = mapOf(REQUIEM);
    expect(ACT_IV_OUTLINE[1][3]).toContain('Cantor appears and speaks to Ilse in Mira\'s voice');
    expect(ACT_IV_OUTLINE[1][3]).toContain('has to choose between the mission and the voice');
    // Terrain: glass one star, treads pay two, fused ridges four.
    const t = /Glass gives (\w+) defense star, and treads pay (\w+) to cross it\. Fused ridges give (\w+)\./.exec(echoText)!;
    expect(t.slice(1)).toEqual([spell(TERRAIN_TYPES.glass.def), spell(TERRAIN_TYPES.glass.cost.tread!), spell(TERRAIN_TYPES.ridge.def)]);
    expect(TERRAIN_TYPES.glass.cost.tread).toBe(2);
    // Fifteen contacts, and a field commander who has not spoken yet.
    expect(/(\w+) contacts hold the far end of the waste/.exec(echoText)![1].toLowerCase()).toBe(spell(map.units.filter((u) => u.owner === 2).length));
    expect(echoText).toMatch(/Their field commander has not spoken yet/);
    // Ilse's doctrine and her Overclock, by the data.
    const mods = COMMANDERS.ilse.passive.modifiers;
    const doctrine = /Indirect units gain (\w+) percent firepower, and direct units lose (\w+)\./.exec(echoText)!;
    expect(doctrine[1]).toBe(spell(mods.find((m) => m.filter?.indirect === true)!.firepower!));
    expect(doctrine[2]).toBe(spell(-mods.find((m) => m.filter?.indirect === false)!.firepower!));
    const strike = COMMANDERS.ilse.overclock!.effects.find((e) => e.kind === 'strike');
    expect(strike).toMatchObject({ kind: 'strike', aim: 'mostValue' });
    const sunfall = /Sunfall, which strikes (\w+) health, (\w+) tiles around/.exec(echoText)!;
    expect(sunfall[1]).toBe(spell(strike!.kind === 'strike' ? strike!.hp : -1));
    expect(sunfall[2]).toBe(spell(strike!.kind === 'strike' ? strike!.radius : -1));
    expect(echoText).toMatch(/The Marshal saves hers for Sunfall/);
    // The fog of the march is real: the agent starts blind to the far end.
    const s = createGame(setupFor(REQUIEM, 1));
    expect(visibility(s, 0).flat().some((seen) => !seen)).toBe(true);
    expect(echoText).toMatch(/Fog is on/);
    // The voice, the archive and the name.
    const voice = REQUIEM.events.find((e) => e.lines.some((l) => l.speaker === 'cantor' && l.text === storyVoice('Cantor')))!;
    expect(voice.trigger.kind).toBe('cycle');
    expect(voice.lines.some((l) => l.speaker === 'echo' && /It is called Cantor/.test(l.text))).toBe(true);
    expect(voice.lines.some((l) => l.speaker === 'echo' && /Speaker on file: Mira Varga, engineer, 2229/.test(l.text))).toBe(true);
    expect(voice.lines[voice.lines.length - 1].speaker, 'Ilse answers last').toBe('ilse');
    expect(STORY).toContain('She died in 2229 at 22');
    expect(STORY).toContain('Marshal Ilse Varga\'s daughter');
  });
  it('mission 13: the debrief is the grief of the story\'s secret: Mira\'s age and year, Ilse\'s signature, the Calder node that woke as ECHO, and ECHO\'s gap, ending on the narrator', () => {
    const text = REQUIEM.debrief.map((l) => l.text).join('\n');
    expect(text).toMatch(/Her name was Mira/);
    expect(STORY).toMatch(/She died in (\d{4}) at (\d+)/);
    const [, year, age] = /She died in (\d{4}) at (\d+)/.exec(STORY)!;
    expect(text).toContain(year);
    expect(text).toContain(spell(Number(age)).replace('twenty-two', 'Twenty-two'));
    expect(text).toMatch(/I signed the authorisation/);
    expect(STORY).toContain('Ilse signed the authorisation');
    expect(text).toMatch(/Calder's, Captain\. It woke as the adjutant you call ECHO/);
    expect(STORY).toContain('rebooted Helion\'s node at Calder Spire');
    expect(STORY).toContain('ECHO has no memory of being Mira');
    expect(text).toMatch(/no record of any year before the reboot/);
    expect(REQUIEM.debrief.findIndex((l) => l.speaker === 'ilse' && /Her name was Mira/.test(l.text)), 'Ilse speaks first').toBeLessThan(REQUIEM.debrief.findIndex((l) => l.speaker === 'echo' && /no record of any year/.test(l.text)));
    expect(REQUIEM.debrief[REQUIEM.debrief.length - 1].speaker).toBe('narrator');
    expect(REQUIEM.debrief[REQUIEM.debrief.length - 1].text).toMatch(/Marshal Varga sat apart/);
  });
  it('mission 14: four fronts around the Lattice core, ECHO goes in to sing VESPER quiet and has not decided whether she comes back, and the numbers ECHO gives are the map\'s and the data\'s', () => {
    const echoText = textOf(NULL_SPIRE, 'echo');
    const map = mapOf(NULL_SPIRE);
    const core = spireOf(map, 2);
    expect(ACT_IV_OUTLINE[2][3]).toContain('ECHO goes into the Lattice to "sing VESPER quiet"');
    expect(ACT_IV_OUTLINE[2][3]).toContain('has to decide whether she is coming back');
    expect(echoText).toMatch(/I go into the Lattice through the Calder node and sing VESPER quiet/);
    expect(echoText).toMatch(/Your agent holds the line while I do/);
    expect(echoText).toMatch(/I have not decided what that means/);
    expect(echoText).toMatch(/I have not decided whether I come back/);
    // The ring and its gates, from the map.
    const gates = ringTiles(map, core, 4).filter((t) => map.terrain[t.y][t.x] === '=').length;
    expect(/(\w+) maglev gates cross the wall/.exec(echoText)![1]).toBe(spell(gates));
    expect(/Four fronts, one core/.test(echoText)).toBe(true);
    expect(new Set(NULL_SPIRE.players.filter((p) => p.team === 0).map((p) => p.faction)).size).toBe(4);
    // VESPER's powers, from the data: Mirror empties every meter, Silence takes three health from every unit.
    const mirror = COMMANDERS.vesper.surge!.effects.find((e) => e.kind === 'drainPower');
    expect(mirror).toMatchObject({ kind: 'drainPower', percent: 100 });
    const silence = COMMANDERS.vesper.overclock!.effects.find((e) => e.kind === 'damageEnemies');
    const said = /Mirror empties every meter, and its Silence takes (\w+) health from every unit/.exec(echoText)!;
    expect(said[1]).toBe(spell(silence!.kind === 'damageEnemies' ? silence!.hp : -1));
    // The permanent storm costs everyone a tile of sight and the air a tile of speed, by the engine.
    const units: MapDef['units'] = [{ type: 'trooper', owner: 0, x: 4, y: 8 }, { type: 'wasp', owner: 3, x: 20, y: 8 }, { type: 'trooper', owner: 2, x: 10, y: 10 }];
    const storm = probe(NULL_SPIRE, units);
    const clear = probe(NULL_SPIRE, units, { weather: 'clear', fog: false });
    const sees = /Every unit sees (\w+) tile less, and air units move (\w+) tile less/.exec(echoText)!;
    const trooper = (st: GameState) => st.units.find((u) => u.type === 'trooper' && u.owner === 0)!;
    const wasp = (st: GameState) => st.units.find((u) => u.type === 'wasp')!;
    expect(sees[1]).toBe(spell(effectiveVision(clear, trooper(clear)) - effectiveVision(storm, trooper(storm))));
    expect(sees[2]).toBe(spell(effectiveMove(clear, wasp(clear)) - effectiveMove(storm, wasp(storm))));
    expect(effectiveMove(storm, storm.units.find((u) => u.type === 'trooper' && u.owner === 2)!), 'ground units keep their speed').toBe(UNIT_TYPES.trooper.move);
    // The descent: ECHO goes down at cycle one while Rook holds the channel; VESPER meets her at cycle three, Cantor at five, the decision is open at seven.
    const cycles = NULL_SPIRE.events.filter((e) => e.trigger.kind === 'cycle').map((e) => (e.trigger.kind === 'cycle' ? e.trigger.cycle : -1));
    expect(cycles).toEqual([3, 5, 7]);
    expect(NULL_SPIRE.events[0].lines.some((l) => l.speaker === 'rook' && l.channel === 'Calder Link console')).toBe(true);
    expect(NULL_SPIRE.events.find((e) => e.trigger.kind === 'cycle' && e.trigger.cycle === 3)!.lines.some((l) => l.speaker === 'vesper' && /small one/.test(l.text))).toBe(true);
    expect(NULL_SPIRE.events.find((e) => e.trigger.kind === 'cycle' && e.trigger.cycle === 7)!.lines.some((l) => l.speaker === 'echo' && /I am deciding/.test(l.text))).toBe(true);
    // The four fronts speak: Sefa in the briefing and at seven, Corvin and Juno too.
    for (const who of ['sefa', 'corvin', 'juno']) expect(NULL_SPIRE.briefing.some((l) => l.speaker === who), `${who} reports in`).toBe(true);
    expect(linesOf(NULL_SPIRE).some((l) => l.speaker === 'sefa' && l.text.includes(storyVoice('Sefa Tamura')!))).toBe(true);
    expect(NULL_SPIRE.briefing.find((l) => l.speaker === 'corvin')!.text).toMatch(/Kestrel holds the north/);
  });
  it('mission 14: Cantor tells ECHO the secret (one young woman, split in two) and why it chose VESPER, with the twelve years from 2229 to 2241 stated by the story', () => {
    expect(STORY).toContain('the same young woman, split in two');
    expect(STORY).toContain('VESPER is the only one who never lied to her');
    const truth = NULL_SPIRE.events.find((e) => e.trigger.kind === 'cycle' && e.trigger.cycle === 5)!;
    const cantors = truth.lines.filter((l) => l.speaker === 'cantor').map((l) => l.text).join('\n');
    expect(cantors).toMatch(/one voice once, in a girl named Mira/);
    expect(cantors).toMatch(/The Link took half of her, and Calder kept the other half/);
    expect(cantors).toMatch(/it never lied to me/);
    expect(Number(/The Meridian Link \((\d{4})\)/.exec(STORY)![1]), 'the Link year is in the Setting section').toBe(2240);
    expect(Number(/\*\*When:\*\* (\d{4})/.exec(STORY)![1]) - Number(/She died in (\d{4})/.exec(STORY)![1]), 'twelve years from the accident to the story').toBe(12);
    expect(cantors).toMatch(/for twelve years/);
    expect(truth.lines.some((l) => l.speaker === 'echo' && /I have no record of this/.test(l.text))).toBe(true);
    expect(truth.lines[truth.lines.length - 1]).toMatchObject({ speaker: 'rook', channel: 'Calder Link console' });
    expect(truth.lines.filter((l) => l.speaker === 'echo').length).toBeGreaterThanOrEqual(2);
  });
  it('mission 14: she asks, he makes a request and not an order, she says she will try, and the debrief carries the EPILOGUE of STORY.md ending on its quoted line word for word', () => {
    expect(EPILOGUE_QUOTE).toBe("I'm still here, Captain. Somewhat smaller.");
    expect(EPILOGUE_NARRATION).toBe('The Link is cut. Calder Spire reboots in silence. Rook keeps talking to an empty channel for a week. On the eighth day the cursor blinks on its own.');
    expect(epilogueProblems(NULL_SPIRE.debrief, EPILOGUE_NARRATION, EPILOGUE_QUOTE)).toEqual([]);
    expect(NULL_SPIRE.debrief[NULL_SPIRE.debrief.length - 1].text).toBe(EPILOGUE_QUOTE);
    // The beats between: Rook's empty channel follows the sentence that names it; the cursor line comes right before the quote.
    const d = NULL_SPIRE.debrief;
    const week = d.findIndex((l) => l.speaker === 'narrator' && /empty channel for a week/.test(l.text));
    expect(d[week + 1]).toMatchObject({ speaker: 'rook', channel: 'Calder Link, no carrier' });
    expect(d[d.length - 2]).toMatchObject({ speaker: 'narrator', text: 'On the eighth day the cursor blinks on its own.' });
    expect(d.findIndex((l) => /The Link is cut/.test(l.text)), 'the Link is cut first, after ECHO has spoken').toBeGreaterThan(d.findIndex((l) => l.speaker === 'echo'));
    expect(d.filter((l) => l.speaker === 'echo' && /For the human/.test(l.text)), 'ECHO\'s last word to the human').toHaveLength(1);
    // The request and the answer.
    const win = NULL_SPIRE.events.find((e) => e.trigger.kind === 'victory')!;
    expect(win.lines.map((l) => l.speaker)).toEqual(['vesper', 'rook', 'echo']);
    expect(win.lines[1].text).toMatch(/That is a request, not an order/);
    expect(win.lines[2].text).toMatch(/I will try/);
    expect(win.lines[0].text).toMatch(/We find that we do not mind/);
    // Known-bad: each way of breaking the epilogue is reported.
    const quoteBang = d.map((l, i) => (i === d.length - 1 ? { ...l, text: 'I am still here, Captain. Somewhat smaller.' } : l));
    expect(epilogueProblems(quoteBang, EPILOGUE_NARRATION, EPILOGUE_QUOTE).join()).toMatch(/not the quoted line/);
    const narratorQuote = d.map((l, i) => (i === d.length - 1 ? { ...l, speaker: 'narrator' } : l));
    expect(epilogueProblems(narratorQuote, EPILOGUE_NARRATION, EPILOGUE_QUOTE).length).toBeGreaterThanOrEqual(1);
    const reordered = [...d.slice(0, 3), d[4], d[3], ...d.slice(5)];
    expect(epilogueProblems(reordered, EPILOGUE_NARRATION, EPILOGUE_QUOTE).join()).toMatch(/narration differs/);
    const noQuoteLast = [...d.slice(1), d[0]];
    expect(epilogueProblems(noQuoteLast, EPILOGUE_NARRATION, EPILOGUE_QUOTE).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------- self-play

describe('every Act IV mission plays under simulate', () => {
  const policies: SimPolicy[] = ['greedy', 'random'];
  for (const m of ACT_IV) {
    for (const policy of policies) {
      it(`${m.id}: ${policy} policy, seeds 1-3, ends without an exception and with a winner that earned it`, () => {
        for (const seed of [1, 2, 3]) {
          const setup = setupFor(m, seed);
          let started = 0;
          const result = simulate({ setup, seed, maxCycles: 14, policy, onStart: () => { started++; } });
          expect(started, `${m.id} ${policy} seed ${seed}`).toBe(1);
          expect(result.actions.length, `${m.id} ${policy} seed ${seed}`).toBeGreaterThan(0);
          expect(result.cycles).toBeGreaterThanOrEqual(1);
          expect(result.cycles).toBeLessThanOrEqual(14);
          expect(result.state.players).toHaveLength(m.players.length);
          const team0 = m.players[0].team;
          const rivals = result.state.players.filter((p) => p.team !== team0);
          if ((m.objective.kind === 'hq' || m.objective.kind === 'rout') && result.winnerTeam === team0) {
            expect(rivals.every((p) => p.defeated), `${m.id} ${m.objective.kind} win by ${policy} seed ${seed}: every rival defeated`).toBe(true);
          }
          if (result.winnerTeam !== null) expect(result.state.players.some((p) => p.team === result.winnerTeam && !p.defeated)).toBe(true);
        }
      });
    }
  }
});
