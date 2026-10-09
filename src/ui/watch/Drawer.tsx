// The one drawer (G18, D-023): Players, Unit intel and the Event log in three tabs, opened by "Details" or the key D and shut by its own x or
// Escape. Over the board's right edge on a desktop (the board is not resized), a bottom sheet over the playback bar on a phone.
//
// It is only in the page while it is open. Open, all three panels are drawn and the two that are not showing are hidden, so a tab switch costs
// nothing and the log keeps where it was. Everything in it is read from ONE viewer's timeline, which the caller hands over: the Players panels
// from the step on screen, the intel card from the timeline's steps, the log from the viewer's own filtered events (D-016).
import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { EventLog } from './EventLog';
import { Hud } from './Hud';
import { IntelCard } from './IntelCard';
import { DRAWER_TABS, tabAfterKey } from './drawer';
import type { DrawerTab } from './drawer';
import type { LogLine } from './format';
import type { Seats } from './seats';
import type { Timeline } from './timeline';

export interface DrawerProps {
  /** The drawer's id: its tabs and panels are named from it, and "Details" points at it. */
  id: string;
  /** The viewer's timeline, and the step on screen. */
  timeline: Timeline;
  step: number;
  seats?: Seats;
  /** The log lines up to the step on screen. */
  lines: LogLine[];
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  onClose: () => void;
  /** Move focus onto the tab when the drawer opens. False when it opens already open (tests, screenshots): nothing steals the focus. */
  focusIn?: boolean;
}

export function Drawer({ id, timeline, step, seats, lines, tab, onTab, onClose, focusIn = false }: DrawerProps): ReactElement {
  const tabs = useRef<Partial<Record<DrawerTab, HTMLButtonElement | null>>>({});
  useEffect(() => {
    // on mount only: a tab change keeps the focus where the viewer put it
    if (focusIn) tabs.current[tab]?.focus({ preventScroll: true });
  }, []);

  // The watch view reads Space as play/pause and the arrows as step back and forward, from the window. Inside the drawer they belong to the
  // tabs, the log's switch and its scrolling list.
  const keepKeys = (e: KeyboardEvent): void => {
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation();
  };
  const onTabKey = (e: KeyboardEvent): void => {
    const next = tabAfterKey(tab, e.key);
    if (next === null) return;
    e.preventDefault();
    onTab(next);
    tabs.current[next]?.focus({ preventScroll: true });
  };

  const stepOn = timeline.steps[Math.min(step, timeline.last)];
  return (
    <aside className="aww-drawer" id={id} aria-label="Details" data-tab={tab} onKeyDown={keepKeys} onKeyUp={keepKeys}>
      <div className="aww-drawer-head">
        <div className="aww-tabs" role="tablist" aria-label="Details" onKeyDown={onTabKey}>
          {DRAWER_TABS.map((t) => (
            <button
              key={t.tab}
              ref={(el) => { tabs.current[t.tab] = el; }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.tab}`}
              className="aww-tab label"
              aria-selected={t.tab === tab}
              aria-controls={`${id}-panel-${t.tab}`}
              tabIndex={t.tab === tab ? 0 : -1}
              data-tab={t.tab}
              onClick={() => onTab(t.tab)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="aww-drawer-close" aria-label="Close details" title="Close (Esc)" data-action="close-details" onClick={onClose}>
          <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden><path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth={1.8} /></svg>
        </button>
      </div>
      <div className="aww-drawer-body">
        {DRAWER_TABS.map((t) => (
          <div key={t.tab} className="aww-drawer-panel" role="tabpanel" id={`${id}-panel-${t.tab}`} aria-labelledby={`${id}-tab-${t.tab}`} data-panel={t.tab} hidden={t.tab !== tab}>
            {t.tab === 'players' && <Hud step={stepOn} seats={seats} />}
            {t.tab === 'intel' && <IntelCard timeline={timeline} step={stepOn.index} seats={seats} />}
            {t.tab === 'log' && <EventLog lines={lines} active={tab === 'log'} />}
          </div>
        ))}
      </div>
    </aside>
  );
}
