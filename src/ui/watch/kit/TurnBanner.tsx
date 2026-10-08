import type { ReactElement } from 'react';
import { cx, factionName, fillOf, onOf, pad2 } from './roles';
import type { Faction } from './roles';
import { Sigil } from './Sigil';
import { useBannerSeat } from '../seatsContext';
import type { BannerSeat } from '../seats';

export interface TurnBannerProps {
  cycle?: number;
  faction?: Faction;
  /** The commander's name. */
  commander?: string;
  /**
   * The seat's own words, when the view names its seats (G15): the name over the band, the nation line under it, and whether the nation
   * is masked (the unmarked mark replaces the sigil). Absent: the nation's name and "<commander> commanding". When absent and the banner
   * sits inside a watch view that names its seats, the view is asked for the seat by nation and commander (the 3D stage draws its own).
   */
  seat?: BannerSeat;
  className?: string;
}

/** The band across the screen at the start of each turn: cycle number, nation and commander, in the nation's colours. */
export function TurnBanner({ cycle = 1, faction = 'helion', commander, seat, className }: TurnBannerProps): ReactElement {
  const named = useBannerSeat(faction, commander);
  const s = seat ?? named;
  return (
    <div className={cx('aw-banner', faction === 'choir' && 'aw-banner--choir', className)} role="status" style={{ background: fillOf(faction), color: onOf(faction) }}>
      <div className="aw-banner-cycle">
        <span className="label">Cycle</span>
        <span className="headline">{pad2(cycle)}</span>
      </div>
      <div className="aw-banner-rule" aria-hidden />
      <div className="aw-banner-who">
        <span className="heading">{s ? s.name : factionName(faction)}</span>
        {s ? <span className="caption">{s.caption}</span> : commander && <span className="caption">{commander} commanding</span>}
      </div>
      <span className="aw-banner-mark" aria-hidden>
        <Sigil faction={faction} size={72} tone="on" masked={s?.masked} />
      </span>
    </div>
  );
}
