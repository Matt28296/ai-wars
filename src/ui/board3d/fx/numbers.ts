// Billboard damage and heal numbers: canvas-drawn text with a dark outline, popped, raised and faded from `progress` alone.
// Textures are cached by text, sprites are pooled, and draw() allocates nothing once the pool is warm.
// Canvas is guarded: where there is no DOM (node tests) a shared blank texture stands in, and the sprites still animate.
import { CanvasTexture, DataTexture, Group, LinearMipmapLinearFilter, RGBAFormat, Sprite, SpriteMaterial, SRGBColorSpace, UnsignedByteType } from 'three';
import type { Texture } from 'three';
import type { NumberItem } from '../contract';
import { easeOutBack, easeOutCubic, smoothstep } from './util';

/** World height of a number at full size (a tile is 1). Big enough to read at the default zoom. */
export const NUMBER_HEIGHT = 0.46;
export const MAX_NUMBERS = 48;
const CACHE_LIMIT = 64;
const MAX_TEXT = 8;

export interface NumberPose { scale: number; rise: number; alpha: number }

/** The pop, rise and fade of a number at `progress` (0..1). Pure; alpha is exactly 0 at both ends. */
export function numberPose(progress: number, out: NumberPose): NumberPose {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  out.scale = 0.35 + 0.65 * easeOutBack(Math.min(1, p / 0.18));
  out.rise = 0.12 + 0.62 * easeOutCubic(p);
  out.alpha = smoothstep(0, 0.07, p) * (1 - smoothstep(0.62, 1, p));
  return out;
}

interface Entry { texture: Texture; aspect: number; used: number }

const hasCanvas = (): boolean => typeof document !== 'undefined' && typeof document.createElement === 'function';

const FONT = '800 64px "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
const FILL: Record<NumberItem['tone'], readonly [string, string]> = {
  damage: ['#ff9a8a', '#ff3a3a'],
  heal: ['#b4ffd0', '#2fe083'],
};

function paint(text: string, tone: NumberItem['tone']): { canvas: HTMLCanvasElement; aspect: number } | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = FONT;
  const pad = 26;
  const w = Math.max(64, Math.ceil(ctx.measureText(text).width) + pad * 2);
  const h = 112;
  canvas.width = w;
  canvas.height = h;
  ctx.font = FONT; // resizing a canvas resets its state
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const cx = w / 2;
  const cy = h / 2 + 3;
  ctx.lineWidth = 18;
  ctx.strokeStyle = 'rgba(7,9,15,0.94)';
  ctx.strokeText(text, cx, cy);
  const grad = ctx.createLinearGradient(0, cy - 30, 0, cy + 30);
  grad.addColorStop(0, FILL[tone][0]);
  grad.addColorStop(1, FILL[tone][1]);
  ctx.fillStyle = grad;
  ctx.fillText(text, cx, cy);
  return { canvas, aspect: w / h };
}

export class NumberLayer {
  /** Numbers shown this frame. */
  shown = 0;
  readonly pool: Sprite[] = [];
  private readonly caches: Record<NumberItem['tone'], Map<string, Entry>> = { damage: new Map(), heal: new Map() };
  private readonly blank: DataTexture;
  private readonly pose: NumberPose = { scale: 1, rise: 0, alpha: 0 };
  private frame = 0;

  constructor(private readonly group: Group) {
    this.blank = new DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, RGBAFormat, UnsignedByteType);
    this.blank.needsUpdate = true;
  }

  /** How many text textures are cached (both tones). */
  get textures(): number {
    return this.caches.damage.size + this.caches.heal.size;
  }

  draw(items: readonly NumberItem[]): void {
    this.frame++;
    let n = 0;
    for (let i = 0; i < items.length && n < MAX_NUMBERS; i++) {
      const it = items[i];
      const p = it.progress;
      if (!(p >= 0 && p <= 1)) continue;
      const pose = numberPose(p, this.pose);
      if (!(pose.alpha > 0.003)) continue;
      const text = it.text.length > MAX_TEXT ? it.text.slice(0, MAX_TEXT) : it.text;
      if (text.length === 0) continue;
      const entry = this.entryFor(text, it.tone);
      const s = this.spriteAt(n++);
      const mat = s.material;
      if (mat.map !== entry.texture) mat.map = entry.texture;
      mat.opacity = pose.alpha;
      const h = NUMBER_HEIGHT * pose.scale;
      s.scale.set(h * entry.aspect, h, 1);
      s.position.set(it.at.x, it.at.y + pose.rise, it.at.z);
      s.visible = true;
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
    this.shown = n;
  }

  private spriteAt(i: number): Sprite {
    while (this.pool.length <= i) {
      const mat = new SpriteMaterial({ map: this.blank, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const s = new Sprite(mat);
      s.name = 'fx-number';
      s.renderOrder = 40;
      s.visible = false;
      this.pool.push(s);
      this.group.add(s);
    }
    return this.pool[i];
  }

  private entryFor(text: string, tone: NumberItem['tone']): Entry {
    const cache = this.caches[tone];
    let e = cache.get(text);
    if (e) {
      e.used = this.frame;
      return e;
    }
    if (this.textures >= CACHE_LIMIT) this.evict();
    let texture: Texture = this.blank;
    let aspect = Math.max(1.4, text.length * 0.62 + 0.5);
    if (hasCanvas()) {
      const painted = paint(text, tone);
      if (painted) {
        const t = new CanvasTexture(painted.canvas);
        t.colorSpace = SRGBColorSpace;
        t.minFilter = LinearMipmapLinearFilter;
        t.anisotropy = 4;
        t.needsUpdate = true;
        texture = t;
        aspect = painted.aspect;
      }
    }
    e = { texture, aspect, used: this.frame };
    cache.set(text, e);
    return e;
  }

  /** Drops the least recently used texture that was not used this frame. */
  private evict(): void {
    let oldest: { cache: Map<string, Entry>; key: string; used: number } | null = null;
    for (const cache of [this.caches.damage, this.caches.heal]) {
      for (const [key, e] of cache) {
        if (e.used === this.frame) continue;
        if (!oldest || e.used < oldest.used) oldest = { cache, key, used: e.used };
      }
    }
    if (!oldest) return;
    const e = oldest.cache.get(oldest.key);
    if (e && e.texture !== this.blank) e.texture.dispose();
    oldest.cache.delete(oldest.key);
  }

  dispose(): void {
    for (const s of this.pool) {
      s.material.dispose();
      s.removeFromParent();
    }
    this.pool.length = 0;
    for (const cache of [this.caches.damage, this.caches.heal]) {
      for (const e of cache.values()) if (e.texture !== this.blank) e.texture.dispose();
      cache.clear();
    }
    this.blank.dispose();
    this.shown = 0;
  }
}
