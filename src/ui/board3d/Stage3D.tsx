// <Stage3D {...StageProps} /> is the 3D diorama stage, a drop-in for the SVG Stage (D-018). Same props, same DOM around the board
// (board chips, banner sweep, power cut-in); the board itself is one WebGL canvas drawn by StageRuntime, which samples the same transition
// plan every animation frame. The bar, the drawer and the playback controls stay React/DOM, outside this component (G18: the cycle and whose
// turn it is are the slim bar's chip, so this stage draws no banner row and no toolbar of its own).
//
// This is a viewer's camera and nothing more: wheel and +/- zoom, drag pans, and nothing selects or commands a unit (D-004, D-007).
// Only the viewer's own frame and filtered events reach the runtime, so a fogged viewer's board can only show what it was told (D-016).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { CutIn } from '../watch/CutIn';
import { TurnBanner } from '../watch/kit';
import { commanderNameOf } from '../watch/format';
import { ownerOf } from '../watch/seats';
import { VictoryChip } from '../watch/VictoryChip';
import type { StageProps } from '../watch/Stage';
import { maskedOwnersOf } from './stage/masked';
import { StageRuntime } from './stage/runtime';
import type { Overlay } from './stage/runtime';
import type { QualityTier } from './stage/quality';
import { MAX_ZOOM_LEVEL, stageAspect } from './stage/rig';

export interface Stage3DProps extends StageProps {
  /** Called when the GPU side cannot go on (no WebGL context, or it was lost), so the page can fall back to the flat board. */
  onFail?: (reason: string) => void;
}

export function Stage3D({ timeline, step, plan, onDone, reducedMotion, seats, onFail }: Stage3DProps): ReactElement {
  const cur = timeline.steps[Math.min(step, timeline.last)];
  const frame = cur.frame;
  const hostRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<StageRuntime | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [zoom, setZoom] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  // The quality tier in force (high, medium, low): the runtime picks it from the machine, `?quality=` forces it, and a slow stretch lowers it.
  // It is shown as data-quality for the viewer's report and the tests; nothing in the page reads it back.
  const [quality, setQuality] = useState<QualityTier | null>(null);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  // One renderer per mount. React StrictMode mounts, unmounts and mounts again: the first runtime is disposed (its context released
  // and its canvas removed) before the second is built, so a double mount leaves exactly one canvas and one context.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let rt: StageRuntime;
    try {
      rt = new StageRuntime(host, {
        onDone: (p) => onDoneRef.current(p),
        onOverlay: setOverlay,
        onZoom: setZoom,
        onQuality: setQuality,
        onFail: (reason) => {
          setFailed(reason);
          onFailRef.current?.(reason);
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setFailed(reason);
      onFailRef.current?.(reason);
      return undefined;
    }
    runtime.current = rt;
    setZoom(0);
    setFailed(null);
    return () => {
      rt.dispose();
      runtime.current = null;
    };
  }, []);

  // The players whose nation the mission does not name (G15): their units wear no nation sigil. Held in an array that keeps its identity, keyed on the
  // indices themselves, so a re-render that changes nothing does not hand the runtime a new view.
  const maskedKey = maskedOwnersOf(seats, frame.players).join(',');
  const maskedOwners = useMemo(() => (maskedKey === '' ? [] : maskedKey.split(',').map(Number)), [maskedKey]);

  useEffect(() => {
    runtime.current?.setView({ timeline, step, plan, reducedMotion, maskedOwners });
  }, [timeline, step, plan, reducedMotion, maskedOwners]);

  const bannerFaction = frame.players[frame.current]?.faction ?? 'helion';
  const sweep = overlay?.banner ?? null;
  const cutIn = overlay?.cutIn ?? null;

  return (
    <div className="aww-stage" data-renderer="3d">
      <div className="aww-board-wrap">
        <div className="aww-boardchips">
          <VictoryChip frame={frame} seats={seats} />
          {frame.weather === 'ionstorm' && <span className="aww-chip caption aww-chip--warn">Ion storm</span>}
        </div>
        <div
          className="aww-stage3d"
          ref={hostRef}
          role="img"
          aria-label={`Battlefield in 3D, cycle ${frame.cycle}, ${ownerOf(seats, frame.current, bannerFaction)} turn`}
          data-step={step}
          data-quality={quality ?? undefined}
          style={{ ['--aww-3d-ratio' as string]: stageAspect({ width: frame.width, height: frame.height }).toFixed(3) }}
        >
          {failed !== null && <div className="aww-stage3d-fail label">The 3D view is unavailable here. Switch to the flat board.</div>}
        </div>
        <div className="aww-zoom" role="group" aria-label="Camera zoom">
          <button type="button" className="aww-zoom-btn" aria-label="Zoom in" title="Zoom in (+ or the mouse wheel); drag to pan" disabled={zoom >= MAX_ZOOM_LEVEL} onClick={() => runtime.current?.zoomStep(1)}>+</button>
          <button type="button" className="aww-zoom-btn" aria-label="Zoom out" title="Zoom out (- or the mouse wheel)" disabled={zoom <= 0} onClick={() => runtime.current?.zoomStep(-1)}>&minus;</button>
        </div>
        {sweep && (
          <div
            className="aww-sweep"
            aria-hidden
            style={reducedMotion ? { opacity: 1 - Math.abs(sweep.slide) } : { transform: `translateX(${sweep.slide * 105}%)` }}
          >
            <TurnBanner
              cycle={sweep.beat.cycle}
              faction={frame.players[sweep.beat.player]?.faction ?? 'helion'}
              commander={commanderNameOf(frame.players[sweep.beat.player]?.commander ?? '')}
              className="aww-sweep-band"
            />
          </div>
        )}
      </div>
      {cutIn && <CutIn sample={cutIn} reducedMotion={reducedMotion} />}
    </div>
  );
}
