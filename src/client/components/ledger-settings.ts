// <ledger-settings> — the application settings panel behind the masthead gear.
// Two sections:
//   Display — view type (columns/outline) and show-closed toggle. Core the-ledger
//     concerns, independent of any plugin.
//   Theme — the active theme's tunable knobs (from its manifest `settings`
//     schema). Hidden when the theme declares no knobs.
//
// Chrome matches the About modal: centered leaf over a scrim, brass rule, focus
// trap, Esc/scrim-click to close. Emits `setting-changed` events (composed,
// bubbles) so the app root can react to display changes.

import { el } from './util.js';
import { chromeSheet, scrollbarSheet } from './shared-styles.js';
import './ledger-switch.js';
import './ledger-segment.js';
import type { LedgerSwitch } from './ledger-switch.js';
import type { LedgerSegment } from './ledger-segment.js';
import {
  activeTheme, loadSettings, saveSetting, applyLiveSetting,
  type ThemeSetting,
} from '../core/theme.js';
import { state } from '../core/state.js';

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { position: fixed; inset: 0; z-index: 500; pointer-events: none; }
  :host([open]) { pointer-events: auto; }
  .scrim { position: absolute; inset: 0; background: rgba(12,8,3,.6); opacity: 0; transition: opacity .3s; }
  :host([open]) .scrim { opacity: 1; }
  .panel {
    position: absolute; top: 50%; left: 50%; width: min(520px, 92vw); max-height: 88vh;
    transform: translate(-50%, -46%); opacity: 0;
    transition: transform .3s cubic-bezier(.2,.8,.2,1), opacity .3s;
    display: flex; flex-direction: column; color: var(--text, #33291a);
    background: var(--sheet-surface-tl,
      radial-gradient(120% 55% at 0% 0%, rgba(196,172,124,.35), transparent 60%),
      linear-gradient(180deg, var(--surface-bright, #f3ead0), var(--surface, #e8dbba) 70%, var(--surface-dim, #d8c69c)));
    border: 1px solid var(--sheet-edge, var(--metal-dim, #7a5f30)); border-top: 6px solid var(--sheet-edge, var(--metal-dim, #7a5f30));
    border-radius: 3px; box-shadow: 0 28px 60px rgba(0,0,0,.5);
    padding: 26px 34px 0;
  }
  :host([open]) .panel { transform: translate(-50%, -50%); opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .scrim, .panel { transition: none; } }

  .s-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .s-kicker { font-family: var(--fell-sc, serif); font-size: 13px; letter-spacing: .1em; color: var(--alert, #8f2f22); }
  .ghost-btn {
    font-family: var(--fell, serif); font-style: italic; font-size: 16px; color: var(--metal-bright, #d8b878);
    background: linear-gradient(180deg, var(--frame, #2a1c10), var(--frame-raised, #33230f));
    border: 1px solid var(--metal-dim, #7a5f30); border-radius: 2px; padding: 7px 14px; cursor: pointer; transition: .15s;
    box-shadow: 0 1px 2px rgba(0,0,0,.4), inset 0 1px 0 rgba(216,184,120,.15);
  }
  .ghost-btn:hover { color: #fff; border-color: var(--metal, #b08d4f); background: linear-gradient(180deg, var(--frame-raised, #33230f), var(--frame, #2a1c10)); }

  .s-title { font-family: var(--fell, serif); font-weight: 400; font-size: 28px; line-height: 1.2; margin: 12px 0 6px; color: var(--text, #33291a); }
  .s-rule { height: 2px; background: linear-gradient(90deg, var(--metal-dim, #7a5f30), transparent); margin: 16px 0 4px; }

  .s-body { overflow-y: auto; padding: 8px 0 0; }

  /* Section headings — dominant over their rows: larger, heavier, full-value
     text, and a hairline underline that groups the rows beneath. Sits below the
     modal title in the hierarchy (title 28px), above the 16px row labels. */
  .section-label {
    font-family: var(--fell, serif); font-size: 19px; font-weight: 600; letter-spacing: .02em;
    color: var(--text, #33291a); margin: 22px 0 2px; padding: 0 0 6px;
    border-bottom: 1px solid var(--hairline-soft, rgba(122,95,48,.4));
  }
  .section-label:first-child { margin-top: 4px; }

  .row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 13px 0; border-bottom: 1px solid var(--hairline-soft, rgba(122,95,48,.4)); }
  .row:last-child { border-bottom: 0; }
  .row-label { font-family: var(--gara, serif); font-size: 16px; color: var(--text, #33291a); }

  /* Range slider */
  .range { display: flex; align-items: center; gap: 10px; }
  .range input { width: 150px; accent-color: var(--metal, #b08d4f); cursor: pointer; }
  .range-val { font-family: var(--mono, monospace); font-size: 13px; color: var(--text-muted, #5b4a30); min-width: 3ch; text-align: right; }

  .s-foot { display: flex; justify-content: flex-end; padding: 14px 0 22px; }
  .s-reset {
    font-family: var(--fell, serif); font-style: italic; font-size: 14px; color: var(--text-muted, #5b4a30);
    background: none; border: 0; padding: 4px 2px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px;
  }
  .s-reset:hover { color: var(--alert, #8f2f22); }

  :focus-visible { outline: 2px solid var(--metal-bright, #d8b878); outline-offset: 3px; }
`);

export class LedgerSettings extends HTMLElement {
  #lastFocus: HTMLElement | null = null;
  #trap: ((e: KeyboardEvent) => void) | null = null;

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.adoptedStyleSheets = [chromeSheet, sheet, scrollbarSheet];
    this.shadowRoot!.innerHTML = `
      <div class="scrim" part="scrim"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="s-title" tabindex="-1" part="panel">
        <div class="s-head">
          <span class="s-kicker" id="s-kicker">Preferences</span>
          <button class="ghost-btn" id="s-close" aria-keyshortcuts="Escape" title="Close (Esc)"><span aria-hidden="true">✕ </span>close</button>
        </div>
        <h2 class="s-title" id="s-title">Settings</h2>
        <div class="s-rule" aria-hidden="true"></div>
        <div class="s-body" id="s-body"></div>
        <div class="s-foot" id="s-foot" hidden><button class="s-reset" id="s-reset">Reset theme to defaults</button></div>
      </div>`;
    this.#$('.scrim').addEventListener('click', () => this.close());
    this.#$('#s-close').addEventListener('click', () => this.close());
    this.#$('#s-reset').addEventListener('click', () => this.#resetTheme());
  }

  #$<T extends Element = HTMLElement>(sel: string): T { return this.shadowRoot!.querySelector(sel) as T; }

  // Build the controls from current state and the active theme's schema.
  // Called on every open so the panel mirrors what's applied.
  #render(): void {
    const theme = activeTheme();
    const body = this.#$('#s-body');
    body.replaceChildren();

    // Display section (the-ledger core)
    body.append(this.#sectionLabel('Display'));
    body.append(this.#displayRows());

    // Theme section (plugin concern) — present only when the theme has knobs.
    const settings = theme?.settings ?? [];
    if (settings.length) {
      body.append(this.#sectionLabel('Theme'));
      const saved = loadSettings(theme!.id);
      for (const s of settings) {
        const cur = s.attr in saved ? saved[s.attr]! : s.default;
        body.append(this.#themeRow(theme!.id, s, cur));
      }
      this.#$('#s-foot').hidden = false;
    } else {
      this.#$('#s-foot').hidden = true;
    }
  }

  #sectionLabel(text: string): HTMLElement {
    return el('h3', 'section-label', text);
  }

  // Display section: view type + show closed.
  #displayRows(): DocumentFragment {
    const frag = document.createDocumentFragment();

    // View type (columns / outline)
    const viewRow = el('div', 'row');
    viewRow.append(el('span', 'row-label', 'View'));
    const seg = document.createElement('ledger-segment') as LedgerSegment;
    seg.setAttribute('aria-label', 'View type');
    seg.options = [
      { value: 'columns', label: 'columns' },
      { value: 'outline', label: 'outline' },
    ];
    seg.value = state.lens;
    seg.addEventListener('change', (e) => {
      const { value } = (e as CustomEvent).detail;
      state.lens = value as typeof state.lens;
      this.#emit('setting-changed', { key: 'lens', value });
    });
    viewRow.append(seg);
    frag.append(viewRow);

    // Show closed items
    const closedRow = el('div', 'row');
    closedRow.append(el('span', 'row-label', 'Show closed items'));
    const sw = document.createElement('ledger-switch') as LedgerSwitch;
    sw.setAttribute('label', 'Show closed items');
    sw.checked = state.status !== 'Open';
    sw.addEventListener('change', (e) => {
      const { checked } = (e as CustomEvent).detail;
      state.status = checked ? 'ALL' : 'Open';
      this.#emit('setting-changed', { key: 'status', value: state.status });
    });
    closedRow.append(sw);
    frag.append(closedRow);

    return frag;
  }

  // One theme knob row: label + control (mode segment, boolean switch, or range
  // slider). Each control writes through on change.
  #themeRow(id: string, s: ThemeSetting, cur: boolean | number | string): HTMLElement {
    const row = el('div', 'row');
    row.append(el('span', 'row-label', s.label));

    if (s.type === 'mode') {
      const seg = document.createElement('ledger-segment') as LedgerSegment;
      seg.setAttribute('aria-label', s.label);
      seg.options = (s.options ?? []).map((o) => ({ value: o.value, label: o.label }));
      seg.value = String(cur);
      seg.addEventListener('change', (e) => {
        const { value } = (e as CustomEvent).detail;
        saveSetting(id, s.attr, value, value === s.default);
        applyLiveSetting(s, value);
      });
      row.append(seg);
    } else if (s.type === 'boolean') {
      const sw = document.createElement('ledger-switch') as LedgerSwitch;
      sw.setAttribute('label', s.label);
      sw.checked = cur === true;
      sw.addEventListener('change', (e) => {
        const v = (e as CustomEvent).detail.checked as boolean;
        saveSetting(id, s.attr, v, v === s.default);
        applyLiveSetting(s, v);
      });
      row.append(sw);
    } else {
      const wrap = el('div', 'range');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(s.min ?? 0); input.max = String(s.max ?? 100); input.step = String(s.step ?? 1);
      input.value = String(cur);
      input.setAttribute('aria-label', s.label);
      const read = el('span', 'range-val', String(cur));
      input.addEventListener('input', () => {
        const v = Number(input.value);
        read.textContent = String(v);
        saveSetting(id, s.attr, v, v === s.default);
        applyLiveSetting(s, v);
      });
      wrap.append(input, read);
      row.append(wrap);
    }
    return row;
  }

  // Clear theme knobs to defaults; rebuild controls.
  #resetTheme(): void {
    const theme = activeTheme();
    if (!theme?.settings) return;
    for (const s of theme.settings) {
      saveSetting(theme.id, s.attr, s.default, true);
      applyLiveSetting(s, s.default);
    }
    this.#render();
  }

  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  open(): void {
    if (this.hasAttribute('open')) return;
    this.#render();
    this.#lastFocus = document.activeElement as HTMLElement | null;
    this.setAttribute('open', '');
    this.#$('.panel').focus();
    this.#trap = (e: KeyboardEvent) => this.#trapFocus(e);
    document.addEventListener('keydown', this.#trap, true);
    this.shadowRoot!.addEventListener('keydown', this.#handleEsc);
  }

  close(): void {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    if (this.#trap) { document.removeEventListener('keydown', this.#trap, true); this.#trap = null; }
    this.shadowRoot!.removeEventListener('keydown', this.#handleEsc);
    if (this.#lastFocus && this.#lastFocus.isConnected) this.#lastFocus.focus();
    this.#lastFocus = null;
  }

  #handleEsc = (e: Event): void => { if ((e as KeyboardEvent).key === 'Escape') this.close(); };

  #trapFocus(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.hasAttribute('open')) return;
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = [...this.#$('.panel').querySelectorAll<HTMLElement>(sel)].filter((n) => !n.hidden && n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0]!, last = focusables[focusables.length - 1]!;
    const active = this.shadowRoot!.activeElement;
    if (e.shiftKey && (active === first || active === this.#$('.panel'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
}

if (!customElements.get('ledger-settings')) customElements.define('ledger-settings', LedgerSettings);
