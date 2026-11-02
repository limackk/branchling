---
id: TL-521
title: "Every task field the served viewer writes has a callable command"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: set-field
    bash: "node --test scripts/tests/set-field.test.mjs"
---

## Goal

A caller outside the served page can change one task field with the same validation, attribution, reason requirement and history record as the viewer's POST /api/task, through one CLI command with --json output.

## Context

Today the only general field write is the HTTP endpoint POST /api/task in scripts/serve-backlog.mjs, guarded by a capability injected into the served page only; `branchling --help` lists no command that sets priority, epic, release, labels, role, executor or estimate. An external interface (a separate branchling-ui package, an editor extension, a script) therefore has no supported way to edit these fields: it must either write the markdown itself, bypassing buildFieldSpecs(), normalizeValue(), isValidReason() and the history log, or depend on a private HTTP contract. The fourth law promises a callable input on every writing operation; the field write is the one that has none. Status changes keep their dedicated commands (take, done, handoff, release, ask) and must not gain a second path here.

## Steps

1. Extract the field-write core used by POST /api/task into a module both the server and the CLI call, so the two paths cannot drift.
2. Add a command (for example `branchling set <ID> <field> <value> [--reason "..."] [--actor ns:name] [--json]`) that accepts only the fields the viewer may write, refuses status and other fields that have dedicated commands, and enforces reason_required_statuses and the reserved reason values.
3. Emit a declared envelope kind from scripts/json-envelope.mjs, including refusals in the shared envelope.
4. Make the served page's write path call the shared core and keep its existing tests green.

## Acceptance criteria

- [ ] A field set through the CLI and through POST /api/task produces the same file change and the same history record on one fixture, and a write of status or an unknown field is refused without touching the tree. [proof: set-field]
