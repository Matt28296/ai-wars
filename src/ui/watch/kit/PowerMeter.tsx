import { useId } from 'react';
import type { ReactElement } from 'react';
import { cx } from './roles';

export interface PowerMeterProps {
  /** Stars filled, fractional. */
  value?: number;
  /** Stars for Surge. */
  surge?: number;
  /** Stars for Overclock (the whole bar). */
  max?: number;
  showLabel?: boolean;
  /** A running power replaces the charge word: the word, not just the glow, tells the viewer. */
  active?: 'surge' | 'overclock' | null;
  className?: string;
}

/** The commander's power gauge: small diamonds charge Surge, large diamonds charge Overclock. */
export function PowerMeter({ value = 0, surge = 3, max = 6, showLabel = true, active = null, className }: PowerMeterProps): ReactElement {
  const uid = useId().replace(/:/g, '');
  const v = Math.max(0, Math.min(max, value));
  const state = active === 'surge' ? 'Surge active' : active === 'overclock' ? 'Overclock active'
    : v >= max && max > 0 ? 'Overclock ready' : v >= surge && surge > 0 ? 'Surge ready' : 'Charging';
  const ready = active !== null || (surge > 0 && v >= surge);
  let x = 0;
  const pips = Array.from({ length: max }, (_, i) => {
    const big = i >= surge;
    const s = big ? 14 : 10;
    const y = big ? 0 : 2;
    const fill = Math.max(0, Math.min(1, v - i));
    const cxp = x + s / 2;
    const d = `M${cxp} ${y}l${s / 2} ${s / 2}-${s / 2} ${s / 2}-${s / 2}-${s / 2}z`;
    const el = (
      <g key={i}>
        <clipPath id={`${uid}p${i}`}>
          <path d={d} />
        </clipPath>
        <path d={d} className="aw-pip" />
        {fill > 0 && <rect x={x} y={y} width={s * fill} height={s} clipPath={`url(#${uid}p${i})`} className="aw-pip-fill" />}
      </g>
    );
    x += s + 3;
    return el;
  });
  const width = Math.max(1, x - 3);
  return (
    <div className={cx('aw-power', className)}>
      <svg width={width} height={14} viewBox={`0 0 ${width} 14`} role="img" aria-label={`Power ${Math.floor(v * 10) / 10} of ${max}: ${state}`}>
        {pips}
      </svg>
      {showLabel && <span className={cx('label', 'aw-power-state', ready && 'aw-power-state--ready')}>{state}</span>}
    </div>
  );
}
