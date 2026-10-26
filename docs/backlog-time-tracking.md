# Activity telemetry was removed

**Status:** Removed from the product on 2026-09-08 (TL-378).

Branchling is a repository-owned protocol for selecting, proving and recording
delivery work. It does not measure who worked, for how long, how many tokens a
provider consumed, or how an individual actor performed. Task estimates remain
ordinary project data; they are not calibrated from activity data.

## Existing local data

Older versions could write raw activity logs outside the repository and per-task
rollups inside `backlog/activity/rollup/`. The current product neither reads nor
writes those files. Upgrading does not remove or alter them: deleting personal
data is a decision for its owner, never an automatic side effect of installing
or upgrading a backlog tool.

If you no longer need legacy local logs, inspect the exact directory first and
remove it yourself with the operating system's normal recoverable deletion
mechanism. Do not remove `backlog/history/`: that is the durable task ledger and
is unrelated to the removed telemetry product.

Versioned historical rollups remain readable in older commits. They are not
migrated, reinterpreted or used by the current binary.

## What this repository did with its own

On 2026-09-21 branchling's own backlog removed `backlog/activity/rollup/` — 206
per-task aggregates of working minutes, 204 of them committed and two that never
were, so the directory did not agree with itself. The advice above is addressed
to the owner of the data; this is that owner acting on it (TL-394).

The argument was not that the files were untidy. Nothing wrote them once TL-378
removed the collector, nothing read them, and `activity forget` — the mechanism
that had justified committing an aggregate at all — went in the same commit, so
their subject had no way to correct or withdraw them. The objects stay in this
repository's git history, which is immutable and does not reopen for this.

## Agent time from the task ledger

**Status:** Added on 2026-10-21 (TL-480) as a narrow, deliberate exception to
the removal above.

TL-378 removed a subsystem that COLLECTED data: heartbeats written while an
actor worked, raw logs outside the repository, per-task rollups inside it,
sessions, engaged time, token cost and per-actor scorecards. Its argument was
that collecting and retaining that data is a privacy and retention product
which strengthens neither authorization, scope nor proof. That argument stands
and nothing it removed comes back.

What returns is one question — *how long does an agent actually take on a task
estimated at X* — answered from data the tool already keeps for a different
reason. Every claim and every closing is a status record in
`backlog/history/`, with its actor and its timestamp, because a change of state
has to travel with its reason (TL-105). `branchling stats --agent-time` reads
those records and nothing else:

- **Nothing new is collected or written.** The report is computed on every
  call, and deleting it costs nothing (the second law). There is no rollup, no
  cache and no frontmatter field — an `agent_estimate:` written into a task
  would be a computed truth stored by hand, stale the moment it was written.
- **Only the `agent:` namespace is measured.** A segment claimed by `local:`,
  `user:` or an observed `unknown` change is not timed, and a task worked
  partly by a person is counted apart as `mixed` rather than timed on its agent
  half. The report describes how long automated work takes; it is not a
  measurement of people.
- **The unit is the task, never the actor.** There is no breakdown by owner or
  by agent name. A per-actor table is the scorecard TL-378 removed.

What is measured, and what is only reported:

- The interval is the sum of every segment a task spent in the in-progress
  status, each from its `-> in_progress` record to the next status record.
  Time in `blocked` or `awaiting_vouch` is NOT counted: in both the task waits
  on something other than the agent, and a handoff or a re-claim adds a segment
  instead of erasing the earlier one.
- A segment longer than `agent_time_segment_cap` (default `8h`) is not averaged
  in. Wall-clock cannot tell an agent working from a claim left open overnight,
  so such a task is counted as an `outlier`, named, and kept out of every
  bucket.
- Only tasks closed into the FIRST archived status (`done` here) are measured.
  A cancelled task's time says nothing about what the estimate would have cost.
- Parallel sessions are not corrected for. Two claims cannot overlap on one
  task, but an agent running several tasks at once makes each of them look
  slower than it was — a distortion the report states rather than repairs.

The report rules are the ones TL-29 settled: below `agent_time_min_n`
(default 8) a bucket says "not enough data" instead of a number; a bucket is a
p20–p80 range with its median, never a ratio to the estimate — a one-off
measurement on 2026-10-21 showed medians moving roughly 2x across a 16x range
of estimates, so a constant multiplier would be false; tasks that could not be
measured are counted next to the table; and a correlation verdict
(`correlated`, `uncorrelated` or `insufficient`) is printed above it, labelling
the table unfit for planning when the spread inside a bucket outweighs the
difference between buckets. `new --estimate` and `next` print the bucket's range
as a one-line hint only when that bucket has met the threshold.
