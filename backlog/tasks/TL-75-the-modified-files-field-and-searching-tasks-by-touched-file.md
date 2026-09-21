---
id: TL-75
title: "The modified_files field and searching tasks by touched file"
type: task
labels: [post-launch]
board: main
epic: "Data integrity"
priority: P2
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: suite
    bash: "node --test scripts/tests/modified-files.test.mjs"
  - id: query
    bash: "test $(node scripts/cli.mjs query --modified-file scripts/cli.mjs --status done --count) -gt 0 && echo 'the file finds its tasks — OK'"
  - id: directory
    bash: "test $(node scripts/cli.mjs query --modified-file scripts/ --status done --count) -ge $(node scripts/cli.mjs query --modified-file scripts/cli.mjs --status done --count) && echo 'a directory matches at least what one of its files does — OK'"
  - id: negative
    bash: "test $(node scripts/cli.mjs query --modified-file scripts/never-existed-anywhere.mjs --status done,pending --count) -eq 0 && echo 'an unrelated file matches nothing — OK'"
  - id: documented
    bash: "grep -q 'modified-file' README.md && echo 'the one data source is documented — OK'"
---

## Goal

A task can record the list of files it changed, and `worktrail query
--modified-file <path>` answers "as part of what was this file touched, and
why".

## Context

`git log <file>` says WHO and WHEN changed a file. It does not say AS PART
OF WHAT — and that is a question that genuinely comes up when reading
someone else's code ("why does this function look like this"). The answer
exists in our backlog: it is in the task's `## Goal` and `## Context`
sections. All that is missing is an index from file to task.

This is a feature an external tracker cannot provide — it requires tasks to
live in the same tree as the code. That is, exactly the payoff of Law I,
unrealized.

Decisions to be made:

1. **Who fills the field.** By hand is useless (nobody will maintain it). A
   sensible source is file names from commits mentioning the task ID — to
   be computed from git, not typed in. Decide: a frontmatter field
   (versioned, can lie) or a value computed at read time (Law II, always
   true, but requires a history scan). By default, lean towards computing
   it.
2. **Paths are relative to the repository root**, not the backlog
   directory — the backlog can be co-located, in which case the two are
   not the same thing (`resolveBacklogDir()`).

## Pre-flight reading

1. `scripts/task-fields.mjs` — how a new frontmatter key gets added and
   where an unknown one fails.
2. `scripts/query.mjs` — the table of criteria; the new flag has to enter
   it like the rest.
3. `scripts/paths.mjs` — `resolveBacklogDir()`; the repo root versus the
   backlog root.

## Steps

1. Decide and record in the task: a frontmatter field or a computed value.
2. Implement the chosen source; normalize paths to the repository root.
3. `worktrail query --modified-file <path>` — exact match and
   directory-prefix match (`--modified-file scripts/` catches the whole
   directory).
4. Show the list in the task's detail view in the viewer.
5. `scripts/tests/modified-files.test.mjs` — a fixture with a task and a
   file; the test fails if a query for an unrelated file returns a match.

## Acceptance criteria

- [x] `query --modified-file` finds tasks by file and by directory prefix. [proof: directory]
- [x] Paths are relative to the repository root, including in a co-located layout. [proof: suite]
- [x] There is one data source and it is documented in the README. [proof: documented]
- [x] The test has a negative control (an unrelated file gives no matches). [proof: negative]

## Log

2026-08-31 pending — agent:claude — created from an analysis of Backlog.md
(github.com/MrLesk/Backlog.md), point 3.
- 2026-09-02 in_progress — agent:claude — step 1 settled: COMPUTED, not a
  frontmatter field. Law 2 almost verbatim — a `modified_files:` field would be
  versioned, would need a hand or a hook to maintain it, and would be wrong the
  moment either failed, wrong while looking exactly like a fact. The commits are
  the record and the index over them is a view. The link is the task id in the
  commit message, which this repository's convention already requires, so
  nothing new is asked of anybody; a project that does not follow it gets a
  NAMED empty answer rather than a wrong one. Cost accepted and bounded: one
  `git log` per query, asked for only when `--modified-file` is present, and
  cached on HEAD for the viewer, which rebuilds far more often than it commits.
