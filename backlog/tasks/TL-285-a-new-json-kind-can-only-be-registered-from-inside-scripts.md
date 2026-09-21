---
id: TL-285
title: "A new --json kind can only be registered from inside scripts/tests/"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: ["docs/manual.md"]   # paths relative to the repository root
# CONTRACT REWRITTEN (TL-260). The single `suite-green` entry passed against an
# UNCHANGED tree: the suite was already green before this task started, so the
# contract could not tell a finished task from an untouched one. The first entry
# now names the guard that carries the thesis — it did not exist before this
# task, and against the previous `scripts/json-envelope.mjs` it fails with
# `does not provide an export named 'KIND_EXERCISE'`. The suite-wide run stays
# as the second entry: relocating the registry must not cost a single case.
verification:                      # HOW to check the task is really done
  # Every kind carries its invocation beside KINDS, a kind nothing exercises is
  # still reported (proved against a deliberately broken pair), and no file
  # under scripts/tests/ holds a table of kinds again.
  - id: registry-outside-tests
    bash: "node --test scripts/tests/json-kind-registry.test.mjs"
  # Every kind is still run end to end, on an empty backlog and a populated
  # one, from the relocated registry.
  - id: envelope-green
    bash: "node --test scripts/tests/json-envelope.test.mjs"
  # The move costs no case anywhere else.
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A hand that may write production code and not tests can add a command that
answers `--json`. Today it cannot, and the wall is not a defect in any one
test: it is where the coverage registry lives.

## Context

Found while writing TL-150's `actors` command. The chain, in three files:

1. `scripts/json-envelope.mjs` declares `KINDS`, and `envelope()` THROWS on a
   kind that is not in it. That rule is deliberate and is not the problem —
   it is what stops an emitter from extending the contract from a typo.
2. `scripts/tests/json-envelope.test.mjs` holds two tables, `READING` and
   `WRITING`, mapping every kind to the invocation that exercises it, and its
   positive control asserts `Object.keys(READING).concat(Object.keys(WRITING))`
   equals `Object.keys(KINDS)`, in both directions.
3. So a new kind FAILS the suite until a line is added to a table that lives
   under `scripts/tests/`.

For a single author that is one line and a good rule: it forces every kind to
be exercised end to end, on an empty backlog and a populated one. For the
two-hand pipeline it is a dead end — the dev hand is forbidden `scripts/tests/`
precisely so that it cannot weaken the spec hand's proof, and this edit is not
a weakening but a registration. TL-150 stopped here with everything else green:
its own 27 cases pass, `check` passes, and three suite cases stay red for the
missing `actors: ["actors", "--json"]` row.

The two shapes of answer, and neither is obviously right:

- **Move the registry out of the test.** The mapping from kind to invocation is
  data about the tool, not about the test — it could sit beside `KINDS` in
  `scripts/json-envelope.mjs`, where the emitter's author can reach it, and the
  test would read it and keep asserting completeness. The cost: a declaration a
  test consumes now ships in the tarball.
- **Say the spec hand registers it.** Keep the table where it is and make the
  handover contract explicit — a spec hand writing a test that demands a new
  kind registers that kind in the same pass. The cost: the spec hand has to
  know the kind's name before the code that emits it exists.

Whichever is chosen, TL-273 is a neighbour rather than a duplicate: it is about
a hard-coded task id INSIDE the same table, not about who may edit the table.

## Pre-flight reading

1. `scripts/json-envelope.mjs` — `KINDS`, and why the declaration sits there
   rather than at the emitters
2. `scripts/tests/json-envelope.test.mjs` — the `READING` and `WRITING` tables
   and the positive control that pins them to `KINDS`
3. `docs/manual.md` — the `--json` contract table, the third place a kind has
   to be written down

## Steps

1. Choose between the two shapes above, and record the choice as a decision.
2. Apply it, keeping the completeness assertion in both directions — a kind
   with no invocation exercising it must still fail.
3. Add the missing `actors` row while passing, so the suite is green.

## Decision (TL-285)

**The registry moves beside `KINDS`.** `scripts/json-envelope.mjs` now exports
`KIND_EXERCISE` — one row per kind, `{ args, noDir?, refuses?, writes?, input? }`
— together with the `FIRST_TASK` and `ABSENT_TASK` sentinels the rows name a
task with (TL-273), and a pure `registrationGaps()` the suite runs against a
deliberately broken pair. Registering a kind is therefore two rows in one
production file, plus the row in the `--json` contract table of
`docs/manual.md`.

**Why, and what was rejected.** The second shape — keep the tables under
`scripts/tests/` and make the handover explicit, so the spec hand registers the
kind — asks the spec hand to know a kind's name before the code that emits it
exists, and leaves the registration path invisible to the person adding the
command. The mapping is data about the TOOL, the canonical call behind each
kind, not data about the test; a reader of `KINDS` is exactly the reader who
needs it. The accepted cost is that the table ships in the tarball although only
the suite reads it.

**What did not change.** Every registered invocation is still run end to end, on
an empty backlog and on a populated one, by
`scripts/tests/json-envelope.test.mjs`. A kind nothing exercises still fails —
now in `scripts/tests/json-kind-registry.test.mjs`, which also fails if a
kind-keyed table reappears anywhere under `scripts/tests/` under ANY name: the
guard counts how many declared kinds a test file names, and a table cannot stay
under the threshold while an ordinary assertion about one command cannot reach
it.

**The `actors` row of step 3 was not added.** TL-150's command has not landed,
so no `actors` kind is declared; adding a row for a kind nothing emits is the
exact failure `registrationGaps()` reports in the other direction.

## Acceptance criteria

- [x] A kind added to `KINDS` with no invocation to exercise it still FAILS —
      the guard is not loosened, only relocated, and its own positive control
      runs the check against a deliberately broken pair.
      [proof: registry-outside-tests]
- [x] Adding a command that answers `--json` needs no edit under
      `scripts/tests/`: the invocation is registered in
      `scripts/json-envelope.mjs`, and a kind-keyed table reappearing under
      `scripts/tests/` fails. [proof: registry-outside-tests]
- [x] Every kind is still exercised end to end on both fixtures from the
      relocated registry. [proof: envelope-green]
- [x] The relocation costs no case elsewhere. [proof: suite-green]
