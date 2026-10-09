// The Orders button in the battle's toolbar and the compact panel it opens (G14, D-022, D-023). The panel is closed by default; the key O opens
// and closes it, Escape closes it. It holds the same card as the objective screen, drawn smaller, and says "From your next turn" while the orders
// shown are not yet the ones in force: a change counts from the start of the player's next turn (liveSession.ts), never sooner.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { StandingOrders } from '../../game/doctrine';
import { OrdersCard } from './OrdersCard';

export interface OrdersControlProps {
  orders: StandingOrders;
  pending: boolean;
  /** G19: what the panel says while the change waits (with a connected agent: "From your agent's next turn"). */
  pendingText?: string;
  /** G19: the button's word. The command row calls it "More"; on its own it is "Orders". */
  label?: string;
  onChange: (next: StandingOrders) => void;
  /** Opens the panel when the view mounts (tests and screenshots). */
  initialOpen?: boolean;
}

/** True when a key press belongs to a text field or menu, which keep their own keys. */
const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"]');

export function OrdersControl({ orders, pending, pendingText, label = 'Orders', onChange, initialOpen = false }: OrdersControlProps): ReactElement {
  const [open, setOpen] = useState(initialOpen);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);

  const close = (): void => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        if (!e.repeat) setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // The watch view reads Space as play/pause and the arrows as step back and forward, from the window. Inside the panel they belong to the
  // button that has focus, and to the radio groups.
  const keepKeys = (e: { key: string; stopPropagation: () => void }): void => {
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
  };

  return (
    <div className="awf-orders-slot" data-open={open ? 'yes' : 'no'}>
      <button
        ref={button}
        type="button"
        className="aw-btn aw-btn--secondary aw-btn--sm label awf-orders-btn"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-action="orders"
        data-pending={pending ? 'yes' : 'no'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="aw-btn-label">{label}</span>
        {pending && <span className="awf-dot" role="img" aria-label="changes wait for your next turn" />}
        <kbd className="aw-key">O</kbd>
      </button>
      {open && (
        <div className="awf-orders-pop" id={panelId} role="dialog" aria-label="Orders" onKeyDown={keepKeys} onKeyUp={keepKeys}>
          <OrdersCard orders={orders} onChange={onChange} variant="panel" pending={pending} pendingText={pendingText} onClose={close} />
        </div>
      )}
    </div>
  );
}
