// The one shared shader patch behind every unit miniature (G7). A unit's paint, gunmetal, trim and glass are vertex data (skin.ts), so
// a single MeshStandardMaterial per faction (and one "spent" variant of it) draws them all. The patch reads four vertex attributes:
//   aSpent     the albedo of a spent unit; `uSpent` (0 or 1, per material) chooses between it and `color`
//   aGlow      emissive weight: the material's emissive (the faction accent, at its intensity) shows on trim and nowhere else
//   aAmbient   light a surface gives off by itself (canopy teal, the Choir's lift), and the share of it a spent unit keeps
//   aSurface   roughness and metalness of the slot each vertex came from
// and adds the faction rim: a view-dependent fresnel in the accent colour, added as emitted light so the shadow side shows it too.
//
// Every edit replaces an anchor in three.js's own shader template, and THROWS when the anchor is missing: a patch that matched nothing
// would ship units with no paint (the tests run every patch against the real templates, so an upgrade that renames a chunk fails there).
import type { Color, IUniform, Material } from 'three';
import { RIM_POWER } from './livery';

export type Shader = Parameters<Material['onBeforeCompile']>[0];

export interface UnitUniforms {
  /** 1 for the spent variant: read `aSpent` for the albedo and keep only part of `aAmbient`. */
  uSpent: IUniform<number>;
  /** Rim strength: about 0.25, and 40% of that on a spent unit. */
  uRim: IUniform<number>;
  /** The faction accent. */
  uRimColor: IUniform<Color>;
}

/** Replace the first occurrence of a shader-chunk anchor, or THROW if it is not there. */
export function swap(src: string, anchor: string, replacement: string, what: string): string {
  if (!src.includes(anchor)) throw new Error(`unit shader patch: ${anchor} not found in ${what}`);
  return src.replace(anchor, () => replacement);
}

const VERTEX_PARS = /* glsl */ `
#include <common>
attribute vec3 aSpent;
attribute float aGlow;
attribute vec4 aAmbient;
attribute vec2 aSurface;
uniform float uSpent;
varying float vGlow;
varying vec3 vAmbient;
varying vec2 vSurface;
`;

const VERTEX_COLOR = /* glsl */ `
#include <color_vertex>
vColor.rgb = mix( vColor.rgb, aSpent, uSpent );
vGlow = aGlow;
vAmbient = aAmbient.rgb * mix( 1.0, aAmbient.a, uSpent );
vSurface = aSurface;
`;

const FRAGMENT_PARS = /* glsl */ `
#include <common>
uniform vec3 uRimColor;
uniform float uRim;
varying float vGlow;
varying vec3 vAmbient;
varying vec2 vSurface;
`;

/** After the normal exists (flat shading: the facet's own), so the rim follows each facet. */
const FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance = totalEmissiveRadiance * vGlow + vAmbient;
float unitRimNV = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
totalEmissiveRadiance += uRimColor * ( uRim * pow( 1.0 - unitRimNV, ${RIM_POWER.toFixed(1)} ) );
`;

/** Hook the baked paint and the rim into a three.js lit material. */
export function patchUnitMaterial(mat: Material, u: UnitUniforms, key: string): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSpent = u.uSpent;
    shader.uniforms.uRim = u.uRim;
    shader.uniforms.uRimColor = u.uRimColor;
    const what = `${mat.type} (${key})`;
    shader.vertexShader = swap(shader.vertexShader, '#include <common>', VERTEX_PARS, what);
    shader.vertexShader = swap(shader.vertexShader, '#include <color_vertex>', VERTEX_COLOR, what);
    let fs = shader.fragmentShader;
    fs = swap(fs, '#include <common>', FRAGMENT_PARS, what);
    fs = swap(fs, '#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSurface.x;', what);
    fs = swap(fs, '#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSurface.y;', what);
    fs = swap(fs, '#include <emissivemap_fragment>', FRAGMENT_EMISSIVE, what);
    shader.fragmentShader = fs;
  };
  // every unit material runs the same program; only the uniform values (spent, rim, accent) differ
  mat.customProgramCacheKey = () => `unit:${key}`;
}
