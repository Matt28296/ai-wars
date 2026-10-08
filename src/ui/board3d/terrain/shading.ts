// Shared shading for the terrain kit: the uniforms every terrain material reads (fog-of-war map, time, ion-storm amount), the shader
// patch that applies them, the lit-window textures and the material set.
//
// The low form of an occupied property is applied in the vertex shader of every merged prop (and its shadow twin): the vertex's tile is
// read from a one-texel-per-tile "low" map the kit eases on the CPU, and parts marked as sinking (geo.ts SINK_ATTR) squash toward the pad.
//
// One grade, applied to the final lit colour of every terrain material (so lit, emissive and shadowed parts all follow it):
//   fog of war   unseen tiles read at about 45% brightness and 30% saturation, with a soft 0.3-tile edge: the fog map has one texel
//                per tile and is filtered bilinearly, then smoothstepped, so the edge is 0.3 tile wide whatever the zoom;
//   ion storm    a cooler, darker, slightly desaturated tint, eased in and out by `uStorm`.
import {
  ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshDepthMaterial, MeshLambertMaterial, MeshStandardMaterial,
  RGBADepthPacking, RGBAFormat, RedFormat, RepeatWrapping, UnsignedByteType, Vector2,
  type IUniform, type MagnificationTextureFilter, type Material, type Texture,
} from 'three';
import { rngFrom } from './rng';

export type Shader = Parameters<Material['onBeforeCompile']>[0];

export interface TerrainUniforms {
  uFogMap: IUniform<Texture>;
  uFogSize: IUniform<Vector2>;
  uTime: IUniform<number>;
  uStorm: IUniform<number>;
  /** One texel per tile: 0 for a property in full form, 1 for a property in its low form (eased by the kit, nearest-filtered). */
  uOccMap: IUniform<Texture>;
}

/** An R8 texture with one texel per tile, linearly filtered and clamped at the board's edge. */
export function tileMap(width: number, height: number, fill: number, filter: MagnificationTextureFilter = LinearFilter): DataTexture {
  const t = new DataTexture(new Uint8Array(width * height).fill(fill), width, height, RedFormat, UnsignedByteType);
  t.minFilter = filter;
  t.magFilter = filter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function createUniforms(fog: Texture, width: number, height: number, occ: Texture): TerrainUniforms {
  return {
    uFogMap: { value: fog },
    uFogSize: { value: new Vector2(width, height) },
    uTime: { value: 0 },
    uStorm: { value: 0 },
    uOccMap: { value: occ },
  };
}

// ---------------------------------------------------------------- the low form of an occupied property

/** The height a property's tall parts shrink to while a unit stands on it, as a fraction of their full height above the pad. */
export const LOW_FORM = 0.25;
/** Seconds the change takes (the kit's `update` eases a tile toward its target over this long). */
export const LOW_EASE_SEC = 0.25;

/**
 * Where a vertex at height `y` lands: parts that sink (`sinks` = 1) squash toward `pivot` (the top of the pad) by `low`, 0 (full form) to
 * 1 (low form); parts that stay are untouched. This is the same arithmetic as SINK_GLSL, so tests and documentation can check it.
 */
export function lowFormY(y: number, sinks: number, pivot: number, low: number): number {
  if (sinks < 0.5) return y;
  return pivot + (y - pivot) * (1 - (1 - LOW_FORM) * low);
}

const SINK_DECL_GLSL = /* glsl */ `
attribute vec2 aSink;
uniform sampler2D uOccMap;
uniform vec2 uOccSize;
`;

const SINK_GLSL = /* glsl */ `
if ( aSink.x > 0.5 ) {
  float trnLow = texture2D( uOccMap, transformed.xz / uOccSize ).r;
  transformed.y = aSink.y + ( transformed.y - aSink.y ) * ( 1.0 - ${(1 - LOW_FORM).toFixed(2)} * trnLow );
}
`;

export const GRADE_GLSL = /* glsl */ `
uniform sampler2D uFogMap;
uniform vec2 uFogSize;
uniform float uStorm;
vec3 trnGrade( vec3 c, vec2 xz ) {
  float v = texture2D( uFogMap, xz / uFogSize ).r;
  float seen = smoothstep( 0.35, 0.65, v );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 hidden = mix( vec3( l ), c, 0.30 ) * 0.45;
  c = mix( hidden, c, seen );
  float l2 = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 storm = mix( vec3( l2 ), c, 0.80 ) * vec3( 0.66, 0.80, 1.0 ) * 0.80;
  return mix( c, storm, uStorm );
}
`;

const SWAY_GLSL = /* glsl */ `
#ifdef USE_INSTANCING
  float swH = clamp( transformed.y / 0.45, 0.0, 1.4 );
  float swP = instanceMatrix[3].x * 1.9 + instanceMatrix[3].z * 2.7;
  transformed.x += sin( uTime * 1.35 + swP ) * 0.022 * swH * swH + sin( uTime * 2.9 + swP * 2.0 ) * 0.006 * swH;
  transformed.z += cos( uTime * 1.1 + swP * 1.3 ) * 0.014 * swH * swH;
#endif
`;

const OBJECT_XZ_GLSL = /* glsl */ `
vec4 trnP = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  trnP = instanceMatrix * trnP;
#endif
vTrnXZ = trnP.xz;
`;

export interface PatchOpts {
  /** Program-cache key: patched variants must not share a program with anything else. */
  key: string;
  /** The material draws merged props: parts marked as sinking squash to their low form when their property is occupied. */
  sink?: boolean;
  /** Instanced foliage sways in the vertex shader. */
  sway?: boolean;
  /** The vertex colour is HDR emissive light (rails, beacons, cracks): the material's own diffuse is ignored. */
  glow?: boolean;
  /** Further edits (water). */
  extra?: (shader: Shader) => void;
}

/**
 * Replace the first occurrence of a shader-chunk anchor, or THROW if it is not there. A patch that silently matched nothing would ship a
 * board with no fog of war (and the tests run every patch against the real three.js shader templates, so an upgrade that renames a chunk
 * fails here, loudly, instead of in a player's browser).
 */
export function swap(src: string, anchor: string, replacement: string, what: string): string {
  if (!src.includes(anchor)) throw new Error(`terrain shader patch: ${anchor} not found in ${what}`);
  return src.replace(anchor, () => replacement);
}

/** Hook the fog-of-war and storm grade (and optional sway or glow) into a three.js lit material. */
export function patchMaterial(mat: Material, u: TerrainUniforms, o: PatchOpts): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFogMap = u.uFogMap;
    shader.uniforms.uFogSize = u.uFogSize;
    shader.uniforms.uStorm = u.uStorm;
    shader.uniforms.uTime = u.uTime;
    if (o.sink) {
      shader.uniforms.uOccMap = u.uOccMap;
      shader.uniforms.uOccSize = u.uFogSize;
    }
    const what = `${mat.type} (${o.key})`;
    let vs = shader.vertexShader;
    vs = swap(vs, '#include <common>', `#include <common>\nvarying vec2 vTrnXZ;\nuniform float uTime;${o.sink ? SINK_DECL_GLSL : ''}`, what);
    vs = swap(vs, '#include <begin_vertex>', `#include <begin_vertex>\n${o.sway ? SWAY_GLSL : ''}${o.sink ? SINK_GLSL : ''}`, what);
    vs = swap(vs, '#include <project_vertex>', `#include <project_vertex>\n${OBJECT_XZ_GLSL}`, what);
    let fs = shader.fragmentShader;
    fs = swap(fs, '#include <common>', `#include <common>\nvarying vec2 vTrnXZ;\n${GRADE_GLSL}`, what);
    fs = swap(fs, '#include <opaque_fragment>', 'outgoingLight = trnGrade( outgoingLight, vTrnXZ );\n#include <opaque_fragment>', what);
    if (o.glow) fs = swap(fs, 'vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb;', what);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    o.extra?.(shader);
  };
  mat.customProgramCacheKey = () => `terrain:${o.key}`;
}

/** The shadow-pass twin of a swaying material, so a tree's shadow sways with the tree. */
export function swayDepthMaterial(u: TerrainUniforms): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    let vs = swap(shader.vertexShader, '#include <common>', '#include <common>\nuniform float uTime;', 'MeshDepthMaterial (sway)');
    vs = swap(vs, '#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_GLSL}`, 'MeshDepthMaterial (sway)');
    shader.vertexShader = vs;
  };
  m.customProgramCacheKey = () => 'terrain:sway-depth';
  return m;
}

/** The shadow-pass twin of a prop material, so the shadow of an occupied property shrinks with the property. */
export function sinkDepthMaterial(u: TerrainUniforms): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOccMap = u.uOccMap;
    shader.uniforms.uOccSize = u.uFogSize;
    let vs = swap(shader.vertexShader, '#include <common>', `#include <common>${SINK_DECL_GLSL}`, 'MeshDepthMaterial (sink)');
    vs = swap(vs, '#include <begin_vertex>', `#include <begin_vertex>\n${SINK_GLSL}`, 'MeshDepthMaterial (sink)');
    shader.vertexShader = vs;
  };
  m.customProgramCacheKey = () => 'terrain:sink-depth';
  return m;
}

// ---------------------------------------------------------------- lit windows

/** A 32 x 32 texture of 4 x 4 windows (8 px cells; the corner texels are plain wall): albedo, and a matching emissive map with about 60% of the windows lit. */
export function buildWindowTextures(): { albedo: DataTexture; emissive: DataTexture } {
  const S = 32;
  const a = new Uint8Array(S * S * 4);
  const e = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) { a.set([255, 255, 255, 255], i * 4); e.set([0, 0, 0, 255], i * 4); }
  const rnd = rngFrom(20261008);
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      const lit = rnd() < 0.62;
      const warm = 0.78 + 0.22 * rnd();
      for (let py = 2; py <= 5; py++) {
        for (let px = 2; px <= 5; px++) {
          const o = ((cy * 8 + py) * S + cx * 8 + px) * 4;
          a[o] = 26; a[o + 1] = 38; a[o + 2] = 54;
          if (lit) { e[o] = Math.round(255 * warm); e[o + 1] = Math.round(206 * warm); e[o + 2] = Math.round(128 * warm); }
          else { e[o] = 6; e[o + 1] = 10; e[o + 2] = 16; }
        }
      }
    }
  }
  const make = (data: Uint8Array): DataTexture => {
    const t = new DataTexture(data, S, S, RGBAFormat, UnsignedByteType);
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: make(a), emissive: make(e) };
}

// ---------------------------------------------------------------- materials

export interface TerrainMaterials {
  ground: MeshStandardMaterial;
  solid: MeshStandardMaterial;
  glossy: MeshStandardMaterial;
  windows: MeshStandardMaterial;
  glow: MeshStandardMaterial;
  decal: MeshLambertMaterial;
  tree: MeshStandardMaterial;
  treeDepth: MeshDepthMaterial;
  /** Shadow pass of the lit props (solid, glossy, windows), which sink with their property. */
  sinkDepth: MeshDepthMaterial;
}

export function createMaterials(u: TerrainUniforms, windowAlbedo: Texture, windowEmissive: Texture, atlas: Texture): TerrainMaterials {
  const ground = new MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  const solid = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.06 });
  const glossy = new MeshStandardMaterial({ vertexColors: true, roughness: 0.26, metalness: 0.2 });
  const windows = new MeshStandardMaterial({
    vertexColors: true, roughness: 0.72, metalness: 0.08, map: windowAlbedo, emissiveMap: windowEmissive, emissive: 0xffffff, emissiveIntensity: 1.5,
  });
  const glow = new MeshStandardMaterial({ vertexColors: true, color: 0x000000, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1 });
  const decal = new MeshLambertMaterial({ vertexColors: true, map: atlas, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const tree = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  patchMaterial(ground, u, { key: 'ground' });
  patchMaterial(solid, u, { key: 'solid', sink: true });
  patchMaterial(glossy, u, { key: 'glossy', sink: true });
  patchMaterial(windows, u, { key: 'windows', sink: true });
  patchMaterial(glow, u, { key: 'glow', glow: true, sink: true });
  patchMaterial(decal, u, { key: 'decal', sink: true });
  patchMaterial(tree, u, { key: 'tree', sway: true });
  return { ground, solid, glossy, windows, glow, decal, tree, treeDepth: swayDepthMaterial(u), sinkDepth: sinkDepthMaterial(u) };
}

// ---------------------------------------------------------------- a JS mirror of the grade (tests and documentation)

/** What `trnGrade` does to a linear colour in fully unseen ground (`seen` = 0) or fully seen ground (`seen` = 1), with no storm. */
export function fogGrade(c: [number, number, number], seen: number): [number, number, number] {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const k = Math.min(1, Math.max(0, seen));
  return c.map((v) => {
    const hidden = (l + (v - l) * 0.3) * 0.45;
    return hidden + (v - hidden) * k;
  }) as [number, number, number];
}
