// Global type augmentations for the client's custom elements and events.
//
// These can't be expressed in a component's own module — `declare global` must
// live in an ambient .d.ts the client tsconfig includes. Two augmentations:
//   1. HTMLElementTagNameMap — so document.createElement('ledger-card') and
//      querySelector('ledger-card') return the element class, not HTMLElement.
//   2. HTMLElementEventMap — so addEventListener('card-open', …) types the
//      handler's event (and its .detail) instead of a bare Event.

import type { LedgerCard } from '../src/client/components/ledger-card';
import type { LedgerColumn } from '../src/client/components/ledger-column';
import type { LedgerDrawer } from '../src/client/components/ledger-drawer';
import type { LedgerCommentThread } from '../src/client/components/ledger-comment-thread';
import type { LedgerCompose } from '../src/client/components/ledger-compose';
import type { LedgerNode, Item, CreateInput } from '../src/shared/contract';

declare global {
  interface HTMLElementTagNameMap {
    'ledger-card': LedgerCard;
    'ledger-column': LedgerColumn;
    'ledger-drawer': LedgerDrawer;
    'ledger-comment-thread': LedgerCommentThread;
    'ledger-compose': LedgerCompose;
  }

  interface HTMLElementEventMap {
    // ledger-card: primary activation and the view-details affordance.
    'card-activate': CustomEvent<{ id: string; item: LedgerNode }>;
    'card-open': CustomEvent<{ id: string; item: LedgerNode }>;
    // ledger-drawer: an edit/comment write succeeded; carries the fresh item.
    'item-changed': CustomEvent<{ item: Item }>;
    // ledger-drawer: a per-section "Add <tier>" was clicked; carries the tier and
    // the open item as the (read-only) parent for the compose sheet.
    'item-add-child': CustomEvent<{ type: 'STORY' | 'TASK'; parentId: string; parentName: string; parentShortId: string | null; parentUrl: string | null; project: string | null }>;
    // ledger-compose: a create succeeded; carries the new item and the input that
    // made it (the input's parent/project place it in the tree — Item has no
    // parent pointer).
    'item-created': CustomEvent<{ item: Item; input: CreateInput }>;
    // ledger-column: the column's "+" affordance was clicked (the board knows
    // which tier from the column that emitted it).
    'column-add': CustomEvent<void>;
    // ledger-comment-thread: composer/row intents (the host performs the write).
    'comment-add': CustomEvent<{ message: string }>;
    'comment-edit': CustomEvent<{ id: string; message: string }>;
    'comment-delete': CustomEvent<{ id: string }>;
  }
}

export {};
