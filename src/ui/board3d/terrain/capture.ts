// Capture rings: a thin ring on the pad of every property that fills clockwise from north as its capture progresses (0..1). All rings are
// one mesh; each ring reads its tile's progress from a one-texel-per-tile map, so `setCapture` is a texture write, not a rebuild.
// A ring is drawn only while progress > 0, in warm amber with a bright leading edge: shape (an arc filling up) is the cue, not just hue.
import { BufferAttribute, BufferGeometry, DoubleSide, ShaderMaterial, type Texture } from 'three';
import type { Board } from './layout';
import { GRADE_GLSL, type TerrainUniforms } from './shading';

export const RING_INNER = 0.385;
export const RING_OUTER = 0.445;
const SEGMENTS = 40;

export function buildRings(board: Board): BufferGeometry | null {
  const pos: number[] = [];
  const ang: number[] = [];
  const tile: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const t of board.tiles) {
    if (!t.property) continue;
    const cx = t.x + 0.5;
    const cz = t.y + 0.5;
    const y = t.walk + 0.014;
    const tu = (t.x + 0.5) / board.width;
    const tv = (t.y + 0.5) / board.height;
    for (let s = 0; s <= SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2; // 0 at north, increasing clockwise seen from above
      const sx = Math.sin(a);
      const sz = -Math.cos(a);
      pos.push(cx + sx * RING_OUTER, y, cz + sz * RING_OUTER, cx + sx * RING_INNER, y, cz + sz * RING_INNER);
      ang.push(s / SEGMENTS, s / SEGMENTS);
      tile.push(tu, tv, tu, tv);
    }
    for (let s = 0; s < SEGMENTS; s++) {
      const o = base + s * 2;
      idx.push(o, o + 1, o + 3, o, o + 3, o + 2);
    }
    base += (SEGMENTS + 1) * 2;
  }
  if (!pos.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aA', new BufferAttribute(new Float32Array(ang), 1));
  g.setAttribute('aTile', new BufferAttribute(new Float32Array(tile), 2));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function createRingMaterial(u: TerrainUniforms, capMap: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uCapMap: { value: capMap }, uFogMap: u.uFogMap, uFogSize: u.uFogSize, uStorm: u.uStorm },
    vertexShader: /* glsl */ `
      attribute float aA;
      attribute vec2 aTile;
      varying float vA;
      varying vec2 vT;
      varying vec2 vXZ;
      void main() {
        vA = aA; vT = aTile; vXZ = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uCapMap;
      varying float vA;
      varying vec2 vT;
      varying vec2 vXZ;
      ${GRADE_GLSL}
      void main() {
        float p = texture2D( uCapMap, vT ).r;
        if ( p < 0.004 ) discard;
        bool filled = vA <= p;
        vec3 c = filled ? vec3( 1.0, 0.5, 0.08 ) * 1.25 : vec3( 0.07, 0.09, 0.13 );
        float a = filled ? 0.96 : 0.6;
        float lead = 1.0 - smoothstep( 0.0, 0.018, abs( vA - p ) );
        c = mix( c, vec3( 2.2, 2.0, 1.6 ), lead );
        a = max( a, lead );
        c = trnGrade( c, vXZ );
        gl_FragColor = vec4( c, a );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
}
