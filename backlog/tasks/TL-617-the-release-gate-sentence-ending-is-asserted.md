---
id: TL-617
title: "The release-gate sentence ending is asserted"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-4
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [instructions]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: gate-sentence-ending
    bash: "node --test scripts/tests/instructions-promotion.test.mjs"
---

## Goal

A test fails when the sentence ending of the release-gate paragraph is wrong.

## Context

`promotionGate(config)` in scripts/instructions.mjs ends the gap sentence with `(recorded.length ? "." : ":")` — a full stop when the `deploy record` half follows, a colon when the command list follows directly. The TL-596 review replaced that expression with `":"` and scripts/tests/instructions-promotion.test.mjs stayed green, so no assertion pins the punctuation. The same review stopped a full Stryker run over instructions.mjs at 22% with 9 survivors whose lines were not identified; some of them may sit inside promotionGate.

## Steps

1. Add an assertion to scripts/tests/instructions-promotion.test.mjs that the gap sentence ends with `.` in a fixture with a recorded stage and with `:` in a fixture without one
2. Show that the assertion fails with the expression replaced by `":"`, and by `"."`
3. Run `npm run mutation -- --named-only --files scripts/instructions.mjs:<promotionGate range>` and name every survivor inside promotionGate, killing each that is not equivalent

## Acceptance criteria

- [x] The sentence ending of the release-gate paragraph is asserted in both fixtures, and no non-equivalent mutant of promotionGate survives [proof: gate-sentence-ending]
