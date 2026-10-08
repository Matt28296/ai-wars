// The HUD: one panel per player (sigil, commander, funds, power stars, unit and property counts), drawn from the viewer's frame only.
// Funds tick to their new value and the power meter fills smoothly (hud.ts tweenAt); under reduced motion both simply change.
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Icon, PlayerHud, Sigil, StatusChip, cx } from './kit';
import { FUNDS_TWEEN_MS, METER_TWEEN_MS, playerPanels, prefersReducedMotion, tweenAt, tweenDuration } from './hud';
import type { PlayerPanelModel } from './hud';
import type { TimelineStep } from './timeline';

/**
 * `target` eased in over `baseMs` whenever it changes, starting from wherever the last tween had got to; exactly `target` at the end.
 * Reduced motion returns the new value on the same render. The first render never animates.
 */
export function useTweened(target: number, baseMs: number): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const ms = tweenDuration(baseMs, prefersReducedMotion());
  useEffect(() => {
    if (ms <= 0 || shownRef.current === target) {
      shownRef.current = target;
      setShown(target);
      return undefined;
    }
    const from = shownRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const elapsed = now - start;
      const v = tweenAt(from, target, elapsed, ms);
      shownRef.current = v;
      setShown(v);
      if (elapsed < ms) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return ms <= 0 ? target : shown;
}

function Count({ label, title, value, icon }: { label: string; title: string; value: string; icon?: boolean }): ReactElement {
  return (
    <span className="aww-hud-count" title={title} aria-label={`${value === '?' ? 'unknown' : value} ${title.toLowerCase()}`}>
      {icon && <Icon name="flag" size={11} />}
      <span className="label aw-muted" aria-hidden>{label}</span>
      <span className="stat-sm" aria-hidden>{value}</span>
    </span>
  );
}

function Panel({ p }: { p: PlayerPanelModel }): ReactElement {
  const funds = Math.round(useTweened(p.funds, FUNDS_TWEEN_MS));
  const meterValue = useTweened(p.meter.value, METER_TWEEN_MS);
  const live = p.isCurrent && !p.defeated;
  return (
    <PlayerHud
      className={cx('aww-hud', live && 'aww-hud--current', p.defeated && 'aww-hud--defeated')}
      commander={{ id: p.commanderId, mood: p.mood, name: p.commanderName, faction: p.faction, initials: p.initials, state: p.active ?? undefined }}
      funds={p.funds}
      fundsShown={funds}
      power={{ value: meterValue, surge: p.meter.surge, max: p.meter.max, active: p.active }}
      muted={p.defeated}
      badge={live ? <StatusChip tone="signal">Turn</StatusChip> : p.defeated ? <StatusChip tone="danger">Defeated</StatusChip> : undefined}
      aside={
        <span className="aww-hud-counts">
          <Count label="Units" title={p.units === null ? 'Units, hidden by fog' : 'Units'} value={p.units === null ? '?' : String(p.units)} />
          <Count label="Props" title="Properties held" value={String(p.properties)} icon />
        </span>
      }
    >
      <div className="aww-hud-meta">
        <Sigil faction={p.faction} size={16} tone="ink" />
        <span className="label aw-muted">{p.factionName}</span>
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
