# github source plugin

Renders a GitHub repo's work as an Epic → Story → Task board. GitHub has no
native three-level hierarchy, so the tiers map onto its grouping primitives:

| Ledger tier | GitHub |
|---|---|
| Epic | a Project (v2) linked to the repo |
| Story | a Milestone |
| Task | an Issue (a `bug`-labelled issue reads as a BUG task) |

Run against it:

```bash
LEDGER_SOURCE=github GITHUB_REPO=owner/name npm start
```

`GITHUB_REPO` defaults to `cpyle0819/the-ledger`. `GITHUB_ME` overrides the
viewer login used for the default assignee filter (otherwise resolved from
`gh api user`).

## Auth

Shells out to the [`gh` CLI](https://cli.github.com/), which owns the
credential — no token is read into or held by this process. Requires `gh` on
PATH and an authenticated session:

```bash
gh auth login
```

Projects (the epic tier) need the `project` scope on the token:

```bash
gh auth refresh -s project
```

Every call is attributed to the signed-in user, who reads and writes exactly
what they already can on GitHub.

## Hierarchy

The whole board loads in one GraphQL query (projects + milestones + issues with
their memberships); the tree is derived in process and cached per filter, so a
root load and the drills under it read one consistent structure.

- A milestone (story) sits under a project (epic) when the issues in that
  milestone belong to that project.
- An issue (task) sits under its milestone; under a project directly when it has
  a project but no milestone; at the root when it has neither.
- Only issues carry a status/assignee, so only issues match the board's filters;
  a matching issue pulls its milestone and project in as context ancestors so it
  always has a place in the tree.

## Capabilities

Reads the full tree and item detail; writes issue status (open / closed-completed
/ closed-not-planned), assignee, and description, plus comment add / edit /
delete, and a milestone's open/closed status. Assignee typeahead lists the repo's
assignable users.

Off by design: **no board project-picker** (Projects *are* the epic tier, so the
hierarchy already surfaces them), no workflow steps, no point estimates — GitHub
carries none of those.

## Limits

- One page of the forest query: up to 100 issues, 100 milestones, 50 projects. A
  repo past those logs a warning; pagination is a follow-up.
- A milestone whose issues span multiple projects is placed under the first
  project seen on its issues.
