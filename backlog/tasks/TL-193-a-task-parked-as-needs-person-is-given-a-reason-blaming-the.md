---
id: TL-193
title: "a task parked as needs-person is given a reason blaming the attempt count"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: parked-reason
    bash: "node --test scripts/tests/run-terminal-refusal.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The sentence written into `backlog/history/` when a run parks a task states
what actually stopped it. A task parked because its contract asks a PERSON is
not a task that ran out of attempts, and its reason must not say it was.

## Context

Surfaced while closing TL-190, in this repository, on 2026-09-03.

`workOne()` in `scripts/run-loop.mjs` can now end a task with the outcome
`needs-person` — before TL-190 that branch compared against a key nothing
wrote, so it had never fired and nothing downstream of it had ever been read
by anybody. The caller does not distinguish it: every outcome that is not
`closed` goes through the same

    const reason = blockedReason(result.attempts, result.detail);

and `blockedReason()` (same file) builds

    "no verification after 1 agent attempt: " + detail

That head clause is a claim about the agent's work. For `needs-person` it is
false in the way that matters: the contract was never reached, no attempt
could have reached it, and one more attempt would change nothing. The history
record is permanent — a `reason` is the one thing about a status change nobody
can reconstruct later — so it is worth being exact in.

`manual-needs-person` is the clearest case: `done --json` refuses because it
cannot ask a person to vouch, and the number of agent attempts is irrelevant
to that. `no-contract` and `criteria` are the same shape — the task FILE is
what stops the close, not the work.

The `already-closed` refusal is deliberately NOT part of this: TL-191 already
settled that a run does not park a task somebody closed, and `blockTask()`
refuses that write before any reason is used.

**What this is NOT.** It is not a change to which refusals are terminal (that
is TL-190, closed) and not a change to `blockTask()`'s guard (TL-191, closed).
It is only the sentence.

## Pre-flight reading

1. `scripts/run-loop.mjs` — `blockedReason()`, `TERMINAL_REFUSALS`, and the
   `else` branch of `run()` where every non-closed outcome is parked through
   one reason.
2. `scripts/tests/run-terminal-refusal.test.mjs` — the fixture that reaches the
   `needs-person` outcome; the assertion belongs beside it.
3. `scripts/tests/run.test.mjs` — the existing `blockedReason` test, for the
   shape a second one should mirror.

## Steps

1. Give the parking reason the outcome, not only the attempt count, so a
   `needs-person` park says what refused instead of how many attempts were
   spent. Keep `blockedReason()` PURE — it exists to be asserted directly.
2. Leave the `exhausted` wording alone: "no verification after N agent
   attempts" is true there and is what a reader of a blocked task needs.
3. Assert the recorded reason from the `manual:` fixture in
   `run-terminal-refusal.test.mjs`, reading it out of `backlog/history/` — the
   file is the artefact, not the report.

## Acceptance criteria

- [ ] A task parked after a `needs-person` outcome carries a history `reason`
      that does not attribute the stop to the number of agent attempts.
      [proof: parked-reason]
- [ ] A task parked after `exhausted` still states the attempts and the entry
      that failed. [proof: parked-reason]
- [ ] The suite stays green. [proof: suite-green]
