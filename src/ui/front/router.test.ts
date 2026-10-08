// The front door's router, against hand-written hashes. The legacy demo links are the ones that must never break: they were shared and
// bookmarked before the front door existed, so each shape the watch view writes itself is checked, with known-bad shapes that must not
// be mistaken for them (a leading slash, a key that only looks like one).
import { describe, expect, it } from 'vitest';
import { formatHash } from '../watch';
import { DEMO_HASH, LEGACY_KEYS, formatRoute, hrefs, isLegacyDemoHash, parseRoute } from './router';
import type { Route } from './router';

describe('the routes of the front door', () => {
  it('reads the title from no hash, an empty hash and the root', () => {
    for (const h of ['', '#', '#/', '/']) expect(parseRoute(h), JSON.stringify(h)).toEqual({ kind: 'title' });
  });

  it('reads the campaign map, forgiving one trailing slash', () => {
    expect(parseRoute('#/campaign')).toEqual({ kind: 'campaign' });
    expect(parseRoute('#/campaign/')).toEqual({ kind: 'campaign' });
  });

  it('reads a briefing and a deploy by mission id', () => {
    expect(parseRoute('#/mission/first-light')).toEqual({ kind: 'briefing', missionId: 'first-light' });
    expect(parseRoute('#/mission/duel-at-ashgrave/')).toEqual({ kind: 'briefing', missionId: 'duel-at-ashgrave' });
    expect(parseRoute('#/mission/root-and-branch/watch')).toEqual({ kind: 'deploy', missionId: 'root-and-branch' });
    expect(parseRoute('#/mission/null-spire/watch/')).toEqual({ kind: 'deploy', missionId: 'null-spire' });
  });

  it('round-trips every route it can write', () => {
    const routes: Route[] = [
      { kind: 'title' }, { kind: 'campaign' }, { kind: 'briefing', missionId: 'static' },
      { kind: 'deploy', missionId: 'requiem' }, { kind: 'demo' },
    ];
    for (const r of routes) expect(parseRoute(formatRoute(r)), formatRoute(r)).toEqual(r);
    expect(hrefs.briefing('static')).toBe('#/mission/static');
    expect(hrefs.deploy('static')).toBe('#/mission/static/watch');
  });
});

describe('the demo links that existed before the front door keep working', () => {
  it('opens the demo for every hash that names one of the watch view\'s keys without a leading slash', () => {
    const legacy = [
      '#step=40&viewer=all', '#step=0&viewer=0', '#viewer=1', '#speed=2', '#play=1', '#play=0', '#play', '#step=12&speed=4&play',
      '#viewer=all&step=3', '#step=40&viewer=all&unrelated=1',
    ];
    for (const h of legacy) {
      expect(parseRoute(h), h).toEqual({ kind: 'demo' });
      expect(isLegacyDemoHash(h), h).toBe(true);
    }
  });

  it('opens the demo for the exact hashes the watch view writes into the address bar itself', () => {
    for (const h of [formatHash({ step: 40, viewer: 'all' }), formatHash({ step: 0, viewer: 0 }), formatHash({ step: 7, viewer: 1, speed: 2 }), formatHash({ step: 99, viewer: 0, speed: 4 })]) {
      expect(h).not.toBe('');
      expect(parseRoute(h), h).toEqual({ kind: 'demo' });
    }
  });

  it('the title\'s own "Watch a battle" link is a demo link', () => {
    expect(parseRoute(DEMO_HASH)).toEqual({ kind: 'demo' });
    expect(hrefs.demo).toBe(DEMO_HASH);
  });

  it('only the four keys the watch view reads count', () => {
    expect([...LEGACY_KEYS]).toEqual(['step', 'viewer', 'speed', 'play']);
  });
});

describe('known-bad hashes are never taken for a screen', () => {
  const unknown = [
    '#/mission', '#/mission/', '#/mission//watch', '#/mission/First-Light', '#/mission/first_light', '#/mission/-first', '#/mission/first-',
    '#/mission/a/b', '#/mission/first-light/watch/extra', '#/mission/first-light/debrief', '#/campaign/extra', '#/Campaign',
    '#/mission/../campaign', '#/mission/%2e%2e', '#/nope', '#/campaign//',
    // a leading slash means a front-door route: these are not demo links, they are nothing
    '#/step=40', '#/play=1', '#/viewer=all&step=3',
    // keys that only look like the watch view's
    '#steps=4', '#Step=4', '#foo=bar', '#main', '#viewers=all', '#xplay=1',
  ];
  it('answers unknown, keeping the hash it was given', () => {
    for (const h of unknown) expect(parseRoute(h), h).toEqual({ kind: 'unknown', hash: h });
  });
  it('is not a legacy demo hash either', () => {
    for (const h of unknown.filter((x) => x.startsWith('#/'))) expect(isLegacyDemoHash(h), h).toBe(false);
  });
  it('never throws, whatever the string', () => {
    for (const h of ['#%', '#/mission/\u0000', '#' + 'a'.repeat(5000), '#=&=&=', '#&&&']) expect(() => parseRoute(h), h).not.toThrow();
  });
});
