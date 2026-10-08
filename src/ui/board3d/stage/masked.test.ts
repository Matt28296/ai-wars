// G16: which players' units are drawn without a nation sigil, and why property banners may stay as they are. The stage draws a masked seat's
// units unmarked (units/), and leaves the terrain kit's property banners alone, which is only right while a masked side owns no property:
// a banner carries the nation's sigil, so a masked side that held one would show the name the mission keeps back. This file measures that
// on every mission's real deployed battle, step by step, not on the map's starting owners alone (a capture changes them).
import { describe, expect, it } from 'vitest';
import { MISSIONS } from '../../../content/missions';
import { MISSION_MAPS } from '../../../content/mission-maps';
import type { Mission } from '../../../content/types';
import type { PlayerIndex } from '../../../game/aw';
import { runDeploy } from '../../front/deploy';
import { seatsOfMission } from '../../front/seats';
import type { SeatPresentation } from '../../watch';
import { recordMatch, viewTimeline } from '../../watch/timeline';
import type { ViewFrame } from '../../watch/timeline';
import { maskedOwnersOf } from './masked';

const indices = (n: number): { index: PlayerIndex }[] => Array.from({ length: n }, (_, i) => ({ index: i }));

describe('maskedOwnersOf: the players whose nation the mission does not name', () => {
  it('mission 1 masks the drones (player 2) and nobody else', () => {
    const first = MISSIONS[0];
    expect(first.id).toBe('first-light');
    expect(maskedOwnersOf(seatsOfMission(first), indices(first.players.length))).toEqual([2]);
  });

  it('names exactly the seats the mission masks, for every mission of the campaign', () => {
    for (const m of MISSIONS) {
      const seats = seatsOfMission(m);
      const want = seats.flatMap((s, i) => (s.nation === 'masked' ? [i] : []));
      expect(maskedOwnersOf(seats, indices(m.players.length)), m.id).toEqual(want);
    }
    // and it is not "always none": at least one mission masks someone
    expect(MISSIONS.some((m) => maskedOwnersOf(seatsOfMission(m), indices(m.players.length)).length > 0)).toBe(true);
  });

  it('no seats at all (the demo, a view that names nobody) masks nobody', () => {
    expect(maskedOwnersOf(undefined, indices(3))).toEqual([]);
    expect(maskedOwnersOf([], indices(3))).toEqual([]);
    expect(maskedOwnersOf([undefined, undefined, undefined], indices(3))).toEqual([]);
  });

  it('known-bad: it follows the seat\'s index, not its place in the list or the nation (player 0 masked reads [0]; player 1 reads [1])', () => {
    const shown: SeatPresentation = { name: 'Rook Okafor', label: 'Rook', nation: 'shown', portrait: 'commander' };
    const masked: SeatPresentation = { name: 'Unmarked drones', label: 'Unmarked', nation: 'masked', portrait: 'unmarked' };
    expect(maskedOwnersOf([masked, shown, shown], indices(3))).toEqual([0]);
    expect(maskedOwnersOf([shown, masked, shown], indices(3))).toEqual([1]);
    expect(maskedOwnersOf([masked, shown, masked], indices(3))).toEqual([0, 2]);
    // a list shorter than the players: the seat that is not in it is shown
    expect(maskedOwnersOf([masked], indices(3))).toEqual([0]);
    // and players with sparse indices keep their own index
    expect(maskedOwnersOf([shown, shown, masked], [{ index: 2 }])).toEqual([2]);
  });
});

/** The property tiles (x, y, owner) a frame gives to any player in `masked`. */
function propertiesOwnedBy(frame: ViewFrame, masked: readonly PlayerIndex[]): string[] {
  const out: string[] = [];
  frame.tiles.forEach((row, y) => row.forEach((t, x) => { if (t.owner !== null && masked.includes(t.owner)) out.push(`${x},${y}:${t.owner}`); }));
  return out;
}

describe('the scan that says a masked side owns no property', () => {
  const frame = viewTimeline(recordMatch(runDeploy(MISSIONS[0]).setup, []), 'all').steps[0].frame;

  it('finds a planted owner, and finds none where there is none', () => {
    expect(propertiesOwnedBy(frame, [2])).toEqual([]);
    const planted: ViewFrame = { ...frame, tiles: frame.tiles.map((row, y) => (y === 3 ? row.map((t, x) => (x === 4 ? { ...t, owner: 2 } : t)) : row)) };
    expect(propertiesOwnedBy(planted, [2])).toEqual(['4,3:2']);
    expect(propertiesOwnedBy(planted, [0, 1]), 'the planted tile is player 2\'s, not 0\'s or 1\'s').not.toContain('4,3:2');
  });

  it('is not vacuous: the frames do carry owners (the other seats own properties on mission 1\'s map)', () => {
    expect(propertiesOwnedBy(frame, [0, 1]).length).toBeGreaterThan(0);
  });
});

// Deploying a mission plays the whole battle with Doctrine, which is slow on a big map, so only the missions with a masked seat are played
// (today: first-light). A later mission that masks a seat is picked up here by itself.
const masking = MISSIONS.filter((m) => seatsOfMission(m).some((s) => s.nation === 'masked'));

describe('a masked side owns no property, so the terrain kit\'s banners name no nation (Acts I to III, every mission with a masked seat)', () => {
  it('there is at least one such mission, and none of them is in Act IV (whose Choir is named)', () => {
    expect(masking.map((m) => m.id)).toContain('first-light');
    for (const m of masking) expect(m.act, `${m.id}: a seat masks a nation Act IV has named`).toBeLessThan(4);
  });

  it.each(masking.map((m) => [m.id, m] as const))('%s: the map starts it with none and the deployed battle never gives it one, at any step, from any viewer\'s frame', (_id, mission: Mission) => {
    const seats = seatsOfMission(mission);
    const masked = seats.flatMap((s, i) => (s.nation === 'masked' ? [i] : []));
    expect(masked.length).toBeGreaterThan(0);

    // the map's own starting owners ('.' neutral, a digit a player's property)
    const map = MISSION_MAPS[mission.mapId];
    for (const [y, row] of map.owners.entries()) {
      for (const [x, c] of [...row].entries()) expect(masked.includes(Number(c)) && c !== '.', `${mission.id} starts with ${c} owning ${x},${y}`).toBe(false);
    }

    // every step of the deployed battle, as the omniscient viewer and as each seat sees it
    const result = runDeploy(mission);
    const rec = recordMatch(result.setup, result.actions);
    let steps = 0;
    for (const viewer of ['all', ...mission.players.map((_, i) => i)] as const) {
      for (const step of viewTimeline(rec, viewer).steps) {
        steps += 1;
        expect(propertiesOwnedBy(step.frame, masked), `${mission.id} viewer ${String(viewer)} step ${step.index}`).toEqual([]);
      }
    }
    expect(steps, 'the scan covered real steps').toBeGreaterThan(mission.players.length + 1);
  });
});
