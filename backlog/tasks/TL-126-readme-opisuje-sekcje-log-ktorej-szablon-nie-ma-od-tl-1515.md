---
id: TL-126
title: "README describes a ## Log section the template hasn't had since TL-105"
type: task
labels: []
board: main
epic: ""
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 30m
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check the task is really done
  - id: no-log-section
    bash: "! grep -n 'append-only log' README.md"
  - id: sections-match-template
    manual: "each body section README names is a heading present in _template.md"
---

## Goal

`README.md` stops describing a `## Log` section in the task file. After the
change, the description of a task's body in the README matches what is
actually in `_template.md` and what `worktrail done` writes, and the "why"
points to the `reason` field of a record in `backlog/history/`.

## Context

TL-105 removed `## Log` from the template and from the write path: the
reason for a change travels with the WRITE, not as prose in the file. The
README did not notice. Line 175 (the section `## The task file`) still
lists among the body sections "an append-only log of the form `YYYY-MM-DD
status — kto — notatka`".

This is not cosmetic. The README is a PUBLIC surface and the first thing a
stranger reads: it describes a section that `worktrail new` will never
create, so it teaches manual journal-keeping alongside the mechanism that
was built to replace it. Old tasks with `## Log` stay — those are sentences
nobody will reconstruct — but the README must not recommend it to new ones.

Found while working on TL-94 (`worktrail seed`), which generates a task body
and deliberately does not write `## Log`.

## Pre-flight reading

1. `README.md` — the `## The task file` section, the paragraph under the
   YAML block (around line 171-179): the list of body sections.
2. `_template.md` — what the template ACTUALLY contains; this is the source
   of truth for that paragraph.
3. `CLAUDE.md` — the paragraph "The reason for a change travels with the
   WRITE, not as prose in the file (TL-105)".

## Steps

1. Fix the paragraph in the README so it lists the sections the template
   has, and does not list `## Log`.
2. Add one sentence saying where the "why" is: the `reason` field of a
   record in `history/`, and that `reason_required_statuses` decides when it
   is required.
3. Check whether the same nonexistent journal is described anywhere else in
   the README or in `scripts/instructions.mjs`.

## Acceptance criteria

- [ ] README does not describe `## Log` as part of the task file. [proof:
      no-log-section]
- [ ] Every body section the README lists is a heading in `_template.md`.
      [proof: sections-match-template]
