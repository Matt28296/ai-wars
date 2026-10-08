import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MoveType, UnitTypeId } from '../game/aw/types';
import { DAMAGE } from './damage';
import { ART, FACTION_LIST, TERRAIN_CODES, TERRAIN_LIST, UNIT_LIST, UNIT_TYPES } from './index';

const MOVE_TYPES: MoveType[] = ['foot', 'exo', 'hover', 'tread', 'walker', 'air', 'sea', 'barge'];
const unitIds = new Set(UNIT_LIST.map((u) => u.id));

describe('units', () => {
  it('has the 16-unit roster with unique ids', () => {
    expect(UNIT_LIST).toHaveLength(16);
    expect(unitIds.size).toBe(16);
  });
  it('gives every unit sane stats', () => {
    for (const u of UNIT_LIST) {
      expect(u.cost, u.id).toBeGreaterThan(0);
      expect(u.move, u.id).toBeGreaterThan(0);
      expect(MOVE_TYPES, u.id).toContain(u.moveType);
      if (u.range) expect(u.range[0], u.id).toBeLessThanOrEqual(u.range[1]);
    }
  });
  it('burns charge each turn for air and naval units only', () => {
    for (const u of UNIT_LIST) {
      if (u.domain === 'ground') expect(u.drain ?? 0, u.id).toBe(0);
      else expect(u.drain, u.id).toBeGreaterThan(0);
    }
  });
  it('lets only foot and exo units capture', () => {
    const capturers = UNIT_LIST.filter((u) => u.captures).map((u) => u.moveType);
    expect(new Set(capturers)).toEqual(new Set(['foot', 'exo']));
  });
});

describe('damage table', () => {
  it('has a row for every unit and only known targets', () => {
    expect(new Set(Object.keys(DAMAGE))).toEqual(unitIds);
    for (const [attacker, row] of Object.entries(DAMAGE)) {
      for (const table of [row.primary, row.secondary]) {
        for (const [target, value] of Object.entries(table ?? {})) {
          expect(unitIds.has(target as UnitTypeId), `${attacker} -> ${target}`).toBe(true);
          expect(value, `${attacker} -> ${target}`).toBeGreaterThanOrEqual(1);
          expect(value, `${attacker} -> ${target}`).toBeLessThanOrEqual(200);
        }
      }
    }
  });
  it('gives a primary weapon only to units that carry ammo, and no weapon to unarmed units', () => {
    for (const u of UNIT_LIST) {
      const row = DAMAGE[u.id];
      if (row.primary && Object.keys(row.primary).length) expect(u.ammo, u.id).toBeGreaterThan(0);
      if (!u.range) expect(Object.keys({ ...row.primary, ...row.secondary }), u.id).toEqual([]);
    }
  });
  it('lets every armed unit hit at least one target', () => {
    for (const u of UNIT_LIST.filter((x) => x.range)) {
      const row = DAMAGE[u.id];
      expect(Object.keys({ ...row.primary, ...row.secondary }).length, u.id).toBeGreaterThan(0);
    }
  });
});

describe('terrain', () => {
  it('has the 15 terrains, each with a cost for every movement type and a map code', () => {
    expect(TERRAIN_LIST).toHaveLength(15);
    const coded = new Set(Object.values(TERRAIN_CODES));
    for (const t of TERRAIN_LIST) {
      expect(coded.has(t.id), t.id).toBe(true);
      expect(t.def, t.id).toBeGreaterThanOrEqual(0);
      expect(t.def, t.id).toBeLessThanOrEqual(4);
      for (const mt of MOVE_TYPES) expect(t.cost, `${t.id}.${mt}`).toHaveProperty(mt);
    }
  });
  it('makes sea passable only to air and naval units', () => {
    const sea = TERRAIN_LIST.find((t) => t.id === 'sea')!;
    const open = MOVE_TYPES.filter((mt) => sea.cost[mt] !== null);
    expect(new Set(open)).toEqual(new Set(['air', 'sea', 'barge']));
  });
  it('gives every unit somewhere to stand', () => {
    for (const u of UNIT_LIST) {
      expect(TERRAIN_LIST.some((t) => t.cost[u.moveType] !== null), u.id).toBe(true);
    }
  });
});

describe('art and tokens', () => {
  const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
  it('has a glyph per unit, art per terrain, a sigil per faction plus ECHO', () => {
    for (const u of UNIT_LIST) expect(ART.glyphs, u.id).toHaveProperty(u.id);
    for (const t of TERRAIN_LIST) expect(ART.terrain, t.id).toHaveProperty(t.id);
    for (const f of FACTION_LIST) expect(ART.sigils, f.id).toHaveProperty(f.id);
    expect(ART.sigils).toHaveProperty('echo');
  });
  it('declares every colour token the terrain art paints with', () => {
    const roles = new Set<string>();
    for (const art of Object.values(ART.terrain) as { base: string; shapes: { c: string }[] }[]) {
      roles.add(art.base);
      for (const s of art.shapes) if (!s.c.startsWith('struct')) roles.add(s.c);
    }
    for (const role of roles) expect(css, role).toContain(`--${role}:`);
  });
  it('declares a fill, on- and -ink token for every faction', () => {
    for (const f of FACTION_LIST) for (const name of [f.id, `on-${f.id}`, `${f.id}-ink`]) expect(css, name).toContain(`--${name}:`);
  });
});

describe('unit lookup', () => {
  it('indexes every unit by id', () => {
    for (const u of UNIT_LIST) expect(UNIT_TYPES[u.id]).toBe(u);
  });
});
