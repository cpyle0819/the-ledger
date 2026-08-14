// The board's model: the current filter/selection state, and the node cache.
//
// The hierarchy loads lazily — roots first, a node's children only when it's
// opened or expanded — so there is no full tree to walk. `nodeIndex` is the
// single source of truth for lookup: every view renders from the one instance a
// node id maps to, so a single Object.assign on an edited item updates the board.

import type { Capabilities, EpicCounts, LedgerNode, Sprint, StatusFilter } from '../../shared/contract';

// Sprints known for the current project, id -> Sprint, so a card/drawer resolves a
// task's sprintId to a name (and its active state) without a per-item read. Filled
// from /api/sprints on load and rebuilt on every project change (see fillSprints);
// empty when the source has no sprints capability or no project is selected.
export const sprintsById = new Map<string, Sprint>();

// A cached node also carries its lazily-loaded children and load bookkeeping.
export interface CachedNode extends LedgerNode {
  children?: CachedNode[];
  loaded?: boolean;
  _loading?: Promise<CachedNode[]> | null;
  // Story/task rollup for epic nodes, filled in after the roots render (see
  // fetchEpicCounts). Absent until it arrives; the card falls back to childCount.
  counts?: EpicCounts;
}

export interface BoardState {
  assignee: string;          // '' = the default (me), 'anyone', or an alias
  status: StatusFilter;
  project: string | null;    // null = every project; else a source project id
  sprint: string | null;     // null = every sprint; else a sprint id (scoped to project)
  search: string;            // '' = no query; else the free text the source matches on
  lens: 'columns' | 'outline';
  me: string | null;
  caps: Partial<Capabilities>;
  epics: CachedNode[];        // root nodes of kind epic
  orphanStories: CachedNode[];// root nodes of kind story (belong to no epic)
  orphanTasks: CachedNode[];  // root nodes of kind task (belong to no parent)
  selEpic: string | null;
  selStory: string | null;
  expanded: Set<string>;      // outline: ids whose children are shown
  // Roots pagination (only for a source with the pagedRoots capability). `cursor`
  // is the opaque token for the NEXT page (null = no more, or a non-paged source);
  // `loaded`/`total` drive the "showing N of M" control. See loadTree/loadMoreRoots.
  rootsCursor: string | null;
  rootsLoaded: number;
  rootsTotal: number | null;
}

export const state: BoardState = {
  assignee: '',
  status: 'Open',
  project: null,
  sprint: null,
  search: '',
  lens: 'columns',
  me: null,
  caps: {},
  epics: [],
  orphanStories: [],
  orphanTasks: [],
  selEpic: null,
  selStory: null,
  expanded: new Set(),
  rootsCursor: null,
  rootsLoaded: 0,
  rootsTotal: null,
};

// Every node the client has fetched, by id.
const nodeIndex = new Map<string, CachedNode>();

/** Cache freshly-fetched nodes (first write wins, so a re-fetch doesn't replace
 *  the instance the views already hold). */
export function indexNodes(nodes: CachedNode[]): void {
  for (const n of nodes) if (!nodeIndex.has(n.id)) nodeIndex.set(n.id, n);
}
/** Look up a cached node by id. */
export function byId(id: string | null): CachedNode | null {
  return id ? nodeIndex.get(id) || null : null;
}
/** Drop the whole cache (on a full reload). */
export function clearNodes(): void { nodeIndex.clear(); }

/** Find a cached node's parent — the cached node whose loaded children include
 *  it. Nodes carry no parent pointer (hierarchy is expressed through children),
 *  so this scans the index. Returns null for a root, or when the parent isn't
 *  cached (its children were never loaded). One parent per node, so first match
 *  wins. */
export function parentOf(node: CachedNode): CachedNode | null {
  for (const n of nodeIndex.values()) if (n.children?.some((c) => c.id === node.id)) return n;
  return null;
}

// An epic's children arrive as one list (stories, then the tasks parented
// directly on the epic); split by kind. A story's children are all tasks.
export const storiesOf = (node: CachedNode | null): CachedNode[] => (node?.children || []).filter((n) => n.kind === 'story');
export const directTasksOf = (node: CachedNode | null): CachedNode[] => (node?.children || []).filter((n) => n.kind !== 'story');
