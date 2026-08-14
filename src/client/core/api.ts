// The data layer: the fetch wrapper and the lazy child loader. This is the only
// module that talks to the host; it holds no rendering. The board client never
// talks to a source backend directly — credentials stay server-side.

import { state, indexNodes, type CachedNode } from './state.js';
import type { EpicCounts, Item, Project, Sprint, SprintState } from '../../shared/contract';

/** An error carrying the HTTP status, so callers can react to the transport-level
 *  outcome (e.g. 401 = not authenticated, 422 = unsupported filter combo) without
 *  parsing the plugin's message text. */
export interface ApiError extends Error { status?: number }

/** Fetch JSON from the host. Throws an ApiError (with `.status`) on a non-ok
 *  response or a body carrying `{ error }`. */
export async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts);
  const data = await res.json() as T & { error?: string };
  if (!res.ok || data.error) {
    throw Object.assign(new Error(data.error || `HTTP ${res.status}`) as ApiError, { status: res.status });
  }
  return data;
}

interface ChildrenResponse { nodes: CachedNode[] }
/** A page of roots from a pagedRoots source: the cumulative nodes plus the paging
 *  cursor (null = last page) and progress counts. See fetchRootsPage. */
export interface RootsPage { nodes: CachedNode[]; cursor: string | null; total: number | null; loaded: number }

// Fetch a parent's children (or the roots when parentId is null) with the current
// filters, WITHOUT touching the cache. The caller decides how to merge — used by
// the reconcile poll, which merges fresh fields into the cached node instances
// rather than replacing them (so open/expanded/loaded state survives).
export async function fetchNodesRaw(parentId: string | null): Promise<CachedNode[]> {
  const q = new URLSearchParams({ status: state.status });
  if (state.assignee) q.set('assignee', state.assignee);
  if (state.project) q.set('project', state.project);
  if (state.sprint) q.set('sprint', state.sprint);
  if (state.search) q.set('search', state.search);
  if (parentId) q.set('parent', parentId);
  const { nodes } = await api<ChildrenResponse>(`/api/children?${q}`);
  return nodes;
}

// Fetch a node's children (or the roots when node is null) and cache them on the
// node. Children are cheap list nodes; the full item is fetched when a drawer
// opens. A node keeps `children` + `loaded` so a re-open doesn't refetch.
export async function fetchChildren(node: CachedNode | null): Promise<CachedNode[]> {
  const nodes = await fetchNodesRaw(node ? node.id : null);
  indexNodes(nodes);
  if (node) { node.children = nodes; node.loaded = true; }
  return nodes;
}

// Fetch one page of roots from a pagedRoots source. `cursor` null starts a fresh
// page-1 load; a cursor from a prior page continues it. The response's `nodes` is
// the CUMULATIVE set of roots loaded so far (the board re-derives its lanes from it
// wholesale), so the caller replaces its root set rather than appending. Returns
// the cursor + progress counts for the "load more" control. Filters mirror
// fetchNodesRaw's; no `parent` (roots only).
export async function fetchRootsPage(cursor: string | null): Promise<RootsPage> {
  const q = new URLSearchParams({ status: state.status });
  if (state.assignee) q.set('assignee', state.assignee);
  if (state.project) q.set('project', state.project);
  if (state.sprint) q.set('sprint', state.sprint);
  if (state.search) q.set('search', state.search);
  if (cursor) q.set('cursor', cursor);
  const page = await api<RootsPage>(`/api/children?${q}`);
  indexNodes(page.nodes);
  return page;
}

// Fetch a parent's children at ALL statuses, ignoring the board's status filter
// (assignee/project still apply). Returned UNCACHED so the board's filtered cache
// — which the columns and deep-linking read — is never overwritten with closed
// items. Used by the drawer's Planning rollup, which measures capacity against the
// complete decomposition (closed work included), not just what the board shows.
export async function fetchChildrenAllStatus(parentId: string): Promise<CachedNode[]> {
  const q = new URLSearchParams({ status: 'ALL', parent: parentId, accurate: '1' });
  if (state.assignee) q.set('assignee', state.assignee);
  if (state.project) q.set('project', state.project);
  const { nodes } = await api<ChildrenResponse>(`/api/children?${q}`);
  return nodes;
}

// Load a node's children once, coalescing concurrent callers onto one request.
export async function ensureChildren(node: CachedNode | null): Promise<CachedNode[]> {
  if (!node || node.loaded) return node?.children || [];
  if (!node._loading) node._loading = fetchChildren(node).finally(() => { node._loading = null; });
  await node._loading;
  return node.children || [];
}

// The projects the source can scope to (when it declares the capability).
export async function loadProjects(): Promise<Project[]> {
  const { projects } = await api<{ projects: Project[] }>('/api/projects');
  return projects || [];
}

// The sprints in a project (when the source declares the sprints capability).
// Scoped to a project — findSprints requires one — so the caller passes the
// current project; an optional state narrows to one lifecycle state. Returns []
// for no project (an unscoped sprint list isn't meaningful).
export async function loadSprints(project: string | null, sprintState?: SprintState): Promise<Sprint[]> {
  if (!project) return [];
  const q = new URLSearchParams({ project });
  if (sprintState) q.set('state', sprintState);
  const { sprints } = await api<{ sprints: Sprint[] }>(`/api/sprints?${q}`);
  return sprints || [];
}

// Move a task into a sprint (single-select: the source drops any other sprint the
// task was directly in). Returns the updated task Item so the drawer patches its node.
export async function addTaskToSprint(taskId: string, sprintId: string): Promise<Item> {
  const { item } = await api<{ item: Item }>(`/api/item/${taskId}/sprint`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sprintId }),
  });
  return item;
}

// Take a task out of a sprint. Returns the updated task Item.
export async function removeTaskFromSprint(taskId: string, sprintId: string): Promise<Item> {
  const { item } = await api<{ item: Item }>(`/api/item/${taskId}/sprint/${sprintId}`, { method: 'DELETE' });
  return item;
}

// Story/task rollups for a set of epics under the current filters. Called after
// the roots render (the card shows the raw child count until this resolves), so
// the filter params mirror fetchNodesRaw's. Gated by the epicCounts capability.
export async function fetchEpicCounts(epicIds: string[]): Promise<Record<string, EpicCounts>> {
  if (!epicIds.length) return {};
  const q = new URLSearchParams({ status: state.status, epics: epicIds.join(',') });
  if (state.assignee) q.set('assignee', state.assignee);
  if (state.project) q.set('project', state.project);
  if (state.sprint) q.set('sprint', state.sprint);
  if (state.search) q.set('search', state.search);
  const { counts } = await api<{ counts: Record<string, EpicCounts> }>(`/api/counts?${q}`);
  return counts || {};
}
