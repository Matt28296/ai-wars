// Doctrine power timing (docs/research/ai-behaviour.md B.9, simplified). The player's `powerPolicy` decides:
//   whenReady         use a power the first turn one can be used: the Overclock if both are ready, else the Surge.
//   saveForOverclock  never spend a Surge while the Overclock is within one star (the bar is nearly full); otherwise spend it when
//                     there is a fight to spend it on. The Overclock is used as soon as it is ready.
//   defensive         hold powers until the army is under real pressure (units in the enemy's reach, the spire contested),
//                     then use the Surge, or the Overclock when the pressure is severe.
// A power is used at the start of the turn, before any unit has acted. The one exception is a power that lets units act again
// ('refresh'), which is worth most after they have: it is used once every unit has acted.
import { UNIT_TYPES } from '../../data';
import { powerCost, powerDef, starValue } from '../aw/power';
import { manhattan } from '../aw/state';
import type { Action } from '../aw/types';
import type { Ctx } from './eval';
import { capturersThreatening, threatOn, unitValue } from './eval';

type PowerAction = Extract<Action, { kind: 'power' }>;

function refreshes(ctx: Ctx, level: 'surge' | 'overclock'): boolean {
  const def = powerDef(ctx.view, ctx.me, level);
  return !!def && def.effects.some((e) => e.kind === 'refresh');
}

/** Is there a fight to spend a power on: a visible enemy within eight tiles of one of my units. */
function inContact(ctx: Ctx): boolean {
  return ctx.foes.some((e) => ctx.mine.some((u) => manhattan(u, e) <= 8));
}

/** How hard the enemy can hit me next turn, 0 (nothing) to 1+ (severe): the share of my army's value that is in reach, and the spire. */
function pressure(ctx: Ctx): number {
  let total = 0;
  let atRisk = 0;
  for (const u of ctx.mine) {
    const v = unitValue(u);
    total += v;
    const dmg = threatOn(ctx, u, u);
    if (dmg >= 30) atRisk += v * Math.min(1, dmg / u.hp);
  }
  let p = total > 0 ? atRisk / total : 0;
  const spire = ctx.homeSpires[0];
  if (spire && capturersThreatening(ctx, spire).length) p += 1;
  const tough = ctx.mine.filter((u) => UNIT_TYPES[u.type].range && threatOn(ctx, u, u) >= 0.5 * u.hp).length;
  return p + (tough >= 2 ? 0.2 : 0);
}

/**
 * The power action to take now, or null. `phase` 'start' is before any unit has acted; 'end' is when no unit has anything left
 * to do (for powers that refresh units).
 */
export function choosePower(ctx: Ctx, actions: Action[], phase: 'start' | 'end'): Action | null {
  const powers = actions.filter((a): a is PowerAction => a.kind === 'power');
  if (!powers.length) return null;
  const surge = powers.find((a) => a.level === 'surge');
  const over = powers.find((a) => a.level === 'overclock');
  const started = ctx.mine.some((u) => u.acted);
  const ready = (a: PowerAction | undefined): a is PowerAction => {
    if (!a) return false;
    if (refreshes(ctx, a.level)) return phase === 'end' && started;
    return phase === 'start' && !started;
  };
  const s = ready(surge) ? surge : undefined;
  const o = ready(over) ? over : undefined;
  if (!s && !o) return null;

  const policy = ctx.orders.powerPolicy;
  if (policy === 'whenReady') return o ?? s ?? null;

  if (policy === 'saveForOverclock') {
    if (o) return o;
    if (!s) return null;
    const me = ctx.view.players[ctx.me];
    const starsToO = (powerCost(ctx.view, ctx.me, 'overclock') - me.power) / starValue(ctx.view, ctx.me);
    if (starsToO <= 1) return null;
    return inContact(ctx) ? s : null;
  }

  // defensive
  const p = pressure(ctx);
  if (p < 0.25) return null;
  if (o && p >= 0.6) return o;
  return s ?? (p >= 0.6 ? o ?? null : null);
}
