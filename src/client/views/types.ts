// The handlers a lens view needs from the board controller. Passing this in
// (rather than importing the board) keeps the module graph acyclic: board.ts
// imports the views, the views import only this type.

import type { CachedNode } from '../core/state.js';

export interface ViewHandlers {
  /** Drill into an epic (select it, load + show its stories/tasks). */
  selectEpic(id: string): void;
  /** Drill into a story (select it, load + show its tasks). */
  selectStory(id: string): void;
  /** Open the reading drawer for a node. */
  openDrawer(node: CachedNode): void;
  /** Expand/collapse an outline node (lazy-loads children on first expand). */
  toggleExpand(node: CachedNode): void;
}
