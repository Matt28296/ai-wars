// How the watch view names the players (G15). A view is given an optional `people` list, one SeatPresentation per player index, saying
// what the screen may show for that seat: a name, a short label, whether the nation is shown or masked, and which portrait. Pure: no
// React, no DOM. With no list every place falls back to the words it always used (the nation, the commander), so the demo is unchanged.
//
// Why it exists: the mission's briefing names the enemy of mission 1 "Unmarked drones, no nation named", and the battle screen used to
// name them "The Hollow Choir" (Act IV's reveal) and to call two Helion seats "Helion, Helion". The mission builds the list from the same
// `sidePerson` the briefing uses (src/ui/front/seats.ts), and every place below reads it.
import { FACTIONS } from '../../data';
import type { FactionId, PlayerIndex } from '../../game/aw';

/** Which face a seat wears: a commander's own bust, the agent's monogram, drones' monogram, or the plate of a side nobody has named. */
export type SeatPortrait = 'commander' | 'agent' | 'drones' | 'unmarked';

export interface SeatPresentation {
  /** The full name: panels, the turn banner, the intel owner line. "Your agent", "Rook Okafor", "Unmarked drones". */
  name: string;
  /** The short label: the viewer toggle and the victory chip, where there is no room for the name. "You", "Rook", "Unmarked". */
  label: string;
  /** 'masked': the nation is not named and its sigil is not drawn (an unmarked mark stands in); its units keep their colours. */
  nation: 'shown' | 'masked';
  portrait: SeatPortrait;
  /**
   * How a sentence in the event log (and "<owner> turn") names the seat. `subject` takes the verb ("Your agent builds a Lancer") and
   * `owner` goes before a unit or a noun ("Your Lancer", "Rook's Lancer", "Rook's turn"). Both default to `label`.
   */
  log?: { subject: string; owner: string };
}

/** One entry per player index. A missing entry (or no list at all) means "name that seat the old way". */
export type Seats = readonly (SeatPresentation | undefined)[] | undefined;

/** What the nation line reads for a seat whose nation is masked: the briefing's own words. */
export const MASKED_NATION_TEXT = 'No nation named';

export const seatOf = (seats: Seats, p: PlayerIndex): SeatPresentation | undefined => seats?.[p];

export const isMasked = (seats: Seats, p: PlayerIndex): boolean => seatOf(seats, p)?.nation === 'masked';

/** The label of a seat: the viewer toggle and the victory chip. Old way: the nation's short name. */
export function labelOf(seats: Seats, p: PlayerIndex, faction: FactionId | undefined): string {
  const s = seatOf(seats, p);
  if (s) return s.label;
  return faction ? FACTIONS[faction].short : `Player ${p + 1}`;
}

/** The seat's name in a log sentence's subject position. */
export function subjectOf(seats: Seats, p: PlayerIndex, faction: FactionId | undefined): string {
  const s = seatOf(seats, p);
  return s ? s.log?.subject ?? s.label : labelOf(undefined, p, faction);
}

/** The seat's name before a noun: "Your" Lancer, "Rook's" Lancer, "Unmarked" Trooper. */
export function ownerOf(seats: Seats, p: PlayerIndex, faction: FactionId | undefined): string {
  const s = seatOf(seats, p);
  return s ? s.log?.owner ?? s.label : labelOf(undefined, p, faction);
}

/** The nation line under a name: the nation's full name, or the briefing's "No nation named" for a masked seat. */
export function nationTextOf(seats: Seats, p: PlayerIndex, faction: FactionId): string {
  return isMasked(seats, p) ? MASKED_NATION_TEXT : FACTIONS[faction].name;
}

/**
 * Labels that no two seats share. A shared label (two seats of one nation, in a view given no seats) gets the seat's number after it, so
 * the viewer toggle never offers two buttons with the same word. Labels that are already alone are left exactly as they are.
 */
export function uniqueLabels(labels: readonly string[]): string[] {
  const count = new Map<string, number>();
  for (const l of labels) count.set(l, (count.get(l) ?? 0) + 1);
  return labels.map((l, i) => ((count.get(l) ?? 0) > 1 ? `${l} ${i + 1}` : l));
}

/** What a banner needs to say about a seat. */
export interface BannerSeat {
  name: string;
  /** The line under the name: the nation, or "No nation named". */
  caption: string;
  masked: boolean;
}

export function bannerSeatOf(seats: Seats, p: PlayerIndex, faction: FactionId): BannerSeat | undefined {
  const s = seatOf(seats, p);
  return s ? { name: s.name, caption: nationTextOf(seats, p, faction), masked: s.nation === 'masked' } : undefined;
}

/** A player as the frames name it: enough to find the seat a banner is drawn for when only the nation and the commander's name are known. */
export interface SeatKey {
  faction: FactionId;
  commanderName: string;
}

/**
 * The seat a banner means. A banner is handed the nation and the commander's name (not an index), so two seats of one nation are told
 * apart by the commander's name, and `current` (the seat whose turn the step is on) settles a tie. -1 when no seat matches.
 */
export function seatIndexOf(keys: readonly SeatKey[], faction: FactionId, commanderName: string | undefined, current: PlayerIndex): number {
  const hits: number[] = [];
  keys.forEach((k, i) => { if (k.faction === faction && (commanderName === undefined || k.commanderName === commanderName)) hits.push(i); });
  if (hits.length === 0) return -1;
  return hits.includes(current) ? current : hits[0];
}
