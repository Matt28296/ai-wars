// Doctrine unit planning (docs/research/ai-behaviour.md B.1, B.3, B.4, B.6, B.7): given the actions the agent is offered (the list
// from agentActions, so every candidate is legal by construction), score what each un-acted unit could do and pick the best.
//
// A candidate is one move action: a unit, where it ends, and what it does there (wait, attack, capture, load, unload, join, supply).
// Its score is in funds:
//     what the action does   (damage dealt and kills, capture progress, a drop that gets a capturer to its property, a repair)
//   + where it leaves the unit (progress toward what the posture wants, defensive terrain, not blocking a fabricator)
//   - what it costs          (the counter-attack taken, and the damage the enemy can do to the unit where it ends)
// minus the same number for the unit simply staying put, so a unit acts only when acting is worth something. Win-now and stop-loss
// actions carry a large bonus and their own class (B.1); the class breaks near-ties otherwise.
import { TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import { DAMAGE } from '../../data/damage';
import { CAPTURE_POINTS, displayHp } from '../aw';
import { actionKey } from '../aw/legal';
import { areEnemies, manhattan, teamOf } from '../aw/state';
import type { Action, Coord, MoveType, Then, Unit } from '../aw/types';
import type { Ctx, Goals, PropInfo, StrikeOutcome } from './eval';
import { covered } from './eval';
import {
  INF, capturable, distTo, exposure, threatOn, foeAnchors as foeAnchorsFor, frontFraction, goals, homeGoals, propertyValue, reachFrom, roleMult,
  roleOf, serviceTiles, starsAt, strike, unitValue, foeGoals, isServiceTile,
} from './eval';
import type { Posture } from './orders';

export type MoveAction = Extract<Action, { kind: 'move' }>;

export interface Cand {
  a: MoveAction;
  dest: Coord;
  then: Then;
}

export interface Scored {
  action: Action;
  score: number;
  /** B.1 priority class, 1 (win now) to 9 (reposition). */
  cls: number;
}

// ---------------------------------------------------------------- posture parameters

interface Params {
  /** How much of the counter-attack a strike takes counts against it. */
  counterW: number;
  /** How much of the damage the enemy can do where the unit ends counts against it. */
  exposureW: number;
  /** Funds per defence star, as a fraction of the unit's cost. */
  starW: number;
}

const PARAMS: Record<Posture, Params> = {
  advance: { counterW: 0.6, exposureW: 0.25, starW: 0.005 },
  holdTheLine: { counterW: 1, exposureW: 0.6, starW: 0.012 },
  fallBack: { counterW: 1.2, exposureW: 1, starW: 0.014 },
};

const SPIRE_STAKE = 400000;
const WIN_NOW = 1e7;
const STOP_LOSS = 1e6;
const MIN_GAIN = 20;

/** How far along the road between the two bases (0 = mine, 1 = theirs) this posture wants the line of battle at this cycle. */
function lineFraction(posture: Posture, cycle: number): number {
  if (posture === 'advance') return 1;
  if (posture === 'fallBack') return 0.18;
  return Math.min(0.9, 0.45 + 0.025 * Math.max(0, cycle - 5));
}

// ---------------------------------------------------------------- the planning environment

interface Asg {
  prop: PropInfo;
  /** No land route from here: needs a transport. */
  ferry: boolean;
  etaTurns: number;
}

interface Plan {
  /** Funds of progress from standing on `d` instead of where the unit is now (>0 = better). */
  progress: (d: Coord) => number;
}

export interface Env {
  ctx: Ctx;
  P: Params;
  exposureW: number;
  lf: number;
  byUnit: Map<number, Cand[]>;
  plans: Map<number, Plan>;
  strikes: Map<string, StrikeOutcome>;
  asg: Map<number, Asg> | null;
  support: Map<number, number> | null;
  guard: number | null | undefined;
  maxFoeValue: number;
  minFoeHp: number;
  /** Funds I hold, for deciding whether a unit standing on a fabricator is in the way. */
  funds: number;
  cheapest: Record<string, number>;
}

export function groupByUnit(actions: Action[]): Map<number, Cand[]> {
  const out = new Map<number, Cand[]>();
  for (const a of actions) {
    if (a.kind !== 'move') continue;
    const dest = a.path[a.path.length - 1];
    let list = out.get(a.unitId);
    if (!list) out.set(a.unitId, (list = []));
    list.push({ a, dest, then: a.then });
  }
  return out;
}

function makeEnv(ctx: Ctx, byUnit: Map<number, Cand[]>): Env {
  const posture = ctx.orders.posture;
  const P = PARAMS[posture];
  // Pressure (B.10-style): when my army clearly outweighs what I can see of theirs, take more risk; when it is outweighed, less.
  let mineV = 0;
  for (const u of ctx.mine) mineV += unitValue(u);
  let foeV = 0;
  let maxFoe = 1;
  let minHp = 100;
  for (const e of ctx.foes) {
    const v = unitValue(e, false);
    foeV += v;
    if (v > maxFoe) maxFoe = v;
    if (e.hp < minHp) minHp = e.hp;
  }
  const ratio = mineV / (foeV + 1);
  let pressure = 1;
  if (ratio >= 1.4) pressure = 0.6;
  else if (ratio <= 0.7) pressure = 1.25;
  const creep = Math.max(0.4, 1 - 0.04 * Math.max(0, ctx.cycle - 8));
  // far ahead of everything I can see, the line stops mattering: finish it
  const crushing = ratio >= 2.2 && ctx.foes.length > 0 && ctx.cycle >= 8 && posture !== 'fallBack';
  const cheapest: Record<string, number> = { ground: INF, air: INF, sea: INF };
  for (const t of Object.values(UNIT_TYPES)) cheapest[t.domain] = Math.min(cheapest[t.domain], t.cost);
  return {
    ctx, P, exposureW: P.exposureW * pressure * (posture === 'fallBack' ? 1 : creep), lf: crushing ? 1 : lineFraction(posture, ctx.cycle), byUnit,
    plans: new Map(), strikes: new Map(), asg: null, support: null, guard: undefined,
    maxFoeValue: maxFoe, minFoeHp: minHp, funds: ctx.view.players[ctx.me].funds, cheapest,
  };
}

// ---------------------------------------------------------------- small helpers

const here = (u: Unit): Coord => ({ x: u.x, y: u.y });
const same = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y;
const tileOf = (ctx: Ctx, c: Coord) => ctx.view.tiles[c.y][c.x];
const moveTypeOf = (u: Unit): MoveType => UNIT_TYPES[u.type].moveType;

function strikeOf(env: Env, a: Unit, from: Coord, t: Unit): StrikeOutcome {
  const key = `${a.id}|${from.x},${from.y}|${t.id}`;
  let s = env.strikes.get(key);
  if (!s) env.strikes.set(key, (s = strike(env.ctx, a, from, t)));
  return s;
}

/** B.3 futureDamageAvoided: what the target would do to me next turn if it lived. */
function futureDamage(t: Unit): number {
  const ut = UNIT_TYPES[t.type];
  if (!ut.range) return 0;
  return 0.3 * ut.cost * (t.hp / 100) * (ut.range[0] > 1 ? 1.4 : 1);
}

/** The orders' target priorities as a multiplier on what damage to this target is worth (1 = no preference, at most 2). */
function priorityMult(env: Env, t: Unit): number {
  const list = env.ctx.orders.targetPriority;
  if (!list.length) return 1;
  const ut = UNIT_TYPES[t.type];
  let bonus = 0;
  for (let i = 0; i < list.length; i++) {
    let intensity = 0;
    switch (list[i]) {
      case 'capturers': intensity = ut.captures ? (roleMult(env.ctx, t) > 1.2 ? 1 : 0.8) : 0; break;
      case 'indirects': intensity = ut.range && ut.range[0] > 1 ? 1 : 0; break;
      case 'transports': intensity = ut.carries ? 1 : 0; break;
      case 'highestValue': intensity = unitValue(t, false) / env.maxFoeValue; break;
      case 'weakest': intensity = 1 - (t.hp - env.minFoeHp) / 100; break;
    }
    bonus += (0.6 * intensity * (list.length - i)) / list.length;
  }
  return 1 + Math.min(1, bonus);
}

/** How far toward the enemy a tile lies, as a straight-line share of the way between the two bases (0 = mine, 1 = theirs). */
function sideFraction(ctx: Ctx, c: Coord): number {
  const home = homeGoals(ctx).list;
  const foe = foeAnchorsFor(ctx);
  if (!home.length || !foe.length) return 0.5;
  let h = INF;
  for (const o of home) h = Math.min(h, manhattan(c, o));
  let f = INF;
  for (const o of foe) f = Math.min(f, manhattan(c, o));
  return h + f <= 0 ? 0.5 : h / (h + f);
}

// ---------------------------------------------------------------- capturer assignment (B.4)

function transportsFor(ctx: Ctx): Unit[] {
  return ctx.mine.filter((u) => !!UNIT_TYPES[u.type].carries);
}

function canFerry(ctx: Ctx): boolean {
  if (transportsFor(ctx).length) return true;
  return ctx.props.some((p) => p.owner === ctx.me && p.terrain === 'dock');
}

/** Matches each of my capturers (on the map or loaded) to the property it should take: value / (1 + turns to get there), greedily,
 *  a capturer already part-way through a capture keeping it. */
function assignments(env: Env): Map<number, Asg> {
  if (env.asg) return env.asg;
  const ctx = env.ctx;
  const out = new Map<number, Asg>();
  env.asg = out;
  const riders: { u: Unit; at: Coord }[] = [];
  for (const u of ctx.mine) {
    if (UNIT_TYPES[u.type].captures) riders.push({ u, at: here(u) });
    for (const c of u.cargo) if (UNIT_TYPES[c.type].captures) riders.push({ u: c, at: here(u) });
  }
  riders.sort((a, b) => a.u.id - b.u.id);
  const claimed = new Set<number>();
  const posture = ctx.orders.posture;
  const ferryOk = canFerry(ctx);
  const homeG = homeGoals(ctx);

  const take = (r: { u: Unit; at: Coord }, p: PropInfo, ferry: boolean, eta: number) => {
    out.set(r.u.id, { prop: p, ferry, etaTurns: eta });
    claimed.add(p.y * ctx.W + p.x);
  };
  // pass 1: a capturer standing on a property it is taking keeps it
  for (const r of riders) {
    if (!ctx.mine.includes(r.u)) continue; // a capturer riding in a transport is not standing on anything
    const p = capturable(ctx, r.u).find((q) => q.x === r.u.x && q.y === r.u.y);
    if (p && !claimed.has(p.y * ctx.W + p.x)) take(r, p, false, 0);
  }
  // pass 2: every free capturer against every free property, the best pairs first (so the nearest, fastest capturer gets a prize
  // and not whichever unit happens to have the lowest id)
  interface Pair { r: { u: Unit; at: Coord }; p: PropInfo; ferry: boolean; eta: number; score: number }
  const pairs: Pair[] = [];
  for (const r of riders) {
    if (out.has(r.u.id)) continue;
    const mt = moveTypeOf(r.u);
    const f = reachFrom(ctx, mt, r.at);
    const move = Math.max(1, UNIT_TYPES[r.u.type].move);
    const mine: Pair[] = [];
    for (const p of capturable(ctx, r.u)) {
      const pi = p.y * ctx.W + p.x;
      if (claimed.has(pi)) continue;
      const occ = ctx.at.get(pi);
      if (occ && occ.owner !== ctx.me && areEnemies(ctx.view, ctx.me, occ.owner)) continue;
      const d = f[pi];
      const ferry = d >= INF;
      if (ferry && !ferryOk) continue;
      const eta = ferry ? 4 : Math.ceil(d / move);
      let value = propertyValue(ctx, p);
      // the posture's reach: Hold the Line does not send capturers deep into the enemy's half while there is work nearer home,
      // Fall Back keeps them close to the base. Far properties are not forbidden, only a poor second choice.
      if (posture === 'fallBack' && distTo(ctx, mt, homeG, p) > 10) value *= 0.05;
      if (posture === 'holdTheLine' && sideFraction(ctx, p) > env.lf + 0.22) value *= 0.35;
      if (posture === 'advance') value *= 1 + sideFraction(ctx, p);
      mine.push({ r, p, ferry, eta, score: value / (1 + eta) });
    }
    mine.sort((a, b) => b.score - a.score);
    // the risk of walking onto the property is worked out for the few it would choose between
    for (const pair of mine.slice(0, 5)) {
      if (!pair.r.u.cargo.length && ctx.mine.includes(pair.r.u)) {
        const risk = Math.min(1, exposureDamage(env, pair.r.u, pair.p) / Math.max(1, pair.r.u.hp));
        pair.score *= 1 - 0.5 * risk;
      }
      pairs.push(pair);
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.r.u.id - b.r.u.id || a.p.y * ctx.W + a.p.x - (b.p.y * ctx.W + b.p.x));
  for (const pair of pairs) {
    if (out.has(pair.r.u.id) || claimed.has(pair.p.y * ctx.W + pair.p.x)) continue;
    take(pair.r, pair.p, pair.ferry, pair.eta);
  }
  return out;
}

function exposureDamage(env: Env, u: Unit, at: Coord): number {
  // threatOn is exposure() / cost, scaled back to HP: use exposure's own memo through a tiny wrapper
  const cost = UNIT_TYPES[u.type].cost || 1;
  return (exposure(env.ctx, u, at) / cost) * 100;
}

// ---------------------------------------------------------------- spire guard (B.4)

function guardId(env: Env): number | null {
  if (env.guard !== undefined) return env.guard;
  const ctx = env.ctx;
  env.guard = null;
  const spire = ctx.homeSpires[0];
  if (!spire) return null;
  const danger = ctx.foes.some((e) => {
    const t = UNIT_TYPES[e.type];
    return !!t.captures && manhattan(e, spire) <= 2 * t.move + 2;
  });
  if (!danger) return null;
  let best: Unit | null = null;
  let bestD = INF;
  for (const u of ctx.mine) {
    const t = UNIT_TYPES[u.type];
    if (t.domain !== 'ground' || t.carries || (t.range && t.range[0] > 1)) continue;
    const d = manhattan(u, spire);
    if (d < bestD || (d === bestD && best && u.id < best.id)) {
      best = u;
      bestD = d;
    }
  }
  env.guard = best ? best.id : null;
  return env.guard;
}

// ---------------------------------------------------------------- needs: repair, fuel, ammo (B.6)

type Need = 'hp' | 'fuel' | 'ammo' | null;

function needOf(env: Env, u: Unit): Need {
  const ctx = env.ctx;
  const t = UNIT_TYPES[u.type];
  if (!serviceTiles(ctx, u).length) return null;
  const onService = isServiceTile(ctx, u, u);
  const limit = ctx.orders.retreatAtHp;
  if (limit > 0) {
    const hp = displayHp(u.hp);
    if (hp <= limit || (onService && hp <= Math.min(8, limit + 3) && hp < 10)) return 'hp';
  }
  if (onService) return null;
  if (t.ammo !== null && u.ammo === 0 && DAMAGE[u.type] && !DAMAGE[u.type].secondary) return 'ammo';
  if (t.drain) {
    const near = serviceDistance(env, u, here(u));
    if (u.charge <= t.drain * (Math.ceil(near / Math.max(1, t.move)) + 2)) return 'fuel';
  } else if (t.domain === 'ground' && u.charge <= 2 * t.move) return 'fuel';
  return null;
}

function serviceGoals(env: Env, u: Unit): Goals {
  const dom = UNIT_TYPES[u.type].domain;
  return goals(`service:${dom}`, serviceTiles(env.ctx, u), true);
}

function serviceDistance(env: Env, u: Unit, at: Coord): number {
  return distTo(env.ctx, moveTypeOf(u), serviceGoals(env, u), at);
}

// ---------------------------------------------------------------- where a unit wants to be

function stepValue(u: Unit, posture: Posture = 'holdTheLine'): number {
  return Math.max(40, Math.min(300, UNIT_TYPES[u.type].cost * 0.02)) * (posture === 'advance' ? 1.6 : 1);
}

function planFor(env: Env, u: Unit): Plan {
  let plan = env.plans.get(u.id);
  if (plan) return plan;
  plan = makePlan(env, u);
  env.plans.set(u.id, plan);
  return plan;
}

function makePlan(env: Env, u: Unit): Plan {
  const ctx = env.ctx;
  const t = UNIT_TYPES[u.type];
  const mt = t.moveType;
  const now = here(u);
  const role = roleOf(t);
  const posture = ctx.orders.posture;
  const sv = stepValue(u, posture);

  const need = needOf(env, u);
  if (need) {
    const g = serviceGoals(env, u);
    const d0 = distTo(ctx, mt, g, now);
    const stepS = Math.max(120, sv * 2);
    return { progress: (d) => (d0 - distTo(ctx, mt, g, d)) * stepS };
  }

  const toward = (g: Goals, step: number): Plan => {
    const d0 = distTo(ctx, mt, g, now);
    return { progress: (d) => (d0 - distTo(ctx, mt, g, d)) * step };
  };
  const line = (lf: number, step: number): Plan => {
    const f0 = Math.abs(frontFraction(ctx, mt, now) - lf);
    return { progress: (d) => (f0 - Math.abs(frontFraction(ctx, mt, d) - lf)) * step * 30 };
  };
  const ring = (step: number): Plan => {
    const base = homeGoals(ctx);
    const prod = ctx.props.filter((p) => p.owner === ctx.me && !!TERRAIN_TYPES[p.terrain].builds);
    const g = goals('ring', [...base.list, ...prod], true);
    const R = 3;
    const d0 = Math.max(0, distTo(ctx, mt, g, now) - R);
    return { progress: (d) => (d0 - Math.max(0, distTo(ctx, mt, g, d) - R)) * step };
  };
  const posturePlan = (lfShift: number, step: number): Plan => {
    if (posture === 'advance') return toward(foeGoals(ctx), step);
    if (posture === 'fallBack') return ring(step);
    return line(Math.max(0.05, env.lf + lfShift), step);
  };

  if (role === 'capturer') {
    const a = assignments(env).get(u.id);
    if (a) {
      const step = Math.max(150, Math.min(500, propertyValue(ctx, a.prop) * 0.05));
      if (a.ferry) {
        const ts = transportsFor(ctx).filter((x) => x.cargo.length < (UNIT_TYPES[x.type].carries ?? 0));
        if (ts.length) return toward(goals(`ferry:${ts.map((x) => x.id).join('.')}`, ts.map(here), true), step);
        const docks = ctx.props.filter((p) => p.owner === ctx.me && p.terrain === 'dock');
        return toward(goals('docks', docks, true), step);
      }
      return toward(goals(`prop:${a.prop.x},${a.prop.y}`, [a.prop], true), step);
    }
    return posturePlan(-0.05, sv);
  }

  if (role === 'transport') {
    if (u.cargo.length) {
      const asg = assignments(env);
      const rider = u.cargo.map((c) => asg.get(c.id)).find((x) => !!x);
      if (rider) {
        const step = Math.max(150, Math.min(500, propertyValue(ctx, rider.prop) * 0.05));
        return toward(goals(`dropAt:${rider.prop.x},${rider.prop.y}`, [rider.prop], false), step);
      }
      return posturePlan(-0.1, sv);
    }
    const asg = assignments(env);
    const waiting = ctx.mine.filter((c) => asg.get(c.id)?.ferry && UNIT_TYPES[c.type].captures);
    if (waiting.length) return toward(goals(`waiting:${waiting.map((c) => c.id).join('.')}`, waiting.map(here), false), sv);
    return posturePlan(-0.12, sv);
  }

  if (role === 'indirect') {
    const base = posturePlan(-0.08, sv);
    const range = t.range ?? [2, 3];
    const foes = ctx.foes;
    const ownDirect = ctx.mine.filter((x) => x.id !== u.id && !!UNIT_TYPES[x.type].range && UNIT_TYPES[x.type].range![0] === 1 && UNIT_TYPES[x.type].domain === t.domain);
    const reachValue = (d: Coord): number => {
      let v = 0;
      for (const e of foes) {
        const m = manhattan(d, e);
        if (m >= range[0] && m <= range[1]) v += 0.3 * unitValue(e, false);
        else if (m > range[1] && m <= range[1] + 3) v += 0.1 * unitValue(e, false);
      }
      return v;
    };
    const screened = (d: Coord): number => {
      if (!foes.length) return 0;
      let nearest: Unit | null = null;
      let nd = INF;
      for (const e of foes) {
        const m = manhattan(d, e);
        if (m < nd) {
          nd = m;
          nearest = e;
        }
      }
      if (!nearest) return 0;
      return ownDirect.some((o) => manhattan(o, d) <= 3 && manhattan(o, nearest!) < nd) ? 0.06 * t.cost : 0;
    };
    // a tile only offers a shot next turn if the unit lives to take it: the value of being in range fades as the damage it would
    // take where it stands rises, and is gone once that damage is two thirds of its health
    const worth = (d: Coord) => {
      const risk = threatOn(ctx, u, d) / Math.max(1, u.hp);
      return Math.max(0, 1 - 1.5 * risk) * reachValue(d) + screened(d);
    };
    const r0 = worth(now);
    return { progress: (d) => base.progress(d) + Math.min(2500, worth(d) - r0) };
  }

  // direct fighters: ground, air, naval
  return posturePlan(0, sv);
}

// ---------------------------------------------------------------- scoring one candidate

interface Eval {
  value: number;
  cls: number;
  /** HP the unit has after any counter-attack, for the exposure term. */
  hpAfter: number;
}

/** Standing on one of my own production tiles that I could build on with the funds I hold: the unit is in the way. */
function prodBlocked(env: Env, d: Coord): boolean {
  const tile = tileOf(env.ctx, d);
  const tt = TERRAIN_TYPES[tile.terrain];
  if (!tt.builds || tile.owner !== env.ctx.me) return false;
  return env.funds >= (env.cheapest[tt.builds] ?? INF);
}

function posBase(env: Env, u: Unit, d: Coord): number {
  const ctx = env.ctx;
  const t = UNIT_TYPES[u.type];
  let v = starsAt(ctx, u, d) * t.cost * env.P.starW;
  v += planFor(env, u).progress(d);
  if (prodBlocked(env, d)) v -= Math.min(4000, 300 + 0.15 * env.funds);
  if (!same(d, u)) {
    if (t.captures) {
      const tile = tileOf(ctx, u);
      const p = ctx.props.find((q) => q.x === u.x && q.y === u.y);
      if (p && (tile.owner === null || areEnemies(ctx.view, u.owner, tile.owner)) && tile.capture < CAPTURE_POINTS) {
        v -= propertyValue(ctx, p) * 0.7 * ((CAPTURE_POINTS - tile.capture) / CAPTURE_POINTS);
      }
    }
  }
  if (guardId(env) === u.id && ctx.homeSpires.some((s) => same(s, d))) v += STOP_LOSS * 0.5;
  return v;
}

/** B.3 captureDisruption: an attack on a capturer that is taking one of OUR properties is worth what it saves. */
function disruption(env: Env, tgt: Unit, so: StrikeOutcome): { value: number; spire: boolean } {
  const ctx = env.ctx;
  if (!UNIT_TYPES[tgt.type].captures) return { value: 0, spire: false };
  const tile = tileOf(ctx, tgt);
  if (tile.owner === null || teamOf(ctx.view, tile.owner) !== ctx.team) return { value: 0, spire: false };
  const p = ctx.props.find((q) => q.x === tgt.x && q.y === tgt.y);
  if (!p) return { value: 0, spire: false };
  const stake = p.hq ? SPIRE_STAKE : propertyValue(ctx, p);
  const remaining = tile.capture;
  const urgency = (hp: number) => (hp <= 0 ? 0 : 1 / Math.ceil(remaining / Math.max(1, displayHp(hp))));
  const before = urgency(tgt.hp);
  const after = (1 - so.killP) * urgency(tgt.hp - so.dealtHp);
  return { value: stake * Math.max(0, before - after) + stake * 0.05 * (so.dealtHp / 100), spire: p.hq };
}

function supportOf(env: Env, tgt: Unit): number {
  if (!env.support) {
    const m = new Map<number, number>();
    const best = new Map<string, number>();
    for (const [uid, cands] of env.byUnit) {
      const u = env.ctx.mine.find((x) => x.id === uid);
      if (!u || u.acted) continue;
      for (const c of cands) {
        if (c.then.kind !== 'attack') continue;
        const t = env.ctx.at.get(c.then.target.y * env.ctx.W + c.then.target.x);
        if (!t) continue;
        const so = strikeOf(env, u, c.dest, t);
        const k = `${uid}|${t.id}`;
        if (so.dealtHp > (best.get(k) ?? 0)) best.set(k, so.dealtHp);
      }
    }
    for (const [k, v] of best) {
      const tid = Number(k.split('|')[1]);
      m.set(tid, (m.get(tid) ?? 0) + v);
    }
    env.support = m;
  }
  return env.support.get(tgt.id) ?? 0;
}

function lastEnemy(env: Env): boolean {
  const ctx = env.ctx;
  return !ctx.fogged && ctx.foes.length === 1 && ctx.foes[0].cargo.length === 0;
}

function evalCand(env: Env, u: Unit, c: Cand, mode: Need): Eval | null {
  const ctx = env.ctx;
  const t = UNIT_TYPES[u.type];
  const d = c.dest;
  const kind = c.then.kind;
  const ev: Eval = { value: 0, cls: 9, hpAfter: u.hp };
  const staying = same(d, u);

  switch (kind) {
    case 'wait':
      ev.value = posBase(env, u, d);
      if (mode) ev.cls = 8;
      return ev;

    case 'attack': {
      const target = ctx.at.get(c.then.target.y * ctx.W + c.then.target.x);
      if (!target || !areEnemies(ctx.view, u.owner, target.owner)) return null;
      const so = strikeOf(env, u, d, target);
      const dis = disruption(env, target, so);
      const killsWin = lastEnemy(env) && so.killP >= 0.99; // the last enemy unit I can see, with no fog: destroying it wins
      if (mode && !killsWin && !(staying && isServiceTile(ctx, u, u))) return null;
      const pm = priorityMult(env, target);
      const tcost = UNIT_TYPES[target.type].cost;
      let dealt = (so.dealtHp / 100) * tcost * roleMult(ctx, target) * pm;
      let kill = so.killP * (0.5 * unitValue(target, false) * pm + futureDamage(target));
      const taken = (so.counterHp / 100) * t.cost;
      if (ctx.orders.posture === 'fallBack') {
        const near = distTo(ctx, moveTypeOf(u), homeGoals(ctx), target) <= 9;
        if (!near) {
          dealt *= 0.5;
          kill *= 0.5;
        }
      }
      if (taken > dealt && so.killP < 0.9 && dis.value <= 0 && !killsWin) return null;
      let focus = 0;
      if (so.killP < 1 && supportOf(env, target) >= target.hp) focus = 0.3 * unitValue(target, false) * (so.dealtHp / target.hp);
      ev.value = dealt + kill + dis.value + focus - env.P.counterW * taken + posBase(env, u, d);
      ev.hpAfter = Math.max(1, u.hp - so.counterHp);
      ev.cls = t.range && t.range[0] > 1 ? 3 : so.killP >= 0.5 ? 4 : 5;
      if (dis.value > 0.3 * (dis.spire ? SPIRE_STAKE : 3000) && dis.value > 0) {
        ev.cls = 2;
        ev.value += STOP_LOSS;
      }
      if (killsWin) {
        ev.cls = 1;
        ev.value += WIN_NOW;
      }
      return ev;
    }

    case 'capture': {
      const p = ctx.props.find((q) => q.x === d.x && q.y === d.y);
      if (!p) return null;
      const tile = tileOf(ctx, d);
      const remaining = tile.capture;
      const apply = displayHp(u.hp);
      const completes = apply >= remaining;
      const value = propertyValue(ctx, p);
      const win = completes && p.hq && p.owner !== null && areEnemies(ctx.view, u.owner, p.owner);
      if (mode && !win) return null;
      const frac = Math.min(apply, remaining) / CAPTURE_POINTS;
      ev.value = value * (0.35 + 0.65 * frac) + (completes ? value * 0.5 : 0) + posBase(env, u, d);
      ev.cls = 6;
      if (win) {
        ev.cls = 1;
        ev.value += WIN_NOW;
      }
      return ev;
    }

    case 'load': {
      if (mode) return null;
      const a = assignments(env).get(u.id);
      if (!a) return null;
      const x = ctx.at.get(d.y * ctx.W + d.x);
      if (!x) return null;
      const xt = UNIT_TYPES[x.type];
      const pv = propertyValue(ctx, a.prop);
      if (a.ferry) ev.value = pv * 0.5;
      else {
        const etaFerry = 1 + distTo(ctx, xt.moveType, goals(`dropAt:${a.prop.x},${a.prop.y}`, [a.prop], false), x) / Math.max(1, xt.move);
        const gain = a.etaTurns - etaFerry;
        if (gain < 2) return null;
        ev.value = pv * 0.06 * gain;
      }
      ev.value += 300;
      ev.cls = 7;
      return ev;
    }

    case 'unload': {
      if (mode) return null;
      const asg = assignments(env);
      let total = 0;
      for (const drop of c.then.drops) {
        const cargo = u.cargo[drop.cargoIndex];
        const a = cargo ? asg.get(cargo.id) : undefined;
        if (!cargo || !a) {
          total -= 400;
          continue;
        }
        const goalsP = goals(`prop:${a.prop.x},${a.prop.y}`, [a.prop], true);
        const mtc = moveTypeOf(cargo);
        const before = distTo(ctx, mtc, goalsP, u);
        const after = distTo(ctx, mtc, goalsP, drop.to);
        const step = Math.max(150, Math.min(500, propertyValue(ctx, a.prop) * 0.05));
        total += (before - after) * step - 200;
        if (same(drop.to, a.prop)) total += propertyValue(ctx, a.prop) * 0.2;
      }
      ev.value = total + posBase(env, u, d);
      ev.cls = 7;
      return ev;
    }

    case 'join': {
      const other = ctx.at.get(d.y * ctx.W + d.x);
      if (!other) return null;
      const sum = displayHp(u.hp) + displayHp(other.hp);
      if (!mode || sum > 11) return null;
      ev.value = posBase(env, u, d) + 0.3 * t.cost * (Math.min(displayHp(u.hp), 10 - displayHp(other.hp)) / 10);
      ev.cls = 8;
      return ev;
    }

    case 'supply': {
      if (mode) return null;
      ev.value = posBase(env, u, d) + 100;
      ev.cls = 7;
      return ev;
    }
  }
}

/** Value of being on a service tile next turn (B.6: hpGain / 10 x cost, less the exposure counted elsewhere). */
function serviceBonus(env: Env, u: Unit, d: Coord, mode: Need): number {
  if (!mode || !isServiceTile(env.ctx, d, u)) return 0;
  const gain = Math.min(2, 10 - displayHp(u.hp)) / 10;
  return 600 + gain * UNIT_TYPES[u.type].cost * 0.8;
}

// ---------------------------------------------------------------- one unit, then all of them

/** Candidates from the shortlist stage onward get the exposure term; the rest are ranked by their cheap score alone. */
const SHORTLIST = 14;

function chooseForUnit(env: Env, u: Unit, cands: Cand[], pick: (n: number) => number): Scored | null {
  const ctx = env.ctx;
  const t = UNIT_TYPES[u.type];
  const mode = needOf(env, u);
  const indirect = !!t.range && t.range[0] > 1;
  const expW = env.exposureW * (indirect ? 2 : 1);

  interface Row { c: Cand; ev: Eval; pre: number }
  const rows: Row[] = [];
  let stay: Row | null = null;
  for (const c of cands) {
    const ev = evalCand(env, u, c, mode);
    if (!ev) continue;
    ev.value += serviceBonus(env, u, c.dest, mode);
    const row = { c, ev, pre: ev.value };
    rows.push(row);
    if (c.then.kind === 'wait' && same(c.dest, u)) stay = row;
  }
  if (!rows.length) return null;

  const full = (r: Row): number => r.ev.value - expW * exposure(ctx, u, r.c.dest, r.ev.hpAfter);

  rows.sort((a, b) => b.pre - a.pre);
  const special = (r: Row) => r.c.then.kind !== 'wait';
  // Exposure is the costly term, so it is only computed for a shortlist: the best by the cheap score, every action that does
  // something, and the best tiles the enemy cannot reach (the shortlist alone would hold only the advanced, dangerous tiles).
  const scored: { r: Row; s: number }[] = [];
  let evaluated = 0;
  let safeSeen = 0;
  for (const r of rows) {
    const reached = covered(ctx, r.c.dest);
    const take = evaluated < SHORTLIST || (special(r) && evaluated < SHORTLIST * 3) || (!reached && safeSeen < 6);
    if (!reached && take) safeSeen++;
    if (take) {
      evaluated++;
      scored.push({ r, s: full(r) });
    }
  }
  const stayScore = stay ? full(stay) : 0;
  if (stay && !scored.some((x) => x.r === stay)) scored.push({ r: stay, s: stayScore }); // the stay row is always a candidate
  let bestScore = -Infinity;
  for (const x of scored) if (x.s > bestScore) bestScore = x.s;
  // equal scores are broken by the seeded generator, not by reading order, so no corner of the map is favoured
  const top = scored.filter((x) => x.s >= bestScore - 1e-6);
  const bestRow: Row = top[top.length > 1 ? pick(top.length) : 0].r;
  const chosen: Row = bestRow;
  if (chosen === stay) return null;
  const gain = bestScore - stayScore;
  if (chosen.ev.cls > 2 && gain < MIN_GAIN) return null;
  return { action: chosen.c.a, score: gain, cls: chosen.ev.cls };
}

/** The best action among all un-acted units, or null when none has anything worth doing. */
export function bestUnitAction(ctx: Ctx, byUnit: Map<number, Cand[]>, pick: (n: number) => number): Scored | null {
  const env = makeEnv(ctx, byUnit);
  const choices: Scored[] = [];
  const mine = [...ctx.mine].sort((a, b) => a.id - b.id);
  for (const u of mine) {
    if (u.acted) continue;
    const cands = byUnit.get(u.id);
    if (!cands) continue;
    const s = chooseForUnit(env, u, cands, pick);
    if (s) choices.push(s);
  }
  if (!choices.length) return null;
  let top = -Infinity;
  for (const s of choices) if (s.score > top) top = s.score;
  const near = choices.filter((s) => s.score >= top - Math.abs(top) * 0.05);
  let lowest = 99;
  for (const s of near) if (s.cls < lowest) lowest = s.cls;
  const tied = near.filter((s) => s.cls === lowest).sort((a, b) => b.score - a.score || (actionKey(a.action) < actionKey(b.action) ? -1 : 1));
  // ties within a hair of each other are broken by the seeded generator, never by reading order
  const best = tied[0].score;
  const exact = tied.filter((s) => s.score >= best - 1e-6);
  return exact[exact.length > 1 ? pick(exact.length) : 0];
}

