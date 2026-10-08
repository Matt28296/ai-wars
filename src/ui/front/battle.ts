// The messages between the page and the live battle (G14). The battle runs off the page's thread (deploy.worker.ts) on A1's match host:
// Doctrine plays every side, the player's seat under the orders the player has set (D-022). Only these shapes cross, and only ids, enums
// and whole numbers: the orders are validated again where they are used (validateOrders), so no text a person typed can reach the engine.
import type { Action } from '../../game/aw';
import type { StandingOrders } from '../../game/doctrine';
import type { OrderChange } from '../../agent/match';

export type BattleIn =
  /** Begin the battle of this mission; the player's first turn is played under these orders. */
  | { type: 'start'; missionId: string; orders: StandingOrders }
  /** Playback has reached the start of the player's next turn: play it under these orders (the ones in force at that moment). */
  | { type: 'turn'; orders: StandingOrders };

/** How the battle ended. */
export interface BattleDone {
  cycles: number;
  winnerTeam: number | null;
  /** The orders each of the player's turns was played under, from the host's own record. */
  orderChanges: OrderChange[];
}

export type BattleOut =
  /** The next actions of the match, in order: the first of them is action number `from`. Every seat's actions, as Deploy has always sent. */
  | { type: 'actions'; from: number; actions: Action[] }
  /** Everything up to the start of the player's next turn is computed: `at` actions so far, the turn is in this cycle. The battle waits for a 'turn'. */
  | { type: 'waiting'; at: number; cycle: number }
  | ({ type: 'done' } & BattleDone)
  | { type: 'error'; message: string };

/** The page's end of a battle: send it a message, and close it when the screen goes away. */
export interface BattleLink {
  send(m: BattleIn): void;
  close(): void;
}

/** Opens a battle; `onMessage` is told everything it sends, in order. */
export type ConnectBattle = (onMessage: (m: BattleOut) => void) => BattleLink;
