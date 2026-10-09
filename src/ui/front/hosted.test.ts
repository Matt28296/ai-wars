// A hosted copy (H1): the preview is the same static build, served from a host no agent can reach. Its connect screen says "coming soon"
// instead of commands to copy, the title's choice says so too, and `#/live` shows that screen instead of opening a feed the host does not
// have. The agent's own page (127.0.0.1) and the dev server (localhost) are unchanged. Every check is run in both directions: the same render
// on an agent host must show the steps and the live view, so a check that cannot fail is caught.
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOSTED_ACTION, HOSTED_CHOICE, HOSTED_LINE, agentHostHere, isAgentHost } from './connect';
import { ConnectScreen } from './ConnectScreen';
import { FrontApp } from './FrontApp';
import { TitleScreen } from './TitleScreen';

function renderAll(el: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = '';
    const sink = new Writable({ write(chunk, _enc, cb) { html += chunk.toString(); cb(); } });
    sink.on('finish', () => resolve(html));
    const { pipe } = renderToPipeableStream(el, { onAllReady: () => pipe(sink), onError: reject });
  });
}
const textOf = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

/** The page as if it were served from this host. */
const servedFrom = (hostname: string): void => {
  vi.stubGlobal('window', { location: { hostname, hash: '' } });
};
afterEach(() => vi.unstubAllGlobals());

describe('which hosts an agent can reach', () => {
  it('is the agent\'s own server and the dev server, and nothing that only looks like them', () => {
    for (const h of ['127.0.0.1', 'localhost', 'LOCALHOST', '[::1]', '::1']) expect(isAgentHost(h), h).toBe(true);
    for (const h of ['ascendant-wars.example.chatgpt.site', '127.0.0.1.example.com', 'localhost.example.com', '127.0.0.2', '0.0.0.0', ''])
      expect(isAgentHost(h), h).toBe(false);
  });

  it('reads this page\'s own host; with no window (the server render) it is the agent\'s page', () => {
    expect(agentHostHere()).toBe(true);
    servedFrom('ascendant-wars.example.chatgpt.site');
    expect(agentHostHere()).toBe(false);
    servedFrom('127.0.0.1');
    expect(agentHostHere()).toBe(true);
  });
});

describe('the connect screen on a hosted copy', () => {
  it('says "coming soon" with one action, and nothing to copy or run', () => {
    const html = renderToStaticMarkup(createElement(ConnectScreen, { hosted: true }));
    const text = textOf(html);
    expect(html).toContain('data-hosted="yes"');
    expect(text).toContain(HOSTED_LINE);
    expect(text).toContain(HOSTED_ACTION);
    expect(html).not.toContain('data-step=');
    expect(html).not.toContain('data-copy=');
    expect(html).not.toContain('data-other');
    for (const word of ['pnpm', 'claude mcp', 'mcpServers', 'game folder']) expect(text, word).not.toContain(word);
    // one main action, to the campaign; no paragraphs (D-023)
    expect([...html.matchAll(/aw-btn--primary/g)]).toHaveLength(1);
    expect(html).toContain('href="#/campaign"');
    expect([...html.matchAll(/<p\b/g)]).toHaveLength(1);
  });

  it('is decided by the page\'s host when nobody says (known answer both ways)', () => {
    servedFrom('ascendant-wars.example.chatgpt.site');
    expect(renderToStaticMarkup(createElement(ConnectScreen))).toContain('data-hosted="yes"');
    servedFrom('127.0.0.1');
    const local = renderToStaticMarkup(createElement(ConnectScreen));
    expect(local).not.toContain('data-hosted');
    expect([...local.matchAll(/data-step="/g)]).toHaveLength(3);
    expect(textOf(local)).not.toContain(HOSTED_LINE);
  });
});

describe('the title on a hosted copy', () => {
  const connectDesc = (html: string): string => textOf(/<a[^>]*data-choice="connect"[\s\S]*?<\/a>/.exec(html)![0]);

  it('says the choice is coming soon there, and keeps its line on the agent\'s page', () => {
    servedFrom('ascendant-wars.example.chatgpt.site');
    expect(connectDesc(renderToStaticMarkup(createElement(TitleScreen, { webgl2: false })))).toContain(HOSTED_CHOICE);
    servedFrom('127.0.0.1');
    const local = connectDesc(renderToStaticMarkup(createElement(TitleScreen, { webgl2: false })));
    expect(local).toContain('Your AI commands your army.');
    expect(local).not.toContain(HOSTED_CHOICE);
  });
});

describe('#/live on a hosted copy', () => {
  it('shows the "coming soon" screen and never mounts the live view (which would open the feed)', async () => {
    servedFrom('ascendant-wars.example.chatgpt.site');
    const html = await renderAll(createElement(FrontApp, { hash: '#/live' }));
    expect(html).toContain('data-screen="connect"');
    expect(html).toContain('data-hosted="yes"');
    expect(html).not.toContain('data-screen="live"');
  });

  it('on the agent\'s own page still mounts the live view (known answer: the check above can fail)', async () => {
    servedFrom('127.0.0.1');
    const html = await renderAll(createElement(FrontApp, { hash: '#/live' }));
    expect(html).toContain('data-screen="live"');
    expect(html).not.toContain('data-hosted');
  });
});
