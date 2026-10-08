// Shell input: one global listener drives every menu screen.
//   arrows / WASD     move the cursor (spatial navigation between [data-nav] elements)
//   Z / Enter / Space confirm (clicks the focused element)
//   X / Esc / Backspace, right-click, two-finger tap   cancel (the top layer's onBack)
//   mouse hover       moves the cursor; click confirms; touch tap = cursor + confirm
// Screens and overlays register a *layer* (useNavLayer); only the top layer receives input.
// Grouping: an element inside [data-nav-group="y"] keeps vertical moves inside that group (wrapping);
// "x" does the same horizontally, "xy" both. Elements with [data-nav-keys="x"] handle left/right themselves.
import { useEffect, useRef, type RefObject } from 'react';
import { sound } from './bridges';

export type Dir = 'up' | 'down' | 'left' | 'right';

export function dirFromKey(e: KeyboardEvent | React.KeyboardEvent): Dir | null {
  switch (e.key) {
    case 'ArrowUp': case 'w': case 'W': return 'up';
    case 'ArrowDown': case 's': case 'S': return 'down';
    case 'ArrowLeft': case 'a': case 'A': return 'left';
    case 'ArrowRight': case 'd': case 'D': return 'right';
    default: return null;
  }
}
export const isConfirmKey = (e: KeyboardEvent | React.KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.key === 'z' || e.key === 'Z';
export const isCancelKey = (e: KeyboardEvent | React.KeyboardEvent) => e.key === 'Escape' || e.key === 'x' || e.key === 'X' || e.key === 'Backspace';

interface LayerOpts {
  onBack?: () => void;
  /** Return true when the key was handled (stops default navigation). */
  onKey?: (e: KeyboardEvent) => boolean | void;
  autoFocus?: boolean;
  active?: boolean;
}
interface Layer { id: number; root: RefObject<HTMLElement>; opts: RefObject<LayerOpts>; last: HTMLElement | null }

const layers: Layer[] = [];
let nextId = 1;
const top = (): Layer | undefined => {
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i]!.opts.current?.active !== false && layers[i]!.root.current) return layers[i];
  return undefined;
};

const NAV = '[data-nav]';
function visible(el: HTMLElement) {
  if (el.closest('[inert],[aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function usable(el: HTMLElement) {
  return !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && visible(el);
}
export function navItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(NAV)].filter(usable);
}

function focusEl(el: HTMLElement | null | undefined, opts?: { silent?: boolean; scroll?: boolean }) {
  if (!el) return;
  if (document.activeElement === el) return;
  el.focus({ preventScroll: opts?.scroll === false });
  if (opts?.scroll !== false) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  if (!opts?.silent) sound.sfx('cursor');
}

function initialTarget(layer: Layer): HTMLElement | undefined {
  const root = layer.root.current;
  if (!root) return undefined;
  if (layer.last && root.contains(layer.last) && usable(layer.last)) return layer.last;
  const auto = [...root.querySelectorAll<HTMLElement>('[data-autofocus]')].find(usable);
  return auto ?? navItems(root)[0];
}

/** Focus the layer's remembered / autofocus / first item. */
export function focusLayerDefault(silent = true) {
  const l = top();
  if (l) focusEl(initialTarget(l), { silent });
}

function moveFocus(layer: Layer, dir: Dir) {
  const root = layer.root.current!;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !root.contains(cur) || !cur.matches(NAV)) {
    focusEl(initialTarget(layer));
    return;
  }
  const vertical = dir === 'up' || dir === 'down';
  const group = cur.closest<HTMLElement>('[data-nav-group]');
  const mode = group?.dataset.navGroup ?? '';
  const constrained = !!group && (vertical ? mode.includes('y') : mode.includes('x'));
  const pool = (constrained ? navItems(group!) : navItems(root)).filter((e) => e !== cur);
  const r = cur.getBoundingClientRect();
  const ccx = r.left + r.width / 2, ccy = r.top + r.height / 2;
  const sign = dir === 'down' || dir === 'right' ? 1 : -1;
  let best: HTMLElement | undefined, bestScore = Infinity;
  for (const el of pool) {
    const c = el.getBoundingClientRect();
    const ecx = c.left + c.width / 2, ecy = c.top + c.height / 2;
    const primary = (vertical ? ecy - ccy : ecx - ccx) * sign;
    if (primary <= 4) continue;
    // Gap on the orthogonal axis (0 when the two boxes overlap there).
    const orth = vertical
      ? Math.max(0, Math.max(c.left, r.left) - Math.min(c.right, r.right))
      : Math.max(0, Math.max(c.top, r.top) - Math.min(c.bottom, r.bottom));
    const centre = Math.abs(vertical ? ecx - ccx : ecy - ccy);
    const score = primary + orth * 3 + centre * 0.25;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best && constrained) {
    // Wrap to the far end of the group, choosing the best-aligned item there.
    let far = -Infinity;
    for (const el of pool) {
      const c = el.getBoundingClientRect();
      const ecx = c.left + c.width / 2, ecy = c.top + c.height / 2;
      const along = (vertical ? ccy - ecy : ccx - ecx) * sign; // distance in the opposite direction
      const centre = Math.abs(vertical ? ecx - ccx : ecy - ccy);
      const s = along - centre * 2;
      if (along > 4 && s > far) { far = s; best = el; }
    }
  }
  if (best) focusEl(best);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const layer = top();
  if (!layer) return;
  const opts = layer.opts.current ?? {};
  if (opts.onKey?.(e)) { e.preventDefault(); return; }
  const root = layer.root.current!;
  const dir = dirFromKey(e);
  if (dir) {
    const cur = document.activeElement as HTMLElement | null;
    if (cur?.dataset.navKeys?.includes(dir === 'left' || dir === 'right' ? 'x' : 'y') && root.contains(cur)) return;
    e.preventDefault();
    moveFocus(layer, dir);
    return;
  }
  if (isConfirmKey(e)) {
    if (e.repeat) { e.preventDefault(); return; }
    const cur = document.activeElement as HTMLElement | null;
    const inLayer = cur && root.contains(cur) && cur.matches(NAV);
    if (!inLayer) { e.preventDefault(); focusEl(initialTarget(layer)); return; }
    // Native buttons already click on Enter/Space; Z (and Enter on non-buttons) clicks explicitly.
    const native = cur.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ');
    if (!native) { e.preventDefault(); cur.click(); }
    return;
  }
  if (isCancelKey(e)) {
    if (opts.onBack) { e.preventDefault(); sound.sfx('cancel'); opts.onBack(); }
    return;
  }
}
function onContextMenu(e: MouseEvent) {
  const layer = top();
  if (!layer?.opts.current?.onBack) return;
  e.preventDefault();
  sound.sfx('cancel');
  layer.opts.current.onBack();
}
function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 2) return;
  const layer = top();
  if (!layer?.opts.current?.onBack) return;
  e.preventDefault();
  sound.sfx('cancel');
  layer.opts.current.onBack();
}
function onPointerOver(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return;
  const layer = top();
  const root = layer?.root.current;
  if (!layer || !root) return;
  const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(NAV);
  if (!el || !root.contains(el) || !usable(el) || el.dataset.navHover === 'off') return;
  focusEl(el, { scroll: false });
}
function onFocusIn(e: FocusEvent) {
  const el = e.target as HTMLElement;
  for (const l of layers) if (l.root.current?.contains(el) && el.matches?.(NAV)) l.last = el;
}

let installed = 0;
/** Installs the global listeners (App calls this once). Returns an uninstaller. */
export function installShellInput(): () => void {
  if (installed++ === 0) {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('focusin', onFocusIn);
  }
  return () => {
    if (--installed === 0) {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('focusin', onFocusIn);
    }
  };
}

/** Registers a navigation layer rooted at `ref`. The newest (or innermost) active layer receives input. */
export function useNavLayer(ref: RefObject<HTMLElement>, opts: LayerOpts = {}) {
  const optsRef = useRef<LayerOpts>(opts);
  optsRef.current = opts;
  useEffect(() => {
    const layer: Layer = { id: nextId++, root: ref, opts: optsRef, last: null };
    // A parent registering after its child (React runs child effects first) goes underneath it.
    const idx = layers.findIndex((l) => l.root.current && ref.current?.contains(l.root.current));
    if (idx >= 0) layers.splice(idx, 0, layer); else layers.push(layer);
    let raf = 0;
    if (opts.autoFocus !== false) {
      raf = requestAnimationFrame(() => {
        if (top() === layer) {
          const cur = document.activeElement as HTMLElement | null;
          if (!cur || !ref.current?.contains(cur)) focusEl(initialTarget(layer), { silent: true });
        }
      });
    }
    return () => {
      cancelAnimationFrame(raf);
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      // Hand focus back to the layer underneath.
      const t = top();
      if (t && (!document.activeElement || document.activeElement === document.body || !document.contains(document.activeElement))) {
        requestAnimationFrame(() => { if (top() === t) focusEl(initialTarget(t), { silent: true }); });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Plays the right sound and runs `fn` — for click handlers on shell controls. */
export function withSfx<T extends unknown[]>(name: Parameters<typeof sound.sfx>[0], fn?: (...a: T) => void) {
  return (...a: T) => { sound.sfx(name); fn?.(...a); };
}
