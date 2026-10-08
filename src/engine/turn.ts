// Turn structure. Start of a player's turn, in order:
//   timed effects owned by the player count down (terrain conversion, weather, reveal)
//   → income → repair (+2 display HP, 10% of unit cost per HP) and resupply on own properties that build the
//   unit's domain (spire/arcology/fabricator: ground, skyport: air, dock: sea) → resupply next to own Mules
//   → charge drain (air −5, sea −1; skipped on cycle 1; units resupplied this turn are exempt) and crash/sink
//   at 0 → the player's power from last turn ends.
// End of turn: the player's enemyMove debuffs count down, then play passes to the next undefeated player.
import { TERRAIN_TYPES } from '../data';
import { destroyUnit } from './combat';
import { activeModifiers, sumField, unitCost, unitModifiers } from './modifiers';
import { displayHp, emit, forEachUnit, propertyIndex, unitType, writableTile } from './state';
import type { Ctx } from './state';
import { checkCycleEnd } from './victory';
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

export function startTurn(ctx: Ctx, p: PlayerIndex): void {
  const s = ctx.s;
  const pl = s.players[p];
  countDownTimedEffects(ctx, p);
  forEachUnit(s, (u) => {
    if (u.owner === p) u.acted = false;
  });

  const income = incomeOf(s, p);
  pl.funds += income;
  emit(ctx, { kind: 'turnStarted', player: p, cycle: s.cycle, income });

  const supplied = new Set<number>();
  const own = s.units.filter((u) => u.owner === p).sort((a, b) => a.id - b.id);
  for (const u of own) {
    const tile = s.tiles[u.y][u.x];
    const t = unitType(u.type);
    if (tile.owner !== p || !repairsDomain(tile.terrain, t.domain)) continue;
    supplied.add(u.id);
    refill(u);
    if (u.hp >= 100) continue;
    const price = unitCost(s, p, t);
    const steps = REPAIR_HP + sumField(unitModifiers(s, u), 'repairBonus');
    for (let a = steps; a > 0; a--) {
      const hp = Math.min(100, u.hp + a * 10);
      const cost = Math.round(((displayHp(hp) - displayHp(u.hp)) * price) / 10);
      if (cost > pl.funds) continue;
      pl.funds -= cost;
      emit(ctx, { kind: 'repaired', unitId: u.id, amount: hp - u.hp, cost });
      u.hp = hp;
      break;
    }
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
      const d = unitType(u.type).domain;
      if (d === 'ground' || supplied.has(u.id)) continue;
      u.charge = Math.max(0, u.charge - (d === 'air' ? 5 : 1));
      if (u.charge <= 0) destroyUnit(ctx, u, null, 'crashed');
    }
  }
  pl.powerState = 'none';
}

/** Passes play to the next undefeated player (closing the cycle when it wraps) and starts their turn. */
export function advanceTurn(ctx: Ctx): void {
  const s = ctx.s;
  const n = s.players.length;
  let next = -1;
  let wrapped = false;
  for (let k = 1; k <= n; k++) {
    if (s.current + k >= n) wrapped = true;
    const i = (s.current + k) % n;
    if (!s.players[i].defeated) {
      next = i;
      break;
    }
  }
  if (next < 0) return;
  if (wrapped) {
    checkCycleEnd(ctx, s.cycle);
    if (s.winnerTeam !== null) return;
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
