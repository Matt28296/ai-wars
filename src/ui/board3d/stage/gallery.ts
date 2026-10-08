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
//   ?plan=1              play the shown step's animation plan (its glides, shots, kills and powers) from the moment the page is ready; the
//                        clock is the page's own, so a test page can fake it and shoot any moment (dev shots use a manual clock)
//   ?level=overclock     with plan=1: make a power's cut-in an Overclock (the demo match only has Surges)
//   ?speed=1|2|4         with plan=1: the plan's speed (default 1)
//   ?probe=1             exposes window.__calls(): the draw calls and triangles of one frame, through the whole post chain and the scene alone
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
import { planTransition } from '../../watch/transition';
import type { Speed } from '../../watch/timing';
import { StageRuntime } from './runtime';
import { createStormStatic } from './storm';
import { createTable } from './table';

interface FrameCost { chain: { calls: number; triangles: number }; scene: { calls: number; triangles: number } }

declare global {
  interface Window { __ready?: boolean; __stage?: StageRuntime; __lone?: { drawCalls: number; triangles: number; what: string }; __calls?: () => FrameCost }
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
const playPlan = q.get('plan') === '1';
const planLevel = q.get('level');
const planSpeed = Number(q.get('speed') ?? 1) as Speed;

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
  const at = Math.min(stepParam, timeline.last);
  let plan = null;
  if (playPlan && at > 0) {
    const cur = timeline.steps[at];
    plan = planTransition(timeline.steps[at - 1].frame, cur.frame, cur.events, { speed: planSpeed, reducedMotion: reduced });
    if (plan.cutIn && (planLevel === 'surge' || planLevel === 'overclock')) plan.cutIn.level = planLevel;
  }
  rt.setView({ timeline, step: at, plan, reducedMotion: reduced });
  if (q.get('probe') === '1') {
    // The frame's draw calls, measured through the real renderer: autoReset is off so the passes of one composer frame add up.
    window.__calls = () => {
      const r = rt as unknown as { renderer: WebGLRenderer; composer: { render(dt: number): void }; scene: Scene; camera: PerspectiveCamera };
      r.renderer.info.autoReset = false;
      r.renderer.info.reset();
      r.composer.render(0.016);
      const chain = { calls: r.renderer.info.render.calls, triangles: r.renderer.info.render.triangles };
      r.renderer.info.reset();
      r.renderer.setRenderTarget(null);
      r.renderer.render(r.scene, r.camera);
      const scene = { calls: r.renderer.info.render.calls, triangles: r.renderer.info.render.triangles };
      r.renderer.info.autoReset = true;
      return { chain, scene };
    };
  }
  window.__ready = true;
}
