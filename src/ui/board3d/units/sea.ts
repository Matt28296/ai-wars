// The three ships: picket, dreadnought, barge. Origin at the waterline; hulls sit a little below it.
import type { FactionId } from '../../../game/aw';
import { cab, dress } from './factions';
import type { Anchors } from './factions';
import { Kit } from './kit';
import { Rig } from './recipe';
import type { Recipe } from './recipe';

const SIDES = [-1, 1] as const;

/** Picket: an escort cruiser. A long sharp hull, one forward gun, a bridge with a radar mast and a missile deck aft. */
export function picket(f: FactionId): Recipe {
  const k = new Kit();
  k.hull('paint', [
    [0.4, 0.09, 0], [0.36, -0.03, 0], [0.2, -0.04, 0.08], [0.2, -0.04, -0.08], [0.2, 0.09, 0.115], [0.2, 0.09, -0.115],
    [-0.1, -0.04, 0.1], [-0.1, -0.04, -0.1], [-0.1, 0.09, 0.135], [-0.1, 0.09, -0.135],
    [-0.36, -0.03, 0.09], [-0.36, -0.03, -0.09], [-0.36, 0.09, 0.12], [-0.36, 0.09, -0.12],
  ]);
  k.hull('dark', [
    [0.36, -0.032, 0], [0.2, -0.042, 0.082], [0.2, -0.042, -0.082], [-0.1, -0.042, 0.102], [-0.1, -0.042, -0.102], [-0.36, -0.032, 0.092], [-0.36, -0.032, -0.092],
    [0.38, 0.0, 0], [0.2, 0.0, 0.098], [0.2, 0.0, -0.098], [-0.1, 0.0, 0.118], [-0.1, 0.0, -0.118], [-0.36, 0.0, 0.1], [-0.36, 0.0, -0.1],
  ]);
  // bridge, mast, funnel, missile cells
  k.hull('paint', [[0.0, 0.09, 0.09], [0.0, 0.09, -0.09], [-0.2, 0.09, 0.09], [-0.2, 0.09, -0.09], [-0.02, 0.2, 0.06], [-0.02, 0.2, -0.06], [-0.16, 0.2, 0.06], [-0.16, 0.2, -0.06], [0.03, 0.15, 0.075], [0.03, 0.15, -0.075]]);
  cab(k, f, [0.0, 0.17, 0], [0.04, 0.05, 0.12]);
  k.cyl('dark', 0.009, 0.012, 0.16, 5, [-0.1, 0.28, 0]);
  k.box('paint', [0.06, 0.08, 0.08], [-0.26, 0.13, 0]);
  for (const x of [-0.31, -0.35]) {
    for (const s of SIDES) {
      k.box('dark', [0.034, 0.014, 0.034], [x, 0.097, s * 0.045]);
      k.box('trim', [0.018, 0.005, 0.018], [x, 0.106, s * 0.045]);
    }
  }
  const a: Anchors = {
    sigil: { x: 0.1, y: 0.09, size: 0.085 },
    deck: { x: 0.1, y: 0.09, len: 0.15, wid: 0.14 },
    flank: { x0: -0.3, x1: 0.1, y: 0.05, z: 0.125, h: 0.09 },
    nose: { x: 0.36, y: 0.09 },
    fins: true,
    scale: 0.8,
    reach: 0.05,
  };
  dress(k, f, a);
  const gun = new Kit();
  gun.chamfer('paint', [0.12, 0.05, 0.11], 0.015, [0, 0.025, 0]);
  gun.barrel('dark', 0.015, 0.012, 0.04, 0.18, 0.03, 0, 5);
  gun.axial('trim', 0.019, 0.012, 5, [0.175, 0.03, 0]);
  const radar = new Kit();
  radar.box('dark', [0.1, 0.01, 0.022], [0, 0, 0]);
  radar.box('trim', [0.018, 0.014, 0.018], [0.05, 0.004, 0]);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('radar', null, [-0.1, 0.37, 0], [0, 0, 0], radar);
  rig.tracks.push({ node: 'radar', kind: 'spin', prop: 'rot', axis: 1, hz: 1.6, move: 1.3 });
  rig.node('gun', null, [0.22, 0.09, 0], [0, 0, 0], gun);
  rig.recoil.push({ node: 'gun', dist: 0.035 });
  return rig.seal('picket', f, 'ship', { node: 'gun', at: [0.18, 0.03, 0] });
}

/** Dreadnought: a rail battleship. A long, broad-shouldered hull, a stepped command tower set back from three twin-barrel rail turrets with glowing coils. */
export function dreadnought(f: FactionId): Recipe {
  const k = new Kit();
  k.hull('paint', [
    [0.385, 0.12, 0], [0.35, -0.03, 0], [0.2, -0.05, 0.1], [0.2, -0.05, -0.1], [0.2, 0.12, 0.15], [0.2, 0.12, -0.15],
    [-0.05, -0.05, 0.14], [-0.05, -0.05, -0.14], [-0.05, 0.12, 0.19], [-0.05, 0.12, -0.19],
    [-0.25, -0.05, 0.14], [-0.25, -0.05, -0.14], [-0.25, 0.12, 0.19], [-0.25, 0.12, -0.19],
    [-0.385, -0.04, 0.1], [-0.385, -0.04, -0.1], [-0.385, 0.12, 0.15], [-0.385, 0.12, -0.15],
  ]);
  k.hull('dark', [
    [0.35, -0.032, 0], [0.2, -0.052, 0.102], [0.2, -0.052, -0.102], [-0.05, -0.052, 0.142], [-0.05, -0.052, -0.142], [-0.385, -0.042, 0.102], [-0.385, -0.042, -0.102],
    [0.37, 0.01, 0], [0.2, 0.01, 0.138], [0.2, 0.01, -0.138], [-0.05, 0.01, 0.192], [-0.05, 0.01, -0.192], [-0.385, 0.01, 0.152], [-0.385, 0.01, -0.152],
  ]);
  k.chamfer('paint', [0.18, 0.09, 0.2], 0.015, [-0.08, 0.165, 0]);
  k.chamfer('paint', [0.13, 0.08, 0.14], 0.015, [-0.09, 0.25, 0]);
  k.chamfer('paint', [0.15, 0.05, 0.18], 0.012, [-0.08, 0.315, 0]);
  cab(k, f, [0.0, 0.318, 0], [0.04, 0.05, 0.14]);
  k.cyl('dark', 0.011, 0.014, 0.14, 5, [-0.1, 0.42, 0]);
  for (const s of SIDES) {
    k.cyl('dark', 0.03, 0.036, 0.1, 6, [-0.19, 0.17, s * 0.07]);
    k.box('dark', [0.05, 0.04, 0.03], [0.1, 0.14, s * 0.18]);
    k.box('dark', [0.05, 0.04, 0.03], [-0.15, 0.14, s * 0.2]);
    k.box('trim', [0.4, 0.008, 0.012], [-0.02, 0.124, s * 0.19]);
  }
  const a: Anchors = {
    sigil: { x: -0.08, y: 0.341, size: 0.1 },
    deck: { x: 0.0, y: 0.12, len: 0.06, wid: 0.3 },
    flank: { x0: -0.32, x1: 0.1, y: 0.07, z: 0.19, h: 0.1 },
    nose: { x: 0.38, y: 0.12 },
    fins: true,
    scale: 1.1,
    reach: 0.07,
  };
  dress(k, f, a);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  // the three turrets are one node, so the main battery recoils together (and costs one set of meshes)
  const guns = new Kit();
  const turret = (x: number, y: number, len: number, high: boolean): void => {
    guns.chamfer('paint', [0.15, 0.06, 0.2], 0.015, [x, y + 0.03, 0]);
    if (high) guns.box('dark', [0.15, 0.04, 0.17], [x, y - 0.02, 0]);
    for (const s of SIDES) {
      guns.barrel('dark', 0.021, 0.016, x + 0.04, x + len, y + 0.035, s * 0.045, 6);
      for (const cx of [len * 0.5, len * 0.82]) guns.axial('trim', 0.029, 0.014, 6, [x + cx, y + 0.035, s * 0.045]);
    }
  };
  turret(0.215, 0.12, 0.17, false);
  turret(0.07, 0.17, 0.17, true);
  turret(-0.27, 0.12, 0.12, false);
  rig.node('gun', null, [0, 0, 0], [0, 0, 0], guns);
  rig.recoil.push({ node: 'gun', dist: 0.035 });
  const radar = new Kit();
  radar.box('dark', [0.14, 0.01, 0.026], [0, 0, 0]);
  radar.box('trim', [0.02, 0.014, 0.02], [0.07, 0.004, 0]);
  rig.node('radar', null, [-0.1, 0.5, 0], [0, 0, 0], radar);
  rig.tracks.push({ node: 'radar', kind: 'spin', prop: 'rot', axis: 1, hz: 1.2, move: 1.3 });
  return rig.seal('dreadnought', f, 'ship', { node: 'gun', at: [0.385, 0.155, 0.045] });
}

/** Barge: a landing craft. An open cargo well between two walls, a raised bow ramp with chevrons, a stern wheelhouse and stacked crates. */
export function barge(f: FactionId): Recipe {
  const k = new Kit();
  k.hull('dark', [[0.3, -0.03, 0.16], [0.3, -0.03, -0.16], [-0.36, -0.03, 0.16], [-0.36, -0.03, -0.16], [0.34, 0.03, 0.18], [0.34, 0.03, -0.18], [-0.36, 0.03, 0.2], [-0.36, 0.03, -0.2]]);
  k.box('dark', [0.64, 0.03, 0.34], [-0.02, 0.045, 0]);
  for (const s of SIDES) {
    k.hull('paint', [
      [0.34, 0.0, s * 0.14], [0.34, 0.0, s * 0.2], [0.34, 0.12, s * 0.2], [0.34, 0.12, s * 0.14],
      [-0.36, 0.0, s * 0.14], [-0.36, 0.0, s * 0.2], [-0.36, 0.14, s * 0.2], [-0.36, 0.14, s * 0.14],
    ]);
    k.box('trim', [0.5, 0.008, 0.012], [-0.02, 0.145, s * 0.17]);
  }
  k.chamfer('paint', [0.1, 0.2, 0.4], 0.015, [-0.31, 0.1, 0]);
  k.chamfer('paint', [0.1, 0.1, 0.22], 0.012, [-0.3, 0.25, 0]);
  if (f === 'choir') cab(k, f, [-0.245, 0.27, 0], [0.03, 0.05, 0.16]);
  else k.box('glass', [0.012, 0.05, 0.17], [-0.248, 0.27, 0]);
  k.box('dark', [0.08, 0.06, 0.1], [-0.14, 0.09, -0.07]);
  k.box('trim', [0.085, 0.01, 0.04], [-0.14, 0.123, -0.07]);
  k.box('paint', [0.08, 0.05, 0.1], [-0.05, 0.085, 0.07]);
  k.box('trim', [0.012, 0.05, 0.08], [-0.005, 0.085, 0.07]);
  const a: Anchors = {
    sigil: { x: -0.3, y: 0.301, size: 0.08 },
    deck: { x: 0.1, y: 0.062, len: 0.24, wid: 0.28 },
    flank: { x0: -0.2, x1: 0.2, y: 0.07, z: 0.2, h: 0.1 },
    nose: { x: 0.34, y: 0.12 },
    fins: true,
    scale: 0.9,
    reach: 0.06,
  };
  dress(k, f, a);
  const ramp = new Kit();
  ramp.box('paint', [0.12, 0.016, 0.3], [0.06, 0, 0]);
  ramp.box('trim', [0.014, 0.019, 0.24], [0.04, 0, 0]);
  ramp.box('trim', [0.014, 0.019, 0.24], [0.085, 0, 0]);
  const rig = new Rig();
  rig.node('body', null, [0, 0, 0], [0, 0, 0], k);
  rig.node('ramp', null, [0.3, 0.1, 0], [0, 0, 0.8], ramp);
  rig.recoil.push({ node: 'ramp', dist: 0.02 });
  return rig.seal('barge', f, 'ship', { node: 'ramp', at: [0.12, 0, 0] });
}
