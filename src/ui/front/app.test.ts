// The front door as a whole: the title without WebGL2, each route's screen, and the legacy demo link opening exactly the view it opened
// before the front door existed. Rendered on the server with every lazy chunk resolved.
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup, renderToPipeableStream, renderToString } from 'react-dom/server';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MISSIONS } from '../../content/missions';
import { MAPS } from '../../content/maps';
import { FACTIONS } from '../../data';
import { WatchView, buildDemoMatch, parseHash } from '../watch';
import { FrontApp } from './FrontApp';
import { TitleScreen } from './TitleScreen';
import { titleScene } from './scene';
import { detectWebGL2 } from '../board3d/stage/support';

/** Renders to a string once every Suspense boundary (the lazy screens) has resolved. */
function renderAll(el: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = '';
    const sink = new Writable({ write(chunk, _enc, cb) { html += chunk.toString(); cb(); } });
    sink.on('finish', () => resolve(html));
    const { pipe } = renderToPipeableStream(el, { onAllReady: () => pipe(sink), onError: reject });
  });
}
/** Comment markers (Suspense boundaries, text joins) are not part of what is on the page. */
const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');

describe('the title without WebGL2', () => {
  const html = (webgl2?: boolean): string => renderToStaticMarkup(createElement(TitleScreen, webgl2 === undefined ? {} : { webgl2 }));

  it('is a browser with no WebGL2: the probe says no where there is no document, and says no for a context that will not come', () => {
    expect(detectWebGL2()).toBe(false);
    expect(detectWebGL2({ createElement: () => ({ getContext: () => null }) })).toBe(false);
    expect(detectWebGL2({ createElement: () => ({ getContext: () => { throw new Error('blocked'); } }) })).toBe(false);
  });

  it('draws the still, made of the design-system tiles and unit tokens, and no canvas', () => {
    for (const h of [html(), html(false)]) {
      expect(h).toContain('data-mode="still"');
      expect(h).toContain('data-still="tiles"');
      expect(h).not.toContain('<canvas');
      const scene = titleScene();
      expect(h.match(/data-terrain="/g)?.length).toBe(scene.width * scene.height);
      expect(h.match(/class="aw-unit[ "]/g)?.length).toBe(scene.units.length);
      expect(scene.width * scene.height).toBe(MAPS['calder-fields'].terrain.length * MAPS['calder-fields'].terrain[0].length);
    }
  });

  it('still has the name, the three choices and the five nations', () => {
    const h = html(false);
    expect(h).toContain('Ascendant<br/>Wars');
    expect(h).toContain('<h1');
    expect(h).toMatch(/<a [^>]*href="#\/campaign"[^>]*>[\s\S]*?Campaign/);
    expect(h).toMatch(/<a [^>]*href="#play=1"[^>]*>[\s\S]*?Watch a battle/);
    expect(h).toMatch(/<button [^>]*disabled=""[^>]*>[\s\S]*?Agent console/);
    expect(h).toContain('aria-label="Agent console (coming with the platform)"');
    for (const f of Object.values(FACTIONS)) expect(h, f.id).toContain(f.short);
    expect(h.match(/class="aw-sigil"/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('puts the first choice first in the order of the page, so the keyboard starts on it', () => {
    const h = html(false);
    expect(h.indexOf('data-choice="campaign"')).toBeGreaterThan(-1);
    expect(h.indexOf('data-choice="campaign"')).toBeLessThan(h.indexOf('data-choice="watch"'));
    expect(h.indexOf('data-choice="watch"')).toBeLessThan(h.indexOf('data-choice="console"'));
  });
});

describe('the screens behind the routes', () => {
  it('opens the title for no hash, the campaign map with a card for every mission, and a briefing on its first line', async () => {
    const title = await renderAll(createElement(FrontApp, { hash: '', webgl2: false }));
    expect(title).toContain('data-screen="title"');
    const campaign = await renderAll(createElement(FrontApp, { hash: '#/campaign', webgl2: false }));
    expect(campaign).toContain('data-screen="campaign"');
    expect(campaign.match(/data-mission="/g)?.length).toBe(MISSIONS.length);
    const briefing = await renderAll(createElement(FrontApp, { hash: '#/mission/first-light', webgl2: false }));
    expect(briefing).toContain('data-screen="briefing"');
    expect(briefing).toContain('data-phase="dialogue"');
  });

  it('opens Deploy on its loading card, never on the units', async () => {
    const deploy = await renderAll(createElement(FrontApp, { hash: '#/mission/first-light/watch', webgl2: false }));
    expect(deploy).toContain('data-screen="deploy"');
    expect(deploy).toContain('The battle is being fought');
    expect(deploy).toContain('Doctrine (local rules)');
    expect(deploy).not.toContain('aww-root');
  });

  it('answers a mission that does not exist, and an address that leads nowhere, with the way out', async () => {
    for (const hash of ['#/mission/nope', '#/mission/nope/watch', '#/nonsense', '#foo=bar', '#/mission/']) {
      const h = await renderAll(createElement(FrontApp, { hash, webgl2: false }));
      expect(h, hash).toContain('data-screen="lost"');
      expect(h, hash).toContain('href="#/"');
      expect(h, hash).toContain('href="#/campaign"');
      expect(h, hash).not.toContain('data-screen="briefing"');
    }
  });
});

describe('the demo links that existed before the front door', () => {
  // The watch board lays itself out in a layout effect, which React warns about on the server. That is the old view's own habit, not news.
  beforeAll(() => {
    const error = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });
  afterAll(() => vi.restoreAllMocks());
  const expectedFor = (hash: string): string => {
    // what the old main.tsx rendered for this hash: the demo match, the hash read once, the viewer toggle on
    const match = buildDemoMatch();
    const initial = parseHash(hash, match.setup.players.length);
    return renderToString(createElement(WatchView, {
      setup: match.setup, actions: match.actions, viewer: initial.viewer ?? 0, onViewerChange: () => {},
      initialStep: initial.step, initialSpeed: initial.speed, autoPlay: initial.play ?? initial.step === undefined, onPositionChange: () => {},
    }));
  };

  for (const hash of ['#step=40&viewer=all', '#step=12&viewer=1&speed=2', '#play=1']) {
    it(`${hash} renders exactly the watch view the old mount rendered`, async () => {
      const got = bare(await renderAll(createElement(FrontApp, { hash, webgl2: false })));
      const want = bare(expectedFor(hash));
      expect(want).toContain('aww-root');
      expect(got).toBe(want);
      expect(got).not.toContain('awf-');
    });
  }

  it('opens at the step and the viewer the hash names', async () => {
    const got = await renderAll(createElement(FrontApp, { hash: '#step=40&viewer=all', webgl2: false }));
    expect(got).toContain('data-viewer="all"');
    expect(got).toContain('data-step="40"');
  });

  it('is not what a front-door route renders (a known-bad: the campaign is not the demo)', async () => {
    const campaign = bare(await renderAll(createElement(FrontApp, { hash: '#/campaign', webgl2: false })));
    expect(campaign).not.toBe(bare(expectedFor('#step=40&viewer=all')));
    expect(campaign).not.toContain('aww-root');
  });
});
