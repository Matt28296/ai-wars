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
import { initialPlayback, keyToAction, playbackReducer } from './controls';
import { buildLog } from './format';
import { dwellMs } from './timing';
import type { Speed } from './timing';
import { recordMatch, viewTimeline } from './timeline';
import type { Viewer } from './timeline';
import { planTransition } from './transition';
import type { TransitionPlan } from './transition';
import './watch.css';

// The 3D stage (three.js) loads on demand, so a page that shows the flat board never pays for it.
const Stage3D = lazy(() => import('../board3d/Stage3D').then((m) => ({ default: m.Stage3D })));

export interface WatchViewProps {
  setup: CreateGameOptions;
  actions: Action[];
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
}

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

export function WatchView({ setup, actions, viewer, onViewerChange, initialStep, initialSpeed, autoPlay, onPositionChange, overlay, onStep, hold = false }: WatchViewProps): ReactElement {
  const record = useMemo(() => recordMatch(setup, actions), [setup, actions]);
  const timeline = useMemo(() => viewTimeline(record, viewer), [record, viewer]);
  const log = useMemo(() => buildLog(timeline.steps), [timeline]);
  const reducedMotion = useReducedMotion();

  // The 3D board when WebGL2 works and `?renderer=2d` is not in the URL; otherwise (or by the viewer's own toggle) the flat SVG board.
  const [webgl2] = useState(() => detectWebGL2());
  const [rendererPick, setRendererPick] = useState<RendererChoice | null>(null);
  const renderer = chooseRenderer({ webgl2, search: typeof window === 'undefined' ? '' : window.location.search, override: rendererPick });
  const onStage3DFail = useCallback(() => setRendererPick('2d'), []);

  const [pb, dispatch] = useReducer(playbackReducer, undefined, () =>
    initialPlayback(timeline.last, { step: initialStep, speed: initialSpeed, playing: autoPlay }),
  );

  // Another viewer means another timeline over the same match: keep the position, snap rather than animate.
  const lastTimeline = useRef(timeline);
  useEffect(() => {
    if (lastTimeline.current !== timeline) {
      lastTimeline.current = timeline;
      dispatch({ type: 'newTimeline', last: timeline.last });
    }
  }, [timeline]);

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
  }, [pb.playing, pb.step, pb.speed, finished, plan, hold]);

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

  const toolbar =
    onViewerChange || webgl2 ? (
      <div className="aww-toolbar-row">
        {onViewerChange && <ViewerToggle frame={timeline.steps[0].frame} viewer={viewer} onChange={onViewerChange} />}
        {webgl2 && <RendererToggle mode={renderer} onChange={setRendererPick} />}
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
          onFail={onStage3DFail}
        />
      </Suspense>
    ) : (
      <Stage timeline={timeline} step={step.index} plan={plan} onDone={onDone} reducedMotion={reducedMotion} toolbar={toolbar} />
    );

  return (
    <div className="aww-root" data-viewer={String(viewer)} data-step={step.index}>
      <div className="aww-main">
        {overlay === undefined ? stage : (
          <div className="aww-stagebox">
            {stage}
            <div className="aww-overlay">{overlay}</div>
          </div>
        )}
        <aside className="aww-side">
          <Hud step={step} />
          <IntelCard timeline={timeline} step={step.index} />
          <EventLog lines={visibleLog} />
        </aside>
        <div className="aww-bottom">
          <Controls state={pb} dispatch={dispatch} timeline={timeline} />
        </div>
      </div>
    </div>
  );
}
