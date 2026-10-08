// The demo match the viewer opens with: calder-fields, Rook Okafor (Helion) against Sefa Tamura (Tidewell), fog on, both sides
// played by the engine's seeded greedy policy (simulate). It is deterministic: the same constants always give the same actions, so
// a `#step=40` link always shows the same moment.
import { COMMANDERS } from '../../content/commanders';
import { MAPS } from '../../content/maps';
import type { Action, CreateGameOptions } from '../../game/aw';
import { simulate } from '../../game/aw/sim';

export const DEMO_MAP_ID = 'calder-fields';
/** Seeds: the engine's luck, and the policy's own choices. */
export const DEMO_GAME_SEED = 3;
export const DEMO_POLICY_SEED = 11;
export const DEMO_MAX_CYCLES = 24;

export function demoSetup(): CreateGameOptions {
  const map = MAPS[DEMO_MAP_ID];
  if (!map) throw new Error(`demo: map ${DEMO_MAP_ID} is missing`);
  const rook = COMMANDERS.rook;
  const sefa = COMMANDERS.sefa;
  return {
    map,
    players: [
      { faction: 'helion', commander: rook.id, controller: 'ai', team: 0 },
      { faction: 'tidewell', commander: sefa.id, controller: 'ai', team: 1 },
    ],
    fog: true,
    seed: DEMO_GAME_SEED,
    startFunds: map.recommended?.startFunds ?? 1000,
  };
}

export interface DemoMatch {
  setup: CreateGameOptions;
  actions: Action[];
}

/** Plays the demo to the end (or the cycle cap) with the greedy policy. Takes well under a second. */
export function buildDemoMatch(): DemoMatch {
  const setup = demoSetup();
  const result = simulate({ setup, seed: DEMO_POLICY_SEED, maxCycles: DEMO_MAX_CYCLES, policy: 'greedy' });
  return { setup, actions: result.actions };
}
