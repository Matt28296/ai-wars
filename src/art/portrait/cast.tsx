// The eleven commanders. Each returns layers drawn on the 100×100 portrait canvas.
import type { ReactNode } from 'react';
import { SigilGlyph } from '../Sigil';
import { BLACK, EYES, HAIR, SKIN, WHITE, mix, tok, type Ramp } from '../palette';
import { BUST, Ear, F, Face, L, Neck, R, type FaceStyle, type Mood } from './kit';

export type CastDraw = (mood: Mood, uid: string) => ReactNode;

const ramp = (c: string, hi = 76, lo = 70, deep = 46): Ramp => ({ light: mix(c, WHITE, hi), base: c, shade: mix(c, BLACK, lo), deep: mix(c, BLACK, deep) });
const HELION = tok('helion');
const TIDE = tok('tidewell');
const VERD = tok('verdant');
const KEST = tok('kestrel');
const SILVER_BRAID = mix('var(--tidewell-ink)', WHITE, 45);
const GOLD = KEST;

/** Shoulders + torso in a cloth ramp, with shade on the far side. */
function Torso({ c, extra }: { c: Ramp; extra?: ReactNode }) {
  return (
    <g>
      <F d={BUST} c={c.base} />
      <F d="66,73.4 72,74.5 84,79 93,86 98,94 100,100 76,100 72,88" c={c.shade} />
      <F d="1,92 7,84 18,78.5 26,76.3 17,83 9,91 5,100 0,100" c={c.light} o={0.5} />
      {extra}
    </g>
  );
}

// ---------------- Ren Okafor ----------------
const renFace: FaceStyle = { skin: SKIN.umber, brow: HAIR.black.base, iris: EYES.brown, browW: 2.3, expressive: 2, closedHappy: true, jaw: 'young' };
const ren: CastDraw = (mood, uid) => {
  const h = HAIR.black;
  const jacket = ramp(mix(HELION, 'var(--panel-raised)', 30));
  return (
    <g>
      <F d="30,46 28.5,30 31,20 38,12.5 48,9 58,9.5 66,13 71,20 72.6,30 71.4,41 67.6,34 66,26 36,26 33.4,36 32.8,46" c={h.base} />
      <Torso c={jacket} extra={<>
        <F d="1,92 7,84 18,78.5 30,75 27,82.5 16,88.4 8,96.5 6,100 0,100" c={HELION} />
        <F d="7,84 18,78.5 30,75 29,77.6 18.6,81 9,86.4" c={mix(HELION, WHITE, 70)} />
        <F d="62,80 96,90 98,94 64,85" c={mix(HELION, BLACK, 60)} />
        <F d="14.5,86.5 25.5,83.2 27.4,92.6 16.6,95.8" c={HELION} />
        <SigilGlyph faction="helion" color="var(--on-helion)" x={17.2} y={85.2} size={8.6} />
      </>} />
      <Neck skin={SKIN.umber} />
      {/* high work collar */}
      <F d="33.6,80 36.4,63.4 47.2,68.4 49,81.4" c={jacket.light} />
      <F d="36.4,63.4 47.2,68.4 46.8,71 37.4,66.6" c={jacket.base} />
      <F d="56,70 65.8,62.6 69.8,76.6 60,81.6" c={jacket.base} />
      <F d="65.8,62.6 69.8,76.6 67.6,77.8 64.4,65.8" c={jacket.shade} />
      <F d="49,81.4 52.6,74 56,70 60,81.6 52.6,100 52,100" c={jacket.shade} />
      <L d="52.6,74 52.6,100" c={mix('var(--line-strong)', WHITE, 60)} w={1} />
      <F d="51.2,77 54,77 54,81.6 51.2,81.6" c={mix('var(--line-strong)', WHITE, 50)} />
      <Ear skin={SKIN.umber} />
      <Face st={renFace} mood={mood} uid={uid} extra={<F d="38.6,51.4 43,50.2 42.4,51.6 39.2,52.6" c={SKIN.umber.deep} o={0.8} />} />
      {/* fringe */}
      <F d="33,35 33.2,25 38,18 47,14.4 57,14.4 65,17.6 69.6,24 70.4,33 67.6,29.2 65.6,33.6 63,27.6 59.6,31.6 57,26.4 53,31.2 50.4,25.8 46,30.6 43.6,25.8 40,31.2 37.6,27.6 35.6,35" c={h.base} />
      <F d="44,26 50.4,25.8 46,30.6" c={h.shade} />
      <F d="31.6,33 35.6,33 35.8,40.6 32.6,39.6" c={h.base} />
      {/* goggles pushed up */}
      <F d="29.4,27.6 30.6,21.4 71,18.6 72.4,24.4" c={mix(BLACK, 'var(--line)', 50)} />
      <F d="38,16.4 48.8,15.6 51,18 50.8,25 48.4,26.6 39.6,27.2 37.2,24.8 37,18.6" c={mix('var(--line-strong)', 'var(--panel)', 60)} />
      <F d="39.8,18.4 48,17.8 49.2,19.4 49,24 47.6,25 40.6,25.4 39.2,24 39,19.8" c={mix(HELION, BLACK, 52)} />
      <F d="39.8,18.4 48,17.8 49.2,19.4 40,21.6" c={mix(HELION, WHITE, 60)} />
      <F d="41,23.6 46,20.4 47,21.4 42,24.8" c={mix(HELION, WHITE, 80)} o={0.7} />
      <F d="54.2,15.6 63.6,15 65.8,17.2 65.6,23 63.6,24.6 55.4,25 53.6,23.2 53.4,17.6" c={mix('var(--line-strong)', 'var(--panel)', 50)} />
      <F d="55.6,17.2 62.8,16.8 64,18.2 63.8,22.4 62.6,23.2 56,23.6 55,22.4 55,18.4" c={mix(HELION, BLACK, 45)} />
      <F d="55.6,17.2 62.8,16.8 64,18.2 55.6,20.2" c={mix(HELION, WHITE, 55)} />
      <F d="50.8,19.4 53.6,19.2 53.6,22.4 50.8,22.6" c={mix('var(--line-strong)', 'var(--panel)', 40)} />
    </g>
  );
};

// ---------------- Ilse Varga ----------------
const ilseFace: FaceStyle = { skin: SKIN.fair, brow: HAIR.silver.shade, iris: EYES.grey, browW: 1.7, expressive: 0, age: 2, jaw: 'gaunt', lip: SKIN.fair.deep };
const ilse: CastDraw = (mood, uid) => {
  const h = HAIR.silver;
  const coat = ramp(mix(HELION, 'var(--panel)', 22));
  const cap = ramp(mix(HELION, 'var(--panel)', 26));
  return (
    <g>
      {/* severe bun at the nape */}
      <F d="22.4,27 28,23.6 34,26 35.6,33 32.4,38.6 26.4,39.6 21.6,36 20.8,30.6" c={h.base} />
      <F d="21.6,36 26.4,39.6 32.4,38.6 34.6,35 28,36.2 23,33.6" c={h.shade} />
      <L d="24,28.4 30.6,27.6 M23.4,32.4 32,31.2" c={h.light} w={0.8} />
      <F d="31.2,28 33.8,27.2 35.6,33.2 33,34" c={mix(HELION, BLACK, 55)} />
      <F d="30.4,42 30,29 36,25 66,24 70.4,30 69.6,38 66.6,30 36,30 33.6,42" c={h.base} />
      <Torso c={coat} extra={<>
        {/* epaulette */}
        <F d="4,88 10,82 22,77.2 30,75.6 31,78.6 22,82 12,88.6 6,93" c={HELION} />
        <F d="6,93 12,88.6 22,82 31,78.6 31.4,80.4 22.6,84 13,90.6 7.6,95" c={mix(HELION, BLACK, 60)} />
        <L d="10,86 22,80.4" c={mix(HELION, WHITE, 60)} w={0.9} />
        {/* ribbons */}
        <F d="18,90 27,88 27.6,90.6 18.6,92.6" c={HELION} />
        <F d="18.6,92.6 27.6,90.6 28.2,93.2 19.2,95.2" c={TIDE} o={0.9} />
        <F d="28.6,88 31.6,87.4 32.2,90 29.2,90.6" c={mix(HELION, WHITE, 40)} />
        <L d="54,82 54,100" c={mix(HELION, BLACK, 30)} w={1.2} />
        <F d="52.6,86 55.4,86 55.4,88.6 52.6,88.6" c={HELION} />
        <F d="52.6,93 55.4,93 55.4,95.6 52.6,95.6" c={HELION} />
      </>} />
      <Neck skin={SKIN.fair} w={-1.4} />
      {/* stand collar */}
      <F d="37,80 38.6,65.4 50,69.4 64.4,65.4 66.4,79 52,82.6" c={coat.base} />
      <F d="38.6,65.4 50,69.4 64.4,65.4 64.8,68.4 50,72.4 38.4,68.4" c={HELION} />
      <F d="56,75 59,75 59,77.8 56,77.8|60.6,74.4 63.4,74.4 63.4,77.2 60.6,77.2" c={mix(HELION, WHITE, 50)} />
      <F d="56,70.6 59,70.6 59,73.4 56,73.4" c={mix(HELION, WHITE, 50)} />
      <Ear skin={SKIN.fair} />
      <Face st={ilseFace} mood={mood} uid={uid} />
      {/* tight hair at temple */}
      <F d="31.2,31 36.4,29 37,36.6 33.6,39.4 31.6,38" c={h.base} />
      <L d="32.4,31.6 35.4,30.4 M32.6,35 35.6,33.8" c={h.shade} w={0.7} />
      {/* officer cap */}
      <F d="30.4,26.8 32.4,15.6 40,10 54,8 66,9.8 72.4,15.4 73,24.6" c={cap.base} />
      <F d="62,10 66,9.8 72.4,15.4 73,24.6 64,25.2" c={cap.shade} />
      <F d="34,14 40,10 54,8 50,10.6 40,12.6" c={cap.light} o={0.6} />
      <F d="30.4,22.4 72.6,19.6 73,26 30.8,28.8" c={mix(BLACK, 'var(--panel)', 30)} />
      <L d="30.6,22.6 72.6,19.8" c={HELION} w={1} />
      <F d="44.6,28.4 72.8,25.6 79,29 74,31.6 60,31.4 46,32" c={mix(BLACK, 'var(--panel)', 20)} />
      <F d="60,26.8 72.8,25.6 77,28 66,28.4" c={mix('var(--line-strong)', BLACK, 40)} />
      <F d="56.4,15.4 64.4,14.8 65.4,23.6 57.4,24.2" c={HELION} />
      <SigilGlyph faction="helion" color="var(--on-helion)" x={57.4} y={16.2} size={7} />
      {/* rangefinder eyepiece over the near eye */}
      <L d="35.4,41.6 31,43" c={mix('var(--line-strong)', BLACK, 40)} w={1.6} />
      <path d="M38.2 36.8L51.4 36.2 53.4 39 53.2 47.6 51 50 38.8 50.4 36.6 47.8 36.6 39.4Z M40 39L50.2 38.6 51.4 40.4 51.2 46.6 49.8 48 40.2 48.4 38.8 46.8 38.8 40.6Z" style={{ fill: mix('var(--line-strong)', 'var(--panel)', 55) }} fillRule="evenodd" />
      <F d="40,39 50.2,38.6 51.4,40.4 51.2,46.6 49.8,48 40.2,48.4 38.8,46.8 38.8,40.6" c={mix(HELION, WHITE, 70)} o={0.18} />
      <L d="45,39.4 45,41 M45,46 45,47.6 M39.6,43.6 41.2,43.6 M48.8,43.4 50.4,43.4" c={HELION} w={0.6} />
      <F d="51,36.6 53.6,36.6 53.6,38.4 51,38.4" c="#ff4d3d" />
      <F d="36.4,44 38.4,44 38.4,47 36.4,47" c={mix('var(--line-strong)', BLACK, 30)} />
    </g>
  );
};

// ---------------- Sefa Tamura ----------------
const sefaFace: FaceStyle = { skin: SKIN.golden, brow: HAIR.ink.base, iris: EYES.dark, browW: 1.8, lashes: true, expressive: 0, jaw: 'soft', age: 1 };
const sefa: CastDraw = (mood, uid) => {
  const h = HAIR.ink;
  const coat = ramp(mix(TIDE, 'var(--panel)', 48));
  const braid: ReactNode[] = [];
  const segs: [number, number][] = [[30.5, 54], [29, 61], [27.6, 68], [26.4, 75], [25.4, 82], [24.6, 89]];
  segs.forEach(([x, y], i) => {
    braid.push(<F key={'b' + i} d={`${x - 4},${y} ${x - 0.4},${y - 4.4} ${x + 3.6},${y - 0.6} ${x + 0.4},${y + 4.4}`} c={i % 2 ? h.shade : h.base} />);
    braid.push(<L key={'l' + i} d={`${x - 2.6},${y - 1} ${x + 0.2},${y - 3.4}`} c={h.light} w={0.8} />);
  });
  return (
    <g>
      <F d="30.4,48 29.6,30 35,22 66,22 71,30 71.6,44 68,36 34,36 33.4,48" c={h.base} />
      <Torso c={coat} extra={<>
        <F d="3,90 9,83.6 22,78 31,75.6 30.4,79 22,82 11,88 5.6,94" c={SILVER_BRAID} />
        <F d="62,76 70,75 72,100 64,100" c={mix(TIDE, BLACK, 60)} />
        <L d="57.4,82 59.2,100" c={SILVER_BRAID} w={0.9} />
        <F d="55.6,85 60.6,84.6 60.8,86.4 55.8,86.8|56.2,91 61.2,90.6 61.4,92.4 56.4,92.8" c={SILVER_BRAID} />
      </>} />
      <Neck skin={SKIN.golden} w={-1.2} />
      {/* high naval collar */}
      <F d="36.4,82 37.6,63.4 49,68.4 50,83.6" c={coat.base} />
      <F d="51,83.6 51.4,68.8 63.4,63 67.8,78.4" c={coat.shade} />
      <L d="37.6,63.4 49,68.4 51.4,68.8 63.4,63" c={SILVER_BRAID} w={1} />
      <SigilGlyph faction="tidewell" color={SILVER_BRAID} x={40.4} y={72} size={6.4} />
      <Ear skin={SKIN.golden} />
      <Face st={sefaFace} mood={mood} uid={uid} />
      {/* parted hair under cap */}
      <F d="32.6,42 32,30 37,25.6 50,25 62,25.6 68.6,28.4 69.6,38 65,31 55,29.4 44,31.6 37.6,36.4 35,44" c={h.base} />
      <F d="44,31.6 55,29.4 65,31 56,30.8" c={h.light} o={0.7} />
      {/* braid over the near shoulder */}
      {braid}
      <F d="21.6,92 26.6,90.6 27.6,94.4 22.6,95.6" c={TIDE} />
      {/* naval cap */}
      <F d="29.4,25.6 30,17 38,11.4 54,9 68,11.4 74,16.6 73.6,23.4" c={'var(--ink)'} />
      <F d="62,11 68,11.4 74,16.6 73.6,23.4 64,24.4" c={mix('var(--ink)', 'var(--line-strong)', 70)} />
      <F d="29.6,21.6 73.6,18.4 73.8,24.8 30.2,28.2" c={mix(TIDE, BLACK, 55)} />
      <L d="30,24.6 73.6,21.4" c={SILVER_BRAID} w={0.9} />
      <F d="46,27.6 73.8,24.8 80,28.4 75,31 60,30.8 47.6,31.2" c={mix(BLACK, 'var(--panel)', 30)} />
      <F d="62,26.2 74,25 78,27.6 66,28" c={mix('var(--line-strong)', BLACK, 30)} />
      <SigilGlyph faction="tidewell" color={SILVER_BRAID} x={55.6} y={15.4} size={7.6} />
    </g>
  );
};

// ---------------- Dax Halloran ----------------
const daxFace: FaceStyle = { skin: SKIN.olive, brow: HAIR.chestnut.shade, iris: EYES.hazel, browW: 1.9, expressive: 1, jaw: 'narrow' };
const dax: CastDraw = (mood, uid) => {
  const h = HAIR.chestnut;
  const suit = ramp(mix(TIDE, 'var(--panel)', 26));
  const frame = mix('var(--line-strong)', 'var(--ink)', 40);
  return (
    <g>
      <F d="31.4,40 30.4,27 34,17 44,11 56,10 66,12.4 72,19 73,28 70.6,35 68,27 61,22 51,21 41,23 36,28 34.4,40" c={h.base} />
      <Torso c={suit} extra={<>
        {/* lapels, shirt, tie */}
        <F d="42,74 52,100 30,100 34,90 30,82" c={suit.light} o={0.55} />
        <F d="44,73.6 50.6,73 52.6,100 49,100" c={'var(--ink)'} />
        <F d="50.6,73 61,73.6 56,100 52.6,100" c={mix('var(--ink)', 'var(--line-strong)', 70)} />
        <F d="49.8,76 54,76 55,79.6 53.6,96 51.6,100 50,96 49,79.6" c={TIDE} />
        <F d="49.8,76 54,76 53.4,78.6 50.4,78.6" c={mix(TIDE, BLACK, 60)} />
        <F d="40,73.4 47.4,81 43,85 46.6,100 38,100 33.4,82" c={suit.base} />
        <F d="40,73.4 47.4,81 43,85 44.6,90 40.6,85 36,80" c={suit.light} o={0.35} />
        <F d="61.6,73.6 58,81.6 62,84 58.6,100 66,100 69,80" c={suit.shade} />
        <F d="22,86 30,84 30.4,86 22.6,88" c={mix(TIDE, WHITE, 55)} />
        <F d="22.6,86.6 25,84.4 26.6,86.4 24.4,88" c={'var(--ink)'} />
      </>} />
      <Neck skin={SKIN.olive} w={-1.6} />
      {/* starched collar */}
      <F d="40.6,74.6 41,66.6 50.6,70.6 51,76.6" c={'var(--ink)'} />
      <F d="51,76.6 51.6,70.6 61.4,65.6 61.4,74.6" c={mix('var(--ink)', 'var(--line-strong)', 72)} />
      <Ear skin={SKIN.olive} />
      <Face st={daxFace} mood={mood} uid={uid} />
      {/* slicked-back hair */}
      <F d="33.4,36 33,26 37,18.4 46,13.4 57,12.4 66,14.8 71,21 71.6,30 69,34 67,27 61,22.6 52,21.6 43,23 38,26.6 35.6,32 35.6,38" c={h.base} />
      <F d="38.6,19 47,14.6 57,13.6 50,16.6 42,20" c={h.light} />
      <F d="52,18.8 61.6,16.8 67.6,20.4 61,20 55,20.6" c={h.light} o={0.85} />
      <F d="62,22.4 67,27 69,34 67.4,26.6" c={h.shade} />
      <F d="33,30 35.6,30.6 35.8,39 33.6,38.6" c={h.shade} />
      {/* thin rectangular glasses */}
      <L d="36.4,42.6 32.4,43.2" c={frame} w={0.8} />
      <path d="M38.4 39.6L51.4 39 51.6 46.2 38.6 46.8Z M57.4 38.8L66.8 38.4 66.8 45.4 57.6 45.8Z" style={{ fill: WHITE }} opacity={0.12} />
      <path d="M38.4 39.6L51.4 39 51.6 46.2 38.6 46.8Z M57.4 38.8L66.8 38.4 66.8 45.4 57.6 45.8Z M51.4 41L57.4 40.8" style={{ fill: 'none', stroke: frame, strokeWidth: 0.9, strokeLinejoin: 'miter' }} />
      <F d="44,39.4 46.4,39.3 42,46.6 39.6,46.7" c={WHITE} o={mood === 'smug' ? 0.55 : 0.22} />
      <F d="62,38.6 63.4,38.6 60.4,45.7 59,45.7" c={WHITE} o={mood === 'smug' ? 0.45 : 0.18} />
    </g>
  );
};

// ---------------- Maru Ingram ----------------
const maruFace: FaceStyle = { skin: SKIN.bronze, brow: HAIR.ash.base, iris: EYES.dark, browW: 2.3, expressive: 1, age: 2, laughLines: true, closedHappy: true, jaw: 'broad' };
const maru: CastDraw = (mood, uid) => {
  const h = HAIR.ash;
  const shawl = ramp(mix(VERD, 'var(--terrain-ridge)', 38));
  const robe = ramp(mix('var(--terrain-ridge)', 'var(--panel)', 60));
  const straw = ramp(mix('var(--terrain-shoal)', 'var(--terrain-ridge)', 58));
  const vine = 'var(--terrain-canopy-detail)';
  const leaf = (x: number, y: number, r = 0, k = '') => <F k={k} d={`${x},${y} ${x + 3.2 * Math.cos(r)},${y + 3.2 * Math.sin(r)} ${x + 1.6 * Math.cos(r) - 1.4 * Math.sin(r)},${y + 1.6 * Math.sin(r) + 1.4 * Math.cos(r)}`} c={vine} />;
  return (
    <g>
      {/* long hair behind */}
      <F d="28,34 72,32 75,50 77,74 73,90 64,86 64,60 36,60 31,80 22,92 19,78 24,54" c={h.shade} />
      <Torso c={robe} extra={<>
        <F d="0,100 2,90 10,82 24,76 36,74 52,100" c={shawl.base} />
        <F d="36,74 52,100 44,100 32,80" c={shawl.shade} />
        <F d="62,74 76,76 90,84 98,94 100,100 70,100" c={shawl.shade} />
        <L d="2,90 10,82 24,76 36,74" c={VERD} w={1.4} />
        <L d="40,74 56,98" c={mix('var(--terrain-ridge)', BLACK, 50)} w={0.8} />
        <F d="52,90 59,90 55.5,97" c={VERD} />
        <path d="M55.5 91.4L57.4 89.9 53.6 89.9Z" style={{ fill: mix(VERD, BLACK, 50) }} />
      </>} />
      <Neck skin={SKIN.bronze} />
      <F d="38,78 40,68 52,73 64,68 66,78 52,84" c={shawl.light} />
      <L d="40,68 52,73 64,68" c={VERD} w={1.2} />
      <Ear skin={SKIN.bronze} />
      <Face st={maruFace} mood={mood} uid={uid} />
      {/* hair framing the face and falling forward */}
      <F d="32.2,48 31,32 36,26 64,25.6 70,30 71,46 74,66 70,82 66,74 67,52 66,34 37,32 35,48 34,64 30,84 26,88 28,64" c={h.base} />
      <F d="36,32 50,28.4 64,29 66,34 56,31.8 44,32.6 38,36" c={h.light} />
      <L d="31,58 33,70 29,82" c={h.shade} w={0.8} />
      <L d="69,48 71,62 69,76" c={h.shade} w={0.8} />
      {/* vine woven through the hair */}
      <L d="34,34 31.4,44 34,52 30.6,62 32.6,72 28.6,82" c={mix(vine, BLACK, 60)} w={1.4} />
      {leaf(31.6, 44, -2.4, 'a')}{leaf(34, 52, 0.4, 'b')}{leaf(30.6, 62, -2.6, 'c')}{leaf(32.6, 72, 0.2, 'd')}
      <L d="68,36 70,48 68.6,58 71,70" c={mix(vine, BLACK, 60)} w={1.2} />
      {leaf(70, 48, 0.4, 'e')}{leaf(68.6, 58, -2.8, 'f')}
      {/* wide-brim grove hat */}
      <F d="2,31.4 10,24.4 30,19.6 70,18.6 90,22 98.4,28.6 92,34 70,34.4 32,35.4 10,36.2" c={straw.base} />
      <F d="10,36.2 32,35.4 70,34.4 92,34 98.4,28.6 99,31 93,36.6 70,37.4 32,38.4 9,38.8 2,31.4" c={straw.deep} />
      <F d="30,23 33.4,9.4 46,4.6 60,4.6 68,8.6 70.6,22.6" c={straw.base} />
      <F d="60,4.6 68,8.6 70.6,22.6 63,23" c={straw.shade} />
      <F d="33.4,9.4 46,4.6 52,4.8 40,9.6 35,14" c={straw.light} o={0.7} />
      <F d="30.6,18.6 70.4,17 70.8,23 30.2,24.4" c={VERD} />
      <L d="31,21.2 70.4,19.8" c={mix(VERD, BLACK, 50)} w={0.8} />
      <L d="35,12 66,11 M33.6,15.4 68.8,14.4 M8,30 26,25.6 M74,23 92,26.4 M12,33.4 30,30.6 M72,28.6 92,31" c={straw.shade} w={0.7} />
      {/* sprout on the band */}
      <L d="62,18 63.6,11" c={mix(vine, BLACK, 40)} w={1} />
      <F d="63.6,11 68,8.6 66,12.6" c={vine} />
      <F d="63.4,13.6 59.6,11 61.4,14.8" c={vine} />
    </g>
  );
};

// ---------------- Juno Reyes-Abara ----------------
const junoFace: FaceStyle = { skin: SKIN.tan, brow: HAIR.rust.shade, iris: EYES.green, browW: 2, lashes: true, expressive: 2, closedHappy: true, jaw: 'young' };
const juno: CastDraw = (mood, uid) => {
  const h = HAIR.rust;
  const suit = ramp(mix(VERD, 'var(--panel-raised)', 50));
  const shell = ramp(VERD, 70, 72, 46);
  const freckles = [[40, 48.2], [42.6, 49.4], [38.6, 50.6], [44.2, 47.2], [57, 46.6], [62, 47.8], [64, 46.4], [60.2, 49.4]];
  return (
    <g>
      {/* helmet shell pushed back */}
      <F d="23.6,36 22.6,22 28,11.6 40,4.6 56,3.6 68,7.4 74,13 66,17 52,15.2 40,18 31,26 28,38" c={shell.base} />
      <F d="23.6,36 22.6,22 26,15 27.6,24 31,32 28,38" c={shell.shade} />
      <F d="30,12 40,6.4 54,5.4 46,8.4 36,12" c={shell.light} o={0.7} />
      {/* wild hair, back mass */}
      <F d="27,44 24,36 26.4,28 31,22 66,18 74,24 76,34 71.6,44 68,36 34,36 31,46" c={h.shade} />
      <Torso c={suit} extra={<>
        <F d="18,78.5 32,74.5 38,100 28,100" c={mix('var(--warn)', BLACK, 72)} />
        <F d="70,75 78,77.6 68,100 61,100" c={mix('var(--warn)', BLACK, 60)} />
        <F d="8,88 20,84 22,93 10,97" c={VERD} />
        <SigilGlyph faction="verdant" color="var(--on-verdant)" x={11.2} y={85.4} size={8.6} />
        <L d="53,74 54,100" c={suit.shade} w={1.2} />
      </>} />
      <Neck skin={SKIN.tan} />
      <F d="38,78 39,66.6 49,71 51,81" c={suit.light} />
      <F d="53,81 55,71 64,65.6 67.4,76" c={suit.base} />
      <F d="51,81 55,71 56,100 53,100" c={suit.shade} />
      <Ear skin={SKIN.tan} />
      <Face st={junoFace} mood={mood} uid={uid} extra={<g>{freckles.map(([x, y], i) => <path key={i} d={`M${x} ${y}h1v1h-1z`} style={{ fill: SKIN.tan.deep }} />)}</g>} />
      {/* wild fringe */}
      <F d="31.4,40 28,31 31.6,22.4 39,18 50,15.6 62,16 70,20 73.6,28 72,35 69,30 67.6,34.6 64.4,27.4 61,32.6 58,25.4 54,31 51,24.6 47,30.4 44,24.6 40.6,31 38,26 36,33.6 34,29.4 33.4,42" c={h.base} />
      <F d="38,20 48,16.6 58,16.6 52,19 42,22" c={h.light} />
      <F d="28.6,30 20.6,32.6 26,35.4 21.4,40.6 28.6,39.4 30,44" c={h.base} />
      <F d="70.4,21 78,22.4 73,25.4 79.4,29.4 72.6,30.6" c={h.base} />
      <F d="47,30.4 51,24.6 51.6,27" c={h.shade} />
      <F d="58,25.4 61,32.6 59,29" c={h.shade} />
      {/* visor flipped up + strap */}
      <F d="34,14 42,9.6 58,7.4 72,10.6 74.6,15.4 66,18 52,16.4 38,18.6" c={mix(BLACK, 'var(--signal-soft)', 40)} />
      <F d="44,10.4 58,8.4 68,10.8 56,10.6" c={mix('var(--signal)', WHITE, 60)} o={0.8} />
      <L d="27,36 31,46" c={mix(BLACK, 'var(--line)', 40)} w={2} />
      <F d="26,44 31.4,43 32.6,50.4 27.4,51.4" c={shell.shade} />
    </g>
  );
};

// ---------------- Corvin Ashgrave ----------------
const corvinFace: FaceStyle = { skin: SKIN.ruddy, brow: HAIR.steel.base, iris: EYES.blue, browW: 2.6, expressive: 1, age: 1, jaw: 'square' };
const corvin: CastDraw = (mood, uid) => {
  const h = HAIR.steel;
  const grey = HAIR.ash;
  const armour = ramp(mix(KEST, 'var(--panel)', 24));
  const beard = mix(h.base, grey.base, 55);
  return (
    <g>
      <F d="29.6,44 28,28 32,15 42,7 56,5 68,8 74,15 76,27 73,38 69,30 34,32 32.6,44" c={h.base} />
      <Torso c={armour} extra={<>
        {/* pauldron */}
        <F d="0,92 3,84 12,77.6 26,74 32,76 26,84 12,92 4,100 0,100" c={armour.light} />
        <L d="3,84 12,77.6 26,74 32,76" c={GOLD} w={1.4} />
        <L d="4,92 12,86 24,81" c={GOLD} w={0.9} />
        <F d="60,76 98,94 100,100 64,100" c={mix(KEST, BLACK, 40)} />
        <L d="62,80 96,96" c={GOLD} w={1} />
        <F d="40,86 52,84 54,96 42,98" c={armour.shade} />
        <SigilGlyph faction="kestrel" color={GOLD} x={42.6} y={85.4} size={9.4} />
      </>} />
      <Neck skin={SKIN.ruddy} w={0.6} />
      {/* armour gorget, layered */}
      <F d="34,82 35.6,64.4 52,71 68,64.4 69.4,80 52,86" c={armour.base} />
      <F d="35.6,64.4 52,71 68,64.4 68.4,68.6 52,75 35.4,69" c={armour.light} />
      <L d="35.6,64.4 52,71 68,64.4" c={GOLD} w={1.3} />
      <L d="35.2,72 52,78.6 68.8,72" c={GOLD} w={0.9} />
      <F d="60,68 68,64.4 69.4,80 60,83.6" c={armour.shade} o={0.8} />
      <Ear skin={SKIN.ruddy} />
      <Face st={corvinFace} mood={mood} uid={uid} extra={
        <g>
          {/* trimmed beard + moustache */}
          <F d="33.6,46 35.6,53.6 40.6,60 47.4,64.4 54.6,66.2 60.6,64 64.6,58.6 66.8,51 65,51.6 62,56.8 59.6,59.8 56,61.4 52.4,61 49,61.4 45,58.8 40.8,54.6 37.4,49.4" c={beard} />
          <F d="52.4,61 56,61.4 59.6,59.8 58.6,63.2 55,64.6 51,63.6" c={mix(beard, BLACK, 75)} />
          <F d="49.6,55.6 53.4,53.6 56,54.4 58.8,53.6 62.6,55.4 61.2,56.6 56,55.8 51,56.8" c={beard} />
          <F d="40.6,60 47.4,64.4 54.6,66.2 50,64 43,60" c={mix(beard, BLACK, 70)} />
        </g>} />
      {/* swept hair with grey streaks */}
      <F d="31.6,38 31,26 35,16.4 44,10 56,8.4 66,10.6 72,16.6 73.4,27 71,34 68.6,27 62,22 51,21 42,23 37,28 34.4,38" c={h.base} />
      <F d="37,17 46,11.4 57,10 50,13.6 41,19" c={grey.base} />
      <F d="50,18 60,13.2 68,15.6 61,17.6 54,20" c={grey.light} />
      <F d="42,23 51,21 47,22.8" c={grey.base} />
      <F d="31,29 35.4,29.6 35.4,39 32.4,39" c={grey.base} />
      <F d="62,22 68.6,27 71,34 69.4,26.4" c={h.shade} />
    </g>
  );
};

// ---------------- Sable Ashgrave ----------------
const sableFace: FaceStyle = { skin: SKIN.pale, brow: HAIR.raven.base, iris: EYES.grey, browW: 1.8, lashes: true, expressive: 0, jaw: 'narrow' };
const sable: CastDraw = (mood, uid) => {
  const h = HAIR.raven;
  const jacket = ramp(mix(KEST, 'var(--void)', 16));
  const scarf = ramp(mix(KEST, 'var(--panel-raised)', 36));
  return (
    <g>
      <F d="31,40 30,26 35,16 45,11 57,10 67,13.6 72,21 73,34 72,46 69.4,40 34,32 32.4,40" c={h.base} />
      <Torso c={jacket} extra={<>
        <L d="7,84 18,78.5 32,74.5" c={KEST} w={1} />
        <F d="62,76 70,76 66,100 58,100" c={mix(KEST, BLACK, 30)} o={0.6} />
      </>} />
      <Neck skin={SKIN.pale} w={-1.6} />
      {/* scarf wrapped high, tail over the shoulder */}
      <F d="33,82 35,63.6 46,68 58,69 66,62.6 70.4,72 67,84 54,88 42,87" c={scarf.base} />
      <F d="35,63.6 46,68 58,69 66,62.6 67.4,66.4 58,73 46,72.4 35,68" c={scarf.light} />
      <L d="34.4,74 50,78.6 68.6,74.6" c={scarf.shade} w={1.2} />
      <F d="60,70 66,62.6 70.4,72 67,84 60,86" c={scarf.shade} />
      <F d="33,78 22,84 14,96 16,100 28,100 30,92 38,84" c={scarf.base} />
      <F d="22,84 14,96 16,100 19,100 24,89 32,82" c={scarf.shade} />
      <L d="18,98 26,86" c={KEST} w={1} />
      <Ear skin={SKIN.pale} />
      <Face st={sableFace} mood={mood} uid={uid} />
      {/* asymmetric cut: undercut on the near side, long bang to the far side */}
      <F d="31.4,38 31,30 34,24 36,24.6 36.6,38" c={mix(h.base, SKIN.pale.shade, 55)} />
      <L d="32.4,30 32.6,36.6 M34.4,28 34.6,36.6" c={h.base} w={0.6} />
      <F d="34,26 36,17.4 45,12 57,11.2 67,14.6 72,22 72.6,34 71.6,47 69,54 67,44 66,36 61.4,29.6 56,27 47,25.4 40,27 36.4,30" c={h.base} />
      <F d="40,17.6 50,13.6 60,14 52,16.6 44,20" c={h.light} />
      <F d="56,27 61.4,29.6 66,36 67,44 64.6,35.6 60,30.4" c={h.light} o={0.5} />
      {/* night visor */}
      <F d="33,38.6 69.6,36.8 70,45.8 61.6,47.4 55.6,46.4 48.6,48.4 34,47.4" c={mix('var(--choir)', 'var(--signal-soft)', 50)} o={0.62} />
      <L d="33,38.6 69.6,36.8" c={KEST} w={0.8} />
      <F d="38,39.4 41.6,39.2 38.6,47 35.8,47" c={WHITE} o={0.12} />
      <F d="62,37.8 64,37.7 61.8,46.8 60.4,47" c={WHITE} o={0.1} />
      <F d="33,40 30.6,40.6 30.4,45.4 33,46.4" c={mix(KEST, BLACK, 40)} />
      <F d="31,42 32.6,42 32.6,44 31,44" c={'var(--signal)'} />
    </g>
  );
};

// ---------------- Cantor ----------------
const CANTOR_EYES: Record<Mood, { near: string; far: string }> = {
  neutral: { near: '40,43 44,41.2 50,41.6 49,43.6 44,44.4', far: '57.8,42.2 62,41.2 65.6,42 64.6,43.6 59,43.8' },
  happy: { near: '40,44 44,41.4 50,42.4 49.6,43.4 44,42.8 41,44.8', far: '57.8,42.8 62,41 65.6,42.6 64.8,43.4 61.6,42.4 58.4,43.6' },
  angry: { near: '40,41.6 49.6,43.4 49.6,44.6 44,44.6 40.4,43', far: '57.8,43.4 65.6,41 65.6,42.6 61,44.2 58,44.4' },
  grim: { near: '40,43.4 50,43 49.6,44.6 40.4,44.6', far: '57.8,43 65.6,42.6 65.2,44 58.2,44.2' },
  surprised: { near: '40,43 43,39.6 48,39.4 50.6,43 48,46.4 43,46.6', far: '57.6,42.6 60,39.6 64,39.4 66,42.6 64,45.6 60,45.8' },
  smug: { near: '40,43.6 50,42.6 49.6,44 44,44.8', far: '57.8,42.6 65.6,41.2 65.4,42.8 59,43.8' },
};
const CANTOR_MOUTH: Record<Mood, string> = {
  neutral: '50.8,57.6 56,57.2 60.6,57.6',
  happy: '50.6,56.6 53,58.2 58.6,58.2 61.4,56.4',
  angry: '50.4,58.8 53,57 59,57 61.4,58.8',
  grim: '50.6,58.6 52.6,57.8 59,57.8 61,58.6',
  surprised: '53.4,57 58.6,57 59.6,59.6 58.6,61.6 53.4,61.6 52.4,59.6 53.4,57',
  smug: '51,58 56,58.2 60.6,56.6 62,55.6',
};
const CANTOR_BROW: Record<Mood, [string, string]> = {
  neutral: ['39,37.6 50.6,36.6', '57.6,36.4 66.4,37.2'],
  happy: ['39,36.6 50.6,35', '57.6,34.8 66.4,36.2'],
  angry: ['39,36.4 50.6,39.6', '57.6,39.4 66.4,36'],
  grim: ['39,38.6 50.6,38.2', '57.6,38 66.4,38.4'],
  surprised: ['39,35 50.6,32.6', '57.6,32.4 66.4,34.6'],
  smug: ['39,38.2 50.6,37.6', '57.6,34.4 66.4,35.2'],
};
const cantor: CastDraw = (mood, uid) => {
  const obs = mix('var(--choir)', 'var(--line-strong)', 74);
  const obsShade = 'var(--choir)';
  const obsLight = mix('var(--choir)', 'var(--line-strong)', 40);
  const red = 'var(--on-choir)';
  const cable = mix('var(--choir)', 'var(--line-strong)', 60);
  const glow = `${uid}-cg`;
  const cables: [string, number][] = [
    ['40,16 30,20 22,32 18,50 14,70 10,92', 3.4],
    ['46,13 34,18 27,32 24,52 22,72 20,96', 3.2],
    ['52,12 42,18 33,32 31,52 30,72 32,96', 3],
    ['60,13 66,20 70,32 72,48 74,64 78,80', 3],
    ['56,12 50,20 38,30 28,42 22,58 26,80', 2.6],
    ['64,16 70,26 74,40 78,54 84,72 90,86', 2.6],
  ];
  const lit = (mood === 'angry' ? 1 : mood === 'grim' ? 0.55 : 0.85);
  return (
    <g>
      <defs>
        <filter id={glow} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.2" /></filter>
      </defs>
      {/* cable hair, back layer */}
      {cables.slice(0, 4).map(([d, w], i) => <L key={i} d={d} c={i % 2 ? cable : mix(cable, BLACK, 70)} w={w} />)}
      <Torso c={{ light: obsLight, base: obs, shade: obsShade, deep: BLACK }} extra={<>
        <L d="7,84 18,78.5 32,74.5 44,72" c={red} w={0.8} o={0.8} />
        <L d="30,100 36,84 44,78 M72,100 66,84 60,78" c={red} w={0.7} o={0.6} />
        <path d="M46 86l6 -3.4 6 3.4v7l-6 3.4 -6 -3.4Z" style={{ fill: 'none', stroke: red, strokeWidth: 1 }} opacity={lit} />
      </>} />
      {/* segmented neck */}
      <F d="43,54 42.4,78 52,82 60.6,78 60.4,58" c={obsShade} />
      {[62, 67, 72].map((y) => <F key={y} d={`43,${y} 60.6,${y + 1} 60.6,${y + 3} 43,${y + 2}`} c={obs} />)}
      <L d="43,64.6 60.6,65.6 M43,69.6 60.6,70.6" c={red} w={0.5} o={lit} />
      <F d="36,80 38,68 52,73 66,68 68,80 52,86" c={obsLight} />
      <L d="38,68 52,73 66,68" c={red} w={0.8} o={lit} />
      {/* faceplate */}
      <Face st={{ skin: { light: obsLight, base: obs, shade: obsShade, deep: BLACK }, brow: obs, iris: obs, jaw: 'soft', noBrows: true, hideFarEye: true }} mood="neutral" uid={uid + 'c'} />
      {/* cover the default features with plate */}
      <F d="37,35 52,34 56,36 58,34 67,35 67.4,47 63,50 58,47 55,50 52,48 48,49 38,48" c={obs} />
      <F d="59,34 67,35 67.4,47 63,50 62,40" c={obsShade} />
      <F d="50,50 56,49 60,56 56,60 51,59" c={obs} />
      <F d="37,40 42,39 44,48 39.4,50" c={obsLight} o={0.6} />
      <F d="55.4,41 59.8,50.4 58.2,52.4 54.6,52.2 53.4,50.8 55.2,49.6" c={obsShade} />
      <F d="56.6,42 59.4,49 58.6,49.6 56,43.6" c={obsLight} />
      {/* glowing seams */}
      <g opacity={lit}>
        <g filter={`url(#${glow})`}>
          <L d={CANTOR_EYES[mood].near.split(' ').concat(CANTOR_EYES[mood].near.split(' ')[0]).join(' ')} c={red} w={1.6} />
          <L d={CANTOR_EYES[mood].far.split(' ').concat(CANTOR_EYES[mood].far.split(' ')[0]).join(' ')} c={red} w={1.4} />
        </g>
        <F d={CANTOR_EYES[mood].near} c={red} />
        <F d={CANTOR_EYES[mood].far} c={red} />
        <F d={CANTOR_EYES[mood].near} c={WHITE} o={0.35} />
        <L d={CANTOR_BROW[mood][0]} c={red} w={0.9} />
        <L d={CANTOR_BROW[mood][1]} c={red} w={0.8} />
        <L d={CANTOR_MOUTH[mood]} c={red} w={1.1} />
        <L d="54.6,20 55.6,33" c={red} w={0.6} />
        <L d="37.6,50 41,56.6 46,61.4" c={red} w={0.6} />
        <L d="63.4,50 61,56.4 58,60.2" c={red} w={0.6} />
        <L d="53,62.6 56,65" c={red} w={0.6} />
      </g>
      {/* cable hair, front layer */}
      <F d="34,30 33,22 38,16 46,12 56,11 64,13 69,19 70,28 67,24 60,20 50,19 41,22 36,28" c={cable} />
      {cables.slice(4).map(([d, w], i) => <L key={'f' + i} d={d} c={i ? cable : mix(cable, WHITE, 80)} w={w} />)}
      {[[27.6, 32], [24, 52], [22, 58], [72, 48], [31, 52], [74, 40]].map(([x, y], i) => (
        <F key={'r' + i} d={`${x - 2},${y - 1} ${x + 2},${y - 1} ${x + 2},${y + 1} ${x - 2},${y + 1}`} c={red} o={lit} />
      ))}
      <L d="40,18 50,15 60,16" c={mix(cable, WHITE, 60)} w={0.8} />
    </g>
  );
};

// ---------------- VESPER ----------------
type Cell = { q: number; r: number; x: number; y: number };
const VESPER_CELLS: Cell[] = (() => {
  const out: Cell[] = [];
  const s = 6.4; // cell spacing
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) {
    if (Math.abs(q + r) > 3) continue;
    out.push({ q, r, x: 50 + s * (q + r / 2), y: 48 + s * 0.866 * r });
  }
  return out;
})();
const ring = (c: Cell) => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r));
function vesperLight(mood: Mood, c: Cell): number {
  const d = ring(c);
  const ny = (c.y - 48) / 19.2, nx = (c.x - 50) / 19.2;
  let v = d === 0 ? 0 : d === 1 ? 0.5 : d === 2 ? 1 : 0.62;
  switch (mood) {
    case 'happy': if (ny > 0.32 - nx * nx * 0.9) v *= 0.08; break;
    case 'angry': if (ny < -0.34 + nx * 0.5) v *= 0.06; else v = Math.min(1, v * 1.25 + 0.15); break;
    case 'grim': if (ny < -0.12) v *= 0.06; else v *= 0.7; break;
    case 'surprised': v = d === 0 ? 0.2 : d === 1 ? 0.15 : d === 2 ? 0.8 : 1; break;
    case 'smug': if (ny < -0.4 - nx * 0.36) v *= 0.06; if (ny > 0.62) v *= 0.15; break;
    default: break;
  }
  return v;
}
const vesper: CastDraw = (mood, uid) => {
  const red = 'var(--on-choir)';
  const glow = `${uid}-vg`;
  const cellPath = (c: Cell, r: number) => {
    let d = '';
    for (let i = 0; i < 6; i++) {
      const a = ((60 * i + 30) * Math.PI) / 180;
      d += (i ? 'L' : 'M') + (c.x + r * Math.cos(a)).toFixed(2) + ' ' + (c.y + r * Math.sin(a)).toFixed(2);
    }
    return d + 'Z';
  };
  const frame = (r: number) => cellPath({ q: 0, r: 0, x: 50, y: 48 }, r);
  const lights = VESPER_CELLS.map((c) => ({ c, v: vesperLight(mood, c) }));
  const lit = lights.filter((l) => l.v > 0.1);
  const pupilR = mood === 'surprised' ? 1.6 : mood === 'angry' ? 2.4 : 3;
  return (
    <g>
      <defs>
        <filter id={glow} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      {/* the broken hexagon, vast and dim */}
      <path d={frame(44)} style={{ fill: 'none', stroke: mix('var(--choir)', 'var(--line-strong)', 60), strokeWidth: 3 }} />
      <path d={frame(36)} style={{ fill: mix('var(--choir)', BLACK, 50) }} />
      <path d={frame(36)} style={{ fill: 'none', stroke: mix(red, 'var(--choir)', 40), strokeWidth: 1.4 }} />
      <path d="M14 86L88 8" style={{ stroke: 'var(--choir)', strokeWidth: 6 }} />
      <path d="M14 86L88 8" style={{ stroke: mix(red, 'var(--choir)', 30), strokeWidth: 1 }} />
      {/* glow */}
      <g filter={`url(#${glow})`}>
        {lit.map(({ c, v }, i) => <path key={i} d={cellPath(c, 3.4)} style={{ fill: red }} opacity={v * 0.9} />)}
      </g>
      {lights.map(({ c, v }, i) => (
        <g key={i}>
          <path d={cellPath(c, 3.1)} style={{ fill: v > 0.1 ? red : mix('var(--choir)', 'var(--line-strong)', 80) }} opacity={v > 0.1 ? 0.35 + v * 0.65 : 0.6} />
          {v > 0.85 && <path d={cellPath(c, 1.4)} style={{ fill: mix(red, WHITE, 45) }} />}
        </g>
      ))}
      <path d={frame(pupilR + 1.6)} style={{ fill: BLACK }} />
      <path d={frame(pupilR * 0.45)} style={{ fill: mix(red, WHITE, 40) }} opacity={mood === 'grim' ? 0.4 : 1} />
      {mood === 'angry' && <>
        <path d="M18 30L30 34M82 30L70 34M50 6V14M16 64L28 60M84 64L72 60" style={{ stroke: red, strokeWidth: 2.2 }} />
      </>}
      {mood === 'surprised' && <path d={frame(30)} style={{ fill: 'none', stroke: red, strokeWidth: 0.8, strokeDasharray: '2 3' }} />}
      {/* scanlines */}
      <path d={Array.from({ length: 24 }, (_, i) => `M0 ${i * 4 + 1}h100`).join('')} style={{ stroke: BLACK, strokeWidth: 0.8 }} opacity={0.25} />
    </g>
  );
};

// ---------------- ECHO ----------------
const echo: CastDraw = (mood, uid) => {
  const c = 'var(--signal)';
  const soft = mix('var(--signal)', WHITE, 55);
  const glow = `${uid}-eg`;
  const W = 2.2;
  const eyes: Record<Mood, ReactNode> = {
    neutral: <>
      <path d="M36 38h-2v12h2M48 38h2v12h-2M54 38h-2v12h2M66 38h2v12h-2" />
      <path d="M38.5 41h7v6h-7zM56.5 41h7v6h-7z" style={{ fill: c, stroke: 'none' }} />
    </>,
    happy: <path d="M35 47l7 -7 7 7M53 47l7 -7 7 7" />,
    angry: <>
      <path d="M34 36l15 5M66 36l-15 5" />
      <path d="M36 42h-2v8h2M48 43h2v7h-2M54 43h-2v7h-2M66 42h2v8h-2" />
      <path d="M38.5 45h7v3.4h-7zM56.5 45h7v3.4h-7z" style={{ fill: c, stroke: 'none' }} />
    </>,
    grim: <>
      <path d="M34 44h15M53 44h15" />
      <path d="M36 47h12M54 47h12" style={{ opacity: 0.5 }} />
    </>,
    surprised: <>
      <path d="M33 36h17v16h-17zM52 36h17v16h-17z" />
      <path d="M40 42.5h3v3h-3zM59 42.5h3v3h-3z" style={{ fill: c, stroke: 'none' }} />
    </>,
    smug: <>
      <path d="M34 44.5h15M36 41h11" />
      <path d="M53 47l7 -6 7 6" />
    </>,
  };
  const mouths: Record<Mood, ReactNode> = {
    neutral: <><path d="M42 60h14" /><path d="M59 56.6h3v6h-3z" style={{ fill: c, stroke: 'none' }} /></>,
    happy: <path d="M38 57v3l3 3h18l3 -3v-3" />,
    angry: <path d="M40 63l4 -4h12l4 4" />,
    grim: <path d="M41 61h18" style={{ opacity: 0.7 }} />,
    surprised: <path d="M45 57h10v8h-10z" />,
    smug: <path d="M41 61h11l8 -4" />,
  };
  const face = (
    <g style={{ fill: 'none', stroke: c, strokeWidth: W, strokeLinecap: 'square', strokeLinejoin: 'miter' }}>
      {/* head as cursor brackets */}
      <path d="M26 30V18h12M74 30V18H62M26 58v10l10 8M74 58v10l-10 8M44 80h12" />
      <path d="M22 38v12M78 38v12" style={{ opacity: 0.55 }} />
      {eyes[mood]}
      {mouths[mood]}
    </g>
  );
  return (
    <g>
      <defs>
        <filter id={glow} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.8" /></filter>
      </defs>
      <path d={Array.from({ length: 11 }, (_, i) => `M${i * 10} 0V100M0 ${i * 10}H100`).join('')} style={{ stroke: c, strokeWidth: 0.3 }} opacity={0.22} />
      <g filter={`url(#${glow})`} opacity={0.9}>{face}</g>
      {face}
      <path d="M26 18h4M70 18h4" style={{ stroke: soft, strokeWidth: W }} />
      <R d="M0 88h100v12H0z" c={mix('var(--signal)', BLACK, 20)} o={0.35} />
    </g>
  );
};

/** Fallback for minor characters: a faceless helmeted silhouette. */
export const generic: CastDraw = () => (
  <g>
    <F d={BUST} c={mix('var(--line-strong)', 'var(--panel)', 50)} />
    <F d="42,56 42,76 60,76 60,58" c={mix('var(--line-strong)', 'var(--panel)', 30)} />
    <F d="33,40 34,22 44,14 58,14 68,22 68,44 62,58 52,62 40,56" c={mix('var(--line-strong)', 'var(--panel)', 70)} />
    <F d="36,36 66,34 66,44 36,46" c={mix('var(--signal)', BLACK, 40)} />
  </g>
);

export const CAST: Record<string, CastDraw> = { ren, ilse, sefa, dax, maru, juno, corvin, sable, cantor, vesper, echo };
