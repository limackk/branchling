---
id: TL-634
title: "A dangling link in place of a skill directory is reported"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [skills]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
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

`skills install` reports, instead of throwing, when a dangling symbolic link stands where a packaged skill's directory belongs.

## Context

Found while reviewing TL-603. notADirectory() in scripts/install-skills.mjs uses existsSync(), which follows links, so a dangling symlink at `.claude/skills/backlog-workflow` reads as absent: compareInstalled() reports every file under it as `missing`, and installSkills() then calls mkdirSync(dirname(destination), {recursive: true}), which throws ENOENT uncaught (`ENOENT: no such file or directory, mkdir '<repo>/.claude/skills/backlog-workflow'`). The repository's own `.claude/skills/*` are symlinks, so a link whose target moved is a realistic layout. The same applies to a dangling link at a nested directory of a skill.

## Steps

1. In notADirectory (or compareInstalled), detect an ancestor that lstat shows as a symbolic link whose target does not exist, and report the file as `blocked` with `at` naming that link, so renderInstall's 'not a directory' remedy names it.
2. Add a test in scripts/tests/skills-install.test.mjs with a dangling symlink in place of the skill directory, with a positive control where the link points at a real directory.

## Acceptance criteria

- [ ] skills install reports a dangling symlink in place of a skill directory without throwing [proof: suite-file]
