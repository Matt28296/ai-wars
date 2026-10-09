// The watch view's three optional slots (G13): `overlay`, `onStep` and `hold`. Absent, the page is byte for byte what it was; given, the
// overlay sits inside the stage area and nothing else on the page moves. Rendered on the server (effects do not run there; what onStep
// and hold DO with a live view was exercised in a real browser, see the order's receipt).
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WatchView, buildDemoMatch } from '../watch';
import type { WatchViewProps } from '../watch';

const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');

describe('the watch view\'s overlay, onStep and hold slots', () => {
  // The watch board lays itself out in a layout effect, which React warns about on the server. That is the old view's own habit, not news.
  beforeAll(() => {
    const error = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });
  afterAll(() => vi.restoreAllMocks());

  const match = buildDemoMatch();
  const render = (extra: Partial<WatchViewProps> = {}): string =>
    bare(renderToString(createElement(WatchView, { setup: match.setup, actions: match.actions, viewer: 0, ...extra })));
  let base = '';
  beforeAll(() => { base = render(); }); // after the spy above, so the layout-effect warning is not printed
  const PROBE = '<p id="story-probe">probe</p>';
  const probe = createElement('p', { id: 'story-probe' }, 'probe');

  it('adds nothing when the slots are absent: the stage is a direct child of the page grid, as it always was', () => {
    expect(base).toContain('<div class="aww-main"><div class="aww-stage"');
    expect(base).not.toContain('aww-stagebox');
    expect(base).not.toContain('aww-overlay');
    expect(render({ overlay: undefined, onStep: undefined, hold: undefined })).toBe(base);
  });

  it('draws the same page with onStep and hold given and no overlay: neither changes a pixel (hold is false by default and only gates playback)', () => {
    expect(render({ onStep: () => {} })).toBe(base);
    expect(render({ hold: true })).toBe(base);
    expect(render({ hold: false })).toBe(base);
    expect(render({ hold: true, onStep: () => {}, autoPlay: true })).toBe(render({ autoPlay: true }));
  });

  it('puts the overlay inside the stage area, after the board and before the playback row', () => {
    const h = render({ overlay: probe });
    expect(h).toContain('<div class="aww-main"><div class="aww-stagebox"><div class="aww-stage"');
    expect(h).toContain(`<div class="aww-overlay">${PROBE}</div></div>`);
    expect(h.indexOf('class="aww-stage"')).toBeLessThan(h.indexOf('class="aww-overlay"'));
    expect(h.indexOf('class="aww-overlay"')).toBeLessThan(h.indexOf('class="aww-bottom"'));
    expect(h.indexOf('class="aww-board-wrap"')).toBeLessThan(h.indexOf('class="aww-overlay"'));
    // known-bad twin: without it there is no probe anywhere
    expect(base).not.toContain('story-probe');
  });

  it('changes nothing else on the page: take the overlay and its box away and the markup is the one without it', () => {
    const h = render({ overlay: probe });
    const without = h.replace('<div class="aww-stagebox">', '').replace(`<div class="aww-overlay">${PROBE}</div></div>`, '');
    expect(without).toBe(base);
  });

  it('counts an empty overlay as given (null): the box is there for an overlay that has nothing to show yet', () => {
    const h = render({ overlay: null });
    expect(h).toContain('<div class="aww-stagebox">');
    expect(h).toContain('<div class="aww-overlay"></div>');
  });

  it('keeps the viewer toggle, the controls, the intel card and the log when an overlay is given (G18: the last three are in the drawer, once it is open)', () => {
    const h = render({ overlay: probe, onViewerChange: () => {}, initialDrawer: 'players' });
    for (const part of ['aww-viewer', 'aww-controls', 'aww-intel', 'aww-log', 'aww-huds']) expect(h, part).toContain(part);
    // shut, the drawer's three are not drawn and the other two are
    const shut = render({ overlay: probe, onViewerChange: () => {} });
    for (const part of ['aww-viewer', 'aww-controls']) expect(shut, part).toContain(part);
    for (const part of ['aww-intel', 'aww-log', 'aww-huds']) expect(shut, part).not.toContain(part);
  });
});
