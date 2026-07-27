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

Requires Node ≥ 18 and TypeScript ≥ 7. The app is authored in TypeScript,
compiled with `tsc` (no bundler) to one JS file per module so devtools maps 1:1
to source. A `prepare` hook builds automatically after `npm install`, and the
`serve`/`register` scripts build before starting.

```bash
npm install            # install deps + compile (prepare hook)
npm run serve          # build + start on http://localhost:4317
npm run build          # just compile (tsc -b)
npm run dev            # tsc --watch for development
```

Then open http://localhost:4317. The port defaults to 4317; override it with a
`npm run serve -- <port>` arg or the `PORT` env var (the arg wins).

**Point it at a plugin.** The board renders whichever plugin `LEDGER_SOURCE`
names (default `local-file`); each plugin reads its own env vars for the rest of
its config. The two bundled plugins:

```bash
npm run serve                                   # local-file (default): reads plugins/local-file/sample.json
LEDGER_FILE=/path/to/board.json npm run serve   # local-file, pointed at your own JSON
LEDGER_SOURCE=github GITHUB_REPO=owner/name npm run serve   # a GitHub repo (auth via the gh CLI)
```

To keep it always running in the background (starts on boot, survives
logout/login), register it as a per-user service:

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

### Keyboard

- `1` / `2` — columns / outline lens
- `r` — refresh
- `esc` — close the detail drawer
- double-click any epic/story row — open its detail drawer

## Scope

Personal, single-user, local-only. It acts as *you*, using whatever credentials
the active source's plugin holds. It is deliberately **not** a multi-user hosted
service fronting a backend through a shared identity.
