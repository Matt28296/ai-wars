// Turns one step's events into an animation plan, and samples the plan at a moment in time. Pure: the React layer only runs a clock
// and draws what sampleTransition says.
//
// The plan is built ONLY from the viewer's frames (before and after) and the viewer's filtered events (viewEvents for a player,
// the raw events for 'all'). It never looks at the true state, so a fogged viewer's animation cannot show what its events do not:
// a move into the dark glides only along the part the viewer saw, a shot from an unseen unit flashes only the unit that was hit.
//
// Beats run one after another along a cursor (move, then hit, then explosion ...), the way the original games sequence them;
// the turn banner opens the step, and a power's cut-in takes the whole screen for itself.
import { COMMANDERS } from '../../content/commanders';
import type { CommanderId, Coord, GameEvent, PlayerIndex, Unit } from '../../game/aw';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import { commanderNameOf, powerNameOf } from './format';
import { glideEase, moveTileMs, scaled, slideInOut, TIMINGS, typedText, bannerMs, cutInMs } from './timing';
import type { Speed } from './timing';
import { headingOfPath, pointAlongPath } from './layout';
import type { Facing } from './unitview';
import type { ViewFrame } from './timeline';

export interface PlanOptions {
  speed: Speed;
  reducedMotion?: boolean;
}

export type FxKind = 'hit' | 'explosion' | 'pulse' | 'ambush' | 'spawn';

export interface FxBeat { kind: FxKind; at: Coord; startMs: number; durMs: number }
export interface NumberBeat { at: Coord; text: string; tone: 'damage' | 'heal'; startMs: number; durMs: number }
export interface MoveBeat { unitId: number; path: Coord[]; startMs: number; durMs: number }
/** A unit's hit points change at `atMs`: `from` (when the viewer knew it) before, `to` after. Internal HP, 0..100. */
export interface HpBeat { unitId: number; atMs: number; from?: number; to: number }
/** A unit that is in the step's first frame but not its last: drawn until `untilMs`, fading from `fadeFromMs`. */
export interface GhostBeat { unit: Unit; at: Coord; fadeFromMs: number; untilMs: number }
/** A unit that does not exist yet (built) until `atMs`. */
export interface AppearBeat { unitId: number; atMs: number }

export interface CutInBeat {
  startMs: number;
  durMs: number;
  player: PlayerIndex;
  level: 'surge' | 'overclock';
  commanderId: CommanderId;
  commanderName: string;
  initials: string;
  powerName: string;
  quote: string;
  faction: ViewFrame['players'][number]['faction'];
}

export interface BannerBeat { startMs: number; durMs: number; player: PlayerIndex; cycle: number }

export interface TransitionPlan {
  /** When the last beat ends, in ms from the start of the step. 0 means there is nothing to animate. */
  durationMs: number;
  /** False when unit glides are switched off (4x, or reduced motion). */
  tween: boolean;
  moves: MoveBeat[];
  hp: HpBeat[];
  fx: FxBeat[];
  numbers: NumberBeat[];
  ghosts: GhostBeat[];
  appear: AppearBeat[];
  cutIn: CutInBeat | null;
  banner: BannerBeat | null;
}

const eachUnit = (units: Unit[], fn: (u: Unit) => void): void => {
  for (const u of units) {
    fn(u);
    eachUnit(u.cargo, fn);
  }
};

const same = (a: Coord, b: Coord): boolean => a.x === b.x && a.y === b.y;

function powerCutIn(next: ViewFrame, e: Extract<GameEvent, { kind: 'powerActivated' }>, startMs: number, durMs: number): CutInBeat {
  const def = Object.prototype.hasOwnProperty.call(COMMANDERS, e.commander) ? COMMANDERS[e.commander] : undefined;
  const power = e.level === 'surge' ? def?.surge : def?.overclock;
  return {
    startMs, durMs, player: e.player, level: e.level, commanderId: e.commander,
    commanderName: commanderNameOf(e.commander), initials: def?.initials ?? 'CO',
    powerName: powerNameOf(e.commander, e.level), quote: power?.quote ?? '',
    faction: next.players[e.player]?.faction ?? 'helion',
  };
}

/** The animation of the step from `prev` to `next`, built from the events the viewer was given. */
export function planTransition(prev: ViewFrame, next: ViewFrame, events: GameEvent[], opts: PlanOptions): TransitionPlan {
  const speed = opts.speed;
  const tileMs = moveTileMs(speed, opts.reducedMotion === true);
  const sc = (ms: number): number => scaled(ms, speed);
  const plan: TransitionPlan = {
    durationMs: 0, tween: tileMs > 0, moves: [], hp: [], fx: [], numbers: [], ghosts: [], appear: [], cutIn: null, banner: null,
  };

  const prevUnits = new Map<number, Unit>();
  eachUnit(prev.units, (u) => prevUnits.set(u.id, u));
  const nextTop = new Set(next.units.map((u) => u.id));
  const pos = new Map<number, Coord>();
  for (const u of prev.units) pos.set(u.id, { x: u.x, y: u.y });
  const nextPos = new Map<number, Coord>();
  for (const u of next.units) nextPos.set(u.id, { x: u.x, y: u.y });
  const where = (id: number): Coord | undefined => (id === UNSEEN_UNIT ? undefined : pos.get(id) ?? nextPos.get(id));

  let cursor = 0;
  const turn = events.find((e): e is Extract<GameEvent, { kind: 'turnStarted' }> => e.kind === 'turnStarted');
  if (turn) {
    plan.banner = { startMs: 0, durMs: bannerMs(speed), player: turn.player, cycle: turn.cycle };
    cursor = plan.banner.durMs;
  }

  const moveEnd = new Map<number, number>(); // when each unit's last glide ends
  const destroyedAt = new Map<number, { at: Coord; startMs: number }>();
  const exploded = new Set<string>();

  const hit = (at: Coord, text: string): void => {
    plan.fx.push({ kind: 'hit', at, startMs: cursor, durMs: sc(TIMINGS.hitMs) });
    if (text) plan.numbers.push({ at, text, tone: 'damage', startMs: cursor + sc(60), durMs: sc(TIMINGS.numberMs) });
  };
  const strike = (who: 'defender' | 'attacker', e: Extract<GameEvent, { kind: 'attacked' }>): void => {
    const id = who === 'defender' ? e.defenderId : e.attackerId;
    const amount = who === 'defender' ? e.damage : e.counter;
    const hpAfter = who === 'defender' ? e.defenderHp : e.attackerHp;
    const at = where(id);
    if (!at) return; // a shooter the viewer was never shown is not drawn flashing
    hit(at, `-${amount}%`);
    if (hpAfter !== UNSEEN_UNIT) plan.hp.push({ unitId: id, atMs: cursor + sc(120), from: prevUnits.get(id)?.hp, to: hpAfter });
    cursor += sc(TIMINGS.hitMs);
  };

  for (const e of events) {
    switch (e.kind) {
      case 'moved': {
        if (tileMs > 0 && e.path.length > 1) {
          const durMs = (e.path.length - 1) * tileMs;
          plan.moves.push({ unitId: e.unitId, path: e.path.map((c) => ({ x: c.x, y: c.y })), startMs: cursor, durMs });
          cursor += durMs;
          moveEnd.set(e.unitId, cursor);
        }
        if (e.path.length) pos.set(e.unitId, e.path[e.path.length - 1]);
        break;
      }
      case 'ambushed':
        plan.fx.push({ kind: 'ambush', at: e.at, startMs: cursor, durMs: sc(TIMINGS.ambushMs) });
        cursor += sc(TIMINGS.ambushLeadMs);
        break;
      case 'attacked': {
        if (e.counterFirst) {
          if (e.counter > 0) strike('attacker', e);
          strike('defender', e);
        } else {
          strike('defender', e);
          if (e.counter > 0) strike('attacker', e);
        }
        break;
      }
      case 'destroyed':
      case 'crashed': {
        const key = `${e.at.x},${e.at.y}`;
        destroyedAt.set(e.unitId, { at: e.at, startMs: cursor });
        if (!exploded.has(key)) {
          exploded.add(key);
          plan.fx.push({ kind: 'explosion', at: e.at, startMs: cursor, durMs: sc(TIMINGS.explosionMs) });
          cursor += sc(TIMINGS.explosionLeadMs);
        }
        break;
      }
      case 'captured':
        plan.fx.push({ kind: 'pulse', at: e.at, startMs: cursor, durMs: sc(TIMINGS.pulseMs) });
        cursor += sc(TIMINGS.pulseLeadMs);
        break;
      case 'built':
        plan.appear.push({ unitId: e.unitId, atMs: cursor });
        plan.fx.push({ kind: 'spawn', at: e.at, startMs: cursor, durMs: sc(TIMINGS.spawnMs) });
        pos.set(e.unitId, e.at);
        cursor += sc(TIMINGS.spawnLeadMs);
        break;
      case 'unloaded': {
        const from = e.transportId === UNSEEN_UNIT ? undefined : where(e.transportId);
        if (tileMs > 0 && from && !same(from, e.to)) {
          plan.moves.push({ unitId: e.unitId, path: [{ x: from.x, y: from.y }, { x: e.to.x, y: e.to.y }], startMs: cursor, durMs: tileMs });
          cursor += tileMs;
          moveEnd.set(e.unitId, cursor);
        }
        pos.set(e.unitId, e.to);
        break;
      }
      case 'powerActivated': {
        const durMs = cutInMs(speed);
        plan.cutIn = powerCutIn(next, e, cursor, durMs);
        cursor += durMs;
        break;
      }
      case 'powerEffect': {
        for (const c of e.affected) plan.fx.push({ kind: 'pulse', at: c, startMs: cursor, durMs: sc(TIMINGS.powerEffectMs) });
        if (e.affected.length) cursor += sc(TIMINGS.powerEffectLeadMs);
        break;
      }
      case 'repaired': {
        const at = where(e.unitId);
        if (!at) break;
        plan.numbers.push({ at, text: `+${Math.round(e.amount / 10)}`, tone: 'heal', startMs: cursor, durMs: sc(TIMINGS.numberMs) });
        const before = prevUnits.get(e.unitId)?.hp;
        plan.hp.push({ unitId: e.unitId, atMs: cursor, from: before, to: before === undefined ? Math.min(100, e.amount) : Math.min(100, before + e.amount) });
        break;
      }
      case 'turnStarted': // opened the step above
      case 'turnEnded':
      case 'dropBlocked':
      case 'captureProgress':
      case 'loaded':
      case 'joined':
      case 'supplied':
      case 'weather':
      case 'playerDefeated':
      case 'victory':
        break;
      default:
        assertNever(e);
    }
  }

  // Units the step takes off the board: destroyed ones stay until their explosion has run, ones that left the viewer's sight
  // or boarded a transport stay until they have finished gliding off.
  for (const u of prev.units) {
    if (nextTop.has(u.id)) continue;
    const dead = destroyedAt.get(u.id);
    if (dead) {
      const untilMs = dead.startMs + sc(TIMINGS.explosionMs);
      plan.ghosts.push({ unit: u, at: { x: u.x, y: u.y }, fadeFromMs: dead.startMs, untilMs });
      continue;
    }
    const end = moveEnd.get(u.id);
    if (end !== undefined) plan.ghosts.push({ unit: u, at: { x: u.x, y: u.y }, fadeFromMs: end, untilMs: end });
  }

  let end = cursor;
  const grow = (ms: number): void => {
    if (ms > end) end = ms;
  };
  for (const b of plan.moves) grow(b.startMs + b.durMs);
  for (const b of plan.fx) grow(b.startMs + b.durMs);
  for (const b of plan.numbers) grow(b.startMs + b.durMs);
  for (const b of plan.hp) grow(b.atMs);
  if (plan.cutIn) grow(plan.cutIn.startMs + plan.cutIn.durMs);
  if (plan.banner) grow(plan.banner.startMs + plan.banner.durMs);
  plan.durationMs = end;
  return plan;
}

function assertNever(e: never): void {
  void e;
}

// ---------------------------------------------------------------- sampling

export interface UnitPlacement { x: number; y: number; heading?: Facing }
export interface GhostSample { unit: Unit; x: number; y: number; fade: number; heading?: Facing }
export interface FxSample { kind: FxKind; at: Coord; progress: number }
export interface NumberSample { at: Coord; text: string; tone: 'damage' | 'heal'; progress: number }

export interface CutInSample {
  beat: CutInBeat;
  /** 0..1 through the cut-in. */
  progress: number;
  /** The band: -1 off to the left, 0 on screen, 1 off to the right. */
  slide: number;
  /** The portrait's slide, a beat behind the band. */
  portraitSlide: number;
  /** How much the map behind is dimmed, 0..0.4. */
  dim: number;
  /** The part of the quote typed so far. */
  quote: string;
}

export interface BannerSample { beat: BannerBeat; progress: number; slide: number }

export interface TransitionSample {
  /** Gliding units, by id. A unit not listed stands where its frame puts it. */
  placements: Map<number, UnitPlacement>;
  /** Hit points (internal, 0..100) to show for units whose HP changes during the step. */
  hp: Map<number, number>;
  /** Units that must not be drawn yet (built later in the step). */
  hidden: Set<number>;
  ghosts: GhostSample[];
  fx: FxSample[];
  numbers: NumberSample[];
  cutIn: CutInSample | null;
  banner: BannerSample | null;
}

export const CUT_IN_ENTER_FRAC = 200 / TIMINGS.cutInMs;
export const CUT_IN_EXIT_FRAC = 200 / TIMINGS.cutInMs;
export const BANNER_IN_FRAC = 200 / TIMINGS.bannerMs;
export const BANNER_OUT_FRAC = 200 / TIMINGS.bannerMs;

const within = (startMs: number, durMs: number, t: number): boolean => t >= startMs && t < startMs + durMs;
const progressOf = (startMs: number, durMs: number, t: number): number => (durMs <= 0 ? 1 : Math.max(0, Math.min(1, (t - startMs) / durMs)));

/** Everything the board needs to draw the step at `t` ms into its animation. */
export function sampleTransition(plan: TransitionPlan, t: number): TransitionSample {
  const placements = new Map<number, UnitPlacement>();
  const byUnit = new Map<number, MoveBeat[]>();
  for (const m of plan.moves) {
    const list = byUnit.get(m.unitId);
    if (list) list.push(m);
    else byUnit.set(m.unitId, [m]);
  }
  for (const [id, list] of byUnit) {
    list.sort((a, b) => a.startMs - b.startMs);
    const beat = list.find((m) => t < m.startMs + m.durMs);
    if (!beat) continue; // every glide is over: the unit stands where its frame puts it
    if (t < beat.startMs) {
      placements.set(id, { x: beat.path[0].x, y: beat.path[0].y });
      continue;
    }
    const p = glideEase(progressOf(beat.startMs, beat.durMs, t));
    const at = pointAlongPath(beat.path, p);
    placements.set(id, { x: at.x, y: at.y, heading: at.dx > 0 ? 'right' : at.dx < 0 ? 'left' : headingOfPath(beat.path) });
  }

  const hp = new Map<number, number>();
  const beats = [...plan.hp].sort((a, b) => a.atMs - b.atMs);
  for (const h of beats) {
    if (t >= h.atMs) hp.set(h.unitId, h.to);
    else if (h.from !== undefined && !hp.has(h.unitId)) hp.set(h.unitId, h.from);
  }

  const hidden = new Set<number>();
  for (const a of plan.appear) if (t < a.atMs) hidden.add(a.unitId);

  const ghosts: GhostSample[] = [];
  for (const g of plan.ghosts) {
    if (t >= g.untilMs) continue;
    const at = placements.get(g.unit.id);
    const fade = g.untilMs > g.fadeFromMs ? progressOf(g.fadeFromMs, g.untilMs - g.fadeFromMs, t) : 0;
    ghosts.push({ unit: g.unit, x: at?.x ?? g.at.x, y: at?.y ?? g.at.y, fade, heading: at?.heading });
  }

  const fx: FxSample[] = [];
  for (const f of plan.fx) if (within(f.startMs, f.durMs, t)) fx.push({ kind: f.kind, at: f.at, progress: progressOf(f.startMs, f.durMs, t) });
  const numbers: NumberSample[] = [];
  for (const n of plan.numbers) {
    if (within(n.startMs, n.durMs, t)) numbers.push({ at: n.at, text: n.text, tone: n.tone, progress: progressOf(n.startMs, n.durMs, t) });
  }

  let cutIn: CutInSample | null = null;
  const c = plan.cutIn;
  if (c && within(c.startMs, c.durMs, t)) {
    const progress = progressOf(c.startMs, c.durMs, t);
    const slide = slideInOut(progress, CUT_IN_ENTER_FRAC, CUT_IN_EXIT_FRAC);
    cutIn = {
      beat: c, progress, slide,
      portraitSlide: slideInOut(progress, CUT_IN_ENTER_FRAC * 1.6, CUT_IN_EXIT_FRAC),
      dim: 0.4 * (1 - Math.min(1, Math.abs(slide))),
      quote: typedText(c.quote, t - c.startMs, c.durMs * 0.2, c.durMs * 0.4),
    };
  }

  let banner: BannerSample | null = null;
  const b = plan.banner;
  if (b && within(b.startMs, b.durMs, t)) {
    const progress = progressOf(b.startMs, b.durMs, t);
    banner = { beat: b, progress, slide: slideInOut(progress, BANNER_IN_FRAC, BANNER_OUT_FRAC) };
  }

  return { placements, hp, hidden, ghosts, fx, numbers, cutIn, banner };
}
