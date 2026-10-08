// The unit miniatures. Node environment: there is no DOM, so the chips use their flat fallback texture and nothing here needs a canvas.
// Every expected value is computed here (from the data, the palette, or geometry), never copied out of the implementation.
import { Box3, BoxGeometry, Color, Group, Mesh, ShaderLib, Vector3 } from 'three';
import type { Material, Object3D, Sprite } from 'three';
import { describe, expect, it } from 'vitest';
import { UNIT_LIST, UNIT_TYPES } from '../../../data';
import type { FactionId, UnitTypeId } from '../../../game/aw';
import type { UnitLook, UnitView } from '../contract';
import { FACTION_ACCENT, FACTION_COLOR } from '../palette';
import { FACTION_IDS, UNIT_IDS, createUnitView, createUnitViewWithPhase, recoilCurve, resourceStats, squadSize } from './index';
import {
  GRID, bitmapDistance, boneFootprint, fitsTile, footprint, geometrySignature, modelOf, paintMaterial, resourcesOf, saturation, silhouette, skinMeshes,
  vertexRows, visibleDrawCalls, visibleFigures, visibleTriangles,
} from './measure';

/** Two types closer than this (plan plus side outline, 0 = identical, 2 = nothing shared) would blur together at 64 px. */
const MIN_SILHOUETTE_GAP = 0.3;
const look = (over: Partial<UnitLook> = {}): UnitLook => ({ hp: 10, spent: false, heading: 0, status: null, focused: false, ...over });
const build = (type: UnitTypeId, faction: FactionId = 'helion', over: Partial<UnitLook> = {}): UnitView => {
  const v = createUnitView(type, faction);
  v.setLook(look(over));
  return v;
};
const each = <T>(fn: (type: UnitTypeId, faction: FactionId) => T): T[] => UNIT_IDS.flatMap((t) => FACTION_IDS.map((f) => fn(t, f)));

/** The idle class a unit type must have, derived from the game data's move type (the data is the known answer). */
const CLASS_OF_MOVE_TYPE = { foot: 'foot', exo: 'foot', hover: 'hover', tread: 'tread', walker: 'walker', air: 'air', sea: 'ship', barge: 'ship' } as const;
const classOf = (type: UnitTypeId) => CLASS_OF_MOVE_TYPE[UNIT_TYPES[type].moveType];

describe('the sixteen types', () => {
  it('the model list is exactly the game data', () => {
    expect([...UNIT_IDS].sort()).toEqual(UNIT_LIST.map((u) => u.id).sort());
    expect(UNIT_IDS).toHaveLength(16);
  });

  it('all 16 types build for all 5 factions, and each is a view of its own type', () => {
    expect(each(() => 1)).toHaveLength(80);
    for (const [type, faction] of UNIT_IDS.flatMap((t) => FACTION_IDS.map((f) => [t, f] as const))) {
      const v = build(type, faction);
      expect(v.type).toBe(type);
      expect(v.object.name).toBe(`unit:${type}`);
      expect(visibleTriangles(modelOf(v)), `${type}/${faction}`).toBeGreaterThan(0);
      v.dispose();
    }
  });

  it('every model is 300 to 1,500 triangles, at every HP a squad can show', () => {
    for (const [type, faction] of UNIT_IDS.flatMap((t) => FACTION_IDS.map((f) => [t, f] as const))) {
      for (const hp of [10, 7, 6, 4, 3, 1]) {
        const v = build(type, faction, { hp });
        const n = visibleTriangles(modelOf(v));
        expect(n, `${type}/${faction} hp ${hp}`).toBeGreaterThanOrEqual(300);
        expect(n, `${type}/${faction} hp ${hp}`).toBeLessThanOrEqual(1500);
        v.dispose();
      }
    }
  });

  it('every model fits inside 0.8 x 0.8 tiles at every heading quarter, idle time and pose, centred, with its origin at its feet', () => {
    for (const [type, faction] of UNIT_IDS.flatMap((t) => FACTION_IDS.map((f) => [t, f] as const))) {
      const v = build(type, faction);
      for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        v.setLook(look({ heading }));
        for (const [pose, t] of [['idle', 0], ['fire', 0.15], ['hit', 0.2], ['move', 0.5]] as const) {
          for (const time of [0, 0.7, 1.9, 3.3]) {
            v.update(0.016, time);
            v.setPose(pose, t);
            const box = footprint(v);
            const size = box.getSize(new Vector3());
            expect(fitsTile(box), `${type}/${faction} heading ${heading.toFixed(2)} ${pose} t=${time}: ${size.x.toFixed(3)} x ${size.z.toFixed(3)}`).toBe(true);
            expect(size.y, `${type} height`).toBeLessThanOrEqual(0.8);
          }
        }
      }
      v.update(0.016, 0);
      v.setPose('idle', 0);
      v.setLook(look());
      const box = footprint(v);
      const domain = UNIT_TYPES[type].domain;
      // feet on the tile (ground), a hover gap, a hull in the water (sea), and an altitude (air)
      if (domain === 'ground') {
        const min = classOf(type) === 'hover' ? [0, 0.1] : [-0.03, 0.03];
        expect(box.min.y, `${type} feet`).toBeGreaterThanOrEqual(min[0]);
        expect(box.min.y, `${type} feet`).toBeLessThanOrEqual(min[1]);
      } else if (domain === 'sea') {
        expect(box.min.y, `${type} draft`).toBeGreaterThanOrEqual(-0.12);
        expect(box.min.y, `${type} draft`).toBeLessThanOrEqual(0);
      } else {
        expect(box.min.y, `${type} altitude`).toBeGreaterThanOrEqual(0.2);
      }
      v.dispose();
    }
  });

  it('a model wider than the tile fails the fit check (known-bad), and a model that fits passes (known-good)', () => {
    const wide = new Group();
    wide.add(new Mesh(new BoxGeometry(0.9, 0.2, 0.3)));
    const tall = new Group();
    tall.add(new Mesh(new BoxGeometry(0.3, 0.2, 0.95)));
    const fine = new Group();
    fine.add(new Mesh(new BoxGeometry(0.78, 0.2, 0.78)));
    const off = new Group();
    const offMesh = new Mesh(new BoxGeometry(0.4, 0.2, 0.4));
    offMesh.position.x = 0.5;
    off.add(offMesh);
    const boxOf = footprintOfGroup;
    expect(fitsTile(boxOf(wide))).toBe(false);
    expect(fitsTile(boxOf(tall))).toBe(false);
    expect(fitsTile(boxOf(off))).toBe(false);
    expect(fitsTile(boxOf(fine))).toBe(true);
  });

  it('the silhouettes differ: no two of the 16 share a plan and side outline (a unit told apart at a glance)', () => {
    const marks = UNIT_IDS.map((t) => {
      const v = build(t, 'helion');
      const s = silhouette(v);
      v.dispose();
      return { t, s };
    });
    const distance = (a: { plan: Uint8Array; side: Uint8Array }, b: { plan: Uint8Array; side: Uint8Array }) =>
      bitmapDistance(a.plan, b.plan) + bitmapDistance(a.side, b.side);
    const pairs: { d: number; a: string; b: string }[] = [];
    for (let i = 0; i < marks.length; i += 1) {
      for (let j = i + 1; j < marks.length; j += 1) pairs.push({ d: distance(marks[i].s, marks[j].s), a: marks[i].t, b: marks[j].t });
    }
    pairs.sort((x, y) => x.d - y.d);
    // eslint-disable-next-line no-console
    console.info(`[units] closest silhouette pairs: ${pairs.slice(0, 4).map((p) => `${p.a}/${p.b} ${p.d.toFixed(2)}`).join(', ')}`);
    expect(pairs[0].d, `closest pair: ${pairs[0].a} vs ${pairs[0].b}`).toBeGreaterThan(MIN_SILHOUETTE_GAP);
    // the instrument works in both directions: a unit is not different from itself, and the same type in another livery is nearer than any other type
    expect(distance(marks[0].s, marks[0].s)).toBe(0);
    const lancer = marks.find((m) => m.t === 'lancer');
    const choirLancer = build('lancer', 'choir');
    const sameType = distance(lancer!.s, silhouette(choirLancer));
    choirLancer.dispose();
    expect(sameType, 'the same type in another faction').toBeLessThan(MIN_SILHOUETTE_GAP);
    expect(GRID).toBe(16);
  });

  it('the faction changes the detailing, never the silhouette: every faction differs, the outline stays within a hand', () => {
    for (const type of UNIT_IDS) {
      const sigs = FACTION_IDS.map((f) => {
        const v = createUnitViewWithPhase(type, f, 0.5);
        v.setLook(look());
        const sig = geometrySignature(v);
        const again = createUnitViewWithPhase(type, f, 0.5);
        again.setLook(look());
        expect(geometrySignature(again), `${type}/${f} is built the same twice`).toBe(sig);
        const size = footprint(v).getSize(new Vector3());
        v.dispose();
        again.dispose();
        return { sig, size };
      });
      expect(new Set(sigs.map((s) => s.sig)).size, `${type}: five factions, five distinct geometries`).toBe(5);
      const xs = sigs.map((s) => s.size.x);
      const zs = sigs.map((s) => s.size.z);
      expect(Math.max(...xs) - Math.min(...xs), `${type} length spread`).toBeLessThan(0.1);
      expect(Math.max(...zs) - Math.min(...zs), `${type} width spread`).toBeLessThan(0.2);
    }
  });

  it('paint is the faction colour, trim glows in the faction accent, and the secondary is dark (the paint is in the vertices)', () => {
    for (const faction of FACTION_IDS) {
      const v = build('lancer', faction);
      const colors = vertexRows(skinMeshes(v)[0].geometry, 'color').map((r) => new Color().fromArray(r));
      const has = (hex: number) => colors.some((c) => c.getHex() === hex);
      expect(has(FACTION_COLOR[faction]), `${faction} paint`).toBe(true);
      // the secondary: gunmetal, one step lighter for the Choir (written out here, not read from the kit)
      const steel = faction === 'choir' ? 0x5b6379 : 0x3a414d;
      expect(has(steel), `${faction} gunmetal`).toBe(true);
      expect(new Color(steel).getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.45);
      // the trim's base colour is a dim accent; its glow is the material's emissive
      const trim = new Color(FACTION_ACCENT[faction]).multiplyScalar(0.12);
      expect(colors.some((c) => Math.abs(c.r - trim.r) + Math.abs(c.g - trim.g) + Math.abs(c.b - trim.b) < 1e-6), `${faction} trim`).toBe(true);
      const material = paintMaterial(v);
      expect(material.emissive.getHex()).toBe(FACTION_ACCENT[faction]);
      expect(material.emissiveIntensity).toBeGreaterThan(0.5);
      v.dispose();
    }
  });
});

describe('foot squads', () => {
  it('3 figures at HP 7-10, 2 at 4-6, 1 at 1-3 (expected counts written out here)', () => {
    const expected = [1, 1, 1, 2, 2, 2, 3, 3, 3, 3];
    for (const type of ['trooper', 'breacher'] as const) {
      const v = build(type);
      for (let hp = 1; hp <= 10; hp += 1) {
        v.setLook(look({ hp }));
        expect(visibleFigures(v), `${type} hp ${hp}`).toBe(expected[hp - 1]);
        expect(squadSize(hp)).toBe(expected[hp - 1]);
      }
      v.dispose();
    }
  });

  it('fewer figures draw fewer triangles, and the other fourteen types have no squad', () => {
    const v = build('trooper');
    const tris = [10, 5, 2].map((hp) => {
      v.setLook(look({ hp }));
      return visibleTriangles(modelOf(v));
    });
    expect(tris[0]).toBeGreaterThan(tris[1]);
    expect(tris[1]).toBeGreaterThan(tris[2]);
    expect(tris[0] / tris[2]).toBeCloseTo(3, 0);
    v.dispose();
    for (const t of UNIT_IDS.filter((x) => x !== 'trooper' && x !== 'breacher')) {
      const u = build(t);
      expect(visibleFigures(u), t).toBe(0);
      u.dispose();
    }
  });

  it('out-of-range HP is clamped, never an empty squad (known-bad inputs)', () => {
    expect(squadSize(0)).toBe(1);
    expect(squadSize(-5)).toBe(1);
    expect(squadSize(99)).toBe(3);
    expect(squadSize(6.6)).toBe(3);
    const v = build('breacher', 'helion', { hp: 0 });
    expect(visibleFigures(v)).toBe(1);
    v.dispose();
  });
});

describe('spent', () => {
  /** What the patched shader gets: the real three.js template, run through the material's own patch. */
  const compile = (m: Material) => {
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
    m.onBeforeCompile(shader as never, {} as never);
    return shader;
  };

  it('desaturates the paint to about 40% and dims the trim to 30%, and never hides the unit', () => {
    for (const faction of FACTION_IDS) {
      for (const type of ['lancer', 'wasp', 'dreadnought', 'trooper'] as const) {
        const v = build(type, faction);
        const normal = paintMaterial(v);
        const geo = skinMeshes(v)[0].geometry;
        const base = vertexRows(geo, 'color').map((r) => new Color().fromArray(r));
        const dim = vertexRows(geo, 'aSpent').map((r) => new Color().fromArray(r));
        const sat = saturation(new Color(FACTION_COLOR[faction]));
        const paint = base.map((c, i) => (c.getHex() === FACTION_COLOR[faction] ? i : -1)).filter((i) => i >= 0);
        expect(paint.length, `${type}/${faction} has paint`).toBeGreaterThan(0);
        for (const i of paint) {
          if (sat > 0.2) expect(saturation(dim[i]) / sat, `${type}/${faction} paint`).toBeCloseTo(0.4, 1);
          else expect(saturation(dim[i])).toBeLessThanOrEqual(sat + 1e-6);
        }
        v.setLook(look({ spent: true }));
        const spentMaterial = paintMaterial(v);
        expect(spentMaterial, `${type}/${faction} a variant of its own`).not.toBe(normal);
        // the spent variant reads the dimmed albedo, and shows 30% of the trim glow
        expect((compile(spentMaterial).uniforms.uSpent as { value: number }).value).toBe(1);
        expect((compile(normal).uniforms.uSpent as { value: number }).value).toBe(0);
        expect(spentMaterial.emissiveIntensity / normal.emissiveIntensity).toBeCloseTo(0.3, 5);
        expect(spentMaterial.emissive.getHex()).toBe(normal.emissive.getHex());
        let hidden = 0;
        modelOf(v).traverse((o) => { if (o instanceof Mesh && !o.visible) hidden += 1; });
        expect(hidden, `${type} nothing hidden`).toBe(0);
        // and back
        v.setLook(look({ spent: false }));
        expect(paintMaterial(v)).toBe(normal);
        v.dispose();
      }
    }
  });

  it('the shared materials are never mutated: a spent unit does not grey its neighbour', () => {
    const a = build('lancer', 'kestrel');
    const b = build('lancer', 'kestrel');
    const before = paintMaterial(b);
    const snapshot = JSON.stringify([before.color, before.emissive, before.emissiveIntensity, before.userData.uniforms]);
    a.setLook(look({ spent: true }));
    expect(paintMaterial(b)).toBe(before);
    expect(JSON.stringify([before.color, before.emissive, before.emissiveIntensity, before.userData.uniforms])).toBe(snapshot);
    expect(paintMaterial(a)).not.toBe(paintMaterial(b));
    a.dispose();
    b.dispose();
  });

  it('known-bad: a unit that is not spent is not told apart as spent', () => {
    const v = build('lancer', 'helion');
    const m = paintMaterial(v);
    // not spent: albedo from `color` (uSpent 0), the full trim glow
    expect((compile(m).uniforms.uSpent as { value: number }).value).toBe(0);
    expect(m.emissiveIntensity).toBeCloseTo(1, 9);
    v.dispose();
  });
});

describe('the muzzle', () => {
  const muzzleOf = (v: UnitView) => v.muzzleWorld(new Vector3());

  it('lies on the weapon that fires, at its tip, in the front half of the model', () => {
    for (const [type, faction] of UNIT_IDS.flatMap((t) => FACTION_IDS.map((f) => [t, f] as const))) {
      const v = build(type, faction);
      const body = footprint(v);
      const m = muzzleOf(v);
      expect(Number.isFinite(m.x + m.y + m.z), type).toBe(true);
      expect(body.clone().expandByScalar(0.01).containsPoint(m), `${type}/${faction} inside the model ${m.toArray().map((n) => n.toFixed(3))}`).toBe(true);
      expect(m.x, `${type} front half`).toBeGreaterThan((body.min.x + body.max.x) / 2);
      // on the weapon: the muzzle marker is a child of the weapon part, and sits at that part's forward end
      const weapon = v.object.getObjectByName('muzzle')?.parent;
      expect(weapon, `${type} has a weapon part`).toBeTruthy();
      const wbox = boneFootprint(weapon as Object3D);
      expect(wbox.clone().expandByScalar(0.012).containsPoint(m), `${type} muzzle on its weapon`).toBe(true);
      expect(m.x, `${type} at the tip`).toBeGreaterThanOrEqual(wbox.max.x - 0.04);
      v.dispose();
    }
  });

  it('follows the heading (heading pi/2 faces +Z), and the unit position', () => {
    const v = build('bastion');
    const east = muzzleOf(v);
    v.setLook(look({ heading: Math.PI / 2 }));
    const south = muzzleOf(v);
    expect(south.z).toBeCloseTo(east.x, 3);
    expect(south.x).toBeCloseTo(-east.z, 3);
    v.object.position.set(5.5, 0.3, 7.5);
    const moved = muzzleOf(v);
    expect(moved.x).toBeCloseTo(5.5 + south.x, 3);
    expect(moved.y).toBeCloseTo(0.3 + south.y, 3);
    v.dispose();
  });

  it('recoils with the weapon on fire (out at t = 0.15, home at 0 and 1), and shots leave a tip that moved back', () => {
    for (const type of UNIT_IDS) {
      const v = build(type);
      const rest = muzzleOf(v).clone();
      v.setPose('fire', 0.15);
      const back = muzzleOf(v);
      expect(rest.x - back.x, `${type} recoil`).toBeGreaterThan(0.015);
      v.setPose('fire', 1);
      expect(muzzleOf(v).distanceTo(rest), `${type} home at t=1`).toBeLessThan(1e-9);
      v.setPose('fire', 0);
      expect(muzzleOf(v).distanceTo(rest), `${type} home at t=0`).toBeLessThan(1e-9);
      v.dispose();
    }
    expect(recoilCurve(0.15)).toBe(1);
    expect(recoilCurve(0)).toBe(0);
    expect(recoilCurve(1)).toBe(0);
    expect(recoilCurve(0.5)).toBeGreaterThan(0);
    expect(recoilCurve(0.5)).toBeLessThan(1);
  });

  it('known-bad: a muzzle moved off the weapon is caught by the same check', () => {
    const v = build('lancer');
    const mark = v.object.getObjectByName('muzzle') as Object3D;
    mark.position.set(-0.3, 0.05, 0.2);
    const m = muzzleOf(v);
    const weapon = mark.parent as Object3D;
    expect(boneFootprint(weapon).clone().expandByScalar(0.012).containsPoint(m)).toBe(false);
    v.dispose();
  });
});

describe('idle motion', () => {
  const idleOf = (v: UnitView) => {
    const idle = v.object.getObjectByName('idle') as Object3D;
    return [idle.position.x, idle.position.y, idle.position.z, idle.rotation.x, idle.rotation.y, idle.rotation.z];
  };
  const range = (v: UnitView, f: (v: UnitView) => number): number => {
    const values: number[] = [];
    for (let t = 0; t < 8; t += 0.05) {
      v.update(0.05, t);
      values.push(f(v));
    }
    return Math.max(...values) - Math.min(...values);
  };

  it('is a pure function of the time and the instance phase (same time, same pose, in any order)', () => {
    for (const type of UNIT_IDS) {
      const a = createUnitViewWithPhase(type, 'helion', 1.1);
      a.update(0.016, 2.5);
      const first = geometrySignature(a);
      const idleFirst = idleOf(a);
      a.update(0.016, 7.9);
      a.update(0.5, 0.1);
      a.update(0.016, 2.5);
      expect(geometrySignature(a), type).toBe(first);
      expect(idleOf(a), type).toEqual(idleFirst);
      const b = createUnitViewWithPhase(type, 'helion', 1.1);
      b.update(0.016, 2.5);
      expect(geometrySignature(b), `${type} same phase, same pose`).toBe(first);
      a.dispose();
      b.dispose();
    }
  });

  it('units do not move in sync: a different phase gives a different pose at the same time', () => {
    for (const type of UNIT_IDS.filter((t) => classOf(t) !== 'tread')) {
      const a = createUnitViewWithPhase(type, 'helion', 0.4);
      const b = createUnitViewWithPhase(type, 'helion', 2.9);
      a.update(0.016, 3);
      b.update(0.016, 3);
      expect(geometrySignature(a), type).not.toBe(geometrySignature(b));
      a.dispose();
      b.dispose();
    }
    // two units made one after the other (the way a battle makes them) get different phases too
    const c = createUnitView('skimmer', 'verdant');
    const d = createUnitView('skimmer', 'verdant');
    c.update(0.016, 1);
    d.update(0.016, 1);
    expect(idleOf(c)).not.toEqual(idleOf(d));
    c.dispose();
    d.dispose();
  });

  it('each type idles as its class: the class comes from the data move type', () => {
    for (const type of UNIT_IDS) {
      const v = createUnitViewWithPhase(type, 'tidewell', 0.7);
      const cls = classOf(type);
      const bob = range(v, (u) => idleOf(u)[1]);
      const roll = range(v, (u) => idleOf(u)[3]);
      const pitch = range(v, (u) => idleOf(u)[5]);
      if (cls === 'hover') {
        expect(bob, `${type} bob`).toBeGreaterThan(0.025);
        expect(roll + pitch, `${type} tilt`).toBeGreaterThan(0.05);
      } else if (cls === 'air') {
        expect(bob, `${type} bob`).toBeGreaterThan(0.04);
        expect(roll + pitch, `${type} tilt`).toBeGreaterThan(0.08);
      } else if (cls === 'ship') {
        expect(roll, `${type} slow roll`).toBeGreaterThan(0.06);
        expect(bob, `${type} heave`).toBeGreaterThan(0.015);
      } else if (cls === 'tread') {
        expect(bob, `${type} grounded`).toBeLessThan(0.004);
        expect(roll + pitch, `${type} grounded`).toBe(0);
      } else if (cls === 'walker') {
        const torso = v.object.getObjectByName('torso') as Object3D;
        const sway = range(v, () => torso.rotation.x);
        expect(sway, `${type} weight shift`).toBeGreaterThan(0.05);
        const legs = [0, 1, 2, 3].map((i) => v.object.getObjectByName(`leg${i}`) as Object3D);
        expect(range(v, () => legs[0].rotation.z), `${type} leg`).toBeGreaterThan(0.1);
      } else {
        const fig = modelOf(v).children.find((c) => c.name === 'figure0') as Object3D;
        expect(range(v, () => fig.position.y), `${type} breathing`).toBeGreaterThan(0.004);
        expect(range(v, () => fig.position.x), `${type} shuffle`).toBeGreaterThan(0.006);
        expect(bob, `${type} the squad is not a hover`).toBe(0);
      }
      v.dispose();
    }
  });

  it('aircraft spin their rotors and fans, and fast: at least a turn a second, opposite hands in pairs', () => {
    for (const [type, names] of [['wasp', ['rotor0', 'rotor1', 'rotor2', 'rotor3']], ['raptor', ['fan0', 'fan1']], ['anvil', ['rotor0', 'rotor1']]] as const) {
      const v = createUnitViewWithPhase(type, 'helion', 0);
      const spin = (name: string, t: number) => {
        v.update(0.016, t);
        return (v.object.getObjectByName(name) as Object3D).rotation.y;
      };
      const rates = names.map((n) => (spin(n, 1.01) - spin(n, 1)) / 0.01);
      for (const r of rates) expect(Math.abs(r), `${type} spin rate`).toBeGreaterThan(Math.PI * 2);
      expect(new Set(rates.map(Math.sign)).size, `${type} has both hands`).toBe(2);
      v.dispose();
    }
  });
});

describe('poses', () => {
  const pose = (v: UnitView) => v.object.getObjectByName('pose') as Object3D;

  it('hit shakes and settles exactly; fire kicks the body back a hair; idle is still', () => {
    const v = build('bastion');
    // the pose group sits at the unit's pivot height (0 for a tread); only the offset from rest counts
    const off = () => pose(v).position.clone().sub(rest);
    const rest = pose(v).position.clone();
    v.setPose('hit', 0.3);
    expect(off().length()).toBeGreaterThan(0.005);
    v.setPose('hit', 1);
    expect(off().length()).toBeLessThan(1e-9);
    v.setPose('fire', 0.15);
    expect(off().x).toBeLessThan(-0.005);
    v.setPose('idle', 0.5);
    expect(off().length() + Math.abs(pose(v).rotation.z)).toBe(0);
    v.dispose();
  });

  it('move leans the unit forward (nose down) in and out smoothly, harder for a hovercraft than for a tread', () => {
    const lean = (type: UnitTypeId) => {
      const v = build(type);
      v.setPose('move', 0);
      expect(pose(v).rotation.z).toBeCloseTo(0, 9);
      v.setPose('move', 1);
      expect(pose(v).rotation.z).toBeCloseTo(0, 9);
      v.setPose('move', 0.5);
      const z = pose(v).rotation.z;
      v.dispose();
      return z;
    };
    expect(lean('lancer')).toBeLessThan(0);
    expect(lean('wasp')).toBeLessThan(lean('lancer'));
    expect(Math.abs(lean('bastion'))).toBeLessThan(Math.abs(lean('lancer')));
  });

  it('move speeds the fans up (about 1.6x on the wasp), and a walker steps harder', () => {
    const v = createUnitViewWithPhase('wasp', 'helion', 0);
    const rate = () => {
      v.update(0.016, 2);
      const a = (v.object.getObjectByName('rotor0') as Object3D).rotation.y;
      v.update(0.016, 2.01);
      return ((v.object.getObjectByName('rotor0') as Object3D).rotation.y - a) / 0.01;
    };
    v.setPose('idle', 0);
    const idle = rate();
    v.setPose('move', 0.5);
    expect(rate() / idle).toBeGreaterThan(1.4);
    expect(rate() / idle).toBeLessThan(1.8);
    v.dispose();
    const w = createUnitViewWithPhase('colossus', 'helion', 0);
    const swing = (p: 'idle' | 'move') => {
      w.setPose(p, 0.5);
      let m = 0;
      for (let t = 0; t < 4; t += 0.05) {
        w.update(0.05, t);
        m = Math.max(m, Math.abs((w.object.getObjectByName('leg0') as Object3D).rotation.z));
      }
      return m;
    };
    expect(swing('move')).toBeGreaterThan(swing('idle') * 1.5);
    w.dispose();
  });
});

describe('look: heading, chips, focus', () => {
  const sprite = (v: UnitView, name: string) => v.object.getObjectByName(name) as Sprite;

  it('heading turns the miniature toward +Z for a positive angle, and the chips do not turn with it', () => {
    const v = build('lancer', 'helion', { heading: Math.PI / 2 });
    const yaw = v.object.getObjectByName('yaw') as Object3D;
    const forward = new Vector3(1, 0, 0).applyEuler(yaw.rotation);
    expect(forward.z).toBeCloseTo(1, 6);
    expect(forward.x).toBeCloseTo(0, 6);
    expect(sprite(v, 'chip:hp').getWorldPosition(new Vector3()).z).toBeGreaterThan(0.2);
    v.dispose();
  });

  it('the HP chip shows below 10 and only then; the status chip shows with a status and only then', () => {
    const v = build('lancer');
    expect(sprite(v, 'chip:hp').visible).toBe(false);
    expect(sprite(v, 'chip:status').visible).toBe(false);
    for (const hp of [9, 5, 1]) {
      v.setLook(look({ hp }));
      expect(sprite(v, 'chip:hp').visible, `hp ${hp}`).toBe(true);
      expect(sprite(v, 'chip:hp').material.map, 'a texture is attached').toBeTruthy();
    }
    v.setLook(look({ hp: 10 }));
    expect(sprite(v, 'chip:hp').visible).toBe(false);
    for (const status of ['capturing', 'low-charge', 'low-ammo', 'loaded'] as const) {
      v.setLook(look({ status }));
      expect(sprite(v, 'chip:status').visible, status).toBe(true);
    }
    v.setLook(look({ status: null }));
    expect(sprite(v, 'chip:status').visible).toBe(false);
    v.dispose();
  });

  it('different HP values and statuses get different chips; the same one is shared between units', () => {
    const a = build('lancer', 'helion', { hp: 5 });
    const b = build('arc', 'tidewell', { hp: 5 });
    const c = build('arc', 'tidewell', { hp: 6 });
    expect(sprite(a, 'chip:hp').material).toBe(sprite(b, 'chip:hp').material);
    expect(sprite(a, 'chip:hp').material).not.toBe(sprite(c, 'chip:hp').material);
    a.setLook(look({ hp: 5, status: 'low-ammo' }));
    a.setLook(look({ hp: 5, status: 'low-charge' }));
    expect(resourcesOf(a).textures.size).toBe(2);
    for (const v of [a, b, c]) v.dispose();
  });

  it('focus shows the ring at the base, and only when focused', () => {
    const v = build('lancer');
    const ring = v.object.getObjectByName('ring') as Object3D;
    expect(ring.visible).toBe(false);
    v.setLook(look({ focused: true }));
    expect(ring.visible).toBe(true);
    expect(ring.position.y).toBeLessThan(0.05);
    v.setLook(look({ focused: false }));
    expect(ring.visible).toBe(false);
    v.dispose();
  });
});

describe('dispose and sharing', () => {
  it('dispose frees everything the last unit of a look holds, and nothing while another still uses it', () => {
    expect(resourceStats()).toEqual({ geometries: 0, materials: 0, textures: 0, looks: 0 });
    const a = build('colossus', 'verdant', { hp: 4, status: 'loaded', focused: true, spent: true });
    const b = build('colossus', 'verdant', { hp: 4, status: 'loaded', focused: true });
    const used = resourcesOf(a);
    const bUsed = resourcesOf(b);
    const freed: object[] = [];
    for (const r of [...used.geometries, ...used.materials, ...used.textures, ...bUsed.geometries, ...bUsed.materials]) {
      (r as { addEventListener: (t: string, f: () => void) => void }).addEventListener('dispose', () => freed.push(r));
    }
    expect(used.geometries.size).toBeGreaterThan(0);
    expect(used.textures.size).toBe(2);
    a.dispose();
    // b is still alive: the geometry, the paint it shows and its chips and ring must all still be there
    for (const g of bUsed.geometries) expect(freed.includes(g), 'a shared geometry survives the first dispose').toBe(false);
    for (const m of bUsed.materials) expect(freed.includes(m), 'a shared material survives the first dispose').toBe(false);
    b.dispose();
    for (const set of [used.geometries, used.materials, used.textures, bUsed.geometries, bUsed.materials]) {
      for (const r of set) expect(freed.includes(r), 'freed after the last dispose').toBe(true);
    }
    expect(resourceStats()).toEqual({ geometries: 0, materials: 0, textures: 0, looks: 0 });
    // idempotent, and a disposed view ignores later calls
    a.dispose();
    a.setLook(look({ hp: 3 }));
    a.update(0.016, 1);
    a.setPose('fire', 0.2);
    expect(resourceStats().geometries).toBe(0);
  });

  it('every look can be disposed and rebuilt (the cache is empty between)', () => {
    for (const [type, faction] of UNIT_IDS.flatMap((t) => FACTION_IDS.map((f) => [t, f] as const))) {
      const v = build(type, faction, { hp: 3, status: 'low-ammo', spent: true, focused: true });
      v.dispose();
    }
    expect(resourceStats()).toEqual({ geometries: 0, materials: 0, textures: 0, looks: 0 });
    const again = build('lancer', 'helion');
    expect(visibleTriangles(modelOf(again))).toBeGreaterThan(300);
    again.dispose();
  });

  it('forty units share their geometry, materials and chips (the counts are printed)', () => {
    // two armies of 20, Helion against Tidewell, the 16 types round-robin, HP and status mixed, a few spent
    const views: UnitView[] = [];
    for (let i = 0; i < 40; i += 1) {
      const faction: FactionId = i % 2 === 0 ? 'helion' : 'tidewell';
      const v = createUnitView(UNIT_IDS[i % 16], faction);
      v.setLook(look({ hp: 1 + (i % 10), spent: i % 5 === 0, status: i % 7 === 0 ? 'low-ammo' : i % 11 === 0 ? 'loaded' : null, focused: i === 3 }));
      views.push(v);
    }
    const geos = new Set<object>();
    const mats = new Set<Material>();
    const texs = new Set<object>();
    let meshes = 0;
    let drawCalls = 0;
    let tris = 0;
    for (const v of views) {
      const r = resourcesOf(v);
      r.geometries.forEach((g) => geos.add(g));
      r.materials.forEach((m) => mats.add(m));
      r.textures.forEach((t) => texs.add(t));
      v.object.traverse((o) => { if (o instanceof Mesh) meshes += 1; });
      drawCalls += visibleDrawCalls(v);
      tris += visibleTriangles(modelOf(v));
    }
    const stats = resourceStats();
    // eslint-disable-next-line no-console
    console.info(`[units] 40 units: ${meshes} meshes and ${drawCalls} draw calls share ${geos.size} geometries, ${mats.size} materials and ${texs.size} chip textures (${stats.looks} distinct looks); ${tris} triangles on screen`);
    expect(geos.size).toBeLessThan(meshes / 2);
    // 40 units, two factions: a material and its spent variant each, the one shared rotor blur, the 2 ring materials, and the shared chip materials
    expect(mats.size).toBeLessThanOrEqual(2 * 2 + 1 + 2 + texs.size);
    expect(texs.size).toBeLessThanOrEqual(10 + 2);
    expect(stats.geometries).toBeLessThanOrEqual(geos.size);
    for (const v of views) v.dispose();
    expect(resourceStats()).toEqual({ geometries: 0, materials: 0, textures: 0, looks: 0 });
  });
});

// ---- helpers local to the tests

function footprintOfGroup(g: Object3D): Box3 {
  g.updateMatrixWorld(true);
  return new Box3().setFromObject(g, true);
}
