---
id: TL-444
title: "A review finding that was considered and rejected leaves no trace"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-22
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: rejected-finding-readable
    bash: "node --test scripts/tests/review-findings.test.mjs"
---

## Goal

A review of a finished branch produces findings, and a person triages each one: fix it, or reject it. A fix becomes work and can become a task. A REJECTION is a decision with a reason, and branchling records nothing about it — so the same finding is raised again by the next reviewer, who redoes the analysis and reaches the same verdict, with no way to know it has already been reached once.

## Context

Surfaced on 2026-09-22 while analysing two published agent workflows. One of them ran review as a stage of its own: the whole branch diff read as one, each finding handed to a separate agent with a clean context, and — the part branchling has no answer for — rejected findings kept on a list rather than dropped. branchling already records decisions as events (`decide`), open questions (`ask`) and what a run proved (`done`), all of them keyed to a task. A review finding is the same shape of thing: a claim about the tree, an actor, a verdict and a reason. What it lacks is a place to be written. Do NOT read this as a mandate to add a review command that runs a model — the fourth law says the input is callable and the output is `--json`; the question here is only where a triaged finding is stored and how it is read back.

## Steps

1. Establish first whether this needs anything new at all. A rejected finding may already fit `decide` as an event with a reason, against the task the branch belongs to — if it does, the answer is documentation and a shape, not a command, and this task closes by proving that.
2. If it does not fit, define the smallest record: what the finding claimed, which task and which branch it was raised against, who rejected it and why. Law 2 applies — the record is a fact that was stated, and nothing computed may be stored beside it.
3. Define how it is read back at the moment it matters, which is the NEXT review of the same area: a reviewer must be able to ask what has already been raised and rejected here, without reading the whole history.
4. Say explicitly what is out of scope: branchling does not run reviews, does not call a model, and does not judge whether a rejection was right.

## Acceptance criteria

- [ ] A finding recorded as rejected against a task is readable back with its reason and its actor [proof: rejected-finding-readable]
