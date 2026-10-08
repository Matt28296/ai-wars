// Deploy's battle runs here, off the page's thread (G14). Doctrine plays every side of the mission on A1's match host, the player's seat under
// the orders the page hands over at the start of each of its turns (D-022); the other seats' turns are played ahead, and the host then waits
// for the page to say that playback has reached the player's next turn. The page builds the same setup itself (deploySetup is pure), so only
// the actions travel back, in batches (battleHost.ts). Takes only the two shapes in battle.ts; the orders are validated where they are used.
import { missionById } from './campaign';
import { BattleHost } from './battleHost';
import type { BattleIn, BattleOut } from './battle';

interface WorkerScope {
  onmessage: ((e: MessageEvent<BattleIn>) => void) | null;
  postMessage(message: BattleOut): void;
}
const scope = self as unknown as WorkerScope;
let host: BattleHost | null = null;

scope.onmessage = (e) => {
  try {
    const m = e.data;
    if (m.type === 'start') {
      const mission = missionById(m.missionId);
      if (!mission) throw new Error(`no mission ${m.missionId}`);
      host = new BattleHost(mission, (out) => scope.postMessage(out));
      host.start(m.orders);
    } else if (m.type === 'turn') {
      host?.turn(m.orders);
    }
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
