// Ion-storm static (G8b, art-direction.md "Ion storm": drifting static particles): a few hundred pale flecks drifting over the board and
// flickering like a bad signal. ONE draw call (a single Points object), and no per-frame work on the CPU beyond five uniforms.
//
// It is drawn from a seed and the clock alone, like the effects kit: each fleck's start position, drift, size and flicker phase come
// from mulberry32(seed, index), and the vertex shader places it at `box.min + wrap(start + drift * t)`. The wrap is exact (a fleck that
// leaves the box on one side comes back on the other), and `particleAt` below is the same formula in plain maths, so a test can check
// where any fleck is at any time against the shader's own rule. Nothing here reads Math.random or the real clock.
//
// Reduced motion halves the number drawn (setDrawRange) and stops both the drift and the flicker, so the flecks hold still at a steady
// brightness: there is no flashing at all.
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector3 } from 'three';
import { Rng } from '../fx';
import type { Board } from './rig';

/** Flecks per tile of board, and the bounds on the whole count (a 23x23 map does not get four thousand). */
export const STORM_PER_TILE = 5;
export const STORM_MIN = 400;
export const STORM_MAX = 1400;
/** With reduced motion this fraction is drawn. */
export const STORM_REDUCED_DENSITY = 0.5;
/** The box the flecks live in: the board plus this much on every side, and from just above the ground to this height. */
export const STORM_REACH = 1.5;
export const STORM_FLOOR = 0.05;
export const STORM_CEILING = 3.2;
/** The mean drift in tiles per second (east, up, south); each fleck scales it by 0.5..1.5 and adds its own wobble. */
export const STORM_DRIFT = { x: 0.55, y: 0.05, z: 0.22 };
/** Fleck diameter range in world units; the shader turns it into pixels. */
export const STORM_SIZE = { min: 0.03, max: 0.07 };
/** The flicker changes this many times per second per fleck (each fleck on its own phase, so the field never pulses as a whole). */
export const STORM_FLICKER_HZ = 9;
const STORM_COLOR = 0xa9cbff;

export interface StormBox {
  min: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

export function stormBox(board: Board): StormBox {
  return {
    min: { x: -STORM_REACH, y: STORM_FLOOR, z: -STORM_REACH },
    size: { x: board.width + 2 * STORM_REACH, y: STORM_CEILING - STORM_FLOOR, z: board.height + 2 * STORM_REACH },
  };
}

/** How many flecks a board gets. */
export function stormCount(board: Board): number {
  return Math.max(STORM_MIN, Math.min(STORM_MAX, Math.round(board.width * board.height * STORM_PER_TILE)));
}

/** One fleck's fixed numbers: its start inside the box (relative to box.min), its drift, its flicker phase and its size. */
export interface Fleck {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  phase: number;
  size: number;
}

/** Fleck `i` of the storm with this seed. A pure function of (seed, i, box): the same inputs always give the same fleck. */
export function fleck(seed: number, i: number, box: StormBox): Fleck {
  const r = new Rng().reset((seed >>> 0) ^ Math.imul(i + 1, 0x9e3779b1));
  const k = (): number => 0.5 + r.next();
  return {
    x: r.next() * box.size.x, y: r.next() * box.size.y, z: r.next() * box.size.z,
    vx: STORM_DRIFT.x * k() * (r.next() < 0.15 ? -1 : 1), vy: STORM_DRIFT.y * (r.next() - 0.5) * 2, vz: STORM_DRIFT.z * k() * (r.next() < 0.5 ? -1 : 1),
    phase: r.next(),
    size: r.range(STORM_SIZE.min, STORM_SIZE.max),
  };
}

const wrap = (v: number, size: number): number => v - size * Math.floor(v / size);

/**
 * Where a fleck is at `timeSec`, in world coordinates, with the motion on (`motion` 1) or off (`motion` 0, reduced motion: it stays
 * where it started). This is the vertex shader's rule written in plain maths: box.min + wrap(start + drift * t).
 */
export function fleckAt(f: Fleck, box: StormBox, timeSec: number, motion = 1): { x: number; y: number; z: number } {
  const t = Number.isFinite(timeSec) ? timeSec * motion : 0;
  return {
    x: box.min.x + wrap(f.x + f.vx * t, box.size.x),
    y: box.min.y + wrap(f.y + f.vy * t, box.size.y),
    z: box.min.z + wrap(f.z + f.vz * t, box.size.z),
  };
}

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uMotion;
  uniform float uPxPerWorld;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxSize;
  attribute vec3 aDrift;
  attribute vec2 aFleck; // x: flicker phase 0..1, y: diameter in world units
  varying float vFlicker;
  float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
  void main() {
    float t = uTime * uMotion;
    vec3 p = position + aDrift * t;
    p = uBoxMin + (p - uBoxSize * floor(p / uBoxSize));
    // a flicker that changes ${STORM_FLICKER_HZ} times a second on each fleck's own phase; steady at 0.7 without motion
    float slot = floor(t * ${STORM_FLICKER_HZ}.0 + aFleck.x * 64.0);
    float on = hash(slot + aFleck.x * 977.0) > 0.4 ? 1.0 : 0.18;
    vFlicker = mix(0.7, on, uMotion);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.6, aFleck.y * uPxPerWorld / max(0.001, -mv.z));
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying float vFlicker;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.12, d) * vFlicker * uStrength;
    gl_FragColor = vec4(uColor, a); // additive blending multiplies by alpha itself
  }
`;

export interface StormStats {
  /** Flecks in the buffer, and how many are drawn now. */
  count: number;
  drawn: number;
  visible: boolean;
  /** Renderable objects this adds: 1 while it shows, 0 while it does not (never more than 1). */
  drawCalls: number;
}

export interface StormStatic {
  readonly points: Points;
  readonly box: StormBox;
  /**
   * `strength` is the storm's strength 0..1 (it fades in and out with the weather); nothing is drawn at 0. `viewportHeightPx` and
   * `fovDeg` size the flecks in pixels.
   */
  update(timeSec: number, strength: number, reduced: boolean, viewportHeightPx?: number, fovDeg?: number): void;
  stats(): StormStats;
  dispose(): void;
}

/** The drift attribute and the fleck attribute are filled from `fleck()`, so the buffers and the CPU mirror cannot disagree. */
export function createStormStatic(board: Board, seed: number): StormStatic {
  const count = stormCount(board);
  const box = stormBox(board);
  const pos = new Float32Array(count * 3);
  const drift = new Float32Array(count * 3);
  const info = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const f = fleck(seed, i, box);
    pos.set([f.x, f.y, f.z], i * 3);
    drift.set([f.vx, f.vy, f.vz], i * 3);
    info.set([f.phase, f.size], i * 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('aDrift', new BufferAttribute(drift, 3));
  geometry.setAttribute('aFleck', new BufferAttribute(info, 2));
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMotion: { value: 1 },
      uStrength: { value: 0 },
      uPxPerWorld: { value: 800 },
      uBoxMin: { value: new Vector3(box.min.x, box.min.y, box.min.z) },
      uBoxSize: { value: new Vector3(box.size.x, box.size.y, box.size.z) },
      uColor: { value: new Color(STORM_COLOR) },
    },
  });
  // The shader moves the flecks, so the positions in the buffer say nothing about where they are drawn: never cull it.
  const points = new Points(geometry, material);
  points.name = 'ion-storm-static';
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 4;
  let drawn = count;
  let disposed = false;

  return {
    points,
    box,
    update(timeSec, strength, reduced, viewportHeightPx = 800, fovDeg = 30) {
      if (disposed) return;
      const s = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
      points.visible = s > 0.01;
      if (!points.visible) return;
      drawn = reduced ? Math.floor(count * STORM_REDUCED_DENSITY) : count;
      geometry.setDrawRange(0, drawn);
      const u = material.uniforms;
      u.uTime.value = timeSec;
      u.uMotion.value = reduced ? 0 : 1;
      u.uStrength.value = s;
      u.uPxPerWorld.value = viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
    stats() {
      return { count, drawn: points.visible ? drawn : 0, visible: points.visible, drawCalls: points.visible ? 1 : 0 };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      points.removeFromParent();
    },
  };
}
