// Defeat and victory: rout (no units after cycle 1), spire capture, resignation, mission objectives
// (survive N cycles, own N properties) and the turn limit.
import { TERRAIN_TYPES } from '../../data';
import { propertyIndex, emit, removeUnit, resetCapture, teamOf, unitCount, writableTile } from './state';
import type { Ctx } from './state';
import type { PlayerIndex } from './types';

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

/** A player with no units (cargo included) after cycle 1 is routed. */
export function checkRout(ctx: Ctx): void {
  const s = ctx.s;
  if (s.winnerTeam !== null || s.cycle <= 1) return;
  for (const p of s.players) {
    if (!p.defeated && unitCount(s, p.index) === 0) defeatPlayer(ctx, p.index, 'rout');
  }
}

export function checkCaptureObjective(ctx: Ctx, p: PlayerIndex): void {
  const s = ctx.s;
  if (s.objective.kind !== 'capture' || s.winnerTeam !== null) return;
  if ((propertyIndex(s).props[p] ?? 0) >= s.objective.properties) declareWinner(ctx, teamOf(s, p));
}

/** Called when cycle `ended` finishes (after the last player's turn). */
export function checkCycleEnd(ctx: Ctx, ended: number): void {
  const s = ctx.s;
  if (s.winnerTeam !== null) return;
  const obj = s.objective;
  const team0 = teamOf(s, 0);
  if (obj.kind === 'survive') {
    if (ended >= obj.cycles) declareWinner(ctx, team0);
    return;
  }
  if (s.turnLimit !== undefined && ended >= s.turnLimit) {
    // Mission clock ran out: player 0's side failed; the strongest other side (most properties) wins.
    const props = propertyIndex(s).props;
    let bestTeam: number | null = null;
    let bestProps = -1;
    for (const p of s.players) {
      if (p.defeated || p.team === team0) continue;
      if ((props[p.index] ?? 0) > bestProps) {
        bestProps = props[p.index] ?? 0;
        bestTeam = p.team;
      }
    }
    if (bestTeam !== null) declareWinner(ctx, bestTeam);
  }
}
