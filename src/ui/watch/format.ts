// Plain-sentence formatting of engine events for the viewer's log ("Helion Lancer hits Tidewell Trooper: 42%").
// The switch over event kinds ends in `assertNever`, so a new GameEvent kind is a compile error here until it has a sentence.
//
// The names come from the frames the VIEWER was given (before and after the step) and from the event itself; a unit the viewer
// was never shown (view-events.ts redacts it to UNSEEN_UNIT, or it is simply not in either frame) is "an unseen unit", never
// looked up anywhere else.
import { COMMANDERS } from '../../content/commanders';
import { FACTIONS, TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import type { CommanderId, Coord, GameEvent, PlayerIndex, Unit, UnitTypeId } from '../../game/aw';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import type { ViewFrame } from './timeline';

export type LogTone = 'info' | 'combat' | 'power' | 'economy' | 'alert' | 'quiet';

export interface LogLine {
  /** The timeline step whose transition produced the line. */
  step: number;
  text: string;
  tone: LogTone;
}

/** Everything a sentence needs to name things, built from what the viewer was shown. */
export interface FormatContext {
  /** "Helion Lancer"; undefined when the viewer was never shown this unit. */
  unitName(id: number): string | undefined;
  /** "Helion" */
  playerName(p: PlayerIndex): string;
  commanderOf(p: PlayerIndex): CommanderId | undefined;
  /** Terrain at a tile in the frame after the step. */
  terrainName(c: Coord): string;
  /** Names of the players on a team. */
  teamName(team: number): string;
}

export const credits = (n: number): string => `${n.toLocaleString('en-US')} CR`;
export const pad2 = (n: number): string => String(n).padStart(2, '0');

const UNSEEN_START = 'An unseen unit';
const UNSEEN_MID = 'an unseen unit';

/** 'a' or 'an' by the first letter's sound (unit names are plain English words). */
export function article(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

export function factionShort(frame: ViewFrame, p: PlayerIndex): string {
  const f = frame.players[p]?.faction;
  return f ? FACTIONS[f].short : `Player ${p + 1}`;
}

/** Builds the naming context for one step from the frames before and after it and the events the viewer got. */
export function makeFormatContext(before: ViewFrame, after: ViewFrame, events: GameEvent[]): FormatContext {
  const known = new Map<number, { type: UnitTypeId; owner: PlayerIndex }>();
  const take = (u: Unit): void => {
    known.set(u.id, { type: u.type, owner: u.owner });
    u.cargo.forEach(take);
  };
  before.units.forEach(take);
  after.units.forEach(take);
  for (const e of events) {
    if (e.kind === 'built') known.set(e.unitId, { type: e.type, owner: e.owner });
    else if (e.kind === 'destroyed') known.set(e.unitId, { type: e.type, owner: e.owner });
  }
  return {
    unitName(id) {
      const k = known.get(id);
      return k ? `${factionShort(after, k.owner)} ${UNIT_TYPES[k.type].name}` : undefined;
    },
    playerName: (p) => factionShort(after, p),
    commanderOf: (p) => after.players[p]?.commander,
    terrainName(c) {
      const t = after.tiles[c.y]?.[c.x]?.terrain ?? before.tiles[c.y]?.[c.x]?.terrain;
      return t ? TERRAIN_TYPES[t].name : 'ground';
    },
    teamName(team) {
      const names = after.players.filter((p) => p.team === team).map((p) => FACTIONS[p.faction].short);
      return names.length ? names.join(' and ') : `Team ${team + 1}`;
    },
  };
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const REASONS: Record<'rout' | 'hq' | 'resign' | 'deadline', string> = {
  rout: 'routed',
  hq: 'Command Spire captured',
  resign: 'resigned',
  deadline: 'out of time',
};

/** The commander's power name for a level, from the commander table; falls back to the level word. */
export function powerNameOf(commander: CommanderId, level: 'surge' | 'overclock'): string {
  const def = Object.prototype.hasOwnProperty.call(COMMANDERS, commander) ? COMMANDERS[commander] : undefined;
  const power = level === 'surge' ? def?.surge : def?.overclock;
  return power?.name ?? (level === 'surge' ? 'Surge' : 'Overclock');
}

export function commanderNameOf(commander: CommanderId): string {
  return Object.prototype.hasOwnProperty.call(COMMANDERS, commander) ? COMMANDERS[commander].name : 'Commander';
}

/** One event as one plain sentence (and the tone the log colours it with). */
export function formatEvent(e: GameEvent, ctx: FormatContext, step = 0): LogLine {
  const line = (text: string, tone: LogTone): LogLine => ({ step, text, tone });
  const name = (id: number, start = true): string => {
    if (id === UNSEEN_UNIT) return start ? UNSEEN_START : UNSEEN_MID;
    return ctx.unitName(id) ?? (start ? UNSEEN_START : UNSEEN_MID);
  };
  switch (e.kind) {
    case 'moved': {
      const n = Math.max(0, e.path.length - 1);
      return n === 0 ? line(`${name(e.unitId)} holds position`, 'quiet') : line(`${name(e.unitId)} moves ${plural(n, 'tile')}`, 'quiet');
    }
    case 'ambushed':
      return line(`${name(e.unitId)} is ambushed by ${name(e.by, false)} and stops`, 'alert');
    case 'dropBlocked':
      return line(`${name(e.transportId)} cannot unload ${name(e.cargoId, false)}: ${name(e.by, false)} blocks the drop`, 'alert');
    case 'attacked': {
      const hit = `${name(e.attackerId)} hits ${name(e.defenderId, false)}: ${e.damage}%`;
      if (e.counter > 0) return line(e.counterFirst ? `${hit} (struck first, counter ${e.counter}%)` : `${hit}, counter ${e.counter}%`, 'combat');
      return line(hit, 'combat');
    }
    case 'destroyed':
      return line(`${ctx.playerName(e.owner)} ${UNIT_TYPES[e.type].name} is destroyed`, 'combat');
    case 'captureProgress':
      return line(`${name(e.unitId)} captures ${ctx.terrainName(e.at)}: ${e.remaining} of 20 left`, 'info');
    case 'captured':
      return line(e.from === null
        ? `${ctx.playerName(e.by)} claims the unowned ${ctx.terrainName(e.at)}`
        : `${ctx.playerName(e.by)} takes the ${ctx.terrainName(e.at)} from ${ctx.playerName(e.from)}`, 'info');
    case 'loaded':
      return line(`${name(e.unitId)} boards ${name(e.transportId, false)}`, 'info');
    case 'unloaded':
      return line(`${name(e.unitId)} unloads from ${name(e.transportId, false)}`, 'info');
    case 'joined':
      return line(`${name(e.unitId)} joins ${name(e.intoId, false)}${e.refund > 0 ? `, refund ${credits(e.refund)}` : ''}`, 'info');
    case 'supplied':
      return line(`${name(e.byId)} resupplies ${plural(e.unitIds.length, 'unit')}`, 'info');
    case 'built':
      return line(`${ctx.playerName(e.owner)} builds ${article(UNIT_TYPES[e.type].name)} ${UNIT_TYPES[e.type].name}: ${credits(e.cost)}`, 'economy');
    case 'powerActivated': {
      const cmd = commanderNameOf(e.commander);
      return line(`${cmd} activates ${powerNameOf(e.commander, e.level)} (${e.level === 'surge' ? 'Surge' : 'Overclock'})`, 'power');
    }
    case 'powerEffect':
      return line(e.description, 'power');
    case 'turnEnded':
      return line(`${ctx.playerName(e.player)} ends the turn`, 'quiet');
    case 'turnStarted':
      return line(`Cycle ${pad2(e.cycle)}: ${ctx.playerName(e.player)} turn, income ${credits(e.income)}`, 'economy');
    case 'repaired':
      return line(`${name(e.unitId)} repairs ${Math.round(e.amount / 10)} HP for ${credits(e.cost)}`, 'economy');
    case 'crashed':
      return line(`${name(e.unitId)} is lost: out of charge`, 'alert');
    case 'weather':
      return line(e.weather === 'ionstorm' ? `An ion storm rises${e.turns > 0 ? ` for ${plural(e.turns, 'turn')}` : ''}` : 'The weather clears', 'info');
    case 'playerDefeated':
      return line(`${ctx.playerName(e.player)} is defeated: ${REASONS[e.reason]}`, 'alert');
    case 'victory':
      return line(`Victory: ${ctx.teamName(e.team)}`, 'alert');
    default:
      return assertNever(e, step);
  }
}

/** Compile-time exhaustiveness: a GameEvent kind without a sentence above makes this call a type error. At run time it fails soft. */
function assertNever(e: never, step: number): LogLine {
  void e;
  return { step, text: 'Something happens', tone: 'quiet' };
}

/** The whole log of a timeline: one line per kept event, in order. */
export function buildLog(steps: { index: number; frame: ViewFrame; events: GameEvent[] }[]): LogLine[] {
  const out: LogLine[] = [];
  for (let i = 1; i < steps.length; i++) {
    const ctx = makeFormatContext(steps[i - 1].frame, steps[i].frame, steps[i].events);
    for (const e of steps[i].events) out.push(formatEvent(e, ctx, i));
  }
  return out;
}
