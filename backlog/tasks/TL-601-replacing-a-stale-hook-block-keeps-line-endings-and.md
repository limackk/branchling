---
id: TL-601
title: "Replacing a stale hook block keeps line endings and indentation"
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
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: [TL-600]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: replace-keeps-endings
    bash: "node --test scripts/tests/hooks-install.test.mjs"
---

## Goal

`hooks install` replacing a stale block of ours keeps the file's line endings and the indentation the block was pasted with, so a CRLF or indented hook does not end up with mixed lines.

## Context

Found in the TL-588 review. `replaceBlock` in scripts/hooks-command.mjs writes the current `hookBlock()` with LF line endings and no indentation. `installedBlock` already matches a block by trimmed line, so an indented or CRLF block whose content is current is left alone; but one whose content is stale is replaced with unindented LF lines, leaving a CRLF file with mixed endings and an indented block flush left. Nothing outside the markers changes, which TL-588 requires and this task must keep.

## Steps

1. Detect the line ending and the leading whitespace of the stale block's opening marker in `replaceBlock`
2. Write the replacement with that ending and indentation
3. Add hooks-install tests for a CRLF file and an indented block, each asserting the bytes outside the markers are unchanged

## Acceptance criteria

- [ ] A stale CRLF or indented block is replaced with lines in the same ending and indentation, and the rest of the file stays byte for byte. [proof: replace-keeps-endings]
