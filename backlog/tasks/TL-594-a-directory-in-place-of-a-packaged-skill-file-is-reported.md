---
id: TL-594
title: "A directory in place of a packaged skill file is reported"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-594
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: directory-in-place-no-throw
    bash: "node -e \"const fs=require('fs'),os=require('os'),p=require('path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'skill-dir-'));fs.mkdirSync(p.join(d,'.claude/skills/backlog-workflow/SKILL.md'),{recursive:true});import('./scripts/install-skills.mjs').then(m=>{m.compareInstalled(d);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})\""
  - id: suite-files
    bash: "node --test scripts/tests/skills-install.test.mjs scripts/tests/doctor-agent-setup.test.mjs"
---

## Goal

A packaged skill path that exists as a directory in the repository is reported by doctor and skills install instead of crashing them.

## Context

Found in the TL-585 review. compareInstalled() in scripts/install-skills.mjs calls contentHash() on every installed packaged path that exists. If such a path, for example .claude/skills/backlog-workflow/SKILL.md, is a directory, readFileSync throws EISDIR and both `doctor` (checkSkill in scripts/doctor.mjs) and `skills install` crash. Before TL-585, `skills install` skipped such a path. The case is unlikely but the failure is an uncaught exception rather than a row naming the path.

## Steps

1. Give compareInstalled a state for an installed path that is not a regular file, and make doctor and skills install name it instead of throwing.
2. Add tests in scripts/tests/skills-install.test.mjs and scripts/tests/doctor-agent-setup.test.mjs with a directory in place of a packaged file, and keep a regular-file control.

## Acceptance criteria

- [x] compareInstalled does not throw when a packaged path is a directory [proof: directory-in-place-no-throw]
- [x] the skill install and doctor tests pass, including the new directory case [proof: suite-files]
