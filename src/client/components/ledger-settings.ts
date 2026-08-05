// <ledger-settings> — the theme settings panel behind the masthead gear. A theme
// declares its tunable knobs in its manifest (`settings`: a list of {attr, type,
// label, default, …}); this panel renders a control per knob and writes the
// user's choice back through the theme controller — into localStorage (so it
// survives reloads) and onto the live ambient/logo element (so it takes effect at
// once). The controller stays theme-agnostic: it renders whatever the schema
// declares and understands no specific attr, exactly as it mounts ambient/logo.
//
// Shares the About modal's chrome verbatim — a centered leaf over a scrim, brass
// rule, focus trap, Esc/scrim-click to close. Reopen re-reads current values, so
// the controls always mirror what's applied. A theme with no `settings` has no
// gear (app.ts hides the button), so this panel is only reachable when there is
// something to tune.

import { el } from './util.js';
import { chromeSheet, scrollbarSheet } from './shared-styles.js';
import {
  activeTheme, loadSettings, saveSetting, applyLiveSetting,
  type ThemeSetting,
} from '../core/theme.js';

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
  .s-lede { font-family: var(--gara, serif); font-size: 15px; line-height: 1.6; color: var(--text-muted, #5b4a30); font-style: italic; margin: 0 0 4px; }
  .s-rule { height: 2px; background: linear-gradient(90deg, var(--metal-dim, #7a5f30), transparent); margin: 16px 0 4px; }

  .s-body { overflow-y: auto; padding: 8px 0 0; }
  /* One knob per row: label at the left, its control at the right. */
  .row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 13px 0; border-bottom: 1px solid var(--hairline-soft, rgba(122,95,48,.4)); }
  .row:last-child { border-bottom: 0; }
  .row-label { font-family: var(--gara, serif); font-size: 16px; color: var(--text, #33291a); }

  /* Toggle switch — a brass-tracked pill echoing the board's "show closed". */
  .switch { position: relative; width: 46px; height: 24px; flex: 0 0 auto; cursor: pointer; }
  .switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
  .track { position: absolute; inset: 0; border-radius: 999px; background: var(--well, rgba(20,14,7,.6)); border: 1px solid var(--metal-dim, #7a5f30); transition: .18s; }
  .thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--metal, #b08d4f); transition: .18s; box-shadow: 0 1px 2px rgba(0,0,0,.5); }
  .switch input:checked + .track { background: var(--seg-on-bg, linear-gradient(180deg, var(--metal-bright, #d8b878), var(--metal, #b08d4f))); }
  .switch input:checked + .track + .thumb { left: 24px; background: var(--frame-deep, #1c1409); }
  .switch input:focus-visible + .track { outline: 2px solid var(--metal-bright, #d8b878); outline-offset: 2px; }

  /* Range slider + its live numeric read-out. */
  .range { display: flex; align-items: center; gap: 10px; }
  .range input { width: 150px; accent-color: var(--metal, #b08d4f); cursor: pointer; }
  .range-val { font-family: var(--mono, monospace); font-size: 13px; color: var(--text-muted, #5b4a30); min-width: 3ch; text-align: right; }

  /* Segmented mode control (e.g. Light / Dark) — a brass-framed pill group; the
     active segment fills with the theme's on-gradient, matching the board's segs. */
  .segmode { display: inline-flex; border: 1px solid var(--metal-dim, #7a5f30); border-radius: 999px; overflow: hidden; background: var(--well, rgba(20,14,7,.6)); }
  .segmode button {
    font-family: var(--gara, serif); font-size: 14px; color: var(--text-muted, #5b4a30);
    background: transparent; border: 0; padding: 6px 16px; cursor: pointer; transition: .15s; line-height: 1.3;
  }
  .segmode button + button { border-left: 1px solid var(--hairline-soft, rgba(122,95,48,.4)); }
  .segmode button:hover { color: var(--text, #33291a); }
  .segmode button[aria-pressed="true"] {
    color: var(--seg-on-fg, var(--frame-deep, #1c1409)); font-weight: 600;
    background: var(--seg-on-bg, linear-gradient(180deg, var(--metal-bright, #d8b878), var(--metal, #b08d4f)));
  }
  .segmode button:focus-visible { outline: 2px solid var(--focus-ring-onlight, var(--metal-bright, #d8b878)); outline-offset: -2px; }

  .s-foot { display: flex; justify-content: flex-end; padding: 14px 0 22px; }
  .s-reset {
    font-family: var(--fell, serif); font-style: italic; font-size: 14px; color: var(--text-muted, #5b4a30);
    background: none; border: 0; padding: 4px 2px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px;
  }
  .s-reset:hover { color: var(--alert, #8f2f22); }
  .s-empty { font-family: var(--gara, serif); font-style: italic; color: var(--text-muted, #5b4a30); padding: 8px 0 24px; }

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
          <span class="s-kicker" id="s-kicker">Theme</span>
          <button class="ghost-btn" id="s-close" aria-keyshortcuts="Escape" title="Close (Esc)"><span aria-hidden="true">✕ </span>close</button>
        </div>
        <h2 class="s-title" id="s-title">Settings</h2>
        <p class="s-lede">Tune this theme's atmosphere. Saved for this browser.</p>
        <div class="s-rule" aria-hidden="true"></div>
        <div class="s-body" id="s-body"></div>
        <div class="s-foot" id="s-foot" hidden><button class="s-reset" id="s-reset">Reset to theme defaults</button></div>
      </div>`;
    this.#$('.scrim').addEventListener('click', () => this.close());
    this.#$('#s-close').addEventListener('click', () => this.close());
    this.#$('#s-reset').addEventListener('click', () => this.#reset());
    this.shadowRoot!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.close();
    });
  }

  #$<T extends Element = HTMLElement>(sel: string): T { return this.shadowRoot!.querySelector(sel) as T; }

  // Whether the active theme has anything to configure — app.ts reads this to
  // show or hide the gear.
  get hasSettings(): boolean { return !!activeTheme()?.settings?.length; }

  // (Re)build the controls from the active theme's schema and current saved
  // values. Called on every open so the panel mirrors what's applied.
  #render(): void {
    const theme = activeTheme();
    const body = this.#$('#s-body');
    body.replaceChildren();
    this.#$('#s-kicker').textContent = theme?.name ?? 'Theme';
    const settings = theme?.settings ?? [];
    const foot = this.#$('#s-foot');
    if (!settings.length) {
      body.append(el('p', 's-empty', 'This theme has nothing to configure.'));
      foot.hidden = true;
      return;
    }
    foot.hidden = false;
    const saved = loadSettings(theme!.id);
    for (const s of settings) {
      const cur = s.attr in saved ? saved[s.attr]! : s.default;
      body.append(this.#row(theme!.id, s, cur));
    }
  }

  // One knob row: its label plus a switch (boolean) or slider (range). Each
  // control writes through on change — persist the value (dropping it when it
  // equals the theme default) and apply it live to the mounted component.
  #row(id: string, s: ThemeSetting, cur: boolean | number | string): HTMLElement {
    const row = el('div', 'row');
    const label = el('span', 'row-label', s.label);
    row.append(label);

    if (s.type === 'mode') {
      // A segmented pick from s.options; the chosen value is written straight to
      // the target (a data-attr on <html> for a light/dark palette). No live
      // remount — the token cascade repaints on the attribute change.
      const group = el('div', 'segmode');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', s.label);
      const opts = s.options ?? [];
      const paint = (chosen: string) => {
        for (const b of group.children) {
          (b as HTMLElement).setAttribute('aria-pressed', String((b as HTMLElement).dataset.value === chosen));
        }
      };
      for (const o of opts) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.value = o.value; b.textContent = o.label;
        b.addEventListener('click', () => {
          saveSetting(id, s.attr, o.value, o.value === s.default);
          applyLiveSetting(s, o.value);
          paint(o.value);
        });
        group.append(b);
      }
      paint(String(cur));
      row.append(group);
    } else if (s.type === 'boolean') {
      const wrap = el('label', 'switch');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = cur === true;
      input.setAttribute('aria-label', s.label);
      const track = el('span', 'track'); track.setAttribute('aria-hidden', 'true');
      const thumb = el('span', 'thumb'); thumb.setAttribute('aria-hidden', 'true');
      wrap.append(input, track, thumb);
      input.addEventListener('change', () => {
        const v = input.checked;
        saveSetting(id, s.attr, v, v === s.default);
        applyLiveSetting(s, v);
      });
      row.append(wrap);
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

  // Clear every knob back to its theme default: wipe the saved value, apply the
  // default live, then rebuild the controls to match.
  #reset(): void {
    const theme = activeTheme();
    if (!theme?.settings) return;
    for (const s of theme.settings) {
      saveSetting(theme.id, s.attr, s.default, true);
      applyLiveSetting(s, s.default);
    }
    this.#render();
  }

  open(): void {
    if (this.hasAttribute('open')) return;
    this.#render();
    this.#lastFocus = document.activeElement as HTMLElement | null;
    this.setAttribute('open', '');
    this.#$('.panel').focus();
    this.#trap = (e: KeyboardEvent) => this.#trapFocus(e);
    document.addEventListener('keydown', this.#trap, true);
  }

  close(): void {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    if (this.#trap) { document.removeEventListener('keydown', this.#trap, true); this.#trap = null; }
    if (this.#lastFocus && this.#lastFocus.isConnected) this.#lastFocus.focus();
    this.#lastFocus = null;
  }

  // Keep Tab within the dialog's focusables, cycling at both ends.
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
