# Roadmap

Desired features and improvements for the app, roughly in priority order. Each
entry names the target state, not the steps to get there.

## Everything is a Web Component

Rebuild the UI so every piece (board, column, card, drawer, comment thread,
title) is a custom element with its own Shadow DOM. The app becomes a
composition of these elements rather than one monolithic script driving a shared
document.

- Styles are encapsulated per component; theming is driven by CSS custom
  properties exposed on each element, so a host can restyle the whole app by
  setting a few variables.
- Components are usable outside this app: register the element, pass attributes,
  and it renders, the way `<smoke-drift>` already works.

## Pluggable data sources

Re-architect around a plugin interface so The Ledger is an opinionated task
board that renders work from any backing system. A plugin extracts items from one
source (an issue tracker, a code host, a local file) and maps them into The
Ledger's Epic/Story/Task model; the board renders any plugin identically.

- The current bundled integration becomes the first plugin, behind the same
  interface every other plugin implements.
- The interface covers the operations the board already needs: list the
  hierarchy, read one item, edit fields, comment, and (once solved) attachments.
- A plugin declares what it supports, so the UI can hide actions a given source
  can't perform.
