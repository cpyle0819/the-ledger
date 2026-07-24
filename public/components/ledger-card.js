'use strict';

// <ledger-card> — a parchment slip for one Epic/Story/Task item.
//
// Data in: the `item` JS property (a shaped node — rich data, so a property, not
// an attribute). Reflected flags as attributes: `selected`, `drill` (shows the
// drill chevron for a card that opens children rather than details).
//
// Events out (composed, so they cross the shadow boundary):
//   card-activate {id}  — primary click: drill into children, or open if a leaf
//   card-open     {id}  — the "view details" affordance / a leaf card's click
//
// Self-contained: the deckled paper edge is an SVG turbulence filter inlined in
// this component's own shadow root. SVG filter references (url(#…)) resolve
// within the element's tree, so a document-level filter would not reach here —
// each card carries its own, which also makes the element reusable anywhere.

import { el, asButton } from './util.js';
import { chromeSheet, idTag } from './shared-styles.js';

const cardSheet = new CSSStyleSheet();
cardSheet.replaceSync(`
  :host { display: block; margin-bottom: 13px; }
  :host([hidden]) { display: none; }
  .card {
    /* border-box so width:100% + padding stays within the host/column — the
       shadow root doesn't inherit the document's global border-box, and without
       this the padding inflates the card box past the column edge. */
    box-sizing: border-box;
    position: relative; display: block; width: 100%; text-align: left;
    color: var(--ink, #33291a); background: transparent; border: 0;
    /* Padding tuned so content sits an even ~16px inside the visible parchment
       on both sides (the paper's inset is near-symmetric with the card box). */
    padding: 14px 15px 13px 12px; cursor: pointer; font: inherit;
    transition: transform .13s ease, filter .15s ease;
  }
  /* The parchment leaf: a separate layer so the deckle displacement can chew
     rough edges into the paper without disturbing the crisp text above it.
     Inset horizontally so the deckle's bulge (the turbulence displaces the edge
     unevenly, more on some sides than others) stays INSIDE the card box — the
     column body's padding then shows as an even leather gutter on both sides,
     instead of the bulge overflowing the right into the column's overflow clip. */
  .paper {
    content: ""; position: absolute; inset: 0 -5px 0 -4px; z-index: 0; pointer-events: none;
    background:
      radial-gradient(120px 80px at 82% 14%, rgba(120,80,40,.10), transparent 70%),
      url("/paper-stain.svg"),
      linear-gradient(180deg, var(--parch-hi, #f3ead0), var(--parch, #e8dbba) 60%, var(--parch-lo, #d8c69c));
    background-size: auto, 360px 260px, auto;
    background-blend-mode: multiply, multiply, normal;
    box-shadow: 1px 2px 4px rgba(0,0,0,.22), inset 0 0 30px rgba(160,120,60,.06), inset 0 0 0 1px rgba(196,172,124,.5);
    filter: url(#ledger-deckle);
  }
  .body { position: relative; z-index: 1; }
  :host([animate]) .card { animation: unfurl .4s cubic-bezier(.2,.7,.3,1) both; }
  @keyframes unfurl { from { opacity: 0; transform: translateY(10px) rotate(-.4deg); } }
  .card:hover .paper { box-shadow: 2px 4px 9px rgba(0,0,0,.3), inset 0 0 30px rgba(160,120,60,.08), inset 0 0 0 1px rgba(196,172,124,.6); }

  :host([selected]) .card { transform: translateY(-1px) rotate(-.2deg); }
  :host([selected]) .paper {
    box-shadow: 2px 4px 12px rgba(0,0,0,.34), inset 0 0 34px rgba(160,120,60,.16);
    background:
      radial-gradient(120px 80px at 82% 14%, rgba(120,80,40,.10), transparent 70%),
      url("/paper-stain.svg"),
      linear-gradient(180deg, var(--parch-hi, #f3ead0), var(--parch-hi, #f3ead0) 55%, var(--parch, #e8dbba));
    background-size: auto, 360px 260px, auto;
    background-blend-mode: multiply, multiply, normal;
  }
  /* Selected: a bold gilded frame, applied like a shoddy gold-leaf job — the
     gild is laid on thick then run through the same deckle displacement as the
     paper, so its edges fringe and flake unevenly instead of reading as a clean
     machined rule. The gradient is stepped (hard color stops) so the metal looks
     patchy and hand-burnished, not a smooth foil. No outer glow — the weight and
     the ragged edge do the standing-out. */
  :host([selected]) .card::after {
    content: ""; position: absolute; inset: 0 -5px 0 -4px; z-index: 2; pointer-events: none;
    border: 4px solid transparent;
    border-image: linear-gradient(125deg,
      #f6e3a6 0%, #cfa544 14%, #8a641f 26%, #e7cf8e 34%, #a5791f 46%,
      #6f4e17 58%, #d8b45e 70%, #8a641f 82%, #c79a3e 100%) 1;
    filter: url(#ledger-deckle);
  }
  /* A thin dark keyline just inside the fringed gild, to seat it on the paper. */
  :host([selected]) .card > .gild-seat {
    position: absolute; inset: 3px -2px 3px -1px; z-index: 1; pointer-events: none; border-radius: 2px;
    box-shadow: inset 0 0 0 1px rgba(74,52,12,.5);
  }

  .card-top { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; }
  .card-top > .id-tag { margin-left: auto; margin-right: 12px; }
  .card-title { font-family: var(--fell, serif); font-size: 16.5px; line-height: 1.3; margin: 0; color: var(--ink, #33291a); }
  .card-meta { display: flex; align-items: center; gap: 12px; margin-top: 9px; flex-wrap: wrap; padding-top: 8px; border-top: 1px dotted rgba(91,74,48,.35); }

  .card-acts { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 6px; opacity: 0; transition: opacity .15s; }
  .card:hover .card-acts { opacity: 1; }
  .card-act {
    font-family: var(--fell, serif); font-style: italic; font-size: 15px; letter-spacing: .02em;
    color: var(--ink-soft, #5b4a30); background: rgba(243,234,208,.85); border: 1px solid var(--parch-edge, #c4ac7c);
    border-radius: 2px; padding: 1px 9px; cursor: pointer; transition: .12s; line-height: 1.3;
  }
  .card-act:hover { background: var(--seal, var(--ink-red, #8f2f22)); color: #f3ead0; border-color: transparent; }
  .drill-hint { position: absolute; right: 12px; top: 14px; color: var(--seal, var(--ink-faint, #6f5c3e)); font-size: 15px; opacity: .55; transition: .15s; }
  .card:hover .drill-hint, :host([selected]) .drill-hint { opacity: 1; transform: translateX(2px); }

  @media (prefers-reduced-motion: reduce) {
    :host([animate]) .card { animation: none; }
  }
`);

// The deckle filter, inlined once per card shadow root. Small and static.
const DECKLE_SVG = `
  <svg width="0" height="0" aria-hidden="true" style="position:absolute">
    <defs>
      <filter id="ledger-deckle" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.014 0.028" numOctaves="4" seed="11" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>
  </svg>`;

class LedgerCard extends HTMLElement {
  static observedAttributes = ['selected', 'drill'];
  #item = null;

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.adoptedStyleSheets = [chromeSheet, cardSheet];
    }
    // Lazy-upgrade the property in case it was set before this module loaded.
    if (Object.prototype.hasOwnProperty.call(this, 'item')) {
      const v = this.item; delete this.item; this.item = v;
    }
    this.#render();
  }

  set item(v) { this.#item = v; this.#render(); }
  get item() { return this.#item; }

  attributeChangedCallback() { /* styling is attribute-driven; no re-render needed */ }

  #render() {
    const root = this.shadowRoot;
    if (!root) return;
    const item = this.#item;
    if (!item) { root.innerHTML = DECKLE_SVG; return; }

    const drill = this.hasAttribute('drill');
    const card = el('div', 'card');
    card.classList.add(`t-${item.type}`);
    // The parchment leaf, behind the content, so the deckle filter warps only
    // the paper edges (see the .paper rule). aria-hidden: purely decorative.
    const paper = el('div', 'paper'); paper.setAttribute('aria-hidden', 'true');

    // Accessible name: type, id, title, step/status, and what activating it does.
    const action = drill ? 'show its children' : 'open details';
    const stepLabel = item.workflowAction ? `Step ${item.workflowAction}` : `Status ${item.status}`;
    card.setAttribute('aria-label', `${item.type} ${item.shortId}: ${item.title}. ${stepLabel}. Activate to ${action}.`);

    const body = el('div', 'body');
    const top = el('div', 'card-top');
    top.append(el('span', `chip t-${item.type}`, item.type), idTag(item.shortId, item.url));
    const title = el('p', 'card-title', item.title); title.setAttribute('part', 'title');

    const meta = el('div', 'card-meta');
    const stepText = item.workflowAction || item.status;
    const status = el('span', `pill st-${item.status}`); status.setAttribute('part', 'status-pill');
    status.append(el('span', 'dot', ''), document.createTextNode(stepText));
    status.firstChild.setAttribute('aria-hidden', 'true');
    meta.append(status);
    if (item.assignee) {
      const who = el('span', 'who');
      who.innerHTML = `<b>${item.assignee}</b>`;
      // A context node is on the board only because a descendant matches the
      // filter; its own assignee differs. Mark the chip and explain via tooltip.
      if (item.context) {
        who.classList.add('context');
        who.title = `Assigned to ${item.assignee}. Shown because it holds items matching the current assignee filter.`;
      }
      meta.append(who);
    }
    if (item.estimate != null) meta.append(el('span', 'pill', `${item.estimate} pts`));
    if (item.childCount > 0) meta.append(el('span', 'pill count-badge', `${item.childCount} within`));

    body.append(top, title, meta);

    // Hover-only "view details" shortcut into the drawer; hidden from AT (the
    // card's aria-label already exposes the action).
    const acts = el('div', 'card-acts'); acts.setAttribute('aria-hidden', 'true');
    const read = el('span', 'card-act', 'view details');
    read.addEventListener('click', (ev) => { ev.stopPropagation(); this.#emit('card-open'); });
    acts.append(read);
    body.append(acts);

    if (drill) { const d = el('span', 'drill-hint', '›'); d.setAttribute('aria-hidden', 'true'); body.append(d); }

    // The whole card is the primary activator (drill, or open for a leaf).
    asButton(card, () => this.#emit(drill ? 'card-activate' : 'card-open'));
    // Seats the fringed gild on the paper when selected (styled in cardSheet).
    const gildSeat = el('div', 'gild-seat'); gildSeat.setAttribute('aria-hidden', 'true');
    card.append(paper, gildSeat, body);

    root.innerHTML = DECKLE_SVG;
    root.append(card);
  }

  #emit(type) {
    this.dispatchEvent(new CustomEvent(type, {
      detail: { id: this.#item?.id, item: this.#item },
      bubbles: true, composed: true,
    }));
  }
}

if (!customElements.get('ledger-card')) customElements.define('ledger-card', LedgerCard);
export { LedgerCard };
