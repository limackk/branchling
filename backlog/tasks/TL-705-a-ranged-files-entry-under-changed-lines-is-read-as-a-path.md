---
id: TL-705
title: "A ranged --files entry under --changed-lines is read as a path, not a range"
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
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-11
updated: 2026-11-11
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: changed-lines-range
    bash: "node --test scripts/tests/mutation-changed-lines.test.mjs"
---

## Goal

`node scripts/mutation-run.mjs --changed-lines --files <module>:<start>-<end>` mutates the changed lines of <module> that lie inside the given range, or refuses with a message naming the combination, instead of reporting that the change added no line to `<module>:<start>-<end>`.

## Context

Observed on 2026-11-11 while doing TL-658. `plan()` in scripts/mutation-run.mjs passes the `--files` entries to `changedLineRanges(root, base, modules)` before they are parsed, so an entry written as `path:start-end` reaches `git diff --unified=0 <merge-base> -- path:start-end`, which matches no file. The module therefore lands in `noAddedLines`, and `main()` fails with `nothing to mutate: the change added no line to scripts/x.mjs:1-10` - a message that blames the change for what is a parsing gap. TL-658 made a ranged `--files` entry keep its test selection and report its range only WITHOUT `--changed-lines`; this combination was deliberately left alone. Two defensible behaviours exist: intersect the hand-written range with the changed ranges (the `clip()` helper already exists in that file), or refuse the combination outright with a reason.

## Steps

1. In plan() in scripts/mutation-run.mjs, parse each --files entry with parseEntry() before changedLineRanges() sees it, so git diff is asked about the bare path.
2. Either clip the changed ranges to the hand-written range, or refuse the combination with a message that names both flags; record which in the module header and why.
3. Add a test in scripts/tests/mutation-changed-lines.test.mjs covering a changed module given as path:start-end together with --changed-lines.

## Acceptance criteria

- [ ] --changed-lines with a ranged --files entry no longer reports that the change added no line to the ranged entry [proof: changed-lines-range]
