---
id: TL-626
title: "A task id mentioned in a trunk commit body does not deploy that task"
type: bug
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
conflict_group: [attribution]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: trunk-body-mention-not-attributed
    bash: "node --test scripts/tests/environments.test.mjs"
---

## Goal

A task id mentioned in a trunk commit's body or later in its title does not place that task in a deployment stage; only the ids the title starts with do, by the same rule as scripts/modified-files.mjs.

## Context

TL-614 changed scripts/modified-files.mjs so that only the run of ids at the head of a commit title (whitespace, comma or colon separated, and ranges such as TL-607..TL-611 expanded) attributes a commit to a task; its module header records the rule and the rejected options. scripts/environments.mjs has its own parser, parseTrunkLog (around line 88), which still scans the WHOLE message (`%B`) with taskIdScanner and adds every id it finds. A trunk commit whose body says 'filed as TL-595' therefore counts as one of TL-595's commits, and `show`/the release view can report TL-595 as reached in a stage on the strength of a commit that only mentioned it. The fix is to reuse titleIds() exported from scripts/modified-files.mjs rather than a second copy of the rule, so the two answers cannot drift apart. Done when parseTrunkLog uses titleIds and scripts/tests/environments.test.mjs has a fixture commit whose body names a second task id, asserting that the second task gets no commit, with a positive control for the title's id.

## Steps

1. Replace the whole-message scan in parseTrunkLog in scripts/environments.mjs with titleIds from scripts/modified-files.mjs
2. Add the body-mention fixture and its positive control to scripts/tests/environments.test.mjs
3. Update the environments.mjs header and the 'no commit on the trunk names a task id' explanation if its wording no longer matches the rule

## Acceptance criteria

- [ ] A task id mentioned only in a trunk commit's body does not place that commit under the task, and an id at the head of the title still does [proof: trunk-body-mention-not-attributed]
