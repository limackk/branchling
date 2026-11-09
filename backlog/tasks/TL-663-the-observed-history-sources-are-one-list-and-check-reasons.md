---
id: TL-663
title: "The observed history sources are one list, and check --reasons reads it"
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
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: observed-sources-one-list
    bash: "node --test scripts/tests/change-reason.test.mjs"
---

## Goal

Which history sources count as an observation (the tool saw a change rather than made it) is declared in one module, and `check --reasons` uses that list instead of reading every `unknown` reason as an observation.

## Context

`OBSERVED_SOURCES = ["external", "manual", "boot"]` is defined twice, separately, in scripts/pr-summary.mjs and scripts/jira-proof.mjs. TL-650 settled that the reserved reason `unknown` only says no reason was stated, and that the entry's `source` says whether the change was observed or made by a command. scripts/check-backlog-reasons.mjs (`auditReasons`) still files every `unknown` entry under `unwitnessed` and prints it as "changed outside the tool" without consulting `source`; that is true today only because the writing commands refuse a transition into `reason_required_statuses` without a reason, not by construction. A command path that ever records such a transition with `unknown` would be reported as a hand edit.

## Steps

1. Export one OBSERVED_SOURCES list from scripts/task-fields.mjs (beside REASON_UNKNOWN) and import it in scripts/pr-summary.mjs and scripts/jira-proof.mjs.
2. In auditReasons, classify an `unknown` entry as unwitnessed only when its source is in the list; an `unknown` entry from any other source is a gap.
3. Add a test in scripts/tests/change-reason.test.mjs: an `unknown` entry with source `next` on a required transition is counted as a gap, and one with source `external` as unwitnessed.

## Acceptance criteria

- [ ] an `unknown` reason is reported as an outside change only under an observing source, and the list of observing sources has one definition [proof: observed-sources-one-list]
