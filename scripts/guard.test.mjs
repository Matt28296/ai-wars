import { describe, expect, it } from 'vitest';
import { scanRepo, scanText } from './guard.mjs';

// Known-answer tests in both directions: planted bad input must fail, real game content must pass.
describe('guard: originality', () => {
  it('flags a Nintendo commander in shipped code', () => {
    const f = scanText('src/content/commanders.ts', "export const co = { name: 'Andy' };");
    expect(f).toEqual([expect.objectContaining({ rule: 'originality', match: 'Andy', line: 1 })]);
  });
  it('flags a Nintendo nation and unit name in the design system', () => {
    const f = scanText('design-system/project/README.md', 'The Orange Star fields a Neotank.');
    expect(f.map((x) => x.match)).toEqual(['Orange Star', 'Neotank']);
  });
  it('does not flag substrings or generic words', () => {
    expect(scanText('src/x.ts', 'const handyman = Math.max(a, b); // grit, flak, lash')).toEqual([]);
  });
  it('ignores reference docs and the guard itself', () => {
    expect(scanText('docs/research/mechanics.md', 'In Advance Wars 2, Andy repairs units.')).toEqual([]);
    expect(scanText('scripts/guard.mjs', "'Andy'")).toEqual([]);
  });
  it('passes our own commander names', () => {
    expect(scanText('src/content/commanders.ts', 'Rook Okafor, Ilse Varga, Sefa Tamura, Cantor, VESPER, ECHO')).toEqual([]);
  });
});

describe('guard: no manual unit control in product routes', () => {
  it('flags a route importing a manual-control module', () => {
    const f = scanText('src/routes/battle.tsx', "import { ManualBattle } from '../ui/manual/Battle';");
    expect(f).toEqual([expect.objectContaining({ rule: 'no-manual-control' })]);
  });
  it('flags a dynamic import of a hot-seat module', () => {
    expect(scanText('app/run/page.tsx', "const m = await import('../hotseat/play');")).toHaveLength(1);
  });
  it('allows the spectator and replay modules', () => {
    expect(scanText('src/routes/watch.tsx', "import { Spectator } from '../ui/watch/Spectator';")).toEqual([]);
  });
  it('does not apply the route rule outside routes', () => {
    expect(scanText('src/game/aw/notes.ts', "// manual: see '../manual/readme'")).toEqual([]);
  });
});

describe('guard: whole repository', () => {
  it('scans tracked files and finds nothing on this tree', () => {
    const r = scanRepo();
    expect(r.scanned).toBeGreaterThan(50);
    expect(r.findings).toEqual([]);
  });
});

describe('guard: test integrity', () => {
  it('flags focused, skipped and placeholder tests in any test file', () => {
    const text = [
      "it.only('a', () => {});",
      "describe.skip('b', () => {});",
      "test.todo('c');",
      "xit('d', () => {});",
      "fdescribe('e', () => {});",
      "it.skipIf(process.env.CI)('f', () => {});",
    ].join('\n');
    const f = scanText('src/game/aw/combat.test.ts', text);
    expect(f.map((x) => [x.line, x.rule])).toEqual([1, 2, 3, 4, 5, 6].map((n) => [n, 'test-integrity']));
    expect(scanText('scripts/other.test.mjs', "test . only('x', () => {})")).toHaveLength(1);
  });
  it('allows ordinary tests, it.fails and lookalike names', () => {
    const text = "it('a', () => {}); it.fails('b', () => {}); describe('c', () => {}); const exit = 1; profit(2); obj.it.skip;";
    expect(scanText('src/game/aw/power.test.ts', text)).toEqual([]);
  });
  it('does not apply the rule outside test files', () => {
    expect(scanText('src/game/aw/notes.ts', "// remember: never commit it.only('x')")).toEqual([]);
  });
});
