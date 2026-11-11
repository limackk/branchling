---
id: TL-710
title: "done --json refusal and awaiting-vouch payloads are asserted"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: done-payload-tests-green
    bash: "node --test scripts/tests/done-awaiting-vouch.test.mjs scripts/tests/done-output.test.mjs"
---

## Goal

The payload of `done --json` refusals and of the awaiting-vouch answer is asserted, so a mutation run over those lines in scripts/done-task.mjs kills its mutants instead of reporting them as survivors.

## Context

A `npm run mutation -- --named-only --changed-lines --concurrency 2` run on 2026-11-11 (TL-672, which only replaced kind literals with REFUSAL_KINDS references on these lines) reported 16 survivors in scripts/done-task.mjs, none on the refusal kind itself: (1) the `results` argument `[]` of the early refusals (no-such-task, already-closed, unreadable-contract, no-contract, closing-contract-collision) survives `["Stryker was here"]`, so no test asserts that a refusal before anything ran publishes `entries: []`; (2) the `[error.message]` details and the headline of both `history-unwritable` refusals survive `[]` and `""`, so no test reaches or reads that refusal's details; (3) on the awaiting-vouch path `if (plan.json) answer(plan, results, { status, closed: false, awaitingVouch: true, refusalKind: REFUSAL_KINDS.awaitingVouch })` survives `if (false)`, `{}` and flipping `awaitingVouch`, so no test reads the JSON answer of a run parked under `awaiting_vouch_status`. Each is a missing assertion in scripts/tests (done-awaiting-vouch.test.mjs, done-output.test.mjs or a new file), not a change to done-task.mjs.

## Steps

1. Assert `entries: []` (and `refusalKind`) in the --json envelope of each early refusal
2. Drive a history-unwritable refusal and assert its details carry the error message
3. Assert the --json answer of an awaiting-vouch park: closed false, awaitingVouch true, refusalKind awaiting-vouch
4. Rerun the mutation run with --changed-lines over those lines and see the survivors killed

## Acceptance criteria

- [ ] the new assertions on the refusal and awaiting-vouch payloads hold [proof: done-payload-tests-green]
