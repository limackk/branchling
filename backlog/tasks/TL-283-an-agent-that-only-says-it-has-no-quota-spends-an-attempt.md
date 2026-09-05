---
id: TL-283
title: "An agent that only says it has no quota spends an attempt and parks the task"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: quota-is-not-an-attempt
    bash: "node --test scripts/tests/agent-refusal-not-an-attempt.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

An agent that never worked the task costs the task nothing. Today an agent
that starts, says it has no quota left and exits is counted as an attempt,
and two of them park a task nobody touched.

## Context

Measured on 2026-09-05, TL-150. The whole of both attempts, from the log:

    === attempt 1: …/hand-spec.sh
    You've hit your session limit · resets 12:10pm (Europe/Warsaw)
    === done: exit 1
    === attempt 2: …/hand-spec.sh
    You've hit your session limit · resets 12:10pm (Europe/Warsaw)
    === done: exit 1

No commit, no file touched, no work of any kind. The loop ran the whole
contract twice — the second run of an 80-second suite purely to learn what
the first had already said — spent both attempts, and parked the task with
`no verification after 2 agent attempts`, which is true and useless: the
reader is told the contract failed when the truth is that no agent ran.

**TL-184's guard was built for exactly this and does not catch it.** An
attempt "that printed nothing and left the tree unchanged" is not an
attempt; this one printed one line, so it counted. The tree test is right
and the output test is too narrow: the distinguishing fact is that the tree
did not move, and the printed line was ABOUT the agent rather than about
the task.

**Why not parse the message.** The tool does not know the vendor and must
not learn one: matching "session limit" would be a literal about somebody
else's product, and the next vendor phrases it differently. What the loop
can see without guessing is that the tree is unchanged across the attempt
AND the agent exited quickly — the second is what separates "worked and
concluded nothing was needed" from "never started".

**The cost is not the two attempts.** It is that the task ends parked with
a reason blaming its contract, in a status a later reader treats as a
finding about the work. TL-150 is untouched and now reads as a task that
failed verification twice.

## Steps

1. Decide, with `branchling ask`, what widens TL-184's rule. The
   candidates: an unchanged tree plus an exit faster than some floor; an
   unchanged tree plus no output on stdout OR a single line; an explicit
   exit code the caller's wrapper may use to say "I could not start". The
   third is the only one that needs no heuristic, and it costs the caller a
   convention.
2. Whatever is decided, such an attempt must not be counted and the task
   must be given back the status it was taken from — the path TL-184
   already built for `agent-never-ran`.
3. The run should stop, as it does for `agent-never-ran`: the next task
   would meet the same wall.

## Acceptance criteria

- [ ] An agent that leaves the tree unchanged and returns immediately does
      not spend an attempt and does not park the task, proven by a test
      that fails against today's loop. [proof: quota-is-not-an-attempt]
- [ ] An agent that genuinely worked and failed its contract still spends
      its attempts. [proof: suite-green]
