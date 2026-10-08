// Results screen score card: Speed / Power / Technique, 0-100 each, total /300, rank S/A/B/C
// (docs/research/quality-bar.md §15.2-15.3; the formulas are ours, the rank scale follows the genre).
//   Speed     = 100 when cycles <= par.cycles, else max(0, round(100 - 100 x (cycles - par) / par))
//   Power     = min(100, round(100 x (enemy units destroyed / max(1, own units lost)) / par.power))
//   Technique = clamp(round(100 - 200 x (lossRatio - 0.10)), 0, 100), lossRatio = lost / max(1, built + started)
// Each formula is evaluated as one division so a value that sits exactly on .5 is rounded the same way every time.
import type { GameState, PlayerIndex } from './types';

export interface ScoreCard { speed: number; power: number; technique: number; total: number; rank: 'S' | 'A' | 'B' | 'C' }

/** Par used when the caller has none (skirmish): finish in 10 cycles, destroy 2 enemy units per own loss. */
export const DEFAULT_PAR = { cycles: 10, power: 2 } as const;

/** Minimum total for each rank; anything lower is a C. */
const RANKS: readonly [ScoreCard['rank'], number][] = [['S', 280], ['A', 250], ['B', 200]];

const clamp100 = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export function scoreCard(state: GameState, player: PlayerIndex, par: { cycles: number; power: number } = DEFAULT_PAR): ScoreCard {
  const pl = state.players[player];
  if (!pl) throw new RangeError(`scoreCard: there is no player ${String(player)}`);
  // A par of 0 must not read as "no limit" (full marks), so a bad par is refused rather than guessed.
  if (!Number.isFinite(par.cycles) || par.cycles <= 0) throw new RangeError(`scoreCard: par.cycles must be a positive number, got ${par.cycles}`);
  if (!Number.isFinite(par.power) || par.power <= 0) throw new RangeError(`scoreCard: par.power must be a positive number, got ${par.power}`);

  const { unitsDestroyed, unitsLost, unitsBuilt } = pl.stats;
  const started = pl.stats.unitsStarted ?? 0;

  const speed = state.cycle <= par.cycles ? 100 : clamp100((100 * (2 * par.cycles - state.cycle)) / par.cycles);
  const power = clamp100((100 * unitsDestroyed) / (Math.max(1, unitsLost) * par.power));
  const fielded = Math.max(1, unitsBuilt + started);
  const technique = clamp100((120 * fielded - 200 * unitsLost) / fielded);

  const total = speed + power + technique;
  const rank = RANKS.find(([, min]) => total >= min)?.[0] ?? 'C';
  return { speed, power, technique, total, rank };
}
