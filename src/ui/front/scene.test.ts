// The boards the front door shows, and the camera that looks at them, against facts worked out here from the raw map text.
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../content/maps';
import { MISSION_MAPS } from '../../content/mission-maps';
import { MISSIONS } from '../../content/missions';
import { TERRAIN_CODES, TERRAIN_TYPES, UNIT_TYPES } from '../../data';
import { BRIEFING_ORBIT, NARROW_ASPECT, TITLE_ORBIT, orbitDistance, orbitPose, shiftFor, yawAt } from './orbit';
import type { OrbitSpec } from './orbit';
import { missionScene } from './missionScene';
import { faceTheEnemy, headingToward, sceneFromMap, titleScene } from './scene';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticBoard } from './StaticBoard';
import { UNMARKED_PATH } from '../watch/kit/roles';

describe('heading toward the enemy', () => {
  it('snaps to the four compass directions, by the larger axis', () => {
    expect(headingToward({ x: 0, y: 0 }, { x: 9, y: 2 })).toBe(0);
    expect(headingToward({ x: 9, y: 0 }, { x: 0, y: 2 })).toBe(Math.PI);
    expect(headingToward({ x: 5, y: 0 }, { x: 4, y: 8 })).toBe(Math.PI / 2);
    expect(headingToward({ x: 5, y: 9 }, { x: 6, y: 1 })).toBe(-Math.PI / 2);
  });
  it('turns each owner toward the nearest other owner, and a lone owner east', () => {
    const units = [{ owner: 0, x: 1, y: 3 }, { owner: 0, x: 2, y: 4 }, { owner: 1, x: 10, y: 3 }, { owner: 1, x: 11, y: 5 }];
    expect(faceTheEnemy(units)).toEqual([0, 0, Math.PI, Math.PI]);
    expect(faceTheEnemy([{ owner: 2, x: 4, y: 4 }])).toEqual([0]);
  });
});

describe('the title skirmish', () => {
  const scene = titleScene();
  it('is Calder Fields with its own terrain', () => {
    const map = MAPS['calder-fields'];
    expect([scene.width, scene.height]).toEqual([map.terrain[0].length, map.terrain.length]);
    for (let y = 0; y < scene.height; y++) for (let x = 0; x < scene.width; x++) expect(scene.terrain[y][x]).toBe(TERRAIN_CODES[map.terrain[y][x]]);
  });
  it('shows all four colours, a handful of units in formation, none off the board and none on ground it cannot cross', () => {
    expect(new Set(scene.units.map((u) => u.faction))).toEqual(new Set(['helion', 'tidewell', 'kestrel', 'verdant']));
    expect(scene.units.length).toBeGreaterThanOrEqual(8);
    const seen = new Set<string>();
    for (const u of scene.units) {
      expect(u.x).toBeGreaterThanOrEqual(0); expect(u.x).toBeLessThan(scene.width);
      expect(u.y).toBeGreaterThanOrEqual(0); expect(u.y).toBeLessThan(scene.height);
      const cost = TERRAIN_TYPES[scene.terrain[u.y][u.x]].cost[UNIT_TYPES[u.type].moveType];
      expect(cost, `${u.faction} ${u.type} at ${u.x},${u.y} on ${scene.terrain[u.y][u.x]}`).not.toBeNull();
      expect(cost).not.toBeUndefined();
      expect(seen.has(`${u.x},${u.y}`), `two units on ${u.x},${u.y}`).toBe(false);
      seen.add(`${u.x},${u.y}`);
    }
  });
  it('draws Helion up on the west facing east and Tidewell on the east facing west', () => {
    for (const u of scene.units.filter((x) => x.faction === 'helion')) expect(u.heading).toBe(0);
    for (const u of scene.units.filter((x) => x.faction === 'tidewell')) expect(u.heading).toBe(Math.PI);
  });
});

describe('a mission\'s own board', () => {
  it('has the map\'s size, terrain, owners and units, for every mission', () => {
    for (const m of MISSIONS) {
      const map = MISSION_MAPS[m.mapId];
      const s = missionScene(m);
      expect([s.width, s.height], m.id).toEqual([map.terrain[0].length, map.terrain.length]);
      expect(s.weather, m.id).toBe(m.weather ?? 'clear');
      expect(s.factions, m.id).toEqual(m.players.map((p) => p.faction));
      expect(s.units.map((u) => [u.x, u.y, u.type]).sort(), m.id).toEqual(map.units.map((u) => [u.x, u.y, u.type]).sort());
      map.owners.forEach((row, y) => [...row].forEach((ch, x) => expect(s.owners[y][x], `${m.id} ${x},${y}`).toBe(ch === '.' ? null : Number(ch))));
    }
  });
  it('draws a side the mission does not name unmarked: mission 1\'s drones, and no other unit in the campaign (G16)', () => {
    const unmarked = MISSIONS.flatMap((m) => missionScene(m).units.filter((u) => u.unmarked).map((u) => `${m.id}:${u.faction}`));
    expect(unmarked.length).toBeGreaterThan(0);
    expect(new Set(unmarked)).toEqual(new Set(['first-light:choir']));
    const fl = MISSIONS.find((m) => m.id === 'first-light')!;
    expect(missionScene(fl).units.filter((u) => u.faction === 'choir').every((u) => u.unmarked), 'every drone').toBe(true);
    // known-bad twin: the same map without the mask marks every unit
    const map = MISSION_MAPS[fl.mapId];
    expect(sceneFromMap(map, fl.players.map((p) => p.faction)).units.some((u) => u.unmarked)).toBe(false);
  });
  it('the flat board behind the Deploy card draws the unmarked mark on exactly those counters (G16)', () => {
    const fl = MISSIONS.find((m) => m.id === 'first-light')!;
    const scene = missionScene(fl);
    const drones = scene.units.filter((u) => u.unmarked).length;
    const marks = (html: string): number => html.split(UNMARKED_PATH).length - 1;
    expect(marks(renderToString(createElement(StaticBoard, { scene }))), 'one mark per drone').toBe(drones);
    // known-bad twin: the same board without the flags draws no unmarked mark at all
    const plain = { ...scene, units: scene.units.map(({ unmarked: _u, ...u }) => u) };
    expect(marks(renderToString(createElement(StaticBoard, { scene: plain })))).toBe(0);
  });
  it('leaves out a unit whose owner has no faction, and refuses a code it does not know', () => {
    const map = MAPS['calder-fields'];
    expect(sceneFromMap(map, ['helion', null]).units.every((u) => u.faction === 'helion')).toBe(true);
    expect(sceneFromMap(map, ['helion', null]).units.length).toBe(map.units.filter((u) => u.owner === 0).length);
    expect(() => sceneFromMap({ ...map, terrain: ['Z'.repeat(14), ...map.terrain.slice(1)] }, ['helion', 'tidewell'])).toThrow(/unknown terrain code/);
  });
});

describe('the preview camera', () => {
  const board = { width: 14, height: 10 };
  const radius = Math.hypot(14, 10) / 2 + 0.6;
  const dist = (p: ReturnType<typeof orbitPose>): number => Math.hypot(p.position.x - p.target.x, p.position.y - p.target.y, p.position.z - p.target.z);

  it('sits at the distance that fits the board\'s circle in the picture, times the fill', () => {
    const spec: OrbitSpec = { ...TITLE_ORBIT, fill: 1 };
    const p = orbitPose(spec, board, 1.6, 0);
    // worked by hand: the circle of radius r just fits when r / distance = sin(half of the narrower field of view)
    const half = (spec.fovDeg * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(half) * 1.6);
    expect(p.distance).toBeCloseTo(radius / Math.sin(Math.min(half, halfH)), 6);
    expect(dist(p)).toBeCloseTo(p.distance, 6);
    expect(orbitPose({ ...spec, fill: 0.5 }, board, 1.6, 0).distance).toBeCloseTo(p.distance / 2, 6);
    expect(orbitDistance(10, 1.6, 30, 1)).toBeGreaterThan(orbitDistance(10, 1.6, 30, 0.6));
  });

  it('looks at the middle of the board from the pitch the spec gives, south of it at yaw 0', () => {
    const spec: OrbitSpec = { ...BRIEFING_ORBIT, swayDeg: 0, yawDeg: 0 };
    const p = orbitPose(spec, board, 1.6, 123);
    expect(p.target.x).toBeCloseTo(7, 9);
    expect(p.target.z).toBeCloseTo(5, 9);
    expect(p.position.x).toBeCloseTo(7, 9);
    expect(p.position.z).toBeGreaterThan(5);
    const ground = Math.hypot(p.position.z - p.target.z, p.position.x - p.target.x);
    expect(Math.atan2(p.position.y - p.target.y, ground)).toBeCloseTo((spec.pitchDeg * Math.PI) / 180, 6);
  });

  it('circles at the spin rate on the title and holds the same distance all the way round', () => {
    expect(yawAt(TITLE_ORBIT, 10) - yawAt(TITLE_ORBIT, 0)).toBeCloseTo(TITLE_ORBIT.spin * 10, 9);
    const d0 = dist(orbitPose(TITLE_ORBIT, board, 1.6, 0));
    for (const t of [5, 33, 77, 140]) expect(dist(orbitPose(TITLE_ORBIT, board, 1.6, t))).toBeCloseTo(d0, 6);
    // a quarter turn later the camera has really moved: it is no longer where it was
    const a = orbitPose(TITLE_ORBIT, board, 1.6, 0);
    const b = orbitPose(TITLE_ORBIT, board, 1.6, Math.PI / 2 / TITLE_ORBIT.spin);
    expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThan(5);
  });

  it('only sways on the briefing, never further than its swing', () => {
    const swing = (BRIEFING_ORBIT.swayDeg * Math.PI) / 180;
    for (let t = 0; t < 200; t += 3) expect(Math.abs(yawAt(BRIEFING_ORBIT, t) - (BRIEFING_ORBIT.yawDeg * Math.PI) / 180)).toBeLessThanOrEqual(swing + 1e-9);
  });

  it('is frozen at time 0: reduced motion is the same pose, not another one', () => {
    for (const spec of [TITLE_ORBIT, BRIEFING_ORBIT]) expect(orbitPose(spec, board, 1.6, 0)).toEqual(orbitPose(spec, board, 1.6, 0));
    expect(orbitPose(TITLE_ORBIT, board, 1.6, 0)).not.toEqual(orbitPose(TITLE_ORBIT, board, 1.6, 30));
  });

  it('uses the narrow framing on a tall picture and the wide one on a wide picture', () => {
    expect(shiftFor(TITLE_ORBIT, 1.6)).toEqual(TITLE_ORBIT.shift);
    expect(shiftFor(TITLE_ORBIT, NARROW_ASPECT - 0.01)).toEqual(TITLE_ORBIT.shiftNarrow);
    expect(shiftFor(TITLE_ORBIT, NARROW_ASPECT)).toEqual(TITLE_ORBIT.shift);
    // the words sit beside the board on a wide picture and under it on a tall one
    expect(TITLE_ORBIT.shift.x).toBeGreaterThan(0);
    expect(TITLE_ORBIT.shiftNarrow.y).toBeLessThan(0);
  });
});
