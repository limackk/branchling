---
id: TL-679
title: "done judges a directly executed changed script capable, not undetermined"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: capability-direct-script
    bash: "node --test scripts/tests/contract-can-fail.test.mjs"
---

## Goal

`done` reports whether a verification that runs a changed script executed it, instead of `undetermined`, or the task records why it cannot.

## Context

Observed on 2026-11-10 when TL-629 was closed: its only verification entry was `node scripts/mutation-run.mjs --files scripts/mutation-run.mjs --concurrency 2`, and TL-629 changed scripts/mutation-run.mjs. `done --json` nevertheless reported `capability: {verdict: "undetermined", changedFilesExecuted: []}`. The same day `done --dry-run TL-632` (verification `node --test scripts/tests/doctor.test.mjs`) correctly reported `the run executed a file this task changed`. The verdict is computed by contractCapability() in scripts/contract-capability.mjs from V8 coverage files read by readCoverageFiles(); `undetermined` means the entry was not marked `coverageObserved`. Cause not yet established. Candidates: the coverage of a 30-minute process with many children was not written or not read; the entry's coverage directory was discarded; or the run was judged unobservable for another reason.

## Steps

1. Reproduce with a short verification that runs a changed script directly (not via node --test) and with mutation-run.mjs on a tiny --files selection
2. Find why the entry is not coverageObserved, and fix it so a directly executed changed script yields `capable`
3. If a long-running or spawning entry legitimately cannot be observed, say so in the statement instead of the generic sentence

## Acceptance criteria

- [ ] a verification entry that executes a changed script directly is judged capable [proof: capability-direct-script]
