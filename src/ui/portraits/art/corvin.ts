// Corvin Ashgrave, Kestrel Dominion highlord, 52, he/him. Swept-back silver hair; a short pointed beard; a tall collar with epaulettes;
// proud. A black dress uniform with gold braid.
import { faceColours, humanExpression, humanHead } from '../face';
import type { FaceRig } from '../face';
import { TORSO, TORSO_LIGHT, TORSO_SHADE } from '../shapes';
import type { PortraitArt } from '../types';

const tones = {
  skin: ['#a47455', '#d0a07c', '#ecc29c'],
  hair: ['#5d6674', '#aab3c0', '#e9eef4'],
  coat: ['#09090d', '#17161e', '#34323f'],
  gold: ['#7d5d12', '#cfa736', '#f6da80'],
} as const;

const rig: FaceRig = {
  eyeY: 97,
  near: { x: 113, w: 25 },
  far: { x: 146, w: 18 },
  mouth: { x: 141, y: 133, w: 21 },
  iris: '#46678d',
  lip: '#8f5249',
  brow: tones.hair[0],
  shade: tones.skin[0],
  browThick: 4.8,
  lash: false,
  k: 0.95,
  irisR: 0.29,
  // proud: lids a little lowered, brows lifted, the corners of the mouth level
  base: { open: 0.84, browUp: -1.4, cornerL: 0, cornerR: 0, sag: 0.2, gaze: 2 },
};

const { neck, head, ear } = humanHead({ skin: 'skin', jaw: 28, chinX: 148, chinY: 150 });

export const corvin: PortraitArt = {
  id: 'corvin',
  faction: 'kestrel',
  eyeY: rig.eyeY,
  tones,
  extra: faceColours(rig),
  parts: [
    // the black dress uniform
    { d: TORSO, m: 'coat', s: TORSO_SHADE, l: TORSO_LIGHT },
    // braided cords across the chest: two loops of gold
    { d: 'M64 206C84 214 104 232 112 256H100C92 236 76 222 58 214Z', m: 'gold', s: 'M84 200H130V256H84Z', l: 'M58 206L66 206L62 214Z' },
    { d: 'M154 200C170 208 184 226 190 256H178C174 238 162 222 148 212Z', m: 'gold', s: 'M150 196H200V256H150Z' },
    // gold buttons
    { d: 'M126 214a4 4 0 1 0 8 0a4 4 0 1 0 -8 0ZM124 234a4 4 0 1 0 8 0a4 4 0 1 0 -8 0ZM122 254a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z', m: 'gold', s: 'M130 206H146V258H130Z', l: 'M120 210H126V258H120Z' },
    // the great epaulettes: broad squared boards that stand up off the shoulders, with a fringe of braid
    { d: 'M-6 208L22 166L76 174L72 200L8 224Z', m: 'gold', s: 'M56 160H100V230H56Z', l: 'M-6 208L22 166L28 167L0 210Z' },
    { d: 'M-4 222L8 224L14 246L0 248ZM12 220L22 218L28 240L18 242ZM26 216L36 214L42 236L32 238Z', m: 'gold', s: 'M24 206H70V250H24Z' },
    { d: 'M198 180L236 164L264 186L252 214L200 202Z', m: 'gold', s: 'M214 160H280V230H214Z', l: 'M198 180L236 164L238 168L202 184Z' },
    // the tall collar, far side: behind the neck
    { d: 'M138 190C140 170 142 158 144 152L164 156C164 166 168 180 172 196Z', m: 'coat', s: 'M150 130H200V210H150Z' },
    neck,
    // the tall collar, near side: up beside the jaw, with a gold edge
    {
      d: 'M88 196C84 172 86 150 92 134L110 146C120 154 136 158 150 156L158 196Z',
      m: 'coat',
      s: 'M134 130H180V210H134Z',
      l: 'M80 140H100V196H80Z',
    },
    { d: 'M92 134L110 146C120 154 136 158 150 156L150 164C134 166 118 162 104 154C96 148 92 142 88 138Z', m: 'gold', s: 'M128 140H170V180H128Z', l: 'M88 132H110V140H88Z' },
    head,
    // the short pointed beard, drawn so the mouth sits on it
    {
      d: 'M121 140C125 148 135 152 141 153L148 180L154 152C158 148 160 142 158 134C150 140 138 140 130 137Z',
      m: 'hair',
      s: 'M150 128H170V190H150Z',
      },
    ear,
    { face: true },
    // swept-back silver hair: a high front and a widow's peak, with the sweep in thin shadow lines
    {
      d: 'M154 78C162 60 156 36 132 30C108 26 88 38 82 60C78 74 80 90 86 100L94 96C92 82 98 70 110 62C122 56 134 62 140 74C144 70 150 72 154 78Z',
      m: 'hair',
      s: 'M142 20C150 44 154 68 158 92L190 92V20Z M100 52L124 40L122 44L104 58Z M96 64L128 48L127 52L100 70Z',
      l: 'M90 56C104 42 126 38 146 44C126 44 108 52 96 66Z',
    },
  ],
  expression: (mood) => humanExpression(rig, mood),
};
