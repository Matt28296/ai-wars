// Ambient occlusion for the diorama (G12). GTAO (three's GTAOPass) darkens the creases a miniature has: where a tower meets its pad, a
// tank meets the ground, a tree meets the canopy floor. It sits right after the scene in the composer, BEFORE the bloom, so the
// darkening happens on linear light and a glow is never lifted by it.
//
// GTAOPass draws the scene a second time (all meshes, one flat normal material, into a small depth+normal buffer). That second draw is
// the cost of the pass, so this subclass makes it as cheap and as truthful as it can:
//   * it leaves out everything the beauty pass does not write depth for (particles, glow quads, sprites, the chips over the units, the
//     capture rings, the sweep band, the backdrop dome) and anything flagged `userData.noAO`: a thing that is not solid in the picture
//     must not occlude, and the flat material would otherwise draw it as a solid card;
//   * it does not redraw the sun's shadow map for that pass (the beauty pass just did).
// What is solid and moves with the camera is the whole picture, so nothing is cached between frames.
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { Camera, Material, Object3D, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';

/**
 * The look, in world units (one tile is 1). Tuned on the real board in SwiftShader screenshots:
 *   radius       0.3 tiles: a crease the size of a prop's foot, not a shadow across a tile.
 *   thickness    1.0: samples more than a tile in front of or behind a point cannot occlude it (a tower behind a tree does not darken it).
 *   falloff      1.0: the soft, short fall-off GTAO calls distanceFallOff (full weight near, fading toward the radius).
 *   scale        1.5: the exponent on the AO term. AO is 1 on open ground and a power of 1 is 1, so a higher exponent deepens the creases
 *                (tower feet, hulls, tile seams) without touching a flat tile's face; it is the knob that grounds props and keeps ground clean.
 *   intensity    0.9: how much of the AO term reaches the picture; below 1 it lightens every crease evenly.
 * Measured in round 2 of the G12 screenshots (SwiftShader, 1280x800, two zoom steps in): scale 1.0 left towers faintly seated; 2.0 with
 * radius 0.35 dirtied the pads and the tower walls; 1.5 at 0.3 grounds towers and tanks, darkens only the tile seams of open ground,
 * and leaves every tile face and the table, plinth and backdrop untouched.
 */
export const AO_LOOK = {
  radius: 0.3,
  thickness: 1,
  distanceExponent: 1,
  distanceFallOff: 1,
  scale: 1.5,
  samples: 16,
  intensity: 0.9,
} as const;

export interface AoLook {
  radius: number;
  thickness: number;
  distanceExponent: number;
  distanceFallOff: number;
  scale: number;
  samples: number;
  intensity: number;
}

type AoMaterialInfo = { depthWrite?: boolean };

/** True when an object must stay out of the AO's depth+normal buffer. */
export function excludedFromAo(o: Object3D): boolean {
  if (o.userData && o.userData.noAO === true) return true;
  const flags = o as unknown as { isSprite?: boolean; isMesh?: boolean; material?: Material | Material[] };
  if (flags.isSprite) return true;
  if (!flags.isMesh || !flags.material) return false;
  const mats = Array.isArray(flags.material) ? flags.material : [flags.material];
  // a mesh with any material that does not write depth is a see-through layer (glow, smoke, ring, band): leave it out whole
  return mats.some((m) => (m as unknown as AoMaterialInfo).depthWrite === false);
}

export class StageAoPass extends GTAOPass {
  private readonly hiddenForAo: Object3D[] = [];

  constructor(scene: Scene, camera: Camera, width: number, height: number, look: AoLook = AO_LOOK) {
    super(scene, camera, width, height);
    this.configure(look);
  }

  /** Applies a look (also how a test or the viewer would retune it). */
  configure(look: AoLook): void {
    this.updateGtaoMaterial({
      radius: look.radius,
      thickness: look.thickness,
      distanceExponent: look.distanceExponent,
      distanceFallOff: look.distanceFallOff,
      scale: look.scale,
      samples: look.samples,
    });
    this.blendIntensity = look.intensity;
  }

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    const hidden = this.hiddenForAo;
    this.scene.traverse((o) => {
      if (o.visible && excludedFromAo(o)) {
        o.visible = false;
        hidden.push(o);
      }
    });
    // the beauty pass has just drawn this frame's shadow map; the flat pass needs none
    const shadow = renderer.shadowMap;
    const auto = shadow.autoUpdate;
    shadow.autoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      shadow.autoUpdate = auto;
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      hidden.length = 0;
    }
  }

  /**
   * Frees what GTAOPass.dispose leaves behind: its AO and blend materials. (Its own dispose frees the three render targets, the noise
   * textures and the other materials.)
   */
  override dispose(): void {
    super.dispose();
    this.gtaoMaterial.dispose();
    this.blendMaterial.dispose();
  }
}
