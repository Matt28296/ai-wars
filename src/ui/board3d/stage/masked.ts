// Which players' units are drawn without a nation sigil (G16). The mission's seats (src/ui/watch/seats.ts, G15) say, for each player, whether
// the nation is shown or masked ("Unmarked drones, no nation named"); the stage hands the masked players' indices to the runtime, which makes
// those players' unit views unmarked. Pure: no React, no DOM, so what the page passes is tested without a browser.
import type { PlayerIndex } from '../../../game/aw';
import { isMasked } from '../../watch/seats';
import type { Seats } from '../../watch/seats';

/** The indices of the players whose nation is masked, in player order. No seats (the demo, a view that names nobody): none. */
export function maskedOwnersOf(seats: Seats, players: readonly { index: PlayerIndex }[]): PlayerIndex[] {
  return players.filter((p) => isMasked(seats, p.index)).map((p) => p.index);
}
