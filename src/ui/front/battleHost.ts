// The live battle's host (G14), the part that runs in the worker (or, where there is no worker, on the page): A1's AgentMatch with Doctrine
// in every seat. The player's seat is played by `playOwnTurn(orders)` under the orders handed over at the start of EACH of its turns, so a
// change the player makes is read when playback reaches the turn, never before and never in the middle of one (D-022). The other seats'
// turns are played straight after the player's, so they are always computed ahead of playback, as far as the start of the player's next turn.
//
// The host sends the actions in batches, one per seat's turn, then either 'waiting' (the next turn needs orders) or 'done'. It knows nothing
// of playback: the page decides when the next turn starts, and says so with a 'turn' message.
import type { Mission } from '../../content/types';
import type { StandingOrders } from '../../game/doctrine';
import { AgentMatch } from '../../agent/match';
import type { Action } from '../../game/aw';
import type { BattleOut } from './battle';

export class BattleHost {
  private match: AgentMatch | null = null;
  private waiting = false;
  private buffer: Action[] = [];
  private count = 0;
  private sent = 0;

  constructor(private readonly mission: Mission, private readonly post: (m: BattleOut) => void) {}

  /** Starts the battle: the player's first turn is played under `orders`, then every other seat's. */
  start(orders: StandingOrders): void {
    if (this.match) throw new Error('the battle has already started');
    const match = new AgentMatch(this.mission, { continueAfterDefeat: true });
    this.match = match;
    match.subscribe((e) => {
      if (e.type !== 'action') return;
      this.buffer.push(e.action);
      this.count = e.index + 1;
      if (e.action.kind === 'endTurn') this.flush();
    });
    this.play(orders);
  }

  /** Plays the player's next turn under `orders`. Ignored unless the host is waiting for it (a repeat or a late message changes nothing). */
  turn(orders: StandingOrders): void {
    if (!this.match || !this.waiting) return;
    this.play(orders);
  }

  /** The orders each of the player's turns was played under so far. */
  orderChanges(): ReturnType<AgentMatch['orderChanges']> {
    return this.match ? this.match.orderChanges() : [];
  }

  private play(orders: StandingOrders): void {
    const match = this.match;
    if (!match) return;
    this.waiting = false;
    const r = match.playOwnTurn(orders);
    this.flush();
    if (!r.ok) {
      this.post({ type: 'error', message: r.message });
      return;
    }
    const result = match.result();
    if (result) {
      this.post({ type: 'done', cycles: result.cycles, winnerTeam: result.winnerTeam, orderChanges: match.orderChanges() });
      return;
    }
    this.waiting = true;
    this.post({ type: 'waiting', at: this.count, cycle: match.latestStep().frame.cycle });
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const actions = this.buffer;
    this.buffer = [];
    this.post({ type: 'actions', from: this.sent, actions });
    this.sent += actions.length;
  }
}
