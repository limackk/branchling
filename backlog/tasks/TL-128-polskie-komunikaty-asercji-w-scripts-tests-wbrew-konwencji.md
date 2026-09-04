---
id: TL-128
title: "Polish assertion messages in scripts/tests/ against the \"all code in English\" convention"
type: task
labels: []
board: main
epic: "worktrail — the tool"
priority: P3
status: pending
owner: unassigned
role: docs
estimate: 30m
confidence: high
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
verification:
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Assertion messages in `scripts/tests/` are in English everywhere — today four
files still have Polish ones left. After this task, `scripts/tests/` has no
Polish text left outside test DATA (fixtures, transliteration tables, task
content in temporary repositories), and those are marked with a comment so
nobody "fixes" them.

## Context

CLAUDE.md says: "All code in English, no exception. Implementation,
identifier names, comments, docstrings, error messages, **test
descriptions**." `worktrail check --language` does not catch this, because its
boundary runs by DIRECTORY — `PUBLIC_PATHS` in
`scripts/check-public-language.mjs` is `scripts`, `bin`, `README.md`,
`_template.md`, and `scripts/tests/` is deliberately outside the guard (a test
taking the expected name from the same constant as the code would be
asserting `N === N`). So the convention applies, but nothing here enforces it.

Seen while working on TL-97: `scripts/tests/task-fields.test.mjs` has
`f.key + " bez etykiety"` and `f.key + " enum bez opcji"` in the test "every
editable field has a label and a known kind". New assertions added in the same
test are in English, so the file is today bilingual within one function.

Files with Polish text (as of 2026-09-01, `grep` for Polish words):
`scripts/tests/task-fields.test.mjs`, `scripts/tests/boards.test.mjs`,
`scripts/tests/history.test.mjs`, `scripts/tests/public-language.test.mjs`.

**Note on the third one.** `public-language.test.mjs` tests the language
guard, so the Polish text there is probably DATA (a sample meant to make the
guard fail). Translating such a sample would disarm the test. This is the
case where you have to read before you change.

## Steps

1. Go through the four files and split: assertion message / test description
   (to be translated) from test data (stays).
2. Translate the first group.
3. Next to every Polish line that is left, add a comment saying it is test
   data — otherwise the next session will report it as the same debt a
   second time.

## Acceptance criteria

- [ ] `node --test scripts/tests/*.test.mjs` green after the change. [proof: suite-green]
- [ ] `scripts/tests/` has no Polish text in an assertion message or a test description. [proof: suite-green]
- [ ] Every remaining Polish line has a comment next to it saying it is test data, not debt. [proof: suite-green]
</content>
