// DEV ONLY: the stage gallery (gallery-stage.html). The real StageRuntime with the real kits on a real map, for moments the demo match
// does not have: an ion storm, reduced motion, another map, the table alone. Not part of the build.
//
//   ?map=<id>            a skirmish or mission map (default calder-fields); the engine's greedy policy plays it so there are units to look at
//   ?weather=ionstorm    the weather (default clear)
//   ?step=<n>            the step shown (default 0, which plays the match intro unless reduced=1)
//   ?cycles=<n>          how many cycles the policy plays (default 3)
//   ?reduced=1           reduced motion
//   ?viewer=all|0|1      whose frame (default all)
//   ?zoom=<n>            press the zoom button n times
//   ?lone=table|storm    measure ONE piece alone through the real renderer: window.__lone = { drawCalls, triangles } (no stage)
// window.__ready is true once the first frames are up; window.__stage is the runtime (debug()).
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { MAPS } from '../../../content/maps';
import { MISSION_MAPS } from '../../../content/mission-maps';
import type { MapDef } from '../../../content/types';
import type { CreateGameOptions, FactionId, PlayerSetup, Weather } from '../../../game/aw';
import { simulate } from '../../../game/aw/sim';
import { demoSetup } from '../../watch/demo';
import { recordMatch, viewTimeline } from '../../watch/timeline';
import type { Viewer } from '../../watch/timeline';
import { StageRuntime } from './runtime';
import { createStormStatic } from './storm';
import { createTable } from './table';

declare global {
  interface Window { __ready?: boolean; __stage?: StageRuntime; __lone?: { drawCalls: number; triangles: number; what: string } }
}

const q = new URLSearchParams(location.search);
const mapId = q.get('map') ?? 'calder-fields';
const weather = (q.get('weather') ?? 'clear') as Weather;
const stepParam = Number(q.get('step') ?? 0);
const cycles = Number(q.get('cycles') ?? 3);
const reduced = q.get('reduced') === '1';
const viewerParam = q.get('viewer') ?? 'all';
const zoom = Number(q.get('zoom') ?? 0);
const lone = q.get('lone');

const map: MapDef = MAPS[mapId] ?? MISSION_MAPS[mapId];
if (!map) throw new Error(`gallery-stage: no map ${mapId}`);
const board = { width: map.terrain[0].length, height: map.terrain.length };
const host = document.getElementById('host') as HTMLElement;

if (lone) {
  // One piece through the real renderer, so the draw-call numbers are the GPU path's own (renderer.info), not a count of objects.
  const renderer = new WebGLRenderer({ antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  host.appendChild(renderer.domElement);
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(board.width / 2, 20, board.height / 2 + 14);
  camera.lookAt(new Vector3(board.width / 2, 0, board.height / 2));
  let triangles = 0;
  if (lone === 'table') {
    const t = createTable(board);
    scene.add(t.group);
    t.update(camera.position, 0, 0);
  } else {
    const s = createStormStatic(board, 1);
    scene.add(s.points);
    s.update(2, 1, false, window.innerHeight, 30);
  }
  renderer.info.reset();
  renderer.render(scene, camera);
  triangles = renderer.info.render.triangles;
  window.__lone = { what: lone, drawCalls: renderer.info.render.calls, triangles };
  window.__ready = true;
} else {
  const base = demoSetup();
  const factions: FactionId[] = ['helion', 'tidewell', 'verdant', 'kestrel'];
  const players: PlayerSetup[] = [];
  for (let i = 0; i < map.players; i++) {
    const p = base.players[i];
    players.push(p ?? { faction: factions[i], commander: 'none', controller: 'ai', team: i });
  }
  const setup: CreateGameOptions = { ...base, map, players, weather, startFunds: map.recommended?.startFunds ?? 1000 };
  const sim = simulate({ setup, seed: 11, maxCycles: cycles, policy: 'greedy' });
  const viewer: Viewer = viewerParam === 'all' ? 'all' : (Number(viewerParam) as Viewer);
  const timeline = viewTimeline(recordMatch(setup, sim.actions), viewer);
  const rt = new StageRuntime(host, { onDone: () => undefined, onOverlay: () => undefined, onFail: (r) => { console.error('stage failed:', r); } });
  window.__stage = rt;
  for (let i = 0; i < zoom; i++) rt.zoomStep(1);
  rt.setView({ timeline, step: Math.min(stepParam, timeline.last), plan: null, reducedMotion: reduced });
  window.__ready = true;
}
