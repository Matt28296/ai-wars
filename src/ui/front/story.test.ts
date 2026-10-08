// The story's screens as markup: the compact dialogue, the debrief with its result card, and the watch with the story laid over it.
// Rendered on the server. Effects (the typewriter timer, the keys) do not run there; what they decide is tested as pure functions, and
// the live behaviour (pausing the battle, Space, Watch again) was exercised in a real browser for the order's receipt.
import { createElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MISSIONS } from '../../content/missions';
import type { DialogueLine, Mission } from '../../content/types';
import type { ResultCard } from './debrief';
import { debriefLines, nextMissionOf } from './debrief';
import { DialogueBox } from './BriefingView';
import { lineView } from './briefing';
import { DialogueRunner, typewriterShown } from './DialogueRunner';
import { runDeploy } from './deploy';
import { MissionWatch } from './MissionWatch';
import { DebriefScreen, ResultCardView, StoryOverlay, unrankedNote } from './StoryOverlay';

/** The text of some markup: tags dropped, the five entities React writes undone. */
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');
const noop = (): void => {};

// What a later act reveals (src/content/missions.test.ts SPOILERS): none of it may stand on a result card.
const REVEALS = [/vesper/i, /lattice core/i, /\bmira\b/i, /\bcantor\b/i, /hollow choir/i, /\bchoir\b/i];
const revealsIn = (text: string): string[] => REVEALS.filter((r) => r.test(text)).map(String);

const first = MISSIONS[0];
const win: ResultCard = { outcome: 'victory', cycles: 5, parCycles: 6, lost: 1, destroyed: 3, ratio: 3, parPower: 3, speed: 100, power: 100, rank: 'S' };
const loss: ResultCard = { outcome: 'defeat', cycles: 3, parCycles: 6, lost: 9, destroyed: 0, ratio: 0, parPower: 3, speed: 100, power: 0, rank: null };
const cap: ResultCard = { outcome: 'undecided', cycles: 30, parCycles: 12, lost: 39, destroyed: 53, ratio: 53 / 39, parPower: 2, speed: 0, power: 68, rank: null };

// ---------------------------------------------------------------- the typewriter

describe('the typewriter', () => {
  it('types 30 characters a second, and stops at the end of the line', () => {
    expect(typewriterShown(false, 0, 80)).toBe(0);
    expect(typewriterShown(false, 1000, 80)).toBe(30);
    expect(typewriterShown(false, 2000, 80)).toBe(60);
    expect(typewriterShown(false, 60_000, 80)).toBe(80);
    expect(typewriterShown(false, -500, 80)).toBe(0);
  });

  it('shows the whole line at once under reduced motion: no typewriter (known-bad: motion on would show none at time 0)', () => {
    expect(typewriterShown(true, 0, 80)).toBe(80);
    expect(typewriterShown(true, 1000, 80)).toBe(80);
    expect(typewriterShown(false, 0, 80)).not.toBe(80);
  });

  it('has no slide under reduced motion: the story box and the debrief stop animating, and the portrait only fades', () => {
    const css = readFileSync(new URL('./front.css', import.meta.url), 'utf8');
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(blocks).toMatch(/\.awf-story\s*\{\s*animation:\s*none/);
    expect(blocks).toMatch(/\.awf-debrief\s*\{\s*animation:\s*none/);
    expect(blocks).toMatch(/\.awf-dlg-portrait\s*\{\s*animation:\s*awf-fade/);
    // and outside that block both do slide in, so the rule above removes something real
    expect(css).toMatch(/\.awf-story\s*\{[^}]*animation:\s*awf-rise/);
  });
});

// ---------------------------------------------------------------- the compact dialogue

describe('the dialogue over a battle', () => {
  const sefa: DialogueLine = { speaker: 'sefa', side: 'right', mood: 'grim', channel: 'Tidewell fleet net, open', text: 'Come about, withdraw your column.' };
  const render = (lines: DialogueLine[], shown = 12): string =>
    renderToStaticMarkup(createElement(DialogueRunner, { lines, onDone: noop, initial: { phase: 'dialogue', index: 0, shown } }));

  it('is the briefing\'s own box in its compact size: portrait on the line\'s side with its mood, nameplate, channel, typed text', () => {
    const h = render([sefa]);
    expect(h).toContain('awf-dlg awf-dlg--compact');
    expect(h).toContain('data-side="right"');
    expect(h).toContain('data-mood="grim"');
    expect(h).toContain('awf-dlg-portrait');
    expect(textOf(h)).toContain('Sefa Tamura');
    expect(textOf(h)).toContain('Tidewell fleet net, open');
    // 12 characters typed, the rest laid out invisibly so the box does not grow as it types
    expect(h).toContain('<span aria-hidden="true">Come about, </span>');
    expect(h).toContain('<span aria-hidden="true" class="awf-dlg-rest">withdraw your column.</span>');
    expect(h).toContain('<span class="awf-sr">Come about, withdraw your column.</span>');
    expect(h).toContain('01/01');
  });

  it('gives the narrator no portrait and the middle of the box', () => {
    const h = render([{ speaker: 'narrator', text: 'By nightfall the fire was out.' }]);
    expect(h).toContain('awf-dlg--narrator');
    expect(h).toContain('data-side="none"');
    expect(h).not.toContain('awf-dlg-portrait');
  });

  it('counts its lines and shows the key that advances', () => {
    const h = render([sefa, sefa, sefa]);
    expect(h).toContain('01/03');
    expect(h).toContain('Space');
    expect(h).toContain('Skip text'); // the first press completes the line; once complete it reads "Next"
    expect(render([sefa], 33)).toContain('Next<kbd');
  });

  it('offers Skip on every line but the last of a run of several, and on a run of one never (known-bad: the last line has nothing to skip to)', () => {
    const three = [sefa, sefa, sefa];
    const at = (index: number, lines = three): string => renderToStaticMarkup(createElement(DialogueRunner, { lines, onDone: noop, initial: { phase: 'dialogue', index, shown: 0 } }));
    expect(at(0)).toContain('data-action="skip-lines"');
    expect(at(1)).toContain('data-action="skip-lines"');
    expect(at(2)).not.toContain('data-action="skip-lines"');
    expect(at(0, [sefa])).not.toContain('data-action="skip-lines"');
    // the briefing's own box has no such button unless it is given one
    expect(renderToStaticMarkup(createElement(DialogueBox, { view: lineView(sefa), shown: 0, index: 0, total: 3 }))).not.toContain('skip-lines');
    expect(renderToStaticMarkup(createElement(DialogueBox, { view: lineView(sefa), shown: 0, index: 0, total: 3, onSkip: noop }))).toContain('skip-lines');
  });

  it('draws nothing for a run with no lines (it is already over)', () => {
    expect(renderToStaticMarkup(createElement(DialogueRunner, { lines: [], onDone: noop }))).toBe('');
  });
});

// ---------------------------------------------------------------- the result card

describe('the result card', () => {
  const card = (c: ResultCard, m: Mission = first): string => renderToStaticMarkup(createElement(ResultCardView, { mission: m, card: c, next: nextMissionOf(m), onWatchAgain: noop }));

  it('shows cycles against par, units lost, units destroyed, destroyed per loss against par, Speed, Power and the rank', () => {
    const t = textOf(card(win));
    expect(t).toMatch(/Cycles taken\s+5\s+par 6/);
    expect(t).toMatch(/Your side lost\s+1\s+units/);
    expect(t).toMatch(/Enemy destroyed\s+3\s+units/);
    expect(t).toMatch(/Destroyed per loss\s+3\.0\s+par 3\.0/);
    expect(t).toMatch(/Speed\s+100/);
    expect(t).toMatch(/Power\s+100/);
    expect(card(win)).toContain('data-rank="S"');
    expect(card(win)).toContain('aria-label="Rank S"');
    expect(t).toContain('Speed 100 + Power 100');
  });

  it('states the rule on the card itself, one hover or focus away on the rank (G18, D-023: no paragraph), so the rank can be checked against it', () => {
    const h = card(win);
    // the paragraph is gone, everywhere; the rule is the rank's own hint, and the rank can take focus to show it
    expect(h).not.toContain('awf-result-rule');
    expect(textOf(h)).not.toContain('Only a victory is ranked');
    expect(textOf(h)).not.toContain('Your side is your agent');
    const rank = /<div class="awf-result-rank"[^>]*>/.exec(h)![0];
    expect(rank).toContain('tabindex="0"');
    const hint = /title="([^"]*)"/.exec(rank)![1];
    expect(hint).toContain('S from 180, A from 150, B from 100, C below');
    expect(hint).toContain('Only a victory is ranked');
    expect(hint).toContain('Speed is 100 at par');
    expect(hint).toContain('Power is enemy units destroyed');
  });

  it('shows no rank, and says why, for a defeat and for an undecided battle (known-bad: a letter on a loss)', () => {
    for (const [c, note] of [[loss, 'Not ranked: the mission was lost.'], [cap, 'Not ranked: nobody won.']] as const) {
      const h = card(c);
      expect(h).toContain('data-rank="none"');
      expect(h).toContain('aria-label="Not ranked"');
      expect(textOf(h)).toContain(note);
      expect(unrankedNote(c.outcome)).toBe(note);
      expect(h).not.toMatch(/aria-label="Rank [SABC]"/);
    }
  });

  it('has Watch again, Back to briefing and Next mission, the last two as links to briefings', () => {
    const h = card(win);
    expect(h).toMatch(/<button[^>]*data-action="again"[^>]*>[\s\S]*?Watch again/);
    expect(h).toMatch(/<a [^>]*href="#\/mission\/first-light"[^>]*data-action="briefing"[^>]*>[\s\S]*?Back to briefing/);
    expect(h).toMatch(/<a [^>]*href="#\/mission\/calder-spire"[^>]*data-action="next"[^>]*>[\s\S]*?Next mission/);
  });

  it('has no Next mission after the last mission (known-bad: it must appear for every other)', () => {
    const last = MISSIONS[MISSIONS.length - 1];
    expect(nextMissionOf(last)).toBeUndefined();
    expect(card(win, last)).not.toContain('Next mission');
    expect(card(win, last)).toContain('Back to briefing');
    for (const m of MISSIONS.slice(0, -1)) expect(card(win, m), m.id).toContain('Next mission');
  });

  it('makes Next mission the main action after a victory, and Watch again the main action otherwise', () => {
    const primary = (h: string): string => /<(?:a|button) [^>]*aw-btn--primary[^>]*data-action="([a-z]+)"/.exec(h)?.[1] ?? /data-action="([a-z]+)"[^>]*aw-btn--primary/.exec(h)?.[1] ?? 'none';
    expect(primary(card(win))).toBe('next');
    expect(primary(card(loss))).toBe('again');
    expect(primary(card(cap))).toBe('again');
  });

  it('keeps Space for the focused button, not for the watch view\'s play and pause (the card stops the key at its edge)', () => {
    // React serialises no handlers, so look at the element: a section that takes key events
    const el = ResultCardView({ mission: first, card: win, onWatchAgain: noop });
    expect(typeof el.props.onKeyDown).toBe('function');
    expect(typeof el.props.onKeyUp).toBe('function');
    let stopped = 0;
    el.props.onKeyDown({ key: ' ', stopPropagation: () => { stopped++; } });
    el.props.onKeyUp({ key: ' ', stopPropagation: () => { stopped++; } });
    el.props.onKeyDown({ key: 'ArrowLeft', stopPropagation: () => { stopped++; } });
    expect(stopped).toBe(2); // Space down and up are stopped; the arrow keys still reach the watch view
  });
});

describe('the result card never names a later act\'s reveals', () => {
  it('holds for every mission and every ending: no reveal, and no other mission\'s title (known-bad: the scanner catches planted ones)', () => {
    for (const m of MISSIONS) {
      const next = nextMissionOf(m);
      for (const c of [win, loss, cap]) {
        const t = textOf(renderToStaticMarkup(createElement(ResultCardView, { mission: m, card: c, next, onWatchAgain: noop })));
        expect(revealsIn(t), `${m.id} ${c.outcome}`).toEqual([]);
        if (next) expect(t, `${m.id} must not name ${next.title}`).not.toContain(next.title);
        expect(t, `${m.id} must not name itself`).not.toContain(m.title);
      }
    }
    expect(revealsIn('The Hollow Choir answers to Cantor')).toHaveLength(3);
    expect(revealsIn('VESPER and the Lattice core')).toHaveLength(2);
    expect(revealsIn('Rank S: Speed 100 + Power 100')).toEqual([]);
  });

  it('holds for the neutral lines under a defeat or an undecided battle on every mission, and for the verdict headings', () => {
    for (const m of MISSIONS) {
      for (const c of [loss, cap]) {
        const t = textOf(renderToStaticMarkup(createElement(DebriefScreen, { mission: m, card: c, onWatchAgain: noop, read: false, onRead: noop })));
        const lines = debriefLines(m, c).map((l) => l.text).join(' ');
        expect(revealsIn(lines), `${m.id} ${c.outcome}`).toEqual([]);
        expect(t).toContain(c.outcome === 'defeat' ? 'Defeat' : 'Undecided');
      }
    }
  });
});

// ---------------------------------------------------------------- the debrief screen and the overlay

describe('the debrief screen', () => {
  const screen = (c: ResultCard, read: boolean, m: Mission = first): string =>
    renderToStaticMarkup(createElement(DebriefScreen, { mission: m, card: c, next: nextMissionOf(m), onWatchAgain: noop, read, onRead: noop }));

  it('names the verdict over the dimmed board: Victory, Defeat, Undecided', () => {
    expect(screen(win, false)).toMatch(/<h2 class="awf-verdict" data-outcome="victory">Victory<\/h2>/);
    expect(screen(loss, false)).toMatch(/<h2 class="awf-verdict" data-outcome="defeat">Defeat<\/h2>/);
    expect(screen(cap, false)).toMatch(/<h2 class="awf-verdict" data-outcome="undecided">Undecided<\/h2>/);
  });

  it('opens on the debrief being read, then shows the card once it has been read', () => {
    const talking = screen(win, false);
    expect(talking).toContain('data-stage="talk"');
    expect(talking).toContain('awf-dlg--compact');
    expect(talking).not.toContain('data-phase="result"');
    expect(textOf(talking)).toContain(first.debrief[0].text);
    const done = screen(win, true);
    expect(done).toContain('data-stage="result"');
    expect(done).toContain('data-phase="result"');
    expect(done).not.toContain('awf-dlg--compact');
  });

  it('reads the mission\'s debrief for a victory and one neutral line for the rest', () => {
    expect(textOf(screen(loss, false))).toContain(debriefLines(first, loss)[0].text);
    expect(textOf(screen(cap, false))).toContain('stopped at cycle 30');
    expect(textOf(screen(loss, false))).not.toContain(first.debrief[0].text);
  });

  it('says which mission it is, in the mission\'s own act', () => {
    const m5 = MISSIONS.find((m) => m.order === 5)!;
    expect(textOf(screen(win, false, m5))).toContain(`Act II · Mission 05 · ${m5.title}`);
  });
});

describe('the overlay slot\'s three states', () => {
  const props = (view: Parameters<typeof StoryOverlay>[0]['view'], card = win, debriefRead = false): Parameters<typeof StoryOverlay>[0] => ({
    mission: first, beats: [{ step: 0, events: [0], lines: first.events[0].lines }], view, card, next: nextMissionOf(first), debriefRead,
    onBeatDone: noop, onDebriefRead: noop, onWatchAgain: noop,
  });

  it('draws nothing when the story has nothing to say', () => {
    expect(renderToStaticMarkup(createElement(StoryOverlay, props({ kind: 'none' })))).toBe('');
  });

  it('draws the open beat as a polite live region holding its first line', () => {
    const h = renderToStaticMarkup(createElement(StoryOverlay, props({ kind: 'beat', index: 0 })));
    expect(h).toContain('data-story="beat"');
    expect(h).toContain('aria-live="polite"');
    expect(h).toContain('aria-label="Mission dialogue"');
    expect(textOf(h)).toContain(first.events[0].lines[0].text);
  });

  it('draws the debrief at the final step, on the lines first and then on the card', () => {
    expect(renderToStaticMarkup(createElement(StoryOverlay, props({ kind: 'debrief' })))).toContain('data-stage="talk"');
    expect(renderToStaticMarkup(createElement(StoryOverlay, props({ kind: 'debrief' }, win, true)))).toContain('data-stage="result"');
  });
});

// ---------------------------------------------------------------- the watch with the story over it

describe('the watch with the story over it', () => {
  // The watch board lays itself out in a layout effect, which React warns about on the server. That is the old view's own habit, not news.
  beforeAll(() => {
    const error = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });
  afterAll(() => vi.restoreAllMocks());

  it('opens on the mission\'s start beat on the first paint, with the battle still the watch view\'s own', () => {
    const result = runDeploy(first);
    const h = bare(renderToString(createElement(MissionWatch, { mission: first, result })));
    expect(h).toContain('aww-root');
    expect(h).toContain('data-step="0"');
    expect(h).toContain('aww-stagebox');
    expect(h).toContain('data-story="beat"');
    expect(textOf(h)).toContain(first.events.find((e) => e.trigger.kind === 'start')!.lines[0].text);
    expect(h).not.toContain('data-story="debrief"'); // the debrief belongs to the final step
    expect(textOf(h)).toContain('Watching as'); // the viewer toggle is still there
    // the board's own markup is still inside the stage box, before the overlay
    expect(h.indexOf('class="aww-stage"')).toBeGreaterThan(h.indexOf('aww-stagebox'));
    expect(h.indexOf('data-story="beat"')).toBeGreaterThan(h.indexOf('class="aww-stage"'));
    // G18: the drawer is not in the page until it is opened, and the playback row is under the board and its story
    expect(h).not.toContain('class="aww-drawer"');
    expect(h.indexOf('data-story="beat"')).toBeLessThan(h.indexOf('class="aww-bottom"'));
  }, 60_000);
});
