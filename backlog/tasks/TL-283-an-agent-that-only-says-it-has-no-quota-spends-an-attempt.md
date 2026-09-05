---
id: TL-283
title: "An agent killed by its own quota leaves work uncommitted and blames the contract"
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

When an agent is cut off by its own vendor mid-task, the run says so. Today
it reports that the contract failed, parks the task on that reason, and
leaves the agent's uncommitted work in the tree for the next `git add -A`
to sweep into an unrelated commit.

## Context

Measured on 2026-09-05, TL-150, and CORRECTED the same day — the first
version of this task said "no commit, no file touched", and that was
wrong. What the log shows is the agent's stdout, which for `claude -p` is
its final message only:

    === attempt 1: …/hand-spec.sh
    You've hit your session limit · resets 12:10pm (Europe/Warsaw)
    === done: exit 1
    === attempt 2: …/hand-spec.sh
    You've hit your session limit · resets 12:10pm (Europe/Warsaw)
    === done: exit 1

What it does NOT show is that the hand had already written
`scripts/tests/actor-record.test.mjs` — 
TL-150's whole spec deliverable, a failing test for a command that does not
exist yet. It was cut off before it could commit and hand on. So the tree
DID change, TL-184's guard correctly did not fire, and the two attempts
were real work rather than nothing.

**Three consequences, all measured.**

The park blames the wrong thing. TL-150 was left with `no verification
after 2 agent attempts: suite-green`, which a later reader takes as a
finding about the work. The truth — the hand ran out of quota with the
deliverable written and uncommitted — is one line at the end of the log
and nowhere else.

The second attempt was pure cost. The contract, an 80-second suite, ran
twice to learn what the first run had already established, against a hand
that could not start.

The uncommitted work is a trap for the next commit. It was swept into an
unrelated commit here by `git add -A` and reached `main` as a red test with
no implementation, which is exactly the hazard TL-276 records two hands
warning about.

**Measured again the same afternoon, from the other side.** TL-150's
closing run: the spec hand added the last registry row and handed on; the
dev leg's entire output was `You've hit your session limit · resets
5:10pm`; the loop then ran `done`, the contract passed — the work was
already complete — and the task closed, credited in the history to the
`dev` role with 204 seconds against it. The closing is sound, because
`done` proved it. The attribution is not: a hand that printed one line
and touched nothing is on the record as the one that finished the task.
Same cause, opposite outcome, and only the second is visible in a report.

**What the tool must not do.** Parse the vendor's wording. "Session limit"
is a literal about somebody else's product and the next vendor phrases it
differently.

**What it can see without guessing.** That the agent exited far faster than
its previous attempt on the same task; that the tree changed but nothing
was committed, while the charter it was given ends in a commit; that two
attempts produced byte-identical output, which no working agent does.

## Steps

1. Decide, with `branchling ask`, what the loop may conclude. The
   candidates: two attempts with identical output are one attempt and the
   run stops; an exit code convention the caller's wrapper uses to say "I
   could not start"; nothing at all, and the report simply quotes the
   agent's last line beside the parked reason so a reader is not misled.
   The third changes no behaviour and removes the false diagnosis.
2. Whatever is decided, a task parked after an agent could not run must not
   carry a reason naming its contract.
3. Say in `run --help` that an agent's uncommitted work is left in the tree
   and belongs to whoever reads the report, since that is where TL-276's
   hazard actually bites.

## Acceptance criteria

- [ ] A task parked after two identical, immediate agent refusals carries a
      reason naming the agent rather than the contract, proven by a test
      that fails against today's loop. [proof: quota-is-not-an-attempt]
- [ ] An agent that genuinely worked and failed its contract still spends
      its attempts and still names the contract. [proof: suite-green]
