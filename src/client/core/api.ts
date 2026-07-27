// The data layer: the fetch wrapper and the lazy child loader. This is the only
// module that talks to the host; it holds no rendering. The board client never
// talks to a source backend directly — credentials stay server-side.

import { state, indexNodes, type CachedNode } from './state.js';
import type { EpicCounts, Project } from '../../shared/contract';

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

// Fetch a parent's children (or the roots when parentId is null) with the current
// filters, WITHOUT touching the cache. The caller decides how to merge — used by
// the reconcile poll, which merges fresh fields into the cached node instances
// rather than replacing them (so open/expanded/loaded state survives).
export async function fetchNodesRaw(parentId: string | null): Promise<CachedNode[]> {
  const q = new URLSearchParams({ status: state.status });
  if (state.assignee) q.set('assignee', state.assignee);
  if (state.project) q.set('project', state.project);
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

// Story/task rollups for a set of epics under the current filters. Called after
// the roots render (the card shows the raw child count until this resolves), so
// the filter params mirror fetchNodesRaw's. Gated by the epicCounts capability.
export async function fetchEpicCounts(epicIds: string[]): Promise<Record<string, EpicCounts>> {
  if (!epicIds.length) return {};
  const q = new URLSearchParams({ status: state.status, epics: epicIds.join(',') });
  if (state.assignee) q.set('assignee', state.assignee);
  if (state.project) q.set('project', state.project);
  const { counts } = await api<{ counts: Record<string, EpicCounts> }>(`/api/counts?${q}`);
  return counts || {};
}
