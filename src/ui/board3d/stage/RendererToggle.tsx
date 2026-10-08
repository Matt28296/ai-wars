// The small 3D / 2D switch in the stage's toolbar slot. It lives apart from Stage3D so the watch view can show it without loading the
// 3D renderer. It changes which board is drawn; nothing else.
import type { ReactElement } from 'react';
import { cx } from '../../watch/kit';
import type { RendererChoice } from './support';

export interface RendererToggleProps {
  mode: RendererChoice;
  onChange: (mode: RendererChoice) => void;
}

const OPTIONS: { mode: RendererChoice; label: string; title: string }[] = [
  { mode: '3d', label: '3D', title: 'The lit 3D board' },
  { mode: '2d', label: '2D', title: 'The flat board' },
];

export function RendererToggle({ mode, onChange }: RendererToggleProps): ReactElement {
  return (
    <div className="aww-viewer" role="radiogroup" aria-label="Board view">
      <span className="label aww-muted aww-viewer-label">Board</span>
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          type="button"
          role="radio"
          aria-checked={o.mode === mode}
          className={cx('aww-viewer-opt', 'label', o.mode === mode && 'aww-viewer-opt--on')}
          onClick={() => onChange(o.mode)}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
