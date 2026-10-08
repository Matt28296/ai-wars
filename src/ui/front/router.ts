// The front door's hash router (G9). Pure: a hash string in, a Route out, and back. No history API, no DOM.
//
//   #/ (or no hash)            the title screen
//   #/campaign                 the campaign map
//   #/mission/<id>             the briefing
//   #/mission/<id>/watch       Doctrine plays the mission on every side, and the watch view opens on that match
//   #step=40&viewer=all        the demo watch view, exactly as before the front door: a hash WITHOUT a leading slash that names
//   #play=1                    one of the watch view's own keys (step, viewer, speed, play). Those links were shared and bookmarked.
//
// Anything else is `unknown`, never a throw: the app answers it with a small "nothing here" card and the way out.

export type Route =
  | { kind: 'title' }
  | { kind: 'campaign' }
  | { kind: 'briefing'; missionId: string }
  | { kind: 'deploy'; missionId: string }
  | { kind: 'demo' }
  | { kind: 'unknown'; hash: string };

/** The keys src/ui/watch/controls.ts parseHash reads. A hash that names one (and has no leading slash) is a demo link. */
export const LEGACY_KEYS: readonly string[] = ['step', 'viewer', 'speed', 'play'];

/** A mission id is lowercase words joined by single hyphens: 'first-light', 'duel-at-ashgrave'. */
const MISSION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The link the title's "Watch a battle" uses. It opens the demo autoplaying, as the bare page did before the front door. */
export const DEMO_HASH = '#play=1';

const bodyOf = (hash: string): string => (hash.startsWith('#') ? hash.slice(1) : hash);

/** True when the hash is one of the watch view's own: no leading slash, and at least one of its keys. */
export function isLegacyDemoHash(hash: string): boolean {
  const body = bodyOf(hash);
  if (body === '' || body.startsWith('/')) return false;
  return body.split('&').some((part) => LEGACY_KEYS.includes(part.split('=')[0]));
}

export function parseRoute(hash: string): Route {
  const body = bodyOf(hash);
  if (body === '') return { kind: 'title' };
  if (!body.startsWith('/')) return isLegacyDemoHash(hash) ? { kind: 'demo' } : { kind: 'unknown', hash };
  // One trailing slash is forgiven: '#/campaign/' is '#/campaign'. Nothing else is.
  const parts = body.slice(1).replace(/\/$/, '').split('/');
  if (parts.length === 1 && parts[0] === '') return { kind: 'title' };
  if (parts.length === 1 && parts[0] === 'campaign') return { kind: 'campaign' };
  if (parts[0] === 'mission' && parts.length >= 2 && parts.length <= 3 && MISSION_ID.test(parts[1])) {
    if (parts.length === 2) return { kind: 'briefing', missionId: parts[1] };
    if (parts[2] === 'watch') return { kind: 'deploy', missionId: parts[1] };
  }
  return { kind: 'unknown', hash };
}

export function formatRoute(route: Route): string {
  switch (route.kind) {
    case 'title': return '#/';
    case 'campaign': return '#/campaign';
    case 'briefing': return `#/mission/${route.missionId}`;
    case 'deploy': return `#/mission/${route.missionId}/watch`;
    case 'demo': return DEMO_HASH;
    case 'unknown': return route.hash;
  }
}

export const hrefs = {
  title: '#/',
  campaign: '#/campaign',
  demo: DEMO_HASH,
  briefing: (id: string): string => `#/mission/${id}`,
  deploy: (id: string): string => `#/mission/${id}/watch`,
} as const;
