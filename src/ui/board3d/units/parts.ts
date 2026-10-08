// Pieces several models share: tracks, hover glow, spinning blades.
import type { Kit, V3 } from './kit';

export interface TrackSpec {
  /** Overall length along X and the |z| of the track's centre line. */
  len: number;
  z: number;
  /** Track width (along Z) and height. */
  w: number;
  h: number;
  wheels: number;
  wheelR: number;
}

/** A pair of tank tracks: a sloped dark track body with painted road wheels on the outer face. */
export function trackPair(k: Kit, t: TrackSpec): void {
  for (const s of [-1, 1]) {
    const zc = s * t.z;
    const e = t.w / 2;
    const l = t.len / 2;
    const pts: V3[] = [];
    for (const dz of [-e, e]) pts.push([-l, 0, zc + dz], [l, 0, zc + dz], [-l + 0.07, t.h, zc + dz], [l - 0.07, t.h, zc + dz]);
    k.hull('dark', pts);
    for (let i = 0; i < t.wheels; i += 1) {
      const x = t.wheels === 1 ? 0 : -l + 0.1 + (i * (t.len - 0.2)) / (t.wheels - 1);
      k.wheel('paint', t.wheelR, 0.018, 6, [x, t.h * 0.46, s * (t.z + e + 0.002)]);
    }
  }
}

/** A glowing disc under a hover unit. */
export function hoverGlow(k: Kit, x: number, z: number, r: number, y = 0.05): void {
  k.cyl('trim', r, r, 0.012, 8, [x, y, z]);
}

/** A rotor: a hub and `blades` full-length blades, one mesh, lying flat in the node's XZ plane at the origin. */
export function rotor(k: Kit, r: number, blades: number): void {
  k.cyl('dark', 0.022, 0.026, 0.03, 6, [0, 0, 0]);
  for (let i = 0; i < blades; i += 1) {
    const a = (i / blades) * Math.PI;
    k.box('dark', [r * 2, 0.008, 0.026], [0, 0.014, 0], [0, a, 0]);
  }
}

/** The see-through disc a spinning rotor blurs into. A circle looks the same turning, so it lives in the static body (one mesh for all). */
export function rotorBlur(k: Kit, r: number, at: V3): void {
  const disc: [number, number][] = [];
  for (let i = 0; i < 12; i += 1) disc.push([Math.cos((i / 12) * Math.PI * 2) * r, Math.sin((i / 12) * Math.PI * 2) * r]);
  k.flat('blur', disc, at[1], [], [at[0], 0, at[2]]);
}
