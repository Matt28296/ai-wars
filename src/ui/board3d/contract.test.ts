import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { UNIT_LIST } from '../../data';
import { tileCenter } from './contract';
import type { TerrainInput } from './contract';
import { createFx } from './fx';
import { FACTION_ACCENT, FACTION_COLOR, TERRAIN_COLOR } from './palette';
import { createTerrain } from './terrain';
import { createUnitView } from './units';

const css = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');
const token = (name: string): number => {
  const m = new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})\\b`).exec(css);
  if (!m) throw new Error(`token --${name} not found`);
  return parseInt(m[1], 16);
};

describe('palette mirrors the design tokens', () => {
  it('faction colours and accents', () => {
    for (const f of Object.keys(FACTION_COLOR) as (keyof typeof FACTION_COLOR)[]) {
      expect(FACTION_COLOR[f], f).toBe(token(f));
      expect(FACTION_ACCENT[f], `${f} accent`).toBe(f === 'choir' ? token('on-choir') : token(`${f}-ink`));
    }
  });
  it('terrain base and detail colours', () => {
    for (const [fam, c] of Object.entries(TERRAIN_COLOR)) {
      expect(c.base, fam).toBe(token(`terrain-${fam}`));
      if (fam !== 'shoal') expect(c.detail, `${fam} detail`).toBe(token(`terrain-${fam}-detail`));
    }
  });
  it('a planted wrong value is caught', () => {
    expect(() => token('no-such-token')).toThrow();
    expect(0x123456).not.toBe(token('helion'));
  });
});

describe('the placeholders meet the contract (so the renderer core can be built against them)', () => {
  const input: TerrainInput = {
    width: 3, height: 2,
    terrainAt: (x) => (x === 2 ? 'fabricator' : 'flats'),
    ownerAt: (x) => (x === 2 ? 0 : null),
    factionOf: () => 'helion',
    weather: 'clear',
  };
  it('terrain builds one group, answers heights and takes owners, capture, occupancy, sight and weather', () => {
    const t = createTerrain(input);
    expect(t.group.children.length).toBeGreaterThan(0);
    expect(Number.isFinite(t.heightAt(1, 1))).toBe(true);
    t.setOwners(() => null);
    t.setCapture(() => 0.5);
    t.setOccupied((x) => x === 2);
    t.setVisible((x) => x > 0);
    t.setWeather('ionstorm');
    t.update(0.016, 1);
    t.dispose();
  });
  it('every unit type has a view with an object, a muzzle and poses', () => {
    for (const u of UNIT_LIST) {
      const v = createUnitView(u.id, 'tidewell');
      expect(v.type).toBe(u.id);
      v.setLook({ hp: 7, spent: true, heading: Math.PI / 2, status: null, focused: false });
      v.setPose('fire', 0.15);
      expect(v.muzzleWorld(new Vector3())).toBeInstanceOf(Vector3);
      v.update(0.016, 1);
      v.dispose();
    }
  });
  it('fx draws a list and an empty list', () => {
    const fx = createFx();
    fx.draw([{ kind: 'explosion', at: new Vector3(1, 0, 1), progress: 0.3, seed: 1 }, { kind: 'tracer', at: new Vector3(), to: new Vector3(2, 0, 0), progress: 0.5, seed: 2 }]);
    fx.draw([]);
    fx.numbers([{ at: new Vector3(), text: '-42%', tone: 'damage', progress: 0.5 }]);
    fx.dispose();
  });
  it('tile centres sit in the middle of their tile', () => {
    expect(tileCenter(0, 0)).toEqual({ x: 0.5, z: 0.5 });
    expect(tileCenter(3, 2)).toEqual({ x: 3.5, z: 2.5 });
  });
});
