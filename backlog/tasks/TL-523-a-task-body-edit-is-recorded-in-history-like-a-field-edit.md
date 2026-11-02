---
id: TL-523
title: "A task body edit is recorded in history like a field edit"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: body-history
    bash: "node --test scripts/tests/body-history.test.mjs"
---

## Goal

Editing a task's body through the tool is recorded in backlog/history/ as a `__body__` change with actor and reason, so an interface can offer body editing without leaving an unexplained change behind.

## Context

FIELD_BODY (`__body__`) is reserved in scripts/task-fields.mjs but not implemented; the plan for body history is in docs/branchling-state-and-sync.md sections 5.2 and 5.3. Today a body edit made outside the tool is reconciled as an `unknown` change, and no command writes a body at all, so an external interface (for example a separate branchling-ui package) can edit only frontmatter. Body history must not store the whole body on every edit if the design in the state-and-sync document says otherwise; follow it, or amend it with a reason.

## Steps

1. Re-read docs/branchling-state-and-sync.md sections 5.2 and 5.3 and settle the record shape for a body change.
2. Add a write path (a command reading the new body from stdin or --body-file, with --reason and --json) that writes the file atomically and appends one `__body__` record.
3. Make `branchling log` render body changes legibly without printing whole bodies.
4. Keep the frontmatter untouched by a body write, and refuse a body that would break the required sections.

## Acceptance criteria

- [ ] A body written through the tool leaves the frontmatter byte-identical, appends exactly one __body__ record with actor and reason, and `branchling log` shows it. [proof: body-history]
