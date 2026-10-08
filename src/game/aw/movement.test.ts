// Movement rules: terrain costs, reachable(), checkPath(). Expected answers are written out here from the rules
// spec (docs/research/mechanics.md sections 1, 3, 9.4, 12 and D-012), or computed by a brute-force search in this
// file, never read back from movement.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommanderDef } from '../../content/types';
import { TERRAIN_CODES, TERRAIN_LIST, TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import { IllegalActionError } from './errors';
import { canSeeUnit, createGame, effectiveMove, resetCommanderRegistry, setCommanderRegistry } from './index';
import type { PlayerSetup } from './index';
import { canCarryType, canJoinInto, canLoadInto, canStandOn, checkPath, reachable, terrainMoveCost } from './movement';
import type { ReachEntry } from './movement';
import { TWO_PLAYERS, fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import type { Coord, GameState, Modifier, MoveType, TerrainId, Unit, UnitTypeId, Weather } from './types';

// One test below swaps the vision grid for a hand-made one (see "backs up"); every other test sees the real one.
const vision = vi.hoisted(() => ({ override: null as null | ((state: { width: number; height: number }, player: number) => Uint8Array | null) }));
vi.mock('./fog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fog')>();
  return {
    ...actual,
    visionGrid: (state: Parameters<typeof actual.visionGrid>[0], player: number) =>
      vision.override ? vision.override(state, player) : actual.visionGrid(state, player),
  };
});

afterEach(() => {
  resetCommanderRegistry();
  vision.override = null;
});

// ---------------------------------------------------------------- expected data (spec section 1 + D-012)

const MT: MoveType[] = ['foot', 'exo', 'hover', 'tread', 'walker', 'air', 'sea', 'barge'];
const N = null;
const LAND = [1, 1, 1, 1, 1, 1, N, N];
// Columns follow MT. N = impassable. Shoal costs tread and walker 2 on purpose (D-012 point 7).
const EXPECTED: Record<TerrainId, (number | null)[]> = {
  flats: LAND,
  canopy: [1, 1, 3, 2, 2, 1, N, N],
  ridge: [2, 1, N, N, 2, 1, N, N],
  maglev: LAND,
  span: LAND,
  river: [2, 1, 1, N, N, 1, N, N],
  sea: [N, N, N, N, N, 1, 1, 1],
  shoal: [1, 1, 1, 2, 2, 1, N, 1],
  glass: [1, 1, 1, 2, 1, 1, N, N],
  arcology: LAND,
  fabricator: LAND,
  skyport: LAND,
  uplink: LAND,
  spire: LAND,
  dock: [1, 1, 1, 1, 1, 1, 1, 1],
};
const expectedCost = (t: TerrainId, mt: MoveType): number | null => EXPECTED[t][MT.indexOf(mt)];

// ---------------------------------------------------------------- helpers

const key = (x: number, y: number) => `${x},${y}`;
const P = (...c: [number, number][]): Coord[] => c.map(([x, y]) => ({ x, y }));
const unitOf = (s: GameState, id: number): Unit => s.units.find((u) => u.id === id)!;
const patch = (s: GameState, id: number, p: Partial<Unit>): GameState => ({ ...s, units: s.units.map((u) => (u.id === id ? { ...u, ...p } : u)) });
const xsOnRow = (r: Map<string, ReachEntry>, y = 0) => [...r.values()].filter((e) => e.y === y).map((e) => e.x).sort((a, b) => a - b);
const maxCost = (r: Map<string, ReachEntry>) => Math.max(...[...r.values()].map((e) => e.cost));
const costAt = (r: Map<string, ReachEntry>, x: number, y = 0) => r.get(key(x, y))?.cost;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function testCommander(modifiers: Modifier[]): CommanderDef {
  return {
    id: 'co', name: 'Fixture CO', initials: 'FC', faction: null, title: 'Test', pronouns: 'they/them', bio: 'fixture', voice: 'fixture',
    passive: { name: 'Fixture', description: 'fixture', modifiers }, surge: null, overclock: null,
    lines: { select: '', victory: '', defeat: '' }, playable: false,
  };
}

interface GameOpts { fog?: boolean; weather?: Weather; mods?: Modifier[]; sameTeam?: boolean }
/** Player 0 may carry a registered test commander (`mods`); unit ids follow the order of `units`, starting at 1. */
function game(rows: string[], units: FixtureUnit[], o: GameOpts = {}): GameState {
  if (o.mods) setCommanderRegistry({ co: testCommander(o.mods) });
  const players: PlayerSetup[] = [
    { faction: 'helion', commander: o.mods ? 'co' : 'none', controller: 'ai', team: 0 },
    { faction: 'tidewell', commander: 'none', controller: 'ai', team: o.sameTeam ? 0 : 1 },
  ];
  return createGame({ map: fixtureMap(rows, units), players, seed: 1, fog: o.fog, weather: o.weather });
}

function illegalMessage(fn: () => unknown): string {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err, 'expected an IllegalActionError').toBeInstanceOf(IllegalActionError);
  return (err as Error).message;
}
const expectIllegal = (fn: () => unknown, message: RegExp) => expect(illegalMessage(fn)).toMatch(message);

// ---------------------------------------------------------------- terrain costs (DONE 1)

describe('terrainMoveCost and canStandOn', () => {
  it('covers every terrain, and matches the spec table for all 8 movement types', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(TERRAIN_LIST.map((t) => t.id).sort());
    for (const t of TERRAIN_LIST) {
      for (const mt of MT) {
        expect(terrainMoveCost(t.id, mt), `${mt} on ${t.id}`).toBe(expectedCost(t.id, mt));
        expect(canStandOn(t.id, mt), `${mt} stands on ${t.id}`).toBe(expectedCost(t.id, mt) !== null);
      }
    }
  });

  it('prices the named cases: hover, tread, walker, exo, air', () => {
    // hover: river and shoal at 1, canopy 3, no ridge
    expect([terrainMoveCost('river', 'hover'), terrainMoveCost('shoal', 'hover'), terrainMoveCost('canopy', 'hover'), terrainMoveCost('ridge', 'hover')]).toEqual([1, 1, 3, null]);
    // tread: no river, no ridge, 2 on glass and (D-012) on shoal
    expect([terrainMoveCost('river', 'tread'), terrainMoveCost('ridge', 'tread'), terrainMoveCost('glass', 'tread'), terrainMoveCost('shoal', 'tread')]).toEqual([null, null, 2, 2]);
    // walker: ridge at 2, shoal 2 (D-012), no river
    expect([terrainMoveCost('ridge', 'walker'), terrainMoveCost('shoal', 'walker'), terrainMoveCost('river', 'walker')]).toEqual([2, 2, null]);
    // exo climbs a ridge at 1, foot at 2
    expect([terrainMoveCost('ridge', 'exo'), terrainMoveCost('ridge', 'foot')]).toEqual([1, 2]);
    // air pays 1 on every terrain in the game
    for (const t of TERRAIN_LIST) expect(terrainMoveCost(t.id, 'air'), t.id).toBe(1);
    // sea units stand on sea and dock only; the barge also takes shoal
    const standable = (mt: MoveType) => TERRAIN_LIST.filter((t) => canStandOn(t.id, mt)).map((t) => t.id).sort();
    expect(standable('sea')).toEqual(['dock', 'sea']);
    expect(standable('barge')).toEqual(['dock', 'sea', 'shoal']);
    // the data module agrees with the spec numbers (a changed data file must change this test on purpose)
    expect(TERRAIN_TYPES.shoal.cost.tread).toBe(2);
  });

  it('lets a commander make terrain cost 1, but never opens impassable terrain', () => {
    const ignore = new Set<TerrainId>(['canopy', 'ridge']);
    expect(terrainMoveCost('canopy', 'hover', ignore)).toBe(1);
    expect(terrainMoveCost('ridge', 'foot', ignore)).toBe(1);
    expect(terrainMoveCost('ridge', 'hover', ignore)).toBeNull();
    expect(terrainMoveCost('ridge', 'tread', ignore)).toBeNull();
    expect(terrainMoveCost('glass', 'tread', ignore)).toBe(2); // not in the set: unchanged
    expect(terrainMoveCost('sea', 'foot', new Set<TerrainId>(['sea']))).toBeNull();
  });
});

// ---------------------------------------------------------------- loading and joining rules (DONE 2: allies)

describe('canCarryType, canLoadInto, canJoinInto', () => {
  it('lets a mule carry foot and exo units only, and a barge carry any ground unit', () => {
    const ut = UNIT_TYPES;
    expect(canCarryType(ut.mule, ut.trooper)).toBe(true);
    expect(canCarryType(ut.mule, ut.breacher)).toBe(true);
    for (const t of ['skimmer', 'lancer', 'bastion', 'colossus', 'arc', 'mule', 'wasp', 'picket', 'barge'] as const) {
      expect(canCarryType(ut.mule, ut[t]), `mule carries ${t}`).toBe(false);
    }
    for (const t of ['trooper', 'breacher', 'skimmer', 'lancer', 'bastion', 'colossus', 'mule', 'arc', 'salvo', 'warden'] as const) {
      expect(canCarryType(ut.barge, ut[t]), `barge carries ${t}`).toBe(true);
    }
    for (const t of ['wasp', 'raptor', 'anvil', 'picket', 'dreadnought', 'barge'] as const) {
      expect(canCarryType(ut.barge, ut[t]), `barge carries ${t}`).toBe(false);
    }
    expect(canCarryType(ut.lancer, ut.trooper)).toBe(false); // not a transport
  });

  // ids: 1 trooper, 2 breacher, 3 lancer, 4 mule, 5 barge (shoal), 6 wasp, 7 enemy mule, 8 second mule
  const loadWorld = () => game(['.....s', '......'], [
    { type: 'trooper', owner: 0, x: 0, y: 0 },
    { type: 'breacher', owner: 0, x: 1, y: 0 },
    { type: 'lancer', owner: 0, x: 2, y: 0 },
    { type: 'mule', owner: 0, x: 3, y: 0 },
    { type: 'barge', owner: 0, x: 5, y: 0 },
    { type: 'wasp', owner: 0, x: 0, y: 1 },
    { type: 'mule', owner: 1, x: 1, y: 1 },
    { type: 'mule', owner: 0, x: 2, y: 1 },
  ]);
  const withCargo = (s: GameState, id: number, n: number): Unit => {
    const filler = unitOf(s, 1);
    return { ...unitOf(s, id), cargo: range(n).map((i) => ({ ...filler, id: 100 + i })) };
  };

  it('lets a unit load into an own transport that has room and takes its type', () => {
    const s = loadWorld();
    const [trooper, breacher, lancer, mule, barge, wasp, enemyMule, mule2] = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => unitOf(s, id));
    expect(canLoadInto(trooper, mule)).toBe(true);
    expect(canLoadInto(breacher, mule)).toBe(true);
    expect(canLoadInto(lancer, mule), 'a lancer is not foot or exo').toBe(false);
    expect(canLoadInto(lancer, barge)).toBe(true);
    expect(canLoadInto(trooper, barge)).toBe(true);
    expect(canLoadInto(mule2, barge), 'an empty mule can ride a barge').toBe(true);
    expect(canLoadInto(wasp, barge), 'air units never load').toBe(false);
    expect(canLoadInto(trooper, enemyMule), 'not your transport').toBe(false);
    expect(canLoadInto(mule, mule), 'not itself').toBe(false);
    expect(canLoadInto(trooper, lancer), 'a lancer carries nothing').toBe(false);
  });

  it('refuses a full transport, and allows a barge with one free slot', () => {
    const s = loadWorld();
    const trooper = unitOf(s, 1);
    expect(canLoadInto(trooper, withCargo(s, 4, 1))).toBe(false); // mule holds 1
    expect(canLoadInto(trooper, withCargo(s, 5, 1))).toBe(true); // barge holds 2
    expect(canLoadInto(trooper, withCargo(s, 5, 2))).toBe(false);
    // a transport that already carries something cannot itself be loaded (nesting is not supported by the engine)
    expect(canLoadInto(withCargo(s, 8, 1), unitOf(s, 5))).toBe(false);
  });

  it('lets a unit join a damaged own unit of the same type, and nothing else', () => {
    const s = game(['.....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0, hp: 4 },
      { type: 'trooper', owner: 0, x: 1, y: 0, hp: 5 },
      { type: 'trooper', owner: 0, x: 2, y: 0, hp: 10 },
      { type: 'lancer', owner: 0, x: 3, y: 0, hp: 5 },
      { type: 'trooper', owner: 1, x: 4, y: 0, hp: 5 },
    ]);
    const [mover, damaged, healthy, otherType, enemy] = [1, 2, 3, 4, 5].map((id) => unitOf(s, id));
    expect(canJoinInto(mover, damaged)).toBe(true);
    expect(canJoinInto(mover, healthy), 'target at 10 HP').toBe(false);
    expect(canJoinInto(mover, { ...healthy, hp: 91 }), '91 internal HP still displays as 10').toBe(false);
    expect(canJoinInto(mover, { ...healthy, hp: 90 }), '90 internal HP displays as 9').toBe(true);
    expect(canJoinInto(mover, otherType), 'different type').toBe(false);
    expect(canJoinInto(mover, enemy), 'different owner').toBe(false);
    expect(canJoinInto(mover, mover), 'itself').toBe(false);
    expect(canJoinInto({ ...mover, cargo: [healthy] }, damaged), 'a loaded mover').toBe(false);
    expect(canJoinInto(mover, { ...damaged, cargo: [healthy] }), 'a loaded target').toBe(false);
  });
});

// ---------------------------------------------------------------- reachable() (DONE 2)

describe('reachable: move points and terrain', () => {
  it('includes the unit\'s own tile at cost 0, and nothing else when it is boxed in by visible enemies', () => {
    const s = game(['...'], [
      { type: 'trooper', owner: 0, x: 1, y: 0 },
      { type: 'trooper', owner: 1, x: 0, y: 0 },
      { type: 'trooper', owner: 1, x: 2, y: 0 },
    ]);
    const r = reachable(s, 1);
    expect([...r.keys()]).toEqual(['1,0']);
    expect(r.get('1,0')).toEqual({ x: 1, y: 0, cost: 0, path: [{ x: 1, y: 0 }] });
  });

  it('stops exactly at move points: cost = move is reachable, cost = move + 1 is not', () => {
    const flat = reachable(game(['........'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }]), 1);
    expect(xsOnRow(flat)).toEqual([0, 1, 2, 3]);
    expect(range(4).map((x) => costAt(flat, x))).toEqual([0, 1, 2, 3]);
    expect(flat.has(key(4, 0))).toBe(false);
    // lancer (hover, move 6): two canopy tiles cost 3 + 3 = 6 (reachable), the flat tile after them costs 7 (not)
    const hover = reachable(game(['.ff.....'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }]), 1);
    expect(xsOnRow(hover)).toEqual([0, 1, 2]);
    expect(costAt(hover, 2)).toBe(6);
    expect(hover.has(key(3, 0))).toBe(false);
  });

  it('prices each movement type by the terrain it enters (first tile after the unit)', () => {
    // [unit, terrain code, expected cost of stepping onto it or null when it cannot]
    const cases: [UnitTypeId, string, number | null][] = [
      ['lancer', '^', null], ['lancer', 'r', 1], ['lancer', 's', 1], ['lancer', 'f', 3], ['skimmer', 'f', 3], ['skimmer', 'r', 1],
      ['bastion', 'r', null], ['bastion', '^', null], ['bastion', 'g', 2], ['bastion', 's', 2], ['bastion', 'f', 2],
      ['colossus', '^', 2], ['colossus', 'r', null], ['colossus', 's', 2], ['colossus', 'g', 1],
      ['breacher', '^', 1], ['breacher', 'r', 1], ['trooper', '^', 2], ['trooper', 'r', 2], ['trooper', 'f', 1],
      ['wasp', '^', 1], ['wasp', '~', 1], ['wasp', 'f', 1], ['trooper', '~', null], ['lancer', '~', null],
    ];
    for (const [type, code, want] of cases) {
      const r = reachable(game([`.${code}.`], [{ type, owner: 0, x: 0, y: 0 }]), 1);
      expect(costAt(r, 1), `${type} onto '${code}'`).toBe(want ?? undefined);
    }
  });

  it('cannot cross a wall of terrain its type cannot enter, but a type that can, does', () => {
    const wall = ['.^..', '.^..', '.^..'];
    const lancer = reachable(game(wall, [{ type: 'lancer', owner: 0, x: 0, y: 1 }]), 1);
    expect([...lancer.values()].every((e) => e.x === 0), 'hover stays west of a ridge wall').toBe(true);
    const colossus = reachable(game(wall, [{ type: 'colossus', owner: 0, x: 0, y: 1 }]), 1);
    expect([costAt(colossus, 1, 1), costAt(colossus, 2, 1), costAt(colossus, 3, 1)]).toEqual([2, 3, 4]);
    const river = ['.r..', '.r..', '.r..'];
    const bastion = reachable(game(river, [{ type: 'bastion', owner: 0, x: 0, y: 1 }]), 1);
    expect([...bastion.values()].every((e) => e.x === 0), 'treads stay west of a river').toBe(true);
    const skimmer = reachable(game(river, [{ type: 'skimmer', owner: 0, x: 0, y: 1 }]), 1);
    expect([costAt(skimmer, 1, 1), costAt(skimmer, 3, 1)]).toEqual([1, 3]);
  });

  it('lets air units fly over everything at 1 per tile (cost = Manhattan distance)', () => {
    const rows = ['.f^r~', 's#g=D', '~~.f^', 'rrCsF', '..^~.'];
    const r = reachable(game(rows, [{ type: 'wasp', owner: 0, x: 2, y: 2 }]), 1);
    expect(r.size).toBe(25); // wasp move 6 covers the whole 5x5 map
    for (const e of r.values()) expect(e.cost, key(e.x, e.y)).toBe(Math.abs(e.x - 2) + Math.abs(e.y - 2));
  });

  it('keeps sea units on sea and dock, and barges also on shoal', () => {
    const rows = ['~~~D.', '~~~s.'];
    const picket = reachable(game(rows, [{ type: 'picket', owner: 0, x: 0, y: 0 }]), 1);
    expect(picket.has(key(3, 0)), 'dock').toBe(true);
    expect(costAt(picket, 3, 0)).toBe(3);
    expect(picket.has(key(3, 1)), 'shoal').toBe(false);
    expect(picket.has(key(4, 0)), 'flats').toBe(false);
    const barge = reachable(game(rows, [{ type: 'barge', owner: 0, x: 0, y: 0 }]), 1);
    expect(costAt(barge, 3, 1)).toBe(4); // shoal is open to a barge
    expect(barge.has(key(4, 1)), 'flats').toBe(false);
  });
});

describe('reachable: other units', () => {
  it('lets visible enemies block passing and stopping, and allies be passed but not stopped on', () => {
    const rows = ['.....', '.....'];
    const withBlocker = (owner: number) => reachable(game(rows, [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'lancer', owner, x: 2, y: 0 },
    ]), 1);
    const enemy = withBlocker(1);
    expect(enemy.has(key(2, 0)), 'cannot stop on an enemy').toBe(false);
    expect(enemy.has(key(3, 0)), 'cannot pass an enemy: the detour costs 5').toBe(false);
    const ally = withBlocker(0);
    expect(ally.has(key(2, 0)), 'cannot stop on a unit that is neither a transport nor a damaged twin').toBe(false);
    expect(costAt(ally, 3, 0), 'passes through the ally').toBe(3);
    expect(ally.get(key(3, 0))!.path).toEqual(P([0, 0], [1, 0], [2, 0], [3, 0]));
  });

  it('treats a teammate (another player, same team) like an ally: passable, never stoppable', () => {
    const s = game(['.....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'mule', owner: 1, x: 1, y: 0 },
      { type: 'trooper', owner: 1, x: 2, y: 0, hp: 4 },
    ], { sameTeam: true });
    const r = reachable(s, 1);
    expect(r.has(key(1, 0)), 'not loadable: another player owns it').toBe(false);
    expect(r.has(key(2, 0)), 'not joinable: another player owns it').toBe(false);
    expect(costAt(r, 3)).toBe(3);
  });

  it('lets a unit stop on a transport it can load into, a damaged twin it can join, and no other friend', () => {
    // 0 trooper (the mover) | 1 mule with room | 2 mule already full | 3 lancer-ride barge cases come later
    const room = game(['.......'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'mule', owner: 0, x: 1, y: 0 }]);
    expect(costAt(reachable(room, 1), 1), 'mule with room').toBe(1);
    const filler = unitOf(room, 1);
    const full = patch(room, 2, { cargo: [{ ...filler, id: 90 }] });
    expect(reachable(full, 1).has(key(1, 0)), 'a full mule').toBe(false);
    expect(costAt(reachable(full, 1), 2), 'but it can still be passed').toBe(2);
    const loadedMover = patch(room, 1, { cargo: [{ ...filler, id: 91 }] });
    expect(reachable(loadedMover, 1).has(key(1, 0)), 'a loaded mover cannot load').toBe(false);

    const wrongCargo = game(['......'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'mule', owner: 0, x: 1, y: 0 }]);
    expect(reachable(wrongCargo, 1).has(key(1, 0)), 'a mule takes foot and exo only').toBe(false);

    const shore = game(['.s.'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'barge', owner: 0, x: 1, y: 0 }]);
    expect(costAt(reachable(shore, 1), 1), 'a barge on a shoal takes a lancer').toBe(1);
    const air = game(['.s.'], [{ type: 'wasp', owner: 0, x: 0, y: 0 }, { type: 'barge', owner: 0, x: 1, y: 0 }]);
    expect(reachable(air, 1).has(key(1, 0)), 'air units never load').toBe(false);
    expect(costAt(reachable(air, 1), 2), 'but they fly over it').toBe(2);

    const join = game(['.....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 0, x: 1, y: 0, hp: 6 },
      { type: 'trooper', owner: 0, x: 2, y: 0, hp: 10 },
    ]);
    const rj = reachable(join, 1);
    expect(costAt(rj, 1), 'damaged twin').toBe(1);
    expect(rj.has(key(2, 0)), 'full-health twin').toBe(false);
  });
});

describe('reachable: fog of war', () => {
  const rowOfEight = '........';
  it('lets an enemy out of sight look like an empty tile, but stops a visible one', () => {
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }];
    const clear = reachable(game([rowOfEight], units, { fog: false }), 1);
    expect(xsOnRow(clear), 'no fog: the enemy at 3 is seen and blocks').toEqual([0, 1, 2]);
    const fog = reachable(game([rowOfEight], units, { fog: true }), 1);
    expect(xsOnRow(fog), 'fog: the enemy at 3 is beyond vision 2, so it does not block').toEqual([0, 1, 2, 3]);
    const seen = reachable(game([rowOfEight], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 2, y: 0 }], { fog: true }), 1);
    expect(xsOnRow(seen), 'fog, enemy at distance 2: inside vision, so it blocks').toEqual([0, 1]);
  });

  it('hides an enemy on canopy unless it is adjacent', () => {
    const far = reachable(game(['..f.....'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 2, y: 0 }], { fog: true }), 1);
    expect(xsOnRow(far), 'canopy at distance 2 is hidden, so it does not block').toEqual([0, 1, 2, 3]);
    const near = reachable(game(['.f......'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }], { fog: true }), 1);
    expect(xsOnRow(near), 'canopy at distance 1 is seen').toEqual([0]);
  });

  it('shares vision with allies: an enemy an ally can see blocks', () => {
    // The trooper alone sees 2 tiles, so the enemy 3 tiles away is hidden. A skimmer (vision 5) beside it sees that tile.
    const units: FixtureUnit[] = [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }];
    const alone = reachable(game([rowOfEight, rowOfEight], units, { fog: true }), 1);
    expect(alone.has(key(3, 0))).toBe(true);
    const scouted = reachable(game([rowOfEight, rowOfEight], [...units, { type: 'skimmer', owner: 0, x: 0, y: 1 }], { fog: true }), 1);
    expect(scouted.has(key(3, 0)), 'the skimmer sees the enemy').toBe(false);
  });
});

describe('reachable: charge limits steps', () => {
  const longRow = '.........';
  it('never reaches more tiles away than the unit has charge, whatever its move', () => {
    const base = game([longRow], [{ type: 'lancer', owner: 0, x: 0, y: 0 }]); // move 6, charge 70
    for (const charge of [0, 1, 2, 5, 6, 7, 70]) {
      const r = reachable(patch(base, 1, { charge }), 1);
      expect(Math.max(...xsOnRow(r)), `charge ${charge}`).toBe(Math.min(charge, 6));
    }
    const two = reachable(patch(base, 1, { charge: 2 }), 1);
    expect(xsOnRow(two)).toEqual([0, 1, 2]);
    expect(two.get(key(2, 0))!.path).toEqual(P([0, 0], [1, 0], [2, 0]));
  });

  it('with charge 0 the unit has only its own tile', () => {
    const r = reachable(patch(game([longRow], [{ type: 'lancer', owner: 0, x: 3, y: 0 }]), 1, { charge: 0 }), 1);
    expect([...r.keys()]).toEqual(['3,0']);
  });

  it('does not lose a shorter-but-pricier path when the cheaper one is too long for the charge', () => {
    // skimmer (hover, move 8) from (0,0) to (3,0): along the canopy row costs 3 + 3 + 1 = 7 in 3 steps;
    // around it costs 5 in 5 steps.
    const rows = ['.ff..', '.....'];
    const s = game(rows, [{ type: 'skimmer', owner: 0, x: 0, y: 0 }]);
    const at = (charge: number) => reachable(patch(s, 1, { charge }), 1).get(key(3, 0));
    expect(at(99)!.cost).toBe(5);
    expect(at(99)!.path).toHaveLength(6);
    expect(at(5)!.cost).toBe(5);
    for (const charge of [3, 4]) {
      const e = at(charge)!;
      expect([e.cost, e.path.length - 1], `charge ${charge}`).toEqual([7, 3]);
    }
    expect(at(2), 'two steps cannot reach (3,0)').toBeUndefined();
    // and every one of those paths is legal
    for (const charge of [3, 4, 5, 99]) {
      const st = patch(s, 1, { charge });
      const e = reachable(st, 1).get(key(3, 0))!;
      expect(checkPath(st, unitOf(st, 1), e.path).cost, `charge ${charge}`).toBe(e.cost);
    }
  });
});

describe('reachable: commander modifiers', () => {
  it('applies a move modifier to the units its filter names, for its owner only', () => {
    const rows = ['..........', '..........', '..........', '..........'];
    const mods: Modifier[] = [{ move: 2, filter: { moveTypes: ['foot'] } }];
    const s = game(rows, [
      { type: 'trooper', owner: 0, x: 0, y: 0 }, // foot, owner 0: 3 + 2
      { type: 'breacher', owner: 0, x: 0, y: 1 }, // exo: filter says foot only
      { type: 'lancer', owner: 0, x: 0, y: 2 }, // hover
      { type: 'trooper', owner: 1, x: 9, y: 3 }, // foot, but another player
    ], { mods });
    expect(maxCost(reachable(s, 1))).toBe(5);
    expect(maxCost(reachable(s, 2))).toBe(2);
    expect(maxCost(reachable(s, 3))).toBe(6);
    expect(maxCost(reachable(s, 4))).toBe(3);
  });

  it('never lets a move modifier take a unit below 1 move point', () => {
    const s = game(['.....'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }], { mods: [{ move: -9 }] });
    expect(xsOnRow(reachable(s, 1))).toEqual([0, 1]);
  });

  it('applies temporary move debuffs and the ion storm penalty to air', () => {
    const base = game(['.......'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }]);
    const debuffed = { ...base, players: base.players.map((p, i) => (i === 0 ? { ...p, moveEffects: [{ delta: -2, turnsLeft: 1 }] } : p)) };
    expect(xsOnRow(reachable(debuffed, 1))).toEqual([0, 1]);
    const wasp = (weather: Weather) => reachable(game(['.........'], [{ type: 'wasp', owner: 0, x: 0, y: 0 }], { weather }), 1);
    expect(maxCost(wasp('clear'))).toBe(6);
    expect(maxCost(wasp('ionstorm'))).toBe(5);
  });

  it('makes ignoreMoveCost terrain cost 1 for the owner, and still cannot open impassable terrain', () => {
    const units: FixtureUnit[] = [{ type: 'lancer', owner: 0, x: 0, y: 0 }];
    const plain = reachable(game(['.fff.'], units), 1);
    expect(xsOnRow(plain)).toEqual([0, 1, 2]);
    expect(costAt(plain, 2)).toBe(6);
    const ignoring = reachable(game(['.fff.'], units, { mods: [{ ignoreMoveCost: ['canopy'] }] }), 1);
    expect(xsOnRow(ignoring)).toEqual([0, 1, 2, 3, 4]);
    expect(range(5).map((x) => costAt(ignoring, x))).toEqual([0, 1, 2, 3, 4]);
    const ridge = reachable(game(['.^.'], units, { mods: [{ ignoreMoveCost: ['ridge', 'canopy'] }] }), 1);
    expect(xsOnRow(ridge), 'a hover unit still cannot climb').toEqual([0]);
    const scoped = reachable(game(['.fff.'], units, { mods: [{ ignoreMoveCost: ['canopy'], filter: { moveTypes: ['foot'] } }] }), 1);
    expect(xsOnRow(scoped), 'a modifier scoped to foot does not help hover').toEqual([0, 1, 2]);
  });

  it('feeds the same modifiers into checkPath', () => {
    const units: FixtureUnit[] = [{ type: 'lancer', owner: 0, x: 0, y: 0 }];
    const path = P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]); // 3 + 3 + 3 + 1 = 10 for hover
    const bare = game(['.fff.'], units);
    expectIllegal(() => checkPath(bare, unitOf(bare, 1), path), /not enough move points/);
    const co = game(['.fff.'], units, { mods: [{ ignoreMoveCost: ['canopy'] }] });
    expect(checkPath(co, unitOf(co, 1), path)).toMatchObject({ cost: 4, stop: 4, ambusher: null });
    const fast = game(['.......'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }], { mods: [{ move: 2 }] });
    expect(checkPath(fast, unitOf(fast, 1), P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0])).cost).toBe(5);
  });
});

describe('reachable: bad input', () => {
  it('returns nothing for an unknown id or a unit loaded in a transport', () => {
    const s = game(['...'], [{ type: 'mule', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 0, x: 1, y: 0 }]);
    const loaded: GameState = {
      ...s,
      units: s.units.filter((u) => u.id === 1).map((mule) => ({ ...mule, cargo: [unitOf(s, 2)] })),
    };
    expect(reachable(loaded, 2).size, 'cargo').toBe(0);
    expect(reachable(loaded, 99).size, 'unknown').toBe(0);
    expect(reachable(loaded, 1).size, 'the carrying mule still moves').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- checkPath() (DONE 3)

describe('checkPath: accepted paths', () => {
  it('returns cost, stop and no ambusher for a legal path', () => {
    const s = game(['.f..'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }]);
    expect(checkPath(s, unitOf(s, 1), P([0, 0], [1, 0], [2, 0]))).toEqual({ cost: 4, stop: 2, ambusher: null });
    expect(checkPath(s, unitOf(s, 1), P([0, 0]))).toEqual({ cost: 0, stop: 0, ambusher: null });
  });

  it('accepts exactly move points and exactly charge, and passes through allies and teammates', () => {
    const s = game(['.ff....'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }]);
    expect(checkPath(s, unitOf(s, 1), P([0, 0], [1, 0], [2, 0])).cost).toBe(6);
    const charged = patch(game(['.....'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }]), 1, { charge: 2 });
    expect(checkPath(charged, unitOf(charged, 1), P([0, 0], [1, 0], [2, 0])).stop).toBe(2);
    const crowd = game(['....'], [
      { type: 'trooper', owner: 0, x: 0, y: 0 },
      { type: 'lancer', owner: 0, x: 1, y: 0 },
      { type: 'lancer', owner: 1, x: 2, y: 0 },
    ], { sameTeam: true });
    expect(checkPath(crowd, unitOf(crowd, 1), P([0, 0], [1, 0], [2, 0], [3, 0])).cost).toBe(3);
  });
});

describe('checkPath: refused paths', () => {
  const rows = ['........', '.ff.....', '....^...', '.r......'];
  const world = () => game(rows, [
    { type: 'lancer', owner: 0, x: 0, y: 0 },
    { type: 'trooper', owner: 1, x: 3, y: 0 },
  ]);
  const check = (path: Coord[], s = world(), id = 1) => () => checkPath(s, unitOf(s, id), path);
  const empty = () => game(rows, [{ type: 'lancer', owner: 0, x: 0, y: 0 }]); // same map, no enemy in the way

  it('refuses a malformed path: empty, not starting at the unit, or containing a hole', () => {
    expectIllegal(check([]), /at least the starting tile/);
    expectIllegal(check(undefined as unknown as Coord[]), /at least the starting tile/);
    expectIllegal(check(P([1, 0], [2, 0])), /start at the unit/);
    expectIllegal(check([null as unknown as Coord]), /start at the unit/); // must be an IllegalActionError, never a TypeError
    expectIllegal(check([{ x: 0, y: 0 }, null as unknown as Coord]), /leaves the map/);
  });

  it('refuses steps that are not orthogonally adjacent, and revisited tiles', () => {
    expectIllegal(check(P([0, 0], [1, 1])), /orthogonally adjacent/);
    expectIllegal(check(P([0, 0], [2, 0])), /orthogonally adjacent/);
    expectIllegal(check(P([0, 0], [0, 0])), /orthogonally adjacent/); // standing still is not a step
    expectIllegal(check(P([0, 0], [1, 0], [0, 0])), /revisit/);
    expectIllegal(check(P([0, 0], [0, 1], [1, 1], [1, 0], [0, 0])), /revisit/);
  });

  it('refuses a path that leaves the map, on every side, or uses fractional or invalid coordinates', () => {
    const s = empty();
    expectIllegal(check(P([0, 0], [-1, 0]), s), /leaves the map/);
    expectIllegal(check(P([0, 0], [0, -1]), s), /leaves the map/);
    expectIllegal(check(P(...range(9).map((x): [number, number] => [x, 0])), s), /leaves the map/); // x = 8 on an 8-wide map
    expectIllegal(check(P([0, 0], [0, 1], [0, 2], [0, 3], [0, 4]), s), /leaves the map/); // y = 4 on a 4-high map
    expectIllegal(check([{ x: 0, y: 0 }, { x: 0.5, y: 0 }], s), /leaves the map/);
    expectIllegal(check([{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }], s), /leaves the map/);
  });

  it('refuses terrain the unit\'s movement type cannot enter', () => {
    expectIllegal(check(P([0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2])), /lancer cannot enter ridge/);
    const rivers = game(['.r.'], [{ type: 'bastion', owner: 0, x: 0, y: 0 }]);
    expectIllegal(check(P([0, 0], [1, 0]), rivers), /bastion cannot enter river/);
    const seas = game(['.~.'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }]);
    expectIllegal(check(P([0, 0], [1, 0]), seas), /trooper cannot enter sea/);
  });

  it('refuses more cost than move points, by exactly one point', () => {
    const s = game(['.ff....'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }]);
    expect(checkPath(s, unitOf(s, 1), P([0, 0], [1, 0], [2, 0])).cost).toBe(6);
    expectIllegal(() => checkPath(s, unitOf(s, 1), P([0, 0], [1, 0], [2, 0], [3, 0])), /not enough move points/);
    const foot = game(['.r.r.'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }]);
    expect(checkPath(foot, unitOf(foot, 1), P([0, 0], [1, 0])).cost).toBe(2);
    expectIllegal(() => checkPath(foot, unitOf(foot, 1), P([0, 0], [1, 0], [2, 0], [3, 0])), /not enough move points/); // 2 + 1 + 2
  });

  it('refuses more steps than charge, by exactly one step, even when the cost is within move points', () => {
    const s = patch(game(['.....'], [{ type: 'lancer', owner: 0, x: 0, y: 0 }]), 1, { charge: 2 });
    expect(checkPath(s, unitOf(s, 1), P([0, 0], [1, 0], [2, 0])).stop).toBe(2);
    expectIllegal(() => checkPath(s, unitOf(s, 1), P([0, 0], [1, 0], [2, 0], [3, 0])), /not enough charge/);
    const empty = patch(s, 1, { charge: 0 });
    expectIllegal(() => checkPath(empty, unitOf(empty, 1), P([0, 0], [1, 0])), /not enough charge/);
  });

  it('refuses to pass through, or end on, a visible enemy', () => {
    expectIllegal(check(P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0])), /blocked by an enemy/);
    expectIllegal(check(P([0, 0], [1, 0], [2, 0], [3, 0])), /blocked by an enemy/);
    // the same enemy one tile off the path does not matter
    expect(check(P([0, 0], [0, 1], [0, 2], [1, 2]))().stop).toBe(3);
    // fog on, enemy inside vision: still refused (the lancer sees 3 tiles)
    const fogged = game(rows, [{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 3, y: 0 }], { fog: true });
    expectIllegal(check(P([0, 0], [1, 0], [2, 0], [3, 0]), fogged), /blocked by an enemy/);
  });
});

describe('checkPath: ambush in the fog', () => {
  const eight = '........';
  it('stops on the tile before an unseen enemy and names the ambusher', () => {
    // lancer sees 3 tiles; the enemy at x=4 is unseen. The path runs through an ally and on past the enemy.
    const s = game([eight], [
      { type: 'lancer', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 0, x: 1, y: 0 },
      { type: 'trooper', owner: 1, x: 4, y: 0 },
    ], { fog: true });
    const r = checkPath(s, unitOf(s, 1), P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]));
    expect(r.stop).toBe(3);
    expect(r.ambusher?.id).toBe(3);
    expect(r.cost).toBe(6);
  });

  it('is the first unseen enemy that ambushes, and only if it is really unseen', () => {
    const two = game([eight], [
      { type: 'lancer', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 1, x: 4, y: 0 },
      { type: 'trooper', owner: 1, x: 5, y: 0 },
    ], { fog: true });
    const hit = checkPath(two, unitOf(two, 1), P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]));
    expect([hit.stop, hit.ambusher?.id]).toEqual([3, 2]);
    // without fog the same path is simply illegal
    const clear = game([eight], [{ type: 'lancer', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 4, y: 0 }], { fog: false });
    expectIllegal(() => checkPath(clear, unitOf(clear, 1), P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0])), /blocked by an enemy/);
  });

  it('hides an enemy on canopy at range 2, but not at range 1', () => {
    const far = game(['..f.....'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 2, y: 0 }], { fog: true });
    const r = checkPath(far, unitOf(far, 1), P([0, 0], [1, 0], [2, 0]));
    expect([r.stop, r.ambusher?.id]).toEqual([1, 2]);
    const near = game(['.f......'], [{ type: 'trooper', owner: 0, x: 0, y: 0 }, { type: 'trooper', owner: 1, x: 1, y: 0 }], { fog: true });
    expectIllegal(() => checkPath(near, unitOf(near, 1), P([0, 0], [1, 0])), /blocked by an enemy/);
  });

  it('backs up to the last free tile when the tile before the ambusher is occupied', () => {
    // With the real vision rules a friend standing next to a hidden enemy always sees it (vision is at least 1),
    // so this can only be reached with a vision grid that misses the enemy's tile: hand-made here.
    const s = game([eight], [
      { type: 'lancer', owner: 0, x: 0, y: 0 },
      { type: 'trooper', owner: 0, x: 1, y: 0 },
      { type: 'trooper', owner: 0, x: 2, y: 0 },
      { type: 'trooper', owner: 1, x: 3, y: 0 },
    ], { fog: true });
    const path = P([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]);
    expectIllegal(() => checkPath(s, unitOf(s, 1), path), /blocked by an enemy/); // real vision: the friend at 2 sees the enemy at 3
    vision.override = (st) => {
      const g = new Uint8Array(st.width * st.height);
      g[0] = g[1] = g[2] = 1; // the lancer's side sees x = 0..2 only
      return g;
    };
    const r = checkPath(s, unitOf(s, 1), path);
    expect([r.stop, r.ambusher?.id], 'tiles 2 and 1 hold friends, so the unit stays at its start').toEqual([0, 4]);
    const oneFriend = patch(s, 3, { x: 7 }); // friend at 2 moves away: only the friend at 1 is left on the path
    const r2 = checkPath(oneFriend, unitOf(oneFriend, 1), path);
    expect([r2.stop, r2.ambusher?.id]).toEqual([2, 4]);
  });
});

// ---------------------------------------------------------------- reachable() against a brute-force search (DONE 4)

function lcg(seed: number): () => number {
  let s = (Math.imul(seed, 2654435761) + 12345) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const MOVERS: UnitTypeId[] = ['trooper', 'breacher', 'skimmer', 'lancer', 'bastion', 'colossus', 'mule', 'arc', 'salvo', 'warden', 'wasp', 'raptor', 'picket', 'barge'];
const OTHERS: UnitTypeId[] = ['trooper', 'breacher', 'skimmer', 'lancer', 'bastion', 'colossus', 'mule', 'arc', 'wasp', 'picket', 'barge'];
const LAND_CODES = '....ffff^^rr=#sgg~D';
const SEA_CODES = '~~~~~sD.#';
const DIRS4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

interface Scenario { seed: number; state: GameState; mover: Unit }

function scenario(seed: number): Scenario {
  const rand = lcg(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
  const moverType = pick(MOVERS);
  const moveType = UNIT_TYPES[moverType].moveType;
  const sea = moveType === 'sea' || moveType === 'barge';
  const W = 5 + Math.floor(rand() * 4);
  const H = 5 + Math.floor(rand() * 3);
  const grid = Array.from({ length: H }, () => Array.from({ length: W }, () => pick([...(sea ? SEA_CODES : LAND_CODES)])));
  const taken = new Set<string>();
  const units: FixtureUnit[] = [];
  const place = (type: UnitTypeId, owner: number, hp?: number): boolean => {
    for (let tries = 0; tries < 80; tries++) {
      const x = Math.floor(rand() * W);
      const y = Math.floor(rand() * H);
      if (taken.has(key(x, y)) || expectedCost(TERRAIN_CODES[grid[y][x]], UNIT_TYPES[type].moveType) === null) continue;
      taken.add(key(x, y));
      units.push({ type, owner, x, y, hp });
      return true;
    }
    return false;
  };
  if (!place(moverType, 0)) {
    grid[0][0] = sea ? '~' : '.';
    taken.add(key(0, 0));
    units.push({ type: moverType, owner: 0, x: 0, y: 0 });
  }
  const extras = 3 + Math.floor(rand() * 5);
  for (let i = 0; i < extras; i++) {
    const r = rand();
    if (r < 0.25) place(moverType, 0, 1 + Math.floor(rand() * 10)); // possible join target
    else if (r < 0.45) place(pick(['mule', 'barge'] as const), 0); // possible transport
    else place(pick(OTHERS), rand() < 0.6 ? 1 : 0, 1 + Math.floor(rand() * 10));
  }
  const fog = rand() < 0.5;
  let state = createGame({ map: fixtureMap(grid.map((r) => r.join('')), units), players: TWO_PLAYERS, seed: 1, fog });
  if (rand() < 0.5) state = patch(state, 1, { charge: Math.floor(rand() * 7) });
  if ((moverType === 'mule' || moverType === 'barge') && rand() < 0.3) {
    const m = unitOf(state, 1);
    state = patch(state, 1, { cargo: [{ ...m, id: 900, type: 'trooper', cargo: [] }] });
  }
  return { seed, state, mover: unitOf(state, 1) };
}

/** Every stoppable tile and its cheapest cost, by depth-first search over all simple paths. Written from the rules. */
function bruteForce(state: GameState, mover: Unit): Map<string, number> {
  const moveType = UNIT_TYPES[mover.type].moveType;
  const mp = effectiveMove(state, mover);
  const at = new Map(state.units.map((u) => [key(u.x, u.y), u]));
  const best = new Map<string, number>();
  const visited = new Set<string>([key(mover.x, mover.y)]);
  const go = (x: number, y: number, cost: number, steps: number) => {
    const k = key(x, y);
    best.set(k, Math.min(best.get(k) ?? Infinity, cost));
    if (steps >= mover.charge) return;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height || visited.has(key(nx, ny))) continue;
      const c = expectedCost(state.tiles[ny][nx].terrain, moveType);
      if (c === null || cost + c > mp) continue;
      const occ = at.get(key(nx, ny));
      if (occ && occ.owner !== mover.owner && canSeeUnit(state, mover.owner, occ)) continue; // a visible enemy blocks passing and stopping
      visited.add(key(nx, ny));
      go(nx, ny, cost + c, steps + 1);
      visited.delete(key(nx, ny));
    }
  };
  go(mover.x, mover.y, 0, 0);
  for (const k of [...best.keys()]) {
    const occ = at.get(k);
    if (!occ || occ.id === mover.id) continue;
    if (occ.owner !== mover.owner) continue; // an unseen enemy looks like an empty tile: stoppable
    const mt = UNIT_TYPES[mover.type];
    const rides = occ.type === 'mule' ? mt.moveType === 'foot' || mt.moveType === 'exo' : occ.type === 'barge' && mt.domain === 'ground';
    const room = (occ.type === 'mule' ? 1 : 2) > occ.cargo.length;
    const loadable = (occ.type === 'mule' || occ.type === 'barge') && rides && room && mover.cargo.length === 0;
    const joinable = occ.type === mover.type && occ.hp <= 90 && mover.cargo.length === 0 && occ.cargo.length === 0;
    if (!loadable && !joinable) best.delete(k);
  }
  return best;
}

describe('reachable against a brute-force search', () => {
  const scenarios = range(120).map((i) => scenario(i + 1));

  it('finds exactly the stoppable tiles and cheapest costs on 120 random maps', () => {
    const seen = { lowCharge: 0, fogHidden: 0, load: 0, join: 0, blockedEnemy: 0, cargoMover: 0, tiles: 0 };
    for (const { seed, state, mover } of scenarios) {
      const got = reachable(state, mover.id);
      const want = bruteForce(state, mover);
      expect([...got.keys()].sort(), `seed ${seed}: tiles`).toEqual([...want.keys()].sort());
      for (const [k, cost] of want) expect(got.get(k)!.cost, `seed ${seed}: cost at ${k}`).toBe(cost);
      // coverage: the scenario mix must actually exercise the rules above
      if (mover.charge < effectiveMove(state, mover)) seen.lowCharge++;
      if (mover.cargo.length) seen.cargoMover++;
      for (const u of state.units) {
        if (u.id === mover.id) continue;
        if (u.owner !== mover.owner && !canSeeUnit(state, mover.owner, u)) seen.fogHidden++;
        if (u.owner !== mover.owner && canSeeUnit(state, mover.owner, u) && !got.has(key(u.x, u.y))) seen.blockedEnemy++;
        if (u.owner === mover.owner && got.has(key(u.x, u.y))) (u.type === mover.type ? seen.join++ : seen.load++);
      }
      seen.tiles += got.size;
    }
    for (const [what, n] of Object.entries(seen)) expect(n, `coverage: ${what}`).toBeGreaterThan(0);
  });

  it('gives every reachable entry a legal path that checkPath prices the same (DONE 4)', () => {
    let paths = 0;
    let ambushes = 0;
    for (const { seed, state, mover } of scenarios) {
      const moveType = UNIT_TYPES[mover.type].moveType;
      const ignore = new Set<TerrainId>();
      const mp = effectiveMove(state, mover);
      for (const e of reachable(state, mover.id).values()) {
        const label = `seed ${seed}, ${mover.type} to ${key(e.x, e.y)}`;
        // the path is a legal walk, priced from the spec table
        expect(e.path[0], label).toEqual({ x: mover.x, y: mover.y });
        expect(e.path[e.path.length - 1], label).toEqual({ x: e.x, y: e.y });
        expect(new Set(e.path.map((c) => key(c.x, c.y))).size, `${label}: no revisits`).toBe(e.path.length);
        let cost = 0;
        for (let i = 1; i < e.path.length; i++) {
          expect(Math.abs(e.path[i].x - e.path[i - 1].x) + Math.abs(e.path[i].y - e.path[i - 1].y), `${label}: adjacent`).toBe(1);
          cost += terrainMoveCost(state.tiles[e.path[i].y][e.path[i].x].terrain, moveType, ignore)!;
        }
        expect(cost, `${label}: path cost`).toBe(e.cost);
        expect(e.cost, label).toBeLessThanOrEqual(mp);
        expect(e.path.length - 1, `${label}: steps within charge`).toBeLessThanOrEqual(mover.charge);
        // checkPath accepts it at the same cost; an enemy the player cannot see on the way ends the move early there
        const r = checkPath(state, mover, e.path);
        expect(r.cost, `${label}: checkPath cost`).toBe(e.cost);
        const firstEnemy = e.path.findIndex((c, i) => i > 0 && state.units.some((u) => u.x === c.x && u.y === c.y && u.owner !== mover.owner));
        if (firstEnemy < 0) {
          expect([r.stop, r.ambusher], label).toEqual([e.path.length - 1, null]);
        } else {
          ambushes++;
          expect(r.stop, `${label}: ambushed`).toBe(firstEnemy - 1);
          expect(r.ambusher?.owner, label).not.toBe(mover.owner);
        }
        paths++;
      }
    }
    expect(paths, 'coverage: paths checked').toBeGreaterThan(1000);
    expect(ambushes, 'coverage: ambushes checked').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- performance (DONE 5)

describe('performance', () => {
  it('reachable() on a 30x20 mixed map with 40 units averages well under 10 ms (target 2 ms)', () => {
    const rand = lcg(7);
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
    const W = 30;
    const H = 20;
    const rows = Array.from({ length: H }, () => Array.from({ length: W }, () => pick([...'....ffff^rr=#sg'])).join(''));
    const types: UnitTypeId[] = ['trooper', 'breacher', 'skimmer', 'lancer', 'bastion', 'colossus', 'mule', 'arc', 'warden', 'raptor'];
    const units: FixtureUnit[] = [];
    const taken = new Set<string>();
    while (units.length < 40) {
      const type = pick(types);
      const x = Math.floor(rand() * W);
      const y = Math.floor(rand() * H);
      if (taken.has(key(x, y)) || !canStandOn(TERRAIN_CODES[rows[y][x]], UNIT_TYPES[type].moveType)) continue;
      taken.add(key(x, y));
      units.push({ type, owner: units.length % 2, x, y });
    }
    const report: string[] = [];
    for (const fog of [false, true]) {
      const state = createGame({ map: fixtureMap(rows, units), players: TWO_PLAYERS, seed: 1, fog });
      // the ten biggest movers of player 0: the slowest case for the search
      const movers = state.units.filter((u) => u.owner === 0).sort((a, b) => UNIT_TYPES[b.type].move - UNIT_TYPES[a.type].move).slice(0, 10);
      reachable(state, movers[0].id); // warm up
      const start = performance.now();
      let tiles = 0;
      for (let i = 0; i < 50; i++) tiles += reachable(state, movers[i % movers.length].id).size;
      const avg = (performance.now() - start) / 50;
      report.push(`${avg.toFixed(3)} ms ${fog ? 'with fog' : 'clear'} (${(tiles / 50).toFixed(0)} tiles per call)`);
      expect(tiles / 50, 'the searches found tiles to work on').toBeGreaterThan(20);
      expect(avg, `fog ${fog}`).toBeLessThan(10);
    }
    // worst case: a raptor (move 9, cost 1 everywhere) in the middle of an open map, so ~180 tiles come back per call
    const open = Array.from({ length: H }, () => '.'.repeat(W));
    const crowd = units.map((u, i) => ({ ...u, type: 'trooper' as const, x: (i * 7) % W, y: (i * 3) % H })).filter((u, i, all) => all.findIndex((o) => o.x === u.x && o.y === u.y) === i && !(u.x === 15 && u.y === 10));
    const wide = createGame({ map: fixtureMap(open, [{ type: 'raptor', owner: 0, x: 15, y: 10 }, ...crowd]), players: TWO_PLAYERS, seed: 1, fog: true });
    const t0 = performance.now();
    let widest = 0;
    for (let i = 0; i < 50; i++) widest += reachable(wide, 1).size;
    const worst = (performance.now() - t0) / 50;
    expect(widest / 50, 'the raptor covers a wide area').toBeGreaterThan(100);
    expect(worst, 'worst case').toBeLessThan(10);
    report.push(`${worst.toFixed(3)} ms for a raptor on open ground (${(widest / 50).toFixed(0)} tiles per call)`);
    console.log(`reachable(), 30x20 map, 40 units, 50 calls, average: ${report.join(', ')}`);
  });
});
