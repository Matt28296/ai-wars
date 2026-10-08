// Instanced draw batches. The whole kit draws through three of them, so a frame costs three draw calls however many effects run:
//   glow   additive sprites, flats and ribbons (HDR, feeds the bloom)
//   smoke  alpha-blended puffs and dark badges (drawn before the glow so fire sits on top of its smoke)
//   debris opaque lit chunks
// Each batch owns one preallocated Float32Array. draw() rewrites the front of it and uploads only that range; nothing is allocated.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  NormalBlending,
  ShaderMaterial,
} from 'three';
import { DEBRIS_FRAGMENT, DEBRIS_VERTEX, MODE, SPRITE_FRAGMENT, SPRITE_VERTEX } from './shaders';

const STRIDE = 16;

/** Instance data below this opacity draws nothing, so it is not written at all. */
export const MIN_ALPHA = 0.002;

interface UpdateRange { start: number; count: number }

abstract class Batch {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly data: Float32Array;
  /** Instances written this frame. */
  n = 0;
  /** Writes refused because the batch was full (a frame with far too many effects). */
  dropped = 0;
  protected readonly buffer: InstancedInterleavedBuffer;
  private readonly range: UpdateRange = { start: 0, count: 0 };

  protected constructor(
    readonly capacity: number,
    geometry: InstancedBufferGeometry,
    material: ShaderMaterial,
    attributes: readonly string[],
    name: string,
    renderOrder: number,
  ) {
    this.data = new Float32Array(capacity * STRIDE);
    this.buffer = new InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(DynamicDrawUsage);
    attributes.forEach((a, i) => geometry.setAttribute(a, new InterleavedBufferAttribute(this.buffer, 4, i * 4)));
    geometry.instanceCount = 0;
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
  }

  reset(): void {
    this.n = 0;
    this.dropped = 0;
  }

  /** Publishes this frame's instances: shows the mesh if there are any, hides it if not, and uploads only the used range. */
  commit(): void {
    const n = this.n;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    this.buffer.clearUpdateRanges();
    this.range.start = 0;
    this.range.count = n * STRIDE;
    this.buffer.updateRanges.push(this.range);
    this.buffer.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

function quad(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  return g;
}

export class SpriteBatch extends Batch {
  constructor(capacity: number, kind: 'add' | 'normal', name: string, renderOrder: number, bias: number) {
    const material = new ShaderMaterial({
      vertexShader: SPRITE_VERTEX,
      fragmentShader: SPRITE_FRAGMENT,
      uniforms: { uBias: { value: bias } },
      side: DoubleSide, // ground-flat quads wind the other way round when seen from above
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: kind === 'add' ? AdditiveBlending : NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    super(capacity, quad(), material, ['iA', 'iB', 'iC', 'iD'], name, renderOrder);
  }

  /** A quad that faces the camera (`MODE.FACING`) or lies on the ground (`MODE.FLAT`). `size` is the half-extent in world units. */
  sprite(
    x: number, y: number, z: number, size: number, rot: number, shape: number,
    r: number, g: number, b: number, a: number,
    mode: number = MODE.FACING, variation = 0, param = 0,
  ): void {
    if (!(a > MIN_ALPHA) || !(size > 0)) return;
    if (this.n >= this.capacity) { this.dropped++; return; }
    const d = this.data;
    const o = this.n * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size;
    d[o + 4] = 0; d[o + 5] = 0; d[o + 6] = 0; d[o + 7] = rot;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    d[o + 12] = shape; d[o + 13] = mode; d[o + 14] = variation; d[o + 15] = param;
    this.n++;
  }

  /** A camera-facing ribbon from (x0,y0,z0) to (x1,y1,z1), `halfWidth` world units to each side. */
  ribbon(
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, halfWidth: number, shape: number,
    r: number, g: number, b: number, a: number, variation = 0, param = 0,
  ): void {
    if (!(a > MIN_ALPHA) || !(halfWidth > 0)) return;
    if (this.n >= this.capacity) { this.dropped++; return; }
    const d = this.data;
    const o = this.n * STRIDE;
    d[o] = x0; d[o + 1] = y0; d[o + 2] = z0; d[o + 3] = halfWidth;
    d[o + 4] = x1; d[o + 5] = y1; d[o + 6] = z1; d[o + 7] = 0;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    d[o + 12] = shape; d[o + 13] = MODE.RIBBON; d[o + 14] = variation; d[o + 15] = param;
    this.n++;
  }
}

export class DebrisBatch extends Batch {
  constructor(capacity: number) {
    const box = new BoxGeometry(1, 1, 1);
    const g = new InstancedBufferGeometry();
    g.setIndex(box.getIndex());
    g.setAttribute('position', box.getAttribute('position'));
    g.setAttribute('normal', box.getAttribute('normal'));
    const material = new ShaderMaterial({ vertexShader: DEBRIS_VERTEX, fragmentShader: DEBRIS_FRAGMENT });
    super(capacity, g, material, ['iPos', 'iQuat', 'iScl', 'iCol'], 'fx-debris', 5);
  }

  /** One chunk: centre, heat (0 cold .. 1 glowing), rotation as a unit quaternion, size and base colour. */
  chunk(
    x: number, y: number, z: number, heat: number,
    qx: number, qy: number, qz: number, qw: number,
    sx: number, sy: number, sz: number,
    r: number, g: number, b: number,
  ): void {
    if (!(sx > 0)) return;
    if (this.n >= this.capacity) { this.dropped++; return; }
    const d = this.data;
    const o = this.n * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = heat;
    d[o + 4] = qx; d[o + 5] = qy; d[o + 6] = qz; d[o + 7] = qw;
    d[o + 8] = sx; d[o + 9] = sy; d[o + 10] = sz; d[o + 11] = 0;
    d[o + 12] = r; d[o + 13] = g; d[o + 14] = b; d[o + 15] = 0;
    this.n++;
  }
}
