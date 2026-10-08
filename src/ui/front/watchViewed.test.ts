// The watch view's `viewed` prop (G17): a growing timeline that arrives already viewed, for the connected agent's live feed. Given nothing, the view
// is the page it always was (watchSlots.test.ts and growing.test.ts hold that for every other prop); given `viewed`, it draws exactly what the
// record-built view of the same seat draws, builds no record while that seat is the viewer, and needs the record for any other viewer.
// Rendered on the server: effects do not run there, so the growth itself is exercised in a real browser (the order's receipt).
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WatchView, buildDemoMatch } from '../watch';
import type { TimelineStep, Viewer } from '../watch';
import { recordMatch, viewTimeline } from '../watch/timeline';
import type { WatchViewProps } from '../watch';

const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');

describe('WatchView with `viewed`', () => {
  beforeAll(() => {
    const error = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });
  afterAll(() => vi.restoreAllMocks());

  const demo = buildDemoMatch();
  const truth = recordMatch(demo.setup, demo.actions);
  /** Seat 0's steps as the feed sends them: the engine's player view, with the action kept only for the seat's own turns. */
  const fed: TimelineStep[] = viewTimeline(truth, 0).steps.map((st, i) => ({ ...st, action: i > 0 && truth.states[i - 1].current === 0 ? st.action : null }));
  const render = (extra: Record<string, unknown>): string => bare(renderToString(createElement(WatchView, extra as unknown as WatchViewProps)));
  const byRecord = (viewer: Viewer, extra: Record<string, unknown> = {}): string => render({ setup: demo.setup, actions: demo.actions, viewer, ...extra });
  const byFeed = (steps: readonly TimelineStep[], extra: Record<string, unknown> = {}): string => render({ viewed: steps, viewer: 0, ...extra });

  it('draws the same page the record-built view draws, at the first step, a middle one and the last', () => {
    for (const at of [0, 1, 40, fed.length - 1]) {
      expect(byFeed(fed, { initialStep: at }), `step ${at}`).toBe(byRecord(0, { initialStep: at }));
    }
  });

  it('draws only the steps it has been given: a match that is three steps old is a three-step page', () => {
    const three = fed.slice(0, 3);
    const h = byFeed(three, { initialStep: 2, live: { open: true } });
    expect(h).toContain('data-step="2"');
    expect(h).not.toBe(byFeed(fed, { initialStep: 2 }));
    // its controls know the match is three steps long
    expect(byFeed(three, { initialStep: 99, live: { open: true } })).toContain('data-step="2"');
  });

  it('opens playing even on step 0 alone, and says Thinking at the edge while more may come (not once the match is over)', () => {
    const first = fed.slice(0, 1);
    expect(byFeed(first, { autoPlay: true, live: { open: true } })).toContain('data-thinking="yes"');
    expect(byFeed(first, { autoPlay: true, live: { open: false } })).not.toContain('data-thinking');
    // not asked to play: it waits for the viewer, as ever
    expect(byFeed(first, { live: { open: true } })).not.toContain('data-thinking');
    // a record-built view of one step is not turned into a playing one (the edge case is only for a fed match)
    expect(byRecord(0, { actions: [], autoPlay: true, live: { open: true } })).not.toContain('data-thinking');
  });

  it('builds no record while the viewer is the seat: no setup and no actions are needed, and none are read', () => {
    const h = byFeed(fed.slice(0, 5), { live: { open: true }, setup: undefined, actions: undefined });
    expect(h).toContain('aww-root');
    // the same page if a record is offered too (it is for the other viewers only)
    expect(byFeed(fed.slice(0, 5), { live: { open: true }, setup: demo.setup, actions: demo.actions })).toBe(h);
  });

  it('really builds none: a record that could not be built (an illegal action) is never touched for the seat, and is for any other viewer', () => {
    const illegal = [{ kind: 'move', unitId: 99999, path: [{ x: 0, y: 0 }], then: { kind: 'wait' } }];
    const handed = { viewed: fed.slice(0, 5), setup: demo.setup, actions: illegal, live: { open: true } };
    expect(render({ ...handed, viewer: 0 })).toContain('aww-root');
    expect(() => render({ ...handed, viewer: 'all' })).toThrow(/illegal/);
  });

  it('draws another viewer from the record: the "All" view is the record-built one, and the seat\'s own view still comes from the steps', () => {
    const all = render({ viewed: fed, setup: demo.setup, actions: demo.actions, viewer: 'all', initialStep: 40 });
    expect(all).toBe(byRecord('all', { initialStep: 40 }));
    expect(all).toContain('data-viewer="all"');
    const other = render({ viewed: fed, setup: demo.setup, actions: demo.actions, viewer: 1, initialStep: 12 });
    expect(other).toBe(byRecord(1, { initialStep: 12 }));
  });

  it('refuses what it cannot draw: another viewer with no record (known-bad), and no steps at all', () => {
    expect(() => render({ viewed: fed.slice(0, 4), viewer: 'all' })).toThrow(/needs `setup` and `actions`/);
    expect(() => render({ viewed: fed.slice(0, 4), viewer: 1 })).toThrow(/needs `setup` and `actions`/);
    expect(() => render({ viewed: [], viewer: 0 })).toThrow(/step 0/);
    // the record-built view still refuses a missing record by name, rather than reading undefined
    expect(() => render({ viewer: 0 })).toThrow(/needs `setup` and `actions`/);
  });

  it('with `viewed` absent the page is the one it always was', () => {
    const base = byRecord(0);
    expect(byRecord(0, { viewed: undefined })).toBe(base);
    expect(byRecord(0, { viewed: undefined, live: { open: false } })).toBe(base);
    expect(base).not.toContain('data-thinking');
  });
});
