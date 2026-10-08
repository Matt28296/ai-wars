// A fixed pool of four point lights for the short light pops of muzzle flashes and explosions.
// The lights stay in the scene and stay visible, with intensity 0 when idle: changing how many lights a scene has makes three
// recompile every lit material, which would be a hitch on the first shot. Four constant lights cost less than one recompile.
import { Group, PointLight } from 'three';

export const MAX_LIGHTS = 4;

export class LightPool {
  readonly lights: PointLight[] = [];
  /** How many lights carry a pop this frame (0..4). */
  active = 0;
  private readonly power = new Float32Array(MAX_LIGHTS);
  private readonly pos = new Float32Array(MAX_LIGHTS * 3);
  private readonly rgb = new Float32Array(MAX_LIGHTS * 3);

  constructor(group: Group) {
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new PointLight(0xffffff, 0, 3.4, 2);
      l.name = `fx-light-${i}`;
      this.lights.push(l);
      group.add(l);
    }
  }

  begin(): void {
    this.active = 0;
  }

  /** Offers a pop. When more than four are offered in a frame the four strongest win (a tie keeps the earlier offer). */
  offer(x: number, y: number, z: number, intensity: number, r: number, g: number, b: number): void {
    if (!(intensity > 0.01)) return;
    let slot = -1;
    if (this.active < MAX_LIGHTS) {
      slot = this.active++;
    } else {
      let weakest = 0;
      for (let i = 1; i < MAX_LIGHTS; i++) if (this.power[i] < this.power[weakest]) weakest = i;
      if (intensity > this.power[weakest]) slot = weakest;
    }
    if (slot < 0) return;
    this.power[slot] = intensity;
    this.pos[slot * 3] = x; this.pos[slot * 3 + 1] = y; this.pos[slot * 3 + 2] = z;
    this.rgb[slot * 3] = r; this.rgb[slot * 3 + 1] = g; this.rgb[slot * 3 + 2] = b;
  }

  end(): void {
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = this.lights[i];
      if (i < this.active) {
        l.position.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
        l.color.setRGB(this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]);
        l.intensity = this.power[i];
      } else {
        // idle: nothing of the last pop is left behind, so the lights too are drawn from this frame's items alone
        l.intensity = 0;
        l.position.set(0, 0, 0);
        l.color.setRGB(1, 1, 1);
      }
    }
  }

  dispose(): void {
    for (const l of this.lights) {
      l.dispose();
      l.removeFromParent();
    }
    this.lights.length = 0;
    this.active = 0;
  }
}
