import type * as React from 'react';

/** The five nations. `null` (or omitted where allowed) means ECHO / the interface itself, painted in signal. */
export type Faction = 'helion' | 'tidewell' | 'verdant' | 'kestrel' | 'choir';
export type UnitId = 'trooper' | 'breacher' | 'skimmer' | 'lancer' | 'bastion' | 'colossus' | 'mule' | 'arc' | 'salvo' | 'warden' | 'wasp' | 'raptor' | 'anvil' | 'picket' | 'dreadnought' | 'barge';
export type TerrainId = 'flats' | 'canopy' | 'ridge' | 'maglev' | 'span' | 'river' | 'sea' | 'shoal' | 'glass' | 'arcology' | 'fabricator' | 'skyport' | 'dock' | 'uplink' | 'spire';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one action that advances (Deploy, End turn); secondary is the default. */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  /** Keyboard hint drawn as a key cap, e.g. "Z". */
  hotkey?: string;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface CommandItem { id: string; label: string; hint?: string; disabled?: boolean }
export interface CommandMenuProps {
  /** Small caption above the rows — usually the acting unit's name. */
  title?: string;
  items: CommandItem[];
  /** The row under the cursor; drawn in signal with the ▸ cursor. */
  activeId?: string;
  onSelect?: (id: string) => void;
  className?: string;
}
export declare function CommandMenu(props: CommandMenuProps): React.ReactElement;

export interface BuildMenuProps {
  /** Header label: "Fabricator", "Skyport", "Dock". */
  title?: string;
  /** Unit ids, or {unit, cost} to override the list price (CO modifiers). Defaults to every ground unit. */
  items?: (UnitId | { unit: UnitId; cost?: number })[];
  funds: number;
  faction: Faction;
  activeId?: UnitId;
  onSelect?: (unit: UnitId) => void;
  className?: string;
}
export declare function BuildMenu(props: BuildMenuProps): React.ReactElement;

export interface StatusChipProps {
  tone?: 'neutral' | 'signal' | 'warn' | 'danger' | 'faction';
  /** Required when tone = "faction". */
  faction?: Faction;
  /** Override the tone's icon, or false for none (only when the word alone is unambiguous). */
  icon?: 'dot' | 'diamond' | 'cross' | 'bolt' | 'ammo' | 'flag' | 'cargo' | false;
  children: React.ReactNode;
  className?: string;
}
export declare function StatusChip(props: StatusChipProps): React.ReactElement;

export interface SigilProps {
  faction: Faction | null;
  size?: number;
  /** ink = faction text colour (on chrome), fill = faction fill (on map-shade), on = on-faction (on a faction fill), current = inherit. */
  tone?: 'ink' | 'fill' | 'on' | 'current';
  /** Accessible name; omit when a visible word already names the faction. */
  title?: string;
}
export declare function Sigil(props: SigilProps): React.ReactElement;

export interface UnitTokenProps {
  unit: UnitId;
  faction: Faction;
  /** Display HP 1–10; the HP chip only shows below 10 (danger colour at 3 or less). */
  hp?: number;
  /** Has acted this turn — greyed out. */
  spent?: boolean;
  selected?: boolean;
  facing?: 'left' | 'right';
  /** Square size in px; 48 = one tile. */
  size?: number;
  status?: 'low-charge' | 'low-ammo' | 'capturing' | 'loaded';
  /** Hide from assistive tech when a visible label already names the unit. */
  decorative?: boolean;
  className?: string;
}
export declare function UnitToken(props: UnitTokenProps): React.ReactElement;

export interface MapTileProps extends React.HTMLAttributes<HTMLDivElement> {
  terrain: TerrainId;
  /** Property owner; unowned properties are neutral grey. */
  owner?: Faction;
  overlay?: 'move' | 'attack';
  cursor?: 'select' | 'target';
  fog?: boolean;
  size?: number;
  /** A UnitToken standing on the tile. */
  children?: React.ReactNode;
  /** Accessible name override (defaults to terrain + owner). */
  label?: string;
}
export declare function MapTile(props: MapTileProps): React.ReactElement;

export interface TerrainCardProps {
  terrain: TerrainId;
  owner?: Faction;
  /** Capture points remaining (20 = untouched). Shown for properties only. */
  capture?: number;
  className?: string;
}
export declare function TerrainCard(props: TerrainCardProps): React.ReactElement;

export interface UnitCardProps {
  unit: UnitId;
  faction: Faction;
  hp?: number;
  /** Defaults to the unit's full charge. */
  charge?: number;
  /** Defaults to full; ignored for units without a primary weapon. */
  ammo?: number | null;
  className?: string;
}
export declare function UnitCard(props: UnitCardProps): React.ReactElement;

export interface Combatant { unit: UnitId; faction: Faction; hp: number }
export interface BattleForecastProps {
  attacker: Combatant;
  defender: Combatant;
  /** [min, max] % of a full-HP unit, luck included. */
  damage: [number, number];
  /** null when the defender cannot strike back. */
  counter?: [number, number] | null;
  className?: string;
}
export declare function BattleForecast(props: BattleForecastProps): React.ReactElement;

export interface CommanderPortraitProps {
  name: string;
  /** null = ECHO. */
  faction: Faction | null;
  initials?: string;
  /** Painted portrait URL; the monogram shows until one exists. */
  src?: string;
  size?: number;
  state?: 'surge' | 'overclock';
  className?: string;
}
export declare function CommanderPortrait(props: CommanderPortraitProps): React.ReactElement;

export interface PowerMeterProps {
  /** Filled stars, fractional. */
  value: number;
  /** Stars needed for Surge (small diamonds). */
  surge: number;
  /** Stars needed for Overclock (total diamonds). */
  max: number;
  showLabel?: boolean;
  className?: string;
}
export declare function PowerMeter(props: PowerMeterProps): React.ReactElement;

export interface PlayerHudProps {
  commander: { name: string; faction: Faction | null; initials?: string; src?: string };
  funds: number;
  cycle?: number;
  power?: PowerMeterProps;
  className?: string;
}
export declare function PlayerHud(props: PlayerHudProps): React.ReactElement;

export interface DialogueBoxProps {
  speaker: { name: string; faction: Faction | null; initials?: string; src?: string; title?: string; state?: 'surge' | 'overclock' };
  /** Portrait side; alternate sides between speakers. */
  side?: 'left' | 'right';
  /** Radio channel line under the name, e.g. "Tactical channel · encrypted". */
  channel?: string;
  /** Show the ▾ advance cue. */
  more?: boolean;
  children: React.ReactNode;
  className?: string;
}
export declare function DialogueBox(props: DialogueBoxProps): React.ReactElement;

export interface TurnBannerProps {
  cycle: number;
  faction: Faction;
  /** Commander name for the "… commanding" line. */
  commander?: string;
  className?: string;
}
export declare function TurnBanner(props: TurnBannerProps): React.ReactElement;

/** Static game data shipped with the bundle: factions, units (stats), terrain (costs, defense), commanders, and the vector art. */
export declare const data: {
  factions: { id: Faction; name: string; short: string; motto: string; home: string }[];
  units: { id: UnitId; name: string; role: string; domain: 'ground' | 'air' | 'sea'; move: number; moveType: string; cost: number; vision: number; charge: number; ammo: number | null; range: [number, number] | null }[];
  terrain: { id: TerrainId; name: string; note: string; def: number; property?: boolean; cost: Record<string, number | null> }[];
  commanders: { id: string; name: string; initials: string; faction: Faction | null; title: string }[];
  art: { glyphs: Record<UnitId, string[]>; sigils: Record<string, { d: string; evenodd?: boolean }[]>; terrain: Record<TerrainId, { base: string; shapes: { c: string; d: string }[] }> };
};

declare global {
  interface Window {
    Ascendant: {
      Button: typeof Button; CommandMenu: typeof CommandMenu; BuildMenu: typeof BuildMenu; StatusChip: typeof StatusChip; Sigil: typeof Sigil;
      UnitToken: typeof UnitToken; MapTile: typeof MapTile; TerrainCard: typeof TerrainCard; UnitCard: typeof UnitCard; BattleForecast: typeof BattleForecast;
      CommanderPortrait: typeof CommanderPortrait; PowerMeter: typeof PowerMeter; PlayerHud: typeof PlayerHud; DialogueBox: typeof DialogueBox; TurnBanner: typeof TurnBanner;
      data: typeof data;
    };
  }
}
