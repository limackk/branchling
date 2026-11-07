---
id: TL-633
title: "A file in place of the skills target directory is reported"
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
conflict_group: [skills]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: suite-file
    bash: "node --test scripts/tests/skills-install.test.mjs"
---

## Goal

`skills install` reports, instead of throwing, when `.claude` or `.claude/skills` itself exists in the target repository and is not a directory.

## Context

Found while doing TL-603. compareInstalled() in scripts/install-skills.mjs now reports `blocked` with `at` for a non-directory between skillsTarget() and a packaged file, but deliberately starts the walk BELOW skillsTarget(repoRoot). When `<repo>/.claude` or `<repo>/.claude/skills` is a regular file, every packaged file still reads as `missing` and installSkills() calls mkdirSync(dirname(destination), {recursive: true}), which throws EEXIST/ENOTDIR uncaught, naming no remedy. `init` installs skills through the same function, so it is affected too.

## Steps

1. Decide how the obstruction at or above the skills target is reported (a `blocked` state with `at` relative to the repository root, or a result with ok:false and a message naming the path), and implement it in compareInstalled/installSkills.
2. Add tests in scripts/tests/skills-install.test.mjs for `.claude` as a file and `.claude/skills` as a file, each with a control where the directory is real.

## Acceptance criteria

- [ ] skills install reports a file in place of .claude or .claude/skills without throwing [proof: suite-file]
