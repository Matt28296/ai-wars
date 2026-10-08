// Maps the transition plan's samples to what the 3D scene draws. Pure (three.js appears only as Vector3 in the FxItem conversion),
// so every rule here is tested against known answers.
//
// The stage samples the SAME plan the 2D stage does (transition.ts: planTransition / sampleTransition) every animation frame. It does
// not re-time anything: unit glides, hit flashes, damage numbers, ghosts, hit-point changes and fx all come from the sample. What it adds
// is what only a 3D picture needs:
//   - headings (a 3D unit faces where it goes and what it shoots), read from the plan's move paths and the step's own events;
//   - the shot that LEADS a hit: a muzzle flash and a tracer (direct fire) or an arcing shell (indirect fire), derived from the plan's
//     hit beats plus the shooter's position in the frames. They are drawn INSIDE the hit beat's own time window, so the plan's timing
//     is untouched; the impact starts when the shot lands.
// Only the viewer's frames and the viewer's filtered events are read (D-016).
import { Vector3 } from 'three';
import { CAPTURE_POINTS, displayHp } from '../../../game/aw';
import type { Coord, FactionId, GameEvent, Unit } from '../../../game/aw';
import { UNSEEN_UNIT } from '../../../game/aw/view-events';
import { UNIT_TYPES, isIndirect } from '../../../data';
import { glideEase } from '../../watch/timing';
import { findUnit } from '../../watch/timeline';
import type { ViewFrame } from '../../watch/timeline';
import { actorIds, focusOf, isSpent, unitStatus } from '../../watch/unitview';
import type { Facing } from '../../watch/unitview';
import { pointAlongPath } from '../../watch/layout';
import type { FxKind, MoveBeat, TransitionPlan, TransitionSample } from '../../watch/transition';
import { TILE } from '../contract';
import type { Fx3dKind, FxItem, NumberItem, UnitLook, UnitPose } from '../contract';
import { FACTION_ACCENT } from '../palette';
import { safeFrame } from './guard';

// ---------------------------------------------------------------- small helpers

const same = (a: Coord, b: Coord): boolean => a.x === b.x && a.y === b.y;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** 0 faces +X (east); positive turns toward +Z (south). */
export function headingOf(from: Coord, to: Coord): number | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return dx === 0 && dy === 0 ? undefined : Math.atan2(dy, dx);
}

export function facingHeading(f: Facing): number {
  return f === 'left' ? Math.PI : 0;
}

/** A stable positive integer from small numbers and a string, for effect seeds. */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = typeof p === 'number' ? String(p) : p;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    h = Math.imul(h ^ 0x2f, 16777619) >>> 0;
  }
  return (h % 2147483646) + 1;
}

/** World Y of the surface at a (possibly fractional) tile position: the four neighbouring tile heights blended. */
export function surfaceY(heightAt: (x: number, y: number) => number, x: number, y: number, width: number, height: number): number {
  const cx = Math.max(0, Math.min(width - 1, x));
  const cy = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = heightAt(x0, y0) * (1 - fx) + heightAt(x1, y0) * fx;
  const bot = heightAt(x0, y1) * (1 - fx) + heightAt(x1, y1) * fx;
  return top * (1 - fy) + bot * fy;
}

/** Identity of a map: the terrain rebuilds only when this changes (not per step, not per viewer). */
export function mapSignature(frame: ViewFrame): string {
  let h = 2166136261;
  for (const row of frame.tiles) for (const t of row) for (let i = 0; i < t.terrain.length; i++) h = Math.imul(h ^ t.terrain.charCodeAt(i), 16777619) >>> 0;
  return `${frame.mapId}|${frame.width}x${frame.height}|${h.toString(16)}`;
}

/** Capture progress for the terrain ring, 0..1, from the capture points a tile has left (20 = untouched). */
export function captureProgress(left: number | undefined): number {
  return left === undefined || left >= CAPTURE_POINTS ? 0 : clamp01((CAPTURE_POINTS - left) / CAPTURE_POINTS);
}

// ---------------------------------------------------------------- shots

/** Where inside a hit beat (0..1) each part of a shot happens. The impact starts when the shot lands. */
export const SHOT = {
  /** The muzzle flash runs over this first part of the beat (about 80 ms at 1x, the art direction's figure). */
  muzzleEnd: 0.2,
  /** A tracer is a streak: it lands almost at once. */
  directFlightEnd: 0.18,
  /** A shell arcs, so it flies for a good part of the beat. */
  indirectFlightEnd: 0.46,
  /** The shooter's recoil pose runs over this first part of the beat. */
  fireEnd: 0.5,
} as const;

export interface ShotPhase {
  /** Muzzle flash progress 0..1, or null when it is over. */
  muzzle: number | null;
  /** Tracer or shell progress 0..1 while it flies, else null. */
  flight: number | null;
  /** The impact's own progress 0..1 once the shot has landed, else null (before it lands). */
  impact: number | null;
  /** The shooter's `fire` pose t, or null when the recoil is over. */
  fire: number | null;
  /** The target's `hit` pose t once the shot has landed, else null. */
  hit: number | null;
  /** The beat fraction at which the shot lands. */
  landsAt: number;
}

export function shotPhase(indirect: boolean, p: number): ShotPhase {
  const q = clamp01(p);
  const landsAt = indirect ? SHOT.indirectFlightEnd : SHOT.directFlightEnd;
  const after = q >= landsAt ? (q - landsAt) / (1 - landsAt) : null;
  return {
    muzzle: q < SHOT.muzzleEnd ? q / SHOT.muzzleEnd : null,
    flight: q < landsAt ? q / landsAt : null,
    impact: after,
    fire: q < SHOT.fireEnd ? q / SHOT.fireEnd : null,
    hit: after,
    landsAt,
  };
}

export interface Shot {
  /** The index of this shot's `hit` beat in plan.fx. */
  beat: number;
  shooterId: number;
  targetId: number;
  /** Tiles at the time of the shot. */
  from: Coord;
  to: Coord;
  indirect: boolean;
  faction: FactionId | undefined;
}

/** What the step's events and frames add on top of the plan: its shots, and the way each unit ends up facing. Computed once per step. */
export interface StepInfo {
  shots: Shot[];
  /** Unit id -> heading (radians) the step leaves it with: where it last walked, or the target it last shot at. */
  rest: Map<number, number>;
  focus: Coord | undefined;
  actors: Set<number>;
}

/**
 * Pairs each strike of the step's `attacked` events with the plan's `hit` beat it produced. transition.ts adds one hit beat per strike
 * whose target the viewer can place, in event order (the counter strike first when `counterFirst`), so walking the events the same way
 * and counting beats gives the pairing. A beat whose tile disagrees with where the target stands is NOT paired: no shot is drawn
 * rather than a shot at the wrong tile. A shooter the viewer was never shown has no shot either (only its target flashes).
 */
export function analyseStep(prev: ViewFrame, next: ViewFrame, events: GameEvent[], plan: TransitionPlan | null): StepInfo {
  const pos = new Map<number, Coord>();
  for (const u of prev.units) pos.set(u.id, { x: u.x, y: u.y });
  const nextPos = new Map<number, Coord>();
  for (const u of next.units) nextPos.set(u.id, { x: u.x, y: u.y });
  const where = (id: number): Coord | undefined => (id === UNSEEN_UNIT ? undefined : pos.get(id) ?? nextPos.get(id));

  const hitBeats: number[] = [];
  plan?.fx.forEach((f, i) => { if (f.kind === 'hit') hitBeats.push(i); });
  let nextBeat = 0;
  const shots: Shot[] = [];
  const rest = new Map<number, number>();

  const strike = (shooterId: number, targetId: number): void => {
    const to = where(targetId);
    if (!to) return; // no beat was made for a target the viewer cannot place
    const beat = hitBeats[nextBeat++];
    if (beat === undefined || !plan || !same(plan.fx[beat].at, to)) return;
    const from = where(shooterId);
    if (!from) return;
    const shooter = findUnit(prev, shooterId) ?? findUnit(next, shooterId);
    if (!shooter) return;
    const type = UNIT_TYPES[shooter.type];
    if (!type) return;
    shots.push({
      beat, shooterId, targetId, from: { ...from }, to: { ...to },
      indirect: isIndirect(type), faction: (next.players[shooter.owner] ?? prev.players[shooter.owner])?.faction,
    });
    const h = headingOf(from, to);
    if (h !== undefined) rest.set(shooterId, h);
  };

  for (const e of events) {
    switch (e.kind) {
      case 'moved': {
        if (!e.path.length) break;
        pos.set(e.unitId, e.path[e.path.length - 1]);
        for (let i = e.path.length - 1; i > 0; i--) {
          const h = headingOf(e.path[i - 1], e.path[i]);
          if (h !== undefined) {
            rest.set(e.unitId, h);
            break;
          }
        }
        break;
      }
      case 'built': pos.set(e.unitId, e.at); break;
      case 'unloaded': pos.set(e.unitId, e.to); break;
      case 'attacked': {
        // The same order transition.ts strikes in.
        if (e.counterFirst) {
          if (e.counter > 0) strike(e.defenderId, e.attackerId);
          strike(e.attackerId, e.defenderId);
        } else {
          strike(e.attackerId, e.defenderId);
          if (e.counter > 0) strike(e.defenderId, e.attackerId);
        }
        break;
      }
      default: break;
    }
  }
  const safe = safeFrame(next).frame;
  return { shots, rest, focus: focusOf(events, safe), actors: actorIds(events) };
}

/** How far through a shot's hit beat the plan is at `t` ms, or null when the beat is not running. Read from the plan's own beat. */
export function shotProgress(plan: TransitionPlan, shot: Shot, t: number): number | null {
  const b = plan.fx[shot.beat];
  if (!b || b.durMs <= 0 || t < b.startMs || t >= b.startMs + b.durMs) return null;
  return clamp01((t - b.startMs) / b.durMs);
}

// ---------------------------------------------------------------- moving units

export interface MoveState {
  /** Eased progress along the whole path, as sampleTransition computes it. */
  progress: number;
  /** Heading along the segment the unit is on (radians). */
  heading: number | undefined;
  /** False while the glide has not begun (the unit waits at the start of its path, already turned toward it). */
  moving: boolean;
}

/** The beat sampleTransition places `unitId` from at `t`: the first of its glides that has not finished. */
function activeMove(plan: TransitionPlan, unitId: number, t: number): MoveBeat | undefined {
  let best: MoveBeat | undefined;
  for (const m of plan.moves) {
    if (m.unitId !== unitId || t >= m.startMs + m.durMs) continue;
    if (!best || m.startMs < best.startMs) best = m;
  }
  return best;
}

export function moveState(plan: TransitionPlan, unitId: number, t: number): MoveState | undefined {
  const beat = activeMove(plan, unitId, t);
  if (!beat || beat.path.length < 2) return undefined;
  const segs = beat.path.length - 1;
  if (t < beat.startMs) return { progress: 0, heading: headingOf(beat.path[0], beat.path[1]), moving: false };
  const progress = glideEase(clamp01((t - beat.startMs) / beat.durMs));
  const i = Math.min(segs - 1, Math.floor(progress * segs)); // the same segment pointAlongPath puts the unit on
  const at = pointAlongPath(beat.path, progress);
  return { progress, heading: headingOf(beat.path[i], beat.path[i + 1]) ?? (at.dx ? (at.dx > 0 ? 0 : Math.PI) : undefined), moving: true };
}

// ---------------------------------------------------------------- the stage state

export interface UnitState {
  id: number;
  unit: Unit;
  faction: FactionId;
  /** Tile coordinates, fractional mid-glide. */
  x: number;
  y: number;
  /** Internal hit points 0..100 (the sample's, so a hit lowers it when the plan says). */
  hp: number;
  ghost: boolean;
  /** 0 solid .. 1 gone, ghosts only. */
  fade: number;
  pose: UnitPose;
  poseT: number;
  /** A heading this frame forces (walking, shooting, or where the step left the unit); undefined keeps the unit's last. */
  heading: number | undefined;
  look: Omit<UnitLook, 'heading'>;
}

export interface FxSpec {
  kind: Fx3dKind;
  at: Coord;
  /** Lift above the surface at `at`, world units. */
  lift: number;
  to?: Coord;
  toLift?: number;
  /** For a shot: the unit whose weapon the shot leaves from (its muzzle replaces `at` when the view can say where it is). */
  fromUnit?: number;
  progress: number;
  seed: number;
  color?: number;
}

export interface NumberSpec { at: Coord; text: string; tone: 'damage' | 'heal'; progress: number }

export interface StageState {
  units: UnitState[];
  fx: FxSpec[];
  numbers: NumberSpec[];
  /** How hard the camera should shake this frame, 0..1 (an ambush or an explosion, decaying). */
  shake: number;
}

/**
 * How far above the tile surface each plan effect is placed (the effects kit's convention). Ground-bound kinds draw their ring, scorch
 * or beam at `at.y`, so they sit just over the surface; a hit lands at the target's centre.
 */
export const GROUND_FX_LIFT = 0.1;
export const HIT_LIFT = 0.35;
const LIFT: Record<FxKind, number> = { hit: HIT_LIFT, explosion: GROUND_FX_LIFT, pulse: GROUND_FX_LIFT, ambush: GROUND_FX_LIFT, spawn: GROUND_FX_LIFT };

export interface MapInput {
  frame: ViewFrame;
  prev: ViewFrame;
  plan: TransitionPlan | null;
  sample: TransitionSample | null;
  t: number;
  info: StepInfo;
  step: number;
}

/** The whole picture for one animation frame, in tile coordinates. Only units the viewer may see are in it. */
export function mapStage(input: MapInput): StageState {
  const { plan, sample, t, info, step } = input;
  const frame = safeFrame(input.frame).frame;
  const prev = safeFrame(input.prev).frame;
  const units: UnitState[] = [];

  // Shots running now, and the pose each of their units takes.
  interface Live { shot: Shot; p: number; phase: ShotPhase }
  const live: Live[] = [];
  const poses = new Map<number, { pose: UnitPose; t: number }>();
  if (plan && sample) {
    for (const shot of info.shots) {
      const p = shotProgress(plan, shot, t);
      if (p === null) continue;
      const phase = shotPhase(shot.indirect, p);
      live.push({ shot, p, phase });
      if (phase.fire !== null) poses.set(shot.shooterId, { pose: 'fire', t: phase.fire });
      if (phase.hit !== null) poses.set(shot.targetId, { pose: 'hit', t: phase.hit });
    }
  }
  const aim = new Map<number, number>();
  for (const l of live) {
    const h = headingOf(l.shot.from, l.shot.to);
    if (h !== undefined) aim.set(l.shot.shooterId, h);
  }

  const place = (u: Unit, ghostFade: number | null, ctx: ViewFrame): void => {
    const g = ghostFade !== null;
    const placement = sample?.placements.get(u.id);
    const ghost = sample?.ghosts.find((s) => s.unit.id === u.id);
    const x = g ? ghost?.x ?? u.x : placement?.x ?? u.x;
    const y = g ? ghost?.y ?? u.y : placement?.y ?? u.y;
    const mv = plan && sample ? moveState(plan, u.id, t) : undefined;
    let pose: UnitPose = 'idle';
    let poseT = 0;
    const shotPose = poses.get(u.id);
    if (shotPose) {
      pose = shotPose.pose;
      poseT = shotPose.t;
    } else if (mv?.moving) {
      pose = 'move';
      poseT = mv.progress;
    }
    const faction = ctx.players[u.owner]?.faction ?? 'helion';
    units.push({
      id: u.id, unit: u, faction, x, y,
      hp: sample?.hp.get(u.id) ?? u.hp,
      ghost: g, fade: ghostFade ?? 0, pose, poseT,
      heading: aim.get(u.id) ?? mv?.heading ?? info.rest.get(u.id),
      look: {
        hp: Math.max(1, displayHp(sample?.hp.get(u.id) ?? u.hp)),
        spent: isSpent(ctx, u),
        status: unitStatus(ctx, u) ?? null,
        focused: step > 0 && info.actors.has(u.id),
      },
    });
  };

  for (const u of frame.units) {
    if (sample?.hidden.has(u.id)) continue;
    place(u, null, frame);
  }
  if (sample) {
    for (const g of sample.ghosts) {
      // A ghost is a unit the viewer saw in the previous frame; it must pass that frame's own sight test.
      const seen = prev.units.find((u) => u.id === g.unit.id);
      if (seen) place(seen, g.fade, prev);
    }
  }

  // Effects: the plan's samples, with each leading shot added and the impact moved to when the shot lands.
  const fx: FxSpec[] = [];
  const nth = new Map<string, number>();
  const liveAtTarget = (c: Coord): Live | undefined => live.find((l) => same(l.shot.to, c));
  for (const f of sample?.fx ?? []) {
    const key = `${f.kind}:${f.at.x},${f.at.y}`;
    const n = nth.get(key) ?? 0;
    nth.set(key, n + 1);
    let progress = f.progress;
    let color: number | undefined;
    if (f.kind === 'hit') {
      const l = liveAtTarget(f.at);
      if (l) {
        if (l.phase.impact === null) continue; // the shot has not landed yet
        progress = l.phase.impact;
        color = l.shot.faction ? FACTION_ACCENT[l.shot.faction] : undefined;
      }
    }
    fx.push({ kind: f.kind, at: f.at, lift: LIFT[f.kind], progress, seed: hashSeed(step, f.kind, f.at.x, f.at.y, n), color });
  }
  for (const l of live) {
    const color = l.shot.faction ? FACTION_ACCENT[l.shot.faction] : undefined;
    const seed = hashSeed(step, 'shot', l.shot.beat);
    if (l.phase.muzzle !== null) {
      fx.push({ kind: 'muzzle', at: l.shot.from, lift: 0.3, fromUnit: l.shot.shooterId, progress: l.phase.muzzle, seed, color });
    }
    if (l.phase.flight !== null) {
      fx.push({
        kind: l.shot.indirect ? 'shell' : 'tracer', at: l.shot.from, lift: 0.3, to: l.shot.to, toLift: HIT_LIFT,
        fromUnit: l.shot.shooterId, progress: l.phase.flight, seed, color,
      });
    }
  }

  const numbers: NumberSpec[] = [];
  for (const n of sample?.numbers ?? []) {
    // A damage number waits for the shot that causes it to land.
    const l = n.tone === 'damage' ? liveAtTarget(n.at) : undefined;
    if (l && l.phase.impact === null) continue;
    numbers.push({ at: n.at, text: n.text, tone: n.tone, progress: n.progress });
  }

  let shake = 0;
  for (const f of sample?.fx ?? []) {
    if (f.kind === 'ambush') shake = Math.max(shake, (1 - f.progress) * (f.progress < 0.5 ? 1 : 0.4));
    else if (f.kind === 'explosion') shake = Math.max(shake, 0.7 * (1 - f.progress) * (1 - f.progress));
  }
  return { units, fx, numbers, shake: clamp01(shake) };
}

// ---------------------------------------------------------------- spec -> world

export interface WorldEnv {
  /** Surface Y at a (fractional) tile position. */
  surface(x: number, y: number): number;
  /** World point where a unit's shots leave its weapon, or null when it has no view. */
  muzzleOf(unitId: number, out: Vector3): Vector3 | null;
}

const worldPoint = (env: WorldEnv, c: Coord, lift: number, out = new Vector3()): Vector3 =>
  out.set((c.x + 0.5) * TILE, env.surface(c.x, c.y) + lift, (c.y + 0.5) * TILE);

export function toFxItems(specs: readonly FxSpec[], env: WorldEnv): FxItem[] {
  return specs.map((s): FxItem => {
    let at: Vector3 | null = null;
    if (s.fromUnit !== undefined) at = env.muzzleOf(s.fromUnit, new Vector3());
    at ??= worldPoint(env, s.at, s.lift);
    const item: FxItem = { kind: s.kind, at, progress: s.progress, seed: s.seed };
    if (s.to) item.to = worldPoint(env, s.to, s.toLift ?? s.lift);
    if (s.color !== undefined) item.color = s.color;
    return item;
  });
}

export function toNumberItems(specs: readonly NumberSpec[], env: WorldEnv): NumberItem[] {
  return specs.map((n): NumberItem => ({ at: worldPoint(env, n.at, 0.85), text: n.text, tone: n.tone, progress: n.progress }));
}
