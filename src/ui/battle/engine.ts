// Adapter over the engine API (docs/ARCHITECTURE.md "Engine API"). The battle screen talks to the engine
// only through `E` so any naming drift is fixed in one place.
import type { Action, ApplyResult, Coord, GameState, Objective, PlayerIndex, TerrainType, Then, Tile, Unit, UnitTypeId, Weather, FactionId, CommanderId } from '../../engine/types';
import type { MapDef } from '../../content/types';
import { TERRAIN_TYPES, UNIT_TYPES } from '../../data';

export interface ReachEntry { x: number; y: number; cost: number; path: Coord[] }
export type ReachMap = Map<string, ReachEntry>;
export type ScoreCard = { speed: number; power: number; technique: number; total: number; rank: 'S' | 'A' | 'B' | 'C' };

export interface CreateGameOpts {
  map: MapDef;
  players: { faction: FactionId; commander: CommanderId; controller: 'human' | 'ai'; team: number; funds?: number; aiLevel?: 'cadet' | 'officer' | 'marshal' }[];
  fog?: boolean; weather?: Weather; objective?: Objective; turnLimit?: number;
  seed?: number; startFunds?: number; incomePerProperty?: number;
}

/** The documented engine surface the battle screen relies on. */
export interface EngineApi {
  createGame(opts: CreateGameOpts): GameState;
  applyAction(state: GameState, action: Action): ApplyResult;
  isLegal(state: GameState, action: Action): boolean;
  unitAt(state: GameState, c: Coord): Unit | undefined;
  unitById(state: GameState, id: number): Unit | undefined;
  tileAt(state: GameState, c: Coord): Tile;
  terrainAt(state: GameState, c: Coord): TerrainType;
  displayHp(hp: number): number;
  reachable(state: GameState, unitId: number): ReachMap;
  attackTargets(state: GameState, unitId: number, from: Coord): Coord[];
  attackRangeTiles(state: GameState, unitId: number): Coord[];
  thenOptions(state: GameState, unitId: number, dest: Coord): Then['kind'][];
  unloadTargets(state: GameState, transportId: number, dest: Coord, cargoIndex: number): Coord[];
  forecast(state: GameState, attackerId: number, from: Coord, target: Coord): { damage: [number, number]; counter: [number, number] | null };
  buildOptions(state: GameState, at: Coord): { type: UnitTypeId; cost: number; affordable: boolean }[];
  visibility(state: GameState, player: PlayerIndex): boolean[][];
  canActivatePower(state: GameState, level: 'surge' | 'overclock'): boolean;
  powerStars(state: GameState, player: PlayerIndex): { filled: number; surge: number; overclock: number };
  effectiveMove(state: GameState, unit: Unit): number;
  incomeOf(state: GameState, player: PlayerIndex): number;
  propertyCount(state: GameState, player: PlayerIndex): number;
  scoreCard(state: GameState, player: PlayerIndex): ScoreCard;
}

// TODO(integration): replace with `import * as Engine from '../../engine'` once src/engine/index.ts lands.
const found = import.meta.glob('../../engine/index.ts', { eager: true });
const mod = (found['../../engine/index.ts'] ?? null) as Partial<EngineApi> | null;
export const engineReady = !!mod && typeof mod.createGame === 'function';
export const E = (mod ?? {}) as EngineApi;

// ---------- small helpers the UI uses everywhere ----------
export const key = (c: Coord) => `${c.x},${c.y}`;
export const same = (a: Coord | null | undefined, b: Coord | null | undefined) => !!a && !!b && a.x === b.x && a.y === b.y;
export const manhattan = (a: Coord, b: Coord) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const isProduction = (t: Tile) => !!TERRAIN_TYPES[t.terrain]?.builds;

/** Step cost for a unit entering a tile (terrain rules only; the engine has the final say via isLegal). */
export function stepCost(state: GameState, unit: Unit, c: Coord): number | null {
  if (c.x < 0 || c.y < 0 || c.x >= state.width || c.y >= state.height) return null;
  const t = safeTerrain(state, c);
  const mt = UNIT_TYPES[unit.type].moveType;
  return t.cost[mt] ?? null;
}

export function safeTerrain(state: GameState, c: Coord): TerrainType {
  try {
    return E.terrainAt(state, c);
  } catch {
    return TERRAIN_TYPES[state.tiles[c.y]?.[c.x]?.terrain ?? 'flats'];
  }
}

export function pathCost(state: GameState, unit: Unit, path: Coord[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const c = stepCost(state, unit, path[i]);
    if (c == null) return Infinity;
    total += c;
  }
  return total;
}

export const unitsOf = (state: GameState, player: PlayerIndex) => state.units.filter((u) => u.owner === player);
export const readyUnits = (state: GameState, player: PlayerIndex) => unitsOf(state, player).filter((u) => !u.acted);
export const teamOf = (state: GameState, p: PlayerIndex) => state.players[p]?.team ?? -1;
export const isEnemy = (state: GameState, a: PlayerIndex, b: PlayerIndex) => teamOf(state, a) !== teamOf(state, b);
