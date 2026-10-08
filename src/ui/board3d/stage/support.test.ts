// Which board to show: the WebGL2 detection and the 3D / 2D choice, including every way the detection can fail.
import { describe, expect, it } from 'vitest';
import { chooseRenderer, detectWebGL2, rendererFromSearch } from './support';
import type { DocumentLike } from './support';

/** A document whose canvas hands out `ctx` for 'webgl2' (or throws). */
function docWith(ctx: unknown, opts: { throws?: boolean } = {}): { doc: DocumentLike; asked: string[] } {
  const asked: string[] = [];
  const doc: DocumentLike = {
    createElement: () => ({
      getContext: (id: string) => {
        asked.push(id);
        if (opts.throws) throw new Error('no gpu');
        return ctx;
      },
    }),
  };
  return { doc, asked };
}

describe('detecting WebGL2', () => {
  it('is true when a webgl2 context can be made, and the probe context is released at once', () => {
    let lost = 0;
    const { doc, asked } = docWith({ getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext: () => { lost++; } } : null) });
    expect(detectWebGL2(doc)).toBe(true);
    expect(asked).toEqual(['webgl2']); // asks for WebGL2 specifically, not "webgl"
    expect(lost).toBe(1);
  });

  it('is true even when the browser offers no way to release the probe context', () => {
    expect(detectWebGL2(docWith({ getExtension: () => null }).doc)).toBe(true);
  });

  it('fails toward no: a null context, a throwing browser, and no document at all', () => {
    expect(detectWebGL2(docWith(null).doc)).toBe(false);
    expect(detectWebGL2(docWith(undefined).doc)).toBe(false);
    expect(detectWebGL2(docWith({}, { throws: true }).doc)).toBe(false);
    expect(detectWebGL2({ createElement: () => { throw new Error('no dom'); } })).toBe(false);
    expect(detectWebGL2(undefined)).toBe(false); // node: there is no document
  });
});

describe('what the address asks for', () => {
  it('reads ?renderer=2d and ?renderer=3d among other parameters', () => {
    expect(rendererFromSearch('?renderer=2d')).toBe('2d');
    expect(rendererFromSearch('?renderer=3d')).toBe('3d');
    expect(rendererFromSearch('?x=1&renderer=2d&y=2')).toBe('2d');
    expect(rendererFromSearch('renderer=2D')).toBe('2d');
  });

  it('ignores anything else, never throws', () => {
    for (const s of ['', '?', '?renderer=', '?renderer=vr', '?rendere=2d', '?renderer=%E0%A4%A', '?renderer2d', '#renderer=2d']) {
      expect(rendererFromSearch(s), s).toBeNull();
    }
  });
});

describe('choosing the board', () => {
  it('shows 3D when WebGL2 works and nothing says otherwise', () => {
    expect(chooseRenderer({ webgl2: true })).toBe('3d');
    expect(chooseRenderer({ webgl2: true, search: '' })).toBe('3d');
    expect(chooseRenderer({ webgl2: true, search: '?other=1' })).toBe('3d');
  });

  it('shows the flat board on ?renderer=2d', () => {
    expect(chooseRenderer({ webgl2: true, search: '?renderer=2d' })).toBe('2d');
  });

  it('shows the flat board without WebGL2, whatever was asked for (known-bad: a request for 3D cannot be honoured)', () => {
    expect(chooseRenderer({ webgl2: false })).toBe('2d');
    expect(chooseRenderer({ webgl2: false, search: '?renderer=3d' })).toBe('2d');
    expect(chooseRenderer({ webgl2: false, override: '3d' })).toBe('2d');
  });

  it('lets the viewer\'s own toggle beat the address, in both directions', () => {
    expect(chooseRenderer({ webgl2: true, search: '?renderer=2d', override: '3d' })).toBe('3d');
    expect(chooseRenderer({ webgl2: true, search: '?renderer=3d', override: '2d' })).toBe('2d');
    expect(chooseRenderer({ webgl2: true, override: null })).toBe('3d');
  });
});
