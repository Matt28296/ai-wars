// Small path builders for hand-authored vector art.

/** "x,y x,y ..." (or "x y, x y") → closed path. */
export function p(points: string): string {
  const nums = points.trim().split(/[\s,]+/).map(Number);
  let d = '';
  for (let i = 0; i < nums.length; i += 2) d += (i === 0 ? 'M' : 'L') + nums[i] + ' ' + nums[i + 1];
  return d + 'Z';
}

/** Several polygons in one path ("|" separated). */
export const ps = (polys: string) => polys.split('|').map(p).join('');

export const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`;

/** Rect with 45° chamfers. c = [topLeft, topRight, bottomRight, bottomLeft]. */
export function chamfer(x: number, y: number, w: number, h: number, c: number | [number, number, number, number]): string {
  const [a, b, cc, d] = typeof c === 'number' ? [c, c, c, c] : c;
  return p(`${x + a},${y} ${x + w - b},${y} ${x + w},${y + b} ${x + w},${y + h - cc} ${x + w - cc},${y + h} ${x + d},${y + h} ${x},${y + h - d} ${x},${y + a}`);
}

export const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
export const ellipse = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;

/** Regular polygon (n sides), rotation in degrees (0 = first vertex pointing right). */
export function ngon(cx: number, cy: number, r: number, n: number, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    pts.push(`${round(cx + r * Math.cos(a))},${round(cy + r * Math.sin(a))}`);
  }
  return p(pts.join(' '));
}

export const hex = (cx: number, cy: number, r: number, pointy = true) => ngon(cx, cy, r, 6, pointy ? 30 : 0);

export const round = (n: number) => Math.round(n * 100) / 100;

/** Deterministic hash → [0,1). */
export function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A line segment as a thick quad (for strokes that must stay crisp and joinless). */
export function seg(x1: number, y1: number, x2: number, y2: number, w: number): string {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
  return p(`${round(x1 + nx)},${round(y1 + ny)} ${round(x2 + nx)},${round(y2 + ny)} ${round(x2 - nx)},${round(y2 - ny)} ${round(x1 - nx)},${round(y1 - ny)}`);
}
