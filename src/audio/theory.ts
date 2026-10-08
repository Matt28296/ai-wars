// Music theory + the tiny composition language used by src/audio/songs/*.
//
// Melodic lines are strings of whitespace-separated tokens, one per note:
//   PITCH[:LEN][!|?][*N]     e.g.  "E5:2 G5:1 A5:1 r:4 C5+E5+G5:8!"
//   PITCH   note name with octave (C4 = middle C, sharps '#', flats 'b'),
//           chords joined with '+', or 'r' for a rest.
//   LEN     length in sequencer steps (16th notes in 4/4); default set by '@N' (initially 2).
//   !  ?    accent / soft.     ~ prefix: glide (portamento) from the previous note.
//   *N      repeat the token N times.          '|' is ignored (use it for bar lines).
//
// Harmony is written as chord progressions ("D:16 A/C#:16 Bm G") and turned into bass lines,
// stabs, pads and arpeggios by comp()/pad()/arp() with automatic voice leading.

export interface Step { len: number; notes: number[]; vel: number; glide: boolean }
export type Line = Step[];

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C#' / 'Bb' / 'F' → pitch class 0–11. */
export function pitchClass(name: string): number {
  const m = /^([A-Ga-g])([#b]*)$/.exec(name);
  if (!m) throw new Error(`audio: bad pitch class "${name}"`);
  let pc = LETTER[m[1].toUpperCase()];
  for (const c of m[2]) pc += c === '#' ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}

/** 'A4' → 69. */
export function noteToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]*)(-?\d)$/.exec(name);
  if (!m) throw new Error(`audio: bad note "${name}"`);
  let pc = LETTER[m[1].toUpperCase()];
  for (const c of m[2]) pc += c === '#' ? 1 : -1;
  return pc + (parseInt(m[3], 10) + 1) * 12;
}

export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const noteToFreq = (name: string): number => midiToFreq(noteToMidi(name));

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiToName = (m: number): string => `${SHARP_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

/** Parse a melodic line (see header). */
export function line(src: string): Line {
  const out: Line = [];
  let def = 2;
  for (const raw of src.split(/\s+/)) {
    if (!raw || raw === '|') continue;
    if (raw[0] === '@') {
      def = Number(raw.slice(1));
      if (!(def > 0)) throw new Error(`audio: bad default length "${raw}"`);
      continue;
    }
    let t = raw;
    let times = 1;
    const rep = /\*(\d+)$/.exec(t);
    if (rep) { times = Number(rep[1]); t = t.slice(0, rep.index); }
    let glide = false;
    let vel = 0.8;
    if (t[0] === '~') { glide = true; t = t.slice(1); }
    const last = t[t.length - 1];
    if (last === '!') { vel = 1; t = t.slice(0, -1); } else if (last === '?') { vel = 0.55; t = t.slice(0, -1); }
    const [p, l] = t.split(':');
    const len = l === undefined ? def : Number(l);
    if (!(len > 0)) throw new Error(`audio: bad length in "${raw}"`);
    const notes = p === 'r' || p === '.' ? [] : p.split('+').map(noteToMidi);
    for (let i = 0; i < times; i++) out.push({ len, notes, vel, glide });
  }
  return out;
}

export const lineLength = (l: Line): number => l.reduce((s, x) => s + x.len, 0);

/** Concatenate lines / line sources. */
export function cat(...parts: (string | Line)[]): Line {
  const out: Line = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? line(p) : p));
  return out;
}

/** Repeat a string (with a separating space) or a line n times. */
export function rep(x: string, n: number): string;
export function rep(x: Line, n: number): Line;
export function rep(x: string | Line, n: number): string | Line {
  if (typeof x === 'string') return Array.from({ length: n }, () => x).join(' ');
  const out: Line = [];
  for (let i = 0; i < n; i++) out.push(...x);
  return out;
}

export const rest = (len: number): Line => [{ len, notes: [], vel: 0, glide: false }];

export function transpose(l: string | Line, semis: number): Line {
  const src = typeof l === 'string' ? line(l) : l;
  return src.map((s) => ({ ...s, notes: s.notes.map((n) => n + semis) }));
}

/** Scale-aware transposition: move each note `steps` scale degrees (e.g. -2 = a third below). */
export function diatonic(l: string | Line, key: string, steps: number): Line {
  const src = typeof l === 'string' ? line(l) : l;
  const scale = scalePcs(key);
  return src.map((s) => ({
    ...s,
    notes: s.notes.map((n) => {
      const pc = ((n % 12) + 12) % 12;
      let off = 0;
      let idx = scale.indexOf(pc);
      while (idx < 0) { off++; idx = scale.indexOf((pc - off + 12) % 12); }
      const base = n - off;
      const oct = Math.floor((idx + steps) / scale.length);
      const ni = ((idx + steps) % scale.length + scale.length) % scale.length;
      let d = scale[ni] - scale[idx] + oct * 12;
      return base + d + off;
    }),
  }));
}

const MODES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
};
function scalePcs(key: string): number[] {
  const [root, mode = 'major'] = key.split(' ');
  const r = pitchClass(root);
  const m = MODES[mode];
  if (!m) throw new Error(`audio: unknown mode "${mode}"`);
  return m.map((x) => (x + r) % 12).sort((a, b) => a - b);
}

// ---------------------------------------------------------------- chords

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '5': [0, 7], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], mmaj7: [0, 3, 7, 11],
  sus2: [0, 2, 7], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
  aug: [0, 4, 8], m7b5: [0, 3, 6, 10], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14],
};

export interface Chord { sym: string; root: number; iv: number[]; bass: number }

export function chord(sym: string): Chord {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym);
  if (!m) throw new Error(`audio: bad chord "${sym}"`);
  const iv = QUALITIES[m[2]];
  if (!iv) throw new Error(`audio: unknown chord quality "${m[2]}" in "${sym}"`);
  const root = pitchClass(m[1]);
  return { sym, root, iv, bass: m[3] ? pitchClass(m[3]) : root };
}

export interface ProgItem { chord: Chord; len: number }
export type Prog = ProgItem[];

/** "D:16 A/C#:16 Bm G" → progression (default length = one 4/4 bar). */
export function prog(src: string, defLen = 16): Prog {
  return src.split(/\s+/).filter((t) => t && t !== '|').map((t) => {
    const [s, l] = t.split(':');
    return { chord: chord(s), len: l ? Number(l) : defLen };
  });
}

const progLength = (p: Prog): number => p.reduce((s, x) => s + x.len, 0);

/** Midi note with pitch class pc nearest to center (ties go down). */
function nearest(pc: number, center: number): number {
  const base = center - (((center - pc) % 12) + 12) % 12; // ≤ center
  return center - base <= 6 ? base : base + 12;
}

function voicingCandidates(c: Chord, lo: number, hi: number, maxNotes: number): number[][] {
  let pcs = [...new Set(c.iv.map((x) => (c.root + x) % 12))];
  while (pcs.length > maxNotes) {
    const fifth = (c.root + 7) % 12;
    const i = pcs.indexOf(fifth);
    pcs.splice(i >= 0 ? i : pcs.length - 1, 1);
  }
  const out: number[][] = [];
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let start = lo - 12; start <= hi; start += 12) {
      const notes: number[] = [];
      let prev = start - 1;
      for (const pc of order) {
        let n = prev + 1;
        while (((n % 12) + 12) % 12 !== pc) n++;
        notes.push(n);
        prev = n;
      }
      if (notes[0] >= lo && notes[notes.length - 1] <= hi) out.push(notes);
    }
  }
  return out;
}

/** Smooth voice-led voicings for a progression. */
export function voiceLead(p: Prog, center = 62, maxNotes = 4, span = 12): number[][] {
  const lo = center - span;
  const hi = center + span;
  const out: number[][] = [];
  let prev: number[] | null = null;
  for (const item of p) {
    const cands = voicingCandidates(item.chord, lo, hi, maxNotes);
    if (!cands.length) throw new Error(`audio: no voicing for ${item.chord.sym}`);
    let best = cands[0];
    let bestScore = Infinity;
    for (const v of cands) {
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      let score = Math.abs(mean - center) * (prev ? 0.35 : 1);
      if (prev) for (const n of v) score += Math.min(...prev.map((q) => Math.abs(q - n)));
      if (score < bestScore) { bestScore = score; best = v; }
    }
    out.push(best);
    prev = best;
  }
  return out;
}

export interface CompOpts {
  /** Centre pitch (midi) for bass degrees R/O/5/3/7/L. Default 40 (E2). */
  center?: number;
  /** Centre pitch for full chords (C). Default 62. */
  chordCenter?: number;
  maxNotes?: number;
  vel?: number;
}

/**
 * Render a progression through a rhythm. Rhythm tokens: DEG[:LEN][!|?], '~' prefix glides.
 * DEG: R root (or slash bass), O octave above R, 5 fifth above, L fifth below, 3 third, 7 seventh
 * (octave if none), 9 ninth, C the whole (voice-led) chord, r rest. The rhythm is anchored to the
 * start of the line and cycles; notes are re-struck at chord changes.
 */
export function comp(p: Prog | string, rhythm: string, o: CompOpts = {}): Line {
  const P = typeof p === 'string' ? prog(p) : p;
  const center = o.center ?? 40;
  const voices = voiceLead(P, o.chordCenter ?? 62, o.maxNotes ?? 4);
  const toks = rhythm.split(/\s+/).filter((t) => t && t !== '|').flatMap((raw) => {
    let t = raw;
    let times = 1;
    const rp = /\*(\d+)$/.exec(t);
    if (rp) { times = Number(rp[1]); t = t.slice(0, rp.index); }
    let glide = false;
    let vel = o.vel ?? 0.8;
    if (t[0] === '~') { glide = true; t = t.slice(1); }
    const last = t[t.length - 1];
    if (last === '!') { vel = Math.min(1, vel * 1.25); t = t.slice(0, -1); } else if (last === '?') { vel *= 0.65; t = t.slice(0, -1); }
    const [deg, l] = t.split(':');
    const len = l ? Number(l) : 2;
    return Array.from({ length: times }, () => ({ deg, len, vel, glide }));
  });
  if (!toks.length) throw new Error('audio: empty rhythm');
  const total = progLength(P);
  const out: Line = [];
  let pos = 0;
  let ti = 0;
  let rem = toks[0].len;
  let ci = 0;
  let cEnd = P[0].len;
  while (pos < total) {
    while (pos >= cEnd) { ci++; cEnd += P[ci].len; }
    const tk = toks[ti];
    const seg = Math.min(rem, cEnd - pos);
    const c = P[ci].chord;
    out.push({ len: seg, notes: degree(tk.deg, c, voices[ci], center), vel: tk.vel, glide: tk.glide });
    pos += seg;
    rem -= seg;
    if (rem <= 0) { ti = (ti + 1) % toks.length; rem = toks[ti].len; }
  }
  return out;
}

function degree(deg: string, c: Chord, voicing: number[], center: number): number[] {
  if (deg === 'r' || deg === '.') return [];
  if (deg === 'C') return voicing;
  const bass = nearest(c.bass, center);
  const above = (pc: number): number => { let n = bass + 1; while (((n % 12) + 12) % 12 !== pc) n++; return n; };
  const has = (x: number): boolean => c.iv.includes(x);
  switch (deg) {
    case 'R': return [bass];
    case 'O': return [bass + 12];
    case '5': return [above((c.root + (has(6) ? 6 : has(8) ? 8 : 7)) % 12)];
    case 'L': return [above((c.root + 7) % 12) - 12];
    case '3': return [above((c.root + (has(3) ? 3 : has(4) ? 4 : has(5) ? 5 : 2)) % 12)];
    case '7': return has(10) ? [above((c.root + 10) % 12)] : has(11) ? [above((c.root + 11) % 12)] : [bass + 12];
    case '9': return [above((c.root + 2) % 12) + 12];
    default: throw new Error(`audio: unknown degree "${deg}"`);
  }
}

/** Sustained chords, one per progression item. */
export function pad(p: Prog | string, o: CompOpts = {}): Line {
  return comp(p, 'C:4096', o);
}

export interface ArpOpts {
  /** Indices into the chord's tones (extended upward by octaves). */
  pattern?: number[];
  /** Steps per arp note (1 = 16ths). */
  rate?: number;
  center?: number;
  maxNotes?: number;
  vel?: number;
  /** Velocity multiplier pattern, cycled per arp note. */
  accent?: number[];
}

export function arp(p: Prog | string, o: ArpOpts = {}): Line {
  const P = typeof p === 'string' ? prog(p) : p;
  const pattern = o.pattern ?? [0, 1, 2, 3];
  const rate = o.rate ?? 1;
  const voices = voiceLead(P, o.center ?? 66, o.maxNotes ?? 3);
  const out: Line = [];
  let pos = 0;
  P.forEach((item, ci) => {
    const v = voices[ci];
    const end = pos + item.len;
    while (pos < end) {
      const i = Math.floor(pos / rate);
      const idx = pattern[i % pattern.length];
      const note = v[idx % v.length] + 12 * Math.floor(idx / v.length);
      const acc = o.accent ? o.accent[i % o.accent.length] : 1;
      const len = Math.min(rate, end - pos);
      out.push(idx < 0 ? { len, notes: [], vel: 0, glide: false } : { len, notes: [note], vel: (o.vel ?? 0.75) * acc, glide: false });
      pos += len;
    }
  });
  return out;
}

// ---------------------------------------------------------------- drum grids

export interface Hit { step: number; vel: number; roll: boolean }

/**
 * Drum grid: one character per step. x hit, X accent, g ghost, r roll (two 32nds),
 * '.' or '-' rest; whitespace and '|' ignored.
 */
export function grid(src: string): { steps: number; hits: Hit[] } {
  const hits: Hit[] = [];
  let step = 0;
  for (const ch of src) {
    if (ch === ' ' || ch === '|' || ch === '\n' || ch === '\t') continue;
    switch (ch) {
      case 'x': hits.push({ step, vel: 0.8, roll: false }); break;
      case 'X': hits.push({ step, vel: 1, roll: false }); break;
      case 'g': hits.push({ step, vel: 0.4, roll: false }); break;
      case 'r': hits.push({ step, vel: 0.6, roll: true }); break;
      case '.': case '-': break;
      default: throw new Error(`audio: bad drum char "${ch}"`);
    }
    step++;
  }
  return { steps: step, hits };
}

/** Repeat a drum bar n times. */
export const bars = (bar: string, n: number): string => Array.from({ length: n }, () => bar).join(' ');
