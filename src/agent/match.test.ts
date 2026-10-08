// The match host (A1). Expected answers are worked out here from the engine's own pieces (createGame, applyAction, replay, decide, observe,
// agentActions, viewEvents) and from the rules in D-007, D-016 and D-019, never read back from match.ts. Planted violations first where a
// checker could pass vacuously.
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../content/missions';
import type { Mission } from '../content/types';
import { applyAction, canSeeUnit, createGame, isLegal, resolvedSetup } from '../game/aw';
import type { Action, GameState } from '../game/aw';
import { actionKey } from '../game/aw/legal';
import { agentActions, observe } from '../game/aw/observe';
import { replay, stateHash } from '../game/aw/replay';
import { viewEvents } from '../game/aw/view-events';
import { DEFAULT_ORDERS, decide } from '../game/doctrine';
import { DEPLOY_MAX_CYCLES, deploySetup } from '../ui/front/deploy';
import { recordMatch } from '../ui/watch/timeline';
import { AGENT_CYCLE_CAP, AGENT_SEAT, AgentMatch } from './match';
import type { MatchEvent } from './match';

const mission = (id: string): Mission => MISSIONS.find((m) => m.id === id)!;
const FIRST_LIGHT = mission('first-light');
const UNDER_CANOPY = mission('under-canopy'); // fog on

/** Pokes the true state of a match, to build a situation the protocol itself cannot reach. Tests only. */
const poke = (m: AgentMatch, f: (s: GameState) => GameState): void => {
  (m as unknown as { state: GameState }).state = f(m.trueState());
  (m as unknown as { cache: null }).cache = null;
};

describe('the match starts the way Deploy starts it', () => {
  it('uses the mission\'s own deployed setup (seed, rule none, fog) with the first-mover rule written in, for every mission', () => {
    for (const m of MISSIONS) {
      const host = new AgentMatch(m);
      expect(host.setup, m.id).toStrictEqual(resolvedSetup(deploySetup(m)));
      expect(host.setup.firstMoverRule, m.id).toBe('none');
      expect(host.setup.seed, m.id).toBe(100 + m.order);
      expect(host.setup.fog, m.id).toBe(m.fog);
    }
  });

  it('takes its own luck seed when given one (the real server passes a fresh random one), and refuses a seed that is not a whole number', () => {
    const fixed = new AgentMatch(FIRST_LIGHT, { seed: 424242 });
    expect(fixed.setup.seed).toBe(424242);
    expect(fixed.setup).toStrictEqual(resolvedSetup({ ...deploySetup(FIRST_LIGHT), seed: 424242 }));
    // known-bad twin: without one it is the Deploy seed, so the two games are not the same game
    expect(new AgentMatch(FIRST_LIGHT).setup.seed).toBe(100 + FIRST_LIGHT.order);
    expect(stateHash(createGame(fixed.setup))).not.toBe(stateHash(createGame(new AgentMatch(FIRST_LIGHT).setup)));
    for (const bad of [1.5, Number.NaN, 2 ** 60]) expect(() => new AgentMatch(FIRST_LIGHT, { seed: bad }), String(bad)).toThrow(RangeError);
  });

  it('seats the agent in slot 0 with the 30-cycle cap, and the game is exactly createGame(setup)', () => {
    const host = new AgentMatch(FIRST_LIGHT);
    expect(AGENT_SEAT).toBe(0);
    expect(host.seat).toBe(0);
    expect(AGENT_CYCLE_CAP).toBe(30);
    expect(AGENT_CYCLE_CAP).toBe(DEPLOY_MAX_CYCLES);
    expect(host.cap).toBe(30);
    expect(host.trueStateHash()).toBe(stateHash(createGame(host.setup)));
    expect(host.trueState().current).toBe(0);
    expect(host.result()).toBeNull();
  });

  it('refuses a cap that is not a whole number >= 1', () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) expect(() => new AgentMatch(FIRST_LIGHT, { maxCycles: bad }), String(bad)).toThrow(RangeError);
  });
});

describe('what the agent is told', () => {
  it('observation() is observe(state, seat), and under fog lists exactly the enemy units canSeeUnit says are seen', () => {
    const host = new AgentMatch(UNDER_CANOPY);
    const truth = host.trueState();
    expect(host.observation()).toStrictEqual(observe(truth, 0));
    const hiddenEnemies = truth.units.filter((u) => truth.players[u.owner].team !== truth.players[0].team && !canSeeUnit(truth, 0, u));
    expect(hiddenEnemies.length, 'setup: this mission starts with enemies the agent cannot see').toBeGreaterThan(0);
    const told = new Set(host.observation().units.map((u) => u.id));
    for (const u of hiddenEnemies) expect(told.has(u.id), `hidden unit ${u.id}`).toBe(false);
    for (const u of truth.units) if (canSeeUnit(truth, 0, u)) expect(told.has(u.id), `visible unit ${u.id}`).toBe(true);
  });

  it('legal() is agentActions minus endTurn, one stable id each (actionKey), every one accepted by the true state', () => {
    for (const m of [FIRST_LIGHT, UNDER_CANOPY]) {
      const host = new AgentMatch(m);
      const truth = host.trueState();
      const expected = agentActions(truth, 0).filter((a) => a.kind !== 'endTurn' && a.kind !== 'resign').map(actionKey);
      const ids = host.legal().map((e) => e.id);
      expect([...new Set(expected)], m.id).toStrictEqual(ids);
      expect(new Set(ids).size, m.id).toBe(ids.length);
      expect(ids.length, m.id).toBeGreaterThan(0);
      for (const e of host.legal()) expect(actionKey(e.action), e.id).toBe(e.id);
      for (const e of host.legal()) expect(isLegal(truth, e.action), e.id).toBe(true);
      expect(ids).not.toContain('endTurn');
      expect(ids).not.toContain('resign');
    }
  });

  it('describes an attack by the visible enemy it hits (id and tile from the true state), and a build by its real cost', () => {
    // First Light: the agent stands still; the drones close in, and an attack is on offer by cycle 6.
    const host = new AgentMatch(FIRST_LIGHT);
    let attacks = 0;
    for (let turn = 0; turn < 8; turn++) {
      for (const e of host.legal()) {
        if (e.kind !== 'attack') continue;
        attacks++;
        const target = host.trueState().units.find((u) => u.id === e.target!.unit)!;
        expect([target.x, target.y]).toStrictEqual([e.target!.x, e.target!.y]);
        expect(host.trueState().players[target.owner].team).not.toBe(0);
        expect(e.id).toBe(`move:${e.unit}>${e.to!.x},${e.to!.y}:attack@${e.target!.x},${e.target!.y}`);
      }
      host.endTurn();
    }
    expect(attacks, 'setup: the walk saw attacks to check').toBeGreaterThan(0);

    // Under Canopy: the agent starts with funds and fabricators.
    const canopy = new AgentMatch(UNDER_CANOPY);
    const builds = canopy.legal().filter((e) => e.kind === 'build');
    expect(builds.length, 'setup: builds on offer').toBeGreaterThan(0);
    const funds = canopy.trueState().players[0].funds;
    for (const b of builds) {
      expect(b.cost, b.id).toBeGreaterThan(0);
      expect(b.cost!, b.id).toBeLessThanOrEqual(funds);
      expect(b.id).toBe(`build:${b.to!.x},${b.to!.y}:${b.unitType}`);
    }
  });
});

describe('act()', () => {
  it('applies exactly the action with that id: the state is applyAction of it, and the events are viewEvents of that step', () => {
    for (const m of [FIRST_LIGHT, UNDER_CANOPY]) {
      const host = new AgentMatch(m);
      const before = host.trueState();
      const entry = host.legal()[Math.floor(host.legal().length / 2)];
      const expected = applyAction(before, entry.action);
      const r = host.act(entry.id);
      expect(r.ok, m.id).toBe(true);
      expect(host.trueStateHash(), m.id).toBe(stateHash(expected.state));
      if (r.ok) expect(r.events, m.id).toStrictEqual(viewEvents(before, expected.state, expected.events, 0));
      expect(host.record().actions, m.id).toStrictEqual([entry.action]);
    }
  });

  it('refuses an id that is not in the legal list, and nothing changes (known-bad inputs)', () => {
    const host = new AgentMatch(FIRST_LIGHT);
    const hash = host.trueStateHash();
    const bad = ['move:999>1,1:wait', 'build:0,0:trooper', 'power:overclock', 'endTurn', 'resign', 'move:1>99,99:wait', ''];
    for (const id of bad) {
      const r = host.act(id);
      expect(r, JSON.stringify(id)).toMatchObject({ ok: false, reason: 'unknown-action' });
    }
    expect(host.trueStateHash()).toBe(hash);
    expect(host.record().actions).toStrictEqual([]);
  });

  it('refuses a stale id: once a unit has acted, its other actions are gone', () => {
    const host = new AgentMatch(FIRST_LIGHT);
    const first = host.legal().find((e) => e.unit !== undefined)!;
    const sameUnit = host.legal().filter((e) => e.unit === first.unit && e.id !== first.id);
    expect(sameUnit.length, 'setup: the unit had other options').toBeGreaterThan(0);
    expect(host.act(first.id).ok).toBe(true);
    expect(host.act(sameUnit[0].id)).toMatchObject({ ok: false, reason: 'unknown-action' });
    expect(host.legal().some((e) => e.unit === first.unit)).toBe(false);
  });

  it('refuses when it is not the agent\'s seat\'s turn', () => {
    const host = new AgentMatch(FIRST_LIGHT);
    const id = host.legal()[0].id;
    poke(host, (s) => ({ ...s, current: 1 }));
    expect(host.act(id)).toMatchObject({ ok: false, reason: 'not-your-turn' });
    expect(host.endTurn()).toMatchObject({ ok: false, reason: 'not-your-turn' });
    expect(host.legal()).toStrictEqual([]);
    expect(host.record().actions).toStrictEqual([]);
  });
});

describe('endTurn() and the other seats', () => {
  it('plays every other seat with Doctrine (DEFAULT_ORDERS) until it is the agent\'s turn again, and stops there', () => {
    const host = new AgentMatch(FIRST_LIGHT);
    const log: MatchEvent[] = [];
    host.subscribe((e) => log.push(e));
    const r = host.endTurn();
    expect(r.ok).toBe(true);
    expect(host.trueState().current).toBe(0);
    expect(host.trueState().cycle).toBe(2);
    if (r.ok) expect(r.played).toBeGreaterThan(0);
    const acts = log.filter((e): e is Extract<MatchEvent, { type: 'action' }> => e.type === 'action');
    expect(acts[0]).toMatchObject({ seat: 0, by: 'agent', action: { kind: 'endTurn' } });
    expect(acts.slice(1).every((a) => a.by === 'doctrine' && a.seat !== 0)).toBe(true);
    expect(new Set(acts.slice(1).map((a) => a.seat))).toStrictEqual(new Set([1, 2]));
    // Each Doctrine action is what decide() answers for that state, computed here by replaying the record.
    const rec = recordMatch(host.setup, host.record().actions);
    acts.forEach((a, i) => {
      expect(a.index).toBe(i);
      if (a.by === 'doctrine') expect(decide(rec.states[i], a.seat, DEFAULT_ORDERS), `action #${i}`).toStrictEqual(a.action);
    });
  });

  it('returns the events the agent may see, step by step, and under fog trims what viewEvents trims', () => {
    const host = new AgentMatch(UNDER_CANOPY);
    const r = host.endTurn();
    expect(r.ok).toBe(true);
    const rec = recordMatch(host.setup, host.record().actions);
    const expected = rec.rawEvents.flatMap((raw, i) => viewEvents(rec.states[i], rec.states[i + 1], raw, 0));
    if (r.ok) expect(r.events).toStrictEqual(expected);
    const raw = rec.rawEvents.flat();
    expect(expected.length, 'setup: fog hid something from the agent, so the check can tell the difference').toBeLessThan(raw.length);
  });

  it('keeps a record that replays to the same state hash', () => {
    const host = new AgentMatch(FIRST_LIGHT);
    for (let i = 0; i < 4; i++) {
      host.act(host.legal()[0].id);
      host.endTurn();
    }
    const rec = host.record();
    expect(rec.actions.length).toBeGreaterThan(8);
    expect(stateHash(replay(rec.setup, rec.actions).state)).toBe(host.trueStateHash());
    // planted: dropping one action gives a different state
    expect(stateHash(replay(rec.setup, rec.actions.slice(0, -1)).state)).not.toBe(host.trueStateHash());
  });

  it('does not let the agent act for another seat: the only way to move seat 1 or 2 is end_turn', () => {
    const host = new AgentMatch(FIRST_LIGHT);
    host.endTurn();
    const seats = host.record().actions.length;
    expect(seats).toBeGreaterThan(1);
    const rec = recordMatch(host.setup, host.record().actions);
    // every unit named by an agent-legal action is the agent's own
    for (const e of host.legal()) if (e.unit !== undefined) expect(rec.states[rec.states.length - 1].units.find((u) => u.id === e.unit)!.owner).toBe(0);
  });
});

describe('the end of a match', () => {
  it('stops at the cap, undecided, with the cap as its cycle; then refuses everything', () => {
    const host = new AgentMatch(FIRST_LIGHT, { maxCycles: 2 });
    const log: MatchEvent[] = [];
    host.subscribe((e) => log.push(e));
    expect(host.endTurn().ok).toBe(true);
    expect(host.result(), 'after cycle 1 the match goes on').toBeNull();
    expect(host.endTurn().ok).toBe(true);
    expect(host.result()).toStrictEqual({ reason: 'cap', winnerTeam: null, outcome: 'undecided', cycles: 2 });
    expect(host.trueState().cycle).toBe(3);
    expect(log.filter((e) => e.type === 'result')).toHaveLength(1);
    expect(log[log.length - 1].type).toBe('result');
    const n = host.record().actions.length;
    expect(host.act('move:1>1,1:wait')).toMatchObject({ ok: false, reason: 'game-over' });
    expect(host.endTurn()).toMatchObject({ ok: false, reason: 'game-over' });
    expect(host.legal()).toStrictEqual([]);
    expect(host.record().actions).toHaveLength(n);
  });

  it('a cap of one cycle ends after exactly one round of turns', () => {
    const host = new AgentMatch(FIRST_LIGHT, { maxCycles: 1 });
    host.endTurn();
    expect(host.result()).toMatchObject({ reason: 'cap', cycles: 1 });
  });

  it('is won when the other team is out: here Doctrine\'s enemy seat resigns (a driver stands in for a beaten army)', () => {
    const driver = (s: GameState): Action => (s.current === 2 ? { kind: 'resign' } : { kind: 'endTurn' });
    const host = new AgentMatch(FIRST_LIGHT, { driver });
    host.endTurn();
    expect(host.result()).toStrictEqual({ reason: 'victory', winnerTeam: 0, outcome: 'won', cycles: 1 });
    expect(host.trueState().winnerTeam).toBe(0);
    expect(host.act('move:1>1,1:wait')).toMatchObject({ ok: false, reason: 'game-over' });
  });

  it('is lost when the agent\'s own team is the one left out (the enemy wins)', () => {
    // The agent's seat is out (routed) while the game is not decided: the match is over for the agent.
    const host = new AgentMatch(FIRST_LIGHT);
    poke(host, (s) => ({ ...s, players: s.players.map((p) => (p.index === 0 ? { ...p, defeated: true } : p)) }));
    (host as unknown as { settle(): void }).settle();
    expect(host.result()).toMatchObject({ reason: 'defeat', outcome: 'lost' });
  });

  it('a subscriber that throws does not stop the match and is reported', () => {
    const errors: unknown[] = [];
    const host = new AgentMatch(FIRST_LIGHT, { onSubscriberError: (e) => errors.push(e) });
    host.subscribe(() => { throw new Error('boom'); });
    expect(host.endTurn().ok).toBe(true);
    expect(errors.length).toBeGreaterThan(0);
    expect(host.trueState().cycle).toBe(2);
  });
});

describe('standing orders', () => {
  it('are DEFAULT_ORDERS until the orders screen sets others, and a copy each time', () => {
    const host = new AgentMatch(FIRST_LIGHT);
    expect(host.orders()).toStrictEqual({ ...DEFAULT_ORDERS, composition: { ...DEFAULT_ORDERS.composition }, targetPriority: [...DEFAULT_ORDERS.targetPriority] });
    const o = host.orders();
    o.posture = 'advance';
    expect(host.orders().posture).toBe('holdTheLine');
  });

  it('are validated: a free-text key is refused (D-005)', () => {
    expect(() => new AgentMatch(FIRST_LIGHT, { orders: { ...DEFAULT_ORDERS, note: 'attack the north' } as never })).toThrow(TypeError);
    expect(new AgentMatch(FIRST_LIGHT, { orders: { ...DEFAULT_ORDERS, posture: 'advance' } }).orders().posture).toBe('advance');
  });
});
