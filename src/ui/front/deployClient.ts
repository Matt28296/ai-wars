// The page's side of Deploy: starts the worker, relays its progress, and falls back to the page's own thread when a worker cannot be
// made. Either way the result is the same: deploySetup(mission) and the actions Doctrine recorded.
import type { Mission } from '../../content/types';
import type { Action } from '../../game/aw';
import { deploySetup, runDeploy } from './deploy';
import type { DeployResult } from './deploy';

export type DeployOut =
  | { type: 'progress'; cycle: number }
  | { type: 'done'; actions: Action[]; cycles: number; winnerTeam: number | null }
  | { type: 'error'; message: string };

export interface DeployJob {
  result: Promise<DeployResult>;
  /** Stops the work; the promise then never settles. */
  cancel(): void;
}

export function startDeploy(mission: Mission, onCycle: (cycle: number) => void): DeployJob {
  let worker: Worker | null = null;
  let timer = 0;
  let cancelled = false;
  const result = new Promise<DeployResult>((resolve, reject) => {
    const onThePage = (): void => {
      // A beat for the loading card to paint before the page's thread is taken.
      timer = window.setTimeout(() => {
        if (cancelled) return;
        try { resolve(runDeploy(mission, onCycle)); } catch (err) { reject(err); }
      }, 80);
    };
    if (typeof Worker === 'undefined') { onThePage(); return; }
    try {
      worker = new Worker(new URL('./deploy.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      onThePage();
      return;
    }
    worker.onmessage = (e: MessageEvent<DeployOut>) => {
      if (cancelled) return;
      const m = e.data;
      if (m.type === 'progress') onCycle(m.cycle);
      else if (m.type === 'done') { worker?.terminate(); resolve({ setup: deploySetup(mission), actions: m.actions, cycles: m.cycles, winnerTeam: m.winnerTeam }); }
      else { worker?.terminate(); reject(new Error(m.message)); }
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      if (!cancelled) onThePage();
    };
    worker.postMessage({ missionId: mission.id });
  });
  return {
    result,
    cancel() {
      cancelled = true;
      window.clearTimeout(timer);
      worker?.terminate();
    },
  };
}
