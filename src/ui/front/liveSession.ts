// The page's side of the live battle (G14), pure of React: the actions that have arrived, the orders the player has set, and the rule of when
// a set of orders starts to count.
//
// D-022, the whole rule: the battle plays live, the player may change orders at any time, and a change takes effect when the player's NEXT
// TURN STARTS. The host computes the other seats' turns ahead and then waits at the start of the player's turn ('waiting', with the number of
// actions so far). The turn is computed only when playback reaches that step (`reached(step)`), and what is handed over then is the orders in
// force AT THAT MOMENT. So:
//   - a change made while playback is in another seat's turn is read when the player's turn comes;
//   - a change made while playback is inside the player's own turn cannot touch it (that turn was computed when it began) and is read at the
//     start of the next one;
//   - nothing is ever applied the moment it is made.
// Each time orders are handed over and differ from the last ones, the change is written down with the action index it applies from, and a
// line for the event log is made from it. The host keeps the same record (A1's `orderChanges`), and when the battle is done that one is used.
import type { Mission } from '../../content/types';
import type { Action, CreateGameOptions } from '../../game/aw';
import type { OrderChange } from '../../agent/match';
import type { StandingOrders } from '../../game/doctrine';
import { validateOrders } from '../../game/doctrine';
import type { BattleDone, BattleLink, BattleOut, ConnectBattle } from './battle';
import { deploySetup } from './deploy';
import { notesOf, sameOrders } from './ordersModel';
import type { OrderNote } from './ordersModel';

export interface LiveSnapshot {
  /** Every action computed so far, in order. A new array each time more arrive; the actions in it are the same objects as before. */
  readonly actions: Action[];
  /** More may still come: the battle is not over and has not failed. */
  readonly open: boolean;
  readonly done: BattleDone | null;
  readonly error: string | null;
  /** The orders the player has set now: what the panel shows. */
  readonly orders: StandingOrders;
  /** The orders set now are not yet the ones in force: they start with the player's next turn. */
  readonly pending: boolean;
  /** The orders each of the player's turns has been played under, with the action index each applies from. */
  readonly orderChanges: readonly OrderChange[];
  /** The log lines for the changes made in the battle (not for the orders it began with). */
  readonly notes: readonly OrderNote[];
}

export class LiveSession {
  readonly mission: Mission;
  /** The setup the battle is played from, one object for the whole session (the watch view tells it is the same match by it). */
  readonly setup: CreateGameOptions;

  private readonly connect: ConnectBattle;
  private link: BattleLink | null = null;
  private actions: Action[] = [];
  private done: BattleDone | null = null;
  private error: string | null = null;
  private orders: StandingOrders;
  private inForce: StandingOrders;
  private changes: OrderChange[];
  /** Where the host waits for the player's next turn, if it does. */
  private waiting: { at: number; cycle: number } | null = null;
  /** The step playback is on. */
  private at = 0;
  private closed = false;
  private readonly listeners = new Set<() => void>();
  private snap: LiveSnapshot;

  constructor(mission: Mission, firstOrders: StandingOrders, connect: ConnectBattle) {
    this.mission = mission;
    this.setup = deploySetup(mission);
    this.connect = connect;
    this.orders = validateOrders(firstOrders);
    this.inForce = this.orders;
    this.changes = [{ from: 0, cycle: 1, orders: this.orders }];
    this.snap = this.build();
  }

  /** Opens the battle. The first turn is played under the orders set so far. */
  start(): void {
    if (this.link || this.closed) return;
    this.link = this.connect((m) => this.receive(m));
    this.link.send({ type: 'start', missionId: this.mission.id, orders: this.inForce });
  }

  /** Stops the battle and lets go of the host. Nothing more is delivered. */
  close(): void {
    this.closed = true;
    this.link?.close();
    this.link = null;
    this.listeners.clear();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  snapshot = (): LiveSnapshot => this.snap;

  /** The player changes the orders. Validated like all orders; they count from the start of the player's next turn, never sooner. */
  setOrders(next: StandingOrders): void {
    const o = validateOrders(next);
    if (sameOrders(o, this.orders)) return;
    this.orders = o;
    this.emit();
  }

  /** Playback is showing this step (told on every change of step, and when the view opens). May hand the next turn to the host. */
  reached(step: number): void {
    this.at = step;
    this.release();
  }

  private receive(m: BattleOut): void {
    if (this.closed) return;
    switch (m.type) {
      case 'actions':
        if (m.from !== this.actions.length) {
          this.fail(`the battle sent action ${m.from} when ${this.actions.length} was next`);
          return;
        }
        this.actions = this.actions.concat(m.actions);
        break;
      case 'waiting':
        this.waiting = { at: m.at, cycle: m.cycle };
        this.release(false);
        break;
      case 'done':
        this.done = m;
        this.waiting = null;
        this.changes = m.orderChanges.map((c) => ({ from: c.from, cycle: c.cycle, orders: c.orders }));
        break;
      case 'error':
        this.error = m.message;
        this.waiting = null;
        break;
    }
    this.emit();
  }

  private fail(message: string): void {
    this.error = message;
    this.waiting = null;
    this.emit();
  }

  /** If the host waits for the player's turn and playback has got there, hands it the orders in force now. */
  private release(announce = true): void {
    const w = this.waiting;
    if (!w || this.done || this.error || !this.link || this.at < w.at) return;
    this.waiting = null;
    const orders = this.orders;
    if (!sameOrders(orders, this.inForce)) this.changes = [...this.changes, { from: w.at, cycle: w.cycle, orders }];
    this.inForce = orders;
    this.link.send({ type: 'turn', orders });
    if (announce) this.emit();
  }

  private build(): LiveSnapshot {
    return {
      actions: this.actions,
      open: this.done === null && this.error === null,
      done: this.done,
      error: this.error,
      orders: this.orders,
      pending: !sameOrders(this.orders, this.inForce),
      orderChanges: this.changes,
      notes: notesOf(this.changes),
    };
  }

  private emit(): void {
    this.snap = this.build();
    for (const l of [...this.listeners]) l();
  }
}
