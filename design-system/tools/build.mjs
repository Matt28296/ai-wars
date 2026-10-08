// Builds every derived file from tokens.src.mjs + game.src.mjs + bundle.src.js:
//   design-system/project/tokens.json, assets/*/*.svg, components/bundle.js
//   design-system/tools/out/tokens.css  (local preview harness only — the system page compiles its own)
//   src/data/base.generated.ts, src/styles/tokens.css, public/fonts/*  (the game)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from './tokens.src.mjs';
import * as G from './game.src.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ds = join(here, '..', 'project');
const repo = join(here, '..', '..');
const w = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };

// ---------- tokens.json ----------
const tokens = {
  name: 'Ascendant Wars',
  version: 1,
  color: { themes: T.themes, tokens: T.colors },
  type: T.type,
  spacing: T.spacing,
  radius: T.radius,
  size: T.size,
  shadow: T.shadow,
};
w(join(ds, 'tokens.json'), JSON.stringify(tokens, null, 2) + '\n');

// ---------- tokens.css (as the page compiles it) ----------
const first = T.themes[0].id;
const val = (t, th) => (typeof t.value === 'string' ? t.value : t.value[th] ?? t.value[first]);
const asCss = (v) => v.replace(/\{([^}]+)\}/g, 'var(--$1)');
function tokensCss(fontUrl) {
  let css = `/* Ascendant Wars — generated from tokens.json */\n`;
  for (const f of T.type.fonts) css += `@font-face { font-family: "${f.family}"; src: url("${fontUrl(f.file)}") format("woff2"); font-weight: ${f.weight}; font-style: ${f.style || 'normal'}; font-display: swap; }\n`;
  css += `:root, [data-theme="${first}"] {\n`;
  for (const t of [...T.colors, ...T.shadow.tokens]) css += `  --${t.name}: ${asCss(val(t, first))};\n`;
  css += '}\n';
  for (const th of T.themes.slice(1)) {
    css += `[data-theme="${th.id}"] {\n`;
    for (const t of [...T.colors, ...T.shadow.tokens]) if (typeof t.value !== 'string' && t.value[th.id]) css += `  --${t.name}: ${asCss(t.value[th.id])};\n`;
    css += '}\n';
  }
  css += ':root {\n';
  for (const fam of [T.spacing, T.radius, T.size]) for (const t of fam.tokens) css += `  --${t.name}: ${t.value};\n`;
  for (const [k, v] of Object.entries(T.type.families)) css += `  --font-${k}: ${v};\n`;
  css += '}\n';
  for (const g of T.type.groups) for (const s of g.styles) {
    css += `.${s.name} { font-family: var(--font-${s.family || g.family}); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight};${s.letterSpacing ? ` letter-spacing: ${s.letterSpacing};` : ''} }\n`;
  }
  return css;
}
w(join(here, 'out', 'tokens.css'), tokensCss((f) => `../../project/${f}`));
w(join(repo, 'src', 'styles', 'tokens.css'), tokensCss((f) => `/${f}`));
mkdirSync(join(repo, 'public', 'fonts'), { recursive: true });
for (const f of readdirSync(join(ds, 'fonts'))) copyFileSync(join(ds, 'fonts', f), join(repo, 'public', 'fonts', f));

// ---------- SVG assets (literal first-theme hex: <img> cannot read tokens) ----------
const hex = (name) => { const t = T.colors.find((c) => c.name === name); if (!t) throw new Error('no token ' + name); return val(t, first); };
const pathsSvg = (list, fill) => list.map((p) => (typeof p === 'string' ? `<path d="${p}"/>` : `<path d="${p.d}"${p.evenodd ? ' fill-rule="evenodd"' : ''}/>`)).join('');
for (const [id, list] of Object.entries(G.sigils)) {
  const ink = id === 'echo' ? hex('signal') : id === 'choir' ? hex('on-choir') : hex(id);
  w(join(ds, 'assets', 'Sigils', `${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96" fill="${ink}">${pathsSvg(list)}</svg>\n`);
}
for (const [id, list] of Object.entries(G.glyphs)) {
  w(join(ds, 'assets', 'Units', `${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="${hex('ink')}">${pathsSvg(list)}</svg>\n`);
}
const roleHex = (c) => hex(c === 'struct' ? 'terrain-structure' : c === 'struct-detail' ? 'terrain-structure-detail' : c);
for (const [id, art] of Object.entries(G.terrainArt)) {
  const body = `<rect width="32" height="32" fill="${roleHex(art.base)}"/>` + art.shapes.map((s) => `<path fill="${roleHex(s.c)}" d="${s.d}"/>`).join('');
  w(join(ds, 'assets', 'Terrain', `${id}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="96" height="96" shape-rendering="geometricPrecision">${body}</svg>\n`);
}

// ---------- bundle.js ----------
const DATA = {
  factions: G.factions, units: G.units, terrain: G.terrain, moveTypes: G.moveTypes, commanders: G.commanders,
  art: { glyphs: G.glyphs, sigils: G.sigils, terrain: G.terrainArt },
};
const COMPONENTS = ['Button', 'CommandMenu', 'BuildMenu', 'StatusChip', 'Sigil', 'UnitToken', 'MapTile', 'TerrainCard', 'UnitCard', 'BattleForecast', 'CommanderPortrait', 'PowerMeter', 'PlayerHud', 'DialogueBox', 'TurnBanner'];
const header = `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace: 'Ascendant', components: COMPONENTS.map((name) => ({ name })) })} */\n`;
const src = readFileSync(join(here, 'bundle.src.js'), 'utf8').replace('__DATA__', JSON.stringify(DATA));
const bundle = header + src;
if (/<\/script|<!--/i.test(bundle)) throw new Error('bundle contains </script or <!--');
w(join(ds, 'components', 'bundle.js'), bundle);

// ---------- game data ----------
w(join(repo, 'src', 'data', 'base.generated.ts'),
  `// GENERATED by design-system/tools/build.mjs from design-system/tools/game.src.mjs — do not edit by hand.\n` +
  `/* eslint-disable */\n` +
  `export const FACTIONS = ${JSON.stringify(G.factions, null, 2)} as const;\n\n` +
  `export const MOVE_TYPES = ${JSON.stringify(G.moveTypes, null, 2)} as const;\n\n` +
  `export const UNITS = ${JSON.stringify(G.units, null, 2)};\n\n` +
  `export const TERRAIN = ${JSON.stringify(G.terrain, null, 2)};\n\n` +
  `export const COMMANDER_BASE = ${JSON.stringify(G.commanders, null, 2)};\n\n` +
  `export const ART = ${JSON.stringify({ glyphs: G.glyphs, sigils: G.sigils, terrain: G.terrainArt })};\n`);

console.log('built: tokens.json, tokens.css x2, %d sigils, %d unit glyphs, %d terrain tiles, bundle.js (%d bytes), base.generated.ts',
  Object.keys(G.sigils).length, Object.keys(G.glyphs).length, Object.keys(G.terrainArt).length, bundle.length);
