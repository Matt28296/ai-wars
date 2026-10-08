import { useId, type ReactNode } from 'react';
import { Frame, Sigil, useKitArt } from './primitives';
import { chamfer, credits, cx, factionName, fillOf, inkOf, onOf, pad2, type FactionOrEcho } from './util';

// ---------- CommanderPortrait (initials plate; src/art Portrait is preferred where available) ----------
export interface CommanderInfo {
  id?: string;
  name?: string;
  faction?: FactionOrEcho;
  initials?: string;
  src?: string;
  state?: 'surge' | 'overclock' | 'none';
  mood?: string;
}
export function CommanderPortrait({ name, faction, initials, src, size = 96, state, className }: CommanderInfo & { size?: number; className?: string }) {
  const label = state === 'surge' ? 'Surge' : state === 'overclock' ? 'Overclock' : undefined;
  return (
    <div
      className={cx('aw-portrait', className)}
      role="img"
      aria-label={`${name || 'Commander'}${label ? ', ' + label + ' active' : ''}`}
      style={{
        width: size, height: size, background: fillOf(faction), color: onOf(faction),
        clipPath: chamfer(size >= 72 ? 'var(--chamfer)' : 'var(--chamfer-sm)'),
        outline: faction === 'choir' ? '1.5px solid var(--on-choir)' : undefined, outlineOffset: -1.5,
      }}
    >
      <span className="aw-portrait-mark" aria-hidden>
        <Sigil faction={faction} size={Math.round(size * 0.78)} tone="on" />
      </span>
      {src ? (
        <img src={src} alt="" className="aw-portrait-img" />
      ) : (
        <span className="aw-portrait-initials" style={{ fontSize: Math.round(size * 0.36) }}>
          {initials || (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2)}
        </span>
      )}
      {label && (
        <span className="aw-portrait-band label" style={size < 72 ? { fontSize: 9, letterSpacing: '0.04em' } : undefined}>
          {label}
        </span>
      )}
    </div>
  );
}

/** Portrait via the art provider when one is given (src/art Portrait), else the initials plate. */
export function CommanderFace(props: CommanderInfo & { size?: number; className?: string }) {
  const art = useKitArt();
  if (art.portrait && props.id) {
    const size = props.size ?? 96;
    const label = props.state === 'surge' ? 'Surge' : props.state === 'overclock' ? 'Overclock' : undefined;
    return (
      <div className={cx('aw-portrait', 'aw-portrait--art', props.className)} role="img" aria-label={`${props.name || 'Commander'}${label ? ', ' + label + ' active' : ''}`}
        style={{ width: size, height: size, background: fillOf(props.faction), clipPath: chamfer(size >= 72 ? 'var(--chamfer)' : 'var(--chamfer-sm)') }}>
        {art.portrait({ commander: props.id, faction: props.faction, size, mood: props.mood })}
        {label && <span className="aw-portrait-band label" style={size < 72 ? { fontSize: 9, letterSpacing: '0.04em' } : undefined}>{label}</span>}
      </div>
    );
  }
  return <CommanderPortrait {...props} />;
}

// ---------- PowerMeter ----------
export interface PowerMeterProps { value?: number; surge?: number; max?: number; showLabel?: boolean; className?: string; active?: 'surge' | 'overclock' | 'none' }
export function PowerMeter({ value = 0, surge = 3, max = 6, showLabel = true, className, active }: PowerMeterProps) {
  const uid = useId().replace(/:/g, '');
  const v = Math.max(0, Math.min(max, value));
  const state = active === 'surge' ? 'Surge active' : active === 'overclock' ? 'Overclock active'
    : v >= max ? 'Overclock ready' : v >= surge ? 'Surge ready' : 'Charging';
  const ready = active === 'surge' || active === 'overclock' || v >= surge;
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
        <clipPath id={`${uid}p${i}`}><path d={d} /></clipPath>
        <path d={d} className="aw-pip" />
        {fill > 0 && <rect x={x} y={y} width={s * fill} height={s} clipPath={`url(#${uid}p${i})`} className="aw-pip-fill" />}
      </g>
    );
    x += s + 3;
    return el;
  });
  return (
    <div className={cx('aw-power', ready && 'aw-power--ready', className)}>
      <svg width={Math.max(1, x - 3)} height={14} viewBox={`0 0 ${Math.max(1, x - 3)} 14`} role="img" aria-label={`Power ${Math.floor(v * 10) / 10} of ${max}: ${state}`}>
        {pips}
      </svg>
      {showLabel && <span className={cx('label', 'aw-power-state', ready && 'aw-power-state--ready')}>{state}</span>}
    </div>
  );
}

// ---------- PlayerHud ----------
export interface PlayerHudProps {
  commander?: CommanderInfo;
  funds?: number;
  power?: PowerMeterProps | null;
  cycle?: number | null;
  /** Extra line under the funds (e.g. income, weather). */
  extra?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
export function PlayerHud({ commander, funds = 0, power, cycle, extra, className, style }: PlayerHudProps) {
  const c = commander || {};
  return (
    <Frame floating className={cx('aw-hud', className)} style={style}>
      <CommanderFace {...c} size={48} />
      <div className="aw-hud-body">
        <div className="aw-hud-top">
          <Sigil faction={c.faction} size={14} />
          <span className="heading" style={{ color: inkOf(c.faction) }}>{c.name}</span>
          {cycle != null && <span className="label aw-muted">{`Cycle ${pad2(cycle)}`}</span>}
        </div>
        <div className="aw-hud-funds">
          <span className="stat">{credits(funds)}</span>
          <span className="label aw-muted">CR</span>
        </div>
        {power && <PowerMeter {...power} />}
        {extra}
      </div>
    </Frame>
  );
}

// ---------- DialogueBox ----------
export interface DialogueBoxProps {
  speaker?: CommanderInfo & { title?: string };
  side?: 'left' | 'right';
  channel?: ReactNode;
  children?: ReactNode;
  more?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
export function DialogueBox({ speaker = {}, side = 'left', channel, children, more = true, className, style }: DialogueBoxProps) {
  const f = speaker.faction;
  return (
    <Frame floating className={cx('aw-dialogue', side === 'right' && 'aw-dialogue--right', className)} style={style}>
      <CommanderFace {...speaker} />
      <div className="aw-dialogue-body">
        <div className="aw-dialogue-who">
          <Sigil faction={f} size={16} />
          <span className="heading" style={{ color: inkOf(f) }}>{speaker.name}</span>
          {speaker.title && <span className="caption aw-muted">{speaker.title}</span>}
        </div>
        {channel && <div className="caption aw-muted aw-dialogue-channel">{channel}</div>}
        <p className="body aw-dialogue-text">{children}</p>
        {more && <span className="aw-dialogue-more" aria-hidden />}
      </div>
    </Frame>
  );
}

// ---------- TurnBanner ----------
export interface TurnBannerProps { cycle?: number; faction?: FactionOrEcho; commander?: string; subtitle?: ReactNode; className?: string; style?: React.CSSProperties }
export function TurnBanner({ cycle = 1, faction = 'helion', commander, subtitle, className, style }: TurnBannerProps) {
  return (
    <div className={cx('aw-banner', faction === 'choir' && 'aw-banner--choir', className)} role="status" style={{ background: fillOf(faction), color: onOf(faction), ...style }}>
      <div className="aw-banner-cycle">
        <span className="label">Cycle</span>
        <span className="headline">{pad2(cycle)}</span>
      </div>
      <div className="aw-banner-rule" aria-hidden />
      <div className="aw-banner-who">
        <span className="heading">{factionName(faction)}</span>
        {commander && <span className="caption">{`${commander} commanding`}</span>}
        {subtitle && <span className="caption">{subtitle}</span>}
      </div>
      <span className="aw-banner-mark" aria-hidden>
        <Sigil faction={faction} size={72} tone="on" />
      </span>
    </div>
  );
}
