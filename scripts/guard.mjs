#!/usr/bin/env node
// CI guard: fails on content that must never ship in Ascendant Wars.
//   1. ORIGINALITY — Nintendo / Advance Wars proper nouns in shipped paths. "Like Advance Wars" means the mechanics
//      family only: no Nintendo names, commanders, nations, unit names, sprites, maps or music.
//   2. NO MANUAL UNIT CONTROL — product routes may not import manual-control modules. The player's agent takes every
//      in-battle action; the human directs it (doctrine, powers, composition, standing orders).
//   3. TEST INTEGRITY — no focused, skipped or placeholder tests (`.only`, `.skip`, `.todo`, `xit`, `fit` …) in any
//      test file, so a green run always means every written test ran. `it.fails` stays allowed: it is a real assertion
//      that goes red the day the expected failure stops happening.
// Exit 0 = clean, 1 = findings, 2 = the guard could not run (never a silent pass).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Paths whose content ships to players.
export const SHIPPED = [/^src\//, /^design-system\/project\//, /^public\//, /^app\//, /^lib\//, /^server\//];
// Reference docs may name the original games to describe mechanics; they do not ship.
export const EXEMPT = [/^scripts\/guard(\.test)?\.mjs$/, /^docs\//];

// Case-sensitive whole words. Generic words that collide with ordinary code or prose are deliberately left out.
export const DENYLIST = [
  'Advance Wars', 'Nintendo', 'Intelligent Systems', 'Famicom Wars', 'Game Boy Wars',
  'Orange Star', 'Blue Moon', 'Green Earth', 'Yellow Comet', 'Black Hole', 'Wars World', 'Cosmo Land', 'Macro Land',
  'Andy', 'Sami', 'Nell', 'Hachi', 'Olaf', 'Kanbei', 'Sonja', 'Sturm', 'Hawke', 'Jugger', 'Koal', 'Kindle', 'Von Bolt',
  'Neotank', 'Megatank', 'Md. Tank', 'Piperunner', 'Black Bomb', 'Black Boat', 'Oozium',
];

// Product route locations (TanStack Start src/routes, or an app/ router) and the manual-control modules they must not reach.
export const ROUTES = [/^src\/routes\//, /^app\//];
export const MANUAL_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*(?:manual|direct-control|hotseat|hot-seat|unit-control|takeover|take-over)[^'"]*['"]/i;

// Test files, and the calls that would let a run go green without running everything.
export const TEST_FILES = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
export const WEAKENED_TEST = /(?<![A-Za-z0-9_$.])(?:(?:it|test|describe|suite|bench)\s*\.\s*(?:only|skip|todo|skipIf|runIf)\b|(?:xit|xtest|xdescribe|fit|fdescribe)\s*\()/;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DENY_RE = new RegExp(`(?<![A-Za-z0-9_])(?:${DENYLIST.map(escape).join('|')})(?![A-Za-z0-9_])`, 'g');

/** Findings for one file's text. Pure, so the tests can feed it known-bad and known-good input. */
export function scanText(path, text) {
  const findings = [];
  if (EXEMPT.some((r) => r.test(path))) return findings;
  const lines = text.split('\n');
  if (SHIPPED.some((r) => r.test(path))) {
    lines.forEach((line, i) => {
      for (const m of line.matchAll(DENY_RE)) findings.push({ path, line: i + 1, rule: 'originality', match: m[0] });
    });
  }
  if (TEST_FILES.test(path)) {
    lines.forEach((line, i) => {
      const m = WEAKENED_TEST.exec(line);
      if (m) findings.push({ path, line: i + 1, rule: 'test-integrity', match: m[0] });
    });
  }
  if (ROUTES.some((r) => r.test(path))) {
    lines.forEach((line, i) => {
      const m = MANUAL_IMPORT.exec(line);
      if (m) findings.push({ path, line: i + 1, rule: 'no-manual-control', match: m[0] });
    });
  }
  return findings;
}

const TEXT = /\.(?:[cm]?[jt]sx?|json|md|mdx|html|css|svg|txt|ya?ml)$/i;

export function scanRepo(cwd = process.cwd()) {
  const list = (...args) => execFileSync('git', ['ls-files', '-z', ...args], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
  // The working tree as it will be committed: tracked and new (not ignored) files, minus deletions.
  const deleted = new Set(list('--deleted'));
  const files = list('--cached', '--others', '--exclude-standard').filter((f) => !deleted.has(f));
  const scanned = [...new Set(files)].filter((f) => TEXT.test(f));
  const findings = scanned.flatMap((f) => scanText(f, readFileSync(`${cwd}/${f}`, 'utf8')));
  return { scanned: scanned.length, findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let result;
  try {
    result = scanRepo();
  } catch (err) {
    console.error(`guard: could not run (${err.message})`);
    process.exit(2);
  }
  if (result.scanned === 0) {
    console.error('guard: scanned 0 files — refusing to report clean');
    process.exit(2);
  }
  for (const f of result.findings) console.error(`${f.path}:${f.line}: ${f.rule}: ${f.match}`);
  console.log(`guard: ${result.scanned} files scanned, ${result.findings.length} findings`);
  process.exit(result.findings.length ? 1 : 0);
}
