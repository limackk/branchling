---
id: TL-736
title: "done --json park answer is reachable or removed"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-1
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-14
blocked_by: [TL-710]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: park-json-tests-green
    bash: "node --test scripts/tests/done-awaiting-vouch.test.mjs scripts/tests/run-terminal-refusal.test.mjs"
---

## Goal

The `--json` answer written by `parkAwaitingVouch` in scripts/done-task.mjs is either reachable and asserted, or removed, so a mutation run over it no longer reports equivalent mutants as missing assertions.

## Context

`parkAwaitingVouch` in scripts/done-task.mjs ends with `if (plan.json) answer(plan, results, { status, closed: false, awaitingVouch: true, refusalKind: REFUSAL_KINDS.awaitingVouch })`, and its `--dry-run` branch with `if (plan.json) answer(plan, results, { status: before.status, wouldBe: status, closed: false, awaitingVouch: true })`. Neither can run. In the `manual:` callback of `run()`, `if (!confirmed && plan.json)` refuses with `manual-needs-person` BEFORE a terminal is looked for, and `--confirm-manual` sets `vouchStatus` to null, so `awaiting` is never filled under `--json` and the park is reached only without it. Measured on 2026-11-13 (TL-710): `done TASK-1 --json` with `awaiting_vouch_status` declared and no terminal exits 1 with `refusalKind: manual-needs-person`, `closed: false`, no `awaitingVouch` field, and the task stays `in_progress`. TL-710 asserted that answer (done-awaiting-vouch.test.mjs, "`--json` answers with the refusal `run` parks on") and left the three mutation survivors on the park's answer line (`if (false)`, `{}`, `awaitingVouch: false`) as equivalent mutants. The refusal is load-bearing: scripts/run-loop.mjs runs `done --json` and parks a task itself when `refusalKind` is `manual-needs-person` and `awaiting_vouch_status` is declared (TL-212, around `toVouch`); `awaiting-vouch` is not in `TERMINAL_REFUSALS`. So making `--json` park changes what `run` receives (exit 3 and a new kind) and needs run-loop's mapping changed in the same act; removing the branches leaves `REFUSAL_KINDS.awaitingVouch` with no publisher, and run-terminal-refusal.test.mjs reads that table.

## Steps

1. Decide between: `--json` parks under `awaiting_vouch_status` (answer reachable; run-loop.mjs and its tests take exit 3 and `awaiting-vouch`), or the two `if (plan.json)` answers in parkAwaitingVouch are deleted (and `awaitingVouch` dropped from REFUSAL_KINDS if nothing else publishes it)
2. Change scripts/done-task.mjs (and scripts/run-loop.mjs if the park becomes reachable) accordingly
3. Update the TL-710 test in done-awaiting-vouch.test.mjs that pins the current `--json` refusal, if the decision changes that answer
4. Run `npm run mutation -- --named-only --changed-lines --concurrency 2` and confirm no survivor remains on the park's answer

## Acceptance criteria

- [x] the park's `--json` answer is either reached and asserted or gone, and `run`'s mapping of done's refusal kinds still holds [proof: park-json-tests-green]
