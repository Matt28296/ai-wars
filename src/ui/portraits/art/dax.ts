// Dax Halloran, Tidewell Union commissioner of logistics, 35, he/him. Slicked hair; thin augmented-reality glasses; a high-collar suit and
// tie; a practised half-smile. Slate suit, white shirt, one burgundy tie against the cobalt ground.
import { faceColours, humanExpression, humanHead } from '../face';
import type { FaceRig } from '../face';
import { frameRect } from '../geom';
import { TORSO, TORSO_LIGHT, TORSO_SHADE } from '../shapes';
import type { PortraitArt } from '../types';

const tones = {
  skin: ['#a56e48', '#c98d60', '#e5ae80'],
  hair: ['#120c0b', '#241713', '#5b4036'],
  suit: ['#111723', '#1f2938', '#37465f'],
  shirt: ['#a3afc3', '#dce3ee', '#ffffff'],
  tie: ['#5f1423', '#9a2438', '#cc4560'],
  frame: ['#080b11', '#151a24', '#3b475a'],
} as const;

const rig: FaceRig = {
  eyeY: 97,
  near: { x: 113, w: 25 },
  far: { x: 146, w: 18 },
  mouth: { x: 141, y: 134, w: 22 },
  iris: '#3c5a4a',
  lip: '#6e3329',
  brow: tones.hair[0],
  shade: tones.skin[0],
  browThick: 4.6,
  lash: false,
  k: 0.95,
  irisR: 0.3,
  // the practised half-smile: one corner up, always, whatever the mood does around it
  base: { cornerL: 0.2, cornerR: 3.2, sag: 0.8, open: 0.92 },
};

const { neck, head, ear } = humanHead({ skin: 'skin', jaw: 22, chinX: 147, chinY: 151, noseX: 163 });
const AR = '#8ab6ff';
const HUD = '#7fe6ff';

export const dax: PortraitArt = {
  id: 'dax',
  faction: 'tidewell',
  eyeY: rig.eyeY,
  tones,
  extra: [...faceColours(rig), AR, HUD],
  parts: [
    // suit jacket
    { d: TORSO, m: 'suit', s: TORSO_SHADE, l: TORSO_LIGHT },
    // the white shirt in the jacket's V
    { d: 'M98 168L150 166L166 196L146 256H112L92 196Z', m: 'shirt', s: 'M140 160H180V256H140Z', l: 'M92 170L104 168L100 256H92Z' },
    // lapels
    { d: 'M62 184L98 174L116 214L106 256H20Z', m: 'suit', s: 'M96 170H130V256H96Z', l: 'M20 200L62 184L66 192L24 214Z' },
    { d: 'M154 176L176 180L198 256H152Z', m: 'suit', s: 'M150 170H210V256H150Z' },
    // the tie
    { d: 'M130 184L144 184L150 256L128 256Z', m: 'tie', s: 'M140 180H160V256H140Z', l: 'M130 184L134 184L132 256L128 256Z' },
    // the jacket's collar stands high behind the neck, a flap on each side
    { d: 'M88 192L84 150L100 140L110 170Z', m: 'suit', s: 'M96 130H130V200H96Z', l: 'M82 146H92V190H82Z' },
    { d: 'M142 170L150 138L170 148L164 192Z', m: 'suit', s: 'M150 130H180V200H150Z' },
    neck,
    // the stiff high shirt collar, both wings, round the tie knot
    { d: 'M96 152L112 156L130 180L108 182Z', m: 'shirt', s: 'M118 150H140V190H118Z', l: 'M94 150L104 152L100 168L94 166Z' },
    { d: 'M148 154L140 158L134 180L154 182Z', m: 'shirt', s: 'M140 150H170V190H140Z' },
    { d: 'M124 172L142 172L146 188L120 188Z', m: 'tie', s: 'M138 168H152V192H138Z', l: 'M122 172L128 172L124 186L120 186Z' },
    head,
    ear,
    { face: true },
    // slicked-back hair: a side parting, a glossy sweep, a quiff that curls up and forward at the front
    {
      d: 'M158 80C169 62 171 44 157 36C146 26 126 24 110 30C92 36 82 52 82 68C80 80 82 92 86 100L94 96C94 82 100 70 112 64C128 56 148 62 158 80Z',
      m: 'hair',
      s: 'M148 20C154 44 156 66 160 90L190 90V20Z M118 34L124 34L122 56L116 58Z',
      l: 'M94 52C108 38 130 34 150 40C132 40 112 46 98 60Z',
    },
    // thin augmented-reality glasses: a slim frame over both eyes, a faint blue tint, two lines of readout
    { d: frameRect(98, 88, 33, 18, 4, 1.7), m: 'frame', s: 'M112 84H140V110H112Z', l: 'M98 88H131V90H98Z' },
    { d: frameRect(135, 88, 24, 17, 4, 1.7), m: 'frame', s: 'M148 84H170V110H148Z', l: 'M135 88H159V90H135Z' },
    { d: 'M131 92H135V94.5H131Z', m: 'frame' },
    { d: 'M158 90L173 86L171 93L158 100Z', m: 'frame', s: 'M158 94H176V104H158Z', l: 'M158 90L173 86L173 87.5L158 92Z' },
    { d: 'M98 92L91 95.5V98L98 96.5Z', m: 'frame' },
    {
      raw:
        `<path d="M99.7 89.7H129.3V104.3H99.7Z" fill="${AR}" fill-opacity="0.16"/><path d="M136.7 89.7H157.3V103.3H136.7Z" fill="${AR}" fill-opacity="0.16"/>` +
        `<path d="M103 92.5H111V93.7H103ZM103 95.5H108V96.7H103Z" fill="${HUD}"/><path d="M141 92.5H149V93.7H141Z" fill="${HUD}"/>`,
    },
  ],
  expression: (mood) => humanExpression(rig, mood),
};
