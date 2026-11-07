---
id: TL-635
title: "handoff refuses an archived --status as a refusal, not a usage error"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [json-envelope]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: handoff-archived-status-refusal
    bash: "node --test scripts/tests/handoff-archived-status.test.mjs"
---

## Goal

`handoff <ID> --status <s>` with `s` an archived status answers a refusal (exit 1, and under `--json` a `task-handoff` envelope with its own `refusalKind`) instead of exit 2, the code for a call built wrong.

## Context

TL-559 and TL-574 drew one line for `handoff`: a value a person typed into a correctly built call is a refusal (exit 1, an envelope under `--json`), and exit 2 is kept for an unknown flag, a missing value or a missing `--reason`. Since TL-574, `--status` outside `statuses:` answers `refusalKind: "unknown-value"` with exit 1. One `--status` case is still on the wrong side: in `scripts/handoff-task.mjs` `run()`, a status that IS declared but is listed in `archived_statuses` (`handoff <ID> --to-role r --reason x --status done`) goes through `fail2()` — exit 2, a sentence on stderr and an empty stdout under `--json`. The value is declared, so `unknown-value` is the wrong word for it; it needs a `refusalKind` of its own (for example `archived-status`) naming the statuses a handoff may set. `scripts/tests/handoff.test.mjs` ("`--status` cannot be used to close a task behind `done`'s back") asserts exit 2 today and has to move with it; `docs/external-consumers.md` (the refusal table under "When a reading command refuses") currently says an archived `--status` stays exit 2.

## Steps

1. Answer an archived `--status` in `scripts/handoff-task.mjs` with exit 1 and, under `--json`, a `task-handoff` envelope with `ok: false`, a dedicated `refusalKind`, `rejected` `{ field: "status", value }` and `declared` holding the non-archived statuses
2. Keep exit 2 for an unknown flag, a missing value and a missing `--reason`
3. Update the handoff row in `docs/external-consumers.md`, the `task-handoff` row in `docs/manual.md`, the `handoff` exit line in `scripts/cli.mjs`, and the assertion in `scripts/tests/handoff.test.mjs`

## Acceptance criteria

- [ ] handoff --status with an archived status answers exit 1 and a task-handoff refusal envelope naming the statuses a handoff may set, and writes nothing [proof: handoff-archived-status-refusal]
