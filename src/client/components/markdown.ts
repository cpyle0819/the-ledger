// Tiny markdown renderer (headings, lists, code, quote, links, rules, GFM pipe
// tables, and inline bold/italic/inline-code). Enough for item descriptions and
// comments; HTML is safe-escaped before inline formatting is applied. Shared by
// the components and the board shell so there is one renderer.

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// A GFM table delimiter row: `| --- | :--: |`, at least one column, each cell a
// run of dashes with optional leading/trailing colon for alignment.
const isTableDelim = (s: string): boolean =>
  /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(s) && s.includes('-');

// Split a pipe row into trimmed cells: drop the optional outer pipes, honour
// backslash-escaped pipes inside a cell, then unescape them for rendering.
function splitRow(line: string): string[] {
  const cells: string[] = []; let cur = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let j = 0; j < body.length; j++) {
    const ch = body[j];
    if (ch === '\\' && body[j + 1] === '|') { cur += '|'; j++; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

// Map a delimiter cell to its column alignment (leading/trailing colons).
function alignOf(cell: string): '' | ' style="text-align:left"' | ' style="text-align:right"' | ' style="text-align:center"' {
  const l = cell.startsWith(':'), r = cell.endsWith(':');
  if (l && r) return ' style="text-align:center"';
  if (r) return ' style="text-align:right"';
  if (l) return ' style="text-align:left"';
  return '';
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
    // GFM pipe table: a header row containing a pipe, immediately followed by a
    // delimiter row. Body rows continue until a blank/non-pipe line.
    if (line.includes('|') && isTableDelim(lines[i + 1] ?? '')) {
      flushPara(para);
      const aligns = splitRow(lines[i + 1] ?? '').map(alignOf);
      const head = splitRow(line);
      const th = head.map((c, k) => `<th${aligns[k] ?? ''}>${inline(c)}</th>`).join('');
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim()) {
        const cells = splitRow(lines[i++] ?? '');
        const tds = head.map((_, k) => `<td${aligns[k] ?? ''}>${inline(cells[k] ?? '')}</td>`).join('');
        rows.push(`<tr>${tds}</tr>`);
      }
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
      continue;
    }
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
