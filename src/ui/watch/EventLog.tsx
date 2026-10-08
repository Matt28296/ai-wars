// The event log: plain sentences, newest at the bottom, built only from the viewer's filtered events (format.ts).
import { memo, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Frame, cx } from './kit';
import type { LogLine } from './format';

const MAX_LINES = 120;

export const EventLog = memo(function EventLog({ lines }: { lines: LogLine[] }): ReactElement {
  const [showMoves, setShowMoves] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const shown = (showMoves ? lines : lines.filter((l) => l.tone !== 'quiet')).slice(-MAX_LINES);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, lines]);
  return (
    <Frame size="sm" className="aww-log">
      <div className="aww-log-head">
        <span className="label aww-muted">Event log</span>
        <label className="aww-log-toggle caption">
          <input type="checkbox" checked={showMoves} onChange={(e) => setShowMoves(e.target.checked)} />
          <span>Show moves</span>
        </label>
      </div>
      <ol className="aww-log-list" ref={listRef} aria-label="Battle events">
        {shown.length === 0 && <li className="aww-log-empty caption">Nothing has happened yet.</li>}
        {shown.map((l, i) => (
          <li key={`${l.step}-${i}`} className={cx('aww-log-line', `aww-log-line--${l.tone}`)}>
            <span className="aww-log-step stat-sm">{l.step}</span>
            <span className="aww-log-text body-sm">{l.text}</span>
          </li>
        ))}
      </ol>
    </Frame>
  );
});
