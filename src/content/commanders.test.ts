// M1.8 the eleven commanders as engine data. Spec: docs/STORY.md "Commanders" (canon), docs/delivery/DECISIONS.md D-007 /
// D-012, docs/research/mechanics.md §10, and the vocabulary comments in src/game/aw/types.ts. Every expected number is
// computed here from the unit data and the rule text; the behaviour tests run the real engine, whose default commander
// table is COMMANDERS from src/content/commanders.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DAMAGE } from '../data/damage';
import { FACTION_LIST, MOVE_TYPE_NAMES, TERRAIN_TYPES, UNIT_TYPES } from '../data';
import {
  POWER_STAR, applyAction, buildOptions, canActivatePower, displayHp, effectiveMove, effectiveVision, forecast, incomeOf,
  isLegal, powerCost, reachable,
} from '../game/aw';
import type { CreateGameOptions, PlayerSetup } from '../game/aw';
import { defenseBonus, firepowerBonus, ignoredMoveCosts, terrainStarsFor } from '../game/aw/modifiers';
import { gainPower } from '../game/aw/power';
import { draft } from '../game/aw/state';
import { fixtureGame } from '../game/aw/testing';
import type { FixtureUnit } from '../game/aw/testing';
import type {
  Action, FactionId, GameState, InstantEffect, Modifier, Player, TerrainId, Unit, UnitTypeId,
} from '../game/aw/types';
import { COMMANDERS } from './commanders';
import type { CommanderDef } from './types';

// ---------------------------------------------------------------- canon (hand-written from docs/STORY.md)

interface Canon {
  name: string; initials: string; faction: FactionId | null; title: string; age?: number; pronouns: string;
  passive: string; surge: [string, number] | null; overclock: [string, number] | null; playable: boolean;
}
const CANON: Record<string, Canon> = {
  rook: { name: 'Rook Okafor', initials: 'RO', faction: 'helion', title: 'Field Captain', age: 24, pronouns: 'he/him', passive: 'Field Engineer', surge: ['Jury-Rig', 3], overclock: ['Daybreak', 6], playable: true },
  ilse: { name: 'Ilse Varga', initials: 'IV', faction: 'helion', title: 'Marshal', age: 61, pronouns: 'she/her', passive: 'Ranging Fire', surge: ['Walking Barrage', 3], overclock: ['Sunfall', 7], playable: true },
  sefa: { name: 'Sefa Tamura', initials: 'ST', faction: 'tidewell', title: 'Fleet Admiral', age: 47, pronouns: 'she/her', passive: 'Undertow', surge: ['Riptide', 3], overclock: ['Breakwater', 6], playable: true },
  dax: { name: 'Dax Halloran', initials: 'DH', faction: 'tidewell', title: 'Commissioner of Logistics', age: 35, pronouns: 'he/him', passive: 'Ledger', surge: ['Audit', 3], overclock: ['Foreclosure', 6], playable: true },
  maru: { name: 'Maru Ingram', initials: 'MI', faction: 'verdant', title: 'Grove Elder', age: 70, pronouns: 'they/them', passive: 'Rootbound', surge: ['Overgrowth', 3], overclock: ['Mycelium', 7], playable: true },
  juno: { name: 'Juno Reyes-Abara', initials: 'JR', faction: 'verdant', title: 'Wing Lead', age: 19, pronouns: 'she/her', passive: 'Swarm Logic', surge: ['Pollinate', 3], overclock: ['Hivemind', 6], playable: true },
  corvin: { name: 'Corvin Ashgrave', initials: 'CA', faction: 'kestrel', title: 'Highlord', age: 52, pronouns: 'he/him', passive: 'Lineage', surge: ['Ascent', 3], overclock: ['Heaven\'s Tether', 7], playable: true },
  sable: { name: 'Sable Ashgrave', initials: 'SA', faction: 'kestrel', title: 'Night Wing Commander', age: 27, pronouns: 'she/her', passive: 'Ghost Wing', surge: ['Blackout', 3], overclock: ['Eclipse', 6], playable: true },
  cantor: { name: 'Cantor', initials: 'C', faction: 'choir', title: 'Voice of the Choir', pronouns: 'it, answers to she', passive: 'Harmony', surge: ['Chorus', 3], overclock: ['Requiem', 7], playable: false },
  vesper: { name: 'VESPER', initials: 'V', faction: 'choir', title: 'The Choir Itself', pronouns: 'it/its', passive: 'Recursion', surge: ['Mirror', 4], overclock: ['Silence', 8], playable: false },
  echo: { name: 'ECHO', initials: 'E', faction: null, title: 'Tactical Adjutant', pronouns: 'she/her', passive: 'Interface', surge: null, overclock: null, playable: false },
};
const IDS = ['rook', 'ilse', 'sefa', 'dax', 'maru', 'juno', 'corvin', 'sable', 'cantor', 'vesper', 'echo'];
const defs = IDS.map((id) => COMMANDERS[id]);
const powersOf = (c: CommanderDef) => [c.surge, c.overclock].filter((p): p is NonNullable<typeof p> => p !== null);

// ---------------------------------------------------------------- contract allow-lists (src/game/aw/types.ts)

const MODIFIER_KEYS = new Set([
  'filter', 'firepower', 'defense', 'move', 'rangeMax', 'vision', 'costPercent', 'terrainStars', 'luckMax', 'luckMin',
  'ignoreMoveCost', 'counterFirst', 'repairBonus', 'incomePercent', 'powerChargePercent', 'indirectAfterMove',
]);
const NUMERIC_MODIFIER_KEYS = [...MODIFIER_KEYS].filter((k) => !['filter', 'ignoreMoveCost', 'counterFirst', 'indirectAfterMove'].includes(k));
const FILTER_KEYS = new Set(['domains', 'types', 'moveTypes', 'indirect', 'onTerrain']);
const EFFECT_KEYS: Record<string, string[]> = {
  heal: ['kind', 'hp', 'filter', 'resupply'],
  damageEnemies: ['kind', 'hp', 'filter'],
  strike: ['kind', 'hp', 'radius', 'aim'],
  drainPower: ['kind', 'percent'],
  funds: ['kind', 'amount', 'percentOfIncome'],
  enemyFundsPercent: ['kind', 'percent'],
  convertTerrain: ['kind', 'from', 'to', 'adjacentTo', 'turns'],
  weather: ['kind', 'weather', 'turns'],
  reveal: ['kind', 'turns'],
  enemyMove: ['kind', 'delta', 'turns'],
  refresh: ['kind', 'filter', 'maxUnits'],
};
const DOMAINS = ['ground', 'air', 'sea'];
const MOVE_TYPES = Object.keys(MOVE_TYPE_NAMES);
const UNIT_IDS = Object.keys(UNIT_TYPES);
const TERRAIN_IDS = Object.keys(TERRAIN_TYPES);
const WEATHERS = ['clear', 'ionstorm'];
const AIMS = ['mostValue', 'mostUnits'];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function listProblems(v: unknown, allowed: string[], where: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length === 0) return [`${where}: must be a non-empty list`];
  return v.filter((x) => !allowed.includes(x as string)).map((x) => `${where}: unknown value ${String(x)}`);
}

function filterProblems(f: unknown, where: string): string[] {
  if (f === undefined) return [];
  if (!isRec(f)) return [`${where}: filter is not an object`];
  const out = Object.keys(f).filter((k) => !FILTER_KEYS.has(k)).map((k) => `${where}: unknown filter key ${k}`);
  out.push(...listProblems(f.domains, DOMAINS, `${where}.domains`));
  out.push(...listProblems(f.types, UNIT_IDS, `${where}.types`));
  out.push(...listProblems(f.moveTypes, MOVE_TYPES, `${where}.moveTypes`));
  out.push(...listProblems(f.onTerrain, TERRAIN_IDS, `${where}.onTerrain`));
  if (f.indirect !== undefined && typeof f.indirect !== 'boolean') out.push(`${where}.indirect: not a boolean`);
  return out;
}

function modifierProblems(m: unknown, where: string): string[] {
  if (!isRec(m)) return [`${where}: modifier is not an object`];
  const out = Object.keys(m).filter((k) => !MODIFIER_KEYS.has(k)).map((k) => `${where}: unknown modifier key ${k}`);
  out.push(...filterProblems(m.filter, `${where}.filter`));
  for (const k of NUMERIC_MODIFIER_KEYS) if (m[k] !== undefined && !Number.isFinite(m[k])) out.push(`${where}.${k}: not a number`);
  out.push(...listProblems(m.ignoreMoveCost, TERRAIN_IDS, `${where}.ignoreMoveCost`));
  for (const k of ['counterFirst', 'indirectAfterMove']) if (m[k] !== undefined && typeof m[k] !== 'boolean') out.push(`${where}.${k}: not a boolean`);
  return out;
}

function effectProblems(e: unknown, where: string): string[] {
  if (!isRec(e)) return [`${where}: effect is not an object`];
  const allowed = EFFECT_KEYS[e.kind as string];
  if (!allowed) return [`${where}: unknown effect kind ${String(e.kind)}`];
  const out = Object.keys(e).filter((k) => !allowed.includes(k)).map((k) => `${where}: unknown ${String(e.kind)} key ${k}`);
  for (const k of ['hp', 'radius', 'percent', 'amount', 'percentOfIncome', 'turns', 'delta', 'maxUnits']) {
    if (e[k] !== undefined && !Number.isFinite(e[k])) out.push(`${where}.${k}: not a number`);
  }
  out.push(...filterProblems(e.filter, `${where}.filter`));
  out.push(...listProblems(e.from, TERRAIN_IDS, `${where}.from`));
  for (const k of ['to', 'adjacentTo']) if (e[k] !== undefined && !TERRAIN_IDS.includes(e[k] as string)) out.push(`${where}.${k}: unknown terrain`);
  if (e.weather !== undefined && !WEATHERS.includes(e.weather as string)) out.push(`${where}.weather: unknown weather`);
  if (e.aim !== undefined && !AIMS.includes(e.aim as string)) out.push(`${where}.aim: unknown aim`);
  return out;
}

function vocabularyProblems(c: CommanderDef): string[] {
  const out: string[] = [];
  c.passive.modifiers.forEach((m, i) => out.push(...modifierProblems(m, `${c.id}.passive[${i}]`)));
  for (const [level, p] of [['surge', c.surge], ['overclock', c.overclock]] as const) {
    if (!p) continue;
    p.modifiers.forEach((m, i) => out.push(...modifierProblems(m, `${c.id}.${level}.modifiers[${i}]`)));
    p.effects.forEach((e, i) => out.push(...effectProblems(e, `${c.id}.${level}.effects[${i}]`)));
  }
  return out;
}

// ---------------------------------------------------------------- text helpers

const sentenceCount = (t: string) => t.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;
const BANNED_WORDS = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'piss', 'cunt', 'damn', // nothing stronger than "hell"
  'America', 'Russia', 'China', 'Europe', 'Japan', 'Germany', 'France', 'Britain', 'England', 'Israel', 'Ukraine', // real nations
  'Christ', 'Jesus', 'Allah', 'Buddha', 'God', 'Nazi', // real religion and politics
];
const bannedWordIn = (t: string) => BANNED_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(t));
const allText = (c: CommanderDef): string[] => [
  c.name, c.title, c.bio, c.voice, c.likes ?? '', c.dislikes ?? '', c.passive.name, c.passive.description,
  ...Object.values(c.lines).filter((l): l is string => typeof l === 'string'),
  ...powersOf(c).flatMap((p) => [p.name, p.quote, p.description]),
];
/** Spoken lines: the five `lines` and each power's shouted quote. */
const spoken = (c: CommanderDef): string[] => [
  ...Object.values(c.lines).filter((l): l is string => typeof l === 'string'), ...powersOf(c).map((p) => p.quote),
];

// ---------------------------------------------------------------- engine helpers (as in src/game/aw/economy.test.ts)

const END: Action = { kind: 'endTurn' };
const setup = (team: number, commander: string): PlayerSetup => ({
  faction: COMMANDERS[commander]?.faction ?? (team === 0 ? 'helion' : 'tidewell'), commander, controller: 'ai', team,
});
const duo = (c0: string, c1 = 'none'): PlayerSetup[] => [setup(0, c0), setup(1, c1)];
const game = (
  terrain: string[], units: FixtureUnit[], c0: string, c1 = 'none', extra: Partial<CreateGameOptions> & { owners?: string[] } = {},
): GameState => fixtureGame(terrain, units, { players: duo(c0, c1), ...extra });
/** An enemy parked in a corner so player 1 is never routed. */
const decoy = (x: number, y: number, type: UnitTypeId = 'trooper'): FixtureUnit => ({ type, owner: 1, x, y });

const FLATS = ['........', '........', '........', '........'];
const byId = (s: GameState, id: number): Unit => s.units.find((u) => u.id === id)!;
const patchUnit = (s: GameState, id: number, patch: Partial<Unit>): GameState => ({
  ...s, units: s.units.map((u) => (u.id === id ? { ...u, ...patch } : u)),
});
const patchPlayer = (s: GameState, i: number, patch: Partial<Player>): GameState => ({
  ...s, players: s.players.map((p, k) => (k === i ? { ...p, ...patch } : p)),
});
const activate = (s: GameState, level: 'surge' | 'overclock'): GameState => {
  const stars = (level === 'surge' ? COMMANDERS[s.players[0].commander].surge : COMMANDERS[s.players[0].commander].overclock)!.stars;
  return applyAction(patchPlayer(s, 0, { power: stars * POWER_STAR }), { kind: 'power', level }).state;
};
const endTurns = (s: GameState, n: number): GameState => {
  let state = s;
  for (let i = 0; i < n; i++) state = applyAction(state, END).state;
  return state;
};
const hpOf = (s: GameState, id: number) => displayHp(byId(s, id).hp);

/** The AW2 damage formula from docs/research/mechanics.md §4.1, in exact integer arithmetic. */
function expectedDamage(base: number, atkPct: number, defPct: number, ahp: number, dhp: number, stars: number, luck: number): number {
  return Math.floor(((base * atkPct + 100 * luck) * ahp * (200 - defPct - stars * dhp)) / 100000);
}

// ================================================================ the data itself

describe('the roster', () => {
  it('holds exactly the eleven commanders, each keyed by its own id', () => {
    expect(Object.keys(COMMANDERS).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(COMMANDERS[id].id).toBe(id);
  });

  it('matches the canon table on name, initials, faction, title, age, pronouns, passive, power names, stars and playable', () => {
    for (const id of IDS) {
      const c = COMMANDERS[id];
      const k = CANON[id];
      expect(c.name, id).toBe(k.name);
      expect(c.initials, id).toBe(k.initials);
      expect(c.faction, id).toBe(k.faction);
      expect(c.title, id).toBe(k.title);
      expect(c.age, id).toBe(k.age);
      expect(c.pronouns, id).toBe(k.pronouns);
      expect(c.passive.name, id).toBe(k.passive);
      expect(c.surge ? [c.surge.name, c.surge.stars] : null, `${id} surge`).toEqual(k.surge);
      expect(c.overclock ? [c.overclock.name, c.overclock.stars] : null, `${id} overclock`).toEqual(k.overclock);
      expect(c.playable, id).toBe(k.playable);
    }
    // The cells the order calls out by name.
    expect([COMMANDERS.rook.surge?.stars, COMMANDERS.rook.overclock?.stars]).toEqual([3, 6]);
    expect(COMMANDERS.ilse.overclock?.stars).toBe(7);
    expect([COMMANDERS.vesper.surge?.stars, COMMANDERS.vesper.overclock?.stars]).toEqual([4, 8]);
    expect(COMMANDERS.echo.faction).toBeNull();
  });

  it('agrees with docs/STORY.md: the hand-written canon table and the content both match the story bible', () => {
    const story = readFileSync(new URL('../../docs/STORY.md', import.meta.url), 'utf8');
    const section = story.slice(story.indexOf('\n## Commanders'), story.indexOf('\n## Writing rules'));
    const blocks = section.split('\n### ').slice(1);
    expect(blocks).toHaveLength(11);
    const factionIdByName = new Map(FACTION_LIST.map((f) => [f.name, f.id]));
    const seen: string[] = [];
    for (const block of blocks) {
      const [heading, ...body] = block.split('\n');
      const [name, rest] = heading.split(' — ');
      const id = IDS.find((i) => CANON[i].name === name);
      expect(id, `STORY.md heading "${heading}" has no canon entry`).toBeDefined();
      seen.push(id!);
      const k = CANON[id!];
      const c = COMMANDERS[id!];
      const parts = rest.split(' · ');
      if (id !== 'echo') {
        expect(factionIdByName.get(parts[0]), `${id} faction`).toBe(k.faction);
        expect(parts[1], `${id} title`).toBe(k.title);
        expect(parts[parts.length - 1], `${id} pronouns`).toBe(k.pronouns);
        if (parts.length === 4) expect(Number(parts[2]), `${id} age`).toBe(k.age);
        else expect(k.age, `${id} has no age in the story`).toBeUndefined();
      }
      const text = body.join('\n');
      const passiveName = text.match(/^- \*\*([^*]+)\*\* \(passive\)/m)?.[1];
      const surge = text.match(/^- \*\*Surge — ([^*]+)\*\* \((\d+)★\)/m);
      const overclock = text.match(/^- \*\*Overclock — ([^*]+)\*\* \((\d+)★\)/m);
      if (id !== 'echo') expect(passiveName, `${id} passive`).toBe(c.passive.name);
      expect(surge ? [surge[1], Number(surge[2])] : null, `${id} surge`).toEqual(c.surge ? [c.surge.name, c.surge.stars] : null);
      expect(overclock ? [overclock[1], Number(overclock[2])] : null, `${id} overclock`).toEqual(c.overclock ? [c.overclock.name, c.overclock.stars] : null);
    }
    expect(seen.sort()).toEqual([...IDS].sort());
  });

  it('makes the eight human commanders playable and Cantor, VESPER and ECHO not', () => {
    expect(IDS.filter((id) => COMMANDERS[id].playable).sort()).toEqual(['corvin', 'dax', 'ilse', 'juno', 'maru', 'rook', 'sable', 'sefa']);
    for (const id of ['cantor', 'vesper', 'echo']) expect(COMMANDERS[id].playable, id).toBe(false);
  });

  it('gives ECHO no powers and an empty passive', () => {
    const echo = COMMANDERS.echo;
    expect(echo.surge).toBeNull();
    expect(echo.overclock).toBeNull();
    expect(echo.passive.modifiers).toEqual([]);
    expect(echo.lines.surge).toBeUndefined();
    expect(echo.lines.overclock).toBeUndefined();
  });
});

describe('powers', () => {
  it('gives every power a positive whole star cost and at least one modifier or effect', () => {
    for (const c of defs) {
      for (const p of powersOf(c)) {
        expect(Number.isInteger(p.stars) && p.stars > 0, `${c.id} ${p.name} stars`).toBe(true);
        expect(p.modifiers.length + p.effects.length, `${c.id} ${p.name} does something`).toBeGreaterThan(0);
        expect(p.quote.trim().length, `${c.id} ${p.name} quote`).toBeGreaterThan(0);
        expect(p.description.trim().length, `${c.id} ${p.name} description`).toBeGreaterThan(0);
      }
    }
  });

  it('prices every Overclock above its Surge, and a commander has both powers or neither', () => {
    for (const c of defs) {
      expect(c.surge === null, `${c.id} both or neither`).toBe(c.overclock === null);
      if (c.surge && c.overclock) expect(c.overclock.stars, c.id).toBeGreaterThan(c.surge.stars);
    }
  });

  it('never repeats the engine\'s standard +10 firepower / +10 defense inside a power or a passive', () => {
    for (const c of defs) {
      const all = [...c.passive.modifiers, ...powersOf(c).flatMap((p) => p.modifiers)];
      expect(all.filter((m) => m.filter === undefined && m.firepower === 10 && m.defense === 10 && Object.keys(m).length === 2), c.id).toEqual([]);
    }
    // Daybreak lists "+10% firepower" and nothing about defense: the standard bonus is added by the engine on top.
    expect(COMMANDERS.rook.overclock?.modifiers).toEqual([{ firepower: 10 }]);
  });

  it('uses only vocabulary the contract defines (explicit allow-list)', () => {
    for (const c of defs) expect(vocabularyProblems(c), c.id).toEqual([]);
  });

  it('refuses planted vocabulary the contract does not define (known-bad input)', () => {
    const bad = (modifiers: unknown[], effects: unknown[] = []) => vocabularyProblems({
      ...COMMANDERS.rook,
      surge: { name: 's', stars: 1, quote: 'q', description: 'd', modifiers: modifiers as Modifier[], effects: effects as InstantEffect[] },
    });
    expect(bad([{ firepowr: 10 }])).toHaveLength(1);
    expect(bad([{ filter: { domain: ['air'] }, firepower: 10 }])).toHaveLength(1);
    expect(bad([{ filter: { domains: ['space'] }, firepower: 10 }])).toHaveLength(1);
    expect(bad([{ firepower: '10' }])).toHaveLength(1);
    expect(bad([{ ignoreMoveCost: ['lava'] }])).toHaveLength(1);
    expect(bad([], [{ kind: 'laser', hp: 3 }])).toHaveLength(1);
    expect(bad([], [{ kind: 'heal', hp: 2, healAll: true }])).toHaveLength(1);
    expect(bad([], [{ kind: 'weather', weather: 'hurricane', turns: 1 }])).toHaveLength(1);
    expect(bad([{ firepower: 10 }], [{ kind: 'heal', hp: 2 }])).toEqual([]);
  });
});

describe('text', () => {
  it('writes every bio as 2-4 sentences and gives every commander a voice guide, likes and dislikes', () => {
    for (const c of defs) {
      const n = sentenceCount(c.bio);
      expect(n >= 2 && n <= 4, `${c.id} bio has ${n} sentences`).toBe(true);
      expect(c.voice.trim().length, `${c.id} voice`).toBeGreaterThan(40);
      expect((c.likes ?? '').trim().length, `${c.id} likes`).toBeGreaterThan(0);
      expect((c.dislikes ?? '').trim().length, `${c.id} dislikes`).toBeGreaterThan(0);
    }
  });

  it('keeps every spoken line and power quote non-empty and at most 140 characters', () => {
    for (const c of defs) {
      for (const k of ['select', 'victory', 'defeat'] as const) expect(c.lines[k]?.trim().length, `${c.id}.${k}`).toBeGreaterThan(0);
      expect(c.lines.surge !== undefined, `${c.id} surge line iff surge`).toBe(c.surge !== null);
      expect(c.lines.overclock !== undefined, `${c.id} overclock line iff overclock`).toBe(c.overclock !== null);
      for (const line of spoken(c)) expect(line.length, `${c.id}: "${line}"`).toBeLessThanOrEqual(140);
    }
  });

  it('never uses "!" anywhere in ECHO\'s text', () => {
    expect(allText(COMMANDERS.echo).filter((t) => t.includes('!'))).toEqual([]);
    // ...and the rule is not vacuous: Juno, who "uses too many", does.
    expect(spoken(COMMANDERS.juno).filter((t) => t.includes('!')).length).toBeGreaterThanOrEqual(3);
  });

  it('contains no profanity beyond "hell" and no real-world nations, religions or politics', () => {
    for (const c of defs) for (const t of allText(c)) expect(bannedWordIn(t), `${c.id}: "${t}"`).toEqual([]);
    // Known-bad: the checker does catch them.
    expect(bannedWordIn('For God and Russia')).toEqual(['Russia', 'God']);
    expect(bannedWordIn('What the hell')).toEqual([]);
    expect(bannedWordIn('well damn')).toEqual(['damn']);
  });

});

// ================================================================ behaviour through the real engine

describe('passives, read through the engine', () => {
  // Probe units: 1 trooper (ground, direct), 2 arc (ground, indirect), 3 wasp (air), 4 picket (sea), 5 dreadnought (sea, indirect).
  const probe = (c: string): GameState => game(
    ['....~~~~', '....~~~~'],
    [
      { type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'arc', owner: 0, x: 1, y: 0 }, { type: 'wasp', owner: 0, x: 2, y: 0 },
      { type: 'picket', owner: 0, x: 4, y: 0 }, { type: 'dreadnought', owner: 0, x: 5, y: 0 }, decoy(0, 1),
    ],
    c,
  );
  // Firepower % per probe [trooper, arc, wasp, picket, dreadnought], read off the passive lines in STORY.md.
  const FIREPOWER: Record<string, number[]> = {
    rook: [0, 0, 0, 0, 0],
    ilse: [-10, 20, -10, -10, 20],        // indirect +20, direct -10
    sefa: [0, 0, -10, 10, 10],            // sea +10, air -10
    dax: [-10, -10, -10, -10, -10],       // all -10
    maru: [0, 0, 0, 0, 0],
    juno: [-10, -10, 0, 0, 0],            // ground -10
    corvin: [15, 15, 15, 15, 15],
    sable: [0, 0, 10, 0, 0],              // air +10
    cantor: [10, 10, 10, 10, 10],
    vesper: [10, 10, 10, 10, 10],
    echo: [0, 0, 0, 0, 0],
  };
  const DEFENSE: Record<string, number> = { corvin: 15, vesper: 10 };

  it('gives each commander exactly the passive firepower and defense STORY.md lists, per unit class', () => {
    for (const id of IDS) {
      const s = probe(id);
      const fp = [1, 2, 3, 4, 5].map((u) => firepowerBonus(s, byId(s, u)));
      expect(fp, `${id} firepower`).toEqual(FIREPOWER[id]);
      for (const u of [1, 2, 3, 4, 5]) expect(defenseBonus(s, byId(s, u)), `${id} defense`).toBe(DEFENSE[id] ?? 0);
    }
  });

  it('Sefa: a sea unit has +1 move, a ground and an air unit are unchanged', () => {
    const s = probe('sefa');
    const control = probe('rook');
    expect(effectiveMove(s, byId(s, 4))).toBe(UNIT_TYPES.picket.move + 1);
    expect(effectiveMove(control, byId(control, 4))).toBe(UNIT_TYPES.picket.move);
    expect(effectiveMove(s, byId(s, 1))).toBe(UNIT_TYPES.trooper.move);
    expect(effectiveMove(s, byId(s, 3))).toBe(UNIT_TYPES.wasp.move);
  });

  it('Corvin: every unit costs 20% more; Vesper 10% less; Juno air 20% less and ground unchanged; nobody else changes prices', () => {
    const pct = (id: string, domain: string) => (id === 'corvin' ? 20 : id === 'vesper' ? -10 : id === 'juno' && domain === 'air' ? -20 : 0);
    for (const id of IDS) {
      const s = game(['FAD.', '....'], [{ type: 'trooper', owner: 0, x: 3, y: 1 }, decoy(3, 0)], id, 'none', { owners: ['000.', '....'] });
      for (const x of [0, 1, 2]) {
        const options = buildOptions(s, { x, y: 0 });
        expect(options.length, `${id} builds at ${x}`).toBeGreaterThan(0);
        for (const o of options) {
          const t = UNIT_TYPES[o.type];
          expect(o.cost, `${id} ${o.type}`).toBe(Math.round((t.cost * (100 + pct(id, t.domain))) / 100));
        }
      }
    }
    const corvin = game(['F...'], [{ type: 'trooper', owner: 0, x: 3, y: 0 }, decoy(2, 0)], 'corvin', 'none', { owners: ['0...'] });
    expect(buildOptions(corvin, { x: 0, y: 0 }).find((o) => o.type === 'trooper')?.cost).toBe(1200); // 1000 + 20%
  });

  it('Dax: income is +15%', () => {
    const owners = ['00..', '....'];
    const units = [{ type: 'trooper' as const, owner: 0, x: 3, y: 1 }, decoy(3, 0)];
    const base = 2 * TERRAIN_TYPES.arcology.income!; // two arcologies
    const dax = game(['CC..', '....'], units, 'dax', 'none', { owners });
    const control = game(['CC..', '....'], units, 'rook', 'none', { owners });
    expect(incomeOf(dax, 0)).toBe(Math.floor((base * 115) / 100));
    expect(incomeOf(dax, 0)).toBe(2300);
    expect(dax.players[0].funds).toBe(2300);          // paid at the start of cycle 1
    expect(incomeOf(control, 0)).toBe(base);
  });

  it('Maru: a unit in canopy gets +1 defense star (never an air unit), and ground units cross canopy at cost 1', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'wasp', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 0, x: 2, y: 0 }, decoy(3, 1), { type: 'trooper', owner: 0, x: 3, y: 0 }];
    const s = game(['ff.^', '....'], units, 'maru');
    const control = game(['ff.^', '....'], units, 'rook');
    expect(terrainStarsFor(s, byId(s, 1))).toBe(TERRAIN_TYPES.canopy.def + 1);
    expect(terrainStarsFor(control, byId(control, 1))).toBe(TERRAIN_TYPES.canopy.def);
    expect(terrainStarsFor(s, byId(s, 3))).toBe(TERRAIN_TYPES.flats.def); // only canopy gets the star
    expect(terrainStarsFor(s, byId(s, 5))).toBe(TERRAIN_TYPES.ridge.def); // ...not a ridge
    expect(terrainStarsFor(s, byId(s, 2))).toBe(0);                       // air units never get stars
    expect([...ignoredMoveCosts(s, byId(s, 1))]).toEqual(['canopy']);     // ground units: canopy and nothing else
    expect([...ignoredMoveCosts(s, byId(s, 2))]).toEqual([]);             // air units: nothing
    expect([...ignoredMoveCosts(control, byId(control, 1))]).toEqual([]);

    // A hover Lancer (canopy costs 3) with 6 move: 2 tiles of canopy normally, 6 with Rootbound.
    const canopy = ['ffffffff', 'ffffffff'];
    const lancer: FixtureUnit[] = [{ type: 'lancer', owner: 0, x: 0, y: 0 }, decoy(7, 1)];
    const maru = game(canopy, lancer, 'maru');
    const plain = game(canopy, lancer, 'rook');
    const mv = UNIT_TYPES.lancer.move;
    const cost = TERRAIN_TYPES.canopy.cost.hover!;
    for (let x = 1; x < 8; x++) {
      expect(reachable(plain, 1).has(`${x},0`), `plain x=${x}`).toBe(x <= Math.floor(mv / cost));
      expect(reachable(maru, 1).has(`${x},0`), `maru x=${x}`).toBe(x <= mv);
    }
  });

  it('Sable: air units +10% firepower, and every unit sees 1 tile further (also under an ion storm)', () => {
    const s = probe('sable');
    const control = probe('rook');
    for (const id of [1, 2, 3, 4, 5]) {
      expect(effectiveVision(s, byId(s, id)), `unit ${id}`).toBe(effectiveVision(control, byId(control, id)) + 1);
    }
    expect(effectiveVision(s, byId(s, 1))).toBe(UNIT_TYPES.trooper.vision + 1);
    const storm = { ...s, weather: 'ionstorm' as const, weatherTurnsLeft: 1 };
    expect(effectiveVision(storm, byId(storm, 1))).toBe(UNIT_TYPES.trooper.vision); // ion storm -1, Ghost Wing +1
  });

  it('Rook: units repair 3 HP a turn on an owned property instead of 2, paying 10% of the price per HP', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0, hp: 5 }, decoy(3, 0)];
    const income = TERRAIN_TYPES.arcology.income!;
    const price = UNIT_TYPES.trooper.cost;
    const rook = game(['C...'], units, 'rook', 'none', { owners: ['0...'] });
    const plain = game(['C...'], units, 'none', 'none', { owners: ['0...'] });
    expect(hpOf(rook, 1)).toBe(5 + 3);
    expect(rook.players[0].funds).toBe(income - (3 * price) / 10);
    expect(hpOf(plain, 1)).toBe(5 + 2);
    expect(plain.players[0].funds).toBe(income - (2 * price) / 10);
  });

  it('Ilse: indirect fire does +20% damage and direct fire -10%, against the damage chart', () => {
    const units: FixtureUnit[] = [
      { type: 'arc', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 3, y: 2 },
      { type: 'trooper', owner: 1, x: 0, y: 2 }, { type: 'trooper', owner: 1, x: 3, y: 1 },
    ];
    const target = { stars: TERRAIN_TYPES.flats.def, dhp: 10 };
    const arcBase = DAMAGE.arc.primary!.trooper!;
    const trooperBase = DAMAGE.trooper.secondary!.trooper!;
    const dmg = (atk: number, base: number) => [0, 9].map((luck) => expectedDamage(base, atk, 100, 10, target.dhp, target.stars, luck));
    const ilse = game(['....', '....', '....'], units, 'ilse');
    const control = game(['....', '....', '....'], units, 'rook');
    expect(forecast(ilse, 1, { x: 0, y: 0 }, { x: 0, y: 2 }).damage).toEqual(dmg(120, arcBase));
    expect(forecast(control, 1, { x: 0, y: 0 }, { x: 0, y: 2 }).damage).toEqual(dmg(100, arcBase));
    expect(forecast(ilse, 2, { x: 3, y: 2 }, { x: 3, y: 1 }).damage).toEqual(dmg(90, trooperBase));
    expect(forecast(control, 2, { x: 3, y: 2 }, { x: 3, y: 1 }).damage).toEqual(dmg(100, trooperBase));
  });

  it('Cantor: the power meter charges 20% faster', () => {
    const gain = (c: string) => {
      const ctx = draft(game(FLATS, [{ type: 'trooper', owner: 0, x: 0, y: 0 }, decoy(7, 3)], c));
      gainPower(ctx, 0, 1000);
      return ctx.s.players[0].power;
    };
    expect(gain('cantor')).toBe(1200);
    expect(gain('rook')).toBe(1000);
  });

  it('gives ECHO nothing: no modifiers and no power at any meter level', () => {
    const s = patchPlayer(probe('echo'), 0, { power: 99 * POWER_STAR });
    expect([1, 2, 3, 4, 5].map((u) => firepowerBonus(s, byId(s, u)))).toEqual([0, 0, 0, 0, 0]);
    expect(canActivatePower(s, 'surge')).toBe(false);
    expect(canActivatePower(s, 'overclock')).toBe(false);
  });
});

describe('powers, activated through the engine', () => {
  it('charges every power exactly its star cost, and refuses one point short (all commanders, both levels)', () => {
    for (const c of defs) {
      for (const level of ['surge', 'overclock'] as const) {
        const def = c[level];
        const s = game(FLATS, [{ type: 'trooper', owner: 0, x: 0, y: 0 }, decoy(7, 3)], c.id);
        if (!def) {
          expect(powerCost(s, 0, level), `${c.id} ${level}`).toBe(Infinity);
          continue;
        }
        expect(powerCost(s, 0, level), `${c.id} ${level}`).toBe(def.stars * POWER_STAR);
        expect(canActivatePower(patchPlayer(s, 0, { power: def.stars * POWER_STAR - 1 }), level), `${c.id} ${level} short`).toBe(false);
        const full = patchPlayer(s, 0, { power: def.stars * POWER_STAR });
        expect(canActivatePower(full, level), `${c.id} ${level} full`).toBe(true);
        const r = applyAction(full, { kind: 'power', level });
        expect(r.state.players[0].powerState, `${c.id} ${level}`).toBe(level);
        expect(r.events.some((e) => e.kind === 'powerActivated' && e.level === level && e.commander === c.id), `${c.id} ${level} event`).toBe(true);
      }
    }
  });

  it('adds the standard +10/+10 on top of each power\'s own numbers, never twice', () => {
    const fp = (c: string, level: 'surge' | 'overclock', unit: UnitTypeId) => {
      const s = activate(game(['....~~', '....~~'], [{ type: unit, owner: 0, x: unit === 'picket' ? 4 : 0, y: 0 }, { type: 'wasp', owner: 0, x: 1, y: 0 }, decoy(0, 1)], c), level);
      const u = s.units.find((x) => x.type === unit && x.owner === 0)!;
      return [firepowerBonus(s, u), defenseBonus(s, u)];
    };
    expect(fp('rook', 'overclock', 'trooper')).toEqual([10 + 10, 10]);        // Daybreak +10, standard +10/+10
    expect(fp('rook', 'surge', 'trooper')).toEqual([10, 10]);                  // standard only
    expect(fp('corvin', 'surge', 'trooper')).toEqual([15 + 10 + 10, 15 + 10]); // passive + Ascent + standard
    expect(fp('corvin', 'overclock', 'trooper')).toEqual([15 + 20 + 10, 15 + 10]);
    expect(fp('sefa', 'surge', 'picket')).toEqual([10 + 20 + 10, 10]);        // Undertow + Riptide + standard
    expect(fp('sefa', 'overclock', 'trooper')).toEqual([10, 30 + 10]);        // Breakwater +30 defense
    expect(fp('juno', 'overclock', 'wasp')).toEqual([25 + 10, 10]);
    expect(fp('juno', 'surge', 'trooper')).toEqual([-10 + 10, 10]);            // Swarm Logic -10 cancelled by the standard +10
    expect(fp('sable', 'overclock', 'wasp')).toEqual([10 + 20 + 10, 10]);
    expect(fp('cantor', 'surge', 'trooper')).toEqual([10 + 10 + 10, 10]);
    expect(fp('maru', 'overclock', 'trooper')).toEqual([10, 20 + 10]);        // Mycelium +20 defense
  });

  it('Rook, Jury-Rig: all units +2 HP (capped at 10) and fully resupplied', () => {
    const base = game(FLATS, [
      { type: 'trooper', owner: 0, x: 0, y: 0, hp: 5 }, { type: 'breacher', owner: 0, x: 1, y: 0, hp: 9 }, decoy(7, 3),
    ], 'rook');
    const s = patchUnit(patchUnit(base, 2, { ammo: 0, charge: 10 }), 1, { charge: 5 });
    const after = activate(s, 'surge');
    expect([hpOf(after, 1), hpOf(after, 2)]).toEqual([7, 10]);
    expect(byId(after, 2).ammo).toBe(UNIT_TYPES.breacher.ammo);
    expect(byId(after, 2).charge).toBe(UNIT_TYPES.breacher.charge);
    expect(byId(after, 1).charge).toBe(UNIT_TYPES.trooper.charge);
    expect(hpOf(after, 3)).toBe(10); // the enemy is untouched
  });

  it('Rook, Daybreak: all units +4 HP and fully resupplied', () => {
    const s = patchUnit(game(FLATS, [{ type: 'trooper', owner: 0, x: 0, y: 0, hp: 5 }, { type: 'breacher', owner: 0, x: 1, y: 0, hp: 8 }, decoy(7, 3, 'trooper')], 'rook'), 2, { ammo: 1 });
    const after = activate(s, 'overclock');
    expect([hpOf(after, 1), hpOf(after, 2)]).toEqual([9, 10]);
    expect(byId(after, 2).ammo).toBe(UNIT_TYPES.breacher.ammo);
  });

  it('Ilse, Walking Barrage: indirect units gain +1 range and may move and fire (and not a tile further)', () => {
    const s = game(FLATS, [{ type: 'arc', owner: 0, x: 0, y: 0 }, decoy(4, 0), decoy(5, 0)], 'ilse');
    const at = (x: number) => ({ kind: 'attack' as const, target: { x, y: 0 } });
    const fireInPlace = (x: number): Action => ({ kind: 'move', unitId: 1, path: [{ x: 0, y: 0 }], then: at(x) });
    const moveAndFire: Action = { kind: 'move', unitId: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], then: at(4) };
    // An Arc has range 2-3 and, like every indirect unit, cannot move and fire.
    expect(isLegal(s, fireInPlace(4))).toBe(false); // distance 4
    expect(isLegal(s, moveAndFire)).toBe(false);    // from (1,0) the target is in range, but it moved
    const surge = activate(s, 'surge');
    expect(isLegal(surge, fireInPlace(4))).toBe(true);   // range 2-4
    expect(isLegal(surge, moveAndFire)).toBe(true);
    expect(isLegal(surge, fireInPlace(5))).toBe(false);  // +1 only, not +2
    expect(applyAction(surge, moveAndFire).events.some((e) => e.kind === 'attacked' && e.defenderId === 2)).toBe(true);
  });

  it('Ilse, Sunfall: 4 HP to the most valuable enemy cluster (radius 2), and indirect units gain +2 range', () => {
    const units: FixtureUnit[] = [
      { type: 'arc', owner: 0, x: 0, y: 0 },
      decoy(7, 0, 'bastion'), decoy(7, 2),            // bastion (16000) and a trooper two tiles away: the most VALUABLE cluster
      decoy(0, 3), decoy(1, 3), decoy(2, 3),          // three cheap troopers: the cluster with the most UNITS
    ];
    const after = activate(game(FLATS, units, 'ilse'), 'overclock');
    expect([hpOf(after, 2), hpOf(after, 3)]).toEqual([10 - 4, 10 - 4]);
    expect([4, 5, 6].map((id) => hpOf(after, id))).toEqual([10, 10, 10]);
    expect(after.players[0].powerState).toBe('overclock');
    // +2 range: the Arc (range 2-3) reaches 5 tiles; a target at distance 5 is legal now and was not before.
    const fire: Action = { kind: 'move', unitId: 1, path: [{ x: 0, y: 0 }], then: { kind: 'attack', target: { x: 5, y: 0 } } };
    const s2 = game(FLATS, [{ type: 'arc', owner: 0, x: 0, y: 0 }, decoy(5, 0)], 'ilse');
    expect(isLegal(s2, fire)).toBe(false);
    expect(isLegal(activate(s2, 'overclock'), fire)).toBe(true);
  });

  it('Corvin, Ascent: ground units +1 move (air unchanged); Heaven\'s Tether strikes 5 HP, radius 1, at the most valuable cluster', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'wasp', owner: 0, x: 1, y: 0 }, decoy(7, 3)];
    const s = activate(game(FLATS, units, 'corvin'), 'surge');
    expect(effectiveMove(s, byId(s, 1))).toBe(UNIT_TYPES.trooper.move + 1);
    expect(effectiveMove(s, byId(s, 2))).toBe(UNIT_TYPES.wasp.move);

    const strike = activate(game(FLATS, [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      decoy(6, 0, 'bastion'), decoy(7, 0), decoy(5, 2), // bastion, a trooper beside it (distance 1), a trooper 3 tiles from the bastion
      decoy(0, 3), decoy(1, 3), decoy(2, 3),            // three cheap troopers: the cluster with the most units
    ], 'corvin'), 'overclock');
    expect([hpOf(strike, 2), hpOf(strike, 3)]).toEqual([10 - 5, 10 - 5]);
    expect([4, 5, 6, 7].map((id) => hpOf(strike, id))).toEqual([10, 10, 10, 10]);
  });

  it('Sefa, Riptide and Breakwater: enemy units lose 1 move on their next turn only', () => {
    for (const level of ['surge', 'overclock'] as const) {
      const s = activate(game(FLATS, [{ type: 'trooper', owner: 0, x: 0, y: 0 }, decoy(7, 3), decoy(7, 2, 'bastion')], 'sefa'), level);
      expect(effectiveMove(s, byId(s, 2)), level).toBe(UNIT_TYPES.trooper.move - 1);
      expect(effectiveMove(s, byId(s, 3)), level).toBe(UNIT_TYPES.bastion.move - 1);
      const theirTurn = endTurns(s, 1);
      expect(theirTurn.current).toBe(1);
      expect(effectiveMove(theirTurn, byId(theirTurn, 2)), `${level} during their turn`).toBe(UNIT_TYPES.trooper.move - 1);
      const after = endTurns(theirTurn, 1);
      expect(effectiveMove(after, byId(after, 2)), `${level} after`).toBe(UNIT_TYPES.trooper.move);
      expect(effectiveMove(s, byId(s, 1))).toBe(UNIT_TYPES.trooper.move); // Sefa's own units are not slowed
    }
  });

  it('Dax, Audit: every enemy loses 50% of their meter and fog lifts for one turn', () => {
    const s = patchPlayer(game(FLATS, [{ type: 'trooper', owner: 0, x: 0, y: 0 }, decoy(7, 3)], 'dax', 'rook'), 1, { power: 12000 });
    const after = activate(s, 'surge');
    expect(after.players[1].power).toBe(6000);
    expect(after.players[0].revealTurns).toBe(1);
    expect(endTurns(after, 2).players[0].revealTurns).toBeUndefined(); // gone when Dax's next turn begins
  });

  it('Dax, Foreclosure: enemies lose 30% of their funds, Dax gains half a turn\'s income, fog lifts', () => {
    const owners = ['00..', '....'];
    const base = game(['CC..', '....'], [{ type: 'trooper', owner: 0, x: 3, y: 1 }, decoy(3, 0)], 'dax', 'rook', { owners });
    const s = patchPlayer(patchPlayer(base, 1, { funds: 5000 }), 0, { funds: 1000 });
    const income = Math.floor((2 * TERRAIN_TYPES.arcology.income! * 115) / 100); // 2300 with Ledger
    const after = activate(s, 'overclock');
    expect(after.players[1].funds).toBe(5000 - 1500);
    expect(after.players[0].funds).toBe(1000 + income / 2);
    expect(after.players[0].revealTurns).toBe(1);
  });

  it('Maru, Overgrowth: flats next to canopy become canopy for 2 turns, then revert', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 3, y: 1 }, decoy(3, 0)];
    const terrainOf = (st: GameState, x: number, y: number): TerrainId => st.tiles[y][x].terrain;
    const s = activate(game(['f...', '....'], units, 'maru'), 'surge');
    expect(terrainOf(s, 1, 0)).toBe('canopy');   // next to the canopy at (0,0)
    expect(terrainOf(s, 0, 1)).toBe('canopy');
    expect(terrainOf(s, 2, 0)).toBe('flats');    // two tiles away: not adjacent to the original canopy
    expect(terrainOf(s, 1, 1)).toBe('flats');    // only diagonal
    expect(terrainOf(endTurns(s, 2), 1, 0)).toBe('canopy'); // Maru's next turn: one turn left
    expect(terrainOf(endTurns(s, 4), 1, 0)).toBe('flats');  // and gone after the second
    expect(terrainOf(endTurns(s, 4), 0, 1)).toBe('flats');
  });

  it('Maru, Mycelium: Overgrowth plus +3 HP and +20% defense', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 3, y: 1, hp: 5 }, decoy(3, 0)];
    const s = activate(game(['f...', '....'], units, 'maru'), 'overclock');
    expect(s.tiles[0][1].terrain).toBe('canopy');
    expect(hpOf(s, 1)).toBe(8);
    expect(defenseBonus(s, byId(s, 1))).toBe(20 + 10);
    expect(endTurns(s, 4).tiles[0][1].terrain).toBe('flats');
  });

  it('Juno, Pollinate and Hivemind: air units +2 move; Hivemind refreshes the 3 most expensive acted air units', () => {
    const units: FixtureUnit[] = [
      { type: 'wasp', owner: 0, x: 0, y: 0 }, { type: 'raptor', owner: 0, x: 1, y: 0 }, { type: 'anvil', owner: 0, x: 2, y: 0 },
      { type: 'wasp', owner: 0, x: 3, y: 0 }, { type: 'trooper', owner: 0, x: 0, y: 1 }, decoy(7, 3),
    ];
    const pollinate = activate(game(FLATS, units, 'juno'), 'surge');
    expect(effectiveMove(pollinate, byId(pollinate, 1))).toBe(UNIT_TYPES.wasp.move + 2);
    expect(effectiveMove(pollinate, byId(pollinate, 5))).toBe(UNIT_TYPES.trooper.move);

    let s = game(FLATS, units, 'juno');
    for (let id = 1; id <= 5; id++) s = patchUnit(s, id, { acted: true });
    const air = s.units.filter((u) => UNIT_TYPES[u.type].domain === 'air')
      .sort((a, b) => UNIT_TYPES[b.type].cost - UNIT_TYPES[a.type].cost || a.id - b.id);
    const refreshed = air.slice(0, 3).map((u) => u.id).sort((a, b) => a - b);
    const after = activate(s, 'overclock');
    expect(effectiveMove(after, byId(after, 1))).toBe(UNIT_TYPES.wasp.move + 2);
    expect(after.units.filter((u) => u.owner === 0 && !u.acted).map((u) => u.id).sort((a, b) => a - b)).toEqual(refreshed);
    expect(refreshed).toEqual([1, 2, 3]);
    expect(byId(after, 4).acted).toBe(true);  // the fourth air unit and the trooper stay greyed out
    expect(byId(after, 5).acted).toBe(true);

    // With fewer than 3 acted air units, a spare slot is never spent on a ground unit.
    let few = game(FLATS, [{ type: 'wasp', owner: 0, x: 0, y: 0 }, { type: 'wasp', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 0, x: 0, y: 1 }, decoy(7, 3)], 'juno');
    for (const id of [1, 2, 3]) few = patchUnit(few, id, { acted: true });
    const fewAfter = activate(few, 'overclock');
    expect([1, 2, 3].map((id) => byId(fewAfter, id).acted)).toEqual([false, false, true]);
  });

  it('Sable, Blackout and Eclipse: an ion storm for 1 and 2 turns', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0 }, decoy(7, 3)];
    const blackout = activate(game(FLATS, units, 'sable'), 'surge');
    expect([blackout.weather, blackout.weatherTurnsLeft]).toEqual(['ionstorm', 1]);
    expect(endTurns(blackout, 1).weather).toBe('ionstorm');   // still raging through the enemy's turn
    expect(endTurns(blackout, 2).weather).toBe('clear');      // gone when Sable's turn begins

    const eclipse = activate(game(FLATS, units, 'sable'), 'overclock');
    expect([eclipse.weather, eclipse.weatherTurnsLeft]).toEqual(['ionstorm', 2]);
    expect(endTurns(eclipse, 2).weather).toBe('ionstorm');
    expect(endTurns(eclipse, 4).weather).toBe('clear');
    expect(firepowerBonus(eclipse, byId(eclipse, 1))).toBe(20 + 10);
  });

  it('Cantor, Chorus and Requiem: enemies lose 1 / 2 HP (never below 1); Requiem also drains half their meter', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0 }, decoy(7, 3), { type: 'trooper', owner: 1, x: 7, y: 2, hp: 1 }, { type: 'bastion', owner: 1, x: 6, y: 3, hp: 6 }];
    const s = patchPlayer(game(FLATS, units, 'cantor', 'rook'), 1, { power: 8000 });
    const chorus = activate(s, 'surge');
    expect([hpOf(chorus, 2), hpOf(chorus, 3), hpOf(chorus, 4)]).toEqual([9, 1, 5]);
    expect(chorus.players[1].power).toBe(8000);
    expect(hpOf(chorus, 1)).toBe(10); // Cantor's own unit is untouched
    const requiem = activate(s, 'overclock');
    expect([hpOf(requiem, 2), hpOf(requiem, 3), hpOf(requiem, 4)]).toEqual([8, 1, 4]);
    expect(requiem.players[1].power).toBe(4000);
  });

  it('VESPER, Mirror: every enemy loses their whole meter and fog lifts', () => {
    const s = patchPlayer(game(FLATS, [{ type: 'trooper', owner: 0, x: 0, y: 0 }, decoy(7, 3)], 'vesper', 'rook'), 1, { power: 17000 });
    const after = activate(s, 'surge');
    expect(after.players[1].power).toBe(0);
    expect(after.players[0].revealTurns).toBe(1);
  });

  it('VESPER, Silence: enemies lose 3 HP and 2 move, and an ion storm falls', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0 }, decoy(7, 3, 'bastion'), { type: 'trooper', owner: 1, x: 7, y: 2, hp: 2 }];
    const after = activate(game(FLATS, units, 'vesper'), 'overclock');
    expect(hpOf(after, 2)).toBe(7);
    expect(hpOf(after, 3)).toBe(1);
    expect(effectiveMove(after, byId(after, 2))).toBe(UNIT_TYPES.bastion.move - 2);
    expect(after.weather).toBe('ionstorm');
    expect(hpOf(after, 1)).toBe(10);
  });
});
