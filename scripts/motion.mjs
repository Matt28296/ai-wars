#!/usr/bin/env node
// `pnpm motion`: measures how the game MOVES (frame pacing, how fast and how smoothly units glide, the camera, the playback cadence) in a real
// browser, and keeps a bigger board from costing frames. The measurements, the budgets and the caveats are in docs/delivery/MOTION.md.
//
//   pnpm motion --port 5312                      serve this checkout's production build (`pnpm build` first) with `vite preview`, measure it, stop it
//   pnpm motion --url http://127.0.0.1:5311/     measure a build that is already being served (main's, say)
//   pnpm motion --port 5312 --out report.json --compare baseline.json     print the deltas; exit 1 when a budget is broken
//   other flags: --sizes desktop,phone  --speeds 1,2,4  --scenarios deploy,demo,live  --steps 10  --max-seconds 60  --settle-seconds 45
//                --pin low@0.7   (adds ?quality=low&scale=0.7, to compare builds on equal footing)    --shots <dir>   (screenshots at scale 1, 0.7, 0.5)
//                --second-load   (after each scenario, load the page again in the same browser profile and time how long the tier and scale take to settle:
//                                 the device remembers where it settled, so the second load should be quick)    --label <text>  --tolerance 0.1
//
// It resolves Playwright from the repo if it is there, else from $PLAYWRIGHT_MODULE, else /opt/node22/lib/node_modules/playwright; it never installs
// anything. A build with the in-page recorder (`?probe=motion`, src/ui/watch/motion) is measured in "recorder" mode; one without (main has none) in
// "page" mode: the page's own requestAnimationFrame intervals, long tasks and the step changes read from `.aww-root[data-step]`. `--compare` weighs
// only the metrics both sides have.
//
// The TypeScript analysis is loaded through vite's SSR loader, as scripts/agent.mjs and scripts/balance.mjs do, so there is no build step for it.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const die = (line, code = 2) => {
  console.error(`motion: ${line}`);
  process.exit(code);
};

// ---------------------------------------------------------------- arguments

const BOOLEAN_FLAGS = new Set(['second-load']);
const FLAGS = new Set(['port', 'url', 'out', 'compare', 'label', 'sizes', 'speeds', 'scenarios', 'steps', 'max-seconds', 'settle-seconds', 'pin', 'shots', 'tolerance', 'start']);
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (!a.startsWith('--')) die(`unexpected argument "${a}"`);
    const [k, inline] = a.slice(2).split('=');
    if (k === 'help') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 14).map((l) => l.slice(3)).join('\n'));
      process.exit(0);
    }
    if (BOOLEAN_FLAGS.has(k)) {
      out[k] = true;
      continue;
    }
    if (!FLAGS.has(k)) die(`unknown flag --${k}`);
    out[k] = inline ?? argv[++i];
    if (out[k] === undefined) die(`--${k} needs a value`);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const list = (v, all) => (v === undefined ? all : v.split(',').map((s) => s.trim()).filter(Boolean));
const num = (v, d) => (v === undefined ? d : Number(v));

const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const sizes = list(args.sizes, ['desktop', 'phone']);
const speeds = list(args.speeds, ['1', '2', '4']).map(Number);
const scenarios = list(args.scenarios, ['deploy', 'demo', 'live']);
const STEPS = num(args.steps, 10);
const MAX_SECONDS = num(args['max-seconds'], 60);
const SETTLE_SECONDS = num(args["settle-seconds"], 90);
const TOLERANCE = num(args.tolerance, 0.1);
for (const s of sizes) if (!SIZES[s]) die(`unknown size "${s}" (desktop, phone)`);
for (const s of speeds) if (![1, 2, 4].includes(s)) die(`unknown speed "${s}" (1, 2, 4)`);
for (const s of scenarios) if (!['deploy', 'demo', 'live'].includes(s)) die(`unknown scenario "${s}" (deploy, demo, live)`);
if (!args.port && !args.url) die('give --port <n> (serve this checkout\'s build) or --url <served build>');
if (args.port && args.url) die('give --port or --url, not both');
let pin = null;
if (args.pin) {
  const m = /^(high|medium|low)@(1|0\.85|0\.7|0\.5)$/.exec(args.pin);
  if (!m) die(`--pin wants tier@scale, e.g. low@0.7 (got "${args.pin}")`);
  pin = { tier: m[1], scale: Number(m[2]) };
}
const START_STEP = { deploy: 1, demo: 2, live: 1 };

// ---------------------------------------------------------------- Playwright, never installed

function loadPlaywright() {
  const tries = [() => require.resolve('playwright', { paths: [ROOT] }), () => process.env.PLAYWRIGHT_MODULE, () => '/opt/node22/lib/node_modules/playwright'];
  for (const t of tries) {
    let p;
    try {
      p = t();
    } catch {
      p = undefined;
    }
    if (!p) continue;
    try {
      return require(p);
    } catch {
      // try the next place
    }
  }
  return die(`Playwright was not found (looked in this repo, $PLAYWRIGHT_MODULE and /opt/node22/lib/node_modules/playwright); this script never installs anything`);
}

// ---------------------------------------------------------------- serving the build

let previewGroup = null;
function stopPreview() {
  if (previewGroup === null) return;
  try {
    process.kill(-previewGroup, 'SIGTERM');
  } catch {
    // already gone
  }
  previewGroup = null;
}

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error(`${url} did not answer in ${ms} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function startPreview(port) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) die('dist/index.html is missing: run `pnpm build` first (with DATABASE_URL unset), then `pnpm motion`');
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) die('node_modules/vite is missing: dependencies are not installed');
  // its own process group (detached): stopping it stops vite and anything vite started, and nothing else
  const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  previewGroup = child.pid;
  let err = '';
  child.stderr.on('data', (d) => { err += String(d); });
  child.on('exit', (code) => { if (previewGroup !== null && code) console.error(`motion: vite preview stopped (${code}): ${err.trim().split('\n').pop()}`); });
  try {
    await waitFor(`http://127.0.0.1:${port}/`, 30_000);
  } catch (e) {
    stopPreview();
    die(`could not serve the build on port ${port}: ${e.message}${err ? ` (${err.trim().split('\n').pop()})` : ''}`);
  }
  return `http://127.0.0.1:${port}/`;
}

// ---------------------------------------------------------------- the TypeScript the script shares with the game

let viteSsr = null;
async function ssr() {
  if (!viteSsr) {
    viteSsr = await createServer({
      root: ROOT, configFile: false, appType: 'custom', logLevel: 'error',
      server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
    });
  }
  return viteSsr;
}

/** G17's feed, played through a short scripted match by the real tools, so the live view has a real battle to watch. Stops itself with close(). */
async function startScriptedFeed() {
  const vite = await ssr();
  const feedMod = await vite.ssrLoadModule('/src/agent/feed.ts');
  const matchMod = await vite.ssrLoadModule('/src/agent/match.ts');
  const toolsMod = await vite.ssrLoadModule('/src/agent/tools.ts');
  const feed = await feedMod.startFeed({ site: null });
  let host;
  const session = new toolsMod.AgentSession({ feed, makeHost: (m) => (host = new matchMod.AgentMatch(m, { maxCycles: 4 })) });
  session.startMission('first-light');
  // the move that goes farthest, so the glides are long enough to measure; the end of the turn when nothing is left to do
  for (let n = 0; !host.result() && n < 400; n++) {
    const legal = session.legalActions().data;
    let best = null;
    let far = -1;
    for (const u of legal.units) {
      for (const a of u.actions) {
        const d = Math.abs(a.to[0] - u.from[0]) + Math.abs(a.to[1] - u.from[1]);
        if (d > far) {
          far = d;
          best = a.id;
        }
      }
    }
    if (best === null && legal.builds.length) best = legal.builds[0].id;
    if (best) session.act(best);
    else session.endTurn();
  }
  return { liveUrl: feed.liveUrl, close: () => feed.close() };
}

// ---------------------------------------------------------------- what runs inside the page

/** Installed before the page's own scripts: page-level samples that exist on EVERY build, recorder or not. */
function pageProbe(feedUrl) {
  const S = { raf: [], longtasks: [], steps: [], holds: [] };
  window.__awPage = S;
  const loop = (t) => {
    S.raf.push(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) S.longtasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // no long-task entries in this browser
  }
  let held = false;
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.target.classList && m.target.classList.contains('aww-root')) {
        S.steps.push({ t: performance.now(), step: Number(m.target.getAttribute('data-step')) });
      }
    }
    const now = !!document.querySelector('[data-story]');
    if (now !== held) {
      held = now;
      S.holds.push({ t: performance.now(), open: now });
    }
  });
  const start = () => mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-step'] });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
  if (feedUrl) {
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(u, o) {
        super(u === '/live' ? feedUrl : u, o);
      }
    };
  }
}

/** One look at the page, in the page: where the battle is, what is open, and it dismisses a story beat (the story is skipped, not measured). */
function pageState() {
  const root = document.querySelector('.aww-root');
  const stage = document.querySelector('.aww-stage3d');
  const beat = document.querySelector('[data-story="beat"]');
  if (beat) {
    const skip = [...beat.querySelectorAll('button')].find((b) => /skip/i.test(b.textContent || ''));
    if (skip) skip.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  const count = (document.querySelector('.aww-scrub-count')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
  const play = document.querySelector('.aww-playpause');
  return {
    step: root ? Number(root.getAttribute('data-step')) : -1,
    last: count ? Number(count[2]) : -1,
    playing: play ? /pause/i.test(play.getAttribute('aria-label') || '') : false,
    beat: !!beat,
    debrief: !!document.querySelector('[data-story="debrief"]'),
    tier: stage ? stage.getAttribute('data-quality') : null,
    scale: stage ? stage.getAttribute('data-scale') : null,
    hasCanvas: !!(stage && stage.querySelector('canvas')),
    flat: !!document.querySelector('.aww-stage[data-renderer="2d"], .aww-stage:not([data-renderer])'),
    recorder: typeof window.__awMotion === 'object' && window.__awMotion !== null && typeof window.__awMotion.read === 'function',
    now: performance.now(),
  };
}

function pageSeek(n) {
  const el = document.querySelector('.aww-scrub input[type="range"]');
  if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(n));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function pageSpeed(speed) {
  const b = [...document.querySelectorAll('.aww-speeds button')].find((x) => (x.textContent || '').trim() === `${speed}x`);
  if (b) b.click();
  return !!b;
}

function pagePlay() {
  const play = document.querySelector('.aww-playpause');
  if (play && !/pause/i.test(play.getAttribute('aria-label') || '')) play.click();
}

// ---------------------------------------------------------------- measuring one scenario

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function addressOf(base, scenario, extra = '') {
  const q = ['probe=motion'];
  if (pin) q.push(`quality=${pin.tier}`, `scale=${pin.scale}`);
  if (extra) q.push(extra);
  const hash = { deploy: '#/mission/first-light/watch', demo: '#play=1', live: '#/live' }[scenario];
  return `${base}?${q.join('&')}${hash}`;
}

/** Waits until the page's tier and scale have not changed for `quiet` seconds (the adaptive step has settled), skipping story as it goes. */
async function settle(page, quietS, capS, tNav = Date.now()) {
  const t0 = Date.now();
  let last = '';
  let since = Date.now();
  // `reachedS` is when the state it ended at was reached, from the start of the navigation: the last change of tier or scale, the first reading included
  const done = (st, capped) => ({ tier: st.tier, scale: st.scale, waited: (Date.now() - t0) / 1000, reachedS: Math.round(((since - tNav) / 1000) * 10) / 10, ...(capped ? { capped: true } : {}) });
  for (;;) {
    const st = await page.evaluate(pageState);
    const key = `${st.tier}@${st.scale}`;
    if (st.tier && key !== last) {
      last = key;
      since = Date.now();
    }
    if (Date.now() - since >= quietS * 1000 && st.tier) return done(st, false);
    if (Date.now() - t0 >= capS * 1000) return done(st, true);
    await sleep(500);
  }
}

async function measureSpeed(page, A, scenario, size, speed, startStep) {
  await page.evaluate(pageSpeed, speed);
  await page.evaluate(pageSeek, startStep);
  await sleep(300);
  await page.evaluate(pagePlay);
  const begin = await page.evaluate(() => {
    if (window.__awMotion) window.__awMotion.reset();
    return performance.now();
  });
  const t0 = Date.now();
  let st = await page.evaluate(pageState);
  const goal = startStep + STEPS;
  let note = null;
  while (st.step < goal) {
    if (Date.now() - t0 > MAX_SECONDS * 1000) {
      note = `stopped at ${MAX_SECONDS} s with ${Math.max(0, st.step - startStep)} of ${STEPS} steps`;
      break;
    }
    if (st.last >= 0 && st.step >= st.last) {
      note = 'reached the end of the battle';
      break;
    }
    if (st.debrief) {
      note = 'reached the debrief';
      break;
    }
    if (!st.playing && !st.beat) await page.evaluate(pagePlay);
    await sleep(250);
    st = await page.evaluate(pageState);
  }
  const data = await page.evaluate(({ begin: b }) => {
    const S = window.__awPage;
    const end = performance.now();
    const within = (t) => t >= b && t <= end;
    return {
      end,
      raf: S.raf.filter(within),
      longtasks: S.longtasks.filter((t) => t.start >= b && t.start <= end),
      steps: S.steps.filter((s) => within(s.t)),
      holds: S.holds,
      recording: window.__awMotion ? window.__awMotion.read() : null,
    };
  }, { begin });
  return { data, begin, steps: { from: startStep, to: st.step }, note, tier: st.tier, scale: st.scale === null ? 1 : Number(st.scale) };
}

/** Story hold spans (open, close) from the page's observer, clipped to the run. */
function holdSpans(holds, begin, end) {
  const spans = [];
  let open = null;
  for (const h of holds) {
    if (h.open) open = h.t;
    else if (open !== null) {
      spans.push({ from: open, to: h.t });
      open = null;
    }
  }
  if (open !== null) spans.push({ from: open, to: end });
  return spans.filter((s) => s.to > begin && s.from < end);
}

function summarise(A, scenario, size, speed, m) {
  const holds = holdSpans(m.data.holds, m.begin, m.data.end);
  // the frames: the recorder's drawn frames where there is one (the stage may choose not to draw at a step boundary on a slow machine, and the page's
  // own animation-frame ticks would count those as frames), else the page's animation-frame ticks (a build without a recorder draws on every one)
  const rec = m.data.recording;
  const page = rec && rec.frames.length > 1
    ? A.framePacing(rec.frames.map((x) => x.t), m.data.longtasks, rec.frames.map((x) => x.js), rec.frames.map((x) => x.skips > 0))
    : A.framePacing(m.data.raf, m.data.longtasks);
  const frameSource = rec && rec.frames.length > 1 ? 'recorder' : 'raf';
  // page-level cadence: steps per second from the step changes, with story holds left out
  const sp = [];
  for (let i = 1; i < m.data.steps.length; i++) {
    const a = m.data.steps[i - 1];
    const b = m.data.steps[i];
    if (b.step !== a.step + 1) continue;
    if (holds.some((h) => h.from < b.t && h.to > a.t)) continue;
    sp.push(b.t - a.t);
  }
  const pageSteps = { steps: sp.length, perSec: sp.length ? Math.round((sp.length / (sp.reduce((x, y) => x + y, 0) / 1000)) * 1000) / 1000 : null };
  const engine = rec ? A.analyseMotion(rec, { holds }) : null;
  const run = {
    scenario, size, speed, mode: rec ? 'recorder' : 'page', tier: m.tier, scale: m.scale, steps: m.steps, note: m.note, holds: holds.length,
    page: { pacing: page, steps: pageSteps, frameSource }, engine,
  };
  run.metrics = flatten(run);
  return run;
}

/** The numbers --compare weighs, by name. A metric only one side has is not compared. */
function flatten(run) {
  const m = {};
  const p = run.page.pacing;
  m['frame.fps'] = p.fps;
  m['frame.drawFps'] = p.drawFps;
  m['frame.maxStill'] = p.maxStillMs;
  m['frame.p50'] = p.interval.p50;
  m['frame.p95'] = p.interval.p95;
  m['frame.p99'] = p.interval.p99;
  m['frame.max'] = p.interval.max;
  m['frame.dropped'] = p.droppedShare;
  m['frame.over50ms'] = p.over50Share;
  m['longtask.count'] = p.longTasks.count;
  m['longtask.totalMs'] = p.longTasks.totalMs;
  if (run.page.steps.perSec !== null) m['page.steps.perSec'] = run.page.steps.perSec;
  if (run.engine) {
    const e = run.engine;
    if (e.pacing.js) {
      m['engine.js.p50'] = e.pacing.js.p50;
      m['engine.js.p95'] = e.pacing.js.p95;
    }
    const c = e.cadence.perSpeed.find((x) => x.speed === run.speed);
    if (c) {
      m['engine.cadence.ratio'] = c.ratio;
      m['engine.steps.perSec'] = c.stepsPerSec;
    }
    const g = e.glide.beats.filter((b) => b.measuredMsPerTile !== null);
    if (g.length) m['engine.glide.msPerTile'] = Math.round((g.reduce((a, b) => a + b.measuredMsPerTile, 0) / g.length) * 10) / 10;
    if (e.glide.steadiness && e.glide.steadiness.mean !== null) {
      m['engine.glide.steadiness.mean'] = e.glide.steadiness.mean;
      m['engine.glide.steadiness.max'] = e.glide.steadiness.max;
    }
  }
  return m;
}

// ---------------------------------------------------------------- the scenario runner

async function runScenario(pw, browser, A, base, scenario, size, feedUrl) {
  const vp = SIZES[size];
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: size === 'phone', hasTouch: size === 'phone' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(pageProbe, scenario === 'live' ? feedUrl : null);
  const runs = [];
  try {
    const tNav = Date.now();
    await page.goto(addressOf(base, scenario), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.aww-root', { timeout: 90_000 });
    await page.waitForSelector('.aww-stage3d canvas', { timeout: 30_000 }).catch(() => {});
    const first = await page.evaluate(pageState);
    if (!first.hasCanvas) throw new Error('the 3D board did not start (no WebGL canvas); nothing to measure');
    const info = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null, sha: document.getElementById('root')?.getAttribute('data-build') || null };
    });
    const settled = await settle(page, 15, SETTLE_SECONDS, tNav);
    console.error(`  ${scenario}/${size}: settled at ${settled.tier}@${settled.scale ?? 1}, reached ${settled.reachedS} s after the load${settled.capped ? ' (capped)' : ''}`);
    for (const speed of speeds) {
      const m = await measureSpeed(page, A, scenario, size, speed, START_STEP[scenario]);
      const run = summarise(A, scenario, size, speed, m);
      run.settle = settled;
      runs.push(run);
      console.error(`    ${speed}x: ${run.page.pacing.fps} fps, ${run.page.pacing.frames} frames, steps ${m.steps.from}->${m.steps.to}${m.note ? ` (${m.note})` : ''}`);
    }
    // the second load, in the same browser profile: the device has remembered where it settled
    let second = null;
    if (args['second-load'] && !pin) {
      const again = await ctx.newPage();
      await again.addInitScript(pageProbe, scenario === 'live' ? feedUrl : null);
      const t1 = Date.now();
      await again.goto(addressOf(base, scenario), { waitUntil: 'domcontentloaded' });
      await again.waitForSelector('.aww-root', { timeout: 90_000 });
      await again.waitForSelector('.aww-stage3d canvas', { timeout: 30_000 }).catch(() => {});
      const s2 = await settle(again, 10, SETTLE_SECONDS, t1);
      const stored = await again.evaluate(() => { try { return window.localStorage.getItem('aw.quality.v1'); } catch { return null; } });
      second = { scenario, size, first: { tier: settled.tier, scale: settled.scale === null ? 1 : Number(settled.scale), reachedS: settled.reachedS }, second: { tier: s2.tier, scale: s2.scale === null ? 1 : Number(s2.scale), reachedS: s2.reachedS }, stored };
      console.error(`  ${scenario}/${size}: second load settled at ${s2.tier}@${s2.scale ?? 1} in ${s2.reachedS} s (first load: ${settled.reachedS} s); stored ${stored ?? 'nothing'}`);
      await again.close();
    }
    return { runs, info, errors, second };
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------- screenshots

async function shoot(pw, browser, base, dir) {
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const size of sizes) {
    for (const scale of [1, 0.7, 0.5]) {
      const ctx = await browser.newContext({ viewport: SIZES[size], deviceScaleFactor: 1, isMobile: size === 'phone', hasTouch: size === 'phone' });
      const page = await ctx.newPage();
      try {
        await page.goto(`${base}?probe=motion&quality=low&scale=${scale}#step=22&viewer=all`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.aww-stage3d canvas', { timeout: 60_000 });
        await sleep(9000); // the intro is over and the picture has settled
        const dims = await page.evaluate(() => {
          const c = document.querySelector('.aww-stage3d canvas');
          return { buffer: [c.width, c.height], css: [Math.round(c.clientWidth), Math.round(c.clientHeight)], scale: document.querySelector('.aww-stage3d').getAttribute('data-scale') };
        });
        const file = join(dir, `board-${size}-scale-${String(scale).replace('.', '_')}.png`);
        await page.screenshot({ path: file });
        files.push({ file, ...dims });
        console.error(`  shot ${file}: buffer ${dims.buffer.join('x')} for a ${dims.css.join('x')} canvas (data-scale ${dims.scale})`);
      } finally {
        await ctx.close();
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------- budgets and the comparison

// the comparison rules (which metrics, which direction, the slack, the floor rule) are src/ui/watch/motion/compare.ts, loaded in main()
let keyOf = (r) => `${r.scenario}/${r.size}/${r.speed}x`;

function absoluteBudgets(report) {
  const out = [];
  for (const run of report.runs) {
    if (!run.engine) continue;
    for (const v of run.engine.verdicts) if (v.applies && !v.ok) out.push({ run: keyOf(run), budget: v.check, detail: v.reason });
  }
  return out;
}

// ---------------------------------------------------------------- printing

const f = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? '-' : Number(n).toFixed(d));

function printSummary(report) {
  console.log(`\nmotion: ${report.label || report.url}   build ${report.build.sha ? report.build.sha.slice(0, 9) : '?'}   ${report.machine.renderer || 'unknown renderer'}`);
  console.log('        (software rendering: absolute fps is a floor; only same-machine comparisons count. See docs/delivery/MOTION.md)');
  console.log('        fps = frames over the wall clock, gaps included; draw = the rate while drawing; still = the longest the picture did not change (ms)');
  console.log('run                     mode      tier@scale  fps  draw   p50   p95   p99   max still  drop% >50% gaps(n/ms) LT(n/ms)  js50/95  steps/s  cadence  ms/tile steady  checks');
  for (const r of report.runs) {
    const p = r.page.pacing;
    const e = r.engine;
    const c = e ? e.cadence.perSpeed.find((x) => x.speed === r.speed) : null;
    const g = r.metrics['engine.glide.msPerTile'];
    const steadyMean = r.metrics['engine.glide.steadiness.mean'];
    const failed = e ? (e.failed.length ? `FAIL ${e.failed.join(',')}` : 'ok') : 'n/a';
    console.log([
      keyOf(r).padEnd(23), r.mode.padEnd(9), `${r.tier}@${r.scale}`.padEnd(11), f(p.fps).padStart(4), f(p.drawFps).padStart(5), f(p.interval.p50, 0).padStart(5), f(p.interval.p95, 0).padStart(5),
      f(p.interval.p99, 0).padStart(5), f(p.interval.max, 0).padStart(5), f(p.maxStillMs, 0).padStart(5), f(p.droppedShare * 100, 0).padStart(5), f(p.over50Share * 100, 0).padStart(5),
      `${p.gaps.count}/${f(p.gaps.totalMs, 0)}`.padStart(11), `${p.longTasks.count}/${f(p.longTasks.totalMs, 0)}`.padStart(9),
      (p.js ? `${f(p.js.p50, 0)}/${f(p.js.p95, 0)}` : '-').padStart(8),
      f(r.metrics['engine.steps.perSec'] ?? r.metrics['page.steps.perSec'], 2).padStart(8), (c ? f(c.ratio, 2) : '-').padStart(8), (g === undefined ? '-' : f(g, 0)).padStart(8), (steadyMean === undefined ? '-' : f(steadyMean, 2)).padStart(6), failed,
    ].join(' '));
    if (r.note) console.log(`    note: ${r.note}`);
  }
  if (report.secondLoads && report.secondLoads.length) {
    console.log('\ntime to settle, first load -> second load in the same profile (tier@scale reached, seconds after the load):');
    for (const s of report.secondLoads) console.log(`  ${s.scenario}/${s.size}: ${s.first.tier}@${s.first.scale} ${s.first.reachedS} s  ->  ${s.second.tier}@${s.second.scale} ${s.second.reachedS} s`);
  }
  const glide = report.runs.filter((r) => r.engine && r.engine.glide.beats.length);
  if (glide.length) {
    console.log('\nglide checks (measured ms per tile against the spec: 240 at 1x, 120 at 2x; none at 4x; steadiness = peak per-frame speed / mean speed, final tile left out):');
    for (const r of glide) {
      const beats = r.engine.glide.beats.filter((b) => b.measuredMsPerTile !== null);
      const st = r.engine.glide.steadiness;
      console.log(`  ${keyOf(r)}: ${r.engine.glide.beats.length} beats, ${beats.length} measurable${beats.length ? `, mean ${f(beats.reduce((a, b) => a + b.measuredMsPerTile, 0) / beats.length)} ms/tile (spec ${beats[0].specMsPerTile})` : ''}, ${r.engine.glide.beats.filter((b) => !b.ok).length} failing, ${r.engine.glide.unmeasured} too short to measure; steadiness ${st.beats ? `mean ${f(st.mean, 2)}, max ${f(st.max, 2)} over ${st.beats} beats` : 'not measurable'}`);
    }
  }
  const cad = report.runs.filter((r) => r.engine && r.engine.cadence.perSpeed.length);
  if (cad.length) {
    console.log('\nplayback cadence (measured step length / plan, story holds left out):');
    for (const r of cad) for (const c of r.engine.cadence.perSpeed) console.log(`  ${keyOf(r)}: ${c.steps} steps, ratio ${f(c.ratio, 3)}, ${f(c.stepsPerSec, 2)} steps/s`);
  }
}

function printCompare(c, baseLabel) {
  console.log(`\ncompared with ${baseLabel}:`);
  const interesting = c.rows.filter((r) => ['frame.fps', 'frame.p95', 'frame.maxStill', 'frame.drawFps', 'page.steps.perSec', 'engine.cadence.ratio', 'engine.glide.steadiness.mean'].includes(r.metric));
  for (const r of interesting) console.log(`  ${r.run.padEnd(22)} ${r.metric.padEnd(22)} ${String(r.was).padStart(8)} -> ${String(r.now).padStart(8)}  ${Number.isFinite(r.delta) ? `${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(1)}%` : 'n/a'}${r.rule === 'floor' ? '  (floor rule)' : ''}${r.worse ? '   WORSE' : ''}`);
  for (const n of [...new Set(c.notes)].slice(0, 12)) console.log(`  note: ${n}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const pw = loadPlaywright();
  let base;
  if (args.port) base = await startPreview(Number(args.port));
  else base = args.url.endsWith('/') ? args.url : `${args.url}/`;
  const vite = await ssr();
  const A = await vite.ssrLoadModule('/src/ui/watch/motion/analysis.ts');
  const C = await vite.ssrLoadModule('/src/ui/watch/motion/compare.ts');
  keyOf = C.keyOf;
  let feed = null;
  const browser = await pw.chromium.launch({ headless: true }).catch((e) => die(`the browser would not start: ${String(e.message).split('\n')[0]}`));
  try {
    const measuring = !args.shots || args.scenarios !== undefined;
    if (measuring && scenarios.includes('live')) feed = await startScriptedFeed();
    if (args.shots) await shoot(pw, browser, base, resolve(args.shots));
    const runs = [];
    let info = { renderer: null, sha: null };
    const errors = [];
    const failures = [];
    const secondLoads = [];
    if (measuring) {
      for (const scenario of scenarios) {
        for (const size of sizes) {
          console.error(`measuring ${scenario} at ${size}`);
          try {
            const r = await runScenario(pw, browser, A, base, scenario, size, feed && feed.liveUrl);
            runs.push(...r.runs);
            if (r.second) secondLoads.push(r.second);
            info = r.info;
            errors.push(...r.errors.map((e) => `${scenario}/${size}: ${e}`));
          } catch (e) {
            // one scenario that cannot run does not take the others with it; the exit code says it happened
            failures.push(`${scenario}/${size}: ${String(e.message || e).split('\n')[0]}`);
            console.error(`  ${scenario}/${size}: FAILED: ${failures[failures.length - 1]}`);
          }
        }
      }
    }
    const report = {
      tool: 'motion', schema: 1, label: args.label || null, when: new Date().toISOString(), url: base,
      build: { sha: info.sha }, machine: { renderer: info.renderer, cores: os.cpus().length, chromium: browser.version() },
      settings: { steps: STEPS, maxSeconds: MAX_SECONDS, pin: pin ? `${pin.tier}@${pin.scale}` : null, tolerance: TOLERANCE },
      pageErrors: errors, failures, secondLoads, runs,
    };
    if (runs.length === 0) {
      if (failures.length) {
        console.log(`SCENARIOS THAT COULD NOT RUN:\n  ${failures.join('\n  ')}`);
        process.exitCode = 2;
      }
      return;
    }
    report.budgets = { absolute: absoluteBudgets(report), relative: [] };
    printSummary(report);
    if (failures.length) {
      console.log(`\nSCENARIOS THAT COULD NOT RUN:\n  ${failures.join('\n  ')}`);
      process.exitCode = 2;
    }
    if (errors.length) console.log(`\npage errors:\n  ${[...new Set(errors)].slice(0, 5).join('\n  ')}`);
    if (args.compare) {
      let baseline;
      try {
        baseline = JSON.parse(readFileSync(resolve(args.compare), 'utf8'));
      } catch (e) {
        die(`cannot read the baseline ${args.compare}: ${e.message}`);
      }
      if (baseline.schema !== 1 || baseline.tool !== 'motion') die(`${args.compare} is not a motion report this version understands`);
      const c = C.compareReports(baseline, report, TOLERANCE);
      report.budgets.relative = c.broken;
      report.compare = { baseline: args.compare, label: baseline.label, rows: c.rows, notes: c.notes };
      printCompare(c, baseline.label || args.compare);
    }
    if (args.out) {
      mkdirSync(dirname(resolve(args.out)), { recursive: true });
      writeFileSync(resolve(args.out), `${JSON.stringify(report, null, 1)}\n`);
      console.log(`\nreport: ${resolve(args.out)}`);
    }
    const broken = [...report.budgets.absolute, ...report.budgets.relative];
    if (broken.length) {
      console.log('\nBUDGETS BROKEN:');
      for (const b of broken.slice(0, 20)) console.log(`  ${b.run}: ${b.budget}: ${b.detail}`);
      process.exitCode = 1;
    } else if (!failures.length) {
      console.log('\nno budget broken.');
    }
  } finally {
    await browser.close().catch(() => {});
    if (feed) await feed.close().catch(() => {});
    if (viteSsr) await viteSsr.close().catch(() => {});
    stopPreview();
  }
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopPreview();
    process.exit(130);
  });
}
process.on('exit', stopPreview);

main().catch((err) => {
  stopPreview();
  console.error(`motion: ${err && err.stack ? err.stack : err}`);
  process.exit(2);
});
