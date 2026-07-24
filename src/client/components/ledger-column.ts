// <ledger-column> — one column of the columns lens (Epics / Stories / Tasks).
// Shadow DOM holds only the chrome: a titled head with the item count and the
// tier's "§" mark, and a scrolling body that projects its light-DOM children
// through a <slot>. Cards, hints, lane labels, and empty messages are passed in
// as children — they stay in the light DOM, so the board's existing CSS styles
// them, and <ledger-card> keeps its own shadow styling.
//
// Attributes: `tier` (epic|story|task), `heading`, `count` (integer). The count
// renders as "N items" / "1 item"; a missing/zero count still shows "0 items".

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: flex; flex-direction: column; min-height: 0; position: relative;
    border-right: 1px solid rgba(122,95,48,.35);
    background: linear-gradient(180deg, rgba(176,141,79,.05), transparent 40%); }
  :host(:last-of-type) { border-right: 0; }
  .col-head {
    display: flex; align-items: baseline; justify-content: space-between;
    padding: 16px 20px 12px; border-bottom: 1px solid var(--brass-lo, #7a5f30); position: relative;
  }
  h3 {
    margin: 0; font-family: var(--fell-sc, Georgia, serif); font-weight: 400; font-size: 21px;
    letter-spacing: .06em; color: var(--brass-hi, #d8b878); text-shadow: 0 1px 0 rgba(0,0,0,.5);
  }
  h3::before { content: "§ "; opacity: .5; }
  .count { font-family: var(--fell, serif); font-style: italic; font-size: 15px; color: var(--brass-hi, #d8b878); }
  /* Generous horizontal padding leaves clear space between the cards' torn
     (deckle-displaced) edges and the column divider / scrollbar gutter.
     overflow-x is hidden explicitly: the deckle filter paints a few px past the
     card box, which would otherwise promote the auto y-scroll into a spurious
     horizontal scrollbar. The padding keeps the torn edge clear of this clip. */
  .col-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 16px 24px; }
`);

export class LedgerColumn extends HTMLElement {
  static observedAttributes = ['heading', 'count'];

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot!.adoptedStyleSheets = [sheet];
      this.shadowRoot!.innerHTML = `
        <div class="col-head" part="head">
          <h3 part="heading"></h3>
          <span class="count" part="count"></span>
        </div>
        <div class="col-body" part="body"><slot></slot></div>`;
    }
    this.#sync();
  }

  attributeChangedCallback(): void { if (this.shadowRoot) this.#sync(); }

  #sync(): void {
    const root = this.shadowRoot!;
    root.querySelector('h3')!.textContent = this.getAttribute('heading') || '';
    const n = Number(this.getAttribute('count') || 0);
    root.querySelector('.count')!.textContent = n === 1 ? '1 item' : `${n} items`;
  }
}

if (!customElements.get('ledger-column')) customElements.define('ledger-column', LedgerColumn);
