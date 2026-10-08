// Playback controls and nothing else: play or pause, step back and forward, speed, a scrubber. There are no unit controls of any kind.
import type { ChangeEvent, ReactElement, ReactNode } from 'react';
import { Button, Sigil, cx, factionShort } from './kit';
import { SPEEDS } from './timing';
import type { Speed } from './timing';
import type { PlaybackAction, PlaybackState } from './controls';
import type { ViewFrame, Viewer } from './timeline';

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
}

export function Controls({ state, dispatch }: ControlsProps): ReactElement {
  const { step, last, playing, speed } = state;
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
      <label className="aww-scrub">
        <span className="label aww-muted aww-scrub-label">Step</span>
        <input
          type="range"
          min={0}
          max={last}
          value={step}
          aria-label="Scrub through the match"
          aria-valuetext={`Step ${step} of ${last}`}
          onChange={(e: ChangeEvent<HTMLInputElement>) => dispatch({ type: 'seek', step: Number(e.target.value) })}
        />
        <span className="stat-sm aww-scrub-count">
          {step}/{last}
        </span>
      </label>
    </div>
  );
}

export interface ViewerToggleProps {
  frame: ViewFrame;
  viewer: Viewer;
  onChange: (v: Viewer) => void;
}

/** Which side of the fog the log and board are read from: one of the players, or the omniscient post-match view. */
export function ViewerToggle({ frame, viewer, onChange }: ViewerToggleProps): ReactElement {
  const options: { value: Viewer; label: ReactNode; text: string }[] = [
    ...frame.players.map((p) => ({
      value: p.index as Viewer,
      text: `${factionShort(p.faction)}`,
      label: (
        <>
          <Sigil faction={p.faction} size={14} tone="current" />
          <span>{factionShort(p.faction)}</span>
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
          title={o.value === 'all' ? 'Omniscient post-match view' : `See only what ${o.text} sees`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
