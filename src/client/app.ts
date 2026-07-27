// The Ledger — client composition root. Talks only to the local host (never to a
// source backend directly; credentials stay server-side). The host is
// plugin-agnostic: the client reads /api/source once for the active source's
// identity + capabilities, then hides actions the source doesn't support.
//
// The UI is a composition of custom elements (the components/): <ledger-card>,
// <ledger-column>, <ledger-comment-thread>, <ledger-drawer>. This module defines
// the <ledger-board> root (light DOM — it owns orchestration, not encapsulation)
// and wires the controls; the model lives in core/, the lenses in views/.
// Importing a component module registers its element as a side effect.

import './components/ledger-card.js';
import './components/ledger-column.js';
import './components/ledger-drawer.js';
import './components/ledger-compose.js';

import { state } from './core/state.js';
import { api, loadProjects } from './core/api.js';
import { loadTree, render, wireDrawer, wireCompose } from './core/board.js';
import { buildTitle } from './ui/title-seal.js';
import { $, need } from './ui/dom.js';
import type { LedgerDrawer } from './components/ledger-drawer.js';
import type { LedgerCompose } from './components/ledger-compose.js';
import type { Capabilities, Project } from '../shared/contract';

// ---- controls ----

// Populate the project picker from the source, when it supports projects. A
// failure here is non-fatal: the picker stays hidden and the board shows every
// project (the unscoped default), so a rooms-endpoint hiccup can't block the tree.
async function fillProjects(): Promise<Project[]> {
  if (!state.caps.projects) return [];
  try {
    const projects = await loadProjects();
    if (!projects.length) return [];
    const sel = need<HTMLSelectElement>('#project-select');
    for (const p of projects) { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name; sel.append(opt); }
    sel.value = state.project || '';
    need('#project-ctl').hidden = false;
    return projects;
  } catch { return []; /* leave the picker hidden; the board stays unscoped */ }
}

// Set the pressed button in a segmented group: visual `.on` + `aria-pressed`.
function setPressed(group: HTMLElement, btn: HTMLElement): void {
  group.querySelectorAll('button').forEach((x) => {
    const on = x === btn;
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', String(on));
  });
}
function segWire(id: string, apply: (data: DOMStringMap) => void): void {
  const s = need(id);
  s.querySelectorAll('button').forEach((b) => { b.onclick = () => { setPressed(s, b); apply(b.dataset); }; });
}
function syncLensSeg(): void {
  need('#lens-seg').querySelectorAll('button').forEach((b) => {
    const on = b.dataset.lens === state.lens;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function wire(): void {
  // Closed items are hidden by default (status 'Open'); the toggle reveals them.
  need<HTMLInputElement>('#show-closed').onchange = (e) => { state.status = (e.target as HTMLInputElement).checked ? 'ALL' : 'Open'; loadTree(); };
  segWire('#lens-seg', (d) => { state.lens = (d.lens as typeof state.lens); render({ animate: true }); });

  const aSeg = need('#assignee-seg'); const aInput = need<HTMLInputElement>('#assignee-input');
  aSeg.querySelectorAll('button').forEach((b) => { b.onclick = () => { setPressed(aSeg, b); aInput.value = ''; state.assignee = b.dataset.assignee || ''; loadTree(); }; });
  aInput.onkeydown = (e) => {
    if (e.key === 'Enter' && aInput.value.trim()) {
      aSeg.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      state.assignee = aInput.value.trim(); loadTree();
    }
  };

  // Project scope: null (all) or a source project id. Reloads the tree scoped.
  need<HTMLSelectElement>('#project-select').onchange = (e) => { state.project = (e.target as HTMLSelectElement).value || null; loadTree(); };

  need('#refresh').onclick = () => loadTree();
  wireDrawer();
  wireCompose();

  // Single-key view shortcuts. The drawer owns its own Escape and internal keys;
  // these stay dormant while it's open (and never hijack modifier combos or keys
  // typed into a field).
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches?.('input, textarea, select')) return;
    if (need('#drawer').hasAttribute('open')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'r') loadTree();
    else if (e.key === '1') { state.lens = 'columns'; syncLensSeg(); render({ animate: true }); }
    else if (e.key === '2') { state.lens = 'outline'; syncLensSeg(); render(); }
  });
}

// ---- <ledger-board> — the app root ----
// A light-DOM element (no shadow root): it owns the model and orchestration
// (imported above), and its children (masthead, controls, stage) keep the
// document's global styling. Startup runs once on connect: wire the controls,
// build the animated title, do the source handshake, load the tree.
class LedgerBoard extends HTMLElement {
  #started = false;
  async connectedCallback(): Promise<void> {
    if (this.#started) return;   // connectedCallback can fire again on a move
    this.#started = true;
    wire();
    buildTitle();
    // One handshake: who we act as and which actions the active source supports.
    try {
      const { me, capabilities } = await api<{ me: string; capabilities: Capabilities }>('/api/source');
      state.me = me; state.caps = capabilities || {};
      need<LedgerDrawer>('#drawer').caps = state.caps;   // gate the drawer's fields on capabilities
      const name = $('#ident-name'); if (name) name.textContent = me;
      const projects = await fillProjects();        // fills + reveals the project picker if supported
      // Hand the compose sheet the identity + project options it needs. The add
      // affordances that open it (column "+", drawer sections) show only when the
      // source declares create; the sheet itself no-ops on open without it.
      if (state.caps.create) {
        const compose = need<LedgerCompose>('#compose');
        compose.caps = state.caps; compose.me = me; compose.projects = projects;
      }
    } catch { const name = $('#ident-name'); if (name) name.textContent = 'unknown'; }
    loadTree();
  }
}
if (!customElements.get('ledger-board')) customElements.define('ledger-board', LedgerBoard);
