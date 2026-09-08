---
id: TL-385
title: "Task filenames use English slugs"
type: task
labels: []
board: main
epic: "Repository readability"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-08
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [AGENTS.md, CONTRIBUTING.md, README.md] # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: filename-policy
    bash: "node --test scripts/tests/task-filename-language.test.mjs"
  - id: references-green
    bash: "node scripts/cli.mjs check --docs"
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

- [ ] Every task filename uses its existing id followed by a lowercase English
      slug. [proof: filename-policy]
- [ ] No repository reference points to a renamed historical task filename.
      [proof: references-green]
