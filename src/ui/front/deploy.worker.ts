// Deploy runs Doctrine on every side of a mission, which takes seconds on the big maps. It runs here, off the page's thread, so the
// loading card keeps moving and the page stays responsive. The page builds the same setup itself (deploySetup is pure), so only the
// recorded actions travel back.
import { missionById } from './campaign';
import { runDeploy } from './deploy';
import type { DeployOut } from './deployClient';

interface WorkerScope {
  onmessage: ((e: MessageEvent<{ missionId: string }>) => void) | null;
  postMessage(message: DeployOut): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  try {
    const mission = missionById(e.data.missionId);
    if (!mission) throw new Error(`no mission ${e.data.missionId}`);
    const r = runDeploy(mission, (cycle) => scope.postMessage({ type: 'progress', cycle }));
    scope.postMessage({ type: 'done', actions: r.actions, cycles: r.cycles, winnerTeam: r.winnerTeam });
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
