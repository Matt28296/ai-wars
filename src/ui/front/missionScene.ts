// A mission's own board for the briefing and Deploy backdrops (G9). Kept apart from scene.ts so the title does not load the campaign's maps.
import { MISSION_MAPS } from '../../content/mission-maps';
import type { Mission } from '../../content/types';
import { sceneFromMap } from './scene';
import type { PreviewScene } from './scene';

/** A mission's own map with its own sides on it: the briefing's backdrop. */
export function missionScene(m: Mission): PreviewScene {
  const map = MISSION_MAPS[m.mapId];
  if (!map) throw new Error(`mission ${m.id}: map ${m.mapId} is missing`);
  return sceneFromMap(map, m.players.map((p) => p.faction), m.weather ?? 'clear');
}
