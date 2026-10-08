// Commander powers: the meter (AW2 rules), activation and the InstantEffect vocabulary.
//
// Meter: damage dealt charges funds value of display HP removed × 0.5, damage taken × 1.0, scaled by
// powerChargePercent; no charging while the player's own power is active; capped at the Overclock cost.
// One star = POWER_STAR points, and every previous activation makes stars 20% dearer (max +100%).
// Activating either power empties the meter. A power stays active until the start of its owner's next turn
// (so its defense applies through the enemy turn); all active powers add +10 firepower / +10 defense.
import { TERRAIN_TYPES } from '../../data';
import { canStandOn } from './movement';
import { activeModifiers, commanderDef, matchesFilter, sumField } from './modifiers';
import { areEnemies, displayHp, emit, forEachUnit, keyOf, MAX_HP, unitType, writableTile } from './state';
import type { Ctx } from './state';
import { incomeOf } from './turn';
import type { Coord, GameState, InstantEffect, PlayerIndex, PowerDef, Unit } from './types';

export const POWER_STAR = 9000;
export type PowerLevel = 'surge' | 'overclock';

export function powerDef(state: GameState, p: PlayerIndex, level: PowerLevel): PowerDef | null {
  const pl = state.players[p];
  if (!pl) return null;
  const co = commanderDef(pl.commander);
  return (level === 'surge' ? co?.surge : co?.overclock) ?? null;
}

/** Meter points per star for this player right now (+20% per previous activation, capped at +100%). */
export function starValue(state: GameState, p: PlayerIndex): number {
  const uses = state.players[p]?.powerUses ?? 0;
  return (POWER_STAR * (100 + Math.min(100, 20 * uses))) / 100;
}

/** Meter points needed for a power (Infinity if the commander has none at that level). */
export function powerCost(state: GameState, p: PlayerIndex, level: PowerLevel): number {
  const d = powerDef(state, p, level);
  return d ? Math.round(d.stars * starValue(state, p)) : Infinity;
}

/** AW2: the meter tops out at the Overclock cost (or the Surge cost if there is no Overclock). */
export function meterCap(state: GameState, p: PlayerIndex): number {
  if (powerDef(state, p, 'overclock')) return powerCost(state, p, 'overclock');
  if (powerDef(state, p, 'surge')) return powerCost(state, p, 'surge');
  return 0;
}

export function powerStars(state: GameState, p: PlayerIndex): { filled: number; surge: number; overclock: number } {
  const pl = state.players[p];
  return {
    filled: pl ? pl.power / starValue(state, p) : 0,
    surge: powerDef(state, p, 'surge')?.stars ?? 0,
    overclock: powerDef(state, p, 'overclock')?.stars ?? 0,
  };
}

/** For the current player. */
export function canActivatePower(state: GameState, level: PowerLevel): boolean {
  if (state.winnerTeam !== null) return false;
  const p = state.current;
  const pl = state.players[p];
  if (!pl || pl.defeated || pl.powerState !== 'none') return false;
  if (!powerDef(state, p, level)) return false;
  return pl.power >= powerCost(state, p, level);
}

export function gainPower(ctx: Ctx, p: PlayerIndex, amount: number): void {
  const s = ctx.s;
  const pl = s.players[p];
  if (!pl || pl.defeated || pl.powerState !== 'none' || amount <= 0) return;
  const cap = meterCap(s, p);
  if (cap <= 0) return;
  const pct = sumField(activeModifiers(s, p), 'powerChargePercent');
  const gain = Math.floor((amount * (100 + pct)) / 100);
  if (gain > 0) pl.power = Math.min(cap, pl.power + gain);
}

export function activatePower(ctx: Ctx, level: PowerLevel): void {
  const s = ctx.s;
  const p = s.current;
  const pl = s.players[p];
  const def = powerDef(s, p, level)!;
  pl.power = 0;
  pl.powerUses += 1;
  pl.powerState = level;
  emit(ctx, { kind: 'powerActivated', player: p, level, commander: pl.commander });
  for (const e of def.effects) applyEffect(ctx, p, e);
}

const at = (u: Unit): Coord => ({ x: u.x, y: u.y });
const unitMatches = (s: GameState, u: Unit, f: Parameters<typeof matchesFilter>[0]) =>
  matchesFilter(f, unitType(u.type), s.tiles[u.y]?.[u.x]?.terrain);

function refill(u: Unit): void {
  const t = unitType(u.type);
  u.charge = t.charge;
  u.ammo = t.ammo ?? 0;
}

function enemiesOf(s: GameState, p: PlayerIndex) {
  return s.players.filter((o) => !o.defeated && areEnemies(s, p, o.index));
}

/** Funds value of the display HP a non-lethal hit of `hp` display HP would remove. */
function strikeValue(u: Unit, hp: number): number {
  const after = Math.max(1, u.hp - hp * 10);
  return ((displayHp(u.hp) - displayHp(after)) * unitType(u.type).cost) / 10;
}

export function applyEffect(ctx: Ctx, p: PlayerIndex, e: InstantEffect): void {
  const s = ctx.s;
  const pl = s.players[p];
  const affected: Coord[] = [];
  const say = (description: string) => emit(ctx, { kind: 'powerEffect', player: p, description, affected });
  switch (e.kind) {
    case 'heal': {
      forEachUnit(s, (u) => {
        if (u.owner !== p || !unitMatches(s, u, e.filter)) return;
        u.hp = Math.min(MAX_HP, u.hp + e.hp * 10);
        if (e.resupply) refill(u);
        affected.push(at(u));
      });
      say(`+${e.hp} HP${e.resupply ? ' and full resupply' : ''}`);
      break;
    }
    case 'damageEnemies': {
      forEachUnit(s, (u) => {
        if (!areEnemies(s, p, u.owner) || !unitMatches(s, u, e.filter)) return;
        u.hp = Math.max(1, u.hp - e.hp * 10);
        affected.push(at(u));
      });
      say(`Enemy units −${e.hp} HP`);
      break;
    }
    case 'strike': {
      const enemies = s.units.filter((u) => areEnemies(s, p, u.owner));
      let best: { x: number; y: number; value: number; count: number } | null = null;
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          let value = 0;
          let count = 0;
          for (const u of enemies) {
            if (Math.abs(u.x - x) + Math.abs(u.y - y) > e.radius) continue;
            count++;
            value += strikeValue(u, e.hp);
          }
          if (count === 0) continue;
          const better = !best
            || (e.aim === 'mostUnits'
              ? count > best.count || (count === best.count && value > best.value)
              : value > best.value || (value === best.value && count > best.count));
          if (better) best = { x, y, value, count };
        }
      }
      if (best) {
        for (const u of enemies) {
          if (Math.abs(u.x - best.x) + Math.abs(u.y - best.y) > e.radius) continue;
          u.hp = Math.max(1, u.hp - e.hp * 10);
          affected.push(at(u));
        }
      }
      say(best ? `Strike at ${best.x},${best.y}: −${e.hp} HP` : 'Strike found no targets');
      break;
    }
    case 'drainPower': {
      for (const o of enemiesOf(s, p)) {
        o.power = Math.max(0, o.power - Math.floor((o.power * e.percent) / 100));
      }
      say(`Enemy power meters −${e.percent}%`);
      break;
    }
    case 'funds': {
      const gain = (e.amount ?? 0) + Math.floor((incomeOf(s, p) * (e.percentOfIncome ?? 0)) / 100);
      pl.funds = Math.max(0, pl.funds + gain);
      say(`+${gain} funds`);
      break;
    }
    case 'enemyFundsPercent': {
      for (const o of enemiesOf(s, p)) o.funds = Math.max(0, o.funds + Math.trunc((o.funds * e.percent) / 100));
      say(`Enemy funds ${e.percent >= 0 ? '+' : ''}${e.percent}%`);
      break;
    }
    case 'convertTerrain': {
      const from = new Set(e.from);
      const occupied = new Map<string, Unit>();
      for (const u of s.units) occupied.set(keyOf(u.x, u.y), u);
      const targets: Coord[] = [];
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          const t = s.tiles[y][x].terrain;
          if (!from.has(t) || TERRAIN_TYPES[t].property) continue;
          const adj = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => s.tiles[y + dy]?.[x + dx]?.terrain === e.adjacentTo);
          if (!adj) continue;
          const u = occupied.get(keyOf(x, y));
          if (u && !canStandOn(e.to, unitType(u.type).moveType)) continue;
          targets.push({ x, y });
        }
      }
      for (const c of targets) {
        const tile = writableTile(ctx, c.x, c.y);
        const i = s.terrainOverrides.findIndex((o) => o.x === c.x && o.y === c.y);
        const original = i >= 0 ? s.terrainOverrides[i].original : tile.terrain;
        if (i >= 0) s.terrainOverrides.splice(i, 1);
        tile.terrain = e.to;
        if (original !== e.to) s.terrainOverrides.push({ x: c.x, y: c.y, terrain: e.to, turnsLeft: e.turns, original, owner: p });
        affected.push(c);
      }
      say(`${e.from.join('/')} → ${e.to} for ${e.turns} turn${e.turns === 1 ? '' : 's'}`);
      break;
    }
    case 'weather': {
      if (s.baseWeather === undefined) s.baseWeather = s.weatherTurnsLeft > 0 ? 'clear' : s.weather;
      s.weather = e.weather;
      s.weatherTurnsLeft = Math.max(1, e.turns);
      s.weatherOwner = p;
      emit(ctx, { kind: 'weather', weather: e.weather, turns: s.weatherTurnsLeft });
      say(`Weather: ${e.weather} for ${s.weatherTurnsLeft} turn${s.weatherTurnsLeft === 1 ? '' : 's'}`);
      break;
    }
    case 'reveal': {
      pl.revealTurns = Math.max(pl.revealTurns ?? 0, e.turns);
      say('Fog lifted');
      break;
    }
    case 'enemyMove': {
      for (const o of enemiesOf(s, p)) o.moveEffects = [...(o.moveEffects ?? []), { delta: e.delta, turnsLeft: e.turns }];
      say(`Enemy movement ${e.delta >= 0 ? '+' : ''}${e.delta}`);
      break;
    }
    case 'refresh': {
      const cands = s.units
        .filter((u) => u.owner === p && u.acted && unitMatches(s, u, e.filter))
        .sort((a, b) => unitType(b.type).cost - unitType(a.type).cost || a.id - b.id);
      const chosen = e.maxUnits === undefined ? cands : cands.slice(0, Math.max(0, e.maxUnits));
      for (const u of chosen) {
        u.acted = false;
        affected.push(at(u));
      }
      say(`${chosen.length} unit${chosen.length === 1 ? '' : 's'} may act again`);
      break;
    }
  }
}
