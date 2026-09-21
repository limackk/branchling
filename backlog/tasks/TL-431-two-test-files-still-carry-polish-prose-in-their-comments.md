---
id: TL-431
title: "Two test files still carry Polish prose in their comments and fixtures"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  # The proof is an ABSENCE, so it needs a positive control: the same command
  # must find something today (it finds four lines across two files) and
  # nothing afterwards. `grep -c` with an inverted exit is that shape.
  - id: no-polish-prose
    bash: "! grep -nE 'PRAWDZIW|oblewa|nieistniejaca|wejdzie w' scripts/tests/flag-validation.test.mjs scripts/tests/cli-help.test.mjs"
  - id: those-files-still-pass
    bash: "node --test scripts/tests/flag-validation.test.mjs scripts/tests/cli-help.test.mjs"
---

## Goal

Every comment and every assertion message in `scripts/tests/` is in English.
Two files are not, and they are the last known ones.

## Context

Found on 2026-09-21 while reading these files for TL-266, which needed their
flag-validation and help guarantees. AGENTS.md draws the language boundary
around "what a stranger reads when they open the repository" and names
`scripts/` without exception; TL-137 translated 145 task and doc files and did
not reach these two.

What is there, measured with
`grep -nE '[ąćęłńóśźż]|PRAWDZIW|oblewa|nieistniejaca|wejdzie w' scripts/ bin/`:

- `scripts/tests/flag-validation.test.mjs:60` — `PRAWDZIWEGO repo`, inside a
  paragraph that is also garbled in English around it: "a relative path that is
  an empty empty", "it script looks for", "a real scenario for `branchling init
  --dir .` in a fresh (open source)". The sentence has lost its claim, so this
  is not a word swap: the paragraph has to be re-derived from what the function
  below it actually does.
- `scripts/tests/cli-help.test.mjs:86` — the assertion message `name + " -h
  oblewa"`, which is what a failing run PRINTS.
- `scripts/tests/cli-help.test.mjs:94` — the fixture flag `--nieistniejaca`
  ("nonexistent"), a value, not prose, but still Polish in the surface a
  reader sees.
- `scripts/tests/cli-help.test.mjs:100` — "once separator wejdzie w TL-58".

NOT in scope, and this is the distinction that matters: the Polish STRINGS in
`scripts/new-task.mjs`, `scripts/tests/new-task.test.mjs` and
`scripts/tests/task-filename-shape.test.mjs` are DATA — the diacritic folding
table and the fixtures that exercise it. Translating those would delete the
test. Only prose a human reads, and the one fixture flag above, are in scope.

## Pre-flight reading

1. `AGENTS.md` — "Language: everything in this repository is English", and what
   it says STAYS Polish (`backlog/history/*.jsonl`), so the boundary is not
   redrawn by accident.
2. `scripts/tests/flag-validation.test.mjs` — the `gitBacklog()` fixture below
   the garbled paragraph: the paragraph has to be rewritten to describe THAT,
   not translated word for word.

## Steps

1. Rewrite the `gitBacklog()` doc comment in `flag-validation.test.mjs` in
   English, from what the function does. The separate defect it reports —
   `BACKLOG_REL` substituting `backlog` for an empty relative path, so
   `branchling init --dir .` looks in `<root>/backlog/tasks` — is worth keeping
   as a sentence, and worth checking whether it is still true.
2. Translate the two assertion messages and the comment in `cli-help.test.mjs`,
   and rename the fixture flag to an English nonsense flag.
3. Re-run both files: the fixture flag is an argument, so renaming it changes
   what is asserted about the refusal.

## Acceptance criteria

- [ ] Neither file carries Polish prose, and the search that finds four lines
      today finds none. [proof: no-polish-prose]
- [ ] Both files still pass, so the rename of the fixture flag did not weaken
      what they assert. [proof: those-files-still-pass]
