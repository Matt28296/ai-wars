// Legal-action enumerator. The player's agent (a Commanding Officer AI) and the MCP tools both need the full, exact list
// of what the current player may do. Every entry here is built from the engine's OWN queries (reachable, thenOptions,
// attackTargets, unloadTargets, buildOptions, canActivatePower) and never re-implements a rule, so a rule change in the
// engine flows through to this list by itself. legal.test.ts holds the guard: every entry must pass isLegal, and every
// action isLegal accepts must be in the list.
//
// One thing to know about fog: reachable() lets a path run through a hidden enemy, and applyAction then ambushes the
// mover on the tile before it. Such an action is legal, and it is listed (the player cannot see the enemy, so it is a
// real option). A tile that holds a hidden enemy has no then-options, so it is not listed as a stopping place.
import {
  attackTargets, buildOptions, canActivatePower, reachable, thenOptions, unloadTargets, withUnitAt,
} from './index';
import type { ReachEntry } from './index';
import type { Action, Coord, GameState, Then, Unit } from './types';

export interface LegalOptions {
  /** Offer `resign` as well. Off by default: the agent never concedes a battle on its own. */
  includeResign?: boolean;
}

type Drop = { cargoIndex: number; to: Coord };

const sameCoord = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y;

/** Every legal set of drops for a transport ending its move at `dest`: one cargo unit anywhere it fits, or two
 *  different cargo units onto two different tiles (a transport carries at most two). */
function dropSets(state: GameState, transport: Unit, dest: Coord): Drop[][] {
  const view = withUnitAt(state, transport.id, dest);
  const where = transport.cargo.map((_, i) => unloadTargets(view, transport.id, dest, i));
  const out: Drop[][] = [];
  for (let i = 0; i < where.length; i++) {
    for (const to of where[i]) out.push([{ cargoIndex: i, to: { x: to.x, y: to.y } }]);
  }
  for (let i = 0; i < where.length; i++) {
    for (let j = i + 1; j < where.length; j++) {
      for (const a of where[i]) {
        for (const b of where[j]) {
          if (sameCoord(a, b)) continue;
          out.push([{ cargoIndex: i, to: { x: a.x, y: a.y } }, { cargoIndex: j, to: { x: b.x, y: b.y } }]);
        }
      }
    }
  }
  return out;
}

/** Every legal move action that ends `unit`'s move at `dest` (one path, from reachable()): one per then-option, one per
 *  attack target, one per unload drop set. Empty when the unit cannot stop there. */
export function destinationActions(state: GameState, unit: Unit, dest: ReachEntry): Action[] {
  const kinds = thenOptions(state, unit.id, dest);
  const out: Action[] = [];
  if (!kinds.length) return out;
  const make = (then: Then): Action => ({
    kind: 'move', unitId: unit.id, path: dest.path.map((c) => ({ x: c.x, y: c.y })), then,
  });
  for (const kind of kinds) {
    if (kind === 'attack') {
      for (const t of attackTargets(state, unit.id, dest)) out.push(make({ kind: 'attack', target: { x: t.x, y: t.y } }));
    } else if (kind === 'unload') {
      for (const drops of dropSets(state, unit, dest)) out.push(make({ kind: 'unload', drops }));
    } else {
      out.push(make({ kind }));
    }
  }
  return out;
}

/** Every legal move action for one unit (empty if it is not the current player's, or has already acted). */
export function unitActions(state: GameState, unit: Unit): Action[] {
  const out: Action[] = [];
  if (state.winnerTeam !== null || unit.owner !== state.current || unit.acted || !state.units.includes(unit)) return out;
  for (const entry of reachable(state, unit.id).values()) {
    for (const a of destinationActions(state, unit, entry)) out.push(a);
  }
  return out;
}

/** Every build the current player can make now: owned, empty production properties, affordable types (row-major). */
export function buildActions(state: GameState): Action[] {
  const out: Action[] = [];
  if (state.winnerTeam !== null) return out;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (state.tiles[y][x].owner !== state.current) continue;
      for (const o of buildOptions(state, { x, y })) {
        if (o.affordable) out.push({ kind: 'build', at: { x, y }, unitType: o.type });
      }
    }
  }
  return out;
}

/** Surge and/or Overclock, when the engine says they can be activated now. */
export function powerActions(state: GameState): Action[] {
  const out: Action[] = [];
  if (canActivatePower(state, 'surge')) out.push({ kind: 'power', level: 'surge' });
  if (canActivatePower(state, 'overclock')) out.push({ kind: 'power', level: 'overclock' });
  return out;
}

/** Every legal action for `state.current`. Game over gives []. */
export function legalActions(state: GameState, opts: LegalOptions = {}): Action[] {
  if (state.winnerTeam !== null) return [];
  const out: Action[] = [];
  for (const unit of state.units) {
    if (unit.owner !== state.current || unit.acted) continue;
    for (const a of unitActions(state, unit)) out.push(a);
  }
  for (const a of buildActions(state)) out.push(a);
  for (const a of powerActions(state)) out.push(a);
  out.push({ kind: 'endTurn' });
  if (opts.includeResign) out.push({ kind: 'resign' });
  return out;
}

/** A stable identity for an action, independent of the path taken: unit + destination + then (or build site + type,
 *  power level, endTurn, resign). Two actions with equal keys do the same thing. */
export function actionKey(a: Action): string {
  switch (a.kind) {
    case 'move': {
      const d = a.path[a.path.length - 1];
      const t = a.then;
      let then: string = t.kind;
      if (t.kind === 'attack') then = `attack@${t.target.x},${t.target.y}`;
      if (t.kind === 'unload') {
        then = `unload[${[...t.drops].sort((p, q) => p.cargoIndex - q.cargoIndex).map((x) => `${x.cargoIndex}>${x.to.x},${x.to.y}`).join('+')}]`;
      }
      return `move:${a.unitId}>${d.x},${d.y}:${then}`;
    }
    case 'build': return `build:${a.at.x},${a.at.y}:${a.unitType}`;
    case 'power': return `power:${a.level}`;
    case 'endTurn': return 'endTurn';
    case 'resign': return 'resign';
  }
}
