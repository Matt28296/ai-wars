// ECHO, Helion's tactical adjutant: not a person but the interface itself. A holographic glyph: a cyan waveform-shaped face inside a hex
// frame, scanlines across it, projected from a small emitter. The mood is the waveform: the eyes' envelope, the mouth's curve and its jag.
import { box, n } from '../geom';
import type { Mood, PortraitArt } from '../types';

const tones = {
  holo: ['#14708a', '#3cb4d4', '#c7f7ff'],
  screen: ['#041a24', '#08303f', '#0e4a60'],
  base: ['#0a1f29', '#14394a', '#2c6e86'],
} as const;

const SIG = '#5ce1ff';
const CX = 128;
const CY = 104;
const HEX_R = 64;

const hexPath = (r: number, hole = false): string => {
  const pts: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((-90 + 60 * (hole ? 5 - k : k)) * Math.PI) / 180;
    pts.push(`${n(CX + Math.cos(a) * r)} ${n(CY + Math.sin(a) * r)}`);
  }
  return `M${pts.join('L')}Z`;
};

/** One bar of the waveform: a rounded vertical capsule centred on (x, y), `h` tall. */
const bar = (x: number, y: number, h: number, w = 3.4): string => {
  const r = w / 2;
  const hh = Math.max(h, w) / 2;
  return `M${n(x - r)} ${n(y - hh + r)}a${n(r)} ${n(r)} 0 0 1 ${n(w)} 0V${n(y + hh - r)}a${n(r)} ${n(r)} 0 0 1 ${n(-w)} 0Z`;
};

interface Wave {
  /** Eye groups: amplitude (bar height at the middle), tilt (px across a group, + = right end lower), and a bow (+ = ends lower: a smile of bars). */
  eye: { amp: number; tilt: number; bow: number; jag: number };
  /** Mouth: amplitude of the bars, bow (+ = ends up: a smile), tilt, jag (alternate bars taller), width factor. */
  mouth: { amp: number; bow: number; tilt: number; jag: number; wide: number };
  /** Right eye amplitude factor (smug is lopsided). */
  right: number;
}

const WAVE: Record<Mood, Wave> = {
  neutral: { eye: { amp: 15, tilt: 0, bow: 0, jag: 0 }, mouth: { amp: 4, bow: 0, tilt: 0, jag: 0, wide: 1 }, right: 1 },
  happy: { eye: { amp: 13, tilt: 0, bow: 7, jag: 0 }, mouth: { amp: 6, bow: 9, tilt: 0, jag: 0, wide: 1.25 }, right: 1 },
  angry: { eye: { amp: 20, tilt: -9, bow: -4, jag: 5 }, mouth: { amp: 9, bow: -8, tilt: 0, jag: 7, wide: 1.1 }, right: 1 },
  grim: { eye: { amp: 6, tilt: 3, bow: -2, jag: 0 }, mouth: { amp: 3, bow: -4, tilt: 2, jag: 0, wide: 0.8 }, right: 1 },
  surprised: { eye: { amp: 29, tilt: 0, bow: 0, jag: 0 }, mouth: { amp: 21, bow: 0, tilt: 0, jag: 0, wide: 0.5 }, right: 1 },
  smug: { eye: { amp: 11, tilt: 0, bow: 0, jag: 0 }, mouth: { amp: 4, bow: 6, tilt: -7, jag: 0, wide: 1 }, right: 1.5 },
};

function face(mood: Mood): string {
  const w = WAVE[mood];
  const out: string[] = [];
  const EYE_Y = 97;
  const group = (cx: number, factor: number, tiltSign: number): void => {
    for (let i = -2; i <= 2; i++) {
      const env = 1 - (Math.abs(i) / 3) ** 2; // a bell: tall in the middle
      const h = w.eye.amp * factor * env + (w.eye.jag && i % 2 ? w.eye.jag : 0) + 3;
      const y = EYE_Y + (i * w.eye.tilt * tiltSign) / 4 + w.eye.bow * (Math.abs(i) / 2) ** 2;
      out.push(bar(cx + i * 5.2, y, h));
    }
  };
  group(104, 1, 1);
  group(152, w.right, -1 * -1);
  // the mouth: a row of bars along a curve
  const MY = 138;
  const N = 11;
  for (let i = 0; i < N; i++) {
    const u = (i - (N - 1) / 2) / ((N - 1) / 2); // -1 .. 1
    const x = CX + u * 30 * w.mouth.wide;
    const env = w.mouth.wide < 0.7 ? 1 - u * u : 0.45 + 0.55 * Math.cos(u * 1.6);
    const h = w.mouth.amp * env + (w.mouth.jag && i % 2 ? w.mouth.jag : 0) + 3;
    const y = MY - w.mouth.bow * u * u + (u * w.mouth.tilt) / 2 + (w.mouth.bow > 0 ? 0 : w.mouth.bow * 0);
    out.push(bar(x, y, h, w.mouth.wide < 0.7 ? 4.2 : 3.4));
  }
  return `<path d="${out.join('')}" fill="${SIG}"/>`;
}

// scanlines across the screen: one path, a thin line every 4 px
const scan = (): string => {
  let d = '';
  for (let y = CY - HEX_R + 6; y < CY + HEX_R - 4; y += 4) d += box(CX - 56, y, 112, 1);
  return `<path d="${d}" fill="${SIG}" fill-opacity="0.12"/>`;
};

export const echo: PortraitArt = {
  id: 'echo',
  faction: null,
  eyeY: 97,
  tones,
  extra: [SIG],
  // the cone of light the emitter throws up into the frame
  backdrop: `<path d="M104 226L152 226L184 168L72 168Z" fill="${SIG}" fill-opacity="0.1"/>`,
  parts: [
    { d: 'M84 224H172L186 256H70Z', m: 'base', s: 'M138 220H200V260H138Z', l: 'M84 224H100L88 256H70Z' },
    { d: 'M104 216H152V226H104Z', m: 'base', s: 'M132 212H160V230H132Z', l: 'M104 216H152V218H104Z' },
    // the screen inside the hex, then its frame
    { d: hexPath(HEX_R - 7), m: 'screen', s: `M${CX + 26} 30H210V180H${CX + 26}Z` },
    { face: true },
    { raw: scan() },
    { d: hexPath(HEX_R) + hexPath(HEX_R - 7, true), m: 'holo', s: `M${CX + 30} 30H210V180H${CX + 30}Z`, l: `M60 30H${CX}V80H60Z` },
  ],
  expression: (mood) => face(mood),
};
