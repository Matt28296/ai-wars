import type { ReactElement } from 'react';
import { ART, UNIT_TYPES } from '../../../data';
import type { UnitTypeId } from '../../../game/aw';
import { ICONS, Paths, cx, factionName, fillOf, markOf, onOf } from './roles';
import type { Faction, PathSpec } from './roles';

export type TokenStatus = 'low-charge' | 'low-ammo' | 'capturing' | 'loaded';

export interface UnitTokenProps {
  unit: UnitTypeId;
  faction: Faction;
  /** Display HP 1-10; the HP chip only shows below 10 (danger colour at 3 or less). */
  hp?: number;
  /** Has acted this turn: greyed out. */
  spent?: boolean;
  selected?: boolean;
  facing?: 'left' | 'right';
  /** Square size in px; 48 = one tile. */
  size?: number;
  status?: TokenStatus;
  /** Hide from assistive tech when a visible label already names the unit. */
  decorative?: boolean;
  className?: string;
}

const GLYPHS = ART.glyphs as unknown as Record<string, readonly PathSpec[]>;
const SIGILS = ART.sigils as unknown as Record<string, readonly PathSpec[]>;

const STATUS_ICON: Record<TokenStatus, readonly [keyof typeof ICONS, string]> = {
  'low-charge': ['bolt', 'var(--warn)'],
  'low-ammo': ['ammo', 'var(--warn)'],
  capturing: ['flag', 'var(--signal)'],
  loaded: ['cargo', 'var(--map-ink)'],
};
const STATUS_WORD: Record<TokenStatus, string> = {
  'low-charge': 'low charge',
  'low-ammo': 'low ammo',
  capturing: 'capturing',
  loaded: 'carrying cargo',
};

/** A unit on the battlefield: faction plate, unit glyph, sigil chip, HP chip and status chip in one square. */
export function UnitToken({ unit, faction, hp = 10, spent, selected, facing = 'right', size = 48, status, decorative, className }: UnitTokenProps): ReactElement {
  const def = UNIT_TYPES[unit] ?? UNIT_TYPES.trooper;
  const hpShown = Math.max(0, Math.min(10, Math.ceil(hp)));
  const choir = faction === 'choir';
  const label = `${factionName(faction)} ${def.name}, ${hpShown} HP${spent ? ', has acted' : ''}${status ? `, ${STATUS_WORD[status]}` : ''}`;
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': label };
  const st = status ? STATUS_ICON[status] : undefined;
  return (
    <svg className={cx('aw-unit', spent && 'aw-unit--spent', selected && 'aw-unit--selected', className)} width={size} height={size} viewBox="0 0 48 48" {...a11y}>
      <g className="aw-unit-body">
        <polygon
          points="12,6 42,6 42,36 36,42 6,42 6,12"
          style={{ fill: fillOf(faction), stroke: choir ? 'var(--on-choir)' : 'var(--map-shade)', strokeWidth: choir ? 1.5 : 2, strokeLinejoin: 'round' }}
        />
        <Paths
          list={GLYPHS[def.id] ?? []}
          color={onOf(faction)}
          transform={facing === 'left' ? 'translate(38,9) scale(-1.1667,1.1667)' : 'translate(10,9) scale(1.1667)'}
        />
      </g>
      {selected && <polygon className="aw-unit-ring" points="11,3.5 44.5,3.5 44.5,37 37,44.5 3.5,44.5 3.5,11" />}
      <rect x={1} y={1} width={15} height={15} rx={2} style={{ fill: 'var(--map-shade)' }} />
      <g transform="translate(2.5,2.5) scale(0.5)">
        <Paths list={SIGILS[faction] ?? []} color={markOf(faction)} />
      </g>
      {st && (
        <g>
          <rect x={32} y={1} width={15} height={15} rx={2} style={{ fill: 'var(--map-shade)' }} />
          <path d={ICONS[st[0]]} transform="translate(33.5,2.5)" style={{ fill: st[1] }} />
        </g>
      )}
      {hpShown < 10 && (
        <g>
          <rect x={31} y={31} width={16} height={16} rx={2} style={{ fill: 'var(--map-shade)' }} />
          <text x={39} y={43.6} textAnchor="middle" className="aw-unit-hp" style={{ fill: hpShown <= 3 ? 'var(--danger)' : 'var(--map-ink)' }}>
            {hpShown}
          </text>
        </g>
      )}
    </svg>
  );
}
