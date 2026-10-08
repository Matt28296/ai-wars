// The connect screen (G17, D-023): at most three short steps, each one copyable, no paragraphs; the same words as docs/AGENT.md; and a Copy that
// falls back to selecting the text when the clipboard is missing or refuses. Rendered on the server. Every checker is run against a planted
// violation (a fourth step, a two-sentence line, a copy that claims success it did not have).
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AFTER_STEPS, CONNECT_STEPS, GAME_FOLDER, OTHER_APPS, OTHER_APPS_TEXT, copyText } from './connect';
import type { CopyEnv } from './connect';
import { ConnectScreen, ConnectSteps } from './ConnectScreen';
import { parseRoute } from './router';

const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const textOf = (html: string): string => decode(html.replace(/<[^>]*>/g, ''));
const screen = (): string => renderToStaticMarkup(createElement(ConnectScreen));

/** The visible sentences in a piece of text: a full stop, question mark or exclamation mark that ends a word. */
const sentences = (text: string): number => (text.trim().match(/[.!?](?=\s|$)/g) ?? []).length;
/** A line is short when it is one sentence at most and a dozen words or fewer. */
const shortLine = (text: string): boolean => sentences(text) <= 1 && text.trim().split(/\s+/).length <= 12;

/** The prose lines of the screen: every paragraph, and the summary of the folded part. (Code is not prose.) */
function proseLines(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<(p|summary)\b[^>]*>([\s\S]*?)<\/\1>/g)) out.push(textOf(m[2]));
  return out;
}
/** The steps: the list items that carry a step. */
const stepsIn = (html: string): string[] => [...html.matchAll(/<li\b[^>]*data-step="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[0]);

describe('the three steps', () => {
  it('are exactly the order\'s: install once, add the server, ask the agent', () => {
    expect(CONNECT_STEPS).toHaveLength(3);
    expect(CONNECT_STEPS.map((s) => s.id)).toStrictEqual(['install', 'add', 'ask']);
    expect(CONNECT_STEPS.map((s) => s.copy)).toStrictEqual([
      'pnpm install',
      'claude mcp add ascendant-wars -- pnpm --silent --dir <game folder> agent',
      'Play Ascendant Wars mission 1.',
    ]);
    expect(CONNECT_STEPS[0].lead).toBe('In the game folder, once:');
    expect(CONNECT_STEPS[2].lead).toBe('Ask your agent:');
    expect(AFTER_STEPS).toBe('Your agent gives you a link to watch.');
  });

  it('say what docs/AGENT.md says: the same three commands, and the same JSON for other apps', () => {
    const doc = readFileSync(new URL('../../../docs/AGENT.md', import.meta.url), 'utf8');
    expect(doc).toContain('`pnpm install`');
    expect(doc).toContain(`\`${CONNECT_STEPS[1].copy.replace(GAME_FOLDER, '<path to ai-wars>')}\``);
    expect(doc).toContain(`"${CONNECT_STEPS[2].copy}"`);
    const block = /```json\n([\s\S]*?)\n```/.exec(doc);
    expect(block, 'the doc has a JSON block').not.toBeNull();
    expect(JSON.parse(block![1])).toStrictEqual(JSON.parse(OTHER_APPS_TEXT));
    expect(JSON.parse(OTHER_APPS_TEXT)).toStrictEqual(JSON.parse(JSON.stringify(OTHER_APPS)));
    // and the JSON is a real server entry: a command and its arguments, naming the game's server
    expect(JSON.parse(OTHER_APPS_TEXT).mcpServers['ascendant-wars']).toMatchObject({ command: 'pnpm' });
  });
});

describe('the connect screen', () => {
  it('shows exactly three steps, numbered, each with its own Copy button and the text that button copies', () => {
    const html = screen();
    const steps = stepsIn(html);
    expect(steps).toHaveLength(3);
    steps.forEach((step, i) => {
      const s = CONNECT_STEPS[i];
      expect(step).toContain(`data-step="${s.id}"`);
      expect(textOf(step), s.id).toContain(s.lead);
      // one Copy button, and it is labelled with exactly what it copies
      expect(step.match(/<button\b/g), s.id).toHaveLength(1);
      expect(step, s.id).toContain(`data-copy="${s.id}"`);
      expect(step, s.id).toContain(`aria-label="Copy: ${s.copy.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`);
      // the text on the panel is the text on the clipboard (the placeholder is drawn apart but reads the same)
      const code = /<code\b[^>]*data-copy-text[^>]*>([\s\S]*?)<\/code>/.exec(step)![1];
      expect(textOf(code), s.id).toBe(s.copy);
    });
    expect(html.match(/<ol\b/g)).toHaveLength(1);
  });

  it('draws <game folder> as a placeholder, and only in the step that has it', () => {
    const steps = stepsIn(screen());
    expect(steps[1]).toContain('<span class="awf-ph">&lt;game folder&gt;</span>');
    expect(steps[0]).not.toContain('awf-ph');
    expect(steps[2]).not.toContain('awf-ph');
  });

  it('has the one line after the steps, the other apps folded away until asked for, and a quiet way to the built-in commander', () => {
    const html = screen();
    expect(html).toContain('data-then');
    expect(textOf(/<p\b[^>]*data-then[^>]*>([\s\S]*?)<\/p>/.exec(html)![1])).toBe('Your agent gives you a link to watch.');
    const other = /<details\b[^>]*data-other([^>]*)>([\s\S]*?)<\/details>/.exec(html)!;
    expect(other[1], 'folded: no open attribute').not.toContain('open');
    expect(textOf(/<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(other[2])![1])).toBe('Other apps');
    expect(textOf(other[2])).toContain('"mcpServers"');
    expect(other[2]).toContain('data-copy="other-apps"');
    expect(html).toMatch(/<a [^>]*href="#\/campaign"[^>]*>Or watch the built-in commander<\/a>/);
    expect(parseRoute('#/campaign')).toEqual({ kind: 'campaign' });
    // and a way back
    expect(html).toMatch(/<a [^>]*href="#\/"[^>]*>Title<\/a>/);
  });

  it('has no paragraph: every prose line is one short sentence at most', () => {
    const lines = proseLines(screen());
    expect(lines.length, 'setup: the screen has prose lines to check').toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(shortLine(l), `"${l}"`).toBe(true);
    expect(textOf(screen()).length, 'the whole screen is short').toBeLessThan(900);
  });

  it('the checkers see a planted fourth step, a second sentence and a long line (known-bad)', () => {
    const four = renderToStaticMarkup(createElement('ol', null, ...['a', 'b', 'c', 'd'].map((id) => createElement('li', { key: id, 'data-step': id }, id))));
    expect(stepsIn(four)).toHaveLength(4);
    expect(shortLine('Your agent gives you a link to watch.')).toBe(true);
    expect(shortLine('Your agent gives you a link. Open it to watch.')).toBe(false);
    expect(shortLine('Your agent gives you a link to watch the battle as it is fought on your own machine today')).toBe(false);
    expect(proseLines('<p class="x">One. Two.</p><summary>ok</summary>').filter((l) => !shortLine(l))).toStrictEqual(['One. Two.']);
  });

  it('is the same three steps wherever they are shown (the live view uses them when there is no feed)', () => {
    const html = renderToStaticMarkup(createElement(ConnectSteps));
    expect(stepsIn(html)).toHaveLength(3);
    expect(html).toContain('data-then');
  });
});

describe('Copy falls back to selecting the text', () => {
  const env = (writeText?: (t: string) => Promise<void> | void): { env: CopyEnv; select: ReturnType<typeof vi.fn> } => {
    const select = vi.fn();
    return { env: { clipboard: writeText ? { writeText: writeText as (t: string) => Promise<void> } : undefined, select }, select };
  };

  it('puts exactly the text on the clipboard when it works, and selects nothing', async () => {
    const write = vi.fn(async (_text: string) => {});
    const { env: e, select } = env(write);
    for (const step of CONNECT_STEPS) expect(await copyText(step.copy, e)).toBe('copied');
    expect(write.mock.calls.map((c) => c[0])).toStrictEqual(CONNECT_STEPS.map((s) => s.copy));
    expect(select).not.toHaveBeenCalled();
  });

  it('selects the text when there is no clipboard API', async () => {
    const { env: e, select } = env();
    expect(await copyText('pnpm install', e)).toBe('selected');
    expect(select).toHaveBeenCalledTimes(1);
    expect(await copyText('x', { clipboard: null, select: select as () => void })).toBe('selected');
    expect(await copyText('x', { clipboard: {}, select: select as () => void })).toBe('selected');
  });

  it('selects the text when the clipboard refuses, whether it rejects or throws (and does not claim a copy it did not make)', async () => {
    for (const refuse of [() => Promise.reject(new Error('NotAllowedError')), () => { throw new Error('SecurityError'); }]) {
      const { env: e, select } = env(refuse);
      expect(await copyText('pnpm install', e)).toBe('selected');
      expect(select).toHaveBeenCalledTimes(1);
    }
  });

  it('calls the clipboard as a method (a clipboard whose writeText needs its own this still works)', async () => {
    const clipboard = { got: '', async writeText(this: { got: string }, t: string): Promise<void> { this.got = t; } };
    expect(await copyText('abc', { clipboard, select: () => {} })).toBe('copied');
    expect(clipboard.got).toBe('abc');
  });

  it('the whole of "Other apps" is one copy: the JSON, as shown', async () => {
    const write = vi.fn(async (_text: string) => {});
    await copyText(OTHER_APPS_TEXT, { clipboard: { writeText: write }, select: () => {} });
    expect(JSON.parse(write.mock.calls[0][0])).toStrictEqual(JSON.parse(JSON.stringify(OTHER_APPS)));
  });
});
