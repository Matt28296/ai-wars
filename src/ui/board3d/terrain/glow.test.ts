// ORDER G8a, part 2: the maglev rails and the other emissive terrain must read as lit strips and tight glows under the STAGE's bloom, not as a
// wide halo. The numbers here come from the stage's own source and from the geometry the kit really builds; the halo itself was measured in the
// real stage (docs in track.ts and index.ts), because bloom is a GPU pass that node cannot run.
import { readFileSync } from 'node:fs';
import { Color, type BufferAttribute, type BufferGeometry, type Mesh, type Object3D } from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FACTION_ACCENT } from '../palette';
import { BEACON_MAX_LUMA, GLOW_PULSE, createTerrainKit } from './index';
import { PartSet } from './geo';
import { FACTIONS, boardInput } from './testing';

/** The stage's bloom, read from the stage's own source so that a change there fails this file instead of silently re-opening the halo. */
function stageBloom(): { strength: number; radius: number; threshold: number } {
  const src = readFileSync(new URL('../stage/runtime.ts', import.meta.url), 'utf8');
  const m = /const BLOOM = \{ strength: ([0-9.]+), radius: ([0-9.]+), threshold: ([0-9.]+) \}/.exec(src);
  if (!m) throw new Error('stage/runtime.ts no longer has the BLOOM line this test reads: re-measure the rails and beacons, then update this reader');
  return { strength: Number(m[1]), radius: Number(m[2]), threshold: Number(m[3]) };
}

const glowOf = (root: Object3D): BufferGeometry | null => {
  let g: BufferGeometry | null = null;
  root.traverse((o) => { if ((o as Mesh).isMesh && o.name === 'terrain:glow') g = (o as Mesh).geometry; });
  return g;
};
/** The luminance the bloom's high-pass sees (Rec. 709 on the linear HDR colour) of one vertex of the glow bucket. */
const luma = (c: BufferAttribute, i: number): number => 0.2126 * c.getX(i) + 0.7152 * c.getY(i) + 0.0722 * c.getZ(i);
const lumas = (g: BufferGeometry): number[] => {
  const c = g.getAttribute('color') as BufferAttribute;
  return Array.from({ length: c.count }, (_, i) => luma(c, i));
};

describe('the stage bloom this file measures against', () => {
  it('is read from the stage source and is the one the order names (strength 0.6, radius 0.4, threshold 0.9)', () => {
    expect(stageBloom()).toEqual({ strength: 0.6, radius: 0.4, threshold: 0.9 });
  });
});

describe('maglev rails are lit strips under the threshold, with a tight glow beside them', () => {
  // Straights, a corner, a tee, a cross, a dead end, a lone tile and a span: every piece the rails are drawn on.
  const TRACK = ['.=....=.', '.====.=.', '.=..=.==', '.=..=.=.', '.==.=..=', '..r#r...', '..r=r...'];
  let kit: ReturnType<typeof createTerrainKit>;
  beforeAll(() => { kit = createTerrainKit(boardInput(TRACK)); });
  afterAll(() => { kit.dispose(); });

  it('no glow on a track-only board is bright enough to pass the bloom threshold, even at the top of its glow pulse', () => {
    const { threshold } = stageBloom();
    const g = glowOf(kit.group)!;
    const all = lumas(g);
    const top = Math.max(...all) * (1 + GLOW_PULSE);
    expect(all.length).toBeGreaterThan(1000); // the board really has rails (the check is not vacuous)
    expect(top, 'brightest rail pixel at the top of the pulse').toBeLessThan(threshold);
    // ... with room to spare (specular and a unit of rounding), and still bright: lit strips, not dim ones.
    expect(top).toBeLessThan(threshold * 0.95);
    expect(Math.max(...all)).toBeGreaterThan(0.6);
  });

  it('the rail the order complained about FAILS this check: the old body (1.45 on cyan) is over the threshold', () => {
    const { threshold } = stageBloom();
    const old = new PartSet().begin(0, 0, 0);
    old.box(0.5, 0.03, 0.5, 0.034, 0.03, 1, { color: 0x72eaff, bucket: 'glow', mult: 1.45 });
    const g = old.finish().glow!;
    const top = Math.max(...lumas(g)) * (1 + GLOW_PULSE);
    expect(top).toBeGreaterThan(threshold);
  });

  it('the glow reaches 0.05 tile past a rail on each side, far under the 0.15 the order allows', () => {
    // One straight north-south tile at the middle of a column: the rail's bright vertices against everything the glow draws across it.
    const one = createTerrainKit(boardInput(['.=.', '.=.', '.=.']));
    const g = glowOf(one.group)!;
    const pos = g.getAttribute('position') as BufferAttribute;
    const col = g.getAttribute('color') as BufferAttribute;
    const inTile = (i: number): boolean => Math.floor(pos.getX(i)) === 1 && Math.floor(pos.getZ(i)) === 1;
    let allMin = Infinity; let allMax = -Infinity; let railMin = Infinity; let railMax = -Infinity;
    const railLuma = Math.max(...Array.from({ length: pos.count }, (_, i) => (inTile(i) ? luma(col, i) : 0)));
    expect(railLuma).toBeGreaterThan(0.6);
    for (let i = 0; i < pos.count; i++) {
      if (!inTile(i)) continue;
      const x = pos.getX(i) - 1;
      allMin = Math.min(allMin, x); allMax = Math.max(allMax, x);
      if (luma(col, i) >= railLuma * 0.99) { railMin = Math.min(railMin, x); railMax = Math.max(railMax, x); }
    }
    // The rails are the brightest strips; the glow is what lies beyond them. Two rails: the outer edges are the extremes.
    const reachOut = Math.max(railMin - allMin, allMax - railMax);
    expect(reachOut, 'glow past the outer rail edge, in tiles').toBeGreaterThan(0.03);
    expect(reachOut).toBeLessThanOrEqual(0.15);
    expect(reachOut).toBeCloseTo(0.05, 3);
    one.dispose();
  });
});

describe('the other emissive terrain', () => {
  it('glass cracks glow a faint red, nowhere near the bloom threshold', () => {
    const { threshold } = stageBloom();
    const k = createTerrainKit(boardInput(['ggg', 'ggg', 'ggg']));
    const g = glowOf(k.group)!;
    const top = Math.max(...lumas(g)) * (1 + GLOW_PULSE);
    expect(g.getAttribute('color').count).toBeGreaterThan(30); // there are cracks
    expect(top).toBeLessThan(threshold * 0.25);
    // Faint and red: the red channel dominates every vertex.
    const c = g.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < c.count; i++) { expect(c.getX(i)).toBeGreaterThan(c.getY(i) * 5); }
    k.dispose();
  });

  it('no owned beacon in any faction is brighter than the cap, and the cap leaves the bright ones still glowing steadily', () => {
    const { threshold } = stageBloom();
    const types = ['C', 'F', 'A', 'D', 'U', 'H'];
    let brightest = 0;
    for (const [f] of FACTIONS.entries()) {
      for (const t of types) {
        const k = createTerrainKit(boardInput(['~~~', `~${t}~`, '~~~'], { '1,1': f }));
        // Beacon is the accent part of the glow bucket; every other glow part on a property alone (door strips, glass lens) is dimmer.
        const peak = Math.max(...lumas(glowOf(k.group)!));
        expect(peak, `${FACTIONS[f]} ${t}`).toBeLessThanOrEqual(BEACON_MAX_LUMA + 1e-6);
        brightest = Math.max(brightest, peak);
        k.dispose();
      }
    }
    // The brightest ones sit exactly at the cap (it bites), and at the bottom of the pulse they still pass the threshold: a steady glow, no flicker.
    expect(brightest).toBeCloseTo(BEACON_MAX_LUMA, 6);
    expect(brightest * (1 - GLOW_PULSE)).toBeGreaterThan(threshold);
  });

  it('the cap cuts only what is too bright, by multiplier: a dim accent keeps its full uncapped brightness (the Choir red spire)', () => {
    const k = createTerrainKit(boardInput(['~~~', '~H~', '~~~'], { '1,1': 4 }));
    const accent = new Color(FACTION_ACCENT.choir);
    const spireMult = 3.2; // buildings.ts: the spire's beacon
    const want = (0.2126 * accent.r + 0.7152 * accent.g + 0.0722 * accent.b) * spireMult;
    expect(want).toBeLessThan(BEACON_MAX_LUMA); // the Choir's red is dark in luminance, so it is not capped
    const peak = Math.max(...lumas(glowOf(k.group)!));
    expect(peak).toBeCloseTo(want, 6);
    k.dispose();
    // And the brightest accent (Kestrel yellow) on the same spire is cut down to the cap, not left at its full 2.2.
    const y = createTerrainKit(boardInput(['~~~', '~H~', '~~~'], { '1,1': 3 }));
    const yellow = new Color(FACTION_ACCENT.kestrel);
    expect((0.2126 * yellow.r + 0.7152 * yellow.g + 0.0722 * yellow.b) * spireMult).toBeGreaterThan(2);
    expect(Math.max(...lumas(glowOf(y.group)!))).toBeCloseTo(BEACON_MAX_LUMA, 6);
    y.dispose();
  });

  it('an unowned beacon stays a dull lens, far under the cap', () => {
    const k = createTerrainKit(boardInput(['~~~', '~H~', '~~~']));
    expect(Math.max(...lumas(glowOf(k.group)!))).toBeLessThan(0.7);
    k.dispose();
  });
});
