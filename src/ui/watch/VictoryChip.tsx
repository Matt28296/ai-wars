// The chip that names the winning side over the board: "Victory: You and Rook". Drawn by the flat stage; the 3D stage draws the same chip.
// The names are the view's seat labels (a nation's short name when the view names no seats), so two seats of one nation read apart.
import type { ReactElement } from 'react';
import { Sigil } from './kit';
import { isMasked, labelOf } from './seats';
import type { Seats } from './seats';
import type { ViewFrame } from './timeline';

export function VictoryChip({ frame, seats }: { frame: ViewFrame; seats?: Seats }): ReactElement | null {
  const winner = frame.winnerTeam;
  if (winner === null) return null;
  const winners = frame.players.filter((p) => p.team === winner);
  return (
    <span className="aww-victory label">
      <Sigil faction={winners[0]?.faction ?? null} size={18} tone="ink" masked={winners[0] !== undefined && isMasked(seats, winners[0].index)} />
      Victory: {winners.map((p) => labelOf(seats, p.index, p.faction)).join(' and ')}
    </span>
  );
}
