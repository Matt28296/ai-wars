import type { ReactElement } from 'react';
import { cx, factionName, fillOf, onOf, pad2 } from './roles';
import type { Faction } from './roles';
import { Sigil } from './Sigil';

export interface TurnBannerProps {
  cycle?: number;
  faction?: Faction;
  /** The commander's name. */
  commander?: string;
  className?: string;
}

/** The band across the screen at the start of each turn: cycle number, nation and commander, in the nation's colours. */
export function TurnBanner({ cycle = 1, faction = 'helion', commander, className }: TurnBannerProps): ReactElement {
  return (
    <div className={cx('aw-banner', faction === 'choir' && 'aw-banner--choir', className)} role="status" style={{ background: fillOf(faction), color: onOf(faction) }}>
      <div className="aw-banner-cycle">
        <span className="label">Cycle</span>
        <span className="headline">{pad2(cycle)}</span>
      </div>
      <div className="aw-banner-rule" aria-hidden />
      <div className="aw-banner-who">
        <span className="heading">{factionName(faction)}</span>
        {commander && <span className="caption">{commander} commanding</span>}
      </div>
      <span className="aw-banner-mark" aria-hidden>
        <Sigil faction={faction} size={72} tone="on" />
      </span>
    </div>
  );
}
