---
id: TL-190
title: "run reads verdict.reason, a field done --json never writes, so no refusal is terminal"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: ["docs/manual.md"]   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: terminal-refusal
    bash: "node --test scripts/tests/run-terminal-refusal.test.mjs"
---

## Goal

`branchling run` recognises a refusal no further attempt can fix, and stops
spending attempts on it. Today `scripts/run-loop.mjs` decides that from
`verdict.reason` — a key `done --json` never writes. The refusal envelope names
it `refusalKind`. The comparison is therefore `undefined === "manual-needs-person"`
and the branch is dead code: every refusal, including the ones the comment above
it says must not be retried, consumes the whole `--max-attempts` budget.

Once this is done, `run` reads the field the envelope actually publishes, the
`needs-person` outcome is reachable, and a task closed already ends the loop
instead of being handed to a second agent.

## Context

Measured on 2026-09-03, in this repository, while re-entering TL-183.

The run handed TL-183 to an agent; the agent did the work and closed the task
itself with `branchling done` (which is what this repository's own conventions
tell an agent to do). The loop then ran `done` a second time, got

    ✗ branchling done: TL-183 is already closed (`status: done`)
      Nothing was run.

and launched a SECOND agent against a finished task, prefixed with "THE
PREVIOUS ATTEMPT DID NOT CLOSE THIS TASK". The task was closed, committed and
already on `main`. An attempt was spent proving that.

Confirmed directly:

    $ node scripts/cli.mjs done TL-183 --json | ...
    reason: undefined   refusalKind: "already-closed"

Two defects sit on top of each other and both have to be fixed together, or the
first fix will look like it worked:

1. **The wrong field name.** `scripts/run-loop.mjs:471` tests `verdict.reason`
   against `manual-needs-person`, `no-contract` and `criteria`. The envelope
   writes `refusalKind` (`scripts/done-task.mjs:361`, and
   `scripts/json-envelope.mjs` documents the choice of that word deliberately).
   Nothing matches, so the shortcut has never fired — and the fallback string it
   builds, `"branchling done refused: " + verdict.reason`, would read
   `refused: undefined` if it ever did.
2. **`already-closed` is not in the list.** Even with the name fixed, a task
   somebody (or the agent itself) already closed is retried. No attempt can
   change an archived status back into a passing contract, so this refusal
   belongs with the other three: it ends the task with an outcome, not with a
   retry.

**Why this was invisible.** No test covers the `needs-person` outcome of the
loop — `grep -rn "needs-person" scripts/tests/` finds nothing, while
`manual-refusal-residue.test.mjs` asserts `refusalKind` on `done` itself. The
two sides are each tested against their own spelling, and no test crosses the
boundary between them. That is the guard to add, not just the fix.

**A related lie in the retry prompt.** `agentInput()` in the same file tells the
next agent "`branchling done` ran the `verification:` contract and refused". For
`already-closed`, `no-contract` and a broken criterion link, nothing ran — the
refusal happened before the contract was reached. Whatever refusals stay
retryable after this task, the sentence has to be true of them; `failedEntry()`
already returns null for exactly this case and can tell the two apart.

**What this is NOT.** It is not a change to `done`'s envelope. `refusalKind` is
the published name, tested and documented; the reader is what is wrong. And it
is not TL-184: that one is about an agent that never STARTED, this one is about
what the loop does with an answer it did receive.

## Pre-flight reading

1. `scripts/run-loop.mjs` — `workOne()`, the terminal-refusal branch and
   `agentInput()` just above it.
2. `scripts/done-task.mjs` — `refuse()` and every call site, for the full set of
   refusal kinds and which of them run anything.
3. `scripts/json-envelope.mjs` — why the word is `refusalKind` and not `kind`.
4. `scripts/tests/manual-refusal-residue.test.mjs` — the existing assertion on
   the `done` side, and the shape a loop-side test should mirror.

## Steps

1. Read `refusalKind` in `scripts/run-loop.mjs`, and add `already-closed` to the
   refusals that end the task instead of retrying it.
2. Make the outcome's `detail` name the refusal kind it actually got, with no
   `undefined` reachable.
3. Make the retry preamble truthful: it may claim the contract ran only when it
   did.
4. `scripts/tests/run-terminal-refusal.test.mjs`, on a FIXTURE tree: a task the
   agent closes itself ends the run in ONE attempt, and a `manual:` task ends as
   `needs-person` in one attempt. A positive control that the same fixture takes
   more than one attempt when the contract genuinely fails.

## Acceptance criteria

- [x] `run` against a task the agent closed itself spends one attempt, not
      `--max-attempts`. [proof: terminal-refusal]
- [x] The `needs-person` outcome is reachable and asserted, and no code path can
      print `undefined` as a refusal kind. [proof: terminal-refusal]
- [x] The suite stays green. [proof: suite-green]
