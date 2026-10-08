import type { CSSProperties, ReactElement } from 'react';
import { CHAMFER, cx, fillOf, onOf } from './roles';
import type { Faction } from './roles';
import { Sigil } from './Sigil';

export interface CommanderPortraitProps {
  name?: string;
  faction: Faction | null;
  initials?: string;
  /** Painted art, when it exists. */
  src?: string;
  size?: number;
  /** While a power is active. */
  state?: 'surge' | 'overclock';
  className?: string;
}

/** A commander's face: faction-coloured chamfered frame, sigil watermark, and the portrait or a monogram. */
export function CommanderPortrait({ name, faction, initials, src, size = 96, state, className }: CommanderPortraitProps): ReactElement {
  const label = state === 'surge' ? 'Surge' : state === 'overclock' ? 'Overclock' : undefined;
  const style: CSSProperties = {
    width: size,
    height: size,
    background: fillOf(faction),
    color: onOf(faction),
    clipPath: CHAMFER(size >= 72 ? 'var(--chamfer)' : 'var(--chamfer-sm)'),
    outline: faction === 'choir' ? '1.5px solid var(--on-choir)' : undefined,
    outlineOffset: -1.5,
  };
  const mono = initials ?? (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2);
  return (
    <div className={cx('aw-portrait', className)} role="img" aria-label={`${name || 'Commander'}${label ? `, ${label} active` : ''}`} style={style}>
      <span className="aw-portrait-mark" aria-hidden>
        <Sigil faction={faction} size={Math.round(size * 0.78)} tone="on" />
      </span>
      {src ? <img src={src} alt="" className="aw-portrait-img" /> : <span className="aw-portrait-initials" style={{ fontSize: Math.round(size * 0.36) }}>{mono}</span>}
      {label && <span className="aw-portrait-band label" style={size < 72 ? { fontSize: 9, letterSpacing: '0.04em' } : undefined}>{label}</span>}
    </div>
  );
}
