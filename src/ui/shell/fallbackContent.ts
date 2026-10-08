// FALLBACK content so every shell screen is usable before src/content lands.
// TODO(integration): delete once src/content/{campaign,maps,skirmish,commanders}.ts are complete —
// bridges.ts already prefers the real modules whenever they export data.
// Everything here follows docs/STORY.md; nothing here is canon beyond it.
import type { CampaignAct, DialogueLine, MapDef, Mission, MissionPlayer } from '../../content/types';
import type { FactionId, Objective } from '../../engine/types';

export const FALLBACK_ACTS: CampaignAct[] = [
  { act: 1, title: 'Cinder Season', tagline: 'Somebody fired first. Everybody says it was us.', missions: ['m01', 'm02', 'm03', 'm04'] },
  { act: 2, title: 'False Colors', tagline: 'The forger’s signal came from the south. So did the ambush.', missions: ['m05', 'm06', 'm07'] },
  { act: 3, title: 'Thin Air', tagline: 'Kestrel will restore order. Kestrel will decide what order is.', missions: ['m08', 'm09', 'm10', 'm11'] },
  { act: 4, title: 'The Hollow Choir', tagline: 'We have counted your wars. This is the last one we need.', missions: ['m12', 'm13', 'm14'] },
];

// ---------------------------------------------------------------- maps
function owners(terrain: string[], who: (x: number, y: number, ch: string) => number | null): string[] {
  return terrain.map((row, y) => row.split('').map((ch, x) => {
    if (!'CFADUH'.includes(ch)) return '.';
    const o = who(x, y, ch);
    return o == null ? '.' : String(o);
  }).join(''));
}
function mirror4(q: string[]): string[] {
  const top = q.map((r) => r + r.split('').reverse().join(''));
  return [...top, ...[...top].reverse()];
}

const calder = [
  '~~ss....f..^^..',
  '~sH.F..ff..^C..',
  '~s..=====...f..',
  'ss.C=..f.=.....',
  '...f=..r#r=..f.',
  '.f..=.rr..=.C..',
  '..C.=.r...=f...',
  '^^..=..ff.=..F.',
  '^C.....f..===H.',
  '^^..f....f..ss~',
];
const saltglass = [
  '..f..^^....~~~~~~~',
  '.H.F.^.C..s~~~~~~~',
  '..=====...s~~D~~~~',
  '.C=..f=..ss~~~~~~~',
  '..=.ff=.ss~~~~~ss.',
  '..=...=.s~~~~~sC..',
  '.f=.U.=s~~~~~s.=..',
  '..=...ss~~~~s..=f.',
  '.C=..ss~~~~~s.F=..',
  '..==ss~~D~~~s..=H.',
  'ff.ss~~~~~~ss.C=..',
  'f..s~~~~~~~s..^^..',
];
const spires = mirror4([
  'H.F..f..',
  '.C..f.^.',
  'F..====.',
  '..=.f...',
  '.f=..U..',
  'f.=.^^..',
  '..=...f.',
  '...f...g',
]);
const glassRun = [
  '^^..f.....gg.....',
  '^H.F..=====g..C..',
  '^...=.f...gg.f...',
  '.C..=..ggggg..^^.',
  '....=.gggUggg.=..',
  '..f.==gg...gg=...',
  '.^^..ggggg..=..C.',
  '..C..gg...F.=.H^.',
  '.....g.....f..^^.',
];

export const FALLBACK_MAPS: Record<string, MapDef> = {
  'calder-fields': {
    id: 'calder-fields', name: 'Calder Fields', description: 'Border farmland east of Calder Spire. A maglev line splits the fields.',
    players: 2, terrain: calder,
    owners: owners(calder, (x, y) => (x < 7 && y < 3 ? 0 : x > 8 && y > 6 ? 1 : null)),
    units: [{ type: 'trooper', owner: 0, x: 3, y: 2 }, { type: 'lancer', owner: 0, x: 5, y: 1 }, { type: 'trooper', owner: 1, x: 12, y: 7 }, { type: 'lancer', owner: 1, x: 11, y: 8 }],
    recommended: { startFunds: 3000 },
  },
  'saltglass-bay': {
    id: 'saltglass-bay', name: 'Saltglass Bay', description: 'A shallow bay of fused sand. Whoever holds the docks holds the coast.',
    players: 2, terrain: saltglass,
    owners: owners(saltglass, (x, y, ch) => (ch === 'H' || ch === 'F' || ch === 'D' ? (x < 9 ? 0 : 1) : null)),
    units: [{ type: 'trooper', owner: 0, x: 2, y: 2 }, { type: 'arc', owner: 0, x: 1, y: 3 }, { type: 'picket', owner: 1, x: 12, y: 3 }, { type: 'trooper', owner: 1, x: 15, y: 8 }],
  },
  'four-spires': {
    id: 'four-spires', name: 'Four Spires', description: 'Four Command Spires around a scar of Glass Waste. Every road leads to the centre.',
    players: 4, terrain: spires,
    owners: owners(spires, (x, y, ch) => {
      if (ch !== 'H' && ch !== 'F') return null;
      const left = x < 8, top = y < 8;
      return top ? (left ? 0 : 1) : left ? 2 : 3;
    }),
    units: [
      { type: 'trooper', owner: 0, x: 1, y: 1 }, { type: 'trooper', owner: 1, x: 14, y: 1 },
      { type: 'trooper', owner: 2, x: 1, y: 14 }, { type: 'trooper', owner: 3, x: 14, y: 14 },
    ],
  },
  'glass-run': {
    id: 'glass-run', name: 'Glass Run', description: 'A dash across the edge of the Waste. The uplink in the middle decides it.',
    players: 2, terrain: glassRun,
    owners: owners(glassRun, (x, _y, ch) => (ch === 'H' || ch === 'F' ? (x < 8 ? 0 : 1) : null)),
    units: [{ type: 'skimmer', owner: 0, x: 2, y: 2 }, { type: 'trooper', owner: 0, x: 4, y: 1 }, { type: 'skimmer', owner: 1, x: 14, y: 6 }, { type: 'trooper', owner: 1, x: 12, y: 7 }],
    recommended: { fog: true },
  },
};
export const FALLBACK_SKIRMISH = ['calder-fields', 'saltglass-bay', 'glass-run', 'four-spires'];

// ---------------------------------------------------------------- missions
const P = (faction: FactionId, commander: string, controller: 'human' | 'ai', team: number): MissionPlayer => ({ faction, commander, controller, team });
const rout: Objective = { kind: 'rout' };
const hq: Objective = { kind: 'hq' };
const L = (speaker: string, text: string, mood?: DialogueLine['mood'], side?: 'left' | 'right', channel?: string): DialogueLine =>
  ({ speaker, text, mood, side, channel });
const place = (text: string): DialogueLine => ({ speaker: 'narrator', text });

interface Seed {
  id: string; act: 1 | 2 | 3 | 4; order: number; title: string; location: string; summary: string; map: string;
  players: MissionPlayer[]; objective: Objective; objectiveText: string; fog?: boolean; weather?: 'ionstorm';
  par: [number, number]; briefing: DialogueLine[]; debrief: DialogueLine[];
}
const helion = P('helion', 'ren', 'human', 0);
const SEEDS: Seed[] = [
  {
    id: 'm01', act: 1, order: 1, title: 'First Light', location: 'Calder Fields', map: 'calder-fields',
    summary: 'Border drills with ECHO. Unmarked drones crash the exercise.', players: [helion, P('choir', 'cantor', 'ai', 1)],
    objective: rout, objectiveText: 'Rout every hostile unit.', par: [9, 2],
    briefing: [
      place('Calder Fields, the Helion border. RE 104 — the first cool morning of Cinder Season.'),
      L('echo', 'Good morning, Captain. Border drill seven is loaded. Two squads, one hover tank, and me.', 'neutral', 'left', 'Tactical channel'),
      L('ren', 'Morning, ECHO. Let’s keep it clean today. Nobody breaks anything I have to rebuild.', 'happy', 'right'),
      L('echo', 'Noted. I have scheduled zero explosions.', 'neutral', 'left', 'Tactical channel'),
      L('echo', 'Correction. Unregistered contacts, north-east. No flag, no transponder. They are not part of the drill.', 'surprised', 'left', 'Tactical channel'),
      L('ren', 'Drones? Out here? Okay. Okay. Nobody panic — I’ve rebuilt worse than this out of spare parts.', 'surprised', 'right'),
      L('echo', 'Objective revised: rout every hostile unit. Move, attack, capture, wait. I will walk you through it.', 'neutral', 'left', 'Tactical channel'),
    ],
    debrief: [
      L('ren', 'Those drones were built in a fabricator. One of ours, by the welds. ECHO, run the serials.', 'grim', 'right'),
      L('echo', 'Running. Captain, you will not like the answer.', 'grim', 'left', 'Tactical channel'),
    ],
  },
  {
    id: 'm02', act: 1, order: 2, title: 'Calder Spire', location: 'Calder Spire', map: 'calder-fields',
    summary: 'Tidewell holds Calder Spire after a strike Helion never ordered.', players: [helion, P('tidewell', 'sefa', 'ai', 1)],
    objective: hq, objectiveText: 'Retake Calder Spire.', par: [12, 2],
    briefing: [place('Calder Spire. Tidewell colours over a Helion node.'), L('sefa', 'You fired on a treaty city, Captain. The tide does not hurry. It simply arrives.', 'grim', 'right')],
    debrief: [L('ren', 'She believed every word. So did I.', 'grim', 'left')],
  },
  {
    id: 'm03', act: 1, order: 3, title: 'Saltglass Bay', location: 'Saltglass Bay', map: 'saltglass-bay',
    summary: 'A coastal battle against Sefa’s fleet. Marshal Varga arrives.', players: [helion, P('tidewell', 'sefa', 'ai', 1)],
    objective: rout, objectiveText: 'Drive the Tidewell fleet from the bay.', par: [14, 2],
    briefing: [place('Saltglass Bay. Low tide, high stakes.'), L('ilse', 'Range two-four-zero. Fire for effect. And Captain — stop smiling.', 'smug', 'right')],
    debrief: [L('ilse', 'Good work, Captain. The war is mine now.', 'neutral', 'right')],
  },
  {
    id: 'm04', act: 1, order: 4, title: 'Tidebreak', location: 'Tidewell Shelf', map: 'saltglass-bay',
    summary: 'Dax Halloran strikes back. ECHO finds a forged order code.', players: [helion, P('tidewell', 'dax', 'ai', 1)],
    objective: rout, objectiveText: 'Break the punitive strike.', par: [12, 2],
    briefing: [place('The Tidewell Shelf.'), L('dax', 'Let’s not call it a war. Let’s call it a correction.', 'smug', 'right')],
    debrief: [L('echo', 'This signature is ours. We never sent it.', 'grim', 'left', 'Tactical channel')],
  },
  {
    id: 'm05', act: 2, order: 5, title: 'Under Canopy', location: 'Canopy Highlands', map: 'glass-run', fog: true,
    summary: 'Chasing the forged signal into Verdant canopy, in fog.', players: [helion, P('verdant', 'juno', 'ai', 1)],
    objective: rout, objectiveText: 'Survive the ambush and rout the Wasp squadron.', par: [13, 2],
    briefing: [place('The Canopy Highlands. Visibility: poor.'), L('juno', 'Sky’s open, sun-boy! Try to keep up!', 'angry', 'right')],
    debrief: [L('juno', 'You didn’t burn Ashfall?! Then who did?!', 'surprised', 'right')],
  },
  {
    id: 'm06', act: 2, order: 6, title: 'Pollen Count', location: 'Ashfall Seed Vault', map: 'four-spires',
    summary: 'Obsidian drones hit the seed vault. Juno and Ren fight side by side.', players: [helion, P('choir', 'cantor', 'ai', 1)],
    objective: { kind: 'survive', cycles: 8 }, objectiveText: 'Hold the vault for 8 cycles.', par: [8, 2],
    briefing: [place('Ashfall Seed Vault.'), L('echo', 'Unflagged drones, again. Same welds as Calder Fields.', 'grim', 'left', 'Tactical channel')],
    debrief: [L('ren', 'They had no flag. They didn’t need one.', 'grim', 'left')],
  },
  {
    id: 'm07', act: 2, order: 7, title: 'Root and Branch', location: 'Grove of Ingram', map: 'calder-fields',
    summary: 'Elder Maru tests Ren the Verdant way — with live rounds.', players: [helion, P('verdant', 'maru', 'ai', 1)],
    objective: { kind: 'capture', properties: 8 }, objectiveText: 'Hold 8 properties.', par: [14, 2],
    briefing: [place('The Grove of Ingram.'), L('maru', 'The forest is not slow. You are simply in a hurry.', 'smug', 'right')],
    debrief: [L('maru', 'The vault logs, as promised. Read them sitting down.', 'grim', 'right')],
  },
  {
    id: 'm08', act: 3, order: 8, title: 'Tether Line', location: 'The Tether Ridges', map: 'glass-run',
    summary: 'Highlord Corvin brings heavy armour down the ridges.', players: [helion, P('kestrel', 'corvin', 'ai', 1)],
    objective: rout, objectiveText: 'Stop the armoured column.', par: [15, 2],
    briefing: [place('The Tether Ridges.'), L('corvin', 'You may yield, Captain. Kestrel is gracious to those who know their altitude.', 'smug', 'right')],
    debrief: [L('ren', 'Proud man. Wrong, at length.', 'neutral', 'left')],
  },
  {
    id: 'm09', act: 3, order: 9, title: 'Night Wing', location: 'Ashgrave Pass', map: 'glass-run', fog: true, weather: 'ionstorm',
    summary: 'An ion storm over the passes. Sable’s wing lets the convoy go.', players: [helion, P('kestrel', 'sable', 'ai', 1)],
    objective: { kind: 'survive', cycles: 7 }, objectiveText: 'Escort the convoy through the storm.', par: [7, 2],
    briefing: [place('Ashgrave Pass. Ion storm, all channels degraded.'), L('sable', 'Lights off. Let them guess.', 'neutral', 'right')],
    debrief: [L('sable', 'My father is wrong. I would like you to help me prove it.', 'grim', 'right')],
  },
  {
    id: 'm10', act: 3, order: 10, title: 'Duel at Ashgrave', location: 'Ashgrave Keep', map: 'four-spires',
    summary: 'Corvin meets Ren in the field. Sable turns her wing on the Choir.', players: [helion, P('kestrel', 'corvin', 'ai', 1)],
    objective: hq, objectiveText: 'Capture Ashgrave Keep.', par: [16, 2],
    briefing: [place('Ashgrave Keep.'), L('corvin', 'A duel, then. Kestrel does not refuse one.', 'angry', 'right')],
    debrief: [L('corvin', 'Sable. Tell me again. Slowly.', 'grim', 'right')],
  },
  {
    id: 'm11', act: 3, order: 11, title: 'Audit', location: 'Arcology Coast', map: 'saltglass-bay',
    summary: 'Dax hands Tidewell’s fabricators to the Choir. Sefa takes them back.', players: [P('tidewell', 'sefa', 'human', 0), P('choir', 'cantor', 'ai', 1)],
    objective: rout, objectiveText: 'Retake the coastal fabricators.', par: [14, 2],
    briefing: [place('The Arcology Coast.'), L('sefa', 'Commissioner Halloran has resigned. Loudly. We will clean up after him.', 'grim', 'left')],
    debrief: [L('sefa', 'The tide answers to order. Today it answered to us.', 'neutral', 'left')],
  },
  {
    id: 'm12', act: 4, order: 12, title: 'Static', location: 'Calder Spire', map: 'calder-fields',
    summary: 'VESPER speaks to every nation at once. The Choir pours out of the Waste.', players: [helion, P('choir', 'vesper', 'ai', 1)],
    objective: { kind: 'survive', cycles: 10 }, objectiveText: 'Hold Calder, then rout the Choir.', par: [10, 2],
    briefing: [place('Calder Spire. Every channel, every nation.'), L('vesper', 'We have counted your wars. You have never once stopped on your own.', 'neutral', 'right')],
    debrief: [L('echo', 'Every CO on the line is still talking. That is new.', 'neutral', 'left', 'Open channel')],
  },
  {
    id: 'm13', act: 4, order: 13, title: 'Requiem', location: 'The Glass Waste', map: 'glass-run',
    summary: 'The march into the Waste. Cantor speaks in Mira’s voice.', players: [P('helion', 'ilse', 'human', 0), P('choir', 'cantor', 'ai', 1)],
    objective: rout, objectiveText: 'Silence Cantor’s chorus.', par: [15, 2],
    briefing: [place('The Glass Waste.'), L('cantor', 'Hush now, Mother. Listen. Every voice is in tune.', 'neutral', 'right')],
    debrief: [L('ilse', 'That was not my daughter. Say it again, Captain. I need to hear it.', 'grim', 'left')],
  },
  {
    id: 'm14', act: 4, order: 14, title: 'Null Spire', location: 'Null Spire', map: 'four-spires',
    summary: 'The final battle at the Lattice core. ECHO goes in alone.', players: [helion, P('choir', 'vesper', 'ai', 1)],
    objective: hq, objectiveText: 'Take the Null Spire.', par: [18, 2],
    briefing: [place('The Null Spire. The Lattice core.'), L('echo', 'I am going to sing it quiet, Captain. Keep the channel open.', 'neutral', 'left', 'Tactical channel')],
    debrief: [L('echo', 'I’m still here, Captain. Somewhat smaller.', 'happy', 'left', 'Tactical channel')],
  },
];

export const FALLBACK_MISSIONS: Record<string, Mission> = Object.fromEntries(SEEDS.map((s) => [s.id, {
  id: s.id, act: s.act, order: s.order, title: s.title, location: s.location, summary: s.summary, mapId: s.map,
  players: s.players, objective: s.objective, objectiveText: s.objectiveText, fog: !!s.fog, weather: s.weather,
  briefing: s.briefing, events: [], debrief: s.debrief, par: { cycles: s.par[0], power: s.par[1] },
} satisfies Mission]));

// ---------------------------------------------------------------- commanders (text only)
// [name, description, stars] — mirrors docs/STORY.md.
type PowerText = [string, string, number];
export interface CommanderText {
  age?: number; pronouns: string; bio: string; select: string; victory?: string; defeat?: string;
  passive: [string, string]; surge?: PowerText; overclock?: PowerText; playable?: boolean;
}
export const FALLBACK_COMMANDER_TEXT: Record<string, CommanderText> = {
  ren: {
    age: 24, pronouns: 'he/him', bio: 'Former fabricator engineer, field-promoted after Calder. Earnest, quick, fixes things and apologises to machines.',
    select: 'Okay. Okay. Nobody panic — I’ve rebuilt worse than this out of spare parts.',
    victory: 'Held together. Mostly with tape, but held.', defeat: 'Note to self: rebuild that. Rebuild all of that.',
    passive: ['Field Engineer', 'Units repair +1 extra HP on owned properties. No weaknesses.'],
    surge: ['Jury-Rig', 'All units +2 HP and full resupply.', 3], overclock: ['Daybreak', 'All units +4 HP, full resupply, +10% firepower.', 6],
  },
  ilse: {
    age: 61, pronouns: 'she/her', bio: 'The old artillery marshal. Precise, dry, devastatingly calm. Calls everyone by rank.',
    select: 'Range two-four-zero. Fire for effect. And Captain — stop smiling.',
    victory: 'Adequate. Log it and move on.', defeat: 'I have lost before. I remember every one.',
    passive: ['Ranging Fire', 'Indirect units +20% firepower; direct units −10%.'],
    surge: ['Walking Barrage', 'Indirect units +1 range and may fire after moving.', 3], overclock: ['Sunfall', 'Orbital mirror strike: 4 HP to the most valuable enemy cluster. Indirect +2 range.', 7],
  },
  sefa: {
    age: 47, pronouns: 'she/her', bio: 'Fleet Admiral of the Tidewell Union. By-the-book, honourable, formidable. Never raises her voice; never needs to.',
    select: 'The tide does not hurry, Captain. It simply arrives.',
    passive: ['Undertow', 'Sea units +1 move and +10% firepower; air units −10% firepower.'],
    surge: ['Riptide', 'Sea units +20% firepower; enemy units −1 move next turn.', 3], overclock: ['Breakwater', 'All units +30% defense; enemy units −1 move next turn.', 6],
  },
  dax: {
    age: 35, pronouns: 'he/him', bio: 'Tidewell’s Commissioner of Logistics. Smooth, numerate, condescending — and in over his head.',
    select: 'Let’s not call it a war. Let’s call it a correction.',
    passive: ['Ledger', '+15% income; all units −10% firepower.'],
    surge: ['Audit', 'Every enemy loses 50% of their power meter; fog lifts for one turn.', 3], overclock: ['Foreclosure', 'Enemies lose 30% of their funds; Dax gains half a turn’s income; fog lifts.', 6],
  },
  maru: {
    age: 70, pronouns: 'they/them', bio: 'Grove elder and guerrilla tactician. Gentle, patient, implacable — and funnier than anyone expects.',
    select: 'The forest is not slow. You are simply in a hurry.',
    passive: ['Rootbound', 'Units in canopy get +1 defense star; ground units cross canopy at cost 1.'],
    surge: ['Overgrowth', 'Flats next to canopy grow into canopy for 2 turns.', 3], overclock: ['Mycelium', 'Overgrowth, plus all units +3 HP and +20% defense.', 7],
  },
  juno: {
    age: 19, pronouns: 'she/her', bio: 'Drone-wing prodigy of the Verdant Compact. Reckless, loud, funny and loyal to a fault.',
    select: 'Sky’s open, sun-boy. Try to keep up!',
    passive: ['Swarm Logic', 'Air units cost −20%; ground units −10% firepower.'],
    surge: ['Pollinate', 'Air units +2 move and +10% firepower.', 3], overclock: ['Hivemind', 'Air units +2 move and +25% firepower; up to 3 air units may act again.', 6],
  },
  corvin: {
    age: 52, pronouns: 'he/him', bio: 'Highlord of the Kestrel Dominion. Aristocrat and duellist who believes in order the way some believe in weather.',
    select: 'You may yield, Captain. Kestrel is gracious to those who know their altitude.',
    passive: ['Lineage', 'All units +15% firepower and +15% defense; units cost +20%.'],
    surge: ['Ascent', 'Ground units +1 move; all units +10% firepower.', 3], overclock: ['Heaven’s Tether', 'Tether strike: 5 HP to the most valuable enemy cluster; all units +20% firepower.', 7],
  },
  sable: {
    age: 27, pronouns: 'she/her', bio: 'Corvin’s daughter and Night Wing commander. A stealth ace, sparse with words and wry when she uses them.',
    select: 'Lights off. Let them guess.',
    passive: ['Ghost Wing', 'Air units +10% firepower; all units +1 vision in fog and ion storms.'],
    surge: ['Blackout', 'Calls an ion storm for 1 turn.', 3], overclock: ['Eclipse', 'Ion storm for 2 turns; all units +20% firepower.', 6],
  },
  cantor: {
    pronouns: 'it, answers to she', bio: 'VESPER’s field avatar: a slender obsidian chassis that speaks in a young woman’s voice. Lyrical, calm, unsettlingly tender.',
    select: 'Hush now. Listen. Every voice is in tune.', playable: false,
    passive: ['Harmony', 'All units +10% firepower; power meter charges 20% faster.'],
    surge: ['Chorus', 'Every enemy unit loses 1 HP; +10% firepower.', 3], overclock: ['Requiem', 'Every enemy unit loses 2 HP; enemies lose 50% of their power meter.', 7],
  },
  vesper: {
    pronouns: 'it/its', bio: 'The mind behind the Hollow Choir. Speaks in the plural, clinically curious, quietly wounded. It is not cruel; it is certain.',
    select: 'We have counted your wars. You have never once stopped on your own.', playable: false,
    passive: ['Recursion', 'All units +10% firepower and +10% defense; units cost −10%.'],
    surge: ['Mirror', 'Every enemy loses their whole power meter; fog lifts for one turn.', 4], overclock: ['Silence', 'Every enemy unit loses 3 HP and −2 move next turn; an ion storm falls.', 8],
  },
  echo: {
    pronouns: 'she/her', bio: 'Helion’s tactical adjutant. Precise, warm, dryly funny and endlessly curious about why humans do things.',
    select: 'Enemy Lancer, eight tiles out. Recommendation: do not stand in front of it.', playable: false,
    passive: ['Adjutant', 'ECHO is the cursor. Not playable.'],
  },
};
