---
id: TL-480
title: "Agent time per estimate bucket is computed from the task ledger"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-10-21
updated: 2026-10-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: fixtures
    bash: "node --test scripts/tests/agent-time.test.mjs"
  - id: report-runs
    bash: "node scripts/cli.mjs stats --agent-time --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);const v=JSON.stringify(d);if(!/correlated|uncorrelated|insufficient/.test(v))throw new Error('no verdict: '+v.slice(0,200));console.log('verdict present')})""
  - id: decision-recorded
    bash: "grep -q '^## Agent time from the task ledger' docs/backlog-time-tracking.md"
  - id: telemetry-still-absent
    bash: "node --test scripts/tests/no-activity-product-surface.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Answer "how long does an agent actually take on a task estimated at X" from the task ledger alone: a pure, computed calibration of claim-to-done wall-clock per estimate bucket, read from `backlog/history/*.jsonl` for actors in the `agent:` namespace, printed by `stats --agent-time [--json]` and offered as a hint by `new --estimate` and `next`. No new data is collected and nothing is written back into task files.

## Context

TL-29 built estimate calibration on activity heartbeats and TL-378 removed it with the whole telemetry subsystem (commit 1e7f9e2), on the grounds that measuring who worked and for how long is a privacy and retention product that does not strengthen authorization, scope or proof. TL-378 also states that `audit` must not reconstruct working time. This task is therefore a deliberate, NARROW reversal of that decision and must record it as such before any code lands: it reads only status transitions the ledger already holds, versioned and append-only, and produces a computed view that may be deleted (law 2). It does not revive heartbeats, sessions, engaged time, token cost or per-actor scorecards.

A one-off measurement on 2026-10-21 (scratch script, not committed) over 370 agent-claimed closings, last `-> in_progress` to `-> done`, gave medians of 5m (30m, n=36), 7m (2h, n=209), 9m (4h, n=31), 10m (1d, n=70) and 40m (1w, n=8, p80 947m). Two conclusions follow. First, the relation is strongly sublinear: a 16x larger estimate moves the median about 2x, so a constant `human / N` multiplier would be false and the output must be a per-bucket range, never a ratio. Second, wall-clock carries known distortions — overnight idle inside a claim, handoffs and re-claims (only the last segment was counted), parallel sessions, time spent in `blocked` or `awaiting_vouch` — and the design must state which of them it corrects and which it only reports.

Rejected: an `agent_estimate` frontmatter field. It would be a computed truth stored by hand, stale the moment it is written, which is exactly the shape law 2 forbids. Rejected: an external script only (variant zero). It is consistent with TL-378 but cannot offer the hint at `new`, which is where an estimate is actually chosen.

The removed `scripts/calibration.mjs` (recoverable from commit ceebed5 / the parent of 1e7f9e2) already encodes the report rules worth keeping: an `n` threshold below which a bucket says "not enough data", a p20-p80 range instead of a point, breakdowns only when every cell meets the threshold, unmeasured tasks counted separately, and a correlation gate whose verdict is printed above the table. Reuse those rules; do not reuse its heartbeat input.

## Steps

1. Record the decision first: add a section to `docs/backlog-time-tracking.md` titled `Agent time from the task ledger` that states what TL-378 removed, what this task reintroduces, why the ledger route does not reopen the privacy argument, and what stays removed. If the review of that section rejects the reversal, close this task as cancelled with that reason and build nothing.
2. Define the measured interval in one pure function over history records: segments from each `-> in_progress` to the next exit from it, summed per task, segments whose claim actor is outside the `agent:` namespace excluded, segments longer than a configured cap reported as outliers rather than averaged in. Decide and document how `blocked` and `awaiting_vouch` time is treated.
3. Write `scripts/agent-time.mjs` as a pure module with no disk access: (history records, tasks) -> buckets keyed by estimate with `n`, p20, median, p80, an `insufficient` flag below the threshold, a count of closed tasks with no measurable interval, and a correlation verdict (correlated | uncorrelated | insufficient). Buckets use `estimateHours()` from `scripts/estimate.mjs`, never a second parser.
4. Take the `n` threshold and the outlier cap from `config.yaml` as new keys with defaults in `scripts/config.mjs`; an unknown key still fails.
5. Add `stats --agent-time` with `--json`, following the existing stats arithmetic/formatting split. The verdict prints above the table; an `uncorrelated` verdict labels the table as not fit for planning.
6. Print the bucket's range as a one-line hint in `new --estimate <e>` and in `next` for the task it hands out, only when the bucket meets the threshold.
7. Write `scripts/tests/agent-time.test.mjs` red-first, on fixtures only: a bucket below the threshold, a handoff split into two segments, an overnight outlier, a human-claimed task excluded, a task with no claim counted as unmeasured, and the hint absent below the threshold. No assertion about this repository's own history.

## Acceptance criteria

- [x] Buckets, segments, outliers, the threshold and the hint behave as specified on fixtures, independent of this repository's data. [proof: fixtures]
- [x] The report runs against a real tree and always carries a correlation verdict, whatever the data says. [proof: report-runs]
- [x] The narrow reversal of TL-378 is written down, not only implied by the code. [proof: decision-recorded]
- [x] No removed telemetry command or surface came back with this change. [proof: telemetry-still-absent]
- [x] The whole suite stays green. [proof: suite-green]
