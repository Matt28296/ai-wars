// The 3D battlefield contract (DECISIONS D-018). Several builders work against this file at the same time:
//   terrain/  -> createTerrain   (tiles, props, water, properties, fog of war)
//   units/    -> createUnitView  (the 16 unit miniatures, their paint, idle motion and poses)
//   fx/       -> createFx        (muzzle flashes, tracers, impacts, explosions, numbers)
//   Stage3D   -> the renderer core: scene, camera, lights, post-processing, and the wiring to the transition plan
// A module may change its own internals freely. Changing THIS file is the lead's job, so the parallel work never drifts.
//
// Coordinates: one tile is TILE world units. Tile (x, y) is centred at world (x + 0.5, height, y + 0.5).
// +X is east (map columns), +Z is south (map rows), +Y is up. Heading 0 faces +X (east); headings turn toward +Z.
import type { Group, Object3D, Vector3 } from 'three';
import type { FactionId, PlayerIndex, TerrainId, UnitTypeId, Weather } from '../../game/aw';
import type { FxKind } from '../watch/transition';
import type { UnitStatusKind } from '../watch/unitview';

export const TILE = 1;

/** World position (x, z) of the centre of tile (x, y). */
export function tileCenter(x: number, y: number): { x: number; z: number } {
  return { x: (x + 0.5) * TILE, z: (y + 0.5) * TILE };
}

// ---------------------------------------------------------------- terrain

export interface TerrainInput {
  width: number;
  height: number;
  terrainAt(x: number, y: number): TerrainId;
  /** Owning player of a property tile, or null (neutral or not a property). */
  ownerAt(x: number, y: number): PlayerIndex | null;
  /** The faction a player plays, for owner colours and sigils. */
  factionOf(player: PlayerIndex): FactionId | null;
  weather: Weather;
}

export interface TerrainView {
  readonly group: Group;
  /** World Y of the walkable surface at the centre of tile (x, y). Units stand here; air units add their own hover. */
  heightAt(x: number, y: number): number;
  /** Owners changed (a capture or a build site flip): recolour roofs, banners and beacons. */
  setOwners(ownerAt: (x: number, y: number) => PlayerIndex | null): void;
  /** Capture progress per tile, 0 (none) to 1 (complete). Shown as a ring at the property's base. */
  setCapture(progressAt: (x: number, y: number) => number): void;
  /**
   * Which tiles have a live unit standing on them (in the viewer's frame; dying units do not count). A property under a unit shows
   * its low form: its tall parts sink so the unit stands visibly on the pad, while the pad, the owner's band or banner, the sigil
   * and the capture ring stay in view. It eases back when the tile is free. heightAt is unchanged.
   */
  setOccupied(occupiedAt: (x: number, y: number) => boolean): void;
  /** Which tiles the viewer sees now. Unseen tiles are dimmed and desaturated with a soft edge, never black. */
  setVisible(visibleAt: (x: number, y: number) => boolean): void;
  setWeather(weather: Weather): void;
  update(dtSec: number, timeSec: number): void;
  dispose(): void;
}

export type CreateTerrain = (input: TerrainInput) => TerrainView;

// ---------------------------------------------------------------- units

export type UnitPose = 'idle' | 'move' | 'fire' | 'hit';

export interface UnitLook {
  /** Display HP 1-10. Below 10 the unit shows its HP chip. */
  hp: number;
  /** Acted this turn: desaturated paint and dimmed trim, never hidden. */
  spent: boolean;
  /** Radians; 0 faces +X (east). */
  heading: number;
  status: UnitStatusKind | null;
  /** The unit the camera is following (a soft ring under it). */
  focused: boolean;
}

export interface UnitView {
  /** Origin at the unit's feet, centred in its tile. Facing +X at heading 0. Scale: fits inside 0.8 x 0.8 tiles. */
  readonly object: Object3D;
  readonly type: UnitTypeId;
  setLook(look: UnitLook): void;
  /** `t` runs 0..1 through the pose (fire: recoil and flash at t = 0.15; hit: shake). Idle ignores `t`. */
  setPose(pose: UnitPose, t: number): void;
  /** World-space point where shots leave the weapon. */
  muzzleWorld(out: Vector3): Vector3;
  update(dtSec: number, timeSec: number): void;
  dispose(): void;
}

/** How a unit is drawn beyond its type and nation. */
export interface UnitViewOptions {
  /**
   * The seat's nation is not named in this mission (G15's masked seat, e.g. mission 1's "Unmarked drones"): no nation sigil on the unit.
   * Paint and trim keep their colours, because colour is not a name.
   */
  unmarked?: boolean;
}

export type CreateUnitView = (type: UnitTypeId, faction: FactionId, opts?: UnitViewOptions) => UnitView;

// ---------------------------------------------------------------- effects

/**
 * The transition plan's effect kinds, plus the 3D-only ones the renderer derives: 'muzzle', 'tracer' and 'shell' from attacks, and the
 * movement trails from moves: 'dust' (ground units), 'wake' (sea units, and hover units over water), 'contrail' (air units).
 */
export type Fx3dKind = FxKind | 'muzzle' | 'tracer' | 'shell' | 'dust' | 'wake' | 'contrail';

export interface FxItem {
  kind: Fx3dKind;
  /**
   * Where it happens (world). For 'tracer' and 'shell' this is the start; `to` is the end. For the trails ('dust', 'wake', 'contrail')
   * `at` is where the mover is now and `to` is a point behind it on its path, so the trail streams away from its direction of travel.
   */
  at: Vector3;
  to?: Vector3;
  /** 0..1 through the effect. Effects are drawn from (kind, progress, seed) alone, so scrubbing and replays are exact. */
  progress: number;
  /** Stable per beat, so the same beat always scatters its sparks the same way. */
  seed: number;
  /** Optional tint (0xRRGGBB), e.g. the attacker's faction. */
  color?: number;
}

export interface NumberItem { at: Vector3; text: string; tone: 'damage' | 'heal'; progress: number }

export interface FxView {
  readonly group: Group;
  /** Draw this frame's effects. Called every animation frame with the full current list (stateless). */
  draw(items: readonly FxItem[]): void;
  numbers(items: readonly NumberItem[]): void;
  update(dtSec: number, timeSec: number): void;
  dispose(): void;
}

export type CreateFx = () => FxView;
