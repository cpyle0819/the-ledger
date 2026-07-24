'use strict';

// The Ledger — local-file source plugin. Renders items from a JSON file as the
// Epic/Story/Task board. The bundled reference source, and a plugin with no
// network and no auth: every method is synchronous, and it declares a smaller
// capability set (no workflow steps, no assignee search, no comment editing), so
// the board hides the actions it can't perform.
//
// The host awaits plugin methods uniformly, so returning plain values (not
// Promises) is fine — this is the sync end of the value-or-Promise contract.
//
// Writes persist back to the same file. Single-user, local-only: there is no
// concurrent-writer story, so a read-modify-write of the whole file is enough.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.LEDGER_FILE || path.join(__dirname, 'sample.json');
const ME = process.env.LEDGER_ME || 'me';

const CLOSED_STATES = new Set(['Resolved', 'Closed']);
const kindOf = (type) => {
  const t = String(type || '').toUpperCase();
  return t === 'EPIC' ? 'epic' : t === 'STORY' ? 'story' : 'task';
};

function load() {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const items = Array.isArray(raw.items) ? raw.items : [];
  const projects = Array.isArray(raw.projects) ? raw.projects : [];
  return { items, projects };
}

// Persist items, preserving the rest of the file (projects, and any future
// top-level keys) so an edit doesn't drop them.
function save(items) {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  fs.writeFileSync(FILE, JSON.stringify({ ...raw, items }, null, 2) + '\n');
}

function passesStatus(status, filter) {
  if (filter === 'ALL') return true;
  const closed = CLOSED_STATES.has(status || 'Open');
  return filter === 'Closed' ? closed : !closed;
}

// The chain of ancestors above an item, nearest first (parent, grandparent, …),
// cycle-guarded. Empty for a root.
function ancestorsOf(item, byId) {
  const chain = [];
  const seen = new Set([item.id]);
  let cur = item.parent ? byId.get(item.parent) : null;
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); chain.push(cur); cur = cur.parent ? byId.get(cur.parent) : null; }
  return chain;
}

// The topmost ancestor (the item itself if it's a root). Used to read the
// project, which lives on the root epic and is inherited by its subtree.
function rootOf(item, byId) {
  const seen = new Set();
  let cur = item;
  while (cur.parent && byId.has(cur.parent) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.parent); }
  return cur;
}

// The visible node set for a filter. The assignee filter applies at every level:
// an item is a MATCH when it passes status + project + assignee. Every ancestor
// of a match is pulled in as CONTEXT (present only to give the match a place in
// the tree, even when assigned elsewhere) — so a match is never lost, but a
// non-matching item with no matching descendant never shows. Ancestors are
// included regardless of their own status/assignee; they share the match's
// project (project lives on the shared root), so they stay in scope.
function computeVisible(items, { status, assignee, project }) {
  const byId = new Map(items.map((it) => [it.id, it]));
  const inProject = (it) => !project || (rootOf(it, byId).project || it.project || null) === project;
  const assigneeOk = (it) => !assignee || assignee === 'anyone' || (it.assignee || null) === assignee;
  const isMatch = (it) => passesStatus(it.status, status) && inProject(it) && assigneeOk(it);

  const matchIds = new Set(items.filter(isMatch).map((it) => it.id));
  const visible = new Set(matchIds);
  for (const id of matchIds) for (const anc of ancestorsOf(byId.get(id), byId)) visible.add(anc.id);
  return { visible, matchIds };
}

// A cheap list node. childCount is the raw number of items parented on this one,
// known from a single pass over the file — no per-child fetch. `context` marks a
// node pulled in only as an ancestor of a match (assigned elsewhere); the board
// renders it distinctly.
function shapeNode(item, items, context = false) {
  return {
    id: item.id,
    shortId: item.id,
    kind: kindOf(item.type),
    type: String(item.type || 'TASK').toUpperCase(),
    title: item.title || '(untitled)',
    status: item.status || 'Open',
    assignee: item.assignee || null,
    project: item.project || null,
    context,
    childCount: items.filter((c) => c.parent === item.id).length,
  };
}

function shapeItem(item, items) {
  return {
    ...shapeNode(item, items),
    description: item.description || '',
    descriptionContentType: 'text/markdown',
    estimate: item.estimate ?? null,
    comments: (item.comments || []).map((c) => ({
      id: c.id,
      message: c.message || '',
      contentType: 'text/markdown',
      author: c.author || null,
      isMine: (c.author || null) === ME,
      createDate: c.createDate || null,
      lastUpdatedDate: c.lastUpdatedDate || null,
    })),
    createDate: item.createDate || null,
    lastUpdatedDate: item.lastUpdatedDate || null,
  };
}

module.exports = function createLocalFilePlugin() {
  return {
    name: 'local-file',
    apiVersion: 1,
    me: ME,
    // A deliberately smaller set: no workflow steps, no assignee typeahead, no
    // comment editing. The board hides those actions.
    capabilities: {
      hierarchy: true,
      readItem: true,
      editFields: ['status', 'description', 'assignee', 'estimate'],
      comment: true,
      editOwnComments: false,
      searchAssignees: false,
      stepOptions: false,
      projects: true,
      attachments: false,
    },

    // The projects (declared in the file) the board can scope to. null project =
    // every project, so the file needs no "all" sentinel.
    listProjects() {
      const { projects } = load();
      return projects.map((p) => ({ id: p.id, name: p.name || p.id }));
    },

    // parentId null => roots (matching epics + matching orphan stories/tasks, plus
    // context-ancestor roots of deeper matches); otherwise a parent's children.
    // The assignee filter applies at every level: a node shows only if it matches
    // or is an ancestor of a match (a context node). See computeVisible.
    getChildren(parentId, filters = {}) {
      const { items } = load();
      const { visible, matchIds } = computeVisible(items, {
        status: filters.status || 'Open',
        assignee: filters.assignee,
        project: filters.project || null,
      });
      // Direct children of parentId (parentId null => roots, i.e. no parent) that
      // are visible. A visible-but-non-matching node is context (ancestor of a
      // deeper match).
      const kids = items.filter((it) => {
        const isChild = parentId ? it.parent === parentId : !it.parent;
        return isChild && visible.has(it.id);
      });
      const nodes = kids.map((it) => shapeNode(it, items, !matchIds.has(it.id)));
      // Stories before tasks, matching the epic-column / direct-task-lane split.
      return [...nodes.filter((n) => n.kind === 'story'), ...nodes.filter((n) => n.kind !== 'story')];
    },

    readItem(id) {
      const { items } = load();
      const item = items.find((it) => it.id === id);
      if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
      return shapeItem(item, items);
    },

    editField(id, field, value) {
      if (!['status', 'description', 'assignee', 'estimate'].includes(field)) {
        throw Object.assign(new Error(`Field '${field}' is not editable`), { status: 400 });
      }
      const { items } = load();
      const item = items.find((it) => it.id === id);
      if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
      item[field] = field === 'estimate' ? (Number(value) || null) : value;
      item.lastUpdatedDate = new Date().toISOString();
      save(items);
      return shapeItem(item, items);
    },

    addComment(id, message) {
      if (!message || !message.trim()) throw Object.assign(new Error('Empty comment'), { status: 400 });
      const { items } = load();
      const item = items.find((it) => it.id === id);
      if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
      (item.comments || (item.comments = [])).push({
        id: crypto.randomUUID(),
        author: ME,
        message,
        createDate: new Date().toISOString(),
      });
      save(items);
      return shapeItem(item, items);
    },
  };
};
