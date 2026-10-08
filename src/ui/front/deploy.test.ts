// Deploy: the mission is played by Doctrine on every side from a fixed seed, under the rule the campaign's own tests use. setupFor below
// is copied from src/content/missions.test.ts (the spec's reference), so the comparison does not read deploy.ts back to itself.
import { describe, expect, it } from 'vitest';
import { MISSION_MAPS } from '../../content/mission-maps';
import { MISSIONS } from '../../content/missions';
import type { Mission } from '../../content/types';
import { applyAction, createGame } from '../../game/aw';
import type { CreateGameOptions, PlayerSetup } from '../../game/aw';
import { replay, stateHash } from '../../game/aw/replay';
import { DEPLOY_MAX_CYCLES, deploySeed, deploySetup, runDeploy } from './deploy';

function setupFor(m: Mission, seed: number): CreateGameOptions {
  const players: PlayerSetup[] = m.players.map((p) => ({
    faction: p.faction, commander: p.commander, controller: p.controller, team: p.team, ...(p.funds !== undefined ? { funds: p.funds } : {}),
  }));
  return { map: MISSION_MAPS[m.mapId], players, fog: m.fog, weather: m.weather, objective: m.objective, seed, firstMoverRule: 'none' };
}

describe('the setup Deploy plays', () => {
  const first = MISSIONS[0];

  it('equals the campaign tests\' setupFor for the same seed, for every mission', () => {
    for (const m of MISSIONS) expect(deploySetup(m), m.id).toStrictEqual(setupFor(m, deploySeed(m)));
  });

  it('plays under the campaign rule: the first mover is not compensated (D-019)', () => {
    for (const m of MISSIONS) expect(deploySetup(m).firstMoverRule, m.id).toBe('none');
  });

  it('would not equal a setup built under a different first-mover rule, a different seed or fog flipped (planted differences)', () => {
    const real = deploySetup(first);
    expect(real).not.toStrictEqual({ ...setupFor(first, deploySeed(first)), firstMoverRule: 'noFirstIncome' });
    expect(real).not.toStrictEqual({ ...setupFor(first, deploySeed(first)), firstMoverRule: undefined });
    expect(real).not.toStrictEqual(setupFor(first, 1));
    expect(real).not.toStrictEqual({ ...setupFor(first, deploySeed(first)), fog: !first.fog });
    // and a setup that omits the rule would replay under the engine's default, which is not 'none'
    expect(createGame({ ...real, firstMoverRule: undefined }).players[0].funds).not.toBe(createGame(real).players[0].funds);
  });

  it('keeps every player\'s controller as the mission wrote it: the agent\'s slot is "human", and Doctrine plays it anyway', () => {
    expect(deploySetup(first).players.map((p) => p.controller)).toEqual(first.players.map((p) => p.controller));
    expect(first.players[0].controller).toBe('human');
  });

  it('has one fixed seed per mission, never the tests\' seed, and each different', () => {
    const seeds = MISSIONS.map(deploySeed);
    expect(new Set(seeds).size).toBe(MISSIONS.length);
    expect(seeds).not.toContain(1);
    expect(deploySeed(first)).toBe(deploySeed(first));
    expect(deploySetup(first).seed).toBe(deploySeed(first));
  });

  it('refuses a mission whose map does not exist', () => {
    expect(() => deploySetup({ ...first, mapId: 'm0-nowhere' })).toThrow(/no map m0-nowhere/);
  });
});

describe('the battle Deploy records', () => {
  const m = MISSIONS[0];
  const run = runDeploy(m);

  it('is a legal game that the engine replays to the same end, and it ends', () => {
    expect(run.actions.length).toBeGreaterThan(20);
    expect(run.cycles).toBeLessThanOrEqual(DEPLOY_MAX_CYCLES);
    const r = replay(run.setup, run.actions);
    expect(r.state.winnerTeam).toBe(run.winnerTeam);
    expect(run.winnerTeam, 'First Light is a win the agent\'s side takes').toBe(0);
  });

  it('is the same battle every time: the same mission always gives the same actions', () => {
    const again = runDeploy(m);
    expect(JSON.stringify(again.actions)).toBe(JSON.stringify(run.actions));
    expect(stateHash(replay(again.setup, again.actions).state)).toBe(stateHash(replay(run.setup, run.actions).state));
  });

  it('plays EVERY side with Doctrine, the agent\'s own slot included: no seat is left waiting for a hand', () => {
    let state = createGame(run.setup);
    const acted = new Set<number>();
    for (const a of run.actions) {
      acted.add(state.current);
      state = applyAction(state, a).state;
    }
    expect([...acted].sort()).toEqual(m.players.map((_, i) => i));
  });

  it('reports each cycle as the battle reaches it, in order, from the first', () => {
    const seen: number[] = [];
    runDeploy(m, (c) => seen.push(c));
    expect(seen[0]).toBeGreaterThanOrEqual(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });
});
