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
import './components/ledger-load-more.js';
import './components/ledger-about.js';
import './components/ledger-settings.js';

import { state } from './core/state.js';
import { api, loadProjects } from './core/api.js';
import { loadTree, render, wireDrawer, wireCompose, reconcile, syncUrl, hydrateStateFromUrl, restoreFromUrl, wireDeepLinkNav } from './core/board.js';
import { initTheme, onThemeChange } from './core/theme.js';
import { $, need } from './ui/dom.js';
import type { LedgerDrawer } from './components/ledger-drawer.js';
import type { LedgerCompose } from './components/ledger-compose.js';
import type { LedgerAbout } from './components/ledger-about.js';
import type { LedgerSettings } from './components/ledger-settings.js';
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

// Reflect the current filter/lens state into the controls, so a view restored
// from the URL shows the matching toolbar (the project select is set in
// fillProjects, once its options exist). Runs on startup after hydration.
function syncControls(): void {
  syncLensSeg();
  need<HTMLInputElement>('#show-closed').checked = state.status !== 'Open';
  need<HTMLInputElement>('#search-input').value = state.search;
  const aSeg = need('#assignee-seg'); const aInput = need<HTMLInputElement>('#assignee-input');
  const preset = [...aSeg.querySelectorAll('button')].find((b) => (b.dataset.assignee || '') === state.assignee);
  aSeg.querySelectorAll('button').forEach((x) => { const on = x === preset; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
  // A specific-assignee filter (no matching preset button) shows in the free-text input.
  aInput.value = preset ? '' : state.assignee;
}

// Poll for changes made outside The Ledger, incrementally (see board.reconcile).
// Reconcile when the tab regains focus or becomes visible — the "I came back to
// it" case — and on a modest timer while the tab is visible. The timer is stopped
// while hidden so a backgrounded tab makes no requests. Overlap and no-op polls
// are guarded inside reconcile, so the extra call when focus + visibility fire
// together is harmless.
const RECONCILE_MS = 30000;
// Restart the poll timer from now — called on every filter change so a poll can't
// fire mid-transition (right as the tree reloads under the new filter). Set by
// wireReconcile; a no-op until then.
let resetReconcileTimer: () => void = () => {};
function wireReconcile(): void {
  let timer = 0;
  const start = (): void => { if (!timer) timer = window.setInterval(() => { if (document.visibilityState === 'visible') reconcile(); }, RECONCILE_MS); };
  const stop = (): void => { if (timer) { clearInterval(timer); timer = 0; } };
  // Reset = stop then start, so the next poll is a full interval away from the
  // filter change rather than whatever was left on the old cycle.
  resetReconcileTimer = (): void => { if (document.visibilityState === 'visible') { stop(); start(); } };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { reconcile(); start(); } else stop();
  });
  window.addEventListener('focus', () => reconcile());
  if (document.visibilityState === 'visible') start();
}

// A filter change reloads the tree AND pushes the next poll a full interval out,
// so no in-flight poll races the reload. One helper for every filter control.
function reloadForFilterChange(): void {
  syncUrl();
  resetReconcileTimer();
  loadTree();
}

// Reveal the masthead terminal button and wire it to the panel. Called only when
// the host reports the terminal is enabled; the component module (and its xterm
// dependency) loads lazily here so a disabled terminal costs nothing.
async function wireTerminal(): Promise<void> {
  const { LedgerTerminal } = await import('./components/ledger-terminal.js');
  const btn = $('#terminal-btn');
  const panel = $('#terminal');
  if (!btn || !(panel instanceof LedgerTerminal)) return;
  btn.hidden = false;
  btn.onclick = () => { void panel.open(); };
}

function wire(): void {
  // Closed items are hidden by default (status 'Open'); the toggle reveals them.
  need<HTMLInputElement>('#show-closed').onchange = (e) => { state.status = (e.target as HTMLInputElement).checked ? 'ALL' : 'Open'; reloadForFilterChange(); };
  segWire('#lens-seg', (d) => { state.lens = (d.lens as typeof state.lens); syncUrl(); render({ animate: true }); });

  const aSeg = need('#assignee-seg'); const aInput = need<HTMLInputElement>('#assignee-input');
  aSeg.querySelectorAll('button').forEach((b) => { b.onclick = () => { setPressed(aSeg, b); aInput.value = ''; state.assignee = b.dataset.assignee || ''; reloadForFilterChange(); }; });
  aInput.onkeydown = (e) => {
    if (e.key === 'Enter' && aInput.value.trim()) {
      aSeg.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      state.assignee = aInput.value.trim(); reloadForFilterChange();
    }
  };

  // Project scope: null (all) or a source project id. Reloads the tree scoped.
  need<HTMLSelectElement>('#project-select').onchange = (e) => { state.project = (e.target as HTMLSelectElement).value || null; reloadForFilterChange(); };

  // Free-text search. Debounced so a reload fires once typing settles rather than
  // per keystroke; Enter reloads at once. A no-op when the trimmed value is
  // unchanged, so blur/Enter after the debounce already ran doesn't refetch.
  const sInput = need<HTMLInputElement>('#search-input');
  let searchTimer = 0;
  const applySearch = (): void => {
    const next = sInput.value.trim();
    if (next === state.search) return;
    state.search = next; reloadForFilterChange();
  };
  sInput.oninput = () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(applySearch, 350); };
  sInput.onkeydown = (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); applySearch(); } };

  need('#refresh').onclick = () => loadTree();
  need('#about-btn').onclick = () => need<LedgerAbout>('#about').open();
  need('#settings-btn').onclick = () => need<LedgerSettings>('#settings').open();
  // The gear is present only when the active theme has knobs to tune; the panel
  // reads its own `hasSettings` off the active theme, so show/hide tracks it on
  // every theme resolve and switch.
  onThemeChange(() => { need('#settings-btn').hidden = !need<LedgerSettings>('#settings').hasSettings; });
  wireDrawer();
  wireCompose();
  wireReconcile();

  // Single-key view shortcuts. The drawer owns its own Escape and internal keys;
  // these stay dormant while it's open (and never hijack modifier combos or keys
  // typed into a field).
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches?.('input, textarea, select')) return;
    if (need('#drawer').hasAttribute('open')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'r') loadTree();
    else if (e.key === '1') { state.lens = 'columns'; syncLensSeg(); syncUrl(); render({ animate: true }); }
    else if (e.key === '2') { state.lens = 'outline'; syncLensSeg(); syncUrl(); render(); }
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
    // Fold the deep link into state before the first load, so the tree is fetched
    // through the linked filters and the linked selection resolves against it.
    const urlState = hydrateStateFromUrl();
    wire();
    wireDeepLinkNav();
    syncControls();
    // The masthead logo is a theme asset, rendered by initTheme once the theme
    // resolves (see core/theme.applyLogo). Nothing to paint here first.
    // One handshake: who we act as, which actions the active source supports, and
    // the server-configured default theme. Apply the theme from that default
    // (the browser's stored choice, if any, overrides it inside initTheme).
    try {
      const { me, capabilities, theme, terminal } = await api<{ me: string; capabilities: Capabilities; theme: string | null; terminal?: boolean }>('/api/source');
      state.me = me; state.caps = capabilities || {};
      await initTheme(theme ?? null);
      // The terminal is optional and its client code pulls in xterm from the
      // vendor route, which the host mounts only when the feature is on. So import
      // and wire it lazily, gated on the handshake flag — a static import would
      // fetch xterm even when disabled (the vendor route 404s then).
      if (terminal) await wireTerminal();
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
    } catch {
      const name = $('#ident-name'); if (name) name.textContent = 'unknown';
      // Handshake failed, but the theme layer is independent of the source — still
      // resolve it (from stored choice / manifest default) so the app is themed
      // and the switcher works.
      await initTheme(null);
    }
    await loadTree();
    // The tree is loaded; restore what it can't rebuild alone — the outline's
    // expanded subtrees and the open drawer from the deep link.
    restoreFromUrl(urlState);
  }
}
if (!customElements.get('ledger-board')) customElements.define('ledger-board', LedgerBoard);
