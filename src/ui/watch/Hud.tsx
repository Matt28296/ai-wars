// The HUD: one panel per player (sigil, commander, funds, power stars, unit count), drawn from the viewer's frame only.
import type { ReactElement } from 'react';
import { PlayerHud, Sigil, StatusChip, cx } from './kit';
import { playerPanels } from './hud';
import type { PlayerPanelModel } from './hud';
import type { TimelineStep } from './timeline';

function Panel({ p }: { p: PlayerPanelModel }): ReactElement {
  return (
    <PlayerHud
      className={cx('aww-hud', p.isCurrent && !p.defeated && 'aww-hud--current', p.defeated && 'aww-hud--defeated')}
      commander={{ name: p.commanderName, faction: p.faction, initials: p.initials, state: p.active ?? undefined }}
      funds={p.funds}
      power={{ value: p.meter.value, surge: p.meter.surge, max: p.meter.max, active: p.active }}
    >
      <div className="aww-hud-meta">
        <Sigil faction={p.faction} size={16} tone="ink" />
        <span className="label aww-muted">{p.factionName}</span>
        <span className="aww-hud-units stat-sm" title={p.units === null ? 'Enemy unit count is hidden by fog' : 'Units'}>
          <span className="label aww-muted">Units</span> {p.units === null ? '?' : p.units}
        </span>
        {p.isCurrent && !p.defeated && <StatusChip tone="signal">Turn</StatusChip>}
        {p.defeated && <StatusChip tone="danger">Defeated</StatusChip>}
      </div>
    </PlayerHud>
  );
}

export function Hud({ step }: { step: TimelineStep }): ReactElement {
  const panels = playerPanels(step);
  return (
    <div className="aww-huds" aria-label="Players">
      {panels.map((p) => <Panel key={p.index} p={p} />)}
    </div>
  );
}
