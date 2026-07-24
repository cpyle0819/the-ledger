// Tiny markdown renderer (headings, lists, code, quote, links, rules, and
// inline bold/italic/inline-code). Enough for item descriptions and comments;
// HTML is safe-escaped before inline formatting is applied. Shared by the
// components and the board shell so there is one renderer.

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function mdToHtml(src: string): string {
  const lines = (src || '').replace(/\r/g, '').split('\n');
  const out: string[] = []; let i = 0;
  const para: string[] = [];
  const flushPara = (buf: string[]) => { if (buf.length) { out.push(`<p>${buf.map(inline).join(' ')}</p>`); buf.length = 0; } };
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (/^```/.test(line)) { flushPara(para); const code: string[] = []; i++; while (i < lines.length && !/^```/.test(lines[i] ?? '')) code.push(lines[i++] ?? ''); i++; out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/); if (h) { flushPara(para); const level = (h[1] ?? '').length; out.push(`<h${level}>${inline(h[2] ?? '')}</h${level}>`); i++; continue; }
    if (/^\s*([-*+])\s+/.test(line)) { flushPara(para); const items: string[] = []; while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i] ?? '')) items.push(`<li>${inline((lines[i++] ?? '').replace(/^\s*([-*+])\s+/, ''))}</li>`); out.push(`<ul>${items.join('')}</ul>`); continue; }
    if (/^\s*\d+\.\s+/.test(line)) { flushPara(para); const items: string[] = []; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) items.push(`<li>${inline((lines[i++] ?? '').replace(/^\s*\d+\.\s+/, ''))}</li>`); out.push(`<ol>${items.join('')}</ol>`); continue; }
    if (/^\s*>\s?/.test(line)) { flushPara(para); const q: string[] = []; while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) q.push(inline((lines[i++] ?? '').replace(/^\s*>\s?/, ''))); out.push(`<blockquote>${q.join('<br>')}</blockquote>`); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushPara(para); out.push('<hr>'); i++; continue; }
    if (!line.trim()) { flushPara(para); i++; continue; }
    para.push(line); i++;
  }
  flushPara(para);
  return out.join('\n');
}

// Render markdown into an element and make links open safely in a new tab.
export function renderInto(box: HTMLElement, src: string): void {
  box.innerHTML = mdToHtml(src);
  box.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener'; });
}
