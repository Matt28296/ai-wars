// Battle input: keyboard (held-key repeat that accelerates), mouse and touch, turned into abstract commands.
import { useEffect, useRef } from 'react';
import { T } from './timings';

export type Cmd =
  | { k: 'move'; dx: number; dy: number; held: boolean }
  | { k: 'confirm'; source: 'key' | 'pointer' }
  | { k: 'cancel'; source: 'key' | 'pointer' }
  | { k: 'cancelHold'; down: boolean }
  | { k: 'confirmHold'; down: boolean }
  | { k: 'threat' }
  | { k: 'cycle'; dir: 1 | -1 }
  | { k: 'co' }
  | { k: 'intel' }
  | { k: 'endTurn' }
  | { k: 'point'; x: number; y: number }           // pointer moved over tile
  | { k: 'click'; x: number; y: number }           // pointer pressed on tile
  | { k: 'pan'; dx: number; dy: number }           // drag / wheel in screen px
  | { k: 'skip' };                                 // any press while a cinematic plays

const DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
};
const CONFIRM = new Set(['z', 'Z', 'Enter', ' ']);
const CANCEL = new Set(['x', 'X', 'Escape', 'Backspace']);

// Repeat timing (QB 2.2): step on key-down, first repeat after ~220 ms, then every ~67 ms; after ~1 s held, ~33 ms.
const FIRST_DELAY = T.repeatDelay;

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

/** Window keyboard listener. `enabled()` lets the screen pause input (e.g. while a dialogue player owns keys). */
export function useKeyboard(dispatch: (c: Cmd) => void, enabled: () => boolean) {
  const d = useRef(dispatch);
  d.current = dispatch;
  const en = useRef(enabled);
  en.current = enabled;

  useEffect(() => {
    const held = new Map<string, [number, number]>();
    let timer: number | undefined;
    let heldSince = 0;

    const vector = () => {
      let dx = 0, dy = 0;
      for (const [x, y] of held.values()) { dx += x; dy += y; }
      return [Math.sign(dx), Math.sign(dy)] as const;
    };
    const stop = () => { if (timer) window.clearTimeout(timer); timer = undefined; };
    const tick = () => {
      const [dx, dy] = vector();
      if (!dx && !dy) return stop();
      if (en.current()) d.current({ k: 'move', dx, dy, held: true });
      const fast = performance.now() - heldSince > T.repeatFastAfter;
      timer = window.setTimeout(tick, fast ? T.repeatFast : T.repeatInterval);
    };

    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!en.current()) return;
      const dir = DIRS[e.key];
      if (dir) {
        e.preventDefault();
        if (e.repeat) return; // our own repeat drives held keys
        const fresh = held.size === 0;
        held.set(e.key.toLowerCase(), dir);
        // a second key while one is held = diagonal step (both axes), keeping the repeat clock running
        const [dx, dy] = vector();
        d.current({ k: 'move', dx: fresh ? dir[0] : dx, dy: fresh ? dir[1] : dy, held: false });
        if (fresh) {
          heldSince = performance.now();
          stop();
          timer = window.setTimeout(tick, FIRST_DELAY);
        }
        return;
      }
      if (CONFIRM.has(e.key)) {
        e.preventDefault();
        if (!e.repeat) { d.current({ k: 'confirm', source: 'key' }); d.current({ k: 'confirmHold', down: true }); }
        return;
      }
      if (CANCEL.has(e.key)) {
        e.preventDefault();
        if (e.repeat) return;
        d.current({ k: 'cancel', source: 'key' });
        d.current({ k: 'cancelHold', down: true });
        return;
      }
      if (e.repeat) return;
      switch (e.key) {
        case 'q': case 'Q': d.current({ k: 'cycle', dir: -1 }); break;
        case 'e': case 'E': d.current({ k: 'cycle', dir: 1 }); break;
        case 'c': case 'C': d.current({ k: 'co' }); break;
        case 'i': case 'I': d.current({ k: 'intel' }); break;
        case 'r': case 'R': d.current({ k: 'endTurn' }); break;
        case 't': case 'T': d.current({ k: 'threat' }); break;
        default: return;
      }
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      if (DIRS[e.key]) {
        held.delete(e.key.toLowerCase());
        if (!held.size) stop();
      }
      if (CANCEL.has(e.key)) d.current({ k: 'cancelHold', down: false });
      if (CONFIRM.has(e.key)) d.current({ k: 'confirmHold', down: false });
    };
    const blur = () => { held.clear(); stop(); d.current({ k: 'cancelHold', down: false }); d.current({ k: 'confirmHold', down: false }); };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      stop();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
}

/**
 * Pointer handlers for the map surface. `toTile` converts client coordinates to a tile (or null off-map).
 * Mouse: hover = point, left click = click, right button = cancel (+ hold for threat), wheel = pan.
 * Touch: tap = click, drag = pan, two-finger tap = cancel, long-press = threat hold.
 */
export function usePointer(el: React.RefObject<HTMLElement>, dispatch: (c: Cmd) => void, toTile: (cx: number, cy: number) => { x: number; y: number } | null, enabled: () => boolean) {
  const d = useRef(dispatch);
  d.current = dispatch;
  const tt = useRef(toTile);
  tt.current = toTile;
  const en = useRef(enabled);
  en.current = enabled;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let last = '';
    let touch: { x: number; y: number; t: number; panned: boolean; multi: boolean; hold?: number; held: boolean } | null = null;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !en.current()) return;
      const t = tt.current(e.clientX, e.clientY);
      if (!t) return;
      const k = `${t.x},${t.y}`;
      if (k === last) return;
      last = k;
      d.current({ k: 'point', x: t.x, y: t.y });
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !en.current()) return;
      if (e.button === 2) { d.current({ k: 'cancel', source: 'pointer' }); d.current({ k: 'cancelHold', down: true }); return; }
      if (e.button !== 0) return;
      const t = tt.current(e.clientX, e.clientY);
      if (t) { last = `${t.x},${t.y}`; d.current({ k: 'click', x: t.x, y: t.y }); }
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button === 2) d.current({ k: 'cancelHold', down: false });
    };
    const onContext = (e: Event) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      if (!en.current()) return;
      e.preventDefault();
      d.current({ k: 'pan', dx: e.shiftKey ? e.deltaY : e.deltaX, dy: e.shiftKey ? 0 : e.deltaY });
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!en.current()) return;
      e.preventDefault();
      if (e.touches.length >= 2) {
        if (touch) { touch.multi = true; if (touch.hold) window.clearTimeout(touch.hold); }
        return;
      }
      const p = e.touches[0];
      touch = { x: p.clientX, y: p.clientY, t: performance.now(), panned: false, multi: false, held: false };
      const tt0 = touch;
      tt0.hold = window.setTimeout(() => {
        if (touch === tt0 && !tt0.panned && !tt0.multi) {
          tt0.held = true;
          const t = tt.current(tt0.x, tt0.y);
          if (t) d.current({ k: 'point', x: t.x, y: t.y });
          d.current({ k: 'cancelHold', down: true });
        }
      }, 480);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touch || e.touches.length !== 1) return;
      e.preventDefault();
      const p = e.touches[0];
      const dx = p.clientX - touch.x, dy = p.clientY - touch.y;
      if (!touch.panned && Math.hypot(dx, dy) < 10) return;
      touch.panned = true;
      if (touch.hold) window.clearTimeout(touch.hold);
      d.current({ k: 'pan', dx: -dx, dy: -dy });
      touch.x = p.clientX; touch.y = p.clientY;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!touch) return;
      e.preventDefault();
      if (e.touches.length > 0) return; // wait for the last finger
      const t0 = touch;
      touch = null;
      if (t0.hold) window.clearTimeout(t0.hold);
      if (t0.held) { d.current({ k: 'cancelHold', down: false }); return; }
      if (t0.multi) { d.current({ k: 'cancel', source: 'pointer' }); return; }
      if (t0.panned) return;
      const t = tt.current(t0.x, t0.y);
      if (t) d.current({ k: 'click', x: t.x, y: t.y });
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    node.addEventListener('contextmenu', onContext);
    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('touchstart', onTouchStart, { passive: false });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd, { passive: false });
    node.addEventListener('touchcancel', onTouchEnd, { passive: false });
    return () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      node.removeEventListener('contextmenu', onContext);
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [el]);
}
