// Fog of war (docs/research/mechanics.md §9, with D-012.2).
// visibility()[y][x] answers "can this player see a unit standing on (x, y)?":
//   - every unit of the player's team sees the Manhattan diamond of its vision radius (own and allied units share);
//   - vision = type vision + commander `vision` modifiers, +3 for foot/exo on a ridge (D-012.2), −1 in an ion storm,
//     never below 1;
//   - an owned (or allied) property sees its own tile only;
//   - a ground unit on canopy is hidden unless an observer stands next to it (distance 1). Air units hover above
//     canopy and are not hidden by it; shoal and sea never hide anything;
//   - a unit with `hidden: true` (future stealth) is visible to enemies only when one of them is adjacent;
//   - `revealTurns > 0` (the 'reveal' power effect) lifts the fog for the user's whole team.
// Fog is on when the game has fog or an ion storm is raging; with fog off everything is visible.
import { sumField, unitModifiers } from './modifiers';
import { manhattan, teamOf, unitType } from './state';
import type { GameState, PlayerIndex, Unit } from './types';

/** Foot and exo units standing on a ridge see this much further (D-012.2; the AW mountain rule). */
const RIDGE_VISION_BONUS = 3;

export function fogActive(state: GameState): boolean {
  return state.fog || state.weather === 'ionstorm';
}

function revealed(state: GameState, team: number): boolean {
  return state.players.some((p) => p.team === team && !p.defeated && (p.revealTurns ?? 0) > 0);
}

/**
 * A unit's vision radius. This is computed here rather than through effectiveVision (modifiers.ts) because that one
 * still adds +1 on ridges; D-012.2 rules +3. Once modifiers.ts carries +3 the two agree and this can delegate.
 */
function unitVision(state: GameState, unit: Unit): number {
  const t = unitType(unit.type);
  let v = t.vision + sumField(unitModifiers(state, unit), 'vision');
  if (state.tiles[unit.y]?.[unit.x]?.terrain === 'ridge' && (t.moveType === 'foot' || t.moveType === 'exo')) {
    v += RIDGE_VISION_BONUS;
  }
  if (state.weather === 'ionstorm') v -= 1;
  return Math.max(1, v);
}

/**
 * What a team's units and properties see, before any hiding rule is applied. Flat grids (index y * width + x):
 * `seen` = inside some observer's vision (or on an owned property), `near` = on or next to a team unit.
 */
function observe(state: GameState, team: number): { seen: Uint8Array; near: Uint8Array } {
  const W = state.width;
  const H = state.height;
  const seen = new Uint8Array(W * H);
  const near = new Uint8Array(W * H);
  for (const u of state.units) {
    if (teamOf(state, u.owner) !== team) continue;
    const v = unitVision(state, u);
    for (let dy = -v; dy <= v; dy++) {
      const y = u.y + dy;
      if (y < 0 || y >= H) continue;
      const span = v - Math.abs(dy);
      for (let dx = -span; dx <= span; dx++) {
        const x = u.x + dx;
        if (x < 0 || x >= W) continue;
        seen[y * W + x] = 1;
        if (Math.abs(dx) + Math.abs(dy) <= 1) near[y * W + x] = 1;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    const row = state.tiles[y];
    for (let x = 0; x < W; x++) {
      const o = row[x].owner;
      if (o !== null && teamOf(state, o) === team) seen[y * W + x] = 1;
    }
  }
  return { seen, near };
}

/** Flat grid (index y * width + x), 1 = a unit standing there would be seen. null means everything is visible. */
export function visionGrid(state: GameState, player: PlayerIndex): Uint8Array | null {
  if (!fogActive(state)) return null;
  const team = teamOf(state, player);
  if (revealed(state, team)) return null;
  const { seen, near } = observe(state, team);
  const W = state.width;
  for (let y = 0; y < state.height; y++) {
    const row = state.tiles[y];
    for (let x = 0; x < W; x++) {
      // Canopy hides what stands on it unless an observer is adjacent (or standing on it).
      if (row[x].terrain === 'canopy' && !near[y * W + x]) seen[y * W + x] = 0;
    }
  }
  return seen;
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

/** Can `viewer` see this unit? Own/allied units are always visible. `grid` may be a visionGrid(viewer) computed earlier. */
export function canSeeUnit(state: GameState, viewer: PlayerIndex, unit: Unit, grid?: Uint8Array | null): boolean {
  const team = teamOf(state, viewer);
  if (teamOf(state, unit.owner) === team) return true;
  // Stealth: visible only to an adjacent enemy, fog or no fog.
  if (unit.hidden && !state.units.some((o) => teamOf(state, o.owner) === team && manhattan(o, unit) === 1)) return false;
  const g = grid === undefined ? visionGrid(state, viewer) : grid;
  if (!g) return true;
  const idx = unit.y * state.width + unit.x;
  if (g[idx] === 1) return true;
  // The grid hides everything on canopy; air units hover above it, so for them plain vision decides.
  if (state.tiles[unit.y][unit.x].terrain === 'canopy' && unitType(unit.type).domain === 'air') {
    return observe(state, team).seen[idx] === 1;
  }
  return false;
}
