---
id: TL-615
title: "Doctor's printed fixes carry the --dir it was run with"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [doctor]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: doctor-fix-carries-dir
    bash: "node --test scripts/tests/doctor.test.mjs"
---

## Goal

Every repair command doctor prints, when doctor was run with --dir, carries that --dir, so running the printed fix acts on the backlog doctor examined.

## Context

scripts/doctor.mjs builds each row's fix as N + ' <command>' (for example the template row's 'template refresh', the hooks row's 'hooks install', 'skills install', 'check', 'migrate-prefix'), and none of them includes the --dir the user passed. Run from outside the backlog as `doctor --dir <path>`, doctor reports on <path> but prints fixes that, run as printed from the same cwd, resolve a different backlog or none. Raised as a minor issue by the TL-595 supervisor, who noted every row behaves the same way, so it is a doctor-wide gap rather than a regression of one row. Commands whose fix does not take --dir (a git command, or one acting on the repository rather than the backlog) must be left as they are, and that distinction has to be explicit rather than a string match.

## Steps

1. Find where doctor knows the --dir it was given, and thread it to the place rows build their fix
2. Append --dir <path> to each fix that names a backlog command accepting --dir; leave git commands and fixes that take no --dir unchanged
3. Add a test in scripts/tests/doctor.test.mjs that runs doctor --dir from an unrelated cwd on a fixture with a lagging template, runs the printed fix from that same cwd, and asserts the row turns OK; include a control that the fix without --dir does not

## Acceptance criteria

- [x] A fix printed by doctor --dir, run from the same cwd, repairs the backlog doctor examined [proof: doctor-fix-carries-dir]
