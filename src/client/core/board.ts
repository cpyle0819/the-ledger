// The board controller: orchestration for the two lenses. It owns the load →
// render → select → patch cycle and the drawer glue, implementing the handler
// contract the views call back into. Rendering lives in the view modules; data
// access in api.js; this module is the conductor between them.
//
// A full render only happens on data load / filter / lens change. Selecting a
// card does a PARTIAL update (selectEpic/selectStory swap only the downstream
// columns) so upstream columns never tear down and re-animate — that was the
// "everything blinks" bug.

import { state, byId, indexNodes, clearNodes, parentOf, type CachedNode } from './state.js';
import { api, fetchChildren, fetchNodesRaw, ensureChildren, fetchChildrenAllStatus, fetchEpicCounts, type ApiError } from './api.js';
import { parseHash, writeHash, type UrlState } from './url.js';
import { sfx } from './sound.js';
import { $, need } from '../ui/dom.js';
import { toast, showLoading } from '../ui/feedback.js';
import { renderColumns, refreshDownstreamColumns, refreshTaskColumn, refreshAllColumns, refreshEpicColumn } from '../views/columns.js';
import { renderOutline } from '../views/outline.js';
import { emptyMsg } from '../views/render-helpers.js';
import type { ViewHandlers, AddRequest } from '../views/types.js';
import type { LedgerDrawer } from '../components/ledger-drawer.js';
import type { LedgerCompose, ComposeAncestor } from '../components/ledger-compose.js';
import type { Item, EpicVelocity } from '../../shared/contract';

const drawer = (): LedgerDrawer => need<LedgerDrawer>('#drawer');
const compose = (): LedgerCompose => need<LedgerCompose>('#compose');

// The item the drawer is currently showing (null when closed) — the one piece of
// view state that doesn't live on `state`, so the URL sync reads it from here.
let openItemId: string | null = null;
// True when the open drawer added its own history entry (a user opened it), so a
// user-driven close pops that entry (Back-closes-the-drawer). A drawer opened by
// restoring a link has no entry of its own; closing it replaces the URL instead.
let drawerPushed = false;
// Set while closing the drawer in response to popstate, so the drawer's own
// close event doesn't try to move history again (which would double-navigate).
let closingFromPop = false;

/** Reflect the live filter/selection state plus the open item into the URL hash.
 *  Selection and filters replace the current entry; opening the drawer pushes one. */
export function syncUrl(push = false): void { writeHash(openItemId, push); }

// The handler bundle the views receive. Defined once and passed down so a view
// never imports the controller (keeps the module graph acyclic).
export const handlers: ViewHandlers = {
  selectEpic,
  selectStory,
  openDrawer,
  toggleExpand,
  addItem,
};

// ---- load ----
// Each loadTree bumps this generation token. Any async continuation kicked off by
// a load (the selection warm, the count rollup) or by the background poll captures
// the current value and bails if it changed — so a fetch issued under one filter
// can't paint stale results after a newer load (e.g. the show/hide-closed toggle
// reloading while a prior fetch is still in flight). `loadInFlight` lets the poll
// skip entirely while a load is running.
let loadGen = 0;
let loadInFlight = false;

// Load the roots and render. Roots are matching epics plus any orphan
// stories/tasks (matches belonging to no epic), split here by kind. Epics head
// the board; orphans render in below-the-fold lanes. Children load lazily.
export async function loadTree(): Promise<void> {
  const gen = ++loadGen;
  loadInFlight = true;
  showLoading(true);
  try {
    clearNodes();
    const roots = await fetchChildren(null);
    if (gen !== loadGen) return;                  // a newer load superseded this one
    state.epics = roots.filter((n) => n.kind === 'epic');
    state.orphanStories = roots.filter((n) => n.kind === 'story');
    state.orphanTasks = roots.filter((n) => n.kind === 'task');
    if (!byId(state.selEpic)) { state.selEpic = state.epics[0]?.id || null; state.selStory = null; }
    // The tree just settled the selection (the linked epic, or the first epic as
    // the default). Reflect it so even an unlinked load carries its selection in
    // the URL, and a link whose epic the current filters exclude corrects to what
    // actually rendered.
    syncUrl();
    render({ animate: true });
    // Warm the selected epic's children (and, if a story is selected, its tasks)
    // so the story/task columns aren't left empty or stuck "Loading…" on first
    // paint; the render above already showed the epics.
    void warmSelection(gen);
    // Roll up each epic's story/task counts after first paint (the cards show the
    // raw child count until these land). Fire-and-forget: a rollup failure leaves
    // the fallback badge, never the loading state.
    warmEpicCounts(state.epics.map((e) => e.id));
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
    if (gen === loadGen) loadInFlight = false;
    showLoading(false);
  }
}

// Warm the columns lens's downstream data after a load: the selected epic's
// children, then — if a story is selected — that story's tasks, so neither column
// is left empty or stuck in its "Loading…" placeholder. Each await re-checks the
// load generation so a filter change mid-warm can't repaint the superseded tree.
async function warmSelection(gen: number): Promise<void> {
  if (state.lens !== 'columns' || !state.selEpic) return;
  const epic = byId(state.selEpic);
  if (epic && !epic.loaded) await ensureChildren(epic).catch(() => []);
  if (gen !== loadGen) return;
  const story = state.selStory ? byId(state.selStory) : null;
  if (story && !story.loaded) await ensureChildren(story).catch(() => []);
  if (gen !== loadGen) return;
  if (state.lens === 'columns') refreshDownstreamColumns(handlers);
}

// Fetch story/task rollups for the given epics and fold them onto the cached
// nodes, then repaint the epics so the cards swap "N within" for "N stories · N
// tasks". Gated by the source capability; a source without it just keeps the raw
// badge. Best-effort — a fetch failure is swallowed so the fallback badge stays.
// Guarded against a filter change landing mid-flight: the counts are computed for
// the filters at call time, so a stale response is dropped if the epic set moved.
async function warmEpicCounts(epicIds: string[]): Promise<void> {
  if (!state.caps.epicCounts || !epicIds.length) return;
  const wanted = new Set(epicIds);
  let counts: Record<string, import('../../shared/contract').EpicCounts>;
  try { counts = await fetchEpicCounts(epicIds); }
  catch { return; }
  // Drop a response whose epics no longer match the board (a filter change
  // reloaded the tree while this was in flight).
  if (state.epics.length && !state.epics.some((e) => wanted.has(e.id))) return;
  let any = false;
  for (const [id, c] of Object.entries(counts)) {
    const node = byId(id);
    if (node) { node.counts = c; any = true; }
  }
  if (!any) return;
  if (state.lens === 'columns') refreshEpicColumn(handlers);
  else render();
}

// ---- deep linking: hydrate on load, restore after load, follow Back/Forward ----

// Fold the URL hash into `state` before the tree loads, so the tree is fetched
// through the linked filters (the filter context is what makes the linked
// selection visible — restore it first or byId can't find the selected node).
// Selection/expansion are set here too; loadTree and restoreFromUrl consume them.
// Returns the parsed state so the caller can restore the drawer + sync controls.
export function hydrateStateFromUrl(): UrlState {
  const u = parseHash();
  if (u.lens) state.lens = u.lens;
  state.assignee = u.assignee ?? '';
  if (u.status) state.status = u.status;
  state.project = u.project ?? null;
  state.selEpic = u.epic ?? null;
  state.selStory = u.story ?? null;
  state.expanded = new Set(u.expanded ?? []);
  return u;
}

// Restore what loadTree can't on its own: the outline's expanded subtrees (their
// children load lazily) and the open drawer. Runs once after the initial load.
export async function restoreFromUrl(u: UrlState): Promise<void> {
  if (state.lens === 'outline' && state.expanded.size) await loadExpandedSubtrees();
  // Columns: a restored selected story's tasks load lazily. The story is a child
  // of the selected epic, so its node only exists once the epic's children load —
  // loadTree kicks that off but doesn't await it. Load the epic's children FIRST
  // (coalesced with loadTree's warm via _loading, so it's one fetch), then the
  // story's, so byId(selStory) resolves and the task column leaves its loading
  // state. Skipping this leaves the story's tasks stuck "Loading…" forever.
  if (state.lens === 'columns' && state.selStory) {
    const epic = byId(state.selEpic);
    if (epic && !epic.loaded) await ensureChildren(epic).catch(() => []);
    const story = byId(state.selStory);
    if (story && !story.loaded) await ensureChildren(story).catch(() => []);
    if (state.lens === 'columns') refreshTaskColumn(handlers);
  }
  if (u.item) await reopenItem(u.item);
}

// Load children for every expanded outline row, deepest-first by iteration: a row
// can only be expanded once its parent's children are cached, so repeat until a
// pass loads nothing new (a bounded walk down the expanded chain).
async function loadExpandedSubtrees(): Promise<void> {
  for (let guard = 0; guard < 20; guard++) {
    const pending = [...state.expanded].map(byId).filter((n): n is CachedNode => !!n && !n.loaded);
    if (!pending.length) break;
    await Promise.all(pending.map((n) => ensureChildren(n).catch(() => [])));
  }
  if (state.lens === 'outline') render();
}

// Reopen the linked item. Prefer the cached node (the tree load usually holds it);
// otherwise read it from the source so a deep link to an off-screen item still
// opens. A read failure is non-fatal — the board still shows, just without the
// drawer.
async function reopenItem(id: string): Promise<void> {
  let node = byId(id);
  if (!node) {
    try { const { item } = await api<{ item: Item }>(`/api/item/${id}`); indexNodes([item as CachedNode]); node = byId(id) || (item as CachedNode); }
    catch { return; }
  }
  openItemId = id;
  drawer().open(node);
  // Opened from a link the URL already carries — don't push a second entry.
  drawerPushed = false;
}

// Follow Back/Forward: re-read the hash and move the board to match it. A filter
// change reloads the tree (the visible set differs); otherwise selection and the
// drawer are reconciled in place. The drawer close here is flagged so it doesn't
// push history back (popstate already moved it).
export function wireDeepLinkNav(): void {
  window.addEventListener('popstate', () => {
    const u = parseHash();
    const filtersDiffer = (u.lens ?? 'columns') !== state.lens
      || (u.assignee ?? '') !== state.assignee
      || (u.status ?? 'Open') !== state.status
      || (u.project ?? null) !== state.project;
    if (filtersDiffer) {
      hydrateStateFromUrl();
      loadTree().then(() => restoreFromUrl(u));
      return;
    }
    // Same filters: reconcile selection, expansion, and the drawer in place.
    state.selEpic = u.epic ?? null;
    state.selStory = u.story ?? null;
    state.expanded = new Set(u.expanded ?? []);
    if (state.lens === 'columns') refreshAllColumns(handlers); else render();
    if (state.lens === 'outline' && state.expanded.size) loadExpandedSubtrees();
    reconcileDrawerWithUrl(u.item ?? null);
  });
}

// Open, switch, or close the drawer to match the URL's item after a Back/Forward.
// Closing is flagged (closingFromPop) so the drawer's close handler doesn't move
// history a second time.
function reconcileDrawerWithUrl(item: string | null): void {
  if (item === openItemId) return;
  if (!item) {
    closingFromPop = true;
    drawer().close();
    closingFromPop = false;
    openItemId = null;
    return;
  }
  reopenItem(item);
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
  // Re-clicking the selected epic deselects it (its children columns clear);
  // reading details is the card's separate "view details" affordance. Clearing
  // the epic also clears any story selection under it.
  if (state.selEpic === id) {
    state.selEpic = null; state.selStory = null;
    syncUrl();
    const cols = $('.columns'); if (!cols) return render();
    cols.querySelectorAll('ledger-column[data-tier="epic"] ledger-card').forEach((cd) => (cd as HTMLElement).removeAttribute('selected'));
    refreshDownstreamColumns(handlers);
    return;
  }
  state.selEpic = id; state.selStory = null;
  syncUrl();
  const cols = $('.columns'); if (!cols) return render();
  cols.querySelectorAll('ledger-column[data-tier="epic"] ledger-card').forEach((cd) => (cd as HTMLElement).toggleAttribute('selected', (cd as HTMLElement).dataset.id === id));
  refreshDownstreamColumns(handlers);
  const epic = byId(id);
  ensureChildren(epic).then(() => { if (state.selEpic === id) refreshDownstreamColumns(handlers); }).catch(handleError);
}
function selectStory(id: string): void {
  // Re-clicking the selected story deselects it (the task column falls back to
  // the epic's direct tasks); "view details" opens the drawer instead.
  if (state.selStory === id) {
    state.selStory = null;
    syncUrl();
    const cols = $('.columns'); if (!cols) return render();
    cols.querySelectorAll('ledger-column[data-tier="story"] ledger-card').forEach((cd) => (cd as HTMLElement).removeAttribute('selected'));
    refreshTaskColumn(handlers);
    return;
  }
  state.selStory = id;
  syncUrl();
  const cols = $('.columns'); if (!cols) return render();
  cols.querySelectorAll('ledger-column[data-tier="story"] ledger-card').forEach((cd) => (cd as HTMLElement).toggleAttribute('selected', (cd as HTMLElement).dataset.id === id));
  refreshTaskColumn(handlers);
  const story = byId(id);
  ensureChildren(story).then(() => { if (state.selStory === id) refreshTaskColumn(handlers); }).catch(handleError);
}

// Expand fetches children on first open (lazy); collapse just hides them. A
// re-render after the fetch resolves shows the loaded subtree.
function toggleExpand(node: CachedNode): void {
  if (state.expanded.has(node.id)) { state.expanded.delete(node.id); syncUrl(); render(); return; }
  state.expanded.add(node.id);
  syncUrl();
  render();
  if (!node.loaded) ensureChildren(node).then(() => { if (state.expanded.has(node.id) && state.lens === 'outline') render(); }).catch(handleError);
}

// ---- drawer ----
// Opening the drawer records the open item and pushes a history entry, so Back
// closes it and a refresh reopens it. Reopening the already-open item (or opening
// while restoring a link, which sets the URL itself) doesn't push a duplicate.
function openDrawer(node: CachedNode): void {
  const alreadyOpen = openItemId === node.id && drawer().hasAttribute('open');
  openItemId = node.id;
  drawer().open(node);
  if (!alreadyOpen) { syncUrl(true); drawerPushed = true; }
}

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
  // Planning measures capacity against the full decomposition, so it needs every
  // child regardless of status. When the board itself is already showing ALL, the
  // cached children are the full set — reuse them (no extra fetch); otherwise
  // fetch all-status separately without disturbing the filtered cache.
  d.planningChildren = (node) => (state.status === 'ALL'
    ? ensureChildren(node as CachedNode)
    : fetchChildrenAllStatus(node.id));
  // Points-per-day velocity for an epic, computed by the source over its whole
  // task tree. Always wired (caps load AFTER wireDrawer runs, so gating here would
  // bake in a stale null); the drawer gates the actual call on its own
  // epicVelocity capability. Historical over completed work, so it takes no filters.
  d.epicVelocity = (epicId) =>
    api<{ velocity: EpicVelocity }>(`/api/velocity?epic=${encodeURIComponent(epicId)}`).then((r) => r.velocity);
  d.addEventListener('item-changed', (e) => { if (e.detail?.item) patchNode(e.detail.item); });
  // The drawer closed. Forget the open item and take it out of the URL. A drawer
  // the user opened pushed a history entry, so a user-driven close pops it (Back's
  // job, done for the ✕/scrim/Esc paths too); one opened by restoring a link had
  // no entry, so its URL is just replaced. A close triggered by popstate already
  // moved history — skip both and only clear the id.
  d.addEventListener('drawer-closed', () => {
    openItemId = null;
    if (closingFromPop) return;
    if (drawerPushed) { drawerPushed = false; history.back(); }
    else syncUrl();
  });
  // A per-section "Add <tier>" in the drawer opens the compose sheet with the open
  // item as the fixed parent. The full ancestor chain is resolved from the cache
  // (the drawer's item is cached); if it somehow isn't, the event's own parent
  // fields still give a single-row chain, so the mini-outline never comes up bare.
  d.addEventListener('item-add-child', (e) => {
    if (!state.caps.create) return;
    const { type, parentId, parentName, parentShortId, parentUrl, parentType, project } = e.detail;
    const cached = byId(parentId);
    const ancestors = cached
      ? ancestorChain(cached)
      : [{ type: parentType || '', shortId: parentShortId || parentId, url: parentUrl, title: parentName }];
    compose().open({ type, parentId, ancestors, project });
  });
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

// ---- compose (create) ----
// Wire the compose sheet's injected services once (parallel to wireDrawer) and
// listen for item-created to drop the new item into the tree without a reload.
export function wireCompose(): void {
  const c = compose();
  c.api = api;
  c.caps = state.caps;
  c.sfx = sfx;
  c.toast = toast;
  c.addEventListener('item-created', (e) => { if (e.detail?.item) insertNode(e.detail.item, e.detail.input?.parent ?? null); });
}

// Open the compose sheet for a new item of a fixed tier under a fixed parent,
// decided by the add affordance that fired (a column "+", a drawer section). The
// parent is shown read-only by name; a child inherits the parent's project, a
// root defaults to the board's current project scope.
function addItem(req: AddRequest): void {
  if (!state.caps.create) return;
  const parent = req.parentNode;
  compose().open({
    type: req.type,
    parentId: parent?.id ?? null,
    ancestors: parent ? ancestorChain(parent) : [],
    project: parent ? (parent.project ?? null) : state.project,
  });
}

// The new item's ancestor path for the compose mini-outline: from the given
// parent up to the epic, returned top-down (epic first). Nodes carry no parent
// pointer, so parentOf scans the cache; the walk stops at a root or an
// uncached parent, and a cycle guard bounds it defensively.
export function ancestorChain(parent: CachedNode): ComposeAncestor[] {
  const chain: ComposeAncestor[] = [];
  const seen = new Set<string>();
  let node: CachedNode | null = parent;
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    chain.unshift({ type: node.type, shortId: node.shortId, url: node.url ?? null, title: node.title });
    node = parentOf(node);
  }
  return chain;
}

// Place a newly created item into the tree without a full reload. The created
// item is indexed, then attached to its parent's loaded children (or a root
// lane); the affected columns/outline are rebuilt the same way patchNode does
// after an edit, and the new item is selected/expanded so it's visible.
function insertNode(item: Item, parentId: string | null): void {
  const node = item as CachedNode;
  indexNodes([node]);

  const parent = parentId ? byId(parentId) : null;
  if (parent) {
    // Attach under the parent only when its children are already loaded; an
    // unloaded parent picks the item up on its next lazy fetch, so avoid seeding
    // a partial child list that would suppress that fetch.
    if (parent.loaded) {
      parent.children = parent.children || [];
      if (!parent.children.some((c) => c.id === node.id)) parent.children.push(node);
    }
    parent.childCount = (parent.childCount || 0) + 1;
    // Reveal the new item: select the lane it lands in. A task under a story
    // selects that story; a story under an epic selects that epic. (Nodes carry
    // no parent pointer, so selection keys off the immediate parent's kind.)
    if (node.kind === 'task' && parent.kind === 'story') state.selStory = parent.id;
    else if (node.kind === 'story' && parent.kind === 'epic') state.selEpic = parent.id;
    state.expanded.add(parent.id);
  } else {
    // A root: goes in the matching lane (epic, or the orphan story/task lanes).
    const lane = node.kind === 'epic' ? state.epics : node.kind === 'story' ? state.orphanStories : state.orphanTasks;
    if (!lane.some((n) => n.id === node.id)) lane.push(node);
    if (node.kind === 'epic') state.selEpic = node.id;
  }

  if (state.lens === 'columns') refreshAllColumns(handlers);
  else render();
  toast(`Created ${item.type} ${item.shortId}`);
}

// ---- reconcile (background poll for out-of-Ledger changes) ----
// A source's items can change outside The Ledger (someone edits the same ticket
// elsewhere). reconcile re-reads what's currently on screen and folds changes in
// WITHOUT a full reload: it re-fetches the roots and every loaded/expanded/
// selected parent, merges fresh fields into the existing cached node instances
// (so selection, expansion, and loaded children survive), adds newly-appeared
// nodes, drops removed ones, and re-renders only when something actually changed.
// The open drawer is intentionally left untouched: repainting it would discard an
// in-progress description edit. It shares the cached instance, so its data stays
// current underneath and shows on the next open.

// The fields a card/row renders; a change in any is worth reflecting. Joined into
// a signature so a whole level's freshness is one comparison.
function nodeSig(n: CachedNode): string {
  return [n.title, n.status, n.assignee, n.project, n.estimate, n.workflowAction, n.childCount, n.context ? 1 : 0].join('');
}

// Merge a freshly-fetched sibling list into the cached list for a parent (or the
// root lanes). Returns true if anything changed (fields, additions, removals, or
// order). Existing instances are mutated in place so every view and the drawer
// keep rendering from the one object per id.
function mergeLevel(existing: CachedNode[], fresh: CachedNode[]): { list: CachedNode[]; changed: boolean } {
  let changed = existing.length !== fresh.length;
  const byIdOld = new Map(existing.map((n) => [n.id, n]));
  const list = fresh.map((f, i) => {
    const old = byIdOld.get(f.id);
    if (!old) { changed = true; indexNodes([f]); return f; }
    if (nodeSig(old) !== nodeSig(f) || existing[i]?.id !== f.id) changed = true;
    // Merge the fresh list-node fields onto the cached instance, preserving its
    // lazily-loaded children/loaded bookkeeping (the list node carries neither).
    const { children, loaded, _loading, ...fields } = old as CachedNode;
    Object.assign(old, f, { children, loaded, _loading });
    return old;
  });
  return { list, changed };
}

let reconciling = false;

export async function reconcile(): Promise<void> {
  if (reconciling) return;                       // drop overlapping polls
  if (loadInFlight) return;                       // a full load is mid-flight; let it win
  if (!state.epics.length && !state.orphanStories.length && !state.orphanTasks.length) return; // nothing loaded yet
  // Capture the load generation: if a loadTree (e.g. a filter toggle) runs while
  // this poll's fetches are outstanding, the fetched nodes describe the OLD filter
  // and must not be merged in — that's what flashed closed items back onto a board
  // that had just hidden them. Bail before painting if the generation moved.
  const gen = loadGen;
  reconciling = true;
  try {
    let changed = false;

    // Roots first (epics + orphan stories/tasks), split like loadTree does.
    const roots = await fetchNodesRaw(null);
    if (gen !== loadGen) return;                  // a load superseded this poll
    const freshEpics = roots.filter((n) => n.kind === 'epic');
    const freshOStories = roots.filter((n) => n.kind === 'story');
    const freshOTasks = roots.filter((n) => n.kind === 'task');
    const e = mergeLevel(state.epics, freshEpics); state.epics = e.list; changed ||= e.changed;
    const os = mergeLevel(state.orphanStories, freshOStories); state.orphanStories = os.list; changed ||= os.changed;
    const ot = mergeLevel(state.orphanTasks, freshOTasks); state.orphanTasks = ot.list; changed ||= ot.changed;

    // Then every loaded parent that's currently shown: the selected epic/story
    // (columns) and every expanded node (outline). Re-fetching these keeps the
    // visible subtrees fresh and surfaces children added elsewhere.
    const parentIds = new Set<string>();
    if (state.selEpic) parentIds.add(state.selEpic);
    if (state.selStory) parentIds.add(state.selStory);
    for (const id of state.expanded) parentIds.add(id);
    for (const id of parentIds) {
      const parent = byId(id);
      if (!parent || !parent.loaded) continue;
      const fresh = await fetchNodesRaw(id);
      if (gen !== loadGen) return;                 // a load superseded this poll
      const m = mergeLevel(parent.children || [], fresh);
      parent.children = m.list; changed ||= m.changed;
    }

    if (gen !== loadGen) return;                    // a load superseded this poll
    if (changed) {
      // Drop cache entries no longer reachable so byId can't resurrect stale nodes.
      if (state.selEpic && !byId(state.selEpic)) { state.selEpic = state.epics[0]?.id || null; state.selStory = null; }
      if (state.lens === 'columns') refreshAllColumns(handlers);
      else {
        // Outline scrolls the stage; preserve its position across the re-render.
        const stage = need('#stage'); const top = stage.scrollTop;
        render(); stage.scrollTop = top;
      }
    }
  } catch { /* a failed poll is a no-op; the next one retries */ }
  finally { reconciling = false; }
}
