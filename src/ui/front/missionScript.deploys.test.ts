// All 14 missions, on their real Doctrine deploy runs (the very battle Deploy records and the watch view replays): the script evaluates
// without error, and every firing agrees with an ORACLE that reads the same battle through a different instrument. The script reads the
// true EVENTS; the oracle below reads the true STATES (who stood where, who owned what, how many powers had been used) and the Doctrine
// run's own reported winner, so a mistake in either one shows up as a disagreement. The result card is checked the same way.
//
// This file plays 14 battles (about a minute in all), so each mission is one test with a long timeout. It asserts no particular winner:
// Doctrine is being tuned by other work, and a mission that wins today may stall tomorrow. What it asserts is that WHATEVER happened is
// reported the way it happened.
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../../content/missions';
import type { Mission } from '../../content/types';
import type { GameEvent, GameState, Unit } from '../../game/aw';
import { recordMatch } from '../watch/timeline';
import type { MatchRecord } from '../watch/timeline';
import { RANK_FLOORS, resultCardOf } from './debrief';
import { DEPLOY_MAX_CYCLES, runDeploy } from './deploy';
import { evaluateScript, outcomeOf, scriptFor } from './missionScript';

// ---------------------------------------------------------------- the oracle: states, not events

/** id -> owner for every unit in a state, loaded cargo included. */
function owners(s: GameState): Map<number, number> {
  const out = new Map<number, number>();
  const walk = (list: Unit[]): void => { for (const u of list) { out.set(u.id, u.owner); walk(u.cargo); } };
  walk(s.units);
  return out;
}

/**
 * Per step i >= 1: the owners of the units that left the battlefield in that step. A unit that joined another did not die, and nor did the
 * army of a player defeated by capture, resignation or deadline (the engine removes it from the board without a kill); a player defeated
 * by `rout` lost its last unit to a real destroy. `crashes` says whether a crash (a unit out of charge) counts as a loss.
 */
function leavers(rec: MatchRecord, crashes: boolean): number[][] {
  const out: number[][] = [[]];
  for (let i = 1; i < rec.states.length; i++) {
    const before = owners(rec.states[i - 1]);
    const after = owners(rec.states[i]);
    const events: GameEvent[] = rec.rawEvents[i - 1];
    const joined = new Set(events.flatMap((e) => (e.kind === 'joined' ? [e.unitId] : [])));
    const crashed = new Set(events.flatMap((e) => (e.kind === 'crashed' ? [e.unitId] : [])));
    const disbanded = new Set(events.flatMap((e) => (e.kind === 'playerDefeated' && e.reason !== 'rout' ? [e.player] : [])));
    out.push([...before].filter(([id, owner]) => !after.has(id) && !joined.has(id) && !disbanded.has(owner) && (crashes || !crashed.has(id))).map(([, owner]) => owner));
  }
  return out;
}
const destroyedOwners = (rec: MatchRecord): number[][] => leavers(rec, false);
const lostOwners = (rec: MatchRecord): number[][] => leavers(rec, true);

/** The steps at which `trigger` occurs, by the oracle (ascending). */
function oracleSteps(m: Mission, rec: MatchRecord, winnerTeam: number | null, trigger: Mission['events'][number]['trigger'], gone: number[][]): number[] {
  const last = rec.states.length - 1;
  const team0 = m.players[0].team;
  const steps = Array.from({ length: last + 1 }, (_, i) => i);
  switch (trigger.kind) {
    case 'start':
      return [0];
    case 'cycle': {
      // the first state of that cycle, found from the turn-start events rather than from the state's own cycle counter
      if (trigger.cycle <= 1) return [0];
      const at = rec.rawEvents.findIndex((evs) => evs.some((e) => e.kind === 'turnStarted' && e.cycle === trigger.cycle));
      return at < 0 ? [] : [at + 1];
    }
    case 'unitDestroyed': {
      const every = trigger.count ?? 1;
      let total = 0;
      const out: number[] = [];
      for (const i of steps) {
        const before = total;
        total += gone[i].filter((o) => o === trigger.owner).length;
        if (Math.floor(total / every) > Math.floor(before / every)) out.push(i);
      }
      return out;
    }
    case 'propertyCaptured':
      // a tile of that terrain whose owner became `by` in this step
      return steps.filter((i) => i > 0 && rec.states[i].tiles.some((row, y) => row.some((t, x) =>
        t.owner === trigger.by && rec.states[i - 1].tiles[y][x].owner !== trigger.by && (trigger.terrain === undefined || t.terrain === trigger.terrain))));
    case 'powerUsed':
      return steps.filter((i) => i > 0 && rec.states[i].players[trigger.player].powerUses > rec.states[i - 1].players[trigger.player].powerUses);
    case 'victory':
      return winnerTeam !== null && winnerTeam === team0 ? [last] : [];
    case 'defeat':
      return winnerTeam !== null && winnerTeam !== team0 ? [last] : [];
  }
}

// ---------------------------------------------------------------- the 14 runs

const fired: { mission: string; kind: string; step: number }[] = [];

describe('every mission, on its real Doctrine deploy run', () => {
  for (const m of MISSIONS) {
    it(`${m.id}: the script agrees with the oracle, and the result card agrees with the battle`, () => {
      const result = runDeploy(m);
      const rec = recordMatch(result.setup, result.actions);
      const last = rec.states.length - 1;
      const finalState = rec.states[last];
      const team0 = m.players[0].team;
      const gone = destroyedOwners(rec);

      // the script evaluates, in order, inside the recording
      const fires = evaluateScript(m, rec);
      for (let i = 1; i < fires.length; i++) {
        expect(fires[i].step > fires[i - 1].step || (fires[i].step === fires[i - 1].step && fires[i].event > fires[i - 1].event), `${m.id}: firings out of order at ${i}`).toBe(true);
      }
      for (const f of fires) expect(f.step >= 0 && f.step <= last, `${m.id}: event ${f.event} fires at step ${f.step} of 0..${last}`).toBe(true);

      // every authored event fires exactly where the oracle says (or never, where the oracle says never)
      m.events.forEach((ev, index) => {
        const oracle = oracleSteps(m, rec, result.winnerTeam, ev.trigger, gone);
        const want = ev.once === false ? oracle : oracle.slice(0, 1);
        expect(fires.filter((f) => f.event === index).map((f) => f.step), `${m.id}: ${JSON.stringify(ev.trigger)}`).toEqual(want);
        for (const step of want) fired.push({ mission: m.id, kind: ev.trigger.kind, step });
      });

      // the opening line is told at the first step; the ending is told at the last, from player 0's side, and only if somebody won
      const kinds = m.events.map((e) => e.trigger.kind);
      expect(kinds, `${m.id} authors a start, a victory and a defeat`).toEqual(expect.arrayContaining(['start', 'victory', 'defeat']));
      const at = (kind: string): number[] => fires.filter((f) => m.events[f.event].trigger.kind === kind).map((f) => f.step);
      expect(at('start')).toEqual([0]);
      const outcome = outcomeOf(team0, result.winnerTeam);
      expect(at('victory')).toEqual(outcome === 'victory' ? [last] : []);
      expect(at('defeat')).toEqual(outcome === 'defeat' ? [last] : []);
      expect(outcome === 'undecided', `${m.id}: undecided exactly when Doctrine reported no winner`).toBe(result.winnerTeam === null);
      expect(finalState.winnerTeam, `${m.id}: the recording ends on the winner Doctrine reported`).toBe(result.winnerTeam);

      // the beats are the firings grouped by step, nothing dropped
      const beats = scriptFor(m, rec);
      expect(beats.flatMap((b) => b.events).sort((a, b) => a - b)).toEqual(fires.map((f) => f.event).sort((a, b) => a - b));
      expect(beats.map((b) => b.step)).toEqual([...new Set(fires.map((f) => f.step))]);

      // the result card
      const card = resultCardOf(m, rec.states);
      expect(card.outcome).toBe(outcome);
      expect(card.cycles, `${m.id}: cycles taken is the cycle Doctrine reports (the cap for an undecided battle)`).toBe(result.cycles);
      if (outcome === 'undecided') expect(card.cycles).toBe(DEPLOY_MAX_CYCLES);
      const lost = lostOwners(rec).flat().filter((o) => m.players[o].team === team0).length;
      expect(card.lost, `${m.id}: units the side lost, counted from the states`).toBe(lost);
      const teams = new Set(m.players.map((p) => p.team));
      const enemyDeaths = gone.flat().filter((o) => m.players[o].team !== team0).length;
      if (teams.size === 2) expect(card.destroyed, `${m.id}: with one enemy team, every enemy death is the side's kill`).toBe(enemyDeaths);
      else expect(card.destroyed).toBeLessThanOrEqual(enemyDeaths);
      // Speed and Power from the quality-bar formulas, written out here (a point of tolerance for rounding at exactly .5)
      const speed = card.cycles <= m.par.cycles ? 100 : Math.max(0, 100 - (100 * (card.cycles - m.par.cycles)) / m.par.cycles);
      const power = Math.min(100, (100 * (card.destroyed / Math.max(1, card.lost))) / m.par.power);
      expect(Math.abs(card.speed - speed), `${m.id} speed`).toBeLessThanOrEqual(1);
      expect(Math.abs(card.power - power), `${m.id} power`).toBeLessThanOrEqual(1);
      expect(card.ratio).toBeCloseTo(card.destroyed / Math.max(1, card.lost), 10);
      // the rank: a letter for a victory only, from the floors
      if (outcome !== 'victory') expect(card.rank, `${m.id}: ${outcome} is not ranked`).toBeNull();
      else {
        const total = card.speed + card.power;
        const want = RANK_FLOORS.find(([, floor]) => total >= floor)?.[0] ?? 'C';
        expect(card.rank).toBe(want);
      }
    }, 240_000);
  }

  it('is not vacuous: across the campaign the script fires mid-battle moments, not only starts and endings', () => {
    const middle = fired.filter((f) => f.kind !== 'start' && f.kind !== 'victory' && f.kind !== 'defeat');
    expect(fired.length).toBeGreaterThan(MISSIONS.length); // at least a start per mission and more
    expect(middle.length).toBeGreaterThan(10);
    expect(new Set(middle.map((f) => f.kind)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(fired.map((f) => f.mission)).size).toBe(MISSIONS.length);
  });
});
