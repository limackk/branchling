---
id: TL-737
title: "Closed-task refusals of take and handoff name the reopen command"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: closed-refusals-route
    bash: "node --test scripts/tests/take-closed-resume.test.mjs scripts/tests/handoff-archived-status.test.mjs"
---

## Goal

Every refusal about a closed task that tells the caller to reopen it, or not to, names the command that does it, so a closing rejected in review is never steered away from the route that withdraws it.

## Context

TL-714 added `take <ID> --reopen --reason "…"` and made the `closed` refusal of `takeTask` (scripts/take-task.mjs) print it. Two neighbouring refusals still speak in prose. (1) The `closed-unmerged` refusal in `takeTask` (TL-684) says "Do not reopen it — the closing stands. Finish it from the briefing" and points at `resume`; that is right for a session that died between `done` and its commit, but it is exactly the state a supervisor leaves when it rejects a closing in review in the loop's own tree, and the refusal never mentions that `--reopen` exists for that case. (2) The `archived` refusal in scripts/handoff-task.mjs (around line 311) says "reopen it deliberately first" without naming any command. Change both so the alternative route is printed as a command (`next:` entry), keeping the TL-684 resume route as the first suggestion for the unmerged case.

## Steps

1. Add the `take --reopen --reason` route as a second, conditional suggestion to the closed-unmerged refusal in takeTask, worded so it does not contradict the resume advice
2. Make the handoff refusal for a closed task name `take <ID> --reopen --reason` as its next step
3. Update scripts/tests/take-closed-resume.test.mjs and the handoff tests to assert the printed routes and run them as printed

## Acceptance criteria

- [ ] The closed-unmerged refusal of take and the closed refusal of handoff each print the reopen command, and running it as printed reopens the task [proof: closed-refusals-route]
