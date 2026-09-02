---
id: TL-129
title: "check --language lets Polish through in scripts/serve-backlog.mjs"
type: task
labels: []
board: main
epic: "worktrail — the tool"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: guard-catches-it
    bash: "node --test scripts/tests/public-language.test.mjs"
---

## Goal

`worktrail check --language` should go red on a Polish sentence that it
today lets through, and `scripts/serve-backlog.mjs:241` should be in
English. Once this task is done, the guard has EVIDENTIARY FORCE on this
sample, not only on samples that happened to land on its word list.

## Context

Found while working on TL-97. `scripts/serve-backlog.mjs:241` carries:

```
// (`history-record.mjs --actor claude`) — dlatego czekamy RECONCILE_DELAY_MS,
```

`scripts/` is in `PUBLIC_PATHS`, so the guard DOES read this line — and
says "✓ language: 29563 lines across 96 public files read as English". The
reason is in `scripts/check-public-language.mjs:83`: detection rests on a
closed list of Polish function words, and neither `dlatego` ("because") nor
`czekamy` ("we wait") is on it.

**This is worse than having no guard.** A guard that says "I read 96 files
and all of them are English" gets cited as proof; that citation was false
the entire time this line stood there.

A decision to make in this task, because it is not obvious: adding a few
words to the list closes THIS hole and does not close the class of bug.
Consider detecting by diacritical marks (`ą ć ę ł ń ó ś ź ż`) as a second,
independent signal — it catches a sentence none of whose words are on the
list. Caveat: diacritics alone are not enough (`dlatego czekamy` has none),
and false positives will come from names and test data — which is why the
`language-guard: allow` exception mechanism already exists and is meant to
remain the only way out.

## Pre-flight reading

1. `scripts/check-public-language.mjs` — `PUBLIC_PATHS`, the word list on
   line 83, and the `language-guard: allow` convention.
2. `scripts/tests/public-language.test.mjs` — what this guard's positive
   control looks like today.

## Steps

1. A test that FAILS on today's code: a sample containing `dlatego
   czekamy` in a public file should go red.
2. Extend detection so that this sample gets caught.
3. Fix `scripts/serve-backlog.mjs:241`.
4. Run the guard over the whole tree and resolve every new hit: either
   translate it, or mark it with `language-guard: allow` on that ONE line.

## Acceptance criteria

- [ ] Positive control: a sample with `dlatego czekamy` in a public file
      fails the guard. [proof: guard-catches-it]
- [ ] `scripts/serve-backlog.mjs` has no Polish sentence. [proof: guard-catches-it]
- [ ] `worktrail check --language` is green across the whole tree, and every
      exception has a `language-guard: allow` comment on that one line. [proof: guard-catches-it]
