// Bridges to modules other workers own (art, audio, AI, story, content). Each is resolved with an eager
// import.meta.glob so the battle screen builds and runs before the module lands and picks it up automatically
// once it does. Fallbacks keep the battle fully playable meanwhile.
//
// TODO(integration): when each module is stable, swap its glob for a static import (shapes mirror
// docs/ARCHITECTURE.md, so the swap is mechanical) — see the per-section notes.
import type { ComponentType } from 'react';
import type { Action, FactionId, GameState, TerrainId, UnitTypeId } from '../../engine/types';
import type { CommanderDef, DialogueLine, MapDef, Mood } from '../../content/types';
import { COMMANDERS as CONTENT_COMMANDERS } from '../../content/commanders';
import { COMMANDER_BASE } from '../../data';
import { FallbackDialogue } from './FallbackDialogue';

type AnyMod = Record<string, unknown>;
const pick = <T,>(mods: Record<string, unknown>, name: string): T | undefined => {
  for (const m of Object.values(mods)) {
    const v = (m as AnyMod)?.[name];
    if (v != null) return v as T;
  }
  return undefined;
};

// ---------------------------------------------------------------- art (src/art)
// TODO(integration): static imports from '../../art/Portrait', '../../art/UnitSprite', '../../art/TerrainTile'.
const artMods = import.meta.glob(['../../art/*.tsx', '../../art/*.ts', '!../../art/*.test.ts'], { eager: true });

export interface UnitSpriteProps { type: UnitTypeId; faction: FactionId; facing?: 'left' | 'right'; size?: number; frame?: 0 | 1 }
export interface PortraitProps { commander: string; mood?: Mood; size?: number }
export interface TerrainTileProps { terrain: TerrainId; owner?: FactionId | null; size?: number; frame?: number; neighbors?: unknown; x?: number; y?: number }

export const art = {
  get UnitSprite() { return pick<ComponentType<UnitSpriteProps>>(artMods, 'UnitSprite'); },
  get BattleSprite() { return pick<ComponentType<UnitSpriteProps>>(artMods, 'BattleSprite'); },
  get Portrait() { return pick<ComponentType<PortraitProps>>(artMods, 'Portrait'); },
  get TerrainTile() { return pick<ComponentType<TerrainTileProps>>(artMods, 'TerrainTile'); },
  get BattleBackdrop() { return pick<ComponentType<{ terrain: TerrainId; side?: 'left' | 'right'; width?: number; height?: number }>>(artMods, 'BattleBackdrop'); },
  get computeNeighbors() { return pick<(...args: unknown[]) => unknown>(artMods, 'computeNeighbors'); },
};

// ---------------------------------------------------------------- audio (src/audio)
// TODO(integration): `import { audio } from '../../audio/audio'`.
export type SfxName =
  | 'cursor' | 'select' | 'cancel' | 'move' | 'menuOpen' | 'confirm' | 'error' | 'fire' | 'cannon' | 'laser' | 'missile'
  | 'explosion' | 'capture' | 'captured' | 'build' | 'powerReady' | 'surge' | 'overclock' | 'turnStart' | 'victory' | 'defeat' | 'text';
export type TrackName =
  | 'title' | 'map' | 'briefing' | 'helion' | 'tidewell' | 'verdant' | 'kestrel' | 'choir' | 'power' | 'victory' | 'defeat' | 'finale';
interface AudioApi { init(): Promise<void>; sfx(name: SfxName): void; music(track: TrackName | null): void; setVolume(kind: 'music' | 'sfx', v: number): void; muted: boolean }
const audioMods = import.meta.glob(['../../audio/audio.ts', '../../audio/index.ts'], { eager: true });
const realAudio = () => pick<AudioApi>(audioMods, 'audio') ?? pick<AudioApi>(audioMods, 'default');

const lastSfx: Partial<Record<SfxName, number>> = {};
export const sound = {
  get available() { return !!realAudio(); },
  init() { try { return realAudio()?.init() ?? Promise.resolve(); } catch { return Promise.resolve(); } },
  sfx(name: SfxName) {
    const now = performance.now();
    if ((name === 'cursor' || name === 'move') && now - (lastSfx[name] ?? 0) < 40) return; // no machine-gunning on held keys
    lastSfx[name] = now;
    try { realAudio()?.sfx(name); } catch { /* audio is never fatal */ }
  },
  music(track: TrackName | null) { try { realAudio()?.music(track); } catch { /* ignore */ } },
  setVolume(kind: 'music' | 'sfx', v: number) { try { realAudio()?.setVolume(kind, v); } catch { /* ignore */ } },
};

// ---------------------------------------------------------------- AI (src/ai)
// TODO(integration): `import { nextAction } from '../../ai'`.
const aiMods = import.meta.glob(['../../ai/index.ts', '../../ai/ai.ts'], { eager: true });
type NextAction = (state: GameState) => Action | Promise<Action>;
export const aiAvailable = () => !!pick<NextAction>(aiMods, 'nextAction');
/** One AI action at a time so every step can be animated. Placeholder (until src/ai lands): end the turn. */
export async function aiNextAction(state: GameState): Promise<Action> {
  const real = pick<NextAction>(aiMods, 'nextAction');
  if (!real) return { kind: 'endTurn' };
  return await real(state);
}

// ---------------------------------------------------------------- story (src/ui/story)
// TODO(integration): `import { DialoguePlayer } from '../story/DialoguePlayer'`.
export interface DialoguePlayerProps { lines: DialogueLine[]; onDone(): void; backdrop?: 'none' | 'dim' | 'briefing' }
const storyMods = import.meta.glob(['../story/DialoguePlayer.tsx'], { eager: true });
export const DialoguePlayer: ComponentType<DialoguePlayerProps> = pick<ComponentType<DialoguePlayerProps>>(storyMods, 'DialoguePlayer') ?? FallbackDialogue;

// ---------------------------------------------------------------- content
// COMMANDERS exists (content worker fills it); base names come from the generated data meanwhile.
export interface CommanderView { id: string; name: string; initials: string; faction: FactionId | null; title: string; def?: CommanderDef }
export function commanderView(id: string): CommanderView {
  const def = CONTENT_COMMANDERS[id];
  const base = (COMMANDER_BASE as unknown as { id: string; name: string; initials: string; faction: FactionId | null; title: string }[]).find((c) => c.id === id);
  return {
    id,
    name: def?.name ?? base?.name ?? id,
    initials: def?.initials ?? base?.initials ?? id.slice(0, 2).toUpperCase(),
    faction: def?.faction ?? base?.faction ?? null,
    title: def?.title ?? base?.title ?? 'Commander',
    def,
  };
}

// Maps for the dev harness. TODO(integration): `import { MAPS } from '../../content/maps'`.
const mapMods = import.meta.glob(['../../content/maps.ts'], { eager: true });
export const contentMaps = (): Record<string, MapDef> => pick<Record<string, MapDef>>(mapMods, 'MAPS') ?? {};
