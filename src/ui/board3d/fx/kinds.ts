// The effect builders. Each one writes the particles of ONE effect into the shared batches from (kind, progress, seed, at, to, color)
// and nothing else: no clock, no stored state, no Math.random. Random numbers come from the item's seed in a fixed order that does
// not depend on `progress`, so scrubbing back shows exactly what going forward showed. Progress is the 0..1 span of the beat; the
// transition plan's TIMINGS decide how many milliseconds that is (muzzle ~80, hit 380, explosion 520, pulse 500, ambush 650,
// spawn 360), so every curve here is written in progress, never in seconds.
//
// Colours are linear light and often above 1 on purpose: the additive layer is HDR, and the renderer's high-threshold bloom
// makes the hot parts glow. World units: a tile is 1. `at.y` is where the effect sits (hits and shots at the point itself; the
// ground-bound kinds ground their rings and scorch there and lift their own glow). The movement trails (dust, wake, contrail) live in
// trails.ts: they stream from `at` toward `to` and are described there.
import type { FxItem } from '../contract';
import type { DebrisBatch, SpriteBatch } from './batches';
import type { LightPool } from './lights';
import { Rng } from './rng';
import { MODE, SHAPE } from './shaders';
import { contrail, dust, wake } from './trails';
import { clamp01, easeOutBack, easeOutCubic, lerp, mixRgb, rgbOf, setHex, smoothstep, TAU } from './util';
import type { Rgb } from './util';

const WARM = rgbOf(0xffc46b);
const HOT = rgbOf(0xfff0d0);
const ORANGE = rgbOf(0xff7a1a);
const HEAL = rgbOf(0x4dffa0);
const ALERT = rgbOf(0xff3347);
const SIGNAL = rgbOf(0x5ce1ff);
const SMOKE_WARM = rgbOf(0x6e4a34);
const SMOKE_GREY = rgbOf(0x4c5058);
const SCORCH = rgbOf(0x050609);
const DEBRIS_COLORS: readonly Rgb[] = [rgbOf(0x2c3138), rgbOf(0x4a4f57), rgbOf(0x1d2026), rgbOf(0x6a5a46)];

/** Everything a builder needs, with scratch values so no builder allocates. */
export class FxContext {
  readonly rng = new Rng();
  /** 1 normally; below 1 for reduced motion (fewer particles, the same shapes). */
  density = 1;
  readonly tint: Rgb = { r: 1, g: 1, b: 1 };
  hasTint = false;
  readonly k1: Rgb = { r: 0, g: 0, b: 0 };
  readonly k2: Rgb = { r: 0, g: 0, b: 0 };
  readonly v1 = { x: 0, y: 0, z: 0 };
  readonly v2 = { x: 0, y: 0, z: 0 };

  constructor(
    readonly glow: SpriteBatch,
    readonly smoke: SpriteBatch,
    readonly debris: DebrisBatch,
    readonly lights: LightPool,
  ) {}

  begin(it: FxItem): void {
    this.rng.reset(it.seed);
    this.hasTint = it.color !== undefined;
    if (it.color !== undefined) setHex(this.tint, it.color);
  }

  /** `out` = `def`, moved `amount` of the way toward the item's tint when it has one. */
  pick(out: Rgb, def: Rgb, amount = 1): Rgb {
    if (this.hasTint) return mixRgb(out, def, this.tint, amount);
    out.r = def.r; out.g = def.g; out.b = def.b;
    return out;
  }

  /** A particle count scaled by density, never below `min`. */
  count(n: number, min = 1): number {
    return Math.max(min, Math.round(n * this.density));
  }

  glowAt(
    x: number, y: number, z: number, size: number, shape: number, col: Rgb, k: number, a: number,
    rot = 0, mode: number = MODE.FACING, variation = 0, param = 0,
  ): void {
    this.glow.sprite(x, y, z, size, rot, shape, col.r * k, col.g * k, col.b * k, a, mode, variation, param);
  }

  streak(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, halfWidth: number,
    col: Rgb, k: number, a: number, tail = 1,
  ): void {
    this.glow.ribbon(x0, y0, z0, x1, y1, z1, halfWidth, SHAPE.STREAK, col.r * k, col.g * k, col.b * k, a, 0, tail);
  }

  puff(x: number, y: number, z: number, size: number, rot: number, col: Rgb, a: number, variation: number): void {
    this.smoke.sprite(x, y, z, size, rot, SHAPE.SMOKE, col.r, col.g, col.b, a, MODE.FACING, variation, 0);
  }
}

// ---------------------------------------------------------------------------------------------------------------- muzzle

function muzzle(c: FxContext, it: FxItem, p: number): void {
  const { x, y, z } = it.at;
  const rng = c.rng;
  const e = (1 - p) * (1 - p) * Math.min(1, 0.45 + p * 9);
  const sz = 0.8 + rng.next() * 0.4;
  const rot = rng.next() * TAU;
  const base = c.pick(c.k1, WARM, 0.6);
  let fx = 0, fy = 0, fz = 0;
  let forward = false;
  if (it.to) {
    const dx = it.to.x - x, dy = it.to.y - y, dz = it.to.z - z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 1e-4) { fx = dx / len; fy = dy / len; fz = dz / len; forward = true; }
  }
  const grow = 0.55 + 0.9 * easeOutCubic(p);
  c.glowAt(x, y, z, 0.22 * sz * (0.7 + 0.6 * p), SHAPE.CORE, HOT, 4.2, e);
  c.glowAt(x, y, z, 0.64 * sz * grow, SHAPE.BURST, base, 2.4, e * 0.95, rot + p * 0.7);
  c.glowAt(x, y, z, 0.6 * sz, SHAPE.GLOW, base, 1.1, e * 0.55);
  const spikes = c.count(6, 3);
  for (let i = 0; i < spikes; i++) {
    let dx = rng.next() * 2 - 1;
    let dy = (rng.next() * 2 - 1) * 0.6;
    let dz = rng.next() * 2 - 1;
    const len0 = 0.28 + rng.next() * 0.34;
    if (forward) { dx = dx * 0.55 + fx; dy = dy * 0.55 + fy; dz = dz * 0.55 + fz; }
    const n = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const len = (len0 * (0.4 + 0.6 * easeOutCubic(p)) * sz) / n;
    c.streak(x + dx * len, y + dy * len, z + dz * len, x, y, z, 0.016, base, 3.2, e * 0.9, 0.7);
  }
  const pop = (1 - p) * (1 - p) * (1 - p) * Math.min(1, 0.4 + p * 10);
  c.lights.offer(x, y + 0.1, z, 5 * pop, 1.0, 0.58, 0.24);
}

// ---------------------------------------------------------------------------------------------------------------- tracer

function tracer(c: FxContext, it: FxItem, p: number): void {
  const to = it.to;
  if (!to) return;
  const { x, y, z } = it.at;
  const dx = to.x - x, dy = to.y - y, dz = to.z - z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-4) return;
  const rng = c.rng;
  const a = 1 - smoothstep(0.82, 1, p);
  // The bolt has a fixed visible length: its head flies to `to` by p = 0.78, then its tail catches up and it is gone at 1.
  const uh = clamp01(p / 0.78);
  const bolt = Math.min(1, Math.min(0.9, 0.2 + 0.4 * dist) / dist);
  const ut = p < 0.78 ? Math.max(0, uh - bolt) : lerp(1 - bolt, 1, (p - 0.78) / 0.22);
  const hx = x + dx * uh, hy = y + dy * uh, hz = z + dz * uh;
  const tx = x + dx * ut, ty = y + dy * ut, tz = z + dz * ut;
  const col = c.pick(c.k1, WARM);
  const core = mixRgb(c.k2, col, HOT, 0.7);
  if ((uh - ut) * dist > 0.01) {
    c.streak(tx, ty, tz, hx, hy, hz, 0.085, col, 1.5, a * 0.7, 1.4);
    c.streak(tx, ty, tz, hx, hy, hz, 0.026, core, 3.6, a, 1.0);
  }
  c.glowAt(hx, hy, hz, 0.085, SHAPE.CORE, core, 4, a);
  c.glowAt(hx, hy, hz, 0.17, SHAPE.GLOW, col, 1.2, a * 0.5);
  for (let i = 0; i < 3; i++) {
    const f = rng.next();
    const k = lerp(ut, uh, f);
    c.glowAt(x + dx * k, y + dy * k, z + dz * k, 0.035, SHAPE.SPARK, core, 3, a * 0.7);
  }
}

// ---------------------------------------------------------------------------------------------------------------- shell

/** How high a shell arcs over a straight line of this length (world units). Scales with distance, capped. */
export function shellApex(dist: number): number {
  return Math.min(3.6, 0.45 + 0.34 * dist);
}

/** The shell's position at fraction `u` of its flight: a parabola over the straight line from (a) to (b). u = 1 is exactly `b`. */
export function shellPoint(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, u: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const apex = shellApex(Math.sqrt(dx * dx + dy * dy + dz * dz));
  out.x = ax + dx * u;
  out.y = ay + dy * u + apex * 4 * u * (1 - u);
  out.z = az + dz * u;
  return out;
}

const SHELL_PUFFS = 22;

function shell(c: FxContext, it: FxItem, p: number): void {
  const to = it.to;
  if (!to) return;
  const { x: ax, y: ay, z: az } = it.at;
  const rng = c.rng;
  const gf = 1 - smoothstep(0.9, 1, p);
  const col = c.pick(c.k1, WARM);
  const pt = c.v1;
  for (let j = 0; j < SHELL_PUFFS; j++) {
    const rot = rng.next() * TAU;
    const jitter = rng.next();
    const side = rng.next() * 2 - 1;
    const s = j / SHELL_PUFFS;
    const age = p - s;
    if (!(age > 0.008)) continue;
    shellPoint(ax, ay, az, to.x, to.y, to.z, s, pt);
    const fade = Math.pow(clamp01(1 - age / 0.8), 1.4);
    const a = 0.7 * smoothstep(0, 0.04, age) * fade * gf;
    c.puff(pt.x + side * age * 0.25, pt.y + 0.04 + age * 0.4, pt.z + side * age * 0.12, 0.1 + age * (0.5 + 0.25 * jitter), rot, SMOKE_GREY, a, jitter);
    if (age < 0.1) c.glowAt(pt.x, pt.y, pt.z, 0.05, SHAPE.SPARK, ORANGE, 2.6, (1 - age / 0.1) * 0.8 * gf);
  }
  shellPoint(ax, ay, az, to.x, to.y, to.z, p, pt);
  const tail = shellPoint(ax, ay, az, to.x, to.y, to.z, Math.max(0, p - 0.06), c.v2);
  c.streak(tail.x, tail.y, tail.z, pt.x, pt.y, pt.z, 0.05, col, 2.2, gf * 0.9, 1);
  c.glowAt(pt.x, pt.y, pt.z, 0.075, SHAPE.CORE, HOT, 4, gf);
  c.glowAt(pt.x, pt.y, pt.z, 0.24, SHAPE.GLOW, col, 1.1, gf * 0.55);
}

// ---------------------------------------------------------------------------------------------------------------- hit

function hit(c: FxContext, it: FxItem, p: number): void {
  const { x, y, z } = it.at;
  const rng = c.rng;
  const f = clamp01(1 - p / 0.32);
  const f2 = f * f;
  const base = c.pick(c.k1, ORANGE, 0.35);
  const rot = rng.next() * TAU;
  const grow = 0.55 + 0.9 * Math.sqrt(clamp01(p / 0.32));
  c.glowAt(x, y, z, 0.34 * grow, SHAPE.CORE, HOT, 4, f2);
  c.glowAt(x, y, z, 0.62 * grow, SHAPE.BURST, base, 2.2, f2 * 0.85, rot);
  c.glowAt(x, y, z, 0.75, SHAPE.GLOW, base, 1.0, f * 0.5);
  const n = c.count(14, 6);
  const gravity = 1.8;
  for (let i = 0; i < n; i++) {
    const th = rng.next() * TAU;
    const e = 0.12 + 0.88 * rng.next();
    const spd = 0.5 + 1.1 * rng.next();
    const life = 0.5 + 0.5 * rng.next();
    const wid = 0.012 + 0.01 * rng.next();
    const age = p / life;
    if (!(age < 1)) continue;
    const h = Math.sqrt(1 - e * e);
    const dx = Math.cos(th) * h * spd, dy = e * spd, dz = Math.sin(th) * h * spd;
    const q0 = Math.max(0, p - 0.12);
    const a = Math.pow(1 - age, 1.3);
    const col = mixRgb(c.k2, HOT, base, smoothstep(0, 0.7, age));
    const k = 3.2 - 1.2 * age;
    c.streak(
      x + dx * q0, y + dy * q0 - 0.5 * gravity * q0 * q0, z + dz * q0,
      x + dx * p, y + dy * p - 0.5 * gravity * p * p, z + dz * p, wid, col, k, a, 0.8,
    );
    c.glowAt(x + dx * p, y + dy * p - 0.5 * gravity * p * p, z + dz * p, 0.022, SHAPE.SPARK, col, k, a);
  }
}

// ---------------------------------------------------------------------------------------------------------------- explosion

// Fireball colour by age q (0 hot white-yellow .. 1 dim red), HDR.
const FIRE_STOPS: readonly (readonly [number, number, number, number])[] = [
  [0.0, 1.6, 1.3, 0.75],
  [0.22, 1.5, 0.7, 0.18],
  [0.6, 0.95, 0.28, 0.05],
  [1.0, 0.4, 0.06, 0.02],
];

function fireRamp(q: number, out: Rgb): Rgb {
  for (let i = 1; i < FIRE_STOPS.length; i++) {
    const b = FIRE_STOPS[i];
    if (q <= b[0] || i === FIRE_STOPS.length - 1) {
      const a = FIRE_STOPS[i - 1];
      const t = clamp01((q - a[0]) / (b[0] - a[0]));
      out.r = lerp(a[1], b[1], t);
      out.g = lerp(a[2], b[2], t);
      out.b = lerp(a[3], b[3], t);
      return out;
    }
  }
  return out;
}

const GRAVITY_DEBRIS = 7.5;

function explosion(c: FxContext, it: FxItem, p: number): void {
  const { x, y, z } = it.at;
  const rng = c.rng;
  const cy = y + 0.28;

  const lp = clamp01(1 - p / 0.5);
  c.lights.offer(x, y + 0.9, z, 5 * lp * lp, 1.0, 0.6, 0.25);

  // the flash
  const f = clamp01(1 - p / 0.22);
  const fb = clamp01(1 - p / 0.3);
  const rotB = rng.next() * TAU;
  c.glowAt(x, cy, z, 0.5 * (0.5 + 1.2 * (1 - f)), SHAPE.CORE, HOT, 1.8, f * f);
  c.glowAt(x, cy, z, 1.0, SHAPE.GLOW, ORANGE, 0.8, f * 0.35);
  c.glowAt(x, cy, z, 1.0 * (0.6 + 0.6 * easeOutCubic(clamp01(p / 0.3))), SHAPE.BURST, HOT, 1.8, fb * fb * 0.55, rotB);

  // the fireball: overlapping puffs that bloom outward and cool from white-yellow to dim red
  const nf = c.count(14, 6);
  for (let i = 0; i < nf; i++) {
    const th = rng.next() * TAU;
    const ey = rng.next();
    const r0 = 0.08 + 0.34 * rng.next();
    const s0 = 0.26 + 0.26 * rng.next();
    const delay = rng.next() * 0.12;
    const life = 0.38 + 0.3 * rng.next();
    const rot = rng.next() * TAU;
    const q = (p - delay) / life;
    if (!(q > 0 && q < 1)) continue;
    const grow = easeOutCubic(q);
    const hr = Math.sqrt(1 - ey * ey);
    const reach = r0 * (0.35 + 1.3 * grow);
    fireRamp(q, c.k1);
    c.glowAt(
      x + Math.cos(th) * hr * reach, cy + ey * 0.9 * reach, z + Math.sin(th) * hr * reach,
      s0 * (0.55 + 1.15 * grow), i % 7 === 0 ? SHAPE.CORE : SHAPE.GLOW, c.k1, 1, 0.42 * (1 - q * q) * clamp01(q / 0.07), rot,
    );
  }

  // the shockwave on the ground
  const rp = p / 0.6;
  if (rp < 1) {
    const ring = c.pick(c.k2, WARM, 0.35);
    c.glowAt(x, y, z, 0.15 + 0.9 * easeOutCubic(rp), SHAPE.RING, ring, 1.2, Math.pow(1 - rp, 1.6) * 0.6, 0, MODE.FLAT, 0, 0.18);
  }
  const rp2 = (p - 0.07) / 0.55;
  if (rp2 > 0 && rp2 < 1) {
    c.glowAt(x, y, z, 0.1 + 0.6 * easeOutCubic(rp2), SHAPE.RING, HOT, 1.0, Math.pow(1 - rp2, 1.8) * 0.4, 0, MODE.FLAT, 0, 0.12);
  }

  // sparks
  const ns = c.count(12, 5);
  for (let i = 0; i < ns; i++) {
    const th = rng.next() * TAU;
    const e = 0.2 + 0.8 * rng.next();
    const spd = 0.9 + 1.3 * rng.next();
    const life = 0.35 + 0.4 * rng.next();
    const age = p / life;
    if (!(age < 1)) continue;
    const h = Math.sqrt(1 - e * e);
    const dx = Math.cos(th) * h * spd, dy = e * spd * 1.2, dz = Math.sin(th) * h * spd;
    const q0 = Math.max(0, p - 0.1);
    const a = Math.pow(1 - age, 1.2);
    mixRgb(c.k1, HOT, ORANGE, smoothstep(0, 0.8, age));
    c.streak(
      x + dx * q0, cy + dy * q0 - 2.2 * q0 * q0, z + dz * q0,
      x + dx * p, cy + dy * p - 2.2 * p * p, z + dz * p, 0.012, c.k1, 3.4, a, 0.8,
    );
  }

  // debris chunks on ballistic paths: 8..14 of them
  const nAll = 8 + Math.floor(rng.next() * 7);
  const nd = Math.min(nAll, Math.max(5, Math.round(nAll * c.density)));
  const shrink = 1 - smoothstep(0.72, 1, p);
  for (let i = 0; i < nd; i++) {
    const ang = rng.next() * TAU;
    const hs = 0.6 + 1.2 * rng.next();
    const vy = 1.9 + 2.2 * rng.next();
    const size = 0.045 + 0.06 * rng.next();
    const sy = 0.4 + 0.8 * rng.next();
    const sz = 0.6 + 0.8 * rng.next();
    let ax = rng.next() * 2 - 1, ay = rng.next() * 2 - 1, az = rng.next() * 2 - 1;
    const spin = 6 + 12 * rng.next();
    const colour = DEBRIS_COLORS[Math.floor(rng.next() * DEBRIS_COLORS.length)];
    const heat0 = 0.6 + 0.4 * rng.next();
    const an = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= an; ay /= an; az /= an;
    const rise = 0.15;
    const tLand = (vy + Math.sqrt(vy * vy + 2 * GRAVITY_DEBRIS * rise)) / GRAVITY_DEBRIS;
    const pc = Math.min(p, tLand);
    const px = x + Math.cos(ang) * hs * pc;
    const pz = z + Math.sin(ang) * hs * pc;
    const py = Math.max(y + size * 0.4, y + rise + vy * pc - 0.5 * GRAVITY_DEBRIS * pc * pc);
    const half = (spin * pc) / 2;
    const sn = Math.sin(half);
    const heat = heat0 * (1 - smoothstep(0, 0.55, p));
    c.debris.chunk(px, py, pz, heat, ax * sn, ay * sn, az * sn, Math.cos(half), size * shrink, size * sy * shrink, size * sz * shrink, colour.r, colour.g, colour.b);
    c.glowAt(px, py, pz, 0.1 * heat, SHAPE.SPARK, ORANGE, 2.4, heat * 0.9);
  }

  // the smoke column: puffs rise one after another and linger, fading to nothing exactly at progress 1
  const nm = c.count(16, 7);
  for (let j = 0; j < nm; j++) {
    const lx = (rng.next() - 0.5) * 0.5;
    const lz = (rng.next() - 0.5) * 0.5;
    const rise = 0.9 + 1.3 * rng.next();
    const s0 = 0.32 + 0.26 * rng.next();
    const rot = rng.next() * TAU;
    const vari = rng.next();
    const d = (j / nm) * 0.38 + 0.02;
    const q = (p - d) / (1 - d);
    if (!(q > 0)) continue;
    const a = 0.62 * smoothstep(0, 0.14, q) * (1 - smoothstep(0.65, 1, q));
    mixRgb(c.k1, SMOKE_WARM, SMOKE_GREY, smoothstep(0, 0.35, q));
    c.puff(x + lx + 0.35 * q, y + 0.2 + rise * easeOutCubic(q) * 1.35, z + lz - 0.1 * q, s0 * (0.7 + 0.9 * q), rot, c.k1, a, vari);
  }

  // a dark scorch mark under it all
  const sa = 0.5 * smoothstep(0, 0.1, p) * (1 - smoothstep(0.45, 1, p));
  c.smoke.sprite(x, y, z, 0.7 + 0.15 * p, 0, SHAPE.BADGE, SCORCH.r, SCORCH.g, SCORCH.b, sa, MODE.FLAT, 0, 0);
}

// ---------------------------------------------------------------------------------------------------------------- pulse

function pulse(c: FxContext, it: FxItem, p: number): void {
  const { x, y, z } = it.at;
  const rng = c.rng;
  const env = smoothstep(0, 0.15, p) * (1 - smoothstep(0.7, 1, p));
  const col = c.pick(c.k1, HEAL);
  const white = mixRgb(c.k2, col, HOT, 0.15);
  c.glowAt(x, y + 0.02, z, 0.6, SHAPE.GLOW, col, 1.2, env * 0.45, 0, MODE.FLAT);
  c.glowAt(x, y, z, 0.25 + 0.38 * easeOutCubic(p), SHAPE.RING, col, 1.8, env * 0.6, 0, MODE.FLAT, 0, 0.2);
  c.glow.ribbon(x, y, z, x, y + 0.95, z, 0.1, SHAPE.BEAM, col.r * 1.1, col.g * 1.1, col.b * 1.1, env * 0.3, 0, 0);
  const n = c.count(16, 6);
  for (let i = 0; i < n; i++) {
    const ang = rng.next() * TAU;
    const rad = 0.1 + 0.3 * Math.sqrt(rng.next());
    const phase = rng.next();
    const speed = 0.85 + 0.5 * rng.next();
    const sway = 0.04 + 0.05 * rng.next();
    const freq = 2 + 2 * rng.next();
    const size = 0.06 + 0.045 * rng.next();
    const t = (phase + p * speed * 1.2) % 1;
    const life = Math.pow(Math.sin(Math.PI * t), 0.9);
    const px = x + Math.cos(ang) * rad + Math.sin(TAU * (freq * p + phase)) * sway;
    const pz = z + Math.sin(ang) * rad + Math.cos(TAU * (freq * p + phase)) * sway;
    const py = y + 0.05 + 1.1 * t;
    const sparkle = i % 3 === 0;
    c.glowAt(px, py, pz, size * (1 - 0.4 * t) * (sparkle ? 1.3 : 1.2), sparkle ? SHAPE.BURST : SHAPE.SPARK, sparkle ? white : col, 2.0, env * life, sparkle ? ang + p * 3 : 0);
  }
}

// ---------------------------------------------------------------------------------------------------------------- ambush

function ambush(c: FxContext, it: FxItem, p: number): void {
  const { x, y, z } = it.at;
  const col = c.pick(c.k1, ALERT);
  const flareEnv = smoothstep(0, 0.05, p) * (1 - smoothstep(0.3, 0.7, p));
  const throb = 0.65 + 0.35 * Math.sin(p * TAU * 1.5);

  // the warning flare: a red light on the ground, a beam shooting up, and a ring going out
  c.glowAt(x, y + 0.02, z, 0.85, SHAPE.GLOW, col, 1.2, 0.6 * throb * (1 - smoothstep(0.6, 1, p)) * smoothstep(0, 0.05, p), 0, MODE.FLAT);
  c.glow.ribbon(x, y, z, x, y + 0.68, z, 0.09, SHAPE.BEAM, col.r * 2.2, col.g * 2.2, col.b * 2.2, 0.85 * flareEnv, 0.3, 0);
  c.glowAt(x, y + 0.68 * easeOutCubic(clamp01(p / 0.3)), z, 0.16, SHAPE.CORE, col, 3, flareEnv);
  const r1 = p / 0.7;
  if (r1 < 1) c.glowAt(x, y, z, 0.3 + 0.9 * easeOutCubic(r1), SHAPE.RING, col, 2.2, Math.pow(1 - r1, 1.5) * 0.8, 0, MODE.FLAT, 0, 0.22);
  const r2 = (p - 0.18) / 0.7;
  if (r2 > 0 && r2 < 1) c.glowAt(x, y, z, 0.3 + 0.7 * easeOutCubic(r2), SHAPE.RING, col, 1.6, Math.pow(1 - r2, 1.5) * 0.5, 0, MODE.FLAT, 0, 0.14);

  // the "!" glyph: pops in with a bounce, holds, fades
  const s = easeOutBack(clamp01(p / 0.22));
  const ga = smoothstep(0, 0.05, p) * (1 - smoothstep(0.82, 1, p));
  const gy = y + 1.05 + 0.16 * (1 - easeOutCubic(clamp01(p / 0.22)));
  if (s > 0) {
    c.smoke.sprite(x, gy, z, 0.32 * s, 0, SHAPE.BADGE, 0.1, 0.008, 0.012, 0.88 * ga, MODE.FACING, 0, 0);
    c.glowAt(x, gy, z, 0.6 * s, SHAPE.GLOW, col, 1.0, 0.4 * ga);
    c.glowAt(x, gy, z, 0.33 * s, SHAPE.RING, col, 1.8, ga, 0, MODE.FACING, 0, 0.1);
    c.glowAt(x, gy, z, 0.34 * s, SHAPE.BANG, col, 2.6, ga);
  }
}

// ---------------------------------------------------------------------------------------------------------------- spawn

function spawn(c: FxContext, it: FxItem, p: number): void {
  const { x, y, z } = it.at;
  const rng = c.rng;
  const env = smoothstep(0, 0.18, p) * (1 - smoothstep(0.55, 1, p));
  const col = c.pick(c.k1, SIGNAL);
  const white = mixRgb(c.k2, col, HOT, 0.6);
  const top = y + 2.0 * easeOutCubic(clamp01(p / 0.3));
  const w = 1 - 0.6 * p;
  c.glow.ribbon(x, y, z, x, top, z, 0.15 * w, SHAPE.BEAM, col.r * 1.5, col.g * 1.5, col.b * 1.5, env * 0.9, p, 0);
  c.glow.ribbon(x, y, z, x, top, z, 0.045 * w, SHAPE.BEAM, white.r * 2.4, white.g * 2.4, white.b * 2.4, env * 0.9, p, 0);
  c.glowAt(x, y + 0.02, z, 0.8, SHAPE.GLOW, col, 1.0, env * 0.35, 0, MODE.FLAT);
  c.glowAt(x, y, z, 0.2 + 0.6 * easeOutCubic(p), SHAPE.RING, col, 1.8, env * 0.85, 0, MODE.FLAT, 0, 0.18);
  c.glowAt(x, y + 1.4 * (1 - easeOutCubic(p)), z, 0.45 * (1 - 0.4 * p), SHAPE.RING, white, 1.4, env * 0.7, 0, MODE.FLAT, 0, 0.16);
  const n = c.count(10, 4);
  for (let i = 0; i < n; i++) {
    const ox = (rng.next() - 0.5) * 0.24;
    const oz = (rng.next() - 0.5) * 0.24;
    const phase = rng.next();
    const speed = 1.2 + 0.8 * rng.next();
    const t = (phase + p * speed) % 1;
    c.glowAt(x + ox, y + t * 1.8, z + oz, 0.04, SHAPE.SPARK, white, 2.4, env * Math.sin(Math.PI * t));
  }
}

/** Builds one effect into the batches. An unknown kind draws nothing. */
export function buildEffect(c: FxContext, it: FxItem, p: number): void {
  switch (it.kind) {
    case 'muzzle': return muzzle(c, it, p);
    case 'tracer': return tracer(c, it, p);
    case 'shell': return shell(c, it, p);
    case 'hit': return hit(c, it, p);
    case 'explosion': return explosion(c, it, p);
    case 'pulse': return pulse(c, it, p);
    case 'ambush': return ambush(c, it, p);
    case 'spawn': return spawn(c, it, p);
    case 'dust': return dust(c, it, p);
    case 'wake': return wake(c, it, p);
    case 'contrail': return contrail(c, it, p);
  }
}
