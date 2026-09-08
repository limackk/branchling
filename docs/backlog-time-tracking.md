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
