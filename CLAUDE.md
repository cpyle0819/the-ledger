# The Ledger — agent orientation

A personal, local-only task board that renders work from any backing system as
**Epics → Stories → Tasks**. Node CommonJS server, **no build step** — plain ES
modules and CSS served straight from `public/` to the browser.

## Run / verify

- `npm run serve` — install deps + start on http://localhost:4317.
- A background service (`the-ledger.service`) usually already runs it. **The
  service bakes the server code into memory**, so after editing `server.js`,
  `lib/`, or `plugins/`, restart it: `systemctl --user restart the-ledger.service`.
  **Frontend edits** (anything under `public/`) need no restart — just reload.
- Verify UI changes by **rendering**, not by reasoning about layout: screenshot
  the live page in headless Chromium over CDP and look. Layout bugs hide from
  static reading.

## The UI is Web Components — this is the core convention

The frontend is a **composition of custom elements**, not one script driving a
shared document. When you add or change UI, you work in components. New reusable,
visually-encapsulated UI should become a custom element, not markup appended to
`app.js`.

Components live in `public/components/`, one self-registering ES module each:

- `ledger-card` — a parchment slip for one item. **Shadow DOM.** Takes an `item`
  property; emits composed `card-activate` / `card-open`.
- `ledger-column` — one columns-lens column. **Shadow DOM** for chrome; slots its
  cards as light-DOM children.
- `ledger-comment-thread` — comment list + composer. **Shadow DOM.** Emits
  `comment-add` / `comment-edit` / `comment-delete`.
- `ledger-drawer` — the whole reading overlay (fields, description editor,
  typeahead, contains list, focus trap). **Shadow DOM.** Host injects services
  (`api`, `fetchChildren`, `caps`, `sfx`, `toast`); emits `item-changed`.
- `ledger-board` — the app root. **Light DOM** (no shadow): it owns the model,
  filters, and lens orchestration; its masthead/controls/stage children keep the
  global styling in `styles.css`. Defined in `app.js`.
- `markdown.js`, `shared-styles.js`, `util.js` — shared helpers: the markdown
  renderer, the constructable `chromeSheet` for leaf chrome (chip/pill/id-tag),
  and DOM utilities (`el`, `asButton`, `copyLink`, `relTime`).

### Conventions that keep the composition working

- **Light DOM vs Shadow DOM:** shadow DOM for reusable, visually-encapsulated
  leaves (card, column, drawer, thread); light DOM for the structural root that
  orchestrates and owns state (`ledger-board`). Data flows **down** as properties,
  events flow **up** as `CustomEvent`s with `{ bubbles: true, composed: true }`
  (composed is required to cross a shadow boundary).
- **Theming crosses the boundary for free:** the `:root` design tokens in
  `styles.css` are CSS custom properties, which inherit through shadow roots.
  Components read `var(--token, fallback)`; there is no per-component theming
  machinery. Restyle the whole app from `:root`.
- **Styles are constructable stylesheets** adopted per shadow root
  (`new CSSStyleSheet()` + `replaceSync()` + `adoptedStyleSheets`), not `<style>`
  tags. Shared leaf chrome comes from `shared-styles.js`; component-specific rules
  live in the component.
- **`connectedCallback` must be idempotent** — guard shadow-root creation with
  `if (!this.shadowRoot)`. Register at module end with a
  `if (!customElements.get('…'))` guard.
- **SVG filter references (`url(#id)`) are tree-scoped.** A document-level filter
  is unreachable from inside a shadow root — inline the `<svg><filter>` into the
  component's own shadow root (see the deckle filter in `ledger-card.js`).
- Spacing between slotted elements lives on the element's `:host`, not on a parent
  rule — a card's own bottom margin, for instance, is a `:host` rule.

## Backend shape

- `server.js` — plugin-agnostic host. Loads one active source and exposes
  `/api/source`, `/api/children`, `/api/item/:id`, `…/edit`, `…/comment`,
  `/api/assignees`, `/api/steps`.
- `lib/plugin-interface.js` — the contract every source implements: capability
  declaration, timeout/guard wrapper, `loadActiveSource()`.
- `plugins/<name>/` — one source each. `local-file` is the bundled reference
  source. Select with `LEDGER_SOURCE` (default `local-file`).
- The hierarchy loads **lazily** via `getChildren(parentId, filters)` — null
  parent = roots (epics). A source declares **capabilities**; the UI hides actions
  a source can't perform.

See `README.md` for the full run/auth story and `ROADMAP.md` for target features.
