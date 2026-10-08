// Test fixtures: tiny maps written as text, so tests read like the battlefield they describe.
// Map codes are TERRAIN_CODES in src/data/index.ts:  . flats  f canopy  ^ ridge  = maglev  # span  r river
//   ~ sea  s shoal  g glass  C arcology  F fabricator  A skyport  D dock  U uplink  H spire
import type { MapDef } from '../../content/types';
import { createGame } from './index';
import type { CreateGameOptions, PlayerSetup } from './index';
import type { GameState, UnitTypeId } from './types';

export interface FixtureUnit { type: UnitTypeId; owner: number; x: number; y: number; hp?: number }

/** A MapDef from terrain rows. `owners` defaults to all neutral; pass rows with '0'..'4' on properties. */
export function fixtureMap(terrain: string[], units: FixtureUnit[] = [], owners?: string[], id = 'fixture'): MapDef {
  return {
    id, name: id, description: 'test fixture', players: 2, terrain,
    owners: owners ?? terrain.map((r) => '.'.repeat(r.length)), units,
  };
}

export const TWO_PLAYERS: PlayerSetup[] = [
  { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
  { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
];

/** A game on a fixture map with two commander-less players, seed 1, no fog. */
export function fixtureGame(
  terrain: string[], units: FixtureUnit[] = [], extra: Partial<CreateGameOptions> & { owners?: string[] } = {},
): GameState {
  const { owners, ...rest } = extra;
  return createGame({ map: fixtureMap(terrain, units, owners), players: TWO_PLAYERS, seed: 1, ...rest });
}
