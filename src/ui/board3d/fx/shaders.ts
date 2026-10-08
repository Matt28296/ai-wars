// GLSL for the effects kit. Two programs:
//   SPRITE  one instanced quad program that draws every glow, flare, ring, smoke puff, spark, glyph, streak and beam. Everything is
//           analytic (no textures), so there is nothing to download, nothing to band and nothing to build in node.
//   DEBRIS  instanced lit chunks.
// Colours arrive in linear light and may exceed 1: the additive layer is HDR so the renderer's bloom pass picks the hot parts up.

/** Shapes the sprite fragment shader knows (instance attribute iD.x). */
export const SHAPE = {
  GLOW: 0, // soft round glow
  CORE: 1, // hot core with a halo
  BURST: 2, // four-point starburst (long cross, short diagonals) over a core
  RING: 3, // a ring whose front edge is bright; iD.w is the thickness (0.05 thin .. 0.5 thick)
  SMOKE: 4, // noisy cloud puff, seeded by iD.z
  SPARK: 5, // small bright dot
  BANG: 6, // an exclamation mark glyph
  STREAK: 7, // ribbon: bright head at the end point, tail fading toward the start; iD.w is the tail exponent
  BEAM: 8, // ribbon: a light beam, bright at the start point and fading toward the end; iD.z is a phase
  BADGE: 9, // flat dark disc
} as const;

/** How the quad is placed (instance attribute iD.y). */
export const MODE = {
  FACING: 0, // faces the camera, size iA.w, rotated by iB.w
  FLAT: 1, // lies on the ground (XZ), size iA.w, rotated by iB.w
  RIBBON: 2, // runs from iA.xyz to iB.xyz, half-width iA.w, always facing the camera
} as const;

export const SPRITE_VERTEX = /* glsl */ `
attribute vec4 iA;   // xyz: centre (ribbon: start); w: half-size (ribbon: half-width)
attribute vec4 iB;   // xyz: ribbon end; w: rotation in radians
attribute vec4 iC;   // rgb: linear colour (may exceed 1); a: opacity
attribute vec4 iD;   // x: shape, y: mode, z: variation, w: shape parameter
uniform float uBias; // facing sprites move this many half-sizes toward the camera along their view ray (same picture, nearer depth)
varying vec2 vUv;
varying vec4 vC;
varying vec4 vD;
void main() {
  vUv = position.xy;
  vC = iC;
  vD = iD;
  vec4 mvA = modelViewMatrix * vec4(iA.xyz, 1.0);
  vec4 mv;
  if (iD.y < 1.5) {
    float c = cos(iB.w);
    float s = sin(iB.w);
    vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iA.w;
    if (iD.y < 0.5) {
      float k = max(0.25, 1.0 - iA.w * uBias / max(length(mvA.xyz), 0.001));
      mv = vec4(mvA.xyz * k + vec3(q * k, 0.0), 1.0);
    } else {
      mv = modelViewMatrix * vec4(iA.x + q.x, iA.y, iA.z + q.y, 1.0);
    }
  } else {
    vec4 mvB = modelViewMatrix * vec4(iB.xyz, 1.0);
    vec2 d = mvB.xy - mvA.xy;
    float len = length(d);
    vec2 dir = len > 0.00001 ? d / len : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    vec4 base = mix(mvA, mvB, position.x * 0.5 + 0.5);
    mv = vec4(base.xy + nrm * position.y * iA.w, base.zw);
  }
  gl_Position = projectionMatrix * mv;
}
`;

export const SPRITE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec4 vC;
varying vec4 vD;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float sdBang(vec2 q) {
  float t = clamp((q.y + 0.22) / 1.04, 0.0, 1.0);
  float hw = mix(0.10, 0.20, t);
  vec2 e = vec2(abs(q.x) - (hw - 0.05), max(-0.17 - q.y, q.y - 0.77));
  float dBar = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - 0.05;
  float dDot = length(q - vec2(0.0, -0.58)) - 0.15;
  return min(dBar, dDot);
}

void main() {
  float shape = vD.x;
  vec2 p = vUv;
  float r = length(p);
  float a = 0.0;
  vec3 tint = vec3(1.0);
  if (shape < 0.5) {
    a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.65, 1.0, r));
  } else if (shape < 1.5) {
    a = (exp(-r * r * 16.0) + 0.3 * exp(-r * r * 4.0)) * (1.0 - smoothstep(0.7, 1.0, r));
  } else if (shape < 2.5) {
    vec2 q = abs(p);
    float h = exp(-q.y * (22.0 + 50.0 * q.x)) * clamp(1.0 - q.x, 0.0, 1.0);
    float v = exp(-q.x * (22.0 + 50.0 * q.y)) * clamp(1.0 - q.y, 0.0, 1.0);
    vec2 d = abs(vec2(p.x + p.y, p.x - p.y)) * 0.70710678;
    float d1 = exp(-d.y * (30.0 + 60.0 * d.x)) * clamp(1.0 - d.x, 0.0, 1.0) * 0.45;
    float d2 = exp(-d.x * (30.0 + 60.0 * d.y)) * clamp(1.0 - d.y, 0.0, 1.0) * 0.45;
    a = clamp(max(h, v) + max(d1, d2) + exp(-r * r * 14.0) * 0.9, 0.0, 1.0);
    a *= 1.0 - smoothstep(0.9, 1.0, max(q.x, q.y));
  } else if (shape < 3.5) {
    float th = max(vD.w, 0.03);
    a = smoothstep(1.0 - th, 1.0 - th * 0.12, r) * (1.0 - smoothstep(1.0 - th * 0.12, 1.0, r));
  } else if (shape < 4.5) {
    float sv = vD.z * 31.7;
    float n1 = vnoise(p * 2.2 + sv);
    float n2 = vnoise(p * 4.6 - sv * 1.3);
    float d = r + (n1 - 0.5) * 0.7 + (n2 - 0.5) * 0.28;
    a = 1.0 - smoothstep(0.1, 0.95, d);
    a = a * a * (1.0 - smoothstep(0.7, 1.0, r));
    float lit = 0.78 + 0.4 * (p.y * 0.5 + 0.2 - p.x * 0.15);
    tint = vec3(lit);
  } else if (shape < 5.5) {
    a = (exp(-r * r * 20.0) + 0.25 * exp(-r * r * 5.0)) * (1.0 - smoothstep(0.75, 1.0, r));
  } else if (shape < 6.5) {
    float d = sdBang(p);
    float body = 1.0 - smoothstep(-0.015, 0.025, d);
    float halo = 0.5 * exp(-max(d, 0.0) * 9.0) * (1.0 - smoothstep(0.55, 1.0, r));
    a = max(body, halo);
    tint = mix(vec3(1.0), vec3(1.0, 0.82, 0.82), body);
  } else if (shape < 7.5) {
    float t = p.x * 0.5 + 0.5;
    float v = abs(p.y);
    a = exp(-v * v * 6.0) * pow(t, max(vD.w, 0.05)) * (1.0 - smoothstep(0.88, 1.0, t));
  } else if (shape < 8.5) {
    float t = p.x * 0.5 + 0.5;
    float v = abs(p.y);
    float fall = pow(clamp(1.0 - t, 0.0, 1.0), 0.75);
    float bands = 0.88 + 0.12 * sin(t * 34.0 - vD.z * 40.0);
    a = (exp(-v * v * 5.0) + 0.9 * exp(-v * v * 60.0)) * fall * bands;
    a = min(a, 1.4);
  } else {
    a = 1.0 - smoothstep(0.8, 1.0, r);
  }
  gl_FragColor = vec4(vC.rgb * tint, a * vC.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const DEBRIS_VERTEX = /* glsl */ `
attribute vec4 iPos;   // xyz: centre; w: heat 0..1
attribute vec4 iQuat;  // rotation
attribute vec4 iScl;   // xyz: size
attribute vec4 iCol;   // rgb: base colour
varying vec3 vN;
varying vec3 vBase;
varying float vHeat;
vec3 rotateBy(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
void main() {
  vec3 wp = rotateBy(position * iScl.xyz, iQuat) + iPos.xyz;
  vN = rotateBy(normal, iQuat);
  vBase = iCol.rgb;
  vHeat = iPos.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
}
`;

export const DEBRIS_FRAGMENT = /* glsl */ `
varying vec3 vN;
varying vec3 vBase;
varying float vHeat;
void main() {
  vec3 n = normalize(vN);
  float key = max(dot(n, normalize(vec3(-0.45, 0.8, -0.35))), 0.0);
  float fill = max(-n.y, 0.0) * 0.08;
  vec3 col = vBase * (0.2 + 0.95 * key + fill);
  col += vec3(2.6, 0.95, 0.28) * vHeat * vHeat;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
