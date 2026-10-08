// Instrument patches: plain data consumed by engine.ts.

export type Wave = OscillatorType | 'pulse12' | 'pulse25' | 'pulse33';

export interface SynthPatch {
  kind: 'synth';
  wave: Wave;
  /** Optional second oscillator layer. */
  wave2?: Wave;
  mix2?: number;
  /** Second layer offset in semitones (e.g. 12, 7, -12) and cents. */
  semi2?: number;
  cents2?: number;
  /** Unison voices of the main wave and their total spread in cents. */
  unison?: number;
  spread?: number;
  /** Sine sub-oscillator one octave down. */
  sub?: number;
  octave?: number;
  /** ADSR: attack s, decay s, sustain 0–1, release s. */
  env: [number, number, number, number];
  gain: number;
  /** Fraction of the written length the note is held (default 0.92). */
  gate?: number;
  filter?: {
    type?: BiquadFilterType; freq: number; q?: number;
    /** Hz added at the envelope peak. */
    env?: number; attack?: number; decay?: number;
    /** Key tracking 0–1 (1 = filter follows pitch fully, ref C4). */
    key?: number;
  };
  vibrato?: { rate: number; depth: number; delay?: number };
  /** Pitch starts `semis` above and falls to the note in `time` s. */
  pitchEnv?: { semis: number; time: number };
  /** FM: sine modulator at ratio × f, index in multiples of f, decaying to `sustain` × index. */
  fm?: { ratio: number; index: number; decay: number; sustain?: number };
  /** Noise transient (breath / chiff / mallet). */
  noise?: { gain: number; decay: number; freq?: number; q?: number };
  glide?: number;
  pan?: number;
  reverb?: number;
  delay?: number;
  /** Channel-level vowel filter bank (choirs). */
  formant?: 'a' | 'o' | 'u' | 'e';
  /** Channel-level bit crusher: number of quantisation levels per polarity. */
  crush?: number;
  /** Channel-level fixed lowpass (cheap tone control). */
  lowpass?: number;
  /** Channel-level highpass. */
  highpass?: number;
  /** Tremolo (amplitude LFO) on the channel. */
  tremolo?: { rate: number; depth: number };
}

export type DrumVoice =
  | 'kick' | 'chipKick' | 'snare' | 'chipSnare' | 'clap' | 'hat' | 'openHat' | 'ride' | 'crash'
  | 'tomHi' | 'tomMid' | 'tomLo' | 'rim' | 'shaker' | 'wood' | 'conga' | 'glitch' | 'bassDrum';

export interface DrumPatch {
  kind: 'drum';
  voice: DrumVoice;
  gain: number;
  /** Pitch multiplier. */
  tune?: number;
  /** Decay multiplier. */
  decay?: number;
  pan?: number;
  reverb?: number;
  delay?: number;
  crush?: number;
  highpass?: number;
  lowpass?: number;
}

export type Patch = SynthPatch | DrumPatch;

const s = (p: Omit<SynthPatch, 'kind'>): SynthPatch => ({ kind: 'synth', ...p });
const d = (voice: DrumVoice, gain: number, extra: Partial<DrumPatch> = {}): DrumPatch => ({ kind: 'drum', voice, gain, ...extra });

/** Preset library. Songs spread these and override gain/pan/sends. */
export const P = {
  // --- leads
  chipLead: s({ wave: 'pulse25', env: [0.004, 0.12, 0.7, 0.08], gain: 0.13, vibrato: { rate: 5.6, depth: 16, delay: 0.16 }, reverb: 0.12, delay: 0.12, lowpass: 7000 }),
  chipHarm: s({ wave: 'pulse12', env: [0.004, 0.15, 0.55, 0.07], gain: 0.085, vibrato: { rate: 5.6, depth: 10, delay: 0.2 }, reverb: 0.12, lowpass: 6500 }),
  squareLead: s({ wave: 'square', env: [0.004, 0.1, 0.65, 0.07], gain: 0.085, vibrato: { rate: 5.5, depth: 14, delay: 0.15 }, lowpass: 5200, reverb: 0.12, delay: 0.1 }),
  sawLead: s({
    wave: 'sawtooth', unison: 2, spread: 12, env: [0.01, 0.25, 0.75, 0.16], gain: 0.1,
    filter: { freq: 1700, env: 2200, decay: 0.25, q: 1.2, key: 0.6 },
    vibrato: { rate: 5.4, depth: 14, delay: 0.22 }, reverb: 0.22, delay: 0.24, glide: 0.05,
  }),
  brass: s({
    wave: 'sawtooth', unison: 3, spread: 9, env: [0.035, 0.35, 0.8, 0.18], gain: 0.085,
    filter: { freq: 520, env: 2400, attack: 0.06, decay: 0.5, q: 1.4, key: 0.7 },
    vibrato: { rate: 5, depth: 9, delay: 0.3 }, reverb: 0.3,
  }),
  horn: s({
    wave: 'square', wave2: 'sawtooth', mix2: 0.5, env: [0.06, 0.3, 0.85, 0.2], gain: 0.07,
    filter: { freq: 380, env: 1100, attack: 0.08, decay: 0.4, q: 0.9, key: 0.8 },
    vibrato: { rate: 4.8, depth: 8, delay: 0.35 }, reverb: 0.35,
  }),
  flute: s({
    wave: 'sine', wave2: 'triangle', mix2: 0.35, semi2: 12, env: [0.05, 0.2, 0.85, 0.14], gain: 0.13,
    noise: { gain: 0.06, decay: 0.09, freq: 2600, q: 1.5 },
    vibrato: { rate: 5.2, depth: 16, delay: 0.18 }, reverb: 0.35, delay: 0.18,
  }),
  choirOo: s({
    wave: 'sawtooth', unison: 2, spread: 8, env: [0.12, 0.3, 0.9, 0.45], gain: 0.3, formant: 'u',
    vibrato: { rate: 5.3, depth: 22, delay: 0.25 }, reverb: 0.55, delay: 0.18,
  }),
  // --- keys / mallets
  bell: s({ wave: 'sine', fm: { ratio: 3.5, index: 2.4, decay: 0.45, sustain: 0.05 }, env: [0.002, 1.3, 0, 0.9], gain: 0.11, reverb: 0.4, delay: 0.22, gate: 1 }),
  glass: s({ wave: 'sine', fm: { ratio: 1.414, index: 2.2, decay: 0.6, sustain: 0.15 }, env: [0.003, 1.6, 0, 1.2], gain: 0.09, reverb: 0.55, delay: 0.3, gate: 1 }),
  ePiano: s({ wave: 'sine', fm: { ratio: 1, index: 1.6, decay: 0.5, sustain: 0.2 }, env: [0.003, 1.1, 0.25, 0.35], gain: 0.11, reverb: 0.3, delay: 0.15 }),
  marimba: s({ wave: 'sine', fm: { ratio: 4, index: 1.1, decay: 0.06 }, env: [0.002, 0.38, 0, 0.12], gain: 0.2, noise: { gain: 0.04, decay: 0.012, freq: 3000 }, reverb: 0.2, gate: 1 }),
  kalimba: s({ wave: 'sine', fm: { ratio: 5.4, index: 0.9, decay: 0.04 }, env: [0.002, 0.7, 0, 0.35], gain: 0.13, reverb: 0.3, delay: 0.2, gate: 1 }),
  pluck: s({ wave: 'sawtooth', env: [0.002, 0.2, 0, 0.12], gain: 0.085, filter: { freq: 420, env: 3600, decay: 0.12, q: 2.5, key: 0.5 }, delay: 0.28, reverb: 0.2, gate: 1 }),
  squareArp: s({ wave: 'square', env: [0.002, 0.08, 0.2, 0.04], gain: 0.05, lowpass: 4200, delay: 0.18 }),
  pulseArp: s({ wave: 'pulse25', env: [0.002, 0.09, 0.15, 0.05], gain: 0.06, lowpass: 5000, delay: 0.2 }),
  // --- pads
  superPad: s({ wave: 'sawtooth', unison: 4, spread: 22, env: [0.35, 0.8, 0.8, 0.9], gain: 0.045, filter: { freq: 1500, q: 0.6, key: 0.3 }, reverb: 0.5 }),
  strings: s({ wave: 'sawtooth', unison: 3, spread: 14, env: [0.22, 0.4, 0.85, 0.6], gain: 0.05, filter: { freq: 2100, q: 0.7, key: 0.4 }, vibrato: { rate: 5.2, depth: 7, delay: 0.2 }, reverb: 0.45 }),
  chipPad: s({ wave: 'pulse33', env: [0.03, 0.3, 0.6, 0.25], gain: 0.04, lowpass: 3800, reverb: 0.3 }),
  choirAh: s({ wave: 'sawtooth', unison: 3, spread: 14, env: [0.45, 0.6, 0.85, 1.1], gain: 0.18, formant: 'a', vibrato: { rate: 4.8, depth: 14, delay: 0.3 }, reverb: 0.65 }),
  stab: s({ wave: 'sawtooth', unison: 3, spread: 16, env: [0.003, 0.18, 0.25, 0.12], gain: 0.05, filter: { freq: 900, env: 3000, decay: 0.12, q: 1.2 }, reverb: 0.3, delay: 0.15 }),
  // --- bass
  triBass: s({ wave: 'triangle', env: [0.003, 0.15, 0.85, 0.05], gain: 0.34 }),
  chipBass: s({ wave: 'pulse25', env: [0.003, 0.1, 0.7, 0.04], gain: 0.07, lowpass: 1600 }),
  synthBass: s({ wave: 'sawtooth', sub: 0.6, env: [0.003, 0.22, 0.55, 0.06], gain: 0.13, filter: { freq: 260, env: 1500, decay: 0.12, q: 5, key: 0.3 }, glide: 0.05 }),
  tuba: s({ wave: 'sawtooth', sub: 0.5, env: [0.025, 0.25, 0.75, 0.1], gain: 0.15, filter: { freq: 340, env: 420, attack: 0.03, decay: 0.2, q: 1, key: 0.5 } }),
  subBass: s({ wave: 'sine', wave2: 'triangle', mix2: 0.25, env: [0.01, 0.3, 0.9, 0.2], gain: 0.32 }),
  roundBass: s({ wave: 'triangle', wave2: 'sine', mix2: 0.6, semi2: -12, env: [0.004, 0.25, 0.6, 0.08], gain: 0.3, pitchEnv: { semis: 0.6, time: 0.03 } }),
  // --- pitched percussion
  timpani: s({ wave: 'sine', wave2: 'triangle', mix2: 0.3, pitchEnv: { semis: 1.5, time: 0.12 }, noise: { gain: 0.12, decay: 0.03, freq: 900, q: 0.8 }, env: [0.002, 1.1, 0, 0.7], gain: 0.42, reverb: 0.35, gate: 1 }),
  logDrum: s({ wave: 'sine', pitchEnv: { semis: 3, time: 0.04 }, env: [0.002, 0.28, 0, 0.12], gain: 0.34, reverb: 0.15, gate: 1 }),

  // --- drums
  kick: d('kick', 0.8),
  chipKick: d('chipKick', 0.6),
  bassDrum: d('bassDrum', 0.75, { reverb: 0.25 }),
  snare: d('snare', 0.42, { reverb: 0.35 }),
  chipSnare: d('chipSnare', 0.3, { reverb: 0.15 }),
  clap: d('clap', 0.38, { reverb: 0.35 }),
  hat: d('hat', 0.13, { pan: 0.2 }),
  openHat: d('openHat', 0.1, { pan: 0.2 }),
  ride: d('ride', 0.07, { pan: -0.25 }),
  crash: d('crash', 0.16, { pan: -0.15, reverb: 0.3 }),
  tomHi: d('tomHi', 0.4, { pan: -0.3, reverb: 0.2 }),
  tomMid: d('tomMid', 0.42, { reverb: 0.2 }),
  tomLo: d('tomLo', 0.45, { pan: 0.3, reverb: 0.2 }),
  rim: d('rim', 0.16, { pan: -0.2, reverb: 0.15 }),
  shaker: d('shaker', 0.07, { pan: 0.35 }),
  wood: d('wood', 0.16, { pan: -0.35, reverb: 0.15 }),
  conga: d('conga', 0.28, { pan: 0.3, reverb: 0.1 }),
  glitch: d('glitch', 0.09, { crush: 6, pan: 0.15, delay: 0.3 }),
} as const;
