// <Stage3D {...StageProps} /> is the 3D diorama stage, a drop-in for the SVG Stage (D-018). Same props, same DOM around the board
// (turn banner, chips row, toolbar slot, banner sweep, power cut-in); the board itself is one WebGL canvas drawn by StageRuntime, which
// samples the same transition plan every animation frame. The HUD, log and controls stay React/DOM, outside this component.
//
// This is a viewer's camera and nothing more: wheel and +/- zoom, drag pans, and nothing selects or commands a unit (D-004, D-007).
// Only the viewer's own frame and filtered events reach the runtime, so a fogged viewer's board can only show what it was told (D-016).
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { CutIn } from '../watch/CutIn';
import { Sigil, TurnBanner, factionShort } from '../watch/kit';
import { commanderNameOf } from '../watch/format';
import type { StageProps } from '../watch/Stage';
import { StageRuntime } from './stage/runtime';
import type { Overlay } from './stage/runtime';
import { MAX_ZOOM_LEVEL, stageAspect } from './stage/rig';

export interface Stage3DProps extends StageProps {
  /** Called when the GPU side cannot go on (no WebGL context, or it was lost), so the page can fall back to the flat board. */
  onFail?: (reason: string) => void;
}

export function Stage3D({ timeline, step, plan, onDone, reducedMotion, toolbar, onFail }: Stage3DProps): ReactElement {
  const cur = timeline.steps[Math.min(step, timeline.last)];
  const frame = cur.frame;
  const hostRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<StageRuntime | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [zoom, setZoom] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

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

  useEffect(() => {
    runtime.current?.setView({ timeline, step, plan, reducedMotion });
  }, [timeline, step, plan, reducedMotion]);

  const winner = frame.winnerTeam;
  const bannerFaction = frame.players[frame.current]?.faction ?? 'helion';
  const bannerCommander = commanderNameOf(frame.players[frame.current]?.commander ?? '');
  const sweep = overlay?.banner ?? null;
  const cutIn = overlay?.cutIn ?? null;

  return (
    <div className="aww-stage" data-renderer="3d">
      <div className="aww-banner-row">
        <TurnBanner key={`${frame.cycle}-${frame.current}`} className="aww-turn-banner" cycle={frame.cycle} faction={bannerFaction} commander={bannerCommander} />
        <div className="aww-chips">
          {winner !== null && (
            <span className="aww-victory label">
              <Sigil faction={frame.players.find((p) => p.team === winner)?.faction ?? null} size={18} tone="ink" />
              Victory: {frame.players.filter((p) => p.team === winner).map((p) => factionShort(p.faction)).join(' and ')}
            </span>
          )}
          <span className="aww-chip caption">{frame.viewer === 'all' ? 'Omniscient view' : frame.fogActive ? 'Fog of war' : 'No fog'}</span>
          {frame.weather === 'ionstorm' && <span className="aww-chip caption aww-chip--warn">Ion storm</span>}
          {toolbar && <div className="aww-toolbar">{toolbar}</div>}
        </div>
      </div>
      <div className="aww-board-wrap">
        <div
          className="aww-stage3d"
          ref={hostRef}
          role="img"
          aria-label={`Battlefield in 3D, cycle ${frame.cycle}, ${factionShort(bannerFaction)} turn`}
          data-step={step}
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
