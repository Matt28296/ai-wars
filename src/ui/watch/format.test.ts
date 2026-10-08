// Sentence formatting of every event kind, with literal expected sentences, plus the log a real fogged match produces.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import type { GameEvent } from '../../game/aw';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import { article, buildLog, formatEvent, makeFormatContext, powerNameOf } from './format';
import type { FormatContext } from './format';
import { recordMatch, viewTimeline } from './timeline';
import { endTurn, fieldSetup, pt, walk } from './testing';

const UNITS: Record<number, string> = { 1: 'Helion Lancer', 2: 'Tidewell Trooper', 3: 'Helion Mule', 4: 'Tidewell Barge' };
const ctx: FormatContext = {
  unitName: (id) => UNITS[id],
  playerName: (p) => ['Helion', 'Tidewell'][p] ?? `Player ${p + 1}`,
  commanderOf: (p) => ['rook', 'sefa'][p],
  terrainName: () => 'Arcology',
  teamName: (t) => ['Helion', 'Tidewell'][t] ?? `Team ${t + 1}`,
};
const say = (e: GameEvent): string => formatEvent(e, ctx).text;

// One sample of EVERY event kind. The mapped type makes this a compile error the day the engine gains a kind with no sample here.
const SAMPLES: { [K in GameEvent['kind']]: Extract<GameEvent, { kind: K }> } = {
  moved: { kind: 'moved', unitId: 1, path: [pt(2), pt(3), pt(4), pt(5)] },
  ambushed: { kind: 'ambushed', unitId: 1, at: pt(4), by: 2 },
  dropBlocked: { kind: 'dropBlocked', transportId: 3, cargoId: 1, at: pt(6), by: 2 },
  attacked: { kind: 'attacked', attackerId: 1, defenderId: 2, damage: 42, counter: 0, attackerHp: 100, defenderHp: 58 },
  destroyed: { kind: 'destroyed', unitId: 2, at: pt(6), type: 'trooper', owner: 1 },
  captureProgress: { kind: 'captureProgress', unitId: 1, at: pt(3), remaining: 10 },
  captured: { kind: 'captured', at: pt(3), terrain: 'arcology', by: 0, from: 1 },
  loaded: { kind: 'loaded', unitId: 1, transportId: 3 },
  unloaded: { kind: 'unloaded', unitId: 1, transportId: 3, to: pt(5) },
  joined: { kind: 'joined', unitId: 1, intoId: 3, refund: 1400 },
  supplied: { kind: 'supplied', byId: 3, unitIds: [1, 2] },
  built: { kind: 'built', unitId: 9, type: 'lancer', at: pt(2), owner: 0, cost: 7000 },
  powerActivated: { kind: 'powerActivated', player: 0, level: 'surge', commander: 'rook' },
  powerEffect: { kind: 'powerEffect', player: 0, description: '+2 HP and full resupply', affected: [pt(2)] },
  turnEnded: { kind: 'turnEnded', player: 0 },
  turnStarted: { kind: 'turnStarted', player: 1, cycle: 3, income: 4000 },
  repaired: { kind: 'repaired', unitId: 1, amount: 20, cost: 1400 },
  crashed: { kind: 'crashed', unitId: 1, at: pt(2) },
  weather: { kind: 'weather', weather: 'ionstorm', turns: 2 },
  playerDefeated: { kind: 'playerDefeated', player: 1, reason: 'rout' },
  victory: { kind: 'victory', team: 0 },
};

describe('formatEvent: one plain sentence per event kind', () => {
  const EXPECTED: Record<GameEvent['kind'], string> = {
    moved: 'Helion Lancer moves 3 tiles',
    ambushed: 'Helion Lancer is ambushed by Tidewell Trooper and stops',
    dropBlocked: 'Helion Mule cannot unload Helion Lancer: Tidewell Trooper blocks the drop',
    attacked: 'Helion Lancer hits Tidewell Trooper: 42%',
    destroyed: 'Tidewell Trooper is destroyed',
    captureProgress: 'Helion Lancer captures Arcology: 10 of 20 left',
    captured: 'Helion takes the Arcology from Tidewell',
    loaded: 'Helion Lancer boards Helion Mule',
    unloaded: 'Helion Lancer unloads from Helion Mule',
    joined: 'Helion Lancer joins Helion Mule, refund 1,400 CR',
    supplied: 'Helion Mule resupplies 2 units',
    built: 'Helion builds a Lancer: 7,000 CR',
    powerActivated: `${COMMANDERS.rook.name} activates ${COMMANDERS.rook.surge!.name} (Surge)`,
    powerEffect: '+2 HP and full resupply',
    turnEnded: 'Helion ends the turn',
    turnStarted: 'Cycle 03: Tidewell turn, income 4,000 CR',
    repaired: 'Helion Lancer repairs 2 HP for 1,400 CR',
    crashed: 'Helion Lancer is lost: out of charge',
    weather: 'An ion storm rises for 2 turns',
    playerDefeated: 'Tidewell is defeated: routed',
    victory: 'Victory: Helion',
  };

  it('reads each kind as its literal sentence', () => {
    for (const kind of Object.keys(SAMPLES) as GameEvent['kind'][]) {
      expect(say(SAMPLES[kind]), kind).toBe(EXPECTED[kind]);
    }
  });

  it('covers every kind the engine has (the sample table is complete and nothing falls to the fallback)', () => {
    const kinds = Object.keys(SAMPLES);
    expect(kinds).toHaveLength(21);
    for (const kind of kinds) expect(formatEvent(SAMPLES[kind as GameEvent['kind']], ctx).text).not.toBe('Something happens');
  });

  it('reads the order\'s own example: "Helion Lancer hits Tidewell Trooper: 42%"', () => {
    expect(say(SAMPLES.attacked)).toBe('Helion Lancer hits Tidewell Trooper: 42%');
  });

  it('tells a counter, a counter-first strike, and a shot from a unit the viewer was never shown', () => {
    const base = SAMPLES.attacked;
    expect(say({ ...base, counter: 18 })).toBe('Helion Lancer hits Tidewell Trooper: 42%, counter 18%');
    expect(say({ ...base, counter: 18, counterFirst: true })).toBe('Helion Lancer hits Tidewell Trooper: 42% (struck first, counter 18%)');
    expect(say({ ...base, attackerId: UNSEEN_UNIT, attackerHp: UNSEEN_UNIT })).toBe('An unseen unit hits Tidewell Trooper: 42%');
  });

  it('names a unit it was never told about as unseen rather than inventing one (known-bad input)', () => {
    expect(say({ ...SAMPLES.attacked, attackerId: 77 })).toBe('An unseen unit hits Tidewell Trooper: 42%');
    expect(say({ ...SAMPLES.moved, unitId: 77 })).toBe('An unseen unit moves 3 tiles');
  });

  it('says the right thing at the edges: one tile, no move, a neutral property, a clear sky, other defeat reasons', () => {
    expect(say({ ...SAMPLES.moved, path: [pt(2), pt(3)] })).toBe('Helion Lancer moves 1 tile');
    expect(say({ ...SAMPLES.moved, path: [pt(2)] })).toBe('Helion Lancer holds position');
    expect(say({ ...SAMPLES.captured, from: null })).toBe('Helion claims the unowned Arcology');
    expect(say({ ...SAMPLES.weather, weather: 'clear', turns: 0 })).toBe('The weather clears');
    expect(say({ ...SAMPLES.playerDefeated, reason: 'hq' })).toBe('Tidewell is defeated: Command Spire captured');
    expect(say({ ...SAMPLES.supplied, unitIds: [1] })).toBe('Helion Mule resupplies 1 unit');
    expect(say({ ...SAMPLES.powerActivated, level: 'overclock' })).toBe(`${COMMANDERS.rook.name} activates ${COMMANDERS.rook.overclock!.name} (Overclock)`);
  });

  it('fails soft on a kind it has never heard of, instead of throwing (known-bad input)', () => {
    const line = formatEvent({ kind: 'bogus' } as unknown as GameEvent, ctx, 5);
    expect(line).toEqual({ step: 5, text: 'Something happens', tone: 'quiet' });
  });

  it('tags each line with a tone, so the log can quieten routine moves', () => {
    expect(formatEvent(SAMPLES.moved, ctx).tone).toBe('quiet');
    expect(formatEvent(SAMPLES.attacked, ctx).tone).toBe('combat');
    expect(formatEvent(SAMPLES.powerActivated, ctx).tone).toBe('power');
    expect(formatEvent(SAMPLES.built, ctx).tone).toBe('economy');
    expect(formatEvent(SAMPLES.crashed, ctx).tone).toBe('alert');
  });
});

describe('powerNameOf', () => {
  it('reads the commander table, and falls back to the level word for a commander it does not have', () => {
    expect(powerNameOf('sefa', 'overclock')).toBe(COMMANDERS.sefa.overclock!.name);
    expect(powerNameOf('nobody', 'surge')).toBe('Surge');
    expect(powerNameOf('__proto__', 'overclock')).toBe('Overclock'); // a prototype key is not a commander
  });
});

// A hidden Tidewell Arc Battery (indirect, range 2-3) fires from x=6 at a Helion trooper at x=3, whose vision reaches x=5. A Tidewell
// skimmer at x=8 (vision 5) is the spotter that lets the arc see its target; it is out of Helion's sight too.
describe('the log a fogged match produces', () => {
  const setup = fieldSetup(
    [{ type: 'trooper', owner: 0, x: 3, y: 1 }, { type: 'arc', owner: 1, x: 6, y: 1 }, { type: 'skimmer', owner: 1, x: 8, y: 1 }],
    { fog: true },
  );
  const actions = [endTurn, walk(2, [6], { kind: 'attack', target: pt(3) })];
  const rec = recordMatch(setup, actions);
  const shot = rec.rawEvents[1].find((e): e is Extract<GameEvent, { kind: 'attacked' }> => e.kind === 'attacked');

  it('has a real shot to talk about (the engine\'s own event)', () => {
    expect(shot).toBeDefined();
    expect(shot!.damage).toBeGreaterThan(0);
  });

  it('tells the shot as "An unseen unit hits ..." to the player it hit, with the damage the engine reported', () => {
    const lines = buildLog(viewTimeline(rec, 0).steps).filter((l) => l.tone === 'combat');
    const dmg = shot!.damage;
    expect(lines.map((l) => l.text)).toEqual([`An unseen unit hits Helion Trooper: ${dmg}%`]);
    expect(lines[0].step).toBe(2);
  });

  it('names the shooter to the omniscient viewer and to the side that fired (known-bad: the hidden viewer must not get these)', () => {
    const dmg = shot!.damage;
    const sentence = `Tidewell Arc Battery hits Helion Trooper: ${dmg}%`;
    for (const viewer of ['all', 1] as const) {
      const text = buildLog(viewTimeline(rec, viewer).steps).map((l) => l.text);
      expect(text, String(viewer)).toContain(sentence);
    }
    const hidden = buildLog(viewTimeline(rec, 0).steps).map((l) => l.text);
    expect(hidden.some((t) => t.includes('Arc Battery'))).toBe(false);
  });

  it('does not log a move the viewer could not see', () => {
    const scouts = recordMatch(fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true }), [walk(1, [0, 1, 2, 3]), endTurn, walk(2, [9, 8, 7, 6])]);
    const seen = buildLog(viewTimeline(scouts, 0).steps).map((l) => l.text);
    const omniscient = buildLog(viewTimeline(scouts, 'all').steps).map((l) => l.text);
    expect(omniscient).toContain('Tidewell Trooper moves 3 tiles');
    expect(seen).not.toContain('Tidewell Trooper moves 3 tiles');
    expect(seen.some((t) => t.startsWith('Tidewell Trooper moves'))).toBe(false);
  });

  it('makeFormatContext names units from the frames it is given and from built/destroyed events', () => {
    const tl = viewTimeline(rec, 1);
    const c = makeFormatContext(tl.steps[1].frame, tl.steps[2].frame, tl.steps[2].events);
    expect(c.unitName(1)).toBe('Helion Trooper');
    expect(c.unitName(2)).toBe('Tidewell Arc Battery');
    expect(c.unitName(99)).toBeUndefined();
    expect(c.playerName(1)).toBe('Tidewell');
    expect(c.terrainName(pt(3))).toBe('Flats');
    expect(c.teamName(0)).toBe('Helion');
  });
});

describe('articles', () => {
  it('uses "an" before a vowel and "a" before a consonant', () => {
    expect(article('Arc Battery')).toBe('an');
    expect(article('Lancer')).toBe('a');
    expect(article('Obsidian Drone')).toBe('an');
  });
});
