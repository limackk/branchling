---
id: TL-400
title: "A half-translated comment survived the translation pass"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: suite-green
    bash: "node --test scripts/tests/new-task.test.mjs"
  - id: read-it
    manual: "Read the comment above `const PAT` in scripts/tests/new-task.test.mjs: it is one English sentence that says why the patterns are imported rather than retyped."
---

## Goal

Every comment in `scripts/tests/` is in English, starting with the half-translated sentence in `scripts/tests/new-task.test.mjs`.

## Context

TL-137 translated 145 files, and one sentence survived it in a mangled state: the comment above `const PAT = taskIdPatterns(P)` in `scripts/tests/new-task.test.mjs` reads "not retyped in the test - a bywa cichym 'prawie tym samym'", an English opening welded onto the tail of the Polish original. The claim it was making is that a pattern retyped in a test is a silent 'almost the same', which is the reason the test asks the tool for its own patterns. The repository's language rule admits no directory-shaped exception, and no automated guard reads prose, so a remnant like this is only ever found by somebody passing through. Spotted while implementing TL-237, which changed a different file in the same directory.

## Steps

1. Rewrite the comment in `scripts/tests/new-task.test.mjs` so it states the whole reason in English, keeping the reference to BL-1452
2. Scan `scripts/`, `bin/` and `scripts/tests/` for other half-translated sentences - diacritics alone do not find them, since this one has none

## Acceptance criteria

- [ ] The file still passes after the comment is rewritten. [proof: suite-green]
- [ ] No half-translated sentence is left in that comment. [proof: read-it]
