// Juno Reyes-Abara, Verdant Compact wing lead, 19, she/her. An undercut with a long braid; a flight headset with a boom mic; a grin.
// Olive flight jacket with a cream fleece collar and a leather harness.
import { faceColours, humanExpression, humanHead } from '../face';
import type { FaceRig } from '../face';
import { leaf, oval, pt, taper } from '../geom';
import { TORSO, TORSO_LIGHT, TORSO_SHADE } from '../shapes';
import type { PortraitArt } from '../types';

const tones = {
  skin: ['#6a3d27', '#955838', '#b97a52'],
  hair: ['#0e0907', '#261811', '#573826'],
  jacket: ['#1d241a', '#313c28', '#4f6140'],
  fleece: ['#b2a789', '#e0d8c0', '#f9f5e6'],
  strap: ['#2f1d12', '#53351f', '#7c5532'],
  gear: ['#141a1f', '#2b343c', '#5a6a77'],
  metal: ['#4a5260', '#8a94a6', '#cdd6e2'],
} as const;

const rig: FaceRig = {
  eyeY: 97,
  near: { x: 113, w: 25 },
  far: { x: 146, w: 19 },
  mouth: { x: 141, y: 134, w: 23 },
  iris: '#3a2214',
  lip: '#5a2420',
  brow: tones.hair[0],
  shade: tones.skin[0],
  browThick: 5.0,
  lash: true,
  k: 1.05,
  irisR: 0.32,
  // she grins by default
  base: { cornerL: 4, cornerR: 4, sag: 4, gap: 6.5, wide: 1.22, open: 0.9, browUp: -1 },
};

const { neck, head, ear } = humanHead({ skin: 'skin', jaw: 22, chinX: 147, noseX: 163 });

// the braid: a column of interlocking leaves down the near shoulder
const braid = (): string => {
  const out: string[] = [];
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const x = 80 - 22 * t - 5 * Math.sin(t * Math.PI);
    const y = 112 + 112 * t;
    const w = 7 - 2.2 * t;
    out.push(`<path d="${leaf(x - 2, y, 20 - 6 * t, w, 62)}" fill="${tones.hair[i % 2 ? 1 : 2]}"/>`);
    out.push(`<path d="${leaf(x + 2, y + 4, 20 - 6 * t, w, 118)}" fill="${tones.hair[i % 2 ? 2 : 1]}"/>`);
  }
  return out.join('');
};
// the braid's outline for the rim light: one tapered shape down its length, not every leaf again
const braidRim = (): string => taper(pt(78, 104), pt(58, 232), 4, 17, 9);

export const juno: PortraitArt = {
  id: 'juno',
  faction: 'verdant',
  eyeY: rig.eyeY,
  tones,
  extra: faceColours(rig),
  parts: [
    // flight jacket and the leather harness across the chest
    { d: TORSO, m: 'jacket', s: TORSO_SHADE, l: TORSO_LIGHT },
    { d: 'M30 196L52 188L170 256H124Z', m: 'strap', s: 'M100 200H200V256H100Z', l: 'M30 196L52 188L56 190L34 200Z' },
    { d: 'M96 214H116V230H96Z', m: 'metal', s: 'M108 208H124V236H108Z', l: 'M94 212H100V232H94Z' },
    // the braid, hung over the near shoulder
    { raw: braid(), rim: braidRim() },
    { d: 'M52 222a6 4 0 1 0 12 0a6 4 0 1 0 -12 0ZM50 226L58 244L66 226Z', m: 'hair', s: 'M58 220H70V248H58Z' },
    { d: 'M51 224a7 3.5 0 1 0 14 0a7 3.5 0 1 0 -14 0Z', m: 'strap', s: 'M58 220H70V230H58Z' },
    neck,
    // the fleece collar
    {
      d: 'M84 176C80 160 92 148 106 150C114 144 130 146 138 152C150 148 162 158 158 170C166 182 160 194 146 196C130 204 108 204 94 196C86 192 82 184 84 176Z',
      m: 'fleece',
      s: 'M128 144H176V212H128Z',
      l: 'M78 150H104V190H78Z',
    },
    head,
    ear,
    { face: true },
    // the hair: shaved sides, a swept top; the undercut above the ear is the dark tone
    {
      d: 'M158 80C165 62 154 42 130 38C108 34 88 44 83 62C80 74 82 84 88 90L96 84C96 72 104 66 116 62C132 58 150 64 158 80Z',
      m: 'hair',
      s: 'M146 28C152 48 154 70 160 94L190 94V28Z',
      l: 'M92 58C106 46 128 44 146 52C128 50 110 54 98 66Z',
    },
    { d: 'M83 66C80 82 82 96 90 104L98 98C96 86 96 74 98 64Z', m: 'hair', s: 'M76 56H110V110H76Z' },
    // the headset: an arched band over the head, the ear cup, and the boom mic curving to the mouth
    { d: 'M82 100C76 62 98 34 128 34C152 34 166 52 166 74L160 74C160 56 148 42 128 42C104 42 86 64 90 100Z', m: 'gear', s: 'M140 24H180V90H140Z', l: 'M74 56H100V80H74Z' },
    { d: oval(86, 110, 11, 15), m: 'gear', s: 'M88 90H106V130H88Z', l: 'M72 96H82V110H72Z' },
    { d: oval(86, 110, 6.5, 10), m: 'metal', s: 'M86 96H98V126H86Z', l: 'M78 100H84V108H78Z' },
    {
      raw: `<path d="${taper(pt(92, 120), pt(122, 141), 6, 2.6, 2)}" fill="${tones.gear[2]}"/><path d="${oval(126, 141, 4.6, 3.6)}" fill="${tones.gear[0]}"/><path d="${oval(124, 140, 1.8, 1.4)}" fill="${tones.gear[2]}"/>`,
    },
  ],
  expression: (mood) => humanExpression(rig, mood),
};
