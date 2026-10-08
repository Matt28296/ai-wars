// Plain-sentence formatting of engine events for the viewer's log ("Helion Lancer hits Tidewell Trooper: 42%").
// The switch over event kinds ends in `assertNever`, so a new GameEvent kind is a compile error here until it has a sentence.
//
// The names come from the frames the VIEWER was given (before and after the step) and from the event itself; a unit the viewer
// was never shown (view-events.ts redacts it to UNSEEN_UNIT, or it is simply not in either frame) is "an unseen unit", never
// looked up anywhere else.
import { COMMANDERS } from '../../content/commanders';
import { FACTIONS, TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import type { CommanderId, Coord, FactionId, GameEvent, PlayerIndex, Unit, UnitTypeId } from '../../game/aw';
import { UNSEEN_UNIT } from '../../game/aw/view-events';
import type { ViewFrame } from './timeline';

export type LogTone = 'info' | 'combat' | 'power' | 'economy' | 'alert' | 'quiet';

/** The small glyph a log line carries, by kind of event. Shape is a cue of its own: the line's colour is never the only one. */
export type LogIcon =
  | 'attack' | 'destroyed' | 'capture' | 'build' | 'power' | 'repair' | 'turn'
  | 'move' | 'alert' | 'cargo' | 'weather' | 'victory' | 'info';

/** One row per event kind. The mapped type makes a new GameEvent kind a compile error here until it has an icon. */
export const LOG_ICONS: { [K in GameEvent['kind']]: LogIcon } = {
  moved: 'move',
  ambushed: 'alert',
  dropBlocked: 'alert',
  attacked: 'attack',
  destroyed: 'destroyed',
  captureProgress: 'capture',
  captured: 'capture',
  loaded: 'cargo',
  unloaded: 'cargo',
  joined: 'repair',
  supplied: 'repair',
  built: 'build',
  powerActivated: 'power',
  powerEffect: 'power',
  turnEnded: 'turn',
  turnStarted: 'turn',
  repaired: 'repair',
  crashed: 'destroyed',
  weather: 'weather',
  playerDefeated: 'destroyed',
  victory: 'victory',
};

/** The icon of an event kind; a kind this table has never heard of (or a prototype key) gets the plain dot. */
export function logIconOf(kind: string): LogIcon {
  return Object.prototype.hasOwnProperty.call(LOG_ICONS, kind) ? LOG_ICONS[kind as GameEvent['kind']] : 'info';
}

export interface LogLine {
  /** The timeline step whose transition produced the line. */
  step: number;
  text: string;
  tone: LogTone;
  /** The event kind behind the sentence ('unknown' for a kind this build does not know). */
  kind: GameEvent['kind'] | 'unknown';
  icon: LogIcon;
  /**
   * The side the sentence is about (its grammatical subject), for the faction stripe. null when the viewer was never shown who it was:
   * a shot from an unseen unit has no stripe, so the stripe cannot tell a fogged viewer what the sentence withholds.
   */
  faction: FactionId | null;
  /** Turn lines read as section headers: "Cycle 04" over "Helion turn, income 7,000 CR". */
  section?: { title: string; detail: string };
}

/** How a striped line names its side without colour: the faction name already in the sentence, or else a sigil to draw. */
export function stripeCue(l: Pick<LogLine, 'faction' | 'text'>): 'name' | 'sigil' | 'none' {
  if (l.faction === null) return 'none';
  return l.text.includes(FACTIONS[l.faction].short) ? 'name' : 'sigil';
}

/**
 * Older lines fade slightly so the newest reads first: age 0 is full strength, and nothing drops below 78%, which keeps even the muted
 * (ink-muted) lines above the 4.5:1 text contrast the design system promises on its panel ground.
 */
export function logOpacity(age: number): number {
  if (!Number.isFinite(age) || age <= 0) return 1;
  return Math.max(0.78, Math.round((1 - age * 0.04) * 100) / 100);
}

/** One turn's lines under their header; `head` is null for the lines before the first turn header the list holds. */
export interface LogSection {
  head: LogLine | null;
  lines: LogLine[];
}

/** The lines grouped under their turn headers, in order, so a header can pin to the top of its own section and be pushed out by the next. */
export function groupLog(lines: readonly LogLine[]): LogSection[] {
  const out: LogSection[] = [];
  for (const l of lines) {
    if (l.section) out.push({ head: l, lines: [] });
    else {
      if (out.length === 0) out.push({ head: null, lines: [] });
      out[out.length - 1].lines.push(l);
    }
  }
  return out;
}

export interface ScrollGeom {
  /** scrollTop */
  top: number;
  /** scrollHeight */
  height: number;
  /** clientHeight */
  client: number;
}

/** How close to the end still counts as "at the end" (sub-pixel rounding, a half-visible line). */
export const FOLLOW_SLACK_PX = 24;

export const atBottom = (g: ScrollGeom): boolean => g.height - g.top - g.client <= FOLLOW_SLACK_PX;

/**
 * Whether the log keeps following its newest line after a scroll event. Reaching the end switches following on; a scroll UP (the
 * viewer reading history) switches it off and nothing the log does later brings it back; a scroll DOWN that has not arrived yet (our own
 * smooth scroll in flight) changes nothing. `lastTop` is the scrollTop at the previous event.
 */
export function followAfterScroll(prev: boolean, g: ScrollGeom, lastTop: number): boolean {
  if (atBottom(g)) return true;
  if (g.top < lastTop - 1) return false;
  return prev;
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
  /** Who owns a unit the viewer was shown; undefined for a unit it never saw. Optional so a hand-made context stays small. */
  unitOwner?(id: number): PlayerIndex | undefined;
  /** The faction of a player, from the frame after the step. */
  factionOf?(p: PlayerIndex): FactionId | undefined;
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
    unitOwner: (id) => known.get(id)?.owner,
    factionOf: (p) => after.players[p]?.faction,
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

/** Who a sentence is about: a unit the viewer was shown (by id), or a player. Becomes the line's faction stripe. */
type Subject = { unit: number } | { player: PlayerIndex };

/** One event as one plain sentence (and the tone the log colours it with, the icon it carries and the side it is about). */
export function formatEvent(e: GameEvent, ctx: FormatContext, step = 0): LogLine {
  const factionOfSubject = (who: Subject | undefined): FactionId | null => {
    if (!who) return null;
    const player = 'player' in who ? who.player : who.unit === UNSEEN_UNIT ? undefined : ctx.unitOwner?.(who.unit);
    return player === undefined ? null : ctx.factionOf?.(player) ?? null;
  };
  const line = (text: string, tone: LogTone, who?: Subject): LogLine => ({
    step, text, tone, kind: e.kind, icon: logIconOf(e.kind), faction: factionOfSubject(who),
  });
  const name = (id: number, start = true): string => {
    if (id === UNSEEN_UNIT) return start ? UNSEEN_START : UNSEEN_MID;
    return ctx.unitName(id) ?? (start ? UNSEEN_START : UNSEEN_MID);
  };
  switch (e.kind) {
    case 'moved': {
      const n = Math.max(0, e.path.length - 1);
      const who = { unit: e.unitId };
      return n === 0 ? line(`${name(e.unitId)} holds position`, 'quiet', who) : line(`${name(e.unitId)} moves ${plural(n, 'tile')}`, 'quiet', who);
    }
    case 'ambushed':
      return line(`${name(e.unitId)} is ambushed by ${name(e.by, false)} and stops`, 'alert', { unit: e.unitId });
    case 'dropBlocked':
      return line(`${name(e.transportId)} cannot unload ${name(e.cargoId, false)}: ${name(e.by, false)} blocks the drop`, 'alert', { unit: e.transportId });
    case 'attacked': {
      const hit = `${name(e.attackerId)} hits ${name(e.defenderId, false)}: ${e.damage}%`;
      const who = { unit: e.attackerId };
      if (e.counter > 0) return line(e.counterFirst ? `${hit} (struck first, counter ${e.counter}%)` : `${hit}, counter ${e.counter}%`, 'combat', who);
      return line(hit, 'combat', who);
    }
    case 'destroyed':
      return line(`${ctx.playerName(e.owner)} ${UNIT_TYPES[e.type].name} is destroyed`, 'combat', { player: e.owner });
    case 'captureProgress':
      return line(`${name(e.unitId)} captures ${ctx.terrainName(e.at)}: ${e.remaining} of 20 left`, 'info', { unit: e.unitId });
    case 'captured':
      return line(e.from === null
        ? `${ctx.playerName(e.by)} claims the unowned ${ctx.terrainName(e.at)}`
        : `${ctx.playerName(e.by)} takes the ${ctx.terrainName(e.at)} from ${ctx.playerName(e.from)}`, 'info', { player: e.by });
    case 'loaded':
      return line(`${name(e.unitId)} boards ${name(e.transportId, false)}`, 'info', { unit: e.unitId });
    case 'unloaded':
      return line(`${name(e.unitId)} unloads from ${name(e.transportId, false)}`, 'info', { unit: e.unitId });
    case 'joined':
      return line(`${name(e.unitId)} joins ${name(e.intoId, false)}${e.refund > 0 ? `, refund ${credits(e.refund)}` : ''}`, 'info', { unit: e.unitId });
    case 'supplied':
      return line(`${name(e.byId)} resupplies ${plural(e.unitIds.length, 'unit')}`, 'info', { unit: e.byId });
    case 'built':
      return line(`${ctx.playerName(e.owner)} builds ${article(UNIT_TYPES[e.type].name)} ${UNIT_TYPES[e.type].name}: ${credits(e.cost)}`, 'economy', { player: e.owner });
    case 'powerActivated': {
      const cmd = commanderNameOf(e.commander);
      return line(`${cmd} activates ${powerNameOf(e.commander, e.level)} (${e.level === 'surge' ? 'Surge' : 'Overclock'})`, 'power', { player: e.player });
    }
    case 'powerEffect':
      return line(e.description, 'power', { player: e.player });
    case 'turnEnded':
      return line(`${ctx.playerName(e.player)} ends the turn`, 'quiet', { player: e.player });
    case 'turnStarted': {
      const title = `Cycle ${pad2(e.cycle)}`;
      const detail = `${ctx.playerName(e.player)} turn, income ${credits(e.income)}`;
      return { ...line(`${title}: ${detail}`, 'economy', { player: e.player }), section: { title, detail } };
    }
    case 'repaired':
      return line(`${name(e.unitId)} repairs ${Math.round(e.amount / 10)} HP for ${credits(e.cost)}`, 'economy', { unit: e.unitId });
    case 'crashed':
      return line(`${name(e.unitId)} is lost: out of charge`, 'alert', { unit: e.unitId });
    case 'weather':
      return line(e.weather === 'ionstorm' ? `An ion storm rises${e.turns > 0 ? ` for ${plural(e.turns, 'turn')}` : ''}` : 'The weather clears', 'info');
    case 'playerDefeated':
      return line(`${ctx.playerName(e.player)} is defeated: ${REASONS[e.reason]}`, 'alert', { player: e.player });
    case 'victory':
      return line(`Victory: ${ctx.teamName(e.team)}`, 'alert');
    default:
      return assertNever(e, step);
  }
}

/** Compile-time exhaustiveness: a GameEvent kind without a sentence above makes this call a type error. At run time it fails soft. */
function assertNever(e: never, step: number): LogLine {
  void e;
  return { step, text: 'Something happens', tone: 'quiet', kind: 'unknown', icon: 'info', faction: null };
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
