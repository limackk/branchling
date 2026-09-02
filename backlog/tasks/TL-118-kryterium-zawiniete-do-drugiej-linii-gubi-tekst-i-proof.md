---
id: TL-118
title: "A criterion wrapped onto a second line loses text and [proof:]"
type: task
labels: []
board: main
epic: "Data integrity"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: wrapped
    bash: "node --test scripts/tests/criteria-mapping.test.mjs"
  - id: tree
    bash: "node scripts/cli.mjs check --criteria"
---

## Goal

An acceptance criterion wrapped onto a following line must be read IN FULL —
together with the `[proof: <id>]` that stands at its end. Today the parser
sees only the first line, so the rest of the sentence and the link to the
proof disappear without a word.

## Context

Measured during TL-87. The task had eight criteria, all with `[proof: suite]`;
`worktrail done --dry-run` checked off FIVE and reported "3 criteria name no
proof". The three left unchecked were exactly the ones wrapped onto a second
line — nobody read the markers on those lines. The workaround in TL-87 was to
collapse those three criteria into one long line.

Why this is not cosmetic:

1. **`check --criteria` states an untruth about someone else's tree.** It
   reports "criterion with no proof" for a criterion that names a proof — and
   under `criteria_links: require` it would FAIL a task written correctly. A
   guard that fails on correct data teaches people to disable the guard.
2. **The criterion's text is truncated in reports.** `parseCriteria` returns
   only the first line, so the message quotes half a sentence (visible in the
   `check` output for a dozen-odd tasks in this repository).
3. **Wrapping is the NORM here, not the exception.** Almost every older task
   in `backlog/tasks/` breaks criteria at 80 columns — so the defect concerns
   most of the tree, not one file.

Decisions still to be made in this task, not settled in advance:

- **What ends a criterion.** The natural rule: indented lines that do NOT
  start a new list item (`- [ ]`) or a new section belong to the previous
  criterion. This is the same rule `setFrontmatterField` applies to
  multi-line frontmatter fields — worth checking whether it can be described
  once.
- **Where `[proof:]` may stand** — at the end of the LAST line of the
  criterion (as a human would write it) or anywhere? One place is easier to
  explain and to write; two give nothing but ambiguity.
- **`applyProofs` checks off by line number** (`c.line`). After the change,
  the criterion's line is no longer its only line — it must be checked that
  the checkoff lands on the line with `- [ ]`, not on a continuation.

## Pre-flight reading

1. `scripts/criteria.mjs` — `parseCriteria()` and `applyProofs()`; both
   functions assume "one criterion = one line".
2. `scripts/tests/criteria-mapping.test.mjs` — existing mapping tests; the
   wrapped case is added there.
3. `backlog/tasks/TL-87-*.md` — three criteria collapsed onto one line as a
   workaround; after the fix they can be expanded back.

## Steps

1. Test FIRST: a criterion wrapped onto two and onto three lines, with
   `[proof:]` at the end of the last one. It must fail against today's code.
2. `parseCriteria`: join continuations into one text, remember the HEADER line
   of the item for checkoff purposes.
3. `applyProofs`: check off on the line with `- [ ]`, not on a continuation.
4. Check `check --criteria` on this tree — the count of "not linked yet" tasks
   should change only where a link was actually written.
5. Expand the three criteria in TL-87 back out (the workaround is no longer
   needed).

## Acceptance criteria

- [ ] A criterion wrapped onto two lines with `[proof: x]` at the end is checked off by `done`. [proof: wrapped]
- [ ] The criterion's text in the `check --criteria` report covers all its lines, not just the first. [proof: wrapped]
- [ ] Positive control: a wrapped criterion WITHOUT `[proof:]` is still reported as unlinked. [proof: wrapped]
- [ ] The checkoff lands on the line with `- [ ]`, and the file is otherwise unchanged byte-for-byte except that mark. [proof: wrapped]
- [ ] `check --criteria` passes on this repository. [proof: tree]
</content>
