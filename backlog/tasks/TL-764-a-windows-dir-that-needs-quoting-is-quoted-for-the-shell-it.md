---
id: TL-764
title: "A Windows --dir that needs quoting is quoted for the shell it is pasted into"
type: task
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-21
updated: 2026-11-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: windows-quoted-word
    bash: "node --test --test-name-pattern='needs quoting' scripts/tests/doctor.test.mjs"
---

## Goal

A doctor fix whose --dir needs quoting on Windows (a space, an apostrophe) is printed in a form the shell it is pasted into reads back as the same path.

## Context

TL-763 made a Windows path of safe characters a bare word. A word outside that set is still wrapped in POSIX single quotes by shellWord in scripts/doctor.mjs, which cmd does not treat as quotes and PowerShell treats differently from sh (no `'\''` escape; an apostrophe is doubled). Which shell the fix targets on Windows is the decision this task makes: PowerShell is the default terminal shell on current Windows, cmd still runs npm scripts. Measure both before choosing.

## Steps

1. Decide the target shell on win32 and write the quoting rule for it.
2. Prove it by spawning that shell on the Windows job with a path containing a space and an apostrophe.

## Acceptance criteria

- [ ] a Windows --dir that needs quoting is read back as the same path by the shell the fix targets [proof: windows-quoted-word]
