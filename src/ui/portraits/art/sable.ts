// Sable Ashgrave, Kestrel Dominion night wing commander, 27, she/her. A black asymmetric bob; a night visor pushed up; a scarf; wry.
// A black flight suit with a gold-buckled harness and a deep crimson scarf.
import { faceColours, humanExpression, humanHead } from '../face';
import type { FaceRig } from '../face';
import { TORSO, TORSO_LIGHT, TORSO_SHADE } from '../shapes';
import type { PortraitArt } from '../types';

const tones = {
  skin: ['#b8908b', '#dfb9b1', '#f4d8cf'],
  hair: ['#07060b', '#15121e', '#3c3552'],
  suit: ['#0b0c10', '#191b22', '#363a47'],
  scarf: ['#35091a', '#6b1a2f', '#a23049'],
  gold: ['#7d5d12', '#cfa736', '#f6da80'],
  visor: ['#10161a', '#232d33', '#4d5d66'],
} as const;

const rig: FaceRig = {
  eyeY: 97,
  near: { x: 113, w: 25 },
  far: { x: 146, w: 18 },
  mouth: { x: 141, y: 134, w: 21 },
  iris: '#a96f1d',
  lip: '#872f44',
  brow: tones.hair[0],
  shade: tones.skin[0],
  browThick: 4.2,
  lash: true,
  k: 1,
  irisR: 0.31,
  // wry: one brow already a little raised, one corner of the mouth already a little up
  base: { open: 0.88, farBrowUp: -2.2, cornerL: -0.2, cornerR: 2, sag: 0.6, gaze: 2.4 },
};

const { neck, head, ear } = humanHead({ skin: 'skin', jaw: 20, chinX: 146, chinY: 150, lip: 157 });
const NV = '#9bffd0';

export const sable: PortraitArt = {
  id: 'sable',
  faction: 'kestrel',
  eyeY: rig.eyeY,
  tones,
  extra: [...faceColours(rig), NV],
  parts: [
    // flight suit and harness
    { d: TORSO, m: 'suit', s: TORSO_SHADE, l: TORSO_LIGHT },
    { d: 'M44 190L66 184L84 256H54Z', m: 'suit', s: 'M64 180H100V256H64Z', l: 'M44 190L52 188L66 256H54Z' },
    { d: 'M60 214H80V228H60Z', m: 'gold', s: 'M72 208H88V234H72Z', l: 'M58 212H64V230H58Z' },
    { d: 'M150 184L176 190L190 256H160Z', m: 'suit', s: 'M150 180H200V256H150Z' },
    { d: 'M156 218H176V232H156Z', m: 'gold', s: 'M168 212H184V238H168Z', l: 'M154 216H160V234H154Z' },
    neck,
    // the scarf: wrapped twice round the neck, with a tail over the near shoulder
    {
      d: 'M80 170C80 154 100 144 122 150C140 146 160 152 162 168C170 184 160 204 140 206C120 214 96 212 84 200C76 192 76 178 80 170Z',
      m: 'scarf',
      s: 'M130 144H176V214H130Z M100 188C112 194 130 194 144 188L144 196C130 202 112 202 100 196Z',
      l: 'M74 156H94V196H74Z',
    },
    { d: 'M76 196L106 202L96 256H64Z', m: 'scarf', s: 'M92 196H120V256H92Z', l: 'M74 198L82 200L72 256H64Z' },
    head,
    ear,
    { face: true },
    // the bob, one piece: the far side short, the near side long and cut on a slant, a side-swept fringe across the brow
    {
      d: 'M160 68C158 50 140 40 120 40C94 40 78 58 76 84C74 110 76 134 86 156L106 148C100 130 98 112 100 94C112 86 134 80 160 68Z',
      m: 'hair',
      s: 'M142 30C148 48 152 62 160 78L190 78V30Z M90 100H112V160H90Z',
      l: 'M84 64C94 50 112 44 130 46C112 50 98 60 92 78C86 76 82 72 84 64Z M78 100H86V140H78Z',
    },
    // the night visor, pushed up: the band across the brow, then the smoked green glass tipped back over the hair, standing proud of the head
    { d: 'M86 72C108 60 140 58 162 66L160 78C140 72 112 72 90 84Z', m: 'visor', s: 'M138 54H176V90H138Z', l: 'M86 72C108 60 140 58 162 66L162 68C140 62 110 62 88 74Z' },
    { d: 'M104 66L138 28L168 44L150 70Z', m: 'visor', s: 'M146 22H180V76H146Z', l: 'M104 66L138 28L141 31L108 68Z' },
    { raw: `<path d="M114 62L140 36L158 46L146 62Z" fill="${NV}" fill-opacity="0.55"/><path d="M122 58L138 42L141 45L126 61Z" fill="${tones.visor[2]}" fill-opacity="0.6"/>` },
  ],
  expression: (mood) => humanExpression(rig, mood),
};
