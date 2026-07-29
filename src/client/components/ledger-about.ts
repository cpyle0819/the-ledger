// <ledger-about> — the "About" modal: a short in-app explainer of why the Ledger
// is opinionated (three tiers, measured velocity). A centered manuscript leaf over
// a scrim, echoing the reading drawer's chrome (parchment panel, brass rule, focus
// trap, Esc/scrim-click to close) but simpler — it holds fixed prose, injects no
// services, and reads rather than edits.
//
// Open with .open(); close with .close(), Escape, the close button, or a scrim
// click. The content is authored here as structured DOM (headings + paragraphs),
// styled from the :root design tokens that inherit through the shadow boundary.

import { el, asButton } from './util.js';
import { chromeSheet } from './shared-styles.js';

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { position: fixed; inset: 0; z-index: 500; pointer-events: none; }
  :host([open]) { pointer-events: auto; }
  .scrim { position: absolute; inset: 0; background: rgba(12,8,3,.6); opacity: 0; transition: opacity .3s; }
  :host([open]) .scrim { opacity: 1; }
  /* A centered leaf, not the drawer's right-edge slide: this is a read, not a
     workspace. Rises and fades in; caps its height and scrolls its own body. */
  .panel {
    position: absolute; top: 50%; left: 50%; width: min(640px, 92vw); max-height: 88vh;
    transform: translate(-50%, -46%); opacity: 0;
    transition: transform .3s cubic-bezier(.2,.8,.2,1), opacity .3s;
    display: flex; flex-direction: column; color: var(--ink, #33291a);
    background:
      radial-gradient(120% 55% at 0% 0%, rgba(196,172,124,.35), transparent 60%),
      linear-gradient(180deg, var(--parch-hi, #f3ead0), var(--parch, #e8dbba) 70%, var(--parch-lo, #d8c69c));
    border: 1px solid var(--brass-lo, #7a5f30); border-top: 6px solid var(--brass-lo, #7a5f30);
    border-radius: 3px; box-shadow: 0 28px 60px rgba(0,0,0,.5);
    padding: 26px 34px 0;
  }
  :host([open]) .panel { transform: translate(-50%, -50%); opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .scrim, .panel { transition: none; }
  }

  .a-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .a-kicker { font-family: var(--fell-sc, serif); font-size: 13px; letter-spacing: .1em; color: var(--ink-red, #8f2f22); }
  .ghost-btn {
    font-family: var(--fell, serif); font-style: italic; font-size: 16px; color: var(--brass-hi, #d8b878);
    background: linear-gradient(180deg, var(--leather, #2a1c10), var(--leather-2, #33230f));
    border: 1px solid var(--brass-lo, #7a5f30); border-radius: 2px; padding: 7px 14px; cursor: pointer; transition: .15s;
    box-shadow: 0 1px 2px rgba(0,0,0,.4), inset 0 1px 0 rgba(216,184,120,.15);
  }
  .ghost-btn:hover { color: #fff; border-color: var(--brass, #b08d4f); background: linear-gradient(180deg, var(--leather-2, #33230f), var(--leather, #2a1c10)); }

  .a-title { font-family: var(--fell, serif); font-weight: 400; font-size: 30px; line-height: 1.2; margin: 12px 0 6px; color: var(--ink, #33291a); }
  .a-lede { font-family: var(--gara, serif); font-size: 16px; line-height: 1.6; color: var(--ink-soft, #5b4a30); font-style: italic; margin: 0 0 4px; }
  .a-rule { height: 2px; background: linear-gradient(90deg, var(--brass-lo, #7a5f30), transparent); margin: 16px 0 4px; }

  /* The scrolling body holds the prose; the head + rule stay pinned above it. */
  .a-body { overflow-y: auto; padding: 14px 0 0; }
  .a-body h3 {
    font-family: var(--fell-sc, serif); font-weight: 400; font-size: 15px; letter-spacing: .06em;
    color: var(--ink-red, #8f2f22); margin: 22px 0 8px;
  }
  .a-body h3:first-child { margin-top: 0; }
  .a-body p { font-family: var(--gara, serif); font-size: 16px; line-height: 1.7; color: var(--ink, #33291a); margin: 0 0 12px; }
  .a-body em { font-style: italic; color: var(--ink-soft, #5b4a30); }
  .a-tail { height: 30px; flex: 0 0 auto; }

  :focus-visible { outline: 2px solid var(--brass-hi, #d8b878); outline-offset: 3px; }
`);

// The doc content, as a flat list of blocks. Each entry is a heading (h3) or a
// paragraph (p). Authored here so the prose has one home; the render walk below
// turns it into styled DOM.
type Block = { h: string } | { p: string };
const DOC: Block[] = [
  { h: 'Why the Ledger uses epics, stories, and tasks' },
  { p: 'The Ledger sorts every item into one of three tiers: epic, story, task. Whatever depth your previous tracker allowed, the Ledger flattens it to these three. This is deliberate.' },
  { p: 'Three tiers answer three questions, and together they tell you where a plan stands. An epic is the outcome: the why. A story is a shippable piece of that outcome: the what. A task is a unit of work: the how. Any tier beyond these gives progress another place to hide. At three, you can read the whole board at once: this is the goal, these are the deliverables, this is what is being worked right now.' },
  { p: 'Three tiers also fix the size of a unit of work. When work nests without limit, "we finished 40 points" means nothing: points buried deep are not the same size as points near the top, and a parent and its children get counted twice. Making the task the smallest unit is what makes progress countable.' },
];

export class LedgerAbout extends HTMLElement {
  #lastFocus: HTMLElement | null = null;
  #trap: ((e: KeyboardEvent) => void) | null = null;

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.adoptedStyleSheets = [chromeSheet, sheet];
    this.shadowRoot!.innerHTML = `
      <div class="scrim" part="scrim"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-labelledby="a-title" tabindex="-1" part="panel">
        <div class="a-head">
          <span class="a-kicker">The Ledger</span>
          <button class="ghost-btn" id="a-close" aria-keyshortcuts="Escape" title="Close (Esc)"><span aria-hidden="true">✕ </span>close</button>
        </div>
        <h2 class="a-title" id="a-title">An archive of works, and its opinions</h2>
        <p class="a-lede">Why the board looks the way it does.</p>
        <div class="a-rule" aria-hidden="true"></div>
        <div class="a-body" id="a-body"></div>
        <div class="a-tail" aria-hidden="true"></div>
      </div>`;
    this.#renderDoc();
    this.#$('.scrim').addEventListener('click', () => this.close());
    this.#$('#a-close').addEventListener('click', () => this.close());
    this.shadowRoot!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') this.close();
    });
  }

  #$<T extends Element = HTMLElement>(sel: string): T { return this.shadowRoot!.querySelector(sel) as T; }

  #renderDoc(): void {
    const body = this.#$('#a-body');
    body.replaceChildren();
    for (const b of DOC) {
      if ('h' in b) body.append(el('h3', null, b.h));
      else body.append(el('p', null, b.p));
    }
  }

  open(): void {
    if (this.hasAttribute('open')) return;
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

  // Keep Tab within the dialog's focusables (the close button and any links in the
  // prose), cycling at both ends.
  #trapFocus(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.hasAttribute('open')) return;
    const sel = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = [...this.#$('.panel').querySelectorAll<HTMLElement>(sel)].filter((n) => !n.hidden && n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0]!, last = focusables[focusables.length - 1]!;
    const active = this.shadowRoot!.activeElement;
    if (e.shiftKey && (active === first || active === this.#$('.panel'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
}

if (!customElements.get('ledger-about')) customElements.define('ledger-about', LedgerAbout);
