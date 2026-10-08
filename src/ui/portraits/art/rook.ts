// Rook Okafor, Helion Accord field captain, 24, he/him. Short locs; welding goggles pushed up on the forehead; a utility collar with a
// tool loop; an open, earnest face. Deep brown skin, charcoal jacket with Helion orange piping.
import { faceColours, humanExpression, humanHead } from '../face';
import type { FaceRig } from '../face';
import { disc, oval } from '../geom';
import type { PortraitArt } from '../types';

const rig: FaceRig = {
  eyeY: 97,
  near: { x: 113, w: 25 },
  far: { x: 146, w: 19 },
  mouth: { x: 141, y: 134, w: 24 },
  iris: '#2b1810',
  lip: '#2e1512',
  brow: '#15100f',
  shade: '#4d2b1c',
  browThick: 5.0,
  k: 1,
  irisR: 0.32,
};

const { neck, head, ear } = humanHead({ skin: 'skin', jaw: 24 });

const GLASS = '#173a44';
const GLINT = '#7fe6ff';

export const rook: PortraitArt = {
  id: 'rook',
  faction: 'helion',
  eyeY: rig.eyeY,
  tones: {
    skin: ['#4d2b1c', '#7a4a2f', '#a0653f'],
    hair: ['#0e0b0c', '#1f1819', '#3b2d2b'],
    cloth: ['#1e2128', '#2f3441', '#475066'],
    trim: ['#a85a12', '#e07d1c', '#ff9e3c'],
    leather: ['#38230f', '#5a3a1f', '#80562f'],
    metal: ['#4a5260', '#8a94a6', '#cdd6e2'],
  },
  extra: [...faceColours(rig), GLASS, GLINT],
  parts: [
    // locs and strap behind the head
    {
      d: 'M72 74C62 84 64 100 74 108L86 112L92 98L90 70Z',
      m: 'hair',
      s: 'M60 60L100 60L100 120L60 120Z',
    },
    // jacket
    {
      d: 'M-8 256V224C-4 205 20 193 52 187L88 177C98 173 100 169 104 167L148 165C152 169 156 173 172 177L206 185C236 191 258 205 264 227V256Z',
      m: 'cloth',
      s: 'M150 160C146 196 142 230 140 262H280V160Z',
      l: 'M-10 200C20 188 60 184 88 176L72 206C44 212 12 226 -10 244Z',
    },
    // orange piping along the shoulder seam
    {
      d: 'M24 196C52 186 80 182 100 176L98 184C74 190 48 196 22 206Z',
      m: 'trim',
      s: 'M60 170H120V220H60Z',
    },
    neck,
    // stand collar
    {
      d: 'M92 166C108 172 132 174 150 168L158 184C150 196 130 200 112 198C100 194 90 190 88 182Z',
      m: 'cloth',
      s: 'M134 150L170 150V210H134Z',
      l: 'M84 160L108 168L104 190L86 190Z',
    },
    // collar piping
    { d: 'M92 163C108 169 132 171 151 165L150 171C132 177 108 175 91 169Z', m: 'trim', s: 'M132 150H170V190H132Z' },
    // the tool loop: a leather tab with a steel ring, off the collar's front edge
    { d: 'M146 178L158 182L160 200L148 203Z', m: 'leather', s: 'M154 170H180V212H154Z', l: 'M145 177L150 179L150 202L147 203Z' },
    { d: 'M146 203a7 7 0 1 0 14 0a7 7 0 1 0 -14 0ZM149.5 203a3.5 3.5 0 1 1 7 0a3.5 3.5 0 1 1 -7 0Z', m: 'metal', s: 'M154 196H170V214H154Z', l: 'M144 195H151V203H144Z' },
    head,
    ear,
    { face: true },
    // short locs: a rounded cap of hair with notches
    {
      d: 'M154 78C163 72 164 58 154 49C157 38 144 31 134 36C130 26 114 26 108 36C98 29 84 38 87 49C74 49 66 62 72 74C65 83 67 99 77 104L84 108L91 98C91 86 97 74 110 68C126 60 144 62 154 78Z',
      m: 'hair',
      s: 'M142 20C148 50 146 72 150 100L190 100V20Z M141 34L138 54L145 50Z M121 29L118 48L126 46Z M107 36L103 52L110 52Z M86 46L86 62L92 58Z M74 56L76 70L81 64Z',
      l: 'M70 42C90 28 120 28 130 40C112 44 96 56 88 74C76 70 68 58 70 42Z',
    },
    // welding goggles pushed up on the forehead: the strap round the head, a bridge, two steel-rimmed lenses of dark glass
    { d: 'M70 84L97 67L102 79L74 99Z', m: 'leather', s: 'M92 60H112V110H92Z', l: 'M70 84L97 67L98 71L72 88Z' },
    { d: 'M150 62L162 68L160 80L149 74Z', m: 'leather', s: 'M148 56H170V90H148Z' },
    { d: 'M126 63H134V71H126Z', m: 'metal', s: 'M131 60H140V76H131Z', l: 'M126 63H134V65H126Z' },
    {
      d: 'M103 70a13 13 0 1 0 26 0a13 13 0 1 0 -26 0ZM108.500 70a7.5 7.5 0 1 1 15 0a7.5 7.5 0 1 1 -15 0Z',
      m: 'metal',
      s: 'M117 50H140V86H117Z',
      l: 'M99 54H116V66H99Z',
    },
    { raw: `<path d="${disc(116, 70, 7.5)}" fill="${GLASS}"/><path d="M111 76L118 63L121 65L114 78Z" fill="${GLINT}"/>` },
    {
      d: 'M133 66a10 11.5 0 1 0 20 0a10 11.5 0 1 0 -20 0ZM137.5 66a5.5 7 0 1 1 11 0a5.5 7 0 1 1 -11 0Z',
      m: 'metal',
      s: 'M143 52H160V84H143Z',
      l: 'M130 55H142V64H130Z',
    },
    { raw: `<path d="${oval(143, 66, 5.5, 7)}" fill="${GLASS}"/><path d="M139.500 71L145 61L147 62.500L142 73Z" fill="${GLINT}"/>` },
  ],
  expression: (mood) => humanExpression(rig, mood),
};
