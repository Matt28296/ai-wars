// The briefing scene's logic and markup. Expected answers are worked out here from the raw mission lines, not read back from briefing.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { MISSIONS } from '../../content/missions';
import type { DialogueLine } from '../../content/types';
import { portraitUrl } from '../portraits';
import { CHARS_PER_SECOND, charsAfter, initialBriefing, lengthOf, lineView, objectiveChips, revealed, stepBriefing } from './briefing';
import type { BriefingAction, BriefingState } from './briefing';
import { BriefingView, DialogueBox, ObjectiveCard } from './BriefingView';

const press = (lines: readonly DialogueLine[], s: BriefingState, a: BriefingAction = { type: 'confirm' }): BriefingState => stepBriefing(s, a, lines);
const codePoints = (t: string): number => [...t].length;
/** The text of some markup: tags dropped, the five entities React writes undone. */
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** An attribute value as React writes it, for comparing a data URL against markup. */
const attr = (value: string): string => /src="([^"]*)"/.exec(renderToStaticMarkup(createElement('img', { src: value })))![1];

describe('walking a briefing', () => {
  for (const m of MISSIONS) {
    it(`${m.id}: every line in order, a press completes it and the next press advances, and the objective card comes last`, () => {
      const lines = m.briefing;
      expect(lines.length).toBeGreaterThan(0);
      let s = initialBriefing(lines);
      expect(s).toEqual({ phase: 'dialogue', index: 0, shown: 0 });
      const visited: number[] = [];
      let presses = 0;
      while (s.phase === 'dialogue') {
        if (visited[visited.length - 1] !== s.index) visited.push(s.index);
        const len = codePoints(lines[s.index].text);
        expect(s.shown, `line ${s.index} starts untyped`).toBe(0);
        const completed = press(lines, s);
        presses += 1;
        expect(completed, `first press on line ${s.index} completes it`).toEqual({ phase: 'dialogue', index: s.index, shown: len });
        s = press(lines, completed);
        presses += 1;
        if (s.phase === 'dialogue') expect(s, `second press on line ${completed.index} advances`).toEqual({ phase: 'dialogue', index: completed.index + 1, shown: 0 });
      }
      expect(visited).toEqual(lines.map((_, i) => i));
      expect(presses).toBe(lines.length * 2);
      expect(s.phase).toBe('objective');
      // Deploy is a deliberate act: another press on the card changes nothing
      expect(press(lines, s)).toBe(s);
    });
  }

  const lines = MISSIONS[0].briefing;
  it('completes a half-typed line on the first press, whatever had been typed', () => {
    let s = initialBriefing(lines);
    s = press(lines, s, { type: 'tick', shown: 7 });
    expect(s.shown).toBe(7);
    expect(press(lines, s)).toEqual({ phase: 'dialogue', index: 0, shown: codePoints(lines[0].text) });
  });

  it('never types backwards and never types past the end of the line', () => {
    let s = initialBriefing(lines);
    s = press(lines, s, { type: 'tick', shown: 9 });
    expect(press(lines, s, { type: 'tick', shown: 3 })).toBe(s);
    expect(press(lines, s, { type: 'tick', shown: 100000 }).shown).toBe(codePoints(lines[0].text));
  });

  it('Skip goes to the objective card from the first line, from the middle and from the last', () => {
    for (const at of [0, 4, lines.length - 1]) {
      const s = press(lines, { phase: 'dialogue', index: at, shown: 2 }, { type: 'skip' });
      expect(s.phase).toBe('objective');
    }
    expect(press(lines, { phase: 'objective', index: 0, shown: 0 }, { type: 'skip' }).phase).toBe('objective');
  });

  it('Replay starts the briefing again from its first line', () => {
    expect(press(lines, { phase: 'objective', index: lines.length - 1, shown: 5 }, { type: 'restart' })).toEqual({ phase: 'dialogue', index: 0, shown: 0 });
  });

  it('goes straight to the objective when a mission has no briefing', () => {
    expect(initialBriefing([]).phase).toBe('objective');
  });

  it('types about thirty characters a second', () => {
    expect(CHARS_PER_SECOND).toBe(30);
    expect([charsAfter(0), charsAfter(1000), charsAfter(1500), charsAfter(333), charsAfter(-40)]).toEqual([0, 30, 45, 9, 0]);
    expect(charsAfter(1000, 60)).toBe(60);
  });

  it('counts and cuts a line by characters, not by UTF-16 units', () => {
    expect(lengthOf('a\u{1F600}b')).toBe(3);
    expect(revealed('a\u{1F600}b', 2)).toBe('a\u{1F600}');
    expect(revealed('abc', 0)).toBe('');
    expect(revealed('abc', -3)).toBe('');
    expect(revealed('abc', 99)).toBe('abc');
  });
});

describe('how a line is shown', () => {
  const all = MISSIONS.flatMap((m) => m.briefing.map((line) => ({ m, line })));

  it('puts the portrait on the side the line names, and the narrator in the middle, for every line of the campaign', () => {
    for (const { m, line } of all) {
      const v = lineView(line);
      const expected = line.speaker === 'narrator' ? null : line.side ?? 'left';
      expect(v.side, `${m.id}: ${line.speaker}: ${line.text.slice(0, 30)}`).toBe(expected);
    }
    expect(all.some(({ line }) => line.side === 'right')).toBe(true);
    expect(all.some(({ line }) => line.side === 'left')).toBe(true);
  });

  it('puts a line that names no side on the left, and a line that names none and no mood in a neutral face (no line of the campaign leaves these out, so planted)', () => {
    expect(all.every(({ line }) => line.speaker === 'narrator' || line.side !== undefined)).toBe(true);
    expect(lineView({ speaker: 'rook', text: 'x' })).toMatchObject({ side: 'left', mood: 'neutral' });
    expect(lineView({ speaker: 'Harbour Control', text: 'x' })).toMatchObject({ side: 'left', mood: 'neutral' });
    expect(lineView({ speaker: 'narrator', side: 'right', text: 'x' }).side).toBeNull();
  });

  it('wears the mood the line names, neutral when it names none, for every line', () => {
    for (const { m, line } of all) expect(lineView(line).mood, `${m.id}: ${line.text.slice(0, 30)}`).toBe(line.mood ?? 'neutral');
    expect(all.some(({ line }) => line.mood === 'happy')).toBe(true);
    expect(all.some(({ line }) => line.mood === 'angry')).toBe(true);
  });

  it('carries the channel and the text as authored', () => {
    for (const { line } of all) {
      const v = lineView(line);
      expect(v.text).toBe(line.text);
      expect(v.channel).toBe(line.channel);
    }
  });

  it('names the speaker from the commander file, a place by its own name, and the narrator by neither', () => {
    for (const { m, line } of all) {
      const p = lineView(line).person;
      if (line.speaker === 'narrator') expect(p.kind).toBe('narrator');
      else if (COMMANDERS[line.speaker]) expect([p.kind, p.name, p.faction], `${m.id} ${line.speaker}`).toEqual(['commander', COMMANDERS[line.speaker].name, COMMANDERS[line.speaker].faction]);
      else expect([p.kind, p.name], `${m.id} ${line.speaker}`).toEqual(['station', line.speaker]);
    }
  });

  it('known answers from Act I: the watch post speaks from the right as a place, Rook\'s happy line from the left with his face', () => {
    const lines = MISSIONS[0].briefing;
    expect(lineView(lines[0])).toMatchObject({ side: 'right', person: { kind: 'station', name: 'Calder Watch' } });
    const happy = lines.find((l) => l.speaker === 'rook' && l.mood === 'happy')!;
    expect(lineView(happy)).toMatchObject({ side: 'left', mood: 'happy', person: { name: 'Rook Okafor', portraitId: 'rook' } });
    // a known-bad: it is not the right side and not a neutral face
    expect(lineView(happy).side).not.toBe('right');
    expect(lineView(happy).mood).not.toBe('neutral');
  });
});

describe('the dialogue box markup', () => {
  const rookLine: DialogueLine = { speaker: 'rook', side: 'left', mood: 'happy', text: 'Hold the line, Captain.' };
  const view = (line: DialogueLine, shown: number, narrow = false): string => renderToStaticMarkup(createElement(DialogueBox, { view: lineView(line), shown, index: 2, total: 11, narrow }));

  it('draws the commander\'s bust in the mood of the line, on the side of the line', () => {
    const left = view(rookLine, 4);
    expect(left).toContain('data-side="left"');
    expect(left).toContain('data-mood="happy"');
    expect(left).toContain('data-speaker="Rook Okafor"');
    expect(left).toContain(attr(portraitUrl('rook', 'happy')));
    expect(left).not.toContain(attr(portraitUrl('rook', 'angry')));
    const right = view({ ...rookLine, side: 'right', mood: 'angry' }, 4);
    expect(right).toContain('data-side="right"');
    expect(right).toContain(attr(portraitUrl('rook', 'angry')));
    expect(right).not.toContain(attr(portraitUrl('rook', 'happy')));
  });

  it('has no portrait for the narrator and a plate, not a face, for a voice that is a place', () => {
    const narrator = view({ speaker: 'narrator', text: 'Dawn over Calder.' }, 5);
    expect(narrator).toContain('data-side="none"');
    expect(narrator).not.toContain('<img');
    expect(narrator).not.toContain('aw-portrait');
    const place = view({ speaker: 'Calder Watch', side: 'right', text: 'Contacts on the ridge.', channel: 'Calder Watch, drill net' }, 5);
    expect(place).toContain('awf-plate');
    expect(place).not.toContain('<img');
    expect(place).toContain('Calder Watch, drill net');
  });

  it('types the line out: the typed part, then the part still to come, laid out but not seen', () => {
    const half = view(rookLine, 8);
    expect(half).toContain('<span aria-hidden="true">Hold the</span><span aria-hidden="true" class="awf-dlg-rest"> line, Captain.</span>');
    expect(half).toContain('data-complete="no"');
    expect(half).not.toContain('awf-dlg-more');
    const whole = view(rookLine, 999);
    expect(whole).toContain('data-complete="yes"');
    expect(whole).toContain('awf-dlg-more');
    // a screen reader gets the whole line from the first frame
    expect(half).toContain('<span class="awf-sr">Hold the line, Captain.</span>');
  });

  it('shows the line counter as two digits', () => {
    expect(textOf(view(rookLine, 3))).toContain('03/11');
  });

  it('shows the line as text: markup in a line is escaped, never run', () => {
    const planted = view({ speaker: 'echo', side: 'left', text: '<img src=x onerror=alert(1)> and <b>bold</b> & "quotes"' }, 999);
    expect(planted).not.toContain('<img src=x');
    expect(planted).not.toContain('<b>bold');
    expect(planted).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(planted).toContain('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quotes&quot;');
  });

  it('no front-door source sets markup from text: no dangerouslySetInnerHTML anywhere', () => {
    const scan = (text: string): boolean => /dangerouslySetInnerHTML/.test(text);
    // the scanner finds a planted use, so a clean result below means something
    expect(scan('<div dangerouslySetInnerHTML={{ __html: x }} />')).toBe(true);
    const dir = new URL('.', import.meta.url);
    const files = readdirSync(dir).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(scan(readFileSync(new URL(f, dir), 'utf8')), f).toBe(false);
  });
});

describe('the briefing screen', () => {
  const render = (m: (typeof MISSIONS)[number], initial?: BriefingState): string => renderToStaticMarkup(createElement(BriefingView, { mission: m, webgl2: false, ...(initial ? { initial } : {}) }));

  it('opens on the first line of the mission, with the mission\'s act, number, title and place, and Skip and Escape on offer', () => {
    const m = MISSIONS.find((x) => x.id === 'root-and-branch')!;
    const html = render(m);
    expect(html).toContain('data-screen="briefing"');
    expect(html).toContain('data-phase="dialogue"');
    expect(html).toContain('data-line="0"');
    expect(textOf(html)).toContain('Act II · Mission 07');
    expect(textOf(html)).toContain(m.title);
    expect(textOf(html)).toContain(m.location);
    expect(html).toContain('data-action="skip"');
    expect(html).toContain('href="#/campaign"');
    // the first line is the narrator's, so there is no face on screen yet
    expect(m.briefing[0].speaker).toBe('narrator');
    expect(html).toContain('data-side="none"');
  });

  it('shows, for each mission, its objective, its sides and a Deploy link to its own watch route', () => {
    for (const m of MISSIONS) {
      const html = render(m, { phase: 'objective', index: m.briefing.length - 1, shown: 0 });
      const t = textOf(html);
      expect(html, m.id).toContain('data-phase="objective"');
      expect(t, m.id).toContain(m.objectiveText);
      expect(html, m.id).toContain(`href="#/mission/${m.id}/watch"`);
      expect(html.match(/class="awf-side"/g)?.length, m.id).toBe(m.players.length);
      expect(t, m.id).toContain('Your agent');
      for (const p of m.players) if (COMMANDERS[p.commander]) expect(t, `${m.id} ${p.commander}`).toContain(COMMANDERS[p.commander].name);
      // no Skip once there is nothing left to skip
      expect(html, m.id).not.toContain('data-action="skip"');
    }
  });

  it('says what the objective card\'s conditions are, the turn limit first when there is one', () => {
    const m = MISSIONS.find((x) => x.id === 'night-wing')!;
    expect(objectiveChips(m).map((c) => c.label)).toEqual(['Fog of war', 'Ion storm']);
    expect(objectiveChips({ ...m, turnLimit: 12 }).map((c) => c.label)).toEqual(['Limit 12 cycles', 'Fog of war', 'Ion storm']);
    expect(objectiveChips(MISSIONS[0]).map((c) => c.label)).toEqual(['Clear sight', 'Clear skies']);
  });

  it('says on the card that Deploy is Doctrine on every side and the player only watches', () => {
    const html = renderToStaticMarkup(createElement(ObjectiveCard, { mission: MISSIONS[0], onReplay: () => {} }));
    expect(textOf(html)).toContain('Doctrine (local rules) on every side');
    expect(textOf(html)).toContain('you watch');
  });
});
