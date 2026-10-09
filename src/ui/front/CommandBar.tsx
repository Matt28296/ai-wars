// The battle's command row (G19, D-025), drawn in the slim bar through the watch view's orders slot: Charge, Hold, Fall back, Take bases, one power
// toggle, and More (the full orders panel of G14). On the live view with a connected agent it also has a one-line box, "Tell your agent...", for a
// note to that agent and no one else.
//
// D-023: one row, short words, no paragraphs; the one line that explains a button shows on hover or focus. D-005 / D-025: a button only hands back
// orders that commands.ts made through `validateOrders`. D-022: a change counts from the player's next turn, and the row says so while it waits.
// The row holds no orders of its own: it draws the orders it is given and hands back the next ones.
import { useId, useState } from 'react';
import type { FocusEvent, FormEvent, PointerEvent, ReactElement } from 'react';
import { NOTE_MAX, cleanNote, noteLength } from '../../agent/live';
import type { StandingOrders } from '../../game/doctrine';
import { COMMAND_TEXT, MORE_HINT, NOTE_HINT, POSTURE_COMMANDS, POWER_TEXT, activePosture, press, takeBasesInForce } from './commands';
import type { CommandId, CommandWords, PostureCommand } from './commands';
import { OrdersControl } from './OrdersControl';

export interface NoteBox {
  /** Told the cleaned note (1 to NOTE_MAX characters) when the person sends it. */
  onSend: (text: string) => void;
}

export interface CommandBarProps {
  /** The orders the person has set now (the waiting set when one waits, else the set in force). */
  orders: StandingOrders;
  /** The orders shown are not in force yet. */
  pending: boolean;
  /** What the row says while they wait: "From your next turn" on Deploy, "From your agent's next turn" with a connected agent. */
  pendingText?: string;
  onChange: (next: StandingOrders) => void;
  /** The note box. Given only on the live view with a connected agent; Deploy's built-in commander reads no text and has no box. */
  note?: NoteBox;
  /** One quiet line for something that did not go through (it replaces the pending line). */
  notice?: string | null;
  /** Opens the More panel when the row mounts (tests and screenshots). */
  initialOpen?: boolean;
}

export function CommandBar({ orders, pending, pendingText = 'From your next turn', onChange, note, notice, initialOpen }: CommandBarProps): ReactElement {
  const [hint, setHint] = useState<string | null>(null);
  const [text, setText] = useState('');
  const hintId = useId();
  const posture = activePosture(orders);
  const bases = takeBasesInForce(orders);
  const power = POWER_TEXT[orders.powerPolicy];
  // A hint shows for a mouse over a control and for keyboard focus; a touch leaves no hover behind to go stale, so it shows none.
  const on = (h: string) => ({
    onPointerEnter: (e: PointerEvent) => { if (e.pointerType === 'mouse') setHint(h); },
    onPointerLeave: () => setHint(null),
    onFocus: (e: FocusEvent) => { if ((e.target as HTMLElement).matches(':focus-visible')) setHint(h); },
    onBlur: () => setHint(null),
  });

  // A press that would leave the orders as they are sends nothing: a command in force stays in force. After a press the line is no longer about the
  // button under the pointer (its hint was for the state before): it says the change waits.
  const set = (id: CommandId): void => {
    setHint(null);
    const next = press(orders, id);
    if (next) onChange(next);
  };
  /** A button's words: the label, and on a phone-width row the short word in its place. */
  const words = (w: CommandWords): ReactElement => (w.short ? <><span className="awf-cmd-full">{w.label}</span><span className="awf-cmd-short" aria-hidden>{w.short}</span></> : <>{w.label}</>);
  const cleaned = cleanNote(text);
  const send = (e: FormEvent): void => {
    e.preventDefault();
    if (!note || cleaned === '' || noteLength(cleaned) > NOTE_MAX) return;
    note.onSend(cleaned);
    setText('');
    setHint(null);
  };
  // The one line under the row: what the button under the pointer does, else what went wrong, else that a change waits.
  const line = hint ?? notice ?? (pending ? pendingText : '');

  return (
    <div className="awf-cmd" role="group" aria-label="Commands" data-pending={pending ? 'yes' : 'no'} data-note={note ? 'yes' : 'no'}>
      <div className="awf-cmd-row">
        <div className="awf-cmd-seg" role="group" aria-label="Posture of every group">
          {POSTURE_COMMANDS.map((c: PostureCommand) => (
            <button
              key={c} type="button" className="awf-cmd-opt label" data-command={c} aria-pressed={posture === c} aria-describedby={hintId}
              onClick={() => set(c)} {...on(COMMAND_TEXT[c].hint)}
            >
              {words(COMMAND_TEXT[c])}
            </button>
          ))}
        </div>
        <button
          type="button" className="aw-btn aw-btn--secondary aw-btn--sm label awf-cmd-btn" data-command="takeBases" aria-pressed={bases} aria-describedby={hintId}
          onClick={() => set('takeBases')} {...on(COMMAND_TEXT.takeBases.hint)}
        >
          {words(COMMAND_TEXT.takeBases)}
        </button>
        <button
          type="button" className="aw-btn aw-btn--secondary aw-btn--sm label awf-cmd-btn" data-command="power" data-policy={orders.powerPolicy} aria-describedby={hintId}
          onClick={() => set('power')} {...on(power.hint)}
        >
          {words(power)}
        </button>
        <span className="awf-cmd-more" {...on(MORE_HINT)}>
          <OrdersControl orders={orders} pending={pending} pendingText={pendingText} label="More" onChange={onChange} initialOpen={initialOpen} />
        </span>
      </div>
      {note && (
        <form className="awf-cmd-note" onSubmit={send}>
          <input
            type="text" className="awf-cmd-input" name="note" value={text} maxLength={NOTE_MAX} placeholder="Tell your agent…" autoComplete="off" spellCheck
            aria-label="Tell your agent" aria-describedby={hintId} onChange={(e) => setText(e.target.value)}
            {...on(NOTE_HINT)}
          />
          <button type="submit" className="aw-btn aw-btn--secondary aw-btn--sm label awf-cmd-send" disabled={cleaned === ''} aria-label="Send to your agent" {...on('Send it to your agent.')}>Send</button>
        </form>
      )}
      <p className="awf-cmd-line caption" id={hintId} role="status" aria-live="polite" data-line={line ? 'yes' : 'no'}>{line}</p>
    </div>
  );
}
