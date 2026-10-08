// Defeat and victory (docs/research/mechanics.md §13, with D-012.4, D-013 and D-015.5): rout (a player who has had
// units and has none left), spire capture, resignation, mission objectives (survive N cycles, own N properties), the
// campaign deadline and the turn limit.
import { TERRAIN_TYPES } from '../../data';
import { displayHp, emit, forEachUnit, propertyIndex, removeUnit, resetCapture, teamOf, unitCount, unitType, writableTile } from './state';
import type { Ctx } from './state';
import type { GameState, Player, PlayerIndex } from './types';

export function declareWinner(ctx: Ctx, team: number): void {
  if (ctx.s.winnerTeam !== null) return;
  ctx.s.winnerTeam = team;
  emit(ctx, { kind: 'victory', team });
}

/** Removes the player's units; properties go to the spire's captor (hq) or turn neutral; their spires become arcologies. */
export function defeatPlayer(ctx: Ctx, p: PlayerIndex, reason: 'rout' | 'hq' | 'resign', by: PlayerIndex | null = null): void {
  const s = ctx.s;
  const pl = s.players[p];
  if (!pl || pl.defeated) return;
  pl.defeated = true;
  pl.powerState = 'none';
  for (const u of s.units.filter((u) => u.owner === p)) {
    removeUnit(ctx, u.id);
    resetCapture(ctx, u);
  }
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (s.tiles[y][x].owner !== p) continue;
      const t = writableTile(ctx, x, y);
      t.owner = reason === 'hq' && by !== null ? by : null;
      t.capture = 20;
      if (TERRAIN_TYPES[t.terrain].hq) t.terrain = 'arcology';
    }
  }
  emit(ctx, { kind: 'playerDefeated', player: p, reason });
}

export function checkGameOver(ctx: Ctx): void {
  const s = ctx.s;
  if (s.winnerTeam !== null) return;
  const teams = new Set(s.players.filter((p) => !p.defeated).map((p) => p.team));
  if (teams.size === 1) declareWinner(ctx, [...teams][0]);
}

/**
 * True once the player has owned a unit: deployed at the start, built, or (saves that predate `unitsStarted`) already lost
 * one. D-012.4: rout needs a unit to lose, so a player who started with none and has built none is never routed.
 */
function hasHadUnits(p: Player): boolean {
  const st = p.stats;
  return (st.unitsStarted ?? 0) > 0 || st.unitsBuilt > 0 || st.unitsLost > 0;
}

/**
 * Event-driven rout (D-012.4): called after every action, so a player whose last unit (cargo included) is gone is
 * defeated at once, on any cycle. A player who has never had a unit is not routed.
 */
export function checkRout(ctx: Ctx): void {
  const s = ctx.s;
  if (s.winnerTeam !== null) return;
  for (const p of s.players) {
    if (isRouted(s, p)) defeatPlayer(ctx, p.index, 'rout');
  }
}

/** True when the player is still in the game, has had units, and has none left (cargo counts). */
export function isRouted(s: GameState, p: Player): boolean {
  return !p.defeated && hasHadUnits(p) && unitCount(s, p.index) === 0;
}

export function checkCaptureObjective(ctx: Ctx, p: PlayerIndex): void {
  const s = ctx.s;
  if (s.objective.kind !== 'capture' || s.winnerTeam !== null) return;
  if ((propertyIndex(s).props[p] ?? 0) >= s.objective.properties) declareWinner(ctx, teamOf(s, p));
}

/** What a team holds when the clock runs out: owned properties first, then the worth of its units (cost x display HP). */
interface Standing { team: number; props: number; value: number; moves: number }

function standings(s: GameState): Standing[] {
  const props = propertyIndex(s).props;
  const byTeam = new Map<number, Standing>();
  for (const p of s.players) {
    if (p.defeated) continue;
    const st = byTeam.get(p.team) ?? { team: p.team, props: 0, value: 0, moves: p.index };
    st.props += props[p.index] ?? 0;
    st.moves = Math.min(st.moves, p.index);
    byTeam.set(p.team, st);
  }
  forEachUnit(s, (u) => {
    const st = byTeam.get(teamOf(s, u.owner));
    if (st) st.value += unitType(u.type).cost * displayHp(u.hp);
  });
  return [...byTeam.values()];
}

/**
 * D-013: a campaign deadline. When cycle `deadline.cycles` has ended and nobody has won, every player on
 * `deadline.team` is defeated and the game-over check runs, so the other side wins. The contract's `playerDefeated`
 * reason has no 'deadline' value, so the defeat is reported as 'rout' (the units are gone either way).
 */
function applyDeadline(ctx: Ctx, ended: number): void {
  const s = ctx.s;
  const d = s.deadline;
  if (!d || ended < d.cycles || s.winnerTeam !== null) return;
  for (const p of s.players) if (p.team === d.team) defeatPlayer(ctx, p.index, 'rout');
  checkGameOver(ctx);
}

/**
 * Called when cycle `ended` finishes (after the last player's turn). Order: survive, deadline, turn limit.
 * - survive N: player 0's team wins when cycle N ends, if it still has a player standing.
 * - deadline (D-013): if its cycle has ended and its team has not won, that team loses (see applyDeadline). It runs
 *   before the turn limit, so a deadline and a turn limit that end together resolve as the deadline.
 * - turn limit: when cycle `turnLimit` ends the team with the most properties wins, then the most unit value
 *   (mechanics.md §13). A tie on both goes to the team that moves later in the cycle, since player 0 moves first.
 */
export function checkCycleEnd(ctx: Ctx, ended: number): void {
  const s = ctx.s;
  if (s.winnerTeam !== null) return;
  const obj = s.objective;
  if (obj.kind === 'survive') {
    const team0 = teamOf(s, 0);
    if (ended >= obj.cycles && s.players.some((p) => p.team === team0 && !p.defeated)) declareWinner(ctx, team0);
  }
  applyDeadline(ctx, ended);
  if (s.winnerTeam !== null || obj.kind === 'survive') return;
  if (s.turnLimit !== undefined && ended >= s.turnLimit) {
    const ranked = standings(s).sort((a, b) => b.props - a.props || b.value - a.value || b.moves - a.moves);
    if (ranked.length) declareWinner(ctx, ranked[0].team);
  }
}
