// D-016 for the 3D stage: the stage may only draw what the viewer was told. The frames it is given come from observe() (a player) or
// the omniscient post-match frame ('all'), so a hidden unit should never be in one. This is the second lock on that door: whatever
// reaches the stage, a unit the viewer cannot see is refused before any view is built for it, so a leak upstream can never become a
// unit standing in the picture.
//
// "Can see" here is the coarsest honest test a frame supports: the unit is on the viewer's team, or its tile is in the frame's visible
// mask. (observe() itself is stricter -- canSeeUnit can hide a unit on a visible tile -- so this never admits what observe() refused.)
import type { Unit } from '../../../game/aw';
import type { ViewFrame } from '../../watch/timeline';

export interface Safe {
  /** The frame with every unit the viewer cannot see removed. */
  frame: ViewFrame;
  /** The units that were refused (empty for a well-formed frame). */
  refused: Unit[];
}

export function onBoard(frame: ViewFrame, u: Unit): boolean {
  return Number.isInteger(u.x) && Number.isInteger(u.y) && u.x >= 0 && u.y >= 0 && u.x < frame.width && u.y < frame.height;
}

/** Whether the viewer of `frame` may be shown `u`. */
export function isViewable(frame: ViewFrame, u: Unit): boolean {
  if (!onBoard(frame, u)) return false;
  if (frame.viewer === 'all') return true;
  const mine = frame.players[frame.viewer]?.team;
  const theirs = frame.players[u.owner]?.team;
  if (mine !== undefined && mine === theirs) return true; // own and allied units are always known to their side
  return frame.visible[u.y]?.[u.x] === true;
}

const cache = new WeakMap<ViewFrame, Safe>();

/** The viewer-safe form of a frame. The same frame object always gives the same answer object, so callers can compare by identity. */
export function safeFrame(frame: ViewFrame): Safe {
  const hit = cache.get(frame);
  if (hit) return hit;
  const units: Unit[] = [];
  const refused: Unit[] = [];
  for (const u of frame.units) (isViewable(frame, u) ? units : refused).push(u);
  const out: Safe = refused.length === 0 ? { frame, refused } : { frame: { ...frame, units }, refused };
  cache.set(frame, out);
  return out;
}
