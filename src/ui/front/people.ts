// Who is who on the front door's screens (G9). Pure: ids in, display facts out.
//
// A dialogue line names a speaker: a commander id ('rook'), 'narrator', or the name of a place or a voice ('Calder Watch', 'Tether
// Control'). A mission side names a commander id too, but also 'agent' (the player's own agent, D-007) and 'none' (drones with no
// commander). Act I never names the Choir (STORY.md, missions.ts header), so its drones are shown as UNMARKED there, with no nation.
import { COMMANDERS } from '../../content/commanders';
import type { Mission, MissionPlayer } from '../../content/types';
import { FACTIONS } from '../../data';
import type { FactionId } from '../../game/aw';
import { hasPortrait } from '../portraits';

export type PersonKind = 'commander' | 'agent' | 'station' | 'narrator' | 'unmarked' | 'drones';

export interface Person {
  kind: PersonKind;
  name: string;
  /** Up to two letters for the monogram frame, when there is no portrait. */
  initials: string;
  /** The nation the person's frame and name are drawn in; null = ECHO, the interface, or nobody. */
  faction: FactionId | null;
  /** Set only when src/ui/portraits has a bust for this person. */
  portraitId?: string;
  /** A short line under the name on a card: the commander's rank and post, or what the side is. */
  role: string;
}

const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

/** Who speaks a dialogue line. */
export function speakerOf(speaker: string): Person {
  if (speaker === 'narrator') return { kind: 'narrator', name: 'Narration', initials: '', faction: null, role: '' };
  const def = Object.prototype.hasOwnProperty.call(COMMANDERS, speaker) ? COMMANDERS[speaker] : undefined;
  if (def) {
    return {
      kind: 'commander', name: def.name, initials: def.initials, faction: def.faction,
      ...(hasPortrait(def.id) ? { portraitId: def.id } : {}), role: def.title,
    };
  }
  return { kind: 'station', name: speaker, initials: initialsOf(speaker), faction: null, role: 'Radio' };
}

/**
 * Who a mission side is, for the campaign map and the objective card. `act` decides whether the Choir may be named yet.
 * `onMap`: the campaign map shows every act at once (there is no progress yet), so the Choir's voices (Cantor, VESPER) are a
 * withheld signal there; their names are the story's late reveals (missions.test.ts SPOILERS). Opening a mission's briefing, the
 * player's own choice, shows them.
 */
export function sidePerson(p: MissionPlayer, act: Mission['act'], opts: { onMap?: boolean } = {}): Person {
  if (p.commander === 'agent') return { kind: 'agent', name: 'Your agent', initials: 'CO', faction: p.faction, role: 'Commanding Officer' };
  const def = Object.prototype.hasOwnProperty.call(COMMANDERS, p.commander) ? COMMANDERS[p.commander] : undefined;
  if (def && opts.onMap && def.faction === 'choir') {
    return { kind: 'unmarked', name: 'Unknown signal', initials: '??', faction: null, role: 'Identity withheld' };
  }
  if (def) {
    return {
      kind: 'commander', name: def.name, initials: def.initials, faction: def.faction ?? p.faction,
      ...(hasPortrait(def.id) ? { portraitId: def.id } : {}), role: def.title,
    };
  }
  // No commander: drones. Until Act II nobody has named whose.
  if (p.faction === 'choir' && act === 1) return { kind: 'unmarked', name: 'Unmarked drones', initials: '??', faction: null, role: 'Unknown force' };
  return { kind: 'drones', name: `${FACTIONS[p.faction].name.replace(/^The /, '')} drones`, initials: 'DR', faction: p.faction, role: 'No commander' };
}
