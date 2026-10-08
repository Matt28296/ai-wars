import type { ReactElement, ReactNode } from 'react';
import type { Mood } from '../../../content/types';
import { CommanderPortrait } from './CommanderPortrait';
import { Frame } from './Frame';
import { PowerMeter } from './PowerMeter';
import type { PowerMeterProps } from './PowerMeter';
import { creditsText, cx, inkOf, pad2 } from './roles';
import type { Faction } from './roles';

export interface PlayerHudProps {
  commander: { name: string; faction: Faction | null; id?: string; mood?: Mood; initials?: string; src?: string; state?: 'surge' | 'overclock' };
  funds?: number;
  /** The number to draw while funds tick toward `funds`. Assistive tech is always told `funds`, so a tick is never read out digit by digit. */
  fundsShown?: number;
  power?: PowerMeterProps;
  cycle?: number;
  /** Beside the name: the turn marker, or the Defeated chip. */
  badge?: ReactNode;
  /** At the right of the funds row (a viewer puts the unit and property counts here). */
  aside?: ReactNode;
  /** A defeated commander's name goes quiet; the portrait is greyed by the viewer's own style. */
  muted?: boolean;
  /** Extra rows under the power meter (a viewer adds the faction line here). */
  children?: ReactNode;
  className?: string;
}

/** One player's corner of the battlefield: commander, funds, cycle and power. */
export function PlayerHud({ commander, funds = 0, fundsShown, power, cycle, badge, aside, muted, children, className }: PlayerHudProps): ReactElement {
  const shown = fundsShown ?? funds;
  return (
    <Frame floating className={cx('aw-hud', className)}>
      <CommanderPortrait {...commander} size={48} />
      <div className="aw-hud-body">
        <div className="aw-hud-top">
          <span className="heading" style={{ color: muted ? 'var(--ink-muted)' : inkOf(commander.faction) }}>{commander.name}</span>
          {cycle != null && <span className="label aw-muted">Cycle {pad2(cycle)}</span>}
          {badge && <span className="aw-hud-badge">{badge}</span>}
        </div>
        <div className="aw-hud-row">
          <div className="aw-hud-funds">
            <span className="stat" aria-hidden={shown !== funds ? true : undefined}>{creditsText(shown)}</span>
            <span className="label aw-muted">CR</span>
            {shown !== funds && <span className="aww-sr">{creditsText(funds)} CR</span>}
          </div>
          {aside}
        </div>
        {power && <PowerMeter {...power} />}
        {children}
      </div>
    </Frame>
  );
}
