---
id: TL-250
title: "CLAUDE.md is audited sentence by sentence: enforced, measurable, or prose"
type: task
labels: []
board: main
epic: "Harness"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: audit-table-exists
    bash: "test -f docs/claude-md-audit.md && grep -c '^| ' docs/claude-md-audit.md | awk '$1 >= 20 {exit 0} {exit 1}'"
  - id: docs-links
    bash: "node scripts/cli.mjs check --docs-links"
  - id: language
    bash: "node scripts/cli.mjs check --language"

---

## Goal

Every rule in `CLAUDE.md` is classified as one of three things — ENFORCED by a
command, MEASURABLE by one, or PROSE that only a reader can apply — and the
result is a table in `docs/claude-md-audit.md` with, for each measurable rule
that is not yet enforced, the task that will enforce it. The file itself is
then shortened to the laws, the pointers and the prose that has nowhere else to
go.

## Context

`CLAUDE.md` is 17 KB — about 4,300 tokens, 2% of a 200k window — and is loaded
into every session before any work starts. Much of it is procedure: "merge into
`main` after the commit", "one task = one commit", "a topic surfacing mid-task
becomes a task", "remove the worktree". None of these is checked by anything,
and `stats` on 2026-09-04 shows the merge rule being broken as it is read:
TL-211 and TL-213 are `done` on `tl-211-wave8-pipeline` and `pending` here, the
class of incident the file's own TL-74 paragraph describes.

Law 2 says what is computed may be deleted. The converse applies to the prompt:
a rule a command can check should not be read by the model on every turn — the
same principle as `CONTEXT_RULE`, applied to the harness's own prompt surface.
The tool already has the mechanism: `branchling instructions <topic>` renders
procedure on demand, and `--update-nudge` maintains the pointer to it in the
agent file.

This task is the AUDIT and the table, plus the shortening it justifies. Each
rule that turns out to be measurable but unenforced becomes its own task
(`branchling new`), linked from the table; this task does not implement any of
them. TL-251 (unmerged closings) is the first such task and already exists.

Rejected: enforcing the git-surface rules (commit title shape, branch names).
The language section already explains why nothing checks the git surface, and
the reasoning holds for the commit-title rule as well.

## Pre-flight reading

1. `CLAUDE.md` — the subject, read once in full for this task only
2. `scripts/instructions.mjs` — the topics that exist, to see which procedural
   paragraphs already have a home there
3. `scripts/context-budget.mjs` — `CONTEXT_RULE` and the one-source test that
   keeps the copy in `CLAUDE.md` from drifting; the model for any other
   paragraph that stays in both places
4. `scripts/doctor.mjs`, `scripts/cli.mjs` (the `check` guards) — what is
   already enforced, so the table does not invent gaps

## Steps

1. Read `CLAUDE.md` paragraph by paragraph. For each rule, one table row:
   the rule in one sentence, its class, the command that enforces or measures
   it (or `—`), and for a measurable-unenforced rule the task id that will.
2. Create the tasks the table needs, one per gap, with `branchling new`.
3. Move each procedural paragraph that `instructions` already covers to a
   pointer, and each that it does not cover into the matching topic in
   `scripts/instructions.mjs` — keeping the one-source pattern where a copy
   must stay.
4. Record the size before and after in Decisions, in bytes and estimated
   tokens (`tokensFromChars`).

## Acceptance criteria

- [ ] `docs/claude-md-audit.md` exists and holds at least twenty rule rows.
      [proof: audit-table-exists]
- [ ] Every task id the table names resolves, and every link in it is live.
      [proof: docs-links]
- [ ] The shortened `CLAUDE.md` and the audit are English. [proof: language]

## Decisions

Nothing decided.
