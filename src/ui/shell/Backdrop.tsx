// The living tile field behind the title and menus: a slowly drifting slab of Meridia drawn from the
// terrain art, with idle units and ECHO's cursor hopping between properties.
import { memo, useEffect, useMemo, useState } from 'react';
import { cx } from '../kit/util';
import { genBackdrop } from './meridia';
import { SvgCursor, TileMap } from './TileMap';

const W = 56, H = 34, T = 32;

export type BackdropVariant = 'title' | 'menu' | 'deep';

export const Backdrop = memo(function Backdrop({ variant }: { variant: BackdropVariant }) {
  const map = useMemo(() => genBackdrop(W, H, 104), []);
  const spots = useMemo(() => {
    const out: [number, number][] = [];
    map.terrain.forEach((row, y) => row.split('').forEach((c, x) => { if ('CFAUH'.includes(c) && x > 8 && x < W - 8 && y > 4 && y < H - 4) out.push([x, y]); }));
    return out;
  }, [map]);
  const [spot, setSpot] = useState(0);
  useEffect(() => {
    if (!spots.length) return;
    const id = setInterval(() => setSpot((s) => (s * 7 + 3) % spots.length), 1500);
    return () => clearInterval(id);
  }, [spots.length]);
  const [cx0, cy0] = spots[spot] ?? [W / 2, H / 2];
  return (
    <div className={cx('sh-backdrop', `sh-backdrop--${variant}`)} aria-hidden>
      <div className="sh-backdrop-pan">
        <TileMap className="sh-backdrop-map" terrain={map.terrain} owners={map.owners} units={map.units} factions={map.factions} animate
          preserveAspectRatio="xMidYMid slice">
          <SvgCursor className="sh-backdrop-cursor" x={cx0 * T} y={cy0 * T} size={T} />
        </TileMap>
      </div>
      <div className="sh-backdrop-shade" />
    </div>
  );
});
