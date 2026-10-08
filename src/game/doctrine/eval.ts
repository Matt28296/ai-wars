// Doctrine valuation (docs/research/ai-behaviour.md B.2 and B.8): what a unit is worth, what a strike would do, where an enemy can hit,
// how far a tile is from where a unit wants to be. Everything here is a pure read of the player's OWN view of the battle:
// `view` is observedState(state, player) (enemy units the player cannot see are gone), `obs` is observe(state, player). Nothing here
// touches the true state, state.rng, or the other players' hidden fields (their stats, unit counts, nextUnitId).
import { TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import { DAMAGE } from '../../data/damage';
import { CAPTURE_POINTS, attackRangeTiles, displayHp, forecast, reachable } from '../aw';
import { damageValue, weaponAgainst } from '../aw/combat';
import { terrainStarsFor } from '../aw/modifiers';
import type { Observation } from '../aw/observe';
import { areEnemies, isIndirectType, manhattan, teamOf } from '../aw/state';
import { repairsDomain } from '../aw/turn';
import type { Coord, GameState, MoveType, PlayerIndex, TerrainId, Unit, UnitType, UnitTypeId } from '../aw/types';
import type { Composition, StandingOrders } from './orders';

export const INF = 9999;

// ---------------------------------------------------------------- unit categories and roles

export type Category = keyof Composition;

const CATEGORY: Record<UnitTypeId, Category> = {
  trooper: 'infantry', breacher: 'infantry',
  skimmer: 'vehicles', lancer: 'vehicles', bastion: 'vehicles', colossus: 'vehicles', mule: 'vehicles', warden: 'vehicles',
  arc: 'indirect', salvo: 'indirect',
  wasp: 'air', raptor: 'air', anvil: 'air',
  picket: 'naval', dreadnought: 'naval', barge: 'naval',
};

export const categoryOf = (t: UnitTypeId): Category => CATEGORY[t];

export type Role = 'capturer' | 'indirect' | 'transport' | 'air' | 'naval' | 'combat';

export function roleOf(t: UnitType): Role {
  if (t.carries) return 'transport';
  if (t.captures) return 'capturer';
  if (isIndirectType(t)) return 'indirect';
  if (t.domain === 'air') return 'air';
  if (t.domain === 'sea') return 'naval';
  return 'combat';
}

export const isArmed = (t: UnitType): boolean => !!t.range;

/** The base damage % one unit type does to another with its best weapon (primary if it has ammo), 0 if it cannot. */
export function baseDamage(att: UnitTypeId, def: UnitTypeId, hasAmmo = true): number {
  const row = DAMAGE[att];
  if (!row) return 0;
  const p = row.primary?.[def];
  const s = row.secondary?.[def];
  return Math.max(hasAmmo ? p ?? 0 : 0, s ?? 0);
}

// ---------------------------------------------------------------- the context

export interface PropInfo {
  x: number;
  y: number;
  terrain: TerrainId;
  owner: PlayerIndex | null;
  capture: number;
  hq: boolean;
}

export interface Striker { unit: Unit; mask: Uint8Array }

export interface Ctx {
  me: PlayerIndex;
  team: number;
  view: GameState;
  obs: Observation;
  orders: StandingOrders;
  W: number;
  H: number;
  cycle: number;
  /** Fog is up: what the agent sees is less than the whole board. */
  fogged: boolean;
  /** My own top-level units. */
  mine: Unit[];
  /** Units of my team's other players. */
  allies: Unit[];
  /** Enemy units I can see. */
  foes: Unit[];
  /** Every property on the board (terrain and owner are public). */
  props: PropInfo[];
  homeSpires: Coord[];
  foeSpires: Coord[];
  /** Tile index -> unit standing there (top level, mine + allies + visible foes). */
  at: Map<number, Unit>;
  memo: Map<string, unknown>;
}

export const idxOf = (ctx: { W: number }, x: number, y: number): number => y * ctx.W + x;

export function buildCtx(view: GameState, obs: Observation, me: PlayerIndex, orders: StandingOrders): Ctx {
  const team = teamOf(view, me);
  const props: PropInfo[] = [];
  const homeSpires: Coord[] = [];
  const foeSpires: Coord[] = [];
  for (let y = 0; y < view.height; y++) {
    for (let x = 0; x < view.width; x++) {
      const t = view.tiles[y][x];
      const tt = TERRAIN_TYPES[t.terrain];
      if (!tt.property) continue;
      props.push({ x, y, terrain: t.terrain, owner: t.owner, capture: t.capture, hq: !!tt.hq });
      if (tt.hq && t.owner !== null) {
        if (t.owner === me) homeSpires.push({ x, y });
        else if (areEnemies(view, me, t.owner)) foeSpires.push({ x, y });
      }
    }
  }
  const mine: Unit[] = [];
  const allies: Unit[] = [];
  const foes: Unit[] = [];
  const at = new Map<number, Unit>();
  for (const u of view.units) {
    at.set(u.y * view.width + u.x, u);
    if (u.owner === me) mine.push(u);
    else if (areEnemies(view, me, u.owner)) foes.push(u);
    else allies.push(u);
  }
  return {
    me, team, view, obs, orders, W: view.width, H: view.height, cycle: view.cycle, fogged: obs.fogActive,
    mine, allies, foes, props, homeSpires, foeSpires, at, memo: new Map(),
  };
}

function memo<T>(ctx: Ctx, key: string, make: () => T): T {
  if (ctx.memo.has(key)) return ctx.memo.get(key) as T;
  const v = make();
  ctx.memo.set(key, v);
  return v;
}

// ---------------------------------------------------------------- values

/** Funds worth of a unit as it stands: cost x display HP / 10, indirects a little more (force multipliers). Own cargo counts. */
export function unitValue(u: Unit, ownCargo = true): number {
  const t = UNIT_TYPES[u.type];
  let v = (t.cost * displayHp(u.hp)) / 10;
  if (isIndirectType(t)) v *= 1.2;
  if (ownCargo) for (const c of u.cargo) v += unitValue(c, true);
  return v;
}

/** B.2 roleMult for a target: a capturer midway through a capture is worth more, an indirect a little more. */
export function roleMult(ctx: Ctx, u: Unit): number {
  const t = UNIT_TYPES[u.type];
  let m = 1;
  if (t.captures) {
    const tile = ctx.view.tiles[u.y][u.x];
    const takeable = tile.owner === null || areEnemies(ctx.view, u.owner, tile.owner);
    if (TERRAIN_TYPES[tile.terrain].property && takeable) m += 0.25 + 0.5 * (1 - tile.capture / CAPTURE_POINTS);
  }
  if (isIndirectType(t)) m += 0.2;
  return m;
}

// ---------------------------------------------------------------- distance fields

interface Seed { x: number; y: number; d: number }

/** Entry cost of every tile for a move type (-1 = impassable), memoised per context. */
function costGrid(ctx: Ctx, mt: MoveType): Int8Array {
  return memo(ctx, `cost:${mt}`, () => {
    const g = new Int8Array(ctx.W * ctx.H);
    for (let y = 0; y < ctx.H; y++) {
      for (let x = 0; x < ctx.W; x++) {
        const c = TERRAIN_TYPES[ctx.view.tiles[y][x].terrain].cost[mt];
        g[y * ctx.W + x] = c === null || c === undefined ? -1 : c;
      }
    }
    return g;
  });
}

/**
 * Movement points still needed to get from every tile to a seed (INF if it cannot), for one move type, ignoring units: the path
 * cost is the sum of the entry costs of the tiles stepped onto, the same rule reachable() uses. Seeds start at their own `d`.
 */
function runField(ctx: Ctx, mt: MoveType, seeds: Seed[], forward = false): Int16Array {
  const { W, H } = ctx;
  const N = W * H;
  const cost = costGrid(ctx, mt);
  const dist = new Int16Array(N).fill(INF);
  const buckets: number[][] = [];
  for (const s of seeds) {
    const i = s.y * W + s.x;
    if (cost[i] < 0 || s.d >= dist[i]) continue;
    dist[i] = s.d;
    (buckets[s.d] ??= []).push(i);
  }
  const LIMIT = 900;
  for (let d = 0; d < buckets.length && d < LIMIT; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (let k = 0; k < b.length; k++) {
      const i = b[k];
      if (dist[i] !== d) continue;
      const x = i % W;
      for (let dir = 0; dir < 4; dir++) {
        let n: number;
        if (dir === 0) n = i - W;
        else if (dir === 1) n = x + 1 < W ? i + 1 : -1;
        else if (dir === 2) n = i + W;
        else n = x > 0 ? i - 1 : -1;
        if (n < 0 || n >= N || cost[n] < 0) continue;
        // backward (default): n -> i enters i, so n pays i's cost; forward: i -> n enters n, so n pays its own
        const step = d + (forward ? cost[n] : cost[i]);
        if (step >= dist[n]) continue;
        dist[n] = step;
        (buckets[step] ??= []).push(n);
      }
    }
  }
  return dist;
}

/** Movement points a unit of `mt` needs to reach every tile from `from`, ignoring other units (INF = cannot): the same entry-cost rule. */
export function reachFrom(ctx: Ctx, mt: MoveType, from: Coord): Int16Array {
  return memo(ctx, `from:${mt}:${from.x},${from.y}`, () => runField(ctx, mt, [{ x: from.x, y: from.y, d: 0 }], true));
}

/** A memoised field. `key` names the goal set, so two calls with the same key and move type share one field. */
export function field(ctx: Ctx, mt: MoveType, key: string, seeds: () => Seed[]): Int16Array {
  return memo(ctx, `field:${mt}:${key}`, () => runField(ctx, mt, seeds()));
}

/** Seeds from which a unit of `mt` can reach a goal: the goal tile itself when it can stand there, else the tiles beside it. */
export function reachSeeds(ctx: Ctx, mt: MoveType, goals: readonly Coord[], onGoal: boolean, d = 0): Seed[] {
  const cost = costGrid(ctx, mt);
  const out: Seed[] = [];
  for (const g of goals) {
    if (onGoal) {
      out.push({ x: g.x, y: g.y, d });
      continue;
    }
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = g.x + dx;
      const y = g.y + dy;
      if (x >= 0 && y >= 0 && x < ctx.W && y < ctx.H && cost[y * ctx.W + x] >= 0) out.push({ x, y, d });
    }
  }
  return out;
}

/** A set of places a unit may be heading for, named so its distance field is built once. `onGoal`: the unit must stand ON a goal
 *  (capture, repair); otherwise standing next to one is enough (attack, escort). */
export interface Goals { key: string; list: readonly Coord[]; onGoal: boolean }

export function goals(key: string, list: readonly Coord[], onGoal: boolean): Goals {
  return { key, list, onGoal };
}

/** Steps to stand on / next to the nearest of the goals, for a unit of this move type. When no path exists the answer is a large
 *  distance that still falls as the unit gets nearer in a straight line, so a boat or a hover unit still has a direction to take. */
export function distTo(ctx: Ctx, mt: MoveType, g: Goals, at: Coord): number {
  if (!g.list.length) return 0;
  const f = field(ctx, mt, `${g.onGoal ? 'on' : 'by'}:${g.key}`, () => reachSeeds(ctx, mt, g.list, g.onGoal));
  const v = f[at.y * ctx.W + at.x];
  if (v < INF) return v;
  let best = INF;
  for (const c of g.list) best = Math.min(best, manhattan(at, c));
  return 60 + best * 2;
}

// ---------------------------------------------------------------- the front: where is home, where is the enemy

/** Where my side's base is: my spire(s), else my production, else any property I own. Empty when I own nothing. */
export function homeAnchors(ctx: Ctx): Coord[] {
  return memo(ctx, 'home', () => {
    if (ctx.homeSpires.length) return ctx.homeSpires;
    const prod = ctx.props.filter((p) => p.owner === ctx.me && !!TERRAIN_TYPES[p.terrain].builds);
    if (prod.length) return prod;
    return ctx.props.filter((p) => p.owner === ctx.me);
  });
}

/** What the enemy holds that I am heading for: their spire(s), else their production, else their properties, else the enemy units
 *  I can see, else the far side of the board from my own base. */
export function foeAnchors(ctx: Ctx): Coord[] {
  return memo(ctx, 'foe', () => {
    if (ctx.foeSpires.length) return ctx.foeSpires;
    const enemyProps = ctx.props.filter((p) => p.owner !== null && areEnemies(ctx.view, ctx.me, p.owner));
    const prod = enemyProps.filter((p) => !!TERRAIN_TYPES[p.terrain].builds);
    if (prod.length) return prod;
    if (enemyProps.length) return enemyProps;
    if (ctx.foes.length) return ctx.foes.map((u) => ({ x: u.x, y: u.y }));
    const home = homeAnchors(ctx);
    if (home.length) {
      const h = home[0];
      return [{ x: Math.max(0, Math.min(ctx.W - 1, ctx.W - 1 - h.x)), y: Math.max(0, Math.min(ctx.H - 1, ctx.H - 1 - h.y)) }];
    }
    return [{ x: Math.floor(ctx.W / 2), y: Math.floor(ctx.H / 2) }];
  });
}

export const homeGoals = (ctx: Ctx): Goals => memo(ctx, 'goals:home', () => goals('home', homeAnchors(ctx), true));
export const foeGoals = (ctx: Ctx): Goals => memo(ctx, 'goals:foe', () => goals('foe', foeAnchors(ctx), true));

/** Every enemy-held property plus the enemy units in view: what an advancing army walks toward. */
export function foeTargets(ctx: Ctx): Goals {
  return memo(ctx, 'goals:foeTargets', () => {
    const out: Coord[] = [];
    for (const p of ctx.props) if (p.owner !== null && areEnemies(ctx.view, ctx.me, p.owner)) out.push({ x: p.x, y: p.y });
    for (const u of ctx.foes) out.push({ x: u.x, y: u.y });
    const list = out.length ? out : foeAnchors(ctx);
    return goals(`foeTargets:${list.length}:${list.map((c) => c.x * 64 + c.y).join('.')}`, list, false);
  });
}

/** 0 at my base, 1 at the enemy's: how far along the road between the two a tile is, for this move type. */
export function frontFraction(ctx: Ctx, mt: MoveType, at: Coord): number {
  const home = homeGoals(ctx);
  const foe = foeGoals(ctx);
  if (!home.list.length || !foe.list.length) return 0.5;
  const h = distTo(ctx, mt, home, at);
  const f = distTo(ctx, mt, foe, at);
  return h + f <= 0 ? 0.5 : h / (h + f);
}

// ---------------------------------------------------------------- strikes: what a unit would do, what can hit it

export interface StrikeOutcome {
  /** Mean damage, internal HP, capped at the target's HP. */
  dealtHp: number;
  /** Chance the strike destroys the target. */
  killP: number;
  /** Mean counter damage to the attacker, internal HP (0 when the target dies for sure or cannot counter). */
  counterHp: number;
}

/** Forecast of attacker `a` striking `t` from `from`, as numbers a score can use. The luck range is treated as uniform. */
export function strike(ctx: Ctx, a: Unit, from: Coord, t: Unit): StrikeOutcome {
  const f = forecast(ctx.view, a.id, from, { x: t.x, y: t.y });
  const [lo, hi] = f.damage;
  let killP: number;
  if (lo >= t.hp) killP = 1;
  else if (hi < t.hp) killP = 0;
  else killP = (hi - t.hp + 1) / (hi - lo + 1);
  // E[min(hp, X)] for X uniform on [lo, hi]
  let dealt: number;
  if (hi <= lo) dealt = Math.min(t.hp, lo);
  else {
    const n = hi - lo + 1;
    let sum = 0;
    for (let x = lo; x <= hi; x++) sum += Math.min(t.hp, x);
    dealt = sum / n;
  }
  const counterMean = f.counter ? (f.counter[0] + f.counter[1]) / 2 : 0;
  return { dealtHp: dealt, killP, counterHp: Math.min(a.hp, counterMean * (1 - killP)) };
}

/** Mean damage (internal HP) enemy `e` does to unit `v` standing on `at`, at the middle of the luck range. */
export function enemyDamageOn(ctx: Ctx, e: Unit, v: Unit, at: Coord, hp = v.hp): number {
  const w = weaponAgainst(e.type, v.type, e.ammo);
  if (!w) return 0;
  const ghost: Unit = { ...v, x: at.x, y: at.y, hp, cargo: [] };
  return Math.min(hp, damageValue(ctx.view, e, e, e.hp, ghost, at, hp, 4, w.base));
}

/** Every visible armed enemy with the tiles it could strike next turn (move + fire for direct units, current range for indirect). */
export function strikers(ctx: Ctx): Striker[] {
  return memo(ctx, 'strikers', () => {
    const out: Striker[] = [];
    // The enemy's reach is measured on a board with none of my side's units on it: they will have moved by the time the enemy
    // acts, and a unit must not count its own body as the wall that keeps the enemy off the tile it is about to step onto.
    const bare = { ...ctx.view, units: ctx.foes };
    for (const e of ctx.foes) {
      if (!isArmed(UNIT_TYPES[e.type])) continue;
      const mask = new Uint8Array(ctx.W * ctx.H);
      for (const c of attackRangeTiles(bare, e.id)) mask[c.y * ctx.W + c.x] = 1;
      out.push({ unit: e, mask });
    }
    return out;
  });
}

/** Can any visible enemy strike this tile next turn? Cheap: no damage is worked out. */
export function covered(ctx: Ctx, at: Coord): boolean {
  const i = at.y * ctx.W + at.x;
  for (const s of strikers(ctx)) if (s.mask[i]) return true;
  return false;
}

/** Expected damage (internal HP, at most the unit's HP) `u` would take next enemy turn if it ended on `at`: the three hardest hitters. */
export function threatOn(ctx: Ctx, u: Unit, at: Coord, hp = u.hp): number {
  const key = `threat:${u.id}:${at.x},${at.y}:${hp}`;
  return memo(ctx, key, () => {
    const i = at.y * ctx.W + at.x;
    const hits: number[] = [];
    for (const s of strikers(ctx)) {
      if (!s.mask[i]) continue;
      const d = enemyDamageOn(ctx, s.unit, u, at, hp);
      if (d > 0) hits.push(d);
    }
    if (!hits.length) return 0;
    hits.sort((a, b) => b - a);
    return Math.min(hp, (hits[0] ?? 0) + (hits[1] ?? 0) * 0.85 + (hits[2] ?? 0) * 0.7);
  });
}

/** Funds a unit stands to lose if it ends on `at` (see threatOn). */
export function exposure(ctx: Ctx, u: Unit, at: Coord, hp = u.hp): number {
  const dmg = threatOn(ctx, u, at, hp);
  if (dmg <= 0) return 0;
  const value = UNIT_TYPES[u.type].cost + u.cargo.reduce((n, c) => n + UNIT_TYPES[c.type].cost, 0);
  return (dmg / 100) * value;
}

/** Defence stars the unit would have on `at`. */
export const starsAt = (ctx: Ctx, u: Unit, at: Coord): number => terrainStarsFor(ctx.view, u, at);

// ---------------------------------------------------------------- properties and capture

/** Funds worth of owning a property (B.4): income for about eight turns, more for production and uplinks, the most for a spire. */
export function propertyValue(ctx: Ctx, p: PropInfo): number {
  const tt = TERRAIN_TYPES[p.terrain];
  let v = (tt.income ?? 0) * 8;
  if (tt.builds === 'ground') v += 4000;
  else if (tt.builds) v += 3000;
  if (tt.boost) v += 2000;
  if (p.hq) v = 40000;
  const enemyOwned = p.owner !== null && areEnemies(ctx.view, ctx.me, p.owner);
  return enemyOwned ? v * 1.5 : v;
}

/** The properties on the board that `u` could capture (neutral or enemy). */
export function capturable(ctx: Ctx, u: Unit): PropInfo[] {
  if (!UNIT_TYPES[u.type].captures) return [];
  return ctx.props.filter((p) => p.owner === null || areEnemies(ctx.view, u.owner, p.owner));
}

/** A tile on which my unit of this domain is repaired and resupplied at the start of my turn. */
export function isServiceTile(ctx: Ctx, c: Coord, u: Unit): boolean {
  const tile = ctx.view.tiles[c.y][c.x];
  return tile.owner === ctx.me && repairsDomain(tile.terrain, UNIT_TYPES[u.type].domain);
}

/** My service tiles for this unit's domain. */
export function serviceTiles(ctx: Ctx, u: Unit): Coord[] {
  const dom = UNIT_TYPES[u.type].domain;
  return memo(ctx, `service:${dom}`, () =>
    ctx.props.filter((p) => p.owner === ctx.me && repairsDomain(p.terrain, dom)).map((p) => ({ x: p.x, y: p.y })));
}

/** Enemy capturers that could stand on this tile on their next turn. */
export function capturersThreatening(ctx: Ctx, tile: Coord): Unit[] {
  return memo(ctx, `capThreat:${tile.x},${tile.y}`, () => {
    const out: Unit[] = [];
    for (const e of ctx.foes) {
      const t = UNIT_TYPES[e.type];
      if (!t.captures) continue;
      if (manhattan(e, tile) > t.move + 1) continue;
      if (e.x === tile.x && e.y === tile.y) {
        out.push(e);
        continue;
      }
      if (reachable(ctx.view, e.id).has(`${tile.x},${tile.y}`)) out.push(e);
    }
    return out;
  });
}
