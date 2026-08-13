// <ledger-switch> — a brass-tracked toggle switch.
// Attributes: checked (boolean), label (aria-label text).
// Emits `change` (composed, bubbles) with detail { checked: boolean }.

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: inline-block; position: relative; width: 46px; height: 24px; flex: 0 0 auto; cursor: pointer; }
  input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
  /* The track and thumb paint over the invisible input; pointer-events:none lets
     clicks fall through to the input beneath (no wrapping <label> to forward them). */
  .track { position: absolute; inset: 0; border-radius: 999px; background: var(--well, rgba(20,14,7,.6)); border: 1px solid var(--metal-dim, #7a5f30); transition: .18s; pointer-events: none; }
  .thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--metal, #b08d4f); transition: .18s; box-shadow: 0 1px 2px rgba(0,0,0,.5); pointer-events: none; }
  input:checked + .track { background: var(--seg-on-bg, linear-gradient(180deg, var(--metal-bright, #d8b878), var(--metal, #b08d4f))); }
  input:checked + .track + .thumb { left: 24px; background: var(--frame-deep, #1c1409); }
  input:focus-visible + .track { outline: 2px solid var(--metal-bright, #d8b878); outline-offset: 2px; }
`);

export class LedgerSwitch extends HTMLElement {
  #input!: HTMLInputElement;

  static get observedAttributes(): string[] { return ['checked', 'label']; }

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.adoptedStyleSheets = [sheet];
    this.#input = document.createElement('input');
    this.#input.type = 'checkbox';
    this.#input.checked = this.hasAttribute('checked');
    this.#input.setAttribute('aria-label', this.getAttribute('label') || '');
    const track = document.createElement('span');
    track.className = 'track'; track.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('span');
    thumb.className = 'thumb'; thumb.setAttribute('aria-hidden', 'true');
    this.shadowRoot!.append(this.#input, track, thumb);
    this.#input.addEventListener('change', () => {
      this.toggleAttribute('checked', this.#input.checked);
      this.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true, detail: { checked: this.#input.checked } }));
    });
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null): void {
    if (!this.#input) return;
    if (name === 'checked') this.#input.checked = val !== null;
    else if (name === 'label') this.#input.setAttribute('aria-label', val || '');
  }

  get checked(): boolean { return this.hasAttribute('checked'); }
  set checked(v: boolean) { this.toggleAttribute('checked', v); if (this.#input) this.#input.checked = v; }
}

if (!customElements.get('ledger-switch')) customElements.define('ledger-switch', LedgerSwitch);
