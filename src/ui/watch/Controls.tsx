// Playback controls and nothing else: play or pause, step back and forward, speed, a scrubber. There are no unit controls of any kind.
import { useMemo, useState } from 'react';
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { Button, Sigil, cx, markOf } from './kit';
import { SPEEDS } from './timing';
import type { Speed } from './timing';
import { cycleOfStep, fractionOfStep, scrubTip, stepAtPointer, timelineMarks } from './controls';
import type { PlaybackAction, PlaybackState } from './controls';
import { isMasked, labelOf, seatOf, uniqueLabels } from './seats';
import type { Seats } from './seats';
import type { Timeline, ViewFrame, Viewer } from './timeline';

const ICON = {
  back: 'M9 1 3 6l6 5V1zM2 1h1.5v10H2z',
  forward: 'M3 1l6 5-6 5V1zM8.5 1H10v10H8.5z',
  play: 'M3 1l8 5-8 5V1z',
  pause: 'M2.5 1h3v10h-3zM7.5 1h3v10h-3z',
} as const;

function Glyph({ name }: { name: keyof typeof ICON }): ReactElement {
  return (
    <svg className="aww-glyph" width={14} height={14} viewBox="0 0 12 12" aria-hidden>
      <path d={ICON[name]} fill="currentColor" />
    </svg>
  );
}

export interface ControlsProps {
  state: PlaybackState;
  dispatch: (a: PlaybackAction) => void;
  /** The viewer's timeline: with it the scrubber shows its cycle ticks and power markers; without it, a plain slider. */
  timeline?: Timeline;
}

/** The slider thumb's width in px (watch.css --aww-thumb): the marks and the tooltip are placed with the same figure. */
const THUMB_PX = 16;
const at = (p: number): CSSProperties => ({ '--p': p }) as CSSProperties;

export function Controls({ state, dispatch, timeline }: ControlsProps): ReactElement {
  const { step, last, playing, speed } = state;
  const marks = useMemo(() => (timeline ? timelineMarks(timeline.steps) : null), [timeline]);
  const [hover, setHover] = useState<number | null>(null);
  // The tooltip names the cycle under the pointer while it is over the track, and the cycle under the thumb otherwise (keyboard focus).
  const tipStep = hover ?? step;
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(stepAtPointer(e.clientX, r, THUMB_PX, last));
  };
  return (
    <div className="aww-controls" role="group" aria-label="Playback controls">
      <div className="aww-transport">
        <Button size="sm" onClick={() => dispatch({ type: 'back' })} disabled={step <= 0} aria-label="Step back" hotkey="Left">
          <Glyph name="back" />
        </Button>
        <Button
          size="sm"
          variant="primary"
          className="aww-playpause"
          onClick={() => dispatch({ type: 'toggle' })}
          aria-label={playing ? 'Pause' : step >= last ? 'Replay' : 'Play'}
          hotkey="Space"
        >
          <Glyph name={playing ? 'pause' : 'play'} />
          <span>{playing ? 'Pause' : step >= last ? 'Replay' : 'Play'}</span>
        </Button>
        <Button size="sm" onClick={() => dispatch({ type: 'forward' })} disabled={step >= last} aria-label="Step forward" hotkey="Right">
          <Glyph name="forward" />
        </Button>
      </div>
      <div className="aww-speeds" role="group" aria-label="Playback speed">
        {SPEEDS.map((s: Speed) => (
          <Button
            key={s}
            size="sm"
            variant={s === speed ? 'primary' : 'secondary'}
            aria-pressed={s === speed}
            onClick={() => dispatch({ type: 'speed', speed: s })}
          >
            {s}x
          </Button>
        ))}
      </div>
      <div className="aww-scrub">
        <span className="label aww-muted aww-scrub-label">Step</span>
        <div className="aww-track" onPointerMove={onMove} onPointerLeave={() => setHover(null)} onPointerCancel={() => setHover(null)}>
          {marks && (
            <div className="aww-marks" aria-hidden>
              {marks.cycles.map((t) => (
                <span key={`c${t.step}`} className={cx('aww-tick', t.major && 'aww-tick--major')} style={at(fractionOfStep(t.step, last))} data-cycle={t.cycle} />
              ))}
              {marks.powers.map((p) => (
                <span
                  key={`p${p.step}-${p.player}`}
                  className={cx('aww-pmark', `aww-pmark--${p.level}`)}
                  style={{ ...at(fractionOfStep(p.step, last)), '--pmark': markOf(p.faction) } as CSSProperties}
                  data-power={p.level}
                />
              ))}
            </div>
          )}
          <input
            type="range"
            min={0}
            max={last}
            value={step}
            style={at(fractionOfStep(step, last))}
            aria-label="Scrub through the match"
            aria-valuetext={marks ? `Step ${step} of ${last}, cycle ${cycleOfStep(marks, step)}` : `Step ${step} of ${last}`}
            onChange={(e: ChangeEvent<HTMLInputElement>) => dispatch({ type: 'seek', step: Number(e.target.value) })}
          />
          {marks && (
            <div className="aww-track-tip caption" style={{ '--tp': fractionOfStep(tipStep, last) } as CSSProperties} role="presentation">
              {scrubTip(marks, tipStep)}
            </div>
          )}
        </div>
        <span className="stat-sm aww-scrub-count">
          {step}/{last}
        </span>
      </div>
    </div>
  );
}

export interface ViewerToggleProps {
  frame: ViewFrame;
  viewer: Viewer;
  onChange: (v: Viewer) => void;
  /** How the view names its seats (WatchView's `people`). Absent: each button is its nation's short name, as ever. */
  seats?: Seats;
}

/**
 * Which side of the fog the log and board are read from: one of the players, or the omniscient post-match view. No two buttons share a
 * label: the mission's own words are unique, and a nation that two seats share is told apart by number.
 */
export function ViewerToggle({ frame, viewer, onChange, seats }: ViewerToggleProps): ReactElement {
  const words = uniqueLabels(frame.players.map((p) => labelOf(seats, p.index, p.faction)));
  const options: { value: Viewer; label: ReactNode; text: string; title?: string }[] = [
    ...frame.players.map((p, i) => ({
      value: p.index as Viewer,
      text: words[i],
      title: seatOf(seats, p.index) ? `Watching as ${seatOf(seats, p.index)?.name}` : undefined,
      label: (
        <>
          <Sigil faction={p.faction} size={14} tone="current" masked={isMasked(seats, p.index)} />
          <span>{words[i]}</span>
        </>
      ),
    })),
    { value: 'all', text: 'All', label: <span>All</span> },
  ];
  return (
    <div className="aww-viewer" role="radiogroup" aria-label="Watching as">
      <span className="label aww-muted aww-viewer-label">Watching as</span>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === viewer}
          className={cx('aww-viewer-opt', 'label', o.value === viewer && 'aww-viewer-opt--on')}
          onClick={() => onChange(o.value)}
          title={o.value === 'all' ? 'Omniscient post-match view' : o.title ?? `See only what ${o.text} sees`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
