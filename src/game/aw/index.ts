// Ascendant Wars engine — the public API. Pure functions over an immutable GameState: applyAction returns a new
// state plus the events that describe what happened; the input is never modified. All randomness comes from
// state.rng, so a game replays exactly from its seed and action list.
import type { MapDef } from '../../content/types';
import { TERRAIN_CODES, TERRAIN_TYPES } from '../../data';
import { attackTargets, resolveAttack } from './combat';
import { applyCapture, canCaptureHere } from './capture';
import { IllegalActionError, illegal } from './errors';
import { canFireAfterMove } from './modifiers';
import { canJoinInto, canLoadInto, canStandOn, checkPath, isUnseenEnemy, unseenEnemyIds } from './movement';
import { activatePower, canActivatePower } from './power';
import { applyBuild } from './production';
import { seedRng } from './rng';
import { CAPTURE_POINTS, MAX_HP, cloneUnit, displayHp, draft, emit, inBounds, neighbours, removeUnit, resetCapture, unitAt, unitById, unitType } from './state';
import type { Ctx } from './state';
import { advanceTurn, endTurn, incomeOf, startTurn } from './turn';
import { checkGameOver, checkRout, defeatPlayer } from './victory';
import type {
  Action, ApplyResult, CommanderId, Coord, Deadline, FactionId, GameState, Objective, Player, Then, Tile, Unit, Weather,
} from './types';

export * from './types';
export { IllegalActionError } from './errors';
export { attackRangeTiles, attackTargets, forecast } from './combat';
export { canCaptureHere } from './capture';
export { canSeeUnit, visibility } from './fog';
export { effectiveMove, effectiveRange, effectiveVision, resetCommanderRegistry, setCommanderRegistry } from './modifiers';
export { reachable } from './movement';
export type { ReachEntry } from './movement';
export { POWER_STAR, canActivatePower, powerCost, powerStars } from './power';
export { MAX_UNITS_PER_PLAYER, buildOptions } from './production';
export type { BuildOption } from './production';
export { DEFAULT_PAR, scoreCard } from './score';
export { CAPTURE_POINTS, MAX_HP, displayHp, terrainAt, tileAt, unitAt, unitById } from './state';
export { incomeOf, propertyCount } from './turn';

// ---------------------------------------------------------------- setup

export interface PlayerSetup {
  faction: FactionId;
  commander: CommanderId;
  controller: 'human' | 'ai';
  team: number;
  funds?: number;
  aiLevel?: 'cadet' | 'officer' | 'marshal';
}

/**
 * How the player who moves first is paid back (M3.2). Measured with Doctrine against Doctrine: with no compensation seat 0 won 17 of
 * 20 on calder-fields, and swapping who owns what still gave 6 to 6, so the cause is the seat.
 *   'none'          no compensation: the original rule, kept for tests, for the campaign and for replays recorded before M3.2.
 *   'noFirstIncome' player 0 collects no income when cycle 1 starts (the one start of turn that createGame runs). Every other
 *                   start of turn, player 0's later ones included, pays as usual.
 *   'gradedFirstIncome'
 *                   (M3.3) player 0 collects part of that income: (n - 2) / (n - 1) of it in an n-player game, rounded to 100 funds. With
 *                   two players that is none of it (the same as 'noFirstIncome'); with three, half; with four, two thirds. The more
 *                   players there are, the less a turn's head start is worth to the one who has it, so the fine shrinks as they grow.
 *   'secondBonus'   every seat after player 0 starts with extra funds: seat k (k >= 1) gets 1000 x k on top of its starting funds,
 *                   so seat 1 gets +1000, seat 2 +2000, seat 3 +3000 -- each later seat gets 1000 more than the one before it.
 *                   Player 0 gets nothing. It is a flat sum paid at setup, before anybody's first income.
 */
export type FirstMoverRule = 'none' | 'noFirstIncome' | 'gradedFirstIncome' | 'secondBonus';
export const FIRST_MOVER_RULES: readonly FirstMoverRule[] = ['none', 'noFirstIncome', 'gradedFirstIncome', 'secondBonus'];
/**
 * The rule a TWO-player game gets when its options do not name one. Chosen by `pnpm balance` (Doctrine against Doctrine, 30 mirrored games
 * on each of calder-fields, tether-ridges and canopy-highlands, M3.2): player 0's share of the decided games, averaged over the three
 * maps, was 74% under 'none', 69% under 'secondBonus' and 59% under 'noFirstIncome', the nearest to a fair seat. The table is in D-019.
 * Games of three or more players get `defaultFirstMoverRule(n)`.
 */
export const DEFAULT_FIRST_MOVER_RULE: FirstMoverRule = 'noFirstIncome';
/** The rule a game of `playerCount` players gets when its options do not name one (M3.3): DEFAULT_FIRST_MOVER_RULE for two, 'gradedFirstIncome' for more. */
export function defaultFirstMoverRule(playerCount: number): FirstMoverRule {
  return playerCount <= 2 ? DEFAULT_FIRST_MOVER_RULE : 'gradedFirstIncome';
}
/** Under 'gradedFirstIncome', the share of player 0's first income that is paid in an n-player game: (n - 2) / (n - 1). */
export function gradedFirstIncomeShare(playerCount: number): number {
  return playerCount < 2 ? 1 : (playerCount - 2) / (playerCount - 1);
}
/** Extra starting funds per seat index under 'secondBonus'. */
export const SECOND_BONUS_PER_SEAT = 1000;

export interface CreateGameOptions {
  map: MapDef;
  players: PlayerSetup[];
  fog?: boolean;
  weather?: Weather;
  objective?: Objective;
  turnLimit?: number;      // versus day limit: standings decide the winner when this cycle ends (D-013)
  deadline?: Deadline;     // campaign "win by cycle N or `team` loses" (D-013); independent of turnLimit
  seed?: number;
  startFunds?: number;
  incomePerProperty?: number;
  /** Compensation for moving first (see FirstMoverRule). Absent = defaultFirstMoverRule(players.length); name 'none' for the old rule. */
  firstMoverRule?: FirstMoverRule;
}

/** Builds the starting state from a map and runs the first player's start of turn (income, repairs). */
export function createGame(opts: CreateGameOptions): GameState {
  const { map, players } = opts;
  const height = map.terrain.length;
  const width = height ? map.terrain[0].length : 0;
  if (!width || !height) throw new Error(`map ${map.id}: empty`);
  if (players.length < 2) throw new Error(`map ${map.id}: needs at least 2 players`);
  if (map.owners.length !== height) throw new Error(`map ${map.id}: owners has ${map.owners.length} rows, terrain has ${height}`);
  // A deadline that names no team, or fires at cycle 0 or 1.5, would silently never behave as written: refuse it.
  const dl = opts.deadline;
  if (dl) {
    if (!Number.isInteger(dl.cycles) || dl.cycles < 1) throw new Error(`map ${map.id}: deadline.cycles must be a whole number >= 1, got ${dl.cycles}`);
    if (!players.some((p) => p.team === dl.team)) throw new Error(`map ${map.id}: deadline.team ${dl.team} is not a team in this game`);
  }

  const rule = opts.firstMoverRule ?? defaultFirstMoverRule(players.length);
  if (!FIRST_MOVER_RULES.includes(rule)) throw new Error(`map ${map.id}: unknown firstMoverRule ${String(rule)} (use ${FIRST_MOVER_RULES.join(', ')})`);

  const tiles: Tile[][] = map.terrain.map((row, y) => {
    if (row.length !== width) throw new Error(`map ${map.id}: row ${y} is ${row.length} wide, expected ${width}`);
    const owners = map.owners[y];
    if (owners.length !== width) throw new Error(`map ${map.id}: owners row ${y} is ${owners.length} wide, expected ${width}`);
    return [...row].map((ch, x) => {
      const terrain = TERRAIN_CODES[ch];
      if (!terrain) throw new Error(`map ${map.id}: unknown terrain code '${ch}' at (${x},${y})`);
      const o = owners[x];
      let owner: number | null = null;
      if (o !== '.') {
        if (!TERRAIN_TYPES[terrain].property) throw new Error(`map ${map.id}: owner on non-property ${terrain} at (${x},${y})`);
        owner = Number(o);
        if (!Number.isInteger(owner) || owner < 0 || owner >= players.length) throw new Error(`map ${map.id}: bad owner '${o}' at (${x},${y})`);
      }
      return { terrain, owner, capture: CAPTURE_POINTS };
    });
  });

  let nextUnitId = 1;
  const units: Unit[] = [];
  for (const u of map.units) {
    const t = unitType(u.type);
    if (!t) throw new Error(`map ${map.id}: unknown unit type ${u.type}`);
    if (u.owner < 0 || u.owner >= players.length) throw new Error(`map ${map.id}: unit owner ${u.owner} out of range`);
    if (!inBounds({ width, height } as GameState, u)) throw new Error(`map ${map.id}: unit at (${u.x},${u.y}) is off the map`);
    if (!canStandOn(tiles[u.y][u.x].terrain, t.moveType)) throw new Error(`map ${map.id}: ${u.type} cannot stand on ${tiles[u.y][u.x].terrain} at (${u.x},${u.y})`);
    if (units.some((o) => o.x === u.x && o.y === u.y)) throw new Error(`map ${map.id}: two units at (${u.x},${u.y})`);
    units.push({
      id: nextUnitId++, type: u.type, owner: u.owner, x: u.x, y: u.y,
      hp: Math.max(1, Math.min(10, u.hp ?? 10)) * 10, charge: t.charge, ammo: t.ammo ?? 0, acted: false, cargo: [],
    });
  }

  const playerStates: Player[] = players.map((p, index) => ({
    index, faction: p.faction, commander: p.commander, team: p.team, controller: p.controller,
    ...(p.aiLevel ? { aiLevel: p.aiLevel } : {}),
    funds: (p.funds ?? opts.startFunds ?? 0) + (rule === 'secondBonus' ? SECOND_BONUS_PER_SEAT * index : 0),
    power: 0, powerUses: 0, powerState: 'none', defeated: false,
    stats: {
      damageDealt: 0, damageTaken: 0, unitsLost: 0, unitsBuilt: 0, unitsDestroyed: 0,
      unitsStarted: units.filter((u) => u.owner === index).length,
    },
  }));

  const weather = opts.weather ?? 'clear';
  const state: GameState = {
    mapId: map.id, width, height, tiles, units, players: playerStates,
    current: 0, cycle: 1, fog: !!opts.fog, weather, weatherTurnsLeft: 0, baseWeather: weather,
    terrainOverrides: [], nextUnitId, rng: seedRng(opts.seed ?? 1), winnerTeam: null,
    objective: opts.objective ?? { kind: 'rout' },
    ...(opts.turnLimit !== undefined ? { turnLimit: opts.turnLimit } : {}),
    ...(dl ? { deadline: { team: dl.team, cycles: dl.cycles } } : {}),
    ...(opts.incomePerProperty !== undefined ? { incomePerProperty: opts.incomePerProperty } : {}),
  };
  // 'gradedFirstIncome': player 0's first start of turn pays a share of its income, paid in here and not through startTurn, which then pays
  // none. The share is in the funds before the repairs run, as income is in startTurn, so what the first turn can afford is the same.
  if (rule === 'gradedFirstIncome') {
    const paid = Math.round((incomeOf(state, 0) * gradedFirstIncomeShare(players.length)) / 100) * 100;
    state.players[0].funds += paid;
  }
  const ctx = draft(state);
  startTurn(ctx, 0, { noIncome: rule === 'noFirstIncome' || rule === 'gradedFirstIncome' });
  return ctx.s;
}

// ---------------------------------------------------------------- queries

/** A view of the state with one unit standing at `dest` — what the command menu and targeting see after a move. */
export function withUnitAt(state: GameState, unitId: number, dest: Coord): GameState {
  return { ...state, units: state.units.map((u) => (u.id === unitId ? { ...u, x: dest.x, y: dest.y } : u)) };
}

function otherUnitAt(state: GameState, c: Coord, selfId: number): Unit | undefined {
  const u = unitAt(state, c);
  return u && u.id !== selfId ? u : undefined;
}

function transportCanDrop(state: GameState, transport: Unit, at: Coord): boolean {
  // Naval transports beach on shoals and docks only.
  if (unitType(transport.type).domain !== 'sea') return true;
  const t = state.tiles[at.y][at.x].terrain;
  return t === 'shoal' || t === 'dock';
}

/** A tile next to the destination that a drop may be ordered onto: free, or holding an enemy the transport's team cannot see
 *  (`blockedBy`). The drop onto the second kind is accepted and fails (D-016): the cargo stays aboard, 'dropBlocked'. */
interface DropSite { to: Coord; blockedBy: Unit | null }

function dropSites(state: GameState, transportId: number, dest: Coord, cargoIndex: number, isHidden?: (u: Unit) => boolean): DropSite[] {
  const transport = unitById(state, transportId);
  if (!transport || !state.units.includes(transport)) return [];
  const cargo = transport.cargo[cargoIndex];
  if (!cargo || !transportCanDrop(state, transport, dest)) return [];
  const mt = unitType(cargo.type).moveType;
  const hidden = isHidden ?? ((u: Unit) => isUnseenEnemy(state, transport.owner, u));
  const out: DropSite[] = [];
  for (const c of neighbours(state, dest)) {
    if (!canStandOn(state.tiles[c.y][c.x].terrain, mt)) continue;
    const other = otherUnitAt(state, c, transport.id);
    if (!other) out.push({ to: c, blockedBy: null });
    else if (hidden(other)) out.push({ to: c, blockedBy: other });
  }
  return out;
}

/** Tiles next to `dest` where cargo number `cargoIndex` can be dropped if the transport ends its move at `dest`. `state` is
 *  the state at the moment of the order, BEFORE the move: what the team can see is decided then, even if arriving would
 *  reveal more (D-016). A tile that holds an enemy the team cannot see counts as free (it looks free); dropping there fails
 *  and the cargo stays aboard ('dropBlocked'). */
export function unloadTargets(state: GameState, transportId: number, dest: Coord, cargoIndex: number): Coord[] {
  return dropSites(state, transportId, dest, cargoIndex).map((site) => site.to);
}

/** What the command menu offers if the unit ends its move at `dest`, in display order. Empty = it cannot stop there. */
export function thenOptions(state: GameState, unitId: number, dest: Coord): Then['kind'][] {
  const unit = unitById(state, unitId);
  if (!unit || !state.units.includes(unit)) return [];
  const occupant = otherUnitAt(state, dest, unit.id);
  // An enemy the mover cannot see looks like an empty tile (D-016): the menu is the empty tile's, and the move itself
  // will end in an ambush on the tile before it (checkPath), so the player cannot tell this tile from a free one.
  if (occupant && !isUnseenEnemy(state, unit.owner, occupant)) {
    if (canJoinInto(unit, occupant)) return ['join'];
    if (canLoadInto(unit, occupant)) return ['load'];
    return [];
  }
  const out: Then['kind'][] = [];
  const view = withUnitAt(state, unit.id, dest);
  if (targetsFrom(state, unit, dest).length) out.push('attack');
  if (canCaptureHere(state, unit, dest.x, dest.y)) out.push('capture');
  if (unit.cargo.some((_, i) => unloadTargets(state, unit.id, dest, i).length)) out.push('unload');
  if (unitType(unit.type).supplies && neighbours(state, dest).some((c) => {
    const n = otherUnitAt(view, c, unit.id);
    return !!n && n.owner === unit.owner;
  })) out.push('supply');
  out.push('wait');
  return out;
}

/** Targets from `dest`, seen from there. Indirect units may not move and fire unless a power allows it. */
function targetsFrom(state: GameState, unit: Unit, dest: Coord): Coord[] {
  const moved = !sameTile(dest, unit);
  const t = unitType(unit.type);
  if (moved && t.range && t.range[0] > 1 && !canFireAfterMove(state, unit, dest)) return [];
  return attackTargets(withUnitAt(state, unit.id, dest), unit.id, dest);
}

/** True when applyAction would accept the action. */
export function isLegal(state: GameState, action: Action): boolean {
  try {
    applyAction(state, action);
    return true;
  } catch (err) {
    if (err instanceof IllegalActionError) return false;
    throw err;
  }
}

// ---------------------------------------------------------------- actions

function sameTile(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

function afterAction(ctx: Ctx): void {
  checkRout(ctx);
  checkGameOver(ctx);
  // A player routed on their own turn (their last unit died to a counter-attack) cannot act: pass the turn on, the
  // same as the resign path and the turn-start path (D-015.5). Found by the seeded simulations (BUG-1).
  if (ctx.s.winnerTeam === null && ctx.s.players[ctx.s.current]?.defeated) advanceTurn(ctx);
}

function refill(u: Unit): boolean {
  const t = unitType(u.type);
  const ammo = t.ammo ?? 0;
  const changed = u.charge !== t.charge || u.ammo !== ammo;
  u.charge = t.charge;
  u.ammo = ammo;
  return changed;
}

function applyMove(ctx: Ctx, action: Extract<Action, { kind: 'move' }>): void {
  const before = ctx.s;
  const s = ctx.s;
  const unit = s.units.find((u) => u.id === action.unitId);
  if (!unit) illegal(`unit ${action.unitId} is not on the map (it may be loaded in a transport)`);
  if (unit.owner !== s.current) illegal('that unit belongs to another player');
  if (unit.acted) illegal('that unit has already acted this turn');

  const check = checkPath(before, unit, action.path);
  const ambushed = check.stop < action.path.length - 1;
  const dest = action.path[check.stop];
  const moved = !sameTile(dest, unit);

  // Validate the follow-up against the state the unit will see at its destination (skipped when ambushed:
  // the move is cut short and the unit simply waits).
  const then = action.then;
  if (!ambushed) {
    const options = thenOptions(before, unit.id, dest);
    if (!options.includes(then.kind)) illegal(`cannot ${then.kind} at (${dest.x},${dest.y})`);
    if (then.kind === 'attack' && !targetsFrom(before, unit, dest).some((t) => sameTile(t, then.target))) {
      illegal('that target is not in range');
    }
  }

  // Who the mover's team cannot see is decided now, at the moment of the order, before the move changes what it sees (D-016).
  const unseenAtOrder = then.kind === 'unload' && !ambushed ? unseenEnemyIds(before, unit.owner) : null;

  // Move.
  if (moved) {
    resetCapture(ctx, unit);
    unit.charge -= check.stop;
    unit.x = dest.x;
    unit.y = dest.y;
    for (const c of unit.cargo) {
      c.x = dest.x;
      c.y = dest.y;
    }
  }
  emit(ctx, { kind: 'moved', unitId: unit.id, path: action.path.slice(0, check.stop + 1).map((c) => ({ x: c.x, y: c.y })) });
  unit.acted = true;

  if (ambushed) {
    emit(ctx, { kind: 'ambushed', unitId: unit.id, at: { x: dest.x, y: dest.y }, by: check.ambusher!.id });
    return;
  }

  switch (then.kind) {
    case 'wait':
      return;
    case 'attack':
      resolveAttack(ctx, unit, then.target);
      return;
    case 'capture':
      applyCapture(ctx, unit);
      return;
    case 'load': {
      const transport = s.units.find((u) => u.id !== unit.id && u.x === dest.x && u.y === dest.y)!;
      removeUnit(ctx, unit.id);
      transport.cargo.push(unit);
      emit(ctx, { kind: 'loaded', unitId: unit.id, transportId: transport.id });
      return;
    }
    case 'join': {
      const target = s.units.find((u) => u.id !== unit.id && u.x === dest.x && u.y === dest.y)!;
      const t = unitType(target.type);
      const total = displayHp(target.hp) + displayHp(unit.hp);
      const refund = Math.max(0, total - 10) * Math.round(t.cost / 10);
      target.hp = Math.min(MAX_HP, target.hp + unit.hp);
      target.charge = Math.min(t.charge, target.charge + unit.charge);
      target.ammo = Math.min(t.ammo ?? 0, target.ammo + unit.ammo);
      target.acted = true;
      removeUnit(ctx, unit.id);
      s.players[unit.owner].funds += refund;
      emit(ctx, { kind: 'joined', unitId: unit.id, intoId: target.id, refund });
      return;
    }
    case 'supply': {
      const ids: number[] = [];
      for (const c of neighbours(s, dest)) {
        const n = otherUnitAt(s, c, unit.id);
        if (n && n.owner === unit.owner && refill(n)) ids.push(n.id);
      }
      emit(ctx, { kind: 'supplied', byId: unit.id, unitIds: ids });
      return;
    }
    case 'unload': {
      if (!then.drops.length) illegal('unload needs at least one drop');
      const used = new Set<number>();
      const tiles = new Set<string>();
      const plan: { cargo: Unit; to: Coord; blockedBy: Unit | null }[] = [];
      for (const d of then.drops) {
        if (used.has(d.cargoIndex)) illegal('each cargo unit can be dropped once');
        if (tiles.has(`${d.to.x},${d.to.y}`)) illegal('two units cannot be dropped on one tile');
        const site = dropSites(s, unit.id, dest, d.cargoIndex, (u) => unseenAtOrder!.has(u.id)).find((c) => sameTile(c.to, d.to));
        if (!site) illegal(`cargo ${d.cargoIndex} cannot be dropped at (${d.to.x},${d.to.y})`);
        used.add(d.cargoIndex);
        tiles.add(`${d.to.x},${d.to.y}`);
        plan.push({ cargo: unit.cargo[d.cargoIndex], to: d.to, blockedBy: site.blockedBy });
      }
      // A drop onto a tile that holds a hidden enemy fails: that cargo stays aboard, the other drop still happens, and the
      // transport's action is over either way (D-016, mechanics.md 9.4).
      const landed = new Set(plan.filter((p) => !p.blockedBy).map((p) => p.cargo.id));
      unit.cargo = unit.cargo.filter((c) => !landed.has(c.id));
      for (const { cargo, to, blockedBy } of plan) {
        if (blockedBy) {
          emit(ctx, { kind: 'dropBlocked', transportId: unit.id, cargoId: cargo.id, at: { x: to.x, y: to.y }, by: blockedBy.id });
          continue;
        }
        const c = cloneUnit(cargo);
        c.x = to.x;
        c.y = to.y;
        c.acted = true;
        s.units.push(c);
        emit(ctx, { kind: 'unloaded', unitId: c.id, transportId: unit.id, to: { x: to.x, y: to.y } });
      }
      return;
    }
  }
}

/** Applies one action for the current player. Throws IllegalActionError when the action is not allowed. */
export function applyAction(state: GameState, action: Action): ApplyResult {
  if (state.winnerTeam !== null) illegal('the game is over');
  const ctx = draft(state);
  switch (action.kind) {
    case 'move':
      applyMove(ctx, action);
      break;
    case 'build':
      applyBuild(ctx, action.at, action.unitType);
      break;
    case 'power':
      if (!canActivatePower(state, action.level)) illegal(`${action.level} is not available`);
      activatePower(ctx, action.level);
      break;
    case 'endTurn':
      endTurn(ctx);
      break;
    case 'resign': {
      const p = ctx.s.current;
      defeatPlayer(ctx, p, 'resign');
      checkGameOver(ctx);
      if (ctx.s.winnerTeam === null) advanceTurn(ctx);
      break;
    }
    default:
      illegal(`unknown action ${(action as { kind: string }).kind}`);
  }
  afterAction(ctx);
  return { state: ctx.s, events: ctx.events };
}
