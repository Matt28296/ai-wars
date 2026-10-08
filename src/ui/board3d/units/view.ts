// One unit on the battlefield: the miniature, its idle motion, its poses, its chips and its focus ring.
//
// Scene graph (all under `object`, whose origin is the unit's feet):
//   object
//    +- yaw        heading (rotation.y = -heading)
//    |   +- pose   shake and lean, set by setPose; its origin is the unit's centre of mass (PIVOT_Y), so tilts do not swing it off its tile
//    |       +- idle   the class motion: hover bob, air bob, ship roll, tread rumble
//    |           +- model   the miniature, lowered by PIVOT_Y again (its nodes; foot units hold three figure groups)
//    +- ring       the focus ring on the ground
//    +- chips      HP chip and status chip, billboards in world axes (they do not turn with the unit)
//
// The miniature is ONE skinned mesh (one per figure for a foot squad): the nodes (body, weapon, rotors, legs) are its bones, so a unit
// costs one draw call, plus one for the see-through rotor blur on the three types that have it. Its geometry, and the material it is
// painted with, are shared by every unit of the same look; the paint is in the vertices (skin.ts, shading.ts).
import { Bone, Euler, Group, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh, Sphere, Sprite, Vector3 } from 'three';
import type { FactionId, UnitTypeId } from '../../../game/aw';
import type { UnitLook, UnitPose, UnitView, UnitViewOptions } from '../contract';
import type { UnitStatusKind } from '../../watch/unitview';
import type { ChipKey } from './chips';
import { squadSize } from './recipe';
import type { MotionClass, Recipe, Track } from './recipe';
import {
  acquireChip, acquireMaterials, acquireRecipe, acquireRing, releaseChip, releaseMaterials, releaseRecipe, releaseRing,
} from './resources';
import type { MaterialSet } from './resources';

const TAU = Math.PI * 2;

/** Foot squad layout by figure count: figure 0 stands out in front and fires. The squad is centred on its tile for every count. */
type Layout = Record<1 | 2 | 3, [number, number][]>;
const SQUAD_LAYOUT: Partial<Record<UnitTypeId, Layout>> = {
  trooper: { 1: [[-0.05, 0]], 2: [[0.0, -0.17], [-0.12, 0.17]], 3: [[0.03, 0], [-0.13, -0.2], [-0.13, 0.2]] },
  breacher: { 1: [[-0.06, 0]], 2: [[0.02, -0.17], [-0.1, 0.17]], 3: [[0.01, 0], [-0.12, -0.17], [-0.12, 0.17]] },
};
const DEFAULT_LAYOUT: Layout = { 1: [[0, 0]], 2: [[0.05, -0.17], [-0.05, 0.17]], 3: [[0.07, 0], [-0.1, -0.2], [-0.1, 0.2]] };
/** A squad figure's size by type (the heavy exo is already broad), and the extra a lone survivor gets so it still reads. */
const FIGURE_SCALE: Partial<Record<UnitTypeId, number>> = { trooper: 1.1, breacher: 1.15 };
const SINGLE_SCALE = 1.1;

/** The height an idle tilt turns about, so a tilting aircraft or hovercraft does not swing sideways off its tile. */
const PIVOT_Y: Record<MotionClass, number> = { foot: 0, hover: 0.14, tread: 0, walker: 0, air: 0.38, ship: 0 };

/** How far a unit leans into a 'move' pose, by class (radians, nose down). */
const LEAN: Record<MotionClass, number> = { foot: 0.12, hover: 0.1, tread: 0.035, walker: 0.05, air: 0.18, ship: 0.04 };

let instanceCounter = 0;
/** The golden angle per instance: neighbours never share a phase, and the sequence is the same on every run. */
function nextPhase(): number {
  instanceCounter += 1;
  return (instanceCounter * 2.399963229728653) % TAU;
}

/** The fire recoil curve: out to full recoil at t = 0.15, then back with an ease. */
export function recoilCurve(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < 0.15) return t / 0.15;
  const u = 1 - (t - 0.15) / 0.85;
  return u * u;
}

/**
 * A unit view as this kit makes it: the contract's view, plus what the stage may ask of it beyond the contract (it asks with `typeof
 * view.setMotion === 'function'`, as it does of the terrain kit and the effects kit, so a stand-in view without it is simply not asked).
 */
export interface UnitKit extends UnitView {
  /** Drawn without a sigil decal: the seat's nation is not named in the mission (G16). */
  readonly unmarked: boolean;
  /** False while the unit's idle motion is held still. */
  readonly motion: boolean;
  /**
   * Reduced motion (G16). Off, the unit's clock holds: the hover and air bob, the ship's roll, the walker's shift, a squad's breathing, the
   * spinning rotors and radars and the focus ring's breath all stay exactly where they are. The poses that show an action still play, because
   * they are the battle: fire and hit are drawn from their own t, and a unit that is moving keeps its stride, rumble and spin (the clock runs
   * while it moves and holds again, where it stopped, when it does). On again, the clock carries on from where it stopped, so nothing jumps.
   * A view starts with motion on.
   */
  setMotion(on: boolean): void;
}

interface Rigged {
  root: Group;
  nodes: Map<string, Bone>;
}

interface Rest { pos: Vector3; rot: Euler; axis: Vector3 }

/** The bones are authored in the model's frame and the mesh sits at the root of that frame, so the bind matrix is the identity. */
const BIND = new Matrix4();
/** How far past the rest-pose bounds the animated parts (a bobbing hull, a swinging leg) can reach, for frustum culling. */
const CULL_MARGIN = 0.25;

export function createUnitViewWithPhase(type: UnitTypeId, faction: FactionId, phase: number, opts?: UnitViewOptions): UnitKit {
  const unmarked = opts?.unmarked === true;
  const recipe: Recipe = acquireRecipe(type, faction, unmarked);
  const mats: MaterialSet = acquireMaterials(faction);
  let disposed = false;

  const object = new Group();
  object.name = `unit:${type}`;
  const yaw = new Group();
  yaw.name = 'yaw';
  const pose = new Group();
  pose.name = 'pose';
  const idle = new Group();
  idle.name = 'idle';
  const model = new Group();
  model.name = 'model';
  model.position.y = -PIVOT_Y[recipe.motion];
  pose.position.y = PIVOT_Y[recipe.motion];
  object.add(yaw);
  yaw.add(pose);
  pose.add(idle);
  idle.add(model);

  // ---- build the nodes (one rig, or three for a foot squad): bones, one skinned mesh over them, and the rotor blur where there is one
  const skins: SkinnedMesh[] = [];
  const skeletons: Skeleton[] = [];
  const rest = new Map<Object3D, Rest>();
  const sphere = recipe.geometry.boundingSphere ?? new Sphere();
  const build = (root: Group): Rigged => {
    const nodes = new Map<string, Bone>();
    const bones: Bone[] = [];
    for (const def of recipe.nodes) {
      const g = new Bone();
      g.name = def.name;
      g.position.set(def.pos[0], def.pos[1], def.pos[2]);
      g.rotation.set(def.rot[0], def.rot[1], def.rot[2]);
      rest.set(g, { pos: g.position.clone(), rot: g.rotation.clone(), axis: new Vector3(1, 0, 0).applyEuler(g.rotation) });
      if (def.blur) {
        const blur = new Mesh(def.blur, mats.blur);
        blur.name = `${def.name}:blur`;
        blur.userData.slot = 'blur';
        g.add(blur);
      }
      (def.parent ? nodes.get(def.parent) ?? root : root).add(g);
      nodes.set(def.name, g);
      bones.push(g);
    }
    const skin = new SkinnedMesh(recipe.geometry, mats.normal);
    skin.name = 'skin';
    skin.castShadow = true;
    skin.receiveShadow = true;
    // the animated parts stay near the rest pose: a fixed sphere keeps culling honest without re-measuring the skin every frame
    skin.boundingSphere = new Sphere(sphere.center.clone(), sphere.radius + CULL_MARGIN);
    root.add(skin);
    const skeleton = new Skeleton(bones, recipe.boneInverses.map((m) => m.clone()));
    skin.bind(skeleton, BIND);
    skins.push(skin);
    skeletons.push(skeleton);
    return { root, nodes };
  };

  const rigs: Rigged[] = [];
  const figures: Group[] = [];
  if (recipe.squad) {
    for (let i = 0; i < 3; i += 1) {
      const fig = new Group();
      fig.name = `figure${i}`;
      model.add(fig);
      figures.push(fig);
      rigs.push(build(fig));
    }
  } else {
    rigs.push(build(model));
  }

  // the muzzle marker rides on the weapon node of the lead figure, so it recoils with the weapon
  const muzzle = new Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(recipe.muzzle.at[0], recipe.muzzle.at[1], recipe.muzzle.at[2]);
  (rigs[0].nodes.get(recipe.muzzle.node) ?? rigs[0].root).add(muzzle);

  // ---- the focus ring and the chips
  const ringSet = acquireRing();
  const ring = new Group();
  ring.name = 'ring';
  for (const part of [ringSet.glow, ringSet.edge]) {
    const m = new Mesh(part.geometry, part.material);
    m.rotation.x = -Math.PI / 2;
    ring.add(m);
  }
  ring.position.y = 0.025;
  ring.visible = false;
  object.add(ring);

  const chips = new Group();
  chips.name = 'chips';
  const hpSprite = new Sprite(acquireChip('blank'));
  const statusSprite = new Sprite(acquireChip('blank'));
  for (const [s, x] of [[hpSprite, 0.275], [statusSprite, -0.275]] as const) {
    s.scale.set(0.27, 0.27, 1);
    s.position.set(x, 0.16, 0.31);
    s.renderOrder = 10;
    s.visible = false;
    chips.add(s);
  }
  hpSprite.name = 'chip:hp';
  statusSprite.name = 'chip:status';
  object.add(chips);

  // ---- state
  let count: 1 | 2 | 3 = 3;
  let spent = false;
  let hpKey: ChipKey = 'blank';
  let statusKey: ChipKey = 'blank';
  let poseName: UnitPose = 'idle';
  let poseT = 0;
  /**
   * The unit's own clock, which every animated transform reads. It follows the time update() is given while motion is on, or while the unit
   * is moving (an action), holds while motion is off and it is not, and carries on from where it stopped: `clockOffset` is the time it has
   * lost to being held, so the clock never jumps.
   */
  let clockSec = 0;
  let clockOffset = 0;
  let motion = true;

  const setChip = (sprite: Sprite, current: ChipKey, next: ChipKey): ChipKey => {
    if (current === next) return current;
    sprite.material = acquireChip(next);
    sprite.visible = next !== 'blank';
    releaseChip(current);
    return next;
  };

  const layoutSquad = (): void => {
    figures.forEach((fig, i) => {
      fig.visible = i < count;
      const slot = (SQUAD_LAYOUT[type] ?? DEFAULT_LAYOUT)[count][i];
      if (slot) fig.userData.slot = slot;
    });
  };
  if (recipe.squad) layoutSquad();

  // ---- evaluation: every animated transform is rest + tracks + recoil, recomputed whole, so it is a pure function of the state
  const moving = (): boolean => poseName === 'move';
  const trackValue = (tr: Track): number => {
    const mv = moving() ? tr.move ?? 1 : 1;
    if (tr.kind === 'spin') return (tr.base ?? 0) + clockSec * tr.hz * mv + phase;
    return (tr.base ?? 0) + (tr.amp ?? 0) * mv * Math.sin(TAU * tr.hz * clockSec + (tr.phase ?? 0) + phase);
  };

  const evaluateRig = (rig: Rigged): void => {
    for (const [, g] of rig.nodes) {
      const r = rest.get(g);
      if (!r) continue;
      g.position.copy(r.pos);
      g.rotation.copy(r.rot);
    }
    for (const tr of recipe.tracks) {
      const g = rig.nodes.get(tr.node);
      if (!g) continue;
      const v = trackValue(tr);
      if (tr.prop === 'rot') g.rotation[AXES[tr.axis]] += v;
      else g.position[AXES[tr.axis]] += v;
    }
    if (poseName === 'fire') {
      const k = recoilCurve(poseT);
      for (const rc of recipe.recoil) {
        const g = rig.nodes.get(rc.node);
        const r = g ? rest.get(g) : undefined;
        if (g && r) g.position.addScaledVector(r.axis, -rc.dist * k);
      }
    }
  };

  const evaluateIdle = (): void => {
    const t = clockSec;
    const p = phase;
    let y = 0;
    let rx = 0;
    let rz = 0;
    switch (recipe.motion) {
      case 'hover':
        y = 0.018 * Math.sin(TAU * 1.3 * t + p);
        rz = 0.035 * Math.sin(TAU * 0.7 * t + p * 1.3);
        rx = 0.03 * Math.sin(TAU * 0.55 * t + p * 0.7);
        break;
      case 'air':
        y = 0.025 * Math.sin(TAU * 0.9 * t + p);
        rz = 0.03 * Math.sin(TAU * 0.6 * t + p * 1.1);
        rx = 0.05 * Math.sin(TAU * 0.45 * t + p * 0.9);
        break;
      case 'ship':
        y = 0.012 * Math.sin(TAU * 0.35 * t + p);
        rx = 0.045 * Math.sin(TAU * 0.28 * t + p);
        rz = 0.02 * Math.sin(TAU * 0.21 * t + p * 1.4);
        break;
      case 'walker':
        y = 0.008 * Math.sin(TAU * 0.9 * t + p);
        break;
      case 'tread':
        y = (moving() ? 0.004 : 0.0015) * Math.sin(TAU * 11 * t + p);
        break;
      case 'foot':
        break;
    }
    idle.position.set(0, y, 0);
    idle.rotation.set(rx, 0, rz);
    // a squad breathes and shuffles; on the move it steps
    figures.forEach((fig, i) => {
      const slot = (fig.userData.slot as [number, number] | undefined) ?? [0, 0];
      const q = p + i * 1.9;
      fig.scale.setScalar((FIGURE_SCALE[type] ?? 1) * (count === 1 ? SINGLE_SCALE : 1));
      const breathe = 0.006 * (0.5 + 0.5 * Math.sin(TAU * 0.9 * t + q));
      const step = moving() ? 0.03 * Math.abs(Math.sin(TAU * 2.4 * t + q)) : 0;
      fig.position.set(slot[0] + 0.004 * Math.sin(TAU * 0.35 * t + q), breathe + step, slot[1] + 0.004 * Math.cos(TAU * 0.3 * t + q * 1.3));
      fig.rotation.z = moving() ? -0.05 : 0.012 * Math.sin(TAU * 0.5 * t + q);
    });
  };

  const evaluatePose = (): void => {
    const pivot = PIVOT_Y[recipe.motion];
    pose.position.set(0, pivot, 0);
    pose.rotation.set(0, 0, 0);
    if (poseName === 'fire') {
      pose.position.x = -0.012 * recoilCurve(poseT);
    } else if (poseName === 'hit') {
      const e = (1 - poseT) * (1 - poseT);
      pose.position.set(0.03 * Math.sin(poseT * 60) * e, pivot + 0.008 * Math.abs(Math.sin(poseT * 53)) * e, 0.025 * Math.cos(poseT * 47) * e);
    } else if (poseName === 'move') {
      const bell = Math.max(0, Math.min(1, poseT / 0.15, (1 - poseT) / 0.15));
      pose.rotation.z = -LEAN[recipe.motion] * bell;
    }
  };

  const evaluate = (): void => {
    for (const rig of rigs) evaluateRig(rig);
    evaluateIdle();
    evaluatePose();
  };
  evaluate();

  const view: UnitKit = {
    object,
    type,
    get unmarked() { return unmarked; },
    get motion() { return motion; },
    setMotion(on: boolean) {
      if (disposed) return;
      motion = on;
    },
    setLook(look: UnitLook) {
      if (disposed) return;
      yaw.rotation.y = -look.heading;
      const next = recipe.squad ? squadSize(look.hp) : 3;
      if (recipe.squad && next !== count) {
        count = next;
        layoutSquad();
        evaluate();
      }
      if (look.spent !== spent) {
        spent = look.spent;
        const set = spent ? mats.spent : mats.normal;
        for (const skin of skins) skin.material = set;
      }
      const hp = Math.max(1, Math.min(10, Math.round(look.hp)));
      hpKey = setChip(hpSprite, hpKey, hp < 10 ? (`hp:${hp}` as ChipKey) : 'blank');
      statusKey = setChip(statusSprite, statusKey, look.status ? (`status:${look.status as UnitStatusKind}` as ChipKey) : 'blank');
      ring.visible = look.focused;
    },
    setPose(next: UnitPose, t: number) {
      if (disposed) return;
      poseName = next;
      poseT = Math.max(0, Math.min(1, t));
      evaluate();
    },
    muzzleWorld(out: Vector3): Vector3 {
      return muzzle.getWorldPosition(out ?? new Vector3());
    },
    update(_dtSec: number, t: number) {
      if (disposed || !Number.isFinite(t)) return;
      if (motion || moving()) clockSec = t - clockOffset;
      else clockOffset = t - clockSec;
      evaluate();
      if (ring.visible) ring.scale.setScalar(1 + 0.035 * Math.sin(TAU * 1.2 * clockSec));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      for (const skeleton of skeletons) skeleton.dispose();
      releaseChip(hpKey);
      releaseChip(statusKey);
      releaseRing();
      releaseMaterials(faction);
      releaseRecipe(type, faction, unmarked);
    },
  };
  return view;
}

const AXES = ['x', 'y', 'z'] as const;

/** Create the miniature for a unit type in a faction's livery. `opts.unmarked`: no sigil decal (the seat's nation is not named). */
export function createUnitView(type: UnitTypeId, faction: FactionId, opts?: UnitViewOptions): UnitKit {
  return createUnitViewWithPhase(type, faction, nextPhase(), opts);
}
