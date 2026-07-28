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

## Setup

Needs Node ≥ 18. Install and start — the default `local-file` plugin serves
sample data on port 4317, so this alone gives you a working board on any OS:

```bash
npm install && npm run serve -- 4317
```

Then open http://localhost:4317. Pick a different plugin by setting
`LEDGER_SOURCE` (default `local-file`), using your shell's env-var syntax:

```bash
LEDGER_SOURCE=github npm run serve          # bash / zsh (Linux, macOS)
$env:LEDGER_SOURCE="github"; npm run serve  # PowerShell (Windows)
set LEDGER_SOURCE=github && npm run serve    # cmd.exe (Windows)
```

To keep it running in the background (starts on boot, survives logout):

```bash
npm run register       # systemd (Linux) / launchd (macOS) / Task Scheduler (Windows)
```

`register` is idempotent — re-run it after a Node upgrade to refresh the service's
baked-in interpreter path. When the background service is up, `npm run serve`
detects it and declines to start a second instance.

## Plugins

Each **plugin** is one backing source — an issue tracker, a code host, a local
file — rendered onto the board through the common contract in
`src/shared/contract.ts`. A plugin lives at `plugins/<name>/index.js`, stays
plain JavaScript, and holds its own credentials; the app talks only to the local
host, which calls plugin methods. `LEDGER_SOURCE` picks the one active plugin.

By default the host looks for the named plugin under the bundled `plugins/`
folder. Set **`LEDGER_PLUGIN_PATH`** to also search directories outside the repo
(colon-separated on Linux/macOS, `;` on Windows — the OS path delimiter); each is
tried in order before the built-in `plugins/` fallback, so an external dir can
shadow a bundled plugin of the same name. This lets a plugin be version-controlled
elsewhere — e.g. built from a package in a separate repo — instead of living in
this repo:

```bash
LEDGER_PLUGIN_PATH=/path/to/workspace/src/TheLedgertracker \
  LEDGER_SOURCE=tracker npm run serve
```

The named plugin resolves via Node's own module resolution, so a search-dir entry
may be a loose `<dir>/<name>/index.js` or a built package that exports a `main`.

Two ship in the box:

- **`local-file`** (default) — items from a JSON file, `sample.json` unless
  `LEDGER_FILE` overrides it. The reference implementation.
- **`github`** — a GitHub repo as the board (Project → Milestone → Issue),
  authenticating through the `gh` CLI. Set `GITHUB_REPO=owner/name`; see its own
  README for details.

To add your own plugin to this install:

1. Create `plugins/<name>/index.js` exporting a factory that returns an object
   implementing the `src/shared/contract.ts` interface (list the hierarchy, read
   an item, edit fields, comment). Declare the capabilities the source supports —
   the UI hides actions a plugin doesn't offer.
2. Start the app with `LEDGER_SOURCE=<name>` (plus whatever env vars your plugin
   reads for its own config). Copy `plugins/local-file/` as a starting point.
