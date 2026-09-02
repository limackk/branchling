---
id: TL-85
title: "Settle the scope policy for the agent: open a task or ask"
type: task
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
verification:
  - manual: "The agent instructions contain one, unambiguous rule for work discovered outside a task's scope, and this task's `## Log` carries the numbers from the backlog review the decision was based on"
---

## Goal

Know what the agent should do when, during a task, it discovers work outside
its scope: open a new task on its own, or stop and ask. There is one rule,
and it follows from data in our own backlog, not from a hunch.

## Context

Our `backlog-workflow` says: *"If the scope grows, open a new task instead of
inflating this one"* — i.e. the agent opens tasks on its own, without asking.
Backlog.md says exactly the opposite, and in two places: *"If you discover
work that is outside the task's acceptance criteria, stop and ask the user"*
and *"Do not create or start follow-up tasks without user approval."*

Both rules are defensible and each has a different failure mode:

- **Ours** produces noise. An agent that opens tasks without asking fills
  the backlog with items nobody ordered, and dilutes the queue's signal.
  With parallel sessions in worktrees, it does this in several places at
  once.
- **Theirs** produces interruptions. Every out-of-scope discovery stops work
  and demands a human's attention — the exact resource this whole
  construction was meant to save.

The way to settle it is empirical, not doctrinal — which is why this task is
cheap and has concrete material to review. **Review the tasks opened by
`agent:claude`** and count how many of them were closed, how many have sat
in `pending` for a long time, and how many ended up `cancelled`. If most were
done, our rule holds up and stays. If most are sitting there — the rule
produces junk and needs to change. `history/*.jsonl` carries the actor, so
these numbers are countable, not something to guess at.

A third path to consider: the agent opens the task, but in a marked state
(e.g. `status: pending` plus a label indicating "unordered"), so that it can
be filtered out with a single query. It keeps the no-interruption property
and restores the signal.

## Pre-flight reading

1. `.claude/skills/backlog-workflow/SKILL.md`, the "Work a task" and "What
   does not belong in the backlog" sections — today's rule and its
   neighborhood.
2. `backlog/history/*.jsonl` — `agent:claude` attribution; this is the
   source for the numbers.
3. `backlog/config.yaml` — `labels_closed` and the label list, if the third
   path is chosen.

## Steps

1. Count tasks opened by `agent:claude`: closed / sitting in `pending` /
   `cancelled`. Record the numbers in `## Log` — this is evidence, not
   decoration.
2. Settle the rule: on its own / ask / a third path with marking.
3. Write it into the single source of instructions (TL-74) and into the
   skill — one sentence, the same in both.
4. If the third path is chosen: add a label to `config.yaml` and the query
   that filters it out.

## Acceptance criteria

- [ ] The numbers from the review of tasks opened by the agent are recorded in `## Log`.
- [ ] The rule is single and unambiguous, with no "it depends."
- [ ] The instructions for the agent and the skill say the same thing.
- [ ] If marking was chosen: the label is in `config.yaml`, and filtering it out is a single query.

## Log

2026-08-31 pending — agent:claude — from analysis of Backlog.md: their
task-execution and task-finalization forbid the agent from opening tasks
without approval; our skill instructs it to. Discrepancy found, unresolved.
