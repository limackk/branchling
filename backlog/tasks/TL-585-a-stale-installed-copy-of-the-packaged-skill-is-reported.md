---
id: TL-585
title: "A stale installed copy of the packaged skill is reported and refreshable"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-585
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: stale-skill-reported
    bash: "node --test scripts/tests/skills-install.test.mjs scripts/tests/doctor*.test.mjs"
---

## Goal

A repository whose installed copy of a packaged skill differs from the one the installed package ships is told so by `doctor`, and `skills install` has an explicit way to refresh it, so a change to the skill's description reaches users who upgrade.

## Context

scripts/install-skills.mjs copies `backlog-workflow` into <repo>/.claude/skills/ and never overwrites an existing file, by design, because the user may have edited it. checkSkill() in scripts/doctor.mjs only checks that SKILL.md exists. The agent-file pointer, by contrast, carries a version and `instructions --update-nudge` refreshes it. So the skill's procedure stays current (it lives in `instructions`), but its DESCRIPTION, which decides when an editor loads the skill at all, is frozen at install time: the uncommitted description edit in .agents/skills/backlog-workflow/SKILL.md on 2026-11-06 would reach no existing user. The refresh must stay opt-in and must not discard a user's own edits silently.

## Steps

1. Make doctor compare the installed SKILL.md with the packaged one and report a difference as INFO with the refresh command.
2. Add an explicit refresh flag to `skills install` that replaces only files identical to a previously shipped version or that the user names, and reports what it replaced.
3. Test both with fixtures.

## Acceptance criteria

- [x] doctor reports a stale installed skill, and the refresh flag updates it without touching an unrelated user file. [proof: stale-skill-reported]
