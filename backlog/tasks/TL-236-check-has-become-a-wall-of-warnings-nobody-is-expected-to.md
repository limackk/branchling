---
id: TL-236
title: "check has become a wall of warnings nobody is expected to fix"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-verdict-is-findable
    bash: "node --test scripts/tests/check-summary.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

`branchling check` ends with a line saying how many guards failed and how many
reported, so its verdict can be read without counting symbols or running it a
second time redirected to `/dev/null`.

## Context

A bare `check` on this repository prints roughly 130 lines before anything a
session changed: 25 tasks with unlinked criteria, 41 stale `## Log` sections, 4
transitions with no reason, plus plan notes. Every one of them is a REPORT that
never fails, and one says so about itself:

> This reports, it does not fail. Since TL-105 the tool writes no `## Log` at
> all — so a legacy section going stale is the normal end state, not somebody's
> mistake.

Forty-one findings whose own text calls them the normal end state.

Three agents in two separate runs reported the same two consequences, without
knowing of each other:

- the one line that mattered was pushed off screen, and they resorted to
  `| tail -30`, `| grep`, or narrowing with `--history --task-state`;
- to learn whether `check` had PASSED they ran it a second time as
  `node scripts/cli.mjs check >/dev/null 2>&1; echo $?`, because `✓`, `✗` and
  `!` do not separate "reports" from "fails" strongly enough to infer an exit
  code from the text.

Each report was argued for on its own and each argument still holds. Nobody has
been accounting for the marginal cost of adding one more — including the two
added on 2026-09-04 (TL-230, and TL-233's audit through TL-234).

## Steps

1. A closing summary line: N guards run, N failed, N reported, and the exit code
   the command is about to use.
2. A report with more findings than fit is already truncated with `… and N
   more`; consider whether a report whose findings are the normal end state
   should print its count and nothing else unless selected by its own flag.
3. `scripts/tests/check-summary.test.mjs`: the summary names a failure when one
   guard fails, and says zero when only reports fired. The positive control is a
   tree with a real failure — a test over a clean tree proves nothing.

## Decisions

**Do not delete the reports.** Each is a real signal for somebody; the defect is
that the verdict is not findable, not that the findings are wrong.

**Do not make reports fail.** An uncommitted state change is the normal
condition of a session mid-task (TL-230), and a guard that failed there would
fail every session.
