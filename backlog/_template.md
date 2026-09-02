---
# ╭─────────────────────────────────────────────────────────────────────────╮
# │  THIS BACKLOG'S TASK TEMPLATE. `worktrail new --title "…"` copies it,    │
# │  assigns the number and fills in the dates — you do not copy it by      │
# │  hand. The vocabularies below (statuses, priorities, types) come from   │
# │  `config.yaml`; a value outside them FAILS the build rather than        │
# │  becoming a new one.                                                    │
# ╰─────────────────────────────────────────────────────────────────────────╯
id: TL-NNN                         # the prefix is `task_id_prefix` in config.yaml; the number comes from `worktrail new`
title: ""                          # imperative, short
type: task
labels: []
board: main                        # a CLOSED vocabulary (boards.yaml); do not guess: `worktrail board <file>`
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: YYYY-MM-DD
updated: YYYY-MM-DD                # set to today on every status change
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-name                   # optional; a criterion below points at this id
    bash: "command to run"
---

## Goal

Why this task exists, and what has to be true once it is done.

## Context

What the next person has to know before they start. They were not part of the
conversation this task came out of: where it came from, what has already been
tried, which alternatives were rejected and why.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `path/to/file` — what to look at there

## Steps

1. ...

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [ ] Verifiable, not subjective. [proof: the-name]
