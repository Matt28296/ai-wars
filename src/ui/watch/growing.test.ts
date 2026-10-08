// A match that is still being computed (G14): the record and timeline grow by what arrived, playback waits at the edge instead of stopping, and
// the log takes a note. Expected answers are the whole-match functions (recordMatch, viewTimeline) and the plain playback reducer, never the
// incremental ones read back. The demo's own page, with none of the new props, must stay byte for byte what it was (watchSlots.test.ts holds the
// stronger markup check; here the new props that must change nothing are named).
import { createElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { stateHash } from '../../game/aw/replay';
import { Controls } from './Controls';
import { initialPlayback, livePlaybackReducer, playbackReducer } from './controls';
import type { PlaybackAction, PlaybackState } from './controls';
import { buildDemoMatch } from './demo';
import { buildLog, mergeNotes } from './format';
import type { LogNote } from './format';
import { extendRecord, extendTimeline, recordMatch, viewTimeline } from './timeline';
import type { Viewer } from './timeline';
import { WatchView } from './WatchView';

const demo = buildDemoMatch();
const hashes = (r: ReturnType<typeof recordMatch>): string[] => r.states.map(stateHash);

describe('extendRecord and extendTimeline', () => {
  const chunks = [30, 31, 31, 90, demo.actions.length];

  it('give exactly the whole-match record and timeline for every viewer, however the match grew', () => {
    let rec: ReturnType<typeof recordMatch> | null = null;
    const tls: Partial<Record<string, ReturnType<typeof viewTimeline>>> = {};
    for (const n of chunks) {
      const actions = demo.actions.slice(0, n);
      rec = extendRecord(rec, demo.setup, actions);
      const whole = recordMatch(demo.setup, actions);
      expect(hashes(rec), `${n} actions`).toStrictEqual(hashes(whole));
      expect(rec.rawEvents).toStrictEqual(whole.rawEvents);
      expect(rec.actions).toStrictEqual(whole.actions);
      for (const v of [0, 1, 'all'] as Viewer[]) {
        const tl = extendTimeline(tls[String(v)] ?? null, rec, v);
        tls[String(v)] = tl;
        expect(tl, `${n} actions, viewer ${v}`).toStrictEqual(viewTimeline(whole, v));
      }
    }
  }, 60_000);

  it('keeps what it has already built (the same state and step objects) and applies only the new actions', () => {
    const a = extendRecord(null, demo.setup, demo.actions.slice(0, 40));
    const b = extendRecord(a, demo.setup, demo.actions.slice(0, 41));
    expect(b.states.length).toBe(a.states.length + 1);
    for (let i = 0; i < a.states.length; i++) expect(b.states[i], `state ${i}`).toBe(a.states[i]);
    expect(extendRecord(b, demo.setup, demo.actions.slice(0, 41)), 'nothing new: the same record').toBe(b);
    const t1 = extendTimeline(null, a, 0);
    const t2 = extendTimeline(t1, b, 0);
    for (let i = 0; i < t1.steps.length; i++) expect(t2.steps[i], `step ${i}`).toBe(t1.steps[i]);
    expect(extendTimeline(t2, b, 0)).toBe(t2);
  }, 60_000);

  it('records the whole match again, rightly, when it is not a growth of what it holds (another setup, a shorter list, an action that is not the same object)', () => {
    const a = extendRecord(null, demo.setup, demo.actions.slice(0, 40));
    const copies = demo.actions.slice(0, 50).map((x) => structuredClone(x));
    expect(hashes(extendRecord(a, demo.setup, copies))).toStrictEqual(hashes(recordMatch(demo.setup, copies)));
    expect(hashes(extendRecord(a, demo.setup, demo.actions.slice(0, 20)))).toStrictEqual(hashes(recordMatch(demo.setup, demo.actions.slice(0, 20))));
    const other = { ...demo.setup };
    expect(hashes(extendRecord(a, other, demo.actions.slice(0, 45)))).toStrictEqual(hashes(recordMatch(other, demo.actions.slice(0, 45))));
    // a timeline for another viewer is not grown: it is built for the viewer asked for
    const t0 = extendTimeline(null, a, 0);
    expect(extendTimeline(t0, a, 1)).toStrictEqual(viewTimeline(a, 1));
  }, 60_000);

  it('still refuses an illegal action, naming its position', () => {
    const bad = [...demo.actions.slice(0, 5), { kind: 'move', unitId: 99999, path: [{ x: 0, y: 0 }], then: { kind: 'wait' } } as never, ...demo.actions.slice(5, 8)];
    const a = extendRecord(null, demo.setup, demo.actions.slice(0, 5));
    expect(() => extendRecord(a, demo.setup, bad.slice(0, 7))).toThrow(/action #5/);
  });
});

describe('playback while the match is still being computed', () => {
  const run = (reducer: (s: PlaybackState, a: PlaybackAction) => PlaybackState, s: PlaybackState, ...actions: PlaybackAction[]): PlaybackState => actions.reduce(reducer, s);

  it('the plain reducer is unchanged: it stops at the last step, and Play from the end starts over (the known-bad twin of the live one)', () => {
    const s = run(playbackReducer, initialPlayback(3, { playing: true }), { type: 'advance' }, { type: 'advance' }, { type: 'advance' });
    expect(s).toMatchObject({ step: 3, playing: false });
    expect(playbackReducer(s, { type: 'play' })).toMatchObject({ step: 0, playing: true });
    expect(playbackReducer({ ...s, playing: true }, { type: 'advance' })).toMatchObject({ step: 3, playing: false });
  });

  it('the live reducer keeps playing at the edge, does not start over on Play, and goes on when the match grows', () => {
    let s = run(livePlaybackReducer, initialPlayback(3, { playing: true }), { type: 'advance' }, { type: 'advance' }, { type: 'advance' });
    expect(s).toMatchObject({ step: 3, last: 3, playing: true });
    expect(livePlaybackReducer(s, { type: 'advance' })).toBe(s);
    expect(livePlaybackReducer({ ...s, playing: false }, { type: 'play' })).toMatchObject({ step: 3, playing: true });
    expect(livePlaybackReducer({ ...s, playing: false }, { type: 'toggle' })).toMatchObject({ step: 3, playing: true });
    s = livePlaybackReducer(s, { type: 'newTimeline', last: 8, grow: true });
    expect(s).toMatchObject({ step: 3, last: 8, playing: true });
    expect(livePlaybackReducer(s, { type: 'advance' })).toMatchObject({ step: 4, animate: true, playing: true });
  });

  it('a growth changes only the length: an animation in flight is not cut, and a pause stays a pause', () => {
    const mid: PlaybackState = { step: 3, last: 3, playing: true, speed: 2, animate: true };
    expect(livePlaybackReducer(mid, { type: 'newTimeline', last: 9, grow: true })).toStrictEqual({ ...mid, last: 9 });
    const paused = { ...mid, playing: false };
    expect(livePlaybackReducer(paused, { type: 'newTimeline', last: 9, grow: true })).toStrictEqual({ ...paused, last: 9 });
    // a new timeline that is NOT a growth (another viewer) still snaps, as before
    expect(livePlaybackReducer(mid, { type: 'newTimeline', last: 9 })).toMatchObject({ animate: false });
  });

  it('the viewer\'s own controls still work at the edge: a manual step pauses, back rewinds, and a scrub to the edge keeps playing', () => {
    const edge: PlaybackState = { step: 5, last: 5, playing: true, speed: 1, animate: true };
    expect(livePlaybackReducer(edge, { type: 'back' })).toMatchObject({ step: 4, playing: false });
    expect(livePlaybackReducer(edge, { type: 'pause' })).toMatchObject({ playing: false });
    expect(livePlaybackReducer({ ...edge, step: 2 }, { type: 'seek', step: 5 })).toMatchObject({ step: 5, playing: true });
    expect(playbackReducer({ ...edge, step: 2 }, { type: 'seek', step: 5 })).toMatchObject({ step: 5, playing: false });
  });

  it('never leaves its bounds, over a long run of random actions with the match growing', () => {
    const kinds: PlaybackAction[] = [
      { type: 'toggle' }, { type: 'play' }, { type: 'pause' }, { type: 'forward' }, { type: 'back' }, { type: 'seek', step: 4 }, { type: 'seek', step: 99 },
      { type: 'advance' }, { type: 'advance' }, { type: 'advance' }, { type: 'newTimeline', last: 12, grow: true }, { type: 'newTimeline', last: 12 },
    ];
    let seed = 7;
    const next = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    for (let trial = 0; trial < 100; trial++) {
      let s = initialPlayback(6);
      for (let i = 0; i < 80; i++) {
        s = livePlaybackReducer(s, kinds[next() % kinds.length]);
        expect(s.step).toBeGreaterThanOrEqual(0);
        expect(s.step).toBeLessThanOrEqual(s.last);
      }
    }
  });
});

describe('the log takes notes', () => {
  const base = buildLog(viewTimeline(recordMatch(demo.setup, demo.actions.slice(0, 60)), 0).steps);

  it('with no notes it is the very same array', () => {
    expect(mergeNotes(base, undefined)).toBe(base);
    expect(mergeNotes(base, [])).toBe(base);
  });

  it('puts a note after every line of its own step and before the lines of any later step, whatever order the notes come in', () => {
    const steps = [...new Set(base.map((l) => l.step))];
    const at = steps[3];
    const notes: LogNote[] = [{ step: steps[5], text: 'later' }, { step: at, text: 'Cycle 2 · Armour: Advance' }];
    const out = mergeNotes(base, notes);
    expect(out).toHaveLength(base.length + 2);
    const i = out.findIndex((l) => l.text === 'Cycle 2 · Armour: Advance');
    expect(out[i]).toMatchObject({ step: at, tone: 'info', kind: 'orders', faction: null });
    expect(out[i - 1].step).toBe(at);
    expect(out[i + 1].step).toBeGreaterThan(at);
    expect(out.map((l) => l.step), 'still in order of step').toStrictEqual([...out.map((l) => l.step)].sort((a, b) => a - b));
    expect(out.findIndex((l) => l.text === 'later')).toBeGreaterThan(i);
    expect(out.filter((l) => l.kind !== 'orders')).toStrictEqual(base);
    // a note beyond the last line goes last
    expect(mergeNotes(base, [{ step: 9999, text: 'end' }]).at(-1)?.text).toBe('end');
  });
});

describe('the new props change nothing they were not asked to', () => {
  beforeAll(() => {
    const error = console.error.bind(console);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });
  afterAll(() => vi.restoreAllMocks());
  const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');
  const render = (extra: Record<string, unknown> = {}): string =>
    bare(renderToString(createElement(WatchView, { setup: demo.setup, actions: demo.actions, viewer: 0, ...extra } as never)));
  let base = '';
  beforeAll(() => { base = render(); }); // after the spy above, so the layout-effect warning is not printed

  it('a page with no `live`, no notes and no slot is the page it always was; `logNotes` of none, and a closed-over match with nothing left to compute, add no markup', () => {
    expect(render({ live: undefined, logNotes: undefined, ordersSlot: undefined })).toBe(base);
    expect(render({ logNotes: [] })).toBe(base);
    expect(base).not.toContain('Orders');
    expect(base).not.toContain('data-thinking');
  });

  it('with `live` given the page is the same until playback has caught up with the match (nothing is drawn for a view that has not)', () => {
    expect(render({ live: { open: true } })).toBe(base);
    expect(render({ live: { open: false } })).toBe(base);
  });

  it('the orders slot sits in the slim bar\'s right group (G18), before Details and the View menu that now holds the toggles, and nowhere else', () => {
    const probe = createElement('button', { id: 'orders-probe' }, 'Orders probe');
    const h = render({ ordersSlot: probe, onViewerChange: () => {} });
    expect(h).toContain('<button id="orders-probe">Orders probe</button>');
    const bar = h.slice(h.indexOf('<header class="aww-bar"'), h.indexOf('</header>'));
    const row = bar.slice(bar.indexOf('class="aww-toolbar-row"'));
    expect(row.indexOf('orders-probe')).toBeGreaterThan(-1);
    expect(row.indexOf('orders-probe')).toBeLessThan(row.indexOf('data-action="details"'));
    expect(row.indexOf('data-action="details"')).toBeLessThan(row.indexOf('data-action="view"'));
    expect(row.indexOf('orders-probe')).toBeLessThan(row.indexOf('aww-viewer'));
    expect(h.split('orders-probe').length - 1).toBe(1);
    // the slot is simply added to the bar: the page with it is the page without it, plus the probe
    expect(render({ ordersSlot: probe })).not.toBe(base);
    expect(render({ ordersSlot: probe }).replace('<button id="orders-probe">Orders probe</button>', '')).toBe(base);
  });

  it('the controls say Thinking only when asked to, in one quiet word', () => {
    const tl = viewTimeline(recordMatch(demo.setup, demo.actions.slice(0, 20)), 0);
    const state = initialPlayback(tl.last);
    const quiet = renderToStaticMarkup(createElement(Controls, { state, dispatch: () => {}, timeline: tl }));
    const thinking = renderToStaticMarkup(createElement(Controls, { state, dispatch: () => {}, timeline: tl, thinking: true }));
    expect(quiet).not.toContain('Thinking');
    expect(thinking).toContain('data-thinking="yes"');
    expect(thinking).toContain('role="status"');
    expect(thinking.replace(/<[^>]*>/g, '').match(/Thinking…/g)).toHaveLength(1);
  });
});
