// The campaign map's model (G9): the four acts, each with its missions as cards. Pure: the screen only draws it.
import { CAMPAIGN_ACTS, MISSIONS } from '../../content/missions';
import type { Mission } from '../../content/types';
import type { FactionId, Objective } from '../../game/aw';
import { sidePerson } from './people';
import type { Person } from './people';

export interface Side {
  /** The player slot in the mission (0 = the agent). */
  slot: number;
  team: number;
  person: Person;
}

/** The players of one team. The first group is always the agent's own team. */
export interface TeamGroup {
  team: number;
  /** True for the agent's team (its allies fight beside it); every other team is hostile. */
  yours: boolean;
  sides: Side[];
}

export interface MissionCard {
  mission: Mission;
  id: string;
  /** 1-based position in the campaign, two digits: "07". */
  number: string;
  title: string;
  location: string;
  summary: string;
  groups: TeamGroup[];
  fogLabel: string;
  weatherLabel: string;
  /** A few words on what wins it, from the objective itself. */
  goal: string;
}

export interface ActColumn {
  act: 1 | 2 | 3 | 4;
  numeral: 'I' | 'II' | 'III' | 'IV';
  title: string;
  tagline: string;
  /** The nation whose sigil and colour mark the act. */
  mark: FactionId;
  /** Act IV is the Hollow Choir's: drawn darker. */
  dark: boolean;
  cards: MissionCard[];
}

export const NUMERALS = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' } as const;
const ACT_MARK: Record<1 | 2 | 3 | 4, FactionId> = { 1: 'helion', 2: 'verdant', 3: 'kestrel', 4: 'choir' };

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export function goalOf(o: Objective): string {
  switch (o.kind) {
    case 'rout': return 'Rout the enemy';
    case 'hq': return 'Seize the Spire';
    case 'survive': return `Hold ${o.cycles} cycles`;
    case 'capture': return `Own ${o.properties} properties`;
  }
}

/** The players of a mission grouped by team: the agent's team first, then the others in order of first appearance. */
export function teamGroups(m: Mission, opts: { onMap?: boolean } = {}): TeamGroup[] {
  const sides: Side[] = m.players.map((p, slot) => ({ slot, team: p.team, person: sidePerson(p, m.act, opts) }));
  const teams: number[] = [];
  for (const s of sides) if (!teams.includes(s.team)) teams.push(s.team);
  const mine = m.players[0].team;
  return teams.map((team) => ({ team, yours: team === mine, sides: sides.filter((s) => s.team === team) }));
}

export const fogLabelOf = (m: Mission): string => (m.fog ? 'Fog of war' : 'Clear sight');
export const weatherLabelOf = (m: Mission): string => (m.weather === 'ionstorm' ? 'Ion storm' : 'Clear skies');

export function cardOf(m: Mission): MissionCard {
  return {
    mission: m, id: m.id, number: pad2(m.order), title: m.title, location: m.location, summary: m.summary,
    groups: teamGroups(m, { onMap: true }), fogLabel: fogLabelOf(m), weatherLabel: weatherLabelOf(m), goal: goalOf(m.objective),
  };
}

export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function campaignModel(): ActColumn[] {
  return CAMPAIGN_ACTS.map((a) => ({
    act: a.act,
    numeral: NUMERALS[a.act],
    title: a.title,
    tagline: a.tagline,
    mark: ACT_MARK[a.act],
    dark: a.act === 4,
    cards: a.missions.map((id) => {
      const m = missionById(id);
      if (!m) throw new Error(`campaign: act ${a.act} lists mission ${id}, which does not exist`);
      return cardOf(m);
    }),
  }));
}
