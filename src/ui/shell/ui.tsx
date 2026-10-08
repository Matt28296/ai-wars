// Shell building blocks on top of the kit (src/ui/kit): every control is a [data-nav] target for the
// shell's spatial navigation (input.ts) and plays the right sound.
import { type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button, type ButtonProps } from '../kit/controls';
import { CommanderPortrait } from '../kit/commander';
import { Sigil } from '../kit/primitives';
import { chamfer, cx, factionShort, inkOf } from '../kit/util';
import type { FactionId } from '../../engine/types';
import type { Mood } from '../../content/types';
import { ArtPortrait, sound, speakerInfo, type SfxName } from './bridges';

// ---------------------------------------------------------------- buttons
export interface BtnProps extends ButtonProps { sfx?: SfxName | null; autoFocus?: boolean }
export function Btn({ sfx = 'confirm', onClick, autoFocus, ...rest }: BtnProps) {
  return (
    <Button
      data-nav=""
      data-autofocus={autoFocus ? '' : undefined}
      onClick={(e) => { if (sfx) sound.sfx(sfx); onClick?.(e); }}
      {...rest}
    />
  );
}

/** Big menu row: index, label, caption; the active (focused) row turns signal with the ▸ cursor. */
export function MenuRow({ index, label, caption, onSelect, onFocus, disabled, autoFocus, aside, sfx = 'confirm', className }: {
  index?: string; label: ReactNode; caption?: ReactNode; onSelect(): void; onFocus?(): void; disabled?: boolean;
  autoFocus?: boolean; aside?: ReactNode; sfx?: SfxName; className?: string;
}) {
  return (
    <button
      type="button"
      data-nav=""
      data-autofocus={autoFocus ? '' : undefined}
      className={cx('sh-mrow', className)}
      disabled={disabled}
      onFocus={onFocus}
      onClick={() => { sound.sfx(sfx); onSelect(); }}
    >
      <span className="sh-mrow-cursor" aria-hidden />
      {index && <span className="sh-mrow-index stat-sm" aria-hidden>{index}</span>}
      <span className="sh-mrow-text">
        <span className="sh-mrow-label">{label}</span>
        {caption && <span className="sh-mrow-caption caption">{caption}</span>}
      </span>
      {aside && <span className="sh-mrow-aside">{aside}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- stepper
export interface StepOption<T> { value: T; label: string }
/** A row that cycles through values with ←/→ (or its arrows, or a click). `bar` shows 0–N as segments. */
export function Stepper<T>({ label, value, options, onChange, hint, bar, disabled, wrap = true, className, autoFocus, compact }: {
  label: ReactNode; value: T; options: StepOption<T>[]; onChange(v: T): void; hint?: ReactNode; bar?: boolean;
  disabled?: boolean; wrap?: boolean; className?: string; autoFocus?: boolean; compact?: boolean;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const cur = options[i];
  const step = (d: number) => {
    if (disabled) return;
    let n = i + d;
    if (n < 0 || n >= options.length) {
      if (!wrap) { sound.sfx('error'); return; }
      n = (n + options.length) % options.length;
    }
    if (n === i) return;
    sound.sfx('cursor');
    onChange(options[n]!.value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); step(1); }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (!e.repeat) step(1); }
  };
  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={typeof label === 'string' ? label : undefined}
      aria-valuemin={0}
      aria-valuemax={options.length - 1}
      aria-valuenow={i}
      aria-valuetext={cur?.label}
      aria-disabled={disabled || undefined}
      data-nav=""
      data-nav-keys="x"
      data-autofocus={autoFocus ? '' : undefined}
      className={cx('sh-step', compact && 'sh-step--compact', disabled && 'sh-step--disabled', className)}
      onKeyDown={onKeyDown}
    >
      <span className="sh-step-text">
        <span className="label sh-step-label">{label}</span>
        {hint && <span className="caption sh-step-hint">{hint}</span>}
      </span>
      <span className="sh-step-ctl">
        <button type="button" tabIndex={-1} className="sh-step-arrow" aria-label="Previous" disabled={disabled || (!wrap && i === 0)}
          onClick={(e) => { e.stopPropagation(); step(-1); }}>
          <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden><path d="M7 1 2 6l5 5" /></svg>
        </button>
        {bar ? (
          <span className="sh-step-bar" aria-hidden>
            {options.slice(1).map((o, k) => (
              <span key={k} className={cx('sh-seg', k < i && 'sh-seg--on')}
                onClick={(e) => { e.stopPropagation(); if (!disabled) { sound.sfx('cursor'); onChange((k + 1 === i ? options[k]! : options[k + 1]!).value); } }} />
            ))}
            <span className="stat-sm sh-step-num">{cur?.label}</span>
          </span>
        ) : (
          <span className="label sh-step-value" onClick={(e) => { e.stopPropagation(); step(1); }}>{cur?.label}</span>
        )}
        <button type="button" tabIndex={-1} className="sh-step-arrow" aria-label="Next" disabled={disabled || (!wrap && i === options.length - 1)}
          onClick={(e) => { e.stopPropagation(); step(1); }}>
          <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden><path d="M1 1l5 5-5 5" /></svg>
        </button>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- identity
/** Commander / speaker portrait: src/art Portrait when available, else the monogram plate.
 *  Minor characters (not in the roster) get a neutral monogram — never ECHO's signal plate. */
export function Face({ speaker, mood, size = 96, className, style }: { speaker: string; mood?: Mood; size?: number; className?: string; style?: CSSProperties }) {
  const info = speakerInfo(speaker);
  const clip = chamfer(size >= 72 ? 'var(--chamfer)' : 'var(--chamfer-sm)');
  if (info.id && ArtPortrait) {
    return (
      <div className={cx('sh-face', className)} role="img" aria-label={info.name}
        style={{ width: size, height: size, clipPath: clip, background: info.faction ? `var(--${info.faction})` : 'var(--signal-soft)', ...style }}>
        <ArtPortrait commander={info.id} mood={mood} size={size} />
      </div>
    );
  }
  if (info.known) return <CommanderPortrait className={className} name={info.name} faction={info.faction} initials={info.initials} size={size} />;
  return (
    <div className={cx('sh-face', 'sh-face--minor', className)} role="img" aria-label={info.name} style={{ width: size, height: size, ...style }}>
      <span className="sh-face-initials" style={{ fontSize: Math.round(size * 0.34) }}>{info.initials}</span>
    </div>
  );
}

/** Faction name in its ink, always with its sigil. */
export function FactionTag({ faction, short = true, size = 14, className }: { faction: FactionId | null; short?: boolean; size?: number; className?: string }) {
  return (
    <span className={cx('sh-ftag', 'label', className)} style={{ color: inkOf(faction) }}>
      <Sigil faction={faction} size={size} />
      <span>{short ? factionShort(faction) : faction ? factionShort(faction) : 'ECHO'}</span>
    </span>
  );
}

/** Star cost as a row of diamonds (Surge small, Overclock large — as on the power meter). */
export function Stars({ n, big }: { n: number; big?: boolean }) {
  return (
    <span className={cx('sh-stars', big && 'sh-stars--big')} role="img" aria-label={`${n} stars`}>
      {Array.from({ length: n }, (_, i) => <span key={i} />)}
    </span>
  );
}

// ---------------------------------------------------------------- chrome
export function KeyHints({ items, className }: { items: [string, string][]; className?: string }) {
  return (
    <div className={cx('sh-hints', className)} aria-hidden>
      {items.map(([k, t]) => (
        <span key={k + t} className="sh-hint"><kbd className="aw-key">{k}</kbd><span className="caption">{t}</span></span>
      ))}
    </div>
  );
}

export function ScreenHeader({ kicker, title, onBack, aside }: { kicker: ReactNode; title: ReactNode; onBack?: () => void; aside?: ReactNode }) {
  return (
    <header className="sh-head">
      <div className="sh-head-text">
        <div className="label sh-kicker">{kicker}</div>
        <h1 className="headline sh-head-title">{title}</h1>
      </div>
      <div className="sh-head-aside">
        {aside}
        {onBack && <Btn variant="ghost" size="sm" hotkey="X" sfx="cancel" onClick={onBack}>Back</Btn>}
      </div>
    </header>
  );
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export function timeAgo(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
