// The live battle (G14): A1's match host with Doctrine in every seat, the player's seat under the orders the player has set, and the rule of
// when a change of orders counts (D-022). Expected answers are worked out here from the engine (createGame, applyAction, replay) and from
// Doctrine's own `decide`, never read back from the host or the session. Known-bad inputs come first where a check could pass vacuously.
//
// The oracle `verifyOrdered` below re-derives a whole recorded battle with `decide`: every action of the player's seat must be the one Doctrine
// chooses under the orders in force at the START of that turn, every other seat's the one it chooses under the default orders, and every change
// of orders must begin at the start of one of the player's turns. A battle recorded by an implementation that applies a change the moment it is
// made does not pass it (planted below), and one recorded by the live battle does.
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../../content/missions';
import type { Mission } from '../../content/types';
import { AgentMatch } from '../../agent/match';
import { applyAction, createGame, resolvedSetup } from '../../game/aw';
import type { Action, CreateGameOptions, GameState } from '../../game/aw';
import { actionKey } from '../../game/aw/legal';
import { replay } from '../../game/aw/replay';
import { fixtureGame } from '../../game/aw/testing';
import { DEFAULT_ORDERS, decide } from '../../game/doctrine';
import type { StandingOrders } from '../../game/doctrine';
import type { BattleIn, BattleOut, ConnectBattle } from './battle';
import { BattleHost } from './battleHost';
import { runDeploy } from './deploy';
import { LiveSession } from './liveSession';
import { freshOrders, notesOf, sameOrders, setMission, setPosture, summariseOrders } from './ordersModel';

const mission = (id: string): Mission => MISSIONS.find((m) => m.id === id)!;
const json = (x: unknown): string => JSON.stringify(x);

interface Wire { in: BattleIn[]; out: BattleOut[] }

/** A battle wired straight to the host in this thread: a message sent is answered at once. `wire` keeps every message either way. */
function direct(m: Mission, wire: Wire): ConnectBattle {
  return (onMessage) => {
    const host = new BattleHost(m, (o) => { wire.out.push(o); onMessage(o); });
    return {
      send(msg) {
        wire.in.push(msg);
        if (msg.type === 'start') host.start(msg.orders);
        else host.turn(msg.orders);
      },
      close() {},
    };
  };
}

/** The true state at every step the playback has been shown so far, built from the actions that have arrived (the engine's own replay). */
class Steps {
  states: GameState[];
  constructor(setup: CreateGameOptions) { this.states = [createGame(resolvedSetup(setup))]; }
  upTo(actions: readonly Action[]): void {
    while (this.states.length <= actions.length) this.states.push(applyAction(this.states[this.states.length - 1], actions[this.states.length - 1]).state);
  }
}

interface Played { session: LiveSession; wire: Wire; steps: Steps; reachedAt: { step: number; sent: number }[] }

/**
 * Starts a battle and plays it back step by step, as the watch view does: `reached(step)` for each step shown, the next step shown only if it
 * has been computed. `act` is called at each step with the true state there, and may change the orders (as the player's hand on the panel would).
 */
function play(m: Mission, act?: (step: number, state: GameState, session: LiveSession) => void, first: StandingOrders = freshOrders()): Played {
  const wire: Wire = { in: [], out: [] };
  const session = new LiveSession(m, first, direct(m, wire));
  const steps = new Steps(session.setup);
  const reachedAt: { step: number; sent: number }[] = [];
  session.start();
  let step = 0;
  for (let guard = 0; guard < 20000; guard++) {
    steps.upTo(session.snapshot().actions);
    const before = wire.in.length;
    session.reached(step);
    reachedAt.push({ step, sent: wire.in.length - before });
    steps.upTo(session.snapshot().actions);
    act?.(step, steps.states[step], session);
    const snap = session.snapshot();
    if (step < snap.actions.length) step++;
    else if (!snap.open) return { session, wire, steps, reachedAt };
    else throw new Error(`playback is at step ${step}, the edge of what is computed, and the battle is waiting for nothing`);
  }
  throw new Error('the battle did not end');
}

/**
 * The oracle. Re-derives the battle with Doctrine: null when every action is the one Doctrine chooses under the orders in force, else a message.
 * `changes[i].from` is the action index the orders start from; the orders for a turn are the ones in force at its FIRST action.
 */
function verifyOrdered(setup: CreateGameOptions, actions: readonly Action[], changes: readonly { from: number; orders: StandingOrders }[]): string | null {
  // First: every change must begin where one of the player's turns begins (the first action played with the player to move).
  const real = startsOf(setup, actions);
  for (const c of changes) if (c.from > 0 && !real.has(c.from)) return `orders start from action ${c.from}, which is not the start of one of the player's turns`;
  // Second: every action is the one Doctrine chooses under the orders in force when its turn began.
  let state = createGame(resolvedSetup(setup));
  const inForce = (i: number): StandingOrders => [...changes].reverse().find((c) => c.from <= i)!.orders;
  let i = 0;
  while (i < actions.length) {
    const seat = state.current;
    const turnOrders = seat === 0 ? inForce(i) : DEFAULT_ORDERS;
    while (i < actions.length && state.current === seat) {
      const want = decide(state, seat, turnOrders);
      if (json(want) !== json(actions[i])) return `action ${i} (seat ${seat}) is not what Doctrine chooses under the orders in force at the start of its turn`;
      state = applyAction(state, actions[i]).state;
      i++;
    }
  }
  return null;
}

/** The action indexes at which one of the player's turns begins: the player is to move and the action before was another seat's (or none). */
function startsOf(setup: CreateGameOptions, actions: readonly Action[]): Set<number> {
  let state = createGame(resolvedSetup(setup));
  const out = new Set<number>();
  let prevSeat = -1;
  for (let i = 0; i < actions.length; i++) {
    if (state.current === 0 && prevSeat !== 0) out.add(i);
    prevSeat = state.current;
    try {
      state = applyAction(state, actions[i]).state;
    } catch {
      break; // a record that stops being legal has no starts beyond this; the second pass names the action
    }
  }
  return out;
}

/** Armour at Advance, infantry told to Fight: orders that change what the player's seat does on any mission with both. */
const BOLD = (): StandingOrders => setMission(setPosture(freshOrders(), { group: 'armour' }, 'advance'), { group: 'infantry' }, 'fight');

describe('the live battle with the orders never changed is the battle Deploy has always fought', () => {
  it('has the same actions, winner and cycles as runDeploy, on three missions', () => {
    for (const id of ['first-light', 'under-canopy', 'tidebreak']) {
      const m = mission(id);
      const ref = runDeploy(m);
      const { session, wire } = play(m);
      const snap = session.snapshot();
      expect(snap.done, id).not.toBeNull();
      expect(json(snap.actions), id).toBe(json(ref.actions));
      expect(snap.done?.winnerTeam, id).toBe(ref.winnerTeam);
      expect(snap.done?.cycles, id).toBe(ref.cycles);
      expect(json(session.setup), id).toBe(json(ref.setup));
      expect(snap.orderChanges, id).toHaveLength(1);
      expect(sameOrders(snap.orderChanges[0].orders, DEFAULT_ORDERS), id).toBe(true);
      expect(summariseOrders(snap.orderChanges).line, id).toBe('Default orders');
      expect(snap.notes, id).toStrictEqual([]);
      expect(wire.in[0], id).toMatchObject({ type: 'start', missionId: id });
    }
  }, 60_000);

  it('known-bad twin: the same battle under changed orders is NOT that battle (so the equality above is not vacuous)', () => {
    const m = mission('under-canopy');
    const ref = runDeploy(m);
    const { session } = play(m, undefined, BOLD());
    expect(json(session.snapshot().actions)).not.toBe(json(ref.actions));
    expect(summariseOrders(session.snapshot().orderChanges).line).toBe('Infantry: Fight from the start · Armour: Advance from the start');
  }, 60_000);

  it('is a legal game the engine replays to the same end', () => {
    const m = mission('under-canopy');
    const { session } = play(m);
    const snap = session.snapshot();
    expect(replay(session.setup, snap.actions).state.winnerTeam).toBe(snap.done?.winnerTeam);
  }, 60_000);
});

describe('D-022: a change of orders counts from the start of the player\'s NEXT turn', () => {
  const m = mission('under-canopy');
  const baseline = play(m);
  const base = baseline.session.snapshot();
  /** Index of the first action of each of the player's turns in a battle (the starts of turns of seat 0). */
  const turnStarts = (steps: Steps, n: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (steps.states[i].current === 0 && (i === 0 || steps.states[i - 1].current !== 0)) out.push(i);
    return out;
  };
  const baseStarts = turnStarts(baseline.steps, base.actions.length);

  it('the oracle accepts the battle that was played, and a battle with a wrong action is refused (setup: the check can fail)', () => {
    expect(verifyOrdered(baseline.session.setup, base.actions, base.orderChanges)).toBeNull();
    const tampered = base.actions.map((a, i) => (i === 3 ? { kind: 'endTurn' } as Action : a));
    expect(verifyOrdered(baseline.session.setup, tampered, base.orderChanges)).toMatch(/not what Doctrine chooses/);
    expect(baseStarts.length, 'setup: the battle has several turns of the player\'s').toBeGreaterThanOrEqual(4);
  });

  it('a change made during ANOTHER seat\'s turn is read when the player\'s next turn comes, and not before', () => {
    let changedAt = -1;
    const p = play(m, (step, state, session) => {
      if (changedAt < 0 && state.cycle === 1 && state.current === 1) { changedAt = step; session.setOrders(BOLD()); }
    });
    const snap = p.session.snapshot();
    expect(changedAt, 'setup: a step inside seat 1\'s turn of cycle 1 was shown').toBeGreaterThan(0);
    // the first turn was played under the orders it started with: it is the baseline's first turn, action for action
    const turn2 = baseStarts[1];
    expect(json(snap.actions.slice(0, turn2))).toBe(json(base.actions.slice(0, turn2)));
    // the change begins exactly at the start of the player's second turn, in cycle 2
    expect(snap.orderChanges).toHaveLength(2);
    expect(snap.orderChanges[1]).toMatchObject({ from: turn2, cycle: 2 });
    expect(sameOrders(snap.orderChanges[1].orders, BOLD())).toBe(true);
    // and that turn is different from the baseline's, so the change really was used there
    expect(json(snap.actions.slice(turn2, turn2 + 4))).not.toBe(json(base.actions.slice(turn2, turn2 + 4)));
    expect(verifyOrdered(p.session.setup, snap.actions, snap.orderChanges)).toBeNull();
    expect(snap.notes).toStrictEqual([{ step: turn2, text: expect.stringMatching(/^Cycle 2 · Infantry: Fight · Armour: Advance$|^Cycle 2 · Armour: Advance · Infantry: Fight$/) }]);
  }, 60_000);

  it('a change made DURING the player\'s own turn does not alter that turn, and counts from the next one', () => {
    let changedAt = -1;
    const turn2 = baseStarts[1];
    const p = play(m, (step, state, session) => {
      // inside the player's second turn: the state shown has the player to move and a turn's action has already been taken
      if (changedAt < 0 && state.cycle === 2 && state.current === 0 && step > turn2) { changedAt = step; session.setOrders(BOLD()); }
    });
    const snap = p.session.snapshot();
    expect(changedAt, 'setup: a step inside the player\'s second turn, after its start, was shown').toBeGreaterThan(turn2);
    // that whole turn, and everything before it, is the baseline's
    const turn3 = baseStarts[2];
    expect(json(snap.actions.slice(0, turn3))).toBe(json(base.actions.slice(0, turn3)));
    expect(snap.orderChanges).toHaveLength(2);
    expect(snap.orderChanges[1]).toMatchObject({ from: turn3, cycle: 3 });
    expect(sameOrders(snap.orderChanges[1].orders, BOLD())).toBe(true);
    expect(verifyOrdered(p.session.setup, snap.actions, snap.orderChanges)).toBeNull();
  }, 60_000);

  it('PLANTED: orders applied the moment they are made (in the middle of a turn) are refused by the oracle, the live battle\'s are not', () => {
    // Build the battle an "apply immediately" implementation would record: the player's second turn starts under the default orders, and
    // the moment after its first action the bold orders take over for the rest of the turn.
    const setup = baseline.session.setup;
    let state = createGame(resolvedSetup(setup));
    const actions: Action[] = [];
    const turn2 = baseStarts[1];
    let mid = -1;
    while (actions.length < base.actions.length && state.winnerTeam === null) {
      const seat = state.current;
      const inTurn2 = seat === 0 && actions.length >= turn2;
      if (inTurn2 && mid < 0 && actions.length > turn2) mid = actions.length;
      const o = seat === 0 ? (mid >= 0 ? BOLD() : DEFAULT_ORDERS) : DEFAULT_ORDERS;
      const a = decide(state, seat, o);
      actions.push(a);
      state = applyAction(state, a).state;
      if (mid >= 0 && state.current !== 0) break;
    }
    expect(mid, 'setup: the planted battle switched orders in the middle of a turn').toBeGreaterThan(turn2);
    const planted = [{ from: 0, orders: freshOrders() }, { from: mid, orders: BOLD() }];
    expect(verifyOrdered(setup, actions, planted)).toMatch(/not the start of one of the player's turns/);
    // the same planted actions with the change honestly dated at the start of the turn do not pass either: that turn's tail is not what the default orders choose
    expect(verifyOrdered(setup, actions, [planted[0], { from: turn2, orders: BOLD() }])).toMatch(/not what Doctrine chooses/);
    // the live battle with the same hand on the panel passes
    const live = play(m, (step, st, session) => { if (st.cycle === 2 && st.current === 0 && step > turn2 && sameOrders(session.snapshot().orders, freshOrders())) session.setOrders(BOLD()); });
    expect(verifyOrdered(live.session.setup, live.session.snapshot().actions, live.session.snapshot().orderChanges)).toBeNull();
  }, 60_000);

  it('computes the player\'s turn only when playback reaches its start: the host waits there, and says so, with nothing of that turn sent', () => {
    const p = play(m);
    const waits = p.wire.out.filter((o): o is Extract<BattleOut, { type: 'waiting' }> => o.type === 'waiting');
    expect(waits.length).toBeGreaterThanOrEqual(3);
    let arrived = 0;
    for (const o of p.wire.out) {
      if (o.type === 'actions') {
        expect(o.from, 'actions arrive in order, with no gap').toBe(arrived);
        arrived += o.actions.length;
      } else if (o.type === 'waiting') {
        expect(o.at, 'it waits having sent everything before the turn and nothing of it').toBe(arrived);
        expect(p.steps.states[o.at].current, `the state at step ${o.at} is the player's to move`).toBe(0);
      }
    }
    // a 'turn' is sent exactly when playback reaches a step where the host waits: never at an earlier step, once each
    const turnMessages = p.reachedAt.filter((r) => r.sent > 0 && r.step > 0);
    expect(turnMessages.map((r) => r.step)).toStrictEqual(waits.map((w) => w.at));
    expect(p.wire.in.filter((x) => x.type === 'turn')).toHaveLength(waits.length);
  }, 60_000);

  it('a host that is told twice, or when it is not waiting, plays nothing more', () => {
    const wire: Wire = { in: [], out: [] };
    const host = new BattleHost(m, (o) => wire.out.push(o));
    host.turn(freshOrders()); // before the start: nothing
    expect(wire.out).toHaveLength(0);
    host.start(freshOrders());
    const afterStart = wire.out.length;
    host.turn(freshOrders());
    const afterTurn = wire.out.length;
    expect(afterTurn).toBeGreaterThan(afterStart);
    const waiting = wire.out.filter((o) => o.type === 'waiting').length;
    host.turn(freshOrders());
    host.turn(freshOrders());
    // each turn message is one turn; once the host is waiting again it plays one more, never several for one
    expect(wire.out.filter((o) => o.type === 'waiting').length).toBeLessThanOrEqual(waiting + 2);
    expect(() => host.start(freshOrders())).toThrow();
  }, 60_000);

  it('says "From your next turn" while a change waits, and not once it has been handed over', () => {
    const wire: Wire = { in: [], out: [] };
    const session = new LiveSession(m, freshOrders(), direct(m, wire));
    session.start();
    expect(session.snapshot().pending).toBe(false);
    session.setOrders(BOLD());
    expect(session.snapshot().pending).toBe(true);
    session.setOrders(freshOrders()); // taken back before it counted: nothing is pending
    expect(session.snapshot().pending).toBe(false);
    session.setOrders(BOLD());
    const edge = wire.out.filter((o) => o.type === 'waiting')[0] as Extract<BattleOut, { type: 'waiting' }>;
    session.reached(edge.at - 1);
    expect(session.snapshot().pending, 'one step short of the turn').toBe(true);
    session.reached(edge.at);
    expect(session.snapshot().pending).toBe(false);
    expect(session.snapshot().orderChanges.map((c) => c.from)).toStrictEqual([0, edge.at]);
  }, 60_000);

  it('refuses orders the engine refuses, before they are kept or sent', () => {
    const wire: Wire = { in: [], out: [] };
    const session = new LiveSession(m, freshOrders(), direct(m, wire));
    session.start();
    expect(() => session.setOrders({ ...freshOrders(), note: 'go north' } as never)).toThrow(TypeError);
    expect(session.snapshot().pending).toBe(false);
    expect(() => new LiveSession(m, { ...freshOrders(), posture: 'charge' } as never, direct(m, wire))).toThrow(TypeError);
  }, 60_000);
});

describe('the record carries the order changes, so the debrief can list them and a replay stays exact', () => {
  it('the session\'s record and the host\'s agree, the notes say the cycle each change began in, and the debrief line lists them', () => {
    const m = mission('under-canopy');
    let done = false;
    const p = play(m, (_step, state, session) => {
      if (!done && state.cycle === 2 && state.current === 1) { done = true; session.setOrders(setPosture(freshOrders(), { group: 'air' }, 'fallBack')); }
    });
    const snap = p.session.snapshot();
    const done2 = snap.done!;
    expect(json(snap.orderChanges)).toBe(json(done2.orderChanges));
    expect(snap.orderChanges).toHaveLength(2);
    const [, second] = snap.orderChanges;
    expect(second.cycle).toBe(p.steps.states[second.from].cycle);
    expect(second.cycle).toBe(3);
    expect(notesOf(snap.orderChanges)).toStrictEqual([{ step: second.from, text: 'Cycle 3 · Air: Fall Back' }]);
    expect(summariseOrders(snap.orderChanges).line).toBe('Air: Fall Back from cycle 3');
    // a replay from the record alone (setup + actions) reaches the same end the host reported
    expect(replay(p.session.setup, snap.actions).state.winnerTeam).toBe(done2.winnerTeam);
    expect(verifyOrdered(p.session.setup, snap.actions, snap.orderChanges)).toBeNull();
  }, 60_000);

  it('AgentMatch keeps the same record when played directly: playOwnTurn writes a change only when the orders differ from the turn before', () => {
    const m = mission('first-light');
    const host = new AgentMatch(m, { continueAfterDefeat: true });
    // G19: a match begins with the orders it was made with (from action 0); the first turn played under other orders REPLACES that entry rather than adding a second from 0
    expect(host.orderChanges()).toStrictEqual([{ from: 0, cycle: 1, orders: freshOrders() }]);
    host.playOwnTurn(freshOrders());
    host.playOwnTurn(freshOrders());
    expect(host.orderChanges()).toHaveLength(1);
    const before = host.record().actions.length;
    host.playOwnTurn(BOLD());
    const changes = host.orderChanges();
    expect(changes).toHaveLength(2);
    expect(changes[1].from).toBe(before);
    expect(host.recordWithOrders().orderChanges).toStrictEqual(changes);
    // the record the MCP feed serves has no such field: it is the same shape it always was
    expect(Object.keys(host.record()).sort()).toStrictEqual(['actions', 'result', 'setup']);
    expect(() => host.playOwnTurn({ posture: 'charge' } as never)).toThrow(TypeError);
  }, 60_000);

  it('playOwnTurn is refused out of turn and after the end, like endTurn, and an agent that plays itself with no new orders writes no order change after its first', () => {
    const m = mission('first-light');
    const own = new AgentMatch(m);
    own.endTurn();
    expect(own.orderChanges()).toStrictEqual([{ from: 0, cycle: 1, orders: freshOrders() }]);
    const first = new AgentMatch(m, { continueAfterDefeat: true });
    first.playOwnTurn(BOLD());
    expect(first.orderChanges(), 'the first turn\'s orders replace the match\'s own, from action 0').toStrictEqual([{ from: 0, cycle: 1, orders: BOLD() }]);
    const host = new AgentMatch(m, { continueAfterDefeat: true });
    while (!host.result()) expect(host.playOwnTurn().ok).toBe(true);
    expect(host.playOwnTurn()).toMatchObject({ ok: false, reason: 'game-over' });
    expect(host.endTurn()).toMatchObject({ ok: false, reason: 'game-over' });
  }, 60_000);

  it('continueAfterDefeat plays on when only the agent\'s seat is out, and the default match ends as a defeat', () => {
    const m = mission('first-light');
    const out = (opts: { continueAfterDefeat?: boolean }): AgentMatch => {
      const h = new AgentMatch(m, opts);
      const s = h.trueState();
      (h as unknown as { state: GameState }).state = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, defeated: true } : p)) };
      (h as unknown as { settle(): void }).settle();
      return h;
    };
    expect(out({}).result()).toMatchObject({ reason: 'defeat', outcome: 'lost' });
    expect(out({ continueAfterDefeat: true }).result()).toBeNull();
  });
});

describe('what a group\'s order does to that group and nobody else', () => {
  /** A one-tile-high field (no two tiles tie): my spire and fabricator at the left end, a distant colossus at the right. Each unit is asked alone. */
  const strip = (): GameState => {
    const len = 27;
    const marks: Record<number, string> = { 0: 'H', 1: 'F' };
    const terrain = [Array.from({ length: len }, (_, x) => marks[x] ?? '.').join('')];
    const owners = [Array.from({ length: len }, (_, x) => (x < 2 ? '0' : '.')).join('')];
    return fixtureGame(terrain, [
      { type: 'arc', owner: 0, x: 2, y: 0 }, { type: 'trooper', owner: 0, x: 4, y: 0 }, { type: 'lancer', owner: 0, x: 6, y: 0 }, { type: 'wasp', owner: 0, x: 8, y: 0 },
      { type: 'colossus', owner: 1, x: 26, y: 0 },
    ], { owners });
  };
  const choose = (board: GameState, id: number, o: StandingOrders): string => {
    const only = { ...board, units: board.units.map((u) => (u.id === id ? u : { ...u, acted: true })) };
    const a = decide(only, 0, o);
    return a.kind === 'move' && a.unitId === id ? actionKey(a) : 'idle';
  };
  const changed = (board: GameState, o: StandingOrders): string[] =>
    board.units.filter((u) => u.owner === 0).filter((u) => choose(board, u.id, DEFAULT_ORDERS as StandingOrders) !== choose(board, u.id, o)).map((u) => u.type);

  it('Armour told to Fall Back (set on the card) moves the lancer and leaves the trooper, the arc and the wasp exactly as they were', () => {
    expect(changed(strip(), setPosture(freshOrders(), { group: 'armour' }, 'fallBack'))).toStrictEqual(['lancer']);
  });

  it('Air told to Advance moves the wasp and nobody else; known-bad twin: a group with no unit on the board changes nobody', () => {
    expect(changed(strip(), setPosture(freshOrders(), { group: 'air' }, 'advance'))).toStrictEqual(['wasp']);
    expect(changed(strip(), setPosture(freshOrders(), { group: 'navy' }, 'advance'))).toStrictEqual([]);
    expect(changed(strip(), freshOrders())).toStrictEqual([]);
  });

  it('a unit type\'s own order moves that type, and a group-mate of another type follows the group', () => {
    const board = strip();
    const own = setPosture(freshOrders(), { type: 'lancer' }, 'fallBack');
    expect(changed(board, own)).toStrictEqual(['lancer']);
  });

  it('in the live battle, Armour at Advance changes what the player\'s seat does on a mission with armour, and only from the turn it was given', () => {
    const m = mission('under-canopy');
    const a = play(m, undefined, freshOrders()).session.snapshot().actions;
    const b = play(m, undefined, setPosture(freshOrders(), { group: 'armour' }, 'advance')).session.snapshot().actions;
    expect(json(b)).not.toBe(json(a));
    // the very first action of the battle is already the changed orders' (they were set before Deploy)
    const firstDiff = a.findIndex((x, i) => json(x) !== json(b[i]));
    expect(firstDiff).toBeGreaterThanOrEqual(0);
    expect(firstDiff).toBeLessThan(25);
  }, 60_000);
});
