import { useEffect, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { UNIT_TYPES, UNIT_LIST } from '../../data';
import type { FactionId, UnitTypeId } from '../../engine/types';
import { Frame, Icon, Sigil, useKitArt, type IconName } from './primitives';
import { UnitToken } from './UnitToken';
import { credits, cx, inkOf, type FactionOrEcho } from './util';

// ---------- Button ----------
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  hotkey?: string;
}
export function Button({ variant = 'secondary', size = 'md', hotkey, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx('aw-btn', 'label', `aw-btn--${variant}`, size === 'sm' && 'aw-btn--sm', className)} {...rest}>
      <span>{children}</span>
      {hotkey && <kbd className="aw-key">{hotkey}</kbd>}
    </button>
  );
}

// ---------- StatusChip ----------
const TONE_ICON: Partial<Record<string, IconName>> = { signal: 'dot', warn: 'diamond', danger: 'cross' };
export interface StatusChipProps {
  tone?: 'neutral' | 'signal' | 'warn' | 'danger' | 'faction';
  faction?: FactionOrEcho;
  icon?: IconName | false;
  children: ReactNode;
  className?: string;
}
/** Status is never colour alone: every tone carries an icon (or the faction sigil). */
export function StatusChip({ tone = 'neutral', faction, icon, children, className }: StatusChipProps) {
  const style = tone === 'faction' ? { color: inkOf(faction), borderColor: inkOf(faction) } : undefined;
  const ic = icon === false ? null : icon || TONE_ICON[tone];
  return (
    <span className={cx('aw-chip', 'caption', `aw-chip--${tone}`, className)} style={style}>
      {tone === 'faction' && icon !== false ? <Sigil faction={faction} size={12} tone="ink" /> : ic && <Icon name={ic} size={10} />}
      <span>{children}</span>
    </span>
  );
}

// ---------- menu keyboard handling ----------
export interface MenuNav {
  ids: string[];
  activeId?: string;
  isDisabled?: (id: string) => boolean;
  onActiveChange?: (id: string) => void;
  onSelect?: (id: string) => void;
  onCancel?: () => void;
}
/** Arrow keys / Home / End move the active row (wrapping), Enter/Space/Z choose, Esc/X/Backspace cancel. */
export function menuKeyDown(e: KeyboardEvent<HTMLElement>, nav: MenuNav) {
  const { ids, activeId, onActiveChange, onSelect, onCancel, isDisabled } = nav;
  if (!ids.length) return;
  const i = Math.max(0, ids.indexOf(activeId ?? ''));
  const step = (d: number) => {
    for (let k = 1; k <= ids.length; k++) {
      const id = ids[(i + d * k + ids.length * k) % ids.length];
      if (!isDisabled?.(id)) return id;
    }
    return ids[i];
  };
  let handled = true;
  switch (e.key) {
    case 'ArrowDown': case 's': case 'S': onActiveChange?.(step(1)); break;
    case 'ArrowUp': case 'w': case 'W': onActiveChange?.(step(-1)); break;
    case 'Home': onActiveChange?.(ids.find((id) => !isDisabled?.(id)) ?? ids[0]); break;
    case 'End': onActiveChange?.([...ids].reverse().find((id) => !isDisabled?.(id)) ?? ids[ids.length - 1]); break;
    case 'Enter': case ' ': case 'z': case 'Z': if (activeId && !isDisabled?.(activeId)) onSelect?.(activeId); break;
    case 'Escape': case 'x': case 'X': case 'Backspace': if (onCancel) onCancel(); else handled = false; break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

/** Keeps DOM focus on the active row while the menu owns focus (roving tabindex). */
function useRovingFocus(activeId: string | undefined, autoFocus: boolean | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !activeId) return;
    const owns = el.contains(document.activeElement);
    if (!owns && !autoFocus) return;
    const btn = el.querySelector<HTMLElement>(`[data-id="${CSS.escape(activeId)}"]`);
    btn?.focus({ preventScroll: true });
  }, [activeId, autoFocus]);
  return ref;
}

// ---------- CommandMenu ----------
export interface CommandItem { id: string; label: ReactNode; hint?: ReactNode; disabled?: boolean }
export interface CommandMenuProps {
  title?: ReactNode;
  items: CommandItem[];
  activeId?: string;
  onSelect?: (id: string) => void;
  onActiveChange?: (id: string) => void;
  onCancel?: () => void;
  /** Take DOM focus on mount so the menu drives itself from the keyboard (shell screens). */
  autoFocus?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
export function CommandMenu({ title, items, activeId, onSelect, onActiveChange, onCancel, autoFocus, className, style }: CommandMenuProps) {
  const ref = useRovingFocus(activeId, autoFocus);
  const ids = items.map((i) => i.id);
  const disabled = (id: string) => !!items.find((i) => i.id === id)?.disabled;
  return (
    <Frame size="sm" raised floating className={cx('aw-menu', className)} style={style}>
      {title && <div className="aw-menu-title caption">{title}</div>}
      <div
        ref={ref}
        role="menu"
        aria-label={typeof title === 'string' ? title : 'Commands'}
        onKeyDown={(e) => menuKeyDown(e, { ids, activeId, isDisabled: disabled, onActiveChange, onSelect, onCancel })}
      >
        {items.map((it) => {
          const active = it.id === activeId;
          return (
            <button
              key={it.id}
              data-id={it.id}
              type="button"
              role="menuitem"
              tabIndex={active || (!activeId && it === items[0]) ? 0 : -1}
              disabled={it.disabled}
              aria-current={active ? 'true' : undefined}
              className={cx('aw-row', active && 'aw-row--active')}
              onMouseEnter={() => !it.disabled && onActiveChange?.(it.id)}
              onClick={(e) => { e.stopPropagation(); onSelect?.(it.id); }}
            >
              <span className="aw-row-cursor" aria-hidden />
              <span className="aw-row-label label">{it.label}</span>
              {it.hint != null && <span className="aw-row-hint stat-sm">{it.hint}</span>}
            </button>
          );
        })}
      </div>
    </Frame>
  );
}

// ---------- BuildMenu ----------
export interface BuildItem { unit: UnitTypeId; cost?: number; affordable?: boolean }
export interface BuildMenuProps {
  title?: string;
  items?: (UnitTypeId | BuildItem)[];
  funds?: number;
  faction?: FactionId;
  activeId?: string;
  onSelect?: (unit: UnitTypeId) => void;
  onActiveChange?: (unit: UnitTypeId) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
export function BuildMenu({ title = 'Fabricator', items, funds = 0, faction, activeId, onSelect, onActiveChange, onCancel, autoFocus, className, style }: BuildMenuProps) {
  const art = useKitArt();
  const ref = useRovingFocus(activeId, autoFocus);
  const list = (items || UNIT_LIST.filter((u) => u.domain === 'ground').map((u) => u.id)).map((it) => (typeof it === 'string' ? { unit: it } : it));
  const shortOf = (it: BuildItem) => (it.affordable != null ? !it.affordable : (it.cost ?? UNIT_TYPES[it.unit].cost) > funds);
  return (
    <Frame size="sm" raised floating className={cx('aw-build', className)} style={style}>
      <div className="aw-build-head">
        <span className="label" style={{ color: 'var(--ink-muted)' }}>{title}</span>
        <span className="stat-sm">
          {credits(funds)}
          <span className="aw-unit-cr"> CR</span>
        </span>
      </div>
      <div
        ref={ref}
        role="menu"
        aria-label={`${title} build list`}
        className="aw-build-list"
        onKeyDown={(e) =>
          menuKeyDown(e, {
            ids: list.map((i) => i.unit),
            activeId,
            onActiveChange: onActiveChange as (id: string) => void,
            onSelect: (id) => { const it = list.find((i) => i.unit === id); if (it && !shortOf(it)) onSelect?.(id as UnitTypeId); },
            onCancel,
          })
        }
      >
        {list.map((it) => {
          const u = UNIT_TYPES[it.unit];
          const cost = it.cost != null ? it.cost : u.cost;
          const short = shortOf(it);
          const active = it.unit === activeId;
          return (
            <button
              key={it.unit}
              data-id={it.unit}
              type="button"
              role="menuitem"
              tabIndex={active || (!activeId && it === list[0]) ? 0 : -1}
              aria-disabled={short || undefined}
              aria-current={active ? 'true' : undefined}
              className={cx('aw-row', 'aw-build-row', active && 'aw-row--active', short && 'aw-row--short')}
              onMouseEnter={() => onActiveChange?.(it.unit)}
              onClick={(e) => { e.stopPropagation(); if (!short) onSelect?.(it.unit); }}
            >
              <span className="aw-row-cursor" aria-hidden />
              <span className={cx('aw-build-art', short && 'aw-build-art--short')} aria-hidden>
                {art.unit && faction ? art.unit({ type: it.unit, faction, size: 32, facing: 'right', spent: short }) : <UnitToken unit={it.unit} faction={faction} size={32} spent={short} decorative />}
              </span>
              <span className="aw-build-name">
                <span className="aw-row-label label">{u.name}</span>
                <span className="caption aw-muted">{u.role}</span>
              </span>
              <span className="aw-row-hint stat-sm">{credits(cost)}</span>
            </button>
          );
        })}
      </div>
    </Frame>
  );
}
