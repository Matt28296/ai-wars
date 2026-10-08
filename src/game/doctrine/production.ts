// Doctrine production (docs/research/ai-behaviour.md B.5, simplified). After the units have moved, pick one build from the builds the
// agent is offered (empty production tiles, affordable types only), or none.
//
// A type scores
//     how well it fights what the enemy has  (damage it does to each enemy unit type less 0.6 x what they do back, per fund spent,
//                                             weighted by each type's share of the enemy army; a stock mix when none is in view)
//   + 1.2 x how far the army is below the player's composition weight for its category
//   + what the situation calls for  (capturers while properties are free, anti-air against air, a scout in fog, a transport
//                                    when a capturer has no land route)
//   - what the army already has too much of
// A category whose weight is 0 is never built. The composition weights are shares of the money spent on the army.
import { TERRAIN_TYPES, UNIT_LIST, UNIT_TYPES } from '../../data';
import type { Action, Unit, UnitTypeId } from '../aw/types';
import { areEnemies, manhattan } from '../aw/state';
import type { Category, Ctx } from './eval';
import { INF, baseDamage, categoryOf, foeAnchors, reachFrom, unitValue } from './eval';
import type { Composition } from './orders';

type BuildAction = Extract<Action, { kind: 'build' }>;

/** What an enemy army is assumed to hold before any of it has been seen: mostly infantry with a few tanks and guns. */
const STOCK_FOE: [UnitTypeId, number][] = [
  ['trooper', 0.4], ['breacher', 0.15], ['lancer', 0.15], ['arc', 0.1], ['skimmer', 0.1], ['bastion', 0.1],
];

const UTILITY: ReadonlySet<UnitTypeId> = new Set<UnitTypeId>(['mule', 'barge']);

function domainOf(t: UnitTypeId) {
  return UNIT_TYPES[t].domain;
}

/** The enemy army by unit type as shares of its value, from what is in view. */
function foeMix(ctx: Ctx): [UnitTypeId, number][] {
  const by = new Map<UnitTypeId, number>();
  let total = 0;
  for (const e of ctx.foes) {
    const v = unitValue(e, false);
    by.set(e.type, (by.get(e.type) ?? 0) + v);
    total += v;
  }
  if (total <= 0) return STOCK_FOE;
  return [...by].map(([t, v]) => [t, v / total] as [UnitTypeId, number]);
}

/** How good a type is against the mix, per fund spent (the damage value it deals less 0.6 of what comes back, full-HP strikes). */
function efficiency(t: UnitTypeId, mix: [UnitTypeId, number][]): number {
  const ut = UNIT_TYPES[t];
  if (!ut.range && !ut.carries) return 0;
  let net = 0;
  for (const [e, share] of mix) {
    const give = (baseDamage(t, e) / 100) * UNIT_TYPES[e].cost;
    const take = (baseDamage(e, t) / 100) * ut.cost;
    // an indirect unit is not hit back by what it shoots; one that cannot be reached by the enemy takes nothing
    const back = ut.range && ut.range[0] > 1 ? 0.3 : 0.6;
    net += share * (give - back * take);
  }
  return net / Math.pow(ut.cost, 0.6);
}

interface Army {
  value: Record<Category, number>;
  total: number;
  count: Partial<Record<UnitTypeId, number>>;
  capturers: number;
  foot: number;
}

function armyOf(ctx: Ctx): Army {
  const value: Record<Category, number> = { infantry: 0, vehicles: 0, indirect: 0, air: 0, naval: 0 };
  const count: Partial<Record<UnitTypeId, number>> = {};
  let total = 0;
  let capturers = 0;
  let foot = 0;
  const add = (u: { type: UnitTypeId; hp: number }) => {
    count[u.type] = (count[u.type] ?? 0) + 1;
    if (UNIT_TYPES[u.type].captures) capturers++;
    if (UNIT_TYPES[u.type].moveType === 'foot' || UNIT_TYPES[u.type].moveType === 'exo') foot++;
    if (UTILITY.has(u.type)) return;
    const v = UNIT_TYPES[u.type].cost * (Math.ceil(u.hp / 10) / 10);
    value[categoryOf(u.type)] += v;
    total += v;
  };
  for (const u of ctx.mine) {
    add(u);
    for (const c of u.cargo) add(c);
  }
  return { value, total, count, capturers, foot };
}

/** The categories I can build in right now: ground (any fabricator), air (a skyport), sea (a dock). */
function availableCategories(ctx: Ctx): Set<Category> {
  const out = new Set<Category>();
  for (const p of ctx.props) {
    if (p.owner !== ctx.me) continue;
    const b = TERRAIN_TYPES[p.terrain].builds;
    if (b === 'ground') {
      out.add('infantry');
      out.add('vehicles');
      out.add('indirect');
    } else if (b === 'air') out.add('air');
    else if (b === 'sea') out.add('naval');
  }
  return out;
}

export function chooseBuild(ctx: Ctx, actions: Action[], pick: (n: number) => number): Action | null {
  const builds = actions.filter((a): a is BuildAction => a.kind === 'build');
  if (!builds.length) return null;
  const comp: Composition = ctx.orders.composition;
  const avail = availableCategories(ctx);
  const army = armyOf(ctx);
  const mix = foeMix(ctx);
  const foeAirShare = mix.reduce((n, [t, s]) => n + (domainOf(t) === 'air' ? s : 0), 0);
  const foeNavalSeen = ctx.foes.some((e) => domainOf(e.type) === 'sea');
  let weightSum = 0;
  for (const k of Object.keys(comp) as Category[]) if (avail.has(k)) weightSum += comp[k];
  if (weightSum <= 0) return null;

  // properties still to be taken, and capturers to take them
  const neutral = ctx.props.filter((p) => p.owner === null).length;
  const enemyProps = ctx.props.filter((p) => p.owner !== null && areEnemies(ctx.view, ctx.me, p.owner)).length;
  const captureWork = neutral + 0.5 * enemyProps;
  const capNeed = Math.max(0, Math.min(1.4, 0.16 * (captureWork - 1.2 * army.capturers)));
  const needScout = ctx.fogged && !ctx.mine.some((u) => UNIT_TYPES[u.type].vision >= 4) && ctx.cycle >= 2;
  const foeAir = ctx.foes.filter((e) => domainOf(e.type) === 'air').length;
  const ownAA = (army.count.warden ?? 0) + (army.count.raptor ?? 0);
  // a capturer with no land route to any free property wants a ferry
  const ferryWanted = ferryNeed(ctx);

  const options = new Map<UnitTypeId, number>();
  let best = -Infinity;
  for (const ut of UNIT_LIST) options.set(ut.id, efficiency(ut.id, mix));
  // With a few production tiles and plenty of money, what an army can use is the best unit it can field, not the cheapest per fund.
  const slots = new Set(builds.map((b) => `${b.at.x},${b.at.y}`)).size;
  const perSlot = ctx.view.players[ctx.me].funds / Math.max(1, slots);
  const thrift = Math.max(0, Math.min(0.7, 0.7 - perSlot / 12000));
  const eff = new Map<UnitTypeId, number>();
  for (const ut of UNIT_LIST) eff.set(ut.id, (options.get(ut.id) ?? 0) * Math.pow(ut.cost, 0.6 - thrift));
  let maxEff = 1e-9;
  for (const b of builds) maxEff = Math.max(maxEff, eff.get(b.unitType) ?? 0);

  const front = foeAnchors(ctx)[0];
  const scored: { b: BuildAction; s: number }[] = [];
  for (const b of builds) {
    const ut = UNIT_TYPES[b.unitType];
    const cat = categoryOf(ut.id);
    if (comp[cat] <= 0 || !avail.has(cat)) continue;
    const isUtility = UTILITY.has(ut.id);
    if (cat === 'naval' && !isUtility && !foeNavalSeen && comp.naval < 6) continue;
    if (cat === 'air' && ctx.cycle < 3) continue;
    let s = Math.max(0, eff.get(ut.id) ?? 0) / maxEff;
    const target = comp[cat] / weightSum;
    const have = army.total > 0 ? army.value[cat] / army.total : 0;
    s += 1.2 * (target - have);
    if (ut.captures) s += capNeed + (ctx.cycle <= 2 ? 0.8 : 0);
    if (ut.id === 'breacher' && ctx.cycle <= 2) s -= 0.4;
    if (ut.id === 'warden' && foeAir > 0 && ownAA < foeAir) s += 0.9;
    if ((ut.id === 'raptor') && foeAirShare > 0.15 && ownAA < foeAir) s += 0.5;
    if (ut.id === 'skimmer' && needScout) s += 0.9;
    if (isUtility) {
      if (ut.id === 'barge') s = ferryWanted > 0 && (army.count.barge ?? 0) < Math.min(2, ferryWanted) ? 0.8 + 0.2 * ferryWanted : -Infinity;
      else s = muleUseful(ctx, army) ? 0.55 : -Infinity;
    }
    if (ut.id === 'arc' && army.total > 0 && ((army.count.arc ?? 0) + (army.count.salvo ?? 0)) * 6000 > 0.35 * army.total) s -= 0.8;
    if (ut.captures && army.capturers > 0 && army.capturers >= 0.6 * Math.max(1, army.foot + 4) && ctx.cycle > 2) s -= 0.3;
    // near the front first: a small pull toward the fabricator closest to the enemy
    const siteD = front ? manhattan(b.at, front) : 0;
    s -= 0.002 * siteD;
    if (s === -Infinity) continue;
    scored.push({ b, s });
    if (s > best) best = s;
  }
  if (!scored.length) return null;
  const top = scored.filter((x) => x.s >= best - 1e-9);
  return top[top.length > 1 ? pick(top.length) : 0].b;
}

/**
 * A mule pays for itself when a free property is a long walk from my fabricators (four turns or more for a trooper) and a hover unit
 * gets a trooper there at least two turns sooner, counting the turn it takes to load and unload. Mules cannot cross water: the sea
 * is the barge's job.
 */
function muleUseful(ctx: Ctx, army: Army): boolean {
  if (ctx.cycle < 3 || army.foot < 4 || (army.count.mule ?? 0) > 0) return false;
  const site = ctx.props.find((p) => p.owner === ctx.me && TERRAIN_TYPES[p.terrain].builds === 'ground');
  if (!site) return false;
  const foot = reachFrom(ctx, 'foot', site);
  const hover = reachFrom(ctx, 'hover', site);
  for (const p of ctx.props) {
    if (!(p.owner === null || (p.owner !== ctx.me && areEnemies(ctx.view, ctx.me, p.owner)))) continue;
    const i = p.y * ctx.W + p.x;
    if (foot[i] >= INF || hover[i] >= INF) continue;
    const walk = Math.ceil(foot[i] / UNIT_TYPES.trooper.move);
    const ride = Math.ceil(hover[i] / UNIT_TYPES.mule.move) + 1;
    if (walk >= 4 && ride <= walk - 2) return true;
  }
  return false;
}

/** How many of my capturers have a free property they can only reach by water or across a river. */
function ferryNeed(ctx: Ctx): number {
  let n = 0;
  const free = ctx.props.filter((p) => p.owner === null || (p.owner !== ctx.me && areEnemies(ctx.view, ctx.me, p.owner)));
  if (!free.length) return 0;
  const hasShore = ctx.props.some((p) => p.owner === ctx.me && p.terrain === 'dock');
  if (!hasShore) return 0;
  // a free property whose neighbours on land do not connect to my side by foot: cheap test = no foot path from any of my units
  const src = ctx.mine.find((u) => UNIT_TYPES[u.type].captures);
  if (!src) return 0;
  const reach = reachableByFoot(ctx, src);
  for (const p of free) {
    if (reach(p.x, p.y) >= INF) n++;
  }
  return Math.min(2, n);
}

function reachableByFoot(ctx: Ctx, from: Unit): (x: number, y: number) => number {
  const f = reachFrom(ctx, UNIT_TYPES[from.type].moveType, { x: from.x, y: from.y });
  return (x, y) => f[y * ctx.W + x];
}
