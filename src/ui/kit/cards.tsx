import type { ReactNode } from 'react';
import { MOVE_TYPE_NAMES, TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import type { FactionId, TerrainId, UnitTypeId } from '../../engine/types';
import { StatusChip } from './controls';
import { Diamonds, Frame, Kicker, Meter, useKitArt } from './primitives';
import { MapTile, UnitToken } from './UnitToken';
import { cx, factionName, factionShort, inkOf, type FactionOrEcho } from './util';

// ---------- TerrainCard ----------
export interface TerrainCardProps {
  terrain?: TerrainId;
  owner?: FactionOrEcho;
  capture?: number | null;     // capture points remaining (20 = untouched)
  /** Defense stars to show (defaults to the terrain's own; pass 0 for air units). */
  def?: number;
  note?: string;
  className?: string;
  style?: React.CSSProperties;
}
export function TerrainCard({ terrain = 'flats', owner, capture, def, note, className, style }: TerrainCardProps) {
  const art = useKitArt();
  const t = TERRAIN_TYPES[terrain] || TERRAIN_TYPES.flats;
  const n = note ?? t.note ?? '';
  const meta = t.property ? `${owner ? factionShort(owner) : 'Neutral'}${n ? ' · ' + n : ''}` : n || 'Terrain';
  const stars = def ?? t.def;
  return (
    <Frame size="sm" className={cx('aw-card', className)} style={style}>
      <Kicker>Terrain</Kicker>
      <div className="aw-card-head">
        {art.terrain ? <span className="aw-card-art" style={{ width: 32, height: 32 }}>{art.terrain({ terrain, owner, size: 32 })}</span> : <MapTile terrain={terrain} owner={owner} size={32} />}
        <div>
          <div className="heading aw-card-title">{t.name}</div>
          <div className="caption aw-muted">{meta}</div>
        </div>
      </div>
      <div className="aw-stat-row">
        <span className="label aw-muted">Def</span>
        <Diamonds value={stars} label={`Defense ${stars} of 4`} />
        <span className="stat-sm">{stars}</span>
      </div>
      {t.property && capture != null && (
        <div className="aw-stat-row">
          <span className="label aw-muted">Capture</span>
          <Meter value={20 - capture} max={20} tone={capture < 20 ? 'warn' : undefined} />
          <span className="stat-sm">{`${capture}/20`}</span>
        </div>
      )}
    </Frame>
  );
}

// ---------- UnitCard ----------
export interface UnitCardProps {
  unit?: UnitTypeId;
  faction?: FactionId;
  hp?: number;               // display HP 0–10
  charge?: number;
  ammo?: number | null;
  /** Extra chips (e.g. "Capturing", "Carrying Trooper"). */
  extra?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
export function UnitCard({ unit = 'trooper', faction = 'helion', hp = 10, charge, ammo, extra, className, style }: UnitCardProps) {
  const art = useKitArt();
  const u = UNIT_TYPES[unit] || UNIT_TYPES.trooper;
  const ch = charge != null ? charge : u.charge;
  const am = ammo !== undefined ? ammo : u.ammo;
  const crit = hp <= 3;
  const lowCharge = ch <= Math.round(u.charge * 0.2);
  const lowAmmo = u.ammo != null && am != null && am <= 1;
  return (
    <Frame size="sm" className={cx('aw-card', className)} style={style}>
      <Kicker>Unit</Kicker>
      <div className="aw-card-head">
        {art.unit ? <span className="aw-card-art" style={{ width: 40, height: 40 }}>{art.unit({ type: unit, faction, size: 40, facing: 'right', hp })}</span> : <UnitToken unit={unit} faction={faction} hp={hp} size={40} decorative />}
        <div>
          <div className="heading aw-card-title" style={{ color: inkOf(faction) }}>{u.name}</div>
          <div className="caption aw-muted">{`${u.role} · ${MOVE_TYPE_NAMES[u.moveType]}`}</div>
        </div>
      </div>
      <div className="aw-stat-row">
        <span className="label aw-muted">HP</span>
        <span className={cx('aw-hpbar', crit && 'aw-hpbar--crit')} role="img" aria-label={`${hp} of 10 HP`}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={i < hp ? 'on' : undefined} />
          ))}
        </span>
        <span className="stat-sm" style={crit ? { color: 'var(--danger)' } : undefined}>{hp}</span>
      </div>
      <div className="aw-stat-row">
        <span className="label aw-muted">Charge</span>
        <Meter value={ch} max={u.charge} tone={lowCharge ? 'warn' : undefined} />
        <span className="stat-sm" style={lowCharge ? { color: 'var(--warn)' } : undefined}>{ch}</span>
      </div>
      <div className="aw-stat-row">
        <span className="label aw-muted">Ammo</span>
        {u.ammo == null ? <span className="caption aw-muted aw-grow">No primary weapon</span> : <Meter value={am ?? 0} max={u.ammo} tone={lowAmmo ? 'warn' : undefined} />}
        <span className="stat-sm" style={lowAmmo ? { color: 'var(--warn)' } : undefined}>{u.ammo == null ? '—' : am}</span>
      </div>
      {(crit || lowCharge || lowAmmo || extra) && (
        <div className="aw-chips">
          {crit && <StatusChip tone="danger">Critical</StatusChip>}
          {lowCharge && <StatusChip tone="warn">Low charge</StatusChip>}
          {lowAmmo && <StatusChip tone="warn">{am === 0 ? 'No ammo' : 'Low ammo'}</StatusChip>}
          {extra}
        </div>
      )}
    </Frame>
  );
}

// ---------- BattleForecast ----------
export interface ForecastSide {
  unit: UnitTypeId;
  faction: FactionId;
  hp: number;        // display HP
  hpRaw?: number;    // internal HP 1–100, for exact "leaves" text
}
function Side({ who, align }: { who: ForecastSide; align?: 'end' }) {
  const art = useKitArt();
  const u = UNIT_TYPES[who.unit];
  const facing = align === 'end' ? 'left' : 'right';
  return (
    <div className={cx('aw-fc-side', align === 'end' && 'aw-fc-side--end')}>
      {art.unit ? <span className="aw-card-art" style={{ width: 40, height: 40 }}>{art.unit({ type: who.unit, faction: who.faction, size: 40, facing, hp: who.hp })}</span> : <UnitToken unit={who.unit} faction={who.faction} hp={who.hp} size={40} facing={facing} decorative />}
      <div>
        <div className="heading" style={{ color: inkOf(who.faction) }}>{u.name}</div>
        <div className="caption aw-muted">{`${factionName(who.faction)} · ${Math.ceil(who.hp)} HP`}</div>
      </div>
    </div>
  );
}
export interface BattleForecastProps {
  attacker: ForecastSide;
  defender: ForecastSide;
  damage?: [number, number];
  counter?: [number, number] | null;
  className?: string;
  style?: React.CSSProperties;
}
export function BattleForecast({ attacker, defender, damage = [0, 0], counter = null, className, style }: BattleForecastProps) {
  const raw = defender.hpRaw ?? defender.hp * 10;
  const left = (d: number) => Math.max(0, Math.ceil((raw - d) / 10));
  const after: [number, number] = [left(damage[1]), left(damage[0])];
  const kills = after[1] === 0;
  const range = (r: [number, number]) => (r[0] === r[1] ? `${r[0]}%` : `${r[0]}–${r[1]}%`);
  return (
    <Frame floating className={cx('aw-forecast', className)} style={style}>
      <Kicker>Battle forecast</Kicker>
      <div className="aw-fc-sides">
        <Side who={attacker} />
        <span className="label aw-muted">vs</span>
        <Side who={defender} align="end" />
      </div>
      <div className="aw-fc-nums">
        <div>
          <div className="label aw-muted">Damage</div>
          <div className="stat">{range(damage)}</div>
        </div>
        <div>
          <div className="label aw-muted">Counter</div>
          <div className="stat" style={counter ? undefined : { color: 'var(--ink-muted)' }}>{counter ? range(counter) : 'None'}</div>
        </div>
      </div>
      <div className="aw-fc-foot">
        {kills ? (
          <StatusChip tone="signal">Destroys target</StatusChip>
        ) : after[0] === 0 ? (
          <StatusChip tone="signal">{`May destroy · leaves 0–${after[1]} HP`}</StatusChip>
        ) : (
          <span className="caption aw-muted">{`Leaves ${after[0] === after[1] ? after[0] : after[0] + '–' + after[1]} HP`}</span>
        )}
      </div>
    </Frame>
  );
}
