// <ledger-column> — one column of the columns lens (Epics / Stories / Tasks).
// Shadow DOM holds only the chrome: a titled head with the item count and the
// tier's "§" mark, and a scrolling body that projects its light-DOM children
// through a <slot>. Cards, hints, lane labels, and empty messages are passed in
// as children — they stay in the light DOM, so the board's existing CSS styles
// them, and <ledger-card> keeps its own shadow styling.
//
// Attributes: `tier` (epic|story|task), `heading`, `count` (integer). The count
// renders as "N items" / "1 item"; a missing/zero count still shows "0 items".
// `add-label` (optional): when set, the head shows a "+" button carrying that
// label as its tooltip/aria-label; clicking it emits a composed `column-add`.

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: flex; flex-direction: column; min-height: 0; position: relative;
    border-right: 1px solid rgba(122,95,48,.35);
    background: linear-gradient(180deg, rgba(176,141,79,.05), transparent 40%); }
  :host(:last-of-type) { border-right: 0; }
  .col-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    padding: 16px 20px 12px; border-bottom: 1px solid var(--brass-lo, #7a5f30); position: relative;
  }
  h3 {
    margin: 0; font-family: var(--fell-sc, Georgia, serif); font-weight: 400; font-size: 21px;
    letter-spacing: .06em; color: var(--brass-hi, #d8b878); text-shadow: 0 1px 0 rgba(0,0,0,.5);
  }
  h3::before { content: "§ "; opacity: .5; }
  .head-right { display: flex; align-items: baseline; gap: 12px; }
  .count { font-family: var(--fell, serif); font-style: italic; font-size: 17px; color: var(--brass-hi, #d8b878); }
  /* The add "+" sits by the count; a small brass roundel that brightens on hover. */
  .col-add {
    align-self: center; width: 24px; height: 24px; padding: 0; cursor: pointer;
    font-size: 18px; line-height: 1; color: var(--brass-hi, #d8b878);
    background: linear-gradient(180deg, var(--leather, #2a1c10), var(--leather-2, #33230f));
    border: 1px solid var(--brass-lo, #7a5f30); border-radius: 50%; transition: .15s;
  }
  .col-add:hover { color: #fff; border-color: var(--brass, #b08d4f); }
  .col-add[hidden] { display: none; }
  /* Generous horizontal padding leaves clear space between the cards' torn
     (deckle-displaced) edges and the column divider / scrollbar gutter.
     overflow-x is hidden explicitly: the deckle filter paints a few px past the
     card box, which would otherwise promote the auto y-scroll into a spurious
     horizontal scrollbar. The padding keeps the torn edge clear of this clip. */
  .col-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 16px 24px; }
`);

export class LedgerColumn extends HTMLElement {
  static observedAttributes = ['heading', 'count', 'add-label'];

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot!.adoptedStyleSheets = [sheet];
      this.shadowRoot!.innerHTML = `
        <div class="col-head" part="head">
          <h3 part="heading"></h3>
          <span class="head-right">
            <span class="count" part="count"></span>
            <button type="button" class="col-add" part="add" hidden>+</button>
          </span>
        </div>
        <div class="col-body" part="body"><slot></slot></div>`;
      this.shadowRoot!.querySelector('.col-add')!.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('column-add', { bubbles: true, composed: true }));
      });
    }
    this.#sync();
  }

  attributeChangedCallback(): void { if (this.shadowRoot) this.#sync(); }

  #sync(): void {
    const root = this.shadowRoot!;
    root.querySelector('h3')!.textContent = this.getAttribute('heading') || '';
    const n = Number(this.getAttribute('count') || 0);
    root.querySelector('.count')!.textContent = n === 1 ? '1 item' : `${n} items`;
    // The add "+" shows only when a label is set; the label is its tooltip + a11y name.
    const label = this.getAttribute('add-label');
    const add = root.querySelector('.col-add') as HTMLButtonElement;
    add.hidden = !label;
    if (label) { add.title = label; add.setAttribute('aria-label', label); }
  }
}

if (!customElements.get('ledger-column')) customElements.define('ledger-column', LedgerColumn);
