// Dev-only contact sheet for the portraits (gallery-portraits.html; `vite build` ignores it).
//   /gallery-portraits.html                  every speaker x every mood at 96px, the neutral at 48px in the real frame, 192px, and silhouettes
//   /gallery-portraits.html?focus=rook       one speaker at a large size (all six moods, then the silhouette); &size=256 sets the size,
//                                            &moods=happy,angry picks moods
//   /gallery-portraits.html?ids=rook,ilse&size=450&moods=neutral    several speakers, side by side
import { createElement as h } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import '../../styles/tokens.css';
import '../watch/kit/kit.css';
import { COMMANDERS } from '../../content/commanders';
import { CommanderPortrait } from '../watch/kit/CommanderPortrait';
import { MOODS, PORTRAIT_IDS, portraitSvg, portraitUrl } from './index';
import type { Mood } from './index';

const params = new URLSearchParams(window.location.search);

const nameOf = (id: string): string => COMMANDERS[id]?.name ?? id;
const subOf = (id: string): string => {
  const c = COMMANDERS[id];
  return c ? `${c.faction ?? 'helion adjutant'} / ${c.title}` : '';
};

function img(id: string, mood: Mood, size: number): ReactElement {
  return h('img', { src: portraitUrl(id, mood), width: size, height: size, alt: `${id} ${mood}` });
}

function silhouette(id: string, size: number, key: string = id): ReactElement {
  const url = `data:image/svg+xml,${encodeURIComponent(portraitSvg(id, 'neutral', { ground: false }))}`;
  return h('div', { className: 'cell sil', key }, h('img', { src: url, width: size, height: size, alt: `${id} silhouette` }), h('span', null, id));
}

function frame(id: string, mood: Mood, size: number): ReactElement {
  const c = COMMANDERS[id];
  return h(CommanderPortrait, { id, mood, name: c?.name, initials: c?.initials, faction: c?.faction ?? null, size });
}

function contactSheet(): ReactElement {
  const head = h(
    'div',
    { className: 'row head' },
    h('div', { className: 'name' }),
    ...MOODS.map((m) => h('div', { className: 'cell', key: m }, m)),
    h('div', { className: 'cell' }, '48 frame'),
    h('div', { className: 'cell' }, '96 frame'),
  );
  const rows = PORTRAIT_IDS.map((id) =>
    h(
      'div',
      { className: 'row', key: id },
      h('div', { className: 'name' }, nameOf(id), h('small', null, subOf(id))),
      ...MOODS.map((m) => h('div', { className: 'cell', key: m }, img(id, m, 96))),
      h('div', { className: 'cell' }, frame(id, 'neutral', 48)),
      h('div', { className: 'cell' }, frame(id, 'happy', 96)),
    ),
  );
  const big = h(
    'div',
    { className: 'strip' },
    h('h2', null, 'Neutral at 192px'),
    ...PORTRAIT_IDS.map((id) => h('div', { className: 'cell', key: id }, img(id, 'neutral', 192), h('span', null, id))),
  );
  const sil = h(
    'div',
    { className: 'strip' },
    h('h2', null, 'Black silhouettes at 96px and 48px'),
    ...PORTRAIT_IDS.map((id) => silhouette(id, 96, `${id}-96`)),
    h('div', { key: 'break', style: { width: '100%' } }),
    ...PORTRAIT_IDS.map((id) => silhouette(id, 48, `${id}-48`)),
  );
  return h('div', null, h('h1', null, 'Ascendant Wars / commander portraits'), h('p', { className: 'note' }, '11 speakers x 6 moods. Rows: moods at 96px, then the real CommanderPortrait frame at 48px (HUD) and 96px (cut-in).'), head, ...rows, big, sil);
}

function focusSheet(id: string, size: number): ReactElement {
  const only = params.get('moods')?.split(',') ?? [];
  const moods = only.length ? MOODS.filter((m) => only.includes(m)) : MOODS;
  const cols = size >= 320 ? 3 : 6;
  return h(
    'div',
    null,
    h('h1', null, `${nameOf(id)} / ${subOf(id)}`),
    h('div', { className: 'grid', style: { gridTemplateColumns: `repeat(${cols}, ${size}px)` } }, ...moods.map((m) => h('div', { className: 'cell', key: m }, img(id, m, size), h('span', null, m)))),
    h('div', { className: 'strip' }, h('h2', null, 'silhouette and small sizes'), silhouette(id, 192, 'a'), silhouette(id, 96, 'b'), silhouette(id, 48, 'c'), h('div', { className: 'cell' }, frame(id, 'neutral', 48)), h('div', { className: 'cell' }, frame(id, 'neutral', 96))),
  );
}

function multiSheet(ids: string[], size: number): ReactElement {
  const only = params.get('moods')?.split(',') ?? ['neutral'];
  const moods = MOODS.filter((m) => only.includes(m));
  const cols = Math.max(1, Math.floor((window.innerWidth - 40) / (size + 10)));
  return h(
    'div',
    null,
    h('div', { className: 'grid', style: { gridTemplateColumns: `repeat(${cols}, ${size}px)` } }, ...ids.flatMap((id) => moods.map((m) => h('div', { className: 'cell', key: `${id}-${m}` }, img(id, m, size), h('span', null, `${id} ${m}`))))),
  );
}

const root = document.getElementById('root');
if (root) {
  const focus = params.get('focus');
  const size = Number(params.get('size')) || 256;
  const ids = params.get('ids')?.split(',').filter((id) => PORTRAIT_IDS.includes(id)) ?? [];
  createRoot(root).render(ids.length ? multiSheet(ids, size) : focus && PORTRAIT_IDS.includes(focus) ? focusSheet(focus, size) : contactSheet());
}
