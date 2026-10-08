// Lighting, storm, lightning and the shadow camera, against known answers.
import { OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  GROUND, HEMI_RATIO, KEY_LUX, LIGHTNING_WINDOW_S, SKY, desaturate, fitShadow, hash01, lightingFor, lightningFlash, luminanceOf, mixColor,
  saturationOf, stormMixFor, sunDirection,
} from './lighting';

describe('the key light', () => {
  it('comes from the north-west at about 50 degrees', () => {
    const d = sunDirection();
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
    expect(d.x).toBeLessThan(0); // west
    expect(d.z).toBeLessThan(0); // north
    expect(d.x).toBeCloseTo(d.z, 12); // exactly north-west
    expect(Math.asin(d.y) * (180 / Math.PI)).toBeCloseTo(50, 9);
  });

  it('keeps the hemisphere at 0.6 of the key, with the art direction\'s sky and ground', () => {
    const clear = lightingFor(0);
    expect(clear.sky).toBe(SKY);
    expect(clear.ground).toBe(GROUND);
    expect(clear.sky).toBe(0xcfe3ff);
    expect(clear.ground).toBe(0x5b4a3a);
    expect(clear.hemiIntensity / clear.sunIntensity).toBeCloseTo(HEMI_RATIO, 9);
    expect(clear.sunIntensity).toBe(KEY_LUX);
    expect(clear.exposure).toBe(1);
  });
});

describe('colour helpers', () => {
  it('mix and desaturate behave at their ends', () => {
    expect(mixColor(0x102030, 0xf0e0d0, 0)).toBe(0x102030);
    expect(mixColor(0x102030, 0xf0e0d0, 1)).toBe(0xf0e0d0);
    expect(mixColor(0x000000, 0xfefefe, 0.5)).toBe(0x7f7f7f);
    expect(saturationOf(desaturate(0xff4d63, 1))).toBe(0);
    expect(desaturate(0xff4d63, 0)).toBe(0xff4d63);
    expect(saturationOf(desaturate(0xff4d63, 0.5))).toBeLessThan(saturationOf(0xff4d63));
  });
});

describe('the ion storm', () => {
  const clear = lightingFor(0);
  const storm = lightingFor(1);

  it('makes the light cooler, more grey and dimmer than clear', () => {
    // cooler: the warm key gains blue on red
    const bias = (c: number): number => (c & 255) - ((c >> 16) & 255);
    expect(bias(storm.sun)).toBeGreaterThan(bias(clear.sun));
    // the sky is already blue: in a storm it goes greyer and darker, not bluer
    expect(luminanceOf(storm.sky)).toBeLessThan(luminanceOf(clear.sky));
    expect(saturationOf(storm.sky)).toBeLessThan(saturationOf(clear.sky));
    // desaturated
    expect(saturationOf(storm.sun)).toBeLessThan(saturationOf(clear.sun));
    expect(saturationOf(storm.ground)).toBeLessThan(saturationOf(clear.ground));
    // dimmer
    expect(storm.sunIntensity).toBeLessThan(clear.sunIntensity);
    expect(storm.hemiIntensity).toBeLessThan(clear.hemiIntensity);
    expect(storm.exposure).toBeLessThanOrEqual(clear.exposure);
    expect(luminanceOf(storm.sun)).toBeLessThanOrEqual(luminanceOf(clear.sun) + 1e-9);
  });

  it('eases in with the mix: half a storm sits between clear and storm', () => {
    const half = lightingFor(0.5);
    expect(half.sunIntensity).toBeLessThan(clear.sunIntensity);
    expect(half.sunIntensity).toBeGreaterThan(storm.sunIntensity);
    expect(lightingFor(-3).sunIntensity).toBe(clear.sunIntensity); // out of range clamps
    expect(lightingFor(9).sunIntensity).toBe(storm.sunIntensity);
  });

  it('maps the game\'s weather: only an ion storm is a storm', () => {
    expect(stormMixFor('clear')).toBe(0);
    expect(stormMixFor('ionstorm')).toBe(1);
  });

  it('a flash lifts the light briefly and turns the key blue-white', () => {
    const lit = lightingFor(1, 1);
    expect(lit.hemiIntensity).toBeGreaterThan(storm.hemiIntensity);
    expect(lit.sunIntensity).toBeGreaterThan(storm.sunIntensity);
    expect(luminanceOf(lit.sun)).toBeGreaterThan(luminanceOf(storm.sun));
  });
});

describe('lightning', () => {
  const SECONDS = 4000;
  const samples = (enabled: boolean, step = 0.05): number[] => {
    const out: number[] = [];
    for (let t = 0; t < SECONDS; t += step) out.push(lightningFlash(t, enabled));
    return out;
  };

  it('is deterministic in the time, so a recorded frame always looks the same', () => {
    for (const t of [3.2, 17.77, 250.1, 999.9]) expect(lightningFlash(t, true)).toBe(lightningFlash(t, true));
    expect(hash01(7)).toBe(hash01(7));
    expect(hash01(7)).not.toBe(hash01(8));
  });

  it('is zero when not enabled (clear weather, or reduced motion), at every moment', () => {
    expect(samples(false, 0.5).every((v) => v === 0)).toBe(true);
    expect(lightningFlash(Number.NaN, true)).toBe(0);
    expect(lightningFlash(-5, true)).toBe(0);
  });

  it('does happen in a storm (not vacuous), and stays within 0..1', () => {
    const v = samples(true);
    expect(Math.max(...v)).toBeGreaterThan(0.5);
    expect(Math.min(...v)).toBe(0);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
  });

  it('is rare and never strobes: at most one flash in any window, a small fraction of the time lit, a flash under half a second', () => {
    const step = 0.02;
    let lit = 0;
    const perWindow = new Map<number, number>();
    let inFlash = false;
    let flashLen = 0;
    let longest = 0;
    for (let t = 0; t < SECONDS; t += step) {
      const v = lightningFlash(t, true);
      if (v > 0) {
        lit += step;
        flashLen += step;
        if (!inFlash) {
          const w = Math.floor(t / LIGHTNING_WINDOW_S);
          perWindow.set(w, (perWindow.get(w) ?? 0) + 1);
        }
        inFlash = true;
      } else {
        if (inFlash) longest = Math.max(longest, flashLen);
        inFlash = false;
        flashLen = 0;
      }
    }
    expect(lit / SECONDS).toBeLessThan(0.03);
    expect(lit / SECONDS).toBeGreaterThan(0.001);
    expect(longest).toBeLessThan(0.5);
    expect(Math.max(...perWindow.values())).toBe(1); // one flash per window, at most
    expect(perWindow.size).toBeLessThan(SECONDS / LIGHTNING_WINDOW_S); // and not every window has one
  });
});

describe('the shadow camera fitted to the board', () => {
  const boards = [{ width: 14, height: 10 }, { width: 25, height: 15 }, { width: 23, height: 23 }];

  /** The light as a three.js orthographic camera, built from the fit; three's own projection is the independent check. */
  const lightCamera = (fit: ReturnType<typeof fitShadow>, scale = { left: 1, right: 1, top: 1, bottom: 1 }): OrthographicCamera => {
    const cam = new OrthographicCamera(fit.left * scale.left, fit.right * scale.right, fit.top * scale.top, fit.bottom * scale.bottom, fit.near, fit.far);
    cam.position.set(fit.position.x, fit.position.y, fit.position.z);
    cam.lookAt(new Vector3(fit.target.x, fit.target.y, fit.target.z));
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    return cam;
  };
  const boardBox = (b: { width: number; height: number }, top = 2.2): Vector3[] => {
    const out: Vector3[] = [];
    for (const x of [0, b.width]) for (const y of [-0.15, top]) for (const z of [0, b.height]) out.push(new Vector3(x, y, z));
    return out;
  };
  const within = (v: Vector3): boolean => Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z >= -1 && v.z <= 1;

  for (const b of boards) {
    it(`covers every corner of a ${b.width}x${b.height} board, from just under the water to the tallest tower`, () => {
      const cam = lightCamera(fitShadow(b));
      for (const p of boardBox(b)) expect(within(p.clone().project(cam)), JSON.stringify(p)).toBe(true);
    });

    it(`is fitted, not huge, for ${b.width}x${b.height}: the board fills most of the shadow map`, () => {
      const cam = lightCamera(fitShadow(b));
      const pts = boardBox(b).map((p) => p.clone().project(cam));
      const span = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
      expect(span).toBeGreaterThan(1.3); // of a possible 2
    });

    it(`a frustum cut 15% short on any side misses the board (known-bad) for ${b.width}x${b.height}`, () => {
      const fit = fitShadow(b);
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        const cam = lightCamera(fit, { left: 1, right: 1, top: 1, bottom: 1, [side]: 0.85 });
        expect(boardBox(b).some((p) => !within(p.clone().project(cam))), side).toBe(true);
      }
    });
  }

  it('puts the light on the north-west side of the board, looking at its centre', () => {
    const fit = fitShadow({ width: 14, height: 10 });
    expect(fit.position.x).toBeLessThan(fit.target.x);
    expect(fit.position.z).toBeLessThan(fit.target.z);
    expect(fit.position.y).toBeGreaterThan(0);
    expect(fit.target).toEqual({ x: 7, y: 0, z: 5 });
  });
});
