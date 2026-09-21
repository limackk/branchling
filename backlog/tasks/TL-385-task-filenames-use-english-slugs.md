---
id: TL-385
title: "Task filenames use English slugs"
type: task
labels: []
board: main
epic: "Repository readability"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [AGENTS.md, CONTRIBUTING.md, README.md] # paths relative to the repository root
# REWRITTEN IN FLIGHT. The block as written carried both known defects, one per
# entry, and neither could have been noticed by running it:
#  * `filename-policy` named `scripts/tests/task-filename-language.test.mjs`, a
#    file that has never existed in this repository. `node --test <missing
#    path>` EXITS 0 (TL-424), so the entry would have ticked its criterion
#    green having executed nothing. Its NAME was the second defect: it promised
#    a judgement about language, and AGENTS.md deleted the only such detector
#    this repository ever had because a green result from it said nothing about
#    any language but one.
#  * `references-green` ran `check --docs`, which was already green on the
#    unchanged tree before a single file moved (TL-260) — it cannot fail for
#    want of this task's work. It is kept, inside the full `check`, for what it
#    honestly is: a no-regression gate over the 607 links and `related_docs`
#    entries this migration could break, beside `--refs`, which is the gate
#    that reads the task-file PATHS written in prose.
# WHAT NO ENTRY HERE CLAIMS. None of the `bash:` entries can fail merely because
# a slug is in the wrong language, and none pretends to. That is the limit
# AGENTS.md sets on guards, and it is why the English judgement is a `manual:`
# entry a person has to vouch for with `done --confirm-manual`.
verification:                      # HOW to check the task is really done
  - id: filename-shape
    bash: "node --test scripts/tests/task-filename-shape.test.mjs"
  - id: references-resolve
    bash: "node scripts/cli.mjs check"
  - id: slugs-read-as-english
    manual: "List the migration with `git log --diff-filter=R --name-status -- backlog/tasks` and read the new slugs. Each one must be English and must say what its task is about. Vouch only for what you read."
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Every task filename consists of its immutable task id and a lowercase English
slug. Historical Polish slugs are renamed without changing ids, losing task
content or leaving a path reference behind. The repository's language rule is
therefore true for names people see as well as for file content.

## Context

Task files inherited their filenames from titles written before the repository
adopted English as its public language. TL-137 translated the task contents but
deliberately left filename migration for a separate decision. On 2026-09-08 the
product owner decided that the language rule applies to filenames too.

The id is the stable identity. A migration must retain it, use `git mv` for
each rename, and update every repository reference to the old path. History
logs are named only by id and must not be renamed. New task titles must already
be English, so their generated slugs must be English as well.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `AGENTS.md` and `CONTRIBUTING.md` — apply the filename language rule at the
   repository and contributor boundaries.
2. `backlog/tasks/` — inventory every non-English task slug while preserving
   the id in each filename.
3. `scripts/task-id.mjs` and task creation tests — identify the filename shape
   the tool accepts and add a regression guard without hard-coding a project
   vocabulary.
4. `git grep` over the repository — find references that must move with a task
   filename.

## Steps

1. Define and test the English-slug filename policy.
2. Rename every historical task file with a non-English slug using `git mv`.
3. Update paths in documentation, task metadata, tests and scripts without
   changing task ids or history-log filenames.
4. Rebuild computed backlog views and run the focused policy and documentation
   checks.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Every task filename is its own id followed by a lowercase ASCII slug of
      hyphen-joined words, the id in the filename is the `id:` inside the file,
      and every history log is still named by a bare id.
      [proof: filename-shape]
- [x] A task created by `new` gets a filename of that shape, so the rule holds
      for the next one without anybody reviewing it. [proof: filename-shape]
- [x] No repository reference points at a task filename that does not exist:
      every one of the ten release gates passes, `--refs` over the task-file
      paths written in prose and `--docs` over the links and `related_docs`
      entries among them. [proof: references-resolve]
- [x] The new slugs read as English and say what their tasks are about — a
      person's judgement, because no guard in this repository decides the
      language of prose. [proof: slugs-read-as-english]
- [x] Nothing else in the suite broke on 134 renames. [proof: suite-green]
