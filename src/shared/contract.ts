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

/** The item's lifecycle state. `Open` and `Closed` are the two states every
 *  source supports: a source maps its own native states (a tracker's Resolved, a
 *  GitHub close reason, …) onto one of them on read. `Abandoned` — displayed as
 *  "Closed (not completed)" — is a THIRD, closed-but-unfinished state that only
 *  sources declaring the `incompleteClose` capability ever produce; for every
 *  other source the board never sees it. It is a terminal state (see isClosed): it
 *  hides by default and wears the closed treatment like any close, but it is
 *  excluded from velocity and never draws a missing-estimate/date warning (an
 *  item abandoned unfinished is not nagged to fill in data it will never need).
 *  Richer per-source step detail rides on `workflowAction`, not here. See the
 *  status predicates in ./status. */
export type Status = 'Open' | 'Closed' | 'Abandoned';

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
  /** A free-text query the viewer typed. The board passes it through verbatim and
   *  ascribes no meaning to it — each source decides what matching a string means
   *  against its own items (a backing search API, or a narrowing on one field). An
   *  empty/absent value is no query (every item passes). Like the assignee filter,
   *  it matches at every level: a matching item deep in a tree pulls its ancestors
   *  in as context, so a deep match isn't lost. */
  search?: string;
  /** A sprint id (a Sprint.id) the board scopes to: only tasks belonging to that
   *  sprint pass, and — like the assignee and search filters — a matching task
   *  deep in a tree pulls its ancestors in as context, so a sprint's tasks render
   *  under their real epics/stories rather than in a flat list. A null/absent value
   *  is no sprint scope (every item passes). Only sources declaring the `sprints`
   *  capability ever receive it; every other source sees the field absent. Sprint
   *  membership is a task-tier concept, so this narrows the task set and rolls its
   *  ancestors up; it never matches a story or epic directly. */
  sprint?: string | null;
  /** Request source-accurate node fields even when that costs extra reads. A
   *  source whose LIST query returns a lagging/eventually-consistent projection
   *  (e.g. a search index behind the authoritative by-id read) can, when this is set,
   *  re-read each returned node from the consistent store so estimates and other
   *  fields are exact. The drawer's Planning rollup sets it — capacity math must be
   *  source-accurate — accepting the extra per-node reads. A source whose list read
   *  is already authoritative ignores the flag. Off by the board's own fast paths. */
  accurate?: boolean;
}

/** The story/task rollup shown on an epic card, replacing the raw "N within".
 *  `stories` is the epic's immediate story children; `tasks` is its direct task
 *  children plus the tasks under those stories. Both honor the same filters as
 *  the board, so the numbers describe exactly what the current view contains. */
export interface EpicCounts {
  stories: number;
  tasks: number;
}

/** A rough velocity rollup for an epic: story points completed per working day
 *  across the epic's whole task tree. `points` sums the estimates of every task
 *  (direct or under a story) that has a computable duration (both a start and a
 *  completion date). `days` is the BUSINESS-DAY SPAN — weekdays from earliest start
 *  to latest completion across those same tasks, weekends excluded — not the sum of
 *  per-task durations, so parallel work counts once. `pointsPerDay` is points/days
 *  (null when days is 0, e.g. every qualifying task finished the day it started).
 *  `tasksCounted` is how many tasks contributed, so the UI can caveat a figure drawn
 *  from few samples. Unlike EpicCounts this is a HISTORICAL metric over completed
 *  work, so it spans all statuses and ignores the board's status filter — but a
 *  source that can tell an abandoned close from a completion (the incompleteClose
 *  capability) excludes the abandoned tasks, since work dropped unfinished never
 *  "delivered" its points.
 *
 *  `openPoints` is the forward-looking counterpart: the summed estimate of the
 *  epic's still-open tasks (not closed, not abandoned), in the same task-point
 *  units as `points`. Dividing it by `pointsPerDay` yields a rough estimated working
 *  days remaining, so the two figures share one rollup. */
export interface EpicVelocity {
  points: number;
  days: number;
  pointsPerDay: number | null;
  tasksCounted: number;
  openPoints: number;
}

/** A time-boxed grouping of tasks — an Agile/Scrum sprint. Orthogonal to the
 *  Epic/Story/Task hierarchy: a sprint is NOT a fourth tier but a cross-cutting
 *  box that collects tasks living anywhere in the tree. Membership is task-only
 *  (see addTaskToSprint). Produced only by sources declaring the `sprints`
 *  capability. */
export interface Sprint {
  /** Stable unique id the source keys on (used for get/delete/membership calls). */
  id: string;
  /** The sprint's display name. */
  name: string;
  /** The sprint's goal or free-text detail. Empty when unset. */
  goal: string;
  /** ISO start date (date-only, YYYY-MM-DD). */
  startDate: string;
  /** ISO end date (date-only, YYYY-MM-DD). Inclusive of the sprint's last day. */
  endDate: string;
  /** Lifecycle state, derived by the source: `future` before the start date,
   *  `active` between start and end, `closed` past the end date or when the source
   *  marks the sprint done. Selects the "current sprint". A source whose backing
   *  store carries no explicit close reports state from the dates alone. */
  state: SprintState;
  /** The project (a Project.id) the sprint lives in, or null when unscoped. A
   *  source that scopes sprints to a project (a room/folder) always sets it; it
   *  is the dimension findSprints filters on. */
  project: string | null;
}

/** A sprint's lifecycle state. See Sprint.state. */
export type SprintState = 'future' | 'active' | 'closed';

/** A create-sprint request. `project` places the sprint in a grouping (a
 *  room/folder); a source that requires one (as Maxis does) rejects an absent
 *  project. State is never an input — the source derives it from the dates and the
 *  current time. */
export interface SprintInput {
  name: string;
  startDate: string;
  endDate: string;
  goal?: string;
  project?: string | null;
}

/** A patch to an existing sprint: a present field is written, an absent field is
 *  left unchanged (not cleared). State is derived, not patchable; project is fixed
 *  at create and not moved here. */
export interface SprintPatch {
  name?: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

/** The filter a findSprints call narrows on. `project` scopes to one grouping (the
 *  common case — a board shows one project's sprints); absent means every project
 *  the viewer can see. `state` narrows to one lifecycle state (e.g. only `active`);
 *  absent means all states. */
export interface SprintFilter {
  project?: string | null;
  state?: SprintState;
}

/** A page of root nodes with an optional continuation cursor — the contract's
 *  lazy-loading primitive. A source whose root set can be large (a broad, unscoped
 *  browse across everyone's work) returns roots one page at a time instead of in
 *  one call: `nodes` is the CUMULATIVE set of roots loaded so far (the board
 *  re-derives its lanes from it wholesale — loading more is purely additive, a
 *  partial page's roots are still correct for what they contain), `cursor` is an
 *  opaque token passed back to fetch the next page (null once the last page has
 *  been reached), and `total`/`loaded` are the match total and how many have been
 *  loaded so the UI can show progress ("showing N of M") and a "load more" control.
 *
 *  A source that needn't paginate simply doesn't implement getRoots (and leaves
 *  the pagedRoots capability off); the board then loads every root in one
 *  getChildren(null) call, exactly as before. Pagination is a ROOTS-level concern
 *  (browse breadth) — a drilled parent's children are bounded and always loaded
 *  whole via getChildren. */
export interface NodePage {
  nodes: LedgerNode[];
  /** Opaque continuation token; pass back to getRoots to fetch the next page.
   *  Null when the last page has been reached (no "load more"). */
  cursor: string | null;
  /** Total matches across all pages, when the source knows it (for "of M"); null
   *  when the source can't cheaply count. */
  total: number | null;
  /** How many matches have been loaded so far (the "N" in "showing N of M"). */
  loaded: number;
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
  /** ISO start date, when a source carries it on the list node (task-tier, gated
   *  by taskDates). Present so the board can flag a closed task with no start date
   *  without a per-item fetch — mirrors `estimate` living on the node for the
   *  missing-estimate flag. The full Item always has it; a node may too. */
  startDate?: string | null;
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
  /** Plugin-defined fields keyed by CustomFieldDef.key. The drawer renders these in
   *  a "Custom Fields" section, one control per def whose tier matches the item.
   *  Each value is the display-ready scalar the plugin returns (the drawer formats
   *  nothing). Absent or empty when the source declares no custom fields. */
  customFields?: Record<string, string | number | null>;
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

/** A plugin-defined field the drawer renders without knowing the backing model.
 *  The plugin declares these in capabilities; the drawer renders one control per
 *  def whose tier matches the open item, reading/writing via the standard
 *  editField endpoint (the def's `key` is the field name). */
export interface CustomFieldDef {
  /** The key passed to editField and returned in Item.customFields. */
  key: string;
  /** Human-facing label shown beside the control. */
  label: string;
  /** Control type the drawer renders. */
  type: 'number' | 'text';
  /** Which tiers show this field; absent/empty = all tiers. */
  tiers?: Kind[];
  /** When true, the drawer shows the value but offers no edit control. */
  readOnly?: boolean;
}

/** The fields a source may allow editing. The board gates each field's control
 *  on membership in Capabilities.editFields. */
export type EditableField = 'title' | 'status' | 'description' | 'assignee' | 'estimate' | 'workflowAction' | 'startDate';

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
  /** Whether the source can compute an epic's points-per-day delivery rate
   *  (backed by epicVelocity). Requires task start/completion dates and point
   *  estimates to be meaningful; when absent, the epic drawer shows no velocity
   *  line. */
  epicVelocity: boolean;
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
  /** Whether the source can distinguish a close that COMPLETED the work from one
   *  that abandoned it unfinished (the 'Abandoned' status, shown as "Closed (not
   *  completed)"). When present: the status select offers the not-completed
   *  option, velocity excludes abandoned tasks, and an abandoned item draws no
   *  missing-estimate/date warnings. When absent, no source ever produces
   *  'Abandoned' and the board behaves exactly as before — every close is a
   *  completion. Gated so a source with no such concept (e.g. a tracker whose
   *  terminal states are indistinguishable) simply folds every close to 'Closed'. */
  incompleteClose: boolean;
  /** Whether the source loads ROOTS in pages (backed by getRoots), for a browse
   *  whose match set can be large — the board shows a "load more" control and a
   *  "showing N of M" count instead of blocking on the whole set. When absent, the
   *  board loads every root in one getChildren(null) call, as it always has. This
   *  gates only how roots arrive; drilling a parent's children is unaffected. */
  pagedRoots: boolean;
  /** Whether the source supports Agile/Scrum sprints — the sprint CRUD family
   *  (findSprints, getSprint, createSprint, updateSprint, deleteSprint) and task
   *  membership (addTaskToSprint, removeTaskFromSprint), plus the `sprint` filter
   *  dimension on getChildren/getRoots. Trusted only when the backing methods
   *  exist. When absent, the board offers no sprint controls and never sends a
   *  `sprint` filter. */
  sprints: boolean;
  /** Plugin-defined fields rendered in the drawer's custom fields section. Each
   *  def declares its key, label, control type, and which tiers it applies to. The
   *  drawer reads values from Item.customFields and writes via editField(id, key,
   *  value). An absent/empty array means no custom fields. */
  customFields?: CustomFieldDef[];
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
   *  otherwise that node's visible children. When the source implements getRoots,
   *  the board uses it for the roots (parentId null) and getChildren only for
   *  drilling a specific parent — but getChildren must still handle a null parent
   *  (it's the non-paged path and the contract's floor). */
  getChildren(parentId: string | null, filters: Filters): MaybePromise<LedgerNode[]>;

  /** Load one page of roots, for a source that paginates a large browse (gated by
   *  the pagedRoots capability). `cursor` null starts a fresh page-1 load; a cursor
   *  returned by a prior page continues from there. Returns the CUMULATIVE roots
   *  loaded through this page plus the next cursor and progress counts (see
   *  NodePage) — cumulative so the board re-derives its lanes wholesale and loading
   *  more never re-parents what's shown. A source without it falls back to
   *  getChildren(null), which loads every root at once. */
  getRoots?(cursor: string | null, filters: Filters): MaybePromise<NodePage>;
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

  /** Compute the epic's points-per-day delivery rate across its whole task tree.
   *  A HISTORICAL rollup over completed work: it spans all statuses (a status
   *  filter would exclude the very closed tasks it measures), so it takes no
   *  Filters. Gated by the epicVelocity capability; the drawer calls it lazily
   *  when an epic opens, so a slow rollup never blocks the drawer's first paint. */
  epicVelocity?(epicId: string): MaybePromise<EpicVelocity>;

  /** The sprint family, gated by the `sprints` capability. A source implements all
   *  seven or none — the host trusts the flag only when every method exists. Sprints
   *  are orthogonal to the hierarchy (see Sprint): these operate on the sprint
   *  grouping and its task membership, never on the Epic/Story/Task tree itself.
   *  The `sprint` filter on getChildren/getRoots is what surfaces a sprint's tasks
   *  on the board; these methods manage the sprints and their membership. */

  /** Sprints matching the filter (by project and/or state). An empty/absent filter
   *  lists every sprint the viewer can see. */
  findSprints?(filter: SprintFilter): MaybePromise<Sprint[]>;
  /** One sprint by id. */
  getSprint?(id: string): MaybePromise<Sprint>;
  /** Create a sprint from a validated SprintInput and return it. */
  createSprint?(input: SprintInput): MaybePromise<Sprint>;
  /** Apply a patch to a sprint and return the updated Sprint. */
  updateSprint?(id: string, patch: SprintPatch): MaybePromise<Sprint>;
  /** Delete the sprint grouping. Never touches the member tasks — they lose their
   *  membership in this sprint and are otherwise unchanged. */
  deleteSprint?(id: string): MaybePromise<void>;

  /** Add a task to a sprint and return the updated task Item. Rejects a non-task
   *  (a story or epic) — sprint membership is task-only (see Sprint). */
  addTaskToSprint?(sprintId: string, taskId: string): MaybePromise<Item>;
  /** Remove a task from a sprint and return the updated task Item. */
  removeTaskFromSprint?(sprintId: string, taskId: string): MaybePromise<Item>;
}

/** A plugin method may answer synchronously or with a Promise; the host awaits
 *  both the same way. */
export type MaybePromise<T> = T | Promise<T>;
