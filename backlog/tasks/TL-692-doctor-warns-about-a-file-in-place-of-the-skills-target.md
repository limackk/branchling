---
id: TL-692
title: "doctor warns about a file in place of the skills target directory"
type: task
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
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-10
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: doctor-suite
    bash: "node --test scripts/tests/doctor-agent-setup.test.mjs scripts/tests/doctor.test.mjs"
---

## Goal

`doctor`'s packaged-skill row names a file standing at `.claude` or `.claude/skills` as a warning with the path to move aside, instead of reporting the skill as not installed.

## Context

Found while doing TL-633. compareInstalled() in scripts/install-skills.mjs now returns ok:false with kind `target-not-directory` and a message naming the path when `<repo>/.claude` or `<repo>/.claude/skills` exists and is not a directory (before TL-633 it threw ENOTDIR, taking doctor down). checkSkill() in scripts/doctor.mjs reads only `state.files` when `state.ok` and otherwise falls through to the absence check, so it prints INFO `not installed: backlog-workflow` with the remedy `skills install` — which then refuses. The row should be a WARNING (as TL-594/TL-632 made the per-file obstructions) naming the obstruction and saying to move it aside before running `skills install`.

## Steps

1. In checkSkill(), consult `state.kind === "target-not-directory"` before the absence check and return a WARN row naming the path (state.message carries it).
2. Add tests in scripts/tests/doctor-agent-setup.test.mjs (or doctor.test.mjs) for `.claude` as a file and `.claude/skills` as a file, each with a control where the directory is real.

## Acceptance criteria

- [x] doctor warns about a file in place of .claude or .claude/skills and names the path to move aside [proof: doctor-suite]
