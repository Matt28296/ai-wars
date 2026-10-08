# Ascendant Wars — battlefield art direction (D-018)

The lead's brief for the 3D battlefield. Every builder working on `src/ui/board3d/` reads it first. Where it and a builder's taste differ, this file wins; where it is silent, readability wins.

## The look in one sentence

**A lit tactical diorama:** the continent as a miniature command table seen from a tilted camera. Bevelled tiles step up and down, the water moves, and the trees sway a little. Units are crisp low-poly miniatures in faction paint with glowing trim. Every shot, hit and power is bright, short and easy to read.

## Pillars (in priority order)

1. **Readability beats spectacle.** This is the GBA lesson. At the default zoom, every unit's **type, owner, HP and acted state** reads in under half a second:
   - silhouettes differ by type;
   - owner shows as colour **plus** a sigil decal **plus** trim (colour-blind safe, never hue alone);
   - HP is a billboard chip below 10;
   - an acted unit is desaturated with dimmed trim, but never hidden.
2. **Diorama, not simulation.**
   - Units are chunky (about 0.6–0.75 of a tile wide), with exaggerated turrets and barrels.
   - Tiles are bevelled with small height steps:
     - ridge +0.35;
     - canopy floor and flats 0;
     - shoal −0.05;
     - sea and river −0.15, with the water surface at −0.08.
   - Soft shadows, a warm key light and a cool fill.
3. **The setting:** clean, engineered, a little worn. Hover tanks, exo-suits, rail artillery, drone gunships and fusion cells ("charge"). No aliens, no magic, no gore. Destroyed units break into debris and smoke, never bodies.
4. **Original, always.** Every model, decal and effect is built procedurally in code for this game. Nothing is traced from any other game.

## Faction design language

Each faction has a colour family (`src/styles/tokens.css`, mirrored in `src/ui/board3d/palette.ts`), a sigil, and a shape vocabulary that every unit of that faction shares.

| Faction | Paint | Trim / emissive | Shape vocabulary | Sigil |
|---|---|---|---|---|
| Helion Accord | amber `#f28c28` | `#ffa95c` | rounded-angular hulls, solar-panel fins, chevron stripes | rising chevron |
| Tidewell Union | cobalt `#2f6fd8` | `#8ab6ff` | maritime hulls, ring vents, stacked plates | concentric ring |
| Verdant Compact | green `#2ea36a` | `#5fd49b` | organic curves, leaf-triangle fins, light frames | leaf triangle |
| Kestrel Dominion | gold `#e6c95e` | `#efd77a` | heavy angular armour, raised prows, wing plates | winged diamond |
| Hollow Choir | obsidian `#1c1b23` | red signal `#ff4d63` | faceted drones, broken hexagons, no crew cabins | broken hexagon |

The unit **silhouette** comes from the unit type, so it is the same for every faction. The **detailing** comes from the faction: fin shapes, trim placement and sigil.

## Camera

- **Projection:** perspective, FOV about 30°, pitch about 55° down from horizontal, and yaw 0, so map rows stay horizontal.
- **Framing:** the whole map fits at the widest zoom, with three zoom steps.
- **Movement:** the camera eases toward the transition plan's focus. It never snaps, except when scrubbing.
- **Reduced motion:** no shake, no easing overshoot.

## Lighting and post

- **Hemisphere light:** sky `#cfe3ff`, ground `#5b4a3a`, intensity about 0.6.
- **Key light:** a directional sun from the north-west at about 50°, with soft PCF shadows on a 2048 map fitted to the board.
- **Faction emissive trim** feeds the bloom.
- **Tone and post:**
  - ACES filmic tone mapping, exposure about 1.0;
  - bloom with a high threshold, so only emissives and effects glow;
  - FXAA;
  - a light vignette.
- **Ion storm:** cooler, desaturated light, drifting static particles, and occasional lightning flashes. Rare, never strobing.
- **Fog of war:** unseen tiles at about 45% brightness and 30% saturation, with a soft 0.3-tile edge. Hidden units are not drawn at all, because they are not in the viewer's frame.

## Terrain kit

Neighbours are autotiled wherever it reads better:

| Terrain | Look |
|---|---|
| flats | grass with subtle vertex-colour noise; scattered pebbles |
| canopy | 3–5 stylised trees per tile, instanced and slightly varied, with a slow sway |
| ridge | raised faceted rock block with 2–3 boulders; snow-free |
| sea | animated water: gentle waves, specular glints, foam where it meets land |
| river | flowing water (scrolling normal pattern) that connects to its neighbours |
| shoal | sand with shallow-water edge |
| maglev | dark track bed with glowing cyan rails, autotiled straight, corner, T and cross |
| span | a bridge deck over river or sea, with rails continuing the maglev |
| glass | dark glossy shards with a faint inner red glow (the Glass Waste) |
| arcology | a cluster of stacked towers with lit windows |
| fabricator | a factory with a gantry crane |
| skyport | a landing pad with a control tower and a beacon |
| dock | a pier with a crane |
| uplink | a dish tower |
| spire | the tallest building, with a beacon in the owner colour |

**Properties** are neutral grey until owned. When owned, the roofs, banners and beacon take the owner's paint and sigil. Capture progress shows as a ring at the base that fills.

## Units kit

There are 16 types, built from primitives and extrusions, each about 300–1,500 triangles.

- **Parts:** chassis, turret, weapon and details. Paint uses primary (faction), secondary (dark gunmetal) and emissive trim (accent).
- **Idle motion by class:**
  - hover: bob and tilt;
  - air: rotor or fan spin, plus bob;
  - walker: weight shift;
  - ship: slow roll;
  - foot: a slight breathing squad shuffle.
- **Foot units** show a squad of 1–3 figures, matching AW's readability.
- **Poses:** `fire` is recoil with a muzzle point; `hit` is a short shake.

## Effects kit

Every effect is drawn from `(kind, progress, seed)`, so it scrubs exactly.

- **muzzle flash:** an additive starburst plus a light pop, about 80 ms.
- **tracer:** a bright streak for direct fire.
- **shell:** an arcing projectile with a smoke trail for indirect fire.
- **hit:** sparks and a small flash.
- **explosion:** fireball, shockwave ring, debris chunks and a lingering smoke column.
- **pulse:** the heal or repair shimmer, rising green motes.
- **ambush:** a red "!" flare plus a short shake.
- **spawn:** the build effect, a fabricator light beam.
- **Damage numbers:** billboard text that pops, rises and fades. Heals are green.

## Performance budget

- 60 fps on a mid-range laptop on a 25×19 map with 100 units.
- Draw calls ≤ 200, using instancing or merged geometry per terrain kind.
- No downloaded textures. Small canvas-generated textures are fine.
- The three.js bundle adds about 600–700 KB.
- With reduced motion: fewer particles and no shake.

## How it is checked

- **Node tests:** autotile masks, model part coverage for all 16 units, deterministic effects from a seed, and the contract.
- **Visual checks:** headless Chromium with SwiftShader WebGL2 screenshots of each module's gallery page and of the demo at fixed steps. The builder and the lead both read them.
- **Fallback:** the SVG board stays as the fallback when WebGL2 is unavailable, and on request with `?renderer=2d`.
