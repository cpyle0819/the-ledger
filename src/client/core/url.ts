// Deep linking: the board's view state lives in the URL hash, so a refresh or a
// copied link reproduces the same view — the filters, the selected epic/story
// (or expanded outline rows), and the open item.
//
// The hash carries this rather than the path because the host serves only known
// files: an unknown path 404s, so path routing would break the very refresh this
// restores. A fragment never reaches the server, so it needs no server change.
//
// Read: parseHash() turns location.hash into a UrlState (on load and on Back).
// Write: writeHash() serializes the live state. Filters and selection replace the
// current history entry (transient — Back shouldn't step through them); opening
// the drawer pushes an entry, so Back closes it.

import { state } from './state.js';
import type { StatusFilter } from '../../shared/contract';

// The slice of view state a link round-trips. Every field is optional: an absent
// field means its default (me / open / columns / nothing selected).
export interface UrlState {
  lens?: 'columns' | 'outline';
  assignee?: string;
  status?: StatusFilter;
  project?: string | null;
  epic?: string | null;
  story?: string | null;
  expanded?: string[];
  item?: string | null;
}

// Default values are omitted from the hash to keep links short; these are the
// values a missing key restores to.
const STATUS_TO_HASH: Record<StatusFilter, string> = { Open: '', Closed: 'closed', ALL: 'all' };
const HASH_TO_STATUS: Record<string, StatusFilter> = { closed: 'Closed', all: 'ALL' };

/** Parse the current location.hash into a UrlState. Unknown keys are ignored; an
 *  empty or absent hash yields an empty object (all defaults). */
export function parseHash(): UrlState {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return {};
  const p = new URLSearchParams(raw);
  const u: UrlState = {};
  if (p.get('lens') === 'outline') u.lens = 'outline';
  if (p.get('assignee')) u.assignee = p.get('assignee')!;
  const status = HASH_TO_STATUS[p.get('status') || ''];
  if (status) u.status = status;
  if (p.get('project')) u.project = p.get('project');
  if (p.get('epic')) u.epic = p.get('epic');
  if (p.get('story')) u.story = p.get('story');
  const exp = p.get('exp');
  if (exp) u.expanded = exp.split(',').filter(Boolean);
  if (p.get('item')) u.item = p.get('item');
  return u;
}

// Build the hash string from the live filter/selection state plus the open item.
// Only the fields relevant to the current lens are emitted (columns → epic/story;
// outline → the expanded set), so switching lenses drops the other lens's keys.
function buildHash(openItem: string | null): string {
  const p = new URLSearchParams();
  if (state.lens === 'outline') p.set('lens', 'outline');
  if (state.assignee) p.set('assignee', state.assignee);
  if (STATUS_TO_HASH[state.status]) p.set('status', STATUS_TO_HASH[state.status]);
  if (state.project) p.set('project', state.project);
  if (state.lens === 'outline') {
    if (state.expanded.size) p.set('exp', [...state.expanded].join(','));
  } else {
    if (state.selEpic) p.set('epic', state.selEpic);
    if (state.selStory) p.set('story', state.selStory);
  }
  if (openItem) p.set('item', openItem);
  return p.toString();
}

/** Reflect the live state into the URL. `push` adds a history entry (opening the
 *  drawer, so Back closes it); otherwise the current entry is replaced (filters and
 *  selection, which shouldn't fill the back stack). A no-op when the hash already
 *  matches, so redundant syncs don't churn history. */
export function writeHash(openItem: string | null, push = false): void {
  const next = buildHash(openItem);
  if (next === location.hash.replace(/^#/, '')) return;
  const url = next ? `#${next}` : location.pathname + location.search;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}
