// The outline lens: a collapsible tree. Nodes start collapsed; a node's children
// are fetched the first time it's expanded (childCount, known up front, decides
// whether a node is expandable). Only expanded nodes with loaded children render
// their subtree. Orphan stories/tasks render in their own cards after the epics.

import { state, storiesOf, directTasksOf, type CachedNode } from '../core/state.js';
import { el, asButton } from '../components/util.js';
import { idTag, noEstimateChip, noStartDateChip } from '../components/shared-styles.js';
import { emptyMsg, whoChip } from './render-helpers.js';
import type { ViewHandlers } from './types.js';

// A small wax "CLOSED" tag for a closed outline row — the row's analogue of the
// card's corner stamp. Styled in styles.css (.ol-closed-tag).
function closedTag(): HTMLElement {
  const tag = el('span', 'ol-closed-tag', 'Closed');
  tag.setAttribute('aria-hidden', 'true');
  return tag;
}

export function renderOutline(stage: HTMLElement, h: ViewHandlers): void {
  const wrap = el('div', 'outline');
  const { orphanStories, orphanTasks } = state;
  if (!state.epics.length && !orphanStories.length && !orphanTasks.length) {
    wrap.append(emptyMsg('Nothing to show.', 'Adjust the filters above.')); stage.append(wrap); return;
  }
  state.epics.forEach((epic) => wrap.append(outlineNode(epic, 'epic', h)));
  // Orphan roots after the epics, each group in its own parchment card (the
  // .ol-epic chrome) — the outline mirror of the columns lanes.
  const orphanCard = (label: string, rows: HTMLElement[]) => {
    const box = el('div', 'ol-epic ol-orphans');
    box.append(el('div', 'ol-sub-label', label));
    const kids = el('div', 'ol-children');
    rows.forEach((r) => kids.append(r));
    box.append(kids);
    return box;
  };
  if (orphanStories.length) wrap.append(orphanCard('stories not in an epic', orphanStories.map((s) => outlineNode(s, 'story', h))));
  if (orphanTasks.length) wrap.append(orphanCard('tasks not in an epic', orphanTasks.map((t) => taskRow(t, false, h))));
  stage.append(wrap);
}

// One outline subtree: the node's row, and — when expanded and loaded — its
// children. An epic separates its stories from the tasks parented directly on
// it; a story lists its tasks. Task-kind nodes render as leaf rows.
function outlineNode(node: CachedNode, tier: 'epic' | 'story' | 'direct', h: ViewHandlers): HTMLElement {
  if (node.kind === 'task') return taskRow(node, tier === 'direct', h);
  const box = el('div', `ol-${tier === 'direct' ? 'epic' : tier}`);
  const open = state.expanded.has(node.id);
  const expandable = node.childCount > 0;
  if (!open) box.classList.add('collapsed');
  box.append(regRow(node, expandable ? (open ? '▾' : '▸') : '·', () => { if (expandable) h.toggleExpand(node); }, expandable, h));
  if (open) {
    const children = el('div', 'ol-children');
    if (!node.loaded) children.append(el('div', 'ol-sub-label', 'loading…'));
    else if (node.kind === 'epic') {
      // An epic separates its stories from the tasks parented directly on it.
      storiesOf(node).forEach((s) => children.append(outlineNode(s, 'story', h)));
      const direct = directTasksOf(node);
      if (direct.length) {
        children.append(el('div', 'ol-sub-label', 'tasks directly on this epic'));
        direct.forEach((t) => children.append(taskRow(t, true, h)));
      }
    } else {
      // A story's children are all tasks; render them directly, no divider.
      (node.children || []).forEach((t) => children.append(taskRow(t, false, h)));
    }
    box.append(children);
  }
  return box;
}

function regRow(item: CachedNode, caretGlyph: string, onToggle: () => void, expandable: boolean, h: ViewHandlers): HTMLElement {
  const row = el('div', 'ol-row');
  if (item.status === 'Closed') row.classList.add('ol-closed');
  const caret = el('span', 'ol-caret', caretGlyph); caret.setAttribute('aria-hidden', 'true');
  const title = el('span', 'card-title', item.title);
  row.append(caret, el('span', `chip t-${item.type}`, item.type), idTag(item.shortId, item.url), title);
  // A closed epic/story (on the board only when "show closed items" is on) gets a
  // small wax "CLOSED" tag, mirroring the card's stamp — the thin row has no room
  // for a struck-across stamp.
  if (item.status === 'Closed') row.append(closedTag());
  // Flag an epic/story with no estimate, when the source has point estimates.
  if (state.caps.points && !(item.estimate != null && item.estimate > 0)) row.append(noEstimateChip());
  // A context epic/story shows its (elsewhere-)assignee so the pulled-in row is
  // legible as context, matching the card treatment.
  if (item.context && item.assignee) row.append(whoChip(item));
  // The row toggles expand/collapse; a separate "read" button opens details.
  asButton(row, onToggle,
    `${item.type} ${item.shortId}: ${item.title}${expandable ? ', expand or collapse' : ''}`);
  if (expandable) row.setAttribute('aria-expanded', String(state.expanded.has(item.id)));
  // Per-row add affordances, gated on the create capability: an epic can add a
  // story or a task, a story can add a task. Parenting the new item on this row's
  // node, via the same handler the columns use.
  if (state.caps.create) {
    const addBtn = (label: string, type: 'STORY' | 'TASK') => {
      const b = el('span', 'ol-add', label);
      asButton(b, (ev: Event) => { ev.stopPropagation(); h.addItem({ type, parentNode: item }); }, `${label} to ${item.shortId}`);
      row.append(b);
    };
    if (item.kind === 'epic') { addBtn('+ story', 'STORY'); addBtn('+ task', 'TASK'); }
    else if (item.kind === 'story') addBtn('+ task', 'TASK');
  }
  const read = el('span', 'ol-read', 'read');
  asButton(read, (ev: Event) => { ev.stopPropagation(); h.openDrawer(item); }, `Read ${item.shortId}`);
  row.append(read);
  return row;
}

function taskRow(t: CachedNode, direct: boolean, h: ViewHandlers): HTMLElement {
  const r = el('div', `ol-task-row${direct ? ' direct' : ''}`);
  if (t.status === 'Closed') r.classList.add('ol-closed');
  const status = el('span', `pill st-${t.status}`); const dot = el('span', 'dot'); dot.setAttribute('aria-hidden', 'true'); status.append(dot);
  r.append(el('span', `chip t-${t.type}`, t.type), idTag(t.shortId, t.url), el('span', 'card-title', t.title), status);
  // A closed task gets the same small wax "CLOSED" tag as closed epic/story rows.
  if (t.status === 'Closed') r.append(closedTag());
  if (state.caps.points && !(t.estimate != null && t.estimate > 0)) r.append(noEstimateChip());
  // Flag a closed task with no start date (see the card treatment): can't yield a
  // duration or feed velocity. Only when the source has a task-date model.
  if (state.caps.taskDates && t.status === 'Closed' && !t.startDate) r.append(noStartDateChip());
  if (t.assignee) r.append(whoChip(t));
  asButton(r, () => h.openDrawer(t),
    `${t.type} ${t.shortId}: ${t.title}. Status ${t.status}. Open details.`);
  return r;
}
