// The fog-honest agent view (D-016). The player's agent (the Doctrine brain, or an MCP client) decides every in-battle action,
// so under fog it may only ever be given what its player can see. Three things live here:
//   observe(state, player)        what the agent is TOLD: a JSON-safe Observation (map, own units, visible enemies, public
//                                 lines of every player, the visible-tile mask). Never the raw state.
//   observedState(state, player)  the same knowledge as a GameState: every enemy unit the player cannot see removed, hidden capture
//                                 progress reset. Engine queries for that player run on it, so nothing the engine computes can
//                                 depend on a unit the player does not know about. It is for queries, not for sending anywhere:
//                                 it keeps engine bookkeeping (rng, nextUnitId, stats) that the agent must never be handed.
//   agentActions(state, player)   the agent's action list: legalActions on the observed state when it is that player's turn.
// Visibility is the engine's own (fog.ts): visionGrid / canSeeUnit, so "can the player see this unit" has one answer everywhere.
// With fog off everything is visible and the three collapse to the plain state and legalActions.
import { canSeeUnit, fogActive, visionGrid } from './fog';
import { legalActions } from './legal';
import { CAPTURE_POINTS, teamOf } from './state';
import type {
  Action, CommanderId, Deadline, FactionId, GameState, Objective, PlayerIndex, PowerState, TerrainId, Unit, Weather,
} from './types';

/** One map tile as the player knows it: terrain and owner are public; capture progress only where the player sees or owns. */
export interface ObservedTile {
  terrain: TerrainId;
  owner: PlayerIndex | null;
  /** Capture points left (20 = untouched). Absent on a tile the player neither sees nor owns. */
  capture?: number;
}

/** What every player may know about every other: no unit count, no stats, no fog state. */
export interface ObservedPlayer {
  index: PlayerIndex;
  faction: FactionId;
  commander: CommanderId;
  team: number;
  funds: number;
  /** The power meter in charge points (see power.ts). */
  power: number;
  powerState: PowerState;
  defeated: boolean;
}

/** Everything the agent is told about the battle. Plain data: it survives JSON.stringify / parse unchanged. */
export interface Observation {
  /** The player this view belongs to. */
  viewer: PlayerIndex;
  mapId: string;
  width: number;
  height: number;
  /** tiles[y][x] */
  tiles: ObservedTile[][];
  /** visible[y][x]: would a unit standing here be seen? (fog.ts visibility). All true with fog off. */
  visible: boolean[][];
  /** The viewer's own and allied units in full (cargo included), and enemy units only where canSeeUnit says so. */
  units: Unit[];
  players: ObservedPlayer[];
  cycle: number;
  current: PlayerIndex;
  weather: Weather;
  /** The game's fog setting. `fogActive` says whether fog is actually up (a raging ion storm raises it too). */
  fog: boolean;
  fogActive: boolean;
  objective: Objective;
  deadline?: Deadline;
  turnLimit?: number;
  winnerTeam: number | null;
}

function checkViewer(state: GameState, player: PlayerIndex): void {
  if (!Number.isInteger(player) || player < 0 || player >= state.players.length) {
    throw new RangeError(`no player ${String(player)} in a ${state.players.length}-player game`);
  }
}

/** The tile is in the viewer's sight, or it is held by the viewer's team (an owned property always sees its own tile). */
function knowsTile(state: GameState, grid: Uint8Array | null, team: number, x: number, y: number): boolean {
  if (!grid || grid[y * state.width + x] === 1) return true;
  const owner = state.tiles[y][x].owner;
  return owner !== null && teamOf(state, owner) === team;
}

/** The units this player's team can see: all of them with fog off, else canSeeUnit (own and allied units always pass). */
function visibleUnits(state: GameState, player: PlayerIndex, grid: Uint8Array | null): Unit[] {
  if (!fogActive(state)) return state.units;
  return state.units.filter((u) => canSeeUnit(state, player, u, grid));
}

/** What the agent is told about the battle, from `player`'s point of view. Never mutates `state`; the result shares nothing with it. */
export function observe(state: GameState, player: PlayerIndex): Observation {
  checkViewer(state, player);
  const grid = visionGrid(state, player);
  const team = teamOf(state, player);
  const seen = (x: number, y: number) => !grid || grid[y * state.width + x] === 1;
  const tiles = state.tiles.map((row, y) => row.map((t, x): ObservedTile => {
    const out: ObservedTile = { terrain: t.terrain, owner: t.owner };
    if (knowsTile(state, grid, team, x, y)) out.capture = t.capture;
    return out;
  }));
  const obs: Observation = {
    viewer: player,
    mapId: state.mapId,
    width: state.width,
    height: state.height,
    tiles,
    visible: state.tiles.map((row, y) => row.map((_, x) => seen(x, y))),
    units: structuredClone(visibleUnits(state, player, grid)),
    players: state.players.map((p): ObservedPlayer => ({
      index: p.index, faction: p.faction, commander: p.commander, team: p.team,
      funds: p.funds, power: p.power, powerState: p.powerState, defeated: p.defeated,
    })),
    cycle: state.cycle,
    current: state.current,
    weather: state.weather,
    fog: state.fog,
    fogActive: fogActive(state),
    objective: structuredClone(state.objective),
    winnerTeam: state.winnerTeam,
  };
  if (state.deadline) obs.deadline = { team: state.deadline.team, cycles: state.deadline.cycles };
  if (state.turnLimit !== undefined) obs.turnLimit = state.turnLimit;
  return obs;
}

/**
 * A copy of the state as `player` knows it: enemy units the player cannot see are gone and capture progress on tiles the player
 * neither sees nor owns is reset to untouched. Run the engine's queries on this, never on the true state, for that player's view.
 * With fog off the copy is the whole state. The input is not modified.
 */
export function observedState(state: GameState, player: PlayerIndex): GameState {
  checkViewer(state, player);
  const grid = visionGrid(state, player);
  const team = teamOf(state, player);
  const keep = new Set(visibleUnits(state, player, grid).map((u) => u.id));
  const copy = structuredClone(state);
  copy.units = copy.units.filter((u) => keep.has(u.id));
  for (let y = 0; y < copy.height; y++) {
    for (let x = 0; x < copy.width; x++) {
      if (!knowsTile(state, grid, team, x, y)) copy.tiles[y][x].capture = CAPTURE_POINTS;
    }
  }
  return copy;
}

/** Every action the player's agent may take now: legalActions on what the player knows, or [] when it is not that player's turn. */
export function agentActions(state: GameState, player: PlayerIndex): Action[] {
  checkViewer(state, player);
  if (state.current !== player) return [];
  return legalActions(observedState(state, player));
}
