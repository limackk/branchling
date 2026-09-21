---
id: TL-218
title: "Six tasks still carry executor: human; TL-212 accounted for four"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  # A READING, so the entry says so. A `grep | wc -l` over the marks would exit 0
  # whatever it counted — a contract that cannot fail is worse than none, because
  # it reports a guarantee it never checked.
  - id: split-stated
    manual: "a person opens each task still carrying `executor: human` and finds, in that file, the act only a person can perform"
---

## Goal

Every task still marked `executor: human` in this backlog is marked because a
person must DO it, and its own file says which act that is. The mark stops
being the place two different questions are answered.

## Context

Surfaced while closing TL-212, on 2026-09-03.

TL-212 undid the mark on the five tasks that only need a person to VOUCH —
TL-89, TL-55, TL-77, TL-122, TL-159 — because the run now parks such a task in
`awaiting_vouch` instead of failing it. Its own Context named the split it was
working from as five against four:

    a person must DO it     TL-203, TL-102, TL-179, TL-123

The tree disagrees. After the revert, SIX tasks carry the mark:

    TL-102  TL-103  TL-123  TL-158  TL-179  TL-203

TL-103 (launch material) and TL-158 (the CI badge and the first publicly
visible green run) are in neither of TL-212's two lists. They were marked on
2026-09-03 in the same sweep and were not examined when the sweep was partly
undone — TL-212's scope was the five it named, and widening it would have
blurred a task already in flight.

TL-158 is the one worth looking at first: "watching a badge appear" is
verbatim one of the acts TL-212 lists under *a person must VOUCH*, and the
neighbouring number, TL-159, was reverted. If TL-158 belongs on the vouch side
too, it is being kept out of the fleet's queue for a reason that no longer
exists.

**This is not a request to remove marks.** `executor: human` is correct for
work a machine cannot perform, and TL-203 (a history rewrite with every session
stopped) and TL-179 (searches in three trademark registers) are the clearest
cases. What is missing is that each remaining mark states WHICH question it
answers, so the next sweep does not have to reconstruct it.

## Pre-flight reading

1. `backlog/tasks/TL-212-*.md` — the Context section, for the criterion that
   separates *must do* from *must vouch*, and why the second is no longer a
   reason to keep a task away from the fleet.
2. `backlog/history/TL-158.jsonl` and `backlog/history/TL-103.jsonl` — what was
   recorded when the mark was written, and by whom.
3. `scripts/next-task.mjs` — `servesExecutor()`, for what the field actually
   gates: who may be HANDED the task, never who may close it.

## Steps

1. Read each of the six task files against TL-212's criterion: can every line
   of its work be written by an agent, with only a check left for a person?
2. Revert the mark on any that only need a vouch, recording the reason with
   `branchling history --file <task.md> --actor <you> --reason "…"` — the same
   route TL-212 used, so the change is not a silent edit.
3. For each mark that STAYS, write the reason into that task's own `## Context`
   in one sentence: what the person has to do that no agent can.

## Acceptance criteria

- [ ] Every task still carrying `executor: human` names, in its own file, the
      act a person must perform. [proof: split-stated]
- [ ] No task carries the mark solely because its contract ends in a `manual:`
      entry — that case is now `awaiting_vouch`. [proof: split-stated]
