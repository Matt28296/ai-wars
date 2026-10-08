// VESPER, the Hollow Choir itself: it/its. No face at all: a lattice sphere of nested rings and nodes around one red iris, on a stem of
// conduit and a broad base. It reads as a mind, not a person. The mood is the iris (its size and shape) and the spin of the rings.
import { disc, n, oval } from '../geom';
import type { Mood, PortraitArt } from '../types';

const tones = {
  obs: ['#06060a', '#14131b', '#2d2b3b'],
  lattice: ['#34314a', '#6b6888', '#b0aed0'],
} as const;

const RED = '#ff4d63';
const HOT = '#ffc2ca';
const CX = 128;
const CY = 100;
const R = 56;

/** Per mood: ring spin (degrees), how open the rings are (minor/major axis), iris radius, pupil [rx, ry], glow, and the lid (0 none .. 1 half). */
const MIND: Record<Mood, { spin: number; open: number; iris: number; pupil: [number, number]; glow: number; lid: number }> = {
  neutral: { spin: 0, open: 0.42, iris: 15, pupil: [5.5, 5.5], glow: 0.3, lid: 0 },
  happy: { spin: 22, open: 0.5, iris: 17, pupil: [7.5, 7.5], glow: 0.55, lid: 0 },
  angry: { spin: -34, open: 0.3, iris: 17, pupil: [2.4, 12], glow: 0.7, lid: 0 },
  grim: { spin: 4, open: 0.22, iris: 11, pupil: [3, 3], glow: 0.14, lid: 0 },
  surprised: { spin: 44, open: 0.62, iris: 22, pupil: [10, 10], glow: 0.75, lid: 0 },
  smug: { spin: -14, open: 0.38, iris: 16, pupil: [5, 5], glow: 0.38, lid: 0.55 },
};

/** An elliptical ring (an annulus) as path data: outer ellipse clockwise, inner ellipse counter-clockwise. */
function ring(rx: number, ry: number, w: number): string {
  const ox = rx;
  const oy = ry;
  const ix = rx - w;
  const iy = ry - w * 0.7;
  return (
    `M${n(CX - ox)} ${n(CY)}a${n(ox)} ${n(oy)} 0 1 0 ${n(2 * ox)} 0a${n(ox)} ${n(oy)} 0 1 0 ${n(-2 * ox)} 0Z` +
    `M${n(CX - ix)} ${n(CY)}a${n(ix)} ${n(iy)} 0 1 1 ${n(2 * ix)} 0a${n(ix)} ${n(iy)} 0 1 1 ${n(-2 * ix)} 0Z`
  );
}

function lattice(mood: Mood): string {
  const m = MIND[mood];
  const out: string[] = [];
  // three rings 60 degrees apart, the whole set spun by the mood
  [0, 60, 120].forEach((base, i) => {
    const a = base + m.spin;
    const fill = tones.lattice[i === 0 ? 1 : i === 1 ? 0 : 2];
    out.push(`<g transform="rotate(${n(a)} ${CX} ${CY})"><path d="${ring(R, R * m.open, 4.2)}" fill="${fill}"/>`);
    // nodes at the ring's four extremes
    out.push(`<path d="${disc(CX - R, CY, 3.6)}${disc(CX + R, CY, 3.6)}${disc(CX, CY - R * m.open + 1, 3)}${disc(CX, CY + R * m.open - 1, 3)}" fill="${RED}"/></g>`);
  });
  // an inner shell, concentric with the sphere
  out.push(`<path d="${ring(R * 0.62, R * 0.62, 2.6)}" fill="${tones.lattice[0]}"/>`);
  // the iris: a glow, a dark socket, a red ring, the pupil, and (smug) a lid across the top
  out.push(`<path d="${disc(CX, CY, m.iris + 9)}" fill="${RED}" fill-opacity="${m.glow * 0.5}"/>`);
  out.push(`<path d="${disc(CX, CY, m.iris + 3)}" fill="${tones.obs[0]}"/>`);
  out.push(`<path d="${disc(CX, CY, m.iris)}" fill="${RED}"/>`);
  out.push(`<path d="${disc(CX, CY, m.iris * 0.7)}" fill="${tones.obs[1]}"/>`);
  out.push(`<path d="${oval(CX, CY, m.pupil[0], m.pupil[1])}" fill="${HOT}"/>`);
  if (m.lid > 0) {
    const y = CY - m.iris * 0.8 + m.iris * 1.6 * m.lid;
    out.push(`<path d="M${n(CX - m.iris - 4)} ${n(CY - m.iris - 4)}H${n(CX + m.iris + 4)}V${n(y - 1)}Q${n(CX)} ${n(y + 5)} ${n(CX - m.iris - 4)} ${n(y - 1)}Z" fill="${tones.obs[1]}"/>`);
  }
  return out.join('');
}

const shell = Array.from({ length: 12 }, (_, k) => {
  const a = (k * 30 * Math.PI) / 180;
  return disc(CX + Math.cos(a) * (R + 9), CY + Math.sin(a) * (R + 9), 2.2);
}).join('');

export const vesper: PortraitArt = {
  id: 'vesper',
  faction: 'choir',
  eyeY: CY,
  tones,
  extra: [RED, HOT],
  parts: [
    // the base: a broad housing for the conduit, in the same dark plates as Cantor
    { d: 'M-8 256V226C0 206 36 194 70 188L100 176H156L186 188C220 194 256 206 264 226V256Z', m: 'obs', s: 'M150 170C146 200 142 230 140 262H280V170Z', l: 'M-10 214C20 200 56 192 90 184L70 214C44 220 14 232 -10 248Z' },
    // the stem: a bundle of conduit, lit by seams of red
    { d: 'M108 190L114 154H142L148 190Z', m: 'obs', s: 'M130 150H156V196H130Z', l: 'M108 190L114 154H118L114 190Z' },
    { raw: `<path d="M120 160H123V192H120ZM129 160H132V192H129Z" fill="${RED}" fill-opacity="0.7"/>` },
    // the sphere's dark core
    { d: disc(CX, CY, R + 2), m: 'obs', s: `M${CX + 14} ${CY - R - 4}A${R + 6} ${R + 6} 0 0 1 ${CX + 12} ${CY + R + 6}L${CX + 70} ${CY + R + 6}V${CY - R - 4}Z`, l: `M${CX - R - 4} ${CY - 30}A${R + 6} ${R + 6} 0 0 1 ${CX - 20} ${CY - R - 4}L${CX - 24} ${CY - 20}Z` },
    { face: true },
    // the outer shell: a broken circle of nodes round the sphere, fixed while the rings spin inside it
    { raw: `<path d="${shell}" fill="${tones.lattice[2]}"/>`, rim: shell },
    // a red seam where the stem meets the sphere
    { raw: `<path d="M110 154H146V158H110Z" fill="${RED}" fill-opacity="0.8"/>` },
  ],
  expression: (mood) => lattice(mood),
};
