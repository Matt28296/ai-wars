// The page's side of Deploy (G14): opens the live battle in a worker, relays what it sends, and falls back to the page's own thread when a
// worker cannot be made. Either way the battle is the same: A1's match host with Doctrine in every seat (battleHost.ts), the player's seat
// under the orders handed over at the start of each of its turns.
import { missionById } from './campaign';
import type { BattleHost } from './battleHost';
import type { BattleIn, BattleLink, BattleOut, ConnectBattle } from './battle';

/** Opens a battle in a worker, or on the page where there is none. */
export const connectBattle: ConnectBattle = (onMessage: (m: BattleOut) => void): BattleLink => {
  let worker: Worker | null = null;
  let closed = false;
  let heard = false;
  let first: BattleIn | null = null;
  const timers = new Set<number>();
  let host: BattleHost | null = null;

  /** Runs the battle on the page's own thread, a beat after each message so the page can paint in between. */
  const onThePage = (m: BattleIn): void => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (closed) return;
      void (async () => {
        try {
          if (m.type === 'start') {
            const mission = missionById(m.missionId);
            if (!mission) throw new Error(`no mission ${m.missionId}`);
            const { BattleHost } = await import('./battleHost');
            if (closed) return;
            const h = new BattleHost(mission, onMessage);
            host = h;
            h.start(m.orders);
          } else {
            host?.turn(m.orders);
          }
        } catch (err) {
          onMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      })();
    }, 80);
    timers.add(id);
  };

  if (typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./deploy.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<BattleOut>) => {
        if (closed) return;
        heard = true;
        onMessage(e.data);
      };
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        if (closed) return;
        // A worker that never spoke is one the browser would not run: start again on the page. One that stopped mid-battle cannot be resumed.
        if (!heard && first) onThePage(first);
        else onMessage({ type: 'error', message: 'The battle stopped.' });
      };
    } catch {
      worker = null;
    }
  }

  return {
    send(m) {
      if (closed) return;
      if (m.type === 'start') first = m;
      if (worker) worker.postMessage(m);
      else onThePage(m);
    },
    close() {
      closed = true;
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      worker?.terminate();
      worker = null;
    },
  };
};
