// Deploy (G9), pure. The player's agent is the commander and nobody moves a unit by hand (D-001, D-004, D-007), so "Deploy" never hands
// the player the units: it plays the mission with Doctrine (local rules) on EVERY side, from a fixed seed so the same mission always
// replays the same battle, and the watch view opens on the recorded actions.
//
// The setup is built the way src/content/missions.test.ts `setupFor` builds it, with `firstMoverRule: 'none'` (D-019: campaign missions
// balance their own start). The test file copies setupFor and compares.
import { MISSION_MAPS } from '../../content/mission-maps';
import type { Mission } from '../../content/types';
import type { Action, CreateGameOptions, PlayerSetup } from '../../game/aw';
import { DEFAULT_ORDERS, playDoctrine } from '../../game/doctrine';

/** Doctrine stops a battle at this cycle if nobody has won, so a stalled mission still opens a finite recording. */
export const DEPLOY_MAX_CYCLES = 30;

/** One fixed seed per mission: its place in the campaign, offset so it never equals the tests' seed 1. */
export const deploySeed = (m: Mission): number => 100 + m.order;

export function deploySetup(m: Mission): CreateGameOptions {
  const map = MISSION_MAPS[m.mapId];
  if (!map) throw new Error(`deploy: mission ${m.id} has no map ${m.mapId}`);
  const players: PlayerSetup[] = m.players.map((p) => ({
    faction: p.faction, commander: p.commander, controller: p.controller, team: p.team, ...(p.funds !== undefined ? { funds: p.funds } : {}),
  }));
  return { map, players, fog: m.fog, weather: m.weather, objective: m.objective, seed: deploySeed(m), firstMoverRule: 'none' };
}

export interface DeployResult {
  setup: CreateGameOptions;
  actions: Action[];
  /** The cycle the battle ended in, or DEPLOY_MAX_CYCLES when the cap stopped it. */
  cycles: number;
  winnerTeam: number | null;
}

/** Plays the mission with Doctrine on every side. `onCycle` is told each cycle as the battle reaches it. Synchronous, and slow on big maps. */
export function runDeploy(m: Mission, onCycle?: (cycle: number) => void): DeployResult {
  const setup = deploySetup(m);
  let seen = 0;
  const r = playDoctrine(setup, DEFAULT_ORDERS, {
    maxCycles: DEPLOY_MAX_CYCLES,
    onStep: onCycle ? (_before, _action, after) => { if (after.cycle !== seen) { seen = after.cycle; onCycle(seen); } } : undefined,
  });
  return { setup, actions: r.actions, cycles: r.cycles, winnerTeam: r.winnerTeam };
}
