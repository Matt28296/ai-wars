// <WatchView setup actions viewer /> replays a finished match step by step, as a WATCHER.
//
// The human never moves units in Ascendant Wars (D-004, D-007): their agent, the Commanding Officer AI, fights, and the human
// watches and then adjusts doctrine. So this is a viewer, not a controller -- playback controls only, no unit control of any kind.
//
// A player viewer renders ONLY observe(state, viewer) and its log uses ONLY viewEvents(before, after, events, viewer); 'all' is the
// omniscient post-match view (timeline.ts). The board, HUD, log and animation are all drawn from the timeline's frames and events.
import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Action, CreateGameOptions } from '../../game/aw';
import { Controls, ViewerToggle } from './Controls';
import { EventLog } from './EventLog';
import { Hud } from './Hud';
import { IntelCard } from './IntelCard';
import { Stage } from './Stage';
import { RendererToggle } from '../board3d/stage/RendererToggle';
import { chooseRenderer, detectWebGL2 } from '../board3d/stage/support';
import type { RendererChoice } from '../board3d/stage/support';
import { initialPlayback, keyToAction, livePlaybackReducer, playbackReducer } from './controls';
import type { PlaybackAction, PlaybackState } from './controls';
import { buildLog, commanderNameOf, mergeNotes } from './format';
import type { LogNote } from './format';
import { SeatsContext } from './seatsContext';
import type { SeatBook } from './seatsContext';
import type { SeatPresentation } from './seats';
import { dwellMs } from './timing';
import type { Speed } from './timing';
import { extendRecord, extendTimeline, recordMatch, viewTimeline } from './timeline';
import type { MatchRecord, Timeline, TimelineStep, Viewer } from './timeline';
import { planTransition } from './transition';
import type { TransitionPlan } from './transition';
import './watch.css';

// The 3D stage (three.js) loads on demand, so a page that shows the flat board never pays for it.
const Stage3D = lazy(() => import('../board3d/Stage3D').then((m) => ({ default: m.Stage3D })));

export interface WatchViewBaseProps {
  /** A player index, or 'all' for the omniscient post-match view. */
  viewer: Viewer;
  /** When given, the viewer toggle is shown and calls this with the viewer picked. */
  onViewerChange?: (v: Viewer) => void;
  initialStep?: number;
  initialSpeed?: Speed;
  autoPlay?: boolean;
  /** Called whenever the step or speed changes, e.g. to keep a URL hash in step. */
  onPositionChange?: (p: { step: number; speed: Speed }) => void;
  /**
   * Drawn above the board, over its bottom edge, inside the stage area (the mission's dialogue and debrief use it). Absent by default,
   * and then nothing at all is added to the page. Decided when the view mounts: give it from the first render or never.
   */
  overlay?: ReactNode;
  /** Called with the step on screen when the view opens, and again each time the step changes (not for a speed or viewer change). */
  onStep?: (index: number) => void;
  /**
   * While true, playback does not move on by itself: the step stays and the pause between actions does not run out. The viewer's own
   * controls keep working. It is how an overlay holds the battle while it talks. False by default.
   */
  hold?: boolean;
  /**
   * How the screen names the players (G15): one entry per player index, saying what may be shown for that seat (a name, a short label,
   * whether its nation is shown or masked, and which portrait). The turn banner, the player panels, the viewer toggle, the victory chip,
   * the event log, the unit intel and the battlefield's label all read it. A seat with no entry, or no list at all, is named the old way
   * (its nation, its commander), so the demo and every view that never asked for this look exactly as before.
   */
  people?: readonly (SeatPresentation | undefined)[];
  /**
   * G14: given for a match that is still being computed. `actions` then GROWS between renders (the same objects, new ones after them; the
   * view applies only the new ones), and `open` says whether more may still come. While open, playback that reaches the last step computed so
   * far waits there, with a quiet "Thinking..." in the controls, and goes on when more arrives. Absent, the match is whole, as ever.
   */
  live?: { open: boolean };
  /** G14: extra lines for the event log, each shown from its step on (the order changes of the player's agent). Absent: the log is the events'. */
  logNotes?: readonly LogNote[];
  /**
   * G14: drawn in the toolbar row beside the viewer and renderer toggles (the Orders button and its panel). Absent, nothing at all is added.
   * Decided when the view mounts: give it from the first render or never.
   */
  ordersSlot?: ReactNode;
}

/**
 * The match the view draws. Either the whole record's inputs (`setup` and `actions`: every viewer is built from them, as ever), or, for G17's
 * live agent feed, a timeline that arrives ALREADY VIEWED.
 *
 * `viewed` (G17): the steps of ONE seat's timeline, which the agent feed sends as they happen (a `TimelineStep` per step, other seats' actions
 * null; `LiveStep` is the same type). It GROWS between renders: pass a new array each time, the steps already in it the same objects, and give
 * `live={{ open: true }}` while more may come. The viewer shown is `viewed[0].frame.viewer`; while `viewer` is that seat, the view draws these
 * steps and builds no record at all (a mid-match viewer has no setup and no actions to build one from: D-016). It opens playing, even on step 0
 * alone, and waits at the edge with "Thinking..." until the next step arrives.
 * `setup` and `actions` are then optional, and used only for any OTHER viewer (the post-match "All" view), once the whole record is known.
 * It needs step 0 at least. Absent, nothing about the view changes.
 */
export type WatchViewProps = WatchViewBaseProps & (
  | { setup: CreateGameOptions; actions: Action[]; viewed?: undefined }
  | { viewed: readonly TimelineStep[]; setup?: CreateGameOptions; actions?: Action[] }
);

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = (): void => setReduced(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function WatchView({ setup, actions, viewed, viewer, onViewerChange, initialStep, initialSpeed, autoPlay, onPositionChange, overlay, onStep, hold = false, people, live, logNotes, ordersSlot }: WatchViewProps): ReactElement {
  // A whole match is recorded once. A growing one (G14) keeps what it has recorded and applies only the actions that arrived since.
  // A match that arrives already viewed (G17) is not recorded at all while the viewer is the seat it was viewed for.
  if (viewed !== undefined && viewed.length === 0) throw new RangeError('WatchView: `viewed` needs step 0 at least');
  const fed = viewed !== undefined && viewed[0].frame.viewer === viewer;
  const growing = live !== undefined;
  const open = live?.open === true;
  const recordMemo = useRef<MatchRecord | null>(null);
  const timelineMemo = useRef<Timeline | null>(null);
  const record = useMemo(() => {
    if (fed) return null;
    if (!setup || !actions) throw new RangeError('WatchView: this viewer needs `setup` and `actions` (the record is known only when the match is over)');
    if (!growing) return recordMatch(setup, actions);
    recordMemo.current = extendRecord(recordMemo.current, setup, actions);
    return recordMemo.current;
  }, [setup, actions, growing, fed]);
  const timeline = useMemo<Timeline>(() => {
    if (fed) return { viewer, steps: viewed.slice(), last: viewed.length - 1 };
    if (!growing) return viewTimeline(record!, viewer);
    timelineMemo.current = extendTimeline(timelineMemo.current, record!, viewer);
    return timelineMemo.current;
  }, [record, viewer, growing, fed, viewed]);
  const log = useMemo(() => mergeNotes(buildLog(timeline.steps, people), logNotes), [timeline, people, logNotes]);
  const reducedMotion = useReducedMotion();

  // The 3D board when WebGL2 works and `?renderer=2d` is not in the URL; otherwise (or by the viewer's own toggle) the flat SVG board.
  const [webgl2] = useState(() => detectWebGL2());
  const [rendererPick, setRendererPick] = useState<RendererChoice | null>(null);
  const renderer = chooseRenderer({ webgl2, search: typeof window === 'undefined' ? '' : window.location.search, override: rendererPick });
  const onStage3DFail = useCallback(() => setRendererPick('2d'), []);

  // The reducer is the live one while more may still come, read at the moment it runs (a ref, so the same function serves every render).
  const openRef = useRef(open);
  openRef.current = open;
  const [pb, dispatch] = useReducer(
    (s: PlaybackState, a: PlaybackAction) => (openRef.current ? livePlaybackReducer(s, a) : playbackReducer(s, a)),
    undefined,
    () => {
      const first = initialPlayback(timeline.last, { step: initialStep, speed: initialSpeed, playing: autoPlay });
      // A fed match (G17) opens on step 0 alone and is played as it arrives: it starts playing and waits at the edge, which `initialPlayback` would not.
      return viewed !== undefined && autoPlay === true && !first.playing && first.step >= timeline.last ? { ...first, playing: true } : first;
    },
  );

  // Another viewer means another timeline over the same match: keep the position, snap rather than animate. A match that merely grew
  // (G14) keeps everything, an animation in flight included: only its length changes.
  const lastTimeline = useRef(timeline);
  useEffect(() => {
    const before = lastTimeline.current;
    if (before !== timeline) {
      lastTimeline.current = timeline;
      dispatch({ type: 'newTimeline', last: timeline.last, ...(growing && before.viewer === timeline.viewer ? { grow: true } : {}) });
    }
  }, [timeline, growing]);

  useEffect(() => {
    onPositionChange?.({ step: pb.step, speed: pb.speed });
  }, [pb.step, pb.speed, onPositionChange]);

  // The step's animation plan. Only a step reached by moving forward one animates; jumps and rewinds snap.
  const step = timeline.steps[Math.min(pb.step, timeline.last)];
  const prev = timeline.steps[Math.max(0, Math.min(pb.step, timeline.last) - 1)];
  const plan = useMemo<TransitionPlan | null>(
    () => (pb.animate && step.index > 0 ? planTransition(prev.frame, step.frame, step.events, { speed: pb.speed, reducedMotion }) : null),
    [pb.animate, pb.speed, step, prev, reducedMotion],
  );

  // The step on screen, told to whoever asked (an overlay that needs to know where the battle is). It is told on mount too.
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  useEffect(() => {
    onStepRef.current?.(step.index);
  }, [step.index]);

  // Playback: once a step's animation has run (or there was none), wait the pause between actions, then move on. A held view waits.
  const [donePlan, setDonePlan] = useState<TransitionPlan | null>(null);
  const finished = plan === null || plan.durationMs <= 0 || donePlan === plan;
  const onDone = useCallback((p: TransitionPlan) => setDonePlan(p), []);
  useEffect(() => {
    if (!pb.playing || !finished || hold) return undefined;
    const id = window.setTimeout(() => dispatch({ type: 'advance' }), dwellMs(pb.speed, plan?.durationMs ?? 0));
    return () => window.clearTimeout(id);
  }, [pb.playing, pb.step, pb.last, pb.speed, finished, plan, hold, open]);

  // Keyboard: Space, Left, Right. Playback only. Space plays and pauses wherever focus is, so a button the viewer just clicked must not
  // also press itself on the key's release: that is stopped on keyup.
  useEffect(() => {
    const targetOf = (e: KeyboardEvent): { tag?: string; type?: string } => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      return { tag: t?.tagName.toLowerCase(), type: t instanceof HTMLInputElement ? t.type : undefined };
    };
    const onKey = (e: KeyboardEvent): void => {
      const action = keyToAction(e, targetOf(e));
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (keyToAction(e, targetOf(e))?.type === 'toggle') e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const logCount = useMemo(() => {
    let n = 0;
    while (n < log.length && log[n].step <= step.index) n++;
    return n;
  }, [log, step.index]);
  const visibleLog = useMemo(() => log.slice(0, logCount), [log, logCount]);

  // The 3D stage draws its own banner and is given no seats, so a banner inside this view asks here which seat a nation and a commander mean.
  const seatBook = useMemo<SeatBook | null>(
    () => (people ? { seats: people, keys: timeline.steps[0].frame.players.map((p) => ({ faction: p.faction, commanderName: commanderNameOf(p.commander) })), current: step.frame.current } : null),
    [people, timeline, step.frame.current],
  );

  const toolbar =
    onViewerChange || webgl2 || ordersSlot ? (
      <div className="aww-toolbar-row">
        {onViewerChange && <ViewerToggle frame={timeline.steps[0].frame} viewer={viewer} onChange={onViewerChange} seats={people} />}
        {webgl2 && <RendererToggle mode={renderer} onChange={setRendererPick} />}
        {ordersSlot}
      </div>
    ) : undefined;

  const stage =
    renderer === '3d' ? (
      <Suspense
        fallback={
          <div className="aww-stage" data-renderer="3d" aria-busy>
            <div className="aww-board-wrap"><div className="aww-stage3d aww-stage3d--loading label">Loading the 3D board</div></div>
          </div>
        }
      >
        <Stage3D
          timeline={timeline}
          step={step.index}
          plan={plan}
          onDone={onDone}
          reducedMotion={reducedMotion}
          toolbar={toolbar}
          seats={people}
          onFail={onStage3DFail}
        />
      </Suspense>
    ) : (
      <Stage timeline={timeline} step={step.index} plan={plan} onDone={onDone} reducedMotion={reducedMotion} toolbar={toolbar} seats={people} />
    );

  return (
    <SeatsContext.Provider value={seatBook}>
      <div className="aww-root" data-viewer={String(viewer)} data-step={step.index}>
        <div className="aww-main">
          {overlay === undefined ? stage : (
            <div className="aww-stagebox">
              {stage}
              <div className="aww-overlay">{overlay}</div>
            </div>
          )}
          <aside className="aww-side">
            <Hud step={step} seats={people} />
            <IntelCard timeline={timeline} step={step.index} seats={people} />
            <EventLog lines={visibleLog} />
          </aside>
          <div className="aww-bottom">
            <Controls state={pb} dispatch={dispatch} timeline={timeline} thinking={open && pb.playing && pb.step >= timeline.last} />
          </div>
        </div>
      </div>
    </SeatsContext.Provider>
  );
}
