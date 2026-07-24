'use strict';

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

import { el, asButton, copyLink, relTime } from './util.js';
import { chromeSheet, idTag } from './shared-styles.js';
import { mdToHtml, renderInto } from './markdown.js';
import './ledger-comment-thread.js';

const STATUSES = ['Open', 'Resolved', 'Closed'];

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
  .d-field select, .d-field input, .d-typeahead input {
    box-sizing: border-box; width: 100%; background: rgba(255,250,235,.7); color: var(--ink, #33291a); border: 1px solid var(--parch-edge, #c4ac7c);
    border-radius: 2px; padding: 8px 10px; font-family: var(--gara, serif); font-size: 15px; outline: none;
  }
  .d-field select:focus, .d-field input:focus, .d-typeahead input:focus { border-color: var(--brass-lo, #7a5f30); background: #fffaeb; }

  .d-typeahead { position: relative; }
  .typeahead-list { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 2px); margin: 0; padding: 4px; list-style: none;
    background: var(--parch-hi, #f3ead0); border: 1px solid var(--brass-lo, #7a5f30); border-radius: 2px;
    box-shadow: 0 8px 20px rgba(0,0,0,.35); max-height: 260px; overflow-y: auto; }
  .typeahead-item { display: grid; grid-template-columns: 1fr auto; gap: 0 10px; align-items: baseline; padding: 6px 8px; cursor: pointer; border-radius: 2px; }
  .typeahead-item.active, .typeahead-item:hover { background: rgba(196,172,124,.35); }
  .ta-name { font-family: var(--gara, serif); font-size: 15px; color: var(--ink, #33291a); }
  .ta-alias { font-family: var(--mono, monospace); font-size: 12px; color: var(--ink-red, #8f2f22); }
  .ta-title { grid-column: 1 / -1; font-family: var(--fell, serif); font-style: italic; font-size: 12.5px; color: var(--ink-faint, #6f5c3e); }

  .d-contains { margin-bottom: 22px; padding: 14px 16px; border: 1px solid var(--parch-edge, #c4ac7c); border-radius: 2px; background: rgba(255,250,235,.4); }
  .d-contains h4 { margin: 0 0 10px; font-family: var(--fell-sc, serif); font-size: 13px; letter-spacing: .08em; color: var(--ink-red, #8f2f22); font-weight: 400; }
  .cline { display: flex; align-items: center; gap: 10px; padding: 6px 4px; cursor: pointer; border-bottom: 1px dotted rgba(91,74,48,.25); font-size: 14px; }
  .cline:last-child { border-bottom: 0; }
  .cline:hover { color: var(--wax, #7c2b22); }
  .cline .ct { flex: 1; font-family: var(--gara, serif); }
  .cgroup { margin-top: 8px; }
  .cgroup-label { font-family: var(--fell, serif); font-style: italic; font-size: 15px; color: var(--ink-soft, #5b4a30); margin: 10px 0 4px; }

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

class LedgerDrawer extends HTMLElement {
  api = null;
  fetchChildren = null;
  sfx = null;
  toast = null;
  #caps = {};
  #item = null;
  #descMode = 'read';
  #descCancelled = false;
  #lastFocus = null;
  #stepCache = new Map();
  #ta = { items: [], active: -1, seq: 0, debounce: null };
  #saveTimer = 0;
  #trap = null;

  connectedCallback() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.adoptedStyleSheets = [chromeSheet, sheet];
    this.shadowRoot.innerHTML = `
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
          <div class="d-field" id="d-estimate-field"><label for="d-estimate-edit">estimate (points)</label><input type="number" id="d-estimate-edit" min="0" step="1" spellcheck="false" placeholder="—" /></div>
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

  set caps(v) { this.#caps = v || {}; }
  get caps() { return this.#caps; }

  #$(sel) { return this.shadowRoot.querySelector(sel); }

  #wire() {
    this.#$('.scrim').addEventListener('click', () => this.close());
    this.#$('#d-close').addEventListener('click', () => this.close());
    this.#$('#d-copy-link').addEventListener('click', () => { if (this.#item?.url) copyLink(this.#item.url, this.#$('#d-copy-link')); });

    this.#$('#d-status-edit').addEventListener('change', (e) => this.#edit('status', e.target.value, 'Status'));
    this.#$('#d-step-edit').addEventListener('change', (e) => this.#edit('workflowAction', e.target.value, 'Workflow step'));
    this.#$('#d-estimate-edit').addEventListener('blur', (e) => {
      const value = e.target.value.trim();
      const current = this.#item?.estimate;
      const same = (value === '' && (current == null || current === 0)) || Number(value) === current;
      if (!same) this.#edit('estimate', value, 'Estimate');
    });

    // Description: click/Enter the rendered view to edit; blur saves; cancel discards.
    asButton(this.#$('#d-desc-render'), () => this.#enterEdit());
    this.#$('#d-cancel').addEventListener('mousedown', (e) => { e.preventDefault(); this.#cancelEdit(); });
    this.#$('#d-desc').addEventListener('blur', () => this.#saveDescOnBlur());

    const aEdit = this.#$('#d-assignee-edit');
    aEdit.addEventListener('input', () => this.#onAssigneeInput());
    aEdit.addEventListener('keydown', (e) => this.#onAssigneeKeydown(e));
    aEdit.addEventListener('blur', () => this.#onAssigneeBlur());

    // Description-editor Escape cancels; otherwise Escape closes the drawer. The
    // assignee list handles its own Escape (stopPropagation) to stay open-scoped.
    this.shadowRoot.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (this.#descMode === 'edit') { this.#cancelEdit(); e.target.blur?.(); }
      else this.close();
    });

    const thread = this.#$('#c-thread');
    thread.addEventListener('comment-add', (e) => this.#comment('POST', '', { message: e.detail.message }, true));
    thread.addEventListener('comment-edit', (e) => this.#comment('POST', `/${e.detail.id}`, { message: e.detail.message }));
    thread.addEventListener('comment-delete', (e) => this.#comment('DELETE', `/${e.detail.id}`));
  }

  // ---- open / close ----
  async open(node) {
    if (!node) return;
    this.sfx?.pageTurn();
    this.#item = node;
    this.#descMode = 'read';
    this.#paint(node);
    this.#lastFocus = node.getRootNode?.()?.activeElement || document.activeElement;
    this.setAttribute('open', '');
    this.#$('.panel').focus();
    this.#trap = (e) => this.#trapFocus(e);
    document.addEventListener('keydown', this.#trap, true);

    if (this.#caps.readItem && this.api) {
      try {
        const { item } = await this.api(`/api/item/${node.id}`);
        if (this.#item?.id !== node.id) return;
        Object.assign(node, item);
        this.#item = node;
        this.#paint(node);
      } catch (err) { this.toast?.(err.message, true); }
    }
  }

  close() {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.#item = null;
    if (this.#trap) { document.removeEventListener('keydown', this.#trap, true); this.#trap = null; }
    if (this.#lastFocus && this.#lastFocus.isConnected) this.#lastFocus.focus();
    this.#lastFocus = null;
  }

  // Focus trap that descends into nested shadow roots (the comment thread), so
  // Tab cycles through every focusable in the open dialog, not just this root's.
  #trapFocus(e) {
    if (e.key !== 'Tab' || !this.hasAttribute('open')) return;
    const focusables = this.#deepFocusables(this.#$('.panel'));
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    const active = this.shadowRoot.activeElement;
    const activeDeep = this.#deepActive();
    if (e.shiftKey && (activeDeep === first || active === this.#$('.panel'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && activeDeep === last) { e.preventDefault(); first.focus(); }
  }
  #deepActive() {
    let a = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  #deepFocusables(root) {
    const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const out = [];
    const walk = (r) => {
      r.querySelectorAll(sel).forEach((n) => {
        if (n.hidden || n.offsetParent === null) return;
        out.push(n);
        if (n.shadowRoot) walk(n.shadowRoot);
      });
    };
    walk(root);
    return out;
  }

  // ---- paint ----
  #paint(item) {
    const caps = this.#caps;
    const type = this.#$('#d-type'); type.textContent = item.type; type.className = `chip t-${item.type}`;
    // The source supplies the ticket link; without one, show the id as plain text
    // (no href, no copy button) — the app builds no source URL itself.
    this.#$('#d-short-text').textContent = `№ ${item.shortId}`;
    const short = this.#$('#d-short'); const copyBtn = this.#$('#d-copy-link');
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

    const canEdit = (f) => (caps.editFields || []).includes(f);
    this.#$('#d-status-field').hidden = !canEdit('status');
    this.#$('#d-assignee-field').hidden = !canEdit('assignee');
    this.#$('#d-estimate-field').hidden = !canEdit('estimate');

    this.#$('#d-estimate-edit').value = item.estimate != null && item.estimate > 0 ? item.estimate : '';
    const sel = this.#$('#d-status-edit'); sel.innerHTML = '';
    const opts = STATUSES.includes(item.status) ? STATUSES : [item.status, ...STATUSES];
    [...new Set(opts)].forEach((s) => { const o = el('option', null, s); o.value = s; if (s === item.status) o.selected = true; sel.append(o); });
    this.#$('#d-assignee-edit').value = item.assignee || '';
    this.#closeAssigneeList();

    this.#populateStepField(item);
    this.#renderContains(item);
    this.#renderMarkdown(item.description || '');
    this.#setDescMode('read');
    this.#setSaveState('');

    const thread = this.#$('#c-thread');
    thread.canComment = !!caps.comment;
    thread.canEdit = !!caps.editOwnComments;
    thread.comments = item.comments || [];
  }

  // ---- edits ----
  async #edit(field, value, label) {
    const node = this.#item; if (!node || !this.api) return;
    try {
      const { item } = await this.api(`/api/item/${node.id}/edit`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ field, value }),
      });
      Object.assign(node, item); this.#item = node;
      if (field === 'estimate') this.#$('#d-estimate-edit').value = item.estimate != null && item.estimate > 0 ? item.estimate : '';
      this.sfx?.quill();
      this.#setSaveState('saved', `${label.toLowerCase()} saved`);
      this.#emitChanged();
      return item;
    } catch (err) { this.toast?.(err.message, true); throw err; }
  }

  async #comment(method, suffix, body, clearComposer) {
    const node = this.#item; if (!node || !this.api) return;
    try {
      const { item } = await this.api(`/api/item/${node.id}/comment${suffix}`, {
        method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      Object.assign(node, item); this.#item = node;
      const thread = this.#$('#c-thread');
      thread.comments = item.comments || [];
      if (clearComposer) thread.clearComposer();
      this.sfx?.quill();
      this.#setSaveState('saved', 'comment saved');
      this.#emitChanged();
    } catch (err) { this.toast?.(err.message, true); }
  }

  #emitChanged() {
    this.dispatchEvent(new CustomEvent('item-changed', { detail: { item: this.#item }, bubbles: true, composed: true }));
  }

  // ---- description edit mode ----
  #renderMarkdown(src) {
    const box = this.#$('#d-desc-render');
    if (!src.trim()) { box.className = 'd-desc-render empty'; box.textContent = 'No description yet. Click “edit” to add one.'; return; }
    box.className = 'd-desc-render';
    renderInto(box, src);
  }
  #setDescMode(mode) {
    this.#descMode = mode;
    const editing = mode === 'edit';
    this.#$('#d-desc-render').hidden = editing;
    this.#$('#d-desc').hidden = !editing;
    this.#$('#d-cancel').hidden = !editing;
    if (editing) this.#$('#d-desc').focus();
  }
  #enterEdit() {
    if (this.#descMode === 'edit') return;
    this.#descCancelled = false;
    this.#$('#d-desc').value = this.#item?.description || '';
    this.#setDescMode('edit');
  }
  #cancelEdit() { this.#descCancelled = true; this.#setDescMode('read'); }
  async #saveDescOnBlur() {
    if (this.#descMode !== 'edit') return;
    if (this.#descCancelled) { this.#descCancelled = false; return; }
    const value = this.#$('#d-desc').value;
    if (value === (this.#item?.description || '')) { this.#setDescMode('read'); return; }
    const item = await this.#edit('description', value, 'Description').catch(() => null);
    if (item) this.#renderMarkdown(item.description || '');
    this.#setDescMode('read');
  }

  #setSaveState(kind, label) {
    const s = this.#$('#d-save-state');
    s.className = `save-state ${kind}`;
    s.textContent = kind === 'saved' ? `✓ ${label || 'saved'}` : '';
    clearTimeout(this.#saveTimer);
    if (kind === 'saved') this.#saveTimer = setTimeout(() => { s.className = 'save-state'; s.textContent = ''; }, 2400);
  }

  // ---- workflow step field ----
  async #populateStepField(item) {
    const field = this.#$('#d-step-field'); const sel = this.#$('#d-step-edit');
    field.hidden = true; sel.innerHTML = '';
    if (!this.#caps.stepOptions || !item.project || !this.api) return;
    let steps = this.#stepCache.get(item.project);
    if (!steps) {
      try { steps = (await this.api(`/api/steps?project=${encodeURIComponent(item.project)}`)).steps || []; }
      catch { steps = []; }
      this.#stepCache.set(item.project, steps);
    }
    const all = item.workflowAction && !steps.includes(item.workflowAction) ? [item.workflowAction, ...steps] : steps;
    if (!all.length) return;
    if (this.#item?.id !== item.id) return; // moved on while awaiting
    all.forEach((s) => { const o = el('option', null, s); o.value = s; if (s === item.workflowAction) o.selected = true; sel.append(o); });
    field.hidden = false;
  }

  // ---- contains (children summary) ----
  async #renderContains(item) {
    const box = this.#$('#d-contains');
    if (!item.childCount) { box.hidden = true; box.innerHTML = ''; return; }
    if (!item.loaded && this.fetchChildren) {
      box.hidden = false; box.innerHTML = '';
      box.append(el('h4', null, 'Contents'), el('div', 'cgroup-label', 'loading…'));
      try { await this.fetchChildren(item); } catch { /* leave loading */ }
      if (this.#item?.id !== item.id) return;
    }
    const children = item.children || [];
    const stories = children.filter((n) => n.kind === 'story');
    const direct = children.filter((n) => n.kind !== 'story');
    const groups = [];
    if (item.kind === 'epic') {
      if (stories.length) groups.push(['Stories', stories]);
      if (direct.length) groups.push(['Tasks directly on this epic', direct]);
    } else if (children.length) {
      groups.push(['Tasks', children]);
    }
    if (!groups.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false; box.innerHTML = '';
    box.append(el('h4', null, 'Contents'));
    for (const [label, list] of groups) {
      const g = el('div', 'cgroup');
      g.append(el('div', 'cgroup-label', `${label} · ${list.length}`));
      list.forEach((child) => {
        const line = el('div', 'cline');
        line.append(el('span', `chip t-${child.type}`, child.type), el('span', 'ct', child.title));
        if (child.childCount) line.append(el('span', 'pill', `${child.childCount} within`));
        asButton(line, () => this.open(child), `${child.type} ${child.shortId}: ${child.title}. Open details.`);
        g.append(line);
      });
      box.append(g);
    }
  }

  // ---- assignee typeahead ----
  #closeAssigneeList() {
    const list = this.#$('#d-assignee-list');
    list.hidden = true; list.innerHTML = '';
    this.#ta.items = []; this.#ta.active = -1;
    this.#$('#d-assignee-edit').setAttribute('aria-expanded', 'false');
  }
  #renderAssigneeList() {
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
  #chooseAssignee(i) {
    const u = this.#ta.items[i]; if (!u) return;
    this.#$('#d-assignee-edit').value = u.alias;
    this.#closeAssigneeList();
    this.#commitAssignee();
  }
  #commitAssignee() {
    const value = this.#$('#d-assignee-edit').value.trim();
    if (value === (this.#item?.assignee || '')) return;
    this.#edit('assignee', value, 'Assignee');
  }
  async #queryAssignee(q) {
    const seq = ++this.#ta.seq;
    try {
      const { users } = await this.api(`/api/assignees?q=${encodeURIComponent(q)}`);
      if (seq !== this.#ta.seq) return;
      if (this.shadowRoot.activeElement !== this.#$('#d-assignee-edit')) return;
      this.#ta.items = users; this.#ta.active = -1;
      this.#renderAssigneeList();
    } catch { /* best-effort */ }
  }
  #onAssigneeInput() {
    const q = this.#$('#d-assignee-edit').value.trim();
    clearTimeout(this.#ta.debounce);
    if (!this.#caps.searchAssignees || q.length < 3) { this.#closeAssigneeList(); return; }
    this.#ta.debounce = setTimeout(() => this.#queryAssignee(q), 180);
  }
  #onAssigneeKeydown(e) {
    const open = !this.#$('#d-assignee-list').hidden;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); this.#ta.active = Math.min(this.#ta.active + 1, this.#ta.items.length - 1); this.#renderAssigneeList(); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); this.#ta.active = Math.max(this.#ta.active - 1, 0); this.#renderAssigneeList(); }
    else if (e.key === 'Enter') {
      if (open && this.#ta.active >= 0) { e.preventDefault(); this.#chooseAssignee(this.#ta.active); }
      else { this.#closeAssigneeList(); this.#commitAssignee(); }
    } else if (e.key === 'Escape' && open) { e.stopPropagation(); this.#closeAssigneeList(); }
  }
  #onAssigneeBlur() {
    setTimeout(() => { if (!this.#$('#d-assignee-list').hidden) return; this.#commitAssignee(); }, 120);
  }
}

if (!customElements.get('ledger-drawer')) customElements.define('ledger-drawer', LedgerDrawer);
export { LedgerDrawer };
