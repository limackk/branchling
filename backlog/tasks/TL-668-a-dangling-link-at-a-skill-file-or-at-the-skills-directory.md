---
id: TL-668
title: "A dangling link at a skill file or at the skills directory is reported"
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
conflict_group: [skills]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-09
updated: 2026-11-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: suite-file
    bash: "node --test scripts/tests/skills-install.test.mjs"
---

## Goal

`skills install` reports, instead of throwing, when a dangling symbolic link stands at a packaged skill FILE or at the skills directory `.claude/skills` itself.

## Context

Found while implementing TL-634, which made notADirectory() in scripts/install-skills.mjs judge the skill's own directories with lstat, so a dangling link in place of `.claude/skills/<skill>` or a nested directory of it is reported as `blocked` with `at` naming it. Two neighbouring layouts still throw uncaught, measured on 2026-11-09 against a fresh `init`: (1) a dangling link AT a packaged file, e.g. `.claude/skills/backlog-workflow/SKILL.md -> <gone>/SKILL.md`: compareInstalled() uses existsSync(installed), which follows the link, so the file reads as `missing`, and installSkills() then calls copyFileSync onto the link, which follows it and throws `ENOENT: no such file or directory, copyfile '<pkg>/.agents/skills/backlog-workflow/SKILL.md' -> '<repo>/.claude/skills/backlog-workflow/SKILL.md'` (and when the link's target directory DOES exist, the copy silently lands outside the repository, at the link's target). (2) a dangling link AT `.claude/skills` (the value skillsTarget() returns): notADirectory() starts its walk BELOW the target, so the target itself is never judged, and mkdirSync throws `ENOENT: no such file or directory, mkdir '<repo>/.claude/skills/backlog-workflow'`. doctor's checkSkill() reads both layouts as `not installed` and names `skills install` as the remedy, which then crashes.

## Steps

1. In compareInstalled(), judge the installed path with lstat: a symbolic link at a packaged file whose target does not resolve to a regular file is `blocked` (the existing 'not a file, left alone' remedy names it).
2. Judge `.claude/skills` (and decide whether `.claude` too) the same way notADirectory() judges a skill directory, and decide how `at` names a path that is the target itself, since `at` is currently relative to the target.
3. Tests in scripts/tests/skills-install.test.mjs for both layouts, each with a positive control where the link resolves; confirm a link at a file whose target directory exists is not written through.

## Acceptance criteria

- [ ] skills install reports a dangling link at a skill file or at the skills directory without throwing [proof: suite-file]
