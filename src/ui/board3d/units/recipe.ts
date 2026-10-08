// What a unit model is made of: a tree of nodes (each a few merged meshes), the weapon parts that recoil, the muzzle point, and
// the animation tracks. A recipe is pure data built once per (type, faction) and shared by every instance of that look.
import type { FactionId, UnitTypeId } from '../../../game/aw';
import type { SlotGeometry, V3 } from './kit';

/** How a unit idles (art-direction Units kit): hover bob and tilt, air fan spin and bob, walker weight shift, ship roll, foot shuffle. */
export type MotionClass = 'foot' | 'hover' | 'tread' | 'walker' | 'air' | 'ship';

export interface NodeDef {
  name: string;
  /** Name of the parent node, or null for a child of the model root. Parents are listed before their children. */
  parent: string | null;
  pos: V3;
  rot: V3;
  geo: SlotGeometry;
}

/** One animated channel of a node. 'sin' oscillates around `base`; 'spin' turns at `hz` radians per second. */
export interface Track {
  node: string;
  kind: 'sin' | 'spin';
  prop: 'pos' | 'rot';
  axis: 0 | 1 | 2;
  /** sin: amplitude; spin: unused. */
  amp?: number;
  /** sin: cycles per second; spin: radians per second. */
  hz: number;
  phase?: number;
  /** Added to the value (a node's rest pose is already in NodeDef). */
  base?: number;
  /** Multiplier on amp (sin) or rate (spin) while the 'move' pose is on. Default 1. */
  move?: number;
}

export interface Recipe {
  type: UnitTypeId;
  faction: FactionId;
  motion: MotionClass;
  nodes: NodeDef[];
  /** Weapon nodes that slide back along their own +X axis on 'fire', by `dist` tile units. */
  recoil: { node: string; dist: number }[];
  /** The barrel tip, in the local frame of `node`. */
  muzzle: { node: string; at: V3 };
  tracks: Track[];
  /** Foot units: `nodes` describe ONE figure and the view makes three of them, shown by HP. */
  squad: boolean;
}

/** The squad size shown for a display HP: 3 at 7-10, 2 at 4-6, 1 at 1-3. */
export function squadSize(hp: number): 1 | 2 | 3 {
  const h = Math.max(1, Math.min(10, Math.round(hp)));
  return h >= 7 ? 3 : h >= 4 ? 2 : 1;
}

/** Collects the nodes, recoil parts and tracks of one model, then seals them into a Recipe. */
export class Rig {
  readonly nodes: NodeDef[] = [];
  readonly recoil: Recipe['recoil'] = [];
  readonly tracks: Track[] = [];

  node(name: string, parent: string | null, pos: V3, rot: V3, kit: { build(): SlotGeometry }): this {
    this.nodes.push({ name, parent, pos, rot, geo: kit.build() });
    return this;
  }

  seal(type: UnitTypeId, faction: FactionId, motion: MotionClass, muzzle: Recipe['muzzle'], squad = false): Recipe {
    return { type, faction, motion, nodes: this.nodes, recoil: this.recoil, muzzle, tracks: this.tracks, squad };
  }
}
