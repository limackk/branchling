---
id: TL-612
title: "The raised floor line of declare has a CLI test again"
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
conflict_group: [release]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: declare-raise-print-test
    bash: "node --test scripts/tests/declare-requires-version.test.mjs"
---

## Goal

The line `declare` prints when it raises requires_version, and the non-null requiresVersion it answers in --json, are proved through the CLI again.

## Context

Since TL-593 a requires_version floor below KEY_SINCE.requires_version (0.4.0) is a parse problem, and both keys declare writes (WRITABLE_KEYS in scripts/declare-vocabulary.mjs: releases, deploy_targets) arrived in 0.3.0. So no file the parser accepts has a floor below a writable key's release, and the branch in runDeclare that prints `requires_version: <from> → <to> — `<key>` arrived in ...` and returns a non-null requiresVersion is unreachable through the CLI. TL-593 removed the two CLI tests that reached it with a 0.1.0 / 0.2.0 floor; the raise itself stays proved through the pure appendEntryText with its own release table, but the printed line and the JSON field of the command have no test. The guard test `every key declare writes predates requires_version` in scripts/tests/declare-requires-version.test.mjs fails the day a writable key is newer than the floor key, which is one way back; the other is a seam (a release table passed to the command, as appendEntryText already takes) so the print is tested now.

## Steps

1. Decide between waiting for a writable key newer than requires_version and giving runDeclare (or its printer) an injectable release table.
2. Write the CLI-level test of the raise: the text line and the --json requiresVersion {from, to}.
3. Confirm the test fails when the print line or the JSON field is removed.

## Acceptance criteria

- [ ] the printed raise line and the --json requiresVersion of declare are asserted by a test that fails without them [proof: declare-raise-print-test]
