// The war-room table (G8b): what the diorama stands on. Three draw calls, all procedural (no texture is loaded):
//
//   plinth    a bevelled gunmetal frame round the board's edge on a wider base plate, with one thin line of NEUTRAL trim light inlaid in
//             the frame (neutral on purpose: faction colour belongs to the units and the properties, never to the furniture). One mesh:
//             flat-shaded bands with baked vertex colours (catch-light on the bevels, darker walls), lit by the stage's own lights, and a
//             per-vertex glow for the trim (a small patch of the standard material, `aGlow`).
//   tabletop  a big dark plane under everything with a faint square grid on the board's own tile lines (a heavier line every five tiles),
//             a soft contact shadow where the plinth meets it, and a radial falloff from deep navy near the board to near-black far away;
//             the grid fades out well before the colour does. Unlit: the board stays the brightest thing in the picture.
//   backdrop  a dome that follows the camera and fills only what nothing else covers (it is drawn at the far plane), with a vertical
//             gradient that starts from the tabletop's far colour, so there is no hard horizon at any zoom or pitch (the match intro
//             looks from a low angle). The falloff above is the visible "gradient backdrop"; the dome is its safety net.
//
// The table never reads the frame or the viewer: it is built from the board's size alone, so it cannot show anything fog should hide.
import {
  BackSide, BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial,
  SphereGeometry, Vector2, Vector3,
} from 'three';
import type { IUniform, Material } from 'three';
import { TILE } from '../contract';
import type { Board } from './rig';

/** The most draw calls the table may add. The stage's budget for it. */
export const TABLE_DRAW_CALL_BUDGET = 3;

/** Heights (world Y). The board's own rim runs from 0 at the top down to the board's underside at -0.5 (terrain BASE_Y). */
export const TABLE_Y = -0.62;
export const FRAME_TOP = -0.03;
export const PLATE_TOP = -0.34;
/** How far the frame and the base plate reach out from the board's edge, in tiles, and the size of their chamfers. */
export const FRAME_WIDTH = 0.42;
export const PLATE_WIDTH = 1.05;
export const CHAMFER = 0.06;
/** The trim line, inlaid in the frame: its inner and outer distance from the board edge. */
export const TRIM_FROM = 0.17;
export const TRIM_TO = 0.21;
/** Half the side of the tabletop plane. The falloff has reached the far colour long before the edge. */
export const TABLE_HALF = 70;

export const TRIM_COLOR = 0xb8d4ee;
export const TRIM_INTENSITY = 0.62;

/** The tabletop's colours: deep navy near the board, near-black far from it; the grid line colour. */
export const TABLE_NEAR = 0x101b2b;
export const TABLE_FAR = 0x05080d;
const GRID_COLOR = 0x6d93ba;
const STORM_NEAR = 0x15263b;
const STORM_FAR = 0x070d16;

// ---------------------------------------------------------------- the plinth mesh

interface Loop { inflate: number; y: number }

/** The four corners of the board's rectangle grown by `inflate` tiles on every side, at height y, clockwise from the north-west. */
function corners(board: Board, l: Loop): [number, number, number][] {
  const w = board.width * TILE;
  const h = board.height * TILE;
  const i = l.inflate;
  return [[-i, l.y, -i], [w + i, l.y, -i], [w + i, l.y, h + i], [-i, l.y, h + i]];
}

const OUT: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // outward normal (x, z) of the north, east, south and west edge

class PlinthBuilder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly color: number[] = [];
  readonly glow: number[] = [];
  triangles = 0;

  constructor(private readonly board: Board) {}

  /**
   * A band joining two loops round the board (a flat ring, a chamfer or a wall), as four mitred quads with flat normals pointing away
   * from the solid. `from` and `to` shade the two edges, so a bevel can catch the light along one of them.
   */
  band(a: Loop, b: Loop, from: number, to: number, glow = 0): void {
    const A = corners(this.board, a);
    const B = corners(this.board, b);
    const ca = new Color(from);
    const cb = new Color(to);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      const [p0, p1, p2, p3] = [A[k], A[k1], B[k1], B[k]];
      const cols = [ca, ca, cb, cb];
      // normal from the quad, flipped to point outward-and-up (the solid is inward and below every surface of this plinth)
      const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const v = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      n = n.map((c) => c / len);
      const hint = [OUT[k][0], 1, OUT[k][1]];
      const flip = n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0;
      const tri = flip ? [[0, 2, 1], [0, 3, 2]] : [[0, 1, 2], [0, 2, 3]];
      const nn = flip ? n.map((c) => -c) : n;
      const pts = [p0, p1, p2, p3];
      for (const t of tri) {
        for (const idx of t) {
          this.position.push(...pts[idx]);
          this.normal.push(...nn);
          this.color.push(cols[idx].r, cols[idx].g, cols[idx].b);
          this.glow.push(glow);
        }
        this.triangles++;
      }
    }
  }
}

// Gunmetal: a cool dark steel, lighter on the bevels where the sun catches the edge, darkest in the walls.
const STEEL_TOP = 0x121a28;
const STEEL_TOP_OUT = 0x182233;
const STEEL_BEVEL = 0x34465f;
const STEEL_WALL = 0x0d131c;
const STEEL_GROOVE = 0x080b11;

/** The plinth's geometry: one BufferGeometry, positions + flat normals + vertex colours + a glow attribute for the trim. */
export function buildPlinth(board: Board): { geometry: BufferGeometry; triangles: number } {
  const b = new PlinthBuilder(board);
  const F = FRAME_WIDTH;
  const P = PLATE_WIDTH;
  const c = CHAMFER;
  // the frame: flat top out to the chamfer, the chamfer, and the wall down to the base plate
  b.band({ inflate: 0, y: FRAME_TOP }, { inflate: TRIM_FROM - 0.02, y: FRAME_TOP }, STEEL_TOP, STEEL_TOP);
  b.band({ inflate: TRIM_FROM - 0.02, y: FRAME_TOP }, { inflate: TRIM_FROM, y: FRAME_TOP }, STEEL_GROOVE, STEEL_GROOVE);
  b.band({ inflate: TRIM_FROM, y: FRAME_TOP + 0.004 }, { inflate: TRIM_TO, y: FRAME_TOP + 0.004 }, STEEL_GROOVE, STEEL_GROOVE, 1); // dark base: the light comes from the glow alone
  b.band({ inflate: TRIM_TO, y: FRAME_TOP }, { inflate: TRIM_TO + 0.02, y: FRAME_TOP }, STEEL_GROOVE, STEEL_GROOVE);
  b.band({ inflate: TRIM_TO + 0.02, y: FRAME_TOP }, { inflate: F - c, y: FRAME_TOP }, STEEL_TOP, STEEL_TOP_OUT);
  b.band({ inflate: F - c, y: FRAME_TOP }, { inflate: F, y: FRAME_TOP - c }, STEEL_BEVEL, STEEL_TOP_OUT);
  b.band({ inflate: F, y: FRAME_TOP - c }, { inflate: F, y: PLATE_TOP }, STEEL_WALL, STEEL_WALL);
  // the base plate it stands on
  b.band({ inflate: F, y: PLATE_TOP }, { inflate: P - c, y: PLATE_TOP }, STEEL_TOP, STEEL_TOP_OUT);
  b.band({ inflate: P - c, y: PLATE_TOP }, { inflate: P, y: PLATE_TOP - c }, STEEL_BEVEL, STEEL_TOP_OUT);
  b.band({ inflate: P, y: PLATE_TOP - c }, { inflate: P, y: TABLE_Y }, STEEL_WALL, STEEL_WALL);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(b.position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(b.normal, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(b.color, 3));
  geometry.setAttribute('aGlow', new Float32BufferAttribute(b.glow, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, triangles: b.triangles };
}

/** The standard material with one addition: the trim's per-vertex glow (aGlow) is added to the emissive light. */
function plinthMaterial(): { material: MeshStandardMaterial; trim: IUniform<Color> } {
  const trim: IUniform<Color> = { value: new Color(TRIM_COLOR).multiplyScalar(TRIM_INTENSITY) };
  const material = new MeshStandardMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.5, metalness: 0.45 });
  material.name = 'table-plinth';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTrim = trim;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTrim;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uTrim * vGlow;');
  };
  material.customProgramCacheKey = () => 'table-plinth-v1';
  return { material, trim };
}

// ---------------------------------------------------------------- the tabletop and the backdrop

const TABLE_VERTEX = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vXZ = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const TABLE_FRAGMENT = /* glsl */ `
  uniform vec2 uHalfBoard;   // half the board's size in tiles (its centre is also its half size: the board starts at the origin)
  uniform vec3 uNear;
  uniform vec3 uFar;
  uniform vec3 uGrid;
  uniform float uBoost;
  varying vec2 vXZ;

  // one anti-aliased grid line per integer of v, thinning to nothing when the lines are closer than a pixel or two
  float gridLine(float v) {
    float w = max(fwidth(v), 1e-5);
    float d = abs(fract(v - 0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, w * 1.25, d);
    return line * (1.0 - smoothstep(0.22, 0.5, w));
  }

  void main() {
    vec2 q = abs(vXZ - uHalfBoard) - uHalfBoard;
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); // tiles from the board's edge (negative under it)
    float away = max(dist - ${PLATE_WIDTH.toFixed(2)}, 0.0);    // tiles from the plinth's base plate

    // deep navy near the board, falling to near-black; a contact shadow tucked against the plate
    float fall = 1.0 - exp(-away / 13.0);
    vec3 col = mix(uNear, uFar, fall);
    col *= 1.0 - 0.6 * exp(-away / 0.4);

    // the grid, on the board's own tile lines; a heavier line every five tiles; gone well before the colour is
    float minor = max(gridLine(vXZ.x), gridLine(vXZ.y));
    float major = max(gridLine(vXZ.x / 5.0), gridLine(vXZ.y / 5.0));
    float fade = exp(-away / 7.5) * smoothstep(0.0, 0.6, away);
    col += uGrid * (0.07 * minor + 0.16 * major) * fade;

    gl_FragColor = vec4(col * uBoost, 1.0);
  }
`;

const DOME_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vDir = w.xyz - cameraPosition;
    // at the far plane: the dome fills only the pixels nothing else has drawn, and costs no overdraw
    gl_Position = (projectionMatrix * viewMatrix * w).xyww;
  }
`;

const DOME_FRAGMENT = /* glsl */ `
  uniform vec3 uFar;
  uniform float uBoost;
  varying vec3 vDir;
  void main() {
    float h = normalize(vDir).y;
    // from the tabletop's far colour at the horizon, a touch darker and bluer overhead; nothing brighter than the table
    vec3 col = mix(uFar, uFar * vec3(0.7, 0.75, 0.9), smoothstep(0.0, 0.7, h));
    gl_FragColor = vec4(col * uBoost, 1.0);
  }
`;

// ---------------------------------------------------------------- the table

export interface TableStats {
  /** Renderable objects the table adds (each is one draw call; none casts a shadow). At most TABLE_DRAW_CALL_BUDGET. */
  drawCalls: number;
  triangles: number;
}

export interface TableView {
  readonly group: Group;
  /**
   * Follows the camera (the backdrop dome) and the weather: `storm` 0..1 (the storm mix) cools the colours, `flash` 0..1 (lightning)
   * lifts them for the moment of the strike.
   */
  update(cameraPosition: Vector3, storm: number, flash: number): void;
  stats(): TableStats;
  /** Geometries and materials this table made that have not been disposed. */
  live(): { geometries: number; materials: number };
  dispose(): void;
}

/** The renderable objects of a group, counted the way the renderer would draw them: one per Mesh, Points or Line, one per material of a multi-material one. */
export function countDrawCalls(root: Group): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!(m.isMesh || (o as { isPoints?: boolean }).isPoints || (o as { isLine?: boolean }).isLine) || !o.visible) return;
    n += Array.isArray(m.material) ? Math.max(1, m.material.length) : 1;
  });
  return n;
}

export function createTable(board: Board): TableView {
  const group = new Group();
  group.name = 'table';
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const own = <T extends BufferGeometry | Material>(x: T): T => {
    const set = (x as BufferGeometry).isBufferGeometry ? geometries : materials;
    set.add(x as never);
    x.addEventListener('dispose', () => set.delete(x as never));
    return x;
  };

  const w = board.width * TILE;
  const h = board.height * TILE;

  // plinth
  const built = buildPlinth(board);
  const plinthMat = plinthMaterial();
  const plinth = new Mesh(own(built.geometry), own(plinthMat.material));
  plinth.name = 'table-plinth';
  plinth.receiveShadow = true;
  plinth.castShadow = false;

  // tabletop: one big plane, the shader does the rest. The uniforms are shared with the dome so the two always agree.
  const uniforms = {
    uHalfBoard: { value: new Vector2(w / 2, h / 2) },
    uNear: { value: new Color(TABLE_NEAR) },
    uFar: { value: new Color(TABLE_FAR) },
    uGrid: { value: new Color(GRID_COLOR) },
    uBoost: { value: 1 },
  };
  const plane = own(new PlaneGeometry(TABLE_HALF * 2, TABLE_HALF * 2, 1, 1));
  plane.rotateX(-Math.PI / 2);
  const tableMat = own(new ShaderMaterial({ vertexShader: TABLE_VERTEX, fragmentShader: TABLE_FRAGMENT, uniforms }));
  tableMat.name = 'table-top';
  const top = new Mesh(plane, tableMat);
  top.name = 'table-top';
  top.position.set(w / 2, TABLE_Y, h / 2);
  top.receiveShadow = false;

  // backdrop dome
  const sphere = own(new SphereGeometry(5, 24, 12));
  const domeMat = own(new ShaderMaterial({
    vertexShader: DOME_VERTEX, fragmentShader: DOME_FRAGMENT, uniforms: { uFar: uniforms.uFar, uBoost: uniforms.uBoost },
    side: BackSide, depthWrite: false,
  }));
  domeMat.name = 'table-backdrop';
  const dome = new Mesh(sphere, domeMat);
  dome.name = 'table-backdrop';
  dome.frustumCulled = false;
  dome.renderOrder = 10; // after the opaque board: it only fills what is left at the far plane

  group.add(top, plinth, dome);
  const near = new Color();
  const far = new Color();
  let disposed = false;

  return {
    group,
    update(cameraPosition, storm, flash) {
      if (disposed) return;
      const s = Number.isFinite(storm) ? Math.max(0, Math.min(1, storm)) : 0;
      const f = Number.isFinite(flash) ? Math.max(0, Math.min(1, flash)) : 0;
      dome.position.copy(cameraPosition);
      uniforms.uNear.value.copy(near.set(TABLE_NEAR).lerp(far.set(STORM_NEAR), s));
      uniforms.uFar.value.copy(near.set(TABLE_FAR).lerp(far.set(STORM_FAR), s));
      uniforms.uBoost.value = 1 + 0.9 * f;
    },
    stats() {
      let triangles = 0;
      group.traverse((o) => {
        const g = (o as Mesh).geometry as BufferGeometry | undefined;
        if (g) triangles += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
      });
      return { drawCalls: countDrawCalls(group), triangles };
    },
    live() {
      return { geometries: geometries.size, materials: materials.size };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      for (const g of [...geometries]) g.dispose();
      for (const m of [...materials]) m.dispose();
    },
  };
}

