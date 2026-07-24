# local-file source plugin

Renders a flat list of items from a JSON file as an Epic → Story → Task board.
The bundled reference source, and a plugin with no network and no auth:
everything is synchronous, and it advertises a smaller capability set (no
workflow steps, no assignee search, no comment editing), so the board hides the
actions it can't do — proof the same UI drives any source through the interface.

Run against it:

```bash
LEDGER_SOURCE=local-file LEDGER_FILE=./plugins/local-file/sample.json npm start
```

## File format

One JSON object: `{ "projects": [ ... ], "items": [ ... ] }`. `projects` is
optional — `[{ id, name }]` naming the groupings the board can scope to. Each
item:

| field | required | notes |
|---|---|---|
| `id` | yes | any stable unique string |
| `type` | yes | `EPIC`, `STORY`, or `TASK` (case-insensitive) |
| `title` | yes | |
| `status` | no | defaults to `Open`; `Resolved`/`Closed` count as closed |
| `assignee` | no | free-text alias |
| `project` | no | a `projects[].id`; set on the root epic, inherited by its subtree |
| `parent` | no | the `id` of the parent item; omit for a root epic |
| `description` | no | Markdown |
| `comments` | no | `[{ id, author, message, createDate }]` |

Hierarchy is derived from `parent`: epics are roots, stories/tasks nest under
their parent. A task whose parent is an epic renders in that epic's direct-task
lane; a task under a story renders in the story. A story or task with no `parent`
is an orphan and renders in a dedicated lane.
