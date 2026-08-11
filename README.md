# The Ledger

A personal, local-only task board that makes **Epics → Stories → Tasks** the
native spine of the view. It renders work from any backing system — an issue
tracker, a code host, a local file — through a common plugin interface, so every
source looks and behaves the same on the board. Not a task system of its own — a
lens on work that lives elsewhere.

- **Columns lens** (Miller): Epics ▸ Stories ▸ Tasks, drill left-to-right.
- **Outline lens**: the whole tree nested, collapsible.
- Tasks parented **directly on an epic** (not under a story) get their own lane so
  they're never lost between levels.
- Default view: epics assigned to you. Any level is filterable by assignee
  (me / anyone / a specific alias) and status.
- Read **and** write: edit status, assignee, and description live — changes go
  straight to the source, attributed to you, and are reversible.
- Every source is a plugin against one interface: list the hierarchy, read an
  item, edit fields, comment. A plugin declares what it supports, so the board
  hides actions a given source can't perform.
- The app is source-agnostic end to end: it talks only to the local host, which
  calls plugin methods. It builds no source URLs and holds no credentials — a
  plugin supplies each item's link as data, and authentication (if a source needs
  any) is entirely the plugin's job. When a source rejects a request as
  unauthenticated the app just surfaces the plugin's own message.
- The UI is a composition of Web Components (board, column, card, drawer, comment
  thread, title), each self-contained with its own styles and usable on its own.
- **Optional embedded terminal**: a real shell on the host, overlaid at the bottom
  of the board, for running your own local tooling (an agent CLI, git, a shell)
  beside the work. Off by default; see [Terminal](#terminal).

## Setup

Needs Node ≥ 18. Install and start — the default `local-file` plugin serves
sample data on port 4317, so this alone gives you a working board on any OS:

```bash
npm install && npm run serve -- 4317
```

Then open http://localhost:4317. Pick a different plugin by creating a
`ledger.config.json` (see [Plugins](#plugins)); with no config file the bundled
`local-file` source serves sample data.

To keep it running in the background (starts on boot, survives logout):

```bash
npm run register       # systemd (Linux) / launchd (macOS) / Task Scheduler (Windows)
```

`register` is idempotent — re-run it after a Node upgrade to refresh the service's
baked-in interpreter path. When the background service is up, `npm run serve`
detects it and declines to start a second instance.

Every configuration setting — the `ledger.config.json` fields (`source`, `theme`,
`terminal`) and the environment variables — is documented in **[CONFIG.md](CONFIG.md)**.

## Terminal

An optional embedded terminal runs a shell on the host machine, overlaid at the
bottom of the board and translucent so the board shows through. It runs your own
local tooling — an agent CLI, git, a shell — beside the board without leaving it.
The board reflects changes a command makes to the source: when the terminal's
output settles, the board re-reads what's on screen and folds in any edits.

Enable it with `"terminal": true` in `ledger.config.json`; it's off by default.
The shell, security model, and the Linux build requirement (`node-pty` compiles
from source there) are documented in **[CONFIG.md](CONFIG.md#terminal)**.

## Plugins

Each **plugin** is one backing source — an issue tracker, a code host, a local
file — rendered onto the board through the common contract in
`src/shared/contract.ts`. A plugin is a plain-JavaScript **npm package** that
holds its own credentials; the app talks only to the local host, which calls
plugin methods.

### Selecting the active source

Plugins are npm **dependencies**, and `ledger.config.json` at the repo root names
the one active source. The file is machine-local (gitignored — it may point at a
private plugin); copy the committed `ledger.config.example.json` to start:

```jsonc
// ledger.config.json
{ "source": "the-ledger-github" }
```

`source` is resolved two ways:

- a **package name** — a dependency declared in `package.json` and installed into
  `node_modules` (how the bundled sources and any published plugin load); or
- a **repo-relative path** (anything with a `/` or leading `.`, e.g.
  `./plugins/my-plugin`) — for a plugin not yet declared as a dependency.

With no `ledger.config.json`, the bundled `the-ledger-local-file` source loads.

Two plugins ship in the box, each a `file:` dependency in `package.json`:

- **`the-ledger-local-file`** (default) — items from a JSON file, `sample.json`
  unless `LEDGER_FILE` overrides it. The reference implementation.
- **`the-ledger-github`** — a GitHub repo as the board (Project → Milestone →
  Issue), authenticating through the `gh` CLI. Set `GITHUB_REPO=owner/name`; see
  its own README for details.

### Adding your own plugin

1. Create a package (a folder with `package.json` + an `index.js` `main`) that
   exports a factory returning an object implementing the `src/shared/contract.ts`
   interface (list the hierarchy, read an item, edit fields, comment). Declare the
   capabilities the source supports — the UI hides actions a plugin doesn't offer.
   Copy `plugins/local-file/` as a starting point.
2. Make it resolvable: add it to `package.json` `dependencies` (a `file:` path, a
   git URL, or a published name) and `npm install`, **or** point `source` at its
   repo-relative path directly.
3. Set `source` to the package name (or path) in `ledger.config.json`, plus
   whatever env vars the plugin reads for its own config.

A plugin whose backend is private can be version-controlled outside this repo and
consumed as a `file:` dependency pointing at its checkout, or by pointing `source`
at its path. This keeps a plugin that wraps an internal or credentialed system out
of the public repo (see the `.gitignore` rule that excludes unlisted `plugins/*`).

## Themes

A **theme** re-skins the whole board — palette, fonts, textures, logo, ambient
backdrop, and sounds — as an installable npm package, discovered automatically
with no code change. `public/base.css` carries a complete neutral token baseline;
a theme's `theme.css` overrides those tokens and paints its own decoration. Switch
themes live from the masthead, or set the default with a `theme` field in
`ledger.config.json`.

The two bundled themes — leather-and-parchment **the-ledger** and dark-data-plate
**space-opera** — are published from the
[`ledger-themes`](https://github.com/cpyle0819/ledger-themes) repo; read them as
example themes.

A theme is code, not just a stylesheet: its logo and ambient are JS modules the
app runs with full access to your board. Install a third-party theme only if you
trust it, like any npm dependency — see [THEMES.md](THEMES.md) for the details.

### Adding your own theme

See **[THEMES.md](THEMES.md)** for the full authoring guide: the token contract,
the `ledgerTheme` manifest, and the path from empty folder to published, installed
theme.
