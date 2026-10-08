// Fixtures for the viewer's tests: small fogged matches written as text, so the expected answers can be worked out by hand.
import { fixtureMap } from '../../game/aw/testing';
import type { FixtureUnit } from '../../game/aw/testing';
import type { Action, CreateGameOptions, Coord, PlayerSetup } from '../../game/aw';

export const PLAYERS: PlayerSetup[] = [
  { faction: 'helion', commander: 'rook', controller: 'ai', team: 0 },
  { faction: 'tidewell', commander: 'sefa', controller: 'ai', team: 1 },
];

/** A 10 x 3 field of open ground with the given units, seed 1, no starting funds. */
export function fieldSetup(units: FixtureUnit[], opts: { fog: boolean; players?: PlayerSetup[] }): CreateGameOptions {
  const row = '..........';
  return {
    map: fixtureMap([row, row, row], units, undefined, 'viewer-fixture'),
    players: opts.players ?? PLAYERS,
    fog: opts.fog,
    seed: 1,
    startFunds: 0,
  };
}

export const pt = (x: number, y = 1): Coord => ({ x, y });

/** A move along `xs` on row 1 followed by `then`. */
export function walk(unitId: number, xs: number[], then: Extract<Action, { kind: 'move' }>['then'] = { kind: 'wait' }): Action {
  return { kind: 'move', unitId, path: xs.map((x) => pt(x)), then };
}

export const endTurn: Action = { kind: 'endTurn' };
