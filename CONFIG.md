# Configuration

The Ledger reads its configuration from `ledger.config.json` at the repo root, plus
a few environment variables. The config file is machine-local and gitignored (it may
point at a private plugin); `ledger.config.example.json` documents the shape. With no
config file, the bundled `the-ledger-local-file` source loads with defaults.

## `ledger.config.json`

A JSON object. A malformed file is a hard error at startup, not a silent fallback —
a typo in the one file that configures the app fails loudly.

| Field | Type | Default | Effect |
|---|---|---|---|
| `source` | string | `the-ledger-local-file` | The active source plugin: a package name (a `package.json` dependency in `node_modules`) or a repo-relative path (anything with a `/` or leading `.`, e.g. `./plugins/my-plugin`). |
| `theme` | string | the built-in `the-ledger` theme | The default theme id, matched against the installed theme packages. A browser's own switcher choice overrides it per-machine; an unknown id falls back to the built-in default. |
| `terminal` | boolean | `false` | Turns on the embedded terminal (see below). Only `true` enables it. |

```jsonc
// ledger.config.json
{
  "source": "the-ledger-github",
  "theme": "space-opera",
  "terminal": true
}
```

`source` and `theme` are covered in depth in the README ([Plugins](README.md#plugins),
[Themes](README.md#themes)).

### `terminal`

When `true`, the board shows a terminal button in the masthead that opens a shell
running on the host machine, overlaid at the bottom of the board. Its purpose: run
your own local tooling (an agent CLI, git, a shell) beside the board without leaving
it. Off by default.

The shell is the host's `$SHELL`, falling back to `%COMSPEC%` (cmd.exe) or PowerShell
on Windows where `$SHELL` is normally unset.

**Security:** the terminal is reachable only from the machine running the board
(bound to `127.0.0.1`). A per-boot token guards the connection, and the board only
accepts it from its own page — another local process or a background browser tab
can't open a shell. A shell is full local access by design; these guards keep *other*
local actors out, not you.

**Platform note:** the terminal depends on `node-pty`, a native addon. macOS and
Windows install prebuilt binaries with no compile. Linux builds it from source during
`npm install`, which needs a C++ toolchain (python3, make, a C++ compiler); a machine
without one fails the install.

## Environment variables

Read by the host and the bundled plugins. Set them in the shell that starts the
server (or the service environment when running under `register`).

| Variable | Read by | Default | Effect |
|---|---|---|---|
| `PORT` | host | `4317` | The port the board serves on. |
| `LEDGER_FILE` | `the-ledger-local-file` | bundled `sample.json` | Path to the JSON file the local-file source reads. |
| `LEDGER_ME` | `the-ledger-local-file` | `me` | The viewer's identity (the default assignee filter). |
| `GITHUB_REPO` | `the-ledger-github` | `cpyle0819/the-ledger` | The `owner/name` repo the GitHub source renders. |
| `GITHUB_ME` | `the-ledger-github` | resolved from `gh api user` | The viewer's GitHub login; resolved lazily when unset. |

A third-party plugin reads whatever env vars it documents; those are the plugin's own
config, not the host's.
