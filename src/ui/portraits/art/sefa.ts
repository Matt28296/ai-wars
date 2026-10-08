// Sefa Tamura, Tidewell Union fleet admiral, 47, she/her. A high-collared naval greatcoat; straight shoulder-length black hair cut level;
// an earpiece; a composed face. Navy coat with silver braid, in front of the Tidewell cobalt ground.
import { faceColours, humanExpression, humanHead } from '../face';
import type { FaceRig } from '../face';
import { pt, taper } from '../geom';
import { TORSO, TORSO_LIGHT, TORSO_SHADE } from '../shapes';
import type { PortraitArt } from '../types';

const tones = {
  skin: ['#c1916b', '#e3b791', '#f6d5b6'],
  hair: ['#06070c', '#131a2b', '#34446b'],
  coat: ['#0b142c', '#16264a', '#2e477a'],
  metal: ['#4f5a6d', '#98a3b6', '#dbe3ef'],
} as const;

const rig: FaceRig = {
  eyeY: 97,
  near: { x: 113, w: 25 },
  far: { x: 146, w: 18 },
  mouth: { x: 141, y: 134, w: 21 },
  iris: '#2b1f19',
  lip: '#a24f52',
  brow: tones.hair[0],
  shade: tones.skin[0],
  browThick: 4.0,
  lash: true,
  k: 0.85,
  irisR: 0.31,
  base: { open: 0.9 },
};

const { neck, head, ear } = humanHead({ skin: 'skin', jaw: 20, chinX: 146, chinY: 150, lip: 157 });
const LED = '#7fe6ff';

export const sefa: PortraitArt = {
  id: 'sefa',
  faction: 'tidewell',
  eyeY: rig.eyeY,
  tones,
  extra: [...faceColours(rig), LED],
  parts: [
    // the long hair behind the head and neck, cut straight across at the shoulder
    { d: 'M76 82C62 96 56 124 56 192H116L104 120Z', m: 'hair', s: 'M96 90H130V196H96Z', l: 'M50 96H66V170H50Z' },
    // greatcoat
    { d: TORSO, m: 'coat', s: TORSO_SHADE, l: TORSO_LIGHT },
    // the double-breasted front: an overlapping panel with two columns of buttons
    { d: 'M118 168L170 178L196 256H110Z', m: 'coat', s: 'M168 170H210V256H168Z', l: 'M118 168L126 169L120 256H110Z' },
    { d: 'M106 206a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0ZM104 230a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0ZM102 254a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0ZM150 214a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0ZM150 238a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0Z', m: 'metal', s: 'M130 190H180V260H130Z', l: 'M96 200H108V260H96Z' },
    // shoulder board on the near shoulder
    { d: 'M26 198L64 188L70 197L32 210Z', m: 'metal', s: 'M54 180H80V212H54Z', l: 'M26 198L64 188L65 191L28 202Z' },
    neck,
    // the tall stand collar, up under the jaw, with a silver rank tab
    {
      d: 'M88 192C84 172 84 156 88 142L100 142L148 146L162 150C158 164 158 178 162 192Z',
      m: 'coat',
      s: 'M132 140H176V200H132Z',
      l: 'M84 150H104V196H84Z',
    },
    { d: 'M96 146L148 148L148 153L96 151Z', m: 'metal', s: 'M130 140H176V160H130Z', l: 'M96 146L148 148L148 149L96 147Z' },
    { d: 'M104 160H118V176H104ZM106 164H116V166H106ZM106 169H116V171H106Z', m: 'metal', s: 'M112 156H124V180H112Z' },
    head,
    // the hair on the head: a side parting swept across the brow, tucked behind the ear
    {
      d: 'M90 92C80 62 100 44 126 44C148 44 161 58 161 80C151 66 137 62 123 66C108 70 98 80 96 98Z',
      m: 'hair',
      s: 'M148 38C152 56 154 74 156 96L180 100V30Z M108 60L124 58L122 62L108 66Z',
      l: 'M84 66C90 52 108 46 126 46C112 54 100 66 94 84C88 80 84 74 84 66Z',
    },
    // the hair falling behind the ear on the near side
    { d: 'M78 86C72 108 72 128 78 150L98 150L96 100Z', m: 'hair', s: 'M90 90H110V160H90Z', l: 'M70 100H78V140H70Z' },
    ear,
    // the earpiece: a bead on the ear and a thin cable down the neck
    { d: 'M80 108a6 6 0 1 0 12 0a6 6 0 1 0 -12 0Z', m: 'metal', s: 'M88 100H98V118H88Z', l: 'M78 104H84V110H78Z' },
    { raw: `<path d="${taper(pt(88, 116), pt(100, 160), 3, 2, 1.4)}" fill="${tones.metal[0]}"/><path d="M84 106a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z" fill="${LED}"/>` },
    { face: true },
  ],
  expression: (mood) => humanExpression(rig, mood),
};
