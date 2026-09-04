---
id: TL-263
title: "The autonomous-loop guide does not know roles exist"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: guide-covers-roles
    bash: "node --test scripts/tests/instructions-cover-roles.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`branchling instructions autonomous-loop` describes the machinery an
unattended run actually uses. Today the topic whose whole subject is
"running the backlog as a queue, with nobody watching" does not contain the
word `role`.

## Context

Measured on 2026-09-04, after nine waves driven by exactly that machinery:

    $ branchling instructions autonomous-loop | grep -ci 'role\|agent-for'
    0

    $ for t in overview task-creation task-execution task-finalization \
               autonomous-loop; do branchling instructions $t | grep -ci role; done
    0  0  1  0  0

The guide shows `branchling run --agent "…"` and stops there. `--agent-for
<role>=<command>`, `--role-strict`, `handoff --to-role`, `next --role`, and
the fact that `--agent` becomes optional once a role is served — all of it
landed in wave 6 and none of it reached the text a caller is told to read
before building a loop.

**Why this topic and not the docs.** `instructions` is the tool's own answer
to "how do I run this", printed by the tool, rendered with the reading
project's vocabulary. `--update-nudge` writes a pointer to it into the
agent file of somebody else's repository. It is therefore the first and
often only thing a caller reads, and it currently describes a
single-generalist loop as if that were the whole product.

**A measured consequence.** The single hand a caller builds from this guide
serves every task; a task carrying `role:` is then either handed to a hand
with the wrong brief, or - with `--role-strict` they were never told about
- waits for a hand that does not exist. This repository's own run reported
52 tasks waiting for a role it did not serve, which is legible only because
whoever launched it already knew what a role was.

**`docs-drift` cannot catch this.** It flags dead references and staleness
signals; a guide that is internally consistent and merely omits a feature
produces no signal. It reported this file as clean on the same day.

## Steps

1. Add roles to the `autonomous-loop` topic: what a role is, the difference
   from `executor`, `--agent-for`, `--role-strict`, and what the report says
   about a role nobody served.
2. Check `overview` for the same omission - it is the switchboard, and a
   reader who needs a role-aware loop has to be sent to the right topic.
3. Add a guard. The gap survived a wave that ADDED the feature, so a test
   that fails when a flag `run --help` documents is absent from the guide is
   the only thing that will stop it recurring.

## Acceptance criteria

- [ ] The `autonomous-loop` topic covers `--agent-for` and `--role-strict`,
      proven by a test that fails against today's text.
      [proof: guide-covers-roles]
- [ ] Nothing in the rendered text names this project's own role values -
      the topic is printed with the reading project's vocabulary.
      [proof: suite-green]
