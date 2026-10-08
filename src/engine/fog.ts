// Fog of war. visibility()[y][x] answers "can this player see a unit standing on (x, y)?":
// unit vision (Manhattan), +1 for foot/exo on ridge, −1 in ion storms; canopy hides units unless an
// observer is adjacent (or it is the observer's own tile); owned properties see their own tile.
// Teammates share vision. Fog is on when the game has fog or an ion storm is raging.
import { effectiveVision } from './modifiers';
import { teamOf } from './state';
import type { GameState, PlayerIndex, Unit } from './types';

export function fogActive(state: GameState): boolean {
  return state.fog || state.weather === 'ionstorm';
}

function revealed(state: GameState, team: number): boolean {
  return state.players.some((p) => p.team === team && !p.defeated && (p.revealTurns ?? 0) > 0);
}

/** Flat grid (index y * width + x), 1 = visible. null means everything is visible. */
export function visionGrid(state: GameState, player: PlayerIndex): Uint8Array | null {
  if (!fogActive(state)) return null;
  const team = teamOf(state, player);
  if (revealed(state, team)) return null;
  const W = state.width;
  const H = state.height;
  const grid = new Uint8Array(W * H);
  for (const u of state.units) {
    if (teamOf(state, u.owner) !== team) continue;
    const v = effectiveVision(state, u);
    for (let dy = -v; dy <= v; dy++) {
      const y = u.y + dy;
      if (y < 0 || y >= H) continue;
      const span = v - Math.abs(dy);
      const row = state.tiles[y];
      for (let dx = -span; dx <= span; dx++) {
        const x = u.x + dx;
        if (x < 0 || x >= W) continue;
        if (row[x].terrain === 'canopy' && Math.abs(dx) + Math.abs(dy) > 1) continue;
        grid[y * W + x] = 1;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    const row = state.tiles[y];
    for (let x = 0; x < W; x++) {
      const o = row[x].owner;
      if (o !== null && teamOf(state, o) === team) grid[y * W + x] = 1;
    }
  }
  return grid;
}

export function visibility(state: GameState, player: PlayerIndex): boolean[][] {
  const grid = visionGrid(state, player);
  const out: boolean[][] = [];
  for (let y = 0; y < state.height; y++) {
    const row: boolean[] = new Array(state.width);
    for (let x = 0; x < state.width; x++) row[x] = grid ? grid[y * state.width + x] === 1 : true;
    out.push(row);
  }
  return out;
}

/** Can `viewer` see this unit? Own/allied units are always visible. */
export function canSeeUnit(state: GameState, viewer: PlayerIndex, unit: Unit, grid?: Uint8Array | null): boolean {
  if (teamOf(state, unit.owner) === teamOf(state, viewer)) return true;
  const g = grid === undefined ? visionGrid(state, viewer) : grid;
  return !g || g[unit.y * state.width + unit.x] === 1;
}
