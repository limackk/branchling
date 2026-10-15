---
id: TL-465
title: "A backslash in a double-quoted value survives a write and a read"
type: task
labels: [bug]
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: high                   # how much you trust the estimate
created: 2026-10-15
updated: 2026-10-15
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: round-trip
    bash: "node --test scripts/tests/task-fields.test.mjs"
  - id: suite
    bash: "npm test"
---

## Goal

A value `yamlScalar()` writes in double quotes reads back through `unquote()`
byte for byte, so a title or a `bash:` entry with a backslash (a regex `\s`, a
BRE alternation `a\|b`) no longer doubles its backslashes on every edit and
reaches bash with the meaning YAML gives it.

## Context

Surfaced while fixing TL-464 (commit 49cb8a8), which made `unquote()` expand
`''` inside single quotes and deliberately left this defect out of scope.
`yamlScalar()` in `scripts/task-fields.mjs` escapes `\` as `\\` and `"` as
`\"`; `unquote()` expanded only `\"`. Every write therefore added a backslash,
and every hand-written `bash: "grep 'a\\|b'"` reached bash as `a\\|b` (a
literal backslash) instead of the `a\|b` a YAML parser yields.

The two escapes must be expanded in ONE left-to-right pass. Two sequential
replaces get `\\\"` wrong in one of the two orders. Other YAML escapes (`\t`,
`\n`) stay literal: `yamlScalar()` never writes them, and expanding them would
change hand-written regexes.

Audit of consumer backlogs on 2026-10-15 (tala-workspace `backlog/tasks`,
this repository's `backlog/tasks` and its open worktrees TL-450 and TL-451, 3549 files):
156 double-quoted tokens change meaning, and all 156 now equal what the `yaml`
parser returns for the same token, so not one of them relied on the old
reading. 26 sit in tasks that are not closed (22 in tala-workspace, 4 in
the copies of TL-158 in the two worktrees), mostly `grep 'a\\|b'`
verifications that only now search for what they say. None shows the
doubling growth a repeated edit would leave.

## Steps

1. Red-first round-trip test `yamlScalar -> unquote` for backslashes and `\"`.
2. One-pass expansion of `\\` and `\"` in `unquote()`.
3. Audit consumer backlogs for tokens whose meaning changes.

## Acceptance criteria

- [x] Every value with backslashes and quotes survives `yamlScalar` then
  `unquote` unchanged, and `\\\"` reads as a backslash and a quote. [proof: round-trip]
- [x] The whole suite stays green. [proof: suite]
