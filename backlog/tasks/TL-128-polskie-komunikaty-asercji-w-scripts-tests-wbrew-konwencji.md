---
id: TL-128
title: "Polish assertion messages in scripts/tests/ against the \"all code in English\" convention"
type: task
labels: []
board: main
epic: "branchling — the tool"
priority: P3
status: done
owner: agent:docs
role: docs
estimate: 30m
confidence: high
created: 2026-09-01
updated: 2026-09-04
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
verification:
  - id: language-green
    bash: "node scripts/cli.mjs check --language"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Assertion messages in `scripts/tests/` are in English everywhere. After this
task, `scripts/tests/` has no Polish text left outside test DATA (fixtures,
positive controls, task content in temporary repositories), those are marked
with a comment so nobody "fixes" them, and the words the translation retires
are deleted from `scripts/language-dictionary.txt` in the same commit.

## Context

CLAUDE.md says everything in this repository is English, without a
directory-shaped exception, and names test descriptions and error messages
explicitly. The premise this task was filed on in 2026-09-01 — that
`scripts/tests/` sits outside the language guard, so the convention applies
with nothing enforcing it — is **wrong, and was wrong when written.**

`PUBLIC_PATHS` in `scripts/check-public-language.mjs` is `scripts`, `bin`,
`README.md`, `_template.md`, `backlog`, `docs` and `skills`; `SKIP_DIRS`
excludes only `node_modules` and `.git`, and the walk collects `.mjs`. So
`scripts/tests/` has always been INSIDE the perimeter, and `branchling check
--language` reads every file named below. The carve-out this task quoted — a
test taking the expected name from the same constant as the code asserts
`N === N` — belongs to the PRODUCT NAME guard and to nothing else. TL-229
states the same boundary from the other side.

**What actually let the Polish stand was the dictionary, not the perimeter.**
`scripts/language-dictionary.txt` is a snapshot generated from the tree, so
the words in these assertion messages were harvested INTO the accepted
vocabulary and the guard then read them back as known English. Its own header
said so and named this task as the debt. That is why the contract below is the
guard rather than the suite, and why the dictionary entries had to go in the
same commit: the guard can only speak once the words stop being whitelisted.

**The 2026-09-01 file list has decayed since.** `history.test.mjs` was
translated in passing by later work and carries nothing. `boards.test.mjs`
had four messages (`NOW.yaml` not written, twice; a missing script, twice).
`task-fields.test.mjs` had one — its sibling `f.key + " bez etykiety"`, cited
here as evidence, had already become `f.key + " has no label"`, leaving the
enum assertion as the only Polish line in that file. `public-language.test.mjs`
is DATA throughout: its Polish is the fixture its positive controls plant, and
every such line already carries a `language-guard: allow` comment saying so.

Half-translated Polish elsewhere in `scripts/tests/` is NOT this task's:
`new-task.test.mjs` holds a comment the guard's word lists genuinely miss, and
that is TL-229, which has to widen a detector rather than delete a word.

## Steps

1. Translate the five assertion messages — four in `boards.test.mjs`, one in
   `task-fields.test.mjs`.
2. Delete the words they retire from `scripts/language-dictionary.txt`, by
   hand, as that file's header prescribes. Before the translation this makes
   `check --language` FAIL, naming the five lines; that failure is the proof
   this task never had.
3. Leave test DATA alone and confirm every remaining Polish line carries a
   comment saying it is data, not debt.

## Acceptance criteria

- [x] `scripts/tests/` has no Polish in an assertion message or a test
      description. [proof: language-green]
- [x] The words the translation retires are gone from
      `scripts/language-dictionary.txt`, so the guard would fail if one came
      back. [proof: language-green]
- [x] Every remaining Polish line is test data and carries a comment saying
      so. [proof: language-green]
- [x] The suite stays green — the messages changed, not what they assert.
      [proof: suite-green]

## Decisions

**The old contract was `node --test scripts/tests/*.test.mjs` and it was green
before any work started.** An assertion message is the text printed when an
assertion FAILS, so translating one cannot move a passing suite by
construction; the entry could never have distinguished this task from an
untouched tree. It is kept as a regression check — the strings are edited in
place and must not break the assertions around them — but it is no longer what
closes the task.
