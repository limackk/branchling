---
id: TL-173
title: "A comment between verification entries is refused"
type: bug
labels: []
board: main
epic: "CLI surface"
priority: P3
status: pending
owner: unassigned
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: comment-between-entries
    bash: "node --test scripts/tests/frontmatter-comments.test.mjs"
---

## Goal

A `#` comment line between two `verification:` entries is read as a comment, the
way a `#` comment beside any other frontmatter field already is. Today it makes
the whole contract unreadable and `worktrail done` reports the task as having no
closing contract at all.

## Context

Found while writing TL-30's contract. A comment placed BEFORE the first entry is
accepted; the same comment moved between the first and second entry produces:

```
✗ worktrail done: TL-30 has no closing contract
  verification: cannot read `# …` (expecting one of: id, bash, manual)
```

Two things make this worth fixing rather than working around:

- **The diagnosis is wrong, not just the parse.** "has no closing contract" is
  the message for a task somebody never finished WRITING, and the finalization
  guide tells the reader to go and write one. Here the contract exists and is
  four entries long. A reader following the message would rewrite something that
  is correct.
- **The format annotates fields with `#` everywhere else.** `_template.md`
  documents a dozen fields that way, and TL-70 extracted `stripComment()` so
  every reader of a frontmatter line treats a trailing comment the same. The
  verification list is the one place that does not, and the inconsistency is
  invisible until it fires.

The workaround in TL-30 was to hoist the comment above the list, where it is
further from the entry it explains. That is the cost this bug charges: the
comments that explain a fragile guard get pushed away from the guard.

## Pre-flight reading

1. `scripts/criteria.mjs` — where `verification:` entries are parsed, and the
   `stripComment`/`unquote` import that already exists there for the same
   reason.
2. `scripts/task-fields.mjs` — `stripComment()`, the one implementation of "a
   trailing `# comment` is a convention of the WHOLE format" (TL-70).
3. `scripts/tests/frontmatter-comments.test.mjs` — the existing tests for that
   convention; this case belongs beside them.
4. `scripts/done-task.mjs` — where "has no closing contract" is decided, so the
   message can distinguish an EMPTY contract from an unreadable line.

## Steps

1. Skip blank and `#`-only lines when reading the `verification:` block, at any
   position in the list.
2. Keep a genuinely unreadable line an error — a mistyped `bash:` must still
   fail. Only comments become invisible.
3. Separate the two diagnoses in `done`: "the contract is empty or still the
   template placeholder" and "line N of the contract cannot be read" are
   different problems with different fixes.
4. Restore TL-30's comment to the entry it belongs to, as the fixture that
   proves the fix on a real file.

## Acceptance criteria

- [ ] A `#` line between two verification entries parses as a comment, and the
      entries either side are both read. [proof: comment-between-entries]
- [ ] A mistyped entry key still fails — the fix does not turn every unreadable
      line into silence. [proof: comment-between-entries]
- [ ] An unreadable line and an empty contract produce DIFFERENT messages from
      `done`. [proof: comment-between-entries]

## Decisions

- Not deferred to "YAML comments in general": the frontmatter is read by a
  narrow parser on purpose, and widening it wholesale is a different task with a
  different risk. This is one block, and it is the block whose failure mode is
  a wrong diagnosis.
