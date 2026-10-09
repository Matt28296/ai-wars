// `#/live` (G17): the connected agent's battle in the browser, tested without a browser. A real short match is played through the real MCP session and
// the real feed over a real socket, its messages are written out as the SSE text the wire carries, and that text is delivered to the page's own client
// by a scripted EventSource. Expected answers are the engine's: viewTimeline(recordMatch(setup, actions), 0), never the page's own state read back.
//
// D-016 is the point: during the match only the agent's own view exists on the page. The planted cases show the checkers can see the two ways to break
// it: a viewer switch (the "All" view) offered before the `record` message, and a page that asks for /record while the match runs.
import { createElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveMessage } from '../../agent/live';
import { MISSIONS } from '../../content/missions';
import { WatchView } from '../watch';
import { recordMatch, viewTimeline } from '../watch/timeline';
import type { TimelineStep } from '../watch';
import { WAITING, openLive, parseLiveMessage, reduceLive } from './liveFeed';
import type { LinkStatus, LiveViewState } from './liveFeed';
import { FakeEventSource, parseSse, scriptedMatch, sseText } from './liveTestkit';
import type { Scripted } from './liveTestkit';
import { LiveScreen, WAITING_LINE, seatScript } from './LiveView';
import type { Shown } from './LiveView';
import { resultCardOf, RANK_RULE } from './debrief';
import { scriptFor } from './missionScript';
import { ResultCardView } from './StoryOverlay';

const bare = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');
const json = <T,>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;
const fold = (messages: readonly LiveMessage[], reduce = reduceLive, from: LiveViewState = WAITING): LiveViewState => messages.reduce(reduce, from);
const mission = (id: string) => MISSIONS.find((m) => m.id === id)!;
/** The same run as an agent from before G19 would have sent it, with no `orders` message: the page must still play it, and these tests index into it. */
const legacy = (run: Scripted): Scripted => ({ ...run, messages: run.messages.filter((m) => m.type !== 'orders') });

/**
 * Does this page offer a way to look through any eyes but the agent's own: the "Watching as" switch, and its "All"?
 * (The 3D / 2D board switch reuses the class `aww-viewer`; it is not this, so the label is what is looked for.)
 */
const offersViewerSwitch = (html: string): boolean => html.includes('aria-label="Watching as"');
/** Does it show a result, a debrief or a result card? Those are built from the whole record. */
const showsResult = (html: string): boolean => html.includes('data-story="debrief"') || html.includes('awf-result') || html.includes('data-phase="result"');

let lightRun: Scripted;
let canopyRun: Scripted;
/** The same missions played to their end (a victory, and a defeat under fog), for the claims that need a whole match. */
let lightFull: Scripted;
let canopyFull: Scripted;
beforeAll(async () => {
  [lightRun, canopyRun, lightFull, canopyFull] = await Promise.all([scriptedMatch('first-light', 2), scriptedMatch('under-canopy', 2), scriptedMatch('first-light', 30), scriptedMatch('under-canopy', 30)]);
  const error = console.error.bind(console);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
    error(...args);
  });
}, 60_000);
afterAll(() => vi.restoreAllMocks());

describe('the setup of these tests', () => {
  it('a scripted match is setup, orders, steps 0..n, result, record, in order (G19: the agent plays it, so the orders never change)', () => {
    for (const run of [lightRun, canopyRun, lightFull, canopyFull]) {
      const kinds = run.messages.map((m) => m.type);
      expect(kinds.slice(0, 2)).toStrictEqual(['setup', 'orders']);
      expect(kinds.slice(-2)).toStrictEqual(['result', 'record']);
      expect(kinds.slice(2, -2).every((k) => k === 'step')).toBe(true);
      expect(kinds.length).toBe(run.record.actions.length + 1 + 4);
      expect(legacy(run).messages.length).toBe(run.record.actions.length + 1 + 3);
    }
  });
});

describe('the feed\'s messages, as the page reads them', () => {
  it('reads every message the real feed sends, from the wire text, and nothing else', () => {
    const wire = parseSse(sseText(lightRun.messages));
    expect(wire).toHaveLength(lightRun.messages.length);
    wire.forEach(({ event, data }, i) => {
      const m = parseLiveMessage(data);
      expect(m, `message ${i}`).not.toBeNull();
      expect(m!.type).toBe(event);
      expect(m).toStrictEqual(json(lightRun.messages[i]));
    });
  });

  it('ignores what is not a message (known-bad input)', () => {
    const step = lightRun.messages[2] as Extract<LiveMessage, { type: 'step' }>;
    const bad = [
      '', 'not json', 'null', '42', '[]', '"setup"', '{}', '{"type":"nope","match":1}', '{"type":"setup"}', '{"type":"setup","match":"1","mission":"x","seat":0,"cycleCap":30}',
      '{"type":"setup","match":1,"mission":7,"seat":0,"cycleCap":30}', '{"type":"step","match":1}', '{"type":"step","match":1,"step":{"index":0}}',
      JSON.stringify({ ...step, step: { ...step.step, events: 'x' } }), '{"type":"result","match":1}', '{"type":"record","match":1,"record":{}}',
      JSON.stringify({ type: 'record', match: 1, record: { setup: {}, actions: {}, result: {} } }),
    ];
    for (const text of bad) expect(parseLiveMessage(text), text).toBeNull();
  });
});

describe('the state of the page as the stream arrives', () => {
  /** The whole claim, as a function of the reducer, so a planted wrong reducer can be run through it. */
  const reachesTheEngineView = (reduce: typeof reduceLive, run: Scripted): void => {
    const state = fold(run.messages, reduce);
    const expected = json<TimelineStep[]>(viewTimeline(recordMatch(run.record.setup, run.record.actions), 0).steps);
    expect(state.steps.length).toBe(expected.length);
    // the same final frame as the engine's own player view
    expect(state.steps.at(-1)!.frame).toStrictEqual(expected.at(-1)!.frame);
    // and every frame and every event on the way there, the other seats' actions being withheld by the feed
    expect(state.steps.map((s) => ({ index: s.index, frame: s.frame, events: s.events, powerUses: s.powerUses }))).toStrictEqual(expected.map((s) => ({ index: s.index, frame: s.frame, events: s.events, powerUses: s.powerUses })));
  };

  it('ends on the same final frame as viewTimeline(recordMatch(setup, actions), 0), for a clear mission and a fogged one', () => {
    reachesTheEngineView(reduceLive, lightRun);
    reachesTheEngineView(reduceLive, canopyRun);
    // and for a whole match, a victory and a defeat (the cap is not what ended them)
    reachesTheEngineView(reduceLive, lightFull);
    reachesTheEngineView(reduceLive, canopyFull);
    expect(lightFull.record.result.reason).toBe('victory');
    expect(canopyFull.record.result.reason).toBe('defeat');
    expect(lightFull.record.actions.length).toBeGreaterThan(150);
    expect(mission('first-light').fog).toBe(false);
    expect(mission('under-canopy').fog).toBe(true);
  });

  it('a reducer that drops a step is caught by that check (known-bad twin)', () => {
    const dropsTheFifth: typeof reduceLive = (s, m) => (m.type === 'step' && m.step.index === 5 ? s : reduceLive(s, m));
    expect(() => reachesTheEngineView(dropsTheFifth, lightRun)).toThrow();
    const keepsOldFrame: typeof reduceLive = (s, m) => (m.type === 'step' && m.step.index === lightRun.record.actions.length ? s : reduceLive(s, m));
    expect(() => reachesTheEngineView(keepsOldFrame, lightRun)).toThrow();
  });

  it('is waiting until a setup, then playing, then over at the record, and holds the record only then', () => {
    expect(WAITING.phase).toBe('waiting');
    const phases = lightRun.messages.map((_, i) => fold(lightRun.messages.slice(0, i + 1)));
    expect(phases.map((s) => s.phase)).toStrictEqual(lightRun.messages.map((m) => (m.type === 'record' ? 'over' : 'playing')));
    // nothing of the whole truth is held before the record message arrives
    for (const s of phases.slice(0, -1)) expect(s.record).toBeNull();
    expect(phases.at(-1)!.record).toStrictEqual(json(lightRun.record));
    expect(phases.at(-2)!.result).not.toBeNull();
    expect(phases.at(-3)!.result).toBeNull();
  });

  it('a second setup starts the view over: new match, new steps, a new epoch', () => {
    const second = legacy(canopyRun).messages.slice(0, 3).map((m) => ({ ...m, match: 2 })) as LiveMessage[];
    const mid = fold(legacy(lightRun).messages.slice(0, 6));
    expect(mid.steps.length).toBe(5);
    expect(mid.epoch).toBe(1);
    const state = fold(second, reduceLive, mid);
    expect(state.epoch).toBe(2);
    expect(state.match).toBe(2);
    expect(state.mission).toBe('under-canopy');
    expect(state.steps).toHaveLength(2);
    expect(state.steps[0].index).toBe(0);
    expect(state.steps[0].frame).toStrictEqual(json((legacy(canopyRun).messages[1] as Extract<LiveMessage, { type: 'step' }>).step.frame));
    // a replay of the same match (the browser reconnected) also starts over, as the feed sends everything again from its setup
    const replay = fold(lightRun.messages, reduceLive, mid);
    expect(replay.epoch).toBe(2);
    expect(replay.steps).toHaveLength(lightRun.record.actions.length + 1);
  });

  it('a step of the match before is stale and changes nothing; a repeat, a gap and anything after the record are ignored too', () => {
    const [setup, s0, s1, s2] = legacy(lightRun).messages;
    const start = fold([setup, s0, s1]);
    expect(reduceLive(start, s1), 'repeat').toBe(start);
    expect(reduceLive(start, legacy(lightRun).messages[5]), 'gap').toBe(start);
    expect(reduceLive(start, { ...(s2 as Extract<LiveMessage, { type: 'step' }>), match: 9 }), 'another match').toBe(start);
    expect(reduceLive(WAITING, s0), 'before any setup').toBe(WAITING);
    expect(reduceLive(start, s2).steps).toHaveLength(3);
    const over = fold(lightRun.messages);
    expect(reduceLive(over, legacy(lightRun).messages[1]), 'after the record').toBe(over);
    // and orders after the record change nothing either
    expect(reduceLive(over, lightRun.messages[1]), 'orders after the record').toBe(over);
  });

  it('the planted reducer that keeps the old steps across a setup is caught by the same expectation', () => {
    const appends: typeof reduceLive = (s, m) => (m.type === 'setup' ? { ...reduceLive(s, m), steps: s.steps } : reduceLive(s, m));
    const both = [...legacy(lightRun).messages.slice(0, 5), ...legacy(canopyRun).messages.slice(0, 3)];
    expect(fold(both, reduceLive).steps).toHaveLength(2);
    expect(fold(both, appends).steps.length).not.toBe(2);
  });
});

describe('the script the seat can see', () => {
  it('without fog, the seat sees every event, so its beats are the mission\'s own beats (the engine\'s record read in full): the start, a first loss and the victory', () => {
    const m = mission('first-light');
    const truth = recordMatch(lightFull.record.setup, lightFull.record.actions);
    const view = viewTimeline(truth, 0).steps;
    const seen = scriptFor(m, seatScript(view));
    expect(seen).toStrictEqual(scriptFor(m, truth));
    // setup: the beats are not only the start; an event the seat saw and the end of the match fired too
    expect(seen.map((b) => b.step)).toStrictEqual([0, expect.any(Number), lightFull.record.actions.length]);
    expect(seen[1].step).toBeGreaterThan(0);
    // a prefix of the match gives the prefix of the beats (the view grows by one step at a time)
    for (const n of [10, seen[1].step - 1, seen[1].step, seen[1].step + 5]) {
      expect(scriptFor(m, seatScript(view.slice(0, n + 1)))).toStrictEqual(scriptFor(m, { states: truth.states.slice(0, n + 1), rawEvents: truth.rawEvents.slice(0, n) }));
    }
  });

  it('under fog, a beat never fires before the thing happened (it may fire later, when the seat sees it), the start beat is there from step 0, and the defeat is known to the seat', () => {
    const m = mission('under-canopy');
    const truth = recordMatch(canopyFull.record.setup, canopyFull.record.actions);
    const view = viewTimeline(truth, 0).steps;
    const trueFire = new Map<number, number>();
    for (const b of scriptFor(m, truth)) for (const e of b.events) trueFire.set(e, b.step);
    const seen = scriptFor(m, seatScript(view));
    expect(seen.some((b) => b.step === 0)).toBe(true);
    expect(seen.length, 'setup: more than the start fired').toBeGreaterThan(1);
    for (const b of seen) for (const e of b.events) expect(b.step, `event ${e}`).toBeGreaterThanOrEqual(trueFire.get(e) ?? Number.POSITIVE_INFINITY);
  });

  it('a seat that is shown no events fires no event-driven beat (the checker sees the planted blindness)', () => {
    const m = mission('first-light');
    const view = viewTimeline(recordMatch(lightFull.record.setup, lightFull.record.actions), 0).steps;
    const blind = { ...seatScript(view), rawEvents: view.slice(1).map(() => []) };
    expect(scriptFor(m, blind).length).toBeLessThan(scriptFor(m, seatScript(view)).length);
  });
});

describe('the screen at each moment (D-016: only the agent\'s own view until the record is here)', () => {
  const at = (run: Scripted, n: number): LiveViewState => fold(legacy(run).messages.slice(0, n));
  const screen = (state: LiveViewState, link: LinkStatus = 'open', shown?: Shown): string => bare(renderToString(createElement(LiveScreen, { state, link, shown })));

  it('before any mission: one quiet line, and nothing else of a battle', () => {
    const h = screen(WAITING);
    expect(h).toContain(WAITING_LINE);
    expect(WAITING_LINE).toBe('Waiting for your agent to start a mission.');
    expect(h.split(WAITING_LINE)).toHaveLength(2);
    expect(h).not.toContain('aww-root');
    expect(h).not.toContain('data-step');
    // not drawn at all while the browser has not yet heard from the feed (no flash before the steps of a page that has no feed)
    expect(screen(WAITING, 'connecting')).not.toContain(WAITING_LINE);
  });

  it('where there is no feed (the dev server, a hosted copy) it shows the three connect steps instead', () => {
    const h = screen(WAITING, 'unavailable');
    expect(h.match(/data-step="/g)).toHaveLength(3);
    expect(h).toContain('data-screen="connect"');
    expect(h).not.toContain(WAITING_LINE);
  });

  it('while the match runs: the board and the agent\'s view, "Thinking…" at the edge, and NO viewer switch and no result', () => {
    for (const run of [lightRun, canopyRun]) {
      for (const n of [2, 3, 6, run.messages.length - 3]) {
        const h = screen(at(run, n));
        expect(h, `${n} messages`).toContain('aww-root');
        expect(h, `${n} messages`).toContain('data-viewer="0"');
        expect(offersViewerSwitch(h), `${n} messages: a viewer switch was offered during the match`).toBe(false);
        expect(showsResult(h), `${n} messages: a result was shown during the match`).toBe(false);
        expect(h).not.toContain('data-viewer="all"');
      }
    }
    // step 0 alone: it plays on and waits for more
    expect(screen(at(lightRun, 2))).toContain('data-thinking="yes"');
    expect(screen(at(lightRun, 2))).toContain('data-phase="playing"');
  });

  it('the checker for "a viewer switch offered during the match" sees one (planted: the watch view given a switch and the agent\'s steps)', () => {
    const state = at(lightRun, 4);
    const planted = bare(renderToString(createElement(WatchView, { viewed: state.steps, viewer: 0, onViewerChange: () => {}, live: { open: true }, autoPlay: true })));
    expect(offersViewerSwitch(planted)).toBe(true);
    expect(planted).toContain('>All<');
    expect(offersViewerSwitch(screen(state))).toBe(false);
  });

  it('after the record: the viewer switch with "All", the result card, and the board from the whole record', () => {
    const over = fold(lightRun.messages);
    const h = screen(over);
    expect(h).toContain('data-phase="over"');
    expect(offersViewerSwitch(h)).toBe(true);
    expect(h).toContain('>All<');
    // the "All" view is built from the record: the same page the record-built watch view draws for it
    const all = bare(renderToString(createElement(WatchView, { viewed: over.steps, setup: lightRun.record.setup, actions: lightRun.record.actions, viewer: 'all', onViewerChange: () => {}, live: { open: false } })));
    expect(all).toContain('data-viewer="all"');
    expect(all).not.toContain('data-thinking');
    // and nothing says "Thinking" any more
    expect(h).not.toContain('data-thinking');
  });

  it('the result card here has no paragraph and no "Next mission": the main action is Watch again, and the rule is one hover away on the rank', () => {
    const over = fold(lightRun.messages);
    const h = screen(over, 'open', { step: lightRun.record.actions.length, resultRead: true });
    expect(h).toContain('data-phase="result"');
    expect(h).toContain('data-stage="result"');
    expect(h).not.toContain('awf-result-rule');
    expect(h).not.toContain('data-action="next"');
    expect(h).toMatch(/<button[^>]*class="aw-btn label aw-btn--primary"[^>]*data-action="again"/);
    expect(h).toContain('data-action="briefing"');
    expect(h).toContain(`title="${RANK_RULE}`);
    // and what it says is the engine's: the cycles of the record, read by the same formulas as Deploy's card
    const m = mission('first-light');
    const card = resultCardOf(m, recordMatch(lightRun.record.setup, lightRun.record.actions).states);
    expect(h).toContain(`data-outcome="${card.outcome}"`);
    expect(h).toContain(`par ${card.parCycles}`);
    // the debrief's own words are not read here until asked: at an ordinary first step there is no card at all
    expect(screen(over)).not.toContain('data-phase="result"');
  });

  it('the result card has no paragraph of rules anywhere, in the live view and in Deploy alike (G18): one card, the rule one hover away on the rank', () => {
    const m = mission('first-light');
    const card = resultCardOf(m, recordMatch(lightRun.record.setup, lightRun.record.actions).states);
    const deploy = renderToStaticMarkup(createElement(ResultCardView, { mission: m, card, next: mission('under-canopy'), onWatchAgain: () => {} }));
    const live = renderToStaticMarkup(createElement(ResultCardView, { mission: m, card, onWatchAgain: () => {} }));
    for (const h of [deploy, live]) {
      expect(h).not.toContain('awf-result-rule');
      expect(h).not.toContain('Your side is your agent');
      expect(h).toContain(`title="${RANK_RULE}`);
    }
    // the rank and the numbers are the same markup on both screens; only the buttons differ (Deploy has a next mission)
    const part = (h: string, open: string, close: string): string => h.slice(h.indexOf(open), h.indexOf(close, h.indexOf(open)) + close.length);
    expect(part(deploy, '<div class="awf-result-rank"', '</dl>')).toBe(part(live, '<div class="awf-result-rank"', '</dl>'));
    expect(deploy).toContain('data-action="next"');
    expect(live).not.toContain('data-action="next"');
  });

  it('the mission\'s people are Deploy\'s: the agent is "You", and the top bar names the mission', () => {
    const h = screen(at(lightRun, 3));
    expect(h).toContain('Mission 01 · First Light');
    expect(h).toContain('Your agent');
    expect(h).toContain('>Live<');
    // the top bar is the watch view's own (G18): the way back, the mission and the link's status are its left end
    const bar = /<header class="aww-bar"[\s\S]*?<\/header>/.exec(h)![0];
    expect(bar).toContain('href="#/"');
    expect(bar).toContain('Mission 01 · First Light');
    expect(bar).toContain('data-pill');
    expect(h).not.toContain('awf-watchbar"');
    // and the drawer, opened on the players, names the agent "Your agent" as Deploy's panels do
    expect(screen(at(lightRun, 3), 'open', { step: 2, drawer: 'players' })).toMatch(/<span class="heading" style="[^"]*">Your agent<\/span>/);
    expect(screen(at(lightRun, 3), 'reconnecting')).toContain('>Reconnecting<');
    expect(screen(fold(lightRun.messages))).toContain('>Finished<');
  });

  it('opens on the mission\'s first beat (its start), held until it is read, as Deploy does', () => {
    const h = screen(at(lightRun, 2));
    expect(h).toContain('data-story="beat"');
    expect(h).toContain('aww-overlay');
  });

  it('an unknown mission id still plays (no story, no names), rather than failing', () => {
    const state = fold(legacy(lightRun).messages.slice(0, 4).map((m) => (m.type === 'setup' ? { ...m, mission: 'no-such-mission' } : m)));
    const h = screen(state);
    expect(h).toContain('aww-root');
    expect(h).toContain('Your agent');
    expect(h).not.toContain('data-story');
  });

  it('a new setup is a new page: the key changes, so the playback, story and viewer start over', () => {
    const one = at(lightRun, 4);
    const two = fold(legacy(canopyRun).messages.slice(0, 3).map((m) => ({ ...m, match: 2 }) as LiveMessage), reduceLive, one);
    expect(two.epoch).toBe(one.epoch + 1);
    expect(screen(two)).toContain(`Mission ${String(mission('under-canopy').order).padStart(2, '0')} · ${mission('under-canopy').title}`);
  });
});

describe('the link to the feed', () => {
  beforeEach(() => { FakeEventSource.made = []; });
  afterEach(() => { vi.unstubAllGlobals(); });
  const link = (): { statuses: LinkStatus[]; messages: LiveMessage[]; es: FakeEventSource; close: () => void } => {
    const statuses: LinkStatus[] = [];
    const messages: LiveMessage[] = [];
    const l = openLive('/live', { message: (m) => messages.push(m), status: (s) => statuses.push(s) }, (u) => new FakeEventSource(u));
    return { statuses, messages, es: FakeEventSource.made.at(-1)!, close: l.close };
  };

  it('reads /live on its own origin, and only /live', () => {
    link();
    expect(FakeEventSource.made.map((e) => e.url)).toStrictEqual(['/live']);
  });

  it('plays a whole scripted stream into the same state the reducer gives, ignoring garbage frames between', () => {
    const { es, messages } = link();
    es.open();
    es.emit('step', 'not json');
    es.play(sseText(lightRun.messages));
    es.emit('nonsense', '{}');
    expect(messages).toStrictEqual(json(lightRun.messages));
    expect(fold(messages)).toStrictEqual(fold(lightRun.messages.map((m) => json(m))));
  });

  it('is unavailable where there is no feed (an error before it ever opened, or a page that is not an event stream), and reconnecting after a drop', () => {
    const a = link();
    a.es.fail(false);
    expect(a.statuses).toStrictEqual(['connecting', 'unavailable']);
    const b = link();
    b.es.fail(true);
    expect(b.statuses).toStrictEqual(['connecting', 'unavailable']);
    const c = link();
    c.es.open();
    c.es.fail(false);
    c.es.open();
    c.es.fail(true);
    expect(c.statuses).toStrictEqual(['connecting', 'open', 'reconnecting', 'open', 'unavailable']);
  });

  it('closing the link closes the EventSource', () => {
    const { es, close } = link();
    close();
    expect(es.closed).toBe(true);
  });

  /** A whole match watched through the link. Reports every request the page made besides the event stream. */
  const watch = (onStep?: (m: LiveMessage) => void): { requests: string[]; state: LiveViewState } => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (input: unknown) => { requests.push(String(input)); return Promise.resolve(new Response('{}', { status: 409 })); });
    let state = WAITING;
    openLive('/live', { message: (m) => { onStep?.(m); state = reduceLive(state, m); }, status: () => {} }, (u) => new FakeEventSource(u));
    const es = FakeEventSource.made.at(-1)!;
    es.open();
    for (const f of parseSse(sseText(lightRun.messages))) es.emit(f.event, f.data);
    return { requests, state };
  };

  it('D-016: asks for nothing but /live, however the match goes, and never for /record (it is 409 until the end anyway)', () => {
    const { requests, state } = watch();
    expect(requests).toStrictEqual([]);
    expect(FakeEventSource.made.map((e) => e.url)).toStrictEqual(['/live']);
    expect(state.phase).toBe('over');
  });

  it('the spy sees a page that peeks at /record while the match runs (planted)', () => {
    const { requests } = watch((m) => { if (m.type === 'step') void fetch('/record'); });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r === '/record')).toBe(true);
  });

  it('a page that built anything from /record mid-match would show it: the state holds no record until the message', () => {
    const seen: (unknown | null)[] = [];
    let state = WAITING;
    openLive('/live', { message: (m) => { state = reduceLive(state, m); if (m.type !== 'record') seen.push(state.record); }, status: () => {} }, (u) => new FakeEventSource(u));
    const es = FakeEventSource.made.at(-1)!;
    es.open();
    es.play(sseText(canopyRun.messages));
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.every((r) => r === null)).toBe(true);
    expect(state.record).not.toBeNull();
  });
});

describe('the page markup stays clean', () => {
  it('the waiting screen is a line and a way back, nothing more (D-023: no paragraphs)', () => {
    const h = renderToStaticMarkup(createElement(LiveScreen, { state: WAITING, link: 'open' }));
    expect(h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).toBe(`${WAITING_LINE} Title`);
  });
});
