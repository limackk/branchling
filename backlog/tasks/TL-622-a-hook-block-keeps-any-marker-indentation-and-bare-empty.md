---
id: TL-622
title: "A hook block keeps any marker indentation and bare empty lines"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [hooks]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: hook-indent
    bash: "node --test scripts/tests/hooks-install.test.mjs"
---

## Goal

replaceBlock in scripts/hooks-command.mjs takes the indentation of the opening marker by the same whitespace rule blockRange uses to recognise it, and writes an empty line of a new block without trailing whitespace.

## Context

Found in the TL-601 review. blockRange (scripts/hooks-command.mjs, around line 156) recognises the marker lines with String.prototype.trim(), which strips every Unicode whitespace character, including U+00A0 and form feed. replaceBlock (around line 190) reads the indentation with /^[ \t]*/, so a marker indented with such a character is recognised, but its replacement comes back without that indentation. replaceBlock also prefixes the indentation to every line of the new block, so an empty line inside a future hookBlock() would gain trailing whitespace. Today's block has no empty line and installedBlock trims each line, so neither has an effect yet; nothing outside the markers is affected either way.

## Steps

1. Derive the indentation in replaceBlock from the same rule blockRange applies (the leading run that trim() would remove), or narrow blockRange to spaces and tabs; record which in the commit body and why.
2. Leave an empty line of the new block empty instead of writing the indentation on it.
3. Add hooks-install tests: a marker indented with a non-breaking space keeps that indentation after replacement, and a block containing an empty line is written without trailing whitespace; both fail against the current code.

## Acceptance criteria

- [x] a non-ASCII-indented marker keeps its indentation and an empty block line carries no trailing whitespace [proof: hook-indent]
