// M4.0 the four Act I mission maps and M4.1 the three Act II maps. Spec: docs/STORY.md "Act I -- Cinder Season" (missions 1-4) and "Act II --
// False Colors" (missions 5-7), docs/delivery/DECISIONS.md D-007.
// All are original and drawn for the story beat they carry, not for symmetry: the player's agent and Rook's detachment (players 0 and 1,
// one team) start on the west, the opposing force (player 2) on the east. Mission 6 adds Wing Lead Juno Reyes-Abara as a fourth player, an
// ally on team 0 in slot 3, so that "player 2 is the opposing force" holds on every map. Tile legend and MapDef: src/content/types.ts. Rules:
// src/content/map-check.ts. missions.test.ts runs checkMap on every map (mission 1 with requireBases false, since it has no production),
// so a bad edit fails the build. Income is 1000 per property except uplinks (0), docs/research/mechanics.md section 6.
// Rows run y = 0 downward and columns x = 0 rightward; each owners row is the twin of its terrain row ('.' = neutral).
// Player slots on every map: 0 = the player's agent (Helion), 1 = Rook Okafor's Helion detachment, 2 = the opposing force.
//
// M4.2 adds the four Act III maps (docs/STORY.md "Act III -- Thin Air", missions 8-11). Slots 0-2 keep their meaning. Mission 10 adds slot 3, the
// Hollow Choir's drones, as a THIRD TEAM hostile to both armies (the Highlord's air wing is part of his own army, slot 2, because a team is fixed at
// setup and cannot change mid-battle); mission 11 adds slot 3, Admiral Sefa Tamura's Tidewell army, an ally on the agent's team (D-007), and its
// slot 2 is the Choir. Mission 9 is fought inside a permanent ion storm, mission 11 in fog. Two of the four are fought up a slope (the Tether
// ridges, the Ashgrave terraces), so the ridge, the maglev gate and the walker are the geometry the story teaches.
//
// M4.3 adds the three Act IV maps (docs/STORY.md "Act IV -- The Hollow Choir", missions 12-14), all fought on or beside the Glass Waste. Mission 12
// keeps the usual slots (0 the agent, 1 Rook, 2 the Choir). Mission 13 adds slot 3, Marshal Ilse Varga's army, an ally on the agent's team (D-007:
// the agent is attached to her army as its adjutant and she leads; she is never the player), and slot 2 is Cantor. Mission 14 has five players:
// slot 2 is VESPER and the four nations hold four fronts around the Lattice core. Rook is not a player there, because the five-player limit leaves
// four allied slots for four nations (he holds ECHO's channel on the radio); slots 1, 3 and 4 are Sefa, Juno and Corvin, all on the agent's team.
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

// 22x14. Mission 8, Tether Line: a ridge spine (x=9-11) splits the map. The Tether Line is the maglev road along row 6, which crosses the spine at
// a gate; a second, low pass of flats crosses at row 11. Treads and hover units cannot climb a ridge, so they must use a gate; walkers, foot
// and exo units climb anywhere. Foothill crests (7-8, rows 5 and 7) flank the gate on the Helion side. Corvin's two Colossus walkers start on
// the spine, his Bastions on the road, and his Tether Gate spire stands at the end of the line at (18,6).
const tetherLine: MapDef = {
  id: 'm8-tether-line',
  name: 'Tether Gate Ridge',
  description: "A ridge spine splits the Tether Line, with one maglev gate, one low pass and foothill crests, between two Helion bases and the Highlord's Tether Gate.",
  players: 3,
  terrain: [
    '..........^...........', // 0
    '.....ff..^^^....ff....', // 1
    '....Ff..^^^^.^.C......', // 2
    '..H...C.^^^^..C..F....', // 3
    '.........^^^^^......f.', // 4
    '.C.....^^^^^..........', // 5
    '.....=============H.C.', // 6
    '.......^^^^^..........', // 7
    '.C.......^^^^^......f.', // 8
    '......C..^^^..C..F....', // 9
    '..H......^^^..........', // 10
    '....F.f...............', // 11
    '.....ff..^^^....ff....', // 12
    '..........^...........', // 13
  ],
  owners: [
    '......................', // 0
    '......................', // 1
    '....0..........2......', // 2
    '..0..............2....', // 3
    '......................', // 4
    '.0....................', // 5
    '..................2.2.', // 6
    '......................', // 7
    '.1....................', // 8
    '.................2....', // 9
    '..1...................', // 10
    '....1.................', // 11
    '......................', // 12
    '......................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 3, y: 4 },
    { type: 'trooper', owner: 0, x: 4, y: 5 },
    { type: 'breacher', owner: 0, x: 4, y: 4 },
    { type: 'arc', owner: 0, x: 3, y: 5 },
    { type: 'trooper', owner: 1, x: 3, y: 9 },
    { type: 'trooper', owner: 1, x: 4, y: 8 },
    { type: 'breacher', owner: 1, x: 4, y: 9 },
    { type: 'arc', owner: 1, x: 3, y: 8 },
    { type: 'colossus', owner: 2, x: 10, y: 3 },
    { type: 'colossus', owner: 2, x: 10, y: 9 },
    { type: 'bastion', owner: 2, x: 14, y: 6 },
    { type: 'bastion', owner: 2, x: 15, y: 7 },
    { type: 'breacher', owner: 2, x: 11, y: 5 },
    { type: 'breacher', owner: 2, x: 11, y: 7 },
    { type: 'trooper', owner: 2, x: 13, y: 5 },
    { type: 'arc', owner: 2, x: 15, y: 5 },
  ],
  recommended: { fog: false, weather: 'clear', startFunds: 4000 },
};

// 24x12 (fog on, permanent ion storm). Mission 9, Night Wing: a high pass of ridge with a valley floor that climbs in steps from the Helion basin
// at the south-west to the Night Wing plateau at the north-east. The maglev road is a monotone staircase from the convoy's head at (1,10) to the
// neutral uplink at (22,4), 27 steps for the rear Mule and 25 for the front one, so a Mule (move 6) needs five cycles. Sable's spire stands
// at (19,2) on the plateau; her skyport at (21,3) feeds the wing. Rook's column is the convoy: three Mules on the road, Wardens beside them.
const nightWing: MapDef = {
  id: 'm9-night-wing',
  name: 'Thornback Pass',
  description: 'A storm-wrapped mountain road climbs in steps from a Helion basin to a Night Wing plateau, with one uplink at the top and ridges on every side.',
  players: 3,
  terrain: [
    '^^^^^^^^^^^^^^^^^^^^^^^^', // 0
    '^^^^^^^^^^^^^^...f...C.^', // 1
    '^^^^^^^^^^^^^^..F.fH...^', // 2
    '^^^^^^^^^^^^^^.......A.^', // 3
    '^^^^^^^^^^^^^^^^.=====U^', // 4
    '..H.F....^^...Cf.=.Cff.^', // 5
    '.f.....C.^^.======.^^^^^', // 6
    '..ff......f.=.f....^^^^^', // 7
    '.C...H.======.^^^^^^^^^^', // 8
    '...F...=..C...^^^^^^^^^^', // 9
    '.=======.^^^^^^^^^^^^^^^', // 10
    '^^^^^^^^^^^^^^^^^^^^^^^^', // 11
  ],
  owners: [
    '........................', // 0
    '.....................2..', // 1
    '................2..2....', // 2
    '.....................2..', // 3
    '........................', // 4
    '..0.0...................', // 5
    '.......1................', // 6
    '........................', // 7
    '.0...1..................', // 8
    '...1....................', // 9
    '........................', // 10
    '........................', // 11
  ],
  units: [
    { type: 'trooper', owner: 0, x: 3, y: 6 },
    { type: 'trooper', owner: 0, x: 5, y: 6 },
    { type: 'breacher', owner: 0, x: 4, y: 6 },
    { type: 'warden', owner: 0, x: 4, y: 7 },
    { type: 'lancer', owner: 0, x: 6, y: 7 },
    { type: 'mule', owner: 1, x: 1, y: 10 },
    { type: 'mule', owner: 1, x: 2, y: 10 },
    { type: 'mule', owner: 1, x: 3, y: 10 },
    { type: 'warden', owner: 1, x: 4, y: 10 },
    { type: 'lancer', owner: 1, x: 5, y: 10 },
    { type: 'trooper', owner: 1, x: 6, y: 9 },
    { type: 'wasp', owner: 2, x: 13, y: 5 },
    { type: 'wasp', owner: 2, x: 15, y: 7 },
    { type: 'wasp', owner: 2, x: 17, y: 3 },
    { type: 'raptor', owner: 2, x: 19, y: 3 },
    { type: 'anvil', owner: 2, x: 16, y: 1 },
    { type: 'trooper', owner: 2, x: 18, y: 3 },
    { type: 'breacher', owner: 2, x: 20, y: 2 },
  ],
  recommended: { fog: true, weather: 'ionstorm', startFunds: 3000 },
};

// 24x14, FOUR players. Mission 10, Duel at Ashgrave: the Helion lines on the west, a duelling field in the middle (a city, two outcrops, canopy) and
// the Ashgrave heights on the east: two ridge terraces (x=16 and x=19), each crossed by one maglev gate on row 7, and the Highlord's spire at the
// top (22,7). Slot 2 is Corvin: his armour in the field, and his air wing (Sable's Night Wing: three Wasps and a Raptor) on the terraces. Slot 3 is
// the Choir's drones, a THIRD team: a seized relay (spire (12,1), fabricator (14,1)) on the north edge, and one squad on each flank, standing off.
const duelAtAshgrave: MapDef = {
  id: 'm10-duel-at-ashgrave',
  name: 'Ashgrave Heights',
  description: 'A duelling field lies between the Helion lines and the Ashgrave terraces, with a seized signal relay on its north edge and a drone squad on each flank.',
  players: 4,
  terrain: [
    '................^..^....', // 0
    '.......f....H.F.^..^....', // 1
    '.........ff.....^..^.f..', // 2
    '....F.........f.^F.^....', // 3
    '..H.....C.......^..^A...', // 4
    '...........^....^..^..f.', // 5
    '.C..............^.^^....', // 6
    '...........C...=======H.', // 7
    '.C..............^^.^....', // 8
    '...........^....^.C^..f.', // 9
    '..H.....C.......^..^.C..', // 10
    '....F.........f.^F.^....', // 11
    '.......f.ff.....^..^.f..', // 12
    '................^..^....', // 13
  ],
  owners: [
    '........................', // 0
    '............3.3.........', // 1
    '........................', // 2
    '....0............2......', // 3
    '..0.................2...', // 4
    '........................', // 5
    '.0......................', // 6
    '......................2.', // 7
    '.1......................', // 8
    '..................2.....', // 9
    '..1..................2..', // 10
    '....1............2......', // 11
    '........................', // 12
    '........................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 4, y: 4 },
    { type: 'trooper', owner: 0, x: 5, y: 5 },
    { type: 'breacher', owner: 0, x: 5, y: 4 },
    { type: 'arc', owner: 0, x: 3, y: 5 },
    { type: 'trooper', owner: 1, x: 4, y: 9 },
    { type: 'trooper', owner: 1, x: 5, y: 9 },
    { type: 'breacher', owner: 1, x: 5, y: 10 },
    { type: 'arc', owner: 1, x: 3, y: 9 },
    { type: 'colossus', owner: 2, x: 14, y: 7 },
    { type: 'bastion', owner: 2, x: 14, y: 5 },
    { type: 'bastion', owner: 2, x: 14, y: 9 },
    { type: 'breacher', owner: 2, x: 15, y: 5 },
    { type: 'breacher', owner: 2, x: 15, y: 9 },
    { type: 'lancer', owner: 2, x: 12, y: 7 },
    { type: 'trooper', owner: 2, x: 15, y: 6 },
    { type: 'arc', owner: 2, x: 17, y: 5 },
    { type: 'wasp', owner: 2, x: 17, y: 4 },
    { type: 'wasp', owner: 2, x: 17, y: 10 },
    { type: 'wasp', owner: 2, x: 18, y: 8 },
    { type: 'raptor', owner: 2, x: 18, y: 5 },
    { type: 'wasp', owner: 3, x: 11, y: 3 },
    { type: 'wasp', owner: 3, x: 13, y: 3 },
    { type: 'skimmer', owner: 3, x: 12, y: 3 },
    { type: 'wasp', owner: 3, x: 11, y: 12 },
    { type: 'wasp', owner: 3, x: 13, y: 11 },
    { type: 'skimmer', owner: 3, x: 12, y: 12 },
  ],
  recommended: { fog: false, weather: 'clear', startFunds: 5000 },
};

// 24x14, FOUR players, fog on. Mission 11, Audit: a northern sea (rows 0-5) over a beach of shoals (row 6) and a southern coast road (row 9). Tidewell's
// north-west promontory (Sefa, slot 3: spire (1,1), docks (5,2) and (5,4) on the sea) is the fleet's front; the Helion bases (slots 0 and 1) in the
// south-west are the land front. The Choir (slot 2) holds three coastal fabricators on row 7, each on the beach, and the Harbour Exchange spire
// at (21,9) at the end of the coast road. Every Choir fabricator is within a Dreadnought's reach of the sea and a walk of the Helion spires.
const audit: MapDef = {
  id: 'm11-audit',
  name: 'Harbour Exchange Coast',
  description: 'A northern sea meets a southern coast road, with Tidewell docks to the north-west, three seized fabricators on the beach and the Harbour Exchange spire beyond.',
  players: 4,
  terrain: [
    '......~~~~~~~~~~~~~~~~~~', // 0
    '.H....~~~~~~~~~~~~~~~~~~', // 1
    '.....D~~~~~~~~~~~~~~~~~~', // 2
    '..F...~~~~~~~~~~~~~~~~~~', // 3
    '.....D~~~~~~~~~~~~~~~~~~', // 4
    '.C....~~~~~~~~~~~~~~~~~~', // 5
    '......ssssssssssssssssss', // 6
    '.C........F....F....F...', // 7
    '..H.....C.....f..C......', // 8
    '....F================H..', // 9
    '.C......................', // 10
    '.......ff....C.....A..^.', // 11
    '..H.F.......ff........ff', // 12
    '...f......^......^......', // 13
  ],
  owners: [
    '........................', // 0
    '.3......................', // 1
    '.....3..................', // 2
    '..3.....................', // 3
    '.....3..................', // 4
    '.3......................', // 5
    '........................', // 6
    '.0........2....2....2...', // 7
    '..0.....................', // 8
    '....0................2..', // 9
    '.1......................', // 10
    '...................2....', // 11
    '..1.1...................', // 12
    '........................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 4, y: 8 },
    { type: 'trooper', owner: 0, x: 5, y: 8 },
    { type: 'breacher', owner: 0, x: 3, y: 8 },
    { type: 'lancer', owner: 0, x: 4, y: 10 },
    { type: 'arc', owner: 0, x: 3, y: 10 },
    { type: 'trooper', owner: 1, x: 3, y: 11 },
    { type: 'trooper', owner: 1, x: 5, y: 12 },
    { type: 'breacher', owner: 1, x: 5, y: 11 },
    { type: 'warden', owner: 1, x: 6, y: 10 },
    { type: 'skimmer', owner: 2, x: 12, y: 6 },
    { type: 'skimmer', owner: 2, x: 17, y: 6 },
    { type: 'skimmer', owner: 2, x: 22, y: 6 },
    { type: 'wasp', owner: 2, x: 13, y: 4 },
    { type: 'wasp', owner: 2, x: 16, y: 3 },
    { type: 'wasp', owner: 2, x: 19, y: 4 },
    { type: 'lancer', owner: 2, x: 12, y: 8 },
    { type: 'lancer', owner: 2, x: 18, y: 8 },
    { type: 'arc', owner: 2, x: 16, y: 8 },
    { type: 'dreadnought', owner: 3, x: 8, y: 3 },
    { type: 'picket', owner: 3, x: 7, y: 2 },
    { type: 'picket', owner: 3, x: 7, y: 4 },
    { type: 'barge', owner: 3, x: 7, y: 5 },
    { type: 'barge', owner: 3, x: 8, y: 5 },
    { type: 'trooper', owner: 3, x: 3, y: 2 },
    { type: 'breacher', owner: 3, x: 3, y: 4 },
  ],
  recommended: { fog: true, weather: 'clear', startFunds: 3000 },
};

// 24x14. Mission 12, Static: the defence of Calder. The Helion bases (the agent's Calder Spire at (2,5), Rook's second base at (2,9)) stand on the
// west behind the Calder Line: a ridge wall at x=9-10 with one open gate (rows 6-8) where the maglev road runs through, and four neutral cities
// and an uplink in and behind the wall. The east is the Glass Waste, and the Choir's seized relay (spire (21,7), two fabricators, a skyport)
// stands in it at the far side. Thirteen Choir voices start on the glass, out of reach of the line for the first cycle.
const static_: MapDef = {
  id: 'm12-static',
  name: 'Calder Static Line',
  description: 'A ridge wall with one maglev gate shelters the Calder bases from a glass plain, where the Choir has seized a relay and thirteen drones are rising.',
  players: 3,
  terrain: [
    '..f......^^...gggggggggg', // 0
    '.....f.C.^^...gggggggggg', // 1
    '.C.......^^...gg^ggggggg', // 2
    '.....F...^^...gggggggggg', // 3
    '...f.....^.C..gggggFgggg', // 4
    '..H......^....gggggg^gAg', // 5
    '.f..........U.gggggggggg', // 6
    '....=============ggggHgg', // 7
    '.f............gggggggggg', // 8
    '..H......^.C..gggggg^ggg', // 9
    '.....F...^....gggggFgggg', // 10
    '.C...f...^^...gggggggggg', // 11
    '.......C.^^...ggg^gggggg', // 12
    '..f......^^...gggggggggg', // 13
  ],
  owners: [
    '........................', // 0
    '........................', // 1
    '.0......................', // 2
    '.....0..................', // 3
    '...................2....', // 4
    '..0...................2.', // 5
    '........................', // 6
    '.....................2..', // 7
    '........................', // 8
    '..1.....................', // 9
    '.....1.............2....', // 10
    '.1......................', // 11
    '........................', // 12
    '........................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 4, y: 4 },
    { type: 'trooper', owner: 0, x: 4, y: 6 },
    { type: 'breacher', owner: 0, x: 5, y: 5 },
    { type: 'arc', owner: 0, x: 3, y: 6 },
    { type: 'warden', owner: 0, x: 6, y: 5 },
    { type: 'trooper', owner: 1, x: 4, y: 8 },
    { type: 'trooper', owner: 1, x: 4, y: 10 },
    { type: 'lancer', owner: 1, x: 5, y: 9 },
    { type: 'arc', owner: 1, x: 3, y: 8 },
    { type: 'warden', owner: 1, x: 6, y: 9 },
    { type: 'wasp', owner: 2, x: 16, y: 4 },
    { type: 'wasp', owner: 2, x: 16, y: 10 },
    { type: 'wasp', owner: 2, x: 17, y: 7 },
    { type: 'skimmer', owner: 2, x: 15, y: 6 },
    { type: 'skimmer', owner: 2, x: 15, y: 8 },
    { type: 'skimmer', owner: 2, x: 17, y: 5 },
    { type: 'lancer', owner: 2, x: 16, y: 6 },
    { type: 'lancer', owner: 2, x: 16, y: 8 },
    { type: 'bastion', owner: 2, x: 18, y: 7 },
    { type: 'arc', owner: 2, x: 19, y: 6 },
    { type: 'arc', owner: 2, x: 19, y: 8 },
    { type: 'trooper', owner: 2, x: 18, y: 5 },
    { type: 'trooper', owner: 2, x: 18, y: 9 },
  ],
  recommended: { fog: false, weather: 'clear', startFunds: 4000 },
};

// 28x14, FOUR players, fog on. Mission 13, Requiem: the march into the Glass Waste. Three Helion columns start on the west flats, one above the other:
// the agent's (spire (2,3)), Marshal Varga's artillery in the middle (spire (2,7), slot 3, who leads) and Rook's (spire (2,11)). Beyond x=8 the
// map is glass, broken by fused ridges, four ruined cities, a dead uplink at (14,6) and the old maglev road along row 7, which runs the whole way
// to Cantor's relay (spire (26,7), two fabricators, a skyport) at the east end. Fifteen Choir voices wait on the glass in front of it.
const requiem: MapDef = {
  id: 'm13-requiem',
  name: 'Requiem Glass',
  description: 'Three Helion columns march east across fused glass and a broken maglev road toward a Choir relay at the far edge of the waste.',
  players: 4,
  terrain: [
    '..f.....gggg^^gggggggggggggg', // 0
    '......f.ggggggg^ggggggggg^gg', // 1
    '.....F..gggggggggggggggggggg', // 2
    '..H.....ggCgggggggggg^gggggg', // 3
    '.C.f....ggggggg^ggggggggFggg', // 4
    '.......fgggg^ggggCgggggggggg', // 5
    '.C.f....ggggggUgggg^gggg^ggg', // 6
    '..H...==================A=Hg', // 7
    '.....F..ggggggggggg^gggg^ggg', // 8
    '.......fgggg^ggggCgggggggggg', // 9
    '.C.f..f.ggggggg^ggggggggFggg', // 10
    '..H.....ggCgggggggggg^gggggg', // 11
    '.....F..ggggggg^gggggggg^ggg', // 12
    '..f...f.gggg^^gggggggggggggg', // 13
  ],
  owners: [
    '............................', // 0
    '............................', // 1
    '.....0......................', // 2
    '..0.........................', // 3
    '.0......................2...', // 4
    '............................', // 5
    '.3..........................', // 6
    '..3.....................2.2.', // 7
    '.....3......................', // 8
    '............................', // 9
    '.1......................2...', // 10
    '..1.........................', // 11
    '.....1......................', // 12
    '............................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 4, y: 3 },
    { type: 'trooper', owner: 0, x: 4, y: 4 },
    { type: 'breacher', owner: 0, x: 5, y: 3 },
    { type: 'arc', owner: 0, x: 3, y: 5 },
    { type: 'warden', owner: 0, x: 5, y: 4 },
    { type: 'trooper', owner: 1, x: 4, y: 10 },
    { type: 'trooper', owner: 1, x: 4, y: 11 },
    { type: 'lancer', owner: 1, x: 5, y: 10 },
    { type: 'warden', owner: 1, x: 5, y: 11 },
    { type: 'arc', owner: 1, x: 3, y: 12 },
    { type: 'arc', owner: 3, x: 4, y: 6 },
    { type: 'arc', owner: 3, x: 4, y: 8 },
    { type: 'arc', owner: 3, x: 3, y: 9 },
    { type: 'salvo', owner: 3, x: 3, y: 7 },
    { type: 'trooper', owner: 3, x: 5, y: 7 },
    { type: 'trooper', owner: 3, x: 5, y: 6 },
    { type: 'warden', owner: 3, x: 6, y: 8 },
    { type: 'wasp', owner: 2, x: 18, y: 3 },
    { type: 'wasp', owner: 2, x: 18, y: 11 },
    { type: 'wasp', owner: 2, x: 19, y: 7 },
    { type: 'skimmer', owner: 2, x: 17, y: 6 },
    { type: 'skimmer', owner: 2, x: 17, y: 8 },
    { type: 'lancer', owner: 2, x: 20, y: 5 },
    { type: 'lancer', owner: 2, x: 20, y: 9 },
    { type: 'lancer', owner: 2, x: 21, y: 7 },
    { type: 'bastion', owner: 2, x: 22, y: 6 },
    { type: 'bastion', owner: 2, x: 22, y: 8 },
    { type: 'colossus', owner: 2, x: 23, y: 5 },
    { type: 'arc', owner: 2, x: 25, y: 6 },
    { type: 'arc', owner: 2, x: 25, y: 8 },
    { type: 'trooper', owner: 2, x: 21, y: 6 },
    { type: 'trooper', owner: 2, x: 21, y: 8 },
  ],
  recommended: { fog: true, weather: 'clear', startFunds: 5000 },
};

// 25x19, FIVE players, fog on, permanent ion storm. Mission 14, Null Spire: four fronts around the Lattice core. The core's spire (12,9) stands inside a
// square ridge wall (Chebyshev radius 4 from the centre) with exactly four maglev gates, one on each axis, and a maglev spoke runs from each gate
// to one nation's front: Helion's plains on the west (the agent, spire (2,9)), the Kestrel heights on the north (Corvin, spire (12,2)), the Verdant
// canopy belt on the east (Juno, spire (22,9)) and a lagoon on the south where Tidewell's fleet (Sefa, spire (12,16)) holds a causeway. The core
// holds its own fabricators and skyport inside the wall. Slot 2 is VESPER; slots 1, 3 and 4 are the allied nations on the agent's team.
const nullSpire: MapDef = {
  id: 'm14-null-spire',
  name: 'Null Spire Rings',
  description: 'Four fronts converge on a black spire inside a ridge wall with four gates: Helion plains, Kestrel heights, a Verdant canopy belt and a Tidewell lagoon.',
  players: 5,
  terrain: [
    'ggggg^^^^^^^^^^^^^^^ggggg', // 0
    'ggggg^^^.........^^^ggggg', // 1
    'ggggg^^^.F..H..A.^^^ggggg', // 2
    '.....C^^....=....^fCfffff', // 3
    '.....^^^..C.=....^ffffff.', // 4
    '.f...f.g^^^^=^^^^gff....f', // 5
    '...f...g^ggg=ggg^gff.F..f', // 6
    '....F..g^gFg=gAg^gf.....f', // 7
    '......fg^ggg=ggg^gff....f', // 8
    '..H=========H=========H.f', // 9
    '......fg^ggg=ggg^gff....f', // 10
    '.C..C..g^gCg=gFg^gf....Cf', // 11
    '.....f.g^ggg=ggg^gff.A..f', // 12
    '.f.f...g^^^^=^^^^gff....f', // 13
    '...~~~~~~~~s=s~~~~~~~~...', // 14
    '..C~~~~~~~~s=s~~~~~~~~C..', // 15
    '...~~~~~~sD.H.Ds~~~~~~...', // 16
    '...~~~~~~~~.F.~~~~~~~~...', // 17
    '...~~~~~~~~~~~~~~~~~~~...', // 18
  ],
  owners: [
    '.........................', // 0
    '.........................', // 1
    '.........4..4..4.........', // 2
    '.........................', // 3
    '..........4..............', // 4
    '.........................', // 5
    '.....................3...', // 6
    '....0.....2...2..........', // 7
    '.........................', // 8
    '..0.........2.........3..', // 9
    '.........................', // 10
    '.0..0.....2...2........3.', // 11
    '.....................3...', // 12
    '.........................', // 13
    '.........................', // 14
    '.........................', // 15
    '..........1.1.1..........', // 16
    '............1............', // 17
    '.........................', // 18
  ],
  units: [
    { type: 'trooper', owner: 0, x: 4, y: 8 },
    { type: 'trooper', owner: 0, x: 4, y: 10 },
    { type: 'breacher', owner: 0, x: 5, y: 9 },
    { type: 'arc', owner: 0, x: 3, y: 8 },
    { type: 'warden', owner: 0, x: 5, y: 10 },
    { type: 'lancer', owner: 0, x: 4, y: 12 },
    { type: 'dreadnought', owner: 1, x: 9, y: 15 },
    { type: 'dreadnought', owner: 1, x: 15, y: 15 },
    { type: 'picket', owner: 1, x: 7, y: 15 },
    { type: 'picket', owner: 1, x: 17, y: 15 },
    { type: 'barge', owner: 1, x: 9, y: 17 },
    { type: 'trooper', owner: 1, x: 11, y: 16 },
    { type: 'breacher', owner: 1, x: 13, y: 16 },
    { type: 'arc', owner: 1, x: 13, y: 17 },
    { type: 'colossus', owner: 2, x: 11, y: 8 },
    { type: 'colossus', owner: 2, x: 13, y: 10 },
    { type: 'bastion', owner: 2, x: 10, y: 9 },
    { type: 'bastion', owner: 2, x: 14, y: 9 },
    { type: 'arc', owner: 2, x: 11, y: 10 },
    { type: 'arc', owner: 2, x: 13, y: 8 },
    { type: 'salvo', owner: 2, x: 12, y: 11 },
    { type: 'lancer', owner: 2, x: 11, y: 7 },
    { type: 'lancer', owner: 2, x: 13, y: 11 },
    { type: 'wasp', owner: 2, x: 12, y: 7 },
    { type: 'wasp', owner: 2, x: 9, y: 10 },
    { type: 'wasp', owner: 2, x: 15, y: 8 },
    { type: 'raptor', owner: 2, x: 9, y: 8 },
    { type: 'anvil', owner: 2, x: 15, y: 10 },
    { type: 'skimmer', owner: 2, x: 11, y: 11 },
    { type: 'skimmer', owner: 2, x: 13, y: 7 },
    { type: 'trooper', owner: 2, x: 10, y: 10 },
    { type: 'trooper', owner: 2, x: 14, y: 8 },
    { type: 'wasp', owner: 3, x: 20, y: 5 },
    { type: 'wasp', owner: 3, x: 20, y: 8 },
    { type: 'wasp', owner: 3, x: 20, y: 10 },
    { type: 'wasp', owner: 3, x: 20, y: 13 },
    { type: 'raptor', owner: 3, x: 22, y: 7 },
    { type: 'anvil', owner: 3, x: 22, y: 11 },
    { type: 'skimmer', owner: 3, x: 21, y: 9 },
    { type: 'trooper', owner: 3, x: 22, y: 8 },
    { type: 'bastion', owner: 4, x: 10, y: 3 },
    { type: 'bastion', owner: 4, x: 14, y: 3 },
    { type: 'colossus', owner: 4, x: 12, y: 3 },
    { type: 'breacher', owner: 4, x: 9, y: 3 },
    { type: 'breacher', owner: 4, x: 15, y: 3 },
    { type: 'arc', owner: 4, x: 11, y: 1 },
    { type: 'arc', owner: 4, x: 13, y: 1 },
    { type: 'trooper', owner: 4, x: 11, y: 3 },
  ],
  recommended: { fog: true, weather: 'ionstorm', startFunds: 4000 },
};

/** The fourteen campaign mission maps by id, in mission order (Act I: 1-4, Act II: 5-7, Act III: 8-11, Act IV: 12-14). A mission's `mapId` is a key of this table. */
export const MISSION_MAPS: Record<string, MapDef> = {
  'm1-first-light': firstLight,
  'm2-calder-spire': calderSpire,
  'm3-saltglass-bay': saltglassBay,
  'm4-tidebreak': tidebreak,
  'm5-under-canopy': underCanopy,
  'm6-pollen-count': pollenCount,
  'm7-root-and-branch': rootAndBranch,
  'm8-tether-line': tetherLine,
  'm9-night-wing': nightWing,
  'm10-duel-at-ashgrave': duelAtAshgrave,
  'm11-audit': audit,
  'm12-static': static_,
  'm13-requiem': requiem,
  'm14-null-spire': nullSpire,
};
