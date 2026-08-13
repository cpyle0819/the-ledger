// <ledger-segment> — a brass-framed segmented control (pill group).
// Usage: set .options and .value properties. Emits `change` (composed, bubbles)
// with detail { value: string }.
//
// Options shape: Array<{ value: string; label: string }>

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: inline-flex; border: 1px solid var(--metal-dim, #7a5f30); border-radius: 999px; overflow: hidden; background: var(--well, rgba(20,14,7,.6)); }
  button {
    font-family: var(--gara, serif); font-size: 14px; color: var(--text-muted, #5b4a30);
    background: transparent; border: 0; padding: 6px 16px; cursor: pointer; transition: .15s; line-height: 1.3;
  }
  button + button { border-left: 1px solid var(--hairline-soft, rgba(122,95,48,.4)); }
  button:hover { color: var(--text, #33291a); }
  button[aria-pressed="true"] {
    color: var(--seg-on-fg, var(--frame-deep, #1c1409)); font-weight: 600;
    background: var(--seg-on-bg, linear-gradient(180deg, var(--metal-bright, #d8b878), var(--metal, #b08d4f)));
  }
  button:focus-visible { outline: 2px solid var(--focus-ring-onlight, var(--metal-bright, #d8b878)); outline-offset: -2px; }
`);

export interface SegmentOption { value: string; label: string; }

export class LedgerSegment extends HTMLElement {
  #options: SegmentOption[] = [];
  #value = '';

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.adoptedStyleSheets = [sheet];
    this.setAttribute('role', 'group');
    this.#paint();
  }

  get options(): SegmentOption[] { return this.#options; }
  set options(v: SegmentOption[]) { this.#options = v; this.#paint(); }

  get value(): string { return this.#value; }
  set value(v: string) { this.#value = v; this.#syncPressed(); }

  #paint(): void {
    if (!this.shadowRoot) return;
    this.shadowRoot!.replaceChildren();
    for (const o of this.#options) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.value = o.value; b.textContent = o.label;
      b.setAttribute('aria-pressed', String(o.value === this.#value));
      b.addEventListener('click', () => {
        this.#value = o.value;
        this.#syncPressed();
        this.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true, detail: { value: o.value } }));
      });
      this.shadowRoot!.append(b);
    }
  }

  #syncPressed(): void {
    if (!this.shadowRoot) return;
    for (const b of this.shadowRoot.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.value === this.#value));
    }
  }
}

if (!customElements.get('ledger-segment')) customElements.define('ledger-segment', LedgerSegment);
