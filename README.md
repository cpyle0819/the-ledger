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

## Sources

A **source plugin** lives at `plugins/<name>/index.js` and exports a factory that
returns an object implementing the contract in `src/shared/contract.ts`. The host
loads one active source and exposes a small plugin-agnostic API to the browser; the
UI reads the source's declared capabilities and hides actions it can't perform.
Plugins stay plain JavaScript (they're the language-agnostic extension boundary).

The bundled source, `plugins/local-file/`, renders items from a JSON file
(`plugins/local-file/sample.json` by default, override with `LEDGER_FILE`). It is
the reference implementation and the default. Select the active source with the
`LEDGER_SOURCE` env var (default `local-file`).

To add a source, drop a new folder under `plugins/`, implement the interface, and
point `LEDGER_SOURCE` at it.

## Build & run

The app is authored in TypeScript, compiled with `tsc` (no bundler) to one JS file
per module so devtools maps 1:1 to source. A `prepare` hook builds automatically
after `npm install`, and the `serve`/`register` scripts build before starting.

```bash
npm install            # install deps + compile (prepare hook)
npm run serve          # build + start on http://localhost:4317
npm run build          # just compile (tsc -b)
npm run dev            # tsc --watch for development
```

Then open http://localhost:4317. Requires Node ≥ 18 and TypeScript ≥ 7.

To keep it always running in the background (starts on boot, survives
logout/login), register it as a per-user service:

```bash
npm run register       # systemd (Linux) / launchd (macOS) / Task Scheduler (Windows)
```

`register` is idempotent — re-run it after a Node upgrade to refresh the service's
baked-in interpreter path. When the background service is up, `npm run serve`
detects it and declines to start a second instance.

### Keyboard

- `1` / `2` — columns / outline lens
- `r` — refresh
- `esc` — close the detail drawer
- double-click any epic/story row — open its detail drawer

## Scope

Personal, single-user, local-only. It acts as *you*, using whatever credentials
the active source's plugin holds. It is deliberately **not** a multi-user hosted
service fronting a backend through a shared identity.
