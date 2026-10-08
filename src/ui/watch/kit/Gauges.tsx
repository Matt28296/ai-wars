// The small gauges of the design system's intel cards (UnitCard, TerrainCard), ported from design-system/project/components/bundle.js to typed
// TSX with the same markup and classes: defense diamonds, the charge meter, the segmented HP bar. Ammo gets rounds, which the originals
// do not have: a handful of pips reads faster than a bar for "6 left".
import type { ReactElement, ReactNode } from 'react';
import { cx } from './roles';

export function Kicker({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <div className={cx('aw-kicker', 'label', className)}>{children}</div>;
}

/** Defense stars: filled diamonds for the value, outlined ones for the rest. The number beside it repeats the count. */
export function Diamonds({ value, total = 4, label }: { value: number; total?: number; label?: string }): ReactElement {
  return (
    <span className="aw-diamonds" role="img" aria-label={label ?? `${value} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cx('aw-diamond', i < value && 'aw-diamond--on')} />
      ))}
    </span>
  );
}

/** A thin horizontal meter; `warn` paints it in the warning colour. */
export function Meter({ value, max, tone }: { value: number; max: number; tone?: 'warn' }): ReactElement {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <span className={cx('aw-meter', tone && `aw-meter--${tone}`)} aria-hidden>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Ten segments, one per display HP. Critical (3 or less) turns them to the danger colour; the number beside it and a chip say it in words. */
export function HpBar({ hp, crit }: { hp: number; crit?: boolean }): ReactElement {
  return (
    <span className={cx('aw-hpbar', crit && 'aw-hpbar--crit')} role="img" aria-label={`${hp} of 10 HP`}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={i < hp ? 'on' : undefined} />
      ))}
    </span>
  );
}

/** Rounds left of a limited primary weapon, one pip each. Low (one or none) turns them to the warning colour. */
export function Rounds({ value, max, low }: { value: number; max: number; low?: boolean }): ReactElement {
  return (
    <span className={cx('aw-rounds', low && 'aw-rounds--low')} role="img" aria-label={`${value} of ${max} rounds`}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < value ? 'on' : undefined} />
      ))}
    </span>
  );
}
