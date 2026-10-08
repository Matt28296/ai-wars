// Camera: integer tile scaling to fit the window, edge-margin cursor follow and smooth scrolling.
// The world transform is written straight to the DOM from a rAF loop, so scrolling never re-renders React.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Coord } from '../../engine/types';

export const BASE_TILE = 48;
/** Aim to show at least this many tiles (or the whole map if smaller) before scaling up. */
const MIN_VIEW_W = 15;
const MIN_VIEW_H = 10;

export function pickScale(vw: number, vh: number, mapW: number, mapH: number) {
  const sx = vw / (BASE_TILE * Math.min(mapW, MIN_VIEW_W));
  const sy = vh / (BASE_TILE * Math.min(mapH, MIN_VIEW_H));
  return Math.max(1, Math.floor(Math.min(sx, sy)));
}

export interface Camera {
  scale: number;
  tile: number;
  vw: number;
  vh: number;
  worldRef: React.RefObject<HTMLDivElement>;
  /** Current target (px) — where the camera is heading. */
  target: () => { x: number; y: number };
  follow(c: Coord, margin?: number): void;
  center(c: Coord, instant?: boolean): void;
  panBy(dx: number, dy: number): void;
  toTile(clientX: number, clientY: number): Coord | null;
  /** Screen-space position (px, relative to the root) of a tile's top-left, using the camera target. */
  screenOf(c: Coord): { x: number; y: number };
}

export function useCamera(rootRef: React.RefObject<HTMLDivElement>, mapW: number, mapH: number, reducedMotion: boolean): Camera {
  const [size, setSize] = useState({ w: typeof window !== 'undefined' ? window.innerWidth : 1280, h: typeof window !== 'undefined' ? window.innerHeight : 720 });
  const worldRef = useRef<HTMLDivElement>(null);
  const cur = useRef({ x: 0, y: 0 });
  const tgt = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);
  const last = useRef(0);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rootRef]);

  const scale = pickScale(size.w, size.h, mapW, mapH);
  const tile = BASE_TILE * scale;
  const mw = mapW * tile, mh = mapH * tile;

  const clamp = useCallback((p: { x: number; y: number }) => ({
    x: mw <= size.w ? -(size.w - mw) / 2 : Math.max(0, Math.min(mw - size.w, p.x)),
    y: mh <= size.h ? -(size.h - mh) / 2 : Math.max(0, Math.min(mh - size.h, p.y)),
  }), [mw, mh, size.w, size.h]);

  const apply = useCallback(() => {
    const w = worldRef.current;
    if (w) w.style.transform = `translate3d(${-Math.round(cur.current.x)}px, ${-Math.round(cur.current.y)}px, 0)`;
  }, []);

  const step = useCallback((t: number) => {
    const dt = Math.min(64, t - (last.current || t));
    last.current = t;
    const k = 1 - Math.exp(-dt / 55); // ~55 ms time constant: quick, never floaty
    const c = cur.current, g = tgt.current;
    c.x += (g.x - c.x) * k;
    c.y += (g.y - c.y) * k;
    if (Math.abs(g.x - c.x) < 0.5 && Math.abs(g.y - c.y) < 0.5) { c.x = g.x; c.y = g.y; raf.current = null; last.current = 0; apply(); return; }
    apply();
    raf.current = requestAnimationFrame(step);
  }, [apply]);

  const kick = useCallback((instant?: boolean) => {
    if (instant || reducedMotion) {
      cur.current = { ...tgt.current };
      apply();
      return;
    }
    if (raf.current == null) raf.current = requestAnimationFrame(step);
  }, [apply, step, reducedMotion]);

  // Re-clamp when the viewport or scale changes.
  useLayoutEffect(() => {
    tgt.current = clamp(tgt.current);
    cur.current = { ...tgt.current };
    apply();
  }, [clamp, apply]);

  useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);

  const follow = useCallback((c: Coord, margin = 2) => {
    const m = Math.min(margin, Math.floor((size.w / tile - 1) / 2), Math.floor((size.h / tile - 1) / 2)) * tile;
    const g = { ...tgt.current };
    const left = c.x * tile, top = c.y * tile;
    if (left - m < g.x) g.x = left - m;
    if (left + tile + m > g.x + size.w) g.x = left + tile + m - size.w;
    if (top - m < g.y) g.y = top - m;
    if (top + tile + m > g.y + size.h) g.y = top + tile + m - size.h;
    const n = clamp(g);
    if (n.x !== tgt.current.x || n.y !== tgt.current.y) { tgt.current = n; kick(); }
  }, [size.w, size.h, tile, clamp, kick]);

  const center = useCallback((c: Coord, instant?: boolean) => {
    tgt.current = clamp({ x: c.x * tile + tile / 2 - size.w / 2, y: c.y * tile + tile / 2 - size.h / 2 });
    kick(instant);
  }, [tile, size.w, size.h, clamp, kick]);

  const panBy = useCallback((dx: number, dy: number) => {
    tgt.current = clamp({ x: tgt.current.x + dx, y: tgt.current.y + dy });
    cur.current = { ...tgt.current };
    apply();
  }, [clamp, apply]);

  const toTile = useCallback((cx: number, cy: number) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return null;
    const x = Math.floor((cx - r.left + cur.current.x) / tile);
    const y = Math.floor((cy - r.top + cur.current.y) / tile);
    if (x < 0 || y < 0 || x >= mapW || y >= mapH) return null;
    return { x, y };
  }, [rootRef, tile, mapW, mapH]);

  const screenOf = useCallback((c: Coord) => ({ x: c.x * tile - tgt.current.x, y: c.y * tile - tgt.current.y }), [tile]);
  const target = useCallback(() => tgt.current, []);

  return useMemo(() => ({ scale, tile, vw: size.w, vh: size.h, worldRef, target, follow, center, panBy, toTile, screenOf }),
    [scale, tile, size.w, size.h, target, follow, center, panBy, toTile, screenOf]);
}
