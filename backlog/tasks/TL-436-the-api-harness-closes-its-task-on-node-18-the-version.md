---
id: TL-436
title: "The API harness closes its task on Node 18, the version engines promises"
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
blocks: [TL-158]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: api-harness-suite
    bash: "test -f scripts/tests/agent-api-harness.test.mjs && node --test scripts/tests/agent-api-harness.test.mjs"
  - id: green-on-node-18
    bash: "id=$(gh run list --workflow test.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId') && gh run view $id --json jobs --jq '.jobs[] | select(.name | test("18")) | .conclusion' | grep -vqx success && exit 1 || echo 'every Node 18 job of the latest run on main is green — OK'"
---

## Goal

`two incompatible API harnesses close work without exposing credentials` closes its task on Node 18 as it does on newer Node — today the harness exhausts its attempts there and closes nothing.

## Context

Measured on 2026-09-22 (Europe/Warsaw) in https://github.com/limackk/branchling/actions/runs/35697131745 (commit 12bacb6). `scripts/tests/agent-api-harness.test.mjs:105` fails on `test (18, ubuntu-latest)` and `test (18, macos-latest)` only. The assertion wants `/1 closed/`; the run reports

    1 task(s) taken · 0 closed · 1 blocked · 1s
    ! TASK-1  exhausted  2 attempts  0s
        remote-done: test -f TASK-1.done

so the harness ran the compatible adapter twice and the `remote-done` probe never saw `TASK-1.done`. It passes on Node 20, 22 and locally on 24, and the credential half of the case is not what breaks — the work simply does not close. A Node-18-only difference in how the adapter is spawned or how its output is awaited is the first place to look; `engines` claims `>=18`, so this is either a repair or a decision to narrow that claim.

## Steps

1. Reproduce under Node 18 (nvm or a node:18 container) and read the run log the failure names, which the harness writes per attempt.
2. Find what differs — most likely the adapter process is awaited differently, or the file the `remote-done` probe looks for is written after the probe runs.
3. Fix it in the harness rather than by relaxing the assertion; the assertion is the only thing that says the work closed.

## Acceptance criteria

- [ ] The harness tests pass in this session's environment. [proof: api-harness-suite]
- [ ] Both Node 18 jobs of the newest run on the default branch concluded success. [proof: green-on-node-18]
