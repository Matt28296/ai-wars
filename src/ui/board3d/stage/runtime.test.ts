// The stage core, run end to end in node: the real StageRuntime on a stand-in GPU (a renderer that draws nothing) and a stand-in page
// (a canvas, a host, a frame clock we advance by hand). What is real: the runtime, the transition plan, the mapping, the camera rig, the
// table, the storm static, the effects kit and the post-processing passes' construction. What is stood in for: WebGL, the DOM and the clock.
// So these tests check the WIRING of G8b: what the terrain is told about occupancy, what the effects kit is told about reduced motion,
// when the match intro runs, and what the storm and the table do.
import { Group, Object3D, Vector2 } from 'three';
import type { Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Coord, GameEvent } from '../../../game/aw';
import { fixtureMap } from '../../../game/aw/testing';
import type { FixtureUnit } from '../../../game/aw/testing';
import { recordMatch, viewTimeline } from '../../watch/timeline';
import type { Timeline, TimelineStep, ViewFrame } from '../../watch/timeline';
import { fieldSetup, pt } from '../../watch/testing';
import { planTransition } from '../../watch/transition';
import type { TransitionPlan } from '../../watch/transition';
import type { CreateFx, CreateTerrain, CreateUnitView, FxView, TerrainView, UnitView, UnitViewOptions } from '../contract';
import { createFxKit } from '../fx';
import type { FxKit } from '../fx';
import { FACTION_ACCENT } from '../palette';
import { INTRO_DISTANCE, INTRO_PITCH_DEG, INTRO_SECONDS } from './intro';
import { SHAKE_AMPLITUDE } from './shake';
import { SWEEP } from './sweep';
import { OCCUPIED_SNAP_DT_SEC } from './occupancy';
import { fitDistance, PITCH_DEG } from './rig';
import { StageRuntime } from './runtime';
import type { StageHooks, StageModules, StageView } from './runtime';
import { REMEMBER_KEY, REMEMBER_MS, TIER_ORDER, passNames } from './quality';
import { analyseMotion } from '../../watch/motion/analysis';
import type { MotionProbe, Recording } from '../../watch/motion/types';
import type { QualitySignals, QualityTier, StorageLike } from './quality';
import { stormCount } from './storm';
import { fieldFrame, idOf } from './testing';
import { createUnitView as realUnitView } from '../units';
import type { UnitKit } from '../units';
import { modelOf, visibleTriangles, worldPositions } from '../units/measure';

// ---------------------------------------------------------------- the stand-in page

const CANVAS_W = 1000;
const CANVAS_H = 600;

/** A strong desktop GPU: the start tier is 'high' whatever machine runs the tests (the real signals come from the host's navigator). */
const STRONG: QualitySignals = { renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', maxTextureSize: 16384, hardwareConcurrency: 16, devicePixelRatio: 1 };

interface Page { advance(ms: number): void; frames(count: number, ms?: number): void; now(): number; pendingFrames(): number; idle(ms: number): void }

/** A fake canvas/host/window/clock. `advance` runs the one pending animation frame at the new time. */
function installPage(): Page {
  let clock = 5000;
  let pending: ((t: number) => void) | null = null;
  // a 2D context that draws nothing (the damage numbers paint text onto a canvas before it becomes a texture)
  const sink = (): unknown => new Proxy(function sinkFn() { return undefined; }, {
    get: (_t, k) => (k === 'width' ? 8 : sink()),
    apply: () => sink(),
    set: () => true,
  });
  const context2d = sink;
  const el = (): Record<string, unknown> => ({
    style: {}, className: '', clientWidth: CANVAS_W, clientHeight: CANVAS_H, width: 0, height: 0,
    setAttribute: () => undefined, appendChild: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined,
    remove: () => undefined, setPointerCapture: () => undefined, releasePointerCapture: () => undefined, getContext: () => context2d(),
  });
  vi.stubGlobal('document', { createElement: () => el() });
  vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined, devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => { pending = cb; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { pending = null; });
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const advance = (ms: number): void => {
    clock += ms;
    const cb = pending;
    pending = null;
    cb?.(clock);
  };
  return {
    advance, frames: (count, ms = 1000 / 60) => { for (let i = 0; i < count; i++) advance(ms); }, now: () => clock, pendingFrames: () => (pending ? 1 : 0),
    // time passes with no animation frame in it (the clock moves; the pending frame stays pending)
    idle: (ms) => { clock += ms; },
  };
}

/** A renderer that does nothing: every call is accepted, the few the passes read answer sensibly. */
function fakeRenderer(): WebGLRenderer {
  const state: Record<string, unknown> = {
    outputColorSpace: '', toneMapping: 0, toneMappingExposure: 1, autoClear: true, shadowMap: { enabled: false, type: 0 },
    getPixelRatio: () => 1,
    getSize: (v: Vector2) => v.set(CANVAS_W, CANVAS_H),
    getDrawingBufferSize: (v: Vector2) => v.set(CANVAS_W, CANVAS_H),
    getClearColor: (c: unknown) => c,
    getClearAlpha: () => 1,
    getRenderTarget: () => null,
  };
  return new Proxy(state, { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: (t, k, v) => { t[k as string] = v; return true; } }) as unknown as WebGLRenderer;
}

// ---------------------------------------------------------------- recording stand-ins for the kits

interface TerrainLog {
  created: number;
  disposed: number;
  occupied: ((x: number, y: number) => boolean)[];
  /** Every setOccupied and every update, in the order the stage made them: 'occupied' or 'update:<dt>'. */
  events: string[];
  /** The dt of every terrain.update, in order. */
  updates: number[];
}

function recordingTerrain(): { create: CreateTerrain; log: TerrainLog } {
  const log: TerrainLog = { created: 0, disposed: 0, occupied: [], events: [], updates: [] };
  const create: CreateTerrain = () => {
    log.created++;
    const v: TerrainView = {
      group: new Group(),
      heightAt: () => 0,
      setOwners: () => undefined,
      setCapture: () => undefined,
      setOccupied: (f) => { log.occupied.push(f); log.events.push('occupied'); },
      setVisible: () => undefined,
      setWeather: () => undefined,
      update: (dt) => { log.updates.push(dt); log.events.push(`update:${dt}`); },
      dispose: () => { log.disposed++; },
    };
    return v;
  };
  return { create, log };
}

/** The tiles `f` answers true for, as "x,y" in reading order. */
const tilesOf = (f: (x: number, y: number) => boolean, w: number, h: number): string[] => {
  const out: string[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f(x, y)) out.push(`${x},${y}`);
  return out;
};

function unitViews(): { create: CreateUnitView; made: string[]; calls: { type: string; faction: string; opts: UnitViewOptions | undefined }[]; live: () => number } {
  const made: string[] = [];
  const calls: { type: string; faction: string; opts: UnitViewOptions | undefined }[] = [];
  let live = 0;
  const create: CreateUnitView = (type, faction, opts) => {
    made.push(type);
    calls.push({ type, faction, opts });
    live++;
    const v: UnitView = {
      object: new Object3D(), type, setLook: () => undefined, setPose: () => undefined, muzzleWorld: (out) => out.set(0, 0, 0),
      update: () => undefined, dispose: () => { live--; },
    };
    return v;
  };
  return { create, made, calls, live: () => live };
}

const plainFx: CreateFx = () => {
  const v: FxView = { group: new Group(), draw: () => undefined, numbers: () => undefined, update: () => undefined, dispose: () => undefined };
  return v;
};

// ---------------------------------------------------------------- fixtures: a field, a kill, a longer match

const frame0 = fieldFrame([
  { type: 'lancer', owner: 0, x: 2, y: 1 }, { type: 'trooper', owner: 1, x: 3, y: 1 }, { type: 'mule', owner: 0, x: 1, y: 1 },
]);
const LANCER = idOf(frame0, 'lancer');
const TROOPER = idOf(frame0, 'trooper');
const MULE = idOf(frame0, 'mule');
const W = frame0.width;
const H = frame0.height;

const step = (index: number, frame: ViewFrame, events: GameEvent[] = []): TimelineStep => ({ index, action: null, frame, events, powerUses: [0, 0] });
const timelineOf = (frames: ViewFrame[], events: GameEvent[][] = []): Timeline => ({
  viewer: 'all', last: frames.length - 1, steps: frames.map((f, i) => step(i, f, events[i] ?? [])),
});
/** The same frame with units moved: spreads every unit it changes, never builds one from nothing. */
const moved = (f: ViewFrame, id: number, x: number, y: number): ViewFrame => ({ ...f, units: f.units.map((u) => (u.id === id ? { ...u, x, y } : u)) });
const without = (f: ViewFrame, id: number): ViewFrame => ({ ...f, units: f.units.filter((u) => u.id !== id) });
const storm = (f: ViewFrame): ViewFrame => ({ ...f, weather: 'ionstorm' });

const planOf = (a: ViewFrame, b: ViewFrame, events: GameEvent[]): TransitionPlan => planTransition(a, b, events, { speed: 1, reducedMotion: false });

const ATTACK: GameEvent = { kind: 'attacked', attackerId: LANCER, defenderId: TROOPER, damage: 42, counter: 18, attackerHp: 82, defenderHp: 58 };
const DEAD: GameEvent = { kind: 'destroyed', unitId: TROOPER, at: pt(3), type: 'trooper', owner: 1 };

// ---------------------------------------------------------------- the harness

interface Rig {
  rt: StageRuntime;
  page: Page;
  terrain: TerrainLog;
  views: ReturnType<typeof unitViews>;
  hooks: { done: number; failed: string[]; quality: string[]; scales: number[] };
  view(partial: Partial<StageView> & Pick<StageView, 'timeline'>): void;
}

function build(modules: Partial<StageModules> = {}, width = CANVAS_W): Rig {
  const page = installPage();
  const t = recordingTerrain();
  const views = unitViews();
  const hooks = { done: 0, failed: [] as string[], quality: [] as string[], scales: [] as number[] };
  const h: StageHooks = {
    onDone: () => { hooks.done++; }, onOverlay: () => undefined, onFail: (r) => { hooks.failed.push(r); },
    onQuality: (tier, pinned, scale) => { hooks.quality.push(`${tier}${pinned ? ' (forced)' : ''}`); hooks.scales.push(scale ?? Number.NaN); },
  };
  const rt = new StageRuntime({ ...(el()), clientWidth: width } as unknown as HTMLElement, h, {
    createRenderer: () => fakeRenderer(), createTerrain: t.create, createUnitView: views.create, createFx: plainFx, search: '', signals: STRONG, ...modules,
  });
  return {
    rt, page, terrain: t.log, views, hooks,
    view: (v) => rt.setView({ step: 0, plan: null, reducedMotion: false, ...v }),
  };
}
const el = (): Record<string, unknown> => ({ clientWidth: CANVAS_W, clientHeight: CANVAS_H, appendChild: () => undefined });

let rig: Rig | null = null;
beforeEach(() => { rig = null; });
afterEach(() => {
  rig?.rt.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const make = (modules: Partial<StageModules> = {}, width = CANVAS_W): Rig => { rig = build(modules, width); return rig; };

// ---------------------------------------------------------------- occupied properties

describe('the terrain is told which tiles are occupied', () => {
  it('on the first frame: exactly the tiles with a live unit in the viewer\'s frame, as x,y', () => {
    const r = make();
    r.view({ timeline: timelineOf([frame0]) });
    expect(r.terrain.occupied).toHaveLength(0); // nothing is drawn until a frame runs
    r.page.frames(2);
    expect(r.terrain.occupied).toHaveLength(1);
    expect(tilesOf(r.terrain.occupied[0], W, H)).toEqual(['1,1', '2,1', '3,1']);
    // known-bad: the stub is a real recording: it does not say yes to a free tile, and x and y are not swapped
    expect(r.terrain.occupied[0](0, 0)).toBe(false);
    expect(r.terrain.occupied[0](1, 2)).toBe(false);
  });

  it('does not repeat itself every frame, only when the set changes', () => {
    const r = make();
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(30);
    expect(r.terrain.occupied).toHaveLength(1);
  });

  it('follows a unit that moves between steps (scrubbing: no plan, so it jumps)', () => {
    const next = moved(frame0, LANCER, 2, 0);
    const timeline = timelineOf([frame0, next]);
    const r = make();
    r.view({ timeline, step: 0 });
    r.page.frames(2);
    r.view({ timeline, step: 1 });
    r.page.frames(2);
    expect(r.terrain.occupied).toHaveLength(2);
    expect(tilesOf(r.terrain.occupied[1], W, H)).toEqual(['2,0', '1,1', '3,1']);
    r.view({ timeline, step: 0 }); // and back
    r.page.frames(2);
    expect(tilesOf(r.terrain.occupied[2], W, H)).toEqual(['1,1', '2,1', '3,1']);
  });

  it('does not count the ghost of a dying unit: its tile is free while it fades, and the unit beside it still counts', () => {
    const next = without(frame0, TROOPER);
    const events = [ATTACK, DEAD];
    const plan = planOf(frame0, next, events);
    const boom = plan.fx.find((f) => f.kind === 'explosion')!;
    const timeline = timelineOf([frame0, next], [[], events]);
    const r = make();
    r.view({ timeline, step: 0 });
    r.page.frames(2);
    expect(tilesOf(r.terrain.occupied.at(-1)!, W, H)).toContain('3,1'); // alive: counted
    r.view({ timeline, step: 1, plan });
    r.page.advance(boom.startMs + boom.durMs / 2); // mid-explosion: the trooper is a fading ghost
    // the ghost is really being drawn (its view is alive), and it is NOT counted
    expect(r.views.made.filter((t) => t === 'trooper')).toHaveLength(1);
    expect(r.views.live()).toBe(3);
    const mid = r.terrain.occupied.at(-1)!;
    expect(tilesOf(mid, W, H)).toEqual(['1,1', '2,1']);
    expect(mid(3, 1)).toBe(false);
    // known-bad: had the ghost been counted, the set would still hold tile 3,1 (it did a moment ago, before the plan)
    expect(tilesOf(r.terrain.occupied[0], W, H)).toContain('3,1');
    // and after the plan, the same two tiles
    r.page.advance(plan.durationMs + 200);
    r.page.frames(2);
    expect(tilesOf(r.terrain.occupied.at(-1)!, W, H)).toEqual(['1,1', '2,1']);
  });

  it('puts a unit that is gliding onto the tile it is nearest: the old tile frees halfway', () => {
    const next = moved(frame0, MULE, 0, 1);
    const events: GameEvent[] = [{ kind: 'moved', unitId: MULE, path: [pt(1), pt(0)], cost: 1, fuel: 0 } as GameEvent];
    const plan = planOf(frame0, next, events);
    expect(plan.moves.length).toBeGreaterThan(0);
    const timeline = timelineOf([frame0, next], [[], events]);
    const r = make();
    r.view({ timeline, step: 0 });
    r.page.frames(2);
    r.view({ timeline, step: 1, plan });
    const m = plan.moves[0];
    r.page.advance(m.startMs + 4); // the glide has hardly begun: still on 1,1
    expect(tilesOf(r.terrain.occupied.at(-1)!, W, H)).toContain('1,1');
    r.page.advance(m.durMs); // past the end of the glide: on 0,1
    expect(tilesOf(r.terrain.occupied.at(-1)!, W, H)).toContain('0,1');
    expect(tilesOf(r.terrain.occupied.at(-1)!, W, H)).not.toContain('1,1');
  });

  it('a hidden unit is not counted: a fogged viewer\'s frame has no unit there, so the tile stays free', () => {
    const fogged = without(frame0, TROOPER); // what observe() gives a viewer who cannot see it
    const r = make();
    r.view({ timeline: timelineOf([fogged]) });
    r.page.frames(2);
    expect(tilesOf(r.terrain.occupied[0], W, H)).toEqual(['1,1', '2,1']);
    expect(r.views.made).not.toContain('trooper');
  });

  it('is told again for a new terrain, which starts with nothing occupied, even when the same tiles are occupied as before', () => {
    const r = make();
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(2);
    expect(r.terrain.created).toBe(1);
    expect(r.terrain.occupied).toHaveLength(1);
    // the same units on the same board, but a map the stage takes for another (its id differs): the terrain is rebuilt
    r.view({ timeline: timelineOf([{ ...frame0, mapId: 'the-same-field-renamed' }]) });
    r.page.frames(2);
    expect(r.terrain.created).toBe(2);
    expect(r.terrain.disposed).toBe(1); // the first one was freed
    expect(r.terrain.occupied).toHaveLength(2); // the new terrain was told, though the set is the same
    expect(tilesOf(r.terrain.occupied[1], W, H)).toEqual(tilesOf(r.terrain.occupied[0], W, H));
  });

  it('and for a different map with different units', () => {
    const r = make();
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(2);
    const other = viewTimeline(recordMatch({
      ...fieldSetup([{ type: 'lancer', owner: 0, x: 1, y: 0 }], { fog: false }),
      map: fixtureMap(['.....', '.....'], [{ type: 'lancer', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 4, y: 1 }], undefined, 'another-map'),
    }, []), 'all');
    r.view({ timeline: other });
    r.page.frames(2);
    expect(r.terrain.created).toBe(2);
    expect(r.terrain.occupied).toHaveLength(2);
    expect(tilesOf(r.terrain.occupied[1], 5, 2)).toEqual(['1,0', '4,1']);
  });
});

describe('the terrain eases occupied properties inside update(dt): when the stage lets it ease and when it snaps', () => {
  /** The events right after each setOccupied: the one that follows it. */
  const afterOccupied = (events: string[]): string[] => events.flatMap((e, i) => (e === 'occupied' ? [events[i + 1] ?? '(end)'] : []));
  const big = `update:${OCCUPIED_SNAP_DT_SEC}`;

  it('the first setOccupied on a board is followed at once by a long update, so nothing sinks at load', () => {
    const r = make();
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(5);
    expect(OCCUPIED_SNAP_DT_SEC).toBeGreaterThanOrEqual(1); // long enough to finish a quarter-second ease many times over
    expect(r.terrain.events.indexOf('occupied')).toBeGreaterThanOrEqual(0);
    expect(afterOccupied(r.terrain.events)).toEqual([big]);
    // and every other update is a real frame's dt: no long one slips into normal frames
    const normal = r.terrain.updates.filter((dt) => dt !== OCCUPIED_SNAP_DT_SEC);
    expect(normal.length).toBeGreaterThanOrEqual(5);
    for (const dt of normal) { expect(dt).toBeGreaterThan(0); expect(dt).toBeLessThanOrEqual(0.1 + 1e-9); }
  });

  it('a new terrain (another map) gets the same treatment on its first call', () => {
    const r = make();
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(3);
    r.view({ timeline: timelineOf([{ ...frame0, mapId: 'the-same-field-renamed' }]) });
    r.page.frames(3);
    expect(afterOccupied(r.terrain.events)).toEqual([big, big]);
  });

  it('the first call on a rebuilt board snaps even when the view that rebuilt it arrives with an animation', () => {
    const renamed = (f: ViewFrame): ViewFrame => ({ ...f, mapId: 'the-same-field-renamed' });
    const next = moved(frame0, MULE, 0, 1);
    const events: GameEvent[] = [{ kind: 'moved', unitId: MULE, path: [pt(1), pt(0)] } as GameEvent];
    const plan = planOf(renamed(frame0), renamed(next), events);
    expect(plan.durationMs).toBeGreaterThan(0);
    const r = make();
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(3);
    r.view({ timeline: timelineOf([renamed(frame0), renamed(next)], [[], events]), step: 1, plan });
    r.page.advance(10);
    expect(r.terrain.created).toBe(2);
    expect(afterOccupied(r.terrain.events)).toEqual([big, big]); // the new terrain starts empty: no ease from nothing
  });

  it('a scrub or a jump snaps: the change lands with a long update behind it', () => {
    const timeline = timelineOf([frame0, moved(frame0, LANCER, 2, 0), moved(frame0, LANCER, 4, 2)]);
    const r = make();
    r.view({ timeline, step: 0 });
    r.page.frames(3);
    r.view({ timeline, step: 2 }); // a jump forward (no plan)
    r.page.frames(3);
    r.view({ timeline, step: 1 }); // a rewind
    r.page.frames(3);
    expect(r.terrain.occupied).toHaveLength(3);
    expect(afterOccupied(r.terrain.events)).toEqual([big, big, big]);
  });

  it('another viewer\'s timeline (a snap) is a jump too', () => {
    const a = timelineOf([frame0, moved(frame0, LANCER, 2, 0)]);
    const r = make();
    r.view({ timeline: a, step: 1 });
    r.page.frames(3);
    const b = { ...a, steps: a.steps.map((st, i) => (i === 1 ? { ...st, frame: moved(frame0, LANCER, 5, 2) } : st)) };
    r.view({ timeline: b, step: 1 });
    r.page.frames(3);
    expect(afterOccupied(r.terrain.events)).toEqual([big, big]);
  });

  it('during playback the change eases: the real frame dt follows it, never the long one (known-bad: that is not the snap case)', () => {
    const next = moved(frame0, MULE, 0, 1);
    const events: GameEvent[] = [{ kind: 'moved', unitId: MULE, path: [pt(1), pt(0)] } as GameEvent];
    const plan = planOf(frame0, next, events);
    const timeline = timelineOf([frame0, next], [[], events]);
    const r = make();
    r.view({ timeline, step: 0 });
    r.page.frames(3);
    expect(afterOccupied(r.terrain.events)).toEqual([big]); // the first call snapped
    r.view({ timeline, step: 1, plan }); // forward one step, with its animation
    const m = plan.moves[0];
    r.page.advance(m.startMs + 4);
    r.page.advance(m.durMs); // the glide ends: 0,1 is occupied and 1,1 is free
    r.page.frames(3);
    expect(r.terrain.occupied.length).toBeGreaterThan(1);
    const after = afterOccupied(r.terrain.events);
    expect(after[0]).toBe(big);
    for (const e of after.slice(1)) {
      expect(e).not.toBe(big);
      const dt = Number(e.replace('update:', ''));
      expect(dt).toBeGreaterThan(0);
      expect(dt).toBeLessThanOrEqual(0.1 + 1e-9);
    }
    // and no further long update was made for it
    expect(r.terrain.updates.filter((dt) => dt === OCCUPIED_SNAP_DT_SEC)).toHaveLength(1);
  });

  it('an unchanged set makes no call and no long update, even on a jump', () => {
    const timeline = timelineOf([frame0, { ...frame0 }]);
    const r = make();
    r.view({ timeline, step: 0 });
    r.page.frames(3);
    r.view({ timeline, step: 1 }); // a jump to a step with the same units
    r.page.frames(3);
    expect(r.terrain.occupied).toHaveLength(1);
    expect(r.terrain.updates.filter((dt) => dt === OCCUPIED_SNAP_DT_SEC)).toHaveLength(1);
  });

  it('a jump that changes nothing spends its flag: a real change during the next playback eases', () => {
    const next = moved(frame0, LANCER, 2, 0);
    const events: GameEvent[] = [{ kind: 'moved', unitId: LANCER, path: [pt(2), pt(2, 0)] } as GameEvent];
    const plan = planOf(frame0, next, events);
    expect(plan.durationMs).toBeGreaterThan(0);
    const timeline = timelineOf([frame0, { ...frame0 }, next], [[], [], events]);
    const r = make();
    r.view({ timeline, step: 0 });
    r.page.frames(3);
    r.view({ timeline, step: 1 }); // a jump, nothing changes
    r.page.frames(3);
    r.view({ timeline, step: 2, plan }); // then forward with an animation
    r.page.advance(plan.moves[0].startMs + plan.moves[0].durMs + 50);
    r.page.frames(3);
    expect(r.terrain.occupied).toHaveLength(2);
    expect(afterOccupied(r.terrain.events)).toEqual([big, expect.stringMatching(/^update:0\.\d+/)]);
  });
});

// ---------------------------------------------------------------- reduced motion for the effects kit

describe('the effects kit follows reduced motion', () => {
  const recordingFx = (): { create: CreateFx; calls: boolean[] } => {
    const calls: boolean[] = [];
    const create: CreateFx = () => ({ ...plainFx(), setReducedMotion: (on: boolean) => { calls.push(on); } }) as FxView;
    return { create, calls };
  };

  it('is told on the first view and then on every change, never twice in a row for the same value', () => {
    const fx = recordingFx();
    const r = make({ createFx: fx.create });
    const timeline = timelineOf([frame0, moved(frame0, LANCER, 2, 0), moved(frame0, LANCER, 2, 2)]);
    r.view({ timeline, step: 0, reducedMotion: false });
    expect(fx.calls).toEqual([false]);
    r.view({ timeline, step: 1, reducedMotion: false }); // another step, the same setting
    expect(fx.calls).toEqual([false]);
    r.view({ timeline, step: 1, reducedMotion: true });
    expect(fx.calls).toEqual([false, true]);
    r.view({ timeline, step: 2, reducedMotion: true });
    expect(fx.calls).toEqual([false, true]);
    r.view({ timeline, step: 2, reducedMotion: false });
    expect(fx.calls).toEqual([false, true, false]);
  });

  it('starts reduced when the page starts reduced', () => {
    const fx = recordingFx();
    const r = make({ createFx: fx.create });
    r.view({ timeline: timelineOf([frame0]), reducedMotion: true });
    expect(fx.calls).toEqual([true]);
  });

  it('copes with a kit that has no such method (an injected FxView), and does not throw', () => {
    const r = make({ createFx: plainFx });
    expect(() => {
      r.view({ timeline: timelineOf([frame0]), reducedMotion: true });
      r.view({ timeline: timelineOf([frame0]), reducedMotion: false });
      r.page.frames(3);
    }).not.toThrow();
    expect(r.hooks.failed).toEqual([]);
  });

  it('the default kit is createFxKit, and reduced motion really halves what it draws', () => {
    let kit: FxKit | null = null;
    const r = make({ createFx: () => { kit = createFxKit(); return kit; } });
    const timeline = timelineOf([frame0, moved(frame0, LANCER, 2, 0)]);
    r.view({ timeline, reducedMotion: false });
    const k = kit as unknown as FxKit;
    expect(typeof k.setReducedMotion).toBe('function');
    const burst = [{ kind: 'explosion' as const, at: { x: 1, y: 0.1, z: 1 }, progress: 0.3, seed: 7 }] as unknown as Parameters<FxKit['draw']>[0];
    k.draw(burst);
    const full = k.stats().instances.glow;
    expect(full).toBeGreaterThan(10);
    r.view({ timeline, reducedMotion: true });
    k.draw(burst);
    const reduced = k.stats().instances.glow;
    expect(reduced).toBeLessThan(full);
    expect(reduced).toBeGreaterThan(full * 0.35); // about half, not none
    expect(reduced).toBeLessThan(full * 0.65);
    r.view({ timeline, reducedMotion: false });
    k.draw(burst);
    expect(k.stats().instances.glow).toBe(full); // and back
  });
});

// ---------------------------------------------------------------- the match intro

describe('the match intro', () => {
  const longTimeline = timelineOf([frame0, moved(frame0, LANCER, 2, 0), moved(frame0, LANCER, 2, 2), moved(frame0, LANCER, 3, 2)]);
  const rest = fitDistance({ width: W, height: H }, CANVAS_W / CANVAS_H);

  it('opened at step 0: starts wide and low, and closes into the resting framing over about 1.5 s', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 0 });
    r.page.advance(1000 / 60);
    let cam = r.rt.debug().camera;
    expect(r.rt.debug().intro.active).toBe(true);
    expect(cam.distance).toBeGreaterThan(rest * (INTRO_DISTANCE - 0.05));
    expect(cam.pitchDeg).toBeLessThan(INTRO_PITCH_DEG + 1);
    // it closes in, frame by frame, never moving out again
    let last = cam.distance;
    let lastPitch = cam.pitchDeg;
    for (let i = 0; i < Math.round(INTRO_SECONDS * 60) - 2; i++) {
      r.page.advance(1000 / 60);
      cam = r.rt.debug().camera;
      expect(cam.distance).toBeLessThanOrEqual(last + 1e-9);
      expect(cam.pitchDeg).toBeGreaterThanOrEqual(lastPitch - 1e-9);
      last = cam.distance;
      lastPitch = cam.pitchDeg;
    }
    expect(r.rt.debug().intro.active).toBe(true);
    r.page.frames(10);
    cam = r.rt.debug().camera;
    expect(r.rt.debug().intro.active).toBe(false);
    expect(cam.distance).toBeCloseTo(rest, 6);
    expect(cam.pitchDeg).toBeCloseTo(PITCH_DEG, 6);
  });

  it('lasts INTRO_SECONDS of frame time: at 1.4 s it is still running and at 1.6 s it is over', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 0 });
    r.page.advance(1); // the first drawn frame
    r.page.frames(Math.round(1.4 * 60));
    expect(r.rt.debug().intro.active).toBe(true);
    r.page.frames(Math.round(0.2 * 60));
    expect(r.rt.debug().intro.active).toBe(false);
  });

  it('is skipped when the match is opened at a later step: resting framing from the very first frame', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 2 });
    r.page.advance(1000 / 60);
    expect(r.rt.debug().intro.active).toBe(false);
    expect(r.rt.debug().camera.distance).toBeCloseTo(rest, 6);
    expect(r.rt.debug().camera.pitchDeg).toBeCloseTo(PITCH_DEG, 6);
  });

  it('is skipped under reduced motion (no easing at all there), even at step 0', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 0, reducedMotion: true });
    r.page.advance(1000 / 60);
    expect(r.rt.debug().intro.active).toBe(false);
    expect(r.rt.debug().camera.distance).toBeCloseTo(rest, 6);
  });

  it('reduced motion switched on while it runs ends it at once', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 0 });
    r.page.frames(20);
    expect(r.rt.debug().intro.active).toBe(true);
    r.view({ timeline: longTimeline, step: 0, reducedMotion: true });
    r.page.frames(1);
    expect(r.rt.debug().intro.active).toBe(false);
    expect(r.rt.debug().camera.distance).toBeCloseTo(rest, 6);
  });

  it('is skipped when the viewer scrubs (a jump has no plan), and does not come back when they scrub to step 0', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 0 });
    r.page.frames(20);
    expect(r.rt.debug().intro.active).toBe(true);
    r.view({ timeline: longTimeline, step: 3 }); // a jump: plan null
    r.page.frames(1);
    expect(r.rt.debug().intro.active).toBe(false);
    expect(r.rt.debug().camera.distance).toBeCloseTo(rest, 6);
    r.view({ timeline: longTimeline, step: 0 }); // scrubbed back to 0: that is not an opening
    r.page.frames(5);
    expect(r.rt.debug().intro.active).toBe(false);
    expect(r.rt.debug().camera.pitchDeg).toBeCloseTo(PITCH_DEG, 6);
  });

  it('survives the viewer pressing play: the next step arrives with a plan and the intro goes on', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 0 });
    r.page.frames(20);
    const plan = planOf(longTimeline.steps[0].frame, longTimeline.steps[1].frame, []);
    r.view({ timeline: longTimeline, step: 1, plan: { ...plan, durationMs: Math.max(plan.durationMs, 400) } });
    r.page.frames(3);
    expect(r.rt.debug().intro.active).toBe(true);
    r.page.frames(120);
    expect(r.rt.debug().intro.active).toBe(false);
  });

  it('is ended by the viewer taking the camera (a zoom step)', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 0 });
    r.page.frames(20);
    expect(r.rt.debug().intro.active).toBe(true);
    r.rt.zoomStep(1);
    expect(r.rt.debug().intro.active).toBe(false);
  });

  it('is skipped when another viewer\'s timeline arrives (a snap, not an animation)', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 0 });
    r.page.frames(20);
    r.view({ timeline: { ...longTimeline }, step: 0 });
    r.page.frames(1);
    expect(r.rt.debug().intro.active).toBe(false);
  });

  it('never runs again in a runtime that has shown something: a re-render at step 0 does not restart it', () => {
    const r = make();
    r.view({ timeline: longTimeline, step: 0 });
    r.page.frames(120);
    expect(r.rt.debug().intro.active).toBe(false);
    r.view({ timeline: longTimeline, step: 0 });
    r.page.frames(3);
    expect(r.rt.debug().intro.active).toBe(false);
  });
});

// ---------------------------------------------------------------- G10: the feel of a battle

/** What the stage does while a plan plays, through the real runtime and the stand-in page: a view at `step` 1 that runs `plan`. */
function playing(opts: { events: GameEvent[]; next?: ViewFrame; reduced?: boolean; modules?: Partial<StageModules> }): { r: Rig; plan: TransitionPlan; rest: ReturnType<StageRuntime['debug']>['camera'] } {
  const next = opts.next ?? frame0;
  const plan = planOf(frame0, next, opts.events);
  const timeline = timelineOf([frame0, next], [[], opts.events]);
  const r = make(opts.modules);
  r.view({ timeline, step: 1, reducedMotion: opts.reduced ?? false });
  r.page.frames(4);
  const rest = r.rt.debug().camera;
  r.view({ timeline, step: 1, plan, reducedMotion: opts.reduced ?? false });
  return { r, plan, rest };
}
const camPos = (rt: StageRuntime): { x: number; y: number; z: number } => {
  const p = (rt as unknown as { camera: { position: { x: number; y: number; z: number } } }).camera.position;
  return { x: p.x, y: p.y, z: p.z };
};

describe('movement trails reach the effects kit', () => {
  const path: Coord[] = [pt(2, 1), pt(2, 0), pt(3, 0), pt(4, 0)];
  const walk: GameEvent[] = [{ kind: 'moved', unitId: LANCER, path }];
  const kitOf = (): { kit: () => FxKit; create: CreateFx } => {
    let k: FxKit | null = null;
    return { kit: () => k as FxKit, create: () => { k = createFxKit(); return k; } };
  };

  it('a hover craft over land kicks dust while it glides: alpha puffs in the existing smoke batch, nothing else, no extra draw call', () => {
    const fx = kitOf();
    const { r, plan } = playing({ events: walk, next: moved(frame0, LANCER, 4, 0), modules: { createFx: fx.create } });
    const mid = plan.moves[0].startMs + plan.moves[0].durMs / 2;
    r.page.advance(mid);
    const st = fx.kit().stats();
    expect(st.instances.smoke).toBeGreaterThan(0);
    expect(st.instances.glow).toBe(0);
    expect(st.instances.debris).toBe(0);
    expect(st.drawCalls).toBeLessThanOrEqual(3);
    r.page.advance(plan.durationMs); // the plan is over: nothing left
    r.page.frames(2);
    expect(fx.kit().stats().instances).toEqual({ glow: 0, smoke: 0, debris: 0 });
  });

  /** The summed opacity of the smoke batch's instances this frame (how much dust there is, not how many puffs). */
  const dustAmount = (kit: FxKit): number => {
    const mesh = kit.group.getObjectByName('fx-smoke') as unknown as { geometry: { instanceCount: number; getAttribute(n: string): { data: { array: Float32Array } } } };
    const data = mesh.geometry.getAttribute('iA').data.array;
    let sum = 0;
    for (let i = 0; i < mesh.geometry.instanceCount; i++) sum += data[i * 16 + 11];
    return sum;
  };

  it('is nothing at the start of the glide and fades to next to nothing as the unit comes to rest (the trail follows its speed)', () => {
    const fx = kitOf();
    const { r, plan } = playing({ events: walk, next: moved(frame0, LANCER, 4, 0), modules: { createFx: fx.create } });
    const dur = plan.moves[0].durMs;
    r.page.advance(1);
    expect(fx.kit().stats().instances.smoke).toBe(0);
    r.page.advance(dur / 2 - 1);
    const mid = dustAmount(fx.kit());
    expect(mid).toBeGreaterThan(0.3);
    r.page.advance(dur / 2 - 3); // 3 ms before the end of the glide
    expect(dustAmount(fx.kit())).toBeLessThan(mid * 0.2);
  });

  it('reduced motion: the viewer\'s plan has no glides, so no trails, and the kit is asked for half the particles', () => {
    const fx = kitOf();
    const next = moved(frame0, LANCER, 4, 0);
    const calm = planTransition(frame0, next, walk, { speed: 1, reducedMotion: true });
    expect(calm.moves).toEqual([]);
    const r = make({ createFx: fx.create });
    const timeline = timelineOf([frame0, next], [[], walk]);
    r.view({ timeline, step: 1, reducedMotion: true });
    r.page.frames(3);
    r.view({ timeline, step: 1, plan: calm, reducedMotion: true });
    for (let t = 0; t < 400; t += 40) {
      r.page.advance(40);
      expect(fx.kit().stats().instances.smoke, `t=${t}`).toBe(0);
    }
  });
});

describe('the attack camera in the runtime', () => {
  const rest = fitDistance({ width: W, height: H }, CANVAS_W / CANVAS_H);

  it('eases in toward the fight (a quarter nearer, 6 degrees lower), holds, and returns exactly to the resting framing as the attack ends', () => {
    const { r, plan } = playing({ events: [ATTACK] });
    // the strikes run 0..760 ms; the window has no lead (nothing precedes the first strike) and ends 240 ms after the last: 0..1000
    expect(plan.fx.filter((f) => f.kind === 'hit').map((f) => [f.startMs, f.durMs])).toEqual([[0, 380], [380, 380]]);
    const series: { t: number; distance: number; pitch: number; attack: number }[] = [];
    for (let t = 20; t <= 1200; t += 20) {
      r.page.advance(20);
      const d = r.rt.debug();
      series.push({ t, distance: d.camera.distance, pitch: d.camera.pitchDeg, attack: d.attack });
    }
    const at = (t: number) => series.find((s) => s.t === t)!;
    // in: from the resting distance, falling smoothly until 240 ms
    expect(at(20).distance).toBeGreaterThan(rest * 0.99);
    for (let t = 40; t <= 240; t += 20) expect(at(t).distance).toBeLessThan(at(t - 20).distance);
    // held: a quarter nearer and 6 degrees lower, with the whole strength, between 240 and 760 ms
    for (let t = 240; t <= 760; t += 20) {
      expect(at(t).attack, `t=${t}`).toBe(1);
      expect(at(t).distance, `t=${t}`).toBeCloseTo(rest * 0.75, 9);
      expect(at(t).pitch, `t=${t}`).toBeCloseTo(PITCH_DEG - 6, 9);
    }
    // out: rising smoothly back, and exactly the resting camera from 1000 ms on
    for (let t = 780; t <= 1000; t += 20) expect(at(t).distance).toBeGreaterThan(at(t - 20).distance);
    for (let t = 1000; t <= 1200; t += 20) {
      expect(at(t).attack, `t=${t}`).toBe(0);
      expect(at(t).distance, `t=${t}`).toBeCloseTo(rest, 9);
      expect(at(t).pitch, `t=${t}`).toBeCloseTo(PITCH_DEG, 9);
    }
    expect(plan.durationMs).toBeGreaterThan(1000); // it was gone before the plan was (the damage number is still rising)
  });

  it('is off under reduced motion: the framing never changes during an attack', () => {
    const { r } = playing({ events: [ATTACK], reduced: true });
    for (let t = 0; t < 1100; t += 40) {
      r.page.advance(40);
      expect(r.rt.debug().attack, `t=${t}`).toBe(0);
      expect(r.rt.debug().camera.distance, `t=${t}`).toBeCloseTo(rest, 9);
    }
  });

  it('is off once the viewer has taken the camera: a zoom step, or a drag', () => {
    const zoomed = playing({ events: [ATTACK] });
    zoomed.r.rt.zoomStep(1);
    for (let t = 0; t < 1100; t += 40) {
      zoomed.r.page.advance(40);
      expect(zoomed.r.rt.debug().attack, `zoom t=${t}`).toBe(0);
    }
    const dragged = playing({ events: [ATTACK] });
    const rt = dragged.r.rt as unknown as { onPointerDown(e: Partial<PointerEvent>): void; onPointerMove(e: Partial<PointerEvent>): void };
    rt.onPointerDown({ button: 0, pointerType: 'mouse', pointerId: 1, clientX: 100, clientY: 100 });
    rt.onPointerMove({ pointerId: 1, clientX: 110, clientY: 105 });
    for (let t = 0; t < 1100; t += 40) {
      dragged.r.page.advance(40);
      expect(dragged.r.rt.debug().attack, `drag t=${t}`).toBe(0);
      expect(dragged.r.rt.debug().camera.distance, `drag t=${t}`).toBeGreaterThan(rest * 0.99);
    }
    // known-bad: the same plan with the camera untouched does apply it
    const free = playing({ events: [ATTACK] });
    free.r.page.advance(500);
    expect(free.r.rt.debug().attack).toBe(1);
  });

  it('is off while the match intro runs, and in a step with no strike', () => {
    const r = make();
    const timeline = timelineOf([frame0, frame0], [[], [ATTACK]]);
    r.view({ timeline, step: 0 });
    r.page.advance(20);
    expect(r.rt.debug().intro.active).toBe(true);
    expect(r.rt.debug().attack).toBe(0);
    const quiet = playing({ events: [{ kind: 'captured', at: pt(5, 2), terrain: 'arcology', by: 0, from: null }] });
    for (let t = 0; t < 600; t += 40) {
      quiet.r.page.advance(40);
      expect(quiet.r.rt.debug().attack).toBe(0);
    }
  });

  it('gives less, down to nothing, when the push-in would cut a unit off: a long map with the fighters at its two ends', () => {
    // at the widest zoom the whole map fills the picture across, so a push-in would leave both fighters outside it
    const rows = ['.'.repeat(24), '.'.repeat(24), '.'.repeat(24), '.'.repeat(24)];
    const units: FixtureUnit[] = [{ type: 'lancer', owner: 0, x: 1, y: 1 }, { type: 'trooper', owner: 1, x: 22, y: 1 }];
    const wide = viewTimeline(recordMatch({ ...fieldSetup(units, { fog: false }), map: fixtureMap(rows, units, undefined, 'g10-wide') }, []), 'all').steps[0].frame;
    const events: GameEvent[] = [{ kind: 'attacked', attackerId: idOf(wide, 'lancer'), defenderId: idOf(wide, 'trooper'), damage: 10, counter: 0, attackerHp: 100, defenderHp: 90 }];
    const plan = planOf(wide, wide, events);
    const timeline = timelineOf([wide, wide], [[], events]);
    const r = make();
    r.view({ timeline, step: 1 });
    r.page.frames(4);
    r.view({ timeline, step: 1, plan });
    const restDistance = r.rt.debug().camera.distance;
    let min = restDistance;
    for (let t = 0; t < 900; t += 30) {
      r.page.advance(30);
      min = Math.min(min, r.rt.debug().camera.distance);
    }
    // the same fight in the same picture on a short map would push all the way in; here the guard holds it back
    expect(min).toBeGreaterThan(restDistance * 0.75 + 1e-6);
  });
});

describe('the explosion\'s shake in the runtime', () => {
  const DEAD1: GameEvent = { kind: 'destroyed', unitId: TROOPER, at: pt(3), type: 'trooper', owner: 1 };
  const killOnly = (reduced = false) => playing({ events: [DEAD1], next: without(frame0, TROOPER), reduced });

  it('moves the camera at the start of the explosion by a few pixels at most, decays, and leaves it exactly at rest a quarter second later', () => {
    const { r, plan, rest } = killOnly();
    const restPos = camPos(r.rt);
    const boom = plan.fx.find((f) => f.kind === 'explosion')!;
    r.page.advance(boom.startMs + 10);
    const d = r.rt.debug();
    expect(d.shake).toBeGreaterThan(0);
    const early = camPos(r.rt);
    const off = Math.hypot(early.x - restPos.x, early.y - restPos.y, early.z - restPos.z);
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThanOrEqual(SHAKE_AMPLITUDE * rest.distance * 1.0001); // never more than the peak, scaled to the distance
    // decaying: the largest offsets of the last quarter are under a tenth of the first quarter's
    const peaks = (from: number, to: number): number => {
      let m = 0;
      for (let ms = from; ms < to; ms += 4) {
        r.page.advance(4);
        const p = camPos(r.rt);
        m = Math.max(m, Math.hypot(p.x - restPos.x, p.y - restPos.y, p.z - restPos.z));
      }
      return m;
    };
    const firstQuarter = peaks(10, 70);
    peaks(70, 190);
    const lastQuarter = peaks(190, 245);
    expect(firstQuarter).toBeGreaterThan(0);
    expect(lastQuarter).toBeLessThan(firstQuarter * 0.2);
    r.page.advance(10); // 255 ms after the start
    expect(r.rt.debug().shake).toBe(0);
    expect(camPos(r.rt)).toEqual(restPos); // exactly where it was
  });

  it('is the same shake for the same beat every time (scrubbing and replays show it exactly)', () => {
    const trace = (): number[] => {
      const { r, plan } = killOnly();
      const boom = plan.fx.find((f) => f.kind === 'explosion')!;
      r.page.advance(boom.startMs);
      const out: number[] = [];
      for (let i = 0; i < 12; i++) {
        r.page.advance(16);
        const p = camPos(r.rt);
        out.push(p.x, p.y, p.z);
      }
      r.rt.dispose();
      return out;
    };
    const a = trace();
    const b = trace();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(8);
  });

  it('never under reduced motion, and a plain hit gives none', () => {
    const calm = killOnly(true);
    const calmBoom = calm.plan.fx.find((f) => f.kind === 'explosion')!;
    calm.r.page.advance(calmBoom.startMs + 10);
    expect(calm.r.rt.debug().shake).toBe(0);
    expect(camPos(calm.r.rt)).toEqual({ x: calm.rest.x, y: calm.rest.y, z: calm.rest.z });
    const hit = playing({ events: [{ ...ATTACK, damage: 10, defenderHp: 90 } as GameEvent] });
    for (let t = 0; t < 700; t += 20) {
      hit.r.page.advance(20);
      expect(hit.r.rt.debug().shake, `t=${t}`).toBe(0);
    }
  });
});

describe('the power sweep in the runtime', () => {
  const surge: GameEvent[] = [{ kind: 'powerActivated', player: 0, level: 'surge', commander: 'rook' }];
  const overclock: GameEvent[] = [{ kind: 'powerActivated', player: 1, level: 'overclock', commander: 'sefa' }];
  const sweepMesh = (rt: StageRuntime): { visible: boolean; parent: unknown } | null => (rt as unknown as { scene: { getObjectByName(n: string): { visible: boolean; parent: unknown } | undefined } }).scene.getObjectByName('power-sweep') ?? null;

  it('is one hidden mesh in the scene until a power runs, shows in the activating commander\'s faction colour for the whole cut-in, and is gone after', () => {
    const { r, plan } = playing({ events: surge });
    expect(sweepMesh(r.rt)).not.toBeNull();
    expect(r.rt.debug().sweep.visible).toBe(false);
    const d = plan.cutIn!.durMs;
    r.page.advance(d / 2);
    const mid = r.rt.debug().sweep;
    expect(mid.visible).toBe(true);
    expect(mid.drawCalls).toBe(1);
    expect(mid.color).toBe(FACTION_ACCENT.helion);
    expect(mid.intensity).toBe(SWEEP.surge.intensity);
    expect(sweepMesh(r.rt)!.visible).toBe(true);
    r.page.advance(d); // the cut-in is over
    r.page.frames(2);
    expect(r.rt.debug().sweep.visible).toBe(false);
    expect(sweepMesh(r.rt)!.visible).toBe(false);
  });

  it('Overclock is stronger than Surge, and the other player\'s power shows the other faction', () => {
    const { r, plan } = playing({ events: overclock });
    r.page.advance(plan.cutIn!.durMs / 2);
    const s = r.rt.debug().sweep;
    expect(s.color).toBe(FACTION_ACCENT.tidewell);
    expect(s.color).not.toBe(FACTION_ACCENT.helion);
    expect(s.intensity).toBe(SWEEP.overclock.intensity);
    expect(s.bands).toBe(2);
    expect(s.intensity).toBeGreaterThan(SWEEP.surge.intensity * 1.8);
  });

  it('crosses the board toward the commander\'s own side\'s front: player 0 (facing east) sweeps east, player 1 (facing west) sweeps west', () => {
    const run = (events: GameEvent[]): number[] => {
      const { r, plan } = playing({ events });
      const out: number[] = [];
      for (let i = 1; i <= 8; i++) {
        r.page.advance(plan.cutIn!.durMs / 10);
        out.push(r.rt.debug().sweep.center);
      }
      return out;
    };
    const east = run(surge);
    const west = run(overclock);
    for (let i = 1; i < east.length; i++) {
      expect(east[i]).toBeGreaterThan(east[i - 1]);
      expect(west[i]).toBeLessThan(west[i - 1]);
    }
  });

  it('under reduced motion it is a plain fade: no band, a wash that rises and falls with the cut-in', () => {
    const { r, plan } = playing({ events: surge, reduced: true });
    const d = plan.cutIn!.durMs;
    const modes = new Set<string>();
    const shown: boolean[] = [];
    for (let i = 1; i <= 9; i++) {
      r.page.advance(d / 10);
      const s = r.rt.debug().sweep;
      modes.add(s.mode);
      shown.push(s.visible);
    }
    expect([...modes]).toEqual(['fade']);
    expect(shown[4]).toBe(true);
    expect(r.rt.debug().sweep.intensity).toBe(SWEEP.surge.wash);
  });

  it('adds one draw call for the whole stage while a power runs and none otherwise (the table, storm and sweep are the only extras)', () => {
    const { r, plan } = playing({ events: surge });
    r.page.advance(10);
    expect(r.rt.debug().sweep.drawCalls).toBe(0); // the band has not started: the cut-in's first moments
    r.page.advance(plan.cutIn!.durMs / 2 - 10);
    expect(r.rt.debug().sweep.drawCalls).toBe(1);
    expect(r.rt.debug().table!.drawCalls).toBe(3);
  });

  it('dispose frees the mesh and takes it out of the scene', () => {
    const r = make();
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(2);
    const mesh = sweepMesh(r.rt)!;
    expect(mesh.parent).not.toBeNull();
    r.rt.dispose();
    expect(mesh.parent).toBeNull();
  });
});

// ---------------------------------------------------------------- the ion storm

describe('the ion-storm static', () => {
  const countFor = stormCount({ width: W, height: H });

  it('shows in an ion storm as one draw call, all its flecks, and not in clear weather', () => {
    const clear = make();
    clear.view({ timeline: timelineOf([frame0]) });
    clear.page.frames(5);
    expect(clear.rt.debug().storm).toMatchObject({ visible: false, drawCalls: 0 });
    clear.rt.dispose();

    const r = make();
    r.view({ timeline: timelineOf([storm(frame0)]) });
    r.page.frames(5);
    expect(r.rt.debug().storm).toMatchObject({ visible: true, drawCalls: 1, drawn: countFor, count: countFor });
  });

  it('draws half under reduced motion and follows the setting back', () => {
    const r = make();
    const timeline = timelineOf([storm(frame0)]);
    r.view({ timeline, reducedMotion: true });
    r.page.frames(5);
    expect(r.rt.debug().storm!.drawn).toBe(Math.floor(countFor / 2));
    expect(r.rt.debug().storm!.drawCalls).toBe(1);
    r.view({ timeline, reducedMotion: false });
    r.page.frames(2);
    expect(r.rt.debug().storm!.drawn).toBe(countFor);
  });

  it('fades out when the weather clears and in when a storm arrives', () => {
    const r = make();
    const stormy = storm(frame0);
    const timeline = timelineOf([stormy, frame0, stormy]);
    r.view({ timeline, step: 0 });
    r.page.frames(5);
    expect(r.rt.debug().storm!.visible).toBe(true);
    r.view({ timeline, step: 1 });
    r.page.frames(300); // five seconds: the mix has eased to zero
    expect(r.rt.debug().storm!.visible).toBe(false);
    r.view({ timeline, step: 2 });
    r.page.frames(30);
    expect(r.rt.debug().storm!.visible).toBe(true);
  });

  it('is the same on every run: two stages on the same map build identical flecks', () => {
    const buffers: number[][] = [];
    for (let i = 0; i < 2; i++) {
      const r = make();
      r.view({ timeline: timelineOf([storm(frame0)]) });
      r.page.frames(3);
      const points = (r.rt as unknown as { storm: { points: { geometry: { getAttribute(n: string): { array: Float32Array } } } } }).storm.points;
      buffers.push([...points.geometry.getAttribute('position').array]);
      r.rt.dispose();
    }
    expect(buffers[0].length).toBe(countFor * 3);
    expect(buffers[0]).toEqual(buffers[1]);
  });
});

// ---------------------------------------------------------------- the table and the teardown

describe('the table', () => {
  it('is in the scene, adds at most 3 draw calls, and is rebuilt (the old one freed) for another map', () => {
    const r = make();
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(2);
    expect(r.rt.debug().table!.drawCalls).toBeLessThanOrEqual(3);
    const internals = r.rt as unknown as { scene: Group; table: { live(): { geometries: number; materials: number } } };
    const first = internals.table;
    expect(internals.scene.getObjectByName('table')).toBeTruthy();
    expect(first.live()).toEqual({ geometries: 3, materials: 3 });
    const other = viewTimeline(recordMatch({
      ...fieldSetup([], { fog: false }), map: fixtureMap(['.....', '.....'], [{ type: 'lancer', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 4, y: 1 }], undefined, 'another-map'),
    }, []), 'all');
    r.view({ timeline: other });
    r.page.frames(2);
    expect(first.live()).toEqual({ geometries: 0, materials: 0 }); // the first table was freed
    expect(internals.table).not.toBe(first);
    expect(internals.scene.children.filter((c) => c.name === 'table')).toHaveLength(1); // exactly one in the scene
  });

  it('dispose frees the table, the storm and the terrain, and stops the frame loop', () => {
    const r = make();
    r.view({ timeline: timelineOf([storm(frame0)]) });
    r.page.frames(3);
    const internals = r.rt as unknown as {
      scene: Group;
      table: { live(): { geometries: number; materials: number } };
      storm: { points: { parent: unknown; geometry: { addEventListener(t: string, f: () => void): void } } };
    };
    const table = internals.table;
    let stormFreed = false;
    internals.storm.points.geometry.addEventListener('dispose', () => { stormFreed = true; });
    expect(table.live().geometries).toBe(3); // known-bad: alive before dispose
    expect(stormFreed).toBe(false);
    expect(r.page.pendingFrames()).toBe(1);
    r.rt.dispose();
    expect(table.live()).toEqual({ geometries: 0, materials: 0 });
    expect(stormFreed).toBe(true);
    expect(r.terrain.disposed).toBe(1);
    expect(internals.scene.getObjectByName('table')).toBeUndefined();
    expect(r.page.pendingFrames()).toBe(0);
    expect(r.rt.debug().table).toBeNull();
    expect(r.rt.debug().storm).toBeNull();
    r.rt.dispose(); // twice is fine
  });
});

describe('the whole stage with the real kits (terrain, units, effects) in node', () => {
  it('draws a frame loop through an attack and a kill without failing', () => {
    const next = without(frame0, TROOPER);
    const events = [ATTACK, DEAD];
    const plan = planOf(frame0, next, events);
    const timeline = timelineOf([frame0, next], [[], events]);
    const page = installPage();
    const hooks = { failed: [] as string[], done: 0 };
    const rt = new StageRuntime(el() as unknown as HTMLElement, { onDone: () => { hooks.done++; }, onOverlay: () => undefined, onFail: (r) => { hooks.failed.push(r); } }, {
      createRenderer: () => fakeRenderer(), search: '', signals: STRONG,
    });
    rig = { rt, page } as unknown as Rig;
    rt.setView({ timeline, step: 0, plan: null, reducedMotion: false });
    page.frames(10);
    rt.setView({ timeline, step: 1, plan, reducedMotion: false });
    for (let i = 0; i < Math.ceil(plan.durationMs / 16) + 5; i++) page.advance(16);
    expect(hooks.failed).toEqual([]);
    expect(hooks.done).toBe(1);
    expect(rt.debug().table!.drawCalls).toBe(3);
  });
});


// ---------------------------------------------------------------- G12: the terrain's motion freeze

describe('the terrain follows reduced motion (setMotion)', () => {
  /** A recording terrain that HAS setMotion (the living board of G11), logging every call. */
  function motionTerrain(): { create: CreateTerrain; calls: boolean[]; made: () => number } {
    const calls: boolean[] = [];
    let made = 0;
    const create: CreateTerrain = () => {
      made++;
      const v = {
        group: new Group(), heightAt: () => 0, setOwners: () => undefined, setCapture: () => undefined, setOccupied: () => undefined,
        setVisible: () => undefined, setWeather: () => undefined, update: () => undefined, dispose: () => undefined,
        setMotion: (on: boolean) => { calls.push(on); },
      };
      return v as TerrainView;
    };
    return { create, calls, made: () => made };
  }
  const timeline = timelineOf([frame0, moved(frame0, LANCER, 2, 0), moved(frame0, LANCER, 2, 2)]);

  it('is told motion ON on the first view and OFF when reduced motion comes on, and back; never twice in a row for one value', () => {
    const t = motionTerrain();
    const r = make({ createTerrain: t.create });
    r.view({ timeline, step: 0, reducedMotion: false });
    expect(t.calls).toEqual([true]);
    r.view({ timeline, step: 1, reducedMotion: false }); // another step, the same setting
    expect(t.calls).toEqual([true]);
    r.view({ timeline, step: 1, reducedMotion: true });
    expect(t.calls).toEqual([true, false]); // reduced motion = motion off
    r.view({ timeline, step: 2, reducedMotion: true });
    expect(t.calls).toEqual([true, false]);
    r.view({ timeline, step: 2, reducedMotion: false });
    expect(t.calls).toEqual([true, false, true]);
  });

  it('starts frozen when the page starts reduced', () => {
    const t = motionTerrain();
    const r = make({ createTerrain: t.create });
    r.view({ timeline, reducedMotion: true });
    expect(t.calls).toEqual([false]);
  });

  it('a new terrain (another map) is told the current setting, so a rebuilt board never wakes up under reduced motion', () => {
    const t = motionTerrain();
    const r = make({ createTerrain: t.create });
    r.view({ timeline, reducedMotion: true });
    expect(t.calls).toEqual([false]);
    const other = viewTimeline(recordMatch({
      ...fieldSetup([], { fog: false }), map: fixtureMap(['.....', '.....'], [{ type: 'lancer', owner: 0, x: 1, y: 0 }, { type: 'trooper', owner: 1, x: 4, y: 1 }], undefined, 'another-map'),
    }, []), 'all');
    r.view({ timeline: other, reducedMotion: true });
    expect(t.made()).toBe(2);
    expect(t.calls).toEqual([false, false]); // once per terrain, each told off
  });

  it('is skipped when the terrain has no setMotion (the kit before G11, or a stand-in), without a throw', () => {
    const r = make(); // the recording terrain of this file has no setMotion
    expect(() => {
      r.view({ timeline, reducedMotion: true });
      r.view({ timeline, reducedMotion: false });
      r.page.frames(3);
    }).not.toThrow();
    expect(r.hooks.failed).toEqual([]);
  });

  it('a setMotion that is not a function is skipped as well (the guard is typeof, not truthiness)', () => {
    const create: CreateTerrain = () => ({ ...recordingTerrain().create({} as never), setMotion: 'yes' }) as unknown as TerrainView;
    const r = make({ createTerrain: create });
    expect(() => r.view({ timeline, reducedMotion: true })).not.toThrow();
  });
});

// ---------------------------------------------------------------- G12: quality tiers

describe('quality tiers: each tier builds exactly its passes', () => {
  type Internals = { composer: { passes: object[] }; sun: { shadow: { mapSize: { x: number; y: number } } }; ao: unknown };
  const peek = (r: Rig): Internals => r.rt as unknown as Internals;

  it('high has the occlusion, medium has not, low has no bloom either; the shadow map is 2048, 1024, 1024', () => {
    const wantCount: Record<QualityTier, number> = { high: 6, medium: 5, low: 4 }; // written by hand: scene, [AO], [bloom], output, FXAA, vignette
    for (const tier of TIER_ORDER) {
      const r = make({ search: `?quality=${tier}`, signals: { renderer: 'SwiftShader' } }); // the forcing beats the software guess
      r.view({ timeline: timelineOf([frame0]) });
      r.page.frames(3);
      const passes = peek(r).composer.passes;
      expect(passes, tier).toHaveLength(wantCount[tier]);
      const count = (k: abstract new (...a: never[]) => object): number => passes.filter((p) => p instanceof k).length;
      expect(count(RenderPass), tier).toBe(1);
      expect(count(GTAOPass), tier).toBe(tier === 'high' ? 1 : 0);
      expect(count(UnrealBloomPass), tier).toBe(tier === 'low' ? 0 : 1);
      expect(count(OutputPass), tier).toBe(1);
      expect(count(ShaderPass), tier).toBe(2); // FXAA and the vignette, on every tier
      expect(r.rt.debug().quality.passes, tier).toEqual(passNames(tier));
      expect(peek(r).sun.shadow.mapSize.x, tier).toBe({ high: 2048, medium: 1024, low: 1024 }[tier]);
      expect(peek(r).sun.shadow.mapSize.y, tier).toBe(peek(r).sun.shadow.mapSize.x);
      expect(r.rt.debug().quality.shadowMapSize, tier).toBe(peek(r).sun.shadow.mapSize.x);
      expect(r.rt.qualityTier).toBe(tier);
      r.rt.dispose();
    }
  });

  it('the pixel ratio is capped at 2 on high and medium and at 1 on low, on a 3x screen', () => {
    const ratio = (tier: QualityTier, dpr: number): number => {
      const r = make({ search: `?quality=${tier}` });
      (window as unknown as { devicePixelRatio: number }).devicePixelRatio = dpr;
      (r.rt as unknown as { resize(): void }).resize();
      const got = r.rt.debug().quality.pixelRatio;
      r.rt.dispose();
      return got;
    };
    expect([ratio('high', 3), ratio('medium', 3), ratio('low', 3)]).toEqual([2, 2, 1]);
    expect([ratio('high', 1), ratio('medium', 1), ratio('low', 1)]).toEqual([1, 1, 1]); // a cap, never a raise
    expect(ratio('low', 1.5)).toBe(1);
    expect(ratio('medium', 1.5)).toBe(1.5);
  });

  it('draws the scene twice per frame on high (the picture and the occlusion\'s depth+normal buffer, which uses an override material) and once on the others', () => {
    for (const tier of TIER_ORDER) {
      let scene: Scene | null = null;
      const seen = { scene: 0, overridden: 0, all: 0 };
      const counting = (): WebGLRenderer => {
        const base = fakeRenderer();
        return new Proxy(base, {
          get: (t, k) => (k === 'render'
            ? (what: unknown) => {
              seen.all++;
              if (what === scene) { seen.scene++; if ((what as Scene).overrideMaterial) seen.overridden++; }
            }
            : (t as unknown as Record<string | symbol, unknown>)[k]),
        });
      };
      const r = make({ search: `?quality=${tier}`, createRenderer: counting });
      scene = (r.rt as unknown as { scene: Scene }).scene;
      r.view({ timeline: timelineOf([frame0]) });
      r.page.frames(2);
      Object.assign(seen, { scene: 0, overridden: 0, all: 0 });
      r.page.frames(1); // exactly one composer frame
      expect(seen.scene, tier).toBe(tier === 'high' ? 2 : 1);
      expect(seen.overridden, tier).toBe(tier === 'high' ? 1 : 0);
      // every other pass is a full-screen quad: the AO adds passes, and its extra scene draw is the one above
      expect(seen.all, tier).toBeGreaterThan(seen.scene);
      r.rt.dispose();
    }
  });
});

describe('quality tiers: the start tier', () => {
  const SOFT: QualitySignals = { renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', maxTextureSize: 8192, hardwareConcurrency: 8, devicePixelRatio: 1 };

  it('a software renderer starts at low, a strong GPU at high', () => {
    const soft = make({ signals: SOFT });
    expect(soft.rt.qualityTier).toBe('low');
    expect(soft.rt.debug().quality).toMatchObject({ tier: 'low', pinned: false, passes: passNames('low') });
    soft.rt.dispose();
    const strong = make({ signals: STRONG });
    expect(strong.rt.qualityTier).toBe('high');
    expect(strong.rt.debug().quality).toMatchObject({ tier: 'high', pinned: false, passes: passNames('high') });
  });

  it('?quality= forces a tier over the guess, in both directions, and marks it forced', () => {
    const up = make({ signals: SOFT, search: '?quality=high' });
    expect(up.rt.qualityTier).toBe('high');
    expect(up.rt.debug().quality.pinned).toBe(true);
    up.rt.dispose();
    const down = make({ signals: STRONG, search: '?quality=low' });
    expect(down.rt.qualityTier).toBe('low');
    expect(down.rt.debug().quality.pinned).toBe(true);
    down.rt.dispose();
    const junk = make({ signals: SOFT, search: '?quality=ultra' }); // not a tier: the guess stands
    expect(junk.rt.qualityTier).toBe('low');
    expect(junk.rt.debug().quality.pinned).toBe(false);
  });

  it('prefers-reduced-motion does not change the start tier', () => {
    const tiers: QualityTier[] = [];
    for (const reduced of [false, true]) {
      const r = make({ signals: { ...STRONG, hardwareConcurrency: 4 } });
      r.view({ timeline: timelineOf([frame0]), reducedMotion: reduced });
      r.page.frames(2);
      tiers.push(r.rt.qualityTier);
      r.rt.dispose();
    }
    expect(tiers).toEqual(['medium', 'medium']);
  });

  it('tells the page the tier at the start, and on every change', () => {
    const r = make({ signals: STRONG });
    expect(r.hooks.quality).toEqual(['high']);
    const forced = make({ signals: STRONG, search: '?quality=low' });
    expect(forced.hooks.quality).toEqual(['low (forced)']);
  });

  it('reads the signals from the renderer and the page when none are injected: a software renderer string off the context starts low, a strong one high', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 16 }); // the host's own core count must not decide this test
    const contextOf = (name: string): (() => WebGLRenderer) => () => new Proxy(fakeRenderer(), {
      get: (t, k) => (k === 'getContext'
        ? () => ({ MAX_TEXTURE_SIZE: 1, getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 2 }), getParameter: (p: number) => (p === 2 ? name : 16384) })
        : (t as unknown as Record<string | symbol, unknown>)[k]),
    });
    const soft = make({ signals: null, createRenderer: contextOf('ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)') });
    expect(soft.rt.qualityTier).toBe('low');
    soft.rt.dispose();
    const strong = make({ signals: null, createRenderer: contextOf('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)') });
    expect(strong.rt.qualityTier).toBe('high');
    strong.rt.dispose();
    // the page's own signals count too: two cores on a strong GPU is low
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    const weakCpu = make({ signals: null, createRenderer: contextOf('NVIDIA GeForce RTX 3070') });
    expect(weakCpu.rt.qualityTier).toBe('low');
  });
});

describe('quality tiers: the adaptive step in the stage', () => {
  type Internals = { ao: { gtaoRenderTarget: WebGLRenderTarget; pdRenderTarget: WebGLRenderTarget; normalRenderTarget: WebGLRenderTarget } | null };
  const timeline = timelineOf([frame0]);

  it('drops one tier after a sustained slow stretch (high to medium to low), rebuilding the passes, the shadow map and the pixel ratio', () => {
    const r = make({ signals: STRONG });
    r.view({ timeline });
    (window as unknown as { devicePixelRatio: number }).devicePixelRatio = 2;
    (r.rt as unknown as { resize(): void }).resize();
    r.page.frames(30, 16);
    expect(r.rt.qualityTier).toBe('high'); // fast frames: nothing happens
    expect(r.rt.debug().quality.pixelRatio).toBe(2);
    r.page.frames(60, 40); // 40 ms frames for 2.4 s: a full window, once
    expect(r.rt.qualityTier).toBe('medium');
    expect(r.rt.debug().quality).toMatchObject({ tier: 'medium', pinned: false, passes: passNames('medium'), shadowMapSize: 1024, pixelRatio: 2 });
    r.page.frames(60, 40); // the second drop needs its own warm-up and its own full window
    expect(r.rt.qualityTier).toBe('low');
    expect(r.rt.debug().quality).toMatchObject({ tier: 'low', passes: passNames('low'), shadowMapSize: 1024, pixelRatio: 1 });
    expect(r.hooks.quality).toEqual(['high', 'medium', 'low']);
    expect(r.hooks.failed).toEqual([]);
  });

  it('never climbs back: after the drop a long run of fast frames leaves the tier (and the passes) as they are', () => {
    const r = make({ signals: STRONG });
    r.view({ timeline });
    r.page.frames(30, 16);
    r.page.frames(60, 40);
    expect(r.rt.qualityTier).toBe('medium');
    r.page.frames(600, 16); // ten seconds at 60 fps
    expect(r.rt.qualityTier).toBe('medium');
    expect(r.rt.debug().quality.passes).toEqual(passNames('medium'));
    expect(r.hooks.quality).toEqual(['high', 'medium']);
  });

  it('a single spike (a 600 ms frame) never drops it', () => {
    const r = make({ signals: STRONG });
    r.view({ timeline });
    r.page.frames(60, 16);
    r.page.advance(600);
    r.page.frames(200, 16);
    expect(r.rt.qualityTier).toBe('high');
    expect(r.hooks.quality).toEqual(['high']);
  });

  it('a forced tier is never second-guessed: slow frames do nothing', () => {
    const r = make({ signals: STRONG, search: '?quality=high' });
    r.view({ timeline });
    r.page.frames(300, 60);
    expect(r.rt.qualityTier).toBe('high');
    expect(r.rt.debug().quality.pinned).toBe(true);
    expect(r.rt.debug().quality.frameMs).toBeNull();
  });

  it('a hidden tab is not a slow device: frames while the page is hidden are not counted', () => {
    const r = make({ signals: STRONG });
    r.view({ timeline });
    r.page.frames(30, 16);
    (document as unknown as { hidden: boolean }).hidden = true;
    r.page.frames(300, 60);
    expect(r.rt.qualityTier).toBe('high');
    (document as unknown as { hidden: boolean }).hidden = false;
    r.page.frames(120, 60); // and once it is back, a slow device is still caught
    expect(r.rt.qualityTier).not.toBe('high');
  });

  it('frames with nothing to draw (no view yet) say nothing about the machine', () => {
    const r = make({ signals: STRONG });
    r.page.frames(300, 60); // no setView yet
    r.view({ timeline });
    r.page.frames(60, 16);
    expect(r.rt.qualityTier).toBe('high');
  });

  it('setQuality forces a tier for good (up or down) and stops the adaptive step', () => {
    const r = make({ signals: { renderer: 'llvmpipe' } });
    r.view({ timeline });
    expect(r.rt.qualityTier).toBe('low');
    r.rt.setQuality('high');
    expect(r.rt.debug().quality).toMatchObject({ tier: 'high', pinned: true, passes: passNames('high'), shadowMapSize: 2048 });
    r.page.frames(300, 60);
    expect(r.rt.qualityTier).toBe('high');
    r.rt.setQuality('high'); // the same tier again changes nothing
    expect(r.hooks.quality).toEqual(['low', 'high (forced)']);
  });

  it('dropping a tier frees the occlusion pass\'s targets, and dispose frees whatever tier is left', () => {
    const r = make({ signals: STRONG });
    r.view({ timeline });
    r.page.frames(3, 16);
    const ao = (r.rt as unknown as Internals).ao!;
    const freed = new Set<string>();
    const watch = (name: string, t: WebGLRenderTarget): void => t.addEventListener('dispose', () => freed.add(name));
    watch('ao', ao.gtaoRenderTarget);
    watch('denoise', ao.pdRenderTarget);
    watch('normal+depth', ao.normalRenderTarget);
    expect(freed.size).toBe(0); // known-bad: nothing is freed while the pass is in use
    r.page.frames(80, 40); // the drop to medium (20 warm-up frames, then a 2 s window)
    expect(r.rt.qualityTier).toBe('medium');
    expect([...freed].sort()).toEqual(['ao', 'denoise', 'normal+depth']);
    expect((r.rt as unknown as Internals).ao).toBeNull();
  });

  it('dispose frees the occlusion pass\'s targets on a high stage', () => {
    const r = make({ signals: STRONG, search: '?quality=high' });
    r.view({ timeline });
    r.page.frames(3, 16);
    const ao = (r.rt as unknown as Internals).ao!;
    const freed = new Set<string>();
    ao.gtaoRenderTarget.addEventListener('dispose', () => freed.add('ao'));
    ao.pdRenderTarget.addEventListener('dispose', () => freed.add('denoise'));
    ao.normalRenderTarget.addEventListener('dispose', () => freed.add('normal+depth'));
    expect(freed.size).toBe(0);
    r.rt.dispose();
    expect([...freed].sort()).toEqual(['ao', 'denoise', 'normal+depth']);
    r.rt.dispose(); // twice is fine
  });
});


// ---------------------------------------------------------------- G16: masked owners' units are unmarked

describe('units of a masked owner are made without a sigil, and everyone else\'s with it', () => {
  const timeline = timelineOf([frame0]);
  // frame0: a lancer (player 0), a trooper (player 1) and a mule (player 0)
  const unmarkedOf = (r: Rig): Record<string, boolean | undefined> => Object.fromEntries(r.views.calls.map((c) => [c.type, c.opts?.unmarked]));

  it('maskedOwners [1]: the trooper (player 1) is created `{ unmarked: true }`; the lancer and the mule (player 0) are created marked', () => {
    const r = make();
    r.view({ timeline, maskedOwners: [1] });
    r.page.frames(2);
    expect(unmarkedOf(r)).toEqual({ lancer: undefined, trooper: true, mule: undefined });
    // marked units are asked for with two arguments, exactly as before G16
    expect(r.views.calls.find((c) => c.type === 'lancer')!.opts).toBeUndefined();
  });

  it('maskedOwners [0]: the other way round (the check follows the owner, not the unit type or its place in the list)', () => {
    const r = make();
    r.view({ timeline, maskedOwners: [0] });
    r.page.frames(2);
    expect(unmarkedOf(r)).toEqual({ lancer: true, trooper: undefined, mule: true });
  });

  it.each([['absent', {}], ['empty', { maskedOwners: [] }]])('no masked owners (%s): nobody is unmarked', (_name, partial) => {
    const r = make();
    r.view({ timeline, ...partial });
    r.page.frames(2);
    expect(unmarkedOf(r)).toEqual({ lancer: undefined, trooper: undefined, mule: undefined });
  });

  it('the nation is still handed to the unit view: an unmarked unit keeps its colours', () => {
    const r = make();
    r.view({ timeline, maskedOwners: [1] });
    r.page.frames(2);
    const trooper = r.views.calls.find((c) => c.type === 'trooper')!;
    expect(trooper.faction).toBe(frame0.players[1].faction);
    expect(r.views.calls.find((c) => c.type === 'lancer')!.faction).toBe(frame0.players[0].faction);
  });

  it('a change in who is masked rebuilds exactly the units it concerns, and frees the views it replaced', () => {
    const r = make();
    r.view({ timeline, maskedOwners: [] });
    r.page.frames(2);
    expect(r.views.made).toEqual(['lancer', 'trooper', 'mule']);
    r.view({ timeline, maskedOwners: [1] });
    r.page.frames(2);
    expect(r.views.made).toEqual(['lancer', 'trooper', 'mule', 'trooper']); // only player 1's unit
    expect(r.views.calls[3].opts).toEqual({ unmarked: true });
    expect(r.views.live()).toBe(3); // the first trooper view was freed
    r.view({ timeline, maskedOwners: [1] }); // the same again: nothing rebuilt
    r.page.frames(2);
    expect(r.views.made).toHaveLength(4);
    r.view({ timeline, maskedOwners: [] }); // the story names the nation: marked again
    r.page.frames(2);
    expect(r.views.made).toEqual(['lancer', 'trooper', 'mule', 'trooper', 'trooper']);
    expect(r.views.calls[4].opts).toBeUndefined();
    expect(r.views.live()).toBe(3);
  });

  it('with the real unit kit, the masked owner\'s units are drawn without the decal and the others\' with it', () => {
    const f = fieldFrame([{ type: 'lancer', owner: 0, x: 2, y: 1 }, { type: 'lancer', owner: 1, x: 5, y: 1 }]);
    const kits: { owner: number; view: UnitKit }[] = [];
    const create: CreateUnitView = (type, faction, opts) => {
      const view = realUnitView(type, faction, opts) as UnitKit;
      kits.push({ owner: faction === f.players[0].faction ? 0 : 1, view });
      return view;
    };
    const r = make({ createUnitView: create });
    r.view({ timeline: timelineOf([f]), maskedOwners: [1] });
    r.page.frames(2);
    expect(kits.map((k) => [k.owner, k.view.unmarked])).toEqual([[0, false], [1, true]]);
    // the triangles say it too: the marked lancer is the unmarked one plus its nation's decal, in the same nation or another
    const marked = realUnitView('lancer', f.players[1].faction);
    const bare = kits[1].view;
    marked.setLook({ hp: 10, spent: false, heading: 0, status: null, focused: false });
    expect(visibleTriangles(modelOf(marked))).toBeGreaterThan(visibleTriangles(modelOf(bare)));
    marked.dispose();
    // and the other one is drawn exactly as a plain marked lancer is
    const plain = realUnitView('lancer', f.players[0].faction);
    plain.setLook({ hp: 10, spent: false, heading: 0, status: null, focused: false });
    expect(visibleTriangles(modelOf(plain))).toBe(visibleTriangles(modelOf(kits[0].view)));
    plain.dispose();
  });
});

// ---------------------------------------------------------------- G16: reduced motion reaches the units

describe('reduced motion holds every unit\'s idle motion still, and lets it carry on again', () => {
  // five classes on one field: a tread, a hover craft, a walker, a gunship and a foot squad
  const units: FixtureUnit[] = [
    { type: 'lancer', owner: 0, x: 1, y: 1 }, { type: 'skimmer', owner: 0, x: 3, y: 1 }, { type: 'colossus', owner: 0, x: 5, y: 1 },
    { type: 'wasp', owner: 1, x: 7, y: 1 }, { type: 'trooper', owner: 1, x: 8, y: 1 },
  ];
  const field = fieldFrame(units);

  /** The real unit kit, every view kept, so what the stage did to them can be read back. */
  function realKit(): { create: CreateUnitView; kits: UnitKit[] } {
    const kits: UnitKit[] = [];
    const create: CreateUnitView = (type, faction, opts) => { const v = realUnitView(type, faction, opts) as UnitKit; kits.push(v); return v; };
    return { create, kits };
  }
  /** Every vertex of a unit in world space, and its idle group: where the renderer draws it now. */
  function stance(v: UnitView): Float64Array {
    v.object.updateMatrixWorld(true);
    const lists: ArrayLike<number>[] = [];
    modelOf(v).traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) lists.push(worldPositions(o as never)); });
    const idle = v.object.getObjectByName('idle')!;
    lists.push([idle.position.x, idle.position.y, idle.position.z, idle.rotation.x, idle.rotation.y, idle.rotation.z]);
    const out = new Float64Array(lists.reduce((n, l) => n + l.length, 0));
    let at = 0;
    for (const l of lists) for (let i = 0; i < l.length; i++) out[at++] = l[i];
    return out;
  }
  const distance = (a: Float64Array, b: Float64Array): number => a.reduce((d, v, i) => Math.max(d, Math.abs(v - b[i])), 0);

  it('under reduced motion six seconds of frames leave every unit exactly where it was; with motion on, every one of them moves', () => {
    const { create, kits } = realKit();
    const r = make({ createUnitView: create });
    const timeline = timelineOf([field]);
    r.view({ timeline, reducedMotion: false });
    r.page.frames(20);
    expect(kits).toHaveLength(5);
    const a = kits.map(stance);
    r.page.frames(60);
    const b = kits.map(stance);
    kits.forEach((k, i) => expect(distance(a[i], b[i]), `${k.type} moves with motion on`).toBeGreaterThan(0));

    r.view({ timeline, reducedMotion: true });
    r.page.frames(1);
    const held = kits.map(stance);
    for (let s = 0; s < 6; s++) {
      r.page.frames(60);
      kits.forEach((k, i) => expect(distance(held[i], stance(k)), `${k.type} after ${s + 1} s of reduced motion`).toBe(0));
    }
    expect(kits.every((k) => !k.motion)).toBe(true);
    expect(r.hooks.failed).toEqual([]);
  });

  it('a page that opens under reduced motion never lets a unit start moving', () => {
    const { create, kits } = realKit();
    const r = make({ createUnitView: create });
    r.view({ timeline: timelineOf([field]), reducedMotion: true });
    r.page.frames(2);
    const held = kits.map(stance);
    r.page.frames(300);
    kits.forEach((k, i) => expect(distance(held[i], stance(k)), `${k.type} on a page that opens reduced`).toBe(0));
  });

  it('a unit that appears while motion is off is held from its first frame', () => {
    const { create, kits } = realKit();
    const r = make({ createUnitView: create });
    const fewer = fieldFrame(units.slice(0, 3));
    const timeline = timelineOf([fewer, field]);
    r.view({ timeline, step: 0, reducedMotion: true });
    r.page.frames(30);
    expect(kits).toHaveLength(3);
    r.view({ timeline, step: 1, reducedMotion: true });
    r.page.frames(2);
    expect(kits).toHaveLength(5);
    const held = kits.map(stance);
    r.page.frames(240);
    kits.forEach((k, i) => expect(distance(held[i], stance(k)), `${k.type}`).toBe(0));
  });

  it('a move still plays under reduced motion: the unit leans and strides while the others stay held', () => {
    const { create, kits } = realKit();
    const r = make({ createUnitView: create });
    const MULE_AT = { type: 'mule', owner: 0, x: 1, y: 2 } as FixtureUnit;
    const f0 = fieldFrame([...units, MULE_AT]);
    const mule = idOf(f0, 'mule');
    const next = moved(f0, mule, 0, 2);
    const events: GameEvent[] = [{ kind: 'moved', unitId: mule, path: [pt(1, 2), pt(0, 2)], cost: 1, fuel: 0 } as GameEvent];
    const plan = planOf(f0, next, events); // a plan with a glide, as a page that is not reduced would have made
    expect(plan.moves.length).toBeGreaterThan(0);
    const timeline = timelineOf([f0, next], [[], events]);
    r.view({ timeline, step: 0, reducedMotion: true });
    r.page.frames(30);
    const muleKit = kits.find((k) => k.type === 'mule')!;
    const others = kits.filter((k) => k !== muleKit);
    const heldOthers = others.map(stance);
    r.view({ timeline, step: 1, plan, reducedMotion: true });
    const m = plan.moves[0];
    r.page.advance(m.startMs + m.durMs * 0.4);
    const first = stance(muleKit);
    const lean = muleKit.object.getObjectByName('pose')!.rotation.z;
    r.page.advance(50);
    expect(muleKit.object.getObjectByName('pose')!.rotation.z, 'the mule leans into its move').toBeLessThan(0);
    expect(lean).toBeLessThan(0);
    expect(distance(first, stance(muleKit)), 'the mule is moving').toBeGreaterThan(0);
    others.forEach((k, i) => expect(distance(heldOthers[i], stance(k)), `${k.type} stays held while the mule moves`).toBe(0));
  });

  it('turning reduced motion off again resumes with no jump: one frame of motion after the held picture, then moving again', () => {
    const { create, kits } = realKit();
    const r = make({ createUnitView: create });
    const timeline = timelineOf([field]);
    r.view({ timeline, reducedMotion: false });
    r.page.frames(30);
    r.view({ timeline, reducedMotion: true });
    r.page.frames(2);
    const held = kits.map((k) => k.object.getObjectByName('idle')!.position.y);
    r.page.frames(600); // ten seconds held: the stage's own clock runs on
    r.view({ timeline, reducedMotion: false });
    r.page.frames(1);
    const first = kits.map((k) => k.object.getObjectByName('idle')!.position.y);
    // the bob of a hover craft and a gunship moves by well under a centimetre of tile in one frame; ten seconds of the stage's time would be a leap
    kits.forEach((k, i) => expect(Math.abs(first[i] - held[i]), `${k.type} idle y one frame after resuming`).toBeLessThan(0.01));
    expect(kits.every((k) => k.motion)).toBe(true);
    r.page.frames(90);
    const later = kits.map(stance);
    r.page.frames(37);
    kits.forEach((k, i) => expect(distance(later[i], stance(k)), `${k.type} moves again`).toBeGreaterThan(0));
  });
});


// ---------------------------------------------------------------- P1: the render scale below the lowest tier

/** A renderer that logs how the stage sizes it: each pixel ratio the drawing buffer was given, and each setSize (width, height, updateStyle). */
function sizedRenderer(): { create: () => WebGLRenderer; ratios: number[]; sizes: [number, number, boolean | undefined][] } {
  const ratios: number[] = [];
  const sizes: [number, number, boolean | undefined][] = [];
  const create = (): WebGLRenderer => new Proxy(fakeRenderer() as unknown as Record<string, unknown>, {
    get: (t, k) => {
      if (k === 'setPixelRatio') return (v: number) => { ratios.push(v); };
      if (k === 'setSize') return (w: number, h: number, style?: boolean) => { sizes.push([w, h, style]); };
      return t[k as string];
    },
  }) as unknown as WebGLRenderer;
  return { create, ratios, sizes };
}

const SOFT: QualitySignals = { renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', maxTextureSize: 16384, hardwareConcurrency: 8, devicePixelRatio: 1 };

describe('the render scale in the stage (below the lowest tier)', () => {
  const timeline = timelineOf([frame0]);
  /** Feeds frames of `ms` until the scale is no longer `from` (at most `cap` of them), and says how many it took. */
  const until = (r: Rig, ms: number, from: number, cap = 400): number => {
    let n = 0;
    while (r.rt.debug().quality.scale === from && n < cap) {
      r.page.frames(1, ms);
      n++;
    }
    return n;
  };
  type Composerish = { composer: { _pixelRatio: number }; fxaa: { material: { uniforms: { resolution: { value: { x: number; y: number } } } } } };
  const bufferOf = (rt: StageRuntime): number => (rt as unknown as Composerish).composer._pixelRatio;
  const fxaaOf = (rt: StageRuntime): { x: number; y: number } => (rt as unknown as Composerish).fxaa.material.uniforms.resolution.value;

  it('starts at 1: the buffer is the canvas at the tier\'s pixel ratio, and the debug numbers say so', () => {
    const sized = sizedRenderer();
    const r = make({ signals: SOFT, createRenderer: sized.create });
    r.view({ timeline });
    r.page.frames(30, 16);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'low', scale: 1, scalePinned: false, pixelRatio: 1 });
    expect(sized.ratios[sized.ratios.length - 1]).toBe(1);
    expect(bufferOf(r.rt)).toBe(1);
    expect(r.hooks.scales).toEqual([1]);
  });

  it('at the lowest tier a slow stretch steps the scale 1 -> 0.85 -> 0.7 -> 0.5: the drawing buffer shrinks every time, the canvas size never changes', () => {
    const sized = sizedRenderer();
    const r = make({ signals: SOFT, createRenderer: sized.create });
    r.view({ timeline });
    r.page.frames(30, 16);
    expect(r.rt.debug().quality.scale).toBe(1);
    const seen: number[] = [];
    for (const from of [1, 0.85, 0.7]) {
      const took = until(r, 40, from); // the warm-up frames (20) and one full 2 s window of 40 ms frames (about 45 more)
      // the first step had its warm-up already spent by the 30 fast frames before it; each later one needs its own, so it takes the whole 65 or so
      expect(took, `from ${from}`).toBeGreaterThanOrEqual(from === 1 ? 40 : 60);
      expect(took, `from ${from}`).toBeLessThanOrEqual(75);
      seen.push(r.rt.debug().quality.scale);
    }
    expect(seen).toEqual([0.85, 0.7, 0.5]);
    expect(r.rt.qualityTier).toBe('low'); // the tier did not move: it is the floor
    expect(r.rt.debug().quality.passes).toEqual(passNames('low'));
    // the buffer: the ratio handed to the renderer and the composer is the scale (the device ratio is 1), and FXAA's texel size follows it
    expect(sized.ratios.slice(-3)).toEqual([0.85, 0.7, 0.5]);
    expect(bufferOf(r.rt)).toBe(0.5);
    expect(fxaaOf(r.rt).x).toBeCloseTo(1 / (CANVAS_W * 0.5), 12);
    expect(fxaaOf(r.rt).y).toBeCloseTo(1 / (CANVAS_H * 0.5), 12);
    // the canvas: every setSize is the host's size with updateStyle FALSE, so the CSS size is never set from the buffer
    expect(sized.sizes.length).toBeGreaterThan(3);
    for (const sz of sized.sizes) expect(sz).toEqual([CANVAS_W, CANVAS_H, false]);
    expect(r.hooks.scales).toEqual([1, 0.85, 0.7, 0.5]);
    r.page.frames(200, 40); // nothing is below 0.5
    expect(r.rt.debug().quality.scale).toBe(0.5);
    expect(r.hooks.scales).toEqual([1, 0.85, 0.7, 0.5]);
    expect(r.hooks.failed).toEqual([]);
  });

  it('a stage that starts at high drops its TIERS first: the scale is still 1 at medium and at low, and steps only after', () => {
    const r = make({ signals: STRONG });
    r.view({ timeline });
    r.page.frames(30, 16);
    r.page.frames(60, 40);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'medium', scale: 1 });
    r.page.frames(60, 40);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'low', scale: 1 });
    until(r, 40, 1);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'low', scale: 0.85 });
  });

  it('a single spike, fast frames, and a slow stretch that is cut short never step it; and it never climbs back', () => {
    const r = make({ signals: SOFT });
    r.view({ timeline });
    r.page.frames(30, 16);
    r.page.advance(600);
    r.page.frames(200, 16);
    expect(r.rt.debug().quality.scale).toBe(1);
    until(r, 40, 1);
    expect(r.rt.debug().quality.scale).toBe(0.85);
    r.page.frames(800, 16); // a long fast stretch, from the moment it stepped
    expect(r.rt.debug().quality.scale).toBe(0.85);
    expect(r.hooks.scales).toEqual([1, 0.85]);
  });

  it('?scale= pins the scale from the first frame: the buffer is that fraction, slow frames never step it, and the tier still adapts on its own', () => {
    const sized = sizedRenderer();
    const r = make({ signals: STRONG, search: '?scale=0.7', createRenderer: sized.create });
    r.view({ timeline });
    r.page.frames(30, 16);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'high', scale: 0.7, scalePinned: true });
    expect(bufferOf(r.rt)).toBeCloseTo(0.7, 12);
    r.page.frames(60, 40);
    r.page.frames(60, 40);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'low', scale: 0.7, scalePinned: true });
    r.page.frames(400, 40);
    expect(r.rt.debug().quality.scale).toBe(0.7);
    expect(bufferOf(r.rt)).toBeCloseTo(0.7, 12);
    // known-bad: a value that is not on the ladder pins nothing
    const bad = make({ signals: SOFT, search: '?scale=0.6' });
    bad.view({ timeline });
    bad.page.frames(30, 16);
    expect(bad.rt.debug().quality).toMatchObject({ scale: 1, scalePinned: false });
  });

  it('the buffer is the device ratio times the scale: a 2x screen pinned to 0.5 draws a 1x buffer, at a tier that allows 2x', () => {
    const r = make({ signals: STRONG, search: '?scale=0.5' });
    (window as unknown as { devicePixelRatio: number }).devicePixelRatio = 2;
    r.view({ timeline });
    (r.rt as unknown as { resize(): void }).resize();
    r.page.frames(3, 16);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'high', pixelRatio: 2, scale: 0.5 });
    expect(bufferOf(r.rt)).toBe(1);
  });

  it('a forced tier is never second-guessed, and that includes the scale: slow frames step nothing', () => {
    const r = make({ signals: SOFT, search: '?quality=low' });
    r.view({ timeline });
    r.page.frames(400, 60);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'low', pinned: true, scale: 1 });
    expect(r.hooks.scales).toEqual([1]);
  });

  it('a hidden tab is not a slow device: frames while it is hidden do not step the scale', () => {
    const r = make({ signals: SOFT });
    r.view({ timeline });
    r.page.frames(30, 16);
    (document as unknown as { hidden: boolean }).hidden = true;
    r.page.frames(300, 60);
    expect(r.rt.debug().quality.scale).toBe(1);
    (document as unknown as { hidden: boolean }).hidden = false;
    until(r, 60, 1);
    expect(r.rt.debug().quality.scale).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------- P1: the motion recorder

/** A recorder stand-in that counts every call it gets, so a test can say "never" and mean it. */
function countingProbe(): { create: () => MotionProbe; made: () => number; calls: { frame: number; start: number; done: number; dispose: number }; frames: unknown[]; events: unknown[] } {
  const calls = { frame: 0, start: 0, done: 0, dispose: 0 };
  const frames: unknown[] = [];
  const events: unknown[] = [];
  let made = 0;
  const create = (): MotionProbe => {
    made++;
    return {
      frame: (f) => { calls.frame++; frames.push(f); },
      stepStart: (e) => { calls.start++; events.push(e); },
      stepDone: (e) => { calls.done++; events.push(e); },
      dispose: () => { calls.dispose++; },
    };
  };
  return { create, made: () => made, calls, frames, events };
}
const NOTHING = { frame: 0, start: 0, done: 0, dispose: 0 };

describe('the motion recorder: off unless the address asks', () => {
  const next = moved(frame0, LANCER, 4, 0);
  const walk: GameEvent[] = [{ kind: 'moved', unitId: LANCER, path: [pt(2, 1), pt(2, 0), pt(3, 0), pt(4, 0)] }];

  /** Runs a stage through a view, a plan that plays to its end, and a rest: every kind of call the recorder could get. */
  const runAll = (search: string, probe: ReturnType<typeof countingProbe>): Rig => {
    const { r } = playing({ events: walk, next, modules: { search, createProbe: probe.create } });
    r.page.advance(1000);
    r.page.frames(5);
    return r;
  };

  it('by default it is never built, never called from the frame loop, and nothing is added to window', () => {
    for (const search of ['', '?quality=low', '?probe=', '?probe=other', '?probe=motions', '?xprobe=motion', '?scale=0.7']) {
      const probe = countingProbe();
      const r = runAll(search, probe);
      expect(probe.made(), search).toBe(0);
      expect(probe.calls, search).toEqual(NOTHING);
      expect('__awMotion' in window, search).toBe(false);
      expect(r.rt.debug().probe, search).toBe(false);
      r.rt.dispose();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('and with the default factory it still adds nothing to window while the address does not ask', () => {
    const { r } = playing({ events: walk, next, modules: { search: '' } });
    r.page.frames(10);
    expect(Object.keys(window as unknown as object).filter((k) => k.startsWith('__'))).toEqual([]);
  });

  it('KNOWN-BAD: the check itself is not vacuous: a recorder that was called does fail the "never" assertion', () => {
    const probe = countingProbe();
    const planted = probe.create();
    planted.frame({} as never); // a leak: the frame loop calling the recorder when it should not
    expect(() => expect(probe.calls).toEqual(NOTHING)).toThrow();
    expect(() => expect(probe.made()).toBe(0)).toThrow();
  });

  it('?probe=motion builds exactly one, calls it once per drawn frame, tells it each plan and its end, and disposes it with the stage', () => {
    const probe = countingProbe();
    const r = runAll('?probe=motion', probe);
    r.page.frames(60, 16);
    expect(probe.made()).toBe(1);
    expect(r.rt.debug().probe).toBe(true);
    // frames that drew nothing (no view yet) are not samples: the first view came after construction, so every call here is a drawn frame
    expect(probe.calls.frame).toBeGreaterThan(30);
    expect(probe.calls.start).toBe(2); // the first view (no plan), then the plan
    expect(probe.calls.done).toBe(1);
    r.rt.dispose();
    expect(probe.calls.dispose).toBe(1);
  });

  it('frames before the stage has a view to draw are not recorded', () => {
    const probe = countingProbe();
    const r = make({ search: '?probe=motion', createProbe: probe.create, signals: STRONG });
    r.page.frames(10);
    expect(probe.calls.frame).toBe(0);
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(3);
    expect(probe.calls.frame).toBe(3);
  });
});

describe('the motion recorder: what it keeps', () => {
  const next = moved(frame0, LANCER, 4, 0);
  const path: Coord[] = [pt(2, 1), pt(2, 0), pt(3, 0), pt(4, 0)];
  const walk: GameEvent[] = [{ kind: 'moved', unitId: LANCER, path }];
  type Api = { version: number; read(): Recording; reset(): void };
  const apiOf = (): Api => (window as unknown as { __awMotion: Api }).__awMotion;
  const FRAME = 1000 / 60;

  it('puts read() and reset() on window.__awMotion and takes them off again when the stage is disposed', () => {
    const { r } = playing({ events: walk, next, modules: { search: '?probe=motion', signals: STRONG } });
    expect(typeof apiOf().read).toBe('function');
    expect(typeof apiOf().reset).toBe('function');
    r.page.frames(5, FRAME);
    expect(apiOf().read().frames.length).toBeGreaterThan(4);
    apiOf().reset();
    expect(apiOf().read()).toMatchObject({ schema: 1, frames: [], events: [], truncated: false });
    r.rt.dispose();
    expect('__awMotion' in window).toBe(false);
  });

  it('a frame sample carries the timestamp, the JS time, the tier, the scale, the camera and the unit the plan moves', () => {
    const { r, plan } = playing({ events: walk, next, modules: { search: '?probe=motion', signals: SOFT } });
    const planStart = apiOf().read().events.filter((e) => e.type === 'start' && e.planned)[0].t;
    apiOf().reset();
    r.page.frames(10, FRAME);
    const rec = apiOf().read();
    const f = rec.frames[rec.frames.length - 1];
    expect(rec.frames).toHaveLength(10);
    expect(f.t).toBe(r.page.now());
    expect(f.js).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(f.js)).toBe(true);
    expect(f.tier).toBe('low');
    expect(f.scale).toBe(1);
    const cam = camPos(r.rt);
    expect(f.cam).toEqual([cam.x, cam.y, cam.z]);
    expect(f.step).toBe(1);
    expect(f.planT).toBeCloseTo(r.page.now() - planStart, 6);
    // the lancer is the one unit the plan moves: id, world position (tile centre = tile + 0.5), the beat it is on
    expect(f.units).toHaveLength(1);
    const [id, x, , z, beat] = f.units[0];
    expect(id).toBe(LANCER);
    expect(beat).toBe(0);
    expect(x).toBeGreaterThan(2.5 - 1e-9);
    expect(x).toBeLessThan(4.5);
    expect(z).toBeGreaterThan(0.5 - 1e-9);
    expect(z).toBeLessThan(1.5 + 1e-9);
    expect(plan.moves).toHaveLength(1);
  });

  it('the tier and the render scale in a sample follow the stage when the adaptive step moves them', () => {
    const r = make({ search: '?probe=motion', signals: SOFT });
    r.view({ timeline: timelineOf([frame0]) });
    r.page.frames(30, 16);
    r.page.frames(90, 40);
    r.page.frames(5, 16);
    const rec = apiOf().read();
    const last = rec.frames[rec.frames.length - 1];
    expect(last).toMatchObject({ tier: 'low', scale: 0.85 });
    expect(rec.frames[0]).toMatchObject({ tier: 'low', scale: 1 });
  });

  it('a plan is recorded as its own timings: durationMs, the dwell, the speed the page shows, and every move beat with its path', () => {
    const r = make({ search: '?probe=motion', signals: STRONG });
    // the page's speed buttons: "2x" is the pressed one
    (document as unknown as { querySelector: (sel: string) => unknown }).querySelector = (sel) => (sel.includes('aria-pressed') ? { textContent: '2x' } : null);
    const timeline = timelineOf([frame0, next], [[], walk]);
    const plan = planOf(frame0, next, walk);
    r.view({ timeline, step: 1, reducedMotion: false });
    r.page.frames(4, FRAME);
    r.view({ timeline, step: 1, plan, reducedMotion: false });
    r.page.advance(plan.durationMs + 50);
    r.page.frames(2);
    const rec = apiOf().read();
    const start = rec.events.filter((e) => e.type === 'start').pop()!;
    if (start.type !== 'start') throw new Error('not a start');
    expect(start).toMatchObject({ step: 1, speed: 2, reduced: false, tween: true, planned: true, durationMs: plan.durationMs, dwellMs: 100 });
    expect(start.moves).toEqual([{ unitId: LANCER, startMs: 0, durMs: 720, path: [[2, 1], [2, 0], [3, 0], [4, 0]] }]);
    const done = rec.events.filter((e) => e.type === 'done');
    expect(done).toHaveLength(1);
    expect(done[0].t).toBeGreaterThanOrEqual(start.t + plan.durationMs);
    expect(done[0]).toMatchObject({ seq: start.seq, step: 1 });
  });

  it('a step reached by a jump is recorded as not planned, and the first frame after a camera snap is flagged a cut, once', () => {
    const r = make({ search: '?probe=motion', signals: STRONG });
    const timeline = timelineOf([frame0, next], [[], walk]);
    r.view({ timeline, step: 0 });
    r.page.frames(5, FRAME);
    r.view({ timeline, step: 1 }); // a scrub: no plan, the camera cuts
    r.page.frames(4, FRAME);
    const rec = apiOf().read();
    expect(rec.events.filter((e) => e.type === 'start').map((e) => (e.type === 'start' ? e.planned : null))).toEqual([false, false]);
    const cuts = rec.frames.map((f) => f.cut);
    expect(cuts.filter(Boolean)).toHaveLength(2); // the first view cuts to its focus, then the scrub does
    expect(cuts[cuts.length - 1]).toBe(false);
  });

  it('a recording the stage made of its own glide goes through the analysis clean: 240 ms a tile, on its tile at the end, no teleport', () => {
    const { r, plan } = playing({ events: walk, next, modules: { search: '?probe=motion', signals: STRONG } });
    apiOf().reset();
    // a view at step 1 with the plan already running: record from the plan's own start
    r.view({ timeline: timelineOf([frame0, next], [[], walk]), step: 1, plan: planOf(frame0, next, walk), reducedMotion: false });
    r.page.frames(Math.ceil((plan.durationMs + 100) / FRAME), FRAME);
    const rec = apiOf().read();
    const report = analyseMotion(rec);
    expect(report.glide.beats).toHaveLength(1);
    const beat = report.glide.beats[0];
    expect(beat.problems).toEqual([]);
    expect(beat.speed).toBe(1); // read off the beat: 240 ms a tile
    expect(beat.measuredMsPerTile).toBeGreaterThan(230);
    expect(beat.measuredMsPerTile).toBeLessThan(250);
    expect(report.failed).toEqual([]);
  });
});


// ---------------------------------------------------------------- P1: the playback clock does not wait for frames

describe('a plan ends on the clock, and a slow machine gives the thread back at a step boundary', () => {
  const next = moved(frame0, LANCER, 4, 0);
  const walk: GameEvent[] = [{ kind: 'moved', unitId: LANCER, path: [pt(2, 1), pt(2, 0), pt(3, 0), pt(4, 0)] }]; // 3 tiles: 720 ms at 1x
  const timeline = timelineOf([frame0, next], [[], walk]);
  const idle = timelineOf([frame0, frame0], [[], []]);
  const calm = planOf(frame0, frame0, []); // nothing to animate

  /** A stage with fake timers whose clock is the page's: `idle(ms)` lets time pass with NO frame, running whatever timer comes due. */
  function clocked(modules: Partial<StageModules> = {}): Rig & { idle(ms: number): void; draws(): number } {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const r = make({ signals: STRONG, ...modules });
    const composer = (r.rt as unknown as { composer: { render(dt: number): void } }).composer;
    let n = 0;
    const real = composer.render.bind(composer);
    composer.render = (dt: number) => { n++; real(dt); };
    // time passes: the page's clock moves, the timers that came due in it run, and only then does the animation frame (if one is wanted) run
    const idle = (ms: number): void => {
      r.page.idle(ms);
      vi.advanceTimersByTime(ms);
    };
    const advance = (ms: number): void => {
      idle(ms);
      r.page.advance(0);
    };
    const page: Page = { ...r.page, advance, idle, frames: (count, ms = 1000 / 60) => { for (let i = 0; i < count; i++) advance(ms); } };
    return { ...r, page, draws: () => n, idle };
  }
  afterEach(() => { vi.useRealTimers(); });

  it('the end of a plan is told by a timer at its time, not by the next frame: with 250 ms between frames, onDone comes at 720 ms, not at the frame after it (750)', () => {
    const r = clocked();
    const plan = planOf(frame0, next, walk);
    expect(plan.durationMs).toBe(720);
    r.view({ timeline, step: 1, reducedMotion: false });
    r.page.frames(2, 16);
    r.view({ timeline, step: 1, plan, reducedMotion: false });
    r.idle(719);
    expect(r.hooks.done).toBe(0); // not yet: the plan is still running
    r.idle(3);
    expect(r.hooks.done).toBe(1); // over, and no frame has come in the meantime
    r.page.advance(250);
    expect(r.hooks.done).toBe(1); // and the frame that comes later does not tell it again
  });

  it('known-bad: with frames alone (the timer swallowed), onDone waits for the first frame past the end', () => {
    const r = clocked();
    const plan = planOf(frame0, next, walk);
    r.view({ timeline, step: 1, reducedMotion: false });
    r.page.frames(2, 16);
    r.view({ timeline, step: 1, plan, reducedMotion: false });
    vi.clearAllTimers(); // the planted fault: no timer
    const before = r.page.now();
    r.page.frames(2, 250);
    expect(r.hooks.done).toBe(0); // 500 ms: the plan is still running
    r.page.frames(1, 250);
    expect(r.page.now() - before).toBe(750);
    expect(r.hooks.done).toBe(1); // told by the third frame, at 750 ms
  });

  it('a hidden tab does not play on: the timer does not end the plan, and the first frame once it is visible does', () => {
    const r = clocked();
    const plan = planOf(frame0, next, walk);
    r.view({ timeline, step: 1, reducedMotion: false });
    r.page.frames(2, 16);
    r.view({ timeline, step: 1, plan, reducedMotion: false });
    (document as unknown as { hidden: boolean }).hidden = true;
    r.idle(2000);
    expect(r.hooks.done).toBe(0);
    (document as unknown as { hidden: boolean }).hidden = false;
    r.page.frames(1, 16);
    expect(r.hooks.done).toBe(1);
  });

  it('a new plan cancels the old one\'s timer, and dispose cancels the pending one: no late onDone for a plan that is gone', () => {
    const r = clocked();
    const plan = planOf(frame0, next, walk);
    r.view({ timeline, step: 1, reducedMotion: false });
    r.page.frames(2, 16);
    r.view({ timeline, step: 1, plan, reducedMotion: false });
    r.idle(100);
    r.view({ timeline, step: 1, reducedMotion: false }); // the viewer scrubbed: no plan any more
    r.idle(1000);
    expect(r.hooks.done).toBe(0);
    r.view({ timeline, step: 1, plan: planOf(frame0, next, walk), reducedMotion: false });
    r.rt.dispose();
    r.idle(1000);
    expect(r.hooks.done).toBe(0);
  });

  it('the recorder hears the end once, from whichever came first', () => {
    const probe = countingProbe();
    const r = clocked({ search: '?probe=motion', createProbe: probe.create });
    const plan = planOf(frame0, next, walk);
    r.view({ timeline, step: 1, reducedMotion: false });
    r.page.frames(2, 16);
    r.view({ timeline, step: 1, plan, reducedMotion: false });
    r.idle(730);
    r.page.frames(3, 16);
    expect(probe.calls.done).toBe(1);
  });

  it('on a slow machine the stage stops drawing after the end of a step, for at most 400 ms, then draws again; the state still updates', () => {
    const r = clocked();
    const plan = planOf(frame0, next, walk);
    r.view({ timeline, step: 1, reducedMotion: false });
    r.page.frames(10, 120); // 8 fps: slow
    r.view({ timeline, step: 1, plan, reducedMotion: false });
    r.page.frames(5, 120); // 600 ms into the 720 ms plan
    const before = r.draws();
    r.idle(130); // the timer ends the plan at 720 ms
    expect(r.hooks.done).toBe(1);
    r.page.frames(1, 16); // the next frame draws the rest state once and opens the window
    expect(r.draws()).toBe(before + 1);
    r.page.frames(10, 30); // 300 ms of frames inside the window: none is drawn
    expect(r.draws()).toBe(before + 1);
    r.page.frames(6, 30); // the window (400 ms) is over: drawing is back
    expect(r.draws()).toBeGreaterThan(before + 1);
    expect(r.hooks.failed).toEqual([]);
  });

  it('a machine that draws at 60 fps never skips a frame, at a boundary or anywhere', () => {
    const r = clocked();
    const plan = planOf(frame0, next, walk);
    r.view({ timeline, step: 1, reducedMotion: false });
    r.page.frames(10, 16);
    r.view({ timeline, step: 1, plan, reducedMotion: false });
    const before = r.draws();
    r.page.frames(60, 16); // a second of play: the plan ends and a boundary passes
    expect(r.hooks.done).toBe(1);
    expect(r.draws() - before).toBe(60);
  });

  it('a step with nothing to animate is a boundary at once: the first frame draws the new step, the next ones are skipped while frames are slow', () => {
    const r = clocked();
    r.view({ timeline: idle, step: 0, reducedMotion: false });
    r.page.frames(10, 120);
    r.view({ timeline: idle, step: 1, plan: calm, reducedMotion: false });
    const before = r.draws();
    r.page.frames(1, 120);
    expect(r.draws()).toBe(before + 1);
    r.page.frames(2, 120);
    expect(r.draws()).toBe(before + 1); // skipped
  });

  it('anything that must be seen wakes it: a new view, a zoom step, a resize', () => {
    for (const wake of [
      (r: Rig) => r.view({ timeline, step: 1, reducedMotion: false }),
      (r: Rig) => r.rt.zoomStep(1),
      (r: Rig) => (r.rt as unknown as { resize(): void }).resize(),
    ]) {
      const r = clocked();
      r.view({ timeline: idle, step: 0, reducedMotion: false });
      r.page.frames(10, 120);
      r.view({ timeline: idle, step: 1, plan: calm, reducedMotion: false });
      r.page.frames(1, 120);
      const before = r.draws();
      r.page.frames(1, 120);
      expect(r.draws()).toBe(before); // inside the window
      wake(r);
      r.page.frames(1, 120);
      expect(r.draws()).toBe(before + 1);
      r.rt.dispose();
      vi.useRealTimers();
    }
  });

  it('the frame that finds the plan over (the timer being late) tells the page but does not draw on a slow machine; the next one draws the rest state', () => {
    const r = clocked();
    const plan = planOf(frame0, next, walk);
    r.view({ timeline, step: 1, reducedMotion: false });
    r.page.frames(10, 120);
    r.view({ timeline, step: 1, plan, reducedMotion: false });
    vi.clearAllTimers(); // the planted case: the frame gets there first
    r.page.frames(5, 120); // 600 ms
    const before = r.draws();
    r.page.frames(1, 120); // 720 ms: the plan is over
    expect(r.hooks.done).toBe(1);
    expect(r.draws()).toBe(before); // told, not drawn
    r.page.frames(1, 16);
    expect(r.draws()).toBe(before + 1); // the rest state
    // and on a fast machine the same frame DOES draw
    const f = clocked();
    f.view({ timeline, step: 1, reducedMotion: false });
    f.page.frames(10, 16);
    f.view({ timeline, step: 1, plan, reducedMotion: false });
    vi.clearAllTimers();
    f.page.frames(40, 16); // 640 ms into the 720 ms plan
    const b2 = f.draws();
    f.page.frames(10, 16); // the plan ends in the fifth of these
    expect(f.hooks.done).toBe(1);
    expect(f.draws() - b2).toBe(10);
    f.rt.dispose();
  });

  it('frames skipped at a boundary are not frame times: the adaptive step is fed only real frame intervals, never a skip gap', () => {
    const r = clocked({ signals: { renderer: 'llvmpipe' } }); // low: the render scale is the next step down
    const adaptive = (r.rt as unknown as { adaptive: { push(ms: number, now: number): unknown } }).adaptive;
    const fed: number[] = [];
    const real = adaptive.push.bind(adaptive);
    adaptive.push = (ms, now) => { fed.push(ms); return real(ms, now); };
    r.view({ timeline: idle, step: 0, reducedMotion: false });
    r.page.frames(10, 120);
    for (let i = 0; i < 6; i++) {
      r.view({ timeline: idle, step: (i + 1) % 2, plan: planOf(frame0, frame0, []), reducedMotion: false }); // a new plan each time: a new boundary
      r.page.frames(8, 120); // one drawn, three skipped (the window is 400 ms), the rest drawn again
    }
    // per boundary: the frame that opens the window, three skipped, then a drawn one that follows the gap (its interval spans the skips: not fed) and three more
    expect(r.draws()).toBe(10 + 6 * 5);
    expect(fed.length).toBe(r.draws() - 6); // one frame per boundary was left out of the adaptive step
    expect(new Set(fed.map((v) => Math.round(v)))).toEqual(new Set([120]));
  });
});


// ---------------------------------------------------------------- P1: a phone stops at 0.7

describe('the render scale on a narrow canvas and a wide one', () => {
  const timeline = timelineOf([frame0]);
  const until = (r: Rig, ms: number, from: number, cap = 400): number => {
    let n = 0;
    while (r.rt.debug().quality.scale === from && n < cap) {
      r.page.frames(1, ms);
      n++;
    }
    return n;
  };
  /** Every slow stretch it can find: steps until the scale stops moving. */
  const settleSlow = (r: Rig): number => {
    let scale = r.rt.debug().quality.scale;
    for (let i = 0; i < 6; i++) {
      until(r, 40, scale, 120);
      if (r.rt.debug().quality.scale === scale) break;
      scale = r.rt.debug().quality.scale;
    }
    return scale;
  };

  it('a 1000 px canvas goes on to 0.5; a 390 px one (a phone) stops at 0.7 and the buffer is 0.7 of its CSS size, however slow the frames stay', () => {
    const wide = sizedRenderer();
    const w = make({ signals: SOFT, createRenderer: wide.create }, 1000);
    w.view({ timeline });
    w.page.frames(30, 16);
    expect(settleSlow(w)).toBe(0.5);

    const narrow = sizedRenderer();
    const n = make({ signals: SOFT, createRenderer: narrow.create }, 390);
    n.view({ timeline });
    n.page.frames(30, 16);
    expect(settleSlow(n)).toBe(0.7);
    n.page.frames(400, 40); // and slow for a long time more
    expect(n.rt.debug().quality.scale).toBe(0.7);
    expect(narrow.ratios[narrow.ratios.length - 1]).toBeCloseTo(0.7, 12);
    expect(n.hooks.scales).toEqual([1, 0.85, 0.7]);
  });

  it('the line is 960: a 960 px canvas reaches 0.5 and a 959 px one stops at 0.7', () => {
    for (const [px, want] of [[960, 0.5], [959, 0.7]] as const) {
      const r = make({ signals: SOFT }, px);
      r.view({ timeline });
      r.page.frames(30, 16);
      expect(settleSlow(r), `${px} px`).toBe(want);
      r.rt.dispose();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('an explicit ?scale=0.5 is the viewer\'s own word and is kept even on a narrow canvas (it is only the adaptive step that stops at 0.7)', () => {
    const r = make({ signals: SOFT, search: '?scale=0.5' }, 390);
    r.view({ timeline });
    r.page.frames(30, 16);
    expect(r.rt.debug().quality).toMatchObject({ scale: 0.5, scalePinned: true });
  });
});

// ---------------------------------------------------------------- P1: the device remembers where it settled

describe('what a device settled on is remembered, and the next battle starts there', () => {
  const timeline = timelineOf([frame0]);
  const DAY = 24 * 60 * 60 * 1000;
  const until = (r: Rig, ms: number, from: number, cap = 400): void => {
    let n = 0;
    while (r.rt.debug().quality.scale === from && n < cap) {
      r.page.frames(1, ms);
      n++;
    }
  };

  /** A Storage stand-in that keeps what it is given and counts the writes. */
  function memory(initial?: string): { storage: () => StorageLike; get: () => string | null; writes: () => number } {
    let value: string | null = initial ?? null;
    let writes = 0;
    return {
      storage: () => ({ getItem: (k) => (k === REMEMBER_KEY ? value : null), setItem: (k, v) => { if (k === REMEMBER_KEY) { value = v; writes++; } } }),
      get: () => value,
      writes: () => writes,
    };
  }
  const saved = (o: { tier?: string; scale?: number; at?: number }): string => JSON.stringify({ tier: 'low', scale: 0.7, at: Date.now(), ...o });

  it('an adaptive drop is written as it happens: the tier, the scale and the time (high -> medium -> low -> 0.85 each leave the state it reached)', () => {
    const mem = memory();
    const r = make({ signals: STRONG, storage: mem.storage });
    r.view({ timeline });
    r.page.frames(30, 16);
    expect(mem.writes()).toBe(0); // nothing has dropped yet: nothing to remember
    r.page.frames(60, 40);
    expect(JSON.parse(mem.get() as string)).toMatchObject({ tier: 'medium', scale: 1 });
    r.page.frames(60, 40);
    expect(JSON.parse(mem.get() as string)).toMatchObject({ tier: 'low', scale: 1 });
    until(r, 40, 1);
    const last = JSON.parse(mem.get() as string);
    expect(last).toMatchObject({ tier: 'low', scale: 0.85 });
    expect(Math.abs(last.at - Date.now())).toBeLessThan(60_000);
    expect(mem.writes()).toBe(3);
  });

  it('a stored state starts the next battle there: no drop is needed, the passes are the stored tier\'s and the buffer the stored scale\'s', () => {
    const sized = sizedRenderer();
    const r = make({ signals: STRONG, storage: memory(saved({ tier: 'low', scale: 0.7 })).storage, createRenderer: sized.create });
    r.view({ timeline });
    r.page.frames(3, 16);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'low', scale: 0.7, passes: passNames('low'), remembered: { tier: 'low', scale: 0.7 } });
    expect(r.hooks.quality[0]).toBe('low'); // the very first thing the page is told
    expect(r.hooks.scales[0]).toBe(0.7);
    expect(sized.ratios[sized.ratios.length - 1]).toBeCloseTo(0.7, 12);
  });

  it('it never starts BETTER than the machine guesses: a remembered high on a software renderer is still low', () => {
    const r = make({ signals: SOFT, storage: memory(saved({ tier: 'high', scale: 1 })).storage });
    r.view({ timeline });
    r.page.frames(3, 16);
    expect(r.rt.qualityTier).toBe('low');
  });

  it('and the adaptive step goes on from there, one way: a stored 0.7 steps to 0.5 on a wide canvas and is written again', () => {
    const mem = memory(saved({ tier: 'low', scale: 0.7 }));
    const r = make({ signals: SOFT, storage: mem.storage }, 1000);
    r.view({ timeline });
    r.page.frames(30, 16);
    until(r, 40, 0.7);
    expect(r.rt.debug().quality.scale).toBe(0.5);
    expect(JSON.parse(mem.get() as string)).toMatchObject({ tier: 'low', scale: 0.5 });
  });

  it('an expired one (7 days) is ignored: the battle starts where the machine guesses, at scale 1', () => {
    for (const age of [REMEMBER_MS, 8 * DAY, 400 * DAY]) {
      const r = make({ signals: STRONG, storage: memory(saved({ at: Date.now() - age })).storage });
      r.view({ timeline });
      r.page.frames(3, 16);
      expect(r.rt.debug().quality, `${age / DAY} days`).toMatchObject({ tier: 'high', scale: 1, remembered: null });
      r.rt.dispose();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
    // known-bad: one day short of it is still believed
    const fresh = make({ signals: STRONG, storage: memory(saved({ at: Date.now() - (REMEMBER_MS - DAY) })).storage });
    fresh.view({ timeline });
    fresh.page.frames(3, 16);
    expect(fresh.rt.debug().quality).toMatchObject({ tier: 'low', scale: 0.7 });
  });

  it('nothing stored: the battle starts as it always did', () => {
    const r = make({ signals: STRONG, storage: memory().storage });
    r.view({ timeline });
    r.page.frames(3, 16);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'high', scale: 1, remembered: null });
    // and so does a page with no storage at all (the default in node: no window.localStorage)
    r.rt.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const none = make({ signals: STRONG, storage: () => null });
    none.view({ timeline });
    none.page.frames(30, 16);
    none.page.frames(60, 40);
    expect(none.rt.qualityTier).toBe('medium'); // adapting works, and there was nowhere to write
    expect(none.hooks.failed).toEqual([]);
  });

  it('storage that throws, on the lookup, the read or the write, changes nothing: the stage starts, adapts and does not fail', () => {
    const lookup = (): StorageLike => { throw new Error('SecurityError: access to localStorage is denied'); };
    const reads: StorageLike = { getItem: () => { throw new Error('boom'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
    for (const storage of [lookup, () => reads]) {
      const r = make({ signals: STRONG, storage });
      r.view({ timeline });
      r.page.frames(30, 16);
      expect(r.rt.debug().quality).toMatchObject({ tier: 'high', scale: 1, remembered: null });
      r.page.frames(60, 40); // a drop whose write throws
      expect(r.rt.qualityTier).toBe('medium');
      expect(r.hooks.failed).toEqual([]);
      r.rt.dispose();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('?quality= and ?scale= win: a forced tier ignores the memory and writes nothing; a forced scale keeps the remembered tier but not the remembered scale and writes nothing', () => {
    const forcedTier = memory(saved({ tier: 'low', scale: 0.5 }));
    const a = make({ signals: STRONG, search: '?quality=high', storage: forcedTier.storage });
    a.view({ timeline });
    a.page.frames(30, 16);
    a.page.frames(200, 60);
    expect(a.rt.debug().quality).toMatchObject({ tier: 'high', scale: 1, remembered: null, pinned: true });
    expect(forcedTier.writes()).toBe(0);
    a.rt.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();

    const forcedScale = memory(saved({ tier: 'low', scale: 0.5 }));
    const b = make({ signals: STRONG, search: '?scale=1', storage: forcedScale.storage });
    b.view({ timeline });
    b.page.frames(3, 16);
    expect(b.rt.debug().quality).toMatchObject({ tier: 'low', scale: 1, scalePinned: true });
    until(b, 40, 1, 150); // slow frames: the scale is pinned and the tier is already the floor
    expect(b.rt.debug().quality.scale).toBe(1);
    expect(forcedScale.writes()).toBe(0);
    b.rt.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();

    // known-bad for the "writes nothing" half: a pinned scale with a tier that DOES drop is not the device's own settling, so it is not remembered either
    const pinnedWhileDropping = memory();
    const c = make({ signals: STRONG, search: '?scale=0.85', storage: pinnedWhileDropping.storage });
    c.view({ timeline });
    c.page.frames(30, 16);
    c.page.frames(60, 40);
    expect(c.rt.debug().quality).toMatchObject({ tier: 'medium', scale: 0.85, scalePinned: true });
    expect(pinnedWhileDropping.writes()).toBe(0);
  });

  it('a remembered 0.5 on a canvas that is now narrow (a smaller window of the same browser) is held to 0.7', () => {
    const r = make({ signals: STRONG, storage: memory(saved({ tier: 'low', scale: 0.5 })).storage }, 390);
    r.view({ timeline });
    r.page.frames(3, 16);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'low', scale: 0.7 });
    // and on a wide one it is kept
    const w = make({ signals: STRONG, storage: memory(saved({ tier: 'low', scale: 0.5 })).storage }, 1000);
    w.view({ timeline });
    w.page.frames(3, 16);
    expect(w.rt.debug().quality).toMatchObject({ tier: 'low', scale: 0.5 });
  });

  it('malformed storage text starts clean, and the first drop overwrites it', () => {
    const mem = memory('{{ not json');
    const r = make({ signals: STRONG, storage: mem.storage });
    r.view({ timeline });
    r.page.frames(30, 16);
    expect(r.rt.debug().quality).toMatchObject({ tier: 'high', remembered: null });
    r.page.frames(60, 40);
    expect(JSON.parse(mem.get() as string)).toMatchObject({ tier: 'medium', scale: 1 });
  });
});
