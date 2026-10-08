// Local preview harness: renders each components/<Comp>/preview.html the way the system page frames it
// (tokens.css, fonts, bundle.css, React libs, bundle.js preloaded; data-theme set) and screenshots both themes.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const proj = join(here, '..', 'project');
const out = process.argv[2] || join(here, 'out', 'shots');
const only = process.argv[3] ? process.argv[3].split(',') : null;
mkdirSync(out, { recursive: true });

const css = readFileSync(join(here, 'out', 'tokens.css'), 'utf8').replace(/url\("\.\.\/\.\.\/project\//g, `url("file://${proj}/`) + '\n' + readFileSync(join(proj, 'components', 'bundle.css'), 'utf8');
const libs = ['components/lib/react.production.min.js', 'components/lib/react-dom.production.min.js', 'components/bundle.js'].map((p) => readFileSync(join(proj, p), 'utf8'));

const browser = await chromium.launch();
const comps = readdirSync(join(proj, 'components')).filter((d) => existsSync(join(proj, 'components', d, 'preview.html')) && (!only || only.includes(d)));
for (const name of comps) {
  const src = readFileSync(join(proj, 'components', name, 'preview.html'), 'utf8');
  const m = /height=(\d+)/.exec(src.split('\n')[0]);
  const height = m ? +m[1] : 120;
  const wm = /width=(\d+)/.exec(src.split('\n')[0]);
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: wm ? +wm[1] : 960, height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    const head = `<style>${css}</style>` + libs.map((s) => `<script>${s}</script>`).join('');
    const html = src.replace(/^<!--.*?-->\n/, '').replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`).replace('<head>', '<head>' + head).replace('<html>', `<html data-theme="${theme}">`);
    const file = join(out, `${name}.${theme}.html`);
    writeFileSync(file, html);
    await page.goto('file://' + file);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(out, `${name}.${theme}.png`), fullPage: true });
    if (errors.length) console.log('ERRORS', name, theme, errors);
    await page.close();
  }
  console.log('rendered', name);
}
await browser.close();
