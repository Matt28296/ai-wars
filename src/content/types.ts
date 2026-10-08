import type { CommanderId, FactionId, Modifier, Objective, PowerDef, TerrainId, UnitTypeId, Weather } from '../engine/types';

export type Mood = 'neutral' | 'happy' | 'angry' | 'grim' | 'surprised' | 'smug';

export interface CommanderDef {
  id: CommanderId;
  name: string;
  initials: string;
  faction: FactionId | null;  // null = ECHO (no nation)
  title: string;
  age?: number;
  pronouns: string;           // as written in their bio, e.g. 'she/her'
  bio: string;                // 2–4 sentences, shown on the CO screen
  voice: string;              // writing guide for this character's lines
  likes?: string;
  dislikes?: string;
  passive: { name: string; description: string; modifiers: Modifier[] };
  surge: PowerDef | null;     // ECHO and story-only characters have none
  overclock: PowerDef | null;
  lines: { select: string; victory: string; defeat: string; surge?: string; overclock?: string };
  playable: boolean;
}

// Map rows use one character per tile:
//   .  flats      f canopy     ^ ridge      = maglev     # span (bridge)
//   r  river      ~ sea        s shoal      g glass waste
//   C  arcology   F fabricator A skyport    D dock       U uplink     H command spire
// owners rows (same size): '0'..'4' = player index owning that property, '.' = neutral / not a property.
export interface MapDef {
  id: string;
  name: string;
  author?: string;
  description: string;
  players: number;            // number of player slots
  terrain: string[];
  owners: string[];
  units: { type: UnitTypeId; owner: number; x: number; y: number; hp?: number }[];
  recommended?: { fog?: boolean; weather?: Weather; startFunds?: number };
}

export interface DialogueLine {
  speaker: CommanderId | 'narrator' | string; // commander id, 'narrator', or a minor character name
  mood?: Mood;
  text: string;
  side?: 'left' | 'right';
  channel?: string;           // e.g. 'Tactical channel · encrypted'
}

export type MissionTrigger =
  | { kind: 'start' }
  | { kind: 'cycle'; cycle: number }
  | { kind: 'unitDestroyed'; owner: number; count?: number }
  | { kind: 'propertyCaptured'; by: number; terrain?: TerrainId }
  | { kind: 'powerUsed'; player: number }
  | { kind: 'victory' }
  | { kind: 'defeat' };

export interface MissionPlayer {
  faction: FactionId;
  commander: CommanderId;
  controller: 'human' | 'ai';
  team: number;
  funds?: number;
}

export interface Mission {
  id: string;
  act: 1 | 2 | 3 | 4;
  order: number;              // position in the campaign
  title: string;
  location: string;
  summary: string;            // one-line campaign map blurb
  mapId: string;
  players: MissionPlayer[];   // index = player index (0 = the human in the campaign)
  objective: Objective;
  objectiveText: string;
  fog: boolean;
  weather?: Weather;
  turnLimit?: number;
  briefing: DialogueLine[];
  events: { trigger: MissionTrigger; once?: boolean; lines: DialogueLine[] }[];
  debrief: DialogueLine[];
  // For the results screen: par values for Speed (cycles) and Power (enemy units destroyed per own loss).
  par: { cycles: number; power: number };
}

export interface CampaignAct { act: 1 | 2 | 3 | 4; title: string; tagline: string; missions: string[] }
