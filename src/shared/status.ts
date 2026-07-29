// The Ledger — status semantics shared by the host and the client.
//
// `Status` (in ./contract) has three values, but almost no code cares about all
// three. Most sites mean one of two questions, and asking them through these
// helpers — rather than open-coding `=== 'Closed'` — is what keeps the third
// state (Abandoned / "Closed (not completed)") behaving correctly everywhere:
//
//   isClosed(s)   — is this a TERMINAL state? true for both Closed and Abandoned.
//                   Use for "hide by default", the closed stamp/tag, and any
//                   "done, whichever way" grouping. Abandoned is still closed.
//   isAbandoned(s)— is this specifically closed-WITHOUT-completion? Use where the
//                   two closes must diverge: exclude from velocity, suppress the
//                   missing-estimate / missing-start-date warnings.
//
// A plain `=== 'Closed'` still means "closed AND completed" and is correct where
// that's the intent (e.g. stamping a completion date only on a real completion).
// Unlike ./contract this module is NOT type-only: it emits runtime JS to both
// build outputs.

import type { Status } from './contract';

/** The display label for a status. Open/Closed are their own names; the third
 *  state reads "Closed (not completed)" so a viewer sees it as a kind of close. */
export const STATUS_LABEL: Record<Status, string> = {
  Open: 'Open',
  Closed: 'Closed',
  Abandoned: 'Closed (not completed)',
};

/** A terminal state — closed in any sense (completed OR abandoned). The board
 *  hides these by default and gives them the closed treatment. */
export function isClosed(status: Status): boolean {
  return status === 'Closed' || status === 'Abandoned';
}

/** Closed without having been completed. Excluded from velocity; never warned
 *  about missing estimates or dates. */
export function isAbandoned(status: Status): boolean {
  return status === 'Abandoned';
}
