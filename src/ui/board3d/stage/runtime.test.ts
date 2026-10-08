// The stage core, run end to end in node: the real StageRuntime on a stand-in GPU (a renderer that draws nothing) and a stand-in page
// (a canvas, a host, a frame clock we advance by hand). What is real: the runtime, the transition plan, the mapping, the camera rig, the
// table, the storm static, the effects kit and the post-processing passes' construction. What is stood in for: WebGL, the DOM and the clock.
// So these tests check the WIRING of G8b: what the terrain is told about occupancy, what the effects kit is told about reduced motion,
// when the match intro runs, and what the storm and the table do.
import { Group, Object3D, Vector2 } from 'three';
import type { WebGLRenderer } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Coord, GameEvent } from '../../../game/aw';
import { fixtureMap } from '../../../game/aw/testing';
import type { FixtureUnit } from '../../../game/aw/testing';
import { recordMatch, viewTimeline } from '../../watch/timeline';
import type { Timeline, TimelineStep, ViewFrame } from '../../watch/timeline';
import { fieldSetup, pt } from '../../watch/testing';
import { planTransition } from '../../watch/transition';
import type { TransitionPlan } from '../../watch/transition';
import type { CreateFx, CreateTerrain, CreateUnitView, FxView, TerrainView, UnitView } from '../contract';
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
import { stormCount } from './storm';
import { fieldFrame, idOf } from './testing';

// ---------------------------------------------------------------- the stand-in page

const CANVAS_W = 1000;
const CANVAS_H = 600;

interface Page { advance(ms: number): void; frames(count: number, ms?: number): void; now(): number; pendingFrames(): number }

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
  return { advance, frames: (count, ms = 1000 / 60) => { for (let i = 0; i < count; i++) advance(ms); }, now: () => clock, pendingFrames: () => (pending ? 1 : 0) };
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

function unitViews(): { create: CreateUnitView; made: string[]; live: () => number } {
  const made: string[] = [];
  let live = 0;
  const create: CreateUnitView = (type) => {
    made.push(type);
    live++;
    const v: UnitView = {
      object: new Object3D(), type, setLook: () => undefined, setPose: () => undefined, muzzleWorld: (out) => out.set(0, 0, 0),
      update: () => undefined, dispose: () => { live--; },
    };
    return v;
  };
  return { create, made, live: () => live };
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
  hooks: { done: number; failed: string[] };
  view(partial: Partial<StageView> & Pick<StageView, 'timeline'>): void;
}

function build(modules: Partial<StageModules> = {}): Rig {
  const page = installPage();
  const t = recordingTerrain();
  const views = unitViews();
  const hooks = { done: 0, failed: [] as string[] };
  const h: StageHooks = { onDone: () => { hooks.done++; }, onOverlay: () => undefined, onFail: (r) => { hooks.failed.push(r); } };
  const rt = new StageRuntime({ ...(el()) } as unknown as HTMLElement, h, {
    createRenderer: () => fakeRenderer(), createTerrain: t.create, createUnitView: views.create, createFx: plainFx, ...modules,
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
const make = (modules: Partial<StageModules> = {}): Rig => { rig = build(modules); return rig; };

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
      createRenderer: () => fakeRenderer(),
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
