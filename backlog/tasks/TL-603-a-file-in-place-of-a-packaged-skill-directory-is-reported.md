---
id: TL-603
title: "A file in place of a packaged skill directory is reported"
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
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: file-in-place-of-directory-no-throw
    bash: "node -e \"const fs=require('fs'),os=require('os'),p=require('path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'skill-parent-'));fs.mkdirSync(p.join(d,'.claude/skills'),{recursive:true});fs.writeFileSync(p.join(d,'.claude/skills/backlog-workflow'),'x');import('./scripts/install-skills.mjs').then(m=>{const r=m.installSkills(d);process.exit(r.blocked.length?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})\""
  - id: suite-file
    bash: "node --test scripts/tests/skills-install.test.mjs"
---

## Goal

A regular file standing where a packaged skill's DIRECTORY belongs is reported by `skills install` instead of crashing it.

## Context

Found while doing TL-594. compareInstalled() in scripts/install-skills.mjs tests only the installed path itself: when `.claude/skills/backlog-workflow` is a regular FILE, existsSync(`.claude/skills/backlog-workflow/SKILL.md`) is false, the state is `missing`, and installSkills() then calls mkdirSync on the parent, which throws EEXIST uncaught. TL-594 gave compareInstalled the `blocked` state for a non-file AT the path; this is the same failure one level up, in an ancestor between `skillsTarget()` and the file. `doctor` does not crash here (checkSkill reports the skill as not installed), but its remedy, `skills install`, does.

## Steps

1. In compareInstalled, report `blocked` when an ancestor of the installed path below the skills target exists and is not a directory, and make the rendered remedy name that ancestor rather than the file.
2. Add a test in scripts/tests/skills-install.test.mjs with a regular file in place of the skill directory, keeping a control where the directory is real.

## Acceptance criteria

- [ ] installSkills does not throw and reports the path as blocked when a file stands where the skill directory belongs [proof: file-in-place-of-directory-no-throw]
- [ ] the skill install tests pass, including the new case [proof: suite-file]
