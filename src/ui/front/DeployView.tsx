// Deploy (G9): the mission is played with Doctrine (local rules) on every side, and the watch view opens on the battle with the campaign's
// player 0 as the viewer. The player never gets the units (D-001, D-007): they watch. G13 lays the mission's story over that watch
// (MissionWatch): its authored lines as the battle reaches them, and the debrief with its result card at the end.
//
// G14: the battle is LIVE. It is fought in a worker while the watch view plays what has been computed, and the player gives their agent orders
// before it (the objective screen's card, saved per mission) and during it (the Orders panel). A change counts from the start of the player's
// next turn (D-022): that turn is computed only when playback reaches it, under the orders in force at that moment (liveSession.ts).
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import type { Mission } from '../../content/types';
import type { StandingOrders } from '../../game/doctrine';
import { BoardPreview } from './BoardPreview';
import { missionById, pad2 } from './campaign';
import { useDocumentTitle } from './hooks';
import { LiveSession } from './liveSession';
import type { LiveSnapshot } from './liveSession';
import { Lost } from './Lost';
import { BRIEFING_ORBIT } from './orbit';
import { hrefs } from './router';
import { missionScene } from './missionScene';
import { connectBattle } from './deployClient';
import type { ConnectBattle } from './battle';
import { freshOrders } from './ordersModel';
import { loadOrders, saveOrders } from './ordersStore';

const MissionWatch = lazy(() => import('./MissionWatch').then((m) => ({ default: m.MissionWatch })));

/** What a screen that has no battle yet reads: nothing computed, orders not set. */
const NOTHING: LiveSnapshot = {
  actions: [], open: true, done: null, error: null, orders: freshOrders(), pending: false, orderChanges: [], notes: [],
};
const none = (): (() => void) => () => {};

/** The session's snapshot, kept current. Before there is a session, nothing. */
function useSnapshot(session: LiveSession | null): LiveSnapshot {
  return useSyncExternalStore(session ? session.subscribe : none, session ? session.snapshot : () => NOTHING, () => NOTHING);
}

export interface LoadingCardProps {
  mission: Mission;
  cycle: number;
}

/** The "the battle is being fought" card. Shown for the moment before the first turns are in. */
export function LoadingCard({ mission, cycle }: LoadingCardProps): ReactElement {
  return (
    <section className="awf-loadcard awf-cut" role="status" aria-live="polite" data-phase="deploying">
      <p className="awf-kicker label">Deploying · Mission {pad2(mission.order)}</p>
      <h1 className="awf-loadcard-h">The battle is being fought</h1>
      <p className="awf-loadcard-p body-sm">Doctrine (local rules) plays every side. Your agent follows your orders.</p>
      <div className="awf-progress" aria-hidden><span className="awf-progress-bar" /></div>
      <p className="awf-loadcard-cycle stat-sm">{cycle > 0 ? `Cycle ${pad2(cycle)}` : 'Briefing the sides'}</p>
    </section>
  );
}

export interface DeployViewProps {
  mission: Mission;
  /** Forces the answer to "can this browser do WebGL2?" for the backdrop (tests and screenshots). */
  webgl2?: boolean;
  /** Opens the battle (tests and screenshots); by default it is fought in a worker. */
  connect?: ConnectBattle;
  /** The orders the battle begins under; by default the ones saved for this mission. */
  firstOrders?: StandingOrders;
}

export function DeployView({ mission, webgl2, connect, firstOrders }: DeployViewProps): ReactElement {
  const [session, setSession] = useState<LiveSession | null>(null);
  const snap = useSnapshot(session);
  const scene = useMemo(() => missionScene(mission), [mission]);
  useDocumentTitle(`${mission.title} · Ascendant Wars`);

  // The watch view's chunk (and the story over it) loads while the battle is being fought, so it is ready the moment the first turns are.
  useEffect(() => {
    void import('./MissionWatch');
  }, []);

  useEffect(() => {
    const s = new LiveSession(mission, firstOrders ?? loadOrders(mission.id), connect ?? connectBattle);
    setSession(s);
    s.start();
    return () => {
      s.close();
      setSession((now) => (now === s ? null : now));
    };
  }, [mission, connect, firstOrders]);

  // Orders set in the battle are saved too: they are the orders of this mission from now on.
  const onOrders = useCallback((next: StandingOrders) => {
    session?.setOrders(next);
    try { saveOrders(mission.id, next); } catch { /* an orders object the card made is valid; nothing else can fail loudly here */ }
  }, [session, mission.id]);
  const result = useMemo(
    () => (session ? { setup: session.setup, actions: snap.actions, orderChanges: snap.orderChanges } : null),
    [session, snap.actions, snap.orderChanges],
  );
  const live = useMemo(
    () => (session ? { open: snap.open, orders: snap.orders, pending: snap.pending, onOrders, onReach: session.reached.bind(session) } : null),
    [session, snap.open, snap.orders, snap.pending, onOrders],
  );

  if (session && result && live && snap.error === null && snap.actions.length > 0) {
    return (
      <div className="awf-watch" data-screen="watch" data-live={snap.open ? 'yes' : 'no'}>
        <div className="awf-watchbar">
          <a className="awf-back label" href={hrefs.briefing(mission.id)}>Back to briefing</a>
          <span className="awf-watchbar-id label">Mission {pad2(mission.order)} · {mission.title}</span>
          <span className="awf-pill caption">Doctrine (local rules) on every side</span>
        </div>
        <Suspense fallback={<div className="awf-loading label">Opening the watch view</div>}>
          <MissionWatch mission={mission} result={result} live={live} />
        </Suspense>
      </div>
    );
  }
  return (
    <main className="awf-root awf-deploy" data-screen="deploy" data-phase={snap.error === null ? 'running' : 'error'}>
      <BoardPreview scene={scene} orbit={BRIEFING_ORBIT} webgl2={webgl2} className="awf-backdrop awf-backdrop--dim" />
      <div className="awf-brief-scrim" aria-hidden />
      <div className="awf-deploy-body">
        {snap.error === null ? (
          <LoadingCard mission={mission} cycle={0} />
        ) : (
          <section className="awf-loadcard awf-cut" role="alert" data-phase="error">
            <p className="awf-kicker label">Deploy stopped</p>
            <h1 className="awf-loadcard-h">The battle could not be fought</h1>
            <p className="awf-loadcard-p body-sm">{snap.error}</p>
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
