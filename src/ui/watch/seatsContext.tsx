// The watch view's seat names, offered to the pieces drawn inside it that were not handed a seat (G15). The 3D stage draws its own turn
// banner and is given only the nation and the commander's name, so the banner asks here which seat that is. With no provider (the demo,
// the gallery) nothing is offered and every piece names things the old way.
import { createContext, useContext } from 'react';
import type { FactionId, PlayerIndex } from '../../game/aw';
import { bannerSeatOf, seatIndexOf } from './seats';
import type { BannerSeat, SeatKey, Seats } from './seats';

export interface SeatBook {
  seats: Seats;
  keys: readonly SeatKey[];
  /** The seat whose turn the step on screen is on: it settles a tie between two seats of one nation and one commander name. */
  current: PlayerIndex;
}

export const SeatsContext = createContext<SeatBook | null>(null);

/** The seat a banner for this nation and commander name means; undefined when the view names no seats or none matches. */
export function useBannerSeat(faction: FactionId, commanderName: string | undefined): BannerSeat | undefined {
  const book = useContext(SeatsContext);
  if (!book) return undefined;
  const i = seatIndexOf(book.keys, faction, commanderName, book.current);
  return i < 0 ? undefined : bannerSeatOf(book.seats, i, faction);
}
