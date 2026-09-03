---
id: TL-200
title: "A run whose own agent closed the task reports zero closed"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: closed-by-this-run
    bash: "node --test scripts/tests/run-closed-by-agent.test.mjs"
---

## Goal

A run whose agent did the work and closed the task must not summarise itself
as having closed nothing. The first line of the report is what a cron entry,
a CI step and a person skimming a log all read.

## Context

Five consecutive successful runs on 2026-09-03 reported:

    1 task(s) taken · 0 closed · 0 blocked · 1 closed elsewhere · 617s
    ✓ TL-192  closed-elsewhere  1 attempt  617s
        TL-192 reached `status: done` while this run was working on it

Every one of them had done exactly what it was asked: `next` handed the task
out, the run's own agent did the work, ran the contract through `branchling
done`, and committed. The counter that says whether anything happened read
zero each time.

**`closed-elsewhere` is honest but under-informed.** It was added by TL-191 and
is the reason a finished task is no longer parked as `blocked` — it must stay.
What it cannot currently distinguish is WHO closed the task, and the loop
already holds the answer: it started the agent, and `history` records the actor
of the closing transition. "The agent this run started closed it" and "somebody
in another worktree closed it while we worked" are the same word today and are
not the same event. The first is the success path; the second is a collision.

**This is not a repository-specific quirk.** This project's conventions tell an
agent to close its own task, so the success path here goes through
`closed-elsewhere` every time. Any project whose agent template ends in
`branchling done` — which the autonomous-loop guide's own example does not, but
which every agent reading a CLAUDE.md like this one will — lands in the same
place. A first line that says `0 closed` after a successful run is a false
negative in the one field an unattended caller reads.

**What the report should say.** Count a task closed by the agent this run
started as CLOSED, and keep `closed-elsewhere` for the collision it was named
for. The per-task line can keep naming which path it took; the summary must
not. `--json` carries both counts separately, so a caller can still tell them
apart.

## Pre-flight reading

1. `scripts/run-loop.mjs` — the outcome vocabulary, the summary line, and the
   `closed-elsewhere` branch TL-191 and TL-192 added.
2. `scripts/tests/run-stuck-status.test.mjs` — the fixture that already drives
   an agent which closes its own task; this test belongs beside it and must
   not duplicate its setup.
3. `backlog/tasks/TL-191-*.md` and `TL-192-*.md` — why the branch exists at
   all, so the distinction is added without weakening the guard.

## Steps

1. Determine, at the `closed-elsewhere` branch, whether the closing was made
   by the actor this run handed the task to.
2. Count that as closed in the summary; leave the other case as it is.
3. Keep both counts distinct in `--json`.
4. `scripts/tests/run-closed-by-agent.test.mjs`: an agent command that closes
   the task, asserting the summary says one closed; and a second case where a
   DIFFERENT actor closes it, asserting `closed-elsewhere` survives.

## Decisions

Nothing decided. Note that the exit code is already 0 in both cases and this
task does not change it.
