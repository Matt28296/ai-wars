// The title's and the briefing's still: the board drawn from the design-system tiles (MapTile) and unit tokens, laid on a tilted plane.
// It is what a browser without WebGL2 sees, and what everybody sees for the moment before the 3D board has drawn its first picture.
// It is never blank and never needs three.js.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { MapTile, UnitToken } from '../watch/kit';
import { NARROW_ASPECT } from './orbit';
import type { PreviewScene } from './scene';

export interface StaticBoardProps {
  scene: PreviewScene;
  /** Edge of one tile, in px, before the plane is scaled to fit. */
  tile?: number;
  /** Where the plane's centre sits, as a fraction of the container (see OrbitSpec.shift), and on a tall narrow one. */
  shift?: { x: number; y: number };
  shiftNarrow?: { x: number; y: number };
}

const TILT_X = 58;
const TILT_Z = -26;

/**
 * The scale and centre at which the tilted plane (rotated about Z, then tipped back about X) fits the container with the board's
 * centre where `shift` puts it. The footprint of the rotated plane is worked out in closed form: a W x H rectangle turned by theta
 * spans W cos + H sin by W sin + H cos, and the tip foreshortens the height by cos(tilt). Measured live; 1 until the container has a
 * size (and on the server).
 */
function useFit(planeW: number, planeH: number, shift: { x: number; y: number }, shiftNarrow: { x: number; y: number }): [React.RefObject<HTMLDivElement>, number, { x: number; y: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; shift: { x: number; y: number } }>({ scale: 1, shift });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const sh = w / h < NARROW_ASPECT ? shiftNarrow : shift;
      const th = (Math.abs(TILT_Z) * Math.PI) / 180;
      const spanX = planeW * Math.cos(th) + planeH * Math.sin(th);
      const spanY = Math.cos((TILT_X * Math.PI) / 180) * (planeW * Math.sin(th) + planeH * Math.cos(th));
      // half the span has to fit between the board's centre and the nearer edge of the picture
      const roomX = w * (0.5 - Math.abs(sh.x)) * 2;
      const roomY = h * (0.5 - Math.abs(sh.y)) * 2;
      // on a tall narrow picture the board is allowed to run off the sides: fitted to the width it would be a thin band
      const narrow = w / h < NARROW_ASPECT;
      setFit({ scale: Math.max(0.2, Math.min(roomX / spanX, roomY / spanY) * (narrow ? 1.6 : 1)), shift: sh });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [planeW, planeH, shift, shiftNarrow]);
  return [ref, fit.scale, fit.shift];
}

export function StaticBoard({ scene, tile = 40, shift = { x: 0, y: 0 }, shiftNarrow = shift }: StaticBoardProps): ReactElement {
  const planeW = scene.width * tile;
  const planeH = scene.height * tile;
  const [ref, scale, at] = useFit(planeW, planeH, shift, shiftNarrow);
  const style = {
    '--awf-plane-w': `${planeW}px`,
    '--awf-plane-h': `${planeH}px`,
    '--awf-still-scale': scale.toFixed(3),
    '--awf-shift-x': `${(at.x * 100).toFixed(1)}%`,
    '--awf-shift-y': `${(at.y * 100).toFixed(1)}%`,
    '--awf-tilt-x': `${TILT_X}deg`,
    '--awf-tilt-z': `${TILT_Z}deg`,
  } as CSSProperties;
  return (
    <div className="awf-still" aria-hidden="true" data-still="tiles" ref={ref} style={style}>
      <div className="awf-still-plane">
        <div className="awf-still-grid" style={{ gridTemplateColumns: `repeat(${scene.width}, ${tile}px)` }}>
          {scene.terrain.flatMap((row, y) => row.map((terrain, x) => {
            const owner = scene.owners[y][x];
            return <MapTile key={`${x},${y}`} terrain={terrain} owner={owner === null ? undefined : scene.factions[owner] ?? undefined} size={tile} decorative />;
          }))}
        </div>
        {scene.units.map((u, i) => (
          <div key={i} className="awf-still-unit" style={{ left: u.x * tile, top: u.y * tile, width: tile, height: tile }}>
            <UnitToken unit={u.type} faction={u.faction} size={tile} facing={Math.cos(u.heading) < -0.5 ? 'left' : 'right'} decorative />
          </div>
        ))}
      </div>
    </div>
  );
}
