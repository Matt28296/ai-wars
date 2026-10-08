// Who the battle screen names, from the mission (G15). Pure: a mission in, one SeatPresentation per player out.
//
// The briefing names each side through `sidePerson` (people.ts), and the battle screen has to name the same people the same way, or the
// screens contradict each other: the briefing of mission 1 says "Unmarked drones, no nation named" and the battle used to say "The
// Hollow Choir", Act IV's reveal. So this reads `sidePerson` and only rewords it for the places the watch view has to fit it into:
//   the player's agent    "Your agent" in a panel or the banner, "You" on a button;
//   an ally or an enemy   the commander's name, "Rook" on a button;
//   drones with no flag   "Unmarked drones" / "Unmarked", the nation masked (until the story names it);
//   drones after that     "Hollow Choir drones" / "Choir" with the nation shown.
import { FACTIONS } from '../../data';
import type { Mission, MissionPlayer } from '../../content/types';
import type { SeatPresentation } from '../watch';
import { sidePerson } from './people';
import type { Person } from './people';

/** The first word of a name: "Rook Okafor" is "Rook" on a button and in a log line. A one-word name is itself ("VESPER"). */
const firstWord = (name: string): string => name.trim().split(/\s+/)[0] || name;

/** "Rook's Lancer", "Dax's turn": the form a name takes before a noun in a log sentence. */
const possessive = (word: string): string => `${word}'s`;

export function presentationOf(person: Person, player: MissionPlayer): SeatPresentation {
  switch (person.kind) {
    case 'agent':
      return { name: person.name, label: 'You', nation: 'shown', portrait: 'agent', log: { subject: person.name, owner: 'Your' } };
    case 'unmarked':
      // The briefing's own word for a side nobody has named: its nation is not printed or drawn anywhere on the battle screen.
      return { name: person.name, label: 'Unmarked', nation: 'masked', portrait: 'unmarked', log: { subject: 'Unmarked', owner: 'Unmarked' } };
    case 'drones': {
      const label = FACTIONS[player.faction].short;
      return { name: person.name, label, nation: 'shown', portrait: 'drones', log: { subject: label, owner: label } };
    }
    default: {
      // A named commander, an ally or an enemy (a station or a narrator is a voice of a dialogue, never a side, but would read the same).
      const label = firstWord(person.name);
      return { name: person.name, label, nation: 'shown', portrait: 'commander', log: { subject: label, owner: possessive(label) } };
    }
  }
}

/** One presentation per player of the mission, in player order: what the battle screen may show for each seat. */
export function seatsOfMission(mission: Mission): SeatPresentation[] {
  return mission.players.map((p) => presentationOf(sidePerson(p, mission.act), p));
}
