// <ledger-load-more> — the "showing N of M · Load more" control shown at the foot
// of the stage when the active source paginates its roots (the pagedRoots
// capability) and more pages remain. Presentational: the board sets its `loaded` /
// `total` / `loading` attributes and listens for the `load-more` event, then fetches
// the next page and updates them. Shadow DOM, styled from the :root design tokens
// (which inherit through the boundary), matching the leather-stage chrome the
// columns/outline lanes sit on rather than parchment.
//
// It sits OUTSIDE the scrolling lens containers (a sibling of .columns/.outline in
// the stage), so it stays pinned at the bottom regardless of which lens is active —
// the control is about the root SET, not either lens's layout.

import { el, asButton } from './util.js';

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: block; }
  :host([hidden]) { display: none; }
  .bar {
    display: flex; align-items: center; justify-content: center; gap: 14px;
    padding: 12px 20px; border-top: 1px solid rgba(160,120,60,.18);
    font-family: var(--fell, serif); color: var(--metal-bright, #cbb07a);
  }
  .count { font-style: italic; font-size: 14px; opacity: .85; }
  button {
    font-family: var(--fell, serif); font-size: 15px; letter-spacing: .02em;
    color: var(--frame-text-strong, #f3ead0); background: rgba(80,60,32,.55);
    border: 1px solid var(--border, #c4ac7c); border-radius: 3px;
    padding: 5px 16px; cursor: pointer; transition: background .12s, opacity .12s;
  }
  button:hover:not(:disabled) { background: var(--seal, var(--alert, #8f2f22)); border-color: transparent; }
  button:disabled { opacity: .6; cursor: default; }
  .spin {
    display: inline-block; width: 11px; height: 11px; margin-right: 7px; vertical-align: -1px;
    border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
    animation: lm-spin .7s linear infinite;
  }
  @keyframes lm-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
`);

export class LedgerLoadMore extends HTMLElement {
  static observedAttributes = ['loaded', 'total', 'loading'];

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot!.adoptedStyleSheets = [sheet];
    }
    this.#render();
  }

  attributeChangedCallback(): void { this.#render(); }

  #render(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const loaded = this.getAttribute('loaded') || '?';
    const total = this.getAttribute('total');
    const loading = this.hasAttribute('loading');

    root.replaceChildren();
    const bar = el('div', 'bar');
    // "showing 100 of 1188" when the total is known; otherwise just the loaded count.
    bar.append(el('span', 'count', total ? `Showing ${loaded} of ${total}` : `Showing ${loaded}`));

    const btn = el('button', null) as HTMLButtonElement;
    btn.type = 'button';
    if (loading) {
      const spin = el('span', 'spin'); spin.setAttribute('aria-hidden', 'true');
      btn.append(spin, document.createTextNode('Loading…'));
      btn.disabled = true;
    } else {
      btn.textContent = 'Load more';
    }
    // Emit an intent event; the board does the fetch and updates the attributes.
    asButton(btn, () => { if (!this.hasAttribute('loading')) this.dispatchEvent(new CustomEvent('load-more', { bubbles: true, composed: true })); },
      total ? `Load more items (showing ${loaded} of ${total})` : 'Load more items');
    bar.append(btn);
    root.append(bar);
  }
}

if (!customElements.get('ledger-load-more')) customElements.define('ledger-load-more', LedgerLoadMore);
