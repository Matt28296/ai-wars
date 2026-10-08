// The two foot units. Each recipe describes ONE figure; the view makes three and shows 1-3 of them by HP.
import { OctahedronGeometry } from 'three';
import type { FactionId } from '../../../game/aw';
import { dress } from './factions';
import type { Anchors } from './factions';
import { Kit } from './kit';
import { Rig } from './recipe';
import type { Recipe } from './recipe';

const SIDES = [-1, 1] as const;

/** Trooper: an exo-rifle squad member. Slim exo-suit, backpack, helmet visor and a long rifle. */
export function trooper(f: FactionId): Recipe {
  const k = new Kit();
  for (const s of SIDES) {
    k.limb('paint', [0, 0.19, s * 0.035], [0.02, 0.105, s * 0.04], 0.021, 0.018, 6);
    k.limb('dark', [0.02, 0.105, s * 0.04], [-0.005, 0.035, s * 0.043], 0.017, 0.015, 6);
    k.box('dark', [0.085, 0.04, 0.055], [0.015, 0.02, s * 0.043]);
    k.box('paint', [0.07, 0.05, 0.06], [0, 0.375, s * 0.09]);
    k.limb('paint', [0, 0.37, s * 0.105], [0.045, 0.3, s * 0.115], 0.02, 0.017, 6);
    k.limb('dark', [0.045, 0.3, s * 0.115], [0.11, 0.31, s * 0.032], 0.016, 0.014, 6);
    k.box('dark', [0.03, 0.03, 0.03], [0.115, 0.31, s * 0.03]);
  }
  k.box('dark', [0.07, 0.04, 0.12], [0, 0.2, 0]);
  k.chamfer('paint', [0.1, 0.15, 0.15], 0.02, [0, 0.295, 0]);
  k.box('trim', [0.012, 0.05, 0.09], [0.056, 0.31, 0]);
  k.box('dark', [0.07, 0.14, 0.11], [-0.085, 0.3, 0]);
  k.box('trim', [0.01, 0.1, 0.03], [-0.123, 0.3, 0]);
  if (f === 'choir') {
    k.add('dark', new OctahedronGeometry(1, 0), [0.01, 0.43, 0], [0, 0, 0], [0.055, 0.058, 0.055]);
    k.add('trim', new OctahedronGeometry(1, 0), [0.055, 0.432, 0], [0, 0, 0], [0.018, 0.014, 0.035]);
  } else {
    k.sphere('paint', [0.05, 0.048, 0.05], [0.01, 0.43, 0], 6, 4);
    k.box('trim', [0.03, 0.02, 0.07], [0.052, 0.43, 0]);
  }
  const a: Anchors = {
    sigil: { x: -0.085, y: 0.371, size: 0.055 },
    deck: { x: 0, y: 0.37, len: 0.08, wid: 0.1 },
    flank: { x0: -0.115, x1: -0.055, y: 0.3, z: 0.055, h: 0.14 },
    nose: { x: 0.05, y: 0.36 },
    fins: true,
    scale: 0.4,
    reach: 0.03,
  };
  dress(k, f, a);
  const rifle = new Kit();
  rifle.box('dark', [0.14, 0.04, 0.035], [0.07, 0, 0]);
  rifle.barrel('dark', 0.011, 0.009, 0.14, 0.22, 0.005, 0, 5);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('rifle', null, [0.06, 0.31, 0], [0, 0, 0], rifle);
  rig.recoil.push({ node: 'rifle', dist: 0.025 });
  return rig.seal('trooper', f, 'foot', { node: 'rifle', at: [0.22, 0.005, 0] }, true);
}

/** Breacher: a heavy exo with a shoulder-mounted rail launcher. Broad armour, small forward head, one long glowing tube. */
export function breacher(f: FactionId): Recipe {
  const k = new Kit();
  for (const s of SIDES) {
    k.limb('paint', [0, 0.23, s * 0.055], [0.025, 0.125, s * 0.06], 0.03, 0.026, 6);
    k.limb('dark', [0.025, 0.125, s * 0.06], [0, 0.045, s * 0.065], 0.024, 0.021, 6);
    k.box('dark', [0.11, 0.05, 0.075], [0.02, 0.025, s * 0.065]);
    k.box('paint', [0.1, 0.07, 0.085], [0, 0.435, s * 0.135]);
    k.limb('paint', [0, 0.42, s * 0.15], [0.05, 0.35, s * 0.15], 0.026, 0.022, 6);
    k.limb('dark', [0.05, 0.35, s * 0.15], [0.07, 0.42, s * 0.1], 0.021, 0.019, 6);
    k.box('dark', [0.04, 0.04, 0.04], [0.075, 0.43, s * 0.09]);
  }
  k.box('dark', [0.09, 0.05, 0.16], [0, 0.245, 0]);
  k.hull('paint', [
    [-0.075, 0.27, 0.105], [-0.075, 0.27, -0.105], [0.075, 0.27, 0.095], [0.075, 0.27, -0.095],
    [-0.065, 0.43, 0.11], [-0.065, 0.43, -0.11], [0.085, 0.43, 0.1], [0.085, 0.43, -0.1],
  ]);
  k.box('trim', [0.012, 0.07, 0.12], [0.088, 0.35, 0]);
  k.box('dark', [0.1, 0.18, 0.15], [-0.12, 0.34, 0]);
  k.box('trim', [0.01, 0.12, 0.03], [-0.173, 0.34, 0]);
  if (f === 'choir') {
    k.add('dark', new OctahedronGeometry(1, 0), [0.04, 0.49, 0], [0, 0, 0], [0.05, 0.05, 0.05]);
    k.add('trim', new OctahedronGeometry(1, 0), [0.083, 0.492, 0], [0, 0, 0], [0.018, 0.014, 0.032]);
  } else {
    k.sphere('paint', [0.045, 0.043, 0.045], [0.04, 0.49, 0], 6, 4);
    k.box('trim', [0.026, 0.018, 0.06], [0.08, 0.49, 0]);
  }
  const a: Anchors = {
    sigil: { x: -0.12, y: 0.431, size: 0.07 },
    deck: { x: 0.0, y: 0.43, len: 0.1, wid: 0.14 },
    flank: { x0: -0.17, x1: -0.07, y: 0.34, z: 0.075, h: 0.16 },
    nose: { x: 0.085, y: 0.42 },
    fins: true,
    scale: 0.5,
    reach: 0.035,
  };
  dress(k, f, a);
  const tube = new Kit();
  tube.box('dark', [0.1, 0.07, 0.07], [0, 0, 0]);
  tube.barrel('dark', 0.034, 0.03, 0.04, 0.33, 0, 0, 6);
  for (const x of [0.12, 0.22]) tube.axial('trim', 0.04, 0.016, 6, [x, 0, 0]);
  tube.axial('trim', 0.036, 0.02, 6, [0.325, 0, 0]);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('tube', null, [-0.07, 0.5, 0.13], [0, 0, 0], tube);
  rig.recoil.push({ node: 'tube', dist: 0.05 });
  return rig.seal('breacher', f, 'foot', { node: 'tube', at: [0.335, 0, 0] }, true);
}
