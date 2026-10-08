// Mounts the watch-only battle viewer on a demo match (M5.0): calder-fields, two commanders, a seeded greedy game, watched as
// player 0 under fog. The platform shell (M2) replaces this mount; the viewer itself is src/ui/watch.
import { StrictMode, useCallback, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import { WatchView, buildDemoMatch, formatHash, parseHash } from './ui/watch';
import type { Speed, Viewer } from './ui/watch';

export const BUILD_SHA: string = __BUILD_SHA__;

function Demo() {
  const match = useMemo(() => buildDemoMatch(), []);
  const initial = useMemo(() => parseHash(window.location.hash, match.setup.players.length), [match]);
  const [viewer, setViewer] = useState<Viewer>(initial.viewer ?? 0);
  const where = useRef<{ step: number; speed: Speed }>({ step: initial.step ?? 0, speed: initial.speed ?? 1 });
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;

  // Keep the URL hash in step with what is on screen, so a moment can be linked: #step=40&viewer=1&speed=2
  const writeHash = useCallback((v: Viewer) => {
    const h = formatHash({ step: where.current.step, viewer: v, speed: where.current.speed });
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${h}`);
  }, []);
  const onPosition = useCallback((p: { step: number; speed: Speed }) => {
    where.current = p;
    writeHash(viewerRef.current);
  }, [writeHash]);
  const onViewer = useCallback((v: Viewer) => {
    viewerRef.current = v;
    setViewer(v);
    writeHash(v);
  }, [writeHash]);

  return (
    <WatchView
      setup={match.setup}
      actions={match.actions}
      viewer={viewer}
      onViewerChange={onViewer}
      initialStep={initial.step}
      initialSpeed={initial.speed}
      autoPlay={initial.play ?? initial.step === undefined}
      onPositionChange={onPosition}
    />
  );
}

const root = document.getElementById('root');
if (root) {
  root.setAttribute('data-build', BUILD_SHA);
  createRoot(root).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  );
}
