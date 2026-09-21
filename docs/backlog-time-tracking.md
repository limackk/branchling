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
