// Composes one portrait SVG (art + mood -> text). Pure and deterministic: the same inputs give the same string.
//
// Stack, back to front: the ground (a radial vignette in the faction ground colour, with the faction sigil as a quiet watermark),
// then the figure. The figure carries ONE rim light: the silhouette is filled in the faction accent, and the figure is drawn on top of it
// shifted RIM_SHIFT px down-right, so the accent shows only along the silhouette's upper-left edge. Each shaded part is a base tone with
// a hard-edged shadow region and light region clipped to its own outline. There are no outlines, no strokes and no gradients but the ground.
import { ART } from '../../data';
import { ACCENT, FILL, SIGNAL, groundOf } from './palette';
import { n } from './geom';
import type { ComposeOptions, Mood, Part, PortraitArt, ShadedPart } from './types';

/** How far the figure is drawn from the accent silhouette, in px of the 256 box. */
export const RIM_SHIFT = 3;

export const VIEW = 256;

const isShaded = (p: Part): p is ShadedPart => 'd' in p;
const isRaw = (p: Part): p is { raw: string; rim?: string } => 'raw' in p;

type SigilSpec = string | { d: string; evenodd?: boolean };
const SIGILS = ART.sigils as unknown as Record<string, readonly SigilSpec[]>;

/** The accent of an art's rim light. */
export function accentOf(art: PortraitArt): string {
  return art.faction ? ACCENT[art.faction] : SIGNAL;
}

/** True when the art has any part on the silhouette (and so is drawn shifted over the accent). */
export function hasRim(art: PortraitArt): boolean {
  return art.parts.some((p) => (isShaded(p) ? !p.noRim : isRaw(p) ? !!p.rim : false));
}

/** Every colour the composed SVG may use for a fill: tones, ground, accent, sigil tint and the art's feature colours. */
export function allowedColours(art: PortraitArt): Set<string> {
  const g = groundOf(art.faction);
  const out = new Set<string>([g.centre, g.edge, g.mark, accentOf(art), ...art.extra]);
  for (const tones of Object.values(art.tones)) for (const c of tones) out.add(c);
  if (art.faction) out.add(FILL[art.faction]);
  return out;
}

function groundSvg(art: PortraitArt): string {
  const g = groundOf(art.faction);
  const key = art.faction ?? 'echo';
  const marks = (SIGILS[key] ?? [])
    .map((s) => (typeof s === 'string' ? `<path d="${s}"/>` : `<path d="${s.d}"${s.evenodd ? ' fill-rule="evenodd"' : ''}/>`))
    .join('');
  return (
    `<radialGradient id="gr" cx="0.46" cy="0.4" r="0.8"><stop offset="0" stop-color="${g.centre}"/><stop offset="1" stop-color="${g.edge}"/></radialGradient>` +
    `|<rect width="${VIEW}" height="${VIEW}" fill="url(#gr)"/>` +
    `<g transform="translate(176 14) scale(3)" fill="${g.mark}" fill-opacity="0.22">${marks}</g>`
  );
}

export function composeSvg(art: PortraitArt, mood: Mood, opts: ComposeOptions = {}): string {
  const withGround = opts.ground !== false;
  const k = art.id.slice(0, 3);
  const defs: string[] = [];
  const figure: string[] = [];
  const rim: string[] = [];

  art.parts.forEach((part, i) => {
    if (isShaded(part)) {
      const tones = art.tones[part.m];
      if (!tones) throw new Error(`portrait ${art.id}: part ${i} uses unknown material "${part.m}"`);
      const [shadow, base, light] = tones;
      const id = `${k}${i}`;
      defs.push(`<path id="${id}" d="${part.d}"/>`);
      figure.push(`<use href="#${id}" fill="${base}"/>`);
      if (part.s || part.l) {
        defs.push(`<clipPath id="c${id}"><use href="#${id}"/></clipPath>`);
        figure.push(
          `<g clip-path="url(#c${id})">${part.s ? `<path d="${part.s}" fill="${shadow}"/>` : ''}${part.l ? `<path d="${part.l}" fill="${light}"/>` : ''}</g>`,
        );
      }
      if (!part.noRim) rim.push(id);
    } else if (isRaw(part)) {
      figure.push(part.raw);
      if (part.rim) {
        const id = `${k}r${i}`;
        defs.push(`<path id="${id}" d="${part.rim}"/>`);
        rim.push(id);
      }
    } else {
      figure.push(art.expression(mood));
    }
  });

  const shifted = rim.length > 0;
  const sil = rim.map((id) => `<use href="#${id}"/>`).join('');
  let body: string;
  if (shifted) {
    defs.push(`<clipPath id="rm">${sil}</clipPath>`);
    body = `<g clip-path="url(#rm)"><g fill="${accentOf(art)}">${sil}</g><g transform="translate(${n(RIM_SHIFT)} ${n(RIM_SHIFT)})">${figure.join('')}</g></g>`;
  } else {
    body = `<g>${figure.join('')}</g>`;
  }

  let ground = '';
  if (withGround) {
    const [gDef, gBody] = groundSvg(art).split('|');
    defs.unshift(gDef);
    ground = gBody;
  }
  if (art.backdrop) ground += art.backdrop;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}">` +
    `<defs>${defs.join('')}</defs>${ground}${body}</svg>`
  );
}
