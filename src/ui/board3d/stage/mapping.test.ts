// Mapping the transition plan's samples to the 3D picture: placements, headings, poses, and the effects (including the muzzle, tracer
// and shell derived from the plan's hit beats). Every plan is built from hand-written events over a fixture field, and the expected
// values are worked out here from the art direction's own figures and from geometry, not read back from mapping.ts.
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Coord, GameEvent, TerrainId, UnitTypeId } from '../../../game/aw';
import { fixtureMap } from '../../../game/aw/testing';
import type { FixtureUnit } from '../../../game/aw/testing';
import { UNSEEN_UNIT } from '../../../game/aw/view-events';
import { TIMINGS, scaled } from '../../watch/timing';
import { recordMatch, viewTimeline } from '../../watch/timeline';
import type { ViewFrame } from '../../watch/timeline';
import { planTransition, sampleTransition } from '../../watch/transition';
import type { TransitionPlan } from '../../watch/transition';
import { fieldSetup, pt } from '../../watch/testing';
import { FACTION_ACCENT } from '../palette';
import {
  CONTRAIL_LIFT, DUST_LIFT, GROUND_FX_LIFT, HIT_LIFT, SHOT, TRAIL_REACH, WAKE_LEVEL, analyseStep, attackAt, captureProgress, dustTint,
  facingHeading, hashSeed, headingOf, mapSignature, mapStage, moveState, shakeAt, shotPhase, shotProgress, surfaceY, sweepOf, toFxItems, toNumberItems,
  trailKindFor, trailOf,
} from './mapping';
import type { FxSpec, StageState, TrailKind, WorldEnv } from './mapping';
import { SHAKE_MS } from './shake';
import { fieldFrame, idOf, planOf } from './testing';

const HIT_MS = scaled(TIMINGS.hitMs, 1); // 380

// Helion lancer (owner 0) at x=2, Tidewell trooper (owner 1) at x=3, Helion mule at x=1, all on row 1 of an open field, no fog.
const frame0 = fieldFrame([
  { type: 'lancer', owner: 0, x: 2, y: 1 }, { type: 'trooper', owner: 1, x: 3, y: 1 }, { type: 'mule', owner: 0, x: 1, y: 1 },
]);
const LANCER = idOf(frame0, 'lancer');
const TROOPER = idOf(frame0, 'trooper');

const ATTACK: GameEvent = { kind: 'attacked', attackerId: LANCER, defenderId: TROOPER, damage: 42, counter: 18, attackerHp: 82, defenderHp: 58 };

/** The whole pipeline for one moment of one step: plan -> sample -> StageState. */
function stateAt(plan: TransitionPlan, events: GameEvent[], t: number, frame: ViewFrame = frame0, prev: ViewFrame = frame0): StageState {
  const info = analyseStep(prev, frame, events, plan);
  return mapStage({ frame, prev, plan, sample: sampleTransition(plan, t), t, info, step: 1 });
}
const unit = (s: StageState, id: number) => s.units.find((u) => u.id === id)!;
const kinds = (s: StageState): string[] => s.fx.map((f) => f.kind);

describe('pairing shots with the plan\'s hit beats', () => {
  const plan = planOf(frame0, frame0, [ATTACK]);

  it('finds one shot per strike, in the plan\'s order: the attack, then the counter', () => {
    const info = analyseStep(frame0, frame0, [ATTACK], plan);
    expect(info.shots).toHaveLength(2);
    expect(info.shots[0]).toMatchObject({ beat: 0, shooterId: LANCER, targetId: TROOPER, from: pt(2), to: pt(3), indirect: false, faction: 'helion' });
    expect(info.shots[1]).toMatchObject({ beat: 1, shooterId: TROOPER, targetId: LANCER, from: pt(3), to: pt(2), indirect: false, faction: 'tidewell' });
    // each shot's beat is the hit beat on the tile it ends at
    for (const s of info.shots) {
      expect(plan.fx[s.beat].kind).toBe('hit');
      expect(plan.fx[s.beat].at).toEqual(s.to);
    }
  });

  it('puts a counter-first strike first', () => {
    const e = { ...ATTACK, counterFirst: true } as GameEvent;
    const p = planOf(frame0, frame0, [e]);
    const shots = analyseStep(frame0, frame0, [e], p).shots;
    expect(shots.map((s) => s.shooterId)).toEqual([TROOPER, LANCER]);
  });

  it('draws no counter shot when there was no counter', () => {
    const e = { ...ATTACK, counter: 0, attackerHp: 100 } as GameEvent;
    const p = planOf(frame0, frame0, [e]);
    expect(analyseStep(frame0, frame0, [e], p).shots).toHaveLength(1);
  });

  it('uses where the shooter stood when it fired: after its own move in the same step', () => {
    const next: ViewFrame = { ...frame0, units: frame0.units.map((u) => (u.id === LANCER ? { ...u, x: 2, y: 0 } : u)) };
    const events: GameEvent[] = [
      { kind: 'moved', unitId: LANCER, path: [pt(2, 1), pt(2, 0)] },
      { kind: 'attacked', attackerId: LANCER, defenderId: TROOPER, damage: 40, counter: 0, attackerHp: 100, defenderHp: 60 },
    ];
    const p = planOf(frame0, next, events);
    const shot = analyseStep(frame0, next, events, p).shots[0];
    expect(shot.from).toEqual(pt(2, 0));
    expect(shot.to).toEqual(pt(3, 1));
  });

  it('does not pair a hit beat that is on a different tile than the target stands on (known-bad plan): no shot at the wrong tile', () => {
    const bad: TransitionPlan = { ...plan, fx: plan.fx.map((f, i) => (i === 0 ? { ...f, at: pt(7, 2) } : f)) };
    const shots = analyseStep(frame0, frame0, [ATTACK], bad).shots;
    expect(shots.some((s) => s.beat === 0)).toBe(false);
    expect(shots.map((s) => s.beat)).toEqual([1]); // the counter, whose beat is still right, is paired
  });

  it('draws nothing leading a shot from a shooter the viewer was never shown', () => {
    const unseen: GameEvent = { kind: 'attacked', attackerId: UNSEEN_UNIT, defenderId: TROOPER, damage: 42, counter: 18, attackerHp: UNSEEN_UNIT, defenderHp: 58 };
    const p = planOf(frame0, frame0, [unseen]);
    expect(analyseStep(frame0, frame0, [unseen], p).shots).toEqual([]);
    const stranger = { ...ATTACK, attackerId: 77 } as GameEvent;
    expect(analyseStep(frame0, frame0, [stranger], planOf(frame0, frame0, [stranger])).shots).toEqual([]);
  });

  it('reads direct versus indirect from the shooter\'s range in the unit data: arc, salvo and dreadnought fire shells, the rest tracers', () => {
    const indirectFor = (type: UnitTypeId): boolean => {
      const base = fieldFrame([{ type: 'lancer', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 4, y: 1 }]);
      const a = idOf(base, 'lancer', 0);
      // the unit's type comes from the frame; retyping it in the frame is the cheapest way to ask about every type
      const f: ViewFrame = { ...base, units: base.units.map((u) => (u.id === a ? { ...u, type } : u)) };
      const e: GameEvent = { kind: 'attacked', attackerId: a, defenderId: idOf(f, 'trooper', 1), damage: 30, counter: 0, attackerHp: 100, defenderHp: 70 };
      return analyseStep(f, f, [e], planOf(f, f, [e])).shots[0].indirect;
    };
    expect((['arc', 'salvo', 'dreadnought'] as const).map(indirectFor)).toEqual([true, true, true]);
    expect((['lancer', 'trooper', 'raptor', 'wasp', 'colossus'] as const).map(indirectFor)).toEqual([false, false, false, false, false]);
  });
});

describe('the phases of a shot inside its hit beat', () => {
  it('a direct shot: muzzle flash about 80 ms, the tracer lands almost at once, then the impact runs to the end of the beat', () => {
    expect(SHOT.muzzleEnd * HIT_MS).toBeGreaterThanOrEqual(60);
    expect(SHOT.muzzleEnd * HIT_MS).toBeLessThanOrEqual(100); // art direction: about 80 ms
    expect(SHOT.directFlightEnd * HIT_MS).toBeLessThanOrEqual(100); // a streak
    const early = shotPhase(false, 0.1);
    expect(early.muzzle).toBeCloseTo(0.5, 12);
    expect(early.flight).toBeCloseTo(0.1 / SHOT.directFlightEnd, 12);
    expect(early.impact).toBeNull();
    expect(early.fire).toBeCloseTo(0.1 / SHOT.fireEnd, 12);
    const landed = shotPhase(false, SHOT.directFlightEnd);
    expect(landed.flight).toBeNull();
    expect(landed.impact).toBe(0);
    expect(shotPhase(false, 1).impact).toBe(1);
    expect(shotPhase(false, 0.6).muzzle).toBeNull();
    expect(shotPhase(false, 0.6).fire).toBeNull();
  });

  it('a shell flies longer than a tracer and lands later', () => {
    expect(shotPhase(true, 0).landsAt).toBeGreaterThan(shotPhase(false, 0).landsAt);
    expect(SHOT.indirectFlightEnd * HIT_MS).toBeGreaterThanOrEqual(120); // long enough to see an arc
    // at a moment where a tracer has landed, the shell is still in the air
    const p = (SHOT.directFlightEnd + SHOT.indirectFlightEnd) / 2;
    expect(shotPhase(false, p).impact).not.toBeNull();
    expect(shotPhase(true, p).impact).toBeNull();
    expect(shotPhase(true, p).flight).not.toBeNull();
  });

  it('the impact is continuous with the flight: the impact starts at 0 exactly when the flight reaches 1', () => {
    for (const indirect of [false, true]) {
      const lands = shotPhase(indirect, 0).landsAt;
      expect(shotPhase(indirect, lands - 1e-9).flight).toBeCloseTo(1, 6);
      expect(shotPhase(indirect, lands).impact).toBe(0);
    }
  });

  it('agrees with the plan\'s own sample of the same hit beat: the shot progress is the sample\'s progress', () => {
    const plan = planOf(frame0, frame0, [ATTACK]);
    const shot = analyseStep(frame0, frame0, [ATTACK], plan).shots[0];
    for (const t of [0, 1, 60, 190, 379]) {
      const sampled = sampleTransition(plan, t).fx.find((f) => f.kind === 'hit' && f.at.x === 3)!;
      expect(shotProgress(plan, shot, t)).toBeCloseTo(sampled.progress, 12);
    }
    expect(shotProgress(plan, shot, HIT_MS)).toBeNull(); // the beat has ended; the counter's beat runs now
    expect(shotProgress(plan, shot, HIT_MS + 5)).toBeNull();
  });
});

describe('an attack, sampled', () => {
  const plan = planOf(frame0, frame0, [ATTACK]);
  const at = (p: number, beat = 0): number => beat * HIT_MS + p * HIT_MS;

  it('starts with a muzzle flash and a tracer from the attacker, no impact yet, and the attacker in its fire pose', () => {
    const s = stateAt(plan, [ATTACK], at(0.1));
    expect(kinds(s)).toEqual(['muzzle', 'tracer']);
    const tracer = s.fx.find((f) => f.kind === 'tracer')!;
    expect(tracer.fromUnit).toBe(LANCER);
    expect(tracer.at).toEqual(pt(2));
    expect(tracer.to).toEqual(pt(3));
    expect(tracer.progress).toBeCloseTo(0.1 / 0.18, 9);
    expect(tracer.color).toBe(FACTION_ACCENT.helion); // tinted with the attacker's faction
    expect(unit(s, LANCER).pose).toBe('fire');
    expect(unit(s, LANCER).poseT).toBeCloseTo(0.2, 9);
    expect(unit(s, TROOPER).pose).toBe('idle');
    expect(s.numbers).toEqual([]); // the damage number waits for the tracer to land
  });

  it('lands the impact when the tracer ends: hit effect, the target in its hit pose, the damage number, and the new hit points', () => {
    const p = 0.4;
    const s = stateAt(plan, [ATTACK], at(p));
    expect(kinds(s)).toEqual(['hit']);
    const hit = s.fx[0];
    expect(hit.at).toEqual(pt(3));
    expect(hit.progress).toBeCloseTo((p - 0.18) / (1 - 0.18), 9);
    expect(hit.color).toBe(FACTION_ACCENT.helion);
    expect(unit(s, TROOPER).pose).toBe('hit');
    expect(unit(s, TROOPER).poseT).toBeCloseTo((p - 0.18) / 0.82, 9);
    expect(unit(s, LANCER).pose).toBe('fire'); // recoil runs a little longer than the flash
    expect(s.numbers.map((n) => [n.text, n.tone])).toEqual([['-42%', 'damage']]);
    expect(unit(s, TROOPER).hp).toBe(58); // the plan's own hit-point beat
    expect(unit(s, TROOPER).look.hp).toBe(6);
  });

  it('then the counter: the trooper fires back at the lancer, the same way round', () => {
    const s = stateAt(plan, [ATTACK], at(0.1, 1));
    expect(kinds(s)).toEqual(['muzzle', 'tracer']);
    const tracer = s.fx.find((f) => f.kind === 'tracer')!;
    expect(tracer.fromUnit).toBe(TROOPER);
    expect(tracer.to).toEqual(pt(2));
    expect(tracer.color).toBe(FACTION_ACCENT.tidewell);
    expect(unit(s, TROOPER).pose).toBe('fire');
    expect(unit(s, LANCER).pose).toBe('idle');
  });

  it('shows no shot and no impact between steps (after the plan)', () => {
    const s = mapStage({ frame: frame0, prev: frame0, plan, sample: null, t: 0, info: analyseStep(frame0, frame0, [ATTACK], plan), step: 1 });
    expect(s.fx).toEqual([]);
    expect(s.numbers).toEqual([]);
    expect(s.units.every((u) => u.pose === 'idle')).toBe(true);
    expect(unit(s, LANCER).hp).toBe(100); // the frame's own number: the test's frame0 was not advanced
  });

  it('turns the shooter to face its target while it fires, and leaves it facing there', () => {
    const s = stateAt(plan, [ATTACK], at(0.05));
    expect(unit(s, LANCER).heading).toBeCloseTo(0, 12); // the trooper is east of the lancer
    expect(unit(s, TROOPER).heading).toBeCloseTo(Math.PI, 12); // the defender turns to face the one that will answer
    const rest = analyseStep(frame0, frame0, [ATTACK], plan).rest;
    expect(rest.get(LANCER)).toBeCloseTo(0, 12);
    expect(rest.get(TROOPER)).toBeCloseTo(Math.PI, 12); // the counter faces west
  });

  it('a shot at a target north of the shooter faces north (a 3D unit turns to every side)', () => {
    const f = fieldFrame([{ type: 'lancer', owner: 0, x: 4, y: 2 }, { type: 'trooper', owner: 1, x: 4, y: 0 }]);
    const e: GameEvent = { kind: 'attacked', attackerId: idOf(f, 'lancer'), defenderId: idOf(f, 'trooper'), damage: 30, counter: 0, attackerHp: 100, defenderHp: 70 };
    const p = planOf(f, f, [e]);
    const s = mapStage({ frame: f, prev: f, plan: p, sample: sampleTransition(p, 10), t: 10, info: analyseStep(f, f, [e], p), step: 1 });
    expect(s.units.find((u) => u.id === idOf(f, 'lancer'))!.heading).toBeCloseTo(-Math.PI / 2, 12);
  });
});

describe('an indirect attack, sampled', () => {
  const f = fieldFrame([{ type: 'arc', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 3, y: 1 }]);
  const ARC = idOf(f, 'arc');
  const TRP = idOf(f, 'trooper');
  const e: GameEvent = { kind: 'attacked', attackerId: ARC, defenderId: TRP, damage: 35, counter: 0, attackerHp: 100, defenderHp: 65 };
  const plan = planOf(f, f, [e]);
  const run = (p: number): StageState => stateAt(plan, [e], p * HIT_MS, f, f);

  it('arcs a shell where a direct shot would draw a tracer', () => {
    const s = run(0.1);
    expect(kinds(s)).toEqual(['muzzle', 'shell']);
    const shell = s.fx.find((x) => x.kind === 'shell')!;
    expect(shell.fromUnit).toBe(ARC);
    expect(shell.to).toEqual(pt(3));
    expect(shell.progress).toBeCloseTo(0.1 / SHOT.indirectFlightEnd, 9);
  });

  it('holds the impact and the damage number until the shell lands, later than a tracer would', () => {
    const p = (SHOT.directFlightEnd + SHOT.indirectFlightEnd) / 2; // a tracer would have landed by now
    const s = run(p);
    expect(kinds(s)).toEqual(['shell']);
    expect(s.numbers).toEqual([]);
    expect(unit(s, TRP).pose).toBe('idle');
    const after = run(0.75);
    expect(kinds(after)).toEqual(['hit']);
    expect(after.numbers.map((n) => n.text)).toEqual(['-35%']);
    expect(unit(after, TRP).pose).toBe('hit');
  });
});

describe('a hit from a shooter the viewer never saw', () => {
  const unseen: GameEvent = { kind: 'attacked', attackerId: UNSEEN_UNIT, defenderId: TROOPER, damage: 42, counter: 0, attackerHp: UNSEEN_UNIT, defenderHp: 58 };
  const plan = planOf(frame0, frame0, [unseen]);

  it('flashes only the unit that was hit: no muzzle, no tracer, and the impact is the plan\'s own sample, untouched', () => {
    const s = stateAt(plan, [unseen], 20);
    expect(kinds(s)).toEqual(['hit']);
    expect(s.fx[0].progress).toBeCloseTo(sampleTransition(plan, 20).fx[0].progress, 12);
    expect(s.fx[0].color).toBeUndefined();
    expect(s.units.every((u) => u.pose === 'idle')).toBe(true);
  });
});

describe('walking', () => {
  const start: ViewFrame = fieldFrame([{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 8, y: 2 }]);
  const L = idOf(start, 'lancer');
  const path: Coord[] = [pt(0, 0), pt(1, 0), pt(1, 1), pt(1, 2)];
  const end: ViewFrame = { ...start, units: start.units.map((u) => (u.id === L ? { ...u, x: 1, y: 2 } : u)) };
  const events: GameEvent[] = [{ kind: 'moved', unitId: L, path }];
  const plan = planOf(start, end, events);
  const dur = plan.moves[0].durMs;

  it('places the unit along its path, as the plan\'s own sample does (fractional tile coordinates)', () => {
    const s = stateAt(plan, events, dur / 2, end, start);
    const u = unit(s, L);
    expect([u.x, u.y]).toEqual([1, 0.5]); // half way (eased half is half) along three tiles: a third into the middle one
    expect(u.pose).toBe('move');
    expect(u.poseT).toBeCloseTo(0.5, 12);
  });

  it('heads along the segment it is on: east, then south, then south again, and keeps that heading when it stops', () => {
    const at = (t: number) => unit(stateAt(plan, events, t, end, start), L).heading;
    expect(at(1)).toBeCloseTo(0, 12); // the first segment runs east
    expect(at(dur / 2)).toBeCloseTo(Math.PI / 2, 12); // the second runs south (+Z)
    expect(at(dur - 1)).toBeCloseTo(Math.PI / 2, 12);
    const rest = mapStage({ frame: end, prev: start, plan, sample: null, t: 0, info: analyseStep(start, end, events, plan), step: 1 });
    expect(unit(rest, L).heading).toBeCloseTo(Math.PI / 2, 12);
    expect(unit(rest, L).pose).toBe('idle');
    expect([unit(rest, L).x, unit(rest, L).y]).toEqual([1, 2]);
  });

  it('is reported by moveState as waiting before its glide begins, already turned toward the path', () => {
    const later = planOf(start, end, [{ kind: 'turnStarted', player: 0, cycle: 2, income: 0 }, ...events]);
    const begins = later.moves[0].startMs;
    expect(begins).toBeGreaterThan(0);
    const waiting = moveState(later, L, begins / 2)!;
    expect(waiting.moving).toBe(false);
    expect(waiting.heading).toBeCloseTo(0, 12);
    expect(moveState(later, L, begins + 10)!.moving).toBe(true);
    expect(moveState(later, L, later.durationMs + 100)).toBeUndefined();
  });

  it('a step with no glide (4x speed) still leaves the unit facing the way it went', () => {
    const fast = planOf(start, end, events, 4);
    expect(fast.moves).toEqual([]);
    const info = analyseStep(start, end, events, fast);
    expect(info.rest.get(L)).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('units that leave and arrive', () => {
  it('draws a destroyed unit as a fading ghost under its explosion, then not at all', () => {
    const dead: GameEvent = { kind: 'destroyed', unitId: TROOPER, at: pt(3), type: 'trooper', owner: 1 };
    const next: ViewFrame = { ...frame0, units: frame0.units.filter((u) => u.id !== TROOPER) };
    const events = [ATTACK, dead];
    const plan = planOf(frame0, next, events);
    const boom = plan.fx.find((f) => f.kind === 'explosion')!;
    const mid = boom.startMs + boom.durMs / 2;
    const s = stateAt(plan, events, mid, next, frame0);
    const ghost = unit(s, TROOPER);
    expect(ghost.ghost).toBe(true);
    expect(ghost.fade).toBeCloseTo(0.5, 6);
    expect(ghost.look.hp).toBeGreaterThanOrEqual(1); // never shows 0
    expect(kinds(s)).toContain('explosion');
    const after = stateAt(plan, events, boom.startMs + boom.durMs + 1, next, frame0);
    expect(after.units.some((u) => u.id === TROOPER)).toBe(false);
    // the lancer is a solid unit throughout
    expect(unit(s, LANCER).ghost).toBe(false);
  });

  it('does not draw a unit that is built later in the step until the build beat', () => {
    const built = { ...frame0.units[0], id: 99, x: 5, y: 1, type: 'trooper' as const, owner: 0 };
    const next: ViewFrame = { ...frame0, units: [...frame0.units, built] };
    const events: GameEvent[] = [{ kind: 'built', unitId: 99, type: 'trooper', at: pt(5), owner: 0, cost: 1000 }];
    const plan = planOf(frame0, next, events);
    expect(plan.appear[0].atMs).toBe(0);
    const spawn = plan.fx.find((f) => f.kind === 'spawn')!;
    expect(spawn.at).toEqual(pt(5));
    const s = stateAt(plan, events, 100, next, frame0);
    expect(s.units.some((u) => u.id === 99)).toBe(true);
    const later = planOf(frame0, next, [{ kind: 'turnStarted', player: 0, cycle: 2, income: 0 }, ...events]);
    const early = stateAt(later, events, later.banner!.durMs - 10, next, frame0);
    expect(early.units.some((u) => u.id === 99)).toBe(false); // hidden until its beat
  });
});

describe('effects the plan already has', () => {
  it('maps each kind with its own progress and a stable seed per beat', () => {
    const events: GameEvent[] = [
      { kind: 'captured', at: pt(5), terrain: 'arcology', by: 0, from: null },
      { kind: 'ambushed', unitId: LANCER, at: pt(2), by: TROOPER },
    ];
    const plan = planOf(frame0, frame0, events);
    const pulse = plan.fx.find((f) => f.kind === 'pulse')!;
    const t = pulse.startMs + pulse.durMs / 4;
    const a = stateAt(plan, events, t);
    const b = stateAt(plan, events, t);
    const fx = a.fx.find((f) => f.kind === 'pulse')!;
    expect(fx.at).toEqual(pt(5));
    expect(fx.progress).toBeCloseTo(0.25, 9);
    expect(fx.seed).toBe(b.fx.find((f) => f.kind === 'pulse')!.seed); // the same beat scatters the same way every frame
    expect(fx.seed).toBeGreaterThan(0);
    const later = stateAt(plan, events, t + 40);
    expect(later.fx.find((f) => f.kind === 'pulse')!.seed).toBe(fx.seed);
  });

  it('shakes the camera for an explosion and an ambush, and only while they run (the full shake is under SHAKE_MS)', () => {
    const events: GameEvent[] = [{ kind: 'ambushed', unitId: LANCER, at: pt(2), by: TROOPER }];
    const plan = planOf(frame0, frame0, events);
    expect(stateAt(plan, events, 50).shake).not.toBeNull();
    expect(stateAt(plan, events, 50).shake!.weight).toBe(0.5);
    expect(stateAt(plan, events, plan.durationMs - 1).shake).toBeNull();
    const quiet = planOf(frame0, frame0, [ATTACK]);
    expect(stateAt(quiet, [ATTACK], 100).shake).toBeNull(); // a hit gives none
  });

  it('keeps the hit points the plan gives: a heal raises them, the plan decides when', () => {
    const events: GameEvent[] = [{ kind: 'repaired', unitId: LANCER, amount: 20, cost: 500 }];
    const hurt: ViewFrame = { ...frame0, units: frame0.units.map((u) => (u.id === LANCER ? { ...u, hp: 60 } : u)) };
    const healed: ViewFrame = { ...frame0, units: frame0.units.map((u) => (u.id === LANCER ? { ...u, hp: 80 } : u)) };
    const plan = planOf(hurt, healed, events);
    const s = stateAt(plan, events, 100, healed, hurt);
    expect(unit(s, LANCER).hp).toBe(80);
    expect(s.numbers.map((n) => [n.text, n.tone])).toEqual([['+2', 'heal']]);
  });
});

describe('where effects are placed (the effects kit\'s convention)', () => {
  // a tilted ground, so a wrong tile or a missing surface height shows
  const env: WorldEnv = { surface: (x, y) => 0.2 * x + 0.1 * y, muzzleOf: (id, out) => (id === LANCER ? out.set(2.7, 5.5, 1.5) : null) };
  const surface = (c: Coord): number => env.surface(c.x, c.y);

  it('draws the ground-bound kinds (explosion, pulse, ambush, spawn) at the tile surface plus 0.1', () => {
    const events: GameEvent[] = [
      { kind: 'captured', at: pt(5, 2), terrain: 'arcology', by: 0, from: null },
      { kind: 'ambushed', unitId: LANCER, at: pt(2, 1), by: TROOPER },
      { kind: 'destroyed', unitId: TROOPER, at: pt(3, 1), type: 'trooper', owner: 1 },
      { kind: 'built', unitId: 99, type: 'trooper', at: pt(7, 0), owner: 0, cost: 1000 },
    ];
    const built = { ...frame0.units[0], id: 99, x: 7, y: 0, type: 'trooper' as const, owner: 0 };
    const next: ViewFrame = { ...frame0, units: [...frame0.units.filter((u) => u.id !== TROOPER), built] };
    const plan = planOf(frame0, next, events);
    const info = analyseStep(frame0, next, events, plan);
    const seen = new Map<string, Coord>();
    for (let t = 0; t < plan.durationMs; t += 20) {
      const s = mapStage({ frame: next, prev: frame0, plan, sample: sampleTransition(plan, t), t, info, step: 1 });
      for (const item of toFxItems(s.fx, env)) {
        const spec = s.fx.find((f) => f.kind === item.kind)!;
        if (item.kind === 'explosion' || item.kind === 'pulse' || item.kind === 'ambush' || item.kind === 'spawn') {
          expect(item.at.y, item.kind).toBeCloseTo(surface(spec.at) + 0.1, 12);
          expect(item.at.x).toBeCloseTo(spec.at.x + 0.5, 12);
          expect(item.at.z).toBeCloseTo(spec.at.y + 0.5, 12);
          seen.set(item.kind, spec.at);
        }
      }
    }
    expect([...seen.keys()].sort()).toEqual(['ambush', 'explosion', 'pulse', 'spawn']); // all four kinds were actually checked
    expect(GROUND_FX_LIFT).toBe(0.1);
  });

  it('draws a hit at the target\'s centre and starts a tracer at the muzzle exactly, ending at the target\'s centre', () => {
    const plan = planOf(frame0, frame0, [ATTACK]);
    const info = analyseStep(frame0, frame0, [ATTACK], plan);
    const early = mapStage({ frame: frame0, prev: frame0, plan, sample: sampleTransition(plan, 20), t: 20, info, step: 1 });
    const tracer = toFxItems(early.fx, env).find((i) => i.kind === 'tracer')!;
    expect(tracer.at.toArray()).toEqual([2.7, 5.5, 1.5]); // the muzzle point, untouched
    expect(tracer.to!.x).toBeCloseTo(3.5, 12);
    expect(tracer.to!.z).toBeCloseTo(1.5, 12);
    expect(tracer.to!.y).toBeCloseTo(surface(pt(3, 1)) + HIT_LIFT, 12);
    const late = mapStage({ frame: frame0, prev: frame0, plan, sample: sampleTransition(plan, 200), t: 200, info, step: 1 });
    const hit = toFxItems(late.fx, env).find((i) => i.kind === 'hit')!;
    expect(hit.at.y).toBeCloseTo(surface(pt(3, 1)) + HIT_LIFT, 12);
    expect(hit.at.x).toBeCloseTo(3.5, 12);
    expect(hit.to).toBeUndefined();
  });
});

describe('from tiles to the world', () => {
  const env: WorldEnv = {
    surface: (x, y) => 0.1 * x + 0.05 * y, // a tilted plane, so a wrong tile or a swapped axis shows
    muzzleOf: (id, out) => (id === 7 ? out.set(9, 8, 7) : null),
  };

  it('puts a tile\'s effect at the centre of the tile, on the surface, plus its lift (+X east, +Z south, +Y up)', () => {
    const spec: FxSpec = { kind: 'explosion', at: pt(3, 2), lift: 0.3, progress: 0.5, seed: 4 };
    const [item] = toFxItems([spec], env);
    expect(item.at.x).toBe(3.5);
    expect(item.at.y).toBeCloseTo(0.3 + 0.1 * 3 + 0.05 * 2, 12);
    expect(item.at.z).toBe(2.5);
    expect(item).toMatchObject({ kind: 'explosion', progress: 0.5, seed: 4 });
    expect(item.to).toBeUndefined();
    expect(item.color).toBeUndefined();
  });

  it('starts a shot at the shooter\'s muzzle when its view can say where that is, else at the shooter\'s tile', () => {
    const shot: FxSpec = { kind: 'tracer', at: pt(1, 1), lift: 0.3, to: pt(4, 1), toLift: 0.3, fromUnit: 7, progress: 0.5, seed: 1, color: 0xff0000 };
    const [withMuzzle] = toFxItems([shot], env);
    expect(withMuzzle.at.toArray()).toEqual([9, 8, 7]);
    expect(withMuzzle.to!.x).toBe(4.5);
    expect(withMuzzle.to!.y).toBeCloseTo(0.3 + 0.4 + 0.05, 12);
    expect(withMuzzle.to!.z).toBe(1.5);
    expect(withMuzzle.color).toBe(0xff0000);
    const [without] = toFxItems([{ ...shot, fromUnit: 8 }], env);
    expect(without.at.x).toBe(1.5);
    expect(without.at.y).toBeCloseTo(0.3 + 0.1 + 0.05, 12);
    expect(without.at.z).toBe(1.5);
  });

  it('floats a damage number above the unit', () => {
    const [n] = toNumberItems([{ at: pt(2, 0), text: '-42%', tone: 'damage', progress: 0.3 }], env);
    expect(n.text).toBe('-42%');
    expect(n.at.x).toBeCloseTo(2.5, 12);
    expect(n.at.z).toBeCloseTo(0.5, 12);
    expect(n.at.y).toBeGreaterThan(0.2 + 0.5);
    expect(n.at).toBeInstanceOf(Vector3);
  });

  it('blends the surface height between tile centres, and clamps at the map edge', () => {
    const plane = (x: number, y: number): number => 0.4 * x + 0.1 * y;
    expect(surfaceY(plane, 2, 1, 6, 4)).toBeCloseTo(0.9, 12);
    expect(surfaceY(plane, 2.5, 1.5, 6, 4)).toBeCloseTo(0.4 * 2.5 + 0.1 * 1.5, 12);
    expect(surfaceY(plane, -3, -3, 6, 4)).toBe(0);
    expect(surfaceY(plane, 99, 99, 6, 4)).toBeCloseTo(0.4 * 5 + 0.1 * 3, 12);
  });
});

describe('small helpers', () => {
  it('headings: east 0, south +90, west 180, north -90, and no heading for no movement', () => {
    expect(headingOf(pt(1, 1), pt(2, 1))).toBe(0);
    expect(headingOf(pt(1, 1), pt(1, 2))).toBeCloseTo(Math.PI / 2, 12);
    expect(Math.abs(headingOf(pt(1, 1), pt(0, 1))!)).toBeCloseTo(Math.PI, 12);
    expect(headingOf(pt(1, 1), pt(1, 0))).toBeCloseTo(-Math.PI / 2, 12);
    expect(headingOf(pt(1, 1), pt(1, 1))).toBeUndefined();
    expect(facingHeading('right')).toBe(0);
    expect(facingHeading('left')).toBe(Math.PI);
  });

  it('seeds are stable, positive and differ between beats', () => {
    expect(hashSeed(3, 'hit', 4, 1, 0)).toBe(hashSeed(3, 'hit', 4, 1, 0));
    expect(hashSeed(3, 'hit', 4, 1, 0)).toBeGreaterThan(0);
    const seeds = new Set<number>();
    for (let step = 0; step < 20; step++) for (let x = 0; x < 10; x++) seeds.add(hashSeed(step, 'hit', x, 1, 0));
    expect(seeds.size).toBe(200);
  });

  it('capture progress runs 0 (untouched) to 1 (taken)', () => {
    expect(captureProgress(undefined)).toBe(0);
    expect(captureProgress(20)).toBe(0);
    expect(captureProgress(10)).toBe(0.5);
    expect(captureProgress(0)).toBe(1);
    expect(captureProgress(99)).toBe(0);
  });

  it('a map is the same map across steps and viewers, and a different one when a tile differs (the terrain rebuilds only then)', () => {
    const a = mapSignature(frame0);
    expect(mapSignature({ ...frame0, units: [] })).toBe(a);
    const tiles = frame0.tiles.map((row, y) => row.map((t, x) => (x === 4 && y === 1 ? { ...t, terrain: 'ridge' as const } : t)));
    expect(mapSignature({ ...frame0, tiles })).not.toBe(a);
    expect(mapSignature({ ...frame0, mapId: 'elsewhere' })).not.toBe(a);
  });
});

// ---------------------------------------------------------------- G10: trails, shake, attack camera, power sweep

/** A frame on the given terrain rows (codes as in the maps: '.' flats, '~' sea, 'r' river, 's' shoal), no fog. */
function frameOn(rows: string[], units: FixtureUnit[]): ViewFrame {
  const setup = { ...fieldSetup(units, { fog: false }), map: fixtureMap(rows, units, undefined, 'g10-fixture') };
  return viewTimeline(recordMatch(setup, []), 'all').steps[0].frame;
}
const LAND = ['..........', '..........', '..........'];
const SEA = ['~~~~~~~~~~', '~~~~~~~~~~', '~~~~~~~~~~'];

/** A unit of `type` walking east along row 1 from x = 1 to x = 8 (seven tiles, 980 ms at 1x), sampled at plan time `t`. */
function glide(frame: ViewFrame, id: number, t: number, speed: 1 | 2 | 4 = 1, from = 1, to = 8): { state: StageState; plan: TransitionPlan } {
  const path: Coord[] = [];
  for (let x = from; x <= to; x++) path.push(pt(x));
  const end: ViewFrame = { ...frame, units: frame.units.map((u) => (u.id === id ? { ...u, x: to, y: 1 } : u)) };
  const events: GameEvent[] = [{ kind: 'moved', unitId: id, path }];
  const plan = planOf(frame, end, events, speed);
  return { state: stateAt(plan, events, t, end, frame), plan };
}
const trailsOf = (s: StageState): FxSpec[] => s.fx.filter((f) => f.kind === 'dust' || f.kind === 'wake' || f.kind === 'contrail');
const reachOf = (f: FxSpec): number => Math.hypot(f.at.x - f.to!.x, f.at.y - f.to!.y);

describe('what a mover leaves behind is decided by how it moves and what it moves over', () => {
  it('ground units kick dust, ships and barges make a wake, aircraft leave contrails, and a hover craft makes dust over land and a wake over water', () => {
    const land: TerrainId[] = ['flats', 'canopy', 'ridge', 'shoal', 'maglev', 'span', 'glass', 'arcology', 'dock'];
    for (const t of land) {
      for (const m of ['foot', 'exo', 'tread', 'walker', 'hover'] as const) expect(trailKindFor(m, t), `${m} over ${t}`).toBe('dust');
      expect(trailKindFor('air', t), `air over ${t}`).toBe('contrail');
    }
    for (const t of ['sea', 'river'] as const) {
      expect(trailKindFor('hover', t)).toBe('wake');
      expect(trailKindFor('air', t)).toBe('contrail'); // aircraft are aircraft whatever is under them
      for (const m of ['foot', 'exo', 'tread', 'walker'] as const) expect(trailKindFor(m, t), `${m} over ${t}`).toBe('dust');
    }
    for (const t of ['sea', 'river', 'flats', 'dock', 'shoal'] as const) {
      expect(trailKindFor('sea', t)).toBe('wake');
      expect(trailKindFor('barge', t)).toBe('wake');
    }
  });

  it('KNOWN-BAD: a wrong mapping is caught (a tread with a wake, a ship with dust, a wasp with dust, a hover craft over water with dust)', () => {
    const wrong: [Parameters<typeof trailKindFor>[0], TerrainId, TrailKind][] = [['tread', 'flats', 'wake'], ['sea', 'sea', 'dust'], ['air', 'flats', 'dust'], ['hover', 'sea', 'dust'], ['hover', 'flats', 'wake'], ['foot', 'flats', 'contrail']];
    for (const [m, t, k] of wrong) expect(trailKindFor(m, t), `${m} over ${t}`).not.toBe(k);
  });

  // The roster, written out here from what each unit is (its data row's move type), one kind per unit type.
  const ROSTER: Record<UnitTypeId, TrailKind> = {
    trooper: 'dust', breacher: 'dust', skimmer: 'dust', lancer: 'dust', bastion: 'dust', colossus: 'dust', mule: 'dust', arc: 'dust', salvo: 'dust', warden: 'dust',
    wasp: 'contrail', raptor: 'contrail', anvil: 'contrail', picket: 'wake', dreadnought: 'wake', barge: 'wake',
  };
  const AT_SEA = new Set<UnitTypeId>(['picket', 'dreadnought', 'barge']);

  it('every one of the 16 unit types draws its own kind of trail through the stage, mid-glide', () => {
    for (const [type, kind] of Object.entries(ROSTER) as [UnitTypeId, TrailKind][]) {
      const foe: UnitTypeId = AT_SEA.has(type) ? (type === 'picket' ? 'barge' : 'picket') : type === 'trooper' ? 'breacher' : 'trooper';
      const frame = frameOn(AT_SEA.has(type) ? SEA : LAND, [{ type, owner: 0, x: 1, y: 1 }, { type: foe, owner: 1, x: 9, y: 0 }]);
      const id = idOf(frame, type, 0);
      const { state } = glide(frame, id, 490);
      const t = trailsOf(state);
      expect(t.map((f) => f.kind), type).toEqual([kind]);
    }
  });

  it('a hover craft over water (a river: the game lets hover craft cross rivers, never open sea) makes a wake, over land dust: the terrain decides', () => {
    const units: FixtureUnit[] = [{ type: 'lancer', owner: 0, x: 1, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 0 }];
    const onRiver = frameOn(['rrrrrrrrrr', 'rrrrrrrrrr', 'rrrrrrrrrr'], units);
    const onLand = frameOn(LAND, units);
    expect(trailsOf(glide(onRiver, idOf(onRiver, 'lancer'), 490).state).map((f) => f.kind)).toEqual(['wake']);
    expect(trailsOf(glide(onLand, idOf(onLand, 'lancer'), 490).state).map((f) => f.kind)).toEqual(['dust']);
    // half and half: a lancer that crosses from land to the river changes kind where the terrain does
    const bank = frameOn(['.....rrrrr', '.....rrrrr', '.....rrrrr'], units);
    expect(trailsOf(glide(bank, idOf(bank, 'lancer'), 100).state).map((f) => f.kind)).toEqual(['dust']); // still over land
    expect(trailsOf(glide(bank, idOf(bank, 'lancer'), 900).state).map((f) => f.kind)).toEqual(['wake']); // now over the water
  });
});

describe('the trail a gliding unit leaves', () => {
  const frame = frameOn(LAND, [{ type: 'bastion', owner: 0, x: 1, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 0 }]);
  const id = idOf(frame, 'bastion', 0);

  it('is where the unit is now and a point behind it on its own path, as far back as it has gone, up to its reach', () => {
    // 7 tiles in 1680 ms (240 ms a tile), eased: at 840 ms the unit has gone half the way (3.5 tiles), so it is at x = 4.5
    const f = trailsOf(glide(frame, id, 840).state)[0];
    expect(f.kind).toBe('dust');
    expect(f.at.x).toBeCloseTo(4.5, 12);
    expect(f.at.y).toBe(1);
    expect(reachOf(f)).toBeCloseTo(TRAIL_REACH.tread, 12); // it has gone 3.5, more than a tread's 1.5, so the full reach
    expect(f.to!.x).toBeCloseTo(4.5 - 1.5, 12); // straight back along row 1
    expect(f.to!.y).toBe(1);
    expect(f.progress).toBeCloseTo(0.5, 12); // half way through the glide's time
    // early on it has barely left its tile: the trail is only as long as the path it has made. At 168 ms (a tenth of the time) the eased
    // progress is 0.028 of 7 tiles = 0.196 tile
    const early = trailsOf(glide(frame, id, 168).state)[0];
    expect(reachOf(early)).toBeCloseTo(0.1 * 0.1 * (3 - 2 * 0.1) * 7, 12);
    expect(early.to!.x).toBeCloseTo(1, 12); // it reaches back exactly to where the unit started
  });

  it('is the same reach for every move type as the table says, and an aircraft\'s is the longest', () => {
    expect(TRAIL_REACH).toEqual({ tread: 1.5, walker: 1.4, exo: 1.2, foot: 1.0, hover: 0.9, sea: 2.2, barge: 1.8, air: 4.5 });
    for (const m of ['foot', 'exo', 'tread', 'walker', 'hover', 'sea', 'barge'] as const) expect(TRAIL_REACH.air).toBeGreaterThan(TRAIL_REACH[m]);
    // a hover craft's trail is short whatever it glides over: over a river it is under what a ship's V needs (about 1.1), so the kit draws
    // ripples, and over land the dust is fainter than a tread's
    expect(TRAIL_REACH.hover).toBeLessThan(1.1);
    expect(TRAIL_REACH.sea).toBeGreaterThan(1.8);
    expect(TRAIL_REACH.hover).toBeLessThan(TRAIL_REACH.tread);
    const foot = frameOn(LAND, [{ type: 'trooper', owner: 0, x: 1, y: 1 }, { type: 'breacher', owner: 1, x: 9, y: 0 }]);
    expect(reachOf(trailsOf(glide(foot, idOf(foot, 'trooper', 0), 1200).state)[0])).toBeCloseTo(1.0, 12);
    const river = frameOn(['rrrrrrrrrr', 'rrrrrrrrrr', 'rrrrrrrrrr'], [{ type: 'lancer', owner: 0, x: 1, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 0 }]);
    expect(reachOf(trailsOf(glide(river, idOf(river, 'lancer'), 1200).state)[0])).toBeCloseTo(0.9, 12);
    const air = frameOn(LAND, [{ type: 'wasp', owner: 0, x: 1, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 0 }]);
    expect(reachOf(trailsOf(glide(air, idOf(air, 'wasp'), 1200).state)[0])).toBeCloseTo(4.5, 12);
  });

  it('exists only while the unit glides: not before its glide, not after, and not at all when glides are off (4x, reduced motion)', () => {
    const { plan } = glide(frame, id, 0);
    const later = planOf(frame, frame, [{ kind: 'turnStarted', player: 0, cycle: 2, income: 0 }, { kind: 'moved', unitId: id, path: [pt(1), pt(2), pt(3)] }]);
    const begins = later.moves[0].startMs;
    expect(begins).toBeGreaterThan(0);
    const wait = mapStage({ frame, prev: frame, plan: later, sample: sampleTransition(later, begins / 2), t: begins / 2, info: analyseStep(frame, frame, [], later), step: 1 });
    expect(trailsOf(wait)).toEqual([]); // waiting at the start of its path
    expect(trailsOf(glide(frame, id, plan.durationMs + 10).state)).toEqual([]); // glide over
    expect(trailsOf(glide(frame, id, 1).state)).toEqual([]); // not yet a hair away from its tile
    for (const speed of [4] as const) {
      const fast = glide(frame, id, 5, speed);
      expect(fast.plan.moves).toEqual([]);
      expect(trailsOf(fast.state)).toEqual([]);
    }
  });

  it('is a stable seed per unit and step, different for another unit, and positive', () => {
    const a = trailsOf(glide(frame, id, 300).state)[0];
    const b = trailsOf(glide(frame, id, 600).state)[0];
    expect(a.seed).toBe(b.seed);
    expect(a.seed).toBe(hashSeed(1, 'trail', id));
    expect(a.seed).toBeGreaterThan(0);
    const other = frameOn(LAND, [{ type: 'bastion', owner: 0, x: 1, y: 1 }, { type: 'arc', owner: 0, x: 2, y: 2 }, { type: 'trooper', owner: 1, x: 9, y: 0 }]);
    const arc = idOf(other, 'arc', 0);
    expect(trailsOf(glide(other, arc, 300, 1, 2, 7).state)[0].seed).not.toBe(a.seed);
  });

  it('is never drawn for a unit the viewer cannot see: no unit, no trail', () => {
    const events: GameEvent[] = [{ kind: 'moved', unitId: id, path: [pt(1), pt(2), pt(3), pt(4)] }];
    const end: ViewFrame = { ...frame, units: frame.units.map((u) => (u.id === id ? { ...u, x: 4 } : u)) };
    const plan = planOf(frame, end, events);
    // the viewer's frames hold no such unit (it was never in sight): the plan is the same, the picture has no trail
    const hidden = { ...frame, units: frame.units.filter((u) => u.id !== id) };
    const t = plan.moves[0].durMs / 2;
    const s = mapStage({ frame: hidden, prev: hidden, plan, sample: sampleTransition(plan, t), t, info: analyseStep(hidden, hidden, events, plan), step: 1 });
    expect(s.units.some((u) => u.id === id)).toBe(false);
    expect(trailsOf(s)).toEqual([]);
  });

  it('puts the effect where the kit expects it: dust at the feet in the terrain\'s tint, a wake on the water, a contrail at flying height', () => {
    const dust = trailsOf(glide(frame, id, 840).state)[0];
    expect(dust.lift).toBe(DUST_LIFT);
    expect(dust.color).toBe(dustTint('flats'));
    expect(dust.level).toBeUndefined();
    const sea = frameOn(SEA, [{ type: 'picket', owner: 0, x: 1, y: 1 }, { type: 'picket', owner: 1, x: 9, y: 0 }]);
    const wake = trailsOf(glide(sea, idOf(sea, 'picket', 0), 840).state)[0];
    expect(wake.level).toBe(WAKE_LEVEL);
    expect(WAKE_LEVEL).toBeCloseTo(-0.08 + 0.012, 12); // a hair over the water surface at -0.08, whatever the sea bed is
    expect(wake.color).toBeUndefined();
    const air = frameOn(LAND, [{ type: 'wasp', owner: 0, x: 1, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 0 }]);
    const con = trailsOf(glide(air, idOf(air, 'wasp'), 840).state)[0];
    expect(con.lift).toBe(CONTRAIL_LIFT);
    expect(con.color).toBeUndefined();
    // in the world: dust over the tilted ground, the wake at the water level whatever the ground is, the contrail up where aircraft fly
    const env: WorldEnv = { surface: (x, y) => 0.2 * x + 0.1 * y, muzzleOf: () => null };
    const [d] = toFxItems([dust], env);
    expect(d.at.y).toBeCloseTo(env.surface(4.5, 1) + DUST_LIFT, 12);
    expect(d.to!.y).toBeCloseTo(env.surface(3, 1) + DUST_LIFT, 12);
    expect(d.at.x).toBeCloseTo(5, 12); // tile 4.5 is centred at 5.0 in the world
    expect(d.at.z).toBeCloseTo(1.5, 12);
    expect(d.color).toBe(dustTint('flats'));
    const [w] = toFxItems([wake], env);
    expect(w.at.y).toBe(WAKE_LEVEL);
    expect(w.to!.y).toBe(WAKE_LEVEL);
    const [c] = toFxItems([con], env);
    expect(c.at.y).toBeCloseTo(env.surface(4.5, 1) + CONTRAIL_LIFT, 12);
  });

  it('the dust tint is the terrain\'s own colour dried with sand: pale, warm, and different over different ground', () => {
    const tints = (['flats', 'canopy', 'ridge', 'shoal', 'maglev', 'glass'] as const).map(dustTint);
    expect(new Set(tints).size).toBeGreaterThanOrEqual(4);
    for (const c of tints) {
      const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      expect(Math.min(r, g, b), 'a pale dust').toBeGreaterThan(110);
      expect(r + g, 'warm, never blue').toBeGreaterThan(b * 2);
    }
    // 70% of the way from the flats' grass (0x86a86c) to dry sand (0xe6d8ae)
    expect(dustTint('flats')).toBe(((Math.round(0x86 + (0xe6 - 0x86) * 0.7)) << 16) | ((Math.round(0xa8 + (0xd8 - 0xa8) * 0.7)) << 8) | Math.round(0x6c + (0xae - 0x6c) * 0.7));
  });

  it('trailOf is pure: no beat time inside the glide, no trail', () => {
    const beat = { unitId: 1, path: [pt(0), pt(1), pt(2)], startMs: 100, durMs: 280 };
    const flats = (): TerrainId => 'flats';
    expect(trailOf(beat, 99, 'tread', flats)).toBeNull();
    expect(trailOf(beat, 380, 'tread', flats)).toBeNull();
    expect(trailOf(beat, 240, 'tread', flats)).not.toBeNull();
    expect(trailOf({ ...beat, path: [pt(0)] }, 240, 'tread', flats)).toBeNull();
  });
});

describe('the camera shake', () => {
  const DEAD: GameEvent = { kind: 'destroyed', unitId: TROOPER, at: pt(3), type: 'trooper', owner: 1 };
  const kill: GameEvent[] = [ATTACK, DEAD];
  const plan = planOf(frame0, without0(frame0, TROOPER), kill);
  const boom = plan.fx.find((f) => f.kind === 'explosion')!;
  function without0(f: ViewFrame, id: number): ViewFrame { return { ...f, units: f.units.filter((u) => u.id !== id) }; }

  it('starts with the explosion at full strength, decays, and is gone SHAKE_MS (a quarter second) later', () => {
    expect(SHAKE_MS).toBe(250);
    expect(boom.durMs).toBe(520);
    expect(shakeAt(plan, boom.startMs - 1, 1)).toBeNull();
    const first = shakeAt(plan, boom.startMs, 1)!;
    expect(first).toMatchObject({ u: 0, weight: 1 });
    expect(shakeAt(plan, boom.startMs + 125, 1)!.u).toBeCloseTo(0.5, 12);
    expect(shakeAt(plan, boom.startMs + 249, 1)).not.toBeNull();
    expect(shakeAt(plan, boom.startMs + 250, 1)).toBeNull();
    expect(shakeAt(plan, boom.startMs + 400, 1)).toBeNull(); // the explosion is still burning; the camera is still
  });
  it('a hit gives none: the attack itself shakes nothing, only the kill does', () => {
    const hitsOnly = planOf(frame0, frame0, [ATTACK]);
    for (let t = 0; t < hitsOnly.durationMs; t += 20) expect(shakeAt(hitsOnly, t, 1), `t=${t}`).toBeNull();
    const hit = plan.fx.find((f) => f.kind === 'hit')!;
    expect(shakeAt(plan, hit.startMs + 100, 1)).toBeNull();
  });
  it('is seeded by the beat: the same beat always shakes the same way, another beat or step differently', () => {
    const a = shakeAt(plan, boom.startMs + 50, 1)!;
    expect(shakeAt(plan, boom.startMs + 90, 1)!.seed).toBe(a.seed);
    expect(a.seed).toBe(hashSeed(1, 'shake', 'explosion', 3, 1));
    expect(shakeAt(plan, boom.startMs + 50, 2)!.seed).not.toBe(a.seed);
    const elsewhere = planOf(frame0, frame0, [{ kind: 'destroyed', unitId: TROOPER, at: pt(6, 2), type: 'trooper', owner: 1 }]);
    const b = shakeAt(elsewhere, elsewhere.fx[0].startMs + 50, 1)!;
    expect(b.seed).not.toBe(a.seed);
  });
  it('an ambush shakes at half strength, and the window shortens with the speed of the plan', () => {
    const amb = planOf(frame0, frame0, [{ kind: 'ambushed', unitId: LANCER, at: pt(2), by: TROOPER }]);
    expect(shakeAt(amb, 10, 1)).toMatchObject({ weight: 0.5 });
    const fast = planOf(frame0, without0(frame0, TROOPER), kill, 2);
    const fastBoom = fast.fx.find((f) => f.kind === 'explosion')!;
    expect(fastBoom.durMs).toBe(260);
    expect(shakeAt(fast, fastBoom.startMs + 120, 1)).not.toBeNull();
    expect(shakeAt(fast, fastBoom.startMs + 125, 1)).toBeNull(); // half of 250 ms at 2x
  });
  it('nothing without a running plan', () => {
    expect(shakeAt(null, 100, 1)).toBeNull();
    expect(shakeAt(plan, null, 1)).toBeNull();
  });
  it('mapStage carries it while the explosion\'s first quarter second runs, and not before or after', () => {
    const next = without0(frame0, TROOPER);
    const info = analyseStep(frame0, next, kill, plan);
    const at = (t: number): StageState => mapStage({ frame: next, prev: frame0, plan, sample: sampleTransition(plan, t), t, info, step: 1 });
    expect(at(boom.startMs - 5).shake).toBeNull();
    expect(at(boom.startMs + 30).shake).not.toBeNull();
    expect(at(boom.startMs + 300).shake).toBeNull();
    // after the plan there is no sample, so no shake
    expect(mapStage({ frame: next, prev: frame0, plan, sample: null, t: 0, info, step: 1 }).shake).toBeNull();
  });
});

describe('the attack camera, from the plan', () => {
  const walkAndShoot: GameEvent[] = [{ kind: 'moved', unitId: LANCER, path: [pt(0), pt(1), pt(2)] }, { ...ATTACK } as GameEvent];
  const base = { ...frame0, units: frame0.units.map((u) => (u.id === LANCER ? { ...u, x: 0 } : u)) };
  const plan = planOf(base, frame0, walkAndShoot);
  const hitAt = plan.fx.find((f) => f.kind === 'hit')!;
  const info = analyseStep(base, frame0, walkAndShoot, plan);

  it('eases in before the first strike, holds through it, and is gone as the attack ends', () => {
    // the glide is 480 ms (two tiles at 240), the strike 480..860, the counter 860..1240; the window is 280..1480
    expect(hitAt.startMs).toBe(480);
    expect(attackAt(plan, info, 280)).toBeNull(); // exactly 0 at the start of the window
    const mid = attackAt(plan, info, 700)!;
    expect(mid.strength).toBe(1);
    const early = attackAt(plan, info, 380)!;
    expect(early.strength).toBeGreaterThan(0);
    expect(early.strength).toBeLessThan(1);
    expect(attackAt(plan, info, plan.durationMs + 5)).toBeNull();
    // the strength is the easing of the window the strikes make
    const last = plan.fx.filter((f) => f.kind === 'hit').at(-1)!;
    expect(attackAt(plan, info, last.startMs + last.durMs + 240)).toBeNull();
    expect(attackAt(plan, info, last.startMs + last.durMs + 100)!.strength).toBeLessThan(1);
  });
  it('looks at the two units of the strike under way: the attacker\'s tile and the defender\'s, then the counter\'s the other way round', () => {
    const first = attackAt(plan, info, 600)!;
    expect(first.from).toEqual(pt(2));
    expect(first.to).toEqual(pt(3));
    const counter = attackAt(plan, info, 1000)!;
    expect(counter.from).toEqual(pt(3));
    expect(counter.to).toEqual(pt(2));
  });
  it('is off for a plan with no glides (4x speed, reduced motion): nothing to ease with', () => {
    const fast = planOf(base, frame0, walkAndShoot, 4);
    expect(fast.tween).toBe(false);
    const fastInfo = analyseStep(base, frame0, walkAndShoot, fast);
    expect(fastInfo.shots.length).toBeGreaterThan(0);
    for (let t = 0; t < fast.durationMs; t += 5) expect(attackAt(fast, fastInfo, t), `t=${t}`).toBeNull();
    const calm = planTransition(base, frame0, walkAndShoot, { speed: 1, reducedMotion: true });
    expect(calm.tween).toBe(false);
    for (let t = 0; t < calm.durationMs; t += 20) expect(attackAt(calm, analyseStep(base, frame0, walkAndShoot, calm), t), `t=${t}`).toBeNull();
  });
  it('is off when the attacker was never seen (a strike with no shot has no pair of units to look between), and with no plan or no clock', () => {
    const unseen: GameEvent = { kind: 'attacked', attackerId: UNSEEN_UNIT, defenderId: TROOPER, damage: 42, counter: 0, attackerHp: UNSEEN_UNIT, defenderHp: 58 };
    const p = planOf(frame0, frame0, [unseen]);
    const i = analyseStep(frame0, frame0, [unseen], p);
    expect(i.shots).toEqual([]);
    for (let t = 0; t < p.durationMs; t += 20) expect(attackAt(p, i, t)).toBeNull();
    expect(attackAt(null, info, 500)).toBeNull();
    expect(attackAt(plan, info, null)).toBeNull();
  });
  it('is off in a step with no strike at all', () => {
    const p = planOf(frame0, frame0, [{ kind: 'captured', at: pt(5, 2), terrain: 'arcology', by: 0, from: null }]);
    for (let t = 0; t < p.durationMs; t += 20) expect(attackAt(p, analyseStep(frame0, frame0, [], p), t)).toBeNull();
  });
  it('mapStage carries it', () => {
    const s = mapStage({ frame: frame0, prev: base, plan, sample: sampleTransition(plan, 700), t: 700, info, step: 1 });
    expect(s.attack).toMatchObject({ strength: 1, from: pt(2), to: pt(3) });
    const rest = mapStage({ frame: frame0, prev: base, plan, sample: null, t: 0, info, step: 1 });
    expect(rest.attack).toBeNull();
  });
});

describe('the power sweep, from the cut-in', () => {
  const overclock: GameEvent[] = [{ kind: 'powerActivated', player: 1, level: 'overclock', commander: 'sefa' }];
  const surge: GameEvent[] = [{ kind: 'powerActivated', player: 0, level: 'surge', commander: 'rook' }];

  it('carries the commander\'s faction, the level and how far through the cut-in it is', () => {
    const p = planOf(frame0, frame0, overclock);
    const d = p.cutIn!.durMs;
    expect(sweepOf(sampleTransition(p, d / 2))).toEqual({ faction: 'tidewell', player: 1, level: 'overclock', progress: 0.5 });
    const s = planOf(frame0, frame0, surge);
    expect(sweepOf(sampleTransition(s, s.cutIn!.durMs / 4))).toEqual({ faction: 'helion', player: 0, level: 'surge', progress: 0.25 });
  });
  it('is nothing outside the cut-in, with no cut-in, and with no sample', () => {
    const p = planOf(frame0, frame0, overclock);
    expect(sweepOf(sampleTransition(p, p.cutIn!.durMs + 50))).toBeNull();
    const plain = planOf(frame0, frame0, [ATTACK]);
    expect(sweepOf(sampleTransition(plain, 100))).toBeNull();
    expect(sweepOf(null)).toBeNull();
  });
  it('mapStage carries it, and the faction is the one that activated the power (known-bad: the other player\'s)', () => {
    const p = planOf(frame0, frame0, overclock);
    const t = p.cutIn!.durMs / 2;
    const s = mapStage({ frame: frame0, prev: frame0, plan: p, sample: sampleTransition(p, t), t, info: analyseStep(frame0, frame0, overclock, p), step: 1 });
    expect(s.sweep!.faction).toBe('tidewell');
    expect(s.sweep!.faction).not.toBe('helion');
    expect(s.sweep!.level).toBe('overclock');
  });
});
