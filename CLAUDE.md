# The Ledger — agent orientation

A personal, local-only task board that renders work from any backing system as
**Epics → Stories → Tasks**. TypeScript throughout (server + client), compiled
by `tsc -b` with no bundler — one `.js` per module. Server emits to `dist/`
(CommonJS), client to `public/build/` (ES modules). Plugins stay plain JS.

## Build / Run / Verify

- `npm run build` (or `tsc -b`) — compile. `npm run dev` for `--watch` mode.
- `npm run serve` — install deps + build + start on http://localhost:4317.
- A background service (`the-ledger.service`) usually already runs it. **The
  service bakes the compiled server into memory**, so after editing anything
  under `src/` or `plugins/`, rebuild and restart:
  `npm run build && systemctl --user restart the-ledger.service`.
- Verify UI changes by **rendering**, not by reasoning about layout: screenshot
  the live page in headless Chromium over CDP and look. Layout bugs hide from
  static reading.

## Source layout

```
src/
  shared/contract.ts        # THE SPINE: the typed data contract (LedgerNode, Item,
                            #   Capabilities, Project, Filters). Both halves reference it.
  server/
    server.ts               # plugin-agnostic HTTP host
    plugin-interface.ts     # loads + resolves + guards plugin methods
  client/
    app.ts                  # thin composition root: wires controls, defines <ledger-board>
    core/{state,api,board,sound}.ts   # model, fetch, orchestration, foley
    views/{columns,outline,render-helpers,types}.ts   # the two lenses
    ui/{dom,feedback,title-seal}.ts   # shared DOM/toast/loading, SVG masthead
    components/*.ts         # Web Components (see below)
```

`dist/` (server CommonJS) and `public/build/` (client ES modules) are compiled
output — gitignored, never committed. Rebuild from source with `npm run build`.

## The UI is Web Components — this is the core convention

The frontend is a **composition of custom elements**, not one script driving a
shared document. When you add or change UI, you work in components. New reusable,
visually-encapsulated UI should become a custom element, not markup appended to
`app.ts`.

Components live in `src/client/components/`, one self-registering module each:

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
  global styling in `public/base.css`. Defined in `app.ts`.
- `markdown.ts`, `shared-styles.ts`, `util.ts` — shared helpers: the markdown
  renderer, the constructable `chromeSheet` for leaf chrome (chip/pill/id-tag),
  and DOM utilities (`el`, `asButton`, `copyLink`, `relTime`). These are the
  **single source of truth** for these functions — no duplicates elsewhere.

### Conventions that keep the composition working

- **Light DOM vs Shadow DOM:** shadow DOM for reusable, visually-encapsulated
  leaves (card, column, drawer, thread); light DOM for the structural root that
  orchestrates and owns state (`ledger-board`). Data flows **down** as properties,
  events flow **up** as `CustomEvent`s with `{ bubbles: true, composed: true }`
  (composed is required to cross a shadow boundary).
- **Theming is layered, and themes are npm packages like plugins.**
  `public/base.css` is the theme-agnostic skeleton: layout, a11y, motion, and a
  COMPLETE neutral `:root` token baseline (flat grey, system font, no texture). A
  theme is an **external npm package** (published from the `ledger-themes`
  monorepo — github.com/cpyle0819/ledger-themes — as `@cpyle0819/ledger-theme-<id>`)
  carrying a `ledgerTheme` block in its package.json and its own deps (the-ledger
  owns `smoke-drift`). Its `theme.css` overrides the tokens and paints its own
  decoration (backdrop, card surface, edge filters); assets referenced relative
  resolve against the served stylesheet. The active theme's distinctive look must
  live ONLY in its package: the test is that an empty theme resolves to the
  neutral baseline, not to any real theme. The server (`server/theme-interface.ts`)
  discovers every installed theme package into the `/api/themes` registry and
  serves each theme's assets under `/theme/<id>/…` (own files) and
  `/theme/<id>/@dep/<specifier>` (a theme dependency, e.g. smoke-drift).
  `core/theme.ts` fetches the registry, resolves the active theme (localStorage →
  ledger.config.json `theme` via /api/source → registry default), and swaps the
  stylesheet/fonts/logo/ambient/sounds live. Add a theme by installing its
  package (`npm install @cpyle0819/ledger-theme-<id>`, or any third-party theme
  package) — no code change. The two bundled themes live in the ledger-themes
  monorepo, not here.
- **Theming crosses the shadow boundary for free:** the `:root` design tokens are
  CSS custom properties, which inherit through shadow roots. Components read
  `var(--token, fallback)`; there is no per-component theming machinery.
- **Non-CSS decoration is a token too.** A surface a theme can't express in a
  plain colour — the card's layered background + torn-edge SVG filter, the panel
  sheets — is a RECIPE token (`--card-surface`, `--deckle-filter`, `--card-frame`,
  `--sheet-surface`, …) the component reads. A theme restyles the surface by
  setting the recipe (e.g. `--deckle-filter: none` for a machined card), never by
  editing the component.
- **Logo and ambient are theme-provided components,** declared in the manifest as
  `{tag, src, attrs}` and mounted by one generic `mountComponent` in `core/theme.ts`
  (no theme-id branching). The logo falls back to the-ledger's `<ledger-mark>`;
  ambient (the `<smoke-drift>`-style backdrop drift) is optional. A theme ships its
  own by declaring one — the controller understands no specific tag or attr.
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

- `src/server/server.ts` — plugin-agnostic host. Loads one active source and
  exposes `/api/source`, `/api/children`, `/api/item/:id`, `…/edit`,
  `…/comment`, `/api/assignees`, `/api/steps`.
- `src/server/plugin-interface.ts` — resolves capabilities, guards every host→plugin
  call, and loads the active source. Each plugin is an npm package; the active one
  is named in `ledger.config.json` (`source`), resolved as a package name or a
  repo-relative path. Absent config → the bundled `the-ledger-local-file`.
- `src/shared/contract.ts` — the typed shapes (LedgerNode, Item, Capabilities,
  Filters, …) that both halves reference. Type-only imports erase at runtime.
- `plugins/<name>/` — one source each, a plain-JS npm package (`package.json` +
  `index.js`). `local-file` is the bundled reference source; `github` also ships.
  A plugin that wraps a private/internal backend is gitignored here and
  version-controlled separately (declared as a dependency or pointed at by path).
- The hierarchy loads **lazily** via `getChildren(parentId, filters)` — null
  parent = roots (epics). A source declares **capabilities**; the UI hides actions
  a source can't perform.

See `README.md` for the full run/build/auth story.
