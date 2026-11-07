---
id: TL-631
title: "Doctor's deploy-fetch notes name doctor with the --dir it was run with"
type: bug
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: deploy-fetch-note-carries-dir
    bash: "node --test scripts/tests/release-fetch-refspec.test.mjs scripts/tests/doctor.test.mjs"
---

## Goal

The deploy-fetch row's notes that send the reader back to doctor (`# then <product> doctor`) carry the --dir doctor was run with, as every fix of ours does since TL-615.

## Context

TL-615 made every repair command of ours that doctor prints carry the --dir it was run with: fixes built with `ownCommand()` in scripts/doctor.mjs are re-printed by `carryDir()`, and `nextStep()` takes the same dir. Two strings in `checkDeployFetch()` were deliberately left as plain strings because the repair itself is a git command or a declaration in config.yaml, not a command of ours: `unresolvedFix` ("declare `refs/…` by its full refs/ name in deploy_targets …   # then <product> doctor") and the `ambiguous` branch ("git branch --set-upstream-to <remote>/<branch>   # then <product> doctor"). The trailing note still names `doctor` without --dir, so a reader who ran `doctor --dir <path>` from outside the backlog and follows the note re-runs doctor on a different backlog or none. The repair is correct; only the follow-up note is not. The fix needs `checkDeployFetch` to know the dir (or the note to be rebuilt in `carryDir`), without turning the git command itself into an own command.

## Steps

1. Thread the --dir into the two notes in checkDeployFetch, leaving the git command and the config.yaml instruction unchanged
2. Add a test in scripts/tests/release-fetch-refspec.test.mjs (or doctor.test.mjs) that runs doctor --dir from an unrelated cwd on a fixture with an ambiguous remote and asserts the note reads `then <product> doctor --dir <path>`, with a control that a run without --dir prints no --dir

## Acceptance criteria

- [ ] The deploy-fetch row's `then doctor` note carries the --dir doctor was run with, and only when it was run with one [proof: deploy-fetch-note-carries-dir]
