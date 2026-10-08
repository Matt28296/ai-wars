// The per-viewer event filter (D-016, the second half). applyAction returns every event of a step, hidden units included; the
// player's agent, the spectator view and the replay viewer must each get only what their player could have seen happen.
//
//   viewEvents(before, after, events, viewer)   the events of one applyAction step (before -> after) that `viewer` may see.
//
// "Visible" is the engine's own vision (fog.ts visionGrid): a tile is visible when it is in the viewer's TEAM's vision in `before`
// OR in `after`. That is a deliberate simplification: vision is not recomputed for each event inside the step. With fog off in both
// states the events come back unchanged -- the very same array. Otherwise every kept event is a fresh copy (the result shares
// nothing with the input, and the input is never modified); if the viewer's team sees everything (the 'reveal' power) or the fog
// comes up or goes down during the step, every tile counts as in sight, so nothing is trimmed, redacted or dropped.
// A unit's owner comes from `before` (or `after` for units that did not exist yet); where a unit stood at the moment of an event
// is its place in `before`, moved on by the step's own `moved` events (a shooter that moved and then died is not in `after`).
//
// Every GameEvent kind has exactly one row below, and the switch is checked at compile time: a new kind fails `tsc` until it has a rule.
// Each event maps to one event or to none, in order. "Friend" = the viewer's own or an allied unit/player (the same team).
//
//   kind              rule  friend                              enemy (not the viewer's team)
//   ----------------  ----  ----------------------------------  ------------------------------------------------------------------
//   moved             a, b  kept in full                        path trimmed to its visible tiles; dropped when none is visible
//   ambushed          a, f  kept; `blockerAt` added (the        mover visible where it stopped -> kept, `blockerAt` added;
//                           hidden blocker is revealed)         otherwise dropped (a blocker that is not ours must be visible too)
//   dropBlocked       a, f  kept; `at` is the blocker's tile    kept when the transport's tile is visible (and a blocker that is
//                                                               not ours is visible at `at`); otherwise dropped
//   attacked          c     we are the attacker: kept in full   we are the defender and the attacker is not visible: kept with
//                                                               attackerId = attackerHp = UNSEEN_UNIT; visible attacker: kept in
//                                                               full. Neither side ours: dropped unless the defender is visible
//                                                               (then the attacker is redacted the same way if it is not)
//   destroyed         d     kept in full                        kept on a visible tile; otherwise dropped
//   captureProgress   d     kept in full                        kept on a visible tile
//   captured          e     kept                                kept: property ownership is public (mechanics.md 9.3)
//   loaded            d     kept in full                        kept when the transport's tile is visible
//   unloaded          d     kept in full                        kept when `to` is visible; transportId = UNSEEN_UNIT when the
//                                                               transport's own tile is not
//   joined            d     kept in full                        kept when the tile of the unit joined into is visible
//   supplied          d     kept in full                        kept when the supplier's tile is visible, unitIds trimmed to the
//                                                               visible ones; dropped when none is left
//   built             d     kept in full                        kept when `at` is visible
//   repaired          d     kept in full                        kept when the unit's tile is visible
//   crashed           d     kept in full                        kept when `at` is visible
//   powerActivated    e     kept                                kept (public: who, which level, which commander)
//   powerEffect       e     kept in full                        kept; `affected` trimmed to visible tiles, and a count of units
//                                                               in the description ("3 units may act again") is blanked
//   turnStarted       e     kept                                kept
//   turnEnded         e     kept                                kept
//   weather           e     kept                                kept
//   playerDefeated    e     kept                                kept
//   victory           e     kept                                kept
//
// (destroyed, captureProgress, repaired, crashed and powerEffect have no letter in the order; they follow (d) and (e) by analogy.)
//
// Redaction uses what the types allow: UNSEEN_UNIT (-1) in a number field that holds a unit id or a unit's HP. The one thing the
// union cannot say is WHERE the blocker of an ambush stands (the event carries the mover's tile), so a kept `ambushed` is typed
// AmbushView: the same event plus `blockerAt`, the blocker's real tile taken from `before`. Nothing here invents data.
//
// Known limits, on purpose: (1) tile visibility is the engine's grid, so an air unit over canopy that observe() lists is not
// reported moving (never a leak, only less); (2) unit ids are the engine's sequential counter, so a gap between the ids the
// viewer sees can still hint that a unit exists; neither this filter nor observe() hides that; (3) the future stealth flag
// (`hidden`) is not consulted, as in movement.ts; (4) a "Strike at x,y" description of an enemy power is kept as is.
import { fogActive, visionGrid } from './fog';
import { teamOf } from './state';
import type { Coord, GameEvent, GameState, PlayerIndex, Unit } from './types';

/** Stands in for a unit id or a unit's HP that the viewer may not know. Never a real id (ids start at 1) and never a real HP. */
export const UNSEEN_UNIT = -1;

/** An `ambushed` event as the ambushed team receives it: the event plus the tile of the unit that blocked the move (rule f). */
export type AmbushView = Extract<GameEvent, { kind: 'ambushed' }> & { blockerAt: Coord };

export function isAmbushView(e: GameEvent): e is AmbushView {
  return e.kind === 'ambushed' && 'blockerAt' in e;
}

const copyCoord = (c: Coord): Coord => ({ x: c.x, y: c.y });
const clone = <T extends GameEvent>(e: T): T => structuredClone(e);

/** "3 units may act again" -> "units may act again": how many hidden units a power touched is not for the viewer. */
function blankUnitCount(description: string): string {
  return description.replace(/\b\d+ units?\b/g, 'units');
}

/** The events of one applyAction step (`before` -> `after`) that `viewer` may see. See the table at the top of this file. */
export function viewEvents(before: GameState, after: GameState, events: GameEvent[], viewer: PlayerIndex): GameEvent[] {
  if (!Number.isInteger(viewer) || viewer < 0 || viewer >= before.players.length) {
    throw new RangeError(`no player ${String(viewer)} in a ${before.players.length}-player game`);
  }
  if (!fogActive(before) && !fogActive(after)) return events;
  const gridBefore = visionGrid(before, viewer);
  const gridAfter = visionGrid(after, viewer);
  // A grid is null when the viewer's team sees every tile ('reveal') or there is no fog: then every tile is in sight at that end of the step.
  const everything = !gridBefore || !gridAfter;

  const team = teamOf(before, viewer);
  const W = before.width;
  const H = before.height;

  // Who owns each unit, and where it stands as the step begins (cargo stands where its transport does).
  const owner = new Map<number, PlayerIndex>();
  const pos = new Map<number, Coord>();
  const register = (u: Unit, where: Coord, overwrite: boolean): void => {
    if (overwrite || !owner.has(u.id)) {
      owner.set(u.id, u.owner);
      pos.set(u.id, copyCoord(where));
    }
    for (const c of u.cargo) register(c, where, overwrite);
  };
  for (const u of before.units) register(u, u, true);
  for (const u of after.units) register(u, u, false); // units that only exist afterwards (built, unloaded)

  const seen = (c: Coord | undefined): boolean => {
    if (!c || c.x < 0 || c.y < 0 || c.x >= W || c.y >= H) return false;
    const i = c.y * W + c.x;
    return everything || gridBefore![i] === 1 || gridAfter![i] === 1;
  };
  const friendPlayer = (p: PlayerIndex): boolean => teamOf(before, p) === team;
  const friend = (id: number): boolean => owner.has(id) && friendPlayer(owner.get(id)!);

  const filterOne = (e: GameEvent): GameEvent | null => {
    switch (e.kind) {
      case 'moved': {
        if (friend(e.unitId)) return clone(e); // (a)
        const path = e.path.filter((c) => seen(c)).map(copyCoord); // (b)
        return path.length ? { kind: 'moved', unitId: e.unitId, path } : null;
      }
      case 'ambushed': {
        const blocker = pos.get(e.by);
        if (!blocker) return null;
        let keep: boolean;
        if (friend(e.unitId)) keep = true; // (a), (f): we were stopped, and the blocker is shown
        else if (friend(e.by)) keep = seen(e.at); // an enemy walked into one of ours: it is seen where it stopped, or not at all
        else keep = seen(e.at) && seen(blocker); // a trap between two others
        if (!keep) return null;
        const view: AmbushView = { ...clone(e), blockerAt: copyCoord(blocker) };
        return view;
      }
      case 'dropBlocked': {
        if (friend(e.transportId)) return clone(e); // (a), (f): `at` is the blocker's tile
        if (!seen(pos.get(e.transportId))) return null;
        return friend(e.by) || seen(e.at) ? clone(e) : null;
      }
      case 'attacked': {
        if (friend(e.attackerId)) return clone(e); // (c): we fired, so we saw the target
        if (!friend(e.defenderId) && !seen(pos.get(e.defenderId))) return null; // a fight in the dark between others
        if (seen(pos.get(e.attackerId))) return clone(e);
        return { ...clone(e), attackerId: UNSEEN_UNIT, attackerHp: UNSEEN_UNIT }; // (c): the shooter stays hidden
      }
      case 'destroyed':
        return friendPlayer(e.owner) || seen(e.at) ? clone(e) : null;
      case 'captureProgress':
        return friend(e.unitId) || seen(e.at) ? clone(e) : null;
      case 'captured':
        return clone(e); // (e)
      case 'loaded':
        return friend(e.transportId) || seen(pos.get(e.transportId)) ? clone(e) : null;
      case 'unloaded': {
        if (friend(e.transportId)) return clone(e);
        if (!seen(e.to)) return null;
        return seen(pos.get(e.transportId)) ? clone(e) : { ...clone(e), transportId: UNSEEN_UNIT };
      }
      case 'joined':
        return friend(e.intoId) || seen(pos.get(e.intoId)) ? clone(e) : null;
      case 'supplied': {
        if (friend(e.byId)) return clone(e);
        if (!seen(pos.get(e.byId))) return null;
        const unitIds = e.unitIds.filter((id) => seen(pos.get(id)));
        return unitIds.length ? { kind: 'supplied', byId: e.byId, unitIds } : null;
      }
      case 'built':
        return friendPlayer(e.owner) || seen(e.at) ? clone(e) : null;
      case 'repaired':
        return friend(e.unitId) || seen(pos.get(e.unitId)) ? clone(e) : null;
      case 'crashed':
        return friend(e.unitId) || seen(e.at) ? clone(e) : null;
      case 'powerEffect': {
        if (friendPlayer(e.player)) return clone(e);
        return {
          kind: 'powerEffect', player: e.player, description: blankUnitCount(e.description),
          affected: e.affected.filter((c) => seen(c)).map(copyCoord),
        };
      }
      case 'powerActivated':
      case 'turnStarted':
      case 'turnEnded':
      case 'weather':
      case 'playerDefeated':
      case 'victory':
        return clone(e); // (e)
      default:
        return assertNever(e);
    }
  };

  /** Moves the tracker on: a unit that moved stands at the end of its path from then on (it may fire from there, or load, or join). */
  const advance = (e: GameEvent): void => {
    if (e.kind === 'moved' && e.path.length) pos.set(e.unitId, copyCoord(e.path[e.path.length - 1]));
  };

  const out: GameEvent[] = [];
  for (const e of events) {
    const v = filterOne(e);
    if (v) out.push(v);
    advance(e);
  }
  return out;
}

/** Fail closed: a kind the union gained without a rule here is dropped at run time, and refused at compile time. */
function assertNever(e: never): null {
  void e;
  return null;
}
