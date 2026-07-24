// The board's light-DOM query helper. The board root (<ledger-board>) has no
// shadow root, so its children live in the document and are found with a plain
// querySelector. Element-creation helpers (el, asButton) live with the
// components (single source of truth); this is just the scoped lookup.

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel);

/** Non-null variant for elements known to exist in index.html (the masthead,
 *  stage, drawer). Throws if missing — a wiring bug, not a runtime condition. */
export const need = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const n = root.querySelector<T>(sel);
  if (!n) throw new Error(`Ledger: expected element ${sel}`);
  return n;
};
