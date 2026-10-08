// Bridge to src/ui/battle/BattleScreen.tsx (UI-battle worker). Types mirror docs/ARCHITECTURE.md.
// TODO(integration): when BattleScreen.tsx is stable, `import { BattleScreen, type BattleSetup, type BattleResult }
// from '../battle/BattleScreen'` here and drop the local copies.
import type { ComponentType } from 'react';
import type { CommanderId, FactionId, GameState, Objective, Weather } from '../../engine/types';
import type { MapDef, Mission } from '../../content/types';
import { FallbackBattle } from './FallbackBattle';

export type Rank = 'S' | 'A' | 'B' | 'C';
export interface ScoreCard { speed: number; power: number; technique: number; total: number; rank: Rank }

export interface SetupPlayer {
  faction: FactionId; commander: CommanderId; controller: 'human' | 'ai'; team: number; funds?: number; aiLevel?: 'cadet' | 'officer' | 'marshal';
}
export interface BattleSetup {
  mode: 'campaign' | 'skirmish' | 'versus';
  mission?: Mission;
  map: MapDef;
  players: SetupPlayer[];
  fog: boolean; weather?: Weather; objective: Objective; turnLimit?: number; seed: number;
  resume?: GameState;
  // Shell extensions (ignored by the engine): War Room rules.
  startFunds?: number; incomePerProperty?: number;
}
export interface BattleResult { outcome: 'victory' | 'defeat' | 'quit'; winnerTeam: number | null; state: GameState; score: ScoreCard | null }
export interface BattleScreenProps { setup: BattleSetup; onExit(result: BattleResult): void; onSuspend?(state: GameState): void }

const mod = Object.values(import.meta.glob('../battle/BattleScreen.tsx', { eager: true }))[0] as
  | { BattleScreen?: ComponentType<BattleScreenProps>; default?: ComponentType<BattleScreenProps> }
  | undefined;

export const BattleScreen: ComponentType<BattleScreenProps> = mod?.BattleScreen ?? mod?.default ?? FallbackBattle;
export const battleIntegrated = !!(mod?.BattleScreen ?? mod?.default);

export const rankFor = (total: number): Rank => (total >= 280 ? 'S' : total >= 250 ? 'A' : total >= 200 ? 'B' : 'C');
