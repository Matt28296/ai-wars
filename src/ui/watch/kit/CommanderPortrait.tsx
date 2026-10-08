import type { CSSProperties, ReactElement } from 'react';
import type { Mood } from '../../../content/types';
import { hasPortrait, portraitUrl } from '../../portraits';
import { CHAMFER, cx, fillOf, onOf } from './roles';
import type { Faction } from './roles';
import { Sigil } from './Sigil';

export interface CommanderPortraitProps {
  name?: string;
  /** The commander's id (src/content/commanders.ts). With a portrait for it, the vector bust is drawn; otherwise the monogram stays. */
  id?: string;
  /** Which face the bust wears. Defaults to neutral. */
  mood?: Mood;
  faction: Faction | null;
  initials?: string;
  /** Painted art, when it exists (wins over the monogram, but not over a portrait for `id`). */
  src?: string;
  size?: number;
  /** A side with no name yet: the unmarked mark stands where the monogram and the nation's watermark would be. The frame keeps the nation's colours. */
  masked?: boolean;
  /** While a power is active. */
  state?: 'surge' | 'overclock';
  className?: string;
}

/** A commander's face: faction-coloured chamfered frame, sigil watermark, and the portrait or a monogram. */
export function CommanderPortrait({ name, id, mood, faction, initials, src, size = 96, masked, state, className }: CommanderPortraitProps): ReactElement {
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
  const art = id !== undefined && hasPortrait(id) ? portraitUrl(id, mood ?? 'neutral') : src;
  const mono = initials ?? (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2);
  return (
    <div className={cx('aw-portrait', art && 'aw-portrait--art', className)} role="img" aria-label={`${name || 'Commander'}${label ? `, ${label} active` : ''}`} style={style}>
      {!masked && (
        <span className="aw-portrait-mark" aria-hidden>
          <Sigil faction={faction} size={Math.round(size * 0.78)} tone="on" />
        </span>
      )}
      {art ? (
        <img src={art} alt="" className="aw-portrait-img" draggable={false} />
      ) : masked ? (
        <span className="aw-portrait-initials"><Sigil faction={faction} size={Math.round(size * 0.58)} tone="on" masked /></span>
      ) : (
        <span className="aw-portrait-initials" style={{ fontSize: Math.round(size * 0.36) }}>{mono}</span>
      )}
      {label && <span className="aw-portrait-band label" style={size < 72 ? { fontSize: 9, letterSpacing: '0.04em' } : undefined}>{label}</span>}
    </div>
  );
}
