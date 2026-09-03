---
id: TL-192
title: "The run does not check that a task is still its own before parking it"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: not-ours
    bash: "node --test scripts/tests/run-stuck-status.test.mjs"
---

## Goal

`branchling run` may park a task in its stuck status only while that task is
still the one this run is holding. Today it checks that the status is not
archived (TL-191) and nothing else, so a task taken from this run by somebody
else — reassigned, taken over, moved on to a different open status — is still
written over.

## Context

TL-191 put the guard at the write: `blockTask` in `scripts/run-loop.mjs`
re-reads the task file immediately before writing and refuses when the status
it finds is in `archived_statuses`. That re-read already has the whole record
in hand, and it answers a second question the loop does not ask: `owner:` — is
this still the run's own task at all.

The case is narrower than TL-191's and costs less when it goes wrong, because
nothing proven is destroyed: an open status is written over an open status. It
is still a lie in the tree and in the report. Concretely, between the take and
the last attempt somebody may run `take <ID>` in another worktree, or hand the
task to a person; the run then writes `blocked` with a reason about ITS agents
over work somebody else is holding, and the history records this run as the
author of a change to a task it no longer owned.

What is NOT decided here, and has to be decided by whoever takes this:

- Whether "still ours" means `owner:` equals this run's actor, or the weaker
  test that the task is still in the in-progress status the run left it in.
  A run whose agent legitimately changed the owner exists (a handoff), and the
  answer has to say what happens then.
- Whether a task that is not ours is reported the way TL-191 reports a closed
  one (a third outcome, counted apart) or with the existing `closed-elsewhere`
  outcome renamed to cover both.

Do not fold this into the archived guard silently: the two refusals have
different reasons and a reader of the report has to be able to tell "somebody
finished it" from "somebody took it".

## Pre-flight reading

1. `scripts/run-loop.mjs` — `blockTask`, the re-read and the archived guard it
   already carries; and the caller in `run`, where the outcome is counted.
2. `scripts/take-task.mjs` — what `owner:` is set to on a claim, and by whom.
3. `scripts/lock.mjs` — the reservation, which is session state and NOT the
   answer to this question: it expires on a TTL and says nothing about the file.
4. `backlog/tasks/TL-191-*.md` — the guard this extends, and why it sits at the
   write rather than at each of the ways of reaching it.

## Steps

1. Decide what "still ours" means, and write the decision into this file.
2. Extend the re-read in `blockTask` with that test; refuse the write when it
   fails, with a reason distinct from the archived one.
3. Count and print the refusal in the run report, separately from a task that
   was closed elsewhere.
4. Extend `scripts/tests/run-stuck-status.test.mjs` with a fixture whose agent
   hands the task to another owner, and assert the tree is untouched and the
   report says who holds it.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] A task whose owner changed while the run worked keeps its status and its
      owner, and the run records no change to it. [proof: not-ours]
- [x] The report distinguishes "closed elsewhere" from "taken by somebody
      else". [proof: not-ours]
- [x] Nothing else in the suite changed behaviour. [proof: suite-green]

## Decisions

**"Still ours" means `owner:` names this run's actor.** The weaker test — the
task is still in the in-progress status the run left it in — was rejected
because the two fields answer different questions: an owner is what a claim IS,
while a status says where the work stands. An agent that moves its own task
between two open statuses has not given it up, and a status test would refuse
to park exactly the task the run still holds. `take` writes `owner:` at the
claim, so that line is the run's whole title to the task, and it travels with
the branch — which is the point the lock cannot serve (it expires on a TTL and
lives on one machine).

**A handoff is not an exception; it is the clearest case of the rule.** An
agent that legitimately hands its task on leaves either somebody else's name in
`owner:` or, for `handoff --to-role`, nobody's — the field is CLEARED
deliberately. Parking the task afterwards would undo the very act the agent was
asked to perform, so a cleared owner is refused by the same line as a changed
one. Nobody is still not us.

**A third outcome, `held-elsewhere`, not a wider `closed-elsewhere`.** Both
refusals leave the tree untouched and there the resemblance ends: one says the
work is finished, the other that it is still open and somebody else is doing
it. Renaming the existing outcome to cover both would cost the reader the only
distinction that matters when a run comes back with nothing closed. It is
counted apart in the tally (`heldElsewhere`), printed as `held elsewhere`, and
carries WHO holds it in the detail line — the reader's next question, which the
file will no longer answer for them. Its mark is the warning one, not the tick
`closed-elsewhere` gets: nothing was proven.

**The archived guard answers first.** A task that was taken over AND closed is
reported as closed elsewhere, because "somebody finished it" is the stronger
fact of the two.

**One line of an existing test changed.** `the guard reads archived_statuses`
now claims the task before writing to it: it is about which statuses stop the
write, so its subject has to be a task the run may write to at all. No
behaviour it asserted was weakened.
