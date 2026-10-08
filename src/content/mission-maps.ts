// M4.0 the four Act I mission maps and M4.1 the three Act II maps. Spec: docs/STORY.md "Act I -- Cinder Season" (missions 1-4) and "Act II --
// False Colors" (missions 5-7), docs/delivery/DECISIONS.md D-007.
// All are original and drawn for the story beat they carry, not for symmetry: the player's agent and Rook's detachment (players 0 and 1,
// one team) start on the west, the opposing force (player 2) on the east. Mission 6 adds Wing Lead Juno Reyes-Abara as a fourth player, an
// ally on team 0 in slot 3, so that "player 2 is the opposing force" holds on every map. Tile legend and MapDef: src/content/types.ts. Rules:
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

// 20x14. Mission 5, Under Canopy (fog on): the Helion zone is open ground on the west; east of x=4 the weald is canopy (about half the map), cut
// by glades with a neutral arcology each, a short maglev road (row 6) and two ridge lookouts (foot units see +3 on a ridge). Juno's relay spire
// stands at (16,6) in a grove behind the central glade, with her fabricator at (18,3) and skyport at (18,10). Her Wasps start in the open sky
// out of sight, and two Troopers wait under canopy beside the road, so a column that does not scout is ambushed.
const underCanopy: MapDef = {
  id: 'm5-under-canopy',
  name: 'Sunless Weald',
  description: 'A weald of dense canopy, glades and two ridge lookouts, with a Verdant relay spire at its heart and open Helion ground behind.',
  players: 3,
  terrain: [
    '...f.fffffffffffffff', // 0
    'f.......ffffffffffff', // 1
    '..F...C.ffff...ff...', // 2
    '....f...f^ff.C.ff.F.', // 3
    '.H...fff^^ff...ff...', // 4
    '.....ffff...fff...ff', // 5
    'f...=====.C.....H.ff', // 6
    '....fffff...fff...ff', // 7
    '.f...fffffffffffffff', // 8
    '.H...fff^^ff...ff...', // 9
    '........f^ff.C.ff.A.', // 10
    '..F...C.ffff...ff...', // 11
    '....f...ffffffffffff', // 12
    '..f..fffffffffffffff', // 13
  ],
  owners: [
    '....................', // 0
    '....................', // 1
    '..0.................', // 2
    '..................2.', // 3
    '.0..................', // 4
    '....................', // 5
    '................2...', // 6
    '....................', // 7
    '....................', // 8
    '.1..................', // 9
    '..................2.', // 10
    '..1.................', // 11
    '....................', // 12
    '....................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 3, y: 4 },
    { type: 'trooper', owner: 0, x: 2, y: 5 },
    { type: 'breacher', owner: 0, x: 3, y: 3 },
    { type: 'skimmer', owner: 0, x: 3, y: 5 },
    { type: 'trooper', owner: 1, x: 3, y: 8 },
    { type: 'trooper', owner: 1, x: 2, y: 7 },
    { type: 'breacher', owner: 1, x: 3, y: 9 },
    { type: 'warden', owner: 1, x: 4, y: 8 },
    { type: 'wasp', owner: 2, x: 12, y: 3 },
    { type: 'wasp', owner: 2, x: 12, y: 10 },
    { type: 'wasp', owner: 2, x: 14, y: 7 },
    { type: 'trooper', owner: 2, x: 9, y: 8 },
    { type: 'trooper', owner: 2, x: 8, y: 5 },
    { type: 'skimmer', owner: 2, x: 13, y: 6 },
  ],
  recommended: { fog: true, weather: 'clear', startFunds: 2000 },
};

// 22x14, FOUR players. Mission 6, Pollen Count: the Ashfall seed vault compound on the west is shared by the agent (spire (2,3)), Rook (spire
// (2,10)) and Juno (the vault hall, spire (4,6), with her skyport at (6,5)); a ridge wall at x=10-11 with a maglev gate (row 6) and open passes
// (rows 2 and 11) shelters it from the east, where the Choir's drones hold a seized relay spire at (19,6) with a fabricator and a skyport.
// checkMap wants every slot to own one spire and a fabricator, so the drones hold a spire and a fabricator at the east treeline; taking that
// spire would rout them and end the mission early, and it sits behind their starting wing. Slot 2 is the opposing force, slot 3 is Juno (team 0).
const pollenCount: MapDef = {
  id: 'm6-pollen-count',
  name: 'Ashfall Seed Vault',
  description: 'A seed vault compound behind a ridge wall with one gate, facing a seized relay spire where unmarked drones gather.',
  players: 4,
  terrain: [
    'ff.....ff.^^.....f....', // 0
    'f.....f...^^.ff......f', // 1
    '....F...C......f......', // 2
    '..H.......^^....fF....', // 3
    '.........f^^.Cf.......', // 4
    '......A.f.^^f.....f...', // 5
    '..C.H===========C=.H..', // 6
    '......F...^^f.....f...', // 7
    '........f.^^..f.......', // 8
    '.........f^^.C........', // 9
    '..H.......^^....f...A.', // 10
    '....F...C......f......', // 11
    'f......f..^^.ff......f', // 12
    'ff.....ff.^^.....f....', // 13
  ],
  owners: [
    '......................', // 0
    '......................', // 1
    '....0.................', // 2
    '..0..............2....', // 3
    '......................', // 4
    '......3...............', // 5
    '..3.3..............2..', // 6
    '......3...............', // 7
    '......................', // 8
    '......................', // 9
    '..1.................2.', // 10
    '....1.................', // 11
    '......................', // 12
    '......................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 3, y: 4 },
    { type: 'trooper', owner: 0, x: 4, y: 4 },
    { type: 'breacher', owner: 0, x: 5, y: 3 },
    { type: 'warden', owner: 0, x: 5, y: 4 },
    { type: 'trooper', owner: 1, x: 3, y: 9 },
    { type: 'trooper', owner: 1, x: 4, y: 9 },
    { type: 'lancer', owner: 1, x: 5, y: 10 },
    { type: 'warden', owner: 1, x: 5, y: 9 },
    { type: 'wasp', owner: 2, x: 16, y: 4 },
    { type: 'wasp', owner: 2, x: 16, y: 8 },
    { type: 'wasp', owner: 2, x: 17, y: 6 },
    { type: 'skimmer', owner: 2, x: 15, y: 5 },
    { type: 'skimmer', owner: 2, x: 15, y: 7 },
    { type: 'skimmer', owner: 2, x: 18, y: 6 },
    { type: 'wasp', owner: 3, x: 7, y: 6 },
    { type: 'wasp', owner: 3, x: 8, y: 4 },
    { type: 'wasp', owner: 3, x: 8, y: 8 },
    { type: 'skimmer', owner: 3, x: 7, y: 3 },
  ],
  recommended: { fog: false, weather: 'clear', startFunds: 3000 },
};

// 22x14. Mission 7, Root and Branch: a grove of canopy (a third of the map) opened by glades, each with a property in it; flats beside canopy
// are what Maru's Overgrowth turns to canopy. Seventeen properties: two each for the agent (spire (1,3)) and Rook (spire (1,10)), three for
// Maru (spire (20,6), fabricator (19,2), arcology (19,10)) and ten neutral, among them an uplink at (11,7), a skyport at (16,6) and a
// fabricator at (15,12). Two ridge mounds in the middle give the lookouts; a short maglev road leads out of the Helion zone.
const rootAndBranch: MapDef = {
  id: 'm7-root-and-branch',
  name: 'The Elder Grove',
  description: 'A grove of canopy and glades between two Helion bases and the Elder\'s root-house, with seventeen properties to hold.',
  players: 3,
  terrain: [
    'f...ffffffffffffffffff', // 0
    '.....fffff...ffff...ff', // 1
    '...F....ff.C.ffff..Fff', // 2
    '.H....C.........f...ff', // 3
    '..........^f..C...ffff', // 4
    'f....fff.^^ff...ff....', // 5
    '...f=====C....f.A...H.', // 6
    'f..f.fff...U..........', // 7
    '.....fff.^^ff...ff....', // 8
    '..........^f..C......f', // 9
    '.H....C.f.......ff.C.f', // 10
    '...F....ff.C.f...f...f', // 11
    '.....fffff...f.F.fffff', // 12
    'f...ffffffffff...fffff', // 13
  ],
  owners: [
    '......................', // 0
    '......................', // 1
    '...0...............2..', // 2
    '.0....................', // 3
    '......................', // 4
    '......................', // 5
    '....................2.', // 6
    '......................', // 7
    '......................', // 8
    '......................', // 9
    '.1.................2..', // 10
    '...1..................', // 11
    '......................', // 12
    '......................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 3, y: 4 },
    { type: 'trooper', owner: 0, x: 2, y: 5 },
    { type: 'trooper', owner: 0, x: 4, y: 3 },
    { type: 'breacher', owner: 0, x: 4, y: 4 },
    { type: 'skimmer', owner: 0, x: 3, y: 5 },
    { type: 'trooper', owner: 1, x: 3, y: 9 },
    { type: 'trooper', owner: 1, x: 2, y: 8 },
    { type: 'trooper', owner: 1, x: 4, y: 10 },
    { type: 'breacher', owner: 1, x: 4, y: 9 },
    { type: 'trooper', owner: 2, x: 16, y: 3 },
    { type: 'trooper', owner: 2, x: 16, y: 5 },
    { type: 'trooper', owner: 2, x: 17, y: 10 },
    { type: 'breacher', owner: 2, x: 18, y: 4 },
    { type: 'breacher', owner: 2, x: 17, y: 8 },
    { type: 'skimmer', owner: 2, x: 15, y: 8 },
  ],
  recommended: { fog: false, weather: 'clear', startFunds: 2000 },
};

/** The seven campaign mission maps by id, in mission order (Act I: 1-4, Act II: 5-7). A mission's `mapId` is a key of this table. */
export const MISSION_MAPS: Record<string, MapDef> = {
  'm1-first-light': firstLight,
  'm2-calder-spire': calderSpire,
  'm3-saltglass-bay': saltglassBay,
  'm4-tidebreak': tidebreak,
  'm5-under-canopy': underCanopy,
  'm6-pollen-count': pollenCount,
  'm7-root-and-branch': rootAndBranch,
};
