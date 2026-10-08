// Combat (docs/research/mechanics.md section 4): weapon choice, the damage formula, counters, forecasts and threat ranges.
//
//   damage = floor((B × ATK/100 + luck) × (AHP/10) × (200 − (DEF + stars × DHP)) / 100)
//
// computed in exact integer arithmetic. B = chart value (primary if it has an entry and ammo > 0, else
// secondary), ATK = 100 + firepower %, DEF = 100 + defense %, AHP/DHP = display HP, stars = terrain stars
// (0 for air). Damage is in internal HP (1–100). Luck always comes from state.rng: the attack's draw first,
// the counter's second (the counter-first doctrine reverses the order, as the strikes do).
import { DAMAGE } from '../../data/damage';
import { illegal } from './errors';
import { fogActive, visionGrid } from './fog';
import {
  canFireAfterMove, defenseBonus, effectiveRange, firepowerBonus, hasCounterFirst, luckRange, terrainStarsFor,
} from './modifiers';
import { reachable } from './movement';
import { gainPower } from './power';
import { randomInt } from './rng';
import { areEnemies, displayHp, emit, isIndirectType, manhattan, removeUnit, resetCapture, unitAt, unitById, unitType } from './state';
import type { Ctx } from './state';
import type { Coord, GameState, PlayerIndex, Unit, UnitTypeId } from './types';

export interface Weapon { base: number; primary: boolean }

/** The weapon an attacker of this type would use against the defender type, or null if it cannot. */
export function weaponAgainst(attacker: UnitTypeId, defender: UnitTypeId, ammo: number): Weapon | null {
  const row = DAMAGE[attacker];
  if (!row) return null;
  const p = row.primary?.[defender];
  if (p !== undefined && ammo > 0) return { base: p, primary: true };
  const s = row.secondary?.[defender];
  if (s !== undefined) return { base: s, primary: false };
  return null;
}

/** One strike's damage in internal HP (not capped at the defender's HP). */
export function damageValue(
  state: GameState, attacker: Unit, aPos: Coord, aHp: number, defender: Unit, dPos: Coord, dHp: number, luck: number, base: number,
): number {
  const atk = 100 + firepowerBonus(state, attacker, aPos);
  const def = 100 + defenseBonus(state, defender, dPos);
  const stars = terrainStarsFor(state, defender, dPos);
  const ahp = displayHp(aHp);
  const dhp = displayHp(dHp);
  const offense = base * atk + 100 * luck; // = 100 × (B × ATK/100 + luck)
  if (offense <= 0 || ahp <= 0) return 0;
  const defense = 200 - def - stars * dhp;
  if (defense <= 0) return 0;
  return Math.floor((offense * ahp * defense) / 100000);
}

/** Spec 4.6: a surviving, direct defender with a usable weapon against a direct attacker that struck from an adjacent tile. */
export function canCounter(defender: Unit, attacker: Unit, distance: number): boolean {
  if (distance !== 1 || defender.hp <= 0) return false;
  if (isIndirectType(unitType(attacker.type))) return false;
  const r = unitType(defender.type).range;
  if (!r || r[0] !== 1) return false;
  return weaponAgainst(defender.type, attacker.type, defender.ammo) !== null;
}

/** True when the unit has any weapon it could fire right now (a primary with ammo, or any secondary). */
function hasUsableWeapon(unit: Unit): boolean {
  const row = DAMAGE[unit.type];
  if (!row) return false;
  if (unit.ammo > 0 && row.primary && Object.keys(row.primary).length > 0) return true;
  return !!row.secondary && Object.keys(row.secondary).length > 0;
}

function topLevel(state: GameState, id: number): Unit | undefined {
  for (const u of state.units) if (u.id === id) return u;
  return undefined;
}

/** Enemy units this unit could attack if it stood at `from` (indirect: only from where it is, unless a power allows). */
export function attackTargets(state: GameState, unitId: number, from: Coord): Coord[] {
  const unit = topLevel(state, unitId);
  if (!unit) return [];
  const range = effectiveRange(state, unit, from);
  if (!range) return [];
  const t = unitType(unit.type);
  const moved = from.x !== unit.x || from.y !== unit.y;
  if (moved && isIndirectType(t) && !canFireAfterMove(state, unit, from)) return [];
  // Fog: what the unit sees is measured from where it would stand, not from where it stands now.
  const seen = moved ? { ...state, units: state.units.map((u) => (u.id === unit.id ? { ...u, x: from.x, y: from.y } : u)) } : state;
  const grid = fogActive(seen) ? visionGrid(seen, unit.owner) : null;
  const out: Coord[] = [];
  for (const e of state.units) {
    if (!areEnemies(state, unit.owner, e.owner)) continue;
    const d = manhattan(from, e);
    if (d < range[0] || d > range[1]) continue;
    if (grid && grid[e.y * state.width + e.x] !== 1) continue;
    if (!weaponAgainst(t.id, e.type, unit.ammo)) continue;
    out.push({ x: e.x, y: e.y });
  }
  return out;
}

/** Threat preview: every tile the unit could strike this turn (move + fire for direct units). */
export function attackRangeTiles(state: GameState, unitId: number): Coord[] {
  const unit = topLevel(state, unitId);
  if (!unit || !unitType(unit.type).range || !hasUsableWeapon(unit)) return [];
  const t = unitType(unit.type);
  const origins: Coord[] =
    isIndirectType(t) && !canFireAfterMove(state, unit) ? [{ x: unit.x, y: unit.y }] : [...reachable(state, unitId).values()];
  const W = state.width;
  const H = state.height;
  const mark = new Uint8Array(W * H);
  for (const o of origins) {
    const r = effectiveRange(state, unit, o);
    if (!r) continue;
    for (let dy = -r[1]; dy <= r[1]; dy++) {
      const y = o.y + dy;
      if (y < 0 || y >= H) continue;
      const span = r[1] - Math.abs(dy);
      for (let dx = -span; dx <= span; dx++) {
        const x = o.x + dx;
        if (x < 0 || x >= W) continue;
        if (Math.abs(dx) + Math.abs(dy) < r[0]) continue;
        mark[y * W + x] = 1;
      }
    }
  }
  const out: Coord[] = [];
  for (let i = 0; i < mark.length; i++) if (mark[i]) out.push({ x: i % W, y: Math.floor(i / W) });
  return out;
}

/** Damage % (internal HP, uncapped — ≥ defender HP means a kill) over the luck range, and the counter range. */
export function forecast(
  state: GameState, attackerId: number, from: Coord, target: Coord,
): { damage: [number, number]; counter: [number, number] | null } {
  const attacker = unitById(state, attackerId);
  const defender = unitAt(state, target);
  const none = { damage: [0, 0] as [number, number], counter: null };
  if (!attacker || !defender || !areEnemies(state, attacker.owner, defender.owner)) return none;
  const w = weaponAgainst(attacker.type, defender.type, attacker.ammo);
  if (!w) return none;
  const [aLo, aHi] = luckRange(state, attacker, from);
  const dist = manhattan(from, target);
  const counters = canCounter(defender, attacker, dist);
  const cw = counters ? weaponAgainst(defender.type, attacker.type, defender.ammo) : null;
  const [dLo, dHi] = luckRange(state, defender, target);
  const hit = (aHp: number, dHp: number, luck: number) => damageValue(state, attacker, from, aHp, defender, target, dHp, luck, w.base);
  const back = (dHp: number, aHp: number, luck: number) =>
    cw ? damageValue(state, defender, target, dHp, attacker, from, aHp, luck, cw.base) : 0;

  if (cw && hasCounterFirst(state, defender)) {
    const cMin = back(defender.hp, attacker.hp, dLo);
    const cMax = back(defender.hp, attacker.hp, dHi);
    const worst = attacker.hp - cMax;
    const bestHp = attacker.hp - cMin;
    return {
      damage: [worst > 0 ? hit(worst, defender.hp, aLo) : 0, bestHp > 0 ? hit(bestHp, defender.hp, aHi) : 0],
      counter: [cMin, cMax],
    };
  }
  const dMin = hit(attacker.hp, defender.hp, aLo);
  const dMax = hit(attacker.hp, defender.hp, aHi);
  if (!cw || dMin >= defender.hp) return { damage: [dMin, dMax], counter: null };
  const afterMax = defender.hp - dMax;
  const afterMin = defender.hp - dMin;
  return {
    damage: [dMin, dMax],
    counter: [afterMax > 0 ? back(afterMax, attacker.hp, dLo) : 0, back(afterMin, attacker.hp, dHi)],
  };
}

// ---------- resolution ----------

/** The unit followed by everything it carries, nested transports included (a barge can carry a loaded mule). */
function withCargo(unit: Unit): Unit[] {
  return [unit, ...unit.cargo.flatMap(withCargo)];
}

/** Removes a destroyed unit (and all its cargo), resets a capture on its tile, records stats, emits events. */
export function destroyUnit(ctx: Ctx, unit: Unit, by: PlayerIndex | null, kind: 'destroyed' | 'crashed' = 'destroyed'): void {
  const s = ctx.s;
  removeUnit(ctx, unit.id);
  resetCapture(ctx, unit);
  const at = { x: unit.x, y: unit.y };
  const lost = withCargo(unit);
  for (const u of lost) {
    if (kind === 'crashed') emit(ctx, { kind: 'crashed', unitId: u.id, at });
    else emit(ctx, { kind: 'destroyed', unitId: u.id, at, type: u.type, owner: u.owner });
  }
  const owner = s.players[unit.owner];
  if (owner) owner.stats.unitsLost += lost.length;
  if (by !== null && s.players[by]) s.players[by].stats.unitsDestroyed += lost.length;
}

function rollLuck(ctx: Ctx, unit: Unit): number {
  const [lo, hi] = luckRange(ctx.s, unit);
  const [v, next] = randomInt(ctx.s.rng, lo, hi);
  ctx.s.rng = next;
  return v;
}

function strike(ctx: Ctx, att: Unit, def: Unit, w: Weapon): number {
  const s = ctx.s;
  const luck = rollLuck(ctx, att);
  const before = def.hp;
  const dmg = Math.min(before, damageValue(s, att, att, att.hp, def, def, def.hp, luck, w.base));
  if (w.primary) att.ammo = Math.max(0, att.ammo - 1);
  def.hp = before - dmg;
  s.players[att.owner].stats.damageDealt += dmg;
  s.players[def.owner].stats.damageTaken += dmg;
  // Power meter (spec 10.1): value = list cost × internal HP lost / 100 — all of it to the victim's owner, half to the dealer's.
  // Internal HP, not display HP: a 9-point hit that leaves the display HP at 10 still charges the meter.
  if (dmg > 0) {
    const value = (unitType(def.type).cost * dmg) / 100;
    gainPower(ctx, att.owner, value / 2);
    gainPower(ctx, def.owner, value);
  }
  return dmg;
}

/** Attacker (already at its firing position) attacks the enemy at `target`. Assumes legality was checked. */
export function resolveAttack(ctx: Ctx, attacker: Unit, target: Coord): void {
  const s = ctx.s;
  const defender = unitAt(s, target);
  if (!defender || !areEnemies(s, attacker.owner, defender.owner)) illegal(`no enemy unit at (${target.x},${target.y})`);
  const w = weaponAgainst(attacker.type, defender.type, attacker.ammo);
  if (!w) illegal(`${attacker.type} has no weapon against ${defender.type}`);
  const dist = manhattan(attacker, defender);
  const counters = canCounter(defender, attacker, dist);
  const first = counters && hasCounterFirst(s, defender);
  let dmg = 0;
  let ctr = 0;
  if (first) {
    ctr = strike(ctx, defender, attacker, weaponAgainst(defender.type, attacker.type, defender.ammo)!);
    if (attacker.hp > 0) dmg = strike(ctx, attacker, defender, weaponAgainst(attacker.type, defender.type, attacker.ammo) ?? w);
  } else {
    dmg = strike(ctx, attacker, defender, w);
    if (defender.hp > 0 && counters) {
      const cw = weaponAgainst(defender.type, attacker.type, defender.ammo);
      if (cw) ctr = strike(ctx, defender, attacker, cw);
    }
  }
  emit(ctx, {
    kind: 'attacked', attackerId: attacker.id, defenderId: defender.id, damage: dmg, counter: ctr,
    attackerHp: Math.max(0, attacker.hp), defenderHp: Math.max(0, defender.hp), ...(first ? { counterFirst: true } : {}),
  });
  if (defender.hp <= 0) destroyUnit(ctx, defender, attacker.owner);
  if (attacker.hp <= 0) destroyUnit(ctx, attacker, defender.owner);
}
