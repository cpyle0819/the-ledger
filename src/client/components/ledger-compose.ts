// <ledger-compose> — the compose sheet (a fresh leaf) for creating one item.
//
// A modal overlay that gathers a new Epic/Story/Task's fields and submits it to
// the create route. It renders only the controls the active source declares it
// accepts on create (Capabilities.createFields), so it never shows a field a
// source can't store; type and title are always present (the create minimum).
// Everything renders in this element's shadow DOM.
//
// Host services (injected properties; the sheet stays transport-agnostic):
//   api(path, opts)   -> the fetch wrapper (the create POST)
//   caps              -> active source capabilities (gates which fields show)
//   me                -> the viewer's identity (default assignee prefill)
//   projects          -> the source's projects (the project picker options)
//   sfx               -> { pageTurn(), quill() } (optional)
//   toast(msg, isErr) -> surface an error (optional)
//
// Events out (composed): item-created {item, input} when the create succeeds, so
// the board can place the new item in the tree without a reload.
//
// Open with .open(context): the tier and parent are decided by which add
// affordance fired (a column "+", a drawer section), so both are fixed here —
// the type shows as a read-only chip, the parent as a read-only name — and only
// title/assignee/description/estimate are editable. A root item (no parent) shows
// the project picker; a child inherits its parent's project silently.

import { el } from './util.js';
import { chromeSheet, idTag } from './shared-styles.js';
import type { Item, CreateInput, CreatableField, Capabilities, Project } from '../../shared/contract';

/** The fetch wrapper the board injects (see app's api()). */
export type ApiFn = <T = unknown>(path: string, opts?: RequestInit) => Promise<T>;
/** Optional foley cues. */
export interface Sfx { pageTurn(): void; quill(): void }
/** Optional toast surface. */
export type ToastFn = (msg: string, isErr?: boolean) => void;
/** One node on the new item's ancestor path, rendered as an outline row in the
 *  mini-outline heading. `url` gives its "№ …" tag a link (the same the cards
 *  show); absent falls back to plain id text. */
export interface ComposeAncestor {
  type: string;
  shortId: string;
  url?: string | null;
  title: string;
}

/** The fixed context an add affordance opens the sheet with: the tier to create,
 *  and the parent it's created under. `parentId` null means a root; `project` is
 *  the parent's project (inherited) or, for a root, the board's current project
 *  scope. `ancestors` is the full chain from the epic down to the immediate
 *  parent (empty for a root), rendered as the mini-outline heading so the new
 *  item shows its place in the tree, not just its parent. */
export interface ComposeContext {
  type: string;
  parentId?: string | null;
  ancestors?: ComposeAncestor[];
  project?: string | null;
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { position: fixed; inset: 0; z-index: 500; pointer-events: none; }
  :host([open]) { pointer-events: auto; }
  .scrim { position: absolute; inset: 0; background: rgba(12,8,3,.6); opacity: 0; transition: opacity .3s; }
  :host([open]) .scrim { opacity: 1; }
  .panel {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -46%);
    width: min(560px, 94vw); max-height: 90vh; overflow-y: auto; color: var(--ink, #33291a);
    background:
      radial-gradient(120% 60% at 100% 0%, rgba(196,172,124,.35), transparent 60%),
      linear-gradient(180deg, var(--parch-hi, #f3ead0), var(--parch, #e8dbba) 70%, var(--parch-lo, #d8c69c));
    border: 1px solid var(--brass-lo, #7a5f30); border-top: 6px solid var(--brass-lo, #7a5f30);
    border-radius: 3px; box-shadow: 0 24px 60px rgba(0,0,0,.5);
    opacity: 0; transition: opacity .25s, transform .25s cubic-bezier(.2,.8,.2,1);
    padding: 24px 30px 28px;
  }
  :host([open]) .panel { opacity: 1; transform: translate(-50%, -50%); }
  .panel > * { flex-shrink: 0; }

  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
  /* The eyebrow carries the tier chip: "new" + the wax seal of what's being made,
     so the type reads as a settled fact of the entry (no field to fill). */
  .c-eyebrow { display: inline-flex; align-items: center; gap: 9px; font-family: var(--fell-sc, serif); font-size: 13px; letter-spacing: .1em; color: var(--ink-red, #8f2f22); text-transform: uppercase; }
  .c-rule { height: 2px; background: linear-gradient(90deg, var(--brass-lo, #7a5f30), transparent); margin: 14px 0 18px; }

  /* Mini-outline preview — the heading, rebuilt as the item's place in the tree.
     It borrows the register lens's three rank devices at a smaller base (same
     ratios): a type SCALE (epic 19.5 → story 16 → task 13 down ~1.22), QUIET
     chips (flat, shrunk — indent already encodes tier), and an indent + guide
     SPINE so the new row reads as hanging off its parent, not merely below it. */
  .mo { padding: 4px 2px 2px; }
  .mo-row { display: flex; align-items: center; gap: 9px; padding: 4px 0; }
  .mo-title { font-family: var(--fell, serif); color: var(--ink, #33291a); line-height: 1.2; }
  .tier-EPIC  .mo-title { font-size: 19.5px; letter-spacing: .01em; }
  .tier-STORY .mo-title { font-size: 16px; }
  .tier-TASK .mo-title, .tier-BUG .mo-title, .tier-SUBTASK .mo-title { font-family: var(--gara, serif); font-size: 13px; }
  /* The new row's title is blank until typed, then mirrors the field live; the
     faint placeholder holds its place so the row never collapses. */
  .mo-new .mo-title.empty { color: var(--ink-faint, #6f5c3e); font-style: italic; }
  /* The id tag rides inline at the end of the title text with a small gap. */
  .mo-title .id-tag { margin-left: 8px; }
  .mo .chip { font-size: 9.5px; padding: 2px 6px; letter-spacing: .1em; box-shadow: none; border-color: rgba(0,0,0,.16); opacity: .85; }
  /* A child hangs off its parent under an indented spine (Gestalt continuity);
     a root new item has no parent row and sits flush. */
  .mo-children.nested { position: relative; padding-left: 30px; }
  .mo-children.nested::before { content: ""; position: absolute; left: 12px; top: 1px; bottom: 4px; width: 1px; background: var(--parch-edge, #c4ac7c); opacity: .6; }

  .ghost-btn {
    font-family: var(--fell, serif); font-style: italic; font-size: 16px; color: var(--brass-hi, #d8b878);
    background: linear-gradient(180deg, var(--leather, #2a1c10), var(--leather-2, #33230f));
    border: 1px solid var(--brass-lo, #7a5f30); border-radius: 2px; padding: 7px 14px; cursor: pointer; transition: .15s;
    box-shadow: 0 1px 2px rgba(0,0,0,.4), inset 0 1px 0 rgba(216,184,120,.15);
  }
  .ghost-btn:hover { color: #fff; border-color: var(--brass, #b08d4f); background: linear-gradient(180deg, var(--leather-2, #33230f), var(--leather, #2a1c10)); }
  .ghost-btn:disabled { opacity: .5; cursor: default; }

  .c-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px 20px; margin-bottom: 18px; }
  .c-field { display: flex; flex-direction: column; }
  /* [hidden] must win over the flex display above, or a hidden field still lays
     out (the project picker leaking in for a child that inherits its parent's). */
  .c-field[hidden] { display: none; }
  .c-field.full { grid-column: 1 / -1; }
  .c-field label { font-family: var(--fell, serif); font-style: italic; font-size: 15px; color: var(--ink-soft, #5b4a30); margin-bottom: 5px; }
  .c-field .req { color: var(--ink-red, #8f2f22); }
  .c-field select, .c-field input, .c-field textarea {
    box-sizing: border-box; width: 100%; background: rgba(255,250,235,.7); color: var(--ink, #33291a);
    border: 1px solid var(--parch-edge, #c4ac7c); border-radius: 2px; padding: 8px 10px;
    font-family: var(--gara, serif); font-size: 15px; outline: none;
  }
  .c-field textarea { min-height: 96px; resize: vertical; line-height: 1.55; }
  .c-field select:focus, .c-field input:focus, .c-field textarea:focus { border-color: var(--brass-lo, #7a5f30); background: #fffaeb; }

  .foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 4px; }
  .c-err { flex: 1; font-family: var(--gara, serif); font-size: 14px; color: var(--wax, #7c2b22); }
  :focus-visible { outline: 2px solid var(--brass-hi, #d8b878); outline-offset: 3px; }
`);

export class LedgerCompose extends HTMLElement {
  api: ApiFn | null = null;
  sfx: Sfx | null = null;
  toast: ToastFn | null = null;
  projects: Project[] = [];
  me = '';
  #caps: Partial<Capabilities> = {};
  #ctx: ComposeContext = { type: 'TASK' };
  #lastFocus: HTMLElement | null = null;
  #submitting = false;
  #trap: ((e: KeyboardEvent) => void) | null = null;

  connectedCallback(): void {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot!.adoptedStyleSheets = [chromeSheet, sheet];
    this.shadowRoot!.innerHTML = `
      <div class="scrim" part="scrim"></div>
      <form class="panel" role="dialog" aria-modal="true" aria-labelledby="c-heading" tabindex="-1" part="panel">
        <div class="head">
          <span class="c-eyebrow" id="c-heading">new <span id="c-type-word">task</span></span>
          <button type="button" class="ghost-btn" id="c-close" aria-keyshortcuts="Escape" title="Close (Esc)"><span aria-hidden="true">✕ </span>close</button>
        </div>
        <div class="mo" id="c-outline" aria-hidden="true"></div>
        <div class="c-rule" aria-hidden="true"></div>
        <div class="c-grid">
          <div class="c-field full" id="c-title-field">
            <label for="c-title">title <span class="req" aria-hidden="true">*</span></label>
            <input type="text" id="c-title" spellcheck="false" required autocomplete="off" placeholder="a short, plain title" />
          </div>
          <div class="c-field" id="c-estimate-field" hidden>
            <label for="c-estimate">estimate (points)</label>
            <input type="number" id="c-estimate" min="0" step="1" spellcheck="false" placeholder="—" />
          </div>
          <div class="c-field" id="c-project-field" hidden>
            <label for="c-project">project</label>
            <select id="c-project"></select>
          </div>
          <div class="c-field" id="c-assignee-field" hidden>
            <label for="c-assignee">assignee</label>
            <input type="text" id="c-assignee" spellcheck="false" autocomplete="off" placeholder="unassigned" />
          </div>
          <div class="c-field full" id="c-description-field" hidden>
            <label for="c-description">description</label>
            <textarea id="c-description" spellcheck="false" placeholder="Markdown; optional"></textarea>
          </div>
        </div>
        <div class="foot">
          <span class="c-err" id="c-err" role="status" aria-live="polite"></span>
          <button type="submit" class="ghost-btn" id="c-submit"><span aria-hidden="true">✎ </span>create</button>
        </div>
      </form>`;
    this.#wire();
  }

  set caps(v: Partial<Capabilities>) { this.#caps = v || {}; }
  get caps(): Partial<Capabilities> { return this.#caps; }

  #$<T extends Element = HTMLElement>(sel: string): T { return this.shadowRoot!.querySelector(sel) as T; }

  #wire(): void {
    this.#$('.scrim').addEventListener('click', () => this.close());
    this.#$('#c-close').addEventListener('click', () => this.close());
    this.#$<HTMLFormElement>('.panel').addEventListener('submit', (e) => { e.preventDefault(); this.#submit(); });
    this.shadowRoot!.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') this.close(); });
    // The mini-outline's new-item title mirrors the title field live as it's typed.
    this.#$<HTMLInputElement>('#c-title').addEventListener('input', () => this.#syncTitle());
  }

  // Which create fields the source declared. type/title are always required; the
  // rest are gated on membership so the sheet never offers a field the source drops.
  #declares(f: CreatableField): boolean {
    return (this.#caps.createFields || []).includes(f);
  }

  // ---- open / close ----
  // The tier and parent are fixed by the caller (which add affordance fired), so
  // both are shown read-only and only the editable fields take input.
  open(context: ComposeContext): void {
    if (!this.#caps.create) return;
    this.#ctx = context || { type: 'TASK' };
    this.#paint();
    this.sfx?.pageTurn();
    this.#lastFocus = document.activeElement as HTMLElement | null;
    this.setAttribute('open', '');
    // Title is the one field a user always fills, so focus it on open.
    this.#$<HTMLInputElement>('#c-title').focus();
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

  // ---- paint ----
  #paint(): void {
    this.#setErr('');
    this.#setSubmitting(false);

    const type = String(this.#ctx.type || 'TASK').toUpperCase();
    const hasParent = !!this.#ctx.parentId;

    // The eyebrow reads "new <type>" as plain text in the eyebrow's own style.
    this.#$('#c-type-word').textContent = type.toLowerCase();

    this.#$<HTMLInputElement>('#c-title').value = '';

    // The mini-outline heading: the new item's full ancestry (epic → … → parent)
    // with the new item nested at the bottom, rendered the way the outline lens
    // renders rows. The new row's title mirrors the field as it's typed.
    this.#paintOutline(type);

    // Project: a child inherits its parent's project silently (no picker). A root
    // shows the picker, defaulted to the board's current scope, when the source
    // declares the field.
    const projectField = this.#$('#c-project-field');
    const showProject = this.#declares('project') && !hasParent;
    projectField.hidden = !showProject;
    if (showProject) {
      const sel = this.#$<HTMLSelectElement>('#c-project'); sel.innerHTML = '';
      const none = el('option', null, 'none'); none.value = ''; sel.append(none);
      for (const p of this.projects) { const o = el('option', null, p.name || p.id); o.value = p.id; sel.append(o); }
      sel.value = this.#ctx.project != null ? String(this.#ctx.project) : '';
    }

    const assigneeField = this.#$('#c-assignee-field');
    assigneeField.hidden = !this.#declares('assignee');
    this.#$<HTMLInputElement>('#c-assignee').value = this.#declares('assignee') ? (this.me || '') : '';

    this.#$('#c-description-field').hidden = !this.#declares('description');
    this.#$<HTMLTextAreaElement>('#c-description').value = '';

    this.#$('#c-estimate-field').hidden = !this.#declares('estimate');
    this.#$<HTMLInputElement>('#c-estimate').value = '';
  }

  // Build the mini-outline heading: the new item's full place in the tree. The
  // ancestor chain (epic → … → immediate parent) renders top-down, each level
  // nested one step deeper under a guide spine, with the new item at the bottom.
  // A root (no ancestors) is a single flush row. The new row's title is blank on
  // open and mirrors the title field via #syncTitle. A tier class per row drives
  // the type scale (epic > story > task) the same way the outline lens does.
  #paintOutline(type: string): void {
    const box = this.#$('#c-outline'); box.innerHTML = '';

    const moRow = (tier: string, isNew: boolean, title?: string, shortId?: string | null, url?: string | null): HTMLElement => {
      const row = el('div', `mo-row tier-${tier}${isNew ? ' mo-new' : ''}`);
      const titleEl = el('span', 'mo-title', title || '');
      // The id trails the title text INLINE, as a span within the title element
      // (chip · "title №"), so it reads as part of the same phrase, not a separate
      // column. The item being created has no id yet, so it shows none.
      if (!isNew && shortId) titleEl.append(idTag(shortId, url));
      row.append(el('span', `chip t-${tier}`, tier), titleEl);
      return row;
    };

    // Walk the ancestor chain, each level nesting one step deeper; the current
    // container is where the next-deeper row/spine is appended.
    let container = box;
    for (const a of this.#ctx.ancestors || []) {
      container.append(moRow(String(a.type || '').toUpperCase() || '·', false, a.title, a.shortId, a.url));
      const kids = el('div', 'mo-children nested');
      container.append(kids);
      container = kids;
    }
    container.append(moRow(type, true, ''));
    this.#syncTitle();
  }

  // Mirror the title field into the new-item row of the mini-outline; a blank
  // field shows a faint placeholder so the row keeps its height.
  #syncTitle(): void {
    const t = this.#$<HTMLInputElement>('#c-title')?.value.trim() || '';
    const cell = this.shadowRoot!.querySelector('.mo-new .mo-title') as HTMLElement | null;
    if (!cell) return;
    cell.textContent = t || 'untitled';
    cell.classList.toggle('empty', !t);
  }

  // ---- submit ----
  async #submit(): Promise<void> {
    if (this.#submitting || !this.api) return;
    const type = String(this.#ctx.type || 'TASK').toUpperCase();
    const title = this.#$<HTMLInputElement>('#c-title').value.trim();
    if (!title) { this.#setErr('A title is required.'); this.#$<HTMLInputElement>('#c-title').focus(); return; }

    const input: CreateInput = { type, title };
    // Parent comes from the fixed context, not a field. A child inherits its
    // parent's project; a root uses the picker's value.
    if (this.#declares('parent') && this.#ctx.parentId) input.parent = String(this.#ctx.parentId);
    if (this.#declares('project')) {
      const v = this.#ctx.parentId ? (this.#ctx.project || '') : this.#$<HTMLSelectElement>('#c-project').value;
      if (v) input.project = String(v);
    }
    if (this.#declares('assignee')) { const v = this.#$<HTMLInputElement>('#c-assignee').value.trim(); if (v) input.assignee = v; }
    if (this.#declares('description')) { const v = this.#$<HTMLTextAreaElement>('#c-description').value; if (v.trim()) input.description = v; }
    if (this.#declares('estimate')) { const v = this.#$<HTMLInputElement>('#c-estimate').value.trim(); if (v) input.estimate = Number(v) || null; }

    this.#setErr('');
    this.#setSubmitting(true);
    try {
      const { item } = await this.api<{ item: Item }>('/api/item', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
      this.sfx?.quill();
      // Carry the submitted input alongside the item: the Item shape has no parent
      // pointer (hierarchy is expressed through getChildren), so the board needs
      // the input's parent/project to place the new item in the tree.
      this.dispatchEvent(new CustomEvent('item-created', { detail: { item, input }, bubbles: true, composed: true }));
      this.close();
    } catch (err) {
      const msg = (err as Error).message || 'Create failed.';
      this.#setErr(msg);
      this.toast?.(msg, true);
      this.#setSubmitting(false);
    }
  }

  #setSubmitting(on: boolean): void {
    this.#submitting = on;
    const btn = this.#$<HTMLButtonElement>('#c-submit');
    btn.disabled = on;
    btn.innerHTML = on ? 'creating…' : '<span aria-hidden="true">✎ </span>create';
  }

  #setErr(msg: string): void { this.#$('#c-err').textContent = msg; }

  // Keep Tab inside the sheet while it's open (a simple single-root trap; the
  // sheet has no nested shadow roots, unlike the drawer's comment thread).
  #trapFocus(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.hasAttribute('open')) return;
    const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const nodes = Array.from(this.#$('.panel').querySelectorAll<HTMLElement>(sel)).filter((n) => !n.hidden && n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0]!, last = nodes[nodes.length - 1]!;
    const active = this.shadowRoot!.activeElement;
    if (e.shiftKey && (active === first || active === this.#$('.panel'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
}

if (!customElements.get('ledger-compose')) customElements.define('ledger-compose', LedgerCompose);
