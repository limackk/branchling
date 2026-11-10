---
id: TL-641
title: "Jira import maps priority with a --priority argument"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [import]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: jira-priority-tests
    bash: "node --test scripts/tests/import-jira.test.mjs"
  - id: help-names-priority
    bash: "node scripts/cli.mjs import --help | grep -q -- '--priority <from>=<to>'"
---

## Goal

`branchling import --from jira` can map a ticket's Jira priority onto one of the project's priorities with `--priority <from>=<to>` (repeatable, an argument and never a `config.yaml` key, by the rule `--label` and `--status` follow). Today TL-581 reads `fields.priority.name` in `parseJiraIssues()` (`scripts/import-jira.mjs`) and only writes it into the task body as `Jira priority: <name> — not mapped onto this project's priorities.`; every imported task gets the template's default priority.

## Context

Deliberately left out of TL-581, whose acceptance criteria name status, labels, the body and the marker, not priority. Jira priority names are per site (Highest, High, Medium, Low, Lowest by default, but configurable), so there is no safe default mapping: without `--priority` the behaviour should stay as it is (noted in the body, template default in the field). A `<to>` outside `priorities:` in config.yaml must be refused with every complaint at once, the way `planImport()` in `scripts/import.mjs` refuses an unknown `--status` target. `--priority` with `--from github` is refused, as `--status` is. Update `import --help` (the command table in `scripts/cli.mjs`), `docs/guide.md` (From Jira) and `docs/external-consumers.md`.

## Steps

1. Parse `--priority` in `parseImportArgs()`; refuse it for GitHub.
2. Apply it in `planImport()` and pass the field to `createTask()` in `writeImport()`; keep the body note for an unmapped priority.
3. Tests in `scripts/tests/import-jira.test.mjs`.

## Acceptance criteria

- [x] A `--priority High=P1` import writes `priority: P1`, an unknown target is refused before anything is written, and without the flag the field keeps the template default. [proof: jira-priority-tests]
- [x] `import --help` documents `--priority`. [proof: help-names-priority]
