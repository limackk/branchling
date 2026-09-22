---
id: TL-437
title: "The suite answers the same twice in a row, or its green means nothing"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-22
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
  - id: green-twenty-times
    bash: "for i in $(seq 20); do node --test scripts/tests/*.test.mjs > /dev/null 2>&1 || { echo "run $i of 20 was red"; exit 1; }; done; echo 'twenty consecutive runs of the suite, all green — OK'"
---

## Goal

The suite answers the same twice in a row on one machine: today it reports `fail 1` on some runs and `fail 0` on the next, with nothing changed between them.

## Context

Observed on 2026-09-22 (Europe/Warsaw) in the worktree for TL-158, on Node v24.18.0, macOS, with `TMPDIR` pointed at an empty directory as TL-403 requires. Eight consecutive runs of `node --test scripts/tests/*.test.mjs` over an unchanged tree gave: 1896/1895 pass/`fail 1`, then `fail 0` six times running, with one earlier `fail 1` before that. The failing case was not captured — the run was piped into a summary filter — and every attempt to reproduce it since has been green, which is exactly what makes it worth a task rather than a note.

WHY IT MATTERS MORE HERE THAN ELSEWHERE. This project closes tasks on a run that could have failed. A suite that is red once in eight runs makes every green ambiguous: the next session cannot tell a real failure from the one that goes away on a retry, and the standing temptation is to re-run until it is green — which is the same thing as not running it. It also lands on CI as an unexplained red, where TL-434, TL-435 and TL-436 are already being investigated as genuine defects, and a flake mixed in among them costs a session each time.

The likely shapes are a timing-sensitive case (a lock, a spawned CLI, a subprocess timeout under load) or a case whose fixture is shared with another file running in parallel. `node --test` runs files concurrently by default, so a test that writes outside its own fixture can be green alone and red beside a neighbour.

## Steps

1. Run the suite in a loop, each run's FULL output to its own file, until a red one is captured: `for i in $(seq 40); do node --test scripts/tests/*.test.mjs > run-$i.log 2>&1; done` then grep the logs for a failure.
2. With the case named, decide whether it is the test or the code that is timing-dependent — a retry loop in a test hides a real race, so fix the cause before relaxing the assertion.
3. If it is a fixture shared between parallel files, give it its own directory rather than serialising the suite.
4. Add a positive control so the fixed case can still fail for the reason it is meant to.

## Acceptance criteria

- [ ] The suite is green in this session. [proof: suite]
- [ ] Twenty consecutive runs over an unchanged tree all pass, which is the property the flake denies. [proof: green-twenty-times]
