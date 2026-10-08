// The eight vehicles: skimmer, lancer, bastion, colossus, mule, arc, salvo, warden. Model space: feet at y = 0, +X forward.
import type { FactionId } from '../../../game/aw';
import { cab, dress } from './factions';
import type { Anchors } from './factions';
import { Kit, taperPoints } from './kit';
import type { V3 } from './kit';
import { hoverGlow, trackPair } from './parts';
import { Rig } from './recipe';
import type { Recipe } from './recipe';

const PI = Math.PI;
const SIDES = [-1, 1] as const;

/** Skimmer: a sleek hover scout. Arrowhead fuselage, two fan pods, a bubble canopy, tail fins and a light nose gun. */
export function skimmer(f: FactionId): Recipe {
  const k = new Kit();
  k.hull('paint', [
    [0.3, 0.15, 0], [0.3, 0.12, 0],
    [0.1, 0.09, 0.12], [0.1, 0.09, -0.12], [0.12, 0.2, 0.07], [0.12, 0.2, -0.07],
    [-0.22, 0.09, 0.15], [-0.22, 0.09, -0.15], [-0.22, 0.21, 0.1], [-0.22, 0.21, -0.1],
    [-0.31, 0.1, 0.08], [-0.31, 0.1, -0.08], [-0.31, 0.19, 0.05], [-0.31, 0.19, -0.05],
  ]);
  k.hull('dark', taperPoints(0.5, 0.18, 0.44, 0.14, 0.035, 0).map((p): V3 => [p[0] - 0.02, p[1] + 0.082, p[2]]));
  hoverGlow(k, -0.03, 0, 0.085, 0.056);
  for (const s of SIDES) {
    k.cyl('dark', 0.085, 0.075, 0.07, 8, [-0.05, 0.1, s * 0.235]);
    hoverGlow(k, -0.05, s * 0.235, 0.062, 0.058);
    k.ring('trim', 0.035, 0.068, 8, [-0.05, 0.138, s * 0.235]);
    k.box('paint', [0.1, 0.03, 0.08], [-0.05, 0.14, s * 0.18]);
    const t = 0.007;
    const zc = s * 0.075;
    const pts: V3[] = [];
    for (const e of [-t, t]) pts.push([-0.19, 0.2, zc + e], [-0.31, 0.19, zc + e], [-0.31, 0.33, zc + e + s * 0.03]);
    k.hull('paint', pts);
  }
  cab(k, f, [0.08, 0.215, 0], [0.13, 0.08, 0.11]);
  const a: Anchors = {
    sigil: { x: -0.1, y: 0.205, size: 0.085 },
    deck: { x: -0.1, y: 0.205, len: 0.24, wid: 0.14 },
    flank: { x0: -0.25, x1: -0.08, y: 0.15, z: 0.12, h: 0.1 },
    nose: { x: 0.28, y: 0.15 },
    fins: true,
    scale: 0.7,
    reach: 0.06,
  };
  dress(k, f, a);
  const gun = new Kit();
  gun.box('dark', [0.05, 0.032, 0.04], [0.015, 0, 0]);
  gun.barrel('dark', 0.013, 0.011, 0.02, 0.12, 0, 0, 5);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('gun', null, [0.27, 0.135, 0], [0, 0, 0], gun);
  rig.recoil.push({ node: 'gun', dist: 0.04 });
  return rig.seal('skimmer', f, 'hover', { node: 'gun', at: [0.12, 0, 0] });
}

/** Lancer: a hover tank. Wedge hull on side skirts, a low turret and one long lance of a gun. */
export function lancer(f: FactionId): Recipe {
  const k = new Kit();
  k.hull('paint', [
    [-0.3, 0.085, 0.22], [-0.3, 0.085, -0.22], [0.3, 0.085, 0.17], [0.3, 0.085, -0.17],
    [-0.26, 0.2, 0.17], [-0.26, 0.2, -0.17], [0.16, 0.2, 0.15], [0.16, 0.2, -0.15],
  ]);
  for (const s of SIDES) {
    k.box('dark', [0.54, 0.07, 0.07], [-0.02, 0.095, s * 0.265]);
    k.box('trim', [0.46, 0.012, 0.035], [-0.02, 0.054, s * 0.265]);
    k.axial('dark', 0.045, 0.07, 8, [-0.32, 0.15, s * 0.1]);
    k.axial('trim', 0.034, 0.012, 8, [-0.357, 0.15, s * 0.1]);
    // lift-fan rings on the skirts: a hovercraft reads as hovering from above
    for (const x of [0.17, -0.19]) k.ring('trim', 0.022, 0.042, 8, [x, 0.134, s * 0.265]);
  }
  hoverGlow(k, 0, 0, 0.13, 0.05);
  // turret, set back to leave a front deck
  k.hull('paint', [
    [-0.23, 0.2, 0.13], [-0.23, 0.2, -0.13], [0.08, 0.2, 0.12], [0.08, 0.2, -0.12],
    [-0.18, 0.285, 0.09], [-0.18, 0.285, -0.09], [0.04, 0.285, 0.08], [0.04, 0.285, -0.08], [0.12, 0.24, 0.05], [0.12, 0.24, -0.05],
  ]);
  k.box('dark', [0.05, 0.07, 0.1], [0.115, 0.245, 0]);
  cab(k, f, [-0.2, 0.215, 0], [0.07, 0.04, 0.1]);
  const a: Anchors = {
    sigil: { x: -0.07, y: 0.285, size: 0.095 },
    deck: { x: 0.115, y: 0.2, len: 0.1, wid: 0.27 },
    flank: { x0: -0.28, x1: 0.02, y: 0.17, z: 0.19, h: 0.1 },
    nose: { x: 0.3, y: 0.1 },
    fins: true,
    scale: 0.8,
    reach: 0.08,
  };
  dress(k, f, a);
  const gun = new Kit();
  gun.barrel('dark', 0.022, 0.017, 0, 0.24, 0, 0, 6);
  gun.axial('trim', 0.027, 0.028, 6, [0.225, 0, 0]);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('gun', null, [0.14, 0.245, 0], [0, 0, 0], gun);
  rig.recoil.push({ node: 'gun', dist: 0.07 });
  return rig.seal('lancer', f, 'hover', { node: 'gun', at: [0.24, 0, 0] });
}

/** Bastion: a heavy grav-tank. Wide tracks, a slab hull, a square turret and one fat gun with a bore bulge. */
export function bastion(f: FactionId): Recipe {
  const k = new Kit();
  trackPair(k, { len: 0.7, z: 0.235, w: 0.13, h: 0.16, wheels: 4, wheelR: 0.052 });
  k.hull('paint', [
    [-0.32, 0.14, 0.17], [-0.32, 0.14, -0.17], [0.34, 0.14, 0.15], [0.34, 0.14, -0.15],
    [-0.3, 0.26, 0.15], [-0.3, 0.26, -0.15], [0.2, 0.26, 0.13], [0.2, 0.26, -0.13],
  ]);
  for (const s of SIDES) k.box('paint', [0.66, 0.025, 0.1], [0, 0.172, s * 0.235]);
  // square turret and mantlet
  k.chamfer('paint', [0.32, 0.13, 0.3], 0.03, [-0.06, 0.325, 0]);
  k.hull('paint', [[0.1, 0.265, 0.11], [0.1, 0.265, -0.11], [0.19, 0.285, 0.07], [0.19, 0.285, -0.07], [0.19, 0.36, 0.07], [0.19, 0.36, -0.07], [0.1, 0.39, 0.11], [0.1, 0.39, -0.11]]);
  k.cyl('dark', 0.045, 0.048, 0.04, 8, [-0.14, 0.41, 0.075]);
  cab(k, f, [-0.14, 0.43, 0.075], [0.07, 0.04, 0.07]);
  k.box('trim', [0.012, 0.03, 0.06], [-0.325, 0.2, 0.09]);
  k.box('trim', [0.012, 0.03, 0.06], [-0.325, 0.2, -0.09]);
  const a: Anchors = {
    sigil: { x: -0.07, y: 0.39, size: 0.12 },
    deck: { x: 0.155, y: 0.26, len: 0.09, wid: 0.26 },
    flank: { x0: -0.3, x1: 0.05, y: 0.2, z: 0.23, h: 0.1 },
    nose: { x: 0.34, y: 0.14 },
    fins: true,
    scale: 1,
    reach: 0.08,
  };
  dress(k, f, a);
  const gun = new Kit();
  gun.barrel('dark', 0.034, 0.028, 0, 0.2, 0, 0, 6);
  gun.axial('paint', 0.043, 0.06, 6, [0.07, 0, 0]);
  gun.axial('trim', 0.037, 0.026, 6, [0.187, 0, 0]);
  gun.barrel('dark', 0.01, 0.01, 0, 0.1, -0.02, 0.075, 4);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('gun', null, [0.19, 0.33, 0], [0, 0, 0], gun);
  rig.recoil.push({ node: 'gun', dist: 0.06 });
  return rig.seal('bastion', f, 'tread', { node: 'gun', at: [0.2, 0, 0] });
}

/** Colossus: a siege walker. Four splayed legs, a tall battery hull and twin cannons. The tallest ground unit. */
export function colossus(f: FactionId): Recipe {
  const rig = new Rig();
  const hipY = 0.44;
  const torso = new Kit();
  // everything in the torso node is authored relative to the hip height
  torso.chamfer('dark', [0.3, 0.06, 0.3], 0.012, [0, -0.03, 0]);
  torso.chamfer('paint', [0.36, 0.17, 0.34], 0.03, [-0.02, 0.085, 0]);
  torso.hull('paint', [
    [-0.08, 0.17, 0.15], [-0.08, 0.17, -0.15], [0.2, 0.17, 0.14], [0.2, 0.17, -0.14],
    [-0.04, 0.27, 0.12], [-0.04, 0.27, -0.12], [0.12, 0.25, 0.11], [0.12, 0.25, -0.11],
  ]);
  torso.box('dark', [0.1, 0.1, 0.26], [0.19, 0.2, 0]);
  torso.box('trim', [0.012, 0.03, 0.2], [-0.2, 0.11, 0]);
  torso.box('trim', [0.012, 0.03, 0.2], [-0.2, 0.05, 0]);
  cab(torso, f, [-0.1, 0.275, 0], [0.12, 0.05, 0.16]);
  const a: Anchors = {
    sigil: { x: 0.04, y: 0.27, size: 0.1 },
    deck: { x: -0.14, y: 0.17, len: 0.08, wid: 0.3 },
    flank: { x0: -0.16, x1: 0.1, y: 0.08, z: 0.17, h: 0.12 },
    nose: { x: 0.16, y: 0.17 },
    fins: false,
    scale: 1,
    reach: 0.0,
  };
  dress(torso, f, a);
  rig.node('torso', null, [0, hipY, 0], [0, 0, 0], torso);
  const legs: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  legs.forEach(([sx, sz], i) => {
    const l = new Kit();
    const knee: V3 = [sx * 0.09, -0.12, sz * 0.12];
    const ankle: V3 = [sx * 0.105, -0.395, sz * 0.14];
    l.sphere('dark', [0.055, 0.05, 0.055], [0, 0, 0], 6, 4);
    l.limb('paint', [0, 0, 0], knee, 0.045, 0.035);
    l.sphere('dark', [0.04, 0.04, 0.04], knee, 5, 3);
    l.limb('dark', knee, ankle, 0.034, 0.028);
    l.box('dark', [0.13, 0.04, 0.13], [ankle[0] + sx * 0.008, -0.42, ankle[2]]);
    rig.node(`leg${i}`, 'torso', [sx * 0.13, 0, sz * 0.15], [0, 0, 0], l);
    // diagonal pairs step together
    rig.tracks.push({ node: `leg${i}`, kind: 'sin', prop: 'rot', axis: 2, amp: 0.06, hz: 0.45, phase: sx * sz > 0 ? 0 : PI, move: 1.7 });
    rig.tracks.push({ node: `leg${i}`, kind: 'sin', prop: 'pos', axis: 1, amp: 0.012, hz: 0.45, phase: sx * sz > 0 ? PI / 2 : PI * 1.5, base: 0.012, move: 2 });
  });
  rig.tracks.push({ node: 'torso', kind: 'sin', prop: 'rot', axis: 0, amp: 0.035, hz: 0.45, phase: 0, move: 1.4 });
  rig.tracks.push({ node: 'torso', kind: 'sin', prop: 'pos', axis: 2, amp: 0.012, hz: 0.45, phase: PI / 2, move: 1.5 });
  const gun = new Kit();
  gun.box('paint', [0.07, 0.11, 0.26], [0.0, 0, 0]);
  for (const s of SIDES) {
    gun.barrel('dark', 0.033, 0.027, 0.02, 0.16, 0, s * 0.085, 6);
    gun.axial('trim', 0.036, 0.025, 6, [0.147, 0, s * 0.085]);
  }
  rig.node('gun', 'torso', [0.225, 0.2, 0], [0, 0, 0], gun);
  rig.recoil.push({ node: 'gun', dist: 0.07 });
  return rig.seal('colossus', f, 'walker', { node: 'gun', at: [0.16, 0, 0.085] });
}

/** Mule: a hover transport. A cab up front, a big ribbed cargo container behind it, four fan skirts. Carries and resupplies. */
export function mule(f: FactionId): Recipe {
  const k = new Kit();
  k.chamfer('dark', [0.66, 0.06, 0.4], 0.012, [0, 0.085, 0]);
  for (const sx of SIDES) {
    for (const sz of SIDES) {
      k.cyl('dark', 0.06, 0.055, 0.05, 8, [sx * 0.21, 0.07, sz * 0.24]);
      hoverGlow(k, sx * 0.21, sz * 0.24, 0.045, 0.043);
      k.ring('trim', 0.03, 0.056, 8, [sx * 0.21, 0.099, sz * 0.25]);
    }
  }
  k.chamfer('paint', [0.66, 0.07, 0.42], 0.015, [0, 0.15, 0]);
  // cab with a raked windscreen
  k.hull('paint', [
    [0.12, 0.185, 0.17], [0.12, 0.185, -0.17], [0.34, 0.185, 0.17], [0.34, 0.185, -0.17],
    [0.12, 0.34, 0.15], [0.12, 0.34, -0.15], [0.22, 0.34, 0.15], [0.22, 0.34, -0.15], [0.33, 0.27, 0.15], [0.33, 0.27, -0.15],
  ]);
  if (f === 'choir') cab(k, f, [0.32, 0.29, 0], [0.1, 0.1, 0.2]);
  else k.box('glass', [0.13, 0.01, 0.26], [0.285, 0.305, 0], [0, 0, -0.51]);
  // cargo container
  k.chamfer('paint', [0.4, 0.22, 0.42], 0.012, [-0.14, 0.3, 0]);
  for (const x of [-0.26, -0.14, -0.02]) k.box('dark', [0.02, 0.222, 0.432], [x, 0.3, 0]);
  for (const s of SIDES) k.box('trim', [0.36, 0.008, 0.022], [-0.14, 0.411, s * 0.13]);
  k.box('dark', [0.07, 0.07, 0.2], [0.075, 0.22, 0]);
  const a: Anchors = {
    sigil: { x: -0.2, y: 0.41, size: 0.11 },
    deck: { x: -0.14, y: 0.41, len: 0.34, wid: 0.36 },
    flank: { x0: -0.33, x1: 0.03, y: 0.3, z: 0.21, h: 0.2 },
    nose: { x: 0.34, y: 0.2 },
    fins: true,
    scale: 1,
    reach: 0.07,
  };
  dress(k, f, a);
  const bump = new Kit();
  bump.box('dark', [0.03, 0.045, 0.3], [0, 0, 0]);
  bump.box('trim', [0.012, 0.012, 0.26], [0.014, 0, 0]);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('bumper', null, [0.355, 0.15, 0], [0, 0, 0], bump);
  rig.recoil.push({ node: 'bumper', dist: 0.025 });
  return rig.seal('mule', f, 'hover', { node: 'bumper', at: [0.02, 0, 0] });
}

/** Arc Battery: rail artillery. A low tracked carrier under one long raised rail gun with glowing coils. */
export function arc(f: FactionId): Recipe {
  const k = new Kit();
  trackPair(k, { len: 0.56, z: 0.21, w: 0.12, h: 0.14, wheels: 3, wheelR: 0.045 });
  k.chamfer('paint', [0.5, 0.1, 0.3], 0.02, [0, 0.19, 0]);
  k.chamfer('paint', [0.14, 0.1, 0.2], 0.02, [0.2, 0.29, 0]);
  cab(k, f, [0.265, 0.3, 0], [0.05, 0.05, 0.14]);
  // cradle and recoil spade
  k.box('dark', [0.16, 0.08, 0.2], [-0.06, 0.28, 0]);
  for (const s of SIDES) {
    const pts: V3[] = [];
    for (const e of [-0.009, 0.009]) pts.push([-0.16, 0.24, s * 0.105 + e], [0.02, 0.24, s * 0.105 + e], [-0.06, 0.38, s * 0.105 + e]);
    k.hull('paint', pts);
    k.box('dark', [0.09, 0.06, 0.06], [-0.2, 0.275, s * 0.14]);
  }
  const spade: V3[] = [];
  for (const sz of SIDES) spade.push([-0.25, 0.01, sz * 0.09], [-0.34, 0.0, sz * 0.09], [-0.25, 0.14, sz * 0.09]);
  k.hull('dark', spade);
  const a: Anchors = {
    sigil: { x: 0.065, y: 0.24, size: 0.085 },
    deck: { x: 0.07, y: 0.24, len: 0.1, wid: 0.26 },
    flank: { x0: -0.25, x1: 0.1, y: 0.2, z: 0.15, h: 0.1 },
    nose: { x: 0.32, y: 0.2 },
    fins: true,
    scale: 0.9,
    reach: 0.07,
  };
  dress(k, f, a);
  const gun = new Kit();
  gun.box('paint', [0.46, 0.045, 0.05], [0.12, 0, 0]);
  for (const s of SIDES) gun.box('dark', [0.46, 0.026, 0.026], [0.13, 0, s * 0.036]);
  for (const x of [-0.03, 0.08, 0.19]) gun.axial('trim', 0.052, 0.018, 8, [x, 0, 0]);
  gun.axial('trim', 0.022, 0.02, 6, [0.355, 0, 0]);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('gun', null, [-0.06, 0.34, 0], [0, 0, 0.55], gun);
  rig.recoil.push({ node: 'gun', dist: 0.075 });
  return rig.seal('arc', f, 'tread', { node: 'gun', at: [0.365, 0, 0] });
}

/** Salvo: a missile platform. A cab on a tracked carrier and a tilted 2 x 3 rack of missile tubes with glowing noses. */
export function salvo(f: FactionId): Recipe {
  const k = new Kit();
  trackPair(k, { len: 0.6, z: 0.22, w: 0.12, h: 0.14, wheels: 4, wheelR: 0.045 });
  k.chamfer('paint', [0.56, 0.1, 0.34], 0.02, [0, 0.19, 0]);
  k.chamfer('paint', [0.17, 0.12, 0.26], 0.02, [0.23, 0.3, 0]);
  cab(k, f, [0.31, 0.315, 0], [0.06, 0.07, 0.2]);
  k.box('dark', [0.14, 0.1, 0.3], [-0.12, 0.27, 0]);
  for (const s of SIDES) {
    const pts: V3[] = [];
    for (const e of [-0.01, 0.01]) pts.push([-0.22, 0.24, s * 0.16 + e], [-0.04, 0.24, s * 0.16 + e], [-0.12, 0.35, s * 0.16 + e]);
    k.hull('paint', pts);
  }
  const a: Anchors = {
    sigil: { x: 0.23, y: 0.36, size: 0.085 },
    deck: { x: 0.0, y: 0.24, len: 0.1, wid: 0.28 },
    flank: { x0: -0.26, x1: 0.1, y: 0.2, z: 0.17, h: 0.1 },
    nose: { x: 0.31, y: 0.3 },
    fins: true,
    scale: 0.95,
    reach: 0.07,
  };
  dress(k, f, a);
  const rack = new Kit();
  rack.chamfer('paint', [0.34, 0.24, 0.34], 0.02, [0.17, 0.05, 0]);
  for (const y of [0, 0.1]) {
    for (const z of [-0.095, 0, 0.095]) {
      rack.axial('dark', 0.04, 0.05, 6, [0.335, y, z]);
      rack.cone('trim', 0.03, 0.07, 5, [0.38, y, z]);
    }
  }
  rack.box('trim', [0.3, 0.012, 0.012], [0.17, 0.176, 0.14]);
  rack.box('trim', [0.3, 0.012, 0.012], [0.17, 0.176, -0.14]);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('rack', null, [-0.14, 0.3, 0], [0, 0, 0.6], rack);
  rig.recoil.push({ node: 'rack', dist: 0.04 });
  return rig.seal('salvo', f, 'tread', { node: 'rack', at: [0.415, 0, 0] });
}

/** Warden: a point-defence laser. A round turret with a fat finned emitter and glowing lens, and a spinning radar mast. */
export function warden(f: FactionId): Recipe {
  const k = new Kit();
  trackPair(k, { len: 0.58, z: 0.2, w: 0.12, h: 0.14, wheels: 3, wheelR: 0.045 });
  k.chamfer('paint', [0.52, 0.1, 0.32], 0.02, [0, 0.19, 0]);
  k.cyl('dark', 0.13, 0.135, 0.04, 8, [-0.04, 0.26, 0]);
  k.cyl('paint', 0.1, 0.12, 0.09, 8, [-0.04, 0.325, 0]);
  cab(k, f, [-0.05, 0.38, -0.03], [0.09, 0.06, 0.09]);
  k.cyl('dark', 0.022, 0.03, 0.2, 6, [-0.12, 0.43, 0]);
  for (const s of SIDES) {
    k.barrel('dark', 0.014, 0.012, 0.02, 0.15, 0.33, s * 0.105, 5);
    k.axial('trim', 0.019, 0.012, 6, [0.155, 0.33, s * 0.105]);
  }
  const a: Anchors = {
    sigil: { x: 0.2, y: 0.24, size: 0.1 },
    deck: { x: 0.2, y: 0.24, len: 0.12, wid: 0.28 },
    flank: { x0: -0.26, x1: -0.06, y: 0.2, z: 0.16, h: 0.1 },
    nose: { x: 0.3, y: 0.2 },
    fins: true,
    scale: 0.9,
    reach: 0.07,
  };
  dress(k, f, a);
  const radar = new Kit();
  radar.cyl('dark', 0.03, 0.03, 0.03, 6, [0, 0, 0]);
  radar.box('dark', [0.04, 0.012, 0.24], [0, 0.016, 0]);
  radar.box('trim', [0.03, 0.02, 0.03], [0, 0.02, 0.115]);
  const gun = new Kit();
  gun.barrel('dark', 0.042, 0.05, 0, 0.22, 0, 0, 8);
  for (const x of [0.05, 0.09, 0.13, 0.17]) gun.box('dark', [0.012, 0.115, 0.115], [x, 0, 0]);
  gun.axial('trim', 0.05, 0.022, 8, [0.23, 0, 0]);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('radar', null, [-0.12, 0.54, 0], [0, 0, 0], radar);
  rig.tracks.push({ node: 'radar', kind: 'spin', prop: 'rot', axis: 1, hz: 2.2, move: 1.5 });
  rig.node('gun', null, [0.05, 0.325, 0], [0, 0, 0], gun);
  rig.recoil.push({ node: 'gun', dist: 0.035 });
  return rig.seal('warden', f, 'tread', { node: 'gun', at: [0.24, 0, 0] });
}
