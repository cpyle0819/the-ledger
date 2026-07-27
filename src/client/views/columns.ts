// The columns lens: Epics | Stories | Tasks, each a <ledger-column> of cards.
//
// Downstream columns depend on lazily-loaded children, so a selected-but-unloaded
// epic/story shows a loading state; the board calls the refresh* swaps once a
// fetch resolves. Orphan stories/tasks (matches belonging to no epic) render in
// below-the-fold lanes, shown regardless of selection.

import { state, byId, storiesOf, directTasksOf, type CachedNode } from '../core/state.js';
import { $ } from '../ui/dom.js';
import { column, card, emptyMsg, hint, laneLabel } from './render-helpers.js';
import type { LedgerColumn } from '../components/ledger-column.js';
import type { ViewHandlers, AddRequest } from './types.js';

// Attach a column's "+" affordance: set its tooltip/label and forward the click
// to addItem with the tier and parent this column composes into. Gated on the
// create capability — no label means the column renders no "+". The parent is
// resolved lazily at click time so it tracks the current selection.
function wireAdd(col: LedgerColumn, label: string, h: ViewHandlers, req: () => AddRequest): void {
  if (!state.caps.create) return;
  col.setAttribute('add-label', label);
  col.addEventListener('column-add', () => h.addItem(req()));
}

export function renderColumns(stage: HTMLElement, animate: boolean, h: ViewHandlers): void {
  const wrap = document.createElement('div'); wrap.className = 'columns';
  wrap.append(buildEpicCol(animate, h), buildStoryCol(animate, h), buildTaskCol(animate, h));
  stage.append(wrap);
}

function buildEpicCol(animate: boolean, h: ViewHandlers): LedgerColumn {
  const { col, body } = column('epic', 'Epics', state.epics.length);
  wireAdd(col, 'Add epic', h, () => ({ type: 'EPIC', parentNode: null }));
  if (!state.epics.length) body.append(emptyMsg('No epics.', 'Try changing your filters.'));
  state.epics.forEach((e) => {
    const cd = card(e, { drill: true, animate, onActivate: () => h.selectEpic(e.id), onOpen: h.openDrawer });
    if (e.id === state.selEpic) cd.setAttribute('selected', '');
    body.append(cd);
  });
  return col;
}

function buildStoryCol(animate: boolean, h: ViewHandlers): LedgerColumn {
  const epic = byId(state.selEpic);
  const orphans = state.orphanStories;
  const storyCard = (s: CachedNode) => {
    const cd = card(s, { drill: true, animate, onActivate: () => h.selectStory(s.id), onOpen: h.openDrawer });
    if (s.id === state.selStory) cd.setAttribute('selected', '');
    return cd;
  };
  const appendOrphans = (body: LedgerColumn) => {
    if (!orphans.length) return;
    body.append(laneLabel(`stories not in an epic · ${orphans.length}`, true));
    orphans.forEach((s) => body.append(storyCard(s)));
  };

  if (!epic) {
    const { col, body } = column('story', 'Stories', orphans.length);
    if (orphans.length) appendOrphans(body);
    // No selected epic here means no epics exist (the first loads selected), so
    // this is an empty state, not a "pick one" prompt.
    else body.append(emptyMsg('No stories.', 'Try changing your filters.'));
    return col;
  }
  // A story needs an epic parent; the "+" is offered whenever an epic is selected.
  const addStory = (col: LedgerColumn) => wireAdd(col, 'Add story', h, () => ({ type: 'STORY', parentNode: byId(state.selEpic) }));
  if (!epic.loaded) {
    const { col, body } = column('story', 'Stories', orphans.length);
    addStory(col);
    body.append(hint('Loading', 'stories…'));
    appendOrphans(body);
    return col;
  }
  const stories = storiesOf(epic);
  const { col, body } = column('story', 'Stories', stories.length + orphans.length);
  addStory(col);
  if (stories.length) stories.forEach((s) => body.append(storyCard(s)));
  else if (!orphans.length) body.append(emptyMsg('No stories.', 'This epic has no stories.'));
  appendOrphans(body);
  return col;
}

// The tasks column holds both the selected story's tasks and the tasks parented
// directly on the epic. Story tasks come first; the epic's direct tasks follow
// under their own divider, so they're always visible (even with no story
// selected) but never confused with the story's own tasks.
function buildTaskCol(animate: boolean, h: ViewHandlers): LedgerColumn {
  const epic = byId(state.selEpic);
  const orphans = state.orphanTasks;
  const addTask = (body: LedgerColumn, t: CachedNode) => { body.append(card(t, { animate, onOpen: h.openDrawer })); };
  const appendOrphans = (body: LedgerColumn) => {
    if (!orphans.length) return;
    body.append(laneLabel(`tasks not in an epic · ${orphans.length}`, true));
    orphans.forEach((t) => addTask(body, t));
  };

  if (!epic) {
    const { col, body } = column('task', 'Tasks', orphans.length);
    if (orphans.length) appendOrphans(body);
    else body.append(emptyMsg('No tasks.', 'Try changing your filters.'));
    return col;
  }
  // A new task parents to the selected story when there is one, else the selected
  // epic (a direct-on-epic task) — matching what the column shows.
  const addTask2 = (col: LedgerColumn) => wireAdd(col, 'Add task', h, () => ({
    type: 'TASK', parentNode: byId(state.selStory) || byId(state.selEpic),
  }));
  if (!epic.loaded) {
    const { col, body } = column('task', 'Tasks', orphans.length);
    addTask2(col);
    body.append(hint('Loading', 'tasks…'));
    appendOrphans(body);
    return col;
  }
  const story = storiesOf(epic).find((s) => s.id === state.selStory);
  const directTasks = directTasksOf(epic);
  const storyTasks = story ? (story.loaded ? story.children ?? [] : null) : [];
  const total = (storyTasks?.length || 0) + directTasks.length + orphans.length;
  const { col, body } = column('task', 'Tasks', total);
  addTask2(col);

  if (story && !story.loaded) body.append(hint('Loading', 'tasks…'));
  else if (storyTasks?.length) storyTasks.forEach((t) => addTask(body, t));
  if (directTasks.length) {
    body.append(laneLabel(`tasks directly on this epic · ${directTasks.length}`, true));
    directTasks.forEach((t) => addTask(body, t));
  }
  // Empty states: distinguish "story has none" from "nothing to select yet".
  // The orphan lane counts as content, so it suppresses both placeholders.
  if (story && story.loaded && !storyTasks?.length && !directTasks.length && !orphans.length) body.append(emptyMsg('No tasks.', 'This story has none yet.'));
  else if (!story && !directTasks.length && !orphans.length) body.append(hint('Select a story', 'to see its tasks.'));
  appendOrphans(body);
  return col;
}

// Swap the story + task columns for the current selection state. Called after a
// selection changes and again once a lazy children fetch resolves.
export function refreshDownstreamColumns(h: ViewHandlers): void {
  const cols = $('.columns'); if (!cols) return;
  cols.children[1]?.replaceWith(buildStoryCol(false, h));
  cols.children[2]?.replaceWith(buildTaskCol(false, h));
}
export function refreshTaskColumn(h: ViewHandlers): void {
  const cols = $('.columns'); if (!cols) return;
  cols.children[2]?.replaceWith(buildTaskCol(false, h));
}
// Rebuild all three columns in place (used by patchNode after an edit and by the
// reconcile poll). Each column's scroll position is preserved across the swap so a
// background refresh doesn't jump a scrolled column back to the top.
export function refreshAllColumns(h: ViewHandlers): void {
  const cols = $('.columns'); if (!cols) return;
  const bodyOf = (n?: Element | null) => (n as HTMLElement)?.shadowRoot?.querySelector('.col-body') as HTMLElement | undefined;
  const tops: number[] = [0, 1, 2].map((i) => bodyOf(cols.children[i])?.scrollTop ?? 0);
  const next: LedgerColumn[] = [buildEpicCol(false, h), buildStoryCol(false, h), buildTaskCol(false, h)];
  cols.children[0]?.replaceWith(next[0]!);
  cols.children[1]?.replaceWith(next[1]!);
  cols.children[2]?.replaceWith(next[2]!);
  next.forEach((c, i) => { const b = bodyOf(c); if (b) b.scrollTop = tops[i]!; });
}
