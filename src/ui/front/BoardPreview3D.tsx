// The lazy half of the board preview: mounts a PreviewRuntime (three.js) in a host element. Imported only through React.lazy in
// BoardPreview.tsx, so three.js, the terrain kit and the unit kit are a separate chunk the title does not wait for.
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { PreviewRuntime } from './preview3d';
import type { OrbitSpec } from './orbit';
import type { PreviewScene } from './scene';

export interface BoardPreview3DProps {
  scene: PreviewScene;
  orbit: OrbitSpec;
  reducedMotion: boolean;
  onReady: () => void;
  onFail: (reason: string) => void;
}

export default function BoardPreview3D({ scene, orbit, reducedMotion, onReady, onFail }: BoardPreview3DProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  // One renderer per mount. StrictMode mounts, unmounts and mounts again: the first runtime is disposed (context released, canvas
  // removed) before the second is built, so a double mount leaves one canvas and one context.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let rt: PreviewRuntime;
    try {
      rt = new PreviewRuntime(host, scene, {
        orbit,
        reducedMotion,
        onReady: () => onReadyRef.current(),
        onFail: (reason) => onFailRef.current(reason),
      });
    } catch (err) {
      onFailRef.current(err instanceof Error ? err.message : String(err));
      return undefined;
    }
    return () => rt.dispose();
  }, [scene, orbit, reducedMotion]);

  return <div className="awf-preview-host" ref={hostRef} />;
}
