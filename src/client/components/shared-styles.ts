// Constructable stylesheets shared across Ledger components. Each is a single
// CSSStyleSheet object, parsed once, adopted into every shadow root that needs
// it (adoptedStyleSheets) — cheaper than inlining <style> per instance.
//
// All colors/fonts read design tokens (--parch, --ink, --seal-*, --fell, …)
// declared on :root in styles.css. Custom properties inherit through the shadow
// boundary, so the tokens reach here; the var() fallbacks keep a component
// legible even if it's dropped on a page that hasn't loaded the token layer.
//
// Styles stay authored as template literals here (rather than `import … with
// { type: 'css' }`) deliberately: CSS module scripts aren't supported in Safari
// as of late 2025, so template-literal constructable sheets are the portable
// no-build choice.

import { el, copyLink } from './util.js';

const sheet = (css: string): CSSStyleSheet => { const s = new CSSStyleSheet(); s.replaceSync(css); return s; };

// The wax-seal tier chip, tier→color map, status/estimate pills, assignee, and
// the ticket-number + copy-link unit. These leaf bits render as part-tagged
// nodes inside card/row/drawer components rather than as their own elements, so
// one stylesheet themes them everywhere.
export const chromeSheet = sheet(`
  .chip {
    font-family: var(--fell, Georgia, serif); font-size: 12px; font-weight: 400;
    letter-spacing: .1em; line-height: 1; text-transform: uppercase;
    padding: 4px 9px; border-radius: 2px; color: #f6eed6;
    background: var(--seal, var(--ink-faint, #6f5c3e));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.2), inset 0 -2px 3px rgba(0,0,0,.3), 0 1px 2px rgba(0,0,0,.3);
    border: 1px solid rgba(0,0,0,.2);
  }
  .t-EPIC    { --seal: var(--seal-epic, #8a5a2b); }
  .t-STORY   { --seal: var(--seal-story, #3f5e4e); }
  .t-TASK    { --seal: var(--seal-task, #47506e); }
  .t-BUG     { --seal: var(--seal-bug, #8f2f22); }
  .t-SUBTASK { --seal: var(--ink-faint, #6f5c3e); }

  .pill { font-family: var(--fell, serif); font-style: italic; font-size: 14px; color: var(--ink-soft, #5b4a30); display: inline-flex; align-items: center; gap: 5px; }
  .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-faint, #6f5c3e); }
  .st-Open .dot { background: var(--seal-epic, #8a5a2b); }
  .st-Closed .dot, .st-Resolved .dot { background: var(--seal-story, #3f5e4e); }
  .who { font-family: var(--gara, serif); font-style: italic; font-size: 13px; color: var(--ink-soft, #5b4a30); }
  .who b { color: var(--ink, #33291a); font-weight: 600; font-style: normal; }
  /* Context node: assigned to someone other than the filtered assignee, present
     only to hold a matching descendant. A dotted outline + muted ink and a small
     leading glyph set it apart from a normal assignee without shouting. */
  .who.context { color: var(--ink-faint, #6f5c3e); border: 1px dotted var(--parch-edge, #c4ac7c); border-radius: 2px; padding: 0 6px; cursor: help; }
  .who.context::before { content: "↳ "; opacity: .7; }
  .who.context b { color: var(--ink-soft, #5b4a30); font-weight: 500; }
  .count-badge { color: var(--ink-red, #8f2f22); }
  /* Missing-estimate flag: a data gap (no points set), distinct from the planning
     risk tones — a muted amber chip with a warning glyph, sitting where the points
     would be (or beside the type chip on a card). Neutral-but-noticeable so it
     draws the eye to fill it in without competing with selection or the risk meter. */
  .no-est {
    font-family: var(--fell, serif); font-weight: 600; font-size: 13px; line-height: 1; letter-spacing: .02em;
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 2px;
    color: #f6eed6; background: var(--risk-under, #b8842a); border: 1px solid rgba(0,0,0,.25);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 1px 2px rgba(0,0,0,.3); white-space: nowrap;
  }
  .no-est::before { content: "⚠"; font-size: 12px; }
  /* Icon-only variant (the ⚠ glyph alone, tooltip carries the meaning): used in the
     Planning list where the points pill would sit. */
  .no-est-icon { font-size: 15px; line-height: 1; color: var(--risk-under, #b8842a); cursor: help; }

  .card-id { font-family: var(--fell, serif); font-style: italic; font-size: 14px; color: var(--ink-red, #8f2f22); letter-spacing: .01em; opacity: .85; }
  .id-tag { display: inline-flex; align-items: center; gap: 4px; }
  .copy-link {
    position: relative; display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; padding: 0; cursor: pointer;
    background: transparent; border: 1px solid transparent; border-radius: 3px;
    color: var(--ink, #33291a); font-size: 13px; line-height: 1;
    opacity: .7; transition: opacity .12s, color .12s, background .12s, border-color .12s;
  }
  .copy-link:hover { opacity: 1; color: var(--wax, #7c2b22); background: rgba(243,234,208,.7); border-color: var(--parch-edge, #c4ac7c); }
  .copy-link.copied { opacity: 1; color: var(--seal-story, #3f5e4e); border-color: var(--seal-story, #3f5e4e); }
  .copy-link.copied .copy-icon { visibility: hidden; }
  .copy-link.copied::after { content: "✓"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }

  :focus-visible { outline: 2px solid var(--wax, #7c2b22); outline-offset: 2px; border-radius: 2px; }
`);

// The "no estimate" flag chip, built once so every surface (card, outline row,
// Planning line) renders it identically. aria-label carries the full meaning; the
// ⚠ glyph is decorative (added via ::before).
export function noEstimateChip(): HTMLSpanElement {
  const chip = el('span', 'no-est', 'no estimate');
  chip.setAttribute('aria-label', 'No estimate set');
  chip.title = 'No estimate set';
  return chip;
}

// The icon-only missing-estimate flag: the ⚠ glyph alone with a tooltip, for the
// Planning list where a full chip would crowd the line.
export function noEstimateIcon(): HTMLSpanElement {
  const icon = el('span', 'no-est-icon', '⚠');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', 'No estimate set');
  icon.title = 'No estimate set';
  return icon;
}

// Build the "№ <shortId>" unit used on cards, rows, and the drawer, with a
// copy-link button when the item carries a `url` (the source supplies the link;
// the app neither knows nor builds any source's URL). Returns a part-tagged node
// so a host can restyle it from outside via ::part(id-tag) / ::part(copy-link).
export function idTag(shortId: string, url?: string | null): HTMLSpanElement {
  const wrap = el('span', 'id-tag'); wrap.setAttribute('part', 'id-tag');
  wrap.append(el('span', 'card-id', `№ ${shortId}`));
  if (!url) return wrap;   // no link when the source doesn't provide one
  const btn = el('button', 'copy-link'); btn.type = 'button'; btn.setAttribute('part', 'copy-link');
  btn.setAttribute('aria-label', `Copy link to ${shortId}`);
  btn.title = 'Copy link';
  btn.innerHTML = '<span class="copy-icon" aria-hidden="true">⧉</span>';
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); copyLink(url, btn); });
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
  wrap.append(btn);
  return wrap;
}
