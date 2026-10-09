// The front door (G9): a small hash router over the title, the campaign map, the briefing, Deploy and today's demo watch view.
// Everything heavy is a lazy chunk, so the title paints at once: the campaign, briefing and Deploy screens, the 3D board preview, the
// watch view and Doctrine are each fetched only when their screen is first opened.
import { Component, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
import { ConnectScreen } from './ConnectScreen';
import { agentHostHere } from './connect';
import { Lost } from './Lost';
import { parseRoute } from './router';
import { TitleScreen } from './TitleScreen';
import '../watch/kit/kit.css';
import './front.css';

const CampaignMap = lazy(() => import('./CampaignMap').then((m) => ({ default: m.CampaignMap })));
const BriefingRoute = lazy(() => import('./BriefingView').then((m) => ({ default: m.BriefingRoute })));
const DeployRoute = lazy(() => import('./DeployView').then((m) => ({ default: m.DeployRoute })));
const DemoView = lazy(() => import('./DemoView'));
const LiveRoute = lazy(() => import('./LiveView').then((m) => ({ default: m.LiveRoute })));

const GAME = 'Ascendant Wars';

function Loading(): ReactElement {
  return <div className="awf-loading label" role="status">Loading</div>;
}

/** A screen that throws shows the way out instead of a blank page. */
class Guard extends Component<{ children: ReactNode; resetKey: string }, { failed: string | null }> {
  state = { failed: null as string | null };
  static getDerivedStateFromError(err: unknown): { failed: string } {
    return { failed: err instanceof Error ? err.message : String(err) };
  }
  componentDidUpdate(prev: { resetKey: string }): void {
    if (prev.resetKey !== this.props.resetKey && this.state.failed !== null) this.setState({ failed: null });
  }
  componentDidCatch(err: unknown, info: ErrorInfo): void {
    console.error('front door:', err, info.componentStack);
  }
  render(): ReactNode {
    return this.state.failed === null ? this.props.children : <Lost title="This screen could not open" body={this.state.failed} />;
  }
}

export interface FrontAppProps {
  /** Pins the address (tests and screenshots). By default the app follows the page's own hash. */
  hash?: string;
  /** Forces the answer to "can this browser do WebGL2?" for the 3D backdrops (tests and screenshots). */
  webgl2?: boolean;
}

export function FrontApp({ hash: pinned, webgl2 }: FrontAppProps): ReactElement {
  const [hash, setHash] = useState(() => pinned ?? (typeof window === 'undefined' ? '' : window.location.hash));
  useEffect(() => {
    if (pinned !== undefined) { setHash(pinned); return undefined; }
    // `hashchange` only: the demo rewrites its own hash with replaceState as it plays, which must not look like a navigation.
    const on = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [pinned]);
  const route = useMemo(() => parseRoute(hash), [hash]);

  // The campaign, briefing and Deploy screens set their own title when they open; the others are the game's name.
  useEffect(() => {
    if (route.kind === 'title' || route.kind === 'demo' || route.kind === 'unknown' || route.kind === 'connect') document.title = GAME;
    window.scrollTo?.(0, 0);
  }, [route]);

  let screen: ReactElement;
  switch (route.kind) {
    case 'title':
      screen = <TitleScreen webgl2={webgl2} />;
      break;
    case 'campaign':
      screen = <CampaignMap />;
      break;
    case 'connect':
      screen = <ConnectScreen />;
      break;
    case 'live':
      // A hosted copy has no feed to open (H1): it shows the connect screen's "coming soon" and asks nothing of its host.
      screen = agentHostHere() ? <LiveRoute /> : <ConnectScreen hosted />;
      break;
    case 'briefing':
      screen = <BriefingRoute missionId={route.missionId} webgl2={webgl2} />;
      break;
    case 'deploy':
      screen = <DeployRoute missionId={route.missionId} webgl2={webgl2} />;
      break;
    case 'demo':
      screen = <DemoView hash={hash} />;
      break;
    case 'unknown':
      screen = <Lost title="No such page" body="That address does not lead anywhere in the game." />;
      break;
  }
  return (
    <Guard resetKey={hash}>
      <Suspense fallback={<Loading />}>{screen}</Suspense>
    </Guard>
  );
}
