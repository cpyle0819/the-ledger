'use strict';

// <ledger-comment-thread> — the comment list and composer for one item.
//
// Data in (properties): `comments` (array of shaped comments), `canEdit`
// (whether the source supports editing/deleting own comments — gates the
// edit/delete affordances alongside each comment's own `isMine`), and
// `canComment` (whether the source accepts new comments — hides the composer
// when false; existing comments still render read-only).
//
// Events out (composed): the thread owns display and input state but not the
// network. It emits and lets the host perform the write, then hand back a fresh
// `comments` array:
//   comment-add    {message}
//   comment-edit   {id, message}
//   comment-delete {id}
//
// Comments render newest-first. Markdown is rendered via the shared renderer.

import { el, relTime } from './util.js';
import { renderInto } from './markdown.js';

const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: block; }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .label { font-family: var(--fell-sc, Georgia, serif); font-size: 15px; letter-spacing: .08em; color: var(--ink-red, #8f2f22); }

  .compose { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
  .compose textarea, .c-edit {
    width: 100%; resize: vertical; color: var(--ink, #33291a); font-family: var(--gara, serif);
    font-size: 16.5px; line-height: 1.6; background: rgba(255,250,235,.7);
    border: 1px solid var(--parch-edge, #c4ac7c); border-radius: 2px; padding: 8px 10px; outline: none;
  }
  .compose textarea:focus, .c-edit:focus { border-color: var(--brass-lo, #7a5f30); background: #fffaeb; }
  .mini-btn, .ghost-btn {
    font-family: var(--fell, serif); font-style: italic; font-size: 16px; cursor: pointer; border-radius: 2px;
    padding: 6px 13px; transition: .13s; line-height: 1.3;
  }
  .mini-btn {
    border: 1px solid var(--brass-lo, #7a5f30); color: var(--wood, #1c1409); font-weight: 700;
    background: linear-gradient(180deg, var(--brass-hi, #d8b878), var(--brass, #b08d4f));
    box-shadow: 0 1px 2px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.25);
  }
  .mini-btn:hover { background: linear-gradient(180deg, var(--brass, #b08d4f), var(--brass-lo, #7a5f30)); color: var(--parch-hi, #f3ead0); }
  .mini-btn:disabled { opacity: .45; cursor: default; }
  .ghost-btn { background: transparent; border: 1px solid var(--parch-edge, #c4ac7c); color: var(--ink-soft, #5b4a30); }
  .compose .mini-btn { align-self: flex-start; }

  .c-empty { font-family: var(--fell, serif); font-style: italic; color: var(--ink-faint, #6f5c3e); font-size: 15px; padding: 4px 0 12px; }
  .c-list { display: flex; flex-direction: column; gap: 12px; }
  .c-item { border-left: 2px solid var(--brass-lo, #7a5f30); padding: 6px 0 6px 12px; background: linear-gradient(90deg, rgba(196,172,124,.14), transparent 60%); }
  .c-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 3px; }
  .c-author { font-family: var(--fell, serif); font-style: italic; font-weight: 600; font-size: 14px; color: var(--ink, #33291a); }
  .c-when { font-family: var(--fell, serif); font-style: italic; font-size: 12.5px; color: var(--ink-faint, #6f5c3e); }
  .c-acts { margin-left: auto; display: flex; gap: 8px; }
  .c-act { font-family: var(--fell, serif); font-style: italic; font-size: 13px; color: var(--ink-soft, #5b4a30); background: transparent; border: 0; padding: 0; cursor: pointer; text-decoration: underline dotted; }
  .c-act:hover { color: var(--wax, #7c2b22); }
  .c-body { font-family: var(--gara, serif); font-size: 16.5px; line-height: 1.6; color: var(--ink, #33291a); }
  .c-body p { margin: 0 0 6px; } .c-body p:last-child { margin-bottom: 0; }
  .c-body code { font-family: var(--mono, monospace); font-size: 12.5px; background: rgba(120,80,40,.12); padding: 1px 4px; border-radius: 2px; }
  .c-body a { color: var(--ink-red, #8f2f22); text-decoration: underline dotted; }
  .c-edit { margin-top: 4px; }
  .c-edit-bar { display: flex; gap: 8px; margin-top: 6px; }
  :focus-visible { outline: 2px solid var(--wax, #7c2b22); outline-offset: 2px; }
`);

class LedgerCommentThread extends HTMLElement {
  #comments = [];
  #canEdit = false;
  #canComment = true;

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.adoptedStyleSheets = [sheet];
      this.shadowRoot.innerHTML = `
        <div class="head"><span class="label" part="label">comments</span></div>
        <div class="compose" part="compose">
          <textarea rows="2" aria-label="Add a comment (Markdown)" placeholder="Add a comment…"></textarea>
          <button type="button" class="mini-btn">add comment</button>
        </div>
        <div class="c-list"></div>`;
      const ta = this.shadowRoot.querySelector('.compose textarea');
      const add = this.shadowRoot.querySelector('.compose .mini-btn');
      const submit = () => {
        const msg = ta.value.trim();
        if (!msg) return;
        this.#emit('comment-add', { message: msg });
      };
      add.addEventListener('click', submit);
      // Cmd/Ctrl+Enter submits.
      ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } });
    }
    this.#renderList();
  }

  set comments(v) { this.#comments = Array.isArray(v) ? v : []; if (this.shadowRoot) this.#renderList(); }
  get comments() { return this.#comments; }
  set canEdit(v) { this.#canEdit = !!v; if (this.shadowRoot) this.#renderList(); }
  get canEdit() { return this.#canEdit; }
  set canComment(v) { this.#canComment = !!v; const c = this.shadowRoot?.querySelector('.compose'); if (c) c.hidden = !this.#canComment; }
  get canComment() { return this.#canComment; }

  // Clear the composer (the host calls this after a successful add).
  clearComposer() { const ta = this.shadowRoot?.querySelector('.compose textarea'); if (ta) ta.value = ''; }

  #renderList() {
    const list = this.shadowRoot.querySelector('.c-list');
    const label = this.shadowRoot.querySelector('.label');
    const comments = this.#comments;
    label.textContent = comments.length ? `comments · ${comments.length}` : 'comments';
    list.innerHTML = '';
    if (!comments.length) { list.append(el('div', 'c-empty', 'No comments yet.')); return; }
    // Newest first. createDate is the stable ordering key; fall back to
    // lastUpdatedDate, then preserve source order for entries missing both.
    const when = (c) => new Date(c.createDate || c.lastUpdatedDate || 0).getTime() || 0;
    [...comments].sort((a, b) => when(b) - when(a)).forEach((c) => list.append(this.#commentEl(c)));
  }

  #commentEl(c) {
    const box = el('div', 'c-item'); box.dataset.id = c.id;
    const head = el('div', 'c-head');
    head.append(el('span', 'c-author', c.author || 'unknown'));
    const when = c.lastUpdatedDate || c.createDate;
    if (when) head.append(el('span', 'c-when', relTime(when)));
    if (c.isMine && this.#canEdit) {
      const acts = el('span', 'c-acts');
      const edit = el('button', 'c-act'); edit.type = 'button'; edit.textContent = 'edit';
      edit.addEventListener('click', () => this.#enterEdit(box, c));
      const del = el('button', 'c-act'); del.type = 'button'; del.textContent = 'delete';
      del.addEventListener('click', () => this.#emit('comment-delete', { id: c.id }));
      acts.append(edit, del);
      head.append(acts);
    }
    const body = el('div', 'c-body');
    renderInto(body, c.message || '');
    box.append(head, body);
    return box;
  }

  // Inline edit: swap the comment body for a textarea + save/cancel.
  #enterEdit(box, c) {
    if (box.querySelector('.c-edit')) return;
    const body = box.querySelector('.c-body');
    const ta = el('textarea', 'c-edit'); ta.value = c.message || ''; ta.rows = 3;
    const bar = el('div', 'c-edit-bar');
    const save = el('button', 'mini-btn'); save.type = 'button'; save.textContent = 'save';
    const cancel = el('button', 'ghost-btn'); cancel.type = 'button'; cancel.textContent = 'cancel';
    bar.append(save, cancel);
    body.hidden = true; box.append(ta, bar); ta.focus();
    cancel.addEventListener('click', () => { ta.remove(); bar.remove(); body.hidden = false; });
    save.addEventListener('click', () => { save.disabled = true; this.#emit('comment-edit', { id: c.id, message: ta.value }); });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

if (!customElements.get('ledger-comment-thread')) customElements.define('ledger-comment-thread', LedgerCommentThread);
export { LedgerCommentThread };
