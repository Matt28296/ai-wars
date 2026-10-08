// Today's demo watch view, moved out of src/main.tsx unchanged in behaviour: calder-fields, Rook Okafor against Sefa Tamura, a seeded
// match watched under fog, with the hash (#step=40&viewer=all&speed=2&play) read once on arrival and kept in step as the viewer plays.
// The only change is that the hash arrives as a prop (the router already has it), which lets the tests render this view on the server.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { WatchView, buildDemoMatch, formatHash, parseHash } from '../watch';
import type { Speed, Viewer } from '../watch';

export default function DemoView({ hash }: { hash: string }): ReactElement {
  const match = useMemo(() => buildDemoMatch(), []);
  const initial = useMemo(() => parseHash(hash, match.setup.players.length), [match, hash]);
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
