// The power sweep: the colour is the commander's faction, the strength follows the level (gentle Surge, strong Overclock), the band
// crosses the board in the direction the commander's side faces, a reduced-motion viewer gets a plain fade, and the whole thing is one
// extra mesh that exists only while a power runs. Expected values are worked out here, not read back from sweep.ts.
import { Color, Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { FACTION_ACCENT } from '../palette';
import { OFF_BOARD, PowerSweep, SWEEP, SWEEP_FROM, SWEEP_TO, SWEEP_Y, fadeEnvelope, sweepColor, sweepIntensity, sweepPhase } from './sweep';
import type { SweepSpec } from './sweep';

const FACTIONS = ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'] as const;
const BOARD = { width: 14, height: 10, direction: 1 as const, reduced: false };
const spec = (over: Partial<SweepSpec> = {}): SweepSpec => ({ faction: 'helion', player: 0, level: 'surge', progress: 0.5, ...over });

describe('the colour is the commander\'s faction', () => {
  it('is the faction\'s bright accent, one colour per faction, never black (light cannot add black to a scene)', () => {
    expect(sweepColor('helion')).toBe(0xffa95c);
    expect(sweepColor('tidewell')).toBe(0x8ab6ff);
    expect(sweepColor('verdant')).toBe(0x5fd49b);
    expect(sweepColor('kestrel')).toBe(0xefd77a);
    expect(sweepColor('choir')).toBe(0xff4d63); // the Choir's own colour is near black, so its red signal carries the band
    expect(new Set(FACTIONS.map(sweepColor)).size).toBe(5);
    for (const f of FACTIONS) {
      expect(sweepColor(f)).toBe(FACTION_ACCENT[f]);
      const c = new Color(sweepColor(f));
      expect(Math.max(c.r, c.g, c.b), f).toBeGreaterThan(0.3);
    }
  });
  it('reaches the shader: the mesh shows the colour of the faction that activated the power', () => {
    const sweep = new PowerSweep();
    for (const f of FACTIONS) {
      sweep.update(spec({ faction: f }), BOARD);
      expect(sweep.stats().color, f).toBe(FACTION_ACCENT[f]);
      const u = (sweep.mesh.material as ShaderMaterial).uniforms.uColor.value as Color;
      expect(u.getHex(), f).toBe(new Color(FACTION_ACCENT[f]).getHex());
    }
    sweep.dispose();
  });
});

describe('strength follows the level', () => {
  it('Overclock is strong and Surge gentle: more than twice the light, a wider reach and a second band', () => {
    expect(sweepIntensity('overclock')).toBeGreaterThan(sweepIntensity('surge') * 1.8);
    expect(SWEEP.overclock.width).toBeGreaterThan(SWEEP.surge.width);
    expect(SWEEP.surge.bands).toBe(1);
    expect(SWEEP.overclock.bands).toBe(2);
    expect(sweepIntensity('surge')).toBeLessThan(0.7); // gentle: well under what the bloom picks up on its own
  });
  it('reaches the shader as the level\'s own intensity, width and bands (known-bad: a level that is ignored shows the other\'s)', () => {
    const sweep = new PowerSweep();
    const u = (sweep.mesh.material as ShaderMaterial).uniforms;
    sweep.update(spec({ level: 'surge' }), BOARD);
    expect([u.uIntensity.value, u.uWidth.value, u.uBands.value]).toEqual([SWEEP.surge.intensity, SWEEP.surge.width, 1]);
    sweep.update(spec({ level: 'overclock' }), BOARD);
    expect([u.uIntensity.value, u.uWidth.value, u.uBands.value]).toEqual([SWEEP.overclock.intensity, SWEEP.overclock.width, 2]);
    expect(u.uIntensity.value).not.toBe(SWEEP.surge.intensity);
    expect(sweep.stats().intensity).toBe(SWEEP.overclock.intensity);
    expect(sweep.stats().bands).toBe(2);
    sweep.dispose();
  });
});

describe('the band crosses the board while the cut-in plays', () => {
  it('is off the board at both ends of its run, and across it in between, monotonically', () => {
    expect(sweepPhase(0)).toBe(0);
    expect(sweepPhase(SWEEP_FROM)).toBe(0);
    expect(sweepPhase(SWEEP_TO)).toBeCloseTo(1, 12);
    expect(sweepPhase(1)).toBe(1);
    let prev = -1;
    for (let p = SWEEP_FROM; p <= SWEEP_TO; p += 0.01) {
      const v = sweepPhase(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(sweepPhase((SWEEP_FROM + SWEEP_TO) / 2)).toBeCloseTo(0.5, 12); // an ease in and out is half way at half way
  });
  it('runs after the DOM band has slid in (200 ms of 2200) and is done before it slides out', () => {
    expect(SWEEP_FROM).toBeGreaterThanOrEqual(200 / 2200 * 0.6);
    expect(SWEEP_TO).toBeLessThanOrEqual(1 - 200 / 2200 * 0.6);
  });
  it('travels in the direction of the commander\'s side: east for a side that faces east, west for one that faces west', () => {
    const sweep = new PowerSweep();
    const centre = (direction: 1 | -1, progress: number): number => {
      sweep.update(spec({ progress }), { ...BOARD, direction });
      return sweep.stats().center;
    };
    const east = [0.1, 0.3, 0.5, 0.7, 0.85].map((p) => centre(1, p));
    const west = [0.1, 0.3, 0.5, 0.7, 0.85].map((p) => centre(-1, p));
    for (let i = 1; i < east.length; i++) {
      expect(east[i]).toBeGreaterThan(east[i - 1]);
      expect(west[i]).toBeLessThan(west[i - 1]);
    }
    // the two end on opposite sides: east starts west of the board and ends east of it, west the other way round
    const axis = BOARD.width * 0.97 + BOARD.height * 0.242;
    expect(centre(1, 0)).toBeLessThan(0);
    expect(centre(1, 1)).toBeGreaterThan(axis);
    expect(centre(-1, 0)).toBeGreaterThan(axis);
    expect(centre(-1, 1)).toBeLessThan(0);
    sweep.dispose();
  });
});

describe('under reduced motion it is a plain fade, not a sweep', () => {
  it('shows in the fade mode: no band moves, the same wash all over the board, brightest in the middle of the cut-in and gone at both ends', () => {
    const sweep = new PowerSweep();
    const reduced = { ...BOARD, reduced: true };
    const u = (sweep.mesh.material as ShaderMaterial).uniforms;
    const seen: number[] = [];
    for (const p of [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
      sweep.update(spec({ progress: p }), reduced);
      expect(sweep.stats().mode, `p=${p}`).toBe('fade');
      expect(sweep.stats().center, `p=${p}`).toBe(OFF_BOARD); // no band, anywhere
      expect(u.uMode.value).toBe(1);
      seen.push(u.uFade.value as number);
    }
    expect(seen[0]).toBe(0);
    expect(seen[6]).toBe(0);
    expect(seen[3]).toBe(1);
    expect(seen[1]).toBeLessThan(seen[2]);
    expect(seen[2]).toBeLessThanOrEqual(seen[3]);
    expect(seen[5]).toBeLessThan(seen[4]);
    // a fade at 0 is not drawn at all
    sweep.update(spec({ progress: 0 }), reduced);
    expect(sweep.mesh.visible).toBe(false);
    expect(sweep.stats().drawCalls).toBe(0);
    // and the wash is gentler than the band: Overclock still shows more than Surge
    sweep.update(spec({ level: 'surge', progress: 0.5 }), reduced);
    const surge = u.uIntensity.value as number;
    sweep.update(spec({ level: 'overclock', progress: 0.5 }), reduced);
    const over = u.uIntensity.value as number;
    expect(over).toBeGreaterThan(surge * 1.8);
    expect(over).toBeLessThan(sweepIntensity('overclock'));
    sweep.dispose();
  });
  it('the fade envelope is exactly 0 at both ends and 1 for the middle three fifths', () => {
    expect(fadeEnvelope(0)).toBe(0);
    expect(fadeEnvelope(1)).toBe(0);
    for (const p of [0.2, 0.3, 0.5, 0.7, 0.8]) expect(fadeEnvelope(p), `p=${p}`).toBe(1);
    expect(fadeEnvelope(0.1)).toBeCloseTo(0.5, 12);
    expect(fadeEnvelope(0.9)).toBeCloseTo(0.5, 12);
  });
});

describe('one extra mesh, only while a power runs', () => {
  it('is not drawn while the band is off the board (before it starts and after it has left): nothing to light, no pass', () => {
    const sweep = new PowerSweep();
    for (const p of [0, 0.03, SWEEP_FROM]) {
      sweep.update(spec({ progress: p }), BOARD);
      expect(sweep.mesh.visible, `p=${p}`).toBe(false);
      expect(sweep.stats().drawCalls).toBe(0);
    }
    for (const p of [SWEEP_TO, 0.9, 1]) {
      sweep.update(spec({ progress: p }), BOARD);
      expect(sweep.mesh.visible, `p=${p}`).toBe(false);
    }
    for (const p of [SWEEP_FROM + 0.01, 0.5, SWEEP_TO - 0.01]) {
      sweep.update(spec({ progress: p }), BOARD);
      expect(sweep.mesh.visible, `p=${p}`).toBe(true);
    }
    sweep.dispose();
  });
  it('is hidden with no power and costs no draw call; shown for a power, one draw call', () => {
    const sweep = new PowerSweep();
    expect(sweep.mesh).toBeInstanceOf(Mesh);
    expect(sweep.mesh.visible).toBe(false);
    sweep.update(null, BOARD);
    expect(sweep.mesh.visible).toBe(false);
    expect(sweep.stats().drawCalls).toBe(0);
    sweep.update(spec(), BOARD);
    expect(sweep.mesh.visible).toBe(true);
    expect(sweep.stats().drawCalls).toBe(1);
    sweep.update(null, BOARD);
    expect(sweep.mesh.visible).toBe(false);
    sweep.dispose();
  });
  it('is one mesh with additive light that does not write depth, laid over the board and a little beyond it, over the ground', () => {
    const sweep = new PowerSweep();
    sweep.update(spec(), BOARD);
    const m = sweep.mesh.material as ShaderMaterial;
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(2); // AdditiveBlending
    expect(sweep.mesh.position.y).toBeCloseTo(SWEEP_Y, 12);
    expect(sweep.mesh.position.x).toBeCloseTo(7, 12);
    expect(sweep.mesh.position.z).toBeCloseTo(5, 12);
    expect(sweep.mesh.scale.x).toBeGreaterThan(14);
    expect(sweep.mesh.scale.z).toBeGreaterThan(10);
    sweep.dispose();
  });
  it('update after dispose is harmless, and dispose frees the geometry and the material', () => {
    const sweep = new PowerSweep();
    let freed = 0;
    sweep.mesh.geometry.addEventListener('dispose', () => { freed++; });
    sweep.mesh.material.addEventListener('dispose', () => { freed++; });
    sweep.dispose();
    sweep.dispose();
    expect(freed).toBe(2);
    expect(() => sweep.update(spec(), BOARD)).not.toThrow();
  });
});
