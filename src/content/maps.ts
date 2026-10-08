// M1.9 the six shipped skirmish maps. All are original: names and layouts come from our own setting (docs/STORY.md "Setting",
// "The five factions"), and no map traces any other game's. Tile legend and MapDef: src/content/types.ts. Rules: src/content/map-check.ts
// (checkMap runs on every map in maps.test.ts, so a bad edit fails the build). Each map is drawn once and expanded by its symmetry, so
// the sides are equal by construction, and maps.test.ts re-measures that: property counts, the declared symmetry, spire distances.
// Income is 1000 per property except uplinks (0), docs/research/mechanics.md §6; every side has 8 or more neutral arcologies to take.
// Rows run y = 0 downward and columns x = 0 rightward; each owners row is the twin of its terrain row ('.' = neutral).
import type { MapDef } from './types';

// 14x10, rot180. The first skirmish: no fog, and a maglev road from each spire that meets the opposing road through the arcology pair at the centre.
const calderFields: MapDef = {
  id: 'calder-fields',
  name: 'Calder Fields',
  description: 'Open farmland beside Calder Spire where two armies fight over a contested crossroads and one forward fabricator each.',
  players: 2,
  terrain: [
    '..f.C=..f..C..', // 0
    '.H=F==.^....C.', // 1
    'f=...======..C', // 2
    'A=.C..F..C.f..', // 3
    '.=C.^.C=..C.f.', // 4
    '.f.C..=C.^.C=.', // 5
    '..f.C..F..C.=A', // 6
    'C..======...=f', // 7
    '.C....^.==F=H.', // 8
    '..C..f..=C.f..', // 9
  ],
  owners: [
    '....0.........', // 0
    '.0.0..........', // 1
    '..............', // 2
    '0.....0.......', // 3
    '..............', // 4
    '..............', // 5
    '.......1.....1', // 6
    '..............', // 7
    '..........1.1.', // 8
    '.........1....', // 9
  ],
  units: [
    { type: 'trooper', owner: 0, x: 2, y: 2 },
    { type: 'trooper', owner: 1, x: 11, y: 7 },
    { type: 'trooper', owner: 0, x: 4, y: 2 },
    { type: 'trooper', owner: 1, x: 9, y: 7 },
  ],
  recommended: { startFunds: 1000 },
};

// 22x14, mirrorX. A bay with a dock on each shore, shoal landings and a central island; a land route runs round the north shore and a second, shorter one
// along a causeway on the south edge, so transports matter for the islands and not for the march.
// M3.3 what changed and why. Measured with Doctrine against Doctrine, 40-cycle cap: the original map's only land route was the north-shore march, 33 steps
// between the spires against 19 in a straight line. On three seed sets (20, 30 and 30 games) 65%, 80% and 60% of the games were still undecided at the
// cap, and player 0 won 24 of the 25 that were decided. Changed, in mirror pairs so mirrorX still holds:
//   rows 12 and 13, x 7-8, 10-11 and 13-14: sea became flats. With the shoals and arcologies already on those rows this is a two-tile-wide causeway
//   along the south edge from shore to shore, 23 steps between the spires. A one-tile causeway (row 13 only) did little (55% undecided against 65%
//   on the same 20 games); the two-wide one brought the undecided share to 33-37%. The two islet arcologies on row 12 (x 9 and 12) are now ON the causeway.
//   (9,5) and (12,5) became islet arcologies and (9,6) and (12,6) shoals beside them: sea all round except the landing shoal, joined to the central
//   island's shoals, so the bay keeps four arcologies that only a Barge can reach (the islets that the causeway took, replaced in the north bay).
//   Start funds 2000 -> 1000. With the causeway alone (2000) player 0 won 70% of the decided games (47 decided, 60 games on two seed sets) and 22% were
//   undecided; with 1000 it won 53% (78 decided, 90 games on three seed sets) and 13% were undecided. Funds alone do not do it: the original map at 1000
//   still left 60% of the games undecided (30 games). The causeway makes the games end, the lower funds make the first move worth less.
const saltglassBay: MapDef = {
  id: 'saltglass-bay',
  name: 'Saltglass Bay',
  description: 'A shallow bay of shoals and islet arcologies between two coastal armies, where Barges and fleets decide who reaches the islands first.',
  players: 2,
  terrain: [
    '.ff^^....C..C....^^ff.', // 0
    '..^................^..', // 1
    '======================', // 2
    '.f=C..f........f..C=f.', // 3
    '..=.C..s~~~~~~s..C.=..', // 4
    '.f=..F.s~C~~C~s.F..=f.', // 5
    '.^=...C~~ssss~~C...=^.', // 6
    '.^=f..s~~sCCs~~s..f=^.', // 7
    '.^=.C..~~sUUs~~..C.=^.', // 8
    '.A=....D~~ss~~D....=A.', // 9
    '.H=F...~~~~~~~~...F=H.', // 10
    '..=.C.s~~s~~s~~s.C.=..', // 11
    'f.=F..C..C..C..C..F=.f', // 12
    '..f...s..s..s..s...f..', // 13
  ],
  owners: [
    '......................', // 0
    '......................', // 1
    '......................', // 2
    '......................', // 3
    '......................', // 4
    '.....0..........1.....', // 5
    '......................', // 6
    '......................', // 7
    '......................', // 8
    '.0.....0......1.....1.', // 9
    '.0.0..............1.1.', // 10
    '......................', // 11
    '...0..............1...', // 12
    '......................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 2, y: 9 },
    { type: 'trooper', owner: 1, x: 19, y: 9 },
    { type: 'trooper', owner: 0, x: 3, y: 8 },
    { type: 'trooper', owner: 1, x: 18, y: 8 },
  ],
  recommended: { startFunds: 1000 },
};

// 18x14, rot180, fog recommended. Over half canopy; ridges give foot units the +3 vision, and two uplinks sit in the centre beside lookout ridges.
// M3.3 start funds 4000 (were 2000). Doctrine against Doctrine, fog up, noFirstIncome, 40 games on each of two seed sets: at 2000 player 0 won 33 of 39 and 30 of 40
// decided games (85% and 75%); at 4000 it won 21 of 37 and 20 of 39 (57% and 51%), with 8% and 3% of the games undecided at the 40-cycle cap. The
// share is not a straight line in the funds (0: 31%, 3000: 36%, 5000: 44%, 6000: 44%, 8000: 35%, one seed set); 2000 is the outlier, not the trend.
const canopyHighlands: MapDef = {
  id: 'canopy-highlands',
  name: 'Canopy Highlands',
  description: 'Dense Verdant canopy broken by a few clearings and lookout ridges, built for fog, ambush and patient scouting.',
  players: 2,
  terrain: [
    '..fff^ffffffff^fff', // 0
    '.H=F=ffffCf.fffCff', // 1
    '..=.=^Cfff..Cf..ff', // 2
    'fA=C.ff.^.^ff^ffff', // 3
    '^f====ff.ffCfffC.f', // 4
    'ffffC=F==f^f...f.f', // 5
    'ffCf..f^U=ffCfffff', // 6
    'fffffCff=U^f..fCff', // 7
    'f.f...f^f==F=Cffff', // 8
    'f.CfffCff.ff====f^', // 9
    'ffff^ff^.^.ff.C=Af', // 10
    'ff..fC..fffC^=.=..', // 11
    'ffCfff.fCffff=F=H.', // 12
    'fff^ffffffff^fff..', // 13
  ],
  owners: [
    '..................', // 0
    '.0.0..............', // 1
    '..................', // 2
    '.0.0..............', // 3
    '..................', // 4
    '......0...........', // 5
    '..................', // 6
    '..................', // 7
    '...........1......', // 8
    '..................', // 9
    '..............1.1.', // 10
    '..................', // 11
    '..............1.1.', // 12
    '..................', // 13
  ],
  units: [
    { type: 'trooper', owner: 0, x: 2, y: 2 },
    { type: 'trooper', owner: 1, x: 15, y: 11 },
    { type: 'trooper', owner: 0, x: 4, y: 3 },
    { type: 'trooper', owner: 1, x: 13, y: 10 },
  ],
  recommended: { fog: true, startFunds: 4000 },
};

// 18x16, mirrorY. A two-tile river with three spans, each flanked by ridges that tread and hover units cannot climb: the spans funnel tanks into walkers and artillery.
const tetherRidges: MapDef = {
  id: 'tether-ridges',
  name: 'Tether Ridges',
  description: 'Two ridge fortresses face each other across a deep river that only three spans cross, so walkers on the heights and artillery behind them hold the chokepoints.',
  players: 2,
  terrain: [
    '^^.........^^...^^', // 0
    '^..F.H.F^.......C^', // 1
    '..A..=ff..C.Uff...', // 2
    '.C.=====C=======f.', // 3
    '^^.=.^^C.=^.C^^=^^', // 4
    '..C=^...fF^^.ff=C.', // 5
    '..^=C...f=C^^.C=^.', // 6
    'rrr#rrrrr#rrrrr#rr', // 7
    'rrr#rrrrr#rrrrr#rr', // 8
    '..^=C...f=C^^.C=^.', // 9
    '..C=^...fF^^.ff=C.', // 10
    '^^.=.^^C.=^.C^^=^^', // 11
    '.C.=====C=======f.', // 12
    '..A..=ff..C.Uff...', // 13
    '^..F.H.F^.......C^', // 14
    '^^.........^^...^^', // 15
  ],
  owners: [
    '..................', // 0
    '...0.0.0..........', // 1
    '..0...............', // 2
    '..................', // 3
    '..................', // 4
    '.........0........', // 5
    '..................', // 6
    '..................', // 7
    '..................', // 8
    '..................', // 9
    '.........1........', // 10
    '..................', // 11
    '..................', // 12
    '..1...............', // 13
    '...1.1.1..........', // 14
    '..................', // 15
  ],
  units: [
    { type: 'trooper', owner: 0, x: 4, y: 2 },
    { type: 'trooper', owner: 1, x: 4, y: 13 },
    { type: 'trooper', owner: 0, x: 6, y: 3 },
    { type: 'trooper', owner: 1, x: 6, y: 12 },
  ],
  recommended: { startFunds: 2000 },
};

// 25x15, 3 players. Player 0 sits on the axis; players 1 and 2 mirror each other. Every spire is 20 steps from the other two, and each owns the same properties.
const glassWaste: MapDef = {
  id: 'glass-waste',
  name: 'Glass Waste',
  description: 'Three armies converge on a plain of fused glass and the lone uplink at its heart.',
  players: 3,
  terrain: [
    '^^^...................^^^', // 0
    '^.......C...H...C.......^', // 1
    '..f..^....F===F....^..f..', // 2
    '.ff.^^..^^..A..^^..^^.ff.', // 3
    '......C.....=.....C......', // 4
    '^..C...^..CgCgC..^...C..^', // 5
    '^..^....gggg=gggg....^..^', // 6
    '..^^ff.gCgggFgggCg.ff^^..', // 7
    '...Cf.gggggg=gggggg.fC...', // 8
    '.A...=FggCgg=ggCggF=...A.', // 9
    '.....=ggggggUgggggg=.....', // 10
    '..H===================H..', // 11
    '....F.C.ggCgggCgg.C.F....', // 12
    'f.F...^.C.fgCgf.C.^...F.f', // 13
    'fff..C.^^ff...ff^^.C..fff', // 14
  ],
  owners: [
    '.........................', // 0
    '............0............', // 1
    '..........0...0..........', // 2
    '............0............', // 3
    '.........................', // 4
    '.........................', // 5
    '.........................', // 6
    '............0............', // 7
    '.........................', // 8
    '.1....1...........2....2.', // 9
    '.........................', // 10
    '..1...................2..', // 11
    '....1...............2....', // 12
    '..1...................2..', // 13
    '.........................', // 14
  ],
  units: [
    { type: 'trooper', owner: 0, x: 11, y: 3 },
    { type: 'trooper', owner: 0, x: 13, y: 3 },
    { type: 'trooper', owner: 1, x: 3, y: 10 },
    { type: 'trooper', owner: 2, x: 21, y: 10 },
    { type: 'trooper', owner: 1, x: 4, y: 11 },
    { type: 'trooper', owner: 2, x: 20, y: 11 },
  ],
  recommended: { startFunds: 3000 },
};

// 23x23, rot90 (clockwise: player 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left). A ring road joins the four bases; each owns a lagoon dock.
const arcologyCoast: MapDef = {
  id: 'arcology-coast',
  name: 'Arcology Coast',
  description: 'Four arcology-states ring a tidal lagoon, fighting along a coast road and by Barge for the uplink on the central island.',
  players: 4,
  terrain: [
    '^^....f..^^^^........^^', // 0
    '^....ff.^f.^.f..ff....^', // 1
    '.........ff.ffC.f..A...', // 2
    '..AH=F=C==C=C=C==F=H...', // 3
    '...=C==.F..s......C=...', // 4
    '.f.F..Cf.Cs~C.Cf..=F.f.', // 5
    '.ff=..===s~~~s.f=C==.ff', // 6
    '...=.ff.D~~~~~..=f.C...', // 7
    '..CC.C..~~~~~~~D=.F=.^.', // 8
    '.ff=..s~~~~~~~~~sC.=ff^', // 9
    '^.fC.C~~~~~s~~~~~s.Cf.^', // 10
    '^^.=s~~~~~sUs~~~~~s=.^^', // 11
    '^.fC.s~~~~~s~~~~~C.Cf.^', // 12
    '^ff=.Cs~~~~~~~~~s..=ff.', // 13
    '.^.=F.=D~~~~~~~..C.CC..', // 14
    '...C.f=..~~~~~D.ff.=...', // 15
    'ff.==C=f.s~~~s===..=ff.', // 16
    '.f.F=..fC.C~sC.fC..F.f.', // 17
    '...=C......s..F.==C=...', // 18
    '...H=F==C=C=C==C=F=HA..', // 19
    '...A..f.Cff.ff.........', // 20
    '^....ff..f.^.f^.ff....^', // 21
    '^^........^^^^..f....^^', // 22
  ],
  owners: [
    '.......................', // 0
    '.......................', // 1
    '...................1...', // 2
    '..00.0...........1.1...', // 3
    '....0...0.........1....', // 4
    '...0...............1...', // 5
    '.......................', // 6
    '........0..............', // 7
    '...............1..1....', // 8
    '.......................', // 9
    '.......................', // 10
    '.......................', // 11
    '.......................', // 12
    '.......................', // 13
    '....3..3...............', // 14
    '..............2........', // 15
    '.......................', // 16
    '...3...............2...', // 17
    '....3.........2...2....', // 18
    '...3.3...........2.22..', // 19
    '...3...................', // 20
    '.......................', // 21
    '.......................', // 22
  ],
  units: [
    { type: 'trooper', owner: 0, x: 4, y: 3 },
    { type: 'trooper', owner: 1, x: 19, y: 4 },
    { type: 'trooper', owner: 2, x: 18, y: 19 },
    { type: 'trooper', owner: 3, x: 3, y: 18 },
    { type: 'trooper', owner: 0, x: 3, y: 6 },
    { type: 'trooper', owner: 1, x: 16, y: 3 },
    { type: 'trooper', owner: 2, x: 19, y: 16 },
    { type: 'trooper', owner: 3, x: 6, y: 19 },
  ],
  recommended: { startFunds: 3000 },
};

/** The shipped maps by id, in menu order. */
export const MAPS: Record<string, MapDef> = {
  'calder-fields': calderFields,
  'saltglass-bay': saltglassBay,
  'canopy-highlands': canopyHighlands,
  'tether-ridges': tetherRidges,
  'glass-waste': glassWaste,
  'arcology-coast': arcologyCoast,
};
