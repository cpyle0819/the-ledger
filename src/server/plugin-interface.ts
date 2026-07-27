// The plugin contract's host-side plumbing. A source plugin is a module that
// exports a factory `(hostConfig) => SourcePlugin`; the plugin renders one
// backing system (an issue tracker, a code host, a local file) into The Ledger's
// Epic/Story/Task model. The board renders every plugin identically and hides
// actions a plugin doesn't advertise.
//
// The shapes (SourcePlugin, Capabilities, LedgerNode, …) live in the shared
// contract; this module is the runtime that loads a plugin, resolves its real
// capabilities, and guards every host->plugin call. Plugins stay plain .js at
// the extension boundary — they are loaded by require() from the repo root.

import * as path from 'node:path';
import type { Capabilities, SourcePlugin } from '../shared/contract';

const CONTRACT_VERSION = 1;

// The repo root, resolved from this compiled module's location. At runtime this
// file is dist/server/plugin-interface.js, so the root is two levels up. Static
// assets (public/) and plugins (plugins/<name>) are resolved against it, since
// __dirname no longer sits at the repo root once compiled.
const REPO_ROOT = path.join(__dirname, '..', '..');

/** A loaded, ready-to-serve source: its name, the plugin, and the capabilities
 *  the host will actually act on. */
export interface ActiveSource {
  name: string;
  plugin: SourcePlugin;
  capabilities: Capabilities;
}

// Resolve the capabilities the host will act on. A plugin declares capabilities,
// but a flag is trusted only when the backing method actually exists — the
// duck-typed backstop keeps a lying or half-built flag from drawing a button
// that has nothing behind it. `editFields` keeps its array (which fields are
// editable) so the drawer can gate per-field, not just on/off.
export function resolveCapabilities(plugin: SourcePlugin): Capabilities {
  const c = plugin.capabilities || {};
  const has = (m: keyof SourcePlugin) => typeof plugin[m] === 'function';
  return {
    hierarchy: !!c.hierarchy && has('getChildren'),
    readItem: !!c.readItem && has('readItem'),
    editFields: Array.isArray(c.editFields) && has('editField') ? c.editFields : [],
    create: !!c.create && has('createItem'),
    createFields: !!c.create && has('createItem') && Array.isArray(c.createFields) ? c.createFields : [],
    comment: !!c.comment && has('addComment'),
    editOwnComments: !!c.editOwnComments && has('editComment') && has('deleteComment'),
    searchAssignees: !!c.searchAssignees && has('searchAssignees'),
    stepOptions: !!c.stepOptions && has('stepOptions'),
    projects: !!c.projects && has('listProjects'),
    attachments: !!c.attachments,
    epicCounts: !!c.epicCounts && has('countEpicTasks'),
    points: !!c.points,
  };
}

// Race a plugin call against a timer so a hung source can't wedge a request.
// The timer is cleared on settle so it never keeps the process alive.
export function withTimeout<T>(promise: T | Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timer = new Promise<never>((_, reject) => {
    t = setTimeout(
      () => reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { status: 504 })),
      ms,
    );
  });
  return Promise.race([Promise.resolve(promise), timer]).finally(() => clearTimeout(t));
}

// The one gateway every host->plugin call goes through. Contains a plugin fault
// (throw, rejection, hang) as an error for this request; the plugin's own thrown
// `status` is preserved so the http layer maps it correctly.
export async function callPlugin(
  plugin: SourcePlugin,
  method: keyof SourcePlugin,
  args: unknown[],
  { timeout = 45000 }: { timeout?: number } = {},
): Promise<unknown> {
  const fn = plugin[method];
  if (typeof fn !== 'function') {
    throw Object.assign(new Error(`Source '${plugin.name}' does not support ${String(method)}`), { status: 400 });
  }
  return withTimeout((fn as (...a: unknown[]) => unknown).apply(plugin, args), timeout, `${plugin.name}.${String(method)}`);
}

// Load the single active source. The plugin lives at plugins/<name>/index.js and
// exports a factory. One active source only — no directory scan or manifest yet.
export function loadActiveSource(hostConfig: Record<string, unknown> = {}): ActiveSource {
  const name = process.env.LEDGER_SOURCE || 'local-file';
  // Plugins are plain .js at the repo root, not compiled into dist/.
  const factory = require(path.join(REPO_ROOT, 'plugins', name)) as
    | ((cfg: Record<string, unknown>) => SourcePlugin)
    | SourcePlugin;
  const plugin = typeof factory === 'function' ? factory(hostConfig) : factory;
  if (plugin.apiVersion > CONTRACT_VERSION) {
    console.warn(`[ledger] source '${plugin.name}' targets contract v${plugin.apiVersion}; host is v${CONTRACT_VERSION} — newer features ignored.`);
  }
  return { name: plugin.name, plugin, capabilities: resolveCapabilities(plugin) };
}

export { CONTRACT_VERSION, REPO_ROOT };
