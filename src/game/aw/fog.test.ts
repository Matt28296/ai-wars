import { afterEach, describe, expect, it } from 'vitest';
import type { CommanderDef } from '../../content/types';
import { attackTargets, createGame, resetCommanderRegistry, setCommanderRegistry, visibility } from './index';
import type { PlayerSetup } from './index';
import { canSeeUnit, fogActive, visionGrid } from './fog';
import { fixtureGame, fixtureMap } from './testing';
import type { FixtureUnit } from './testing';
import type { GameState, Unit, UnitTypeId } from './types';

afterEach(() => resetCommanderRegistry());

const flats = (w: number, h: number) => Array.from({ length: h }, () => '.'.repeat(w));
const unit = (type: UnitTypeId, owner: number, x: number, y: number): FixtureUnit => ({ type, owner, x, y });

/** Every tile `player` sees, as "x,y" keys, read through the public visibility() grid. */
function seen(s: GameState, player = 0): Set<string> {
  const out = new Set<string>();
  visibility(s, player).forEach((row, y) => row.forEach((v, x) => v && out.add(`${x},${y}`)));
  return out;
}

/** The tiles a radius-r diamond around (cx, cy) covers on a w x h map, computed from the Manhattan definition. */
function diamond(cx: number, cy: number, r: number, w: number, h: number): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.abs(x - cx) + Math.abs(y - cy) <= r) out.add(`${x},${y}`);
  return out;
}

/** How far along a one-row map a lone unit at (0,0), standing on `ground`, sees (its vision radius). */
function reach(type: UnitTypeId, ground: string, opts: { weather?: 'ionstorm' } = {}): number {
  const s = fixtureGame([ground + '.'.repeat(13)], [unit(type, 0, 0, 0)], { fog: true, ...opts });
  const row = visibility(s, 0)[0];
  let far = -1;
  row.forEach((v, x) => { if (v) far = x; });
  return far;
}

/** The unit with the given owner, as the engine holds it in `state.units`. */
function ofOwner(s: GameState, owner: number): Unit {
  return s.units.find((u) => u.owner === owner)!;
}

const sharpEyes: CommanderDef = {
  id: 'sharp', name: 'Sharp', initials: 'SH', faction: null, title: 'test', pronouns: 'they/them', bio: '', voice: '',
  passive: { name: 'Far sight', description: 'test', modifiers: [{ vision: 2 }, { vision: 1, filter: { types: ['skimmer'] } }] },
  surge: null, overclock: null, lines: { select: '', victory: '', defeat: '' }, playable: false,
};

const THREE_WAY: PlayerSetup[] = [
  { faction: 'helion', commander: 'none', controller: 'ai', team: 0 },
  { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
  { faction: 'verdant', commander: 'none', controller: 'ai', team: 0 }, // player 2 is player 0's ally
];

describe('fogActive and the all-visible case', () => {
  it('is on for fog or an ion storm, off for clear weather without fog', () => {
    const open = flats(3, 3);
    expect(fogActive(fixtureGame(open))).toBe(false);
    expect(fogActive(fixtureGame(open, [], { fog: true }))).toBe(true);
    expect(fogActive(fixtureGame(open, [], { weather: 'ionstorm' }))).toBe(true);
    expect(fogActive(fixtureGame(open, [], { fog: true, weather: 'ionstorm' }))).toBe(true);
  });

  it('shows every tile, as a [y][x] grid, when fog is off', () => {
    const s = fixtureGame(flats(5, 3), [unit('trooper', 0, 0, 0), unit('trooper', 1, 4, 2)]);
    const v = visibility(s, 0);
    expect(v).toHaveLength(3); // rows are y
    expect(v.every((row) => row.length === 5)).toBe(true); // columns are x
    expect(v.flat().every(Boolean)).toBe(true);
    expect(visionGrid(s, 0)).toBeNull();
  });
});

describe('unit vision', () => {
  it('is the Manhattan diamond of the unit radius, per player, and hides the rest', () => {
    const s = fixtureGame(flats(9, 7), [unit('trooper', 0, 3, 4), unit('trooper', 1, 8, 0)], { fog: true });
    expect(seen(s, 0)).toEqual(diamond(3, 4, 2, 9, 7)); // trooper vision 2: 13 tiles
    expect(seen(s, 0).size).toBe(13);
    expect(seen(s, 1)).toEqual(diamond(8, 0, 2, 9, 7)); // clipped by the map edge
    expect(seen(s, 0).has('8,0')).toBe(false);
  });

  it('adds +3 on a ridge for foot and exo units only (D-012.2)', () => {
    expect(reach('trooper', '.')).toBe(2);
    expect(reach('trooper', '^')).toBe(5); // 2 + 3; the old +1 rule would give 3
    expect(reach('breacher', '^')).toBe(5); // exo: 2 + 3
    expect(reach('colossus', '^')).toBe(2); // walkers get nothing
    expect(reach('wasp', '^')).toBe(3); // neither do air units (vision 3)
  });

  it('applies commander vision modifiers, honouring their unit filter', () => {
    setCommanderRegistry({ sharp: sharpEyes });
    const players: PlayerSetup[] = [
      { faction: 'helion', commander: 'sharp', controller: 'ai', team: 0 },
      { faction: 'tidewell', commander: 'none', controller: 'ai', team: 1 },
    ];
    const probe = (type: UnitTypeId, owner: number) => {
      const map = fixtureMap(['.'.repeat(16)], [unit(type, owner, 0, 0)]);
      const s = createGame({ map, players, fog: true, seed: 1 });
      return Math.max(...visibility(s, owner)[0].map((v, x) => (v ? x : -1)));
    };
    expect(probe('trooper', 0)).toBe(4); // 2 + 2
    expect(probe('skimmer', 0)).toBe(8); // 5 + 2 + 1 (the filtered +1 applies to skimmers only)
    expect(probe('trooper', 1)).toBe(2); // the other player's commander has no modifiers
  });

  it('lowers every radius by 1 in an ion storm, never below 1', () => {
    expect(reach('skimmer', '.', { weather: 'ionstorm' })).toBe(4); // 5 - 1
    expect(reach('trooper', '.', { weather: 'ionstorm' })).toBe(1); // 2 - 1
    expect(reach('mule', '.', { weather: 'ionstorm' })).toBe(1); // 1 - 1 = 0, floored to 1
    expect(reach('trooper', '^', { weather: 'ionstorm' })).toBe(4); // 2 + 3 - 1
  });

  it('turns fog on in an ion storm even when the game has no fog', () => {
    const s = fixtureGame(flats(9, 1), [unit('trooper', 0, 0, 0)], { weather: 'ionstorm' });
    expect(s.fog).toBe(false);
    expect(seen(s, 0)).toEqual(new Set(['0,0', '1,0']));
  });
});

describe('what else lifts or shares the fog', () => {
  it('lets an owned property see its own tile and nothing around it', () => {
    const s = fixtureGame(['F...H', '.....', '....C'], [], { fog: true, owners: ['0...1', '.....', '.....'] });
    expect(seen(s, 0)).toEqual(new Set(['0,0'])); // own fabricator only; the enemy spire and neutral arcology stay dark
    expect(seen(s, 1)).toEqual(new Set(['4,0']));
  });

  it('shares vision and properties with allies but not with enemies', () => {
    const map = fixtureMap(['.........', '....F....'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 7, 0), unit('trooper', 2, 8, 0)], ['.........', '....2....']);
    const s = createGame({ map, players: THREE_WAY, fog: true, seed: 1 });
    const enemy = ofOwner(s, 1);
    expect(canSeeUnit(s, 0, enemy)).toBe(true); // only the ally at x=8 is close enough to see x=7
    expect(seen(s, 0).has('4,1')).toBe(true); // the ally's property, far from every unit
    expect(seen(s, 1).has('4,1')).toBe(false);
    const alone = createGame({ map: fixtureMap(['.........'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 7, 0)]), players: THREE_WAY, fog: true, seed: 1 });
    expect(canSeeUnit(alone, 0, ofOwner(alone, 1))).toBe(false); // known-bad: without the ally nobody sees it
  });

  it('shows everything to a team whose player has a reveal running, and only to that team', () => {
    const base = fixtureGame(flats(9, 1), [unit('trooper', 0, 0, 0), unit('trooper', 1, 8, 0)], { fog: true });
    const withReveal = (owner: number, turns: number): GameState => ({
      ...base, players: base.players.map((p) => (p.index === owner ? { ...p, revealTurns: turns } : p)),
    });
    const mine = withReveal(0, 2);
    expect(visionGrid(mine, 0)).toBeNull();
    expect(visibility(mine, 0).flat().every(Boolean)).toBe(true);
    expect(canSeeUnit(mine, 0, ofOwner(mine, 1))).toBe(true);
    expect(visionGrid(mine, 1)).not.toBeNull(); // the enemy is still in fog
    expect(canSeeUnit(mine, 1, ofOwner(mine, 0))).toBe(false);
    expect(visionGrid(withReveal(1, 2), 0)).not.toBeNull(); // the enemy's reveal does not help me
    expect(visionGrid(withReveal(0, 0), 0)).not.toBeNull(); // 0 turns left means over
  });
});

describe('hiding', () => {
  const lane = (terrain: string, enemy: UnitTypeId = 'trooper', extra: FixtureUnit[] = []) =>
    fixtureGame([terrain], [unit('trooper', 0, 0, 0), unit(enemy, 1, 2, 0), ...extra], { fog: true });

  it('hides a ground unit on canopy from distance 2, though the tile is inside vision', () => {
    const hidden = lane('..f..');
    expect(canSeeUnit(hidden, 0, ofOwner(hidden, 1))).toBe(false);
    expect(visibility(hidden, 0)[0][2]).toBe(false);
    const open = lane('.....'); // same lane on flats
    expect(canSeeUnit(open, 0, ofOwner(open, 1))).toBe(true);
    expect(visibility(open, 0)[0][2]).toBe(true);
  });

  it('shows a unit on canopy once any observer is adjacent, whichever side of it', () => {
    const adjacent = fixtureGame(['.f...'], [unit('trooper', 0, 0, 0), unit('trooper', 1, 1, 0)], { fog: true });
    expect(canSeeUnit(adjacent, 0, ofOwner(adjacent, 1))).toBe(true);
    const flanked = lane('..f..', 'trooper', [unit('mule', 0, 3, 0)]); // the mule is 3 away from the trooper and 1 from the canopy
    expect(canSeeUnit(flanked, 0, ofOwner(flanked, 1))).toBe(true);
  });

  it('does not hide units on ridge, shoal or flats, and never hides your own', () => {
    for (const ground of ['..^..', '..s..']) {
      const s = lane(ground);
      expect(canSeeUnit(s, 0, ofOwner(s, 1)), ground).toBe(true);
    }
    const own = fixtureGame(['..f..'], [unit('trooper', 0, 0, 0), unit('trooper', 0, 2, 0), unit('trooper', 1, 4, 0)], { fog: true });
    expect(canSeeUnit(own, 0, own.units.find((u) => u.x === 2)!)).toBe(true);
  });

  it('lets an air unit over canopy be seen by plain vision, which the tile grid cannot say', () => {
    const near = lane('..f..', 'wasp');
    expect(canSeeUnit(near, 0, ofOwner(near, 1))).toBe(true); // distance 2, inside vision 2
    expect(visibility(near, 0)[0][2]).toBe(false); // the grid still hides ground units on that tile
    const far = fixtureGame(['....f'], [unit('trooper', 0, 0, 0), unit('wasp', 1, 4, 0)], { fog: true });
    expect(canSeeUnit(far, 0, ofOwner(far, 1))).toBe(false); // outside vision: still unseen
  });

  it('shows a stealthed unit only to an adjacent enemy, with fog on or off', () => {
    const stealth = (fog: boolean, x: number): GameState => {
      const s = fixtureGame(flats(5, 1), [unit('trooper', 0, 0, 0), unit('trooper', 1, x, 0)], { fog });
      return { ...s, units: s.units.map((u) => (u.owner === 1 ? { ...u, hidden: true } : u)) };
    };
    for (const fog of [true, false]) {
      const adjacent = stealth(fog, 1);
      const apart = stealth(fog, 2);
      expect(canSeeUnit(adjacent, 0, ofOwner(adjacent, 1)), `adjacent, fog ${fog}`).toBe(true);
      expect(canSeeUnit(apart, 0, ofOwner(apart, 1)), `two away, fog ${fog}`).toBe(false);
    }
    const apart = stealth(true, 2);
    expect(canSeeUnit(apart, 1, ofOwner(apart, 0))).toBe(true); // the plain unit is seen by the stealthed side as usual
    expect(canSeeUnit(apart, 1, ofOwner(apart, 1))).toBe(true); // a team sees its own stealthed unit
  });

  it('agrees with visibility() on ordinary tiles for every tile of an open field', () => {
    const s = fixtureGame(flats(8, 4), [unit('skimmer', 0, 2, 1), unit('trooper', 1, 0, 0)], { fog: true });
    const grid = visionGrid(s, 0)!;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        const probe: Unit = { id: 99, type: 'trooper', owner: 1, x, y, hp: 100, charge: 99, ammo: 0, acted: false, cargo: [] };
        expect(canSeeUnit(s, 0, probe), `${x},${y}`).toBe(visibility(s, 0)[y][x]);
        expect(canSeeUnit(s, 0, probe, grid), `${x},${y} with grid`).toBe(visibility(s, 0)[y][x]);
      }
    }
  });
});

describe('fog as combat sees it', () => {
  it('lets an arc fire at a ground target in view, but not at one hidden in canopy', () => {
    const arcAt = (terrain: string): number => {
      // The skimmer is the observer: it sees 3 tiles to the target at (2,0) without being next to it.
      const s = fixtureGame([terrain, '.....'], [unit('arc', 0, 0, 0), unit('skimmer', 0, 0, 1), unit('trooper', 1, 2, 0)], { fog: true });
      return attackTargets(s, 1, { x: 0, y: 0 }).length;
    };
    expect(arcAt('.....')).toBe(1);
    expect(arcAt('..f..')).toBe(0);
  });
});
