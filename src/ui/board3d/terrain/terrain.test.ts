// The terrain kit as the renderer core sees it: createTerrain over real and synthetic boards, in node (no DOM, no GPU).
import { BufferAttribute, Color, InstancedMesh, Mesh, ShaderLib, type Material, type Object3D, type ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../../../content/maps';
import { MISSION_MAPS } from '../../../content/mission-maps';
import type { MapDef } from '../../../content/types';
import { TERRAIN_LIST } from '../../../data';
import type { FactionId, TerrainId } from '../../../game/aw';
import type { TerrainInput } from '../contract';
import { FACTION_ACCENT, FACTION_COLOR, NEUTRAL_COLOR } from '../palette';
import { createTerrain, createTerrainKit } from './index';
import { BASE_Y, WALK_HEIGHT, isProperty } from './layout';
import { planTrees } from './flora';
import { analyseBoard } from './layout';
import { GRADE_GLSL, fogGrade } from './shading';
import {
  ATLAS_COLS, ATLAS_ROWS, CELL, SIGIL_BLANK, SIGIL_ORDER, contrast, rasterSigil, sigilCell, sigilInk, sigilInside, sigilUv, buildSigilAtlas,
} from './sigils';
import { FACTIONS, boardInput, stressRows } from './testing';

const ALL_IDS = TERRAIN_LIST.map((t) => t.id) as TerrainId[];
const CODE_OF: Record<TerrainId, string> = {
  flats: '.', canopy: 'f', ridge: '^', maglev: '=', span: '#', river: 'r', sea: '~', shoal: 's', glass: 'g',
  arcology: 'C', fabricator: 'F', skyport: 'A', dock: 'D', uplink: 'U', spire: 'H',
};

function mapInput(m: MapDef, weather: 'clear' | 'ionstorm' = 'clear'): TerrainInput {
  const codes = boardInput(m.terrain);
  return {
    ...codes,
    ownerAt: (x, y) => {
      const c = m.owners[y][x];
      return c === '.' ? null : Number(c);
    },
    weather,
  };
}

const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => { if (o instanceof Mesh) out.push(o); });
  return out;
};

describe('every terrain builds', () => {
  it('all 15 TerrainIds appear in the id table and build alone, in a flats field and in a sea', () => {
    expect(ALL_IDS.length).toBe(15);
    for (const id of ALL_IDS) {
      for (const ground of ['.', '~', id === 'sea' ? '.' : CODE_OF[id]]) {
        const c = CODE_OF[id];
        const rows = [ground.repeat(5), `${ground}${ground}${c}${ground}${ground}`, ground.repeat(5)];
        const kit = createTerrainKit(boardInput(rows));
        expect(kit.group.children.length, `${id} on ${ground}`).toBeGreaterThan(0);
        expect(kit.heightAt(2, 1), id).toBe(WALK_HEIGHT[id]);
        kit.update(0.016, 1);
        kit.dispose();
      }
    }
  });

  it('the contract entry point returns a TerrainView with the full interface', () => {
    const view = createTerrain(boardInput(['.f^', '=#r', '~sg']));
    for (const k of ['group', 'heightAt', 'setOwners', 'setCapture', 'setVisible', 'setWeather', 'update', 'dispose'] as const) expect(view[k], k).toBeDefined();
    view.dispose();
  });

  it('every property type builds on a coast, a track end and a field', () => {
    const rows = ['~~~~~~', '~D~A~~', '~~C=F~', '~~~U~H', '......'];
    const kit = createTerrainKit(boardInput(rows));
    expect(kit.stats.properties).toBe(6);
    kit.dispose();
  });
});

describe('heights by terrain', () => {
  it('heightAt gives the walkable surface of each terrain, clamped at the board edge', () => {
    const EXPECTED: Record<TerrainId, number> = {
      flats: 0, canopy: 0, ridge: 0.35, shoal: -0.05, sea: -0.15, river: -0.15, glass: 0,
      maglev: 0.02, span: 0.05, arcology: 0.06, fabricator: 0.06, skyport: 0.06, dock: 0.04, uplink: 0.06, spire: 0.06,
    };
    const rows = ['.f^=#', 'rs~g.', 'CFADU', 'H....'];
    const kit = createTerrainKit(boardInput(rows));
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[0].length; x++) {
        const id = Object.entries(CODE_OF).find(([, c]) => c === rows[y][x])![0] as TerrainId;
        expect(kit.heightAt(x, y), `${id} at ${x},${y}`).toBe(EXPECTED[id]);
        expect(kit.heightAt(x + 0.5, y + 0.5), 'inside the tile').toBe(EXPECTED[id]);
      }
    }
    expect(kit.heightAt(-3, -3)).toBe(kit.heightAt(0, 0));
    expect(kit.heightAt(99, 99)).toBe(kit.heightAt(4, 3));
    kit.dispose();
  });
});

describe('owner recolour and sigils', () => {
  const PROPS = ['C', 'F', 'A', 'D', 'U', 'H'];
  const rows = ['~~~~~~~', '~C.F.A~', '~.....~', '~D.U.H~', '~~~~~~~'];
  const spots: [number, number][] = [[1, 1], [3, 1], [5, 1], [1, 3], [3, 3], [5, 3]];

  it('each faction paints roofs, edge band and banner in its colour and points the banner at its own sigil', () => {
    for (let f = 0; f < FACTIONS.length; f++) {
      const owners: Record<string, number> = {};
      for (const [x, y] of spots) owners[`${x},${y}`] = f;
      const kit = createTerrainKit(boardInput(rows, owners));
      for (const [x, y] of spots) {
        expect(kit.debug.factionAt(x, y)).toBe(FACTIONS[f]);
        expect(kit.debug.paintAt(x, y), `${FACTIONS[f]} paint at ${x},${y}`).toBe(FACTION_COLOR[FACTIONS[f]]);
        expect(kit.debug.sigilAt(x, y), `${FACTIONS[f]} sigil at ${x},${y}`).toBe(sigilCell(FACTIONS[f]));
      }
      kit.dispose();
    }
  });

  it('the banner really shows the faction\'s own shape: decal UVs read through the atlas match the sigil predicate', () => {
    expect(SIGIL_ORDER).toEqual(['helion', 'tidewell', 'verdant', 'kestrel', 'choir']); // the art-direction table's order
    for (let f = 0; f < FACTIONS.length; f++) {
      const kit = createTerrainKit(boardInput(rows, { '1,1': f }));
      // How well what the decal shows matches each faction's shape (the atlas keeps a small margin, so a good match is ~90%, not 100%).
      const agree = Object.fromEntries(FACTIONS.map((g) => [g, 0])) as Record<FactionId, number>;
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 20; j++) {
          const a = (i + 0.5) / 20;
          const b = (j + 0.5) / 20;
          const seen = kit.debug.sigilSample(1, 1, a, b)! > 127;
          for (const g of FACTIONS) if (seen === sigilInside(g, a * 2 - 1, b * 2 - 1)) agree[g]++;
        }
      }
      const own = agree[FACTIONS[f]] / 400;
      const best = Math.max(...FACTIONS.filter((g) => g !== FACTIONS[f]).map((g) => agree[g] / 400));
      expect(own, FACTIONS[f]).toBeGreaterThan(0.85);
      // A swapped sigil would match some OTHER faction's shape better than its own: it must beat every other by a clear margin.
      expect(own - best, `${FACTIONS[f]} against the others`).toBeGreaterThan(0.05);
      kit.dispose();
    }
    const neutral = createTerrainKit(boardInput(rows));
    for (let i = 0; i < 10; i++) expect(neutral.debug.sigilSample(1, 1, (i + 0.5) / 10, 0.5)).toBe(0);
    neutral.dispose();
  });

  it('neutral properties are grey with a blank banner; capture flips them; losing them flips them back', () => {
    const kit = createTerrainKit(boardInput(rows));
    for (const [x, y] of spots) {
      expect(kit.debug.paintAt(x, y)).toBe(NEUTRAL_COLOR);
      expect(kit.debug.sigilAt(x, y)).toBe(SIGIL_BLANK);
    }
    kit.setOwners((x, y) => (x === 1 && y === 1 ? 2 : null));
    expect(kit.debug.paintAt(1, 1)).toBe(FACTION_COLOR.verdant);
    expect(kit.debug.sigilAt(1, 1)).toBe(sigilCell('verdant'));
    expect(kit.debug.paintAt(3, 1)).toBe(NEUTRAL_COLOR);
    kit.setOwners((x, y) => (x === 1 && y === 1 ? 4 : null)); // the Hollow Choir takes it
    expect(kit.debug.paintAt(1, 1)).toBe(FACTION_COLOR.choir);
    expect(kit.debug.sigilAt(1, 1)).toBe(sigilCell('choir'));
    kit.setOwners(() => null);
    expect(kit.debug.paintAt(1, 1)).toBe(NEUTRAL_COLOR);
    expect(kit.debug.sigilAt(1, 1)).toBe(SIGIL_BLANK);
    kit.dispose();
  });

  it('an owned beacon glows in the faction accent; an unowned one is a dull lens', () => {
    const kit = createTerrainKit(boardInput(['~~~', '~H~', '~~~'], { '1,1': 3 }));
    const glow = meshesOf(kit.group).find((m) => m.name === 'terrain:glow')!;
    const col = glow.geometry.getAttribute('color') as BufferAttribute;
    let owned = 0;
    for (let i = 0; i < col.count; i++) owned = Math.max(owned, col.getX(i), col.getY(i), col.getZ(i));
    // The accent is baked above 1 (HDR) so it feeds bloom.
    expect(owned).toBeGreaterThan(1);
    const brightest = (hex: number): number => { const c = new Color(hex); return Math.max(c.r, c.g, c.b); };
    expect(brightest(FACTION_ACCENT.kestrel)).toBeGreaterThan(0.5);
    kit.setOwners(() => null);
    let neutral = 0;
    for (let i = 0; i < col.count; i++) neutral = Math.max(neutral, col.getX(i), col.getY(i), col.getZ(i));
    expect(neutral).toBeLessThan(owned);
    kit.dispose();
  });

  it('the five sigils are five different shapes, none blank, each readable on its own paint', () => {
    const masks = SIGIL_ORDER.map((f) => rasterSigil(f));
    for (const [i, m] of masks.entries()) {
      const covered = m.reduce((n, v) => n + (v > 127 ? 1 : 0), 0) / (CELL * CELL);
      expect(covered, SIGIL_ORDER[i]).toBeGreaterThan(0.08);
      expect(covered, SIGIL_ORDER[i]).toBeLessThan(0.6);
    }
    for (let i = 0; i < masks.length; i++) {
      for (let j = i + 1; j < masks.length; j++) {
        let diff = 0;
        for (let k = 0; k < masks[i].length; k++) if ((masks[i][k] > 127) !== (masks[j][k] > 127)) diff++;
        expect(diff / (CELL * CELL), `${SIGIL_ORDER[i]} vs ${SIGIL_ORDER[j]}`).toBeGreaterThan(0.12);
      }
    }
    expect(rasterSigil(null).every((v) => v === 0)).toBe(true);
    for (const f of SIGIL_ORDER) expect(contrast(f === 'choir' ? FACTION_ACCENT.choir : sigilInk(f), FACTION_COLOR[f]), `${f} ink`).toBeGreaterThan(3);
  });

  it('the atlas cells are where sigilUv says: a faction cell has ink, the blank cell has none', () => {
    const atlas = buildSigilAtlas();
    const data = atlas.image.data as Uint8Array;
    const w = ATLAS_COLS * CELL;
    const h = ATLAS_ROWS * CELL;
    const alphaAt = (u: number, v: number): number => data[(Math.floor(v * h) * w + Math.floor(u * w)) * 4 + 3];
    for (let cell = 0; cell <= SIGIL_BLANK; cell++) {
      const [u0, v0, u1, v1] = sigilUv(cell);
      let ink = 0;
      for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) ink += alphaAt(u0 + ((u1 - u0) * (i + 0.5)) / 24, v0 + ((v1 - v0) * (j + 0.5)) / 24) > 127 ? 1 : 0;
      if (cell === SIGIL_BLANK) expect(ink).toBe(0);
      else expect(ink, `cell ${cell}`).toBeGreaterThan(50);
    }
    atlas.dispose();
  });

  it('a planted wrong faction is caught: another faction\'s paint is not this one\'s', () => {
    const kit = createTerrainKit(boardInput(rows, { '1,1': 0 }));
    expect(kit.debug.paintAt(1, 1)).not.toBe(FACTION_COLOR.tidewell);
    expect(kit.debug.sigilAt(1, 1)).not.toBe(sigilCell('tidewell'));
    kit.dispose();
    expect(PROPS.every((c) => isProperty(Object.entries(CODE_OF).find(([, v]) => v === c)![0] as TerrainId))).toBe(true);
  });
});

describe('fog of war', () => {
  const rows = ['.f^=.', 'f.r~.', '^s~g.', '.....'];
  it('setVisible marks exactly the hidden tiles, once each, and a second call fully replaces the first', () => {
    const kit = createTerrainKit(boardInput(rows));
    const asked: string[] = [];
    const hidden = (x: number, y: number): boolean => (x * 3 + y * 5) % 4 === 0;
    kit.setVisible((x, y) => { asked.push(`${x},${y}`); return !hidden(x, y); });
    expect(asked.length).toBe(20);
    expect(new Set(asked).size).toBe(20);
    let hiddenCount = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 5; x++) {
        expect(kit.debug.fogAt(x, y), `tile ${x},${y}`).toBe(hidden(x, y) ? 0 : 255);
        if (hidden(x, y)) hiddenCount++;
      }
    }
    expect(hiddenCount).toBeGreaterThan(0);
    expect(hiddenCount).toBeLessThan(20);
    kit.setVisible((x, y) => x < 2 && y < 2);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) expect(kit.debug.fogAt(x, y)).toBe(x < 2 && y < 2 ? 255 : 0);
    kit.setVisible(() => true);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) expect(kit.debug.fogAt(x, y)).toBe(255);
    kit.dispose();
  });

  it('a board starts fully visible', () => {
    const kit = createTerrainKit(boardInput(rows));
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) expect(kit.debug.fogAt(x, y)).toBe(255);
    kit.dispose();
  });

  it('the grade dims unseen ground to about 45% brightness and 30% saturation, and leaves seen ground alone', () => {
    const c: [number, number, number] = [0.5, 0.3, 0.1];
    const lum = (v: number[]): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    const sat = (v: number[]): number => Math.max(...v) - Math.min(...v);
    const hidden = fogGrade(c, 0);
    expect(fogGrade(c, 1)).toEqual(c);
    expect(lum(hidden) / lum(c)).toBeCloseTo(0.45, 6);
    expect(sat(hidden) / sat(c)).toBeCloseTo(0.45 * 0.3, 6); // 30% of the colour's spread, at 45% brightness
    expect(hidden.every((v) => v > 0)).toBe(true); // never black
    // The shader source carries the same numbers, so the mirror cannot drift from what the GPU runs.
    expect(GRADE_GLSL).toContain('* 0.45');
    expect(GRADE_GLSL).toContain('c, 0.30');
    expect(GRADE_GLSL).toContain('smoothstep( 0.35, 0.65, v )'); // 0.3 of a tile: bilinear v crosses 0.35..0.65 over 0.3 tiles
  });
});

describe('shader patches', () => {
  // The fog of war and the storm live in patched shaders: a patch that matched nothing would ship a board with no fog, silently.
  const TEMPLATE: Record<string, { vertexShader: string; fragmentShader: string }> = {
    MeshStandardMaterial: ShaderLib.physical,
    MeshPhysicalMaterial: ShaderLib.physical,
    MeshLambertMaterial: ShaderLib.lambert,
    MeshDepthMaterial: ShaderLib.depth,
  };
  const run = (m: Material, vertexShader: string, fragmentShader: string) => {
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader, fragmentShader };
    m.onBeforeCompile(shader as never, {} as never);
    return shader;
  };

  it('every terrain material patches the real three.js shader templates and reads the one shared fog map', () => {
    const kit = createTerrainKit(boardInput(['.f', '~C']));
    const fog = kit.debug.uniforms().fogMap;
    const all = Object.entries(kit.debug.materials());
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const [name, m] of all) {
      if (m.type === 'ShaderMaterial') {
        expect((m as ShaderMaterial).uniforms.uFogMap.value, name).toBe(fog);
        expect((m as ShaderMaterial).fragmentShader, name).toContain('trnGrade');
        continue;
      }
      const tpl = TEMPLATE[m.type];
      expect(tpl, `${name}: ${m.type}`).toBeDefined();
      const shader = run(m, tpl.vertexShader, tpl.fragmentShader);
      if (m.type === 'MeshDepthMaterial') {
        expect(name).toBe('treeDepth');
        expect(shader.vertexShader).toContain('swH'); // the shadow of a tree sways with the tree
        continue;
      }
      expect(shader.vertexShader, name).toContain('vTrnXZ');
      expect(shader.uniforms.uFogMap.value, name).toBe(fog);
      expect(shader.fragmentShader, name).toContain('outgoingLight = trnGrade( outgoingLight, vTrnXZ )');
      expect(shader.vertexShader.includes('swH'), `${name} sway`).toBe(name === 'tree');
      expect(shader.fragmentShader.includes('emissive * vColor.rgb'), `${name} glow`).toBe(name === 'glow');
      expect(shader.fragmentShader.includes('wNoise'), `${name} water`).toBe(name === 'water');
    }
    kit.dispose();
  });

  it('a template missing an anchor is refused loudly, never patched halfway', () => {
    const kit = createTerrainKit(boardInput(['.f']));
    const ground = kit.debug.materials().ground;
    const tpl = ShaderLib.physical;
    expect(() => run(ground, tpl.vertexShader.replace('#include <project_vertex>', ''), tpl.fragmentShader)).toThrow(/project_vertex/);
    expect(() => run(ground, tpl.vertexShader, tpl.fragmentShader.replace('#include <opaque_fragment>', ''))).toThrow(/opaque_fragment/);
    kit.dispose();
  });
});

describe('weather', () => {
  it('an ion storm eases in and out, and a board built under a storm starts in it', () => {
    const kit = createTerrainKit(boardInput(['..', '..']));
    expect(kit.debug.storm()).toBe(0);
    kit.setWeather('ionstorm');
    expect(kit.debug.storm()).toBe(0); // not yet: it eases
    kit.update(0.1, 0.1);
    const mid = kit.debug.storm();
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.9);
    kit.update(3, 3.1);
    expect(kit.debug.storm()).toBeGreaterThan(0.99);
    kit.setWeather('clear');
    kit.update(3, 6.1);
    expect(kit.debug.storm()).toBeLessThan(0.01);
    kit.dispose();
    const stormy = createTerrainKit(boardInput(['..'], {}, 'ionstorm'));
    expect(stormy.debug.storm()).toBe(1);
    stormy.dispose();
  });
});

describe('capture rings', () => {
  it('progress is clamped to 0..1, stored for properties only, and cleared by a later call', () => {
    const kit = createTerrainKit(boardInput(['C.F', '...']));
    kit.setCapture((x, y) => (x === 0 && y === 0 ? 0.5 : x === 2 ? 2 : -1));
    expect(kit.debug.captureAt(0, 0)).toBe(128);
    expect(kit.debug.captureAt(2, 0)).toBe(255);
    expect(kit.debug.captureAt(1, 0)).toBe(0); // not a property: no ring, nothing stored
    kit.setCapture(() => 0);
    expect(kit.debug.captureAt(0, 0)).toBe(0);
    expect(meshesOf(kit.group).some((m) => m.name === 'terrain:capture-rings')).toBe(true);
    kit.dispose();
  });
});

describe('trees', () => {
  it('every canopy tile grows 3 to 5 trees inside its own bounds, the same every time', () => {
    const rows = ['ffff', 'f..f', 'ffff'];
    const board = analyseBoard(boardInput(rows));
    const a = planTrees(board);
    const b = planTrees(board);
    expect(a.map((t) => t.matrix.elements.join())).toEqual(b.map((t) => t.matrix.elements.join()));
    for (const t of board.tiles) {
      const mine = a.filter((tr) => tr.tile === t.index);
      if (t.terrain !== 'canopy') { expect(mine.length).toBe(0); continue; }
      expect(mine.length).toBeGreaterThanOrEqual(3);
      expect(mine.length).toBeLessThanOrEqual(5);
      for (const tr of mine) {
        const x = tr.matrix.elements[12]; const z = tr.matrix.elements[14];
        expect(x).toBeGreaterThan(t.x); expect(x).toBeLessThan(t.x + 1);
        expect(z).toBeGreaterThan(t.y); expect(z).toBeLessThan(t.y + 1);
      }
    }
    // Varied, not cloned: at least two different scales among the trees.
    expect(new Set(a.map((t) => t.matrix.elements[0].toFixed(3))).size).toBeGreaterThan(3);
  });
  it('trees are instanced: one draw per species, not one per tree', () => {
    const kit = createTerrainKit(boardInput(['ffffff', 'ffffff', 'ffffff']));
    const inst = meshesOf(kit.group).filter((m): m is InstancedMesh => m instanceof InstancedMesh);
    expect(inst.length).toBe(2);
    expect(inst.reduce((n, m) => n + m.count, 0)).toBe(kit.stats.trees);
    expect(kit.stats.trees).toBeGreaterThanOrEqual(18 * 3);
    kit.dispose();
  });
});

describe('dispose', () => {
  it('frees every geometry, material and texture the kit made, and is safe to repeat', () => {
    const kit = createTerrainKit(mapInput(MAPS['glass-waste']));
    const before = kit.live();
    expect(before.geometries).toBeGreaterThan(5);
    expect(before.materials).toBeGreaterThan(5);
    expect(before.textures).toBeGreaterThan(3);
    // Everything the scene graph holds is accounted for by the ledger.
    const held = new Set<unknown>();
    for (const m of meshesOf(kit.group)) { held.add(m.geometry); }
    expect(held.size).toBeGreaterThan(5);
    let disposedGeos = 0;
    for (const g of held) (g as { addEventListener: (t: string, f: () => void) => void }).addEventListener('dispose', () => { disposedGeos++; });
    kit.dispose();
    expect(disposedGeos).toBe(held.size);
    expect(kit.live()).toEqual({ geometries: 0, materials: 0, textures: 0 });
    expect(kit.group.children.length).toBe(0);
    expect(() => kit.dispose()).not.toThrow();
  });
});

describe('budgets and sanity on real and worst-case boards', () => {
  const boards: [string, TerrainInput][] = [
    ...Object.entries(MAPS).map(([id, m]) => [id, mapInput(m)] as [string, TerrainInput]),
    ...Object.entries(MISSION_MAPS).map(([id, m]) => [id, mapInput(m)] as [string, TerrainInput]),
    ['stress 25x19', boardInput(stressRows(25, 19))],
  ];

  it('draw calls stay at or under 120 (shadow pass included) and the mesh is finite, in bounds and above the underside', () => {
    const lines: string[] = [];
    for (const [id, input] of boards) {
      const t0 = performance.now();
      const kit = createTerrainKit(input);
      const ms = performance.now() - t0;
      lines.push(`${id.padEnd(22)} ${input.width}x${input.height} meshes ${kit.stats.meshes} drawCalls ${kit.stats.drawCalls} tris ${kit.stats.triangles} trees ${kit.stats.trees} props ${kit.stats.properties} build ${ms.toFixed(0)}ms`);
      expect(kit.stats.drawCalls, id).toBeLessThanOrEqual(120);
      expect(kit.stats.meshes, id).toBeLessThanOrEqual(20);
      expect(kit.stats.triangles, id).toBeLessThan(600_000);
      for (const m of meshesOf(kit.group)) {
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!;
        for (const v of [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z]) expect(Number.isFinite(v), `${id} ${m.name}`).toBe(true);
        if (m instanceof InstancedMesh) continue;
        expect(b.min.x, `${id} ${m.name}`).toBeGreaterThanOrEqual(-0.7);
        expect(b.max.x, `${id} ${m.name}`).toBeLessThanOrEqual(input.width + 0.7);
        expect(b.min.z, `${id} ${m.name}`).toBeGreaterThanOrEqual(-0.7);
        expect(b.max.z, `${id} ${m.name}`).toBeLessThanOrEqual(input.height + 0.7);
        expect(b.min.y, `${id} ${m.name}`).toBeGreaterThanOrEqual(BASE_Y - 0.05);
        expect(b.max.y, `${id} ${m.name}`).toBeLessThan(1.6);
        const pos = m.geometry.getAttribute('position') as BufferAttribute;
        for (let i = 0; i < pos.count * 3; i += 97) expect(Number.isNaN(pos.array[i]), `${id} ${m.name} NaN`).toBe(false);
      }
      kit.dispose();
    }
    console.info(`\n${lines.join('\n')}`);
  });

  it('the same board builds the same world: identical geometry on two builds', () => {
    const sum = (input: TerrainInput): number => {
      const kit = createTerrainKit(input);
      let s = 0;
      for (const m of meshesOf(kit.group)) {
        const pos = m.geometry.getAttribute('position') as BufferAttribute;
        for (let i = 0; i < pos.array.length; i += 11) s += pos.array[i] * (1 + (i % 7));
      }
      const out = s + kit.stats.triangles;
      kit.dispose();
      return out;
    };
    const input = mapInput(MAPS['saltglass-bay']);
    expect(sum(input)).toBe(sum(input));
    expect(sum(input)).not.toBe(sum(mapInput(MAPS['calder-fields'])));
  });

  it('the board\'s rim walls face outward and its top faces face up', () => {
    const input = mapInput(MAPS['saltglass-bay']);
    const kit = createTerrainKit(input);
    const ground = meshesOf(kit.group).find((m) => m.name === 'terrain:ground')!;
    const pos = ground.geometry.getAttribute('position') as BufferAttribute;
    const nrm = ground.geometry.getAttribute('normal') as BufferAttribute;
    const eps = 1e-4;
    const seen = { west: 0, east: 0, north: 0, south: 0 };
    for (let t = 0; t < pos.count; t += 3) {
      const xs = [0, 1, 2].map((k) => pos.getX(t + k));
      const zs = [0, 1, 2].map((k) => pos.getZ(t + k));
      const all = (v: number[], to: number): boolean => v.every((q) => Math.abs(q - to) < eps);
      // The geometric normal of the triangle as wound (what the GPU culls by).
      const ux = pos.getX(t + 1) - pos.getX(t); const uy = pos.getY(t + 1) - pos.getY(t); const uz = pos.getZ(t + 1) - pos.getZ(t);
      const vx = pos.getX(t + 2) - pos.getX(t); const vy = pos.getY(t + 2) - pos.getY(t); const vz = pos.getZ(t + 2) - pos.getZ(t);
      const gx = uy * vz - uz * vy; const gz = ux * vy - uy * vx; const gy = uz * vx - ux * vz;
      if (all(xs, 0)) { expect(gx).toBeLessThan(0); seen.west++; }
      if (all(xs, input.width)) { expect(gx).toBeGreaterThan(0); seen.east++; }
      if (all(zs, 0)) { expect(gz).toBeLessThan(0); seen.north++; }
      if (all(zs, input.height)) { expect(gz).toBeGreaterThan(0); seen.south++; }
      if (nrm.getY(t) > 0.99) expect(gy, 'a flat top faces up').toBeGreaterThan(0);
    }
    for (const side of Object.values(seen)) expect(side).toBeGreaterThan(20); // every rim has walls to check: the check is not vacuous
    kit.dispose();
  });

  it('ground normals are unit length and the top faces point up', () => {
    const kit = createTerrainKit(mapInput(MAPS['tether-ridges']));
    const ground = meshesOf(kit.group).find((m) => m.name === 'terrain:ground')!;
    const nrm = ground.geometry.getAttribute('normal') as BufferAttribute;
    const pos = ground.geometry.getAttribute('position') as BufferAttribute;
    let up = 0;
    for (let i = 0; i < nrm.count; i++) {
      expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 4);
      if (nrm.getY(i) > 0.5) up++;
    }
    expect(up / nrm.count).toBeGreaterThan(0.4);
    // Winding agrees with normals: for every triangle, the geometric normal is within 90 degrees of its vertex normals.
    for (let t = 0; t < pos.count; t += 3 * 5) {
      const ax = pos.getX(t + 1) - pos.getX(t); const ay = pos.getY(t + 1) - pos.getY(t); const az = pos.getZ(t + 1) - pos.getZ(t);
      const bx = pos.getX(t + 2) - pos.getX(t); const by = pos.getY(t + 2) - pos.getY(t); const bz = pos.getZ(t + 2) - pos.getZ(t);
      const gx = ay * bz - az * by; const gy = az * bx - ax * bz; const gz = ax * by - ay * bx;
      expect(gx * nrm.getX(t) + gy * nrm.getY(t) + gz * nrm.getZ(t), `triangle ${t / 3}`).toBeGreaterThanOrEqual(-1e-9);
    }
    kit.dispose();
  });
});

describe('colours are the palette', () => {
  it('every faction colour used for paint is the palette colour, never a near miss', () => {
    for (const f of SIGIL_ORDER as readonly FactionId[]) {
      const kit = createTerrainKit(boardInput(['~~~', '~C~', '~~~'], { '1,1': FACTIONS.indexOf(f) }));
      expect(kit.debug.paintAt(1, 1)).toBe(FACTION_COLOR[f]);
      kit.dispose();
    }
  });
});
