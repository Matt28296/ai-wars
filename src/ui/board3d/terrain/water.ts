// Water for sea, river, shoal and the water under a span: one merged mesh at the water surface (-0.08), shaded by a patched
// MeshStandardMaterial so it still takes the scene's lights, shadows and fog-of-war grade.
//   per-vertex `aShore`  distance-like value, 0 at the waterline, growing into open water. It drives shallow-to-deep colour and the foam
//                        band, so foam hugs every wall, river bank and shoal edge without any per-tile special case in the shader;
//   waves/glints         animated normals (broad swell plus fine ripples) catch the key light as moving glints; rivers scroll their
//                        ripples along `aFlow`, so the current visibly runs down the channel;
//   caustics (G11)       a soft moving web of light on the shallows (shoal edges and the sea beside them, never rivers), clipped by the same
//                        `aShore` value to where the water is shallow, applied after the fog grade with the cloud shadows (living.ts).
import { BufferAttribute, BufferGeometry, MeshPhysicalMaterial } from 'three';
import { WATER_Y, shoreAt, type Board } from './layout';
import { patchMaterial, swap, type Shader, type TerrainUniforms } from './shading';

const WATER_VERT_PARS = /* glsl */ `
attribute float aShore;
attribute float aKind;
attribute vec2 aFlow;
varying float vShore;
varying float vKind;
varying vec2 vFlow;
varying vec2 vWp;
`;

const WATER_FRAG_PARS = /* glsl */ `
varying float vShore;
varying float vKind;
varying vec2 vFlow;
varying vec2 vWp;
float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wHash( i ), wHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wHash( i + vec2( 0.0, 1.0 ) ), wHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
const vec3 SEA_DEEP = vec3( 0.02, 0.085, 0.19 );
const vec3 SEA_SHAL = vec3( 0.07, 0.36, 0.42 );
const vec3 RIV_DEEP = vec3( 0.03, 0.17, 0.25 );
const vec3 RIV_SHAL = vec3( 0.10, 0.40, 0.42 );
`;

const WATER_COLOR = /* glsl */ `
#include <color_fragment>
{
  float t = uTime;
  vec2 wp = vWp;
  bool river = vKind > 0.5;
  float depth = smoothstep( 0.0, 0.6, vShore );
  vec3 col = mix( river ? RIV_SHAL : SEA_SHAL, river ? RIV_DEEP : SEA_DEEP, depth );
  float swell;
  if ( river ) {
    float along = dot( wp, vFlow ) * 7.0 - t * 1.3;
    float across = dot( wp, vec2( -vFlow.y, vFlow.x ) ) * 9.0;
    swell = wNoise( vec2( along, across ) ) * 0.6 + wNoise( vec2( along * 2.1 + 3.0, across * 1.7 ) ) * 0.4;
  } else {
    swell = wNoise( wp * 3.2 + vec2( t * 0.25, t * 0.18 ) ) * 0.6 + wNoise( wp * 7.0 - vec2( t * 0.3, -t * 0.22 ) ) * 0.4;
  }
  col *= 0.86 + 0.30 * swell;
  float fn = wNoise( wp * 11.0 + vec2( t * 0.35, -t * 0.2 ) );
  float band = 0.055 + 0.03 * sin( t * 1.6 + wp.x * 9.0 + wp.y * 7.0 );
  float foam = ( 1.0 - smoothstep( band * 0.35, band + 0.03 * fn, vShore ) ) * ( 0.6 + 0.4 * fn );
  float line = 1.0 - smoothstep( 0.0, 0.016, abs( vShore - ( 0.11 + 0.02 * sin( t * 1.1 + wp.x * 6.0 + wp.y * 4.0 ) ) ) );
  foam = max( foam, line * 0.4 * fn );
  col = mix( col, vec3( 0.92, 0.97, 1.0 ), clamp( foam, 0.0, 1.0 ) * 0.92 );
  diffuseColor.rgb = col;
}
`;

const WATER_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  float t = uTime;
  vec2 wp = vWp;
  vec2 g;
  if ( vKind > 0.5 ) {
    // River: ripples stretched along the current, scrolling with it.
    vec2 side = vec2( -vFlow.y, vFlow.x );
    vec2 q = vec2( dot( wp, vFlow ) * 5.0 - t * 1.5, dot( wp, side ) * 11.0 );
    vec2 gq = vec2( wNoise( q + vec2( 0.2, 0.0 ) ) - wNoise( q - vec2( 0.2, 0.0 ) ), wNoise( q + vec2( 0.0, 0.2 ) ) - wNoise( q - vec2( 0.0, 0.2 ) ) );
    g = vFlow * gq.x * 0.24 + side * gq.y * 0.2;
  } else {
    // Sea: two scales of drifting swell, as slopes of value noise, so the glitter breaks up organically rather than in a lattice.
    vec2 p1 = wp * 3.0 + vec2( t * 0.22, t * 0.15 );
    vec2 p2 = wp * 7.0 - vec2( t * 0.30, -t * 0.20 );
    vec2 g1 = vec2( wNoise( p1 + vec2( 0.2, 0.0 ) ) - wNoise( p1 - vec2( 0.2, 0.0 ) ), wNoise( p1 + vec2( 0.0, 0.2 ) ) - wNoise( p1 - vec2( 0.0, 0.2 ) ) );
    vec2 g2 = vec2( wNoise( p2 + vec2( 0.2, 0.0 ) ) - wNoise( p2 - vec2( 0.2, 0.0 ) ), wNoise( p2 + vec2( 0.0, 0.2 ) ) - wNoise( p2 - vec2( 0.0, 0.2 ) ) );
    g = g1 * 0.22 + g2 * 0.12;
  }
  normal = normalize( ( viewMatrix * vec4( normalize( vec3( -g.x, 1.0, -g.y ) ), 0.0 ) ).xyz );
}
`;

const WATER_GLINT = /* glsl */ `
#include <emissivemap_fragment>
{
  // Sparse sparkles: about one cell in sixty flashes a small disc, so the open water twinkles without snowing.
  vec2 gp = vWp * 26.0 + vec2( uTime * 0.5, -uTime * 0.35 );
  vec2 gi = floor( gp );
  float r = wHash( gi );
  float tw = step( 0.985, r ) * smoothstep( 0.30, 0.0, length( fract( gp ) - 0.5 ) ) * ( 0.5 + 0.5 * sin( uTime * 4.0 + r * 60.0 ) );
  totalEmissiveRadiance += vec3( 0.9, 0.95, 1.0 ) * tw * 0.9 * smoothstep( 0.12, 0.4, vShore );
}
`;

export function createWaterMaterial(u: TerrainUniforms): MeshPhysicalMaterial {
  // Physical (not Standard) only for `specularIntensity`: the key light's glitter on the ripples is kept gentle.
  const mat = new MeshPhysicalMaterial({ roughness: 0.24, metalness: 0, specularIntensity: 0.55 });
  patchMaterial(mat, u, {
    key: 'water',
    live: 'water',
    extra(shader: Shader) {
      const what = 'MeshPhysicalMaterial (water)';
      let vs = shader.vertexShader;
      vs = swap(vs, '#include <common>', `#include <common>\n${WATER_VERT_PARS}`, what);
      vs = swap(vs, '#include <begin_vertex>', '#include <begin_vertex>\nvShore = aShore; vKind = aKind; vFlow = aFlow; vWp = position.xz;', what);
      let fs = shader.fragmentShader;
      fs = swap(fs, '#include <common>', `#include <common>\n${WATER_FRAG_PARS}\nuniform float uTime;`, what);
      fs = swap(fs, '#include <color_fragment>', WATER_COLOR, what);
      fs = swap(fs, '#include <normal_fragment_maps>', WATER_NORMAL, what);
      fs = swap(fs, '#include <emissivemap_fragment>', WATER_GLINT, what);
      shader.vertexShader = vs;
      shader.fragmentShader = fs;
    },
  });
  return mat;
}

export interface WaterBuild { geometry: BufferGeometry | null; triangles: number }

export function buildWater(board: Board): WaterBuild {
  const pos: number[] = [];
  const shore: number[] = [];
  const kind: number[] = [];
  const flow: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const t of board.tiles) {
    if (!t.water) continue;
    const n = t.water.wide ? 4 : 8;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const v = j / n;
        pos.push(t.x + u, WATER_Y, t.y + v);
        shore.push(shoreAt(t, u, v));
        kind.push(t.water.kind === 'river' ? 1 : 0);
        flow.push(t.flow[0], t.flow[1]);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const A = base + j * (n + 1) + i; const B = A + 1; const D = A + n + 1; const C = D + 1;
        idx.push(A, D, C, A, C, B);
      }
    }
    base += (n + 1) * (n + 1);
  }
  if (!pos.length) return { geometry: null, triangles: 0 };
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('aShore', new BufferAttribute(new Float32Array(shore), 1));
  g.setAttribute('aKind', new BufferAttribute(new Float32Array(kind), 1));
  g.setAttribute('aFlow', new BufferAttribute(new Float32Array(flow), 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { geometry: g, triangles: idx.length / 3 };
}
