'use strict';

// The Ledger — client. Talks only to the local host (never to a source backend
// directly; credentials stay server-side). The host is plugin-agnostic: the
// client reads /api/source once for the active source's identity + capabilities,
// then hides actions the source doesn't support. The Epic -> Story -> Task
// hierarchy is the app's spine and loads lazily — /api/children returns the roots
// (epics) with no `parent`, or a node's children with one; the full item (with
// description and comments) is fetched from /api/item/:id when a drawer opens.
//
// The UI is a composition of custom elements (public/components): <ledger-card>,
// <ledger-column>, <ledger-comment-thread>, and <ledger-drawer> each render in
// their own shadow DOM; this module defines the <ledger-board> root element that
// owns the model and orchestration and wires the others together. Importing a
// component module registers its element as a side effect.

import './components/ledger-card.js';
import './components/ledger-column.js';
import './components/ledger-drawer.js';

const state = {
  assignee: '',          // '' = me, 'anyone', or an alias
  status: 'Open',
  project: null,         // null = every project; else a source project id
  lens: 'columns',
  me: null,
  caps: {},              // active source capabilities (from /api/source)
  epics: [],             // root nodes of kind epic
  orphanStories: [],     // root nodes of kind story (belong to no epic)
  orphanTasks: [],       // root nodes of kind task (belong to no parent)
  selEpic: null,         // id
  selStory: null,        // id
  expanded: new Set(),   // outline: ids whose children are shown
};

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
// Make a non-button element behave like one for keyboard users: role, tab stop,
// and Enter/Space activation mirroring its click handler.
const asButton = (node, onActivate, label) => {
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  if (label) node.setAttribute('aria-label', label);
  node.onclick = onActivate;
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(e); }
  });
  return node;
};

// Copy an item's source link to the clipboard, with brief button feedback. The
// link is supplied by the source (item.url); the app builds no source URL itself.
async function copyLink(shortId, url, btn) {
  // execCommand fallback for when the async Clipboard API is missing OR rejects
  // (e.g. permission denied, non-secure context).
  const legacyCopy = () => {
    const ta = el('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    if (!ok) throw new Error('copy command rejected');
  };
  try {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(url); }
      catch { legacyCopy(); } // Clipboard API present but blocked — fall back
    } else legacyCopy();
    if (btn) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1200); }
    toast(`Link copied · ${shortId}`);
  } catch { toast('Could not copy link', true); }
}

// Render "№ <shortId>", followed by a copy-link button when the item carries a
// source-supplied `url`. Used everywhere a ticket number appears.
function idTag(shortId, url, extraCls = '') {
  const wrap = el('span', `id-tag ${extraCls}`.trim());
  wrap.append(el('span', 'card-id', `№ ${shortId}`));
  if (!url) return wrap;   // no link when the source doesn't provide one
  const btn = el('button', 'copy-link');
  btn.type = 'button';
  btn.setAttribute('aria-label', `Copy link to ${shortId}`);
  btn.title = 'Copy link';
  btn.innerHTML = '<span class="copy-icon" aria-hidden="true">⧉</span>';
  btn.onclick = (ev) => { ev.stopPropagation(); ev.preventDefault(); copyLink(shortId, url, btn); };
  // Don't let keyboard activation bubble to a parent row's Enter/Space handler.
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); });
  wrap.append(btn);
  return wrap;
}
// Every node the client has fetched, by id. The hierarchy is loaded lazily —
// roots first, a node's children only when it's opened or expanded — so there is
// no full tree to walk; this index is the single source of truth for lookup.
const nodeIndex = new Map(); // id -> node
const indexNodes = (nodes) => { for (const n of nodes) if (!nodeIndex.has(n.id)) nodeIndex.set(n.id, n); };
const byId = (id) => nodeIndex.get(id) || null;

// An epic's children arrive as one list (stories, then the tasks parented
// directly on the epic); split by kind. A story's children are all tasks.
const storiesOf = (node) => (node?.children || []).filter((n) => n.kind === 'story');
const directTasksOf = (node) => (node?.children || []).filter((n) => n.kind !== 'story');

// Fetch a node's children (or the roots when node is null) and cache them on the
// node. Children are cheap list nodes; the full item is fetched when a drawer
// opens. A node keeps `children` + `loaded` so a re-open doesn't refetch.
async function fetchChildren(node) {
  const q = new URLSearchParams({ status: state.status });
  if (state.assignee) q.set('assignee', state.assignee);
  if (state.project) q.set('project', state.project);
  if (node) q.set('parent', node.id);
  const { nodes } = await api(`/api/children?${q}`);
  indexNodes(nodes);
  if (node) { node.children = nodes; node.loaded = true; }
  return nodes;
}

// Load a node's children once, coalescing concurrent callers onto one request.
async function ensureChildren(node) {
  if (!node || node.loaded) return node?.children || [];
  if (!node._loading) node._loading = fetchChildren(node).finally(() => { node._loading = null; });
  await node._loading;
  return node.children || [];
}

// ---- sound ----
// Two short foley cues, public-domain (Wikimedia Commons): a page turn when a
// record opens, a quill scratch when an edit saves. Audio is lazy — the browser
// blocks playback until the first user gesture, so we don't preload aggressively
// and we swallow the autoplay rejection silently (a muted cue is never an error
// worth surfacing). The quill clip is long; we clip it to a brief scratch.
const sfx = (() => {
  const make = (src, { volume = 0.55, startAt = 0, maxMs = 0 } = {}) => {
    const base = new Audio(src);
    base.preload = 'auto';
    // Seeking currentTime on a reused element AFTER it has `ended` races with
    // play() (Chrome resets to 0) — so play a FRESH clone each time. The clone
    // shares the buffered resource (no re-download); we just wait for its
    // metadata before seeking to the start offset.
    const start = (a) => {
      a.volume = volume;
      try { a.currentTime = startAt; } catch { /* seek not ready — plays from 0 */ }
      const p = a.play();
      if (p) p.catch(() => {}); // autoplay blocked until first gesture — fine
      if (maxMs) setTimeout(() => { a.pause(); }, maxMs);
    };
    return () => {
      try {
        const a = base.cloneNode();
        if (a.readyState >= 1) start(a); // HAVE_METADATA — safe to seek now
        else a.addEventListener('loadedmetadata', () => start(a), { once: true });
      } catch { /* no audio support — silent */ }
    };
  };
  return {
    // The page-turn recording has ~1.7s of lead-in before the actual turn.
    pageTurn: make('/sounds/page-turn.ogg', { volume: 0.5, startAt: 1.7 }),
    quill: make('/sounds/quill.ogg', { volume: 0.45, maxMs: 1400 }),
  };
})();

// ---- data ----
async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok || data.error) {
    // Carry the HTTP status so callers can react to the transport-level outcome
    // (e.g. 401 = not authenticated) without parsing the plugin's message text.
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  }
  return data;
}

// Load the roots and render. Roots are no longer all epics: the source returns
// matching epics plus any orphan stories/tasks (matches that belong to no epic),
// split here by kind. Epics head the board; orphans render in below-the-fold
// lanes in the story/task columns. Children load lazily on select/expand.
async function loadTree() {
  showLoading(true);
  try {
    nodeIndex.clear();
    const roots = await fetchChildren(null);
    state.epics = roots.filter((n) => n.kind === 'epic');
    state.orphanStories = roots.filter((n) => n.kind === 'story');
    state.orphanTasks = roots.filter((n) => n.kind === 'task');
    if (!byId(state.selEpic)) { state.selEpic = state.epics[0]?.id || null; state.selStory = null; }
    render({ animate: true });
    // Warm the selected epic's children so the story/task columns aren't empty
    // on first paint; the render above already showed the epics.
    if (state.selEpic) { ensureChildren(byId(state.selEpic)).then(() => { if (state.lens === 'columns') refreshDownstreamColumns(); }); }
  } catch (err) {
    // 422: the filter combination is intentionally unsupported (e.g. anyone +
    // all-projects is unbounded). Not an error — clear the board and prompt for
    // the missing choice, without the red error toast.
    if (err.status === 422) {
      state.epics = []; state.orphanStories = []; state.orphanTasks = [];
      state.selEpic = null; state.selStory = null;
      const stage = $('#stage');
      stage.querySelectorAll('.columns, .outline').forEach((n) => n.remove());
      const wrap = el('div', 'columns');
      wrap.append(emptyMsg('Pick a project.', err.message));
      stage.append(wrap);
    } else {
      handleError(err);
    }
  } finally {
    showLoading(false);
  }
}

// Populate the project picker from the source, when it supports projects. A
// failure here is non-fatal: the picker stays hidden and the board shows every
// project (the unscoped default), so a rooms-endpoint hiccup can't block the tree.
async function loadProjects() {
  if (!state.caps.projects) return;
  try {
    const { projects } = await api('/api/projects');
    if (!projects?.length) return;
    const sel = $('#project-select');
    for (const p of projects) {
      const opt = el('option'); opt.value = p.id; opt.textContent = p.name;
      sel.append(opt);
    }
    sel.value = state.project || '';
    $('#project-ctl').hidden = false;
  } catch { /* leave the picker hidden; the board stays unscoped */ }
}

function handleError(err) {
  // 401 means the active source rejected us as unauthenticated. The front end
  // knows nothing about how any source authenticates — it flags the identity as
  // stale and lets the plugin's own message (in the toast) tell the user how to
  // recover.
  if (err.status === 401) {
    $('#ident').classList.add('stale');
    $('#ident-name').textContent = 'session expired';
  }
  toast(err.message, true);
  $('#stage').querySelectorAll('.columns, .outline').forEach((n) => n.remove());
}

// ---- render dispatch ----
// A full render only happens on data load / filter / lens change. Selecting a
// card does a PARTIAL update (see selectEpic/selectStory) so upstream columns
// never tear down and re-animate — that was the "everything blinks" bug.
function render({ animate = false } = {}) {
  const stage = $('#stage');
  stage.querySelectorAll('.columns, .outline').forEach((n) => n.remove());
  stage.dataset.lens = state.lens;
  if (state.lens === 'columns') renderColumns(stage, animate);
  else renderOutline(stage);
}

// ---- card factory ----
// A <ledger-card> custom element (public/components/ledger-card.js) renders the
// parchment slip in its own shadow DOM. This wires one to an item and to its
// activation handlers: `onActivate` fires on the primary click (drill into
// children), `onOpen` on the "view details" affordance / a leaf card's click.
// The element emits composed `card-activate` / `card-open` events; we bind them
// per card here. dataset.id on the host lets selection-sync find cards by id.
function card(item, { drill = false, animate = false, onActivate, onOpen } = {}) {
  const c = document.createElement('ledger-card');
  c.dataset.id = item.id;
  if (drill) c.setAttribute('drill', '');
  if (animate) c.setAttribute('animate', '');
  c.item = item;
  if (onActivate) c.addEventListener('card-activate', () => onActivate(item));
  if (onOpen) c.addEventListener('card-open', () => onOpen(item));
  return c;
}

// ===== DRAWERS LENS =====
function renderColumns(stage, animate) {
  const wrap = el('div', 'columns');
  wrap.append(buildEpicCol(animate).col, buildStoryCol(animate).col, buildTaskCol(animate).col);
  stage.append(wrap);
}

function buildEpicCol(animate) {
  const c = column('epic', 'Epics', state.epics.length);
  if (!state.epics.length) c.body.append(emptyMsg('No epics.', 'Try changing your filters.'));
  state.epics.forEach((e) => {
    const cd = card(e, { drill: true, animate, onActivate: () => selectEpic(e.id), onOpen: openDrawer });
    if (e.id === state.selEpic) cd.setAttribute('selected', '');
    c.body.append(cd);
  });
  return c;
}

// Downstream columns depend on lazily-loaded children. When an epic/story is
// selected but its children haven't arrived, show a loading state; the fetch's
// completion swaps in the real column (see selectEpic/selectStory).
function buildStoryCol(animate) {
  const epic = byId(state.selEpic);
  const orphans = state.orphanStories;
  // The selected epic's stories head the column; orphan stories (belonging to no
  // epic) follow under a below-the-fold lane, shown regardless of selection.
  const storyCard = (s) => {
    const cd = card(s, { drill: true, animate, onActivate: () => selectStory(s.id), onOpen: openDrawer });
    if (s.id === state.selStory) cd.setAttribute('selected', '');
    return cd;
  };
  const appendOrphans = (c) => {
    if (!orphans.length) return;
    c.body.append(laneLabel(`stories not in an epic · ${orphans.length}`, true));
    orphans.forEach((s) => c.body.append(storyCard(s)));
  };

  if (!epic) {
    const c = column('story', 'Stories', orphans.length);
    if (orphans.length) appendOrphans(c);
    // No selected epic here means no epics exist (the first loads selected), so
    // this is an empty state, not a "pick one" prompt.
    else c.body.append(emptyMsg('No stories.', 'Try changing your filters.'));
    return c;
  }
  if (!epic.loaded) {
    const c = column('story', 'Stories', orphans.length);
    c.body.append(hint('Loading', 'stories…'));
    appendOrphans(c);
    return c;
  }
  const stories = storiesOf(epic);
  const c = column('story', 'Stories', stories.length + orphans.length);
  if (stories.length) stories.forEach((s) => c.body.append(storyCard(s)));
  else if (!orphans.length) c.body.append(emptyMsg('No stories.', 'This epic has no stories.'));
  appendOrphans(c);
  return c;
}

// The tasks column holds both the selected story's tasks and the tasks parented
// directly on the epic. Story tasks come first; the epic's direct tasks follow
// under their own divider, so they're always visible (even with no story
// selected) but never confused with the story's own tasks. A story's tasks are
// lazily loaded, so a selected-but-unloaded story shows a loading state.
function buildTaskCol(animate) {
  const epic = byId(state.selEpic);
  const orphans = state.orphanTasks;
  const addTask = (c, t) => { c.body.append(card(t, { animate, onOpen: openDrawer })); };
  const appendOrphans = (c) => {
    if (!orphans.length) return;
    c.body.append(laneLabel(`tasks not in an epic · ${orphans.length}`, true));
    orphans.forEach((t) => addTask(c, t));
  };

  if (!epic) {
    const c = column('task', 'Tasks', orphans.length);
    if (orphans.length) appendOrphans(c);
    // No selected epic means no epics exist (see buildStoryCol), so this is an
    // empty state, not a "pick one" prompt.
    else c.body.append(emptyMsg('No tasks.', 'Try changing your filters.'));
    return c;
  }
  if (!epic.loaded) {
    const c = column('task', 'Tasks', orphans.length);
    c.body.append(hint('Loading', 'tasks…'));
    appendOrphans(c);
    return c;
  }
  const story = storiesOf(epic).find((s) => s.id === state.selStory);
  const directTasks = directTasksOf(epic);
  const storyTasks = story ? (story.loaded ? story.children : null) : [];
  const total = (storyTasks?.length || 0) + directTasks.length + orphans.length;
  const c = column('task', 'Tasks', total);

  if (story && !story.loaded) c.body.append(hint('Loading', 'tasks…'));
  else if (storyTasks?.length) storyTasks.forEach((t) => addTask(c, t));
  if (directTasks.length) {
    c.body.append(laneLabel(`tasks directly on this epic · ${directTasks.length}`, true));
    directTasks.forEach((t) => addTask(c, t));
  }
  // Empty states: distinguish "story has none" from "nothing to select yet".
  // The orphan lane counts as content, so it suppresses both placeholders.
  if (story && story.loaded && !storyTasks.length && !directTasks.length && !orphans.length) c.body.append(emptyMsg('No tasks.', 'This story has none yet.'));
  else if (!story && !directTasks.length && !orphans.length) c.body.append(hint('Select a story', 'to see its tasks.'));
  appendOrphans(c);
  return c;
}

// Swap the story + task columns for the current selection state. Called after a
// selection changes and again once a lazy children fetch resolves.
function refreshDownstreamColumns() {
  const cols = $('.columns'); if (!cols) return;
  cols.children[1].replaceWith(buildStoryCol(false).col);
  cols.children[2].replaceWith(buildTaskCol(false).col);
}
function refreshTaskColumn() {
  const cols = $('.columns'); if (!cols) return;
  cols.children[2].replaceWith(buildTaskCol(false).col);
}

// Partial updates — no upstream teardown, no re-animation → no blink. Children
// load lazily: the columns render immediately (loading state if needed), and the
// fetch's completion swaps in the populated column.
function selectEpic(id) {
  if (state.selEpic === id) { openDrawer(byId(id)); return; } // re-click the active epic = read it
  state.selEpic = id; state.selStory = null;
  const cols = $('.columns'); if (!cols) return render();
  cols.querySelectorAll('ledger-column[data-tier="epic"] ledger-card').forEach((cd) => cd.toggleAttribute('selected', cd.dataset.id === id));
  refreshDownstreamColumns();
  const epic = byId(id);
  ensureChildren(epic).then(() => { if (state.selEpic === id) refreshDownstreamColumns(); }).catch(handleError);
}
function selectStory(id) {
  if (state.selStory === id) { openDrawer(byId(id)); return; }
  state.selStory = id;
  const cols = $('.columns'); if (!cols) return render();
  cols.querySelectorAll('ledger-column[data-tier="story"] ledger-card').forEach((cd) => cd.toggleAttribute('selected', cd.dataset.id === id));
  refreshTaskColumn();
  const story = byId(id);
  ensureChildren(story).then(() => { if (state.selStory === id) refreshTaskColumn(); }).catch(handleError);
}

// A <ledger-column> (public/components/ledger-column.js) renders the column
// chrome in its own shadow DOM and slots its light-DOM children into the body.
// Cards/hints/labels are appended as children (still light DOM), so `body` here
// is the element itself. `col` and `body` are the same node; both keys are kept
// so existing call sites (col-swaps, body.append) read naturally.
function column(tier, title, count) {
  const col = document.createElement('ledger-column');
  col.dataset.tier = tier;             // used by selection-sync queries
  col.setAttribute('tier', tier);
  col.setAttribute('heading', title);
  col.setAttribute('count', count);
  return { col, body: col };
}
function emptyMsg(a, b) { const d = el('div', 'col-empty'); d.append(el('div', null, a), el('div', null, b)); return d; }
function hint(a, b) { const d = el('div', 'col-hint'); d.innerHTML = `${a}<br>${b}`; return d; }
function laneLabel(text, direct) { return el('div', `lane-label${direct ? ' direct' : ''}`, text); }

// The assignee chip for an outline row. A context node (present only to hold a
// matching descendant) gets the distinct treatment + tooltip, mirroring the card.
function whoChip(item) {
  const w = el('span', 'who');
  w.innerHTML = `<b>${item.assignee}</b>`;
  if (item.context) {
    w.classList.add('context');
    w.title = `Assigned to ${item.assignee}. Shown because it holds items matching the current assignee filter.`;
  }
  return w;
}

// ===== REGISTER LENS =====
// Nodes start collapsed; a node's children are fetched the first time it's
// expanded (childCount, known up front, decides whether a node is expandable).
// Only expanded nodes with loaded children render their subtree.
function renderOutline(stage) {
  const wrap = el('div', 'outline');
  const orphanStories = state.orphanStories;
  const orphanTasks = state.orphanTasks;
  if (!state.epics.length && !orphanStories.length && !orphanTasks.length) {
    wrap.append(emptyMsg('Nothing to show.', 'Adjust the filters above.')); stage.append(wrap); return;
  }
  state.epics.forEach((epic) => wrap.append(outlineNode(epic, 'epic')));
  // Orphan roots (stories/tasks belonging to no epic) after the epics, each group
  // in its own parchment card (the .ol-epic chrome) so the sub-label + rows sit on
  // parchment like nested content — the outline mirror of the columns lanes.
  const orphanCard = (label, rows) => {
    const box = el('div', 'ol-epic ol-orphans');
    box.append(el('div', 'ol-sub-label', label));
    const kids = el('div', 'ol-children');
    rows.forEach((r) => kids.append(r));
    box.append(kids);
    return box;
  };
  if (orphanStories.length) wrap.append(orphanCard('stories not in an epic', orphanStories.map((s) => outlineNode(s, 'story'))));
  if (orphanTasks.length) wrap.append(orphanCard('tasks not in an epic', orphanTasks.map((t) => taskRow(t))));
  stage.append(wrap);
}

// One outline subtree: the node's row, and — when expanded and loaded — its
// children. An epic separates its stories from the tasks parented directly on
// it; a story lists its tasks. Task-kind nodes render as leaf rows.
function outlineNode(node, tier) {
  if (node.kind === 'task') return taskRow(node, tier === 'direct');
  const box = el('div', `ol-${tier === 'direct' ? 'epic' : tier}`);
  const open = state.expanded.has(node.id);
  const expandable = node.childCount > 0;
  if (!open) box.classList.add('collapsed');
  box.append(regRow(node, expandable ? (open ? '▾' : '▸') : '·', () => { if (expandable) toggleExpand(node); }, expandable));
  if (open) {
    const children = el('div', 'ol-children');
    if (!node.loaded) children.append(el('div', 'ol-sub-label', 'loading…'));
    else {
      storiesOf(node).forEach((s) => children.append(outlineNode(s, 'story')));
      const direct = directTasksOf(node);
      if (direct.length) {
        children.append(el('div', 'ol-sub-label', 'tasks directly on this epic'));
        direct.forEach((t) => children.append(taskRow(t, true)));
      }
      // A story's children are all tasks; render them directly.
      if (node.kind === 'story') node.children.forEach((t) => children.append(taskRow(t)));
    }
    box.append(children);
  }
  return box;
}

function regRow(item, caretGlyph, onToggle, expandable) {
  const row = el('div', 'ol-row');
  const caret = el('span', 'ol-caret', caretGlyph); caret.setAttribute('aria-hidden', 'true');
  const title = el('span', 'card-title', item.title);
  row.append(caret, el('span', `chip t-${item.type}`, item.type), idTag(item.shortId, item.url), title);
  // A context epic/story shows its (elsewhere-)assignee so the pulled-in row is
  // legible as context, matching the card treatment.
  if (item.context && item.assignee) row.append(whoChip(item));
  // The row toggles expand/collapse; a separate "read" button opens details.
  asButton(row, onToggle,
    `${item.type} ${item.shortId}: ${item.title}${expandable ? ', expand or collapse' : ''}`);
  if (expandable) row.setAttribute('aria-expanded', String(state.expanded.has(item.id)));
  const read = el('span', 'ol-read', 'read');
  asButton(read, (ev) => { ev.stopPropagation(); openDrawer(item); }, `Read ${item.shortId}`);
  row.append(read);
  return row;
}

function taskRow(t, direct) {
  const r = el('div', `ol-task-row${direct ? ' direct' : ''}`);
  const status = el('span', `pill st-${t.status}`); const dot = el('span', 'dot'); dot.setAttribute('aria-hidden', 'true'); status.append(dot);
  r.append(el('span', `chip t-${t.type}`, t.type), idTag(t.shortId, t.url), el('span', 'card-title', t.title), status);
  if (t.assignee) r.append(whoChip(t));
  asButton(r, () => openDrawer(t),
    `${t.type} ${t.shortId}: ${t.title}. Status ${t.status}. Open details.`);
  return r;
}

// Expand fetches children on first open (lazy); collapse just hides them. A
// re-render after the fetch resolves shows the loaded subtree.
function toggleExpand(node) {
  if (state.expanded.has(node.id)) { state.expanded.delete(node.id); render(); return; }
  state.expanded.add(node.id);
  render();
  if (!node.loaded) ensureChildren(node).then(() => { if (state.expanded.has(node.id) && state.lens === 'outline') render(); }).catch(handleError);
}

// ===== READING DRAWER =====
// The <ledger-drawer> element (public/components/ledger-drawer.js) owns the whole
// overlay. The board injects the host services it needs and opens it with a node;
// when the drawer writes an edit or comment it emits item-changed, and the board
// patches its cached node + card from the returned item.
const drawer = () => $('#drawer');
function openDrawer(node) { drawer().open(node); }
function wireDrawer() {
  const d = drawer();
  d.api = api;
  d.caps = state.caps;
  d.sfx = sfx;
  d.toast = toast;
  // The drawer's contains-list needs children lazily loaded with the board's
  // current filters; hand it the same loader the board uses.
  d.fetchChildren = ensureChildren;
  d.addEventListener('item-changed', (e) => { if (e.detail?.item) patchNode(e.detail.item); });
}


// Merge an edited item back into the cached node and refresh what's visible. The
// node index holds the one instance every view renders from, so a single
// Object.assign updates the board; children/loaded are preserved (the edit
// response carries item fields, not the lazily-loaded child list).
function patchNode(item) {
  const node = byId(item.id);
  if (node) Object.assign(node, item);
  if (state.lens === 'columns') {
    const cols = $('.columns');
    if (cols) { cols.children[0].replaceWith(buildEpicCol(false).col); cols.children[1].replaceWith(buildStoryCol(false).col); cols.children[2].replaceWith(buildTaskCol(false).col); }
  } else render();
}

// ---- UI wiring ----
function showLoading(on) { $('#loading').style.display = on ? 'flex' : 'none'; }
let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.className = `toast show${isErr ? ' err' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// Set the pressed button in a segmented group: visual `.on` + `aria-pressed`.
function setPressed(group, btn) {
  group.querySelectorAll('button').forEach((x) => {
    const on = x === btn;
    x.classList.toggle('on', on);
    x.setAttribute('aria-pressed', String(on));
  });
}
function segWire(id, apply) {
  const s = $(id);
  s.querySelectorAll('button').forEach((b) => { b.onclick = () => { setPressed(s, b); apply(b.dataset); }; });
}

function wire() {
  // Closed items are hidden by default (status 'Open'); the toggle reveals them.
  $('#show-closed').onchange = (e) => { state.status = e.target.checked ? 'ALL' : 'Open'; loadTree(); };
  segWire('#lens-seg', (d) => { state.lens = d.lens; render({ animate: true }); });

  const aSeg = $('#assignee-seg'); const aInput = $('#assignee-input');
  aSeg.querySelectorAll('button').forEach((b) => { b.onclick = () => { setPressed(aSeg, b); aInput.value = ''; state.assignee = b.dataset.assignee; loadTree(); }; });
  aInput.onkeydown = (e) => { if (e.key === 'Enter' && aInput.value.trim()) { aSeg.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); state.assignee = aInput.value.trim(); loadTree(); } };

  // Project scope: null (all) or a source project id. Reloads the tree scoped.
  $('#project-select').onchange = (e) => { state.project = e.target.value || null; loadTree(); };

  $('#refresh').onclick = loadTree;
  wireDrawer();

  // Single-key view shortcuts. The drawer owns its own Escape and internal keys;
  // these stay dormant while it's open (and never hijack modifier combos or keys
  // typed into a field).
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (drawer().hasAttribute('open')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'r') loadTree();
    else if (e.key === '1') { state.lens = 'columns'; syncLensSeg(); render({ animate: true }); }
    else if (e.key === '2') { state.lens = 'outline'; syncLensSeg(); render(); }
  });
}
function syncLensSeg() {
  $('#lens-seg').querySelectorAll('button').forEach((b) => {
    const on = b.dataset.lens === state.lens;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// ---- masthead logo: wax seal + wordmark --------------------------------
// A wax-seal emblem carrying a debossed "TL" monogram, next to "The Ledger"
// set in IM Fell English with a brushed-brass gilt fill. The seal doubles as the
// app's standalone mark (public/seal.svg, also the favicon). Everything is live
// SVG: real <text> for the wordmark (accessible + crisp at any size, no font
// baked to paths) and static shapes for the seal (no turbulence filters — a
// wordmark reads cleanest plain).
const SVGNS = 'http://www.w3.org/2000/svg';

// Wax-seal geometry, shared verbatim with public/seal.svg — keep the two in
// sync. A real seal is a roughly-circular but IRREGULAR pour of wax with broad,
// squeezed-out lobes and smooth continuous curves (not a struck coin). SEAL_BLOB
// is the outer edge; SEAL_DISC is the pressed inner face (a lower level, so the
// rim between them reads as a raised glossy ridge); SEAL_RING_* are two grooves
// on the disc echoing the same irregular outline.
const SEAL_BLOB = 'M 59.07 32.44 C 58.71 40.15, 50.32 52.60, 44.84 56.49 C 39.37 60.38, 32.33 57.84, 26.21 55.78 C 20.08 53.73, 10.91 50.43, 8.09 44.16 C 5.27 37.89, 6.91 23.95, 9.29 18.18 C 11.68 12.41, 16.11 10.87, 22.40 9.54 C 28.68 8.22, 40.90 6.42, 47.01 10.23 C 53.13 14.05, 59.43 24.73, 59.07 32.44 Z';
const SEAL_DISC = 'M 52.54 32.33 C 52.26 38.19, 45.89 47.52, 41.72 50.53 C 37.55 53.54, 32.17 51.94, 27.52 50.39 C 22.87 48.85, 15.95 46.07, 13.81 41.25 C 11.67 36.43, 12.90 25.90, 14.70 21.47 C 16.50 17.04, 19.81 15.71, 24.60 14.70 C 29.39 13.69, 38.79 12.46, 43.45 15.40 C 48.11 18.34, 52.83 26.48, 52.54 32.33 Z';
const SEAL_RING_OUT = 'M 51.04 32.31 C 50.77 37.74, 44.87 46.38, 41.01 49.17 C 37.14 51.96, 32.16 50.48, 27.85 49.05 C 23.54 47.61, 17.12 45.04, 15.14 40.57 C 13.16 36.11, 14.30 26.34, 15.97 22.24 C 17.64 18.14, 20.70 16.90, 25.14 15.96 C 29.58 15.03, 38.29 13.89, 42.61 16.62 C 46.93 19.34, 51.31 26.88, 51.04 32.31 Z';
const SEAL_RING_IN = 'M 50.04 32.29 C 49.79 37.43, 44.19 45.62, 40.53 48.27 C 36.87 50.91, 32.15 49.51, 28.07 48.15 C 23.98 46.79, 17.90 44.35, 16.03 40.12 C 14.15 35.89, 15.23 26.64, 16.81 22.75 C 18.39 18.87, 21.30 17.69, 25.50 16.81 C 29.71 15.92, 37.96 14.85, 42.05 17.43 C 46.14 20.01, 50.29 27.15, 50.04 32.29 Z';

function buildTitle() {
  const host = $('.ledger-title');
  if (!host) return;

  // Layout: a 64-unit seal at the left, then the wordmark. The viewBox height is
  // the seal's; the width is generous and trimmed to the wordmark once the
  // display font has loaded and we can measure the real glyph advance.
  const H = 64, seal = 64, gap = 16;
  const wordX = seal + gap;

  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${wordX + 300} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'The Ledger');
  svg.innerHTML = `
    <defs>
      <!-- Molten-gold wax body, lit upper-left, deepening lower-right. -->
      <radialGradient id="lg-wax" cx="40%" cy="34%" r="70%">
        <stop offset="0" stop-color="#f6e08f"/>
        <stop offset="0.5" stop-color="#d9a92e"/>
        <stop offset="1" stop-color="#8a6015"/>
      </radialGradient>
      <!-- The pressed inner disc: darker/flatter than the raised rim. -->
      <radialGradient id="lg-disc" cx="42%" cy="38%" r="66%">
        <stop offset="0" stop-color="#e8c25a"/>
        <stop offset="0.6" stop-color="#c7961f"/>
        <stop offset="1" stop-color="#9a6f18"/>
      </radialGradient>
      <!-- Broad specular sheen for a shiny, lacquered wax finish. -->
      <radialGradient id="lg-sheen" cx="36%" cy="28%" r="46%">
        <stop offset="0" stop-color="#fff6d8" stop-opacity="0.8"/>
        <stop offset="0.5" stop-color="#fff6d8" stop-opacity="0.13"/>
        <stop offset="1" stop-color="#fff6d8" stop-opacity="0"/>
      </radialGradient>
      <!-- Brushed-brass gilt for the wordmark: lit crown, warm midtone, shadowed
           foot — the same fitting-metal as the masthead rule and controls. -->
      <linearGradient id="lg-gilt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f0d79b"/>
        <stop offset="0.42" stop-color="#d8b878"/>
        <stop offset="0.62" stop-color="#b08d4f"/>
        <stop offset="1" stop-color="#7a5f30"/>
      </linearGradient>
    </defs>

    <!-- The wax seal (shares geometry with public/seal.svg): blob body, a
         groove shadow + pressed inner disc for the raised-rim relief, irregular
         die rings, the debossed monogram, and a specular sheen over it all. -->
    <g>
      <ellipse cx="33" cy="36" rx="27" ry="27" fill="#000" opacity="0.3"/>
      <path fill="url(#lg-wax)" d="${SEAL_BLOB}"/>
      <path fill="#000" opacity="0.18" d="${SEAL_DISC}"/>
      <path fill="url(#lg-disc)" d="${SEAL_DISC}"/>
      <path fill="none" stroke="#6e4e12" stroke-opacity="0.6" stroke-width="1" d="${SEAL_RING_OUT}"/>
      <path fill="none" stroke="#fbeeb6" stroke-opacity="0.5" stroke-width="0.8" d="${SEAL_RING_IN}"/>
      <!-- Embossed, same gold as the disc — read entirely by edge relief. Light
           from top-left: lit crowns up-left, shaded far walls down-right. -->
      <g font-family="'IM Fell English', Georgia, serif" font-size="21" text-anchor="middle" font-style="italic">
        <text x="31.15" y="39.15" fill="#fff4cf" fill-opacity="0.9">TL</text>
        <text x="32.85" y="40.85" fill="#5a3e0e" fill-opacity="0.85">TL</text>
        <text x="32" y="40" fill="#cf9f28">TL</text>
      </g>
      <path fill="url(#lg-sheen)" pointer-events="none" d="${SEAL_BLOB}"/>
    </g>

    <!-- The wordmark: live text, gilt fill, a hair of tracking for the caps. A
         soft dark offset underneath lifts the brass off the leather. -->
    <g font-family="'IM Fell English', Georgia, serif" font-size="40" letter-spacing="0.6"
       dominant-baseline="alphabetic">
      <text class="lg-word" x="${wordX + 1}" y="45.5" fill="#000" fill-opacity="0.42">The Ledger</text>
      <text class="lg-word" x="${wordX}" y="44.5" fill="url(#lg-gilt)">The Ledger</text>
    </g>`;

  host.replaceChildren(svg);

  // Trim the viewBox to the measured wordmark once the display font is ready, so
  // the logo box hugs the text instead of the 300-unit guess. getBBox needs the
  // node laid out; the fonts.ready promise fires after IM Fell English loads.
  const fit = () => {
    const word = svg.querySelector('.lg-word');
    if (!word) return;
    try {
      const right = word.getBBox().x + word.getBBox().width;
      svg.setAttribute('viewBox', `0 0 ${Math.ceil(right + 6)} ${H}`);
    } catch { /* getBBox can throw if not yet rendered; the guess stands */ }
  };
  if (document.fonts?.ready) document.fonts.ready.then(fit); else fit();
}

// <ledger-board> — the app root. A light-DOM element (no shadow root): it owns
// the model and orchestration above, and its children (masthead, controls,
// stage) keep the document's global styling. Startup runs once on connect: wire
// the controls, build the animated title, do the source handshake, load the tree.
// The functions above are its implementation; kept module-scoped so each reads
// as before, operating on the element's light-DOM children via `$`.
class LedgerBoard extends HTMLElement {
  #started = false;
  async connectedCallback() {
    if (this.#started) return;   // connectedCallback can fire again on a move
    this.#started = true;
    wire();
    buildTitle();
    // One handshake: who we act as and which actions the active source supports.
    try {
      const { me, capabilities } = await api('/api/source');
      state.me = me; state.caps = capabilities || {};
      drawer().caps = state.caps;   // the drawer gates its fields on capabilities
      $('#ident-name').textContent = me;
      await loadProjects();         // fills + reveals the project picker if supported
    } catch { $('#ident-name').textContent = 'unknown'; }
    loadTree();
  }
}
if (!customElements.get('ledger-board')) customElements.define('ledger-board', LedgerBoard);
