'use strict';

// The plugin contract and host-side plumbing. A source plugin is a module that
// exports a factory `(hostConfig) => plugin`; the plugin renders one backing
// system (an issue tracker, a code host, a local file) into The Ledger's
// Epic/Story/Task model. The board renders every plugin identically and hides
// actions a plugin doesn't advertise.
//
// A plugin object:
//   name          string, stable identifier
//   apiVersion    integer, the contract major version it targets
//   me            the viewer's identity in this source (default assignee filter)
//   capabilities  object the host reads to gate the UI — see resolveCapabilities
//   getChildren(parentId, filters) -> node[]   parentId null => roots
//   readItem(id)                    -> item     full item incl. description/comments
//   editField(id, field, value)     -> item
//   addComment(id, message)         -> item
//   editComment(id, commentId, msg) -> item     capability: editOwnComments
//   deleteComment(id, commentId)    -> item     capability: editOwnComments
//   searchAssignees(query)          -> user[]   capability: searchAssignees
//   stepOptions({ project })        -> string[] capability: stepOptions
//   listProjects()                  -> project[] capability: projects
//
// A `project` is { id, name }: the source's own grouping the viewer belongs to
// (a folder / room / repo). It scopes the hierarchy as one more filter dimension
// — the host threads the selected project id through `filters.project` on
// getChildren, alongside assignee and status. null project = every project (the
// unscoped default). The id is the value the source keys its own items on, so it
// round-trips through the filter without translation.
//
// The assignee filter applies at EVERY level, not just roots: getChildren returns
// only children matching filters.assignee (assignee 'anyone' disables it). Two
// consequences the source must honor so the board stays complete:
//   - Ancestry rollup. A matching item whose parent does NOT match still needs a
//     place in the tree, so getChildren includes that parent as a CONTEXT node
//     (`context: true`): it is present only because a descendant matches. A
//     context node's own assignee is left as-is (the card shows it, distinctly);
//     drilling it applies the same filter one level down, again rolling up any
//     intermediate context ancestor of a deeper match.
//   - Orphans. A matching item with no parent at all is a root. The roots call
//     (parentId null) therefore returns matching epics, matching orphan stories,
//     and matching orphan tasks together; the board sorts them into columns/lanes
//     by kind. Roots are not all epics anymore — kind is read per node.
//
// A node MAY carry `context: true` (see rollup above). The board renders such a
// node normally but marks its assignee as belonging to someone other than the
// filtered assignee, with a tooltip. Absent/false means a normal match.
//
// A node MAY carry `url`: the item's link in its backing system. The board is
// source-agnostic and builds no URL itself — when a node has `url` the board
// shows a copy/open affordance for it, and when it doesn't the id renders as
// plain text. A source with no per-item web address simply omits it.
//
// Every method may return a value or a Promise; the host awaits uniformly, so a
// local-file plugin can be synchronous and a network plugin async through one
// host code path.

const CONTRACT_VERSION = 1;

// Resolve the capabilities the host will act on. A plugin declares capabilities,
// but a flag is trusted only when the backing method actually exists — the
// duck-typed backstop keeps a lying or half-built flag from drawing a button
// that has nothing behind it. `editFields` keeps its array (which fields are
// editable) so the drawer can gate per-field, not just on/off.
function resolveCapabilities(plugin) {
  const c = plugin.capabilities || {};
  const has = (m) => typeof plugin[m] === 'function';
  return {
    hierarchy: !!c.hierarchy && has('getChildren'),
    readItem: !!c.readItem && has('readItem'),
    editFields: Array.isArray(c.editFields) && has('editField') ? c.editFields : [],
    comment: !!c.comment && has('addComment'),
    editOwnComments: !!c.editOwnComments && has('editComment') && has('deleteComment'),
    searchAssignees: !!c.searchAssignees && has('searchAssignees'),
    stepOptions: !!c.stepOptions && has('stepOptions'),
    projects: !!c.projects && has('listProjects'),
    attachments: !!c.attachments && has('addAttachment'),
  };
}

// Race a plugin call against a timer so a hung source can't wedge a request.
// The timer is cleared on settle so it never keeps the process alive.
function withTimeout(promise, ms, label) {
  let t;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { status: 504 })), ms);
  });
  return Promise.race([Promise.resolve(promise), timer]).finally(() => clearTimeout(t));
}

// The one gateway every host->plugin call goes through. Contains a plugin fault
// (throw, rejection, hang) as an error for this request; the plugin's own thrown
// `status` is preserved so the http layer maps it correctly.
async function callPlugin(plugin, method, args, { timeout = 45000 } = {}) {
  if (typeof plugin[method] !== 'function') {
    throw Object.assign(new Error(`Source '${plugin.name}' does not support ${method}`), { status: 400 });
  }
  return withTimeout(plugin[method](...args), timeout, `${plugin.name}.${method}`);
}

// Load the single active source. The plugin lives at plugins/<name>/index.js and
// exports a factory. One active source only — no directory scan or manifest yet.
function loadActiveSource(hostConfig = {}) {
  const name = process.env.LEDGER_SOURCE || 'local-file';
  const path = require('path');
  const factory = require(path.join(__dirname, '..', 'plugins', name));
  const plugin = typeof factory === 'function' ? factory(hostConfig) : factory;
  if (plugin.apiVersion > CONTRACT_VERSION) {
    console.warn(`[ledger] source '${plugin.name}' targets contract v${plugin.apiVersion}; host is v${CONTRACT_VERSION} — newer features ignored.`);
  }
  return { name: plugin.name, plugin, capabilities: resolveCapabilities(plugin) };
}

module.exports = { CONTRACT_VERSION, resolveCapabilities, withTimeout, callPlugin, loadActiveSource };
