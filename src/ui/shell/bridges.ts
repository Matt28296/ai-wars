// Bridges to modules other workers own (audio, art, content). Each one is resolved with an eager
// import.meta.glob so the shell builds and runs before the module lands, and picks it up automatically
// (Vite re-evaluates the glob when the file appears). Fallbacks keep every screen usable meanwhile.
//
// TODO(integration): once src/audio/audio.ts, src/art/Portrait.tsx and src/content/{campaign,maps,skirmish}.ts
// are stable, replace the globs with static imports for full type checking (the shapes below mirror
// docs/ARCHITECTURE.md exactly, so the swap is mechanical).
import type { ComponentType } from 'react';
import type { CommanderId, FactionId } from '../../engine/types';
import type { CampaignAct, CommanderDef, MapDef, Mission, Mood } from '../../content/types';
import { COMMANDERS as CONTENT_COMMANDERS } from '../../content/commanders';
import { COMMANDER_BASE } from '../../data';
import { FALLBACK_ACTS, FALLBACK_COMMANDER_TEXT, FALLBACK_MAPS, FALLBACK_MISSIONS, FALLBACK_SKIRMISH } from './fallbackContent';

const first = <T,>(mods: Record<string, unknown>): T | undefined => Object.values(mods)[0] as T | undefined;

// ---------------------------------------------------------------- audio
export type SfxName =
  | 'cursor' | 'select' | 'cancel' | 'move' | 'menuOpen' | 'confirm' | 'error' | 'fire' | 'cannon' | 'laser' | 'missile'
  | 'explosion' | 'capture' | 'captured' | 'build' | 'powerReady' | 'surge' | 'overclock' | 'turnStart' | 'victory' | 'defeat' | 'text';
export type TrackName =
  | 'title' | 'map' | 'briefing' | 'helion' | 'tidewell' | 'verdant' | 'kestrel' | 'choir' | 'power' | 'victory' | 'defeat' | 'finale';
interface AudioApi {
  init(): Promise<void>;
  sfx(name: SfxName): void;
  music(track: TrackName | null): void;
  setVolume(kind: 'music' | 'sfx', v: number): void;
  muted: boolean;
}
const audioMod = first<{ audio?: AudioApi; default?: AudioApi }>(
  import.meta.glob(['../../audio/audio.ts', '../../audio/index.ts'], { eager: true }),
);
const realAudio = (): AudioApi | undefined => audioMod?.audio ?? audioMod?.default;

let currentTrack: TrackName | null = null;
let audioReady = false;
const lastSfx: Partial<Record<SfxName, number>> = {};

/** Safe wrapper: never throws, no-ops until src/audio lands or before the first gesture. */
export const sound = {
  get available() { return !!realAudio(); },
  async init() {
    const a = realAudio();
    if (!a) { audioReady = true; return; }
    try { await a.init(); audioReady = true; if (currentTrack) a.music(currentTrack); } catch { /* blocked autoplay: retry on next gesture */ }
  },
  get ready() { return audioReady; },
  sfx(name: SfxName) {
    const now = performance.now();
    // Cursor ticks are throttled so hover-scrubbing a list does not machine-gun.
    if (name === 'cursor' && now - (lastSfx.cursor ?? 0) < 45) return;
    lastSfx[name] = now;
    if (!audioReady) return;
    try { realAudio()?.sfx(name); } catch { /* ignore */ }
  },
  music(track: TrackName | null) {
    if (track === currentTrack) return;
    currentTrack = track;
    if (!audioReady) return;
    try { realAudio()?.music(track); } catch { /* ignore */ }
  },
  setVolume(kind: 'music' | 'sfx', v: number) {
    try { realAudio()?.setVolume(kind, v); } catch { /* ignore */ }
  },
};

// ---------------------------------------------------------------- art
export interface PortraitProps { commander: string; mood?: Mood; size?: number }
const portraitMod = first<{ Portrait?: ComponentType<PortraitProps>; default?: ComponentType<PortraitProps> }>(
  import.meta.glob('../../art/Portrait.tsx', { eager: true }),
);
/** src/art Portrait, or null while the art module has not landed (callers draw the monogram plate). */
export const ArtPortrait: ComponentType<PortraitProps> | null = portraitMod?.Portrait ?? portraitMod?.default ?? null;
/** Ids the art Portrait draws. Everyone else (minor characters) gets a monogram tile. */
export const hasArtPortrait = (id: string) => !!ArtPortrait && !!commanderBase(id);

// ---------------------------------------------------------------- content
const campaignMod = first<{ ACTS?: CampaignAct[]; MISSIONS?: Record<string, Mission> }>(
  import.meta.glob('../../content/campaign.ts', { eager: true }),
);
const mapsMod = first<{ MAPS?: Record<string, MapDef> }>(import.meta.glob('../../content/maps.ts', { eager: true }));
const skirmishMod = first<{ SKIRMISH_MAPS?: string[] }>(import.meta.glob('../../content/skirmish.ts', { eager: true }));

const realMissions = campaignMod?.MISSIONS && Object.keys(campaignMod.MISSIONS).length ? campaignMod.MISSIONS : null;
const realActs = campaignMod?.ACTS && campaignMod.ACTS.length ? campaignMod.ACTS : null;

export const contentStatus = {
  campaign: !!(realMissions && realActs),
  maps: !!(mapsMod?.MAPS && Object.keys(mapsMod.MAPS).length),
  skirmish: !!(skirmishMod?.SKIRMISH_MAPS && skirmishMod.SKIRMISH_MAPS.length),
  commanders: Object.keys(CONTENT_COMMANDERS).length > 0,
  portraits: !!ArtPortrait,
  audio: !!realAudio(),
};

export const MISSIONS: Record<string, Mission> = realMissions ?? FALLBACK_MISSIONS;
export const ACTS: CampaignAct[] = realActs ?? FALLBACK_ACTS;
export const MAPS: Record<string, MapDef> = contentStatus.maps ? { ...FALLBACK_MAPS, ...mapsMod!.MAPS! } : FALLBACK_MAPS;
export const SKIRMISH_MAPS: string[] = (contentStatus.skirmish ? skirmishMod!.SKIRMISH_MAPS! : FALLBACK_SKIRMISH).filter((id) => MAPS[id]);

/** Missions in campaign order (act, then order). */
export const MISSION_ORDER: string[] = ACTS.flatMap((a) => a.missions).filter((id) => MISSIONS[id]);

export function mapFor(id: string | undefined): MapDef | undefined {
  return id ? MAPS[id] : undefined;
}

// ---------------------------------------------------------------- commanders
type BaseCommander = { id: string; name: string; initials: string; faction: FactionId | null; title: string };
const BASE = COMMANDER_BASE as unknown as BaseCommander[];
export const commanderBase = (id: string) => BASE.find((c) => c.id === id);

/** Every commander: content's full definition when present, else the base identity + story text. */
export function getCommander(id: CommanderId): CommanderDef | undefined {
  const real = CONTENT_COMMANDERS[id];
  if (real) return real;
  const b = commanderBase(id);
  if (!b) return undefined;
  const t = FALLBACK_COMMANDER_TEXT[id];
  return {
    id: b.id, name: b.name, initials: b.initials, faction: b.faction, title: b.title,
    age: t?.age, pronouns: t?.pronouns ?? '', bio: t?.bio ?? '', voice: '',
    passive: { name: t?.passive[0] ?? 'Doctrine', description: t?.passive[1] ?? '', modifiers: [] },
    surge: t?.surge ? { name: t.surge[0], stars: t.surge[2], quote: '', description: t.surge[1], modifiers: [], effects: [] } : null,
    overclock: t?.overclock ? { name: t.overclock[0], stars: t.overclock[2], quote: '', description: t.overclock[1], modifiers: [], effects: [] } : null,
    lines: { select: t?.select ?? '', victory: t?.victory ?? '', defeat: t?.defeat ?? '' },
    playable: t?.playable ?? b.id !== 'echo',
  };
}

/** Commander ids in roster order (faction by faction), as the CO select grid shows them. */
export const ROSTER: string[] = (() => {
  const ids = new Set<string>([...BASE.map((c) => c.id), ...Object.keys(CONTENT_COMMANDERS)]);
  return [...ids];
})();

/** Display identity for any dialogue speaker: a commander id, 'narrator', or a minor character name. */
export interface SpeakerInfo { id: string | null; name: string; title?: string; faction: FactionId | null; initials: string; known: boolean; narrator: boolean }
export function speakerInfo(speaker: string): SpeakerInfo {
  if (speaker === 'narrator') return { id: null, name: '', faction: null, initials: '', known: false, narrator: true };
  const c = getCommander(speaker) ?? (CONTENT_COMMANDERS ? Object.values(CONTENT_COMMANDERS).find((x) => x.name === speaker) : undefined);
  if (c) return { id: c.id, name: c.name, title: c.title, faction: c.faction, initials: c.initials, known: true, narrator: false };
  const initials = speaker.split(/[\s-]+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join('').slice(0, 2) || '?';
  return { id: null, name: speaker, faction: null, initials, known: false, narrator: false };
}
