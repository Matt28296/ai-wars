// Maglev track and span bridges, autotiled from the neighbour mask (layout.ts decides the piece; this file draws it).
// A track tile is arms from the tile centre to each connected side: a dark bed, sleepers and two glowing cyan rails. Corners curve as an
// arc about the shared corner. Where a branch meets a through line its rails stop at the through rail. A span puts the same track on a
// bridge deck with parapets and piers, so the rails continue across the water.
import { BIT, DIRS, popcount, type Dir, type TileInfo } from './layout';
import type { PartSet, PartOpts } from './geo';

const GAUGE = 0.15;
const RAIL_W = 0.034;
const RAIL_H = 0.03;
const BED_W = 0.5;
const DECK_W = 0.66;
const COL = { bed: 0x2a313a, sleeper: 0x3a424c, deck: 0x5d6874, parapet: 0x95a1ae, pier: 0x4b5560, rail: 0x72eaff, lamp: 0xffb347, stop: 0x3a434e };

interface Arm { d: Dir; /** distance from the tile centre where the arm starts, ends */ from: number; to: number; railFrom: number; through: boolean }

/** A box along arm `d` between distances `ts` and `te` from the tile centre, `lat` to the side of the centre line. */
function armBox(p: PartSet, d: Dir, ts: number, te: number, lat: number, width: number, yc: number, h: number, o: PartOpts): void {
  const len = te - ts;
  const mid = (ts + te) / 2;
  if (d === 'N') p.box(0.5 + lat, yc, 0.5 - mid, width, h, len, o);
  else if (d === 'S') p.box(0.5 + lat, yc, 0.5 + mid, width, h, len, o);
  else if (d === 'E') p.box(0.5 + mid, yc, 0.5 + lat, len, h, width, o);
  else p.box(0.5 - mid, yc, 0.5 + lat, len, h, width, o);
}

/** A ring strip as a chain of boxes: centre of curvature at the shared corner, `r` the centre line's radius. */
function arcBoxes(p: PartSet, mask: number, r: number, width: number, yc: number, h: number, o: PartOpts, steps = 6): void {
  const cx = mask & BIT.E ? 1 : 0;
  const cz = mask & BIT.S ? 1 : 0;
  const phi = Math.atan2(0.5 - cz, 0.5 - cx);
  const step = Math.PI / 2 / steps;
  for (let k = 0; k < steps; k++) {
    const th = phi - Math.PI / 4 + (k + 0.5) * step;
    const ry = Math.atan2(-Math.cos(th), -Math.sin(th));
    p.box(cx + r * Math.cos(th), yc, cz + r * Math.sin(th), 2 * r * Math.sin(step / 2) * 1.08, h, width, { ...o, ry });
  }
}

function arms(mask: number, kind: string): Arm[] {
  const out: Arm[] = [];
  if (kind === 'isolated') {
    for (const d of ['E', 'W'] as Dir[]) out.push({ d, from: 0, to: 0.32, railFrom: -0.0, through: false });
    return out;
  }
  const ns = (mask & (BIT.N | BIT.S)) === (BIT.N | BIT.S);
  const ew = (mask & (BIT.E | BIT.W)) === (BIT.E | BIT.W);
  const alongThrough = (d: Dir): boolean => (ns && (d === 'N' || d === 'S')) || (!ns && ew && (d === 'E' || d === 'W'));
  for (const d of DIRS) {
    if (!(mask & BIT[d])) continue;
    const through = alongThrough(d);
    out.push({
      d, from: kind === 'end' ? -0.24 : 0, to: 0.5,
      railFrom: through ? 0 : kind === 'end' ? -0.15 : GAUGE + RAIL_W / 2, through,
    });
  }
  return out;
}

export function addTrack(p: PartSet, t: TileInfo): void {
  if (!t.track) return;
  p.begin(t.index, t.x, t.y);
  const deck = t.terrain === 'span';
  const base = deck ? 0.05 : 0;
  const bedH = deck ? 0.004 : 0.02;
  const bedTop = base + bedH;
  const { mask, piece } = t.track;
  const rail: PartOpts = { color: COL.rail, bucket: 'glow', mult: 1.45 };

  const list = arms(mask, piece.kind);
  const curved = piece.kind === 'corner';

  // Deck, parapets and piers (spans only).
  if (deck) {
    if (curved) arcBoxes(p, mask, 0.5, DECK_W, 0.025, 0.05, { color: COL.deck });
    else {
      for (const a of list) armBox(p, a.d, a.from, a.to, 0, DECK_W, 0.025, 0.05, { color: COL.deck });
      armBox(p, 'N', -DECK_W / 2, DECK_W / 2, 0, DECK_W, 0.025, 0.05, { color: COL.deck });
    }
    if (piece.kind === 'straight') {
      const d = list[0].d;
      const ns = d === 'N' || d === 'S';
      for (const s of [-1, 1]) {
        p.box(0.5 + (ns ? s * 0.2 : 0), -0.075, 0.5 + (ns ? 0 : s * 0.2), 0.09, 0.15, 0.09, { color: COL.pier });
        for (const a of list) {
          armBox(p, a.d, 0, 0.5, s * 0.315, 0.026, 0.083, 0.066, { color: COL.parapet });
          armBox(p, a.d, 0, 0.5, s * 0.315, 0.012, 0.1185, 0.005, { color: COL.rail, bucket: 'glow', mult: 1.0 });
        }
      }
    }
  }

  if (curved) {
    arcBoxes(p, mask, 0.5, BED_W, base + bedH / 2, bedH, { color: COL.bed });
    arcBoxes(p, mask, 0.5 - GAUGE, RAIL_W, bedTop + RAIL_H / 2, RAIL_H, rail);
    arcBoxes(p, mask, 0.5 + GAUGE, RAIL_W, bedTop + RAIL_H / 2, RAIL_H, rail);
    // Sleepers radiate across the bed.
    const cx = mask & BIT.E ? 1 : 0;
    const cz = mask & BIT.S ? 1 : 0;
    const phi = Math.atan2(0.5 - cz, 0.5 - cx);
    for (let k = 0; k < 5; k++) {
      const th = phi - Math.PI / 4 + ((k + 0.5) / 5) * (Math.PI / 2);
      const ry = Math.atan2(-Math.cos(th), -Math.sin(th));
      p.box(cx + 0.5 * Math.cos(th), bedTop + 0.006, cz + 0.5 * Math.sin(th), 0.026, 0.012, 0.4, { color: COL.sleeper, ry });
    }
    return;
  }

  for (const a of list) {
    armBox(p, a.d, a.from, a.to, 0, BED_W, base + bedH / 2, bedH, { color: COL.bed });
    for (const s of [-1, 1]) armBox(p, a.d, a.railFrom, a.to, s * GAUGE, RAIL_W, bedTop + RAIL_H / 2, RAIL_H, rail);
    for (const tt of [0.1, 0.2, 0.3, 0.4]) {
      if (tt > a.to - 0.03) continue;
      armBox(p, a.d, tt - 0.013, tt + 0.013, 0, 0.4, bedTop + 0.006, 0.012, { color: COL.sleeper });
    }
    if (a.through && popcount(mask) <= 2) armBox(p, a.d, -0.013, 0.013, 0, 0.4, bedTop + 0.006, 0.012, { color: COL.sleeper });
  }
  // A cross of two lines or a tee: a sleeper square at the junction.
  if (piece.kind === 'tee' || piece.kind === 'cross') armBox(p, 'N', -0.2, 0.2, 0, 0.4, base + bedH / 2, bedH, { color: COL.bed });

  // Buffer stops close a dead end (and both ends of a lone stub).
  if (piece.kind === 'end') {
    armBox(p, list[0].d, -0.2, -0.15, 0, 0.36, bedTop + 0.03, 0.06, { color: COL.stop });
    armBox(p, list[0].d, -0.2, -0.15, 0, 0.03, bedTop + 0.072, 0.03, { color: COL.lamp, bucket: 'glow', mult: 1.4 });
  } else if (piece.kind === 'isolated') {
    for (const a of list) {
      armBox(p, a.d, 0.32, 0.37, 0, 0.36, bedTop + 0.03, 0.06, { color: COL.stop });
      armBox(p, a.d, 0.32, 0.37, 0, 0.03, bedTop + 0.072, 0.03, { color: COL.lamp, bucket: 'glow', mult: 1.4 });
    }
  }
}
