---
id: TL-639
title: "Uninstall never reports removing an unclosed hook block it kept"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [hooks]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-07
updated: 2026-11-10
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: uninstall-unclosed-not-reported
    bash: "node --test scripts/tests/hooks-install.test.mjs"
---

## Goal

`hooks uninstall` on a hook whose block of ours opens and never closes refuses or says nothing was removed, instead of reporting a removal while writing the file back unchanged.

## Context

runUninstall in scripts/hooks-command.mjs calls withoutBlock() for every hook whose state is `ours` and ignores its `removed` field. For an unclosed block blockRange() returns null, so withoutBlock returns the text unchanged with removed: false; runUninstall then writes that text back and prints `<hook> removed — the rest of <path> is untouched` and exits 0. The hook still carries the opening marker and the gate. Found while supervising TL-609, which fixed the same false report for a marker quoted inside a line (now read as foreign) but deliberately did not change the unclosed path. install already refuses an unclosed block and names the span from unclosedSpan(); uninstall should either refuse the same way (naming the span a person may delete by hand) or remove nothing and say so.

## Steps

1. In runUninstall, check withoutBlock().removed before writing; never write or report a hook it did not change
2. Refuse with exit 1 and name the span from unclosedSpan(found.unclosed), matching the wording install uses
3. Add a test in scripts/tests/hooks-install.test.mjs: an unclosed block plus the user's lines after it; uninstall exits non-zero, prints no `removed`, and leaves the file byte for byte; positive control that a closed block is still removed

## Acceptance criteria

- [x] Uninstalling a hook with an unclosed block of ours never reports a removal it did not make, and leaves the file untouched [proof: uninstall-unclosed-not-reported]
