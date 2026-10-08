// A board for a backdrop: the tile still first, and over it, when the browser can make a WebGL2 context, the 3D board (a lazy chunk)
// fading in as soon as it has drawn its first picture (the still then hides itself once the fade is over). A browser without WebGL2, or
// a context that fails, keeps the still: never a blank.
import { Suspense, lazy, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { chooseRenderer, detectWebGL2 } from '../board3d/stage/support';
import { useReducedMotion } from './hooks';
import { StaticBoard } from './StaticBoard';
import type { OrbitSpec } from './orbit';
import type { PreviewScene } from './scene';

const BoardPreview3D = lazy(() => import('./BoardPreview3D'));

export interface BoardPreviewProps {
  scene: PreviewScene;
  orbit: OrbitSpec;
  /** Forces the answer to "can this browser do WebGL2?" (tests and screenshots); by default the browser is asked once. */
  webgl2?: boolean;
  className?: string;
}

export function BoardPreview({ scene, orbit, webgl2: forced, className }: BoardPreviewProps): ReactElement {
  const [webgl2] = useState(() => forced ?? detectWebGL2());
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  // `?renderer=2d` (the battle view's own switch) asks for the flat board here too.
  const live = webgl2 && !failed && chooseRenderer({ webgl2, search: typeof window === 'undefined' ? '' : window.location.search }) === '3d';
  const onReady = useCallback(() => setReady(true), []);
  const onFail = useCallback(() => setFailed(true), []);
  return (
    <div className={className ? `awf-preview ${className}` : 'awf-preview'} data-mode={live ? '3d' : 'still'} data-ready={live && ready ? 'yes' : 'no'}>
      <StaticBoard scene={scene} shift={orbit.shift} shiftNarrow={orbit.shiftNarrow} />
      {live && (
        <Suspense fallback={null}>
          <BoardPreview3D scene={scene} orbit={orbit} reducedMotion={reduced} onReady={onReady} onFail={onFail} />
        </Suspense>
      )}
    </div>
  );
}
