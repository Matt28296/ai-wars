// G15: the height of the chrome above the watch view is ONE variable. The "Back to briefing" strip is 48 px tall on the deployed screen,
// and every viewport-height formula in the watch view's stylesheet has to subtract it by name, not by a second hard-coded 48 (or a
// 234 or a 562 that quietly includes it). The page is measured in a browser (the order's receipt); this guards the wiring.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const FRONT = css('./front.css');
const WATCH = css('../watch/watch.css');

const CHROME = '--aww-chrome-h';

/** Every declaration in a stylesheet that takes a viewport height and subtracts a pixel length from it. */
function viewportMinusPx(sheet: string): string[] {
  return sheet.split(/[;{}]/).map((d) => d.trim()).filter((d) => /\b100d?vh\b\s*-\s*[\d.]+px/.test(d) || /calc\(\s*100d?vh\s*-/.test(d));
}
/** Those among them that do not subtract the chrome variable too. */
const unwired = (sheet: string): string[] => viewportMinusPx(sheet).filter((d) => !d.includes(`var(${CHROME}`));

describe('the chrome height is one variable', () => {
  it('is declared once, by the page that hosts the view, and is the strip\'s own height', () => {
    expect(FRONT.match(new RegExp(`${CHROME}\\s*:`, 'g'))?.length).toBe(1);
    expect(FRONT).toMatch(new RegExp(`\\.awf-watch\\s*\\{[^}]*${CHROME}:\\s*48px`));
    expect(FRONT).toMatch(new RegExp(`\\.awf-watchbar\\s*\\{[^}]*min-height:\\s*var\\(${CHROME}\\)`));
    expect(WATCH).not.toMatch(new RegExp(`${CHROME}\\s*:`));
  });

  it('is subtracted by name in every viewport-height formula of the watch view', () => {
    const found = viewportMinusPx(WATCH);
    expect(found.length, 'the stage, the log and the root each take a height from the viewport').toBeGreaterThanOrEqual(3);
    expect(unwired(WATCH)).toEqual([]);
  });

  it('known-bad twin: a formula that hard-codes the strip is found', () => {
    expect(unwired('.x { max-height: max(280px, calc(100vh - 234px)); }')).toEqual(['max-height: max(280px, calc(100vh - 234px))']);
    expect(unwired('.x { height: calc(100dvh - var(--aww-chrome-h, 0px)); }')).toEqual([]);
    expect(unwired('.x { height: calc(100dvh - 48px); }')).toHaveLength(1);
  });
});
