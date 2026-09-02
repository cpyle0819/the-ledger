// The handlers a lens view needs from the board controller. Passing this in
// (rather than importing the board) keeps the module graph acyclic: board.ts
// imports the views, the views import only this type.

import type { CachedNode } from '../core/state.js';

/** A request to compose a new item of a fixed tier, optionally under a parent
 *  node. Both are decided by which add affordance fired (a column "+", a drawer
 *  section), so the compose sheet opens with type and parent locked. `parentNode`
 *  is the cached parent (null for a root); the sheet reads its title to show the
 *  parent by name and its id/project to place and scope the new item. */
export interface AddRequest {
  type: 'EPIC' | 'STORY' | 'TASK';
  parentNode: CachedNode | null;
}

export interface ViewHandlers {
  /** Drill into an epic (select it, load + show its stories/tasks). */
  selectEpic(id: string): void;
  /** Drill into a story (select it, load + show its tasks). */
  selectStory(id: string): void;
  /** Open the reading drawer for a node. */
  openDrawer(node: CachedNode): void;
  /** Reassign a node to the current user (the card's "assign to me" action). */
  assignToMe(node: CachedNode): void;
  /** Expand/collapse an outline node (lazy-loads children on first expand). */
  toggleExpand(node: CachedNode): void;
  /** Open the compose sheet for a new item of a fixed tier/parent. */
  addItem(req: AddRequest): void;
}
