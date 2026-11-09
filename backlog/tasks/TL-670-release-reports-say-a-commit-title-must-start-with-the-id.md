---
id: TL-670
title: "Release reports say a commit title must start with the id, not name it"
type: bug
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
created: 2026-11-09
updated: 2026-11-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: release-no-commit-wording
    bash: "node --test scripts/tests/release-scope.test.mjs scripts/tests/release-status.test.mjs scripts/tests/release-gaps.test.mjs"
---

## Goal

Every release message that explains a task with no trunk commit says the commit TITLE must start with the task id, not that no commit 'names' it, because since TL-626 a commit that names a task anywhere but at the head of its title does not count.

## Context

TL-626 made parseTrunkLog in scripts/environments.mjs attribute a trunk commit only to the ids its title starts with (titleIds from scripts/modified-files.mjs, the TL-614 rule). Every release module reads trunk commits through parseTrunkLog, so the behaviour is consistent, but three user-facing sentences still describe the old rule: scripts/release-status.mjs (`describe` for note `no-commits`, around line 867: 'no commit on the trunk names it'), scripts/release-gaps.mjs (around line 364: '... and no commit on the trunk names it; ...'), and docs/manual.md (around line 344, the sample output line 'no commit on the trunk names it'). A user whose commit body says 'TL-5' then reads that no commit names TL-5 and sees a commit that plainly does. scripts/tests/release-scope.test.mjs (around line 193) asserts the current wording. TL-626 already reworded scripts/environments.mjs (describeTaskDeployment and explain) and the viewer hint in scripts/viewer-release.mjs; this task carries the same wording to the remaining sites. Done when the three sentences say a commit title must start with the id and the release tests assert the new wording.

## Steps

1. Reword the no-commits sentence in scripts/release-status.mjs and scripts/release-gaps.mjs to say no trunk commit title starts with the task's id
2. Update the sample output line in docs/manual.md to match
3. Update the assertion in scripts/tests/release-scope.test.mjs and any other test that matches the old sentence

## Acceptance criteria

- [ ] The release reports explain a task with no trunk commit by the title-head rule, not by 'names it' [proof: release-no-commit-wording]
