// The three aircraft: wasp, raptor, anvil. They hover above their tile (the terrain's height is the ground below them);
// Model space: y = 0 is the ground, so every part sits at an altitude.
import type { FactionId } from '../../../game/aw';
import type { UnitViewOptions } from '../contract';
import { cab, dress } from './factions';
import type { Anchors } from './factions';
import { Kit } from './kit';
import type { V3 } from './kit';
import { rotor, rotorBlur } from './parts';
import { Rig } from './recipe';
import type { Recipe } from './recipe';

const SIDES = [-1, 1] as const;

/** Wasp: a gunship drone. A small pod slung under four spinning rotors on diagonal arms, with a chin gun and missile pods. */
export function wasp(f: FactionId, o?: UnitViewOptions): Recipe {
  const Y = 0.36;
  const k = new Kit();
  k.hull('paint', [
    [0.22, Y, 0], [0.12, Y - 0.045, 0.06], [0.12, Y - 0.045, -0.06], [0.12, Y + 0.05, 0.05], [0.12, Y + 0.05, -0.05],
    [-0.18, Y - 0.03, 0.05], [-0.18, Y - 0.03, -0.05], [-0.18, Y + 0.035, 0.04], [-0.18, Y + 0.035, -0.04], [-0.24, Y + 0.01, 0],
  ]);
  k.box('dark', [0.2, 0.03, 0.08], [0, Y - 0.055, 0]);
  cab(k, f, [0.1, Y + 0.045, 0], [0.12, 0.08, 0.1]);
  const fin: V3[] = [];
  for (const e of [-0.008, 0.008]) fin.push([-0.1, Y + 0.03, e], [-0.24, Y + 0.01, e], [-0.23, Y + 0.12, e]);
  k.hull('paint', fin);
  for (const s of SIDES) {
    k.box('paint', [0.1, 0.016, 0.07], [0.0, Y - 0.01, s * 0.075]);
    k.box('dark', [0.15, 0.045, 0.045], [0.04, Y - 0.02, s * 0.11]);
    k.cone('trim', 0.022, 0.045, 5, [0.14, Y - 0.02, s * 0.11]);
  }
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      k.limb('dark', [sx * 0.05, Y + 0.02, sz * 0.045], [sx * 0.2, Y + 0.045, sz * 0.215], 0.014, 0.012, 5);
      k.cyl('dark', 0.032, 0.036, 0.04, 6, [sx * 0.2, Y + 0.04, sz * 0.215]);
    }
  }
  const a: Anchors = {
    sigil: { x: -0.05, y: Y + 0.052, size: 0.075 },
    deck: { x: -0.06, y: Y + 0.05, len: 0.2, wid: 0.1 },
    flank: { x0: -0.17, x1: 0.05, y: Y, z: 0.05, h: 0.07 },
    nose: { x: 0.22, y: Y },
    fins: false,
    scale: 0.6,
    reach: 0.0,
  };
  dress(k, f, a, o);
  for (const sx of SIDES) for (const sz of SIDES) rotorBlur(k, 0.1, [sx * 0.2, Y + 0.083, sz * 0.215]);
  const gun = new Kit();
  gun.box('dark', [0.05, 0.035, 0.04], [0.01, 0, 0]);
  gun.barrel('dark', 0.014, 0.011, 0.02, 0.2, 0, 0, 5);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('gun', null, [0.17, Y - 0.05, 0], [0, 0, 0], gun);
  rig.recoil.push({ node: 'gun', dist: 0.04 });
  let i = 0;
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      const r = new Kit();
      rotor(r, 0.1, 2);
      rig.node(`rotor${i}`, null, [sx * 0.2, Y + 0.065, sz * 0.215], [0, 0, 0], r);
      rig.tracks.push({ node: `rotor${i}`, kind: 'spin', prop: 'rot', axis: 1, hz: (sx * sz > 0 ? 1 : -1) * 26, move: 1.6 });
      i += 1;
    }
  }
  return rig.seal('wasp', f, 'air', { node: 'gun', at: [0.2, 0, 0] });
}

/** Raptor: air superiority. A dart fuselage, swept wings, twin canted tails, a hot exhaust and a ducted lift fan on each wingtip. */
export function raptor(f: FactionId, o?: UnitViewOptions): Recipe {
  const Y = 0.42;
  const k = new Kit();
  k.hull('paint', [
    [0.37, Y, 0], [0.2, Y - 0.025, 0.045], [0.2, Y - 0.025, -0.045], [0.2, Y + 0.04, 0.04], [0.2, Y + 0.04, -0.04],
    [-0.2, Y - 0.03, 0.06], [-0.2, Y - 0.03, -0.06], [-0.2, Y + 0.05, 0.05], [-0.2, Y + 0.05, -0.05], [-0.33, Y, 0.04], [-0.33, Y, -0.04],
  ]);
  cab(k, f, [0.14, Y + 0.04, 0], [0.2, 0.07, 0.08]);
  for (const s of SIDES) {
    const wing: V3[] = [];
    for (const e of [-0.008, 0.008]) wing.push([0.1, Y + e, s * 0.05], [-0.16, Y + e, s * 0.3], [-0.26, Y + e, s * 0.3], [-0.3, Y + e, s * 0.05]);
    k.hull('paint', wing);
    k.line('trim', [0.1, s * 0.05], [-0.16, s * 0.3], 0.012, Y + 0.0095);
    k.cyl('dark', 0.052, 0.058, 0.045, 8, [-0.2, Y - 0.002, s * 0.315]);
    k.ring('trim', 0.046, 0.06, 8, [-0.2, Y + 0.0216, s * 0.315]);
    k.axial('dark', 0.012, 0.15, 5, [0.0, Y - 0.035, s * 0.16]);
    k.cone('trim', 0.012, 0.035, 5, [0.095, Y - 0.035, s * 0.16]);
    const tail: V3[] = [];
    for (const e of [-0.007, 0.007]) tail.push([-0.2, Y + 0.04, s * 0.05 + e], [-0.335, Y + 0.04, s * 0.05 + e], [-0.35, Y + 0.16, s * 0.09 + e]);
    k.hull('paint', tail);
  }
  k.axial('dark', 0.045, 0.05, 8, [-0.34, Y, 0]);
  k.axial('trim', 0.034, 0.012, 8, [-0.368, Y, 0]);
  const a: Anchors = {
    sigil: { x: -0.08, y: Y + 0.052, size: 0.075 },
    deck: { x: -0.08, y: Y + 0.05, len: 0.2, wid: 0.09 },
    flank: { x0: -0.24, x1: 0.0, y: Y + 0.006, z: 0.1, h: 0.04 },
    nose: { x: 0.37, y: Y },
    fins: true,
    scale: 0.6,
    reach: 0.09,
  };
  dress(k, f, a, o);
  const gun = new Kit();
  gun.barrel('dark', 0.012, 0.01, 0, 0.09, 0, 0, 5);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('gun', null, [0.3, Y - 0.02, 0], [0, 0, 0], gun);
  rig.recoil.push({ node: 'gun', dist: 0.03 });
  for (const [i, s] of SIDES.entries()) {
    const r = new Kit();
    rotor(r, 0.05, 3);
    rig.node(`fan${i}`, null, [-0.2, Y + 0.03, s * 0.315], [0, 0, 0], r);
    rig.tracks.push({ node: `fan${i}`, kind: 'spin', prop: 'rot', axis: 1, hz: s * 34, move: 1.6 });
  }
  return rig.seal('raptor', f, 'air', { node: 'gun', at: [0.09, 0, 0] });
}

/** Anvil: a strike bomber. A broad flying wing with a fat fuselage, two big lift rotors, wing missile pods and twin chin cannons. */
export function anvil(f: FactionId, o?: UnitViewOptions): Recipe {
  const Y = 0.38;
  const k = new Kit();
  k.hull('paint', [
    [0.3, Y - 0.01, 0], [0.26, Y - 0.05, 0.07], [0.26, Y - 0.05, -0.07], [0.26, Y + 0.055, 0.06], [0.26, Y + 0.055, -0.06],
    [-0.2, Y - 0.06, 0.1], [-0.2, Y - 0.06, -0.1], [-0.2, Y + 0.07, 0.09], [-0.2, Y + 0.07, -0.09], [-0.34, Y, 0.07], [-0.34, Y, -0.07],
  ]);
  cab(k, f, [0.18, Y + 0.06, 0], [0.2, 0.08, 0.1]);
  const stab: V3[] = [];
  const fin: V3[] = [];
  for (const e of [-0.008, 0.008]) {
    stab.push([-0.26, Y + 0.02 + e, 0.04], [-0.26, Y + 0.02 + e, -0.04], [-0.33, Y + 0.02 + e, 0.2], [-0.33, Y + 0.02 + e, -0.2], [-0.38, Y + 0.02 + e, 0.2], [-0.38, Y + 0.02 + e, -0.2]);
    fin.push([-0.18, Y + 0.07, e], [-0.34, Y + 0.03, e], [-0.33, Y + 0.18, e]);
  }
  k.hull('paint', stab);
  k.hull('paint', fin);
  for (const s of SIDES) {
    const wing: V3[] = [];
    for (const e of [-0.02, 0.02]) wing.push([0.12, Y + e, s * 0.08], [-0.02, Y + e, s * 0.365], [-0.2, Y + e, s * 0.365], [-0.3, Y + e, s * 0.08]);
    k.hull('paint', wing);
    k.line('trim', [0.12, s * 0.08], [-0.02, s * 0.365], 0.014, Y + 0.0205);
    k.cyl('dark', 0.058, 0.066, 0.1, 8, [-0.02, Y + 0.03, s * 0.245]);
    k.axial('dark', 0.026, 0.12, 6, [0.1, Y - 0.01, s * 0.2]);
    k.cone('trim', 0.026, 0.05, 6, [0.185, Y - 0.01, s * 0.2]);
  }
  const a: Anchors = {
    sigil: { x: -0.02, y: Y + 0.075, size: 0.1 },
    deck: { x: -0.12, y: Y + 0.07, len: 0.22, wid: 0.16 },
    flank: { x0: -0.26, x1: -0.02, y: Y + 0.02, z: 0.1, h: 0.05 },
    nose: { x: 0.3, y: Y },
    fins: true,
    scale: 0.7,
    reach: 0.07,
  };
  dress(k, f, a, o);
  for (const s of SIDES) rotorBlur(k, 0.12, [-0.02, Y + 0.103, s * 0.245]);
  const gun = new Kit();
  gun.box('dark', [0.05, 0.04, 0.1], [0.005, 0, 0]);
  for (const s of SIDES) gun.barrel('dark', 0.015, 0.012, 0.0, 0.12, 0, s * 0.03, 5);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('gun', null, [0.27, Y - 0.04, 0], [0, 0, 0], gun);
  rig.recoil.push({ node: 'gun', dist: 0.04 });
  for (const [i, s] of SIDES.entries()) {
    const r = new Kit();
    rotor(r, 0.12, 3);
    rig.node(`rotor${i}`, null, [-0.02, Y + 0.085, s * 0.245], [0, 0, 0], r);
    rig.tracks.push({ node: `rotor${i}`, kind: 'spin', prop: 'rot', axis: 1, hz: s * 16, move: 1.7 });
  }
  return rig.seal('anvil', f, 'air', { node: 'gun', at: [0.12, 0, 0.03] });
}
