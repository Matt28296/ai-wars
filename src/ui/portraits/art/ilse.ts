// Ilse Varga, Helion Accord marshal, 61, she/her. Silver hair in a tight bun; a peaked marshal's cap; a monocular rangefinder over the far
// eye; a lined, calm face. Charcoal dress tunic with a stand collar, Helion orange braid.
import { ageLines, faceColours, humanExpression, humanHead } from '../face';
import type { FaceRig } from '../face';
import { disc, oval } from '../geom';
import { TORSO, TORSO_LIGHT, TORSO_SHADE } from '../shapes';
import type { PortraitArt } from '../types';

const tones = {
  skin: ['#b8836b', '#dcb096', '#f1cfb7'],
  hair: ['#5b6573', '#a9b3c0', '#e6ebf1'],
  cloth: ['#1d2229', '#2e353f', '#485260'],
  trim: ['#a85a12', '#e07d1c', '#ff9e3c'],
  visor: ['#0a0b0f', '#15171d', '#2b2e3a'],
  metal: ['#4a5260', '#8a94a6', '#cdd6e2'],
} as const;

const rig: FaceRig = {
  eyeY: 97,
  near: { x: 113, w: 25 },
  far: { x: 146, w: 18 },
  mouth: { x: 141, y: 134, w: 21 },
  iris: '#5d7c97',
  lip: '#9a5252',
  brow: tones.hair[0],
  shade: tones.skin[0],
  browThick: 4.0,
  lash: true,
  k: 0.9,
  irisR: 0.3,
  base: { open: 0.88, browUp: 0.5 },
};

const { neck, head, ear } = humanHead({ skin: 'skin', jaw: 22, chinX: 146, chinY: 150, lip: 157 });
const RED = '#ff5a4a';
const GLASS = '#7fe6ff';

export const ilse: PortraitArt = {
  id: 'ilse',
  faction: 'helion',
  eyeY: rig.eyeY,
  tones,
  extra: [...faceColours(rig), RED, GLASS],
  parts: [
    // the bun, low on the back of the head, tied
    { d: 'M54 106a15 15 0 1 0 30 0a15 15 0 1 0 -30 0Z', m: 'hair', s: 'M76 130C92 126 92 104 84 92L100 92V132Z', l: 'M52 98C54 90 62 88 68 91C62 93 58 98 56 106Z' },
    // dress tunic
    { d: TORSO, m: 'cloth', s: TORSO_SHADE, l: TORSO_LIGHT },
    // epaulette on the near shoulder: a plate with three bars of braid
    { d: 'M22 202L60 190L72 198L30 214Z', m: 'trim', s: 'M54 180H80V214H54Z', l: 'M22 202L60 190L62 193L24 206Z' },
    { d: 'M30 207L36 205L38 212L32 214ZM42 203L48 201L50 208L44 210ZM54 199L60 197L62 204L56 206Z', m: 'metal', s: 'M44 192H70V217H44Z' },
    // ribbons on the chest
    { d: 'M112 222H140V228H112ZM112 229H140V235H112Z', m: 'trim', s: 'M128 216H150V242H128Z' },
    neck,
    // stand collar with a braided edge
    {
      d: 'M90 172C90 160 94 152 100 148C114 158 136 160 152 154L160 176C152 192 132 198 114 196C102 192 92 186 90 172Z',
      m: 'cloth',
      s: 'M136 140L172 140V210H136Z',
    },
    { d: 'M96 147C112 157 134 159 153 153L154 159C134 165 112 163 94 154Z', m: 'trim', s: 'M134 140H172V190H134Z' },
    head,
    // silver hair, drawn back tight from the temple to the bun: a narrow band under the cap's rim and a short sweep to the ear
    { d: 'M80 70C104 62 130 60 164 66L164 72C142 70 112 72 102 80L98 94C90 92 84 84 80 70Z', m: 'hair', s: 'M122 56H176V100H122Z M98 80L128 72L127 75L102 86Z', l: 'M84 70L100 66L100 69L84 75Z' },
    ear,
    { raw: ageLines(rig, tones.skin[0], 2, { x: 152, y: 118 }) },
    { face: true },
    // the peaked cap: a flared crown over a banded rim, a badge, and a short bill
    {
      d: 'M78 62C72 46 72 32 84 26C100 20 140 16 158 18C172 20 176 36 172 52C168 58 164 60 160 62C130 56 104 58 78 68Z',
      m: 'cloth',
      s: 'M144 8C150 34 152 50 154 62L190 72V8Z',
      l: 'M72 36C86 20 112 18 128 18C110 26 96 40 90 58C80 54 72 48 72 36Z',
    },
    { d: 'M78 54C104 46 140 44 169 51L169 62C140 56 104 58 78 68Z', m: 'trim', s: 'M142 40H182V72H142Z', l: 'M76 54C100 46 122 44 136 44L136 48C112 50 96 54 78 62Z' },
    { d: 'M142 44a7 7 0 1 0 14 0a7 7 0 1 0 -14 0Z', m: 'metal', s: 'M150 36H162V56H150Z', l: 'M140 40H148V48H140Z' },
    { d: 'M152 62C172 56 196 62 204 76C190 82 166 80 150 72Z', m: 'visor', s: 'M172 50H212V86H172Z', l: 'M154 62C168 58 182 60 192 66C178 64 164 66 154 70Z' },
    // the monocular rangefinder over the far eye: a strut from the cap, the eyepiece, a short barrel, a flared objective, a red range light
    { d: 'M144 68H150V90H144Z', m: 'metal', s: 'M148 62H158V96H148Z', l: 'M142 66H145V91H142Z' },
    { d: 'M139 89H152C154 89 155 92 155 96C155 100 154 103 152 103H139C137 103 136 100 136 96C136 92 137 89 139 89Z', m: 'metal', s: 'M130 97H165V110H130Z', l: 'M133 87H165V91H133Z' },
    { d: 'M153 91H162V101H153Z', m: 'metal', s: 'M153 97H170V108H153Z', l: 'M153 90H170V93H153Z' },
    { d: 'M160 91L170 87V105L160 101Z', m: 'metal', s: 'M160 96H176V110H160Z', l: 'M160 91L170 87V90L160 94Z' },
    { raw: `<path d="${oval(170, 96, 2.4, 7.5)}" fill="${GLASS}"/><path d="${disc(143, 92, 1.6)}" fill="${RED}"/>` },
  ],
  expression: (mood) => humanExpression(rig, mood),
};
