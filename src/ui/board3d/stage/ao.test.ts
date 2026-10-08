// The ambient-occlusion pass, in node: what it leaves out of its depth+normal buffer, that it does not redraw the shadow map, that the
// look it is tuned to is the one in AO_LOOK, and that dispose frees its targets. The GPU is a stand-in that records what it was asked.
import {
  AdditiveBlending, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera, Points, PointsMaterial,
  Scene, Sprite, SpriteMaterial, Vector2,
} from 'three';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import { describe, expect, it } from 'vitest';
import { AO_LOOK, StageAoPass, excludedFromAo } from './ao';

const box = new BoxGeometry(1, 1, 1);
const solid = (): Mesh => new Mesh(box, new MeshStandardMaterial());
const seeThrough = (): Mesh => new Mesh(box, new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending }));

describe('what stays out of the occlusion buffer', () => {
  it('a see-through layer (a mesh whose material does not write depth), a sprite and a flagged object are out, and so is a mixed-material mesh with a see-through layer', () => {
    expect(excludedFromAo(seeThrough())).toBe(true);
    expect(excludedFromAo(new Sprite(new SpriteMaterial()))).toBe(true);
    const flagged = solid();
    flagged.userData.noAO = true;
    expect(excludedFromAo(flagged)).toBe(true);
    // a mesh with several materials is out when ANY of them is see-through (a decal layer over a solid body is not solid)
    const mixed = new Mesh(box, [new MeshStandardMaterial(), new MeshBasicMaterial({ depthWrite: false })]);
    expect(excludedFromAo(mixed)).toBe(true);
  });

  it('known-bad: solid things stay in, and a group or a bare object is not "excluded" by this rule (point clouds are hidden by three itself, see below)', () => {
    expect(excludedFromAo(solid())).toBe(false);
    expect(excludedFromAo(new Mesh(box, [new MeshStandardMaterial(), new MeshStandardMaterial()]))).toBe(false);
    expect(excludedFromAo(new Group())).toBe(false);
    expect(excludedFromAo(new Object3D())).toBe(false);
    const flaggedFalse = solid();
    flaggedFalse.userData.noAO = false;
    expect(excludedFromAo(flaggedFalse)).toBe(false);
  });
});

// ---------------------------------------------------------------- a recording stand-in for the GPU

interface Recorder {
  renderer: WebGLRenderer;
  /** One entry per renderer.render(scene) call that carried an override material: what was visible then, by name. */
  gbuffer: { visible: string[]; shadowAutoUpdate: boolean }[];
  renders: number;
}

function recorder(scene: Scene, names: Map<Object3D, string>): Recorder {
  const rec: Recorder = { renderer: null as unknown as WebGLRenderer, gbuffer: [], renders: 0 };
  const state: Record<string, unknown> = {
    autoClear: true,
    shadowMap: { enabled: true, autoUpdate: true, type: 0 },
    getClearColor: (c: unknown) => c,
    getClearAlpha: () => 1,
    render: (what: unknown) => {
      rec.renders++;
      if (what === scene && scene.overrideMaterial) {
        const visible: string[] = [];
        scene.traverse((o) => { if (o.visible && names.has(o)) visible.push(names.get(o) as string); });
        rec.gbuffer.push({ visible, shadowAutoUpdate: (state.shadowMap as { autoUpdate: boolean }).autoUpdate });
      }
    },
  };
  rec.renderer = new Proxy(state, { get: (t, k) => (k in t ? t[k as string] : () => undefined), set: (t, k, v) => { t[k as string] = v; return true; } }) as unknown as WebGLRenderer;
  return rec;
}

function sceneWithLayers(): { scene: Scene; names: Map<Object3D, string>; byName: Record<string, Object3D> } {
  const scene = new Scene();
  const names = new Map<Object3D, string>();
  const byName: Record<string, Object3D> = {};
  const add = (name: string, o: Object3D): void => { o.name = name; names.set(o, name); byName[name] = o; scene.add(o); };
  add('ground', solid());
  add('tower', solid());
  add('glow', seeThrough());
  add('chip', new Sprite(new SpriteMaterial()));
  add('storm', new Points(new BoxGeometry(1, 1, 1), new PointsMaterial()));
  const flagged = solid();
  flagged.userData.noAO = true;
  add('flagged', flagged);
  const hiddenAlready = solid();
  hiddenAlready.visible = false;
  add('hiddenAlready', hiddenAlready);
  return { scene, names, byName };
}

describe('the pass draws only what is solid, once, and puts everything back', () => {
  it('while the depth+normal buffer is drawn only the solid meshes are visible; before and after, everything is as it was', () => {
    const { scene, names, byName } = sceneWithLayers();
    const camera = new PerspectiveCamera();
    const rec = recorder(scene, names);
    const pass = new StageAoPass(scene, camera, 64, 64);
    const target = { texture: {} } as unknown as WebGLRenderTarget;
    pass.render(rec.renderer, target, target, 0.016, false);
    expect(rec.gbuffer).toHaveLength(1);
    expect(rec.gbuffer[0].visible.sort()).toEqual(['ground', 'tower']); // not glow, chip, storm points or the flagged one
    // restored exactly: what was visible is visible again, what was hidden stays hidden
    for (const n of ['ground', 'tower', 'glow', 'chip', 'storm', 'flagged']) expect(byName[n].visible, n).toBe(true);
    expect(byName.hiddenAlready.visible).toBe(false);
    pass.dispose();
  });

  it('does not redraw the sun\'s shadow map for its flat pass, and leaves the renderer\'s setting as it found it', () => {
    const { scene, names } = sceneWithLayers();
    const rec = recorder(scene, names);
    const pass = new StageAoPass(scene, new PerspectiveCamera(), 64, 64);
    const target = { texture: {} } as unknown as WebGLRenderTarget;
    pass.render(rec.renderer, target, target, 0.016, false);
    expect(rec.gbuffer[0].shadowAutoUpdate).toBe(false); // off while the flat pass ran
    expect(rec.renderer.shadowMap.autoUpdate).toBe(true); // and back on after
    // known-bad: a renderer that had it off stays off (the pass restores, it does not force on)
    rec.renderer.shadowMap.autoUpdate = false;
    pass.render(rec.renderer, target, target, 0.016, false);
    expect(rec.renderer.shadowMap.autoUpdate).toBe(false);
    pass.dispose();
  });

  it('restores visibility and the shadow setting even when drawing throws', () => {
    const { scene, names, byName } = sceneWithLayers();
    const rec = recorder(scene, names);
    const boom = new Proxy(rec.renderer, { get: (t, k) => (k === 'render' ? () => { throw new Error('gpu lost'); } : (t as unknown as Record<string | symbol, unknown>)[k]) });
    const pass = new StageAoPass(scene, new PerspectiveCamera(), 64, 64);
    const target = { texture: {} } as unknown as WebGLRenderTarget;
    expect(() => pass.render(boom as WebGLRenderer, target, target, 0.016, false)).toThrow('gpu lost');
    expect(byName.glow.visible).toBe(true);
    expect(byName.chip.visible).toBe(true);
    expect(rec.renderer.shadowMap.autoUpdate).toBe(true);
    pass.dispose();
  });
});

describe('the look and the teardown', () => {
  it('is tuned to AO_LOOK: a radius of about 0.3 tiles, a soft short fall-off, and a strength that is neither none nor full', () => {
    const pass = new StageAoPass(new Scene(), new PerspectiveCamera(), 64, 64);
    const u = pass.gtaoMaterial.uniforms;
    expect(u.radius.value).toBe(AO_LOOK.radius);
    expect(AO_LOOK.radius).toBeGreaterThanOrEqual(0.25); // the order's range: 0.25 to 0.35 tiles
    expect(AO_LOOK.radius).toBeLessThanOrEqual(0.35);
    expect(u.thickness.value).toBe(AO_LOOK.thickness);
    expect(u.distanceFallOff.value).toBe(AO_LOOK.distanceFallOff);
    expect(u.scale.value).toBe(AO_LOOK.scale);
    expect(pass.blendIntensity).toBe(AO_LOOK.intensity);
    expect(pass.blendIntensity).toBeGreaterThan(0.5);
    expect(pass.blendIntensity).toBeLessThanOrEqual(1);
    // retuning goes through configure()
    pass.configure({ ...AO_LOOK, radius: 0.5, intensity: 0.3 });
    expect(u.radius.value).toBe(0.5);
    expect(pass.blendIntensity).toBe(0.3);
    pass.dispose();
  });

  it('dispose frees the three render targets and both materials the pass made (known-bad: none is freed before)', () => {
    const pass = new StageAoPass(new Scene(), new PerspectiveCamera(), 64, 64);
    const normalTarget = (pass as unknown as { normalRenderTarget: WebGLRenderTarget }).normalRenderTarget;
    const watched: [string, { addEventListener(t: 'dispose', f: () => void): void }][] = [
      ['ao target', pass.gtaoRenderTarget], ['denoise target', pass.pdRenderTarget], ['normal+depth target', normalTarget],
      ['ao material', pass.gtaoMaterial], ['blend material', pass.blendMaterial], ['denoise material', pass.pdMaterial],
    ];
    const freed = new Set<string>();
    for (const [name, o] of watched) o.addEventListener('dispose', () => freed.add(name));
    expect(freed.size).toBe(0);
    pass.dispose();
    expect([...freed].sort()).toEqual(watched.map(([n]) => n).sort());
  });

  it('is sized by the composer like any pass: its targets follow setSize', () => {
    const pass = new StageAoPass(new Scene(), new PerspectiveCamera(), 64, 64);
    pass.setSize(320, 200);
    expect(pass.gtaoRenderTarget.width).toBe(320);
    expect(pass.pdRenderTarget.height).toBe(200);
    const res = pass.gtaoMaterial.uniforms.resolution.value as Vector2;
    expect([res.x, res.y]).toEqual([320, 200]);
    pass.dispose();
  });
});
