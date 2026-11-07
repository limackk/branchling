---
id: TL-568
title: "Every refusal of new --json answers in its envelope"
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
conflict_group: [json-envelope]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-630]  # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: new-json-refusals
    bash: "node --test scripts/tests/new-json-refusals.test.mjs"
---

## Goal

Under --json, every refusal of `new` prints a `task-new` envelope with ok false, refusalKind, refusal and details on stdout, as seed, import and deploy record do, instead of a sentence on stderr and an empty stdout.

## Context

TL-550 gave `new` a --json answer (kind `task-new` in scripts/json-envelope.mjs) carrying ok, id, file, board, wave, idSource and actorSource, but only on success. Every refusal in scripts/new-task.mjs main() still goes through fail() or failure() to stderr with exit 2 or 1: an unknown flag, a missing title, a value outside a vocabulary, a refused task document from stdin or --body-file, a prefix mismatch, a drifted template, and a plan that refuses the --wave. A program calling `new --json` must therefore branch on the exit code and parse prose to learn why. docs/manual.md and docs/external-consumers.md say so explicitly ('A refusal prints no envelope'). The fix declares refusalKind, refusal and details on `task-new`, routes each refusal through one helper that prints the envelope under --json, names a refusalKind per path (usage, invalid-document, prefix-mismatch, template-drift, plan-refused, and the shared no-backlog one), removes the two doc sentences, and adds a refusal row to KIND_EXERCISE. TL-548 (missing backlog under --json) overlaps on the no-backlog path; check its state first.

## Steps

1. Declare refusalKind, refusal and details on task-new in scripts/json-envelope.mjs
2. Route every refusal in scripts/new-task.mjs main() through one helper that prints the envelope under --json
3. Update docs/manual.md and docs/external-consumers.md and add a refusing KIND_EXERCISE row
4. Test each refusal path under --json

## Acceptance criteria

- [x] Every refusal of `new --json` is a task-new envelope with ok false and a refusalKind. [proof: new-json-refusals]
