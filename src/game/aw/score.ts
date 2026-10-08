// Results screen score card (Speed / Power / Technique). Built in M1.5 (docs/delivery/TASKS.md).
// Until then it refuses loudly, so no caller can mistake a missing score for a real one.
import type { GameState, PlayerIndex } from './types';

export interface ScoreCard { speed: number; power: number; technique: number; total: number; rank: 'S' | 'A' | 'B' | 'C' }

export function scoreCard(_state: GameState, _player: PlayerIndex, _par?: { cycles: number; power: number }): ScoreCard {
  throw new Error('scoreCard is not implemented yet (TASKS M1.5)');
}
