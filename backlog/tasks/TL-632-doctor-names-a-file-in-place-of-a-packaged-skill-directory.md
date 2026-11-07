---
id: TL-632
title: "doctor names a file in place of a packaged skill directory"
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
  - id: doctor-names-ancestor
    bash: "node --test scripts/tests/doctor.test.mjs"
---

## Goal

`doctor` reports a non-directory standing where a packaged skill's directory belongs as a warning that names that path, instead of 'not installed' with a remedy that cannot work.

## Context

Found while doing TL-603. checkSkill() in scripts/doctor.mjs tests existsSync(<target>/<name>/SKILL.md) BEFORE it calls compareInstalled(), so when `.claude/skills/backlog-workflow` is a regular file it returns INFO 'not installed: backlog-workflow' with the remedy `skills install`. Since TL-603 that command no longer crashes there, but it installs nothing either: it reports `not a directory, left alone: backlog-workflow`. The same function's WARN branch for blocked files builds its remedy from `f.file`; compareInstalled() now carries `at` on a blocked entry whose obstruction is an ancestor (e.g. `demo/refs` for `demo/refs/notes.md`), and the remedy should name `at` when present, as renderInstall() in scripts/install-skills.mjs already does.

## Steps

1. In checkSkill, consult compareInstalled() before the missing check, and treat a blocked entry with `at` as WARN naming join(target, at) in the remedy.
2. Add tests in scripts/tests/doctor.test.mjs (or a skill-specific doctor test) for a file in place of the skill directory and a file in place of a nested directory, with a control where the directory is real.

## Acceptance criteria

- [ ] doctor warns about a file in place of the skill directory and its remedy names that path [proof: doctor-names-ancestor]
