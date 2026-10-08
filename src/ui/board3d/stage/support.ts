// Which board to show: the 3D diorama when WebGL2 works and nobody asked for the flat one, else the SVG stage (D-018). No three.js here,
// so the watch view can use it without pulling the 3D renderer into its first load.
export type RendererChoice = '3d' | '2d';

/** What the page address asks for: `?renderer=2d` or `?renderer=3d`; anything else (or nothing) asks for nothing. */
export function rendererFromSearch(search: string): RendererChoice | null {
  const q = search.startsWith('?') ? search.slice(1) : search;
  for (const part of q.split('&')) {
    const [key, value = ''] = part.split('=');
    if (key !== 'renderer') continue;
    let v = value.toLowerCase();
    try {
      v = decodeURIComponent(value).toLowerCase();
    } catch {
      // a malformed escape is just not a request
    }
    if (v === '2d' || v === '3d') return v;
  }
  return null;
}

/**
 * The renderer to use. Without WebGL2 the answer is always the flat board, whatever was asked for: a request for 3D cannot be honoured.
 * With it, the viewer's own toggle beats the address, and the address beats the default (3D).
 */
export function chooseRenderer(opts: { webgl2: boolean; search?: string; override?: RendererChoice | null }): RendererChoice {
  if (!opts.webgl2) return '2d';
  return opts.override ?? rendererFromSearch(opts.search ?? '') ?? '3d';
}

interface ContextLike { getExtension(name: string): { loseContext(): void } | null }
interface CanvasLike { getContext(id: string): unknown }
export interface DocumentLike { createElement(tag: string): unknown }

/**
 * Whether this browser can make a WebGL2 context. Fails toward "no": any throw, a missing document, or a null context is false, so
 * the page falls back to the flat board and never to a blank canvas. The probe context is released at once.
 */
export function detectWebGL2(doc: DocumentLike | undefined = typeof document === 'undefined' ? undefined : document): boolean {
  if (!doc) return false;
  try {
    const canvas = doc.createElement('canvas') as CanvasLike;
    const gl = canvas.getContext('webgl2') as ContextLike | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
