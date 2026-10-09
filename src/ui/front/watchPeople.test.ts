// G15: the deployed battle screen names people the way the mission's own briefing does, and the demo is untouched.
//
//  - The briefing of mission 1 calls its enemy "Unmarked drones, no nation named"; the battle screen used to call them "The Hollow Choir"
//    (Act IV's reveal) and offered "Helion" twice. Every mission is deployed on its real Doctrine run and its battle screen rendered at
//    the first step, a middle step and the last step, through every viewer, and what a player can read (text and accessible names, not
//    class names or colour variables) is scanned for the names the story keeps back at that act.
//  - The demo (no `people`) renders byte for byte what it did before this change: nine renders whose hashes were taken from the code as it
//    was on main, BEFORE the change (see GOLDEN below).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { MISSIONS } from '../../content/missions';
import type { Mission } from '../../content/types';
import { FACTIONS } from '../../data';
import { WatchView, buildDemoMatch } from '../watch';
import type { Viewer } from '../watch/timeline';
import { recordMatch } from '../watch/timeline';
import { teamGroups } from './campaign';
import { resultCardOf } from './debrief';
import { runDeploy } from './deploy';
import type { DeployResult } from './deploy';
import { MissionWatch } from './MissionWatch';
import { seatsOfMission } from './seats';
import { DebriefScreen } from './StoryOverlay';

// ---------------------------------------------------------------- what a player can read

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };
const decode = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => ENTITIES[m]);

/**
 * The strings a person can read in a page's markup: its text, and the accessible names and tooltips on its elements. Class names, style
 * attributes (the colour variables) and data attributes are NOT in it: `var(--choir)` is a colour, and a colour is not a name.
 */
function readable(html: string): string[] {
  const bare = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script)[\s\S]*?<\/\1>/g, '');
  const out: string[] = [];
  for (const m of bare.matchAll(/\s(?:aria-label|aria-valuetext|aria-description|title|alt|placeholder)="([^"]*)"/g)) out.push(decode(m[1]));
  for (const m of bare.matchAll(/>([^<>]+)</g)) {
    const t = decode(m[1]).trim();
    if (t) out.push(t);
  }
  return out;
}

// What the story keeps back, by act. These mirror src/content/missions.test.ts (SPOILERS for Act I, ACT_II_RULES.spoilers for Acts II and
// III; nothing is hidden in Act IV). That file does not export them, so the test below reads its source and checks the two lines are there
// word for word: if the story's rules move, this file says so instead of quietly checking the old ones.
const ACT_I_BANS = [/vesper/i, /lattice core/i, /\bmira\b/i, /\bcantor\b/i, /hollow choir/i, /\bchoir\b/i];
const ACT_II_III_BANS = [/vesper/i, /\bcantor\b/i, /\bmira\b/i, /lattice core/i];
const bansFor = (m: Mission): RegExp[] => (m.act === 1 ? ACT_I_BANS : m.act === 4 ? [] : ACT_II_III_BANS);

const spoilersIn = (strings: readonly string[], bans: readonly RegExp[]): string[] =>
  strings.flatMap((s) => bans.filter((re) => re.test(s)).map((re) => `${re} in "${s}"`));

describe('the scan itself', () => {
  it('reads text and accessible names, and not class names or colour variables', () => {
    const html = '<div class="aw-banner--choir" style="fill:var(--choir)" data-x="Choir"><!-- Choir --><span aria-label="The Hollow Choir turn" title="Choir">Victory: Choir &amp; Rook</span></div><style>.choir{}</style>';
    expect(readable(html)).toEqual(['The Hollow Choir turn', 'Choir', 'Victory: Choir & Rook']);
  });
  it('finds a planted spoiler in every place a player could read it, and not in the places they cannot', () => {
    expect(spoilersIn(readable('<p>The Hollow Choir</p>'), ACT_I_BANS).length).toBeGreaterThan(0);
    expect(spoilersIn(readable('<svg aria-label="Choir Trooper, 10 HP"></svg>'), ACT_I_BANS).length).toBeGreaterThan(0);
    expect(spoilersIn(readable('<p title="Cantor speaks">x</p>'), ACT_II_III_BANS).length).toBeGreaterThan(0);
    expect(spoilersIn(readable('<div class="aw-banner--choir" style="fill:var(--choir)">Unmarked drones</div>'), ACT_I_BANS)).toEqual([]);
    expect(spoilersIn(['Admiral Tamura'], ACT_I_BANS), '"admiral" holds the letters of "mira"').toEqual([]);
    expect(bansFor(MISSIONS.find((m) => m.act === 4)!)).toEqual([]);
  });
  it('mirrors the story\'s own lists (src/content/missions.test.ts)', () => {
    const src = readFileSync(new URL('../../content/missions.test.ts', import.meta.url), 'utf8');
    expect(src).toContain('const SPOILERS = [/vesper/i, /lattice core/i, /\\bmira\\b/i, /\\bcantor\\b/i, /hollow choir/i, /\\bchoir\\b/i];');
    expect(src).toContain('spoilers: [/vesper/i, /\\bcantor\\b/i, /\\bmira\\b/i, /lattice core/i],');
  });
});

// ---------------------------------------------------------------- the seats a mission builds

describe('seatsOfMission: the battle screen names what the mission\'s own briefing names', () => {
  it('mission 1: "Your agent" (You), Rook Okafor (Rook) and unmarked drones with no nation (Unmarked)', () => {
    const [first] = MISSIONS;
    expect(first.id).toBe('first-light');
    expect(seatsOfMission(first)).toEqual([
      { name: 'Your agent', label: 'You', nation: 'shown', portrait: 'agent', log: { subject: 'Your agent', owner: 'Your' } },
      { name: 'Rook Okafor', label: 'Rook', nation: 'shown', portrait: 'commander', log: { subject: 'Rook', owner: "Rook's" } },
      { name: 'Unmarked drones', label: 'Unmarked', nation: 'masked', portrait: 'unmarked', log: { subject: 'Unmarked', owner: 'Unmarked' } },
    ]);
  });

  it.each(MISSIONS.map((m) => [m.id, m] as const))('%s: each seat is the person the briefing shows for that slot, masked exactly when the briefing names no nation', (_id, m) => {
    const seats = seatsOfMission(m);
    expect(seats.length).toBe(m.players.length);
    const sides = teamGroups(m).flatMap((g) => g.sides).sort((a, b) => a.slot - b.slot);
    for (const side of sides) {
      const seat = seats[side.slot];
      expect(seat.name, `slot ${side.slot}`).toBe(side.person.name);
      expect(seat.nation === 'masked', `slot ${side.slot} masked`).toBe(side.person.faction === null);
    }
    // the player's agent is the one seat that reads "You"; every named commander is called by their first name
    m.players.forEach((p, i) => {
      if (p.commander === 'agent') expect(seats[i].label).toBe('You');
      else if (Object.prototype.hasOwnProperty.call(COMMANDERS, p.commander)) expect(seats[i].label).toBe(COMMANDERS[p.commander].name.split(' ')[0]);
    });
  });

  it.each(MISSIONS.map((m) => [m.id, m] as const))('%s: no two seats share a label, so the "Watching as" buttons are all different words', (_id, m) => {
    const labels = seatsOfMission(m).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
  });

  it('masks a nation only where the briefing names none: mission 1\'s drones, and nobody else in the whole campaign', () => {
    const maskedSeats = MISSIONS.flatMap((m) => seatsOfMission(m).map((s, i) => ({ m, s, i })).filter((x) => x.s.nation === 'masked'));
    expect(maskedSeats.map((x) => `${x.m.id}#${x.i}`)).toEqual(['first-light#2']);
    // Act II onward may name the Hollow Choir: its drones are shown, by the nation's short name
    const act2 = MISSIONS.find((m) => m.id === 'pollen-count')!;
    const drones = seatsOfMission(act2)[act2.players.findIndex((p) => p.faction === 'choir')];
    expect(drones).toMatchObject({ nation: 'shown', label: FACTIONS.choir.short, portrait: 'drones' });
  });
});

// ---------------------------------------------------------------- the demo is untouched

describe('the demo watch view, given no people', () => {
  beforeAll(() => {
    const error = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });
  afterAll(() => vi.restoreAllMocks());

  // sha256 (first 16 hex digits) : length of renderToString(WatchView) for the demo match, with the drawer shut and no `lead` (the bare view).
  // A change that adds an attribute, a class, an element or one more comment node to the demo changes one of these.
  // RETAKEN FOR G18 (D-023): these nine were first taken from the code as it was on main BEFORE G15, and they held through G15, G14 and G17. G18
  // changed the demo's page on purpose (the banner row, the toolbar and the side column became one slim bar, a shut drawer and one row of playback),
  // so they are taken again from the code as G18 leaves it, and are a guard from here on, not a proof of anything older. The page is much shorter
  // (the log is in the drawer, which is not drawn until it is opened); what the new page holds is tested in src/ui/watch/clean.test.ts.
  const GOLDEN: Record<string, string> = {
    '0@0': 'efc3771189505985:87690',
    '0@40': '4ff91f22757d4282:97517',
    '0@last': '768332d8ad287be2:92788',
    '1@0': '03b4ea35070c3900:87732',
    '1@40': '1c801dda93f6814b:95668',
    '1@last': '5317cdeebbb617b6:86333',
    'all@0': '15d4a0ad2b735ff0:83608',
    'all@40': '85f816a942c3d742:95177',
    'all@last': '073fd698df6964ff:89647',
  };
  const match = buildDemoMatch();
  const stamp = (viewer: Viewer, step: number | 'last', extra: Record<string, unknown> = {}): string => {
    const initialStep = step === 'last' ? match.actions.length : step;
    const html = renderToString(createElement(WatchView, { setup: match.setup, actions: match.actions, viewer, initialStep, onViewerChange: () => {}, ...extra }));
    return `${createHash('sha256').update(html).digest('hex').slice(0, 16)}:${html.length}`;
  };

  it.each(Object.entries(GOLDEN))('renders exactly what it rendered before: viewer@step %s', (key, expected) => {
    const [viewer, step] = key.split('@');
    expect(stamp(viewer === 'all' ? 'all' : (Number(viewer) as Viewer), step === 'last' ? 'last' : Number(step))).toBe(expected);
  });

  it('is changed by the drawer being open (known-bad twin: the golden pages are the shut ones, so a drawer that was open by default would be seen)', () => {
    expect(stamp(0, 40, { initialDrawer: 'players' })).not.toBe(GOLDEN['0@40']);
    expect(stamp(0, 40, { initialDrawer: undefined })).toBe(GOLDEN['0@40']);
  });

  it('is changed by `people` (known-bad twin: the check cannot pass for a view that ignores what it was given)', () => {
    const people = [
      { name: 'Rook', label: 'Rook', nation: 'shown' as const, portrait: 'commander' as const },
      { name: 'Sefa', label: 'Sefa', nation: 'shown' as const, portrait: 'commander' as const },
    ];
    expect(stamp(0, 0, { people })).not.toBe(GOLDEN['0@0']);
  });
});

// ---------------------------------------------------------------- every mission, deployed and rendered

describe('the deployed battle screen of every mission names nothing its act has not revealed', () => {
  beforeAll(() => {
    const error = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });
  afterAll(() => vi.restoreAllMocks());

  const render = (mission: Mission, result: DeployResult, viewer: Viewer, step: number): string =>
    // G18: the drawer is open (on its first tab; all three panels are in the page, two of them hidden), so the scan reads the players, the intel
    // card and the log as well as the bar and the board
    renderToString(createElement(MissionWatch, { mission, result, initialViewer: viewer, initialStep: step, drawerOpen: 'players' }));

  it.each(MISSIONS.map((m) => [m.id, m] as const))('%s', (_id, mission) => {
    const result = runDeploy(mission);
    const last = result.actions.length;
    const steps = [0, Math.floor(last / 2), last];
    const viewers: Viewer[] = [...mission.players.map((_, i) => i as Viewer), 'all'];
    const bans = bansFor(mission);
    const found: string[] = [];
    const toggles = new Set<string>();
    for (const viewer of viewers) {
      for (const step of steps) {
        const html = render(mission, result, viewer, step);
        const strings = readable(html);
        for (const f of spoilersIn(strings, bans)) found.push(`viewer ${String(viewer)} step ${step}: ${f}`);
        // the toggle's own buttons, in order: one per seat and "All", every one a different word
        const buttons = [...html.matchAll(/role="radio"[^>]*>(.*?)<\/button>/g)].map((x) => x[1].replace(/<[^>]*>/g, ''));
        expect(buttons.length, 'a button per seat and one for all').toBe(mission.players.length + 1);
        expect(new Set(buttons).size, `unique toggle words ${buttons.join(', ')}`).toBe(buttons.length);
        buttons.forEach((b) => toggles.add(b));
        // the player's agent is never "Helion" and never "Commander" on a panel
        expect(strings, 'the agent is named on its panel').toContain('Your agent');
      }
    }
    expect(found).toEqual([]);

    // the debrief over the last step: the verdict, the lines read aloud and the result card, each at its own stage
    const card = resultCardOf(mission, recordMatch(result.setup, result.actions).states);
    for (const read of [false, true]) {
      const html = renderToString(createElement(DebriefScreen, { mission, card, onWatchAgain: () => {}, read, onRead: () => {} }));
      expect(spoilersIn(readable(html), bans), `debrief, read=${read}`).toEqual([]);
    }
  }, 240000);

  it('mission 1 reads "Unmarked drones" and "No nation named" on its battle screen, and the nation nowhere', () => {
    const mission = MISSIONS[0];
    const result = runDeploy(mission);
    const strings = readable(render(mission, result, 0, result.actions.length));
    expect(strings).toContain('Unmarked drones');
    expect(strings).toContain('No nation named');
    expect(strings).toContain('Unmarked');
    expect(strings).toContain('You');
    expect(strings).toContain('Rook');
    expect(spoilersIn(strings, ACT_I_BANS)).toEqual([]);
    // the log: the drones are named as the briefing names them
    expect(strings.some((s) => /^Unmarked \w+ (hits|moves|holds)/.test(s) || /Unmarked turn, income/.test(s))).toBe(true);
  }, 120000);

  it('mission 1 names the winners "You and Rook" in the victory chip and "Your agent and Rook" in the log, from the engine\'s own winner', () => {
    const mission = MISSIONS[0];
    const result = runDeploy(mission);
    const winnerTeam = recordMatch(result.setup, result.actions).states.at(-1)!.winnerTeam;
    const strings = readable(render(mission, result, 0, result.actions.length));
    // Doctrine is tuned by other work and no winner is assumed: a decided battle names its winners, an undecided one draws no chip
    if (winnerTeam === null) {
      expect(strings.some((s) => s.startsWith('Victory: '))).toBe(false);
      return;
    }
    const sideOf = (team: number, name: (p: Mission['players'][number]) => string): string => mission.players.filter((p) => p.team === team).map(name).join(' and ');
    const first = (p: Mission['players'][number]): string => COMMANDERS[p.commander].name.split(' ')[0];
    expect(strings).toContain(`Victory: ${sideOf(winnerTeam, (p) => (p.commander === 'agent' ? 'You' : p.commander === 'none' ? 'Unmarked' : first(p)))}`);
    expect(strings).toContain(`Victory: ${sideOf(winnerTeam, (p) => (p.commander === 'agent' ? 'Your agent' : p.commander === 'none' ? 'Unmarked' : first(p)))}`);
    expect(strings.some((s) => /Helion and Helion/.test(s))).toBe(false);
  }, 120000);

  it('known-bad twin: the same battle rendered WITHOUT `people` fails the Act I check, names "Helion" twice, and calls two panels "Commander"', () => {
    const mission = MISSIONS[0];
    const result = runDeploy(mission);
    const mid = Math.floor(result.actions.length / 2);
    const html = renderToString(createElement(WatchView, { setup: result.setup, actions: result.actions, viewer: 0, initialStep: mid, onViewerChange: () => {}, initialDrawer: 'players' }));
    const strings = readable(html);
    expect(spoilersIn(strings, ACT_I_BANS).length, 'the old screen names the Choir').toBeGreaterThan(0);
    const buttons = [...html.matchAll(/role="radio"[^>]*>(.*?)<\/button>/g)].map((x) => x[1].replace(/<[^>]*>/g, ''));
    // (the toggle now numbers a nation two seats share; the panel headings below are what the old screen did)
    expect(buttons.slice(0, 2)).toEqual(['Helion 1', 'Helion 2']);
    const headings = [...html.matchAll(/<span class="heading" style="[^"]*">([^<]*)<\/span>/g)].map((x) => x[1]);
    expect(headings, 'the panels\' headings: the agent and the drones are both just "Commander"').toEqual(['Commander', 'Rook Okafor', 'Commander']);
  }, 120000);
});
