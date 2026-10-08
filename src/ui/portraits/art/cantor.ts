// Cantor, the Hollow Choir's voice, "it, answers to she". A slender obsidian chassis under a smooth hood; a faceted obsidian mask with no
// mouth; one horizontal slit of red light where the eyes would be. Unsettlingly serene. The mood is the slit: its shape and its brightness.
import { n, oval } from '../geom';
import { TORSO, TORSO_LIGHT, TORSO_SHADE } from '../shapes';
import type { Mood, PortraitArt } from '../types';

const tones = {
  obs: ['#06060a', '#14131b', '#2d2b3b'],
  mask: ['#0c0b12', '#1f1e2b', '#464460'],
  plate: ['#0a0a10', '#1a1925', '#3a384e'],
} as const;

const RED = '#ff4d63';
const HOT = '#ffc2ca';

/** The slit for a mood: half-length, thickness, how far its ends sit below the centre (negative: above), tilt, glow, and the right half's weight. */
const SLIT: Record<Mood, { len: number; t: number; end: number; tilt: number; glow: number; right: number; v?: boolean }> = {
  neutral: { len: 25, t: 4.2, end: 0, tilt: 0, glow: 0.3, right: 1 },
  happy: { len: 25, t: 5, end: 9, tilt: 0, glow: 0.5, right: 1 }, // the ends turn down: a calm smile of light
  angry: { len: 27, t: 7, end: -10, tilt: 0, glow: 0.62, right: 1, v: true }, // a hard V, thick
  grim: { len: 15, t: 2.2, end: 5, tilt: 4, glow: 0.08, right: 1 },
  surprised: { len: 15, t: 15, end: 0, tilt: 0, glow: 0.7, right: 1 }, // the slit opens
  smug: { len: 25, t: 4.6, end: 3, tilt: -4, glow: 0.4, right: 1.9 }, // lopsided, and thicker on the right
};

const CY = 99;
const CX = 135;

function slit(mood: Mood): string {
  const s = SLIT[mood];
  const x0 = CX - s.len;
  const x1 = CX + s.len;
  const yL = CY + s.end + s.tilt; // left end y (end > 0 lowers the ends)
  const yR = CY + s.end - s.tilt;
  const half = s.t / 2;
  const tr = half * s.right;
  // the band from the left end to the right end: a lens bowed through the centre, or (angry) two straight blades meeting in a V
  const band = (grow: number): string => {
    if (s.v) {
      const h = half + grow * 0.8;
      const yc = CY + 4;
      return `M${n(x0 - 4 - grow)} ${n(yL)}L${n(x0)} ${n(yL - h)}L${n(CX)} ${n(yc - h)}L${n(x1)} ${n(yR - h)}L${n(x1 + 4 + grow)} ${n(yR)}L${n(x1)} ${n(yR + h)}L${n(CX)} ${n(yc + h)}L${n(x0)} ${n(yL + h)}Z`;
    }
    return `M${n(x0 - grow)} ${n(yL)}Q${n(CX)} ${n(CY - 2 * half - grow * 0.8 - s.end * 0.9)} ${n(x1 + grow)} ${n(yR)}Q${n(CX)} ${n(CY + 2 * tr + grow * 0.8 - s.end * 0.9)} ${n(x0 - grow)} ${n(yL)}Z`;
  };
  return (
    `<path d="${band(7)}" fill="${RED}" fill-opacity="${s.glow * 0.55}"/>` +
    `<path d="${band(3.5)}" fill="${RED}" fill-opacity="${s.glow}"/>` +
    `<path d="${band(0)}" fill="${RED}"/>` +
    `<path d="${band(-s.t * 0.28)}" fill="${HOT}"/>`
  );
}

export const cantor: PortraitArt = {
  id: 'cantor',
  faction: 'choir',
  eyeY: CY,
  tones,
  extra: [RED, HOT],
  parts: [
    // the smooth hood, tall and narrow, and its fall over the shoulders
    {
      d: 'M124 12C150 20 172 52 178 92C182 122 178 150 170 172L206 212H48L80 172C72 150 70 122 74 92C80 52 100 20 124 12Z',
      m: 'obs',
      s: 'M146 0C156 40 164 90 160 134L186 176L218 218V0Z',
      l: 'M66 92C70 52 92 20 118 14C98 40 86 72 84 112C74 108 66 102 66 92Z',
    },
    // the chassis: a plain dark body with hard faceted shoulder plates
    { d: TORSO, m: 'plate', s: TORSO_SHADE, l: TORSO_LIGHT },
    { d: 'M14 206L62 178L84 198L40 224Z', m: 'plate', s: 'M52 170H100V230H52Z', l: 'M14 206L62 178L66 184L22 208Z' },
    { d: 'M196 186L246 202L258 232L206 214Z', m: 'plate', s: 'M196 180H270V240H196Z', l: 'M196 186L222 194L222 198L200 192Z' },
    // the gorget: a slender neck of stacked rings
    { d: 'M100 196L104 166H152L158 196Z', m: 'plate', s: 'M132 160H170V204H132Z', l: 'M100 196L104 166H112L108 196Z' },
    { d: 'M102 178H154V182H102ZM101 188H156V192H101Z', m: 'mask', s: 'M130 172H170V196H130Z' },
    // the mask: a long faceted almond, no mouth, turned a little to the right. A ridge runs down it; the left planes catch the light in
    // three facets (brow, cheek, jaw), the right half is in shade.
    {
      d: 'M126 46C142 48 156 62 158 88C160 112 154 134 142 152C136 160 128 166 120 164C106 156 98 134 98 108C98 76 108 52 126 46Z',
      m: 'mask',
      s: 'M134 40H190V168H134Z',
      l: 'M106 66L128 48L133 72L112 84Z M110 90L133 80L134 112L112 120Z M114 126L133 118L132 152L120 158Z',
    },
    { face: true },
    // a thin red seam down the chest
    { raw: `<path d="M126 200L130 200L132 256L128 256Z" fill="${RED}" fill-opacity="0.55"/><path d="${oval(128, 214, 2.4, 2.4)}" fill="${RED}"/>` },
  ],
  expression: (mood) => slit(mood),
};
