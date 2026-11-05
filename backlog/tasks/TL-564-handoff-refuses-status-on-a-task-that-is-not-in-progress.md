---
id: TL-564
title: "handoff refuses --status on a task that is not in progress"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: status-flag
    bash: "node --test scripts/tests/handoff.test.mjs scripts/tests/handoff-atomicity.test.mjs"
---

## Goal

`branchling handoff --status <s>` either applies the status it was given or refuses and says why. It never exits 0 having silently ignored an explicit flag.

## Context

On 2026-11-05 `handoff TL-450 --to-role dev --status pending`, run on a task in `awaiting_vouch`, exited 0, changed the role and left the status untouched, with no warning. `scripts/handoff-task.mjs` reads `opts.status` only inside the branch for a task in the in-progress status; every other status is deliberately left alone, because it 'was entered by a decision this command is not making'.

That policy is sound, but the flag is accepted and then dropped, which is the defect AGENTS.md names for unknown flags: a silent no-op looks like it worked. The caller believed the task was back in the queue as `pending`.

Preferred: refuse with exit 1 before writing anything, naming the current status and why handoff leaves it alone. Rejected: applying the status, which would let handoff reopen decisions such as `blocked` that it explicitly does not make. `release --status` goes through the same write path and should be checked for the same gap.

## Steps

1. In `scripts/handoff-task.mjs`, when `opts.status` is set and the task is not in the in-progress status, return a refusal before the first write.
2. Check `release --status` for the same path and treat it alike.
3. Extend `scripts/tests/handoff.test.mjs` with a task in a waiting status handed off with `--status`, asserting exit 1, an unchanged file and no new history entry; keep a positive control in which `--status` on an in-progress task is applied.
4. Make the `--status` line of `handoff --help` say that it applies only to a task in progress.

## Acceptance criteria

- [ ] `handoff --status` on a task that is not in progress is refused without writing anything, and is still applied to a task in progress. [proof: status-flag]
