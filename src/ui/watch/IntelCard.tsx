// The intel card: the unit the step is about and the ground it stands on, in the source games' panel layout (name, HP, charge, ammo, then
// the terrain's defense stars). It is drawn from one viewer's timeline only (intel.ts), so a fogged viewer's card cannot show a unit its
// board does not. It keeps one fixed height: stepping from a Trooper to an Anvil, or to nothing at all, moves nothing around it.
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { Diamonds, Frame, HpBar, Kicker, MapTile, Meter, Rounds, Sigil, StatusChip, UnitToken, cx, inkOf } from './kit';
import { intelAt, intelReasonLabel } from './intel';
import type { IntelModel, IntelTile, IntelUnit } from './intel';
import type { Seats } from './seats';
import type { Timeline } from './timeline';

export interface IntelCardProps {
  timeline: Timeline;
  /** The timeline step on screen. */
  step: number;
  /** How the view names its seats (WatchView's `people`); absent, the card names a side by its nation and its commander. */
  seats?: Seats;
}

export function IntelCard({ timeline, step, seats }: IntelCardProps): ReactElement {
  const model = useMemo(() => intelAt(timeline.steps, step, seats), [timeline, step, seats]);
  return <IntelCardView model={model} />;
}

const STATUS_WORD: Record<NonNullable<IntelUnit['status']>, string> = {
  capturing: 'Capturing',
  'low-charge': 'Low charge',
  'low-ammo': 'Low ammo',
  loaded: 'Carrying cargo',
};

function UnitSection({ unit }: { unit: IntelUnit }): ReactElement {
  // The warnings, most pressing first. The row holds one line of them: what would wrap is dropped whole (the gauges above say it too).
  const chips: ReactElement[] = [];
  if (unit.hpCritical) chips.push(<StatusChip key="hp" tone="danger">Critical</StatusChip>);
  if (unit.chargeLow) chips.push(<StatusChip key="charge" tone="warn">Low charge</StatusChip>);
  if (unit.ammo?.low) chips.push(<StatusChip key="ammo" tone="warn">{unit.ammo.value === 0 ? 'No ammo' : 'Low ammo'}</StatusChip>);
  if (unit.status === 'capturing') chips.push(<StatusChip key="capture" tone="signal">{STATUS_WORD.capturing}</StatusChip>);
  if (unit.loaded) chips.push(<StatusChip key="cargo">{STATUS_WORD.loaded}</StatusChip>);
  if (unit.spent) chips.push(<StatusChip key="spent">Has acted</StatusChip>);
  return (
    <div className="aww-intel-unit">
      <div className="aww-intel-who">
        <UnitToken unit={unit.type} faction={unit.faction} size={52} status={unit.status} masked={unit.masked} decorative />
        <div className="aww-intel-names">
          <div className="heading aww-intel-name" style={{ color: inkOf(unit.faction) }}>{unit.name}</div>
          <div className="caption aww-muted aww-intel-owner">
            <Sigil faction={unit.faction} size={14} tone="ink" masked={unit.masked} />
            <span>{unit.seated ? (unit.ownerNation ? `${unit.ownerName} · ${unit.ownerNation}` : unit.ownerName) : unit.factionName}</span>
          </div>
          <div className="caption aww-muted aww-intel-role">{unit.seated ? unit.role : <>{unit.commanderName} · {unit.role}</>}</div>
        </div>
      </div>
      <div className="aww-intel-stats">
        <div className="aw-stat-row">
          <span className="label aw-muted">HP</span>
          <HpBar hp={unit.hp} crit={unit.hpCritical} />
          <span className="stat-sm" style={unit.hpCritical ? { color: 'var(--danger)' } : undefined}>{unit.hp}/10</span>
        </div>
        <div className="aw-stat-row">
          <span className="label aw-muted">Charge</span>
          <Meter value={unit.charge} max={unit.chargeMax} tone={unit.chargeLow ? 'warn' : undefined} />
          <span className="stat-sm" style={unit.chargeLow ? { color: 'var(--warn)' } : undefined}>{unit.charge}/{unit.chargeMax}</span>
        </div>
        {unit.ammo ? (
          <div className="aw-stat-row">
            <span className="label aw-muted">Ammo</span>
            <Rounds value={unit.ammo.value} max={unit.ammo.max} low={unit.ammo.low} />
            <span className="stat-sm" style={unit.ammo.low ? { color: 'var(--warn)' } : undefined}>{unit.ammo.value}/{unit.ammo.max}</span>
          </div>
        ) : (
          <div className="aw-stat-row" data-weapon={unit.weapon}>
            <span className="label aw-muted">Weapon</span>
            <span className="caption aw-muted aw-grow">{unit.weapon === 'unarmed' ? 'Unarmed' : 'No ammo limit'}</span>
          </div>
        )}
      </div>
      {chips.length > 0 && (
        <div className="aww-intel-chips" aria-label="Warnings">
          {chips}
        </div>
      )}
    </div>
  );
}

function TerrainSection({ tile, airborne }: { tile: IntelTile; airborne: boolean }): ReactElement {
  const owner = tile.ownerLabel ?? 'Neutral';
  const meta =
    tile.property && tile.capture !== null
      ? `${owner} · capture ${tile.capture}/20`
      : tile.property
        ? `${owner} · ${tile.note}`
        : airborne && tile.terrainStars > 0
          ? `${tile.note} Air units take no cover.`
          : tile.note;
  return (
    <div className="aww-intel-terrain">
      <MapTile terrain={tile.terrain} owner={tile.owner ?? undefined} size={36} decorative />
      <div className="aww-intel-ground">
        <div className="aww-intel-ground-head">
          <span className="heading aww-intel-ground-name">{tile.name}</span>
          <span className="aww-intel-def" title={airborne ? 'Air units get no defense from terrain' : `Terrain defense ${tile.stars} of 4`}>
            <span className="label aw-muted">Def</span>
            <Diamonds value={tile.stars} label={`Defense ${tile.stars} of 4`} />
            <span className="stat-sm">{tile.stars}</span>
          </span>
        </div>
        <div className={cx('caption', 'aww-intel-meta', tile.capture !== null ? 'aww-intel-meta--warn' : 'aw-muted')}>{meta}</div>
      </div>
    </div>
  );
}

/** The card for a model. Exported on its own so markup tests can feed it a model without a match. */
export function IntelCardView({ model }: { model: IntelModel }): ReactElement {
  return (
    <Frame size="sm" className="aww-intel" role="region" aria-label="Unit intel" data-intel={model.kind}>
      <div className="aww-intel-head">
        <Kicker>Unit intel</Kicker>
        {model.kind === 'unit' && <span className="caption aww-muted aww-intel-why">{intelReasonLabel(model)}</span>}
      </div>
      {model.kind === 'unit' ? (
        <>
          <UnitSection unit={model.unit} />
          <TerrainSection tile={model.tile} airborne={model.unit.airborne} />
        </>
      ) : (
        <div className="aww-intel-empty">
          <span className="caption aww-muted">{model.message}</span>
        </div>
      )}
    </Frame>
  );
}
