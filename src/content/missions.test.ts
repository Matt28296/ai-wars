// M4.0 Act I of the campaign: missions 1-4 as data. Spec: docs/STORY.md "Act I" and "Writing rules for dialogue", docs/delivery/DECISIONS.md
// D-004, D-005 and D-007, docs/research/quality-bar.md section 15 (the par values the score uses). Every expectation is computed here from
// the story text, from the map rows or from the engine's own queries, never copied back from missions.ts or mission-maps.ts. Known-bad
// inputs: the dialogue checker, the hq check and the trigger check each have planted failures they must keep reporting, and checkMap's
// requireBases option has a map with no base that must fail by default and pass with it off.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERRAIN_CODES, TERRAIN_TYPES } from '../data';
import { applyAction, createGame, incomeOf, scoreCard } from '../game/aw';
import type { CreateGameOptions, PlayerSetup } from '../game/aw';
import { simulate } from '../game/aw/sim';
import type { SimPolicy } from '../game/aw/sim';
import type { MoveType } from '../game/aw/types';
import { COMMANDERS } from './commanders';
import { checkMap } from './map-check';
import { MAPS } from './maps';
import { MISSION_MAPS } from './mission-maps';
import { CAMPAIGN_ACTS, MISSIONS } from './missions';
import type { DialogueLine, MapDef, Mission, MissionTrigger } from './types';

// The repo guard owns the list of names that must never ship; reuse it rather than copy it (as maps.test.ts does).
const guardUrl = new URL('../../scripts/guard.mjs', import.meta.url).href;
const guard: { DENYLIST: string[]; scanText: (path: string, text: string) => { rule: string; match: string }[] } = await import(/* @vite-ignore */ guardUrl);

const STORY = readFileSync(new URL('../../docs/STORY.md', import.meta.url), 'utf8');

// ---------------------------------------------------------------- helpers (independent of the code under test)

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const [FIRST_LIGHT, CALDER_SPIRE, SALTGLASS_BAY, TIDEBREAK] = MISSIONS;
const mapOf = (m: Mission): MapDef => MISSION_MAPS[m.mapId];
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
  return { map: mapOf(m), players, fog: m.fog, weather: m.weather, objective: m.objective, seed };
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

/** Every broken writing rule in a list of lines. Empty = clean. */
function dialogueProblems(lines: DialogueLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const tag = `${l.speaker}: "${l.text.slice(0, 40)}"`;
    if (!l.text.trim()) out.push(`empty line (${tag})`);
    if (l.text.length > 220) out.push(`over 220 characters (${tag})`);
    if (!ACT_I_SPEAKERS.includes(l.speaker)) out.push(`speaker not allowed in Act I (${tag})`);
    if (NEVER_SHOUTS.has(l.speaker) && l.text.includes('!')) out.push(`exclamation mark from a speaker who never uses one (${tag})`);
    for (const re of SPOILERS) if (re.test(l.text)) out.push(`spoiler ${re} (${tag})`);
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
