---
id: TL-613
title: "The consumer contract no longer says new has no --json"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [consumer-doc]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: consumer-doc
    bash: "node --test scripts/tests/external-consumer-doc.test.mjs && ! grep -n 'has no `--json` at all' docs/external-consumers.md"
---

## Goal

docs/external-consumers.md no longer tells a consumer that `new` has no `--json`, so an interface that creates a task reads the new id from the `task-new` envelope instead of a second `query --json`.

## Context

The paragraph beginning "Outside the envelope today.", just below the declared-kinds table in docs/external-consumers.md, says that `new` has no `--json` at all and that an interface creating a task reads the new id with `query --json` after `new` returns. That is stale: `new --help` declares `--json` (the task created, as data, kind `task-new`), scripts/json-envelope.mjs declares the `task-new` kind, and the same document's own table lists `task-new` as emitted by `new --title "..." --json`. The document contradicts itself, and a consumer following the paragraph pays a second process and a race: another session may create a task between the two calls. Noticed while adding the `template-refresh` row for TL-595; outside that task's thesis.

## Steps

1. Replace the paragraph so the document says that `new --json` answers a `task-new` envelope, naming what it carries (`id`, `file`) and what is still a sentence on stderr: the manual's `task-new` row says only the missing-backlog refusal is an envelope so far.
2. If a guard can hold the document to the code here (for example: no sentence may say a command has no `--json` while its usage in the COMMANDS table of scripts/cli.mjs declares it), add it with a positive control; otherwise say in the commit why not.

## Acceptance criteria

- [x] docs/external-consumers.md no longer claims `new` has no `--json`, and its consumer-contract test is green. [proof: consumer-doc]
