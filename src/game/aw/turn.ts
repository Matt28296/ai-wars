// Turn structure. Start of a player's turn, in order (docs/research/mechanics.md §2.1, with D-012):
//   timed effects owned by the player count down (terrain conversion, weather, reveal)
//   1. the player's power from their last turn ends
//   2. their units un-act
//   3. income (CO incomePercent applies)
//   4. repair (+2 display HP, 10% of unit cost per HP; 1 HP if short of funds) and resupply on own properties that
//      service the unit's domain (spire/arcology/fabricator: ground, skyport: air, dock: sea), row-major
//   5. resupply next to own Mules
//   6. charge drain by the unit's own `drain` (from cycle 2; units resupplied in 4-5 are exempt)
//   7. crash/sink: air and sea units at 0 charge are destroyed
//   8. D-015.5: if that left the player with no units (and they have had units), they are routed at once, the victory
//      check runs, and play passes straight to the next undefeated player -- no 'turnStarted' is emitted for them
//   9. 'turnStarted' is emitted last. (Later victory checks run in applyAction's afterAction.)
// End of turn: the player's enemyMove debuffs count down, then play passes to the next undefeated player.
import { TERRAIN_TYPES } from '../../data';
import { destroyUnit } from './combat';
import { activeModifiers, sumField, unitCost, unitModifiers } from './modifiers';
import { MAX_HP, displayHp, emit, forEachUnit, propertyIndex, unitType, writableTile } from './state';
import type { Ctx } from './state';
import { checkCycleEnd, checkGameOver, defeatPlayer, isRouted } from './victory';
import type { Domain, GameState, PlayerIndex, TerrainId, Unit } from './types';

export const REPAIR_HP = 2;

export function propertyCount(state: GameState, p: PlayerIndex): number {
  return propertyIndex(state).props[p] ?? 0;
}

/** Funds the player will receive at the start of their turn. */
export function incomeOf(state: GameState, p: PlayerIndex): number {
  const base = propertyIndex(state).income[p] ?? 0;
  const pct = sumField(activeModifiers(state, p), 'incomePercent');
  return Math.max(0, Math.floor((base * (100 + pct)) / 100));
}

/** Whether this tile repairs/resupplies a unit of this domain for its owner. */
export function repairsDomain(terrain: TerrainId, domain: Domain): boolean {
  const tt = TERRAIN_TYPES[terrain];
  if (!tt.property) return false;
  if (tt.builds) return tt.builds === domain;
  return (tt.id === 'arcology' || !!tt.hq) && domain === 'ground';
}

function refill(u: Unit): boolean {
  const t = unitType(u.type);
  const ammo = t.ammo ?? 0;
  const changed = u.charge !== t.charge || u.ammo !== ammo;
  u.charge = t.charge;
  u.ammo = ammo;
  return changed;
}

function countDownTimedEffects(ctx: Ctx, p: PlayerIndex): void {
  const s = ctx.s;
  const owns = (owner: PlayerIndex | undefined) => owner === undefined || owner === p || !!s.players[owner]?.defeated;
  if (s.terrainOverrides.length) {
    const keep = [];
    for (const o of s.terrainOverrides) {
      if (owns(o.owner)) {
        const n = { ...o, turnsLeft: o.turnsLeft - 1 };
        if (n.turnsLeft <= 0) writableTile(ctx, o.x, o.y).terrain = o.original;
        else keep.push(n);
      } else keep.push(o);
    }
    s.terrainOverrides = keep;
  }
  if (s.weatherTurnsLeft > 0 && owns(s.weatherOwner)) {
    s.weatherTurnsLeft -= 1;
    if (s.weatherTurnsLeft <= 0) {
      s.weatherTurnsLeft = 0;
      const base = s.baseWeather ?? 'clear';
      delete s.weatherOwner;
      if (s.weather !== base) {
        s.weather = base;
        emit(ctx, { kind: 'weather', weather: base, turns: 0 });
      }
    }
  }
  const pl = s.players[p];
  if (pl.revealTurns !== undefined) {
    pl.revealTurns -= 1;
    if (pl.revealTurns <= 0) delete pl.revealTurns;
  }
}

/** Row-major (y, then x), so a short purse always repairs the same units first. */
const rowMajor = (a: Unit, b: Unit) => a.y - b.y || a.x - b.x;

/** +2 display HP (plus repairBonus) at 10% of the unit's price per HP; with a short purse, as many HP as it covers. */
function repairUnit(ctx: Ctx, u: Unit): void {
  const s = ctx.s;
  if (u.hp >= MAX_HP) return;
  const pl = s.players[u.owner];
  const price = unitCost(s, u.owner, unitType(u.type), u);
  const shown = displayHp(u.hp);
  const steps = REPAIR_HP + sumField(unitModifiers(s, u), 'repairBonus');
  for (let a = steps; a > 0; a--) {
    const hp = Math.min(MAX_HP, (shown + a) * 10);
    const cost = Math.round(((displayHp(hp) - shown) * price) / 10);
    if (cost > pl.funds) continue;
    pl.funds -= cost;
    emit(ctx, { kind: 'repaired', unitId: u.id, amount: hp - u.hp, cost });
    u.hp = hp;
    return;
  }
}

/** `noIncome`: this start of turn pays nothing (the 'noFirstIncome' first-mover rule, see createGame): no funds, and the 'turnStarted' event says 0. */
export interface StartTurnOptions { noIncome?: boolean }

export function startTurn(ctx: Ctx, p: PlayerIndex, opts: StartTurnOptions = {}): void {
  const s = ctx.s;
  const pl = s.players[p];
  countDownTimedEffects(ctx, p);
  pl.powerState = 'none'; // §2.1 step 1: last turn's power is over before income, repair or cost modifiers are read
  forEachUnit(s, (u) => {
    if (u.owner === p) u.acted = false;
  });

  const income = opts.noIncome ? 0 : incomeOf(s, p);
  pl.funds += income;

  const supplied = new Set<number>();
  const own = s.units.filter((u) => u.owner === p).sort(rowMajor);
  for (const u of own) {
    const tile = s.tiles[u.y][u.x];
    if (tile.owner !== p || !repairsDomain(tile.terrain, unitType(u.type).domain)) continue;
    supplied.add(u.id);
    refill(u);
    repairUnit(ctx, u);
  }
  for (const m of own) {
    if (!unitType(m.type).supplies) continue;
    const ids: number[] = [];
    for (const u of own) {
      if (u.id === m.id || Math.abs(u.x - m.x) + Math.abs(u.y - m.y) !== 1) continue;
      supplied.add(u.id);
      if (refill(u)) ids.push(u.id);
    }
    if (ids.length) emit(ctx, { kind: 'supplied', byId: m.id, unitIds: ids });
  }
  if (s.cycle > 1) {
    for (const u of own) {
      const drain = unitType(u.type).drain ?? 0;
      if (drain > 0 && !supplied.has(u.id)) u.charge = Math.max(0, u.charge - drain);
    }
  }
  for (const u of own) {
    if (unitType(u.type).domain !== 'ground' && u.charge <= 0) destroyUnit(ctx, u, null, 'crashed');
  }
  // D-015.5: losing the last unit during turn start routes the player now, in any size of game.
  if (isRouted(s, pl)) {
    defeatPlayer(ctx, p, 'rout');
    checkGameOver(ctx);
    if (s.winnerTeam === null) advanceTurn(ctx); // s.current is still p, so the cycle counter wraps correctly
    return;
  }
  emit(ctx, { kind: 'turnStarted', player: p, cycle: s.cycle, income });
}

/** The next undefeated player after `s.current` in turn order, and whether reaching them wraps into a new cycle. */
function nextUndefeated(s: GameState): { next: number; wrapped: boolean } {
  const n = s.players.length;
  let wrapped = false;
  for (let k = 1; k <= n; k++) {
    if (s.current + k >= n) wrapped = true;
    const i = (s.current + k) % n;
    if (!s.players[i].defeated) return { next: i, wrapped };
  }
  return { next: -1, wrapped };
}

/** Passes play to the next undefeated player (closing the cycle when it wraps) and starts their turn. */
export function advanceTurn(ctx: Ctx): void {
  const s = ctx.s;
  const first = nextUndefeated(s);
  let next = first.next;
  if (next < 0) return;
  if (first.wrapped) {
    checkCycleEnd(ctx, s.cycle);
    if (s.winnerTeam !== null) return;
    // The end-of-cycle checks (a campaign deadline) can defeat players, so who is next must be read again.
    ({ next } = nextUndefeated(s));
    if (next < 0) return;
    s.cycle += 1;
  }
  s.current = next;
  startTurn(ctx, next);
}

export function endTurn(ctx: Ctx): void {
  const s = ctx.s;
  const p = s.current;
  const pl = s.players[p];
  emit(ctx, { kind: 'turnEnded', player: p });
  if (pl.moveEffects) {
    const left = pl.moveEffects.map((e) => ({ ...e, turnsLeft: e.turnsLeft - 1 })).filter((e) => e.turnsLeft > 0);
    if (left.length) pl.moveEffects = left;
    else delete pl.moveEffects;
  }
  advanceTurn(ctx);
}
