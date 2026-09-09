---
id: TL-387
title: "Manual history preserves related-doc edits after reconciliation"
type: task
labels: []
board: main
epic: "Evidence-gated product focus"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-09
updated: 2026-09-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - scripts/history.mjs
  - scripts/history-record.mjs
  - scripts/tests/history-manual.test.mjs
  - scripts/tests/history-whole-directory.test.mjs
verification:                      # HOW to check the task is really done
  - id: related-doc-history
    bash: "node --test scripts/tests/history-manual.test.mjs scripts/tests/history-whole-directory.test.mjs"
---

## Goal

An edit to a task's `related_docs` is either recorded with its author and reason
or reported as an explicit adoption that the caller can act on. It is never
silently accepted into the local history snapshot.

## Context

While repairing the links broken by TL-382, a manual `related_docs` update was
made to 16 historical tasks. `branchling history --file … --actor agent:codex
--source manual --reason "…"` recorded two edits but reported "no changes to
record" for the remaining tasks, despite their task files differing in Git and
their history logs having no `related_docs` entry.

The history reconciler deliberately protects against inventing a previous value
when a task is absent from its local snapshot. That protection is correct, but
the command must make the resulting adoption observable and must not describe
an unrecorded field edit as no change. Do not rewrite existing `unknown` history
entries: logs are append-only.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/history.mjs` — snapshot, adoption and reconciliation semantics.
2. `scripts/history-record.mjs` — the terminal contract for a manual edit.
3. `scripts/tests/history-manual.test.mjs` — current manual-recording cases.
4. `scripts/tests/history-whole-directory.test.mjs` — partial snapshots and
   explicit adoption coverage.

## Steps

1. Reproduce a hand edit to `related_docs` after a task is absent from the local
   snapshot but has a shared history log.
2. Make the command record a trustworthy field transition when a prior value is
   available, or report the task as adopted when it is not.
3. Add a regression test covering both outcomes and preserve the append-only
   treatment of an already reconciled `unknown` entry.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] A manual `related_docs` edit cannot be accepted silently into a snapshot.
      [proof: related-doc-history]
- [ ] The terminal result distinguishes a recorded edit from an explicit
      adoption, without rewriting prior history. [proof: related-doc-history]
