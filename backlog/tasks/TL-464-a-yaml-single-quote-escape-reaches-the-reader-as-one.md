---
id: TL-464
title: "A YAML single-quote escape reaches the reader as one apostrophe"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-15
updated: 2026-10-15
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: unquote-escape
    bash: "node --test scripts/tests/task-fields.test.mjs scripts/tests/criteria-mapping.test.mjs"
  - id: full-suite
    bash: "npm test"
---

## Goal

A single-quoted frontmatter value with the YAML escape '' reaches its reader as one apostrophe.

## Context

unquote() in scripts/task-fields.mjs strips the surrounding quotes but does not expand the YAML single-quote escape: in a single-quoted scalar, '' means one '. A verification entry written as bash: 'curl ... | grep -q ''"status":"resolved"''' (valid YAML; the shape a Sentry import routine in a consuming project writes) reached bash as ''"status":"resolved"'', bash concatenated the empty quotes away, grep searched for status:resolved, and done refused a task whose condition was true. Measured on 2026-10-15 in the consuming project: done --dry-run failed while the issue was resolved. Every reader that goes through unquote() (verification, frontmatter fields, config) was affected the same way.

## Steps

1. Red-first test in scripts/tests/task-fields.test.mjs: unquote of a single-quoted value with '' gives one apostrophe; a double-quoted value keeps '' untouched
2. Expand '' only inside single quotes in unquote()
3. Test parseVerification end to end on the bash entry shape that failed

## Acceptance criteria

- [x] A single-quoted value expands '' to ' and the verification entry reaches bash with its inner quotes intact [proof: unquote-escape]
- [x] No other reader of unquote() regressed [proof: full-suite]
