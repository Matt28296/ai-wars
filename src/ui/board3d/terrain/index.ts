// PLACEHOLDER terrain (lead, D-018): one flat-coloured box per tile, so the renderer core can be built and tested before
// the real terrain kit lands. The terrain builder replaces this file's internals; the export and the TerrainView contract
// stay as they are.
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import type { CreateTerrain, TerrainView } from '../contract';
import { tileCenter } from '../contract';
import { FACTION_COLOR, NEUTRAL_COLOR, TERRAIN_COLOR, terrainFamily } from '../palette';

export const createTerrain: CreateTerrain = (input) => {
  const group = new Group();
  group.name = 'terrain';
  const geo = new BoxGeometry(0.98, 0.2, 0.98);
  const tiles: { mesh: Mesh<BoxGeometry, MeshStandardMaterial>; base: Color }[] = [];
  for (let y = 0; y < input.height; y++) {
    for (let x = 0; x < input.width; x++) {
      const fam = TERRAIN_COLOR[terrainFamily(input.terrainAt(x, y))];
      const mat = new MeshStandardMaterial({ color: fam.base, roughness: 0.9 });
      const mesh = new Mesh(geo, mat);
      const c = tileCenter(x, y);
      mesh.position.set(c.x, -0.1, c.z);
      mesh.receiveShadow = true;
      group.add(mesh);
      tiles.push({ mesh, base: new Color(fam.base) });
    }
  }
  const at = (x: number, y: number) => tiles[y * input.width + x];
  const view: TerrainView = {
    group,
    heightAt: () => 0,
    setOwners(ownerAt) {
      for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
        if (terrainFamily(input.terrainAt(x, y)) !== 'structure') continue;
        const p = ownerAt(x, y);
        const f = p === null ? null : input.factionOf(p);
        at(x, y).base.set(f ? FACTION_COLOR[f] : NEUTRAL_COLOR);
        at(x, y).mesh.material.color.copy(at(x, y).base);
      }
    },
    setCapture() {},
    setVisible(visibleAt) {
      for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
        const t = at(x, y);
        t.mesh.material.color.copy(t.base).multiplyScalar(visibleAt(x, y) ? 1 : 0.45);
      }
    },
    setWeather() {},
    update() {},
    dispose() {
      geo.dispose();
      for (const t of tiles) t.mesh.material.dispose();
    },
  };
  view.setOwners(input.ownerAt);
  return view;
};
