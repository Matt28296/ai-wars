// Faction detailing (art direction, Faction design language). The silhouette comes from the unit type; the faction adds fins,
// trim placement and a sigil decal on top of that same shape. Owner is never colour alone: paint + sigil + trim.
import { OctahedronGeometry } from 'three';
import type { FactionId } from '../../../game/aw';
import type { UnitViewOptions } from '../contract';
import { Kit } from './kit';
import type { P2, V3 } from './kit';

/** Where a recipe lets the faction attach detail. All in model space, +X forward. */
export interface Anchors {
  /** Centre and edge length of the sigil decal (flat on a top-facing surface at height y). */
  sigil: { x: number; y: number; size: number };
  /** The exposed top of the main hull: stripes, frames and vents go here. */
  deck: { x: number; y: number; len: number; wid: number };
  /** The hull side: bands, plates and fins attach at +-z, between x0 and x1, centred at height y. */
  flank: { x0: number; x1: number; y: number; z: number; h: number };
  /** The front tip of the hull (the raised prow sits behind it). */
  nose: { x: number; y: number };
  /** Skip the side fins when the type has its own appendages there (wings, rotor arms, legs). */
  fins: boolean;
  /** Overall scale of the detail (a foot figure is far smaller than a battleship). */
  scale: number;
  /** The most any fin or plate may stand out sideways from the flank, so the faction never changes the silhouette's width by much. */
  reach: number;
}

// ---------------------------------------------------------------- sigils

const CHEVRON: P2[] = [[0.5, 0], [-0.35, 0.5], [-0.35, 0.24], [0.02, 0], [-0.35, -0.24], [-0.35, -0.5]];

/** Outline polygons (x forward, z) of each faction's sigil, in a unit box. Holes make the rings. */
const SIGILS: Record<FactionId, { outline: P2[][]; holes?: P2[][] }> = {
  // rising chevron
  helion: { outline: [CHEVRON, [[-0.46, -0.1], [-0.46, 0.1], [-0.62, 0.1], [-0.62, -0.1]]] },
  // concentric ring
  tidewell: { outline: [ring(0.5, 10), ring(0.17, 6)], holes: [ring(0.3, 10)] },
  // leaf triangle
  verdant: { outline: [[[0.5, 0], [-0.5, 0.46], [-0.5, -0.46]]], holes: [[[0.18, 0], [-0.3, 0.07], [-0.3, -0.07]]] },
  // winged diamond
  kestrel: { outline: [[[0.5, 0], [0, 0.16], [-0.5, 0], [0, -0.16]], [[0.08, 0.14], [-0.4, 0.52], [-0.14, 0.12]], [[0.08, -0.14], [-0.14, -0.12], [-0.4, -0.52]]] },
  // broken hexagon (a gap on the forward-left side) plus a slash
  choir: { outline: [...hexSegments(), [[-0.42, -0.5], [-0.3, -0.5], [0.42, 0.5], [0.3, 0.5]]] },
};

function ring(r: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i += 1) out.push([Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r]);
  return out;
}

/** Five of the six sides of a hexagon ring: the sixth is the "break". */
function hexSegments(): P2[][] {
  const segs: P2[][] = [];
  const R = 0.5;
  const r = 0.34;
  for (let i = 0; i < 5; i += 1) {
    const a0 = (i / 6) * Math.PI * 2 + 0.12;
    const a1 = ((i + 1) / 6) * Math.PI * 2 - 0.12;
    segs.push([
      [Math.cos(a0) * R, Math.sin(a0) * R], [Math.cos(a1) * R, Math.sin(a1) * R],
      [Math.cos(a1) * r, Math.sin(a1) * r], [Math.cos(a0) * r, Math.sin(a0) * r],
    ]);
  }
  return segs;
}

/** One faction's sigil as flat pieces (x forward, z; in a unit box). The first piece owns the holes. Read-only: the tests measure the decal against it. */
export function sigilShapes(faction: FactionId): { outline: readonly P2[]; holes: readonly (readonly P2[])[] }[] {
  const s = SIGILS[faction];
  return s.outline.map((outline, i) => ({ outline, holes: i === 0 && s.holes ? s.holes : [] }));
}

/** The sigil decal, flat on the deck, pointing forward. */
export function sigil(k: Kit, faction: FactionId, at: { x: number; y: number; size: number }): void {
  const s = SIGILS[faction];
  // The holes belong to the first outline only (rings and the leaf); further outlines are separate pieces.
  s.outline.forEach((o, i) => k.flat('trim', o, at.y + 0.004, i === 0 && s.holes ? s.holes : [], [at.x, 0, 0], at.size));
}

// ---------------------------------------------------------------- crew cabin or sensor

/** A crew canopy for the four nations; the Choir has no crew cabins, so it gets a faceted red sensor instead. */
export function cab(k: Kit, faction: FactionId, pos: V3, size: V3, wSeg = 6, hSeg = 4): void {
  if (faction === 'choir') {
    k.add('trim', new OctahedronGeometry(1, 0), pos, [0, 0, 0], [size[0] * 0.55, size[1] * 0.6, size[2] * 0.55]);
  } else {
    k.sphere('glass', [size[0] / 2, size[1] / 2, size[2] / 2], pos, wSeg, hSeg);
  }
}

// ---------------------------------------------------------------- the dressing

/**
 * Add the faction's fins, trim placement and sigil to a model that offers these anchors.
 * `unmarked` (a seat whose nation the mission does not name, G16): no sigil decal, and nothing in its place. Everything else the nation adds
 * is paint, trim and shape, which are colours and silhouettes and not a name, so they stay.
 */
export function dress(k: Kit, faction: FactionId, a: Anchors, opts?: UnitViewOptions): void {
  if (!opts?.unmarked) sigil(k, faction, a.sigil);
  switch (faction) {
    case 'helion': return helion(k, a);
    case 'tidewell': return tidewell(k, a);
    case 'verdant': return verdant(k, a);
    case 'kestrel': return kestrel(k, a);
    case 'choir': return choir(k, a);
  }
}

const SIDES = [-1, 1] as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Rounded-angular hulls, solar-panel fins and chevron stripes. */
function helion(k: Kit, a: Anchors): void {
  const L = a.flank.x1 - a.flank.x0;
  const lite = a.scale < 0.6;
  const pw = Math.min(clamp(L * 0.3, 0.03, 0.14), a.reach / 0.83);
  const pl = Math.min(clamp(L * 0.42, 0.045, 0.2), pw / 0.7 + 0.04);
  if (a.fins) {
    for (const s of SIDES) {
      for (let i = 0; i < (lite ? 1 : 2); i += 1) {
        const panel = new Kit();
        panel.box('dark', [pl, 0.012, pw], [0, 0, s * pw / 2]);
        panel.box('trim', [pl, 0.016, 0.01], [0, 0.002, s * (pw - 0.005)]);
        if (!lite) panel.box('trim', [pl, 0.016, 0.01], [0, 0.002, s * 0.005]);
        k.addKit(panel, [a.flank.x0 + L * (0.2 + 0.36 * i), a.flank.y + a.flank.h * 0.3, s * a.flank.z], [-s * 0.6, 0, 0]);
      }
    }
  }
  // two chevron stripes pointing forward on the deck
  const cw = a.deck.wid * 0.62;
  const cl = clamp(a.deck.len * 0.2, 0.03, 0.09);
  for (let i = 0; i < (lite ? 1 : 2); i += 1) {
    const x = a.deck.x - a.deck.len * (0.12 + 0.25 * i);
    k.flat('trim', CHEVRON, a.deck.y + 0.003, [], [x, 0, 0], [cl, cw]);
  }
}

/** Maritime hulls, ring vents and stacked plates. */
function tidewell(k: Kit, a: Anchors): void {
  const L = a.flank.x1 - a.flank.x0;
  const sc = clamp(a.scale, 0.4, 1.4);
  const lite = a.scale < 0.6;
  // ring vents on the rear deck
  for (const s of lite ? [1] : SIDES) {
    const x = a.deck.x - a.deck.len * 0.28;
    const z = lite ? 0 : s * a.deck.wid * 0.24;
    const r = 0.042 * sc;
    k.cyl('dark', r, r * 1.1, 0.03 * sc, 8, [x, a.deck.y + 0.015 * sc, z]);
    k.ring('trim', r * 0.55, r * 0.9, 8, [x, a.deck.y + 0.03 * sc + 0.003, z]);
  }
  // stacked plates and a trim band along the hull side
  for (const s of SIDES) {
    const zf = s * (a.flank.z + 0.004);
    const th = clamp(a.flank.h * 0.2, 0.012, 0.03);
    if (!lite) {
      k.box('paint', [L * 0.78, th, 0.012], [a.flank.x0 + L * 0.45, a.flank.y + th * 1.6, zf]);
      k.box('paint', [L * 0.62, th, 0.012], [a.flank.x0 + L * 0.4, a.flank.y - th * 1.6, zf]);
    }
    k.box('trim', [L * 0.7, th * 0.4, 0.014], [a.flank.x0 + L * 0.44, a.flank.y, zf]);
  }
}

/** Organic curves, leaf-triangle fins and light frames. */
function verdant(k: Kit, a: Anchors): void {
  const L = a.flank.x1 - a.flank.x0;
  const lite = a.scale < 0.6;
  if (a.fins) {
    for (const s of SIDES) {
      for (let i = 0; i < (lite ? 1 : 2); i += 1) {
        const l = clamp(L * 0.4, 0.05, 0.16);
        const h = Math.min(l * 1.1, a.reach / 0.95);
        const leaf = new Kit();
        // a thin triangular plate leaning outward: base along X, apex swept back and out
        const t = 0.007;
        const pts: V3[] = [];
        for (const e of [-t, t]) pts.push([-l / 2, e, 0], [l / 2, e, 0], [-l * 0.18, e, s * h]);
        leaf.hull('paint', pts);
        leaf.box('trim', [l * 0.5, 0.01, 0.01], [-l * 0.05, 0.002, s * h * 0.28]);
        k.addKit(leaf, [a.flank.x0 + L * (0.18 + 0.32 * i), a.flank.y + a.flank.h * 0.3, s * a.flank.z], [-s * 0.35, 0, 0]);
      }
    }
  }
  // light frame: thin trim rails around the deck
  const hx = a.deck.len * 0.45;
  const hz = a.deck.wid * 0.45;
  const y = a.deck.y + 0.003;
  const w = 0.012;
  k.line('trim', [a.deck.x - hx, -hz], [a.deck.x + hx * 0.7, -hz], w, y);
  k.line('trim', [a.deck.x - hx, hz], [a.deck.x + hx * 0.7, hz], w, y);
  k.line('trim', [a.deck.x - hx, -hz], [a.deck.x - hx, hz], w, y);
}

/** Heavy angular armour, raised prows and wing plates. */
function kestrel(k: Kit, a: Anchors): void {
  const L = a.flank.x1 - a.flank.x0;
  // raised prow wedge over the front of the hull, with a bright ridge line
  const pw = a.deck.wid * 0.42;
  const px = a.nose.x;
  const py = a.nose.y;
  const pl = clamp(a.deck.len * 0.3, 0.05, 0.16);
  k.hull('paint', [
    [px, py - 0.01, 0], [px - pl, py - 0.01, pw], [px - pl, py - 0.01, -pw],
    [px - pl, py + 0.07, pw * 0.7], [px - pl, py + 0.07, -pw * 0.7], [px - pl * 0.3, py + 0.035, 0],
  ]);
  k.limb('trim', [px - pl * 0.3, py + 0.038, 0], [px - pl, py + 0.075, 0], 0.007, 0.007, 4);
  if (a.fins) {
    const ww = Math.min(clamp(L * 0.42, 0.05, 0.15), a.reach);
    for (const s of SIDES) {
      const x = a.flank.x0 + L * 0.5;
      const wing = new Kit();
      const t = 0.008;
      const pts: V3[] = [];
      for (const e of [-t, t]) pts.push([L * 0.2, e, 0], [-L * 0.28, e, 0], [-L * 0.36, e, s * ww], [L * 0.02, e, s * ww * 0.8]);
      wing.hull('paint', pts);
      wing.line('trim', [L * 0.2, s * 0.004], [L * 0.02, s * ww * 0.8], 0.01, t + 0.002);
      k.addKit(wing, [x, a.flank.y + a.flank.h * 0.28, s * a.flank.z], [-s * 0.18, 0, 0]);
    }
  }
}

/** Faceted drones, broken hexagons and red signal slits. No crew cabins (see cab()). */
function choir(k: Kit, a: Anchors): void {
  const L = a.flank.x1 - a.flank.x0;
  if (a.fins) {
    for (const s of SIDES) {
      for (let i = 0; i < (a.scale < 0.6 ? 1 : 3); i += 1) {
        const x = a.flank.x0 + L * (0.12 + 0.17 * i);
        const h = 0.07 - i * 0.012;
        k.add('dark', new OctahedronGeometry(1, 0), [x, a.flank.y + a.flank.h * 0.35, s * (a.flank.z + 0.012)], [s * 0.5, 0, 0], [0.022, Math.min(h, a.reach * 1.4), 0.022]);
      }
    }
  }
  // red signal slits across the deck
  const w = a.deck.wid * 0.7;
  for (let i = 0; i < 2; i += 1) {
    const x = a.deck.x + a.deck.len * (0.14 - 0.22 * i);
    k.line('trim', [x, -w / 2], [x - 0.02, w / 2], 0.012, a.deck.y + 0.003);
  }
}
