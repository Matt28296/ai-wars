// Portrait kit: a shared 3/4-view head (facing viewer's right) on a 100×100 canvas,
// with mood-driven brows, eyes and mouth. Characters layer hair, clothes and gear on top.
import type { ReactNode } from 'react';
import type { Mood } from '../../content/types';
import { p, ps } from '../geom';
import { FACE_INK, MOUTH_DARK, SCLERA, TEETH, type Ramp } from '../palette';

export type { Mood };

/** Filled polygon from a points string. */
export function F({ d, c, o, k }: { d: string; c: string; o?: number; k?: string | number }) {
  return <path key={k} d={ps(d)} style={{ fill: c }} opacity={o} />;
}
/** Raw path. */
export function R({ d, c, o, rule }: { d: string; c: string; o?: number; rule?: 'evenodd' }) {
  return <path d={d} style={{ fill: c }} opacity={o} fillRule={rule} />;
}
/** Open stroke from a points string. */
export function L({ d, c, w = 1, o, cap = 'round' }: { d: string; c: string; w?: number; o?: number; cap?: 'round' | 'butt' | 'square' }) {
  return <path d={polyline(d)} style={{ fill: 'none', stroke: c, strokeWidth: w, strokeLinecap: cap, strokeLinejoin: 'round' }} opacity={o} />;
}

/** "x,y x,y M x,y x,y" → open path. */
export function polyline(d: string): string {
  let s = '';
  for (const part of d.split('M')) {
    const n = part.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    for (let i = 0; i < n.length; i += 2) s += (i === 0 ? 'M' : 'L') + n[i] + ' ' + n[i + 1];
  }
  return s;
}

export interface FaceStyle {
  skin: Ramp;
  brow: string;
  iris: string;
  /** brow thickness */
  browW?: number;
  /** heavier upper lash line + outer flick */
  lashes?: boolean;
  /** 0 restrained … 2 big and loud */
  expressive?: 0 | 1 | 2;
  /** 0 young, 1 lines, 2 deep lines */
  age?: 0 | 1 | 2;
  /** extra laugh lines (Maru) */
  laughLines?: boolean;
  /** draw happy as closed ^ eyes */
  closedHappy?: boolean;
  /** face outline */
  jaw?: Jaw;
  /** override mouth lip line colour */
  lip?: string;
  /** hide the far eye (e.g. covered by gear) */
  hideFarEye?: boolean;
  /** hide brows entirely (visor characters draw their own) */
  noBrows?: boolean;
  /** vertical offset of features */
  dy?: number;
  /** narrower eyes */
  eyeH?: number;
}

export type Jaw = 'young' | 'soft' | 'narrow' | 'square' | 'gaunt' | 'broad';

// Face outlines, 3/4 view looking right. The far (right) edge carries the profile.
export const JAWS: Record<Jaw, { face: string; shade: string; light: string }> = {
  young: {
    face: '35,22 32.5,31 32,44 34.5,52.5 40.5,59.5 47.5,63.8 54.5,65 59.5,62.6 63.8,57 66.2,50 67.6,45 67.8,39.5 66.6,31 63.5,22.5 56,18 43,18',
    shade: '62.5,30 66.6,31 67.8,39.5 67.6,45 66.2,50 63.8,57 59.5,62.6 54.5,65 50,64.6 56.5,61.2 60.6,55.6 62.7,49.2 63.2,43.2 62.7,37',
    light: '37.6,47.4 43.4,46.2 44.6,48.4 39.6,50.6',
  },
  soft: {
    face: '35.5,22 33,31 32.6,43.5 35,51.5 40.5,58.5 47.5,63 54,64.4 59,62 63,56.5 65.6,50 67,45 67.2,39.5 66.2,31 63.5,22.5 56,18 43,18',
    shade: '62.5,30 66.2,31 67.2,39.5 67,45 65.6,50 63,56.5 59,62 54,64.4 50,64 56,60.6 60,55.2 62.2,49 62.8,43.2 62.5,37',
    light: '37.6,47.4 43.4,46.2 44.6,48.4 39.6,50.6',
  },
  narrow: {
    face: '36,22 33.6,31 33.2,43.5 35.4,51.5 41,59 48,64.5 54.5,66 58.6,63.4 62.4,57.6 65,50.5 66.4,45 66.6,39.5 65.8,31 63,22.5 56,18 43.5,18',
    shade: '62,30 65.8,31 66.6,39.5 66.4,45 65,50.5 62.4,57.6 58.6,63.4 54.5,66 50.5,65.4 56,61.6 59.4,56 61.6,49.4 62.2,43.4 61.9,37',
    light: '37.6,47.4 43.4,46.2 44.6,48.4 39.6,50.6',
  },
  square: {
    face: '34.5,22 32,31 31.6,44.5 33.6,53.5 39,60.5 46.5,64.8 55,65.6 60.5,63.6 64.5,58.4 66.8,51 68,45.5 68.2,39.5 67,31 64,22.5 56,18 43,18',
    shade: '63,30 67,31 68.2,39.5 68,45.5 66.8,51 64.5,58.4 60.5,63.6 55,65.6 51,65.2 57.4,61.6 61.4,56.2 63.4,49.6 63.6,43.4 63.1,37',
    light: '37.6,47.4 43.4,46.2 44.6,48.4 39.6,50.6',
  },
  gaunt: {
    face: '35.5,22 33,31 32.8,43 34.5,50 39.5,57.5 47,63.4 54.5,65.2 59,62.8 62.6,57.4 64.8,51 66.8,45.5 67.2,39.5 66.2,31 63.5,22.5 56,18 43,18',
    shade: '62.5,30 66.2,31 67.2,39.5 66.8,45.5 64.8,51 62.6,57.4 59,62.8 54.5,65.2 50.5,64.8 56,61 59.4,55.6 61.4,50 62.6,45.4 62.6,37',
    light: '37.6,47.4 43.4,46.2 44.6,48.4 39.6,50.6',
  },
  broad: {
    face: '34.5,22 31.8,31 31.4,44 33.6,52.5 39.5,59.5 47,63.8 54.5,64.8 60,62.6 64.4,57.4 66.8,50.5 68.2,45 68.4,39.5 67.2,31 64,22.5 56,18 43,18',
    shade: '63,30 67.2,31 68.4,39.5 68.2,45 66.8,50.5 64.4,57.4 60,62.6 54.5,64.8 50.5,64.4 57,60.6 61,55.4 63.2,49.2 63.6,43.2 63.2,37',
    light: '37.6,47.4 43.4,46.2 44.6,48.4 39.6,50.6',
  },
};

// Feature anchors.
const NEAR = { cx: 45, cy: 43, w: 10.4, h: 5.2 };
const FAR = { cx: 61.4, cy: 42.6, w: 7.6, h: 4.8 };

type Lid = { to: number; ti: number; bo: number; bi: number; iris: number; look: number };
const LIDS: Record<Mood, Lid> = {
  neutral: { to: 1, ti: 1, bo: 0.78, bi: 0.78, iris: 1, look: 0.16 },
  happy: { to: 1.02, ti: 1, bo: 0.22, bi: 0.34, iris: 1, look: 0.12 },
  angry: { to: 0.62, ti: 0.02, bo: 0.62, bi: 0.6, iris: 0.92, look: 0.12 },
  grim: { to: 0.4, ti: 0.36, bo: 0.66, bi: 0.66, iris: 1, look: 0.1 },
  surprised: { to: 1.5, ti: 1.45, bo: 1.18, bi: 1.15, iris: 0.8, look: 0.06 },
  smug: { to: 0.36, ti: 0.42, bo: 0.42, bi: 0.46, iris: 1, look: 0.26 },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function Eye({ e, inner, mood, st, uid }: { e: typeof NEAR; inner: 1 | -1; mood: Mood; st: FaceStyle; uid: string }) {
  const lid = LIDS[mood];
  const a = e.w / 2;
  const b = (e.h / 2) * (st.eyeH ?? 1);
  const cy = e.cy + (st.dy ?? 0);
  const cx = e.cx;
  const lashC = st.lashes ? FACE_INK : st.skin.deep;
  const lashW = st.lashes ? 1.7 : 1.35;
  if (mood === 'happy' && st.closedHappy) {
    // ^ shaped closed eye
    const o = cx - inner * a, i = cx + inner * a;
    return (
      <g>
        <L d={`${o},${cy + 1.2} ${cx - inner * a * 0.3},${cy - b * 0.7} ${cx + inner * a * 0.4},${cy - b * 0.6} ${i},${cy + 0.8}`} c={FACE_INK} w={lashW + 0.2} />
        <L d={`${o + inner * 1.5},${cy + 2.6} ${cx},${cy + 2.2} ${i - inner * 1.5},${cy + 2.4}`} c={st.skin.shade} w={0.7} />
      </g>
    );
  }
  const outerC = [cx - inner * a, cy + 0.35];
  const innerC = [cx + inner * a, cy];
  const tO = [cx - inner * a * 0.5, cy - b * lid.to];
  const tI = [cx + inner * a * 0.45, cy - b * lid.ti];
  const bI = [cx + inner * a * 0.48, cy + b * lid.bi];
  const bO = [cx - inner * a * 0.5, cy + b * lid.bo];
  const shape = [outerC, tO, tI, innerC, bI, bO].map((q) => q.map(r2).join(',')).join(' ');
  const ir = b * 1.12 * lid.iris;
  const ix = cx + a * lid.look; // looking to the viewer's right
  const iy = cy + 0.15;
  const id = `${uid}-eye${inner}`;
  const top = `${outerC.join(',')} ${tO.join(',')} ${tI.join(',')} ${innerC.join(',')}`;
  return (
    <g>
      <clipPath id={id}><path d={p(shape)} /></clipPath>
      <path d={p(shape)} style={{ fill: SCLERA }} />
      <g clipPath={`url(#${id})`}>
        <path d={p(`${ix - ir * 0.62},${iy - ir} ${ix + ir * 0.62},${iy - ir} ${ix + ir * 0.95},${iy} ${ix + ir * 0.62},${iy + ir} ${ix - ir * 0.62},${iy + ir} ${ix - ir * 0.95},${iy}`)} style={{ fill: st.iris }} />
        <path d={p(`${ix - ir * 0.35},${iy - ir * 0.62} ${ix + ir * 0.35},${iy - ir * 0.62} ${ix + ir * 0.5},${iy} ${ix + ir * 0.35},${iy + ir * 0.62} ${ix - ir * 0.35},${iy + ir * 0.62} ${ix - ir * 0.5},${iy}`)} style={{ fill: FACE_INK }} />
        <path d={p(`${ix + ir * 0.12},${iy - ir * 0.7} ${ix + ir * 0.52},${iy - ir * 0.7} ${ix + ir * 0.52},${iy - ir * 0.3} ${ix + ir * 0.12},${iy - ir * 0.3}`)} style={{ fill: '#ffffff' }} />
        {/* upper-lid shadow on the eyeball */}
        <path d={p(`${outerC.join(',')} ${tO.join(',')} ${tI.join(',')} ${innerC.join(',')} ${innerC[0]},${innerC[1] - b * 0.1} ${tI[0]},${tI[1] + b * 0.45} ${tO[0]},${tO[1] + b * 0.45}`)} style={{ fill: st.skin.deep }} opacity={0.35} />
      </g>
      <L d={top} c={lashC} w={lashW} />
      {st.lashes && <L d={`${outerC[0]},${outerC[1]} ${outerC[0] - inner * 1.6},${outerC[1] - 1.3}`} c={FACE_INK} w={1.4} />}
      <L d={`${bO.join(',')} ${bI.join(',')}`} c={st.skin.deep} w={0.6} o={0.8} />
      {mood === 'surprised' && <L d={`${tO[0]},${tO[1] - 1.4} ${tI[0]},${tI[1] - 1.3}`} c={st.skin.shade} w={0.6} />}
      {(mood === 'grim' || (st.age ?? 0) > 1) && <L d={`${cx - inner * a * 0.4},${cy + b * 1.7} ${cx + inner * a * 0.45},${cy + b * 1.55}`} c={st.skin.shade} w={0.7} />}
    </g>
  );
}

type BrowPose = { i: number; o: number; arch: number };
const BROWS: Record<Mood, [BrowPose, BrowPose]> = {
  // [near, far]; i = inner-end dy, o = outer-end dy (negative = up)
  neutral: [{ i: 0, o: 0, arch: 0.6 }, { i: 0, o: 0, arch: 0.6 }],
  happy: [{ i: -1.6, o: -0.8, arch: 1.4 }, { i: -1.6, o: -0.8, arch: 1.4 }],
  angry: [{ i: 3.2, o: -1, arch: -0.4 }, { i: 3.2, o: -1, arch: -0.4 }],
  grim: [{ i: 1.5, o: 0.9, arch: -0.2 }, { i: 1.5, o: 0.9, arch: -0.2 }],
  surprised: [{ i: -4.2, o: -2.6, arch: 1.8 }, { i: -4.2, o: -2.6, arch: 1.8 }],
  smug: [{ i: 0.9, o: 0.7, arch: 0.3 }, { i: -2.6, o: -2.2, arch: 1.6 }],
};

function Brow({ near, mood, st }: { near: boolean; mood: Mood; st: FaceStyle }) {
  const pose = BROWS[mood][near ? 0 : 1];
  const w = (st.browW ?? 2) * (mood === 'angry' ? 1.15 : 1);
  const dy = st.dy ?? 0;
  // outer → inner
  const o = near ? [38.6, 37.8] : [66.6, 37.4];
  const i = near ? [50.8, 36.6] : [57.6, 36.4];
  const oy = o[1] + pose.o + dy, iy = i[1] + pose.i + dy;
  const mx = (o[0] + i[0]) / 2, my = (oy + iy) / 2 - pose.arch;
  const wi = w * 1.05, wo = w * 0.62;
  const d = `${o[0]},${oy - wo / 2} ${mx},${my - w / 2} ${i[0]},${iy - wi / 2} ${i[0] + (near ? 0.5 : -0.5)},${iy + wi / 2} ${mx},${my + w / 2} ${o[0]},${oy + wo / 2}`;
  return <F d={d} c={st.brow} />;
}

function Mouth({ mood, st }: { mood: Mood; st: FaceStyle }) {
  const ex = st.expressive ?? 1;
  const dy = st.dy ?? 0;
  const lip = st.lip ?? st.skin.deep;
  const y = 57.6 + dy;
  const sh = st.skin.shade;
  const lowerLip = <L d={`${53.4},${y + 2.5} ${58.2},${y + 2.3}`} c={sh} w={1.1} o={0.9} />;
  switch (mood) {
    case 'neutral':
      return <g><L d={`50.8,${y + 0.2} 56,${y - 0.2} 60.6,${y + 0.1}`} c={lip} w={1.3} />{lowerLip}</g>;
    case 'grim':
      return <g><L d={`50.4,${y + 1.3} 52.4,${y + 0.2} 59,${y + 0.1} 61,${y + 1.2}`} c={lip} w={1.35} />{lowerLip}</g>;
    case 'smug':
      return (
        <g>
          <L d={`51.2,${y + 0.4} 56,${y + 0.5} 60.4,${y - 1} 61.8,${y - 2.1}`} c={lip} w={1.35} />
          <L d={`62.2,${y - 3.4} 62.6,${y - 0.8}`} c={sh} w={0.8} />
          {lowerLip}
        </g>
      );
    case 'happy':
      if (ex === 0) return <g><L d={`50.6,${y - 0.8} 53,${y + 0.6} 58.6,${y + 0.5} 61.2,${y - 1.1}`} c={lip} w={1.3} />{lowerLip}</g>;
      if (ex === 1)
        return (
          <g>
            <F d={`50.2,${y - 1} 56,${y - 0.4} 61.6,${y - 1.4} 59.6,${y + 2.4} 56,${y + 3.4} 52.4,${y + 2.2}`} c={MOUTH_DARK} />
            <F d={`51.2,${y - 0.7} 56,${y - 0.2} 60.8,${y - 1.1} 60.2,${y + 0.4} 51.8,${y + 0.6}`} c={TEETH} />
            <L d={`50.2,${y - 1} 56,${y - 0.4} 61.6,${y - 1.4}`} c={lip} w={1} />
          </g>
        );
      return (
        <g>
          <F d={`48.8,${y - 1.8} 56,${y - 1} 63,${y - 2.6} 61,${y + 3} 56.2,${y + 5} 51.4,${y + 3.2}`} c={MOUTH_DARK} />
          <F d={`52.4,${y + 3} 56.2,${y + 1.6} 60,${y + 2.8} 56.2,${y + 4.8}`} c="#b5474c" />
          <F d={`49.8,${y - 1.5} 56,${y - 0.8} 62.2,${y - 2.2} 61.6,${y + 0.2} 50.6,${y + 0.5}`} c={TEETH} />
          <L d={`48.8,${y - 1.8} 56,${y - 1} 63,${y - 2.6}`} c={lip} w={1} />
          <L d={`47.8,${y - 3.4} 48.6,${y - 1.2}`} c={sh} w={0.8} />
          <L d={`63.6,${y - 4.2} 63.4,${y - 2}`} c={sh} w={0.8} />
        </g>
      );
    case 'angry':
      if (ex === 2)
        return (
          <g>
            <F d={`49.6,${y - 0.6} 56,${y - 1.2} 62,${y - 0.4} 61,${y + 4} 56,${y + 5.2} 51,${y + 4.2}`} c={MOUTH_DARK} />
            <F d={`50.4,${y - 0.4} 56,${y - 0.9} 61.2,${y - 0.2} 60.8,${y + 1} 50.8,${y + 1.2}`} c={TEETH} />
            <F d={`51.6,${y + 3.6} 60.2,${y + 3.4} 59.6,${y + 4.4} 52.2,${y + 4.4}`} c={TEETH} />
            <L d={`49.6,${y - 0.6} 56,${y - 1.2} 62,${y - 0.4}`} c={lip} w={1} />
          </g>
        );
      return (
        <g>
          <F d={`50.8,${y - 0.2} 56,${y - 0.6} 61,${y - 0.1} 60.6,${y + 2.2} 51.2,${y + 2.4}`} c={TEETH} />
          <L d={`50.8,${y + 1.1} 60.8,${y + 1}`} c={st.skin.deep} w={0.5} />
          <L d={`50.4,${y + 0.6} 50.8,${y - 0.2} 56,${y - 0.6} 61,${y - 0.1} 61.6,${y + 0.8}`} c={lip} w={1.1} />
          <L d={`50.8,${y + 2.6} 60.6,${y + 2.4}`} c={lip} w={0.9} />
        </g>
      );
    case 'surprised': {
      const s = ex === 0 ? 0.7 : ex === 1 ? 0.9 : 1.15;
      const cy = y + 1.6;
      return (
        <g>
          <F d={`${56 - 2.2 * s},${cy - 2.6 * s} ${56 + 2.2 * s},${cy - 2.6 * s} ${56 + 3.2 * s},${cy} ${56 + 2.2 * s},${cy + 3 * s} ${56 - 2.2 * s},${cy + 3 * s} ${56 - 3.2 * s},${cy}`} c={MOUTH_DARK} />
          <F d={`${56 - 1.8 * s},${cy - 2.3 * s} ${56 + 1.8 * s},${cy - 2.3 * s} ${56 + 2.2 * s},${cy - 1.3 * s} ${56 - 2.2 * s},${cy - 1.3 * s}`} c={TEETH} />
        </g>
      );
    }
  }
}

function Nose({ st }: { st: FaceStyle }) {
  const dy = st.dy ?? 0;
  const y = (n: number) => n + dy;
  return (
    <g>
      <F d={`55.4,${y(41)} 59.8,${y(50.4)} 58.2,${y(52.4)} 54.6,${y(52.2)} 53.4,${y(50.8)} 55.2,${y(49.6)}`} c={st.skin.shade} />
      <F d={`56.6,${y(42)} 59.4,${y(49)} 58.6,${y(49.6)} 56,${y(43.6)}`} c={st.skin.light} />
      <L d={`55,${y(51.6)} 56.6,${y(51.2)}`} c={st.skin.deep} w={0.9} />
    </g>
  );
}

function AgeLines({ st, mood }: { st: FaceStyle; mood: Mood }) {
  const age = st.age ?? 0;
  const dy = st.dy ?? 0;
  const c = st.skin.shade;
  const out: ReactNode[] = [];
  if (age >= 1 || st.laughLines) {
    // nasolabial folds
    out.push(<L key="nl" d={`53.2,${51.4 + dy} 50.4,${55.6 + dy} 49.6,${59 + dy}`} c={c} w={0.9} />);
    out.push(<L key="nr" d={`60.8,${51.6 + dy} 62.4,${55 + dy}`} c={c} w={0.8} />);
  }
  if (age >= 1) {
    out.push(<L key="cf" d={`37.4,${42.4 + dy} 35.2,${41.4 + dy}`} c={c} w={0.8} />);
    out.push(<L key="cf2" d={`37.6,${44.6 + dy} 35.4,${45.4 + dy}`} c={c} w={0.8} />);
  }
  if (age >= 2) {
    out.push(<L key="fh" d={`41,${31.5 + dy} 50,${31 + dy}`} c={c} w={0.7} />);
    out.push(<L key="fh2" d={`55,${31 + dy} 62,${31.6 + dy}`} c={c} w={0.7} />);
    out.push(<L key="jw" d={`45,${61.2 + dy} 50,${63.2 + dy}`} c={c} w={0.7} />);
  }
  if (st.laughLines) {
    out.push(<L key="ll" d={`48.4,${53 + dy} 47.2,${57 + dy} 48.2,${60.6 + dy}`} c={st.skin.deep} w={0.9} />);
    out.push(<L key="ll2" d={`62.6,${53.2 + dy} 63.6,${57 + dy}`} c={st.skin.deep} w={0.8} />);
    out.push(<L key="cf3" d={`37.2,${43.6 + dy} 34.4,${43.6 + dy}`} c={c} w={0.8} />);
  }
  if (mood === 'angry') {
    out.push(<L key="fr" d={`52.4,${37.6 + dy} 53,${40.4 + dy}`} c={c} w={0.8} />);
    out.push(<L key="fr2" d={`55.6,${37.4 + dy} 55.4,${40.2 + dy}`} c={c} w={0.8} />);
  }
  return <g>{out}</g>;
}

/** The ear on the near (left) side. */
export function Ear({ skin, x = 0, y = 0 }: { skin: Ramp; x?: number; y?: number }) {
  return (
    <g transform={x || y ? `translate(${x} ${y})` : undefined}>
      <F d="31,40.5 33.4,38.6 36.4,40.4 36.6,50 33.4,51.6 30.6,47.6" c={skin.base} />
      <F d="32.4,41.8 34.6,41.2 34.8,47.8 33.2,48.8 32,46.6" c={skin.shade} />
      <F d="31,40.5 33.4,38.6 34.2,39.2 31.8,41.4" c={skin.light} />
    </g>
  );
}

/** Neck, drawn before the clothes collar. */
export function Neck({ skin, w = 0 }: { skin: Ramp; w?: number }) {
  return (
    <g>
      <F d={`${42 - w},54 ${41.4 - w},76 52,81 ${61.4 + w},76 ${61 + w},58`} c={skin.base} />
      <F d={`${42 - w},54 ${61 + w},58 ${61 + w},65.5 52,69 ${42 - w},63.5`} c={skin.shade} />
      <F d={`${41.4 - w},66 ${44 - w},67 ${44 - w},77 ${41.4 - w},76`} c={skin.shade} o={0.7} />
    </g>
  );
}

/** Head skin + features. */
export function Face({ st, mood, uid, extra }: { st: FaceStyle; mood: Mood; uid: string; extra?: ReactNode }) {
  const jaw = JAWS[st.jaw ?? 'young'];
  return (
    <g>
      <F d={jaw.face} c={st.skin.base} />
      <F d={jaw.shade} c={st.skin.shade} />
      <F d={jaw.light} c={st.skin.light} o={0.32} />
      <AgeLines st={st} mood={mood} />
      {extra}
      <Nose st={st} />
      <Mouth mood={mood} st={st} />
      <Eye e={NEAR} inner={1} mood={mood} st={st} uid={uid} />
      {!st.hideFarEye && <Eye e={FAR} inner={-1} mood={mood} st={st} uid={uid} />}
      {!st.noBrows && <Brow near mood={mood} st={st} />}
      {!st.noBrows && !st.hideFarEye && <Brow near={false} mood={mood} st={st} />}
    </g>
  );
}

export const BUST = '0,100 1,92 7,84 18,78.5 32,74.5 44,72 60,72 72,74.5 84,79 93,86 98,94 100,100';
