// The power sweep (G10): when a power activates, a band of the commander's faction light sweeps across the board while the 2D cut-in
// plays. It is gentle on Surge, strong on Overclock, and a plain fade under reduced motion.
//
// It is ONE extra mesh (a board-sized plane with a small additive shader), hidden whenever no power is running, so the stage's draw
// calls grow by one for those 2.2 seconds and by nothing otherwise. The band runs along the board in the direction the commander's own
// side faces. Everything it shows comes from the cut-in sample (the commander's faction and the level, and how far through the cut-in
// it is), so it scrubs and replays exactly. The pure parts (colour, strength, phase) are exported and tested; the mesh is built here.
import { AdditiveBlending, Color, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from 'three';
import type { FactionId, PlayerIndex } from '../../../game/aw';
import { FACTION_ACCENT } from '../palette';

export type PowerLevel = 'surge' | 'overclock';

/** One power running: whose (the faction colours the band, the player's side sets its direction), which level, and how far through the cut-in it is (0..1). */
export interface SweepSpec { faction: FactionId; player: PlayerIndex; level: PowerLevel; progress: number }

export const SWEEP = {
  /** `intensity` is the band's light, `width` its reach in tiles, `bands` how many cross; `wash` is the light of the plain fade used under reduced motion. */
  surge: { intensity: 0.5, width: 3.2, bands: 1, wash: 0.09 },
  overclock: { intensity: 1.0, width: 4.0, bands: 2, wash: 0.2 },
} as const;

/** The band's colour: the faction's bright accent. (The Choir's own colour is near black, which light cannot add to a scene.) */
export function sweepColor(faction: FactionId): number {
  return FACTION_ACCENT[faction];
}

/** How strong the light is for a level: Overclock is more than twice Surge. */
export function sweepIntensity(level: PowerLevel): number {
  return SWEEP[level].intensity;
}

/** The part of the cut-in the band is crossing the board in: after the DOM band has slid in, and done before it slides out. */
export const SWEEP_FROM = 0.06;
export const SWEEP_TO = 0.86;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const easeInOut = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

/** How far across the board the band is, 0 (off the starting edge) to 1 (off the far edge), for a progress through the cut-in. */
export function sweepPhase(progress: number): number {
  return easeInOut((progress - SWEEP_FROM) / (SWEEP_TO - SWEEP_FROM));
}

/** The fade a reduced-motion viewer gets in place of the sweep: in, hold, out, exactly 0 at both ends of the cut-in. */
export function fadeEnvelope(progress: number): number {
  const p = clamp01(progress);
  return Math.min(easeInOut(p / 0.2), easeInOut((1 - p) / 0.2));
}

export interface SweepBoard { width: number; height: number; /** +1 sweeps toward +X (east), -1 toward -X. */ direction: 1 | -1; reduced: boolean }

/** What the mesh is showing now, as plain numbers (the tests and the gallery read it). */
export interface SweepStats {
  visible: boolean;
  color: number;
  intensity: number;
  /** The band's centre along its axis, in world units (a band is on the board while this is between 0 and the board's width). */
  center: number;
  mode: 'band' | 'fade';
  bands: number;
  drawCalls: number;
}

/** The sheet's height over the ground: above ridges and low hulls, so it washes over them rather than hiding under them. */
export const SWEEP_Y = 0.32;
const PAD = 1;
/** Where the band's centre rests when there is no band (the fade): far off the board. */
export const OFF_BOARD = -1000;

const VERTEX = /* glsl */ `
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uCenter;
uniform float uDir;
uniform float uWidth;
uniform float uBands;
uniform float uFade;
uniform float uMode;
uniform vec2 uBoard;
varying vec2 vW;
void main() {
  vec2 e = min(vW, uBoard - vW);
  float inside = smoothstep(-0.2, 0.7, min(e.x, e.y));
  float prof = 1.0;
  if (uMode < 0.5) {
    // the band leans a little across the board (14 degrees); d is the distance ahead of its heart along its way
    float u = vW.x * 0.970 + vW.y * 0.242;
    float d = (u - uCenter) * uDir;
    float lead = exp(-pow(d / (uWidth * 0.2), 2.0));
    float tail = exp(d / (uWidth * 0.36));
    prof = d > 0.0 ? lead : tail;
    if (uBands > 1.5) {
      float d2 = d + uWidth * 0.8;
      float p2 = d2 > 0.0 ? exp(-pow(d2 / (uWidth * 0.12), 2.0)) : exp(d2 / (uWidth * 0.2));
      prof = max(prof, p2 * 0.7);
    }
    prof *= 0.92 + 0.08 * sin(vW.y * 38.0 + vW.x * 3.0);
  }
  float a = clamp(prof * inside * uFade, 0.0, 1.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * uIntensity, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class PowerSweep {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private state: SweepStats = { visible: false, color: 0, intensity: 0, center: OFF_BOARD, mode: 'band', bands: 1, drawCalls: 0 };
  private disposed = false;

  constructor() {
    const g = new PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: new Color(0xffffff) },
        uIntensity: { value: 0 },
        uCenter: { value: OFF_BOARD },
        uDir: { value: 1 },
        uWidth: { value: SWEEP.surge.width },
        uBands: { value: 1 },
        uFade: { value: 0 },
        uMode: { value: 0 },
        uBoard: { value: new Vector2(1, 1) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.mesh = new Mesh(g, m);
    this.mesh.name = 'power-sweep';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
  }

  /** Shows the sweep for a power running now over a board, or hides it (`spec` null). Safe to call every frame: it allocates nothing. */
  update(spec: SweepSpec | null, board: SweepBoard): void {
    if (this.disposed) return;
    const s = this.state;
    if (!spec) {
      this.mesh.visible = false;
      s.visible = false;
      s.drawCalls = 0;
      return;
    }
    const level = SWEEP[spec.level];
    const u = this.mesh.material.uniforms;
    const fade = fadeEnvelope(spec.progress);
    const reduced = board.reduced;
    const color = sweepColor(spec.faction);
    (u.uColor.value as Color).setHex(color);
    u.uBoard.value.x = board.width;
    u.uBoard.value.y = board.height;
    u.uDir.value = board.direction;
    u.uWidth.value = level.width;
    u.uBands.value = level.bands;
    u.uMode.value = reduced ? 1 : 0;
    // a plain fade keeps the light low: it washes the whole board instead of crossing it
    u.uIntensity.value = reduced ? level.wash : level.intensity;
    u.uFade.value = reduced ? fade : 1;
    // along the band's axis (x + 0.25 z, to the lean in the shader): from just off the near edge to just off the far one
    const span = board.width * 0.970 + board.height * 0.242 + level.width * 2;
    const from = board.direction > 0 ? -level.width : span - level.width;
    const center = reduced ? OFF_BOARD : from + board.direction * span * sweepPhase(spec.progress);
    u.uCenter.value = center;
    this.mesh.scale.set(board.width + PAD * 2, 1, board.height + PAD * 2);
    this.mesh.position.set(board.width / 2, SWEEP_Y, board.height / 2);
    // the band is drawn only while it is crossing: before it starts and after it has left it is off the board, and a plane that lights
    // nothing is not worth a pass over the whole board
    const phase = sweepPhase(spec.progress);
    const on = reduced ? fade > 0.003 : phase > 0 && phase < 1;
    this.mesh.visible = on;
    s.visible = on;
    s.color = color;
    s.intensity = u.uIntensity.value;
    s.center = center;
    s.mode = reduced ? 'fade' : 'band';
    s.bands = level.bands;
    s.drawCalls = on ? 1 : 0;
  }

  stats(): SweepStats {
    return { ...this.state };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}
