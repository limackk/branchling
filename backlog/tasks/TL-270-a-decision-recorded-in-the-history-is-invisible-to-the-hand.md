---
id: TL-270
title: "A decision recorded in the history is invisible to the hand that gets the task"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: decision-in-handover
    bash: "node --test scripts/tests/next-shows-decision.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A `__decision__` recorded for a task travels with the task when `next`
hands it over. Today the decision is in `backlog/history/<ID>.jsonl` and
the task file is on stdout, and a hand that does not open the log designs
against the question the decision already answered.

## Context

`branchling decide` writes the answer as an event, deliberately: prose in
the task file could be edited or missed, an event cannot (TL-148, TL-204).

**The premise, narrowed on 2026-09-05 before the work.** The HUMAN render of
`take` and `next` has printed a "Decisions and open questions" block since
TL-148 — `renderTake` calls `withDecisions`. What did not was the JSON
envelope: `takeJson` returned the raw file as `text`, and `run` feeds its
agents from `next --json`. So a person at a terminal saw the decision and
every hand in a fleet did not, which is the opposite of who needed it. The
fix is therefore on the JSON path, and the human path is the reference the
JSON has to match.

Every charter run in this repository since wave 6 carries this sentence:

    A QUESTION THIS TASK ONCE CARRIED MAY ALREADY BE ANSWERED. Decisions are
    events, not prose: read backlog/history/<ID>.jsonl for a __decision__
    entry before you design anything.

That sentence exists because the tool does not do it. It costs each hand a
file read it may skip, and a weaker model — which follows the task file it
was given and does not go looking for a second one — is the one most likely
to skip it. A decision the user made in person, on the record, is then
re-litigated by an agent that never saw it, which is the worst outcome
`decide` was built to prevent.

**`next` already reads the history** for `blocked_by` resolution and to
name which blockers closed. The decision is one more field of the same
file.

**Scope.** Only `__decision__` events, in order, with the question and the
chosen option. Not the whole history — that is `resume`'s job (TL-151) and
a briefing is a different document from a handover.

## Steps

1. After the task file, `next` and `take` print a block with every
   `__decision__` recorded for the task: when, by whom, the question, the
   answer. Nothing when there are none.
2. `--json` carries them as a field beside the task.
3. `run` passes the block through on the agent's stdin after the task, the
   way it already passes a refused `done`.

## Acceptance criteria

- [x] A task with a recorded decision is handed over with that decision
      printed after the file, proven by a test that records one with
      `decide` and reads `next`'s output. [proof: decision-in-handover]
- [x] A task with no decision is handed over exactly as today.
      [proof: suite-green]
