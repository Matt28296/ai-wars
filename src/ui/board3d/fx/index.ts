// The 3D effects kit (D-018). `createFx` returns the FxView the renderer core draws with.
//
// STATELESS: draw(items) rewrites everything from each item's (kind, progress, seed, at, to, color). There is no clock, no stored
// particle and no Math.random anywhere, so scrubbing backwards shows exactly what going forward showed at the same progress, and
// update() has nothing to advance.
//
// Cost: the whole kit draws through three instanced batches (additive glow, alpha smoke, opaque debris) plus one sprite per
// visible number, so a frame is 3 draw calls plus numbers however many effects run. Four pooled point lights give the
// muzzle and explosion pops. Buffers are preallocated; draw() allocates nothing once the number pool is warm.
import { Group } from 'three';
import type { CreateFx, FxItem, FxView, NumberItem } from '../contract';
import { DebrisBatch, SpriteBatch } from './batches';
import { buildEffect, FxContext } from './kinds';
import { LightPool, MAX_LIGHTS } from './lights';
import { NumberLayer } from './numbers';

export { mulberry32, Rng } from './rng';
export { shellApex, shellPoint } from './kinds';
export { numberPose, NUMBER_HEIGHT } from './numbers';

/** Effects drawn at once. A frame with more drops the extras (the budget is 30 at 60 fps). */
export const MAX_EFFECTS = 32;
export { MAX_LIGHTS };

const GLOW_CAPACITY = 2560;
const SMOKE_CAPACITY = 1024;
const DEBRIS_CAPACITY = 512;
/** With reduced motion the kit draws this fraction of the particles. */
const REDUCED_DENSITY = 0.5;

export interface FxStats {
  /** Effects drawn this frame. */
  effects: number;
  /** Effects in the list that were not drawn (over MAX_EFFECTS, a progress outside 0..1, or an unknown kind). */
  skipped: number;
  /** Particles refused because a batch was full. */
  dropped: number;
  instances: { glow: number; smoke: number; debris: number };
  /** Lights carrying a pop this frame (at most 4). */
  lights: number;
  /** Number sprites shown this frame. */
  numbers: number;
  /** Renderable objects the kit asks the renderer to draw this frame (an upper bound on draw calls; lights cost none). */
  drawCalls: number;
  /** Pool sizes, which must stay put after warm-up. */
  pooled: { numberSprites: number; numberTextures: number; lights: number };
}

/** The FxView plus the knobs and counters the gallery and the tests use. The renderer core needs only FxView. */
export interface FxKit extends FxView {
  /** Reduced motion: half the particles, the same shapes. Takes effect on the next draw. */
  setReducedMotion(on: boolean): void;
  stats(): FxStats;
}

export function createFxKit(): FxKit {
  const group = new Group();
  group.name = 'fx';
  const glow = new SpriteBatch(GLOW_CAPACITY, 'add', 'fx-glow', 12, 0.85);
  const smoke = new SpriteBatch(SMOKE_CAPACITY, 'normal', 'fx-smoke', 10, 0.7);
  const debris = new DebrisBatch(DEBRIS_CAPACITY);
  group.add(debris.mesh, smoke.mesh, glow.mesh);
  const lights = new LightPool(group);
  const numberLayer = new NumberLayer(group);
  const ctx = new FxContext(glow, smoke, debris, lights);
  let drawn = 0;
  let skipped = 0;
  let disposed = false;

  const view: FxKit = {
    group,
    draw(items: readonly FxItem[]): void {
      if (disposed) return;
      glow.reset();
      smoke.reset();
      debris.reset();
      lights.begin();
      drawn = 0;
      skipped = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const p = it.progress;
        if (drawn >= MAX_EFFECTS || !(p >= 0 && p <= 1)) { skipped++; continue; }
        ctx.begin(it);
        buildEffect(ctx, it, p);
        drawn++;
      }
      glow.commit();
      smoke.commit();
      debris.commit();
      lights.end();
    },
    numbers(items: readonly NumberItem[]): void {
      if (disposed) return;
      numberLayer.draw(items);
    },
    update(): void {
      // Nothing advances: every frame is drawn from the items alone.
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      glow.dispose();
      smoke.dispose();
      debris.dispose();
      lights.dispose();
      numberLayer.dispose();
      group.clear();
    },
    setReducedMotion(on: boolean): void {
      ctx.density = on ? REDUCED_DENSITY : 1;
    },
    stats(): FxStats {
      const numbers = numberLayer.shown;
      return {
        effects: drawn,
        skipped,
        dropped: glow.dropped + smoke.dropped + debris.dropped,
        instances: { glow: glow.n, smoke: smoke.n, debris: debris.n },
        lights: lights.active,
        numbers,
        drawCalls: (glow.n > 0 ? 1 : 0) + (smoke.n > 0 ? 1 : 0) + (debris.n > 0 ? 1 : 0) + numbers,
        pooled: { numberSprites: numberLayer.pool.length, numberTextures: numberLayer.textures, lights: lights.lights.length },
      };
    },
  };
  return view;
}

export const createFx: CreateFx = () => createFxKit();
