// PLACEHOLDER effects (lead, D-018): a glowing sphere that grows and fades per effect, so the renderer core can be built
// before the real effects kit lands. The effects builder replaces this file's internals; the export and the FxView
// contract stay as they are.
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { CreateFx, FxView } from '../contract';

export const createFx: CreateFx = () => {
  const group = new Group();
  group.name = 'fx';
  const geo = new SphereGeometry(0.2, 12, 8);
  const pool: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
  const view: FxView = {
    group,
    draw(items) {
      while (pool.length < items.length) {
        const m = new Mesh(geo, new MeshBasicMaterial({ color: 0xffc44d, transparent: true, blending: AdditiveBlending, depthWrite: false }));
        pool.push(m);
        group.add(m);
      }
      pool.forEach((m, i) => {
        const it = items[i];
        m.visible = !!it;
        if (!it) return;
        m.position.copy(it.to && it.kind !== 'muzzle' ? it.at.clone().lerp(it.to, it.progress) : it.at);
        m.scale.setScalar(0.5 + it.progress * (it.kind === 'explosion' ? 3 : 1.5));
        m.material.opacity = 1 - it.progress;
        if (it.color !== undefined) m.material.color.set(it.color);
      });
    },
    numbers() {},
    update() {},
    dispose() {
      geo.dispose();
      for (const m of pool) m.material.dispose();
    },
  };
  return view;
};
