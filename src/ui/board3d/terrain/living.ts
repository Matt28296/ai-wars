// The living board (ORDER G11): light and wind that move across the diorama, so a still board under a sky feels alive. PURE (no three.js,
// no DOM): every number here is the single source for BOTH the shader (shading.ts and water.ts paste the GLSL this file generates) and the
// CPU mirror the tests check, so the two cannot drift apart by hand.
//
//   cloud shadows   2-5 tile soft patches, at most CLOUD_MAX (15%) darker, drifting with a fixed wind from the north-west across the whole
//                   board (props and water too). Off in an ion storm (the storm grade already darkens). Pure advection:
//                   field(p + wind * dt, t + dt) = field(p, t), so a screenshot at any time is a function of (position, time) alone.
//   wind on grass   a faint travelling brightness wave (WIND_AMP, a few percent) over flats and canopy; the trees' sway reads the same
//                   gust field, so a gust visibly rolls across the board and the wood leans with it.
//   caustics        a soft moving web of light on the shallows (shoal edges and the sea beside them), clipped to the shallow water.
//
// All of it is a function of world position and ONE clock (`uLive` in the shader). The clock stops when motion is switched off
// (`TerrainKit.setMotion(false)`, for reduced motion) and resumes where it stopped.
//
// ORDER OF OPERATIONS, and why it is not negotiable: the fog-of-war grade (shading.ts) runs first, the living multiplier second, and the
// multiplier is capped to [LIVE_FLOOR, LIVE_CEIL]. A cloud is therefore a plain scalar on the already graded colour, so it can never move a tile
// across the fog line: an unseen tile keeps its 45% brightness and 30% saturation times at most 15% less, and a seen tile keeps its full
// colour times at most 15% less, whatever the weather. (Folding the cloud into the fog map, or into the colour before the grade, is what would
// let a cloud make a seen tile read as hidden; the tests plant exactly that mistake and require it to fail.)

const TAU = Math.PI * 2;
const r5 = (v: number): number => Math.round(v * 1e5) / 1e5;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- the wind

/** The direction the air travels: from the north-west toward the south-east, the way the sun's shadows fall. World (x, z), unit length. */
export const WIND_DIR: readonly [number, number] = [r5(Math.SQRT1_2), r5(Math.SQRT1_2)];
/** Cloud shadows drift at this speed along the wind, in tiles per second: across a 25-tile board in about two minutes. */
export const CLOUD_SPEED = 0.22;
/** Gusts travel faster than clouds do. */
export const GUST_SPEED = 0.95;
/** The darkest a cloud shadow makes anything: 15% (the order's "at most about 15%"). */
export const CLOUD_MAX = 0.15;
/** Peak brightness swing of a gust over grass, either way: a few percent of value. */
export const WIND_AMP = 0.035;
/** Peak brightening of a caustic web on the shallows. */
export const CAUSTIC_AMP = 0.24;
/** The combined living multiplier never goes below this (cloud and wind together are capped at 15% darker) ... */
export const LIVE_FLOOR = 1 - CLOUD_MAX;
/** ... and never above this (a gust or a caustic on top of full light). */
export const LIVE_CEIL = 1.3;

/** The per-second drift of the cloud and gust patterns, along WIND_DIR. */
export const CLOUD_DRIFT: readonly [number, number] = [r5(WIND_DIR[0] * CLOUD_SPEED), r5(WIND_DIR[1] * CLOUD_SPEED)];
export const GUST_DRIFT: readonly [number, number] = [r5(WIND_DIR[0] * GUST_SPEED), r5(WIND_DIR[1] * GUST_SPEED)];

// ---------------------------------------------------------------- wave tables

/** One plane wave of a field: wave vector (radians per tile), phase and weight. The weights of a table sum to 1, so a field stays inside [-1, 1]. */
export interface Wave { kx: number; kz: number; phase: number; amp: number }

function wave(lambdaTiles: number, angleDeg: number, phase: number, amp: number): Wave {
  const k = TAU / lambdaTiles;
  const a = (angleDeg * Math.PI) / 180;
  return { kx: r5(k * Math.cos(a)), kz: r5(k * Math.sin(a)), phase: r5(phase), amp };
}

/** Cloud shadows: wavelengths of 4.6 to 11 tiles from every side, so patches come out 2-5 tiles across and nothing lines up into stripes. */
export const CLOUD_WAVES: readonly Wave[] = [
  wave(11.0, 20, 0.7, 0.24),
  wave(8.6, 78, 2.1, 0.20),
  wave(7.2, 135, 4.0, 0.18),
  wave(5.6, 47, 5.3, 0.14),
  wave(4.6, 108, 1.3, 0.12),
  wave(6.3, 165, 3.2, 0.12),
];
/** Where the cloud field turns into shadow: nothing below LO, the full CLOUD_MAX from HI up, a smooth edge between. */
export const CLOUD_LO = -0.03;
export const CLOUD_HI = 0.3;

/** Gusts: shorter waves leaning across the wind, so the fronts roll down the board in broken bands, never in one straight line. */
export const GUST_WAVES: readonly Wave[] = [
  wave(4.2, 45, 0.4, 0.28),
  wave(3.3, 18, 2.6, 0.20),
  wave(5.4, 72, 4.4, 0.20),
  wave(2.9, 38, 1.1, 0.16),
  wave(6.5, 60, 5.6, 0.16),
];

// ---------------------------------------------------------------- the CPU mirror (the shader's arithmetic, in doubles)

/** Sum of a wave table at world (x, z), advected along the wind by `drift` per second for `t` seconds. In [-1, 1]. */
export function waveField(waves: readonly Wave[], drift: readonly [number, number], x: number, z: number, t: number): number {
  const qx = x - drift[0] * t;
  const qz = z - drift[1] * t;
  let s = 0;
  for (const w of waves) s += w.amp * Math.sin(w.kx * qx + w.kz * qz + w.phase);
  return s;
}

/** Cloud cover in 0..1 at (x, z) and time t: 0 clear sky, 1 the heart of a shadow. */
export function cloudCover(x: number, z: number, t: number): number {
  return smoothstep(CLOUD_LO, CLOUD_HI, waveField(CLOUD_WAVES, CLOUD_DRIFT, x, z, t));
}

/**
 * How much darker a cloud makes the point, 0..CLOUD_MAX. `storm` is the ion-storm amount 0..1: the storm grade already darkens the board,
 * so the shadows fade out as the storm fades in and are gone at 1.
 */
export function cloudDarkening(x: number, z: number, t: number, storm = 0): number {
  return CLOUD_MAX * cloudCover(x, z, t) * (1 - clamp01(storm));
}

/** The gust at (x, z) and time t, in -1..1: the wind field the grass brightness and the trees' sway both read. */
export function gust(x: number, z: number, t: number): number {
  return waveField(GUST_WAVES, GUST_DRIFT, x, z, t);
}

/** Caustic web at (x, z), 0..1, on the live clock `t`. Three warped ridge families; bright where their lines cross. */
export function causticWeb(x: number, z: number, t: number): number {
  const px = x * 7;
  const pz = z * 7;
  const f1 = (px + 0.9 * Math.sin(pz * 0.8 + t * 0.7)) + t * 0.45;
  const f2 = (px * 0.5 + pz * 0.866 + 0.9 * Math.sin((px - pz) * 0.7 + t * 0.6)) - t * 0.38;
  const f3 = (-px * 0.5 + pz * 0.866 + 0.9 * Math.sin((px + pz) * 0.6 - t * 0.5)) + t * 0.31;
  const net = (1 - Math.abs(Math.sin(f1))) + (1 - Math.abs(Math.sin(f2))) + (1 - Math.abs(Math.sin(f3)));
  return smoothstep(1.35, 2.1, net);
}

/** Where a water point counts as shallow, 0..1: full at the waterline's edge, gone by `vShore` 0.8 (the water shader's own shore value). */
export function shallowWeight(shore: number): number {
  return (1 - smoothstep(0.3, 0.8, shore)) * smoothstep(0.02, 0.1, shore);
}

/**
 * The living multiplier the shader applies to the already fog-graded colour: cloud shadow, then the grass gust and the caustic web, capped to
 * [LIVE_FLOOR, LIVE_CEIL]. `gustValue` is already weighted by how grassy the point is (0 off grass); `causticValue` by how shallow it is.
 */
export function livingMultiplier(darkening: number, gustValue: number, causticValue: number): number {
  const m = (1 - darkening) * (1 + WIND_AMP * gustValue) * (1 + CAUSTIC_AMP * causticValue);
  return Math.min(LIVE_CEIL, Math.max(LIVE_FLOOR, m));
}

// ---------------------------------------------------------------- trees in the wind

/** How far a tree's top leans along the wind with a full gust, with no gust (a steady lean), across it, and its fine flutter: tiles, at a tree's top. */
export const SWAY_LEAN = 0.03;
export const SWAY_BIAS = 0.004;
export const SWAY_CROSS = 0.010;
export const SWAY_FLUTTER = 0.006;

/**
 * The world-space push (x, z) a tree gets, before it is turned into the tree's own frame. `gustValue` is the gust field AT THE TREE (-1..1), `t`
 * the living clock, `swP` the tree's own phase (from its position, so neighbours flutter out of step) and `swH` how high up the vertex is
 * (0 at the foot, 1 at the top of the crown, up to 1.4): the push grows with the square of it, so the foot stays planted.
 */
export function swayPush(gustValue: number, t: number, swP: number, swH: number): [number, number] {
  const along = (gustValue * SWAY_LEAN + SWAY_BIAS) * swH * swH;
  const across = Math.cos(t * 1.1 + swP * 1.3) * SWAY_CROSS * swH * swH;
  const flutter = Math.sin(t * 2.9 + swP * 2.0) * SWAY_FLUTTER * swH;
  return [WIND_DIR[0] * along - WIND_DIR[1] * across + flutter, WIND_DIR[1] * along + WIND_DIR[0] * across];
}

/**
 * A world push turned into an instance's local frame, from the first and third columns of its instance matrix (a heading about the vertical,
 * times a scale): exactly the shader's arithmetic. Every tree has its own random heading, so a push applied in local space would send each tree
 * a different way; this makes them all lean WITH the wind.
 */
export function swayToLocal(c0: readonly [number, number, number], c2: readonly [number, number, number], w: readonly [number, number]): [number, number] {
  return [
    (c0[0] * w[0] + c0[2] * w[1]) / (c0[0] * c0[0] + c0[1] * c0[1] + c0[2] * c0[2]),
    (c2[0] * w[0] + c2[2] * w[1]) / (c2[0] * c2[0] + c2[1] * c2[1] + c2[2] * c2[2]),
  ];
}

// ---------------------------------------------------------------- the clock

/**
 * The living clock. It follows the time the stage passes, until motion is switched off: then it holds, and when motion comes back it
 * carries on from where it stopped (no jump). Pure, so the freeze is tested without a renderer.
 */
export class LiveClock {
  private offset = 0;
  private t = 0;
  private moving = true;
  get motion(): boolean { return this.moving; }
  get time(): number { return this.t; }
  setMotion(on: boolean): void { this.moving = on; }
  /** Feed the stage's time; returns the living time. A non-finite time is ignored. */
  advance(timeSec: number): number {
    if (!Number.isFinite(timeSec)) return this.t;
    if (this.moving) this.t = timeSec - this.offset;
    else this.offset = timeSec - this.t;
    return this.t;
  }
}

// ---------------------------------------------------------------- GLSL generated from the same tables

const f5 = (v: number): string => v.toFixed(5);

function fieldFn(name: string, waves: readonly Wave[], drift: readonly [number, number]): string {
  const terms = waves
    .map((w) => `  s += ${f5(w.amp)} * sin( dot( q, vec2( ${f5(w.kx)}, ${f5(w.kz)} ) ) + ${f5(w.phase)} );`)
    .join('\n');
  return /* glsl */ `
float ${name}( vec2 xz ) {
  vec2 q = xz - vec2( ${f5(drift[0])}, ${f5(drift[1])} ) * uLive;
  float s = 0.0;
${terms}
  return s;
}`;
}

/** The live clock and the wind direction: declared once per shader (vertex and fragment alike). */
export const CLOCK_GLSL = /* glsl */ `
uniform float uLive;
const vec2 TRN_WIND = vec2( ${f5(WIND_DIR[0])}, ${f5(WIND_DIR[1])} );
`;

/** The gust field (-1..1), read by the trees' sway in the vertex shader and by the grass brightness in the fragment shader. Needs CLOCK_GLSL above it. */
export const GUST_GLSL = /* glsl */ `${fieldFn('trnGust', GUST_WAVES, GUST_DRIFT)}
`;

/**
 * The trees' sway, in the vertex shader of the lit tree AND of its shadow twin (so a tree's shadow sways with it): the gust field at the tree, pushed
 * along the wind in world space and turned into the instance's frame (`swayPush` and `swayToLocal` are the CPU mirrors). Leaves `swG`, the gust at
 * this tree, for the grass-brightness wave. Needs CLOCK_GLSL and GUST_GLSL above it.
 */
export const SWAY_GLSL = /* glsl */ `
#ifdef USE_INSTANCING
  float swH = clamp( transformed.y / 0.45, 0.0, 1.4 );
  vec2 swXZ = instanceMatrix[3].xz;
  float swG = trnGust( swXZ );
  float swP = swXZ.x * 1.9 + swXZ.y * 2.7;
  vec2 swW = TRN_WIND * ( swG * ${f5(SWAY_LEAN)} + ${f5(SWAY_BIAS)} ) * swH * swH
    + vec2( -TRN_WIND.y, TRN_WIND.x ) * cos( uLive * 1.1 + swP * 1.3 ) * ${f5(SWAY_CROSS)} * swH * swH
    + vec2( sin( uLive * 2.9 + swP * 2.0 ) * ${f5(SWAY_FLUTTER)} * swH, 0.0 );
  vec3 swC0 = instanceMatrix[0].xyz;
  vec3 swC2 = instanceMatrix[2].xyz;
  transformed.x += ( swC0.x * swW.x + swC0.z * swW.y ) / dot( swC0, swC0 );
  transformed.z += ( swC2.x * swW.x + swC2.z * swW.y ) / dot( swC2, swC2 );
#endif
`;

/** Cloud cover (0..1) and the combined multiplier, for the fragment shader. Needs CLOCK_GLSL's `uLive` and GRADE_GLSL's `uStorm` above it. */
export const CLOUD_GLSL = /* glsl */ `
${fieldFn('trnCloudField', CLOUD_WAVES, CLOUD_DRIFT)}
float trnCloud( vec2 xz ) {
  return smoothstep( ${f5(CLOUD_LO)}, ${f5(CLOUD_HI)}, trnCloudField( xz ) );
}
float trnLive( vec2 xz, float gustValue, float causticValue ) {
  float dark = ${f5(CLOUD_MAX)} * trnCloud( xz ) * ( 1.0 - uStorm );
  float m = ( 1.0 - dark ) * ( 1.0 + ${f5(WIND_AMP)} * gustValue ) * ( 1.0 + ${f5(CAUSTIC_AMP)} * causticValue );
  return clamp( m, ${f5(LIVE_FLOOR)}, ${f5(LIVE_CEIL)} );
}
`;

/** The caustic web and the shallow clip, for the water shader. */
export const CAUSTIC_GLSL = /* glsl */ `
float trnCaustic( vec2 xz ) {
  vec2 p = xz * 7.0;
  float t = uLive;
  float f1 = ( p.x + 0.9 * sin( p.y * 0.8 + t * 0.7 ) ) + t * 0.45;
  float f2 = ( p.x * 0.5 + p.y * 0.866 + 0.9 * sin( ( p.x - p.y ) * 0.7 + t * 0.6 ) ) - t * 0.38;
  float f3 = ( -p.x * 0.5 + p.y * 0.866 + 0.9 * sin( ( p.x + p.y ) * 0.6 - t * 0.5 ) ) + t * 0.31;
  float net = ( 1.0 - abs( sin( f1 ) ) ) + ( 1.0 - abs( sin( f2 ) ) ) + ( 1.0 - abs( sin( f3 ) ) );
  return smoothstep( 1.35, 2.1, net );
}
float trnShallow( float shore ) {
  return ( 1.0 - smoothstep( 0.3, 0.8, shore ) ) * smoothstep( 0.02, 0.1, shore );
}
`;
