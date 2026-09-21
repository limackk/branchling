---
id: TL-428
title: "The last Polish filename in docs is English"
type: task
labels: []
board: main
epic: "Repository readability"
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m                      # 30m | 2h | 1d | 1w
confidence: high                   # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/funkcjonalnosci.md, AGENTS.md]
verification:                      # HOW to check the task is really done
  # Both run against this tree. The first fails today — the file is there — so
  # neither entry can pass on an empty sample.
  - id: no-polish-filename
    bash: "test ! -e docs/funkcjonalnosci.md"
  - id: links-resolve
    bash: "node scripts/cli.mjs check --docs"
---

## Goal

`docs/funkcjonalnosci.md` is called what its own first line says it is, in
English, and every path that named it still leads somewhere.

## Context

`AGENTS.md` puts filenames inside the language rule — "every new filename, and
every filename touched by a rename, uses a lowercase English slug" — and TL-137
translated the CONTENTS of `docs/` without renaming files, because a filename
migration must preserve every path reference and is therefore its own change.
TL-385 covers `backlog/tasks/`. This is the one file left in `docs/`: its
content is English and begins "# Functionality — state and direction", while its
name is not.

Five task files name the path, four of them in `related_docs`, and two records
in `backlog/history/TL-104.jsonl` carry it inside a `related_docs` change. The
history is append-only and is NOT rewritten (`AGENTS.md`): those two lines are
what the field held on that day, and a rename does not make them untrue.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `AGENTS.md` — the language rule, and the paragraph on why the history is not
   rewritten to match a rename.
2. `docs/funkcjonalnosci.md` — its first heading, which is where the new name
   comes from.
3. `backlog/tasks/TL-37-split-the-documents-the-mechanism-travels.md` — a prose
   reference rather than a `related_docs` entry; `check --docs` reads both.

## Steps

1. `git mv` the file to the English slug its own heading gives.
2. Update the four `related_docs` entries and the prose reference; leave
   `backlog/history/` alone.
3. `node scripts/cli.mjs check --docs`, then `build`.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] No file under `docs/` carries a non-English slug.
      [proof: no-polish-filename]
- [ ] Every `related_docs` entry and prose path that named it resolves.
      [proof: links-resolve]
