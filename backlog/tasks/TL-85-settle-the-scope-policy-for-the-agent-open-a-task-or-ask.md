---
id: TL-85
title: "Settle the scope policy for the agent: open a task or ask"
type: task
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P2
status: done
owner: agent:claude
estimate: 2h
confidence: medium
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
verification:
  - id: rule
    bash: "node scripts/cli.mjs instructions overview | grep -q 'A TOPIC THAT SURFACES MID-TASK IS A NEW TASK, AND YOU DO NOT ASK FIRST' && node scripts/cli.mjs instructions task-execution | grep -q 'do not ask first' && echo 'one rule, stated once and pointed at from where it applies — OK'"
  - id: numbers
    bash: "grep -q '105 done, 55 open, 0 cancelled' backlog/tasks/TL-85-*.md && echo 'the review numbers are recorded — OK'"
  - id: unmarked
    bash: "node scripts/cli.mjs query --label unordered --status pending,done --count | grep -qx 0 && echo 'the third path was rejected, and no label was introduced — OK'"
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

- [x] The numbers from the review of tasks opened by the agent are recorded in `## Log`. [proof: numbers]
- [x] The rule is single and unambiguous, with no "it depends." [proof: rule]
- [x] The instructions for the agent and the skill say the same thing. [proof: rule]
- [x] If marking was chosen: the label is in `config.yaml`, and filtering it out is a single query. [proof: unmarked]

## Log

2026-08-31 pending — agent:claude — from analysis of Backlog.md: their
task-execution and task-finalization forbid the agent from opening tasks
without approval; our skill instructs it to. Discrepancy found, unresolved.
- 2026-09-02 in_progress — agent:claude — step 1, the review, counted on
  2026-09-02 over a backlog spanning 2026-08-26 to 2026-09-02: 163 tasks, 105
  done, 55 open, 0 cancelled. Of the creations the history attributes explicitly
  to `agent:claude` — 14 of them; the other 143 predate attribution and are
  recorded as `unknown` — 9 are done, 2 in progress, 3 pending and all three
  were opened the same day. The oldest OPEN task in the whole backlog was
  created on 2026-08-30, three days before the count, while tasks created on the
  first day are closed. So the feared failure mode has not occurred: nothing has
  silted up, and NOBODY HAS EVER CANCELLED A TASK THE AGENT OPENED — not once in
  163. The honest caveat, recorded rather than glossed: the backlog is seven
  days old, so "nothing has aged" is partly a statement about its age. What is
  not age-dependent is the zero.
- 2026-09-02 in_progress — agent:claude — step 2 settled: the rule STAYS —
  the agent opens the task and does not ask. Their rule spends a human's
  attention on every out-of-scope discovery, which is the one resource this
  arrangement exists to save, and the noise it protects against is not present
  in the measurement. The third path — a marking label separating "ordered" from
  "unordered" — was REJECTED: somebody would have to review and un-mark, which
  reintroduces the interruption the marking was meant to avoid, and there is no
  signal to restore because there is no noise. What the rule was missing is not
  approval but a CRITERION, and that is what went into the instruction source:
  does doing it NOW fit inside the current task's thesis. A rule with no
  criterion is what produces the junk Backlog.md is guarding against.
- 2026-09-02 in_progress — agent:claude — step 3: since TL-74 the skill carries
  no procedure and only points at `worktrail instructions`, so "the same in
  both" is satisfied by there being ONE source rather than two texts kept in
  step. The same resolution as TL-84's step 4, and for the same reason. Step 4
  does not apply — no label was introduced.
