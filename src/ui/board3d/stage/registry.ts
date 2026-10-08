// The unit views of the 3D stage, kept by unit id and reused from step to step: a unit that is still on the board keeps its view (and so
// its idle animation and its heading); a view is built only for a unit the stage was told to show, and disposed when that unit leaves.
//
// The registry never decides what may be shown. The caller hands it the units mapStage produced, which passed the viewer guard
// (guard.ts), and `sync` builds a view for exactly those: a hidden unit is not in the list, so it has no view.
import type { FactionId, UnitTypeId } from '../../../game/aw';
import type { CreateUnitView, UnitLook, UnitPose, UnitView } from '../contract';

export interface Wanted { id: number; type: UnitTypeId; faction: FactionId }

interface Entry {
  view: UnitView;
  type: UnitTypeId;
  faction: FactionId;
  /** The heading the unit is turning toward, and the one it shows now (they differ while it turns). */
  goal: number;
  shown: number;
  look: UnitLook | null;
  pose: UnitPose | null;
  poseT: number;
}

const near = (a: number, b: number, eps = 1e-3): boolean => Math.abs(a - b) <= eps;

/** An angle wrapped to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Turns `from` toward `to` by the shortest way, exponentially: never overshoots, and lands exactly when close. */
export function turnToward(from: number, to: number, dtSec: number, rate = 16): number {
  const d = wrapAngle(to - from);
  if (Math.abs(d) < 1e-3) return to;
  return from + d * (1 - Math.exp(-rate * Math.max(0, dtSec)));
}

const sameLook = (a: UnitLook, b: UnitLook): boolean =>
  a.hp === b.hp && a.spent === b.spent && a.status === b.status && a.focused === b.focused && near(a.heading, b.heading);

export class UnitRegistry {
  private readonly entries = new Map<number, Entry>();

  constructor(private readonly create: CreateUnitView) {}

  get size(): number { return this.entries.size; }

  has(id: number): boolean { return this.entries.has(id); }

  view(id: number): UnitView | undefined { return this.entries.get(id)?.view; }

  ids(): number[] { return [...this.entries.keys()]; }

  /**
   * Makes the views match `wanted`: builds a view for each new id, rebuilds one whose type or faction changed, and disposes every view
   * that is no longer wanted. `homeHeading` is the facing a brand-new view starts with.
   */
  sync(wanted: readonly Wanted[], homeHeading: (id: number) => number, onAdd?: (view: UnitView) => void, onRemove?: (view: UnitView) => void): { created: number[]; removed: number[] } {
    const created: number[] = [];
    const removed: number[] = [];
    const keep = new Set<number>();
    for (const w of wanted) {
      keep.add(w.id);
      const have = this.entries.get(w.id);
      if (have && have.type === w.type && have.faction === w.faction) continue;
      if (have) {
        onRemove?.(have.view);
        have.view.dispose();
        removed.push(w.id);
      }
      const view = this.create(w.type, w.faction);
      const home = homeHeading(w.id);
      this.entries.set(w.id, { view, type: w.type, faction: w.faction, goal: home, shown: home, look: null, pose: null, poseT: 0 });
      onAdd?.(view);
      created.push(w.id);
    }
    for (const [id, e] of this.entries) {
      if (keep.has(id)) continue;
      onRemove?.(e.view);
      e.view.dispose();
      this.entries.delete(id);
      removed.push(id);
    }
    return { created, removed };
  }

  /**
   * The heading a unit shows now. A forced one (walking, shooting) becomes its goal; with no forced heading it keeps the last, as a unit
   * does between steps. `smooth` turns toward the goal over a few frames; otherwise (scrubbing, reduced motion) it lands on it at once.
   */
  heading(id: number, forced: number | undefined, dtSec: number, smooth: boolean): number {
    const e = this.entries.get(id);
    if (!e) return forced ?? 0;
    if (forced !== undefined) e.goal = forced;
    e.shown = smooth ? turnToward(e.shown, e.goal, dtSec) : e.goal;
    return e.shown;
  }

  /** Sets a unit's look only when it changed since the last call, so a still unit costs the view nothing. */
  look(id: number, look: UnitLook): void {
    const e = this.entries.get(id);
    if (!e || (e.look && sameLook(e.look, look))) return;
    e.look = { ...look };
    e.view.setLook(look);
  }

  /** Sets a pose; `idle` ignores t, so it is sent once, and other poses are sent every frame (their t moves). */
  pose(id: number, pose: UnitPose, t: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (pose === 'idle' && e.pose === 'idle') return;
    e.pose = pose;
    e.poseT = t;
    e.view.setPose(pose, t);
  }

  update(dtSec: number, timeSec: number): void {
    for (const e of this.entries.values()) e.view.update(dtSec, timeSec);
  }

  dispose(onRemove?: (view: UnitView) => void): void {
    for (const e of this.entries.values()) {
      onRemove?.(e.view);
      e.view.dispose();
    }
    this.entries.clear();
  }
}
