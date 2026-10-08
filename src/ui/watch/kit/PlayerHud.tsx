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
  power?: PowerMeterProps;
  cycle?: number;
  /** Extra rows under the power meter (a viewer adds the unit count and the turn marker here). */
  children?: ReactNode;
  className?: string;
}

/** One player's corner of the battlefield: commander, funds, cycle and power. */
export function PlayerHud({ commander, funds = 0, power, cycle, children, className }: PlayerHudProps): ReactElement {
  return (
    <Frame floating className={cx('aw-hud', className)}>
      <CommanderPortrait {...commander} size={48} />
      <div className="aw-hud-body">
        <div className="aw-hud-top">
          <span className="heading" style={{ color: inkOf(commander.faction) }}>{commander.name}</span>
          {cycle != null && <span className="label aw-muted">Cycle {pad2(cycle)}</span>}
        </div>
        <div className="aw-hud-funds">
          <span className="stat">{creditsText(funds)}</span>
          <span className="label aw-muted">CR</span>
        </div>
        {power && <PowerMeter {...power} />}
        {children}
      </div>
    </Frame>
  );
}
