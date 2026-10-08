import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Icon, cx, inkOf } from './roles';
import type { Faction, IconName } from './roles';
import { Sigil } from './Sigil';

export interface StatusChipProps {
  tone?: 'neutral' | 'signal' | 'warn' | 'danger' | 'faction';
  /** Required when tone = "faction". */
  faction?: Faction;
  /** Override the tone's icon, or false for none (only when the word alone is unambiguous). */
  icon?: IconName | false;
  children: ReactNode;
  className?: string;
}

const TONE_ICON: Partial<Record<NonNullable<StatusChipProps['tone']>, IconName>> = { signal: 'dot', warn: 'diamond', danger: 'cross' };

/** One or two words of state with an icon. Status is never colour alone: every tone carries its icon (or the faction sigil). */
export function StatusChip({ tone = 'neutral', faction, icon, children, className }: StatusChipProps): ReactElement {
  const style: CSSProperties | undefined = tone === 'faction' ? { color: inkOf(faction), borderColor: inkOf(faction) } : undefined;
  const ic = icon === false ? null : icon ?? TONE_ICON[tone];
  return (
    <span className={cx('aw-chip', 'caption', `aw-chip--${tone}`, className)} style={style}>
      {tone === 'faction' && icon !== false ? <Sigil faction={faction ?? null} size={12} tone="ink" /> : ic ? <Icon name={ic} size={10} /> : null}
      <span>{children}</span>
    </span>
  );
}
