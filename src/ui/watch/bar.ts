// The slim bar's numbers (G18, D-023): the cycle, whose turn it is, and the viewer's own funds. Pure, and read from ONE frame, the viewer's:
// a fogged viewer's bar can only say what its own frame says (funds are a public line of every player in an observation, observe.ts, and the
// viewer's own are its own). The omniscient view has no "your side", so it shows no funds at all.
import type { FactionId, PlayerIndex } from '../../game/aw';
import { isMasked, labelOf, ownerOf, seatOf } from './seats';
import type { Seats } from './seats';
import type { ViewFrame } from './timeline';

export interface BarModel {
  cycle: number;
  turn: {
    player: PlayerIndex;
    faction: FactionId;
    /** The short name on the chip: "You", "Rook", "Unmarked", or the nation's short name when the view names no seats. */
    label: string;
    /** For the accessible name: "Your", "Rook's", "Unmarked". */
    owner: string;
    /** The seat's nation is not named: the chip's sigil is the unmarked mark. */
    masked: boolean;
  };
  /** The viewer's own funds; null for the omniscient view (and for a viewer the frame has no line for). */
  funds: number | null;
  /** Whose funds they are, for the accessible name; null with no funds. */
  fundsOf: { label: string; masked: boolean; faction: FactionId } | null;
}

export function barModel(frame: ViewFrame, seats?: Seats): BarModel {
  const cur = frame.players[frame.current];
  const faction = cur?.faction ?? 'helion';
  const mine = frame.viewer === 'all' ? undefined : frame.players[frame.viewer];
  return {
    cycle: frame.cycle,
    turn: {
      player: frame.current,
      faction,
      label: labelOf(seats, frame.current, faction),
      owner: ownerOf(seats, frame.current, faction),
      masked: isMasked(seats, frame.current),
    },
    funds: mine ? mine.funds : null,
    fundsOf: mine && frame.viewer !== 'all' ? { label: labelOf(seats, frame.viewer, mine.faction), masked: seatOf(seats, frame.viewer)?.nation === 'masked', faction: mine.faction } : null,
  };
}

/** What the fog chip in the View menu says: the omniscient view first, then whether fog is up in this frame. */
export const fogLabel = (frame: Pick<ViewFrame, 'viewer' | 'fogActive'>): string => (frame.viewer === 'all' ? 'Omniscient view' : frame.fogActive ? 'Fog of war' : 'No fog');
