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

import { el, asButton, plural } from './util.js';
import { chromeSheet, idTag, noEstimateChip, noStartDateChip, pointsPill } from './shared-styles.js';
import { isClosed, isAbandoned, STATUS_LABEL } from '../../shared/status.js';
import type { LedgerNode } from '../../shared/contract';

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
  /* The surface stack, its blend, shadow, corner radius, and edge filter are all
     theme RECIPE tokens (see themes/the-ledger/theme.css). The fallbacks are the
     original parchment leaf, so a card dropped on a page with no theme layer
     still reads as parchment. A theme with a machined surface sets
     --deckle-filter:none and a rounded --card-radius. */
  .paper {
    content: ""; position: absolute; inset: 0 -5px 0 -4px; z-index: 0; pointer-events: none;
    background: var(--card-surface,
      radial-gradient(120px 80px at 82% 14%, rgba(120,80,40,.10), transparent 70%),
      url("/paper-stain.svg"),
      linear-gradient(180deg, var(--parch-hi, #f3ead0), var(--parch, #e8dbba) 60%, var(--parch-lo, #d8c69c)));
    background-size: var(--card-surface-size, auto, 360px 260px, auto);
    background-blend-mode: var(--card-surface-blend, multiply, multiply, normal);
    border-radius: var(--card-radius, 0);
    box-shadow: var(--card-shadow, 1px 2px 4px rgba(0,0,0,.22), inset 0 0 30px rgba(160,120,60,.06), inset 0 0 0 1px rgba(196,172,124,.5));
    filter: var(--deckle-filter, url(#ledger-deckle));
  }
  .body { position: relative; z-index: 1; }
  :host([animate]) .card { animation: unfurl .4s cubic-bezier(.2,.7,.3,1) both; }
  @keyframes unfurl { from { opacity: 0; transform: translateY(10px) rotate(-.4deg); } }
  .card:hover .paper { box-shadow: var(--card-shadow-hover, 2px 4px 9px rgba(0,0,0,.3), inset 0 0 30px rgba(160,120,60,.08), inset 0 0 0 1px rgba(196,172,124,.6)); }

  :host([selected]) .card { transform: translateY(-1px) rotate(-.2deg); }
  /* The active card is the column's focal point. Its dominance is carried mainly
     by a VALUE lift on the parchment itself — a brightness/saturation bump on the
     paper layer (an area-wide contrast shift the eye reads preattentively), backed
     by the deeper shadow, the slight elevation, and the gilded frame as redundant
     cues. The peer cards recede in parallel (see the column's dim rule in
     styles.css), so the active card reads as figure against a receded ground —
     a border alone shifts figure/ground too little to lead. The brightness rides
     on the deckle filter (kept first so the torn edge is preserved). */
  :host([selected]) .paper {
    box-shadow: var(--card-shadow-selected, 2px 4px 12px rgba(0,0,0,.34), inset 0 0 34px rgba(160,120,60,.16));
    background: var(--card-surface-selected,
      radial-gradient(120px 80px at 82% 14%, rgba(120,80,40,.10), transparent 70%),
      url("/paper-stain.svg"),
      linear-gradient(180deg, var(--parch-hi, #f3ead0), var(--parch-hi, #f3ead0) 55%, var(--parch, #e8dbba)));
    background-size: var(--card-surface-size, auto, 360px 260px, auto);
    background-blend-mode: var(--card-surface-blend, multiply, multiply, normal);
    filter: var(--deckle-filter-selected, url(#ledger-deckle) brightness(1.07) saturate(1.12));
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
    border-image: var(--card-frame, linear-gradient(125deg,
      #f6e3a6 0%, #cfa544 14%, #8a641f 26%, #e7cf8e 34%, #a5791f 46%,
      #6f4e17 58%, #d8b45e 70%, #8a641f 82%, #c79a3e 100%) 1);
    filter: var(--card-frame-filter, var(--deckle-filter, url(#ledger-deckle)));
  }
  /* A thin dark keyline just inside the frame, to seat it on the surface. */
  :host([selected]) .card > .gild-seat {
    position: absolute; inset: 3px -2px 3px -1px; z-index: 1; pointer-events: none; border-radius: 2px;
    box-shadow: var(--card-frame-seat, inset 0 0 0 1px rgba(74,52,12,.5));
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

  /* Closed item: a small rotated wax "CLOSED" stamp in the bottom-right corner.
     Cornered rather than struck across the middle so it reads as done without
     obscuring the title (the id tag holds the top-right; the meta row's right end
     is free). The stamp is a hand-inked seal — semi-transparent oxblood ink, a
     double rule, run through the deckle displacement so its edges fringe like a
     real rubber stamp rather than a crisp CSS box. pointer-events:none so it never
     intercepts the card click. The paper is NOT dimmed — the seal alone carries
     the closed signal. */
  .closed-stamp {
    position: absolute; z-index: 3; bottom: 12px; right: 10px;
    transform: rotate(-9deg);
    pointer-events: none; user-select: none;
    font-family: var(--fell, serif); font-weight: 700; text-transform: uppercase;
    font-size: 13px; letter-spacing: .13em; line-height: 1;
    color: var(--stamp-ink, rgba(140,43,34,.7));
    padding: 3px 9px; border: 2px double var(--stamp-edge, rgba(140,43,34,.58)); border-radius: 3px;
    text-shadow: 0 1px 0 rgba(255,255,255,.18);
    filter: var(--stamp-filter, var(--deckle-filter, url(#ledger-deckle)));
    transition: opacity .15s;
  }
  /* An abandoned close ("Not done"): a desaturated slate ink instead of the oxblood
     of a completed close, so the two terminal states read differently at a glance —
     done is warm/final, not-done is grey/inert. Slightly tighter tracking keeps the
     two-word label compact in the corner. */
  .closed-stamp.abandoned {
    color: var(--stamp-ink-abandoned, rgba(74,78,86,.7)); border-color: var(--stamp-edge-abandoned, rgba(74,78,86,.5));
    letter-spacing: .08em;
  }
  /* The hover "view details" affordance shares this corner; fade the stamp out on
     hover so the button is unobstructed (the card is clearly closed by then). */
  .card:hover .closed-stamp { opacity: 0; }
  /* A selected closed card: the stamp would fight the gild, so ease it back. */
  :host([selected]) .closed-stamp { color: rgba(140,43,34,.58); border-color: rgba(140,43,34,.46); }
  :host([selected]) .closed-stamp.abandoned { color: rgba(74,78,86,.58); border-color: rgba(74,78,86,.4); }

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

export class LedgerCard extends HTMLElement {
  static observedAttributes = ['selected', 'drill'];
  #item: LedgerNode | null = null;

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot!.adoptedStyleSheets = [chromeSheet, cardSheet];
    }
    // Lazy-upgrade the property in case it was set before this module loaded.
    if (Object.prototype.hasOwnProperty.call(this, 'item')) {
      const v = (this as { item?: LedgerNode }).item; delete (this as { item?: LedgerNode }).item; this.item = v ?? null;
    }
    this.#render();
  }

  set item(v: LedgerNode | null) { this.#item = v; this.#render(); }
  get item(): LedgerNode | null { return this.#item; }

  attributeChangedCallback(): void { /* styling is attribute-driven; no re-render needed */ }

  #render(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const item = this.#item;
    if (!item) { root.innerHTML = DECKLE_SVG; return; }

    const drill = this.hasAttribute('drill');
    const card = el('div', 'card');
    card.classList.add(`t-${item.type}`);
    // A closed item (only ever on the board when "show closed items" is on) gets a
    // small rotated wax "CLOSED" stamp in the corner, so it reads as done at a glance
    // against its open neighbors — the status pill's tiny dot is too weak a signal,
    // and a source that shows workflowAction in place of status may not say "Closed"
    // at all. isClosed(), not `=== 'Closed'`, so an abandoned close (closed-not-
    // completed) is stamped too — it's terminal work, just not completed work.
    const closed = isClosed(item.status);
    // The parchment leaf, behind the content, so the deckle filter warps only
    // the paper edges (see the .paper rule). aria-hidden: purely decorative.
    const paper = el('div', 'paper'); paper.setAttribute('aria-hidden', 'true');

    // Accessible name: type, id, title, step/status, and what activating it does.
    const action = drill ? 'show its children' : 'open details';
    const stepLabel = item.workflowAction ? `Step ${item.workflowAction}` : `Status ${STATUS_LABEL[item.status] ?? item.status}`;
    card.setAttribute('aria-label', `${item.type} ${item.shortId}: ${item.title}. ${stepLabel}. Activate to ${action}.`);

    const body = el('div', 'body');
    const top = el('div', 'card-top');
    const hasPoints = this.hasAttribute('points');
    const hasTaskDates = this.hasAttribute('taskdates');
    top.append(el('span', `chip t-${item.type}`, item.type));
    // Flag an item with no estimate (any tier), right beside the type chip. A
    // missing estimate is a data gap worth filling regardless of status. Only when
    // the source has point estimates at all — a source without them isn't nagged —
    // and never for an abandoned item, which will never need the figure.
    if (hasPoints && !isAbandoned(item.status) && !(item.estimate != null && item.estimate > 0)) top.append(noEstimateChip());
    // Flag a completed task with no start date: a finished task with no recorded
    // start can't yield a duration or feed epic velocity. Task-tier + completed only
    // (`=== 'Closed'`, the completion sense — an open task hasn't necessarily
    // started, an abandoned one never delivered; higher tiers carry no dates), and
    // only when the source has a task-date model — mirrors the missing-estimate gate.
    if (hasTaskDates && item.kind === 'task' && item.status === 'Closed' && !item.startDate) top.append(noStartDateChip());
    top.append(idTag(item.shortId, item.url));
    const title = el('p', 'card-title', item.title); title.setAttribute('part', 'title');

    const meta = el('div', 'card-meta');
    const stepText = item.workflowAction || STATUS_LABEL[item.status] || item.status;
    const status = el('span', `pill st-${item.status}`); status.setAttribute('part', 'status-pill');
    status.append(el('span', 'dot', ''), document.createTextNode(stepText));
    (status.firstChild as HTMLElement).setAttribute('aria-hidden', 'true');
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
    if (hasPoints && item.estimate != null && item.estimate > 0) meta.append(pointsPill(item.kind, item.estimate));
    // Rollup badges. An epic with resolved counts shows "N stories" + "N tasks"
    // (see EpicCounts — tasks is direct + under-story, stories is immediate),
    // filtered like the board. The counts arrive after first paint, so the epic
    // shows NO count badge until they land — the `rollup` attribute marks that the
    // source produces them, so a not-yet-loaded epic reads as loading (blank), not
    // as "N within". A source without the epicCounts capability sets no attribute
    // and keeps the raw "N within" fallback. A story's children are all tasks in
    // this three-tier model, so its badge reads "N tasks" (from the raw child
    // count); a task keeps the generic "N within" for any sub-items it carries.
    const counts = (item as { counts?: { stories: number; tasks: number } }).counts;
    const rollup = this.hasAttribute('rollup');
    if (item.kind === 'epic' && rollup) {
      if (counts) {
        if (counts.stories > 0) meta.append(el('span', 'pill count-badge', plural(counts.stories, 'story', 'stories')));
        if (counts.tasks > 0) meta.append(el('span', 'pill count-badge', plural(counts.tasks, 'task', 'tasks')));
      }
      // else: counts still loading — show nothing.
    } else if (item.kind === 'story' && item.childCount > 0) {
      meta.append(el('span', 'pill count-badge', plural(item.childCount, 'task', 'tasks')));
    } else if (item.childCount > 0) {
      meta.append(el('span', 'pill count-badge', `${item.childCount} within`));
    }

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
    // The wax "CLOSED" stamp in the corner (styled in cardSheet).
    // Decorative — the status is already in the card's aria-label. An abandoned
    // close reads "NOT DONE" so the stamp itself distinguishes the two terminal
    // states, rather than both saying "Closed".
    if (closed) {
      const stamp = el('div', 'closed-stamp', isAbandoned(item.status) ? 'Not done' : 'Closed');
      if (isAbandoned(item.status)) stamp.classList.add('abandoned');
      stamp.setAttribute('aria-hidden', 'true');
      card.append(stamp);
    }

    root.innerHTML = DECKLE_SVG;
    root.append(card);
  }

  #emit(type: 'card-activate' | 'card-open'): void {
    this.dispatchEvent(new CustomEvent(type, {
      detail: { id: this.#item?.id, item: this.#item },
      bubbles: true, composed: true,
    }));
  }
}

if (!customElements.get('ledger-card')) customElements.define('ledger-card', LedgerCard);
