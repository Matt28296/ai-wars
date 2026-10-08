// The 3D terrain kit (D-018, art-direction.md "Terrain kit"): `createTerrain` builds the whole board as a handful of merged or instanced
// meshes (about a dozen draw calls on the largest map), so the renderer core can spend its budget on units and effects.
//
//   ground    bevelled tiles with baked vertex-colour noise, height steps, ridge facets, river banks and shoal dips   (ground.ts)
//   water     sea / river / shoal / under-span water: waves, glints, shore foam, a current in rivers                  (water.ts)
//   trees     3-5 instanced, swaying trees per canopy tile, two species                                              (flora.ts)
//   props     boulders, pebbles, glass shards, maglev track and bridges, the six property models                     (flora.ts, track.ts, buildings.ts)
//   rings     capture rings, one mesh, progress read from a texture                                                  (capture.ts)
//   low form  a property under a unit sinks its tall parts to a quarter height: a one-texel-per-tile map the vertex shader reads  (shading.ts)
// Fog of war and the ion-storm grade are applied inside every material (shading.ts), so one texture write changes what is dimmed.
import {
  BufferAttribute, Color, Group, InstancedMesh, Mesh, NearestFilter,
  type BufferGeometry, type Material, type Texture,
} from 'three';
import type { FactionId, Weather } from '../../../game/aw';
import type { CreateTerrain, TerrainInput, TerrainView } from '../contract';
import { FACTION_ACCENT, FACTION_COLOR, NEUTRAL_COLOR } from '../palette';
import { addProperty, NEUTRAL_ACCENT } from './buildings';
import { buildRings, createRingMaterial } from './capture';
import { addDecor, broadleafGeometry, pineGeometry, planTrees } from './flora';
import { PartSet, SINK_ATTR, type Bucket, type PartRecord } from './geo';
import { buildGround } from './ground';
import { analyseBoard, type Board } from './layout';
import { smoothstep } from './rng';
import { LOW_EASE_SEC, buildWindowTextures, createMaterials, createUniforms, lowFormY, tileMap } from './shading';
import { buildSigilAtlas, sigilCell, sigilInk, sigilUv } from './sigils';
import { addTrack } from './track';
import { buildWater, createWaterMaterial } from './water';

export { analyseBoard, neighbourMask, pieceFor, pieceMask, rotateMask, WALK_HEIGHT } from './layout';
export type { Piece, PieceKind } from './layout';
export { sigilCell, sigilInk } from './sigils';

export interface TerrainStats {
  tiles: number;
  /** Renderable objects in the group; each is one draw call, plus one more in the shadow pass if it casts shadows. */
  meshes: number;
  drawCalls: number;
  triangles: number;
  trees: number;
  properties: number;
}

export interface TerrainDebug {
  /** Fog map value of a tile: 255 seen, 0 hidden. */
  fogAt(x: number, y: number): number;
  /** Capture map value of a tile, 0..255. */
  captureAt(x: number, y: number): number;
  /** Current ion-storm amount, 0..1. */
  storm(): number;
  /** Faction a property currently shows (null = neutral). */
  factionAt(x: number, y: number): FactionId | null;
  /** How low a tile's property sits right now, 0 (full form) to 1 (low form): the value the vertex shader reads from the low map. */
  lowAt(x: number, y: number): number;
  /**
   * The vertical extent of a property tile's parts as drawn right now, the vertex shader's arithmetic run on the CPU over the real
   * merged geometry: parts that stay (pad, owner band, bay, banner, sigil, landing disc) and parts that sink (everything else).
   * Null for a tile with no such parts. Heights are world Y, the highest vertex of each kind.
   */
  extentAt(x: number, y: number): { stays: { minY: number; maxY: number } | null; sinks: { minY: number; maxY: number } | null; pad: number } | null;
  /** Colour (0xRRGGBB) the first paint part of a property currently has, read back from the vertex buffer. */
  paintAt(x: number, y: number): number | null;
  /** The atlas cell the property's banner sigil currently points at, read back from the decal UVs. */
  sigilAt(x: number, y: number): number | null;
  /** The sigil alpha (0..255) a player would see at (a, b) in 0..1 across a property's banner decal, read through the decal's real UVs into the atlas. */
  sigilSample(x: number, y: number, a: number, b: number): number | null;
  /** Every material the kit uses, by role, and the shared uniforms they must all read (the fog map above all). */
  materials(): Record<string, Material>;
  uniforms(): { fogMap: Texture; storm: number; time: number; occMap: Texture };
}

export interface TerrainKit extends TerrainView {
  readonly board: Board;
  readonly stats: TerrainStats;
  readonly debug: TerrainDebug;
  /** Geometries, materials and textures this kit created that have not been disposed. */
  live(): { geometries: number; materials: number; textures: number };
}

/**
 * The brightest a beacon may be, as the luminance of its HDR colour. The stage's bloom keeps whatever passes its threshold whole, so a brighter
 * beacon only widens its halo: measured in the real stage, a Helion spire beacon at luminance 1.6 hazed 8 px (0.15 tile) and the yellow Kestrel
 * accent, which is brighter per unit, would have gone further. Past this the beacon's multiplier is cut down, never its colour.
 */
export const BEACON_MAX_LUMA = 1.3;
/** The glow materials breathe by this fraction of their brightness (a slow sine), so the brightest a glow ever gets is (1 + GLOW_PULSE) times its colour. */
export const GLOW_PULSE = 0.1;

class Ledger {
  readonly geometries = new Set<BufferGeometry>();
  readonly materials = new Set<Material>();
  readonly textures = new Set<Texture>();
  geometry<T extends BufferGeometry>(g: T): T {
    this.geometries.add(g);
    g.addEventListener('dispose', () => this.geometries.delete(g));
    return g;
  }
  material<T extends Material>(m: T): T {
    this.materials.add(m);
    m.addEventListener('dispose', () => this.materials.delete(m));
    return m;
  }
  texture<T extends Texture>(t: T): T {
    this.textures.add(t);
    t.addEventListener('dispose', () => this.textures.delete(t));
    return t;
  }
  disposeAll(): void {
    for (const g of [...this.geometries]) g.dispose();
    for (const m of [...this.materials]) m.dispose();
    for (const t of [...this.textures]) t.dispose();
  }
}

const triangleCount = (m: Mesh): number => {
  const g = m.geometry;
  const per = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  return m instanceof InstancedMesh ? per * m.count : per;
};

export function createTerrainKit(input: TerrainInput): TerrainKit {
  const board = analyseBoard(input);
  const { width, height } = board;
  const ledger = new Ledger();
  const group = new Group();
  group.name = 'terrain';

  // Textures and shared uniforms.
  const fogMap = ledger.texture(tileMap(width, height, 255));
  const capMap = ledger.texture(tileMap(width, height, 0, NearestFilter));
  const occMap = ledger.texture(tileMap(width, height, 0, NearestFilter));
  const atlas = ledger.texture(buildSigilAtlas());
  const win = buildWindowTextures();
  ledger.texture(win.albedo);
  ledger.texture(win.emissive);
  const uniforms = createUniforms(fogMap, width, height, occMap);
  const mats = createMaterials(uniforms, win.albedo, win.emissive, atlas);
  const waterMat = createWaterMaterial(uniforms);
  const ringMat = createRingMaterial(uniforms, capMap);
  for (const m of [mats.ground, mats.solid, mats.glossy, mats.windows, mats.glow, mats.decal, mats.tree, mats.treeDepth, mats.sinkDepth, waterMat, ringMat]) ledger.material(m);

  const meshes: Mesh[] = [];
  const add = (name: string, geo: BufferGeometry, mat: Material, cast: boolean, receive: boolean, order = 0): Mesh => {
    const mesh = new Mesh(ledger.geometry(geo), mat);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.renderOrder = order;
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // Ground and water.
  const ground = buildGround(board);
  add('terrain:ground', ground.geometry, mats.ground, true, true);
  const water = buildWater(board);
  if (water.geometry) add('terrain:water', water.geometry, waterMat, false, true);

  // Props: track, decor, buildings, merged per bucket.
  const parts = new PartSet();
  for (const t of board.tiles) {
    addTrack(parts, t);
    addDecor(parts, t);
    addProperty(parts, t);
  }
  const merged = parts.finish();
  const bucketMat: Record<Bucket, Material> = { solid: mats.solid, glossy: mats.glossy, windows: mats.windows, glow: mats.glow, decal: mats.decal };
  const bucketGeo: Partial<Record<Bucket, BufferGeometry>> = {};
  for (const b of ['solid', 'glossy', 'windows', 'glow', 'decal'] as Bucket[]) {
    const g = merged[b];
    if (!g) continue;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    bucketGeo[b] = g;
    const mesh = add(`terrain:${b}`, g, bucketMat[b], b !== 'glow' && b !== 'decal', b !== 'glow', b === 'decal' ? 1 : 0);
    // The shadow of an occupied property shrinks with the property (the default depth material knows nothing of the low form).
    if (mesh.castShadow) mesh.customDepthMaterial = mats.sinkDepth;
  }

  // Trees.
  const plan = planTrees(board);
  const species = [pineGeometry(), broadleafGeometry()];
  for (const sp of [0, 1] as const) {
    const list = plan.filter((p) => p.species === sp);
    const geo = ledger.geometry(species[sp]);
    if (!list.length) continue;
    const im = new InstancedMesh(geo, mats.tree, list.length);
    im.name = sp === 0 ? 'terrain:pines' : 'terrain:broadleaf';
    list.forEach((inst, i) => { im.setMatrixAt(i, inst.matrix); im.setColorAt(i, inst.tint); });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.customDepthMaterial = mats.treeDepth;
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    meshes.push(im);
  }

  // Capture rings.
  const rings = buildRings(board);
  if (rings) add('terrain:capture-rings', rings, ringMat, false, false, 5);

  // ---------------------------------------------------------------- owners

  const byTile = new Map<number, PartRecord[]>();
  for (const r of parts.records) {
    const list = byTile.get(r.tile);
    if (list) list.push(r); else byTile.set(r.tile, [r]);
  }
  const shown = new Map<number, FactionId | null>();
  const tmp = new Color();

  function showOwner(tile: number, faction: FactionId | null): void {
    const recs = byTile.get(tile);
    if (!recs) return;
    const paint = faction ? FACTION_COLOR[faction] : NEUTRAL_COLOR;
    const accent = faction ? FACTION_ACCENT[faction] : NEUTRAL_ACCENT;
    const ink = faction ? sigilInk(faction) : 0xffffff;
    const [u0, v0, u1, v1] = sigilUv(sigilCell(faction));
    for (const rec of recs) {
      const g = bucketGeo[rec.bucket];
      if (!g) continue;
      const col = g.getAttribute('color') as BufferAttribute;
      if (rec.role === 'paint') tmp.setHex(paint);
      else if (rec.role === 'accent') tmp.setHex(accent);
      else tmp.setHex(ink);
      // An unowned beacon is a dull lens, not a light; an owned one is capped so its bloom stays a tight glow.
      let mult = rec.mult;
      if (rec.role === 'accent') {
        if (!faction) mult *= 0.16;
        else {
          const luma = 0.2126 * tmp.r + 0.7152 * tmp.g + 0.0722 * tmp.b;
          if (luma * mult > BEACON_MAX_LUMA) mult = BEACON_MAX_LUMA / luma;
        }
      }
      for (let i = rec.start; i < rec.start + rec.count; i++) col.setXYZ(i, tmp.r * mult, tmp.g * mult, tmp.b * mult);
      col.needsUpdate = true;
      if (rec.role === 'ink' && rec.baseUv) {
        const uv = g.getAttribute('uv') as BufferAttribute;
        for (let k = 0; k < rec.count; k++) uv.setXY(rec.start + k, u0 + rec.baseUv[k * 2] * (u1 - u0), v0 + rec.baseUv[k * 2 + 1] * (v1 - v0));
        uv.needsUpdate = true;
      }
    }
    shown.set(tile, faction);
  }

  const properties = board.tiles.filter((t) => t.property);
  // The low form: per property tile, a target (1 = a unit stands here) and an eased progress. The map the shader reads holds the progress
  // passed through smoothstep, so the sink starts and ends gently; `update` writes only the tiles that are still moving.
  const lowTarget = new Uint8Array(width * height);
  const lowProgress = new Float32Array(width * height);
  const lowMap = occMap.image.data as Uint8Array;
  let stormTarget = input.weather === 'ionstorm' ? 1 : 0;
  uniforms.uStorm.value = stormTarget;
  const stats: TerrainStats = {
    tiles: width * height,
    meshes: meshes.length,
    drawCalls: meshes.reduce((n, m) => n + 1 + (m.castShadow ? 1 : 0), 0),
    triangles: meshes.reduce((n, m) => n + triangleCount(m), 0),
    trees: plan.length,
    properties: properties.length,
  };
  const view: TerrainKit = {
    group,
    board,
    heightAt(x, y) {
      const cx = Math.min(width - 1, Math.max(0, Math.floor(x)));
      const cy = Math.min(height - 1, Math.max(0, Math.floor(y)));
      return board.at(cx, cy).walk;
    },
    setOwners(ownerAt) {
      for (const t of properties) {
        const p = ownerAt(t.x, t.y);
        const f = p === null ? null : input.factionOf(p);
        if (shown.get(t.index) !== f || !shown.has(t.index)) showOwner(t.index, f);
      }
    },
    setCapture(progressAt) {
      const data = capMap.image.data as Uint8Array;
      for (const t of properties) data[t.index] = Math.round(Math.min(1, Math.max(0, progressAt(t.x, t.y))) * 255);
      capMap.needsUpdate = true;
    },
    setOccupied(occupiedAt) {
      for (const t of properties) lowTarget[t.index] = occupiedAt(t.x, t.y) ? 1 : 0;
    },
    setVisible(visibleAt) {
      const data = fogMap.image.data as Uint8Array;
      for (const t of board.tiles) data[t.index] = visibleAt(t.x, t.y) ? 255 : 0;
      fogMap.needsUpdate = true;
    },
    setWeather(weather: Weather) {
      stormTarget = weather === 'ionstorm' ? 1 : 0;
    },
    update(dtSec, timeSec) {
      // A huge dt (scrubbing, a first frame after a long pause) reaches every target at once; NaN and negative steps do nothing.
      const dt = dtSec > 0 ? dtSec : 0;
      const step = Math.min(dt, 1e6) / LOW_EASE_SEC;
      let moved = false;
      if (step > 0) {
        for (const t of properties) {
          const i = t.index;
          const goal = lowTarget[i];
          const p = lowProgress[i];
          if (p === goal) continue;
          lowProgress[i] = goal > p ? Math.min(goal, p + step) : Math.max(goal, p - step);
          lowMap[i] = Math.round(smoothstep(0, 1, lowProgress[i]) * 255);
          moved = true;
        }
      }
      if (moved) occMap.needsUpdate = true;
      uniforms.uTime.value = timeSec;
      uniforms.uStorm.value += (stormTarget - uniforms.uStorm.value) * (1 - Math.exp(-dt * 3));
      mats.glow.emissiveIntensity = 1 + GLOW_PULSE * Math.sin(timeSec * 2.3);
    },
    dispose() {
      group.clear();
      ledger.disposeAll();
    },
    stats,
    debug: {
      fogAt: (x, y) => (fogMap.image.data as Uint8Array)[y * width + x],
      captureAt: (x, y) => (capMap.image.data as Uint8Array)[y * width + x],
      storm: () => uniforms.uStorm.value,
      factionAt: (x, y) => shown.get(y * width + x) ?? null,
      lowAt: (x, y) => lowMap[y * width + x] / 255,
      extentAt(x, y) {
        const tile = board.at(x, y);
        if (!tile.property) return null;
        const low = lowMap[tile.index] / 255;
        const out = { stays: null as { minY: number; maxY: number } | null, sinks: null as { minY: number; maxY: number } | null, pad: tile.walk };
        for (const b of ['solid', 'glossy', 'windows', 'glow', 'decal'] as Bucket[]) {
          const g = bucketGeo[b];
          if (!g) continue;
          const pos = g.getAttribute('position') as BufferAttribute;
          const sk = g.getAttribute(SINK_ATTR) as BufferAttribute;
          for (let i = 0; i < pos.count; i++) {
            if (Math.floor(pos.getX(i)) !== x || Math.floor(pos.getZ(i)) !== y) continue;
            const yy = lowFormY(pos.getY(i), sk.getX(i), sk.getY(i), low);
            const k = sk.getX(i) > 0.5 ? 'sinks' : 'stays';
            const e = out[k];
            if (!e) out[k] = { minY: yy, maxY: yy };
            else { e.minY = Math.min(e.minY, yy); e.maxY = Math.max(e.maxY, yy); }
          }
        }
        return out;
      },
      materials: () => ({ ...mats, water: waterMat, rings: ringMat }),
      uniforms: () => ({ fogMap: uniforms.uFogMap.value, storm: uniforms.uStorm.value, time: uniforms.uTime.value, occMap: uniforms.uOccMap.value }),
      paintAt(x, y) {
        const rec = byTile.get(y * width + x)?.find((r) => r.role === 'paint');
        const g = rec && bucketGeo[rec.bucket];
        if (!rec || !g) return null;
        const col = g.getAttribute('color') as BufferAttribute;
        return tmp.setRGB(col.getX(rec.start), col.getY(rec.start), col.getZ(rec.start)).getHex();
      },
      sigilSample(x, y, a, b) {
        const rec = byTile.get(y * width + x)?.find((r) => r.role === 'ink' && r.baseUv);
        const g = rec && bucketGeo.decal;
        if (!rec || !g || !rec.baseUv) return null;
        const uv = g.getAttribute('uv') as BufferAttribute;
        let lo = -1; let hi = -1;
        for (let k = 0; k < rec.count; k++) {
          if (rec.baseUv[k * 2] === 0 && rec.baseUv[k * 2 + 1] === 0) lo = rec.start + k;
          if (rec.baseUv[k * 2] === 1 && rec.baseUv[k * 2 + 1] === 1) hi = rec.start + k;
        }
        if (lo < 0 || hi < 0) return null;
        const u = uv.getX(lo) + (uv.getX(hi) - uv.getX(lo)) * a;
        const v = uv.getY(lo) + (uv.getY(hi) - uv.getY(lo)) * b;
        const img = atlas.image as { data: Uint8Array; width: number; height: number };
        const px = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width)));
        const py = Math.min(img.height - 1, Math.max(0, Math.floor(v * img.height)));
        return img.data[(py * img.width + px) * 4 + 3];
      },
      sigilAt(x, y) {
        const rec = byTile.get(y * width + x)?.find((r) => r.role === 'ink' && r.baseUv);
        const g = rec && bucketGeo.decal;
        if (!rec || !g || !rec.baseUv) return null;
        const uv = g.getAttribute('uv') as BufferAttribute;
        // Find the cell whose rectangle contains this decal's first corner.
        for (let cell = 0; cell < 6; cell++) {
          const [u0, v0, u1, v1] = sigilUv(cell);
          const u = uv.getX(rec.start); const v = uv.getY(rec.start);
          if (u >= u0 - 1e-6 && u <= u1 + 1e-6 && v >= v0 - 1e-6 && v <= v1 + 1e-6) return cell;
        }
        return null;
      },
    },
    live: () => ({ geometries: ledger.geometries.size, materials: ledger.materials.size, textures: ledger.textures.size }),
  };
  view.setOwners(input.ownerAt);
  return view;
}

export const createTerrain: CreateTerrain = (input) => createTerrainKit(input);
