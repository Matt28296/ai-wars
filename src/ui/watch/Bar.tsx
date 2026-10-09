// The one slim bar above the board (G18, D-023): the screen's own back link and title on the left, the cycle, whose turn it is and the viewer's
// funds in the middle, and the few things a viewer can do on the right (Orders when given, Details, View). Nothing else lives here: players, unit
// intel and the log are in the drawer, the board's switches are in the View menu, and playback is the bar below the board.
//
// The turn chip is what the old full-width banner said, said small. Its numbers come from ONE frame (bar.ts), the viewer's.
//
// G19: when the screen gives commands (the orders slot: the battle's command buttons), they are the bar's second row, under the three groups above and
// across their whole width. Without them the bar is the one 48px row it was.
import type { CSSProperties, ReactElement, ReactNode, Ref } from 'react';
import { Sigil, fillOf, onOf, pad2 } from './kit';
import { credits } from './format';
import { FUNDS_TWEEN_MS } from './hud';
import { useTweened } from './Hud';
import { countLabel } from './drawer';
import type { BarModel } from './bar';

export interface BarProps {
  model: BarModel;
  /** The screen's own back link, title and status pill (the front door gives them). Absent, nothing is drawn there. */
  lead?: ReactNode;
  /** The right of the bar: the Details button and the View menu, in that order. */
  children?: ReactNode;
  /** G19: the battle's command row (the orders slot). It is the bar's second row. Absent, the bar has no second row and nothing else changes. */
  commands?: ReactNode;
}

function Turn({ model }: { model: BarModel }): ReactElement {
  const { turn } = model;
  const chip: CSSProperties = { background: fillOf(turn.faction), color: onOf(turn.faction) };
  return (
    <div className="aww-turn" data-player={turn.player}>
      {/* One sentence for a screen reader, told whenever the turn changes; the pieces beside it are for the eye. */}
      <span className="aww-sr" role="status">{`Cycle ${model.cycle}, ${turn.owner} turn`}</span>
      <span className="aww-turn-cycle label" aria-hidden>
        <span className="aww-muted">Cycle</span> <span className="stat-sm">{pad2(model.cycle)}</span>
      </span>
      <span className="aww-turn-who label" style={chip} aria-hidden>
        <Sigil faction={turn.faction} size={14} tone="on" masked={turn.masked} />
        <span>{turn.label}</span>
      </span>
    </div>
  );
}

function Funds({ model }: { model: BarModel }): ReactElement | null {
  const shown = Math.round(useTweened(model.funds ?? 0, FUNDS_TWEEN_MS));
  if (model.funds === null || model.fundsOf === null) return null;
  return (
    <div className="aww-funds" data-funds={model.funds} title={`${model.fundsOf.label} funds`}>
      {/* Assistive tech is told the figure once; the number on screen may be mid-tick. */}
      <span className="aww-sr">{`Funds ${credits(model.funds)}`}</span>
      <span className="label aww-muted" aria-hidden>Funds</span>
      <span className="stat-sm aww-funds-num" aria-hidden>{shown.toLocaleString('en-US')}</span>
      <span className="label aww-muted" aria-hidden>CR</span>
    </div>
  );
}

export function Bar({ model, lead, children, commands }: BarProps): ReactElement {
  return (
    <header className="aww-bar" aria-label="Battle" data-commands={commands ? 'yes' : undefined}>
      <div className="aww-bar-lead">{lead}</div>
      <div className="aww-bar-mid">
        <Turn model={model} />
        <Funds model={model} />
      </div>
      <div className="aww-toolbar-row">{children}</div>
      {commands && <div className="aww-bar-cmd">{commands}</div>}
    </header>
  );
}

export interface DetailsButtonProps {
  open: boolean;
  /** New log lines since the drawer was shut (drawer.ts unreadLines). */
  unread: number;
  /** The drawer's id, while it is open. */
  controls?: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

/** "Details": opens the drawer. Its small count is the log lines that arrived while the drawer was shut. */
export function DetailsButton({ open, unread, controls, onClick, buttonRef }: DetailsButtonProps): ReactElement {
  const count = countLabel(unread);
  return (
    <button
      ref={buttonRef}
      type="button"
      className="aw-btn aw-btn--secondary aw-btn--sm label aww-details"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      data-action="details"
      data-unread={unread}
      title="Players, unit intel and the log (D)"
      onClick={onClick}
    >
      <span className="aw-btn-label">Details</span>
      {count && <span className="aww-count caption" role="img" aria-label={`${unread} new log ${unread === 1 ? 'line' : 'lines'}`}>{count}</span>}
      <kbd className="aw-key">D</kbd>
    </button>
  );
}
