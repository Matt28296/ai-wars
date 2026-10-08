// The portrait system, tested against known answers: the cast list comes from the commander table and the spec, the safety checker is shown
// known-bad text it must refuse, the colours are checked against tokens.css and the declared tones, and the composer is checked on a
// tiny hand-made art whose output is written out here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMANDERS } from '../../content/commanders';
import { MOODS, PORTRAIT_IDS, checkPortraitSvg, hasPortrait, MAX_SVG_BYTES, portraitSvg, portraitUrl } from './index';
import { ACCENT, FILL, SIGNAL, groundOf } from './palette';
import { RIM_SHIFT, allowedColours, composeSvg, hasRim } from './compose';
import { ARTS } from './registry';
import type { PortraitArt } from './types';

const TEN = ['rook', 'ilse', 'sefa', 'dax', 'maru', 'juno', 'corvin', 'sable', 'cantor', 'vesper'];

describe('who has a portrait', () => {
  it('is every commander in the table, and ECHO, and nobody else', () => {
    expect(new Set(PORTRAIT_IDS)).toEqual(new Set([...TEN, 'echo']));
    expect(PORTRAIT_IDS.length).toBe(11);
    for (const id of Object.keys(COMMANDERS)) expect(hasPortrait(id), id).toBe(true);
    expect(hasPortrait('echo')).toBe(true);
    for (const id of PORTRAIT_IDS) expect(ARTS[id].id).toBe(id);
  });

  it('refuses ids that are not commanders, including names that exist on every object', () => {
    for (const id of ['narrator', 'Calder Watch', 'Harbour Control', '', 'ROOK', 'toString', '__proto__', 'constructor', 'hasOwnProperty']) {
      expect(hasPortrait(id), id).toBe(false);
    }
    expect(() => portraitSvg('narrator')).toThrow(/no portrait/);
    expect(() => portraitUrl('toString', 'neutral')).toThrow(/no portrait/);
  });

  it('draws an unknown mood as neutral rather than failing a screen', () => {
    expect(portraitSvg('rook', 'furious' as never)).toBe(portraitSvg('rook', 'neutral'));
  });
});

describe('every portrait x every mood composes, and is safe', () => {
  it('composes 11 x 6 SVGs with no problem found by the checker, each within 12 KB', () => {
    let count = 0;
    for (const id of PORTRAIT_IDS) {
      for (const mood of MOODS) {
        const svg = portraitSvg(id, mood);
        expect(checkPortraitSvg(svg), `${id} ${mood}`).toEqual([]);
        expect(new TextEncoder().encode(svg).length, `${id} ${mood}`).toBeLessThanOrEqual(12 * 1024);
        expect(svg).toContain('viewBox="0 0 256 256"');
        expect(svg).not.toMatch(/NaN|undefined|Infinity/);
        count++;
      }
    }
    expect(count).toBe(66);
    expect(MAX_SVG_BYTES).toBe(12288);
  });

  it('has no outlines at all, and exactly one gradient: the ground vignette', () => {
    for (const id of PORTRAIT_IDS) {
      const svg = portraitSvg(id, 'neutral');
      expect(svg, id).not.toMatch(/stroke/);
      expect(svg.match(/<radialGradient/g)?.length, id).toBe(1);
      expect(svg, id).not.toMatch(/<linearGradient/);
      expect(svg.match(/url\(#gr\)/g)?.length, id).toBe(1);
    }
  });

  it('paints the ground from the faction: the vignette runs from a lifted centre to a darkened edge, and ECHO is dark cyan', () => {
    for (const id of PORTRAIT_IDS) {
      const a = ARTS[id];
      const g = groundOf(a.faction);
      const svg = portraitSvg(id, 'neutral');
      expect(svg).toContain(`stop-color="${g.centre}"`);
      expect(svg).toContain(`stop-color="${g.edge}"`);
    }
    expect(ARTS.rook.faction).toBe('helion');
    expect(ARTS.echo.faction).toBeNull();
    expect(groundOf(null).edge).toBe('#03161d');
    // a lifted centre is lighter than the faction fill, and the edge darker, for every nation but the Choir
    for (const f of ['helion', 'tidewell', 'verdant', 'kestrel'] as const) {
      const lum = (hex: string): number => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
      expect(lum(groundOf(f).centre), f).toBeGreaterThan(lum(FILL[f]));
      expect(lum(groundOf(f).edge), f).toBeLessThan(lum(FILL[f]));
    }
  });
});

describe('the safety checker refuses known-bad text and passes known-good text', () => {
  const good = portraitSvg('rook', 'neutral');
  const wrap = (inner: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs></defs>${inner}</svg>`;

  it('passes a real portrait and a minimal hand-written one', () => {
    expect(checkPortraitSvg(good)).toEqual([]);
    expect(checkPortraitSvg(wrap('<path d="M0 0H1V1Z" fill="#000000"/>'))).toEqual([]);
  });

  it.each([
    ['a script', wrap('<script>alert(1)</script>'), /forbidden element <script>/],
    ['a foreignObject', wrap('<foreignObject><div/></foreignObject>'), /foreignObject/],
    ['a <text>', wrap('<text x="1" y="1">hi</text>'), /forbidden element <text>/],
    ['an external href', wrap('<use href="https://evil.example/x.svg#a"/>'), /external href/],
    ['an xlink external href', wrap('<use xlink:href="http://evil.example/x.svg#a"/>'), /external href/],
    ['a relative-file href', wrap('<use href="x.svg"/>'), /external href/],
    ['an event attribute', wrap('<path d="M0 0Z" onload="alert(1)"/>'), /event attribute/],
    ['an onclick on a group', wrap('<g onclick="x()"><path d="M0 0Z"/></g>'), /event attribute/],
    ['an embedded raster', wrap('<image href="data:image/png;base64,AAAA" width="1" height="1"/>'), /data: value|forbidden element <image>/],
    ['a data: url in a fill', wrap('<path d="M0 0Z" fill="url(data:image/svg+xml,xx)"/>'), /url\(\) that is not a #reference/],
    ['an external url() fill', wrap('<path d="M0 0Z" fill="url(https://evil.example/g.svg#a)"/>'), /url\(\) that is not a #reference/],
    ['javascript:', wrap('<use href="javascript:alert(1)"/>'), /javascript:|external href/],
    ['a <style>', wrap('<style>@import url(https://evil.example/x.css);</style>'), /forbidden element <style>/],
    ['an unbalanced tag', wrap('<g><path d="M0 0Z"/>'), /unbalanced/],
    ['a stray close', wrap('<path d="M0 0Z"/></g>'), /unbalanced/],
    ['text between tags', wrap('<g>hello</g>'), /text outside tags/],
    ['a duplicate id', wrap('<path id="a" d="M0 0Z"/><path id="a" d="M1 1Z"/>'), /duplicate id/],
    ['a dangling reference', wrap('<use href="#nowhere"/>'), /dangling reference/],
  ])('refuses %s', (_name, svg, expected) => {
    const problems = checkPortraitSvg(svg);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' | ')).toMatch(expected);
  });

  it('refuses a missing viewBox, a document that is not an <svg>, and an oversize text', () => {
    expect(checkPortraitSvg(good.replace('viewBox="0 0 256 256"', 'viewBox="0 0 100 100"')).join()).toMatch(/viewBox/);
    expect(checkPortraitSvg(`<div>${good}</div>`).length).toBeGreaterThan(0);
    const big = good.replace('</svg>', `<path d="${'M0 0L1 1'.repeat(MAX_SVG_BYTES / 7)}"/></svg>`);
    expect(checkPortraitSvg(big).join()).toMatch(/too large/);
  });

  it('refuses a real portrait that has had a hostile fragment spliced in', () => {
    for (const bad of ['<script>1</script>', '<use href="https://x.example/a"/>', '<text>x</text>']) {
      expect(checkPortraitSvg(good.replace('</svg>', `${bad}</svg>`)).length, bad).toBeGreaterThan(0);
    }
  });
});

describe('moods and determinism', () => {
  it('draws six different SVGs for the six moods of every speaker', () => {
    for (const id of PORTRAIT_IDS) {
      const all = MOODS.map((m) => portraitSvg(id, m));
      expect(new Set(all).size, id).toBe(6);
    }
  });

  it('keeps one shared bust and changes only the expression: the human faces share most of their text across moods', () => {
    for (const id of TEN.filter((x) => !['cantor', 'vesper'].includes(x))) {
      const base = portraitSvg(id, 'neutral');
      for (const mood of MOODS.filter((m) => m !== 'neutral')) {
        const other = portraitSvg(id, mood);
        let pre = 0;
        while (pre < base.length && base[pre] === other[pre]) pre++;
        let suf = 0;
        while (suf < base.length - pre && suf < other.length - pre && base[base.length - 1 - suf] === other[other.length - 1 - suf]) suf++;
        expect((pre + suf) / Math.min(base.length, other.length), `${id} ${mood}`).toBeGreaterThan(0.6);
      }
    }
  });

  it('is deterministic: composing again from the art gives the same text, and so does the cached call', () => {
    for (const id of PORTRAIT_IDS) {
      for (const mood of MOODS) {
        expect(composeSvg(ARTS[id], mood)).toBe(composeSvg(ARTS[id], mood));
        expect(portraitSvg(id, mood)).toBe(composeSvg(ARTS[id], mood));
      }
    }
  });

  it('wraps the SVG as an image/svg+xml data URL that decodes back to the same text', () => {
    for (const id of ['rook', 'echo']) {
      const url = portraitUrl(id, 'smug');
      expect(url.startsWith('data:image/svg+xml,')).toBe(true);
      expect(decodeURIComponent(url.slice('data:image/svg+xml,'.length))).toBe(portraitSvg(id, 'smug'));
    }
    expect(portraitUrl('rook', 'happy')).not.toBe(portraitUrl('rook', 'angry'));
    expect(portraitUrl('rook')).toBe(portraitUrl('rook', 'neutral'));
  });

  it('can leave the ground out, for the silhouette view, and then has no vignette and no sigil', () => {
    const bare = portraitSvg('rook', 'neutral', { ground: false });
    expect(bare).not.toContain('radialGradient');
    expect(bare).not.toContain('fill-opacity="0.22"');
    expect(checkPortraitSvg(bare)).toEqual([]);
    expect(portraitSvg('rook', 'neutral')).toContain('radialGradient');
  });
});

describe('colour: the rim, the tones, the faction accents', () => {
  const tokens = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');
  const token = (name: string): string => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
    if (!m) throw new Error(`token --${name} not found`);
    return m[1].toLowerCase();
  };

  it('uses the design-system accents: the -ink tokens, and the Choir\'s red signal; ECHO uses the interface signal', () => {
    for (const f of ['helion', 'tidewell', 'verdant', 'kestrel'] as const) expect(ACCENT[f], f).toBe(token(`${f}-ink`));
    expect(ACCENT.choir).toBe(token('on-choir'));
    expect(SIGNAL).toBe(token('signal'));
    for (const f of ['helion', 'tidewell', 'verdant', 'kestrel', 'choir'] as const) expect(FILL[f], f).toBe(token(f));
  });

  it('has exactly three distinct tones per material, shadow darker than base darker than light', () => {
    const lum = (hex: string): number => parseInt(hex.slice(1, 3), 16) * 0.3 + parseInt(hex.slice(3, 5), 16) * 0.59 + parseInt(hex.slice(5, 7), 16) * 0.11;
    for (const id of PORTRAIT_IDS) {
      for (const [name, tones] of Object.entries(ARTS[id].tones)) {
        expect(tones.length, `${id}.${name}`).toBe(3);
        expect(new Set(tones).size, `${id}.${name}`).toBe(3);
        for (const t of tones) expect(t, `${id}.${name}`).toMatch(/^#[0-9a-f]{6}$/);
        expect(lum(tones[0]), `${id}.${name} shadow`).toBeLessThan(lum(tones[1]));
        expect(lum(tones[1]), `${id}.${name} base`).toBeLessThan(lum(tones[2]));
      }
    }
  });

  it('uses no colour that the art, the ground and the accent do not declare', () => {
    for (const id of PORTRAIT_IDS) {
      const allowed = allowedColours(ARTS[id]);
      for (const mood of MOODS) {
        const svg = portraitSvg(id, mood);
        const used = [...svg.matchAll(/(?:fill|stop-color)="(#[0-9a-fA-F]{3,8})"/g)].map((m) => m[1]);
        expect(used.length, id).toBeGreaterThan(0);
        for (const c of used) expect(allowed.has(c), `${id} ${mood} uses ${c}`).toBe(true);
      }
    }
  });

  it('rims every figure with the faction accent: the silhouette is filled in it, once, and the figure is drawn shifted over it', () => {
    for (const id of PORTRAIT_IDS) {
      const art = ARTS[id];
      const accent = art.faction ? ACCENT[art.faction] : SIGNAL;
      const svg = portraitSvg(id, 'neutral');
      expect(hasRim(art), id).toBe(true);
      expect(svg.split(`<g fill="${accent}">`).length - 1, id).toBe(1);
      expect(svg, id).toContain(`translate(${RIM_SHIFT} ${RIM_SHIFT})`);
      expect(svg, id).toContain('<clipPath id="rm">');
    }
  });

  it('puts the eye line near y = 100 once the rim shift is added', () => {
    for (const id of PORTRAIT_IDS) {
      const y = ARTS[id].eyeY + (hasRim(ARTS[id]) ? RIM_SHIFT : 0);
      expect(y, id).toBeGreaterThanOrEqual(94);
      expect(y, id).toBeLessThanOrEqual(106);
    }
  });

  it('gives each portrait its own element ids, so inlining two on one page cannot make them collide', () => {
    const prefixes = PORTRAIT_IDS.map((id) => /<path id="([a-z]+)\d/.exec(portraitSvg(id, 'neutral'))![1]);
    expect(new Set(prefixes).size).toBe(PORTRAIT_IDS.length);
  });

  it('draws every one of the eleven with a different silhouette', () => {
    const sil = PORTRAIT_IDS.map((id) =>
      ARTS[id].parts.map((p) => ('d' in p ? (p.noRim ? '' : p.d) : 'raw' in p ? (p.rim ?? '') : '')).join('|'),
    );
    expect(new Set(sil).size).toBe(sil.length);
  });
});

describe('the composer, on a tiny hand-made art with a known answer', () => {
  const tiny: PortraitArt = {
    id: 'tst',
    faction: 'helion',
    eyeY: 97,
    tones: { m: ['#111111', '#222222', '#333333'] },
    extra: ['#444444'],
    parts: [{ d: 'M0 0H10V10Z', m: 'm', s: 'M5 0H10V10H5Z', l: 'M0 0H3V3Z' }, { face: true }, { raw: '<path d="M2 2Z" fill="#444444"/>', rim: 'M2 2H4V4Z' }],
    expression: () => '<path d="M1 1Z" fill="#444444"/>',
  };

  it('writes the part once, shades it by clipping, rims it, and shifts the figure', () => {
    const svg = composeSvg(tiny, 'neutral', { ground: false });
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><defs>' +
        '<path id="tst0" d="M0 0H10V10Z"/><clipPath id="ctst0"><use href="#tst0"/></clipPath>' +
        '<path id="tstr2" d="M2 2H4V4Z"/><clipPath id="rm"><use href="#tst0"/><use href="#tstr2"/></clipPath></defs>' +
        '<g clip-path="url(#rm)"><g fill="#ffa95c"><use href="#tst0"/><use href="#tstr2"/></g>' +
        '<g transform="translate(3 3)"><use href="#tst0" fill="#222222"/>' +
        '<g clip-path="url(#ctst0)"><path d="M5 0H10V10H5Z" fill="#111111"/><path d="M0 0H3V3Z" fill="#333333"/></g>' +
        '<path d="M1 1Z" fill="#444444"/><path d="M2 2Z" fill="#444444"/></g></g></svg>',
    );
  });

  it('refuses a part that names a material the art does not have', () => {
    const bad: PortraitArt = { ...tiny, parts: [{ d: 'M0 0Z', m: 'nope' }, { face: true }] };
    expect(() => composeSvg(bad, 'neutral')).toThrow(/unknown material "nope"/);
  });
});
