---
id: TL-466
title: "The forced-colour rerun finishes inside its budget on macOS runners"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-15
updated: 2026-10-15
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-455]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: terminal-independent
    bash: "node --test scripts/tests/suite-is-terminal-independent.test.mjs"
  - id: macos-runs-green
    bash: "gh run list --workflow test.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId' | xargs -I{} gh run view {} --json jobs --jq '.jobs[] | select(.name | test(\"macos\")) | .conclusion' | sort -u | grep -qx success && echo 'every macOS job of the newest test.yml run on main concluded success - OK'"
---

## Goal

`the rendering tests pass with colour forced on`
(`scripts/tests/suite-is-terminal-independent.test.mjs:91`) completes on the
GitHub-hosted macOS runners and reports what the rendering tests did, instead
of being killed by its own time limit.

## Context

After TL-461 and TL-462, run 38755633972 (commit 636e202, 2026-10-15) was green
on all three Ubuntu jobs. All three macOS jobs (Node 18, 20, 22) failed on this
one test, with no failing rendering test named: its duration was 600042 to
600053 ms each time. The guard reruns 151 rendering test files under
`FORCE_COLOR` through `spawnSync(..., { timeout: 600_000 })`, and on these
runners the rerun takes longer than that, so the child is killed and the
non-zero status reads exactly like a colour dependence. Locally on macOS the
same test takes about 300 s.

That is the defect worth fixing first: a timeout and a real failure must not
produce the same message. Then make the rerun fit, for example by running the
files concurrently (`--test-concurrency`), narrowing what counts as a
rendering test, or giving the budget per file instead of per suite. Raising
the single limit alone is the weakest option; say why if it is chosen.

The Windows job is TL-463 and is out of scope here.

## Steps

1. Distinguish a timeout (`signal`/`error` on the spawn result) from a red
   rerun in the assertion message.
2. Bring the rerun inside its budget on macOS runners.
3. Push only on the owner's request and confirm the macOS jobs.

## Acceptance criteria

- [ ] The guard passes locally and says "timed out" when it does. [proof: terminal-independent]
- [ ] Every macOS job of the newest run on main concluded success. [proof: macos-runs-green]
