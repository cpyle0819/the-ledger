// The Ledger — the data contract shared by the host and the client.
//
// This is the spine of the app: the Epic/Story/Task shapes every source plugin
// produces and every view consumes. It was previously prose in the plugin
// interface; here it is a checkable type surface both halves import. It is
// type-only — `import type` erases at compile time, so nothing ships at runtime
// and neither the CommonJS server nor the browser client loads this module.
//
// A source plugin renders one backing system (an issue tracker, a code host, a
// local file) into these shapes. The board renders every plugin identically and
// hides the actions a plugin doesn't advertise (see Capabilities).

/** The three tiers of the hierarchy. `kind` is derived from `type` by the source. */
export type Kind = 'epic' | 'story' | 'task';

/** The item's lifecycle state: binary. Every source maps its own native states
 *  (tracker's Resolved, a GitHub close reason, …) onto exactly one of these two on
 *  read; the board never sees anything else. Richer per-source step detail rides
 *  on `workflowAction`, not here. */
export type Status = 'Open' | 'Closed';

/** The status filter the board sends down: open-only, closed-only, or all. */
export type StatusFilter = 'Open' | 'Closed' | 'ALL';

/** A source's own grouping the viewer belongs to (a folder / room / repo). It
 *  scopes the hierarchy as one more filter dimension. `id` is the value the
 *  source keys its items on, so it round-trips through the filter untranslated. */
export interface Project {
  id: string;
  name: string;
}

/** The filters threaded through getChildren. `assignee` 'anyone' disables the
 *  assignee match; a null/absent `project` means every project (unscoped). */
export interface Filters {
  status: StatusFilter;
  assignee?: string;
  project?: string | null;
}

/** The story/task rollup shown on an epic card, replacing the raw "N within".
 *  `stories` is the epic's immediate story children; `tasks` is its direct task
 *  children plus the tasks under those stories. Both honor the same filters as
 *  the board, so the numbers describe exactly what the current view contains. */
export interface EpicCounts {
  stories: number;
  tasks: number;
}

/** A cheap list node — what getChildren returns. Rich enough to render a card
 *  without a per-item fetch; the full Item is fetched lazily when a drawer opens. */
export interface LedgerNode {
  /** Stable unique id the source keys on (used for children/read calls). */
  id: string;
  /** Human-facing short id shown on the card ("№ …"). */
  shortId: string;
  kind: Kind;
  /** Uppercase tier/type label (EPIC, STORY, TASK, BUG, …) driving the chip. */
  type: string;
  title: string;
  status: Status;
  assignee: string | null;
  /** The project this node belongs to (a Project.id), or null when unscoped. */
  project: string | null;
  /** How many items are parented directly on this node — decides expandability
   *  without a fetch. */
  childCount: number;
  /** Present only as an ancestor of a match (assigned elsewhere): the board
   *  renders it distinctly. Absent/false means a normal match. See the rollup
   *  contract in the plugin interface. */
  context?: boolean;
  /** The item's link in its backing system. The board builds no URL itself —
   *  when present it shows a copy/open affordance, when absent the id is plain
   *  text. A source with no per-item web address omits it. */
  url?: string;
  /** Some sources carry a workflow step distinct from status; shown in place of
   *  status on the card/pill when present. */
  workflowAction?: string | null;
  /** Estimate in points, when a source carries it on the list node (shown as a
   *  card pill). The full Item always has it; a node may too. */
  estimate?: number | null;
}

/** One comment on an item. */
export interface Comment {
  id: string;
  message: string;
  contentType: string;
  author: string | null;
  /** Whether the viewer authored it (gates edit/delete affordances). */
  isMine: boolean;
  createDate: string | null;
  lastUpdatedDate: string | null;
}

/** A fully-read item: a node plus its description and comment thread. Returned
 *  by readItem/editField/addComment. */
export interface Item extends LedgerNode {
  description: string;
  descriptionContentType: string;
  estimate: number | null;
  /** ISO date a task was started. Editable in the drawer (task-only, gated by the
   *  taskDates capability). Null when unset. */
  startDate: string | null;
  /** ISO date a task was completed. Written by the SOURCE when the task moves to a
   *  closed status — never user-editable; cleared if the task reopens. Null while
   *  open. Task-only, gated by the taskDates capability. */
  completionDate: string | null;
  comments: Comment[];
  createDate: string | null;
  lastUpdatedDate: string | null;
}

/** A person returned by the assignee typeahead (searchAssignees). */
export interface User {
  alias: string;
  fullName: string;
  jobTitle?: string;
}

/** The fields a source may allow editing. The board gates each field's control
 *  on membership in Capabilities.editFields. */
export type EditableField = 'status' | 'description' | 'assignee' | 'estimate' | 'workflowAction' | 'startDate';

/** The fields a create request may carry. A source declares which it accepts in
 *  Capabilities.createFields (parallel to editFields); the compose UI shows a
 *  control per declared field. `type` (the tier/type) and `title` are the
 *  minimum a create needs; the rest are optional placement/detail. */
export type CreatableField = 'type' | 'title' | 'parent' | 'project' | 'assignee' | 'description' | 'estimate';

/** A create request the host validates against a source's declared createFields
 *  before calling createItem. `type` and `title` are always required; every other
 *  field is honored only when the source declares it in createFields. `parent` is
 *  the id of the item the new one is parented on (null/absent => a root). */
export interface CreateInput {
  /** The tier/type label (EPIC, STORY, TASK, BUG, …); the source derives `kind`. */
  type: string;
  title: string;
  parent?: string | null;
  project?: string | null;
  assignee?: string | null;
  description?: string;
  estimate?: number | null;
}

/** What a source can do, as the host resolves it (a declared flag is trusted
 *  only when the backing method actually exists — see resolveCapabilities). The
 *  board reads this once and hides actions the source can't perform. */
export interface Capabilities {
  hierarchy: boolean;
  readItem: boolean;
  /** The subset of fields the drawer may edit; empty disables editing. */
  editFields: EditableField[];
  /** Whether the source can create items (backed by createItem). */
  create: boolean;
  /** The subset of fields a create request may carry; the compose UI gates each
   *  control on membership. Meaningful only when `create` is true. */
  createFields: CreatableField[];
  comment: boolean;
  editOwnComments: boolean;
  searchAssignees: boolean;
  stepOptions: boolean;
  projects: boolean;
  attachments: boolean;
  /** Whether the source can roll up story/task counts for a set of epics
   *  (backed by countEpicTasks). When absent, the card falls back to the raw
   *  "N within" child count. */
  epicCounts: boolean;
  /** Whether the source's items carry point estimates at all. When absent, the UI
   *  shows no estimate figures, no planning risk meter, and no missing-estimate
   *  warnings — a source with no concept of points (e.g. GitHub issues) isn't
   *  nagged to fill in a field it doesn't have. Distinct from editFields carrying
   *  'estimate', which is write permission, not whether the concept exists. */
  points: boolean;
  /** Whether the source's tasks carry start/completion dates. When absent, the
   *  drawer shows neither the editable start-date field nor the read-only
   *  completion-date line. Start date is editable (gated additionally by
   *  editFields carrying 'startDate'); completion date is written by the source
   *  when a task closes and is never user-editable. Task-tier only. */
  taskDates: boolean;
}

/** The plugin contract every source implements. A source module exports a
 *  factory `(hostConfig) => SourcePlugin`. Every method may return a value or a
 *  Promise; the host awaits uniformly, so a local-file source can be synchronous
 *  and a network source async through one host code path. Optional methods are
 *  gated by the matching capability. */
export interface SourcePlugin {
  name: string;
  /** The contract major version this plugin targets. */
  apiVersion: number;
  /** The viewer's identity in this source (the default assignee filter). */
  me: string;
  /** What the plugin declares it can do (the host re-resolves against methods). */
  capabilities: Partial<Capabilities> & { editFields?: EditableField[] };

  /** parentId null => roots (matching epics + matching orphan stories/tasks);
   *  otherwise that node's visible children. */
  getChildren(parentId: string | null, filters: Filters): MaybePromise<LedgerNode[]>;
  readItem(id: string): MaybePromise<Item>;
  editField(id: string, field: EditableField, value: unknown): MaybePromise<Item>;
  addComment(id: string, message: string): MaybePromise<Item>;

  /** Create a new item from a validated CreateInput and return it, so the caller
   *  can place it in the tree without a reload. Gated by the create capability. */
  createItem?(input: CreateInput): MaybePromise<Item>;
  editComment?(id: string, commentId: string, message: string): MaybePromise<Item>;
  deleteComment?(id: string, commentId: string): MaybePromise<Item>;
  searchAssignees?(query: string): MaybePromise<User[]>;
  stepOptions?(opts: { project?: string | null }): MaybePromise<string[]>;
  listProjects?(): MaybePromise<Project[]>;

  /** Roll up each epic's story/task counts under the given filters, keyed by
   *  epic id. Missing/absent epics simply don't appear in the map. Gated by the
   *  epicCounts capability; the board calls it after the roots render, so a slow
   *  or unavailable rollup never blocks the first paint. */
  countEpicTasks?(epicIds: string[], filters: Filters): MaybePromise<Record<string, EpicCounts>>;
}

/** A plugin method may answer synchronously or with a Promise; the host awaits
 *  both the same way. */
export type MaybePromise<T> = T | Promise<T>;
