// <ledger-drawer> — the reading drawer (manuscript leaf) for one item.
//
// A modal overlay that reads and edits a single Epic/Story/Task: status, workflow
// step, assignee (typeahead), estimate, description (inline markdown editor), a
// summary of what the item contains, and its comment thread. Everything renders
// in this element's shadow DOM.
//
// Host services (injected properties; the drawer stays transport-agnostic):
//   api(path, opts)      -> the fetch wrapper (reads, edits, steps, assignees)
//   fetchChildren(item)  -> Promise<children[]> (the board's lazy loader, which
//                           knows the current assignee/status filters)
//   caps                 -> active source capabilities (gates fields/actions)
//   sfx                  -> { pageTurn(), quill() } (optional)
//   toast(msg, isErr)    -> surface an error (optional)
//
// Events out (composed): item-changed {item} whenever an edit/comment write
// succeeds, so the board can patch its cached node and card.
//
// Open with .open(node); the node's known fields paint immediately, then the
// full item is fetched and the drawer repaints.

import { el, asButton, copyLink, plural } from './util.js';
import { chromeSheet, idTag, noEstimateIcon } from './shared-styles.js';
import { renderInto } from './markdown.js';
import './ledger-comment-thread.js';
import type { LedgerCommentThread } from './ledger-comment-thread.js';
import type { Item, LedgerNode, User, EditableField, Capabilities } from '../../shared/contract';

/** The fetch wrapper the board injects (see app's api()). */
export type ApiFn = <T = unknown>(path: string, opts?: RequestInit) => Promise<T>;
/** The board's lazy child loader, injected so the contains-list uses the same
 *  filters as the board. */
export type FetchChildrenFn = (node: LedgerNode) => Promise<LedgerNode[]>;
/** Loads a parent's children at ALL statuses (closed included), for the Planning
 *  rollup — capacity is measured against the full decomposition, not the board's
 *  filtered view. Injected so the drawer stays transport-agnostic. */
export type PlanningChildrenFn = (node: LedgerNode) => Promise<LedgerNode[]>;
/** Optional foley cues. */
export interface Sfx { pageTurn(): void; quill(): void }
/** Optional toast surface. */
export type ToastFn = (msg: string, isErr?: boolean) => void;

const STATUSES = ['Open', 'Closed'];

/** Sum the estimate points across a list of nodes (missing/zero estimates count
 *  as 0). Used for the Planning group effort figures and the risk rollup. */
function sumEffort(nodes: LedgerNode[]): number {
  return nodes.reduce((s, n) => s + (Number((n as { estimate?: number | null }).estimate) || 0), 0);
}

// Status is binary at the contract: a source has already folded its native
// terminal states (tracker's Resolved, a GitHub close reason, …) into 'Closed'
// on read, so Planning counts closed exactly as the board's status filter does.
const isClosed = (n: LedgerNode): boolean => n.status === 'Closed';

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { position: fixed; inset: 0; z-index: 500; pointer-events: none; }
  :host([open]) { pointer-events: auto; }
  .scrim { position: absolute; inset: 0; background: rgba(12,8,3,.6); opacity: 0; transition: opacity .3s; }
  :host([open]) .scrim { opacity: 1; }
  .panel {
    position: absolute; top: 0; right: 0; height: 100%; width: min(600px, 94vw); color: var(--ink, #33291a);
    background:
      radial-gradient(120% 60% at 100% 0%, rgba(196,172,124,.35), transparent 60%),
      linear-gradient(180deg, var(--parch-hi, #f3ead0), var(--parch, #e8dbba) 70%, var(--parch-lo, #d8c69c));
    border-left: 6px solid var(--brass-lo, #7a5f30); box-shadow: -24px 0 48px rgba(0,0,0,.4);
    transform: translateX(100%); transition: transform .3s cubic-bezier(.2,.8,.2,1);
    display: flex; flex-direction: column; padding: 26px 32px 0; overflow-y: auto;
  }
  /* Children must not flex-shrink below content, or a tall description overflows
     and inflates scrollHeight with phantom space. */
  .panel > * { flex-shrink: 0; }
  .panel::before { content: ""; position: absolute; left: -6px; top: 0; bottom: 0; width: 6px;
    background: repeating-linear-gradient(180deg, var(--brass-lo, #7a5f30) 0 8px, var(--wood, #1c1409) 8px 16px); opacity: .6; }
  :host([open]) .panel { transform: translateX(0); }
  /* Bottom breathing room: a real block in the scroll flow (Blink drops container
     padding-bottom and trailing margins at a flex-column scroll end). */
  .scroll-tail { height: 48px; }

  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .dh-left { display: flex; align-items: center; gap: 12px; }
  .d-short { font-family: var(--fell, serif); font-style: italic; font-size: 16px; color: var(--ink-red, #8f2f22); text-decoration: none; border-bottom: 1px dotted var(--ink-red, #8f2f22); }
  .d-short:hover { color: var(--wax, #7c2b22); }
  /* No source link: plain id text, not a dead link. */
  .d-short.no-link { color: var(--ink-soft, #5b4a30); border-bottom: 0; cursor: default; pointer-events: none; }
  .save-state { font-family: var(--fell, serif); font-style: italic; font-size: 14px; margin-left: 10px; color: var(--ink-faint, #6f5c3e); opacity: 0; transition: opacity .18s ease; }
  .save-state.saved { color: var(--seal-story, #3f5e4e); opacity: 1; }
  .ghost-btn {
    font-family: var(--fell, serif); font-style: italic; font-size: 16px; color: var(--brass-hi, #d8b878);
    background: linear-gradient(180deg, var(--leather, #2a1c10), var(--leather-2, #33230f));
    border: 1px solid var(--brass-lo, #7a5f30); border-radius: 2px; padding: 7px 14px; cursor: pointer; transition: .15s;
    box-shadow: 0 1px 2px rgba(0,0,0,.4), inset 0 1px 0 rgba(216,184,120,.15);
  }
  .ghost-btn:hover { color: #fff; border-color: var(--brass, #b08d4f); background: linear-gradient(180deg, var(--leather-2, #33230f), var(--leather, #2a1c10)); }

  .d-title { font-family: var(--fell, serif); font-weight: 400; font-size: 30px; line-height: 1.2; margin: 18px 0 12px; color: var(--ink, #33291a); }
  .d-rule { height: 2px; background: linear-gradient(90deg, var(--brass-lo, #7a5f30), transparent); margin-bottom: 20px; }
  .d-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 22px; margin-bottom: 20px; }
  .d-field label { display: block; font-family: var(--fell, serif); font-style: italic; font-size: 15px; color: var(--ink-soft, #5b4a30); margin-bottom: 5px; }
  /* A missing-estimate warning glyph beside the estimate label (the drawer's own
     item — just the icon, per the flag's window treatment). */
  .est-warn { margin-left: 7px; font-style: normal; font-size: 13px; color: var(--risk-under, #b8842a); }
  .d-field select, .d-field input, .d-typeahead input {
    box-sizing: border-box; width: 100%; background: rgba(255,250,235,.7); color: var(--ink, #33291a); border: 1px solid var(--parch-edge, #c4ac7c);
    border-radius: 2px; padding: 8px 10px; font-family: var(--gara, serif); font-size: 15px; outline: none;
  }
  .d-field select:focus, .d-field input:focus, .d-typeahead input:focus { border-color: var(--brass-lo, #7a5f30); background: #fffaeb; }
  /* A read-only field value (the completion date, written by the source on close,
     never edited here): the field-box metrics without an input's affordances. */
  .d-readonly { box-sizing: border-box; padding: 8px 10px; font-family: var(--gara, serif); font-size: 15px; color: var(--ink, #33291a); }
  .d-readonly.empty { color: var(--ink-faint, #6f5c3e); font-style: italic; }

  .d-typeahead { position: relative; }
  .typeahead-list { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 2px); margin: 0; padding: 4px; list-style: none;
    background: var(--parch-hi, #f3ead0); border: 1px solid var(--brass-lo, #7a5f30); border-radius: 2px;
    box-shadow: 0 8px 20px rgba(0,0,0,.35); max-height: 260px; overflow-y: auto; }
  .typeahead-item { display: grid; grid-template-columns: 1fr auto; gap: 0 10px; align-items: baseline; padding: 6px 8px; cursor: pointer; border-radius: 2px; }
  .typeahead-item.active, .typeahead-item:hover { background: rgba(196,172,124,.35); }
  .ta-name { font-family: var(--gara, serif); font-size: 15px; color: var(--ink, #33291a); }
  .ta-alias { font-family: var(--mono, monospace); font-size: 12px; color: var(--ink-red, #8f2f22); }
  .ta-title { grid-column: 1 / -1; font-family: var(--fell, serif); font-style: italic; font-size: 12.5px; color: var(--ink-faint, #6f5c3e); }

  /* The risk line under the title: a budget meter contrasting the item's own
     estimate (the baseline) against the summed effort of its direct children.
     Balanced stays calm and low-contrast so it recedes; an over/under imbalance
     lights a warning tone AND carries an arrow + literal numbers, so the risk
     reads without relying on color alone (see the hierarchy research). */
  .d-risk { display: flex; align-items: center; gap: 12px; margin: 0 0 14px; font-family: var(--fell, serif); font-size: 14px; }
  .d-risk .rmeter {
    position: relative; flex: 0 0 132px; height: 9px; border-radius: 5px; overflow: hidden;
    background: rgba(91,74,48,.18); box-shadow: inset 0 0 0 1px rgba(91,74,48,.25);
  }
  /* The fill is the children's share of the budget: capped at 100% width, with an
     overflow wedge riding the right edge when children exceed the estimate. */
  .d-risk .rfill { position: absolute; inset: 0 auto 0 0; height: 100%; border-radius: 5px 0 0 5px; transition: width .25s ease, background .2s ease; }
  .d-risk .rover { position: absolute; inset: 0 0 0 auto; width: 12px; background: repeating-linear-gradient(135deg, var(--risk-over, #a8321f) 0 4px, rgba(168,50,31,.55) 4px 8px); }
  .d-risk .rlabel { display: inline-flex; align-items: baseline; gap: 6px; }
  .d-risk .rarrow { font-size: 13px; font-style: normal; }
  .d-risk .rnums { font-style: italic; color: var(--ink-soft, #5b4a30); }
  /* Balanced: calm brass fill, quiet ink label. Over: hot red. Under: cooler
     amber (ambiguous — may just mean more work is planned than was booked). */
  .d-risk.balanced .rfill { background: var(--brass-lo, #7a5f30); }
  .d-risk.balanced .rlabel { color: var(--seal-story, #3f5e4e); }
  .d-risk.over .rfill { background: var(--risk-over, #a8321f); }
  .d-risk.over .rlabel { color: var(--risk-over, #a8321f); }
  .d-risk.under .rfill { background: var(--risk-under, #b8842a); }
  .d-risk.under .rlabel { color: var(--risk-under, #b8842a); }
  /* No estimate to budget against, or a leaf: no meter, just a muted note. */
  .d-risk.none { color: var(--ink-faint, #6f5c3e); font-style: italic; }

  /* Planning section (was "Contents"): each group header carries the child count
     and their summed effort. Same dot separator the group labels already use. */
  .cgroup-effort { margin-left: 14px; font-family: var(--fell, serif); font-style: italic; font-size: 15px; color: var(--ink-soft, #5b4a30); }
  .cgroup-effort::before { content: "· "; color: var(--ink-faint, #6f5c3e); }

  .d-contains { margin-bottom: 22px; padding: 14px 16px; border: 1px solid var(--parch-edge, #c4ac7c); border-radius: 2px; background: rgba(255,250,235,.4); }
  .d-contains h4 { margin: 0 0 10px; font-family: var(--fell-sc, serif); font-size: 13px; letter-spacing: .08em; color: var(--ink-red, #8f2f22); font-weight: 400; }
  .cline { display: flex; align-items: center; gap: 10px; padding: 6px 4px; cursor: pointer; border-bottom: 1px dotted rgba(91,74,48,.25); font-size: 14px; }
  .cline:last-child { border-bottom: 0; }
  .cline:hover { color: var(--wax, #7c2b22); }
  .cline .ct { flex: 1; font-family: var(--gara, serif); }
  /* A de-emphasized (closed) child line: dimmed/desaturated so done work recedes
     behind the open decomposition, lifting on hover so it still reads as clickable. */
  .cline.deemph { filter: brightness(.82) saturate(.72); opacity: .82; }
  .cline.deemph:hover { filter: none; opacity: 1; }
  /* The collapsed closed-children row and its caret; the revealed list is indented. */
  .cclosed-toggle .ct { font-style: italic; color: var(--ink-soft, #5b4a30); }
  .cclosed-caret { display: inline-block; width: 1em; color: var(--ink-faint, #6f5c3e); font-size: 12px; }
  .cclosed-list { padding-left: 16px; }
  .cgroup { margin-top: 8px; }
  .cgroup-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 10px 0 4px; }
  .cgroup-label { font-family: var(--fell, serif); font-style: italic; font-size: 15px; color: var(--ink-soft, #5b4a30); }
  /* The per-section add button is revealed on hover/focus of its group, so the
     contents list stays calm until you reach for it. It stays visible while
     keyboard-focused so it's reachable without a pointer. */
  .cgroup-add {
    font-family: var(--fell, serif); font-style: italic; font-size: 13px; color: var(--brass-hi, #d8b878);
    background: linear-gradient(180deg, var(--leather, #2a1c10), var(--leather-2, #33230f));
    border: 1px solid var(--brass-lo, #7a5f30); border-radius: 2px; padding: 3px 10px; cursor: pointer;
    opacity: 0; transition: opacity .12s, color .12s, border-color .12s;
  }
  .cgroup:hover .cgroup-add, .cgroup-add:focus-visible { opacity: 1; }
  .cgroup-add:hover { color: #fff; border-color: var(--brass, #b08d4f); }

  .d-desc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .d-desc-label { font-family: var(--fell-sc, serif); font-size: 15px; letter-spacing: .08em; color: var(--ink-red, #8f2f22); }
  .d-desc-render { font-family: var(--gara, serif); font-size: 18px; line-height: 1.7; color: var(--ink, #33291a); min-height: 120px; cursor: text; border-radius: 2px; transition: background .12s; }
  .d-desc-render:hover { background: rgba(196,172,124,.12); }
  .d-desc-render.empty { font-style: italic; color: var(--ink-faint, #6f5c3e); }
  .d-desc-render h1, .d-desc-render h2, .d-desc-render h3 { font-family: var(--fell, serif); font-weight: 400; color: var(--ink, #33291a); line-height: 1.25; margin: 20px 0 8px; }
  .d-desc-render h1 { font-size: 24px; } .d-desc-render h2 { font-size: 21px; } .d-desc-render h3 { font-size: 18px; }
  .d-desc-render p { margin: 0 0 12px; }
  .d-desc-render a { color: var(--ink-red, #8f2f22); text-decoration: underline; text-decoration-style: dotted; }
  .d-desc-render a:hover { color: var(--wax, #7c2b22); }
  .d-desc-render code { font-family: var(--mono, monospace); font-size: 13px; background: rgba(120,80,40,.12); padding: 1px 5px; border-radius: 2px; }
  .d-desc-render pre { background: rgba(40,28,14,.08); border: 1px solid var(--parch-edge, #c4ac7c); border-left: 3px solid var(--brass-lo, #7a5f30); border-radius: 2px; padding: 12px 14px; overflow-x: auto; }
  .d-desc-render pre code { background: none; padding: 0; font-size: 12.5px; line-height: 1.5; }
  .d-desc-render ul, .d-desc-render ol { margin: 0 0 12px; padding-left: 24px; }
  .d-desc-render li { margin: 3px 0; }
  .d-desc-render blockquote { margin: 0 0 12px; padding: 4px 16px; border-left: 3px solid var(--brass-lo, #7a5f30); color: var(--ink-soft, #5b4a30); font-style: italic; }
  .d-desc-render hr { border: 0; height: 1px; background: linear-gradient(90deg, var(--brass-lo, #7a5f30), transparent); margin: 18px 0; }
  .d-desc {
    width: 100%; min-height: 300px; resize: vertical; color: var(--ink, #33291a); background: rgba(255,250,235,.7);
    border: 1px solid var(--parch-edge, #c4ac7c); border-radius: 2px; padding: 16px; font-family: var(--gara, serif);
    font-size: 15px; line-height: 1.65; outline: none;
    background-image: repeating-linear-gradient(180deg, transparent 0 27px, rgba(91,74,48,.12) 27px 28px);
  }
  .d-desc:focus { border-color: var(--brass-lo, #7a5f30); }
  .d-comments { margin-top: 26px; }
  :focus-visible { outline: 2px solid var(--brass-hi, #d8b878); outline-offset: 3px; }
`);

interface TypeaheadState { items: User[]; active: number; seq: number; debounce: number | null }

export class LedgerDrawer extends HTMLElement {
  api: ApiFn | null = null;
  fetchChildren: FetchChildrenFn | null = null;
  planningChildren: PlanningChildrenFn | null = null;
  sfx: Sfx | null = null;
  toast: ToastFn | null = null;
  #caps: Partial<Capabilities> = {};
  #item: (LedgerNode & Partial<Item>) | null = null;
  #descMode: 'read' | 'edit' = 'read';
  #descCancelled = false;
  #lastFocus: HTMLElement | null = null;
  #stepCache = new Map<string, string[]>();
  #ta: TypeaheadState = { items: [], active: -1, seq: 0, debounce: null };
  #saveTimer = 0;
  #trap: ((e: KeyboardEvent) => void) | null = null;

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.adoptedStyleSheets = [chromeSheet, sheet];
    this.shadowRoot!.innerHTML = `
      <div class="scrim" part="scrim"></div>
      <div class="panel" role="dialog" aria-modal="true" tabindex="-1" part="panel">
        <div class="head">
          <div class="dh-left">
            <span class="chip" id="d-type">TASK</span>
            <a class="d-short" id="d-short" target="_blank" rel="noopener"><span class="sr-only" id="d-short-prefix">Open at source: </span><span id="d-short-text"></span></a>
            <button type="button" class="copy-link" id="d-copy-link" title="Copy link" aria-label="Copy link to this item"><span class="copy-icon" aria-hidden="true">⧉</span></button>
            <span class="save-state" id="d-save-state" role="status" aria-live="polite"></span>
          </div>
          <button class="ghost-btn" id="d-close" aria-keyshortcuts="Escape" title="Close (Esc)"><span aria-hidden="true">✕ </span>close</button>
        </div>
        <h2 class="d-title" id="d-title"></h2>
        <div class="d-risk" id="d-risk" hidden></div>
        <div class="d-rule" aria-hidden="true"></div>
        <div class="d-grid">
          <div class="d-field" id="d-status-field"><label for="d-status-edit">status</label><select id="d-status-edit"></select></div>
          <div class="d-field" id="d-step-field" hidden><label for="d-step-edit">workflow step</label><select id="d-step-edit"></select></div>
          <div class="d-field" id="d-assignee-field"><label for="d-assignee-edit">assignee</label>
            <div class="d-typeahead">
              <input type="text" id="d-assignee-edit" spellcheck="false" placeholder="unassigned" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="d-assignee-list" />
              <ul class="typeahead-list" id="d-assignee-list" role="listbox" hidden></ul>
            </div>
          </div>
          <div class="d-field" id="d-estimate-field"><label for="d-estimate-edit">estimate (points)<span class="est-warn" id="d-estimate-warn" title="No estimate set" aria-label="No estimate set" hidden>⚠</span></label><input type="number" id="d-estimate-edit" min="0" step="1" spellcheck="false" placeholder="—" /></div>
          <div class="d-field" id="d-startdate-field" hidden><label for="d-startdate-edit">start date</label><input type="date" id="d-startdate-edit" spellcheck="false" /></div>
          <div class="d-field" id="d-completion-field" hidden><label id="d-completion-label">completed</label><div class="d-readonly" id="d-completion-text" aria-labelledby="d-completion-label"></div></div>
        </div>
        <div class="d-contains" id="d-contains" hidden></div>
        <div class="d-desc-head">
          <span class="d-desc-label">description</span>
          <button type="button" class="ghost-btn" id="d-cancel" hidden>cancel</button>
        </div>
        <div class="d-desc-render" id="d-desc-render" tabindex="0" role="button" aria-label="Description — activate to edit"></div>
        <textarea id="d-desc" class="d-desc" spellcheck="false" aria-label="Description (Markdown)" placeholder="No description yet. Click to write one…" hidden></textarea>
        <div class="d-comments"><ledger-comment-thread id="c-thread"></ledger-comment-thread></div>
        <div class="scroll-tail" aria-hidden="true"></div>
      </div>`;
    this.#wire();
  }

  set caps(v: Partial<Capabilities>) { this.#caps = v || {}; }
  get caps(): Partial<Capabilities> { return this.#caps; }

  #$<T extends Element = HTMLElement>(sel: string): T { return this.shadowRoot!.querySelector(sel) as T; }

  #wire(): void {
    this.#$('.scrim').addEventListener('click', () => this.close());
    this.#$('#d-close').addEventListener('click', () => this.close());
    this.#$('#d-copy-link').addEventListener('click', () => { if (this.#item?.url) copyLink(this.#item.url, this.#$('#d-copy-link')); });

    this.#$<HTMLSelectElement>('#d-status-edit').addEventListener('change', (e) => this.#edit('status', (e.target as HTMLSelectElement).value, 'Status'));
    this.#$<HTMLSelectElement>('#d-step-edit').addEventListener('change', (e) => this.#edit('workflowAction', (e.target as HTMLSelectElement).value, 'Workflow step'));
    this.#$<HTMLInputElement>('#d-estimate-edit').addEventListener('blur', (e) => {
      const value = (e.target as HTMLInputElement).value.trim();
      const current = this.#item?.estimate;
      const same = (value === '' && (current == null || current === 0)) || Number(value) === current;
      if (!same) this.#edit('estimate', value, 'Estimate');
    });
    // Start date: a native date picker; commit on change (the <input type="date">
    // fires change on selection/clear). Its value is YYYY-MM-DD, or '' when cleared.
    this.#$<HTMLInputElement>('#d-startdate-edit').addEventListener('change', (e) => {
      const value = (e.target as HTMLInputElement).value; // '' or YYYY-MM-DD
      const current = this.#dateInputValue(this.#item?.startDate);
      if (value !== current) this.#edit('startDate', value, 'Start date');
    });

    // Description: click/Enter the rendered view to edit; blur saves; cancel discards.
    asButton(this.#$('#d-desc-render'), () => this.#enterEdit());
    this.#$('#d-cancel').addEventListener('mousedown', (e) => { e.preventDefault(); this.#cancelEdit(); });
    this.#$('#d-desc').addEventListener('blur', () => this.#saveDescOnBlur());

    const aEdit = this.#$<HTMLInputElement>('#d-assignee-edit');
    aEdit.addEventListener('input', () => this.#onAssigneeInput());
    aEdit.addEventListener('keydown', (e) => this.#onAssigneeKeydown(e));
    aEdit.addEventListener('blur', () => this.#onAssigneeBlur());

    // Description-editor Escape cancels; otherwise Escape closes the drawer. The
    // assignee list handles its own Escape (stopPropagation) to stay open-scoped.
    this.shadowRoot!.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== 'Escape') return;
      if (this.#descMode === 'edit') { this.#cancelEdit(); (ke.target as HTMLElement).blur?.(); }
      else this.close();
    });

    const thread = this.#$('#c-thread');
    thread.addEventListener('comment-add', (e) => this.#comment('POST', '', { message: e.detail.message }, true));
    thread.addEventListener('comment-edit', (e) => this.#comment('POST', `/${e.detail.id}`, { message: e.detail.message }));
    thread.addEventListener('comment-delete', (e) => this.#comment('DELETE', `/${e.detail.id}`));
  }

  // ---- open / close ----
  async open(node: LedgerNode | null): Promise<void> {
    if (!node) return;
    this.sfx?.pageTurn();
    this.#item = node;
    this.#descMode = 'read';
    this.#paint(node);
    this.#lastFocus = document.activeElement as HTMLElement | null;
    this.setAttribute('open', '');
    this.#$('.panel').focus();
    this.#trap = (e: KeyboardEvent) => this.#trapFocus(e);
    document.addEventListener('keydown', this.#trap, true);

    if (this.#caps.readItem && this.api) {
      try {
        const { item } = await this.api<{ item: Item }>(`/api/item/${node.id}`);
        if (this.#item?.id !== node.id) return;
        Object.assign(node, item);
        this.#item = node;
        this.#paint(node);
      } catch (err) { this.toast?.((err as Error).message, true); }
    }
  }

  close(): void {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.#item = null;
    if (this.#trap) { document.removeEventListener('keydown', this.#trap, true); this.#trap = null; }
    if (this.#lastFocus && this.#lastFocus.isConnected) this.#lastFocus.focus();
    this.#lastFocus = null;
    // The host keeps the URL in step with what's open; a close is a state change
    // it must hear about (to drop the ?item= key, or to pop the pushed entry).
    this.dispatchEvent(new CustomEvent('drawer-closed', { bubbles: true, composed: true }));
  }

  // Focus trap that descends into nested shadow roots (the comment thread), so
  // Tab cycles through every focusable in the open dialog, not just this root's.
  #trapFocus(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.hasAttribute('open')) return;
    const focusables = this.#deepFocusables(this.#$('.panel'));
    if (!focusables.length) return;
    const first = focusables[0]!, last = focusables[focusables.length - 1]!;
    const active = this.shadowRoot!.activeElement;
    const activeDeep = this.#deepActive();
    if (e.shiftKey && (activeDeep === first || active === this.#$('.panel'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && activeDeep === last) { e.preventDefault(); first.focus(); }
  }
  #deepActive(): Element | null {
    let a: Element | null = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  #deepFocusables(root: Element): HTMLElement[] {
    const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const out: HTMLElement[] = [];
    const walk = (r: Element | ShadowRoot) => {
      r.querySelectorAll<HTMLElement>(sel).forEach((n) => {
        if (n.hidden || n.offsetParent === null) return;
        out.push(n);
        if (n.shadowRoot) walk(n.shadowRoot);
      });
    };
    walk(root);
    return out;
  }

  // ---- paint ----
  #paint(item: LedgerNode & Partial<Item>): void {
    const caps = this.#caps;
    const type = this.#$('#d-type'); type.textContent = item.type; type.className = `chip t-${item.type}`;
    // The source supplies the ticket link; without one, show the id as plain text
    // (no href, no copy button) — the app builds no source URL itself.
    this.#$('#d-short-text').textContent = `№ ${item.shortId}`;
    const short = this.#$<HTMLAnchorElement>('#d-short'); const copyBtn = this.#$('#d-copy-link');
    const prefix = this.#$('#d-short-prefix');
    if (item.url) {
      short.href = item.url; short.classList.remove('no-link'); copyBtn.hidden = false;
      prefix.textContent = 'Open at source: ';
    } else {
      // No source link: render the id as plain text, not a dead link.
      short.removeAttribute('href'); short.classList.add('no-link'); copyBtn.hidden = true;
      prefix.textContent = '';
    }
    this.#$('#d-title').textContent = item.title;

    const canEdit = (f: EditableField) => (caps.editFields || []).includes(f);
    this.#$('#d-status-field').hidden = !canEdit('status');
    this.#$('#d-assignee-field').hidden = !canEdit('assignee');
    this.#$('#d-estimate-field').hidden = !canEdit('estimate');

    const hasEstimate = item.estimate != null && item.estimate > 0;
    this.#$<HTMLInputElement>('#d-estimate-edit').value = hasEstimate ? String(item.estimate) : '';
    // Flag the open item's own missing estimate beside the label (icon only) — only
    // when the source has point estimates at all.
    this.#$('#d-estimate-warn').hidden = hasEstimate || !caps.points;

    this.#paintDates(item);
    const sel = this.#$<HTMLSelectElement>('#d-status-edit'); sel.innerHTML = '';
    const opts = STATUSES.includes(item.status) ? STATUSES : [item.status, ...STATUSES];
    [...new Set(opts)].forEach((s) => { const o = el('option', null, s); o.value = s; if (s === item.status) o.selected = true; sel.append(o); });
    this.#$<HTMLInputElement>('#d-assignee-edit').value = item.assignee || '';
    this.#closeAssigneeList();

    this.#populateStepField(item);
    this.#renderContains(item);
    this.#renderMarkdown(item.description || '');
    this.#setDescMode('read');
    this.#setSaveState('');

    const thread = this.#$<LedgerCommentThread>('#c-thread');
    thread.canComment = !!caps.comment;
    thread.canEdit = !!caps.editOwnComments;
    thread.comments = item.comments || [];
  }

  // Task dates (task-tier only, gated by taskDates): an editable start date and a
  // read-only completion date the source stamps on close. Both fields hide for
  // epics/stories and for sources with no date model. Split out so an edit that
  // changes a date (a start-date save, or a status change that stamps completion)
  // can repaint just these without a full re-render.
  #paintDates(item: LedgerNode & Partial<Item>): void {
    const caps = this.#caps;
    const canEdit = (f: EditableField) => (caps.editFields || []).includes(f);
    const showDates = !!caps.taskDates && item.kind === 'task';
    // Start date is additionally gated on write permission; without it, hide the
    // field rather than show an input that can't save.
    this.#$('#d-startdate-field').hidden = !(showDates && canEdit('startDate'));
    this.#$<HTMLInputElement>('#d-startdate-edit').value = this.#dateInputValue(item.startDate);
    // Completion is meaningful only once the task is done: show the line when a
    // completion date exists OR the task is closed. An open task hides it entirely
    // (the concept doesn't apply yet — no empty-state noise). A closed task with no
    // stamped date (closed before this feature, or by a source that doesn't record
    // one) reads "completed (date not recorded)" rather than the false "not yet".
    const closed = item.status === 'Closed';
    this.#$('#d-completion-field').hidden = !(showDates && (item.completionDate || closed));
    const compText = this.#$('#d-completion-text');
    if (item.completionDate) { compText.className = 'd-readonly'; compText.textContent = this.#formatDate(item.completionDate); }
    else { compText.className = 'd-readonly empty'; compText.textContent = 'date not recorded'; }
  }

  // An ISO timestamp (or date) narrowed to the YYYY-MM-DD an <input type="date">
  // expects; '' for a null/absent/unparseable value.
  #dateInputValue(iso: string | null | undefined): string {
    if (!iso) return '';
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
    return m ? m[1]! : '';
  }
  // A human-readable date for the read-only completion line ("Jul 28, 2026").
  // Formatted in UTC: the stored value is an instant (often pinned to UTC
  // midnight), and we show only its date — converting to local time would render
  // the previous day for any user west of UTC.
  #formatDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  // ---- edits ----
  async #edit(field: EditableField, value: unknown, label: string): Promise<Item | undefined> {
    const node = this.#item; if (!node || !this.api) return;
    try {
      const { item } = await this.api<{ item: Item }>(`/api/item/${node.id}/edit`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ field, value }),
      });
      Object.assign(node, item); this.#item = node;
      if (field === 'estimate') {
        const hasEstimate = item.estimate != null && item.estimate > 0;
        this.#$<HTMLInputElement>('#d-estimate-edit').value = hasEstimate ? String(item.estimate) : '';
        this.#$('#d-estimate-warn').hidden = hasEstimate;
      }
      // A status change can stamp/clear the source-written completion date, and a
      // start-date save re-normalizes the input — repaint the date fields from the
      // authoritative item the source returned.
      if (field === 'status' || field === 'startDate') this.#paintDates(node);
      this.sfx?.quill();
      this.#setSaveState('saved', `${label.toLowerCase()} saved`);
      this.#emitChanged();
      return item;
    } catch (err) { this.toast?.((err as Error).message, true); throw err; }
  }

  async #comment(method: string, suffix: string, body?: { message: string }, clearComposer?: boolean): Promise<void> {
    const node = this.#item; if (!node || !this.api) return;
    try {
      const { item } = await this.api<{ item: Item }>(`/api/item/${node.id}/comment${suffix}`, {
        method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      Object.assign(node, item); this.#item = node;
      const thread = this.#$<LedgerCommentThread>('#c-thread');
      thread.comments = item.comments || [];
      if (clearComposer) thread.clearComposer();
      this.sfx?.quill();
      this.#setSaveState('saved', 'comment saved');
      this.#emitChanged();
    } catch (err) { this.toast?.((err as Error).message, true); }
  }

  #emitChanged(): void {
    this.dispatchEvent(new CustomEvent('item-changed', { detail: { item: this.#item as Item }, bubbles: true, composed: true }));
  }

  // ---- description edit mode ----
  #renderMarkdown(src: string): void {
    const box = this.#$('#d-desc-render');
    if (!src.trim()) { box.className = 'd-desc-render empty'; box.textContent = 'No description yet. Click “edit” to add one.'; return; }
    box.className = 'd-desc-render';
    renderInto(box, src);
  }
  #setDescMode(mode: 'read' | 'edit'): void {
    this.#descMode = mode;
    const editing = mode === 'edit';
    this.#$('#d-desc-render').hidden = editing;
    this.#$('#d-desc').hidden = !editing;
    this.#$('#d-cancel').hidden = !editing;
    if (editing) this.#$('#d-desc').focus();
  }
  #enterEdit(): void {
    if (this.#descMode === 'edit') return;
    this.#descCancelled = false;
    this.#$<HTMLTextAreaElement>('#d-desc').value = this.#item?.description || '';
    this.#setDescMode('edit');
  }
  #cancelEdit(): void { this.#descCancelled = true; this.#setDescMode('read'); }
  async #saveDescOnBlur(): Promise<void> {
    if (this.#descMode !== 'edit') return;
    if (this.#descCancelled) { this.#descCancelled = false; return; }
    const value = this.#$<HTMLTextAreaElement>('#d-desc').value;
    if (value === (this.#item?.description || '')) { this.#setDescMode('read'); return; }
    const item = await this.#edit('description', value, 'Description').catch(() => null);
    if (item) this.#renderMarkdown(item.description || '');
    this.#setDescMode('read');
  }

  #setSaveState(kind: '' | 'saved', label?: string): void {
    const s = this.#$('#d-save-state');
    s.className = `save-state ${kind}`;
    s.textContent = kind === 'saved' ? `✓ ${label || 'saved'}` : '';
    clearTimeout(this.#saveTimer);
    if (kind === 'saved') this.#saveTimer = window.setTimeout(() => { s.className = 'save-state'; s.textContent = ''; }, 2400);
  }

  // ---- workflow step field ----
  async #populateStepField(item: LedgerNode & Partial<Item>): Promise<void> {
    const field = this.#$('#d-step-field'); const sel = this.#$<HTMLSelectElement>('#d-step-edit');
    field.hidden = true; sel.innerHTML = '';
    if (!this.#caps.stepOptions || !item.project || !this.api) return;
    let steps = this.#stepCache.get(item.project);
    if (!steps) {
      try { steps = (await this.api<{ steps: string[] }>(`/api/steps?project=${encodeURIComponent(item.project)}`)).steps || []; }
      catch { steps = []; }
      this.#stepCache.set(item.project, steps);
    }
    const all = item.workflowAction && !steps.includes(item.workflowAction) ? [item.workflowAction, ...steps] : steps;
    if (!all.length) return;
    if (this.#item?.id !== item.id) return; // moved on while awaiting
    all.forEach((s) => { const o = el('option', null, s); o.value = s; if (s === item.workflowAction) o.selected = true; sel.append(o); });
    field.hidden = false;
  }

  // ---- planning risk (estimate vs. summed child effort) ----
  // A budget meter + label under the title, contrasting the item's OWN estimate
  // (the budget baseline) against the summed effort of its direct children. The
  // three outcomes:
  //   balanced (children == estimate) — calm, low-contrast; the item recedes.
  //   over     (children  > estimate) — hot warning; more work booked than budgeted.
  //   under    (children  < estimate) — cooler warning; ambiguous (may just mean
  //                                     more work is planned than was estimated).
  // Encoded redundantly (color + arrow + literal numbers) so it doesn't rely on
  // color alone. Tasks are leaves and epics/stories with no own-estimate have no
  // budget to measure against, so they show a muted note instead of a meter.
  #renderRisk(item: LedgerNode & Partial<Item>, children: LedgerNode[]): void {
    const box = this.#$('#d-risk');
    // A source with no point estimates has no budget to measure against — no meter.
    if (!this.#caps.points) { box.hidden = true; box.innerHTML = ''; return; }
    const budget = Number(item.estimate) || 0;
    const actual = sumEffort(children);

    // No own-estimate to budget against: nothing to assess (don't cry risk on an
    // un-estimated item — that's a data gap, not a plan deficit).
    if (budget <= 0) {
      box.className = 'd-risk none'; box.hidden = false; box.innerHTML = '';
      box.textContent = children.length
        ? `No estimate set — ${actual} pts across children can't be measured against a budget.`
        : 'No estimate set.';
      return;
    }

    const delta = actual - budget;
    const state = delta === 0 ? 'balanced' : delta > 0 ? 'over' : 'under';
    // Fill is the children's share of the budget, capped at 100%; the overflow
    // wedge appears only when over. An under-fill leaves a visible right gap.
    const fillPct = Math.min(100, Math.round((actual / budget) * 100));

    box.className = `d-risk ${state}`; box.hidden = false; box.innerHTML = '';
    const meter = el('div', 'rmeter'); meter.setAttribute('aria-hidden', 'true');
    const fill = el('div', 'rfill'); fill.style.width = `${fillPct}%`; meter.append(fill);
    if (state === 'over') meter.append(el('div', 'rover'));

    const arrow = state === 'over' ? '▲' : state === 'under' ? '▼' : '✓';
    const word = state === 'over' ? `over by ${delta}` : state === 'under' ? `under by ${-delta}` : 'balanced';
    const label = el('span', 'rlabel');
    label.append(el('span', 'rarrow', arrow), document.createTextNode(word),
      el('span', 'rnums', `(${budget} budgeted → ${actual} in children)`));

    // Screen-reader summary: the meter is decorative, so the label carries it all.
    box.setAttribute('role', 'status');
    box.setAttribute('aria-label',
      `Planning risk: ${word}. Estimate ${budget} points, children total ${actual} points.`);
    box.append(meter, label);
  }

  // ---- contains (children summary) ----
  // Renders the item's children, grouped by tier, and — when the source can
  // create and the item can hold that tier — a per-section "Add <tier>" button
  // (revealed on hover) that parents the new item on THIS item. An epic always
  // shows a Stories and a Tasks section and a story a Tasks section, even when
  // empty, so the add affordance is always reachable; a task holds nothing, so it
  // renders no contents. Sections render for a leaf-only item too (the sole reason
  // to show contents used to be existing children; now the add affordances count).
  async #renderContains(item: LedgerNode & Partial<Item>): Promise<void> {
    const box = this.#$('#d-contains');
    const risk = this.#$('#d-risk');
    const canCreate = !!this.#caps.create;
    // A task is a leaf: no children, nothing to add under it, no budget to assess.
    if (item.kind === 'task') { box.hidden = true; box.innerHTML = ''; risk.hidden = true; return; }
    // Nothing to show and can't add? Then there's no section to render.
    if (!item.childCount && !canCreate) { box.hidden = true; box.innerHTML = ''; risk.hidden = true; return; }

    // Planning measures capacity against the full decomposition, so it loads the
    // children at ALL statuses (closed included) rather than the board's filtered
    // set. This is a separate fetch held locally — the board's cache stays filtered.
    box.hidden = false; box.innerHTML = '';
    box.append(el('h4', null, 'Planning'), el('div', 'cgroup-label', 'loading…'));
    let children: LedgerNode[] = [];
    if (this.planningChildren) {
      try { children = await this.planningChildren(item); } catch { /* leave loading */ }
      if (this.#item?.id !== item.id) return;
    }
    const stories = children.filter((n) => n.kind === 'story');
    const direct = children.filter((n) => n.kind !== 'story');
    // The risk line contrasts this item's own estimate against the summed effort of
    // ALL its direct children (stories + direct-on-epic tasks for an epic; tasks for
    // a story), closed work included — that's the capacity-utilization question.
    this.#renderRisk(item, children);
    // Each group: a heading, an optional add-tier, and the child lines. Groups are
    // always shown for the addable tiers so the affordance is reachable when empty.
    const groups: { label: string; list: LedgerNode[]; addType: 'STORY' | 'TASK' }[] =
      item.kind === 'epic'
        ? [
            { label: 'Stories', list: stories, addType: 'STORY' },
            { label: 'Tasks directly on this epic', list: direct, addType: 'TASK' },
          ]
        : [{ label: 'Tasks', list: children, addType: 'TASK' }];

    box.hidden = false; box.innerHTML = '';
    box.append(el('h4', null, 'Planning'));
    for (const { label, list, addType } of groups) {
      const open = list.filter((n) => !isClosed(n));
      const closed = list.filter(isClosed);
      const g = el('div', 'cgroup');
      const head = el('div', 'cgroup-head');
      const labelText = list.length ? `${label} · ${list.length}` : label;
      const headLeft = el('div', 'cgroup-label', labelText);
      // Alongside the count, the summed effort — with the closed portion broken out
      // ("Effort · 34 pts (14 pts closed)") so capacity already spent is legible.
      // Only when the source has point estimates; otherwise the Planning section
      // still shows the counts, just no effort figures.
      if (list.length && this.#caps.points) {
        const total = sumEffort(list); const closedPts = sumEffort(closed);
        const effortText = closedPts > 0 ? `Effort · ${total} pts (${closedPts} pts closed)` : `Effort · ${total} pts`;
        headLeft.append(el('span', 'cgroup-effort', effortText));
      }
      head.append(headLeft);
      if (canCreate) {
        const add = el('button', 'cgroup-add', `+ Add ${addType.toLowerCase()}`);
        add.type = 'button';
        add.setAttribute('aria-label', `Add ${addType.toLowerCase()} to ${item.title}`);
        add.addEventListener('click', () => this.#emitAddChild(addType));
        head.append(add);
      }
      g.append(head);
      if (list.length) {
        open.forEach((child) => g.append(this.#childLine(child)));
        // Closed children collapse into one dimmed, expandable line so a long done
        // list doesn't bury the open work; the summed closed effort rides the label.
        if (closed.length) g.append(this.#closedGroup(closed, addType));
      } else {
        g.append(el('div', 'cline', `No ${addType.toLowerCase()}s yet.`));
      }
      box.append(g);
    }
  }

  // One child line in the Planning list. `deemph` dims it (used for closed items
  // revealed under the expander). Shows the child's own estimate as a points pill.
  #childLine(child: LedgerNode, deemph = false): HTMLElement {
    const line = el('div', `cline${deemph ? ' deemph' : ''}`);
    line.append(el('span', `chip t-${child.type}`, child.type), el('span', 'ct', child.title));
    // Where the points pill would sit: show it, or flag a missing estimate with the
    // icon-only marker (tooltip carries the meaning) so the line stays uncluttered.
    // Nothing at all when the source has no point estimates.
    if (this.#caps.points) {
      const pts = Number((child as { estimate?: number | null }).estimate) || 0;
      line.append(pts > 0 ? el('span', 'pill', `${pts} pts`) : noEstimateIcon());
    }
    asButton(line, () => this.open(child), `${child.type} ${child.shortId}: ${child.title}. Open details.`);
    return line;
  }

  // The collapsed closed-children line: "+ N closed stories (X pts)", expanding on
  // click to reveal the individual (dimmed) lines. Closed work counts toward the
  // rollup but is folded away so it doesn't crowd the open decomposition.
  #closedGroup(closed: LedgerNode[], addType: 'STORY' | 'TASK'): HTMLElement {
    const wrap = el('div', 'cclosed');
    const noun = addType.toLowerCase();
    const countNoun = `${closed.length} closed ${closed.length === 1 ? noun : `${noun}s`}`;
    const summary = el('div', 'cline cclosed-toggle');
    const caret = el('span', 'cclosed-caret', '▸');
    summary.append(caret, el('span', 'ct', `+ ${countNoun}`), el('span', 'pill', `${sumEffort(closed)} pts`));
    const list = el('div', 'cclosed-list'); list.hidden = true;
    closed.forEach((child) => list.append(this.#childLine(child, true)));
    asButton(summary, () => {
      const nowHidden = !list.hidden; list.hidden = nowHidden;
      caret.textContent = nowHidden ? '▸' : '▾';
      summary.setAttribute('aria-expanded', String(!nowHidden));
    }, `${countNoun}, ${sumEffort(closed)} points. Expand to view.`);
    summary.setAttribute('aria-expanded', 'false');
    wrap.append(summary, list);
    return wrap;
  }

  // Ask the host to compose a new child of a fixed tier under the open item. The
  // drawer performs no write itself; the board maps this to the compose sheet with
  // this item as the (read-only) parent.
  #emitAddChild(type: 'STORY' | 'TASK'): void {
    const parent = this.#item;
    if (!parent) return;
    this.dispatchEvent(new CustomEvent('item-add-child', {
      detail: {
        type, parentId: parent.id, parentName: parent.title,
        parentShortId: parent.shortId ?? null, parentUrl: parent.url ?? null,
        parentType: parent.type ?? null,
        project: parent.project ?? null,
      },
      bubbles: true, composed: true,
    }));
  }

  // ---- assignee typeahead ----
  #closeAssigneeList(): void {
    const list = this.#$('#d-assignee-list');
    list.hidden = true; list.innerHTML = '';
    this.#ta.items = []; this.#ta.active = -1;
    this.#$('#d-assignee-edit').setAttribute('aria-expanded', 'false');
  }
  #renderAssigneeList(): void {
    const list = this.#$('#d-assignee-list');
    list.innerHTML = '';
    if (!this.#ta.items.length) { this.#closeAssigneeList(); return; }
    this.#ta.items.forEach((u, i) => {
      const li = el('li', 'typeahead-item' + (i === this.#ta.active ? ' active' : ''));
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === this.#ta.active)); li.id = `d-assignee-opt-${i}`;
      li.append(el('span', 'ta-name', u.fullName), el('span', 'ta-alias', u.alias));
      if (u.jobTitle) li.append(el('span', 'ta-title', u.jobTitle));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); this.#chooseAssignee(i); });
      list.append(li);
    });
    list.hidden = false;
    this.#$('#d-assignee-edit').setAttribute('aria-expanded', 'true');
  }
  #chooseAssignee(i: number): void {
    const u = this.#ta.items[i]; if (!u) return;
    this.#$<HTMLInputElement>('#d-assignee-edit').value = u.alias;
    this.#closeAssigneeList();
    this.#commitAssignee();
  }
  #commitAssignee(): void {
    const value = this.#$<HTMLInputElement>('#d-assignee-edit').value.trim();
    if (value === (this.#item?.assignee || '')) return;
    this.#edit('assignee', value, 'Assignee');
  }
  async #queryAssignee(q: string): Promise<void> {
    const seq = ++this.#ta.seq;
    try {
      const { users } = await this.api!<{ users: User[] }>(`/api/assignees?q=${encodeURIComponent(q)}`);
      if (seq !== this.#ta.seq) return;
      if (this.shadowRoot!.activeElement !== this.#$('#d-assignee-edit')) return;
      this.#ta.items = users; this.#ta.active = -1;
      this.#renderAssigneeList();
    } catch { /* best-effort */ }
  }
  #onAssigneeInput(): void {
    const q = this.#$<HTMLInputElement>('#d-assignee-edit').value.trim();
    if (this.#ta.debounce) clearTimeout(this.#ta.debounce);
    if (!this.#caps.searchAssignees || q.length < 3) { this.#closeAssigneeList(); return; }
    this.#ta.debounce = window.setTimeout(() => this.#queryAssignee(q), 180);
  }
  #onAssigneeKeydown(e: KeyboardEvent): void {
    const open = !this.#$('#d-assignee-list').hidden;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); this.#ta.active = Math.min(this.#ta.active + 1, this.#ta.items.length - 1); this.#renderAssigneeList(); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); this.#ta.active = Math.max(this.#ta.active - 1, 0); this.#renderAssigneeList(); }
    else if (e.key === 'Enter') {
      if (open && this.#ta.active >= 0) { e.preventDefault(); this.#chooseAssignee(this.#ta.active); }
      else { this.#closeAssigneeList(); this.#commitAssignee(); }
    } else if (e.key === 'Escape' && open) { e.stopPropagation(); this.#closeAssigneeList(); }
  }
  #onAssigneeBlur(): void {
    setTimeout(() => { if (!this.#$('#d-assignee-list').hidden) return; this.#commitAssignee(); }, 120);
  }
}

if (!customElements.get('ledger-drawer')) customElements.define('ledger-drawer', LedgerDrawer);
