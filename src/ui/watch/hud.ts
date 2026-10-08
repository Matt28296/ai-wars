// The HUD's numbers, derived from what the viewer was told (an observation, or the omniscient frame) and from the public activation
// count. Nothing here reads the true state: a fogged viewer gets "?" for an enemy's unit count, as quality-bar 11.3 asks.
import { COMMANDERS } from '../../content/commanders';
import type { Mood } from '../../content/types';
import { FACTIONS, TERRAIN_TYPES } from '../../data';
import { POWER_STAR } from '../../game/aw';
import type { FactionId, PlayerIndex, PowerState } from '../../game/aw';
import type { ObservedPlayer } from '../../game/aw/observe';
import { hudMood } from '../portraits/mood';
import { knownUnitCount } from './timeline';
import type { TimelineStep, ViewFrame } from './timeline';

export interface StarMeter {
  /** Stars filled, fractional. */
  value: number;
  /** Stars that buy a Surge (0 when the commander has none). */
  surge: number;
  /** Stars that buy an Overclock: the whole bar. */
  max: number;
}

export interface PlayerPanelModel {
  index: PlayerIndex;
  faction: FactionId;
  factionName: string;
  commanderId: string;
  commanderName: string;
  initials: string;
  /** The portrait's face: neutral, grim once defeated, happy while a power is active. */
  mood: Mood;
  funds: number;
  meter: StarMeter;
  /** Which power is running now, if any. */
  active: Exclude<PowerState, 'none'> | null;
  /** Units the viewer may count; null shows as "?" (an enemy under fog). */
  units: number | null;
  /** Properties the player holds. Ownership is public, so this is a number for every viewer, fog or not. */
  properties: number;
  isCurrent: boolean;
  defeated: boolean;
  team: number;
}

/** What one star costs in meter points after `uses` activations: +20% each, capped at double (power.ts). */
export function starValueAfter(uses: number): number {
  return (POWER_STAR * (100 + Math.min(100, 20 * uses))) / 100;
}

/** The meter in stars. Activations are public, so a fogged viewer can price a star exactly as the engine does. */
export function starMeter(player: ObservedPlayer, uses: number): StarMeter {
  const def = Object.prototype.hasOwnProperty.call(COMMANDERS, player.commander) ? COMMANDERS[player.commander] : undefined;
  const surge = def?.surge?.stars ?? 0;
  const overclock = def?.overclock?.stars ?? surge;
  const max = Math.max(surge, overclock);
  const value = max > 0 ? Math.min(max, player.power / starValueAfter(uses)) : 0;
  return { value, surge, max };
}

/** How many properties a player holds in a frame. Tile ownership is public (observe.ts), so a fogged viewer counts both sides exactly. */
export function propertiesOf(frame: ViewFrame, player: PlayerIndex): number {
  let n = 0;
  for (const row of frame.tiles) for (const t of row) if (t.owner === player && TERRAIN_TYPES[t.terrain]?.property) n += 1;
  return n;
}

// ---------------------------------------------------------------- tweens: funds tick, the meter fills

/** Funds tick to their new value over about this long. */
export const FUNDS_TWEEN_MS = 400;
/** The power meter fills a little slower, so a charge reads as a fill and not a flicker. */
export const METER_TWEEN_MS = 600;

/** Reduced motion answers with 0 ms: the value is simply the new value. */
export function tweenDuration(baseMs: number, reducedMotion: boolean): number {
  return reducedMotion || !(baseMs > 0) ? 0 : baseMs;
}

/** Ease-out cubic: quick at first, settling on the value. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/**
 * The value `elapsedMs` into a tween from `from` to `to`. Before it starts it is `from`; at or after its end, or with no duration at all,
 * it is EXACTLY `to` (never a rounding off by one), and in between it moves monotonically from one to the other.
 */
export function tweenAt(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return to;
  if (!(elapsedMs > 0)) return from;
  return from + (to - from) * easeOut(elapsedMs / durationMs);
}

/** The reader's reduced-motion setting, read now (false where there is no window, as in tests). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function playerPanels(step: TimelineStep): PlayerPanelModel[] {
  const f = step.frame;
  return f.players.map((p): PlayerPanelModel => {
    const def = Object.prototype.hasOwnProperty.call(COMMANDERS, p.commander) ? COMMANDERS[p.commander] : undefined;
    return {
      index: p.index,
      faction: p.faction,
      factionName: FACTIONS[p.faction].name,
      commanderId: p.commander,
      commanderName: def?.name ?? 'Commander',
      initials: def?.initials ?? 'CO',
      mood: hudMood({ defeated: p.defeated, active: p.powerState === 'none' ? null : p.powerState }),
      funds: p.funds,
      meter: starMeter(p, step.powerUses[p.index] ?? 0),
      active: p.powerState === 'none' ? null : p.powerState,
      units: knownUnitCount(f, p.index),
      properties: propertiesOf(f, p.index),
      isCurrent: p.index === f.current,
      defeated: p.defeated,
      team: p.team,
    };
  });
}
