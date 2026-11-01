---
id: TL-500
title: "A verification string from a task document survives new unchanged"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: local:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: round-trip
    bash: "node --test scripts/tests/new-verification-round-trip.test.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`new` writes every `verification:` entry from a task document as YAML that parses back to exactly the string the document carried, so `done` runs the command the author wrote.

## Context

Observed 2026-11-01 in a consumer backlog: a document entry `{"bash": "echo \"$f\" | grep -q '\"name\"'"}` passed to `new --body-file` produced `bash: "echo "$f" | grep -q '"name"'"` in the frontmatter. `verificationEntry()` in `scripts/new-task.mjs` wraps the raw string in double quotes without escaping it, which is invalid YAML for any string holding a double quote or a backslash; the same applies to `manual:`. The consumer fixed two task files by hand. A second defect sits on the read side: `stripComment()` in `scripts/task-fields.mjs` does not know the `\"` escape, so even a correctly escaped value is cut at a ` #` that follows an escaped quote. A line break cannot be represented at all, because the frontmatter readers are line-based and `unquote()` deliberately leaves `\n` literal.

## Steps

1. Write a red-first test: a document with quotes, a backslash, ` #` and `: ` in `bash:` and `manual:` round-trips through `new`, `parseVerification` and `done`
2. Escape the value in `verificationEntry()` with the writer the reader is matched to
3. Teach `stripComment()` the backslash escape inside double quotes, through one scanner shared with `trailingComment()`, which `setFrontmatterField` uses and which carried the same defect
4. Refuse a line break or other control character in `bash:`/`manual:` at document validation, before anything is written

## Acceptance criteria

- [x] A verification string with quotes, backslashes, ` #` and `: ` parses back unchanged, and `done` runs that exact command. [proof: round-trip]
- [x] The full suite stays green. [proof: suite]
