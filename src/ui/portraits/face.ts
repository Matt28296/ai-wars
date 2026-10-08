// The shared human head and the shared expression layer. Eight of the eleven portraits are people; they share one skull construction
// (three-quarter view, facing the viewer's right, eye line at y = 97 before the rim shift) and one face rig, and differ in proportions,
// hair, clothes and gear. That sameness is what keeps the cast one family of drawings. The head is drawn from landmark numbers, so a
// jaw, a chin or a nose is a number rather than a fresh set of curves.
import { FACE } from './palette';
import { box, disc, n, oval, pt, taper } from './geom';
import type { Pt } from './geom';
import type { Mood, ShadedPart } from './types';

// ---------------------------------------------------------------- the head

export interface HeadSpec {
  /** Material key of the skin in the art's tones. */
  skin: string;
  /** Crown of the skull. */
  top?: number;
  /** Back of the skull (leftmost). */
  back?: number;
  /** Far forehead, at the brow. */
  brow?: number;
  /** Nose tip: it breaks the far contour, which is what says the face is turned. */
  noseX?: number;
  noseY?: number;
  /** Upper lip. */
  lip?: number;
  /** Chin point. */
  chinX?: number;
  chinY?: number;
  /** Near jaw corner, under the ear. */
  jawX?: number;
  jawY?: number;
  /** How much of the chin base is flat (bigger is a squarer jaw). */
  jaw?: number;
}

export interface HeadParts {
  neck: ShadedPart;
  head: ShadedPart;
  ear: ShadedPart;
}

export function humanHead(s: HeadSpec): HeadParts {
  const top = s.top ?? 48;
  const back = s.back ?? 78;
  const brow = s.brow ?? 160;
  const nx = s.noseX ?? 165;
  const ny = s.noseY ?? 116;
  const lip = s.lip ?? 158;
  const chinX = s.chinX ?? 148;
  const chinY = s.chinY ?? 151;
  const jawX = s.jawX ?? 92;
  const jawY = s.jawY ?? 138;
  const jaw = s.jaw ?? 26;
  const d =
    `M${back} 92C${back - 1} 68 97 ${top + 1} 121 ${top}` +
    `C145 ${top - 1} ${brow - 2} 64 ${brow} 86` +
    `C${brow + 1} 93 ${brow - 1} 98 ${brow - 2} 102` +
    `C${nx - 7} 106 ${nx - 2} 110 ${nx} ${ny}` +
    `C${nx - 1} ${ny + 3} ${nx - 6} ${ny + 5} ${lip - 1} ${ny + 6}` +
    `C${lip + 1} ${ny + 10} ${lip + 1} ${ny + 14} ${lip - 1} ${ny + 17}` +
    `C${lip} ${ny + 20} ${lip - 1} ${ny + 22} ${lip - 2} ${ny + 24}` +
    `C${lip - 2} ${ny + 29} ${chinX + 5} ${chinY - 8} ${chinX} ${chinY}` +
    `C${chinX - 3} ${chinY + 4} ${chinX - 10} ${chinY + 7} ${chinX - jaw} ${chinY + 3}` +
    `C${chinX - jaw - 16} ${chinY} ${jawX + 14} ${jawY + 6} ${jawX} ${jawY - 4}` +
    `C${jawX - 6} ${jawY - 14} ${back + 2} 118 ${back} 92Z`;

  // The terminator: one hard edge down the far side of the face (the viewer's right is in shade), kept a few px inside the contour, so the far
  // cheek, the nose's far plane and the jaw are dark and the eyes, brow and mouth stay in the light.
  const shade =
    `M${brow - 9} ${top - 2}C${brow - 8} 66 ${brow - 5} 82 ${brow - 5} 98L${nx - 10} 104L${nx - 4} ${ny - 3}L${nx - 8} ${ny + 5}` +
    `L${lip - 4} ${ny + 8}C${lip - 6} ${ny + 14} ${lip - 7} ${ny + 20} ${lip - 5} ${ny + 25}` +
    `C${chinX - 4} ${chinY - 5} ${chinX - 10} ${chinY + 3} ${chinX - 18} ${chinY + 11}L190 200V40Z`;
  const light = `M86 70C92 56 108 50 128 51C114 58 104 72 100 90C94 84 87 80 86 70Z`;

  const head: ShadedPart = { d, m: s.skin, s: shade, l: light };

  const neck: ShadedPart = {
    d: `M${jawX + 4} ${jawY - 10}C${jawX + 5} 154 ${jawX + 3} 172 ${jawX - 2} 180H158C150 172 146 152 148 134Z`,
    m: s.skin,
    // the head's shadow on the neck, a hard band under the jaw, and the far side of the neck in shade
    s: `M80 ${jawY - 6}L80 ${jawY + 6}C100 ${chinY + 14} 130 ${chinY + 18} ${chinX + 8} ${chinY + 6}L${chinX + 8} 120Z` + `M138 130C140 160 140 180 142 200H200V130Z`,
  };

  const ear: ShadedPart = {
    d: `M${jawX} ${jawY - 44}C${jawX - 9} ${jawY - 47} ${jawX - 13} ${jawY - 38} ${jawX - 10} ${jawY - 28}C${jawX - 8} ${jawY - 20} ${jawX - 2} ${jawY - 16} ${jawX + 4} ${jawY - 18}L${jawX + 6} ${jawY - 42}Z`,
    m: s.skin,
    s: `M${jawX - 2} ${jawY - 40}C${jawX - 6} ${jawY - 34} ${jawX - 4} ${jawY - 26} ${jawX + 1} ${jawY - 24}L${jawX + 8} ${jawY - 24}V${jawY - 44}Z`,
  };
  return { neck, head, ear };
}

// ---------------------------------------------------------------- the expression layer

export interface FaceRig {
  /** Eye line (y of both eye centres in art coordinates). */
  eyeY: number;
  /** The near eye (viewer's left) and the far eye (viewer's right, narrower by foreshortening). */
  near: { x: number; w: number };
  far: { x: number; w: number };
  /** The mouth's centre and width. */
  mouth: { x: number; y: number; w: number };
  iris: string;
  /** Lip colour (the mouth line and the upper lip when open). */
  lip: string;
  /** Brow colour. */
  brow: string;
  /** The skin's shadow tone, for the marks a mood adds (a frown furrow, eye bags, a smirk's dimple). */
  shade: string;
  /** Brow thickness at the inner end. */
  browThick?: number;
  /** Height of the brow line above the eye line. */
  browGap?: number;
  /** A heavier upper lid and a lash flick. */
  lash?: boolean;
  /** How far this face goes toward the full mood (0.6 .. 1.2). Stoic faces use less, but every mood must still read at 96px. */
  k?: number;
  /** Iris radius as a fraction of the eye width. */
  irisR?: number;
  /** This face's own neutral (a practised half-smile, a grin): the other moods are measured from it. */
  base?: Partial<MoodShape>;
}

/** The colours a rig adds to the SVG, for the art's `extra` list. */
export function faceColours(rig: FaceRig): string[] {
  return [FACE.white, FACE.ink, FACE.teeth, FACE.mouthIn, FACE.tongue, rig.iris, rig.lip, rig.brow, rig.shade];
}

export interface MoodShape {
  browUp: number; // both brows, px (negative = raised)
  browInner: number; // inner ends lowered, px (negative = raised, the worried look)
  farBrowUp: number; // extra raise of the far brow only
  nearBrowDown: number;
  open: number; // eye opening
  lower: number; // lower lids pushed up
  pupil: number; // iris size factor
  gaze: number; // iris x offset
  cornerL: number; // mouth corner lift, px (positive = up)
  cornerR: number;
  sag: number; // mouth centre sag, px (positive = U-shaped)
  gap: number; // mouth interior height
  wide: number; // mouth width factor
  tilt: number; // inner eye corners lowered, px (the glare)
  furrow: number; // a frown furrow between the brows (on above 0.5)
  bags: number; // shade under the eyes (on above 0.5)
  dimple: number; // a dimple at the raised corner of a smirk (on above 0.5)
  browScale: number; // brow thickness factor
  lidScale: number; // upper-lid thickness factor (heavy lids read as scorn or fatigue)
}

const SHAPE: Record<Mood, MoodShape> = {
  neutral: { browUp: 0, browInner: 0, farBrowUp: 0, nearBrowDown: 0, open: 1, lower: 0, pupil: 1, gaze: 1.5, cornerL: 0.4, cornerR: 0.4, sag: 0.4, gap: 0, wide: 1, tilt: 0, furrow: 0, bags: 0, dimple: 0, browScale: 1, lidScale: 1 },
  happy: { browUp: -4, browInner: -1.5, farBrowUp: 0, nearBrowDown: 0, open: 0.7, lower: 4.2, pupil: 1, gaze: 1.5, cornerL: 5.5, cornerR: 5.5, sag: 6, gap: 8, wide: 1.32, tilt: -1, furrow: 0, bags: 0, dimple: 0, browScale: 0.95, lidScale: 0.9 },
  angry: { browUp: 3.5, browInner: 11, farBrowUp: 0, nearBrowDown: 0, open: 0.55, lower: 1.8, pupil: 0.9, gaze: 2, cornerL: -3.5, cornerR: -3.5, sag: -3, gap: 8, wide: 1.15, tilt: 4.2, furrow: 1, bags: 0, dimple: 0, browScale: 1.35, lidScale: 1.4 },
  grim: { browUp: 5, browInner: 2.6, farBrowUp: 0, nearBrowDown: 0, open: 0.5, lower: 0.6, pupil: 0.92, gaze: 0.5, cornerL: -6, cornerR: -6, sag: -3.4, gap: 0, wide: 0.86, tilt: 1, furrow: 0, bags: 1, dimple: 0, browScale: 1.2, lidScale: 1.7 },
  surprised: { browUp: -9, browInner: -2, farBrowUp: 0, nearBrowDown: 0, open: 1.5, lower: -1, pupil: 0.74, gaze: 0.5, cornerL: 0, cornerR: 0, sag: 0, gap: 12, wide: 0.55, tilt: -1, furrow: 0, bags: 0, dimple: 0, browScale: 0.85, lidScale: 0.6 },
  smug: { browUp: 0.5, browInner: 1.6, farBrowUp: -8, nearBrowDown: 2, open: 0.52, lower: 1, pupil: 1, gaze: 3.4, cornerL: -1.2, cornerR: 7.5, sag: 2.6, gap: 0, wide: 1.05, tilt: 0, furrow: 0, bags: 0, dimple: 1, browScale: 1, lidScale: 1.8 },
};

/** The mood's shape for a face that goes `k` of the way from neutral to the full mood. */
function shapeFor(mood: Mood, k: number, base?: Partial<MoodShape>): MoodShape {
  const a: MoodShape = { ...SHAPE.neutral, ...base };
  const b = mood === 'neutral' ? a : SHAPE[mood];
  const out = { ...b };
  (Object.keys(a) as (keyof MoodShape)[]).forEach((key) => {
    out[key] = a[key] + (b[key] - a[key]) * k;
  });
  return out;
}

function eyeSvg(id: string, c: Pt, w: number, sh: MoodShape, rig: FaceRig, outerSign: -1 | 1, scale: number): string {
  const open = sh.open;
  const hu = w * 0.3 * open;
  const hl = Math.max(0.6, w * 0.17 * open - sh.lower * 0.55);
  // the inner corner (right for the near eye, left for the far one) drops with the glare, the outer corner lifts a little
  const L = pt(c.x - w / 2, c.y + (outerSign < 0 ? -sh.tilt * 0.4 : sh.tilt));
  const R = pt(c.x + w / 2, c.y + (outerSign < 0 ? sh.tilt : -sh.tilt * 0.4));
  const upCtl = c.y - 2 * hu;
  const loCtl = c.y + 2 * hl;
  const sclera = `M${n(L.x)} ${n(L.y)}Q${n(c.x)} ${n(upCtl)} ${n(R.x)} ${n(R.y)}Q${n(c.x)} ${n(loCtl)} ${n(L.x)} ${n(L.y)}Z`;
  const ir = w * (rig.irisR ?? 0.3) * sh.pupil * scale;
  const ix = c.x + sh.gaze * scale;
  const iy = c.y - hu * 0.15 + 0.4;
  const lidT = (rig.lash ? 3.4 : 2.6) * (0.8 + open * 0.2) * sh.lidScale;
  const lid = `M${n(L.x - 0.6)} ${n(L.y + 0.4)}Q${n(c.x)} ${n(upCtl - 2 * lidT)} ${n(R.x + 0.6)} ${n(R.y + 0.4)}Q${n(c.x)} ${n(upCtl)} ${n(L.x - 0.6)} ${n(L.y + 0.4)}Z`;
  const outer = outerSign < 0 ? L : R;
  const flick = rig.lash
    ? `<path d="M${n(outer.x - outerSign * 1.5)} ${n(outer.y - 1)}L${n(outer.x + outerSign * 4.5)} ${n(outer.y - 3.8)}L${n(outer.x - outerSign * 1)} ${n(outer.y - 3.2)}Z" fill="${FACE.ink}"/>`
    : '';
  return (
    `<clipPath id="${id}"><path d="${sclera}"/></clipPath>` +
    `<path d="${sclera}" fill="${FACE.white}"/>` +
    `<g clip-path="url(#${id})"><path d="${disc(ix, iy, ir)}" fill="${rig.iris}"/><path d="${disc(ix + 0.3, iy + 0.2, ir * 0.52)}" fill="${FACE.ink}"/>` +
    `<path d="${disc(ix - ir * 0.34, iy - ir * 0.36, Math.max(0.9, ir * 0.24))}" fill="${FACE.white}"/></g>` +
    `<path d="${lid}" fill="${FACE.ink}"/>${flick}` +
    (sh.bags > 0.5
      ? `<path d="M${n(L.x + 2)} ${n(c.y + hl + 2.4)}Q${n(c.x)} ${n(c.y + hl + 7)} ${n(R.x - 2)} ${n(c.y + hl + 2.4)}Q${n(c.x)} ${n(c.y + hl + 4.4)} ${n(L.x + 2)} ${n(c.y + hl + 2.4)}Z" fill="${rig.shade}"/>`
      : '')
  );
}

function browSvg(inner: Pt, outer: Pt, arch: number, thick: number, colour: string): string {
  // inner end is the thick end; the stroke arches up by `arch`
  const bend = -arch * Math.sign(outer.x - inner.x);
  return `<path d="${taper(inner, outer, bend, thick, thick * 0.5)}" fill="${colour}"/>`;
}

function mouthSvg(rig: FaceRig, sh: MoodShape): string {
  const m = rig.mouth;
  const hw = (m.w * sh.wide) / 2;
  const L = pt(m.x - hw, m.y - sh.cornerL);
  const R = pt(m.x + hw * 0.86, m.y - sh.cornerR - 0.6);
  const lipT = 3.2;
  if (sh.gap < 1.2) {
    const dimple = sh.dimple > 0.5 ? `<path d="${taper(pt(R.x + 1.2, R.y - 3.4), pt(R.x + 3.4, R.y + 3.2), -1.2, 2, 0.6)}" fill="${rig.shade}"/>` : '';
    return `<path d="${taper(L, R, sh.sag, lipT, lipT * 0.8)}" fill="${rig.lip}"/>${dimple}`;
  }
  const mx = (L.x + R.x) / 2;
  const my = (L.y + R.y) / 2;
  const top = my + sh.sag; // the top edge's middle
  const o = sh.gap;
  let interior: string;
  if (sh.wide < 0.7) {
    // the round "O"
    interior = oval(m.x + 1, m.y + 1.5, hw * 0.78, o * 0.62);
    return (
      `<path d="${oval(m.x + 1, m.y + 1.5, hw * 0.78 + 2.2, o * 0.62 + 2.2)}" fill="${rig.lip}"/>` +
      `<path d="${interior}" fill="${FACE.mouthIn}"/>` +
      `<clipPath id="mo"><path d="${interior}"/></clipPath><g clip-path="url(#mo)"><path d="${oval(m.x + 1, m.y + o * 0.9, hw * 0.6, o * 0.32)}" fill="${FACE.tongue}"/></g>`
    );
  }
  // A quadratic's middle is halfway to its control point, so a middle offset d needs a control offset of 2d.
  const topCtl = my + 2 * sh.sag;
  const botCtl = my + 2 * (sh.sag + o);
  interior = `M${n(L.x)} ${n(L.y)}Q${n(mx)} ${n(topCtl)} ${n(R.x)} ${n(R.y)}Q${n(mx)} ${n(botCtl)} ${n(L.x)} ${n(L.y)}Z`;
  const bandTop = Math.min(L.y, R.y, top) - 3;
  const band = box(L.x - 1, bandTop, R.x - L.x + 2, top + o * 0.5 - bandTop);
  const gritted = sh.sag < -1;
  return (
    `<path d="${interior}" fill="${FACE.mouthIn}"/>` +
    `<clipPath id="mo"><path d="${interior}"/></clipPath>` +
    `<g clip-path="url(#mo)"><path d="${band}" fill="${FACE.teeth}"/>` +
    (gritted ? `<path d="${box(L.x - 1, top + o * 0.3, R.x - L.x + 2, 1.2)}" fill="${FACE.mouthIn}"/>` : `<path d="${oval(mx + 1, top + o * 0.95, hw * 0.55, o * 0.36)}" fill="${FACE.tongue}"/>`) +
    `</g>` +
    `<path d="${taper(L, R, sh.sag, lipT, lipT * 0.8)}" fill="${rig.lip}"/>`
  );
}

/** The six moods of a human face: brows, eyes and mouth. */
export function humanExpression(rig: FaceRig, mood: Mood): string {
  const sh = shapeFor(mood, rig.k ?? 1, rig.base);
  const ey = rig.eyeY;
  const thick = (rig.browThick ?? 4) * sh.browScale;
  const gap = rig.browGap ?? 13;
  const by = ey - gap + sh.browUp;
  const near = pt(rig.near.x, ey);
  const far = pt(rig.far.x, ey);
  // near eye: outer end is on the left; far eye: outer end is on the right
  const nIn = pt(near.x + rig.near.w * 0.5, by + sh.browInner + sh.nearBrowDown);
  const nOut = pt(near.x - rig.near.w * 0.62, by - sh.browInner * 0.18 + sh.nearBrowDown);
  const fIn = pt(far.x - rig.far.w * 0.5, by + sh.browInner + sh.farBrowUp);
  const fOut = pt(far.x + rig.far.w * 0.6, by - sh.browInner * 0.18 + sh.farBrowUp + 1);
  return (
    eyeSvg('en', near, rig.near.w, sh, rig, -1, 1) +
    eyeSvg('ef', far, rig.far.w, sh, rig, 1, 0.85) +
    browSvg(nIn, nOut, 2.2, thick, rig.brow) +
    browSvg(fIn, fOut, 2, thick * 0.9, rig.brow) +
    (sh.furrow > 0.5
      ? `<path d="${taper(pt((nIn.x + fIn.x) / 2 - 1.5, by - 5), pt((nIn.x + fIn.x) / 2 - 1.2, by + 6), 0.4, 2.2, 0.8)}" fill="${rig.shade}"/><path d="${taper(pt((nIn.x + fIn.x) / 2 + 2.5, by - 4), pt((nIn.x + fIn.x) / 2 + 2.2, by + 6), -0.4, 2, 0.8)}" fill="${rig.shade}"/>`
      : '') +
    mouthSvg(rig, sh)
  );
}

/**
 * Age lines in a shade colour: crow's feet at both eyes and the fold from the nose to the corner of the mouth. `n` is how many
 * (1 = a few, 2 = clear, 3 = deep). They are part of the bust, so they do not move with the mood.
 */
export function ageLines(rig: FaceRig, colour: string, level: 1 | 2 | 3, nose: Pt): string {
  const ey = rig.eyeY;
  const out: string[] = [];
  const t = 0.8 + level * 0.2;
  const feet = (x: number, dir: -1 | 1, reach: number): void => {
    const ends = [pt(x + dir * reach, ey - 2.5), pt(x + dir * (reach + 1), ey + 3), pt(x + dir * (reach - 1), ey + 8)];
    ends.slice(0, level === 1 ? 2 : 3).forEach((e) => out.push(`<path d="${taper(pt(x, ey + 1.5), e, 0.6 * dir, t, 0.4)}" fill="${colour}"/>`));
  };
  feet(rig.near.x - rig.near.w / 2 - 1, -1, 7);
  feet(rig.far.x + rig.far.w / 2 + 1, 1, 3.5);
  const m = rig.mouth;
  // the fold from the nose to the corner of the mouth, and (deep) a second under it
  out.push(`<path d="${taper(pt(nose.x - 13, nose.y + 6), pt(m.x - m.w / 2 - 1.5, m.y + 1), -1.6, t + 0.2, 0.4)}" fill="${colour}"/>`);
  if (level >= 3) out.push(`<path d="${taper(pt(m.x - m.w / 2 - 2, m.y + 8), pt(m.x - m.w / 2 + 2, m.y + 15), 1.2, t * 0.8, 0.4)}" fill="${colour}"/>`);
  return out.join('');
}
