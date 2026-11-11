---
id: TL-662
title: "The plain-text plan-refused answer of new is asserted line by line"
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
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-08
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: plan-refused-text
    bash: "node --test scripts/tests/new-json-refusals.test.mjs"
---

## Goal

The plain-text answer of `new --wave` when the plan is refused after the task was written (refusalKind plan-refused, exit 1) is asserted line by line: the header, the path of the written task, one `  - <problem>` line per plan problem, and the `schedule it with ... plan add <id> --wave ...` hint, each on its own line.

## Context

Observed on 2026-11-08 at 13:23 CET in the TL-649 loop worktree, in a Stryker run over scripts/new-task.mjs line 958 (the `text:` of the plan-refused refusal inside main()) with scripts/tests/new-duplicate-note.test.mjs selected. Five mutants survived on that line, all in text written before TL-649: the `problems.map((p) => "  - " + p)` callback replaced by `() => undefined`, the `"  - "` and `"  "` prefixes emptied, `["  " + schedule]` replaced by `[]`, and the `\n` join separator emptied. scripts/tests/new-json-refusals.test.mjs covers plan-refused only under --json (its refusedAs() always appends --json), and the one test that reads the text form, in new-duplicate-note.test.mjs, asserts only the header and the near-duplicate note. A person without --json is therefore told which plan problem stopped the scheduling, and how to schedule the task by hand, by text no test reads.

## Steps

1. Add a test that reaches plan-refused after the write without --json (the fixture in new-json-refusals.test.mjs, a plan scheduling the next id in another wave, already does) and asserts each line of stderr
2. Rerun `node scripts/mutation-run.mjs --files scripts/new-task.mjs:<line of the text:> --tests <that test>` and confirm none of the five mutants survives

## Acceptance criteria

- [x] the plain-text plan-refused answer names each plan problem and the command that schedules the written task [proof: plan-refused-text]
