// Deploy (G9): the mission is played with Doctrine (local rules) on every side, and the watch view opens on the recorded battle with
// the campaign's player 0 as the viewer. The player never gets the units (D-001, D-007): they watch. G13 lays the mission's story over
// that watch (MissionWatch): its authored lines as the battle reaches them, and the debrief with its result card at the end.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Mission } from '../../content/types';
import { BoardPreview } from './BoardPreview';
import { missionById, pad2 } from './campaign';
import { useDocumentTitle } from './hooks';
import { Lost } from './Lost';
import { BRIEFING_ORBIT } from './orbit';
import { hrefs } from './router';
import { missionScene } from './missionScene';
import { startDeploy } from './deployClient';
import type { DeployResult } from './deploy';

const MissionWatch = lazy(() => import('./MissionWatch').then((m) => ({ default: m.MissionWatch })));

type DeployState =
  | { phase: 'running'; cycle: number }
  | { phase: 'done'; result: DeployResult }
  | { phase: 'error'; message: string };

export interface LoadingCardProps {
  mission: Mission;
  cycle: number;
}

/** The "the battle is being fought" card. Shown while Doctrine plays every side. */
export function LoadingCard({ mission, cycle }: LoadingCardProps): ReactElement {
  return (
    <section className="awf-loadcard awf-cut" role="status" aria-live="polite" data-phase="deploying">
      <p className="awf-kicker label">Deploying · Mission {pad2(mission.order)}</p>
      <h1 className="awf-loadcard-h">The battle is being fought</h1>
      <p className="awf-loadcard-p body-sm">
        Doctrine (local rules) is playing {mission.title} on every side. Your agent commands and nobody moves a unit by hand, so there is nothing to do but wait for the recording.
      </p>
      <div className="awf-progress" aria-hidden><span className="awf-progress-bar" /></div>
      <p className="awf-loadcard-cycle stat-sm">{cycle > 0 ? `Cycle ${pad2(cycle)}` : 'Briefing the sides'}</p>
    </section>
  );
}

export interface DeployViewProps {
  mission: Mission;
  /** Forces the answer to "can this browser do WebGL2?" for the backdrop (tests and screenshots). */
  webgl2?: boolean;
}

export function DeployView({ mission, webgl2 }: DeployViewProps): ReactElement {
  const [state, setState] = useState<DeployState>({ phase: 'running', cycle: 0 });
  const scene = useMemo(() => missionScene(mission), [mission]);
  useDocumentTitle(`${mission.title} · Ascendant Wars`);

  // The watch view's chunk (and the story over it) loads while the battle is being fought, so it is ready the moment the recording is.
  useEffect(() => {
    void import('./MissionWatch');
  }, []);

  useEffect(() => {
    setState({ phase: 'running', cycle: 0 });
    const job = startDeploy(mission, (cycle) => setState((s) => (s.phase === 'running' ? { phase: 'running', cycle } : s)));
    job.result.then(
      (result) => setState({ phase: 'done', result }),
      (err: unknown) => setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
    return () => job.cancel();
  }, [mission]);

  if (state.phase === 'done') {
    return (
      <div className="awf-watch" data-screen="watch">
        <div className="awf-watchbar">
          <a className="awf-back label" href={hrefs.briefing(mission.id)}>Back to briefing</a>
          <span className="awf-watchbar-id label">Mission {pad2(mission.order)} · {mission.title}</span>
          <span className="awf-pill caption">Doctrine (local rules) on every side</span>
        </div>
        <Suspense fallback={<div className="awf-loading label">Opening the watch view</div>}>
          <MissionWatch mission={mission} result={state.result} />
        </Suspense>
      </div>
    );
  }
  return (
    <main className="awf-root awf-deploy" data-screen="deploy" data-phase={state.phase}>
      <BoardPreview scene={scene} orbit={BRIEFING_ORBIT} webgl2={webgl2} className="awf-backdrop awf-backdrop--dim" />
      <div className="awf-brief-scrim" aria-hidden />
      <div className="awf-deploy-body">
        {state.phase === 'running' ? (
          <LoadingCard mission={mission} cycle={state.cycle} />
        ) : (
          <section className="awf-loadcard awf-cut" role="alert" data-phase="error">
            <p className="awf-kicker label">Deploy stopped</p>
            <h1 className="awf-loadcard-h">The battle could not be fought</h1>
            <p className="awf-loadcard-p body-sm">{state.message}</p>
            <p className="awf-loadcard-actions"><a className="awf-back label" href={hrefs.briefing(mission.id)}>Back to briefing</a></p>
          </section>
        )}
      </div>
    </main>
  );
}

/** The route's own entry: finds the mission by id, or says there is none. */
export function DeployRoute({ missionId, webgl2 }: { missionId: string; webgl2?: boolean }): ReactElement {
  const mission = missionById(missionId);
  if (!mission) return <Lost title="No such mission" body={`The campaign has no mission called "${missionId}".`} />;
  return <DeployView key={mission.id} mission={mission} webgl2={webgl2} />;
}
