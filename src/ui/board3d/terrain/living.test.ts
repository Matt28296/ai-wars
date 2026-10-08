// ORDER G11, the living board: cloud shadows, wind on the grass and caustics in the shallows. Node only (no GPU): the shaders are checked as text
// against the REAL three.js templates, and by a CPU mirror (living.ts) whose arithmetic is the shader's. The mirror and the GLSL were also run
// against each other on a real GL context (gallery-terrain.html?probe=living, errors under 0.005 of the 0..1 range, in NOTES of the receipt).
// Every check that matters has a planted-wrong twin: a known-bad input the same check must refuse.
import { BufferAttribute, Mesh, ShaderLib, type BufferGeometry, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../content/maps';
import { createTerrain, createTerrainKit } from './index';
import { analyseBoard } from './layout';
import { planTrees } from './flora';
import {
  CAUSTIC_AMP, CAUSTIC_GLSL, CLOUD_DRIFT, CLOUD_GLSL, CLOUD_HI, CLOUD_LO, CLOUD_MAX, CLOUD_SPEED, CLOUD_WAVES, GUST_GLSL, GUST_SPEED, GUST_WAVES, LIVE_CEIL,
  LIVE_FLOOR, LiveClock, SWAY_BIAS, SWAY_CROSS, SWAY_FLUTTER, SWAY_GLSL, SWAY_LEAN, WIND_AMP, WIND_DIR, causticWeb, cloudCover, cloudDarkening, gust, livingMultiplier, shallowWeight, swayPush, swayToLocal,
  waveField,
} from './living';
import { fogGrade, gradeThenLive, swap } from './shading';
import { FACTIONS, boardInput, stressRows } from './testing';

const TEMPLATE: Record<string, { vertexShader: string; fragmentShader: string }> = {
  MeshStandardMaterial: ShaderLib.physical,
  MeshPhysicalMaterial: ShaderLib.physical,
  MeshLambertMaterial: ShaderLib.lambert,
  MeshDepthMaterial: ShaderLib.depth,
};
const run = (m: Material, vertexShader: string, fragmentShader: string) => {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader, fragmentShader };
  m.onBeforeCompile(shader as never, {} as never);
  return shader;
};
const patched = (m: Material) => run(m, TEMPLATE[m.type].vertexShader, TEMPLATE[m.type].fragmentShader);

/** Materials that get the living multiplier, and the kind of board feature each one draws. */
const LIVE_MATERIALS = ['ground', 'solid', 'glossy', 'windows', 'decal', 'tree', 'water'] as const;

describe('shader patches: the living multiplier comes AFTER the fog grade, and every anchor is still found', () => {
  const kit = createTerrainKit(boardInput(['.f~', 'sC=', '^g#']));
  const mats = kit.debug.materials();

  /** True when the grade line comes first, the living line second, and both come before three's own output line. */
  const livingAfterGrade = (fs: string): boolean => {
    const grade = fs.indexOf('outgoingLight = trnGrade( outgoingLight, vTrnXZ );');
    const live = fs.indexOf('outgoingLight *= trnLive(');
    const out = fs.indexOf('#include <opaque_fragment>');
    return grade >= 0 && live > grade && out > live;
  };

  it('every lit terrain material (and only those: glow is a light, not a surface) is patched with the multiplier, after the grade', () => {
    for (const name of LIVE_MATERIALS) {
      const fs = patched(mats[name]).fragmentShader;
      expect(fs, name).toContain('trnLive(');
      expect(livingAfterGrade(fs), `${name}: grade, then living, then output`).toBe(true);
    }
    // Emissive parts (rails, beacons, cracks) are lights: a cloud does not dim them, and the grade alone applies.
    const glow = patched(mats.glow).fragmentShader;
    expect(glow).not.toContain('trnLive');
    expect(glow).toContain('outgoingLight = trnGrade( outgoingLight, vTrnXZ )');
  });

  it('a planted wrong order (living multiplier BEFORE the grade) is caught by the same check', () => {
    const fs = patched(mats.ground).fragmentShader;
    const grade = 'outgoingLight = trnGrade( outgoingLight, vTrnXZ );';
    const live = fs.slice(fs.indexOf('outgoingLight *= trnLive('), fs.indexOf('#include <opaque_fragment>'));
    const swapped = fs.replace(grade, '@@GRADE@@').replace(live, '').replace('@@GRADE@@', `${live}${grade}\n`);
    expect(swapped).toContain('trnLive(');
    expect(livingAfterGrade(swapped)).toBe(false);
    expect(livingAfterGrade(fs)).toBe(true);
  });

  it('the grass gust, the cloud field and the sway are ONE source: the strings in the shaders are the strings living.ts generates', () => {
    const groundFs = patched(mats.ground).fragmentShader;
    const treeVs = patched(mats.tree).vertexShader;
    const treeDepthVs = patched(mats.treeDepth).vertexShader;
    expect(groundFs).toContain(GUST_GLSL);
    expect(treeVs).toContain(GUST_GLSL);
    expect(treeDepthVs).toContain(GUST_GLSL);
    // The shadow of a tree sways exactly as the tree does (one snippet in both), and both read the gust AT the tree.
    expect(treeVs).toContain(SWAY_GLSL);
    expect(treeDepthVs).toContain(SWAY_GLSL);
    expect(SWAY_GLSL).toContain('trnGust( swXZ )');
    expect(SWAY_GLSL).toContain('swH'); // the sway keeps its height variable: the foot stays planted
    // The world push is turned into the instance's frame exactly as swayToLocal does (the CPU mirror the test above runs), and the amplitudes are the table's.
    expect(SWAY_GLSL).toContain('transformed.x += ( swC0.x * swW.x + swC0.z * swW.y ) / dot( swC0, swC0 );');
    expect(SWAY_GLSL).toContain('transformed.z += ( swC2.x * swW.x + swC2.z * swW.y ) / dot( swC2, swC2 );');
    expect(SWAY_GLSL).toContain(`( swG * ${SWAY_LEAN.toFixed(5)} + ${SWAY_BIAS.toFixed(5)} )`);
    expect(SWAY_GLSL).toContain(`${SWAY_CROSS.toFixed(5)} * swH * swH`);
    expect(SWAY_GLSL).toContain(`${SWAY_FLUTTER.toFixed(5)} * swH`);
    for (const name of LIVE_MATERIALS) expect(patched(mats[name]).fragmentShader, name).toContain(CLOUD_GLSL);
    expect(patched(mats.water).fragmentShader).toContain(CAUSTIC_GLSL);
    // Every wave constant of the tables is in the GLSL, to the five decimals the CPU mirror uses.
    for (const w of [...CLOUD_WAVES, ...GUST_WAVES]) {
      const text = CLOUD_WAVES.includes(w) ? CLOUD_GLSL : GUST_GLSL;
      expect(text).toContain(`${w.amp.toFixed(5)} * sin( dot( q, vec2( ${w.kx.toFixed(5)}, ${w.kz.toFixed(5)} ) ) + ${w.phase.toFixed(5)} )`);
    }
    // The numbers the order names are the numbers the shader runs.
    expect(CLOUD_GLSL).toContain(`${CLOUD_MAX.toFixed(5)} * trnCloud( xz ) * ( 1.0 - uStorm )`);
    expect(CLOUD_GLSL).toContain(`clamp( m, ${LIVE_FLOOR.toFixed(5)}, ${LIVE_CEIL.toFixed(5)} )`);
  });

  it('every patch shares the one living clock, and the clock the kit advances is the one the shaders read', () => {
    const k = createTerrainKit(boardInput(['.f~', 'sC=']));
    const shader = patched(k.debug.materials().tree);
    const treeDepth = patched(k.debug.materials().treeDepth);
    k.update(0.016, 12.5);
    expect(shader.uniforms.uLive.value).toBe(12.5);
    expect(treeDepth.uniforms.uLive.value).toBe(12.5);
    k.setMotion(false);
    k.update(0.016, 40);
    expect(shader.uniforms.uLive.value).toBe(12.5); // held, and held in the shader's own uniform object
    k.dispose();
  });

  it('a missing anchor is still refused loudly, in the living materials too', () => {
    const cut = (m: Material, side: 'vertexShader' | 'fragmentShader', anchor: string) => {
      const tpl = TEMPLATE[m.type];
      const src = { vertexShader: tpl.vertexShader, fragmentShader: tpl.fragmentShader };
      src[side] = src[side].replace(anchor, '');
      return () => run(m, src.vertexShader, src.fragmentShader);
    };
    for (const name of ['ground', 'tree', 'water', 'solid'] as const) {
      expect(cut(mats[name], 'vertexShader', '#include <begin_vertex>'), `${name} begin_vertex`).toThrow(/begin_vertex/);
      expect(cut(mats[name], 'fragmentShader', '#include <opaque_fragment>'), `${name} opaque_fragment`).toThrow(/opaque_fragment/);
      expect(cut(mats[name], 'fragmentShader', '#include <common>'), `${name} common`).toThrow(/common/);
    }
    expect(cut(mats.water, 'fragmentShader', '#include <color_fragment>'), 'water color_fragment').toThrow(/color_fragment/);
    expect(cut(mats.treeDepth, 'vertexShader', '#include <begin_vertex>'), 'tree shadow').toThrow(/begin_vertex/);
    expect(() => swap('no anchor here', '#include <begin_vertex>', 'x', 'test')).toThrow(/not found/);
  });
});

describe('cloud shadows: the CPU mirror', () => {
  const grid: [number, number][] = [];
  for (let z = 0; z < 19; z += 0.5) for (let x = 0; x < 25; x += 0.5) grid.push([x, z]);

  it('is a pure function of (position, time): the same inputs give the same number, in any order, on every call', () => {
    const probes: [number, number, number][] = [];
    for (let i = 0; i < 300; i++) probes.push([(i * 7.31) % 25, (i * 3.77) % 19, i * 1.913]);
    const first = probes.map(([x, z, t]) => cloudDarkening(x, z, t));
    const again = [...probes].reverse().map(([x, z, t]) => cloudDarkening(x, z, t)).reverse();
    expect(again).toEqual(first);
    expect(new Set(first.map((v) => v.toFixed(6))).size).toBeGreaterThan(40); // not a constant: the check is not vacuous
  });

  it('never darkens more than 15%, reaches that in the heart of a shadow, and leaves clear sky between', () => {
    let max = 0; let min = 1; let over = 0; let n = 0;
    for (let t = 0; t < 600; t += 7) {
      for (const [x, z] of grid) {
        const d = cloudDarkening(x, z, t);
        max = Math.max(max, d); min = Math.min(min, d); n++;
        if (d > CLOUD_MAX / 2) over++;
      }
    }
    expect(CLOUD_MAX).toBe(0.15);
    expect(max).toBeLessThanOrEqual(0.15 + 1e-12);
    expect(max).toBeGreaterThan(0.149); // the shadows really reach the cap
    expect(min).toBe(0);
    // Patches, not a blanket: a fraction of the board is in at least half shadow at any time.
    expect(over / n).toBeGreaterThan(0.12);
    expect(over / n).toBeLessThan(0.5);
  });

  it('shadows are 2 to 5 tiles across (mean and median length of a run of heavy shadow along a row or a column)', () => {
    const lens: number[] = [];
    const step = 0.05;
    for (const t of [0, 13, 29, 47, 71, 101]) {
      for (const dir of ['x', 'z'] as const) {
        for (let line = 0; line < 19; line++) {
          let cur = 0;
          for (let s = 0; s < 25; s += step) {
            const dark = (dir === 'x' ? cloudCover(s, line + 0.5, t) : cloudCover(line + 0.5, s, t)) > 0.5;
            if (dark) cur += step;
            else { if (cur > 0) lens.push(cur); cur = 0; }
          }
        }
      }
    }
    lens.sort((a, b) => a - b);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    expect(lens.length).toBeGreaterThan(200);
    expect(mean).toBeGreaterThan(2);
    expect(mean).toBeLessThan(5);
    expect(lens[Math.floor(lens.length / 2)]).toBeGreaterThan(2);
    expect(lens[Math.floor(lens.length / 2)]).toBeLessThan(5);
  });

  /** The translation (tiles) that best maps the field at time 0 onto the field at time `dt`: brute force, on a 0.2-tile lattice of shifts. */
  const bestShift = (field: (x: number, z: number, t: number) => number, dt: number): [number, number] => {
    let bestErr = Infinity; let best: [number, number] = [0, 0];
    for (let sx = -4; sx <= 4.001; sx += 0.2) {
      for (let sz = -4; sz <= 4.001; sz += 0.2) {
        let e = 0;
        for (let z = 4; z < 16; z += 0.75) for (let x = 4; x < 16; x += 0.75) e += (field(x, z, dt) - field(x - sx, z - sz, 0)) ** 2;
        if (e < bestErr) { bestErr = e; best = [sx, sz]; }
      }
    }
    return best;
  };

  it('drifts along the wind from the north-west (toward the south-east) at CLOUD_SPEED, found by matching the field against itself', () => {
    const dt = 10;
    const along = CLOUD_SPEED * dt * Math.SQRT1_2; // computed here from the order's numbers, not read from the module's drift vector
    const [sx, sz] = bestShift(cloudCover, dt);
    expect(sx).toBeGreaterThan(0); // east
    expect(sz).toBeGreaterThan(0); // south
    expect(Math.abs(sx - along)).toBeLessThan(0.25);
    expect(Math.abs(sz - along)).toBeLessThan(0.25);
  });

  it('a planted wrong wind (from the north-east) is caught by the same measurement', () => {
    const wrong = (x: number, z: number, t: number): number => {
      const s = waveField(CLOUD_WAVES, [CLOUD_DRIFT[0], -CLOUD_DRIFT[1]], x, z, t);
      return Math.min(1, Math.max(0, (s - CLOUD_LO) / (CLOUD_HI - CLOUD_LO)));
    };
    const [sx, sz] = bestShift(wrong, 10);
    expect(sx > 0 && sz > 0).toBe(false); // it drifts south-WEST: not the wind the order names
    const [rx, rz] = bestShift(cloudCover, 10);
    expect(rx > 0 && rz > 0).toBe(true);
  });

  it('is exact advection: moving with the wind for dt seconds lands on the same value, whatever the position and time', () => {
    for (let i = 0; i < 200; i++) {
      const x = (i * 5.17) % 25; const z = (i * 2.39) % 19; const t = (i * 3.1) % 90; const dt = (i * 0.77) % 30;
      const d = CLOUD_SPEED * dt * Math.SQRT1_2;
      expect(cloudCover(x + d, z + d, t + dt)).toBeCloseTo(cloudCover(x, z, t), 3);
    }
    // And standing still the value changes: the shadow really moves past a fixed point.
    expect(Math.abs(cloudCover(10, 8, 0) - cloudCover(10, 8, 12))).toBeGreaterThan(0.05);
  });

  it('the ion storm turns the shadows off: nothing at storm 1, a proportional fade on the way', () => {
    let seen = 0;
    for (const [x, z] of grid) {
      const clear = cloudDarkening(x, z, 31, 0);
      expect(cloudDarkening(x, z, 31, 1)).toBe(0);
      expect(cloudDarkening(x, z, 31, 0.5)).toBeCloseTo(clear * 0.5, 12);
      if (clear > 0.1) seen++;
    }
    expect(seen).toBeGreaterThan(20); // there WERE shadows to turn off
  });
});

describe('the ion storm in the kit: shadows fade out as the storm grade fades in', () => {
  it('the kit reports no cloud shadow in a full storm anywhere on the board, and gets it back when the storm clears', () => {
    const kit = createTerrainKit(boardInput(stressRows(25, 19)));
    kit.update(0.016, 31);
    const pts: [number, number][] = [];
    for (let z = 0; z < 19; z++) for (let x = 0; x < 25; x++) pts.push([x + 0.5, z + 0.5]);
    const shadowed = pts.filter(([x, z]) => kit.debug.cloudAt(x, z) > 0.1);
    expect(shadowed.length).toBeGreaterThan(20);
    kit.setWeather('ionstorm');
    kit.update(0.1, 31.1);
    const mid = shadowed.map(([x, z]) => kit.debug.cloudAt(x, z));
    kit.update(5, 36.1);
    expect(kit.debug.storm()).toBeGreaterThan(0.99);
    for (const [x, z] of pts) expect(kit.debug.cloudAt(x, z)).toBeLessThan(0.15 * 0.01 + 1e-9);
    shadowed.forEach(([x, z], i) => expect(mid[i]).toBeLessThan(cloudDarkening(x, z, 31.1, 0) - 1e-6)); // fading, not a switch
    kit.setWeather('clear');
    kit.update(5, 41.1);
    expect(pts.some(([x, z]) => kit.debug.cloudAt(x, z) > 0.1)).toBe(true);
    kit.dispose();
    // A board built under a storm starts without shadows.
    const stormy = createTerrainKit(boardInput(stressRows(25, 19), {}, 'ionstorm'));
    stormy.update(0.016, 31);
    for (const [x, z] of pts) expect(stormy.debug.cloudAt(x, z)).toBe(0);
    stormy.dispose();
    // The shader's own gate is the same factor.
    expect(CLOUD_GLSL).toContain('( 1.0 - uStorm )');
  });
});

describe('reduced motion: setMotion(false) freezes the board and setMotion(true) carries on from where it stopped', () => {
  /** A clock freezes if its time stays put across stage times while off and resumes without a jump. */
  const freezes = (c: { setMotion(on: boolean): void; advance(t: number): number }): boolean => {
    c.advance(10);
    c.setMotion(false);
    const a = c.advance(11); const b = c.advance(25); const d = c.advance(26);
    c.setMotion(true);
    const resumed = c.advance(27); // frozen at stage time 10 -> live 10; stage ran on to 26; at 27 the live clock reads 11
    return a === 10 && b === 10 && d === 10 && Math.abs(resumed - 11) < 1e-12;
  };

  it('the clock holds while motion is off and resumes with no jump; a clock that ignores the switch fails the same check', () => {
    expect(freezes(new LiveClock())).toBe(true);
    const broken = { setMotion: () => undefined, advance: (t: number) => t };
    expect(freezes(broken)).toBe(false);
    const c = new LiveClock();
    expect(c.motion).toBe(true);
    expect(c.advance(Number.NaN)).toBe(0); // a bad time is ignored, never poisons the clock
    expect(c.advance(5)).toBe(5);
    expect(c.advance(Number.POSITIVE_INFINITY)).toBe(5);
  });

  it('a kit with motion off draws the same cloud field at any stage time, and keeps the water on the stage clock as before', () => {
    const kit = createTerrainKit(boardInput(stressRows(25, 19)));
    // A point where the shadow is moving at t = 10 (so a frozen field is not a field that never changes anywhere).
    let probe: [number, number] | null = null;
    for (let z = 0.5; z < 19 && !probe; z += 1) for (let x = 0.5; x < 25 && !probe; x += 1) if (Math.abs(cloudDarkening(x, z, 10) - cloudDarkening(x, z, 25)) > 0.05) probe = [x, z];
    expect(probe).not.toBeNull();
    const [px, pz] = probe!;
    kit.update(0.016, 10);
    expect(kit.debug.living()).toEqual({ time: 10, motion: true });
    const frozen = kit.debug.cloudAt(px, pz);
    const gustAt10 = kit.debug.gustAt(px, pz);
    kit.setMotion(false);
    kit.update(0.016, 11);
    kit.update(0.016, 25);
    expect(kit.debug.living()).toEqual({ time: 10, motion: false });
    expect(kit.debug.uniforms().live).toBe(10);
    expect(kit.debug.cloudAt(px, pz)).toBe(frozen);
    expect(kit.debug.gustAt(px, pz)).toBe(gustAt10);
    expect(kit.debug.uniforms().time).toBe(25); // the waves of the water are not part of this switch
    expect(cloudDarkening(px, pz, 25)).not.toBe(frozen); // with motion on, stage time 25 would have drawn something else
    kit.setMotion(true);
    kit.update(0.016, 26);
    expect(kit.debug.living()).toEqual({ time: 11, motion: true });
    expect(kit.debug.cloudAt(px, pz)).toBeCloseTo(cloudDarkening(px, pz, 11), 12);
    kit.dispose();
  });

  it('motion starts on, off before the first frame holds the board at its first picture, and the contract entry point carries setMotion', () => {
    const kit = createTerrainKit(boardInput(['..', '..']));
    expect(kit.debug.living().motion).toBe(true);
    kit.dispose();
    const still = createTerrainKit(boardInput(['..', '..']));
    still.setMotion(false);
    still.update(0.016, 500);
    still.update(0.016, 900);
    expect(still.debug.living()).toEqual({ time: 0, motion: false });
    still.dispose();
    const view = createTerrain(boardInput(['.f', '~C'])) as unknown as { setMotion?: unknown };
    expect(typeof view.setMotion).toBe('function'); // what the stage tests for, like the effects kit's setReducedMotion
    (view as unknown as { dispose(): void }).dispose();
  });
});

describe('wind on the grass and in the trees', () => {
  it('the gust is one field: a function of (position, time), inside -1..1, and it travels with the wind at GUST_SPEED', () => {
    let max = 0;
    for (let i = 0; i < 400; i++) {
      const x = (i * 5.17) % 25; const z = (i * 2.39) % 19; const t = (i * 1.7) % 90;
      expect(gust(x, z, t)).toBe(gust(x, z, t));
      max = Math.max(max, Math.abs(gust(x, z, t)));
      const dt = (i * 0.37) % 9; const d = GUST_SPEED * dt * Math.SQRT1_2;
      expect(gust(x + d, z + d, t + dt)).toBeCloseTo(gust(x, z, t), 3); // the front that is here now is there, dt seconds later
    }
    expect(max).toBeLessThanOrEqual(1 + 1e-12);
    expect(max).toBeGreaterThan(0.8); // real gusts, not a whisper
    // Gusts are faster than clouds, and both go the same way.
    expect(GUST_SPEED).toBeGreaterThan(CLOUD_SPEED * 2);
    expect(WIND_DIR[0]).toBeGreaterThan(0);
    expect(WIND_DIR[1]).toBeGreaterThan(0);
    expect(Math.hypot(WIND_DIR[0], WIND_DIR[1])).toBeCloseTo(1, 4);
  });

  it('the brightness it gives grass is a few percent, up or down, and the sum with a shadow stays inside the cap', () => {
    expect(WIND_AMP).toBeLessThanOrEqual(0.05);
    expect(WIND_AMP).toBeGreaterThanOrEqual(0.02);
    expect(livingMultiplier(0, 1, 0)).toBeCloseTo(1 + WIND_AMP, 12);
    expect(livingMultiplier(0, -1, 0)).toBeCloseTo(1 - WIND_AMP, 12);
    expect(livingMultiplier(0, 0, 0)).toBe(1);
  });

  it('the combined multiplier never darkens more than 15%: a full shadow plus a lull is clamped, and an uncapped product would not be', () => {
    const uncapped = (1 - CLOUD_MAX) * (1 - WIND_AMP);
    expect(uncapped).toBeLessThan(LIVE_FLOOR); // the cap is doing work: without it the product goes under 85%
    expect(livingMultiplier(CLOUD_MAX, -1, 0)).toBe(LIVE_FLOOR);
    expect(LIVE_FLOOR).toBeCloseTo(0.85, 12);
    // Over a dense sweep of every input it can take, nothing leaves [FLOOR, CEIL]; and the floor is met, so the sweep is not vacuous.
    let lo = 9; let hi = 0;
    for (let d = 0; d <= CLOUD_MAX + 1e-9; d += 0.015) {
      for (let g = -1; g <= 1.001; g += 0.25) {
        for (let c = 0; c <= 1.001; c += 0.25) { const m = livingMultiplier(d, g, c); lo = Math.min(lo, m); hi = Math.max(hi, m); }
      }
    }
    expect(lo).toBeGreaterThanOrEqual(LIVE_FLOOR - 1e-12);
    expect(hi).toBeLessThanOrEqual(LIVE_CEIL + 1e-12);
    expect(lo).toBeCloseTo(LIVE_FLOOR, 12);
    // Even the brightest a hidden tile gets stays far below the darkest a seen tile gets: 45% x ceiling against the floor.
    expect(LIVE_FLOOR / (0.45 * LIVE_CEIL)).toBeGreaterThan(1.4);
  });

  it('trees lean WITH the wind whatever heading they were planted at: the world push survives the trip into each tree\'s own frame', () => {
    const board = analyseBoard(boardInput(['ffffff', 'ffffff', 'ffffff']));
    const trees = planTrees(board);
    expect(trees.length).toBeGreaterThan(40);
    const yaws = new Set(trees.map((t) => Math.atan2(t.matrix.elements[2], t.matrix.elements[0]).toFixed(1)));
    expect(yaws.size).toBeGreaterThan(8); // the trees really do face every way
    const world: [number, number] = swayPush(0.8, 12.3, 4.2, 1.2);
    const lands = (toLocal: (c0: [number, number, number], c2: [number, number, number], w: [number, number]) => [number, number]): boolean => {
      for (const t of trees) {
        const e = t.matrix.elements;
        const c0: [number, number, number] = [e[0], e[1], e[2]];
        const c2: [number, number, number] = [e[8], e[9], e[10]];
        const [lx, lz] = toLocal(c0, c2, world);
        // What that local push does to the tree in the world: the instance matrix's xz part applied to it.
        const wx = lx * c0[0] + lz * c2[0];
        const wz = lx * c0[2] + lz * c2[2];
        if (Math.abs(wx - world[0]) > 1e-9 || Math.abs(wz - world[1]) > 1e-9) return false;
      }
      return true;
    };
    expect(lands(swayToLocal)).toBe(true);
    // Planted wrong: the push applied in local space unchanged (what the shader did before): trees spun away from north-west go the wrong way.
    expect(lands((_c0, _c2, w) => [w[0], w[1]])).toBe(false);
  });

  it('the push is small and the foot stays planted; a gust pushes along the wind, and the same gust at the same tree is the same push', () => {
    expect(swayPush(1, 3, 1, 0)).toEqual([0, 0]); // at the foot of the tree nothing moves
    let big = 0;
    for (let i = 0; i < 500; i++) {
      const [x, z] = swayPush(Math.sin(i), i * 0.37, i * 1.3, 1.4);
      big = Math.max(big, Math.hypot(x, z));
    }
    expect(big).toBeLessThan(0.1); // a tenth of a tile at the very top of the crown, at worst
    expect(big).toBeGreaterThan(0.02);
    const a = swayPush(1, 0, 0, 1); const b = swayPush(-1, 0, 0, 1);
    const along = (p: [number, number]): number => p[0] * WIND_DIR[0] + p[1] * WIND_DIR[1];
    expect(along(a)).toBeGreaterThan(along(b)); // a gust leans the tree further downwind than a lull does
    expect(swayPush(0.3, 7, 2, 1)).toEqual(swayPush(0.3, 7, 2, 1));
  });
});

describe('caustics in the shallows', () => {
  it('the web is a pure 0..1 function of (position, living time), and it moves', () => {
    let max = 0; let sum = 0; let n = 0;
    for (let z = 0; z < 6; z += 0.05) for (let x = 0; x < 6; x += 0.05) { const c = causticWeb(x, z, 3.3); max = Math.max(max, c); sum += c; n++; expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    expect(max).toBe(1); // bright web lines exist
    expect(sum / n).toBeGreaterThan(0.05); // and they are not rare specks ...
    expect(sum / n).toBeLessThan(0.45); // ... nor a blanket
    expect(causticWeb(2.31, 4.07, 5)).toBe(causticWeb(2.31, 4.07, 5));
    let moved = 0;
    for (let i = 0; i < 400; i++) if (Math.abs(causticWeb(i * 0.113 % 6, i * 0.071 % 6, 0) - causticWeb(i * 0.113 % 6, i * 0.071 % 6, 1.5)) > 0.2) moved++;
    expect(moved).toBeGreaterThan(40);
  });

  it('is clipped to shallow water: full beside the shore, gone in open water, nothing on dry ground or in the foam line', () => {
    expect(shallowWeight(0.25)).toBeGreaterThan(0.99);
    expect(shallowWeight(0.9)).toBe(0);
    expect(shallowWeight(2)).toBe(0);
    expect(shallowWeight(-0.1)).toBe(0); // dry
    expect(shallowWeight(0)).toBe(0);
    expect(shallowWeight(0.01)).toBe(0); // the foam's own band
    expect(shallowWeight(0.55)).toBeGreaterThan(0);
    expect(shallowWeight(0.55)).toBeLessThan(1);
    // Rivers get none (the order names shoals and the shallow edge), and it is the water shader's own shore value that clips.
    expect(CAUSTIC_AMP).toBeGreaterThan(0.05);
    const water = (createTerrainKit(boardInput(['~s'])).debug.materials().water);
    const fs = patched(water).fragmentShader;
    expect(fs).toContain('vKind > 0.5 ? 0.0 : trnShallow( vShore )');
  });
});

describe('fog of war ordering: a cloud never moves a tile across the fog line', () => {
  const COLOURS: [number, number, number][] = [
    [0.22, 0.34, 0.12], // grass
    [0.9, 0.45, 0.08], // an orange roof
    [0.1, 0.25, 0.6], // a blue roof
    [0.05, 0.3, 0.38], // shallow water
    [0.4, 0.4, 0.42], // paving
  ];
  const lum = (v: readonly number[]): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const sat = (v: readonly number[]): number => Math.max(...v) - Math.min(...v);
  type Finish = (c: [number, number, number], seen: number, mult: number) => [number, number, number];

  /** Under any shadow the order allows, an unseen tile is darker than the same tile seen by at least the fog grade's own 0.45, and keeps 30% of its colour. */
  const respectsFog = (finish: Finish): boolean => {
    for (const c of COLOURS) {
      for (const dark of [0, 0.05, 0.1, CLOUD_MAX]) {
        const m = livingMultiplier(dark, 0, 0);
        const hidden = finish(c, 0, m); const seen = finish(c, 1, m);
        if (lum(hidden) / lum(seen) > 0.45 + 1e-9) return false;
        if (Math.abs(sat(hidden) / sat(seen) - 0.45 * 0.3) > 1e-9) return false;
        // The seen tile keeps its own colour under the shadow: darker by the shadow, no less saturated, no change of hue.
        if (Math.abs(sat(seen) / sat(c) - m) > 1e-9) return false;
      }
    }
    return true;
  };

  it('a hidden tile under a cloud is still darker than a seen tile under the same cloud by the fog grade\'s factor', () => {
    expect(respectsFog(gradeThenLive)).toBe(true);
    // With no cloud it is exactly today's grade.
    for (const c of COLOURS) expect(gradeThenLive(c, 0, 1)).toEqual(fogGrade(c, 0));
    for (const c of COLOURS) gradeThenLive(c, 1, 1).forEach((v, i) => expect(v).toBeCloseTo(c[i], 12));
  });

  it('planted wrong orders fail it: the cloud folded into the fog map, and a cloud that desaturates', () => {
    // The cloud written into the fog map's "seen" value (so a seen tile under a cloud reads partly hidden).
    const folded: Finish = (c, seen, m) => fogGrade(c, seen * m);
    expect(respectsFog(folded)).toBe(false);
    // A shadow that mixes toward grey instead of scaling.
    const greyed: Finish = (c, seen, m) => {
      const g = fogGrade(c, seen); const l = lum(g);
      return g.map((v) => (l + (v - l) * m) * m) as [number, number, number];
    };
    expect(respectsFog(greyed)).toBe(false);
  });

  it('the margin that keeps the fog line readable: the dimmest seen tile is well above the brightest hidden one, whatever the weather', () => {
    for (const c of COLOURS) {
      const seenWorst = lum(gradeThenLive(c, 1, LIVE_FLOOR));
      const hiddenBest = lum(gradeThenLive(c, 0, LIVE_CEIL));
      expect(seenWorst / hiddenBest).toBeGreaterThan(1.4);
    }
  });
});

describe('cost: no new draw calls, meshes, triangles, geometries, materials or textures', () => {
  // Measured on the kit as it stood before this order (main @ 323a2ff), same boards, same build.
  it('the kit builds exactly the draw calls, meshes and triangles it built before', () => {
    const BEFORE: Record<string, { meshes: number; drawCalls: number; triangles: number }> = {
      'stress': { meshes: 10, drawCalls: 16, triangles: 152014 },
    };
    const kit = createTerrainKit(boardInput(stressRows(25, 19)));
    expect(kit.stats).toMatchObject(BEFORE.stress);
    expect(kit.group.children.map((c) => c.name)).toEqual([
      'terrain:ground', 'terrain:water', 'terrain:solid', 'terrain:glossy', 'terrain:windows', 'terrain:glow', 'terrain:decal',
      'terrain:pines', 'terrain:broadleaf', 'terrain:capture-rings',
    ]);
    expect(kit.live()).toEqual({ geometries: 10, materials: 11, textures: 6 });
    kit.update(0.016, 3);
    expect(kit.live()).toEqual({ geometries: 10, materials: 11, textures: 6 }); // running it adds nothing either
    kit.dispose();
  });

  it('two real maps keep their measured draw-call counts too', () => {
    const BEFORE: Record<string, { meshes: number; drawCalls: number; triangles: number }> = {
      'calder-fields': { meshes: 8, drawCalls: 13, triangles: 44972 },
      'saltglass-bay': { meshes: 9, drawCalls: 14, triangles: 70544 },
    };
    for (const [id, want] of Object.entries(BEFORE)) {
      const m = MAPS[id];
      const base = boardInput(m.terrain);
      const kit = createTerrainKit({ ...base, ownerAt: (x, y) => (m.owners[y][x] === '.' ? null : Number(m.owners[y][x])), factionOf: (p) => FACTIONS[p] ?? null });
      expect(kit.stats, id).toMatchObject(want);
      kit.dispose();
    }
  });
});

describe('the grass weight the ground carries for the wind wave', () => {
  const rows = ['.f^=', '~sCg', 'r.H#', 'ff..'];
  const kit = createTerrainKit(boardInput(rows));
  const ground = kit.group.children.find((c) => c.name === 'terrain:ground') as Mesh;
  const geo: BufferGeometry = ground.geometry;
  const grass = geo.getAttribute('aGrass') as BufferAttribute;
  const pos = geo.getAttribute('position') as BufferAttribute;
  const nrm = geo.getAttribute('normal') as BufferAttribute;

  it('is one float per vertex, 1 on the top and bevel of a flats or canopy tile and 0 on every wall and on every other terrain', () => {
    expect(grass.itemSize).toBe(1);
    expect(grass.count).toBe(pos.count);
    let grassTop = 0; let otherTop = 0; let walls = 0;
    for (let t = 0; t < pos.count; t += 3) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
      const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      const w = [grass.getX(t), grass.getX(t + 1), grass.getX(t + 2)];
      expect(new Set(w).size, 'a triangle has one weight').toBe(1);
      const wall = nrm.getY(t) < 0.1;
      if (wall) { expect(w[0]).toBe(0); walls++; continue; }
      const terrain = rows[Math.floor(cz)][Math.floor(cx)];
      const isGrass = terrain === '.' || terrain === 'f';
      expect(w[0], `tile ${Math.floor(cx)},${Math.floor(cz)} (${terrain})`).toBe(isGrass ? 1 : 0);
      if (isGrass) grassTop++; else otherTop++;
    }
    expect(grassTop).toBeGreaterThan(20);
    expect(otherTop).toBeGreaterThan(20);
    expect(walls).toBeGreaterThan(10);
  });

  it('is only a weight: the same board still builds the same positions (a known-bad weight changes no geometry)', () => {
    const again = createTerrainKit(boardInput(rows));
    const g2 = (again.group.children.find((c) => c.name === 'terrain:ground') as Mesh).geometry;
    expect(Array.from((g2.getAttribute('position') as BufferAttribute).array)).toEqual(Array.from(pos.array));
    again.dispose();
    kit.dispose();
  });
});
