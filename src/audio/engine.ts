// The synth engine: master chain, shared reverb, voices and drum kit.
// Works on any BaseAudioContext so the same code renders live and offline.

import type { DrumPatch, Patch, SynthPatch, Wave } from './patches';
import { midiToFreq } from './theory';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface EngineOptions {
  /** Master compressor + soft clipper (default true). Off only for diagnostics. */
  limiter?: boolean;
  /** Tap an AnalyserNode on the output (for meters). */
  analyser?: boolean;
}

export class Engine {
  readonly ctx: BaseAudioContext;
  /** Overall level (mute lives here). */
  readonly master: GainNode;
  /** Music volume. */
  readonly music: GainNode;
  /** Music ducking under big SFX. */
  readonly duck: GainNode;
  /** SFX volume. */
  readonly sfx: GainNode;
  /** Shared reverb send. */
  readonly reverb: GainNode;
  /** SFX echo send. */
  readonly echo: GainNode;
  readonly analyser: AnalyserNode | null = null;
  readonly rand: () => number;
  private readonly waves = new Map<string, PeriodicWave>();
  private readonly noiseBuf: AudioBuffer;
  private crushCurves = new Map<number, Float32Array>();

  constructor(ctx: BaseAudioContext, opts: EngineOptions = {}) {
    this.ctx = ctx;
    this.rand = mulberry32(0x5eed1e55);
    this.noiseBuf = this.makeNoise(2);

    this.master = ctx.createGain();
    let tail: AudioNode = this.master;
    if (opts.limiter !== false) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 8;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.22;
      const pre = ctx.createGain();
      pre.gain.value = 0.5;
      const clip = ctx.createWaveShaper();
      clip.curve = softClipCurve();
      clip.oversample = '2x';
      this.master.connect(comp).connect(pre).connect(clip);
      tail = clip;
    }
    tail.connect(ctx.destination);
    if (opts.analyser) {
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      tail.connect(an);
      this.analyser = an;
    }

    this.music = ctx.createGain();
    this.duck = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music.connect(this.duck).connect(this.master);
    this.sfx.connect(this.master);

    // Reverb: highpassed send → generated plate-ish IR → dark return.
    this.reverb = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 220;
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(2.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    const ret = ctx.createGain();
    ret.gain.value = 0.8;
    this.reverb.connect(hp).connect(conv).connect(lp).connect(ret).connect(this.master);

    this.echo = createDelay(this, 0.17, 0.32, this.sfx);
  }

  get now(): number { return this.ctx.currentTime; }

  /** Pulse-wave PeriodicWave (duty 0–1), cached. */
  wave(osc: OscillatorNode, w: Wave): void {
    if (w === 'pulse12' || w === 'pulse25' || w === 'pulse33') {
      let pw = this.waves.get(w);
      if (!pw) {
        const duty = w === 'pulse12' ? 0.125 : w === 'pulse25' ? 0.25 : 0.333;
        const n = 48;
        const re = new Float32Array(n);
        const im = new Float32Array(n);
        for (let k = 1; k < n; k++) {
          re[k] = (2 / (k * Math.PI)) * Math.sin(2 * k * Math.PI * duty);
          im[k] = (4 / (k * Math.PI)) * Math.sin(k * Math.PI * duty) ** 2;
        }
        pw = this.ctx.createPeriodicWave(re, im);
        this.waves.set(w, pw);
      }
      osc.setPeriodicWave(pw);
    } else {
      osc.type = w;
    }
  }

  /** A started noise source playing from t for dur seconds. */
  noise(t: number, dur: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start(t, this.rand() * 1.5);
    src.stop(t + dur);
    return src;
  }

  crushCurve(levels: number): Float32Array {
    let c = this.crushCurves.get(levels);
    if (!c) {
      c = new Float32Array(2048);
      for (let i = 0; i < c.length; i++) {
        const x = (i / (c.length - 1)) * 2 - 1;
        c[i] = Math.round(x * levels) / levels;
      }
      this.crushCurves.set(levels, c);
    }
    return c;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = this.rand() * 2 - 1;
    return buf;
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp((-6.9 * t) / seconds) * (t < 0.008 ? t / 0.008 : 1);
        const k = 0.15 + 0.8 * Math.min(1, t / seconds); // darker as it decays
        lp += (this.rand() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * env;
      }
    }
    return buf;
  }
}

function softClipCurve(): Float32Array {
  // Input is pre-scaled by 0.5, so x ∈ [-1, 1] represents a signal s ∈ [-2, 2].
  // Linear (unity) up to |s| = 0.6, then a tanh knee that never exceeds 0.98.
  const n = 8193;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(s);
    const y = a <= 0.6 ? a : 0.6 + 0.38 * Math.tanh((a - 0.6) / 0.38);
    c[i] = Math.sign(s) * y;
  }
  return c;
}

/** Ping-pong delay. Returns its input node; output goes to `out`. */
export function createDelay(e: Engine, time: number, feedback: number, out: AudioNode): GainNode {
  const ctx = e.ctx;
  const input = ctx.createGain();
  const l = ctx.createDelay(2);
  const r = ctx.createDelay(2);
  l.delayTime.value = time;
  r.delayTime.value = time;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 3200;
  const pl = panner(ctx, -0.55);
  const pr = panner(ctx, 0.55);
  input.connect(tone).connect(l);
  l.connect(pl).connect(out);
  l.connect(r);
  r.connect(pr).connect(out);
  r.connect(fb).connect(tone);
  return input;
}

export function panner(ctx: BaseAudioContext, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  }
  return ctx.createGain();
}

const clampF = (ctx: BaseAudioContext, f: number): number => Math.max(20, Math.min(ctx.sampleRate * 0.45, f));

// ---------------------------------------------------------------- channel strips

const FORMANTS: Record<string, [number, number, number][]> = {
  // [centre Hz, gain, Q]
  a: [[780, 1, 6], [1180, 0.55, 8], [2800, 0.2, 10]],
  o: [[480, 1, 5], [840, 0.5, 7], [2800, 0.14, 10]],
  u: [[360, 1, 4], [760, 0.4, 6], [2500, 0.08, 10]],
  e: [[430, 1, 6], [2000, 0.4, 10], [2600, 0.22, 10]],
};

export interface Strip { input: GainNode; nodes: AudioNode[] }

/** Per-channel insert chain + sends. */
export function createStrip(e: Engine, p: Patch, dry: AudioNode, wet: AudioNode | null, delayIn: AudioNode | null): Strip {
  const ctx = e.ctx;
  const input = ctx.createGain();
  const nodes: AudioNode[] = [input];
  let chain: AudioNode = input;
  const add = <T extends AudioNode>(n: T): T => { nodes.push(n); chain.connect(n); chain = n; return n; };
  if (p.crush) {
    add(ctx.createGain()).gain.value = 4;
    add(ctx.createWaveShaper()).curve = e.crushCurve(p.crush);
    add(ctx.createGain()).gain.value = 0.25;
  }
  if (p.kind === 'synth' && p.formant) {
    const sum = ctx.createGain();
    nodes.push(sum);
    for (const [f, g, q] of FORMANTS[p.formant]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gn = ctx.createGain();
      gn.gain.value = g * 2.2;
      chain.connect(bp).connect(gn).connect(sum);
      nodes.push(bp, gn);
    }
    const body = ctx.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 1400;
    const bg = ctx.createGain();
    bg.gain.value = 0.18;
    chain.connect(body).connect(bg).connect(sum);
    nodes.push(body, bg);
    chain = sum;
  }
  if (p.lowpass) {
    const f = add(ctx.createBiquadFilter());
    f.type = 'lowpass';
    f.frequency.value = p.lowpass;
    f.Q.value = 0.5;
  }
  if (p.highpass) {
    const f = add(ctx.createBiquadFilter());
    f.type = 'highpass';
    f.frequency.value = p.highpass;
  }
  if (p.kind === 'synth' && p.tremolo) {
    const g = add(ctx.createGain());
    g.gain.value = 1 - p.tremolo.depth / 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.tremolo.rate;
    const lg = ctx.createGain();
    lg.gain.value = p.tremolo.depth / 2;
    lfo.connect(lg).connect(g.gain);
    lfo.start();
    nodes.push(lfo, lg);
  }
  const pan = panner(ctx, p.pan ?? 0);
  chain.connect(pan);
  nodes.push(pan);
  pan.connect(dry);
  if (p.reverb && wet) {
    const g = ctx.createGain();
    g.gain.value = p.reverb;
    pan.connect(g).connect(wet);
    nodes.push(g);
  }
  if (p.delay && delayIn) {
    const g = ctx.createGain();
    g.gain.value = p.delay;
    pan.connect(g).connect(delayIn);
    nodes.push(g);
  }
  return { input, nodes };
}

export function disposeStrip(s: Strip): void {
  for (const n of s.nodes) {
    try {
      if (n instanceof OscillatorNode) n.stop();
      n.disconnect();
    } catch { /* already gone */ }
  }
}

// ---------------------------------------------------------------- synth voice

/** Play one note of a synth patch. Returns the time the voice ends. */
export function playSynth(
  e: Engine, p: SynthPatch, dest: AudioNode, t: number, midi: number, dur: number, vel: number, glideFrom?: number,
): number {
  const ctx = e.ctx;
  const f = midiToFreq(midi + 12 * (p.octave ?? 0));
  const [A, D, S, R] = p.env;
  const a = Math.max(0.001, Math.min(A, dur * 0.6));
  const peak = p.gain * vel;
  const off = t + Math.max(dur, a + 0.004);
  const end = off + R * 2 + 0.02;

  const vca = ctx.createGain();
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(peak, t + a);
  if (S < 1) vca.gain.setTargetAtTime(peak * S, t + a, Math.max(0.001, D / 3));
  vca.gain.setTargetAtTime(0, off, Math.max(0.002, R / 3));
  vca.connect(dest);

  let input: AudioNode = vca;
  let filter: BiquadFilterNode | null = null;
  if (p.filter) {
    const fl = p.filter;
    filter = ctx.createBiquadFilter();
    filter.type = fl.type ?? 'lowpass';
    filter.Q.value = fl.q ?? 0.7;
    const base = fl.freq * Math.pow(f / 261.63, fl.key ?? 0);
    if (fl.env) {
      const pk = base + fl.env * (0.4 + 0.6 * vel);
      const fa = fl.attack ?? 0;
      filter.frequency.setValueAtTime(clampF(ctx, fa ? base : pk), t);
      if (fa) filter.frequency.linearRampToValueAtTime(clampF(ctx, pk), t + fa);
      filter.frequency.setTargetAtTime(clampF(ctx, base + fl.env * 0.15), t + fa, Math.max(0.005, (fl.decay ?? 0.2) / 3));
    } else {
      filter.frequency.value = clampF(ctx, base);
    }
    filter.connect(vca);
    input = filter;
  }

  const oscs: OscillatorNode[] = [];
  const setFreq = (o: OscillatorNode, ratio: number): void => {
    const target = f * ratio;
    if (glideFrom !== undefined && p.glide) {
      const from = midiToFreq(glideFrom + 12 * (p.octave ?? 0)) * ratio;
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(target, t + p.glide);
    } else if (p.pitchEnv) {
      o.frequency.setValueAtTime(target * Math.pow(2, p.pitchEnv.semis / 12), t);
      o.frequency.exponentialRampToValueAtTime(target, t + p.pitchEnv.time);
    } else {
      o.frequency.setValueAtTime(target, t);
    }
  };
  const addOsc = (w: Wave, ratio: number, cents: number, level: number): OscillatorNode => {
    const o = ctx.createOscillator();
    e.wave(o, w);
    setFreq(o, ratio);
    if (cents) o.detune.value = cents;
    if (level === 1) o.connect(input);
    else {
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(input);
    }
    oscs.push(o);
    return o;
  };

  const n = p.unison ?? 1;
  const main: OscillatorNode[] = [];
  for (let i = 0; i < n; i++) {
    const c = n > 1 ? (i / (n - 1) - 0.5) * (p.spread ?? 10) : 0;
    main.push(addOsc(p.wave, 1, c, 1 / Math.sqrt(n)));
  }
  if (p.wave2) addOsc(p.wave2, Math.pow(2, (p.semi2 ?? 0) / 12), p.cents2 ?? 0, p.mix2 ?? 0.5);
  if (p.sub) addOsc('sine', 0.5, 0, p.sub);

  if (p.fm) {
    const mod = ctx.createOscillator();
    mod.frequency.value = f * p.fm.ratio;
    const mg = ctx.createGain();
    const idx = p.fm.index * f * (0.6 + 0.4 * vel);
    mg.gain.setValueAtTime(idx, t);
    mg.gain.setTargetAtTime(idx * (p.fm.sustain ?? 0), t, Math.max(0.005, p.fm.decay / 3));
    mod.connect(mg);
    for (const o of main) mg.connect(o.frequency);
    oscs.push(mod);
  }

  if (p.vibrato && dur > (p.vibrato.delay ?? 0) + 0.08) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.vibrato.rate;
    const lg = ctx.createGain();
    const vd = t + (p.vibrato.delay ?? 0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, vd);
    lg.gain.linearRampToValueAtTime(p.vibrato.depth, vd + 0.2);
    lfo.connect(lg);
    for (const o of oscs) lg.connect(o.detune);
    oscs.push(lfo);
  }

  if (p.noise) {
    const nz = e.noise(t, p.noise.decay * 4 + 0.01);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = clampF(ctx, p.noise.freq ?? f * 2);
    bp.Q.value = p.noise.q ?? 1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(p.noise.gain * vel, t);
    ng.gain.setTargetAtTime(0, t + 0.002, p.noise.decay / 3);
    nz.connect(bp).connect(ng).connect(dest);
    nz.onended = () => { nz.disconnect(); bp.disconnect(); ng.disconnect(); };
  }

  for (const o of oscs) { o.start(t); o.stop(end); }
  oscs[0].onended = () => {
    for (const o of oscs) o.disconnect();
    filter?.disconnect();
    vca.disconnect();
  };
  return end;
}

// ---------------------------------------------------------------- drum kit

interface Env { g: number; tau: number; hold?: number; attack?: number }

function envGain(ctx: BaseAudioContext, t: number, env: Env): GainNode {
  const g = ctx.createGain();
  const at = env.attack ?? 0.001;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(env.g, t + at);
  g.gain.setTargetAtTime(0, t + at + (env.hold ?? 0), env.tau);
  return g;
}

function osc(e: Engine, w: Wave, t: number, stop: number, f0: number, f1?: number, glide = 0.05): OscillatorNode {
  const o = e.ctx.createOscillator();
  e.wave(o, w);
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== undefined) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  o.start(t);
  o.stop(stop);
  return o;
}

function filt(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = clampF(ctx, f);
  b.Q.value = q;
  return b;
}

/** Chain nodes, wire the tail to dest, and disconnect everything when `src` ends. */
function wire(src: AudioScheduledSourceNode, dest: AudioNode, ...chain: AudioNode[]): void {
  let n: AudioNode = src;
  for (const c of chain) { n.connect(c); n = c; }
  n.connect(dest);
  src.onended = () => { src.disconnect(); for (const c of chain) c.disconnect(); };
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

function metal(e: Engine, dest: AudioNode, t: number, g: number, tau: number, tune: number, bp = 9000): void {
  const ctx = e.ctx;
  const sum = envGain(ctx, t, { g, tau });
  const hp = filt(ctx, 'highpass', 6500);
  const band = filt(ctx, 'bandpass', bp * tune, 0.8);
  const stop = t + tau * 6 + 0.02;
  for (const f of METAL) {
    const o = osc(e, 'square', t, stop, f * tune * 1.4);
    o.connect(band);
    o.onended = () => o.disconnect();
  }
  band.connect(hp).connect(sum).connect(dest);
  setTimeoutSafe(e, stop, () => { band.disconnect(); hp.disconnect(); sum.disconnect(); });
}

/** Disconnect helper for node groups without a natural `ended` event: uses a silent source. */
function setTimeoutSafe(e: Engine, at: number, fn: () => void): void {
  const s = e.ctx.createConstantSource ? e.ctx.createConstantSource() : null;
  if (!s) return;
  s.offset.value = 0;
  s.onended = () => { s.disconnect(); fn(); };
  s.start(at);
  s.stop(at + 0.01);
}

export function playDrum(e: Engine, p: DrumPatch, dest: AudioNode, t: number, vel: number): void {
  const ctx = e.ctx;
  const T = p.tune ?? 1;
  const Dm = p.decay ?? 1;
  const g = p.gain * vel;
  switch (p.voice) {
    case 'kick': {
      const o = osc(e, 'sine', t, t + 0.7 * Dm, 165 * T, 46 * T, 0.085);
      wire(o, dest, envGain(ctx, t, { g, tau: 0.11 * Dm, hold: 0.025, attack: 0.002 }));
      const n = e.noise(t, 0.03);
      wire(n, dest, filt(ctx, 'highpass', 2800), envGain(ctx, t, { g: g * 0.28, tau: 0.004 }));
      break;
    }
    case 'bassDrum': {
      const o = osc(e, 'sine', t, t + 1.1 * Dm, 96 * T, 52 * T, 0.14);
      wire(o, dest, envGain(ctx, t, { g, tau: 0.2 * Dm, hold: 0.02, attack: 0.003 }));
      const n = e.noise(t, 0.25);
      wire(n, dest, filt(ctx, 'lowpass', 500), envGain(ctx, t, { g: g * 0.4, tau: 0.05 * Dm }));
      break;
    }
    case 'chipKick': {
      const o = osc(e, 'triangle', t, t + 0.35 * Dm, 240 * T, 48 * T, 0.06);
      wire(o, dest, envGain(ctx, t, { g, tau: 0.07 * Dm, hold: 0.02 }));
      const q = osc(e, 'square', t, t + 0.06, 130 * T, 45 * T, 0.03);
      wire(q, dest, filt(ctx, 'lowpass', 900), envGain(ctx, t, { g: g * 0.22, tau: 0.012 }));
      break;
    }
    case 'snare': {
      const n = e.noise(t, 0.5 * Dm);
      wire(n, dest, filt(ctx, 'bandpass', 2100 * T, 0.6), envGain(ctx, t, { g, tau: 0.065 * Dm, hold: 0.005 }));
      const s = e.noise(t, 0.3 * Dm);
      wire(s, dest, filt(ctx, 'highpass', 5500), envGain(ctx, t, { g: g * 0.45, tau: 0.045 * Dm }));
      const o = osc(e, 'triangle', t, t + 0.2, 215 * T, 165 * T, 0.04);
      wire(o, dest, envGain(ctx, t, { g: g * 0.9, tau: 0.04 }));
      break;
    }
    case 'chipSnare': {
      const n = e.noise(t, 0.25 * Dm);
      wire(n, dest, filt(ctx, 'highpass', 1700 * T), envGain(ctx, t, { g, tau: 0.05 * Dm }));
      const o = osc(e, 'square', t, t + 0.08, 270 * T, 120 * T, 0.035);
      wire(o, dest, filt(ctx, 'lowpass', 2500), envGain(ctx, t, { g: g * 0.35, tau: 0.02 }));
      break;
    }
    case 'clap': {
      const n = e.noise(t, 0.5 * Dm);
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(0, t);
      for (const dt of [0, 0.011, 0.022]) {
        eg.gain.setValueAtTime(g, t + dt);
        eg.gain.setTargetAtTime(g * 0.1, t + dt + 0.001, 0.004);
      }
      eg.gain.setValueAtTime(g * 0.9, t + 0.031);
      eg.gain.setTargetAtTime(0, t + 0.032, 0.055 * Dm);
      wire(n, dest, filt(ctx, 'bandpass', 1250 * T, 1.4), eg);
      break;
    }
    case 'hat': {
      const n = e.noise(t, 0.12 * Dm);
      wire(n, dest, filt(ctx, 'highpass', 7200 * T), filt(ctx, 'peaking', 10000, 1), envGain(ctx, t, { g, tau: 0.014 * Dm }));
      break;
    }
    case 'openHat': {
      const n = e.noise(t, 0.6 * Dm);
      wire(n, dest, filt(ctx, 'highpass', 6800 * T), envGain(ctx, t, { g, tau: 0.09 * Dm }));
      metal(e, dest, t, g * 0.5, 0.08 * Dm, T);
      break;
    }
    case 'ride': {
      metal(e, dest, t, g, 0.32 * Dm, T, 8000);
      const n = e.noise(t, 1.2 * Dm);
      wire(n, dest, filt(ctx, 'highpass', 8500), envGain(ctx, t, { g: g * 0.6, tau: 0.25 * Dm }));
      break;
    }
    case 'crash': {
      const n = e.noise(t, 2.6 * Dm);
      wire(n, dest, filt(ctx, 'highpass', 3800 * T), envGain(ctx, t, { g, tau: 0.5 * Dm, attack: 0.002 }));
      metal(e, dest, t, g * 0.5, 0.45 * Dm, T * 0.9, 7000);
      break;
    }
    case 'tomHi': case 'tomMid': case 'tomLo': {
      const base = p.voice === 'tomHi' ? 250 : p.voice === 'tomMid' ? 175 : 122;
      const o = osc(e, 'sine', t, t + 0.6 * Dm, base * 1.25 * T, base * 0.85 * T, 0.16);
      wire(o, dest, envGain(ctx, t, { g, tau: 0.13 * Dm, hold: 0.01 }));
      const n = e.noise(t, 0.05);
      wire(n, dest, filt(ctx, 'bandpass', 1600, 1), envGain(ctx, t, { g: g * 0.25, tau: 0.01 }));
      break;
    }
    case 'rim': {
      const o = osc(e, 'triangle', t, t + 0.06, 1750 * T);
      wire(o, dest, envGain(ctx, t, { g, tau: 0.008 * Dm }));
      const n = e.noise(t, 0.04);
      wire(n, dest, filt(ctx, 'bandpass', 4200 * T, 2), envGain(ctx, t, { g: g * 0.8, tau: 0.006 }));
      break;
    }
    case 'shaker': {
      const n = e.noise(t, 0.15 * Dm);
      wire(n, dest, filt(ctx, 'highpass', 5200 * T), envGain(ctx, t, { g, tau: 0.022 * Dm, attack: 0.012 }));
      break;
    }
    case 'wood': {
      const o = osc(e, 'sine', t, t + 0.15, 1080 * T, 1000 * T, 0.02);
      wire(o, dest, envGain(ctx, t, { g, tau: 0.022 * Dm }));
      const o2 = osc(e, 'sine', t, t + 0.1, 1620 * T);
      wire(o2, dest, envGain(ctx, t, { g: g * 0.4, tau: 0.012 * Dm }));
      break;
    }
    case 'conga': {
      const o = osc(e, 'sine', t, t + 0.5 * Dm, 330 * T, 275 * T, 0.05);
      wire(o, dest, envGain(ctx, t, { g, tau: 0.09 * Dm, hold: 0.005 }));
      const n = e.noise(t, 0.04);
      wire(n, dest, filt(ctx, 'bandpass', 2200, 1.2), envGain(ctx, t, { g: g * 0.3, tau: 0.006 }));
      break;
    }
    case 'glitch': {
      const chirps = 2 + Math.floor(e.rand() * 3);
      for (let i = 0; i < chirps; i++) {
        const ts = t + i * 0.017;
        const f = 300 * Math.pow(2, e.rand() * 3.6);
        const o = osc(e, e.rand() < 0.5 ? 'square' : 'pulse12', ts, ts + 0.016, f);
        o.frequency.setValueAtTime(f * (e.rand() < 0.5 ? 1.5 : 0.5), ts + 0.008);
        wire(o, dest, envGain(ctx, ts, { g: g * (1 - i * 0.2), tau: 0.02 }));
      }
      break;
    }
  }
}
