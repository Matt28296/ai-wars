// The portraits in the game's screens: the mood rules, the CommanderPortrait component, the HUD panel model and the cut-in. Expected faces are
// written out from the spec (neutral / grim when defeated / happy while a power is active; angry for an Overclock, smug for a Surge, grim for
// both for Ilse, Sefa and Maru), not read back from the implementation.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import type { Mood } from '../../content/types';
import { CutIn } from '../watch/CutIn';
import { Hud } from '../watch/Hud';
import { buildDemoMatch } from '../watch/demo';
import { playerPanels } from '../watch/hud';
import { CommanderPortrait } from '../watch/kit/CommanderPortrait';
import { endTurn, fieldSetup, walk } from '../watch/testing';
import { recordMatch, viewTimeline } from '../watch/timeline';
import type { TimelineStep } from '../watch/timeline';
import type { CutInSample } from '../watch/transition';
import { cutInMood, hudMood, portraitUrl } from './index';
import type { GameEvent } from '../../game/aw';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);

describe('which face a screen asks for', () => {
  it('HUD: neutral, grim once defeated, happy while a power is active', () => {
    expect(hudMood({ defeated: false, active: null })).toBe('neutral');
    expect(hudMood({ defeated: true, active: null })).toBe('grim');
    expect(hudMood({ defeated: false, active: 'surge' })).toBe('happy');
    expect(hudMood({ defeated: false, active: 'overclock' })).toBe('happy');
    // a defeated player's face wins, whatever the last frame said about the power
    expect(hudMood({ defeated: true, active: 'overclock' })).toBe('grim');
  });

  it('cut-in: angry for an Overclock, smug for a Surge, except Ilse, Sefa and Maru, who go grim for both', () => {
    const expected: Record<string, [Mood, Mood]> = {
      // [surge, overclock]
      rook: ['smug', 'angry'], dax: ['smug', 'angry'], juno: ['smug', 'angry'], corvin: ['smug', 'angry'], sable: ['smug', 'angry'],
      cantor: ['smug', 'angry'], vesper: ['smug', 'angry'], echo: ['smug', 'angry'],
      ilse: ['grim', 'grim'], sefa: ['grim', 'grim'], maru: ['grim', 'grim'],
    };
    expect(Object.keys(expected).sort()).toEqual(Object.keys(COMMANDERS).sort());
    for (const [id, [surge, overclock]] of Object.entries(expected)) {
      expect(cutInMood(id, 'surge'), `${id} surge`).toBe(surge);
      expect(cutInMood(id, 'overclock'), `${id} overclock`).toBe(overclock);
    }
    // an id the table does not know gets the ordinary rule (known-bad input does not crash)
    expect(cutInMood('nobody', 'overclock')).toBe('angry');
  });
});

describe('CommanderPortrait', () => {
  const base = { name: 'Rook Okafor', initials: 'RO', faction: 'helion' as const, size: 48 };

  it('draws the vector bust as an <img> for a commander that has a portrait, inside the frame, and drops the monogram', () => {
    const out = html(createElement(CommanderPortrait, { ...base, id: 'rook' }));
    expect(out).toContain('<img');
    expect(out).toContain(`src="${portraitUrl('rook', 'neutral')}"`);
    expect(out).toContain('class="aw-portrait aw-portrait--art"');
    expect(out).toContain('aria-label="Rook Okafor"');
    expect(out).toContain('clip-path:polygon(');
    expect(out).toContain('aw-portrait-mark'); // the sigil watermark stays behind the art
    expect(out).not.toContain('aw-portrait-initials');
  });

  it('wears the mood it is given, and neutral by default', () => {
    for (const mood of ['happy', 'angry', 'grim', 'surprised', 'smug'] as const) {
      const out = html(createElement(CommanderPortrait, { ...base, id: 'rook', mood }));
      expect(out, mood).toContain(`src="${portraitUrl('rook', mood)}"`);
      expect(out, mood).not.toContain(`src="${portraitUrl('rook', 'neutral')}"`);
    }
  });

  it('keeps today\'s monogram for an unknown id, for no id, and for the narrator', () => {
    for (const id of [undefined, 'nobody', 'narrator', 'Calder Watch', 'toString']) {
      const out = html(createElement(CommanderPortrait, { ...base, id }));
      expect(out, String(id)).not.toContain('<img');
      expect(out, String(id)).toContain('<span class="aw-portrait-initials" style="font-size:17px">RO</span>');
      expect(out, String(id)).toContain('class="aw-portrait"'); // no art class
    }
  });

  it('still draws a painted src when there is no portrait for the id, and prefers the portrait when there is one', () => {
    expect(html(createElement(CommanderPortrait, { ...base, src: '/art/x.png' }))).toContain('src="/art/x.png"');
    expect(html(createElement(CommanderPortrait, { ...base, id: 'nobody', src: '/art/x.png' }))).toContain('src="/art/x.png"');
    const both = html(createElement(CommanderPortrait, { ...base, id: 'rook', src: '/art/x.png' }));
    expect(both).toContain(portraitUrl('rook', 'neutral'));
    expect(both).not.toContain('/art/x.png');
  });

  it('keeps the power band and the aria label', () => {
    const out = html(createElement(CommanderPortrait, { ...base, id: 'rook', size: 96, state: 'overclock' }));
    expect(out).toContain('aria-label="Rook Okafor, Overclock active"');
    expect(out).toContain('aw-portrait-band');
    expect(out).toContain('>Overclock<');
    const surge = html(createElement(CommanderPortrait, { ...base, id: 'rook', state: 'surge' }));
    expect(surge).toContain('>Surge<');
  });

  it('gives ECHO, who has no nation, the signal frame and her portrait', () => {
    const out = html(createElement(CommanderPortrait, { name: 'ECHO', id: 'echo', faction: null, size: 48 }));
    expect(out).toContain(portraitUrl('echo', 'neutral'));
    expect(out).toContain('background:var(--signal)');
  });
});

describe('the HUD model and panel', () => {
  const rec = recordMatch(fieldSetup([{ type: 'trooper', owner: 0, x: 0, y: 1 }, { type: 'trooper', owner: 1, x: 9, y: 1 }], { fog: true }), [walk(1, [0, 1, 2, 3]), endTurn]);
  const step0 = viewTimeline(rec, 0).steps[0];

  const withPlayers = (step: TimelineStep, patch: (i: number) => Record<string, unknown>): TimelineStep => ({
    ...step,
    frame: { ...step.frame, players: step.frame.players.map((p, i) => ({ ...p, ...patch(i) })) },
  });

  it('carries the commander id and a neutral face for players in play', () => {
    const [a, b] = playerPanels(step0);
    expect(a).toMatchObject({ commanderId: 'rook', mood: 'neutral' });
    expect(b).toMatchObject({ commanderId: 'sefa', mood: 'neutral' });
  });

  it('turns grim for the defeated player only, and happy for the player whose power is running', () => {
    const defeated = playerPanels(withPlayers(step0, (i) => (i === 1 ? { defeated: true } : {})));
    expect(defeated.map((p) => p.mood)).toEqual(['neutral', 'grim']);
    const active = playerPanels(withPlayers(step0, (i) => (i === 0 ? { powerState: 'surge' } : {})));
    expect(active.map((p) => p.mood)).toEqual(['happy', 'neutral']);
  });

  it('is happy on the real activation step of a played match, from the engine\'s own state', () => {
    const demo = buildDemoMatch();
    const demoRec = recordMatch(demo.setup, demo.actions);
    const tl = viewTimeline(demoRec, 0);
    const first = tl.steps.find((s) => s.events.some((e) => e.kind === 'powerActivated'))!;
    const who = first.events.find((e): e is Extract<GameEvent, { kind: 'powerActivated' }> => e.kind === 'powerActivated')!;
    expect(demoRec.states[first.index].players[who.player].powerState).not.toBe('none');
    expect(playerPanels(first)[who.player].mood).toBe('happy');
    expect(playerPanels(tl.steps[first.index - 1])[who.player].mood).toBe('neutral');
  });

  it('draws each player\'s portrait in the HUD with that player\'s id and face', () => {
    const out = html(createElement(Hud, { step: step0 }));
    expect(out).toContain(portraitUrl('rook', 'neutral'));
    expect(out).toContain(portraitUrl('sefa', 'neutral'));
    const after = html(createElement(Hud, { step: withPlayers(step0, (i) => (i === 1 ? { defeated: true } : {})) }));
    expect(after).toContain(portraitUrl('sefa', 'grim'));
    expect(after).toContain(portraitUrl('rook', 'neutral'));
    const surging = html(createElement(Hud, { step: withPlayers(step0, (i) => (i === 0 ? { powerState: 'overclock' } : {})) }));
    expect(surging).toContain(portraitUrl('rook', 'happy'));
  });
});

describe('the power cut-in', () => {
  const sample = (commanderId: string, level: 'surge' | 'overclock'): CutInSample => {
    const def = COMMANDERS[commanderId];
    return {
      beat: {
        startMs: 0, durMs: 1000, player: 0, level, commanderId, commanderName: def.name, initials: def.initials,
        powerName: 'Power', quote: 'Quote', faction: def.faction as never,
      },
      progress: 0.5, slide: 0, portraitSlide: 0, dim: 0.2, quote: 'Quote',
    };
  };

  it('shows the commander\'s portrait with the face the rules ask for', () => {
    const cases: [string, 'surge' | 'overclock', Mood][] = [
      ['rook', 'overclock', 'angry'], ['rook', 'surge', 'smug'], ['corvin', 'overclock', 'angry'], ['juno', 'surge', 'smug'],
      ['ilse', 'overclock', 'grim'], ['ilse', 'surge', 'grim'], ['sefa', 'surge', 'grim'], ['maru', 'overclock', 'grim'],
    ];
    for (const [id, level, mood] of cases) {
      const out = html(createElement(CutIn, { sample: sample(id, level), reducedMotion: false }));
      expect(out, `${id} ${level}`).toContain(`src="${portraitUrl(id, mood)}"`);
    }
  });

  it('keeps the band label on the portrait and the power name beside it', () => {
    const out = html(createElement(CutIn, { sample: sample('rook', 'overclock'), reducedMotion: false }));
    expect(out).toContain('Overclock active');
    expect(out).toContain('Rook Okafor / Overclock');
  });
});
