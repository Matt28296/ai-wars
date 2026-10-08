// M4.0 the four Act I mission maps. Spec: docs/STORY.md "Act I -- Cinder Season" (missions 1-4), docs/delivery/DECISIONS.md D-007.
// All are original and drawn for the story beat they carry, not for symmetry: the player's agent and Rook's detachment (players 0 and 1,
// one team) start on the west, the opposing force (player 2) on the east. Tile legend and MapDef: src/content/types.ts. Rules:
// src/content/map-check.ts. missions.test.ts runs checkMap on every map (mission 1 with requireBases false, since it has no production),
// so a bad edit fails the build. Income is 1000 per property except uplinks (0), docs/research/mechanics.md section 6.
// Rows run y = 0 downward and columns x = 0 rightward; each owners row is the twin of its terrain row ('.' = neutral).
// Player slots on every map: 0 = the player's agent (Helion), 1 = Rook Okafor's Helion detachment, 2 = the opposing force.
import type { MapDef } from './types';

// 12x9. Mission 1, First Light: the border drill. No fabricator, skyport or dock, so nothing can be built; Calder Spire stands at the
// back for the player and four neutral arcologies lie between it and the east road the drones come down.
const firstLight: MapDef = {
  id: 'm1-first-light',
  name: 'Calder Drill Grounds',
  description: 'A small stretch of farmland below Calder Spire, laid out for a border drill, with four arcologies to claim and a ridge to hold.',
  players: 3,
  terrain: [
    '..ff..^^....', // 0
    '.H=..C...f..', // 1
    '..=.f...^..f', // 2
    '..===....C..', // 3
    '....f.^.....', // 4
    '.C......f...', // 5
    '...^..f...^.', // 6
    '..f.....C...', // 7
    '.....f......', // 8
  ],
  owners: [
    '............', // 0
    '.0..........', // 1
    '............', // 2
    '............', // 3
    '............', // 4
    '............', // 5
    '............', // 6
    '............', // 7
    '............', // 8
  ],
  units: [
    { type: 'trooper', owner: 0, x: 2, y: 2 },
    { type: 'trooper', owner: 0, x: 3, y: 3 },
    { type: 'trooper', owner: 0, x: 2, y: 4 },
    { type: 'breacher', owner: 0, x: 3, y: 4 },
    { type: 'trooper', owner: 1, x: 1, y: 6 },
    { type: 'trooper', owner: 1, x: 3, y: 7 },
    { type: 'lancer', owner: 1, x: 2, y: 6 },
    { type: 'skimmer', owner: 2, x: 11, y: 3, hp: 8 },
    { type: 'skimmer', owner: 2, x: 10, y: 5, hp: 8 },
    { type: 'skimmer', owner: 2, x: 11, y: 7, hp: 6 },
  ],
  recommended: { fog: false, weather: 'clear', startFunds: 0 },
};

// 18x12. Mission 2, Calder Spire: Tidewell holds the Spire at (15,5) behind two fabricators. A river at x=8 is crossed by three spans
// (rows 2, 5 and 9), so tread units must use a span while foot and hover units may wade or float. Each Helion column has a
// fabricator and an owned arcology, and eight neutral arcologies lie in reach, so production and income decide the battle.
const calderSpire: MapDef = {
  id: 'm2-calder-spire',
  name: 'Calder Crossing',
  description: 'Two Helion columns face the seized Calder Spire across a river with three spans, and both sides have fabricators and cities to fight over.',
  players: 3,
  terrain: [
    '.....^C.r...C...f.', // 0
    '...F....r...f.....', // 1
    '.H======#======^..', // 2
    '..=..Cf.r.fC^.=F..', // 3
    '.C=ff..^r^....=.C.', // 4
    'f.======#==^.^=H..', // 5
    'f.=ff..^r.....=...', // 6
    '.C=..C..r^.C..=.C.', // 7
    '..=...f.r.f.^.=F..', // 8
    '.H======#======^..', // 9
    '...F....r...f.....', // 10
    '.....^C.r...C...f.', // 11
  ],
  owners: [
    '..................', // 0
    '...0..............', // 1
    '.0................', // 2
    '...............2..', // 3
    '.0..............2.', // 4
    '...............2..', // 5
    '..................', // 6
    '.1..............2.', // 7
    '...............2..', // 8
    '.1................', // 9
    '...1..............', // 10
    '..................', // 11
  ],
  units: [
    { type: 'trooper', owner: 0, x: 3, y: 3 },
    { type: 'trooper', owner: 0, x: 2, y: 4 },
    { type: 'breacher', owner: 0, x: 2, y: 3 },
    { type: 'trooper', owner: 1, x: 3, y: 8 },
    { type: 'trooper', owner: 1, x: 2, y: 7 },
    { type: 'lancer', owner: 1, x: 2, y: 8 },
    { type: 'trooper', owner: 2, x: 14, y: 5 },
    { type: 'trooper', owner: 2, x: 16, y: 5 },
    { type: 'breacher', owner: 2, x: 14, y: 4 },
    { type: 'arc', owner: 2, x: 16, y: 6 },
    { type: 'lancer', owner: 2, x: 14, y: 7 },
  ],
  recommended: { fog: false, weather: 'clear', startFunds: 1000 },
};

// 22x14. Mission 3, Saltglass Bay: the Helion dock at (5,7) and the Tidewell docks at (18,6) and (18,11) face each other across open
// water. Three islet cities (centre, south-west, north-east) are ringed by shoal and fall only to a Barge landing; the Anchorage spire
// at (19,9) sits behind a shoal beach at x=17; the one land route is the long north road on row 1. Arcs start on the west shore.
const saltglassBay: MapDef = {
  id: 'm3-saltglass-bay',
  name: 'Saltglass Anchorage',
  description: 'A bay of shoals and islet cities lies between the Helion coast and the Tidewell Anchorage, with one long road round the north shore.',
  players: 3,
  terrain: [
    '...^...^.C..f.^...^...', // 0
    '.====================.', // 1
    '.=....C....C....C...=.', // 2
    '.=F..f..........f..^=f', // 3
    '.=....ss~~~~~~~~ss.f=f', // 4
    'f=H.^.~~~~~~~sCs~~..=.', // 5
    'f=f...~~~~~~~~s~~~D.=.', // 6
    '.=..^D~~~~sss~~~~~.C=^', // 7
    'f=.C..~~~~sCs~~~~s..=.', // 8
    '.=..^.~~~~sss~~~~s.H=.', // 9
    'f=.C..~~s~~~~~~~~s....', // 10
    '.=H...~sCs~~~~~~~~D.Ff', // 11
    '.=fF..~~s~~~~~~~~~f^..', // 12
    '..^...~~~~~~~~~~~~....', // 13
  ],
  owners: [
    '......................', // 0
    '......................', // 1
    '......................', // 2
    '..0...................', // 3
    '......................', // 4
    '..0...................', // 5
    '..................2...', // 6
    '.....0.............2..', // 7
    '...0..................', // 8
    '...................2..', // 9
    '...1..................', // 10
    '..1...............2.2.', // 11
    '...1..................', // 12
    '......................', // 13
  ],
  units: [
    { type: 'arc', owner: 0, x: 4, y: 6 },
    { type: 'arc', owner: 0, x: 4, y: 8 },
    { type: 'trooper', owner: 0, x: 3, y: 4 },
    { type: 'trooper', owner: 0, x: 3, y: 6 },
    { type: 'picket', owner: 0, x: 7, y: 6 },
    { type: 'barge', owner: 0, x: 6, y: 8 },
    { type: 'trooper', owner: 1, x: 3, y: 9 },
    { type: 'trooper', owner: 1, x: 3, y: 11 },
    { type: 'lancer', owner: 1, x: 4, y: 10 },
    { type: 'arc', owner: 1, x: 4, y: 12 },
    { type: 'picket', owner: 2, x: 15, y: 6 },
    { type: 'picket', owner: 2, x: 15, y: 10 },
    { type: 'dreadnought', owner: 2, x: 14, y: 8 },
    { type: 'barge', owner: 2, x: 16, y: 9 },
    { type: 'trooper', owner: 2, x: 19, y: 10 },
    { type: 'trooper', owner: 2, x: 20, y: 9 },
    { type: 'breacher', owner: 2, x: 19, y: 8 },
  ],
  recommended: { fog: false, weather: 'clear', startFunds: 8000 },
};

// 18x12. Mission 4, Tidebreak: a ridge seawall at x=8 (two gates, rows 5 and 8) shelters the Helion town from a beach at x=10 and a sea
// that fills the east. Dax Halloran's force comes in two ways: Barges and Pickets from the sea, and a column along the north road
// from his headland base (spire at (15,0), docks at (11,2) and (15,2)). Helion's two bases sit behind the wall; the mission is to hold it.
const tidebreak: MapDef = {
  id: 'm4-tidebreak',
  name: 'Tidebreak Seawall',
  description: 'A ridge seawall shelters the Helion harbour town while a Tidewell landing force comes in by sea and along the northern headland.',
  players: 3,
  terrain: [
    'f^.....^.^.ff^.Hf.', // 0
    '...=============..', // 1
    '......f..C.D.F.DCf', // 2
    'f..F.=..^.s~~~~~~~', // 3
    'f.H..=C.^.s~~~~~~~', // 4
    '.....=====s~~~~~~~', // 5
    '.f.f.=C.^.s~~~~~~~', // 6
    '...f.=C.^.s~~~~~~~', // 7
    '.f...=====s~~~~~~~', // 8
    'f.H..=C.^.s~~~~~~~', // 9
    '...F.=..^.s~~~~~~~', // 10
    '^.^.^.....s~~~~~~~', // 11
  ],
  owners: [
    '...............2..', // 0
    '..................', // 1
    '...........2.2.22.', // 2
    '...0..............', // 3
    '..0...0...........', // 4
    '..................', // 5
    '......0...........', // 6
    '......1...........', // 7
    '..................', // 8
    '..1...1...........', // 9
    '...1..............', // 10
    '..................', // 11
  ],
  units: [
    { type: 'trooper', owner: 0, x: 4, y: 4 },
    { type: 'trooper', owner: 0, x: 7, y: 4 },
    { type: 'breacher', owner: 0, x: 7, y: 6 },
    { type: 'arc', owner: 0, x: 5, y: 5 },
    { type: 'trooper', owner: 1, x: 4, y: 9 },
    { type: 'trooper', owner: 1, x: 7, y: 9 },
    { type: 'lancer', owner: 1, x: 7, y: 7 },
    { type: 'arc', owner: 1, x: 5, y: 8 },
    { type: 'barge', owner: 2, x: 12, y: 5 },
    { type: 'barge', owner: 2, x: 12, y: 8 },
    { type: 'picket', owner: 2, x: 13, y: 6 },
    { type: 'picket', owner: 2, x: 13, y: 9 },
    { type: 'trooper', owner: 2, x: 12, y: 1 },
    { type: 'trooper', owner: 2, x: 11, y: 1 },
    { type: 'breacher', owner: 2, x: 10, y: 1 },
    { type: 'arc', owner: 2, x: 14, y: 2 },
  ],
  recommended: { fog: false, weather: 'clear', startFunds: 4000 },
};

/** The four Act I mission maps by id, in mission order. A mission's `mapId` is a key of this table. */
export const MISSION_MAPS: Record<string, MapDef> = {
  'm1-first-light': firstLight,
  'm2-calder-spire': calderSpire,
  'm3-saltglass-bay': saltglassBay,
  'm4-tidebreak': tidebreak,
};
