// Save system: one versioned localStorage record per slot.
//   ascendant-wars/v1/settings   Settings
//   ascendant-wars/v1/campaign   CampaignProgress
//   ascendant-wars/v1/suspend    SuspendedBattle (one slot)
//   ascendant-wars/v1/warroom    last War Room / Versus setup (convenience)
// Each value is an envelope { v: SAVE_VERSION, at: epoch ms, data }. Unknown or corrupt envelopes are moved
// aside to `<key>.bak` and replaced by defaults, so a bad save never bricks the title screen.
// Other modules (battle, story) may read settings with getSettings()/useSettings() and listen for changes.
import { useSyncExternalStore } from 'react';
import type { GameState } from '../../engine/types';
import type { BattleSetup, Rank, ScoreCard } from './battleBridge';

export const SAVE_VERSION = 1;
const NS = 'ascendant-wars/v1/';

interface Envelope<T> { v: number; at: number; data: T }

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
function read<T>(slot: string, fallback: T, validate: (x: unknown) => T | null): T {
  const s = storage();
  if (!s) return fallback;
  let raw: string | null = null;
  try { raw = s.getItem(NS + slot); } catch { return fallback; }
  if (raw == null) return fallback;
  try {
    const env = JSON.parse(raw) as Envelope<unknown>;
    if (env && env.v === SAVE_VERSION) {
      const ok = validate(env.data);
      if (ok) return ok;
    }
    // Future: migrate(env.v → SAVE_VERSION) here.
  } catch { /* fall through */ }
  try { s.setItem(NS + slot + '.bak', raw); } catch { /* ignore */ }
  return fallback;
}
function write<T>(slot: string, data: T | null): boolean {
  const s = storage();
  if (!s) return false;
  try {
    if (data == null) s.removeItem(NS + slot);
    else s.setItem(NS + slot, JSON.stringify({ v: SAVE_VERSION, at: Date.now(), data } satisfies Envelope<T>));
    return true;
  } catch (e) {
    console.warn('[save] write failed', slot, e);
    return false;
  }
}
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

// ---------------------------------------------------------------- settings
export type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';
export type AiSpeed = 'normal' | 'fast';
export type BattleAnimations = 'on' | 'player' | 'off';
export interface Settings {
  musicVolume: number;        // 0–10
  sfxVolume: number;          // 0–10
  textSpeed: TextSpeed;
  battleAnimations: BattleAnimations; // battle cut-ins: every fight / only fights a human is in / never
  aiSpeed: AiSpeed;           // AI turn playback
  grid: boolean;              // battlefield grid lines
  hoverThreat: boolean;       // enemy threat preview when the cursor rests on an enemy
  theme: 'dark' | 'light';
}
export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 7, sfxVolume: 8, textSpeed: 'normal', battleAnimations: 'on', aiSpeed: 'normal', grid: true, hoverThreat: false, theme: 'dark',
};
export const TEXT_SPEEDS: readonly TextSpeed[] = ['slow', 'normal', 'fast', 'instant'];
export const AI_SPEEDS: readonly AiSpeed[] = ['normal', 'fast'];
export const BATTLE_ANIMATIONS: readonly BattleAnimations[] = ['on', 'player', 'off'];
/** Characters per second for the typewriter. */
export const TEXT_CPS: Record<TextSpeed, number> = { slow: 28, normal: 55, fast: 110, instant: Infinity };

/** The battle screen's settings shape (src/ui/battle/settings.ts BattleSettings), derived from the shell's. */
export function battleSettingsOf(s: Settings = settings) {
  return {
    animations: s.battleAnimations, aiSpeed: s.aiSpeed, grid: s.grid, hoverThreat: s.hoverThreat,
    musicVolume: s.musicVolume / 10, sfxVolume: s.sfxVolume / 10,
  };
}

function validSettings(x: unknown): Settings | null {
  if (!isObj(x)) return null;
  return {
    musicVolume: num(x.musicVolume, 0, 10, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: num(x.sfxVolume, 0, 10, DEFAULT_SETTINGS.sfxVolume),
    textSpeed: pick(x.textSpeed, TEXT_SPEEDS, DEFAULT_SETTINGS.textSpeed),
    battleAnimations: x.battleAnimations === false ? 'off' : x.battleAnimations === true ? 'on' : pick(x.battleAnimations, BATTLE_ANIMATIONS, DEFAULT_SETTINGS.battleAnimations),
    aiSpeed: pick(x.aiSpeed, AI_SPEEDS, DEFAULT_SETTINGS.aiSpeed),
    grid: typeof x.grid === 'boolean' ? x.grid : DEFAULT_SETTINGS.grid,
    hoverThreat: typeof x.hoverThreat === 'boolean' ? x.hoverThreat : DEFAULT_SETTINGS.hoverThreat,
    theme: pick(x.theme, ['dark', 'light'] as const, DEFAULT_SETTINGS.theme),
  };
}

let settings: Settings = read('settings', DEFAULT_SETTINGS, validSettings);
const settingsListeners = new Set<() => void>();
export const getSettings = () => settings;
export function setSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  write('settings', settings);
  settingsListeners.forEach((l) => l());
}
export function subscribeSettings(fn: () => void) { settingsListeners.add(fn); return () => { settingsListeners.delete(fn); }; }
export const useSettings = () => useSyncExternalStore(subscribeSettings, getSettings, getSettings);

// ---------------------------------------------------------------- campaign
export interface MissionRecord { rank: Rank; score: ScoreCard; cycles: number; at: number; plays: number }
export interface CampaignProgress {
  unlocked: string[];                       // mission ids the player may start
  completed: Record<string, MissionRecord>; // best result per mission (by total score)
  last?: string;                            // last mission played (campaign map cursor)
}
export const EMPTY_CAMPAIGN: CampaignProgress = { unlocked: [], completed: {} };

function validCampaign(x: unknown): CampaignProgress | null {
  if (!isObj(x)) return null;
  const unlocked = Array.isArray(x.unlocked) ? x.unlocked.filter((s): s is string => typeof s === 'string') : [];
  const completed: Record<string, MissionRecord> = {};
  if (isObj(x.completed)) {
    for (const [k, r] of Object.entries(x.completed)) {
      if (!isObj(r) || !isObj(r.score)) continue;
      const rank = pick(r.rank, ['S', 'A', 'B', 'C'] as const, 'C');
      const sc = r.score;
      completed[k] = {
        rank, cycles: num(r.cycles, 0, 9999, 0), at: num(r.at, 0, Number.MAX_SAFE_INTEGER, 0), plays: num(r.plays, 1, 9999, 1),
        score: { speed: num(sc.speed, 0, 999, 0), power: num(sc.power, 0, 999, 0), technique: num(sc.technique, 0, 999, 0), total: num(sc.total, 0, 9999, 0), rank },
      };
    }
  }
  return { unlocked, completed, last: typeof x.last === 'string' ? x.last : undefined };
}

let campaign: CampaignProgress = read('campaign', EMPTY_CAMPAIGN, validCampaign);
const campaignListeners = new Set<() => void>();
export const getCampaign = () => campaign;
function setCampaign(next: CampaignProgress) { campaign = next; write('campaign', campaign); campaignListeners.forEach((l) => l()); }
export function subscribeCampaign(fn: () => void) { campaignListeners.add(fn); return () => { campaignListeners.delete(fn); }; }
export const useCampaign = () => useSyncExternalStore(subscribeCampaign, getCampaign, getCampaign);

/** A mission is open if it is first, explicitly unlocked, already completed, or its predecessor is complete. */
export function isUnlocked(order: string[], id: string, p: CampaignProgress = campaign): boolean {
  const i = order.indexOf(id);
  if (i < 0) return false;
  if (i === 0 || p.unlocked.includes(id) || p.completed[id]) return true;
  return !!p.completed[order[i - 1]!];
}

/** Record a victory. Returns the id newly unlocked by it (if any) for the campaign map's reveal. */
export function recordVictory(order: string[], id: string, score: ScoreCard, cycles: number): { next?: string; newBest: boolean } {
  const prev = campaign.completed[id];
  const newBest = !prev || score.total > prev.score.total;
  const rec: MissionRecord = newBest
    ? { rank: score.rank, score, cycles, at: Date.now(), plays: (prev?.plays ?? 0) + 1 }
    : { ...prev!, plays: prev!.plays + 1 };
  const i = order.indexOf(id);
  const next = i >= 0 && i + 1 < order.length ? order[i + 1] : undefined;
  const wasOpen = next ? isUnlocked(order, next) : true;
  const unlocked = new Set(campaign.unlocked);
  unlocked.add(id);
  if (next) unlocked.add(next);
  setCampaign({ unlocked: [...unlocked], completed: { ...campaign.completed, [id]: rec }, last: next ?? id });
  return { next: next && !wasOpen ? next : undefined, newBest };
}
export function markPlayed(id: string) { setCampaign({ ...campaign, last: id }); }
export function resetCampaign() { setCampaign({ unlocked: [], completed: {} }); }
/** Debug / QA helper: open every mission. */
export function unlockAll(order: string[]) { setCampaign({ ...campaign, unlocked: [...order] }); }

// ---------------------------------------------------------------- suspended battle
export interface SuspendedBattle {
  setup: Omit<BattleSetup, 'resume'>;
  state: GameState;
  savedAt: number;
  label: string;             // "Calder Fields · Cycle 07"
}
function validSuspend(x: unknown): SuspendedBattle | null {
  if (!isObj(x) || !isObj(x.setup) || !isObj(x.state) || !isObj((x.setup as Record<string, unknown>).map)) return null;
  return x as unknown as SuspendedBattle;
}
let suspended: SuspendedBattle | null = read<SuspendedBattle | null>('suspend', null, validSuspend);
const suspendListeners = new Set<() => void>();
export const getSuspended = () => suspended;
export function subscribeSuspended(fn: () => void) { suspendListeners.add(fn); return () => { suspendListeners.delete(fn); }; }
export const useSuspended = () => useSyncExternalStore(subscribeSuspended, getSuspended, getSuspended);
export function saveSuspended(s: SuspendedBattle | null): boolean {
  const { resume: _drop, ...setup } = (s?.setup ?? {}) as BattleSetup;
  void _drop;
  suspended = s ? { ...s, setup } : null;
  const ok = write('suspend', suspended);
  suspendListeners.forEach((l) => l());
  return ok;
}

// ---------------------------------------------------------------- war room preferences
export interface WarRoomPrefs {
  mapId?: string;
  slots?: { faction: string; commander: string; controller: string; team: number }[];
  fog?: boolean; weather?: string; startFunds?: number; income?: number;
}
export const getWarRoom = (mode: 'skirmish' | 'versus'): WarRoomPrefs =>
  read<WarRoomPrefs>('warroom-' + mode, {}, (x) => (isObj(x) ? (x as WarRoomPrefs) : null));
export const setWarRoom = (mode: 'skirmish' | 'versus', p: WarRoomPrefs) => { write('warroom-' + mode, p); };

/** Wipes every slot (Options → Erase all data). */
export function eraseAll() {
  const s = storage();
  if (s) for (const k of Object.keys(s)) if (k.startsWith(NS)) { try { s.removeItem(k); } catch { /* ignore */ } }
  settings = { ...DEFAULT_SETTINGS };
  campaign = { unlocked: [], completed: {} };
  suspended = null;
  settingsListeners.forEach((l) => l());
  campaignListeners.forEach((l) => l());
  suspendListeners.forEach((l) => l());
}
