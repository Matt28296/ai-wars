// THE CONTRACT. Engine, AI, content and UI all build against these types.
// Change only with the lead's agreement — other modules depend on every name here.

export type FactionId = 'helion' | 'tidewell' | 'verdant' | 'kestrel' | 'choir';
export type UnitTypeId =
  | 'trooper' | 'breacher' | 'skimmer' | 'lancer' | 'bastion' | 'colossus' | 'mule' | 'arc' | 'salvo' | 'warden'
  | 'wasp' | 'raptor' | 'anvil'
  | 'picket' | 'dreadnought' | 'barge';
export type TerrainId =
  | 'flats' | 'canopy' | 'ridge' | 'maglev' | 'span' | 'river' | 'sea' | 'shoal' | 'glass'
  | 'arcology' | 'fabricator' | 'skyport' | 'dock' | 'uplink' | 'spire';
export type MoveType = 'foot' | 'exo' | 'hover' | 'tread' | 'walker' | 'air' | 'sea' | 'barge';
export type Domain = 'ground' | 'air' | 'sea';
export type CommanderId = string; // see src/content/commanders.ts
export type PlayerIndex = number; // index into GameState.players

export interface Coord { x: number; y: number }

// ---------- static data ----------
export interface UnitType {
  id: UnitTypeId;
  name: string;
  role: string;
  domain: Domain;
  move: number;
  moveType: MoveType;
  cost: number;
  vision: number;
  charge: number;           // fuel
  ammo: number | null;      // null = no primary weapon (may still have a secondary — see damage.ts)
  range: [number, number] | null; // null = cannot attack; [1,1] = direct; min > 1 = indirect
  captures?: boolean;
  carries?: number;         // transport capacity
  supplies?: boolean;       // resupplies adjacent allies at turn start / on Supply
}

export interface TerrainType {
  id: TerrainId;
  name: string;
  def: number;              // defense stars 0–4
  note?: string;            // one-line rules hint for the terrain card
  property?: boolean;
  income?: number;
  builds?: Domain;
  boost?: number;           // uplink: +% firepower for every unit of the owner
  hq?: boolean;
  cost: Record<MoveType, number | null>; // null = impassable
}

// ---------- runtime state ----------
export interface Unit {
  id: number;
  type: UnitTypeId;
  owner: PlayerIndex;
  x: number;
  y: number;
  hp: number;               // 1–100 internal; displayed HP = ceil(hp / 10)
  charge: number;
  ammo: number;             // 0 when the type has no primary weapon
  acted: boolean;           // has moved/acted this turn (greyed out)
  cargo: Unit[];            // loaded units (their x/y mirror the transport)
  hidden?: boolean;         // future: stealth/dive
}

export interface Tile {
  terrain: TerrainId;
  owner: PlayerIndex | null; // properties only
  capture: number;           // capture points remaining, 20 when untouched
}

export type PowerState = 'none' | 'surge' | 'overclock';

export interface Player {
  index: PlayerIndex;
  faction: FactionId;
  commander: CommanderId;
  team: number;              // players on the same team never fight
  controller: 'human' | 'ai';
  aiLevel?: 'cadet' | 'officer' | 'marshal';
  funds: number;
  power: number;             // meter in charge points (see engine/power.ts: one star = POWER_STAR)
  powerUses: number;         // number of activations so far (AW2-style cost scaling)
  powerState: PowerState;    // active this turn
  defeated: boolean;
  stats: {
    damageDealt: number; damageTaken: number; unitsLost: number; unitsBuilt: number; unitsDestroyed: number;
    unitsStarted?: number;   // engine: units deployed at game start (for the Technique score)
  };
  revealTurns?: number;      // engine: 'reveal' power effect — fog ignored while > 0 (counts down at the start of this player's turns)
  moveEffects?: { delta: number; turnsLeft: number }[]; // engine: 'enemyMove' debuffs on this player's units (count down at the end of this player's turns)
}

export type Weather = 'clear' | 'ionstorm';

// tiles[y][x].terrain always holds the CURRENT terrain; an override remembers the original to restore.
export interface TerrainOverride { x: number; y: number; terrain: TerrainId; turnsLeft: number; original: TerrainId; owner?: PlayerIndex /* engine: counts down at the start of this player's turns */ }

export interface GameState {
  mapId: string;
  width: number;
  height: number;
  tiles: Tile[][];           // tiles[y][x]
  units: Unit[];             // top-level units on the map (cargo lives inside transports)
  players: Player[];
  current: PlayerIndex;
  cycle: number;             // starts at 1
  fog: boolean;
  weather: Weather;
  weatherTurnsLeft: number;
  terrainOverrides: TerrainOverride[]; // temporary terrain changes from CO powers
  nextUnitId: number;
  rng: number;               // seeded PRNG state (mulberry32); luck must come from here so replays are deterministic
  winnerTeam: number | null;
  turnLimit?: number;        // mission: survive/rout by this cycle
  objective: Objective;
  // engine bookkeeping (optional so older saves still load):
  weatherOwner?: PlayerIndex; // temporary weather counts down at the start of this player's turns (weatherTurnsLeft 0 = permanent)
  baseWeather?: Weather;      // weather restored when temporary weather expires
  incomePerProperty?: number; // createGame override of each income property's yield
}

export type Objective =
  | { kind: 'rout' }                                  // destroy all enemy units or capture their spire
  | { kind: 'hq' }                                    // capture the enemy spire (rout also wins)
  | { kind: 'survive'; cycles: number }               // hold out until cycle N ends
  | { kind: 'capture'; properties: number };          // own N properties

// ---------- actions ----------
export type Then =
  | { kind: 'wait' }
  | { kind: 'attack'; target: Coord }
  | { kind: 'capture' }
  | { kind: 'load' }                                  // destination holds a friendly transport
  | { kind: 'join' }                                  // destination holds a damaged friendly unit of the same type
  | { kind: 'supply' }                                // mule: resupply all adjacent allies
  | { kind: 'unload'; drops: { cargoIndex: number; to: Coord }[] };

export type Action =
  | { kind: 'move'; unitId: number; path: Coord[]; then: Then } // path[0] = current position; path may be length 1 (act in place)
  | { kind: 'build'; at: Coord; unitType: UnitTypeId }
  | { kind: 'power'; level: 'surge' | 'overclock' }
  | { kind: 'endTurn' }
  | { kind: 'resign' };

// Events describe what happened so the UI can animate it and the log can narrate it.
export type GameEvent =
  | { kind: 'moved'; unitId: number; path: Coord[] }
  | { kind: 'ambushed'; unitId: number; at: Coord; by: number } // movement stopped by a hidden enemy (fog)
  | { kind: 'attacked'; attackerId: number; defenderId: number; damage: number; counter: number; attackerHp: number; defenderHp: number; counterFirst?: boolean }
  | { kind: 'destroyed'; unitId: number; at: Coord; type: UnitTypeId; owner: PlayerIndex }
  | { kind: 'captureProgress'; unitId: number; at: Coord; remaining: number }
  | { kind: 'captured'; at: Coord; terrain: TerrainId; by: PlayerIndex; from: PlayerIndex | null }
  | { kind: 'loaded'; unitId: number; transportId: number }
  | { kind: 'unloaded'; unitId: number; transportId: number; to: Coord }
  | { kind: 'joined'; unitId: number; intoId: number; refund: number }
  | { kind: 'supplied'; byId: number; unitIds: number[] }
  | { kind: 'built'; unitId: number; type: UnitTypeId; at: Coord; owner: PlayerIndex; cost: number }
  | { kind: 'powerActivated'; player: PlayerIndex; level: 'surge' | 'overclock'; commander: CommanderId }
  | { kind: 'powerEffect'; player: PlayerIndex; description: string; affected: Coord[] }
  | { kind: 'turnEnded'; player: PlayerIndex }
  | { kind: 'turnStarted'; player: PlayerIndex; cycle: number; income: number }
  | { kind: 'repaired'; unitId: number; amount: number; cost: number }
  | { kind: 'crashed'; unitId: number; at: Coord }      // air/sea out of charge
  | { kind: 'weather'; weather: Weather; turns: number }
  | { kind: 'playerDefeated'; player: PlayerIndex; reason: 'rout' | 'hq' | 'resign' }
  | { kind: 'victory'; team: number };

export interface ApplyResult { state: GameState; events: GameEvent[] }

// ---------- CO power vocabulary (content declares, engine executes) ----------
export interface UnitFilter {
  domains?: Domain[];
  types?: UnitTypeId[];
  moveTypes?: MoveType[];
  indirect?: boolean;        // true = only range min > 1, false = only direct
  onTerrain?: TerrainId[];   // where the unit stands
}

export interface Modifier {
  filter?: UnitFilter;
  firepower?: number;        // additive % (e.g. +20, -10)
  defense?: number;          // additive %
  move?: number;             // additive tiles
  rangeMax?: number;         // indirect max range bonus
  vision?: number;
  costPercent?: number;      // production cost change in % (e.g. -20)
  terrainStars?: number;     // extra defense stars (only where terrain gives >= 0 stars, never for air)
  luckMax?: number;          // replaces the default luck ceiling (default 9)
  luckMin?: number;          // negative luck floor (default 0)
  ignoreMoveCost?: TerrainId[]; // these terrains cost 1 to enter
  counterFirst?: boolean;    // defender strikes first when attacked (ambush doctrine)
  repairBonus?: number;      // extra display HP repaired on owned properties
  incomePercent?: number;    // income change in %
  powerChargePercent?: number; // meter charge rate change in %
  indirectAfterMove?: boolean; // indirect units may move and fire this turn
}

export type InstantEffect =
  | { kind: 'heal'; hp: number; filter?: UnitFilter; resupply?: boolean }          // display HP to all own matching units
  | { kind: 'damageEnemies'; hp: number; filter?: UnitFilter }                     // never below 1 display HP
  | { kind: 'strike'; hp: number; radius: number; aim: 'mostValue' | 'mostUnits' } // area strike on the best enemy cluster
  | { kind: 'drainPower'; percent: number }                                        // each enemy loses % of meter
  | { kind: 'funds'; amount?: number; percentOfIncome?: number }
  | { kind: 'enemyFundsPercent'; percent: number }                                  // e.g. -25
  | { kind: 'convertTerrain'; from: TerrainId[]; to: TerrainId; adjacentTo: TerrainId; turns: number }
  | { kind: 'weather'; weather: Weather; turns: number }
  | { kind: 'reveal'; turns: number }                                               // ignore fog for the user
  | { kind: 'enemyMove'; delta: number; turns: number }
  | { kind: 'refresh'; filter?: UnitFilter; maxUnits?: number };                   // un-act units so they move again

export interface PowerDef {
  name: string;
  stars: number;             // base star cost
  quote: string;             // shouted on activation
  description: string;       // rules text shown in the CO screen
  modifiers: Modifier[];     // active for the rest of the turn (on top of the passive)
  effects: InstantEffect[];  // applied immediately on activation
}
