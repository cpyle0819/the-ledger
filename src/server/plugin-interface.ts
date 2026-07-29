// The plugin contract's host-side plumbing. A source plugin is a module that
// exports a factory `(hostConfig) => SourcePlugin`; the plugin renders one
// backing system (an issue tracker, a code host, a local file) into The Ledger's
// Epic/Story/Task model. The board renders every plugin identically and hides
// actions a plugin doesn't advertise.
//
// The shapes (SourcePlugin, Capabilities, LedgerNode, …) live in the shared
// contract; this module is the runtime that loads a plugin, resolves its real
// capabilities, and guards every host->plugin call. Plugins stay plain .js at
// the extension boundary.
//
// A plugin is an npm dependency: each source (the bundled local-file/github, or
// an external one wrapping a private backend) is declared in the-ledger's
// package.json and installed into node_modules, so the loader resolves it by
// package name through Node's own module resolution. Which one is active is read
// from `ledger.config.json` at the repo root — see loadActiveSource.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Capabilities, SourcePlugin } from '../shared/contract';

const CONTRACT_VERSION = 1;

// The repo root, resolved from this compiled module's location. At runtime this
// file is dist/server/plugin-interface.js, so the root is two levels up. Static
// assets (public/) and the config file are resolved against it, since __dirname
// no longer sits at the repo root once compiled.
const REPO_ROOT = path.join(__dirname, '..', '..');

// The sibling config file naming the active source. Follows the modern Node
// `<tool>.config.json` convention (node.config.json, vite.config.*, …), not the
// older `.*rc` family. Machine-local and gitignored: the committed
// `ledger.config.example.json` documents the shape.
const CONFIG_FILE = path.join(REPO_ROOT, 'ledger.config.json');
const DEFAULT_SOURCE = 'the-ledger-local-file';

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
    epicVelocity: !!c.epicVelocity && has('epicVelocity'),
    points: !!c.points,
    taskDates: !!c.taskDates,
    incompleteClose: !!c.incompleteClose,
    pagedRoots: !!c.pagedRoots && has('getRoots'),
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

// The active source's package name, from ledger.config.json's `source` field.
// Absent file or absent/blank field falls back to the bundled local-file source,
// so a fresh clone runs with no config. A malformed file is a hard error, not a
// silent fallback — a typo in the one file that picks the backend should fail
// loudly rather than quietly serving the wrong (or default) source.
function activeSourceName(): string {
  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  } catch {
    return DEFAULT_SOURCE; // no config file — bundled default
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw Object.assign(
      new Error(`Malformed ${path.basename(CONFIG_FILE)}: ${(e as Error).message}`),
      { status: 500 },
    );
  }
  const source = (parsed as { source?: unknown })?.source;
  return typeof source === 'string' && source.trim() ? source.trim() : DEFAULT_SOURCE;
}

// A source is a package name unless it looks like a path — a leading '.' or any
// slash. A path resolves against the repo root (so a relative config value is
// stable regardless of cwd); a bare name resolves as an npm dependency through
// Node's own node_modules resolution. The path form is the bridge for a plugin
// that isn't yet a committable dependency (e.g. a private-backend source that
// lives in a gitignored folder here until it's version-controlled elsewhere);
// flip the config value to the package name once a dependency can be declared.
function resolveSource(source: string): string {
  const isPath = source.startsWith('.') || source.includes('/') || source.includes('\\');
  return isPath ? path.resolve(REPO_ROOT, source) : source;
}

// Load the single active source. Its name/path comes from ledger.config.json;
// require() resolves it either from node_modules (a declared dependency) or from
// a repo-relative path. The module exports a factory or a ready plugin object. A
// source that can't be loaded fails loudly with the offending value.
export function loadActiveSource(hostConfig: Record<string, unknown> = {}): ActiveSource {
  const name = activeSourceName();
  let factory: ((cfg: Record<string, unknown>) => SourcePlugin) | SourcePlugin;
  try {
    factory = require(resolveSource(name)) as ((cfg: Record<string, unknown>) => SourcePlugin) | SourcePlugin;
  } catch (e) {
    throw Object.assign(
      new Error(`Source '${name}' could not be loaded (a declared package.json dependency, or a repo-relative path to a plugin?): ${(e as Error).message}`),
      { status: 500 },
    );
  }
  const plugin = typeof factory === 'function' ? factory(hostConfig) : factory;
  if (plugin.apiVersion > CONTRACT_VERSION) {
    console.warn(`[ledger] source '${plugin.name}' targets contract v${plugin.apiVersion}; host is v${CONTRACT_VERSION} — newer features ignored.`);
  }
  return { name: plugin.name, plugin, capabilities: resolveCapabilities(plugin) };
}

export { CONTRACT_VERSION, REPO_ROOT };
