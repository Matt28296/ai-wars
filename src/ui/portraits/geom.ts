// Small geometry and colour helpers for drawing portrait shapes. Pure and deterministic; every number is rounded to a tenth so the
// composed SVG text is stable and short.

export interface Pt {
  x: number;
  y: number;
}

/** A number as short text: at most one decimal, no trailing zero. */
export function n(v: number): string {
  const r = Math.round(v * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}

export const pt = (x: number, y: number): Pt => ({ x, y });
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const P = (p: Pt): string => `${n(p.x)} ${n(p.y)}`;

/**
 * A filled brush stroke from `a` to `b`: thickness `ta` at a, `tb` at b, bowed by `bend` px at the middle (positive bends toward the
 * chord's normal, which is "down" for a left-to-right stroke). Used for brows, lids and lip lines, so the portraits have no strokes.
 */
export function taper(a: Pt, b: Pt, bend: number, ta: number, tb: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const m = mid(a, b);
  const tm = (ta + tb) / 2;
  const cx = m.x + nx * 2 * bend;
  const cy = m.y + ny * 2 * bend;
  const a1 = pt(a.x - (nx * ta) / 2, a.y - (ny * ta) / 2);
  const a2 = pt(a.x + (nx * ta) / 2, a.y + (ny * ta) / 2);
  const b1 = pt(b.x - (nx * tb) / 2, b.y - (ny * tb) / 2);
  const b2 = pt(b.x + (nx * tb) / 2, b.y + (ny * tb) / 2);
  const c1 = pt(cx - (nx * tm) / 2, cy - (ny * tm) / 2);
  const c2 = pt(cx + (nx * tm) / 2, cy + (ny * tm) / 2);
  return `M${P(a1)}Q${P(c1)} ${P(b1)}L${P(b2)}Q${P(c2)} ${P(a2)}Z`;
}

/** A filled circle as path data (so every shape in the art is a <path>). */
export function disc(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

/** A filled ellipse as path data. */
export function oval(cx: number, cy: number, rx: number, ry: number): string {
  return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
}

/** An axis-aligned rectangle as path data. */
export function box(x: number, y: number, w: number, h: number): string {
  return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
}

// ---------------------------------------------------------------- colour

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `a` toward `b` by `t` (0 = a, 1 = b), per channel. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** A pointed leaf (an almond) centred at (cx, cy), `len` long and `wid` wide, turned `deg` degrees clockwise from pointing right. */
export function leaf(cx: number, cy: number, len: number, wid: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const t1 = pt(cx - (ux * len) / 2, cy - (uy * len) / 2);
  const t2 = pt(cx + (ux * len) / 2, cy + (uy * len) / 2);
  const c1 = pt(cx - uy * wid, cy + ux * wid);
  const c2 = pt(cx + uy * wid, cy - ux * wid);
  return `M${n(t1.x)} ${n(t1.y)}Q${n(c1.x)} ${n(c1.y)} ${n(t2.x)} ${n(t2.y)}Q${n(c2.x)} ${n(c2.y)} ${n(t1.x)} ${n(t1.y)}Z`;
}

/** A rounded rectangle, clockwise. */
export function rrect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${n(x + r)} ${n(y)}H${n(x + w - r)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)}V${n(y + h - r)}Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}H${n(x + r)}Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r)}V${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Z`;
}

/** A rounded rectangle, counter-clockwise (a hole when drawn inside a clockwise one). */
export function rrectHole(x: number, y: number, w: number, h: number, r: number): string {
  return `M${n(x + r)} ${n(y)}Q${n(x)} ${n(y)} ${n(x)} ${n(y + r)}V${n(y + h - r)}Q${n(x)} ${n(y + h)} ${n(x + r)} ${n(y + h)}H${n(x + w - r)}Q${n(x + w)} ${n(y + h)} ${n(x + w)} ${n(y + h - r)}V${n(y + r)}Q${n(x + w)} ${n(y)} ${n(x + w - r)} ${n(y)}Z`;
}

/** A frame: a rounded rectangle with a hole `t` px inside it on every side. */
export function frameRect(x: number, y: number, w: number, h: number, r: number, t: number): string {
  return rrect(x, y, w, h, r) + rrectHole(x + t, y + t, w - 2 * t, h - 2 * t, Math.max(0.5, r - t));
}
