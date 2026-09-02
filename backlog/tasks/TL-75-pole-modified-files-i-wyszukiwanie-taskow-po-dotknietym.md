---
id: TL-75
title: "The modified_files field and searching tasks by touched file"
type: code
labels: [post-launch]
board: main
epic: "Data integrity"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node --test scripts/tests/modified-files.test.mjs"
  - bash: "node scripts/cli.mjs query --modified-file scripts/cli.mjs --count"
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

- [ ] `query --modified-file` finds tasks by file and by directory prefix.
- [ ] Paths are relative to the repository root, including in a co-located
      layout.
- [ ] There is one data source and it is documented in the README.
- [ ] The test has a negative control (an unrelated file gives no matches).

## Log

2026-08-31 pending — agent:claude — created from an analysis of Backlog.md
(github.com/MrLesk/Backlog.md), point 3.
