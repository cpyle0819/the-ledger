// Constructable stylesheets shared across Ledger components. Each is a single
// CSSStyleSheet object, parsed once, adopted into every shadow root that needs
// it (adoptedStyleSheets) — cheaper than inlining <style> per instance.
//
// All colors/fonts read design tokens (--surface, --text, --seal-*, --fell, …)
// declared on :root in styles.css. Custom properties inherit through the shadow
// boundary, so the tokens reach here; the var() fallbacks keep a component
// legible even if it's dropped on a page that hasn't loaded the token layer.
//
// Styles stay authored as template literals here (rather than `import … with
// { type: 'css' }`) deliberately: CSS module scripts aren't supported in Safari
// as of late 2025, so template-literal constructable sheets are the portable
// no-build choice.

import { el, copyLink } from './util.js';
import type { Kind } from '../../shared/contract';

const sheet = (css: string): CSSStyleSheet => { const s = new CSSStyleSheet(); s.replaceSync(css); return s; };

// The aged-brass scrollbar, for every scroll container inside a shadow root.
// ::-webkit-scrollbar pseudo-elements are document-scoped and do NOT cross the
// shadow boundary — the global rule in styles.css styles only light-DOM scrollers
// (the document, the outline lens), so a shadow-DOM scroller (a column body, the
// drawer panel) falls back to the native bar and breaks the archive look. Adopt
// this into any shadow root that scrolls to carry the brass bar across. The
// standard scrollbar-color/-width ARE inherited, so they also cover Firefox from
// here; kept in sync with the global rule in styles.css. */
export const scrollbarSheet = sheet(`
  :host { scrollbar-color: var(--metal-dim, #7a5f30) rgba(20,14,7,.5); scrollbar-width: thin; }
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-thumb { background: var(--metal-dim, #7a5f30); border-radius: 0; border: 3px solid var(--frame-deep, #1c1409); }
  ::-webkit-scrollbar-thumb:hover { background: var(--metal, #b08d4f); }
  ::-webkit-scrollbar-track { background: rgba(20,14,7,.5); }
`);

// The wax-seal tier chip, tier→color map, status/estimate pills, assignee, and
// the ticket-number + copy-link unit. These leaf bits render as part-tagged
// nodes inside card/row/drawer components rather than as their own elements, so
// one stylesheet themes them everywhere.
export const chromeSheet = sheet(`
  .chip {
    font-family: var(--fell, Georgia, serif); font-size: 14px; font-weight: 400;
    letter-spacing: .1em; line-height: 1; text-transform: uppercase;
    padding: 4px 9px; border-radius: 2px; color: var(--chip-fg, #f6eed6);
    background: var(--seal, var(--text-faint, #6f5c3e));
    box-shadow: inset 0 1px 0 rgba(255,255,255,.2), inset 0 -2px 3px rgba(0,0,0,.3), 0 1px 2px rgba(0,0,0,.3);
    border: 1px solid rgba(0,0,0,.2);
  }
  .t-EPIC    { --seal: var(--seal-epic, #8a5a2b); }
  .t-STORY   { --seal: var(--seal-story, #3f5e4e); }
  .t-TASK    { --seal: var(--seal-task, #47506e); }
  .t-BUG     { --seal: var(--seal-bug, #8f2f22); }
  .t-SUBTASK { --seal: var(--text-faint, #6f5c3e); }

  /* Every metadata pill shares one voice: fell / italic / 14px / ink-soft, a
     uniform field so the row reads as a set. Each carries ONE leading mark (a
     shape cue, the only per-item distinction) — the status dot, the estimate's
     operator glyph, the assignee nib, the count fleuron. Marks render as text,
     not emoji (the \\FE0E in .who/.count-badge forces monochrome). */
  .pill { font-family: var(--fell, serif); font-style: italic; font-size: var(--fs-meta, 16px); color: var(--text-muted, #5b4a30); display: inline-flex; align-items: center; gap: 5px; }
  .pill .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-faint, #6f5c3e); }
  .st-Open .dot { background: var(--dot-open, var(--seal-epic, #8a5a2b)); }
  .st-Closed .dot { background: var(--dot-closed, var(--seal-story, #3f5e4e)); }
  /* The estimate's leading mark: the confidence operator (≈ / ~ / =), upright and
     slightly muted so it reads as a sign, not a letter. */
  .pmark { font-style: normal; color: var(--text-faint, #6f5c3e); }
  /* Assignee: same voice as the pills, with a nib mark for "owner". The name stays
     italic (the row is uniformly italic) but bold — weight, not slant, is its
     one accent as a proper noun. */
  .who { font-family: var(--fell, serif); font-style: italic; font-size: var(--fs-meta, 16px); color: var(--text-muted, #5b4a30); }
  .who::before { content: "\\270E\\FE0E"; margin-right: 5px; font-style: normal; color: var(--text-faint, #6f5c3e); }
  .who b { color: var(--text, #33291a); font-weight: 600; }
  /* Context node: assigned to someone other than the filtered assignee, present
     only to hold a matching descendant. A dotted outline + muted ink and a distinct
     leading glyph set it apart from a normal assignee without shouting. */
  .who.context { color: var(--text-faint, #6f5c3e); border: 1px dotted var(--border, #c4ac7c); border-radius: 2px; padding: 0 6px; cursor: help; }
  .who.context::before { content: "\\21B3\\FE0E"; opacity: .7; }
  .who.context b { color: var(--text-muted, #5b4a30); font-weight: 500; }
  /* Count badge: kept accented (red) with a fleuron mark for "contains". */
  .count-badge { color: var(--alert, #8f2f22); }
  .count-badge::before { content: "\\2767\\FE0E"; margin-right: 5px; opacity: .8; }
  /* Missing-estimate flag: a data gap (no points set), distinct from the planning
     risk tones — a muted amber chip with a warning glyph, sitting where the points
     would be (or beside the type chip on a card). Neutral-but-noticeable so it
     draws the eye to fill it in without competing with selection or the risk meter. */
  .no-est {
    font-family: var(--fell, serif); font-weight: 600; font-size: 15px; line-height: 1; letter-spacing: .02em;
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 2px;
    color: #f6eed6; background: var(--risk-under, #b8842a); border: 1px solid rgba(0,0,0,.25);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 1px 2px rgba(0,0,0,.3); white-space: nowrap;
  }
  .no-est::before { content: "⚠"; font-size: 12px; }
  /* Icon-only variant (the ⚠ glyph alone, tooltip carries the meaning): used in the
     Planning list where the points pill would sit. */
  .no-est-icon { font-size: 15px; line-height: 1; color: var(--risk-under, #b8842a); cursor: help; }

  .card-id { font-family: var(--fell, serif); font-style: italic; font-size: var(--fs-meta, 16px); color: var(--alert, #8f2f22); letter-spacing: .01em; opacity: .85; }
  .id-tag { display: inline-flex; align-items: center; gap: 4px; }
  .copy-link {
    position: relative; display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; padding: 0; cursor: pointer;
    background: transparent; border: 1px solid transparent; border-radius: 3px;
    color: var(--text, #33291a); font-size: 13px; line-height: 1;
    opacity: .7; transition: opacity .12s, color .12s, background .12s, border-color .12s;
  }
  .copy-link:hover { opacity: 1; color: var(--wax, #7c2b22); background: var(--onlight-chip-bg, rgba(243,234,208,.7)); border-color: var(--field-edge, var(--border, #c4ac7c)); }
  .copy-link.copied { opacity: 1; color: var(--seal-story, #3f5e4e); border-color: var(--seal-story, #3f5e4e); }
  .copy-link.copied .copy-icon { visibility: hidden; }
  .copy-link.copied::after { content: "✓"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }

  :focus-visible { outline: 2px solid var(--wax, #7c2b22); outline-offset: 2px; border-radius: 2px; }
`);

// A missing-data flag chip, built once so every surface (card, outline row,
// Planning line) renders it identically. The visible text is just the field name
// ("estimate", "start date"); the leading ⚠ glyph (added via ::before) carries the
// "no", and aria-label/title spell out the full meaning. `field` is the short
// label, `meaning` the full sentence for AT and the tooltip.
function missingChip(field: string, meaning: string): HTMLSpanElement {
  const chip = el('span', 'no-est', field);
  chip.setAttribute('aria-label', meaning);
  chip.title = meaning;
  return chip;
}

// The icon-only missing-data flag: the ⚠ glyph alone with a tooltip, for the
// Planning list where a full chip would crowd the line.
function missingIcon(meaning: string): HTMLSpanElement {
  const icon = el('span', 'no-est-icon', '⚠');
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', meaning);
  icon.title = meaning;
  return icon;
}

// Missing-estimate flags (any tier, when the source has point estimates).
export function noEstimateChip(): HTMLSpanElement { return missingChip('estimate', 'No estimate set'); }
export function noEstimateIcon(): HTMLSpanElement { return missingIcon('No estimate set'); }

// The estimate-confidence a tier's points carry. An epic's estimate is a rough
// order-of-magnitude guess (very low confidence); a story's a working estimate
// (medium); a task's the committed figure (high) — and tasks are the only tier
// whose estimates feed velocity. The coarser two exist for capacity planning and
// for checking a high-level guess against the sum of its low-level estimates.
// The glyph is the pill's leading mark AND its confidence cue, one channel: the
// relational-operator ladder ≈ → ∼ → = reads "roughly → approximately → exactly",
// so a task's committed figure gets the firm "=" where the coarse tiers get the
// approximation waves. All three are math operators (U+2248 / U+223C / U+003D) so
// they render mid-height in IM Fell; a plain ASCII "~" drops to a dash there.
export const CONFIDENCE: Record<Kind, { label: string; glyph: string; meaning: string }> = {
  epic:  { label: 'Rough',     glyph: '≈', meaning: 'Rough estimate — an order-of-magnitude guess. Not used for velocity; a sanity check against the summed story estimates.' },
  story: { label: 'Estimate',  glyph: '∼', meaning: 'Working estimate — a mid-confidence figure for capacity planning. Not used for velocity.' },
  task:  { label: 'Committed', glyph: '=', meaning: 'Committed estimate — the firm figure. Only task estimates are used to compute velocity.' },
};

// The points pill. One builder so the card, outline, and drawer render the estimate
// identically, as a peer of the other metadata (same font/size/style — no internal
// variance). Estimate confidence rides ONE channel: an approximation glyph before
// the number — "≈" for an epic's rough guess, "~" for a story's working estimate,
// nothing for a task's committed figure (the only tier fed to velocity). A tooltip
// carries the full meaning; the drawer's estimate field spells it out in prose.
// `pts` is the raw count (caller has checked it's > 0 and the source has points).
export function pointsPill(kind: Kind, pts: number): HTMLSpanElement {
  const c = CONFIDENCE[kind];
  const unit = pts === 1 ? 'pt' : 'pts';
  const pill = el('span', 'pill');
  const mark = el('span', 'pmark', c.glyph); mark.setAttribute('aria-hidden', 'true');
  pill.append(mark, document.createTextNode(`${pts} ${unit}`));
  pill.title = c.meaning;
  pill.setAttribute('aria-label', `${c.label} estimate: ${pts} ${unit}. ${c.meaning}`);
  return pill;
}

// Missing-start-date flags (closed tasks, when the source has task dates). A
// closed task with no recorded start date can't contribute a duration or velocity
// figure — the flag nudges the gap the way the missing-estimate flag does.
export function noStartDateChip(): HTMLSpanElement { return missingChip('start date', 'No start date set'); }
export function noStartDateIcon(): HTMLSpanElement { return missingIcon('No start date set'); }

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
