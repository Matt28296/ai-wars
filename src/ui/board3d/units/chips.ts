// The two billboard chips above a unit: an HP chip (below 10) and a status chip. Drawn once into small canvas textures and
// shared by every unit that needs the same one. In a test with no DOM there is no canvas: a flat 1 x 1 texture stands in, so the
// rest of the code runs the same either way.
import { CanvasTexture, DataTexture, RGBAFormat, SRGBColorSpace, SpriteMaterial } from 'three';
import type { Texture } from 'three';
import type { UnitStatusKind } from '../../watch/unitview';
import { UI } from '../palette';

/** 'blank' is the invisible placeholder a hidden chip holds, so a sprite never owns a private default material. */
export type ChipKey = 'blank' | `hp:${number}` | `status:${UnitStatusKind}`;

const SIZE = 96;
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function canvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The HP number on a dark plate: white, and a danger red at 3 or less. Never colour alone: the number is the cue. */
function drawHp(g: CanvasRenderingContext2D, hp: number): void {
  const low = hp <= 3;
  roundRect(g, 8, 8, SIZE - 16, SIZE - 16, 20);
  g.fillStyle = 'rgba(10,14,20,0.92)';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = low ? css(UI.danger) : '#e8edf3';
  g.stroke();
  g.fillStyle = low ? css(UI.danger) : '#ffffff';
  g.font = '800 60px system-ui, "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(hp), SIZE / 2, SIZE / 2 + 4);
}

/** A status glyph on a dark plate. Each kind has its own SHAPE, so it never rests on colour alone. */
function drawStatus(g: CanvasRenderingContext2D, kind: UnitStatusKind): void {
  const tone = kind === 'capturing' ? UI.signal : kind === 'loaded' ? 0xe8edf3 : UI.warn;
  roundRect(g, 8, 8, SIZE - 16, SIZE - 16, 20);
  g.fillStyle = 'rgba(10,14,20,0.92)';
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = css(tone);
  g.stroke();
  g.fillStyle = css(tone);
  g.strokeStyle = css(tone);
  g.lineWidth = 6;
  g.lineJoin = 'round';
  const c = SIZE / 2;
  if (kind === 'capturing') {
    // a flag on a pole
    g.fillRect(31, 22, 6, 52);
    g.beginPath();
    g.moveTo(37, 24);
    g.lineTo(70, 34);
    g.lineTo(37, 46);
    g.closePath();
    g.fill();
  } else if (kind === 'low-charge') {
    // a lightning bolt
    g.beginPath();
    g.moveTo(c + 8, 18);
    g.lineTo(c - 16, c + 6);
    g.lineTo(c - 1, c + 6);
    g.lineTo(c - 8, 78);
    g.lineTo(c + 18, c - 8);
    g.lineTo(c + 3, c - 8);
    g.closePath();
    g.fill();
  } else if (kind === 'low-ammo') {
    // a shell: round tip over a flat base, with a base ring
    g.beginPath();
    g.moveTo(c - 13, 72);
    g.lineTo(c - 13, 44);
    g.quadraticCurveTo(c - 13, 20, c, 18);
    g.quadraticCurveTo(c + 13, 20, c + 13, 44);
    g.lineTo(c + 13, 72);
    g.closePath();
    g.fill();
    g.fillRect(c - 19, 68, 38, 8);
  } else {
    // loaded: a crate with a lid line
    g.strokeRect(c - 20, c - 17, 40, 36);
    g.beginPath();
    g.moveTo(c - 20, c - 4);
    g.lineTo(c + 20, c - 4);
    g.moveTo(c, c - 17);
    g.lineTo(c, c - 4);
    g.stroke();
  }
}

export interface Chip {
  texture: Texture;
  material: SpriteMaterial;
}

/** Build one chip. Shared and counted by the resource cache; the caller never builds a chip directly. */
export function buildChip(key: ChipKey): Chip {
  const c = canvas();
  const g = c?.getContext('2d') ?? null;
  let texture: Texture;
  if (c && g) {
    if (key.startsWith('hp:')) drawHp(g, Number(key.slice(3)));
    else if (key !== 'blank') drawStatus(g, key.slice(7) as UnitStatusKind);
    texture = new CanvasTexture(c);
  } else {
    texture = new DataTexture(new Uint8Array(key === 'blank' ? [0, 0, 0, 0] : [20, 28, 40, 235]), 1, 1, RGBAFormat);
    texture.needsUpdate = true;
  }
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  return { texture, material };
}
