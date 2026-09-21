---
id: TL-237
title: "new creates a task it cannot fill, against the fourth law"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: a-body-can-be-given
    bash: "node --test scripts/tests/new-body-input.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

`branchling new` accepts the task's body and `verification:` block on stdin, so
the command CLAUDE.md tells every session to use can produce a finished task.

## Context

The fourth law is "extensibility through composition — `--json` on every reading
command, a callable input on every writing one". `new` has no such input:

```
$ branchling new --help
  --title --board --priority --status --type --owner --epic --estimate --dir
```

Every one of those is frontmatter. The Goal, the Context, the Steps, the
Decisions and the whole `verification:` block — the part that decides whether a
task can ever be closed — must be written into the generated file afterwards.

CLAUDE.md says, in the same breath, to create tasks "with `node scripts/cli.mjs
new --title "…"`, not by writing the file by hand". Both are followed today by
calling `new` and then rewriting its output with a heredoc. Four agents did
exactly that on 2026-09-04, and so did this session. The rule and the interface
disagree, and the workaround is the thing the rule forbids.

A task created and left unfilled is worse than not created: `check` reports it
as having no closing contract, and `next` may hand it out.

## Steps

1. Read the body from stdin when it is not a terminal, or from `--body-file`.
   The format follows `seed`'s: it already parses a structured task from stdin
   without a model, so the shape exists and must not be invented twice.
2. `verification:` entries have to be settable, since that is the field the
   whole workflow turns on.
3. `scripts/tests/new-body-input.test.mjs`: a task created with a body on stdin
   closes through `done` with no hand edit in between. That end-to-end assertion
   is the point — a test that only checks the file's text would pass for a body
   written into the wrong place.

## Decisions

**Stdin, not a flag per section.** A flag for Goal, one for Context and one for
Steps would encode this project's template into the tool, and the template is
data.

**`seed` is not the answer.** It creates a whole backlog from a plan; the gap is
one task, in an existing tree, from a session that has just found something.
