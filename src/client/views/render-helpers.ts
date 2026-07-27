// Small builders shared by both lenses: the column chrome factory, the card
// factory, and the empty/hint/lane-label/assignee-chip bits. Pure DOM
// construction — they take the data and the activation callbacks and return
// nodes, holding no board state themselves.

import { el, asButton } from '../components/util.js';
import { idTag } from '../components/shared-styles.js';
import type { LedgerColumn } from '../components/ledger-column.js';
import type { LedgerCard } from '../components/ledger-card.js';
import { state, type CachedNode } from '../core/state.js';

/** A <ledger-column>: shadow chrome + a light-DOM body its children slot into.
 *  `col` and `body` are the same node; both keys are kept so call sites read
 *  naturally (col-swaps use `col`, appends use `body`). */
export function column(tier: string, title: string, count: number): { col: LedgerColumn; body: LedgerColumn } {
  const col = document.createElement('ledger-column');
  col.dataset.tier = tier;             // used by selection-sync queries
  col.setAttribute('tier', tier);
  col.setAttribute('heading', title);
  col.setAttribute('count', String(count));
  return { col, body: col };
}

export interface CardOpts {
  drill?: boolean;
  animate?: boolean;
  onActivate?: (item: CachedNode) => void;
  onOpen?: (item: CachedNode) => void;
}

// Wire a <ledger-card> to an item and its activation handlers: `onActivate`
// fires on the primary click (drill into children), `onOpen` on the view-details
// affordance / a leaf card's click. dataset.id lets selection-sync find cards.
export function card(item: CachedNode, { drill = false, animate = false, onActivate, onOpen }: CardOpts = {}): LedgerCard {
  const c = document.createElement('ledger-card');
  c.dataset.id = item.id;
  if (drill) c.setAttribute('drill', '');
  if (animate) c.setAttribute('animate', '');
  // Mark epics whose source produces story/task rollups: the card then shows a
  // blank (loading) count area until the rollup lands, instead of the raw "N
  // within". Sources without the capability leave the attribute off and keep the
  // fallback badge.
  if (item.kind === 'epic' && state.caps.epicCounts) c.setAttribute('rollup', '');
  // Mark that the source has point estimates, so the card shows the points pill and
  // flags a missing estimate. Off => no points UI at all (a source without the
  // concept isn't nagged). Set via attribute so the card stays board-state-free.
  if (state.caps.points) c.setAttribute('points', '');
  c.item = item;
  if (onActivate) c.addEventListener('card-activate', () => onActivate(item));
  if (onOpen) c.addEventListener('card-open', () => onOpen(item));
  return c;
}

export function emptyMsg(a: string, b: string): HTMLElement {
  const d = el('div', 'col-empty'); d.append(el('div', null, a), el('div', null, b)); return d;
}
export function hint(a: string, b: string): HTMLElement {
  const d = el('div', 'col-hint'); d.innerHTML = `${a}<br>${b}`; return d;
}
export function laneLabel(text: string, direct = false): HTMLElement {
  return el('div', `lane-label${direct ? ' direct' : ''}`, text);
}

// The assignee chip for an outline row. A context node (present only to hold a
// matching descendant) gets the distinct treatment + tooltip, mirroring the card.
export function whoChip(item: CachedNode): HTMLElement {
  const w = el('span', 'who');
  w.innerHTML = `<b>${item.assignee}</b>`;
  if (item.context) {
    w.classList.add('context');
    w.title = `Assigned to ${item.assignee}. Shown because it holds items matching the current assignee filter.`;
  }
  return w;
}
