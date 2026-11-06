---
id: TL-587
title: "Each published release leaves a fixture the suite reads"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-587
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: [TL-586]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: released-fixtures-read
    bash: "node --test scripts/tests/released-backlogs.test.mjs"
  - id: notes-name-new-keys
    bash: "node --test scripts/tests/release-notes.test.mjs"
---

## Goal

Every published release leaves a frozen fixture of what its `init` wrote, and the suite proves the current code reads each of them and that the release notes name every config key added since the previous one.

## Context

Nothing in scripts/tests/ exercises a backlog created by an earlier release; every fixture is produced by the current code, so an upgrade regression would pass the suite. On 2026-11-06 the check was done by hand: `git archive v0.1.0`, `init` with it, then the current `doctor`, `declare`, `new --release`, `set` and `deploy status --release` on the result; all worked, and the reverse direction failed (see the task about requires_version). That run should be a test. Tags may be absent in a shallow CI checkout, so the fixture is committed rather than rebuilt from a tag. docs/releasing.md already requires `## Upgrade notes`, and release-notes.test.mjs already ties the notes to the version; it does not check that a new config key is mentioned, and v0.2.0 and v0.3.0 notes name theirs only because somebody remembered.

## Steps

1. Add scripts/tests/fixtures/released/<version>/ holding the tree `init` of that version writes (config.yaml, _template.md, boards.yaml, one task) and the list of config keys that version knew; create them for v0.1.0, v0.2.0 and v0.3.0 from the tags.
2. Add a test that runs the current build, check, doctor, query, stats and new against a copy of each fixture and expects success.
3. Make release-notes.test.mjs fail when a config key known now is absent from the previous release's key list and the notes for the current version do not name it.
4. Add the fixture step to docs/releasing.md and to the branchling-release skill.

## Acceptance criteria

- [x] The current code builds, checks and creates a task in a backlog written by each published release. [proof: released-fixtures-read]
- [x] The notes for the manifest version fail the suite when they omit a config key the previous release did not know. [proof: notes-name-new-keys]
