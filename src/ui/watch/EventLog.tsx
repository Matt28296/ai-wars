// The event log: plain sentences, newest at the bottom, built only from the viewer's filtered events (format.ts). Each line carries a thin
// stripe in its side's colour (paired with the faction name in the sentence, or a sigil where the sentence has none), a small icon by kind of
// event, and fades a little as it ages; the newest line is lit, and a turn reads as a section header. The list follows the newest line with
// a smooth scroll, and stops following the moment the viewer scrolls up to read.
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Frame, Sigil, cx, markOf } from './kit';
import { ICONS } from './kit/roles';
import { followAfterScroll, groupLog, logOpacity, stripeCue } from './format';
import type { LogIcon, LogLine } from './format';
import { prefersReducedMotion } from './hud';

const MAX_LINES = 120;

/** Line-art for the kinds the kit has no glyph for, on the same 12 px grid; the rest reuse the kit's own filled icons. */
const GLYPH: Record<LogIcon, { fill?: string; stroke?: string }> = {
  attack: { stroke: 'M6 1.5v2.5M6 8v2.5M1.5 6H4M8 6h2.5M6 4.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 1 1 0-3.2z' },
  destroyed: { fill: ICONS.cross },
  capture: { fill: ICONS.flag },
  build: { fill: 'M1.5 10.5h9v-1.2h-9zM2.8 8.6V5.2L6 2.6l3.2 2.6v3.4z' },
  power: { fill: ICONS.diamond },
  repair: { fill: 'M5 1.5h2V5h3.5v2H7v3.5H5V7H1.5V5H5z' },
  turn: { stroke: 'M2.5 2.5 6 6 2.5 9.5M6.5 2.5 10 6 6.5 9.5' },
  move: { stroke: 'M1.5 6h8M6.5 2.8 9.7 6 6.5 9.2' },
  alert: { fill: 'M6 1.2 11 10.5H1zM5.3 4.6v2.6h1.4V4.6zM5.3 8h1.4v1.2H5.3z' },
  cargo: { fill: ICONS.cargo },
  weather: { fill: ICONS.bolt },
  victory: { fill: ICONS.flag },
  info: { fill: ICONS.dot },
};

export function LogGlyph({ icon }: { icon: LogIcon }): ReactElement {
  const g = GLYPH[icon] ?? GLYPH.info;
  return (
    <svg className={cx('aww-log-icon', `aww-log-icon--${icon}`)} data-icon={icon} width={13} height={13} viewBox="0 0 12 12" aria-hidden>
      {g.fill && <path d={g.fill} fill="currentColor" fillRule="evenodd" />}
      {g.stroke && <path d={g.stroke} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="square" />}
    </svg>
  );
}

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const stripeStyle = (l: LogLine, age: number): CSSProperties =>
  ({ '--stripe': l.faction ? markOf(l.faction) : 'transparent', '--fade': logOpacity(age) }) as CSSProperties;

function Header({ l, age }: { l: LogLine & { section: NonNullable<LogLine['section']> }; age: number }): ReactElement {
  return (
    <div className={cx('aww-log-line', 'aww-log-line--turn', age === 0 && 'aww-log-line--newest')} style={stripeStyle(l, 0)} data-kind={l.kind}>
      <span className="aww-log-head-row" role="heading" aria-level={3} aria-label={l.text}>
        {l.faction && <Sigil faction={l.faction} size={15} tone="fill" masked={l.masked} />}
        <span className="label aww-log-title">{l.section.title}</span>
        <span className="caption aww-log-detail">{l.section.detail}</span>
      </span>
    </div>
  );
}

function Line({ l, age }: { l: LogLine; age: number }): ReactElement {
  const cue = stripeCue(l);
  const newest = age === 0;
  return (
    <li
      className={cx('aww-log-line', `aww-log-line--${l.tone}`, newest && 'aww-log-line--newest')}
      style={stripeStyle(l, age)}
      data-kind={l.kind}
      data-icon={l.icon}
      aria-current={newest ? 'true' : undefined}
    >
      <span className="aww-log-step stat-sm">{l.step}</span>
      <LogGlyph icon={l.icon} />
      <span className="aww-log-text body-sm">
        {cue === 'sigil' && l.faction && <Sigil faction={l.faction} size={13} tone="fill" masked={l.masked} />}
        {l.text}
      </span>
    </li>
  );
}

/**
 * `active` (G18): false while the log sits in a hidden drawer tab, where it has no height to measure. It going true snaps the list to the newest
 * line again (when the viewer had not scrolled away from it), so a tab that was hidden while lines arrived opens on the latest, not the top.
 */
export const EventLog = memo(function EventLog({ lines, active = true }: { lines: LogLine[]; active?: boolean }): ReactElement {
  const [showMoves, setShowMoves] = useState(false);
  const [following, setFollowing] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const followRef = useRef(true);
  const lastTop = useRef(0);
  const shown = (showMoves ? lines : lines.filter((l) => l.tone !== 'quiet')).slice(-MAX_LINES);
  // Each section remembers where it starts (its header) and where its first line sits in `shown`, so a row's age (its distance from the
  // newest) is one number across headers and lines.
  const sections = (() => {
    let at = 0;
    return groupLog(shown).map((g) => {
      const first = at + (g.head ? 1 : 0);
      const start = at;
      at = first + g.lines.length;
      return { ...g, at: start, first };
    });
  })();

  const setFollow = useCallback((v: boolean): void => {
    followRef.current = v;
    setFollowing(v);
  }, []);

  // New lines: follow the newest one only while the viewer has not scrolled away from it. A shorter list (the scrubber went back) or a
  // long way to go snaps; one more line glides.
  const count = useRef(0);
  useIsoLayoutEffect(() => {
    const el = listRef.current;
    const grew = shown.length - count.current;
    count.current = shown.length;
    if (!el || !followRef.current) return;
    const target = el.scrollHeight - el.clientHeight;
    if (grew > 0 && grew <= 3 && !prefersReducedMotion() && target - el.scrollTop < 320) el.scrollTo({ top: target, behavior: 'smooth' });
    else el.scrollTop = target;
    lastTop.current = el.scrollTop;
  }, [shown.length, lines, showMoves, active]);

  const onScroll = useCallback((): void => {
    const el = listRef.current;
    if (!el) return;
    const next = followAfterScroll(followRef.current, { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }, lastTop.current);
    lastTop.current = el.scrollTop;
    if (next !== followRef.current) setFollow(next);
  }, [setFollow]);

  const jump = useCallback((): void => {
    const el = listRef.current;
    if (!el) return;
    setFollow(true);
    el.scrollTo({ top: el.scrollHeight - el.clientHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [setFollow]);

  return (
    <Frame size="sm" className="aww-log">
      <div className="aww-log-head">
        <span className="label aww-muted">Event log</span>
        <label className="aww-log-toggle caption">
          <input type="checkbox" checked={showMoves} onChange={(e) => setShowMoves(e.target.checked)} />
          <span>Show moves</span>
        </label>
      </div>
      <div className="aww-log-body">
        <ol className="aww-log-list" ref={listRef} onScroll={onScroll} aria-label="Battle events" tabIndex={0}>
          {shown.length === 0 && <li className="aww-log-empty caption">Nothing has happened yet.</li>}
          {sections.map((g) => (
            <li className="aww-log-section" key={`${g.at}-${g.first}`}>
              {g.head?.section && <Header l={{ ...g.head, section: g.head.section }} age={shown.length - 1 - g.at} />}
              <ol className="aww-log-rows">
                {g.lines.map((l, j) => (
                  <Line key={`${l.step}-${g.first + j}`} l={l} age={shown.length - 1 - (g.first + j)} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
        {!following && shown.length > 0 && (
          <button type="button" className="aww-log-jump label" onClick={jump}>
            Latest
            <svg width={10} height={10} viewBox="0 0 12 12" aria-hidden><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.8} /></svg>
          </button>
        )}
      </div>
    </Frame>
  );
});
