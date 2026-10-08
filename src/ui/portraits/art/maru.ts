// Maru Ingram, Verdant Compact grove elder, 70, they/them. Long white hair; a woven leaf hood; laugh lines; gentle. A hood and cowl of
// overlapping leaves in two greens and a dried gold, over an earth-brown robe.
import { ageLines, faceColours, humanExpression, humanHead } from '../face';
import type { FaceRig } from '../face';
import { leaf } from '../geom';
import { TORSO, TORSO_LIGHT, TORSO_SHADE } from '../shapes';
import type { PortraitArt } from '../types';

const tones = {
  skin: ['#8a5a3b', '#b3794f', '#d39b6b'],
  hair: ['#8f9c9e', '#dbe3e2', '#fbfdfd'],
  leafA: ['#0f3326', '#1d5a3b', '#3b8c58'],
  leafB: ['#5a4a1c', '#8a7432', '#bba85a'],
  robe: ['#241f14', '#3b3622', '#58502f'],
} as const;

const rig: FaceRig = {
  eyeY: 97,
  near: { x: 113, w: 25 },
  far: { x: 146, w: 18 },
  mouth: { x: 141, y: 134, w: 22 },
  iris: '#5f4d22',
  lip: '#7d3f33',
  brow: tones.hair[1],
  shade: tones.skin[0],
  browThick: 4.4,
  lash: false,
  k: 0.9,
  irisR: 0.3,
  // a gentle smile that is always about to become a laugh
  base: { cornerL: 0.9, cornerR: 0.9, sag: 1, open: 0.88, browUp: -0.5 },
};

const { neck, head, ear } = humanHead({ skin: 'skin', jaw: 24, chinX: 147 });

type LeafSpec = readonly [x: number, y: number, len: number, wid: number, deg: number, tone: 'a' | 'b' | 'c'];
const FILL = { a: tones.leafA[1], b: tones.leafA[2], c: tones.leafB[1] } as const;
const leaves = (list: readonly LeafSpec[]): string => list.map(([x, y, l, w, a, t]) => `<path d="${leaf(x, y, l, w, a)}" fill="${FILL[t]}"/>`).join('');
const leafPaths = (list: readonly LeafSpec[]): string => list.map(([x, y, l, w, a]) => leaf(x, y, l, w, a)).join('');

// the woven surface of the hood's far side and top, and of the cowl on the shoulders
const HOOD_LEAVES: readonly LeafSpec[] = [
  [122, 16, 22, 6, 100, 'b'], [104, 22, 22, 6, 130, 'a'], [140, 22, 22, 6, 60, 'a'], [88, 38, 24, 6, 140, 'c'], [158, 36, 24, 6, 40, 'c'],
  [74, 60, 24, 6, 160, 'a'], [172, 58, 24, 6, 25, 'b'], [66, 86, 24, 6, 175, 'b'], [180, 84, 24, 6, 10, 'a'], [64, 112, 24, 6, 190, 'c'],
  [182, 110, 24, 6, -5, 'c'], [68, 138, 24, 6, 200, 'a'], [180, 136, 24, 6, -15, 'b'], [76, 164, 24, 6, 210, 'b'], [172, 162, 24, 6, -25, 'a'],
];
const COWL_LEAVES: readonly LeafSpec[] = [
  [26, 214, 30, 8, 210, 'a'], [52, 204, 30, 8, 200, 'c'], [78, 196, 28, 8, 195, 'b'], [20, 238, 30, 8, 215, 'c'], [48, 228, 30, 8, 205, 'b'],
  [76, 220, 30, 8, 195, 'a'], [34, 254, 30, 8, 215, 'b'], [64, 248, 30, 8, 200, 'a'], [236, 214, 30, 8, -30, 'b'], [210, 204, 30, 8, -20, 'a'],
  [184, 196, 28, 8, -15, 'c'], [244, 238, 30, 8, -35, 'a'], [218, 228, 30, 8, -25, 'c'], [190, 220, 30, 8, -15, 'b'], [228, 254, 30, 8, -35, 'c'],
  [198, 246, 30, 8, -20, 'a'],
];
const RIM_LEAVES: readonly LeafSpec[] = [
  [150, 60, 20, 5, -35, 'b'], [136, 48, 20, 5, -10, 'c'], [120, 44, 20, 5, 0, 'b'], [104, 48, 20, 5, 25, 'a'], [92, 60, 20, 5, 55, 'c'],
  [86, 78, 20, 5, 80, 'b'], [84, 98, 20, 5, 95, 'a'], [86, 118, 20, 5, 105, 'c'], [90, 138, 20, 5, 115, 'b'], [96, 154, 20, 5, 125, 'a'],
];

export const maru: PortraitArt = {
  id: 'maru',
  faction: 'verdant',
  eyeY: rig.eyeY,
  tones,
  extra: faceColours(rig),
  parts: [
    // the hood, behind the head: a peaked cowl woven of leaves
    {
      d: 'M120 6C146 12 172 38 183 76C192 106 188 138 178 164L200 200H52L72 164C60 132 62 100 72 70C84 36 104 12 120 6Z',
      m: 'leafA',
      s: 'M150 0C160 40 168 90 164 130L186 170L212 210V0Z',
      l: 'M60 90C64 56 84 24 112 12C92 36 80 70 78 110C70 106 62 100 60 90Z',
    },
    { raw: leaves(HOOD_LEAVES), rim: leafPaths(HOOD_LEAVES) },
    // the earth-brown robe, and the cowl of leaves over the shoulders
    { d: TORSO, m: 'robe', s: TORSO_SHADE, l: TORSO_LIGHT },
    { raw: leaves(COWL_LEAVES) },
    neck,
    // the cowl's collar, round the base of the neck
    { d: 'M88 176C88 164 94 156 102 154C116 162 138 164 152 156C158 162 160 172 158 182C146 196 130 202 112 198C98 194 90 186 88 176Z', m: 'leafA', s: 'M132 150H170V210H132Z', l: 'M84 160H104V196H84Z' },
    head,
    ear,
    { raw: ageLines(rig, tones.skin[0], 3, { x: 152, y: 118 }) },
    { face: true },
    // white bangs under the hood's rim (cut in points), and the long white hair falling on the near side in three locks
    { d: 'M96 82C108 66 134 64 156 78L156 88L148 82L144 90L136 82L130 90L122 82L116 90L108 84L102 94Z', m: 'hair', s: 'M130 60H170V100H130Z' },
    { d: 'M76 96C68 130 66 176 72 226L84 232L90 218L96 232L106 224C100 188 102 140 104 100Z', m: 'hair', s: 'M96 96H120V240H96Z M84 120L90 120L88 214L82 214Z', l: 'M66 110H76V190H66Z' },
    // the hood's rim: a band of leaves framing the face
    {
      d: 'M160 72C158 52 140 40 118 40C92 40 74 62 74 96C74 124 82 148 94 166L106 158C98 140 94 120 96 96C98 70 112 56 130 56C142 56 152 62 156 76Z',
      m: 'leafA',
      s: 'M140 30H190V120H140Z',
      l: 'M70 60H78V150H70Z',
    },
    { raw: leaves(RIM_LEAVES) },
  ],
  expression: (mood) => humanExpression(rig, mood),
};
