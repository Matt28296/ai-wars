// PLACEHOLDER units (lead, D-018): a faction-coloured block per unit with a nose showing its heading, so the renderer core
// can be built before the real miniatures land. The unit builder replaces this file's internals; the export and the
// UnitView contract stay as they are.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { CreateUnitView, UnitView } from '../contract';
import { FACTION_ACCENT, FACTION_COLOR } from '../palette';

export const createUnitView: CreateUnitView = (type, faction) => {
  const object = new Group();
  object.name = `unit:${type}`;
  const bodyMat = new MeshStandardMaterial({ color: FACTION_COLOR[faction], roughness: 0.6 });
  const noseMat = new MeshStandardMaterial({ color: FACTION_ACCENT[faction], emissive: FACTION_ACCENT[faction], emissiveIntensity: 0.4 });
  const bodyGeo = new BoxGeometry(0.5, 0.3, 0.4);
  const noseGeo = new BoxGeometry(0.15, 0.1, 0.1);
  const body = new Mesh(bodyGeo, bodyMat);
  body.position.y = 0.15;
  body.castShadow = true;
  const nose = new Mesh(noseGeo, noseMat);
  nose.position.set(0.3, 0.2, 0);
  object.add(body, nose);
  const view: UnitView = {
    object,
    type,
    setLook(look) {
      object.rotation.y = -look.heading;
      bodyMat.color.set(FACTION_COLOR[faction]).multiplyScalar(look.spent ? 0.55 : 1);
    },
    setPose(pose, t) {
      body.position.x = pose === 'fire' ? -0.05 * Math.sin(Math.PI * t) : pose === 'hit' ? 0.03 * Math.sin(t * 40) : 0;
    },
    muzzleWorld(out) {
      return nose.getWorldPosition(out ?? new Vector3());
    },
    update() {},
    dispose() {
      bodyGeo.dispose();
      noseGeo.dispose();
      bodyMat.dispose();
      noseMat.dispose();
    },
  };
  return view;
};
