// Animation plans and their samples. Every plan is built from hand-written events and frames, so the expected beats, texts and times
// are worked out here (from the timing table's own numbers) rather than read back from transition.ts.
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import type { GameEvent } from '../../game/aw';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import { SPEEDS, TIMINGS, bannerMs, cutInMs, moveTileMs, scaled } from './timing';
import { recordMatch, viewTimeline } from './timeline';
import type { ViewFrame } from './timeline';
import { planTransition, sampleTransition } from './transition';
import { endTurn, fieldSetup, pt, walk } from './testing';

// Helion lancer (1) at x=2, Tidewell trooper (2) at x=3, Helion mule (3) at x=1. No fog: everything is in view.
const frame0: ViewFrame = viewTimeline(
  recordMatch(fieldSetup([
    { type: 'lancer', owner: 0, x: 2, y: 1 }, { type: 'trooper', owner: 1, x: 3, y: 1 }, { type: 'mule', owner: 0, x: 1, y: 1 },
  ], { fog: false }), []),
  'all',
).steps[0].frame;

const without = (f: ViewFrame, id: number): ViewFrame => ({ ...f, units: f.units.filter((u) => u.id !== id) });
const plan = (events: GameEvent[], speed: 1 | 2 | 4 = 1, next: ViewFrame = frame0, prev: ViewFrame = frame0, reducedMotion = false) =>
  planTransition(prev, next, events, { speed, reducedMotion });

const ATTACK: GameEvent = { kind: 'attacked', attackerId: 1, defenderId: 2, damage: 42, counter: 18, attackerHp: 82, defenderHp: 58 };

describe('a step with nothing to animate', () => {
  it('has no beats and no duration', () => {
    const p = plan([]);
    expect(p.durationMs).toBe(0);
    expect([p.moves, p.fx, p.numbers, p.hp, p.ghosts, p.appear].every((l) => l.length === 0)).toBe(true);
    expect(p.cutIn).toBeNull();
    expect(p.banner).toBeNull();
  });

  it('stays empty for events that only go in the log (loaded, joined, supplied, weather, defeat, victory)', () => {
    const quiet: GameEvent[] = [
      { kind: 'loaded', unitId: 1, transportId: 3 }, { kind: 'joined', unitId: 1, intoId: 3, refund: 0 },
      { kind: 'supplied', byId: 3, unitIds: [1] }, { kind: 'weather', weather: 'ionstorm', turns: 2 },
      { kind: 'playerDefeated', player: 1, reason: 'rout' }, { kind: 'victory', team: 0 }, { kind: 'turnEnded', player: 0 },
      { kind: 'captureProgress', unitId: 1, at: pt(2), remaining: 10 }, { kind: 'dropBlocked', transportId: 3, cargoId: 1, at: pt(2), by: 2 },
    ];
    expect(plan(quiet).durationMs).toBe(0);
  });
});

describe('unit glides', () => {
  const path = [pt(0), pt(1), pt(2), pt(3)]; // three tiles
  const move: GameEvent = { kind: 'moved', unitId: 1, path };

  it('take moveTileMs per tile at 1x (at most 250) and run for exactly the path\'s length', () => {
    const p = plan([move]);
    expect(p.tween).toBe(true);
    expect(p.moves).toHaveLength(1);
    expect(p.moves[0]).toMatchObject({ unitId: 1, startMs: 0, durMs: 3 * moveTileMs(1) });
    expect(moveTileMs(1)).toBeLessThanOrEqual(250);
    expect(p.durationMs).toBe(3 * moveTileMs(1));
    expect(plan([move], 2).moves[0].durMs).toBe(3 * moveTileMs(2));
  });

  it('are skipped at 4x and under reduced motion: no move beats, so nothing to wait for', () => {
    for (const p of [plan([move], 4), plan([move], 1, frame0, frame0, true)]) {
      expect(p.tween).toBe(false);
      expect(p.moves).toEqual([]);
      expect(p.durationMs).toBe(0);
    }
  });

  it('do not glide a unit that acted where it stood (a one-tile path)', () => {
    expect(plan([{ kind: 'moved', unitId: 1, path: [pt(2)] }]).moves).toEqual([]);
  });

  it('run one after another, so two moves in a step do not overlap', () => {
    const p = plan([move, { kind: 'moved', unitId: 3, path: [pt(1), pt(0)] }]);
    expect(p.moves[1].startMs).toBe(p.moves[0].startMs + p.moves[0].durMs);
  });

  it('are sampled along the path: start, half way (a steady march: 0.475 of the time), and gone once finished', () => {
    const p = plan([move]);
    const d = p.moves[0].durMs;
    const at0 = sampleTransition(p, 0).placements.get(1)!;
    expect(at0.x).toBeCloseTo(0, 9);
    // the march moves at 1 / 0.95 of the mean speed until the last tenth of its time, so half the path (1.5 of three tiles) is at 0.475 of the time
    const mid = sampleTransition(p, 0.475 * d).placements.get(1)!;
    expect(mid.x).toBeCloseTo(1.5, 9); // half way along three tiles
    expect(mid.y).toBeCloseTo(1, 9);
    expect(mid.heading).toBe('right');
    // known-bad: half the time is NOT half the path (smoothstep's symmetry is gone): it is 0.5 / 0.95 = 52.6% of the way
    expect(sampleTransition(p, d / 2).placements.get(1)!.x).toBeCloseTo(3 * (0.5 / 0.95), 9);
    expect(sampleTransition(p, d).placements.has(1)).toBe(false); // finished: the frame's own position takes over
    expect(sampleTransition(p, d + 500).placements.has(1)).toBe(false);
  });

  it('face the way they travel', () => {
    const left = plan([{ kind: 'moved', unitId: 1, path: [pt(3), pt(2), pt(1)] }]);
    expect(sampleTransition(left, left.durationMs / 2).placements.get(1)!.heading).toBe('left');
  });
});

describe('combat: hit flash, damage number, hit points', () => {
  it('flashes the defender with the damage number, then the attacker with the counter, in order', () => {
    const p = plan([ATTACK]);
    const hit = scaled(TIMINGS.hitMs, 1);
    expect(p.fx.map((f) => [f.kind, f.at, f.startMs])).toEqual([
      ['hit', pt(3), 0],        // the defender is at x=3
      ['hit', pt(2), hit],      // the attacker, at x=2, answers one hit-beat later
    ]);
    expect(p.numbers.map((n) => [n.text, n.tone, n.at])).toEqual([['-42%', 'damage', pt(3)], ['-18%', 'damage', pt(2)]]);
    expect(p.durationMs).toBeGreaterThanOrEqual(2 * hit);
  });

  it('puts a counter-first strike first', () => {
    const p = plan([{ ...ATTACK, counterFirst: true } as GameEvent]);
    expect(p.numbers.map((n) => n.text)).toEqual(['-18%', '-42%']);
    expect(p.fx[0].at).toEqual(pt(2));
  });

  it('shows no counter when there was none', () => {
    const p = plan([{ ...ATTACK, counter: 0, attackerHp: 100 } as GameEvent]);
    expect(p.numbers.map((n) => n.text)).toEqual(['-42%']);
    expect(p.fx).toHaveLength(1);
  });

  it('lets the hit points drop when the flash lands, not before', () => {
    const p = plan([ATTACK]);
    // before the defender's hit lands it still has what the frame before gave it (100); after, the engine's number (58)
    expect(sampleTransition(p, 0).hp.get(2)).toBe(100);
    expect(sampleTransition(p, scaled(TIMINGS.hitMs, 1) - 1).hp.get(2)).toBe(58);
    // the attacker's own drop (to 82) comes with the counter
    expect(sampleTransition(p, 10).hp.get(1)).toBe(100);
    expect(sampleTransition(p, scaled(TIMINGS.hitMs, 1) + 200).hp.get(1)).toBe(82);
  });

  it('flashes only what the viewer was shown: a shot from an unseen unit has no attacker flash (known-bad: the counter would draw on a guess)', () => {
    const unseen: GameEvent = { kind: 'attacked', attackerId: UNSEEN_UNIT, defenderId: 2, damage: 42, counter: 18, attackerHp: UNSEEN_UNIT, defenderHp: 58 };
    const p = plan([unseen]);
    expect(p.fx).toHaveLength(1);
    expect(p.fx[0].at).toEqual(pt(3));
    expect(p.numbers.map((n) => n.text)).toEqual(['-42%']);
    expect(p.hp.every((h) => h.unitId === 2)).toBe(true);
    // and an attacker id the viewer's frames have never held is not flashed either
    const stranger = plan([{ ...ATTACK, attackerId: 77 } as GameEvent]);
    expect(stranger.fx).toHaveLength(1);
  });
});

describe('destruction', () => {
  const dead: GameEvent = { kind: 'destroyed', unitId: 2, at: pt(3), type: 'trooper', owner: 1 };
  const next = without(frame0, 2);

  it('explodes on the tile and keeps the destroyed unit drawn, fading, until the explosion has run', () => {
    const p = plan([ATTACK, dead], 1, next);
    const boom = p.fx.find((f) => f.kind === 'explosion')!;
    expect(boom.at).toEqual(pt(3));
    expect(boom.startMs).toBe(2 * scaled(TIMINGS.hitMs, 1)); // after both hit beats
    expect(p.ghosts).toHaveLength(1);
    expect(p.ghosts[0].unit.id).toBe(2);
    expect(p.ghosts[0].untilMs).toBe(boom.startMs + scaled(TIMINGS.explosionMs, 1));

    const before = sampleTransition(p, boom.startMs - 1);
    expect(before.ghosts.map((g) => [g.unit.id, g.fade])).toEqual([[2, 0]]);
    const during = sampleTransition(p, boom.startMs + scaled(TIMINGS.explosionMs, 1) / 2);
    expect(during.ghosts[0].fade).toBeCloseTo(0.5, 6);
    expect(during.fx.some((f) => f.kind === 'explosion')).toBe(true);
    const after = sampleTransition(p, boom.startMs + scaled(TIMINGS.explosionMs, 1));
    expect(after.ghosts).toEqual([]);
  });

  it('blows up one explosion for a transport and its cargo on the same tile', () => {
    const cargoDead: GameEvent = { kind: 'destroyed', unitId: 4, at: pt(3), type: 'trooper', owner: 1 };
    expect(plan([dead, cargoDead], 1, next).fx.filter((f) => f.kind === 'explosion')).toHaveLength(1);
  });

  it('does not invent a ghost for a unit the viewer never saw (the explosion still plays)', () => {
    const p = plan([{ ...dead, unitId: 88 }], 1, next);
    expect(p.ghosts).toEqual([]);
    expect(p.fx.some((f) => f.kind === 'explosion')).toBe(true);
  });
});

describe('units that leave the picture without being destroyed', () => {
  it('stay drawn until they have finished gliding off (into the fog, or onto a transport)', () => {
    const next = without(frame0, 2);
    const p = plan([{ kind: 'moved', unitId: 2, path: [pt(3), pt(4)] }], 1, next);
    const end = moveTileMs(1);
    expect(p.ghosts).toHaveLength(1);
    expect(p.ghosts[0].untilMs).toBe(end);
    const mid = sampleTransition(p, 0.475 * end); // half way along the one tile: the steady march is there at 0.475 of the time
    expect(mid.ghosts).toHaveLength(1);
    expect(mid.ghosts[0].x).toBeCloseTo(3.5, 9);
    expect(sampleTransition(p, end).ghosts).toEqual([]);
  });

  it('are simply gone when there is no glide to wait for (4x)', () => {
    const next = without(frame0, 2);
    expect(plan([{ kind: 'moved', unitId: 2, path: [pt(3), pt(4)] }], 4, next).ghosts).toEqual([]);
  });
});

describe('the power cut-in', () => {
  it('names the commander and the power from the commander table, and fits in 2.2 s at 1x', () => {
    const surge = plan([{ kind: 'powerActivated', player: 0, level: 'surge', commander: 'rook' }]);
    expect(surge.cutIn).not.toBeNull();
    const c = surge.cutIn!;
    expect(c.commanderName).toBe(COMMANDERS.rook.name);
    expect(c.powerName).toBe(COMMANDERS.rook.surge!.name);
    expect(c.quote).toBe(COMMANDERS.rook.surge!.quote);
    expect(c.faction).toBe('helion');
    expect(c.level).toBe('surge');
    expect(c.durMs).toBeLessThanOrEqual(2200);
    expect(c.durMs).toBe(cutInMs(1));
    expect(surge.durationMs).toBe(c.startMs + c.durMs);

    const over = plan([{ kind: 'powerActivated', player: 1, level: 'overclock', commander: 'sefa' }]).cutIn!;
    expect(over.powerName).toBe(COMMANDERS.sefa.overclock!.name);
    expect(over.faction).toBe('tidewell');
    expect(over.level).toBe('overclock');
  });

  it('shrinks with the speed and never exceeds the 1x length', () => {
    const events: GameEvent[] = [{ kind: 'powerActivated', player: 0, level: 'surge', commander: 'rook' }];
    const lens = SPEEDS.map((s) => plan(events, s).cutIn!.durMs);
    expect(lens).toEqual([cutInMs(1), cutInMs(2), cutInMs(4)]);
    expect(lens[2]).toBeLessThan(lens[1]);
    expect(lens[1]).toBeLessThan(lens[0]);
  });

  it('is sampled: dimmed map at most 40%, band off to the left at the start and on screen in the middle, gone at the end', () => {
    const p = plan([{ kind: 'powerActivated', player: 0, level: 'surge', commander: 'rook' }]);
    const d = p.cutIn!.durMs;
    const first = sampleTransition(p, 0).cutIn!;
    expect(first.slide).toBe(-1);
    expect(first.dim).toBe(0);
    const mid = sampleTransition(p, d / 2).cutIn!;
    expect(mid.slide).toBe(0);
    expect(mid.dim).toBeCloseTo(0.4, 9);
    expect(mid.quote.length).toBeGreaterThan(0);
    for (let t = 0; t < d; t += 25) expect(sampleTransition(p, t).cutIn!.dim).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(sampleTransition(p, d).cutIn).toBeNull();
  });

  it('types the commander\'s line in, never past the whole quote', () => {
    const p = plan([{ kind: 'powerActivated', player: 0, level: 'surge', commander: 'rook' }]);
    const quote = COMMANDERS.rook.surge!.quote;
    const d = p.cutIn!.durMs;
    expect(sampleTransition(p, 0).cutIn!.quote).toBe('');
    // the line is typed between 20% and 60% of the cut-in: at 40% it is half typed
    expect(sampleTransition(p, d * 0.4).cutIn!.quote).toBe(quote.slice(0, Math.floor(quote.length * 0.5)));
    expect(sampleTransition(p, d * 0.9).cutIn!.quote).toBe(quote);
  });

  it('falls back to the level word for a commander it has no table row for (known-bad input)', () => {
    const c = plan([{ kind: 'powerActivated', player: 0, level: 'surge', commander: 'nobody' }]).cutIn!;
    expect(c.powerName).toBe('Surge');
    expect(c.quote).toBe('');
  });
});

describe('the turn banner opens its step', () => {
  it('starts at 0, lasts bannerMs, and the step\'s other beats wait for it', () => {
    const p = plan([{ kind: 'turnEnded', player: 0 }, { kind: 'turnStarted', player: 1, cycle: 3, income: 4000 }, ATTACK]);
    expect(p.banner).toEqual({ startMs: 0, durMs: bannerMs(1), player: 1, cycle: 3 });
    expect(p.fx[0].startMs).toBe(bannerMs(1));
    const s = sampleTransition(p, 10);
    expect(s.banner!.slide).toBeLessThan(0); // still sliding in
    expect(sampleTransition(p, bannerMs(1)).banner).toBeNull();
  });
});

describe('built units, repairs, captures, ambushes and unloading', () => {
  it('holds a built unit back until its build-in beat, with a spawn effect on the tile', () => {
    const p = plan([{ kind: 'built', unitId: 9, type: 'lancer', at: pt(5), owner: 0, cost: 7000 }]);
    expect(p.fx).toEqual([{ kind: 'spawn', at: pt(5), startMs: 0, durMs: scaled(TIMINGS.spawnMs, 1) }]);
    expect(p.appear).toEqual([{ unitId: 9, atMs: 0 }]);
    expect(sampleTransition(p, -1).hidden.has(9)).toBe(true);
    expect(sampleTransition(p, 1).hidden.has(9)).toBe(false);
  });

  it('floats "+2" over a repaired unit and lifts its hit points', () => {
    const hurt: ViewFrame = { ...frame0, units: frame0.units.map((u) => (u.id === 1 ? { ...u, hp: 60 } : u)) };
    const p = planTransition(hurt, hurt, [{ kind: 'repaired', unitId: 1, amount: 20, cost: 1400 }], { speed: 1 });
    expect(p.numbers).toEqual([{ at: pt(2), text: '+2', tone: 'heal', startMs: 0, durMs: scaled(TIMINGS.numberMs, 1) }]);
    expect(sampleTransition(p, 0).hp.get(1)).toBe(80);
  });

  it('pulses a property that changes hands, and the tiles a power touched', () => {
    expect(plan([{ kind: 'captured', at: pt(4), terrain: 'arcology', by: 0, from: null }]).fx).toEqual([{ kind: 'pulse', at: pt(4), startMs: 0, durMs: scaled(TIMINGS.pulseMs, 1) }]);
    const fx = plan([{ kind: 'powerEffect', player: 0, description: '+2 HP', affected: [pt(1), pt(2)] }]).fx;
    expect(fx.map((f) => [f.kind, f.at])).toEqual([['pulse', pt(1)], ['pulse', pt(2)]]);
  });

  it('pops a "!" over an ambushed unit', () => {
    const p = plan([{ kind: 'ambushed', unitId: 1, at: pt(2), by: 2 }]);
    expect(p.fx).toEqual([{ kind: 'ambush', at: pt(2), startMs: 0, durMs: scaled(TIMINGS.ambushMs, 1) }]);
  });

  it('glides an unloaded unit from its transport to the drop tile', () => {
    const p = plan([{ kind: 'unloaded', unitId: 1, transportId: 3, to: pt(1, 0) }]);
    expect(p.moves).toHaveLength(1);
    expect(p.moves[0].path).toEqual([pt(1), pt(1, 0)]);
    // before the glide starts it stands on the transport
    expect(sampleTransition(p, 0).placements.get(1)).toMatchObject({ x: 1, y: 1 });
  });
});

describe('a fogged viewer\'s plan is built from its own frames and events only', () => {
  // A hidden Tidewell arc fires from x=6 at the Helion trooper at x=3, whose vision reaches x=5.
  const rec = recordMatch(
    fieldSetup([{ type: 'trooper', owner: 0, x: 3, y: 1 }, { type: 'arc', owner: 1, x: 6, y: 1 }, { type: 'skimmer', owner: 1, x: 8, y: 1 }], { fog: true }),
    [endTurn, walk(2, [6], { kind: 'attack', target: pt(3) })],
  );

  it('flashes only the trooper that was hit, at its own tile, and nothing at the hidden arc', () => {
    const v = viewTimeline(rec, 0);
    const p = planTransition(v.steps[1].frame, v.steps[2].frame, v.steps[2].events, { speed: 1 });
    const hits = p.fx.filter((f) => f.kind === 'hit');
    expect(hits.map((f) => f.at)).toEqual([pt(3)]);
    expect(p.fx.every((f) => f.at.x <= 5)).toBe(true); // nothing drawn inside the dark
    expect(p.ghosts).toEqual([]);
  });

  it('shows the omniscient viewer the same shot as coming from the arc only if it fired a counter (it did not: indirect fire)', () => {
    const v = viewTimeline(rec, 'all');
    const p = planTransition(v.steps[1].frame, v.steps[2].frame, v.steps[2].events, { speed: 1 });
    expect(p.fx.filter((f) => f.kind === 'hit').map((f) => f.at)).toEqual([pt(3)]);
    expect(p.numbers).toHaveLength(1);
  });
});
