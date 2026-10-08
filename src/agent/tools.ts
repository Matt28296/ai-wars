// The tools (A1): what a connected agent can ask of its match, as plain functions from a session to structured data.
//
// D-005: every input is an enum, an integer or an id pattern; there is no free-text input. Every output is game data in a fixed shape.
// Nothing a person typed is in any output, and the mission's story lines (briefing, events, debrief, summary, objective text) are left
// out: a later act's summary names reveals. D-016: the only sources of game data here are the host's observation(), legal(), act() and
// endTurn(), which are the engine's fog-honest doors (observe, agentActions, viewEvents). This file never sees the true state.
import { z } from 'zod';
import { MISSIONS } from '../content/missions';
import type { Mission } from '../content/types';
import { TERRAIN_CODES, UNIT_LIST } from '../data';
import { DAMAGE } from '../data/damage';
import { CAPTURE_POINTS, displayHp } from '../game/aw';
import type { UnitTypeId } from '../game/aw';
import type { Observation, ObservedUnit } from '../game/aw/observe';
import type { Feed } from './feed';
import { AgentMatch } from './match';
import type { LegalEntry, LegalKind, MatchHost } from './match';

// ---------------------------------------------------------------- the input schemas (D-005)

/** The campaign's mission ids, in campaign order. */
export const MISSION_IDS = MISSIONS.map((m) => m.id) as [string, ...string[]];

/** An action id is an actionKey: letters, digits and `: > , @ + [ ]` only (for example `move:12>5,3:attack@6,3` or `build:3,4:lancer`). */
export const ACTION_ID_PATTERN = /^[A-Za-z0-9:>,@+[\]]{1,160}$/;

export const LEGAL_KINDS = ['wait', 'attack', 'capture', 'load', 'join', 'supply', 'unload', 'build', 'power'] as const satisfies readonly LegalKind[];

/** The unit type ids, in the data's order. */
export const UNIT_TYPE_IDS = UNIT_LIST.map((u) => u.id) as [UnitTypeId, ...UnitTypeId[]];

export const unitInfoInput = z.strictObject({
  type: z.enum(UNIT_TYPE_IDS).optional().describe('Only this unit type. Omit it for all of them.'),
});
export const startMissionInput = z.strictObject({
  mission: z.enum(MISSION_IDS).describe('A mission id from list_missions.'),
});
export const legalActionsInput = z.strictObject({
  unit: z.int().min(1).max(100000).optional().describe('Only the actions of this one unit of yours (its id from observe).'),
  kind: z.enum(LEGAL_KINDS).optional().describe('Only actions of this kind.'),
});
export const actInput = z.strictObject({
  action_id: z.string().regex(ACTION_ID_PATTERN).describe('An id copied exactly from the current legal_actions list.'),
});

// ---------------------------------------------------------------- the descriptions (written for the agent that reads them)

export const SERVER_INSTRUCTIONS =
  'You command one side in Ascendant Wars, a turn-based tactics game. Start with list_missions and start_mission (unit_info gives the unit stats). Each turn: observe, then legal_actions, then act '
  + 'with one id at a time, then end_turn. Follow get_orders. You only ever see what your side sees. After start_mission, give your person the live.watch link: '
  + 'it opens the battle in their browser.';

export const DESCRIPTIONS = {
  list_missions:
    'Lists the campaign missions you can play: id, act, order and title. No story text. Pick an id and call start_mission.',
  start_mission:
    'Starts a campaign mission, or restarts the match, with you commanding seat 0 (your side). Every other seat is played by the built-in Doctrine rules, '
    + 'which take their turns when you call end_turn. Returns your seat and team, the map size, the cycle cap (the match ends undecided when it is passed), '
    + 'and live, the addresses on this machine where a person can watch the battle (a running match shows only your own view there; the whole record is served when it is over). '
    + 'Give your person live.watch: it opens the battle in their browser. Call observe next.',
  unit_info:
    'Returns the static table of unit types, public game data that never changes: for each type its name, role, domain (ground, air or sea), cost, move (movement points) and '
    + 'moveType, vision (tiles), range = [min, max] (min above 1 means indirect fire that cannot hit adjacent tiles; null = no attack), ammo (null = no primary weapon), fuel '
    + '(what a fresh unit carries; the engine calls it charge), drain (fuel burned each of your turns by air and sea units), captures (true = can capture), carries (cargo capacity) '
    + 'and supplies (true = resupplies neighbours), and primary and secondary = base damage in percent of a full-HP defender, by target type (a target not listed cannot be hit '
    + 'by that weapon; primary uses ammo, secondary does not and is used when the primary cannot hit). Pass a type to get just one unit. Works before start_mission.',
  observe:
    'Returns what your side can see right now, and nothing else. Fields: seat and team (yours); mission; cycle and cycleCap; turn (the seat to move) and yourTurn; '
    + 'weather; fogActive; objective (kind rout, hq, survive or capture, with its number); width and height; terrain (one string per row, one character per tile; '
    + 'legend maps each character to a terrain id); owners (same shape: the digit of the seat that owns that property, else "."); seen (only under fog: "1" where '
    + 'a unit standing there would be seen, else "0"); capturing (tiles with capture progress: x, y, left = points remaining of 20); players (seat, team, faction, '
    + 'commander, funds, power = the power meter in points, powerState, defeated); you (your funds, power, powerState and the meter cost of surge and overclock, '
    + 'null if your commander has none); units you can see (id, type, owner seat, x, y, hp 1-10; your side\'s units also fuel, ammo, acted and cargo; an enemy '
    + 'transport shows loaded true or false and never what it carries); result (null while the match is on).',
  legal_actions:
    'Lists every action you can take now, as ids, grouped by unit (unit, type, from = [x, y] where it stands). Each action has an id (pass it to act), a kind (wait, attack, capture, load, join, supply or '
    + 'unload), to = [x, y] where the unit ends its move (its own tile means it stays), target = {unit, at} for an attack, with = the friendly unit you load into '
    + 'or join, and drops = [{cargo, unit, to}] for an unload. builds lists what you can buy (id, at = [x, y] of the property, type, cost). powers lists a surge or '
    + 'overclock you can use now. A unit that has acted has no actions. Ending your turn is the end_turn tool, not an action. The list can be long: filter with unit '
    + '(one unit id) or kind. The same list is checked again when you act.',
  act:
    'Applies exactly one action, by the id it has in the current legal_actions list. Returns ok, the events your side may see (what you did, and anything it '
    + 'caused), and your status. It is refused, and nothing happens, when the match is over (game-over), it is not your seat\'s turn (not-your-turn), or the id is '
    + 'not in the current legal list (unknown-action; ids change as units act, so call legal_actions again). Each unit acts once per turn.',
  end_turn:
    'Ends your turn. The other seats then play, one after another, until it is your turn again or the match ends. Returns the events your side saw during their '
    + 'turns, in order, and your new status. Units you did not use stay where they are. Call it when you have nothing more worth doing.',
  get_orders:
    'Returns your standing orders exactly as validated, whatever their shape. Army-wide fields: posture (advance, holdTheLine or fallBack), retreatAtHp (0-9, the display HP at or below '
    + 'which a unit falls back to repair; 0 never retreats), powerPolicy (whenReady, saveForOverclock or defensive), composition (build weights 0-10 for infantry, vehicles, indirect, air '
    + 'and naval) and targetPriority (what to attack first, first = most wanted). When present, groups refines them per kind of unit (keys infantry, armour, artillery, air, navy, '
    + 'transports) and types per unit type; an entry may hold posture, retreatAtHp, targetPriority and mission (infantry: capture, fight, guardBase; armour and navy: frontline, escort, '
    + 'guardBase; artillery: support, guardBase; air: strike, escort, scout, guardBase; transports: ferry, stayBack). A field missing from a unit type\'s entry falls back to its group\'s, '
    + 'then to the army-wide field. Your human sets them and you should follow them. Read-only.',
} as const;

// ---------------------------------------------------------------- results

export interface ToolResult {
  data: Record<string, unknown>;
  isError: boolean;
}
const ok = (data: Record<string, unknown>): ToolResult => ({ data: { ok: true, ...data }, isError: false });
const fail = (reason: string, message: string): ToolResult => ({ data: { ok: false, reason, message }, isError: true });

type XY = [number, number];
const xy = (c: { x: number; y: number }): XY => [c.x, c.y];

// ---------------------------------------------------------------- the session

export interface SessionOptions {
  /** The live feed to announce the match to. Optional: with none, start_mission returns live: null. */
  feed?: Feed | null;
  /** Builds the match for a mission. Default: a real AgentMatch. Tests substitute their own. */
  makeHost?: (mission: Mission) => MatchHost;
  /** One line to stderr (never stdout: stdout is the protocol). */
  log?: (line: string) => void;
  /** A fresh luck seed for each match the default host builds (the real server's is random; see MatchOptions.seed). Default: none (the Deploy seed). */
  seed?: () => number;
}

/** One match per server process: start_mission replaces it. */
export class AgentSession {
  private host: MatchHost | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly feed: Feed | null;
  private readonly makeHost: (mission: Mission) => MatchHost;
  private readonly log: (line: string) => void;

  constructor(opts: SessionOptions = {}) {
    this.feed = opts.feed ?? null;
    this.log = opts.log ?? (() => {});
    const seed = opts.seed;
    this.makeHost = opts.makeHost ?? ((mission) => new AgentMatch(mission, {
      onSubscriberError: (err) => this.log(`live feed error: ${String(err)}`),
      ...(seed ? { seed: seed() } : {}),
    }));
  }

  /** The running match, if any. For tests and the feed wiring. */
  current(): MatchHost | null {
    return this.host;
  }

  listMissions(): ToolResult {
    return ok({ missions: MISSIONS.map((m) => ({ id: m.id, act: m.act, order: m.order, title: m.title })) });
  }

  startMission(missionId: string): ToolResult {
    const mission = MISSIONS.find((m) => m.id === missionId);
    if (!mission) return fail('unknown-mission', 'No such mission. Call list_missions.');
    this.unsubscribe?.();
    this.unsubscribe = null;
    const host = this.makeHost(mission);
    this.host = host;
    const feed = this.feed;
    if (feed) {
      // While the match runs the feed gets only the agent's own view (D-016): the latest step now, each step as it is taken, and the whole
      // record only when the host says the match is over.
      feed.begin({ mission: mission.id, seat: host.seat, cycleCap: host.cap }, host.latestStep());
      this.unsubscribe = host.subscribe((e) => {
        try {
          if (e.type === 'step') feed.step(e.step);
          else if (e.type === 'result') feed.finish(e.result, host.record());
        } catch (err) {
          this.log(`live feed error: ${String(err)}`);
        }
      });
    }
    this.log(`mission ${mission.id} started`);
    const o = host.observation();
    return ok({
      mission: mission.id,
      title: mission.title,
      seat: host.seat,
      team: o.players[host.seat]?.team ?? null,
      map: { width: o.width, height: o.height },
      cycleCap: host.cap,
      yourTurn: o.current === host.seat,
      // `watch` is the one link a person opens (the game's page, served by this same port); `events` and `record` are the feed it reads.
      live: feed ? { watch: feed.watchUrl, events: feed.liveUrl, record: feed.recordUrl } : null,
    });
  }

  /** Static game data: works with no match running. */
  unitInfo(type?: UnitTypeId): ToolResult {
    return ok(unitInfoOut(type));
  }

  observe(): ToolResult {
    const host = this.host;
    if (!host) return noMatch();
    return ok(observationOut(host));
  }

  legalActions(filter: { unit?: number; kind?: LegalKind } = {}): ToolResult {
    const host = this.host;
    if (!host) return noMatch();
    return ok(legalOut(host, filter));
  }

  act(actionId: string): ToolResult {
    const host = this.host;
    if (!host) return noMatch();
    const r = host.act(actionId);
    if (!r.ok) return fail(r.reason, r.message);
    return ok({ done: r.id, events: r.events, status: statusOut(host) });
  }

  endTurn(): ToolResult {
    const host = this.host;
    if (!host) return noMatch();
    const r = host.endTurn();
    if (!r.ok) return fail(r.reason, r.message);
    return ok({ events: r.events, status: statusOut(host) });
  }

  getOrders(): ToolResult {
    const host = this.host;
    if (!host) return noMatch();
    return ok({
      orders: host.orders(),
      note: 'Your human sets these standing orders; follow them. groups and types, when present, refine the army-wide fields for a kind of unit or a unit type.',
    });
  }
}

const noMatch = (): ToolResult => fail('no-match', 'No mission is running. Call list_missions, then start_mission.');

// ---------------------------------------------------------------- unit_info

/** The static unit table (src/data), compact: one object per type. No hidden state is involved. */
export function unitInfoOut(type?: UnitTypeId): Record<string, unknown> {
  const units = UNIT_LIST.filter((u) => type === undefined || u.id === type).map((u) => {
    const row = DAMAGE[u.id] ?? {};
    const out: Record<string, unknown> = {
      type: u.id, name: u.name, role: u.role, domain: u.domain, cost: u.cost, move: u.move, moveType: u.moveType, vision: u.vision,
      range: u.range ? [u.range[0], u.range[1]] : null, ammo: u.ammo, fuel: u.charge,
    };
    if (u.drain !== undefined) out.drain = u.drain;
    if (u.captures) out.captures = true;
    if (u.carries !== undefined) out.carries = u.carries;
    if (u.supplies) out.supplies = true;
    if (row.primary) out.primary = { ...row.primary };
    if (row.secondary) out.secondary = { ...row.secondary };
    return out;
  });
  return { units };
}

// ---------------------------------------------------------------- observation

const TERRAIN_CHAR: Record<string, string> = Object.fromEntries(Object.entries(TERRAIN_CODES).map(([ch, id]) => [id, ch]));
const LEGEND: Record<string, string> = { ...TERRAIN_CODES };

function unitOut(u: ObservedUnit, mine: boolean): Record<string, unknown> {
  const base = { id: u.id, type: u.type, owner: u.owner, x: u.x, y: u.y, hp: displayHp(u.hp) };
  if (!mine) return { ...base, loaded: u.loaded };
  return {
    ...base, fuel: u.charge, ammo: u.ammo, acted: u.acted,
    cargo: u.cargo.map((c) => ({ id: c.id, type: c.type, hp: displayHp(c.hp) })),
  };
}

/** The observe tool's data, built only from host.observation(). */
export function observationOut(host: MatchHost): Record<string, unknown> {
  const o: Observation = host.observation();
  const seat = host.seat;
  const myTeam = o.players[seat].team;
  const teamOfSeat = (p: number): number => o.players[p]?.team ?? -1;
  const costs = host.powerCosts();
  const me = o.players[seat];
  const capturing: { x: number; y: number; left: number }[] = [];
  o.tiles.forEach((row, y) => row.forEach((t, x) => {
    if (t.capture !== undefined && t.capture < CAPTURE_POINTS) capturing.push({ x, y, left: t.capture });
  }));
  const out: Record<string, unknown> = {
    seat, team: myTeam, mission: host.mission.id,
    cycle: o.cycle, cycleCap: host.cap, turn: o.current, yourTurn: o.current === seat,
    weather: o.weather, fogActive: !!o.fogActive,
    objective: o.objective,
    width: o.width, height: o.height,
    terrain: o.tiles.map((row) => row.map((t) => TERRAIN_CHAR[t.terrain] ?? '?').join('')),
    legend: LEGEND,
    owners: o.tiles.map((row) => row.map((t) => (t.owner === null ? '.' : String(t.owner))).join('')),
  };
  if (o.fogActive && o.visible) out.seen = o.visible.map((row) => row.map((v) => (v ? '1' : '0')).join(''));
  if (o.deadline) out.deadline = o.deadline;
  if (o.turnLimit !== undefined) out.turnLimit = o.turnLimit;
  out.capturing = capturing;
  out.players = o.players.map((p) => ({
    seat: p.index, team: p.team, faction: p.faction, commander: p.commander,
    funds: p.funds, power: p.power, powerState: p.powerState, defeated: p.defeated,
  }));
  out.you = { funds: me.funds, power: me.power, powerState: me.powerState, surgeCost: costs.surge, overclockCost: costs.overclock };
  out.units = o.units.map((u) => unitOut(u, teamOfSeat(u.owner) === myTeam));
  out.result = host.result();
  return out;
}

/** The short summary every act and end_turn answer carries. Built from the observation, so it counts only what the agent can see. */
export function statusOut(host: MatchHost): Record<string, unknown> {
  const o = host.observation();
  const seat = host.seat;
  const myTeam = o.players[seat].team;
  const me = o.players[seat];
  return {
    cycle: o.cycle, turn: o.current, yourTurn: o.current === seat,
    funds: me.funds, power: me.power, powerState: me.powerState,
    myUnits: o.units.filter((u) => u.owner === seat).length,
    visibleEnemies: o.units.filter((u) => (o.players[u.owner]?.team ?? -1) !== myTeam).length,
    result: host.result(),
  };
}

// ---------------------------------------------------------------- legal actions

function actionOut(e: LegalEntry): Record<string, unknown> {
  const out: Record<string, unknown> = { id: e.id, kind: e.kind };
  if (e.to) out.to = xy(e.to);
  if (e.target) out.target = { unit: e.target.unit, at: xy(e.target) };
  if (e.withUnit !== undefined) out.with = e.withUnit;
  if (e.drops) out.drops = e.drops.map((d) => ({ cargo: d.cargo, unit: d.unit, to: xy(d.to) }));
  return out;
}

/** The legal_actions tool's data, built only from host.legal() and host.observation(). */
export function legalOut(host: MatchHost, filter: { unit?: number; kind?: LegalKind } = {}): Record<string, unknown> {
  const all = host.legal();
  const o = host.observation();
  const picked = all.filter((e) => (filter.kind === undefined || e.kind === filter.kind) && (filter.unit === undefined || e.unit === filter.unit));
  const byUnit = new Map<number, LegalEntry[]>();
  const builds: Record<string, unknown>[] = [];
  const powers: Record<string, unknown>[] = [];
  for (const e of picked) {
    if (e.kind === 'build') builds.push({ id: e.id, kind: 'build', at: xy(e.to!), type: e.unitType, cost: e.cost ?? null });
    else if (e.kind === 'power') powers.push({ id: e.id, kind: 'power', level: e.level });
    else {
      const list = byUnit.get(e.unit!) ?? [];
      list.push(e);
      byUnit.set(e.unit!, list);
    }
  }
  const units = [...byUnit.entries()].map(([id, list]) => {
    const u = o.units.find((x) => x.id === id);
    return { unit: id, type: u?.type ?? null, from: xy(list[0].from!), actions: list.map(actionOut) };
  });
  return {
    yourTurn: o.current === host.seat,
    total: all.length,
    count: picked.length,
    units, builds, powers,
  };
}
