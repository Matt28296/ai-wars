// Battle presentation settings. The shell may pass them as a prop; otherwise they persist per browser.
export interface BattleSettings {
  /** Battle cut-ins: 'on' for every fight, 'player' only when a human is involved, 'off' = quick map animation. */
  animations: 'on' | 'player' | 'off';
  /** AI turn playback: 'normal' follows every action, 'fast' halves timings and skips cut-ins. */
  aiSpeed: 'normal' | 'fast';
  /** Grid lines over the terrain. */
  grid: boolean;
  /** Show the enemy-threat preview (hatched red) when the cursor rests on an enemy for a moment. */
  hoverThreat: boolean;
  musicVolume: number; // 0–1
  sfxVolume: number;   // 0–1
}

export const DEFAULT_SETTINGS: BattleSettings = {
  animations: 'on',
  aiSpeed: 'normal',
  grid: true,
  hoverThreat: false,
  musicVolume: 0.7,
  sfxVolume: 0.8,
};

const KEY = 'aw.battle.settings';
export function loadSettings(): BattleSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* private mode or blocked storage */ }
  return { ...DEFAULT_SETTINGS };
}
export function saveSettings(s: BattleSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
