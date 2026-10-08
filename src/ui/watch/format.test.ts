// Sentence formatting of every event kind, with literal expected sentences, plus the log a real fogged match produces.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import type { GameEvent } from '../../game/aw';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import { buildDemoMatch } from './demo';
import { EventLog } from './EventLog';
import {
  FOLLOW_SLACK_PX, LOG_ICONS, article, atBottom, buildLog, followAfterScroll, formatEvent, groupLog, logIconOf, logOpacity, makeFormatContext, powerNameOf, stripeCue,
} from './format';
import type { FormatContext, LogIcon, LogLine } from './format';
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
    expect(line).toEqual({ step: 5, text: 'Something happens', tone: 'quiet', kind: 'unknown', icon: 'info', faction: null });
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

// ---------------------------------------------------------------- the log's icons, stripes, fade and follow

// Written out by hand, one per kind, so that moving a kind to another icon in the table is a test failure and not a silent edit.
const ICON_BY_KIND: Record<GameEvent['kind'], LogIcon> = {
  moved: 'move', ambushed: 'alert', dropBlocked: 'alert', attacked: 'attack', destroyed: 'destroyed', captureProgress: 'capture',
  captured: 'capture', loaded: 'cargo', unloaded: 'cargo', joined: 'repair', supplied: 'repair', built: 'build', powerActivated: 'power',
  powerEffect: 'power', turnEnded: 'turn', turnStarted: 'turn', repaired: 'repair', crashed: 'destroyed', weather: 'weather',
  playerDefeated: 'destroyed', victory: 'victory',
};

describe('log icons by kind of event', () => {
  it('gives every event kind its icon, and carries it on the line formatEvent returns', () => {
    for (const kind of Object.keys(SAMPLES) as GameEvent['kind'][]) {
      expect(logIconOf(kind), kind).toBe(ICON_BY_KIND[kind]);
      expect(LOG_ICONS[kind], kind).toBe(ICON_BY_KIND[kind]);
      const line = formatEvent(SAMPLES[kind], ctx);
      expect(line.icon, kind).toBe(ICON_BY_KIND[kind]);
      expect(line.kind).toBe(kind);
    }
  });

  it('has the seven kinds the order names, each told apart from the others', () => {
    const seven: [GameEvent['kind'], LogIcon][] = [
      ['attacked', 'attack'], ['destroyed', 'destroyed'], ['captured', 'capture'], ['built', 'build'],
      ['powerActivated', 'power'], ['repaired', 'repair'], ['turnStarted', 'turn'],
    ];
    for (const [kind, icon] of seven) expect(logIconOf(kind)).toBe(icon);
    expect(new Set(seven.map(([, i]) => i)).size).toBe(7);
    // known-bad: an attack must not read as a destruction or a capture
    expect(logIconOf('attacked')).not.toBe(logIconOf('destroyed'));
    expect(logIconOf('attacked')).not.toBe(logIconOf('captured'));
  });

  it('gives a kind it has never heard of, or a prototype key, the plain dot (known-bad input)', () => {
    for (const bad of ['bogus', '', '__proto__', 'toString', 'constructor', 'hasOwnProperty']) expect(logIconOf(bad), bad).toBe('info');
  });
});

describe('the faction stripe and the sentence\'s side', () => {
  const rec = recordMatch(
    fieldSetup([{ type: 'trooper', owner: 0, x: 3, y: 1 }, { type: 'arc', owner: 1, x: 6, y: 1 }, { type: 'skimmer', owner: 1, x: 8, y: 1 }], { fog: true }),
    [endTurn, walk(2, [6], { kind: 'attack', target: pt(3) })],
  );
  const shot = (viewer: 0 | 1 | 'all'): LogLine => buildLog(viewTimeline(rec, viewer).steps).find((l) => l.kind === 'attacked')!;

  it('stripes a line with the side of its subject: the Tidewell arc\'s shot is Tidewell, to the side that sees who fired', () => {
    for (const viewer of ['all', 1] as const) expect(shot(viewer), String(viewer)).toMatchObject({ faction: 'tidewell', icon: 'attack', tone: 'combat' });
  });

  it('gives NO stripe to a shot from a unit the viewer was never shown (known-bad: it must not say tidewell)', () => {
    const hidden = shot(0);
    expect(hidden.text).toMatch(/^An unseen unit hits/);
    expect(hidden.faction).toBeNull();
    expect(stripeCue(hidden)).toBe('none');
  });

  it('pairs the stripe with the faction name in the sentence, or with a sigil when the sentence has none', () => {
    const demo = buildDemoMatch();
    const log = buildLog(viewTimeline(recordMatch(demo.setup, demo.actions), 'all').steps);
    const power = log.find((l) => l.kind === 'powerActivated')!;
    expect(power.faction).not.toBeNull();
    expect(power.text.includes('Helion') || power.text.includes('Tidewell')).toBe(false); // "Rook Okafor activates ..." names no faction
    expect(stripeCue(power)).toBe('sigil');
    expect(stripeCue(log.find((l) => l.kind === 'attacked')!)).toBe('name');
    // every striped line in a whole match carries one cue or the other, and an unstriped line carries neither
    for (const l of log) expect(stripeCue(l) === 'none', `${l.kind}: ${l.text}`).toBe(l.faction === null);
  });

  it('cues by the FACTION named, not by any faction named (known-bad: the other side\'s name does not count)', () => {
    expect(stripeCue({ faction: 'helion', text: 'Tidewell Trooper is destroyed' })).toBe('sigil');
    expect(stripeCue({ faction: 'helion', text: 'Helion Lancer hits Tidewell Trooper: 42%' })).toBe('name');
    expect(stripeCue({ faction: null, text: 'Helion builds a Lancer: 7,000 CR' })).toBe('none');
  });

  it('turns a turn into a section header: "Cycle 03" over "Tidewell turn, income 4,000 CR", still one sentence in text', () => {
    const line = formatEvent(SAMPLES.turnStarted, ctx);
    expect(line.section).toEqual({ title: 'Cycle 03', detail: 'Tidewell turn, income 4,000 CR' });
    expect(line.text).toBe('Cycle 03: Tidewell turn, income 4,000 CR');
    expect(formatEvent(SAMPLES.turnEnded, ctx).section).toBeUndefined();
    expect(formatEvent(SAMPLES.attacked, ctx).section).toBeUndefined();
  });
});

describe('grouping the log by turn', () => {
  const mk = (kind: GameEvent['kind'], text: string, section?: LogLine['section']): LogLine => ({ step: 1, text, tone: 'info', kind, icon: 'info', faction: null, ...(section ? { section } : {}) });
  const head = (n: number): LogLine => mk('turnStarted', `Cycle ${n}`, { title: `Cycle ${n}`, detail: 'x' });

  it('puts each line under the header before it, and lines before the first header in a header-less section', () => {
    const a = mk('attacked', 'a');
    const b = mk('built', 'b');
    const c = mk('captured', 'c');
    const groups = groupLog([a, head(1), b, c, head(2)]);
    expect(groups.map((g) => [g.head?.text ?? null, g.lines.map((l) => l.text)])).toEqual([[null, ['a']], ['Cycle 1', ['b', 'c']], ['Cycle 2', []]]);
  });

  it('is empty for no lines, and keeps every line exactly once (known-bad: none lost or doubled)', () => {
    expect(groupLog([])).toEqual([]);
    const all = [head(1), mk('moved', '1'), mk('moved', '2'), head(2), head(3), mk('moved', '3')];
    const g = groupLog(all);
    expect(g.flatMap((s) => [...(s.head ? [s.head] : []), ...s.lines])).toEqual(all);
    expect(g).toHaveLength(3);
  });
});

describe('older lines fade, and the log follows the newest line until the viewer scrolls up', () => {
  it('fades by age from full strength, never below 78%, and reads a bad age as the newest (known-bad input)', () => {
    expect(logOpacity(0)).toBe(1);
    expect(logOpacity(1)).toBe(0.96);
    expect(logOpacity(2)).toBe(0.92);
    expect(logOpacity(5)).toBe(0.8);
    expect(logOpacity(100)).toBe(0.78);
    for (let a = 1; a < 30; a++) expect(logOpacity(a)).toBeLessThanOrEqual(logOpacity(a - 1));
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) expect(logOpacity(bad), String(bad)).toBe(1);
  });

  const geom = (top: number, height = 1000, client = 200) => ({ top, height, client });

  it('counts the end as within a few pixels of it, and nothing further', () => {
    expect(atBottom(geom(800))).toBe(true);
    expect(atBottom(geom(800 - FOLLOW_SLACK_PX))).toBe(true);
    expect(atBottom(geom(800 - FOLLOW_SLACK_PX - 1))).toBe(false);
  });

  it('stops following the moment the viewer scrolls UP, and does not resume while they read', () => {
    expect(followAfterScroll(true, geom(500), 800)).toBe(false); // scrolled up from the end
    expect(followAfterScroll(false, geom(400), 500)).toBe(false); // still going up
    expect(followAfterScroll(false, geom(400), 400)).toBe(false); // a scroll event that did not move (content grew below them)
    expect(followAfterScroll(false, geom(450), 400)).toBe(false); // scrolling back down, not there yet: still reading
  });

  it('follows again once the viewer reaches the end, and holds through its own smooth scroll in flight', () => {
    expect(followAfterScroll(false, geom(790), 600)).toBe(true); // back at the bottom
    expect(followAfterScroll(true, geom(700), 650)).toBe(true); // our own smooth scroll, still on its way down
    expect(followAfterScroll(true, geom(800), 800)).toBe(true);
  });
});

describe('the event log\'s markup', () => {
  const demo = buildDemoMatch();
  const rec = recordMatch(demo.setup, demo.actions);
  const lines = buildLog(viewTimeline(rec, 0).steps).filter((l) => l.step <= 76);
  const html = renderToStaticMarkup(createElement(EventLog, { lines }));
  // Every row (a line, or a turn header) opens with a tag whose class starts "aww-log-line ".
  const items = html.split(/(?=<(?:li|div) class="aww-log-line )/).slice(1);
  const shownLines = lines.filter((l) => l.tone !== 'quiet');

  it('draws one row per kept line, with the icon of its kind, and hides the quiet moves until asked', () => {
    expect(shownLines.length).toBeGreaterThan(20);
    expect(items).toHaveLength(Math.min(120, shownLines.length));
    const tail = shownLines.slice(-items.length);
    items.forEach((li, i) => expect(li, `row ${i}`).toContain(`data-kind="${tail[i].kind}"`));
    items.filter((li) => !li.includes('--turn')).forEach((li) => {
      const kind = /data-kind="([^"]+)"/.exec(li)![1] as GameEvent['kind'];
      expect(li).toContain(`data-icon="${ICON_BY_KIND[kind]}"`);
    });
    expect(html).not.toMatch(/holds position|moves \d+ tiles?/);
  });

  it('reads each turn as a heading with its cycle, and no other line is one', () => {
    const turns = shownLines.filter((l) => l.kind === 'turnStarted');
    expect(turns.length).toBeGreaterThan(3);
    expect((html.match(/role="heading"/g) ?? []).length).toBe(turns.filter((t) => shownLines.slice(-items.length).includes(t)).length);
    expect(html).toContain('aww-log-line--turn');
    expect(html).toContain('Cycle 0');
  });

  it('lights exactly one line, the last, and fades the older ones toward the top', () => {
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
    expect(items[items.length - 1]).toContain('aria-current="true"');
    const fades = items.map((li) => Number(/--fade:([0-9.]+)/.exec(li)![1]));
    expect(fades[fades.length - 1]).toBe(1);
    expect(Math.min(...fades)).toBeGreaterThanOrEqual(0.78);
    expect(Math.min(...fades)).toBeLessThan(1);
    // older never stronger than newer, apart from the headers, which stay full so a pinned header never shows through
    const bodyFades = items.map((li, i) => [li, fades[i]] as const).filter(([li]) => !li.includes('--turn')).map(([, f]) => f);
    for (let i = 1; i < bodyFades.length; i++) expect(bodyFades[i]).toBeGreaterThanOrEqual(bodyFades[i - 1]);
  });

  it('stripes each line in its side\'s colour and draws a sigil only where the sentence names no faction', () => {
    const startsWith = (kind: string, side: string): string => items.find((li) => li.includes(`data-kind="${kind}"`) && li.includes(`body-sm">${side} `))!;
    const helion = startsWith('attacked', 'Helion');
    expect(helion).toContain('--stripe:var(--helion)');
    expect(helion).not.toContain('aw-sigil');
    // the other side's shot is that side's colour, even though the sentence also names Helion (the stripe follows the subject)
    const tidewell = startsWith('attacked', 'Tidewell');
    expect(tidewell).toContain('--stripe:var(--tidewell)');
    expect(tidewell).toContain('Helion');
    const power = items.find((li) => li.includes('data-kind="powerActivated"'));
    expect(power).toBeDefined();
    expect(power).toContain('aw-sigil');
    expect(power).toContain('--stripe:var(--');
    const turn = items.find((li) => li.includes('--turn'))!;
    expect(turn).toContain('aw-sigil');
  });

  it('pins each turn header inside its own section, so the next header pushes it out (no two pinned headers overlap)', () => {
    const sections = html.split('<li class="aww-log-section">').slice(1);
    expect(sections.length).toBeGreaterThan(3);
    for (const [i, sec] of sections.entries()) {
      const headers = sec.split('</li></ol></li>')[0].match(/aww-log-line--turn/g) ?? [];
      expect(headers.length, `section ${i}`).toBeLessThanOrEqual(1);
      if (i > 0) expect(sec.indexOf('aww-log-line--turn'), `section ${i} opens with its header`).toBeLessThan(sec.indexOf('<ol class="aww-log-rows">'));
    }
  });

  it('draws a fogged viewer no stripe on a shot it cannot attribute (known-bad: the shooter\'s colour must not leak)', () => {
    const fogRec = recordMatch(
      fieldSetup([{ type: 'trooper', owner: 0, x: 3, y: 1 }, { type: 'arc', owner: 1, x: 6, y: 1 }, { type: 'skimmer', owner: 1, x: 8, y: 1 }], { fog: true }),
      [endTurn, walk(2, [6], { kind: 'attack', target: pt(3) })],
    );
    const row = (viewer: 0 | 'all'): string => {
      const out = renderToStaticMarkup(createElement(EventLog, { lines: buildLog(viewTimeline(fogRec, viewer).steps) }));
      return out.split('<li ').find((li) => li.includes('data-kind="attacked"'))!;
    };
    expect(row(0)).toContain('--stripe:transparent');
    expect(row(0)).not.toContain('--tidewell');
    expect(row('all')).toContain('--stripe:var(--tidewell)');
  });

  it('is never blank: an empty log says nothing has happened yet', () => {
    expect(renderToStaticMarkup(createElement(EventLog, { lines: [] }))).toContain('Nothing has happened yet.');
  });
});
