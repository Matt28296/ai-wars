// The portrait safety check: what a composed portrait SVG must be before it can be handed to an <img> (or inlined). Pure; it returns the
// problems it finds, so a test can feed it known-bad text and expect refusals, and known-good text and expect none.
//
// Refused: <script>, <foreignObject>, <text>/<tspan>, <image>, <style>, <iframe>, <a>, any on* event attribute, `javascript:` and `data:`
// values, any href that is not a "#..." reference, any url(...) that is not url(#...), an embedded raster, a missing viewBox, a document
// that is not one balanced <svg>, and a text larger than the size limit.

/** The size limit of one composed portrait, in bytes. */
export const MAX_SVG_BYTES = 12 * 1024;

const FORBIDDEN_TAGS = ['script', 'foreignObject', 'text', 'tspan', 'textPath', 'image', 'style', 'iframe', 'a', 'video', 'audio', 'canvas', 'object', 'embed', 'link', 'animate', 'set'];
const VOID_OK = /^(path|rect|circle|ellipse|line|polyline|polygon|use|stop)$/;

export function checkPortraitSvg(svg: string): string[] {
  const problems: string[] = [];
  const bytes = new TextEncoder().encode(svg).length;
  if (bytes > MAX_SVG_BYTES) problems.push(`too large: ${bytes} bytes (limit ${MAX_SVG_BYTES})`);
  if (!svg.startsWith('<svg ')) problems.push('does not start with <svg');
  if (!svg.endsWith('</svg>')) problems.push('does not end with </svg>');
  if (!/<svg[^>]*\sviewBox="0 0 256 256"/.test(svg)) problems.push('missing viewBox="0 0 256 256"');

  // balanced tags: walk every tag, push opens, pop closes, and require the names to match
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let consumed = 0;
  for (let m = tag.exec(svg); m; m = tag.exec(svg)) {
    consumed += m[0].length;
    const [, closing, name, , selfClose] = m;
    if (FORBIDDEN_TAGS.includes(name)) problems.push(`forbidden element <${name}>`);
    if (closing) {
      const open = stack.pop();
      if (open !== name) problems.push(`unbalanced: </${name}> closes <${open ?? 'nothing'}>`);
    } else if (!selfClose) {
      if (VOID_OK.test(name)) problems.push(`<${name}> is not self-closed`);
      stack.push(name);
    }
  }
  if (stack.length) problems.push(`unbalanced: <${stack.join('>, <')}> never closed`);
  // everything outside tags must be nothing at all (a portrait has no text nodes)
  const outside = svg.replace(tag, '');
  if (outside.trim() !== '') problems.push(`text outside tags: "${outside.trim().slice(0, 40)}"`);
  if (consumed === 0) problems.push('no tags found');

  if (/\son[a-z]+\s*=/i.test(svg)) problems.push('event attribute');
  if (/javascript:/i.test(svg)) problems.push('javascript: value');
  if (/data:/i.test(svg)) problems.push('data: value (an embedded raster or document)');
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*"([^"]*)"/g)) {
    if (!m[1].startsWith('#')) problems.push(`external href "${m[1].slice(0, 40)}"`);
  }
  for (const m of svg.matchAll(/url\(\s*([^)]*)\)/g)) {
    if (!/^['"]?#/.test(m[1].trim())) problems.push(`url() that is not a #reference: "${m[1].slice(0, 40)}"`);
  }
  if (/@import/i.test(svg)) problems.push('@import');

  // every #reference must land on an id defined in the same document, and no id may be defined twice
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`duplicate id "${id}"`);
    seen.add(id);
  }
  const refs = [...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]).concat([...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]));
  for (const r of refs) if (!seen.has(r)) problems.push(`dangling reference #${r}`);
  return problems;
}
