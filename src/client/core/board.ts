// The board controller: orchestration for the two lenses. It owns the load →
// render → select → patch cycle and the drawer glue, implementing the handler
// contract the views call back into. Rendering lives in the view modules; data
// access in api.js; this module is the conductor between them.
//
// A full render only happens on data load / filter / lens change. Selecting a
// card does a PARTIAL update (selectEpic/selectStory swap only the downstream
// columns) so upstream columns never tear down and re-animate — that was the
// "everything blinks" bug.

import { state, byId, clearNodes, type CachedNode } from './state.js';
import { api, fetchChildren, ensureChildren, type ApiError } from './api.js';
import { sfx } from './sound.js';
import { $, need } from '../ui/dom.js';
import { toast, showLoading } from '../ui/feedback.js';
import { renderColumns, refreshDownstreamColumns, refreshTaskColumn, refreshAllColumns } from '../views/columns.js';
import { renderOutline } from '../views/outline.js';
import { emptyMsg } from '../views/render-helpers.js';
import type { ViewHandlers } from '../views/types.js';
import type { LedgerDrawer } from '../components/ledger-drawer.js';
import type { Item } from '../../shared/contract';

const drawer = (): LedgerDrawer => need<LedgerDrawer>('#drawer');

// The handler bundle the views receive. Defined once and passed down so a view
// never imports the controller (keeps the module graph acyclic).
export const handlers: ViewHandlers = {
  selectEpic,
  selectStory,
  openDrawer,
  toggleExpand,
};

// ---- load ----
// Load the roots and render. Roots are matching epics plus any orphan
// stories/tasks (matches belonging to no epic), split here by kind. Epics head
// the board; orphans render in below-the-fold lanes. Children load lazily.
export async function loadTree(): Promise<void> {
  showLoading(true);
  try {
    clearNodes();
    const roots = await fetchChildren(null);
    state.epics = roots.filter((n) => n.kind === 'epic');
    state.orphanStories = roots.filter((n) => n.kind === 'story');
    state.orphanTasks = roots.filter((n) => n.kind === 'task');
    if (!byId(state.selEpic)) { state.selEpic = state.epics[0]?.id || null; state.selStory = null; }
    render({ animate: true });
    // Warm the selected epic's children so the story/task columns aren't empty
    // on first paint; the render above already showed the epics.
    if (state.selEpic) { ensureChildren(byId(state.selEpic)).then(() => { if (state.lens === 'columns') refreshDownstreamColumns(handlers); }); }
  } catch (err) {
    const e = err as ApiError;
    // 422: the filter combination is intentionally unsupported (e.g. anyone +
    // all-projects is unbounded). Not an error — clear the board and prompt for
    // the missing choice, without the red error toast.
    if (e.status === 422) {
      state.epics = []; state.orphanStories = []; state.orphanTasks = [];
      state.selEpic = null; state.selStory = null;
      const stage = need('#stage');
      stage.querySelectorAll('.columns, .outline').forEach((n) => n.remove());
      const wrap = document.createElement('div'); wrap.className = 'columns';
      wrap.append(emptyMsg('Pick a project.', e.message));
      stage.append(wrap);
    } else {
      handleError(e);
    }
  } finally {
    showLoading(false);
  }
}

export function handleError(err: ApiError): void {
  // 401 means the active source rejected us as unauthenticated. The front end
  // knows nothing about how any source authenticates — it flags the identity as
  // stale and lets the plugin's own message (in the toast) tell the user how to
  // recover.
  if (err.status === 401) {
    $('#ident')?.classList.add('stale');
    const name = $('#ident-name'); if (name) name.textContent = 'session expired';
  }
  toast(err.message, true);
  need('#stage').querySelectorAll('.columns, .outline').forEach((n) => n.remove());
}

// ---- render dispatch ----
export function render({ animate = false }: { animate?: boolean } = {}): void {
  const stage = need('#stage');
  stage.querySelectorAll('.columns, .outline').forEach((n) => n.remove());
  stage.dataset.lens = state.lens;
  if (state.lens === 'columns') renderColumns(stage, animate, handlers);
  else renderOutline(stage, handlers);
}

// ---- selection (partial updates — no upstream teardown, no re-animation) ----
function selectEpic(id: string): void {
  if (state.selEpic === id) { const n = byId(id); if (n) openDrawer(n); return; } // re-click = read it
  state.selEpic = id; state.selStory = null;
  const cols = $('.columns'); if (!cols) return render();
  cols.querySelectorAll('ledger-column[data-tier="epic"] ledger-card').forEach((cd) => (cd as HTMLElement).toggleAttribute('selected', (cd as HTMLElement).dataset.id === id));
  refreshDownstreamColumns(handlers);
  const epic = byId(id);
  ensureChildren(epic).then(() => { if (state.selEpic === id) refreshDownstreamColumns(handlers); }).catch(handleError);
}
function selectStory(id: string): void {
  if (state.selStory === id) { const n = byId(id); if (n) openDrawer(n); return; }
  state.selStory = id;
  const cols = $('.columns'); if (!cols) return render();
  cols.querySelectorAll('ledger-column[data-tier="story"] ledger-card').forEach((cd) => (cd as HTMLElement).toggleAttribute('selected', (cd as HTMLElement).dataset.id === id));
  refreshTaskColumn(handlers);
  const story = byId(id);
  ensureChildren(story).then(() => { if (state.selStory === id) refreshTaskColumn(handlers); }).catch(handleError);
}

// Expand fetches children on first open (lazy); collapse just hides them. A
// re-render after the fetch resolves shows the loaded subtree.
function toggleExpand(node: CachedNode): void {
  if (state.expanded.has(node.id)) { state.expanded.delete(node.id); render(); return; }
  state.expanded.add(node.id);
  render();
  if (!node.loaded) ensureChildren(node).then(() => { if (state.expanded.has(node.id) && state.lens === 'outline') render(); }).catch(handleError);
}

// ---- drawer ----
function openDrawer(node: CachedNode): void { drawer().open(node); }

// Wire the drawer's injected host services once. The drawer stays
// transport-agnostic; the board hands it the api/fetch/caps/sfx/toast it needs
// and listens for item-changed to patch its cached node + card.
export function wireDrawer(): void {
  const d = drawer();
  d.api = api;
  d.caps = state.caps;
  d.sfx = sfx;
  d.toast = toast;
  d.fetchChildren = ensureChildren;
  d.addEventListener('item-changed', (e) => { if (e.detail?.item) patchNode(e.detail.item); });
}

// Merge an edited item back into the cached node and refresh what's visible. The
// node index holds the one instance every view renders from, so a single
// Object.assign updates the board; children/loaded are preserved (the edit
// response carries item fields, not the lazily-loaded child list).
function patchNode(item: Item): void {
  const node = byId(item.id);
  if (node) Object.assign(node, item);
  if (state.lens === 'columns') refreshAllColumns(handlers);
  else render();
}
