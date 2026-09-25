---
id: TL-444
title: "A rejected review finding cannot be found again by the next reviewer"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex-subagent
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-25
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: rejected-finding-readable
    bash: "node --test scripts/tests/review-findings.test.mjs"
---

## Goal

A review of a finished branch produces findings, and a person triages each one: fix it, or reject it. A fix becomes work and can become a task. A REJECTION is a decision with a reason, and `decide` records it against the task — but nothing can find it again. `log` answers for ONE named id, so the next reviewer of the same file has no question to ask short of reading every task's log, redoes the analysis, and reaches the same verdict with no way to know it has already been reached.

## Context

Surfaced on 2026-09-22 while analysing two published agent workflows. One of them ran review as a stage of its own: the whole branch diff read as one, each finding handed to a separate agent with a clean context, and — the part branchling has no answer for — rejected findings kept on a list rather than dropped. branchling already records decisions as events (`decide`), open questions (`ask`) and what a run proved (`done`), all of them keyed to a task. A review finding is the same shape of thing: a claim about the tree, an actor, a verdict and a reason. What it lacks is a place to be written. Do NOT read this as a mandate to add a review command that runs a model — the fourth law says the input is callable and the output is `--json`; the question here is only where a triaged finding is stored and how it is read back.

## Steps

1. THE WRITING SIDE IS SETTLED and adds nothing: a rejected finding is a `decide` event against the task the branch belongs to. `decide` takes a decision on a CLOSED task by design — its own source says why, and a review rejects findings after the work is finished — and the event travels with the branch exactly like the rest of that task's history. No new record, no new command, no second store. The choice is not reopened here: `branchling log TL-444 --decisions`.
2. The only thing to BUILD is the reading, at the moment it matters, which is the next review of the same area. Today `log` answers for ONE named id, so a reviewer who wants to know what has already been raised and rejected about a file has no question to ask short of reading every task's log.
3. Select by AREA, not by kind, and accept what that costs. The files a task changed are already computed (`modified-files.mjs`), so the reader asks for the decisions carried by the tasks that touched these paths. That over-reports: a decision unrelated to any review comes back too. It is the cheaper wrong: the alternative is a marker or a field that says `this one is a finding`, which changes the log's shape and depends on every writer remembering a convention, and a convention followed nine times out of ten produces a reader that is confidently incomplete.
4. Nothing new is stored (law 2). The answer is computed from the history and the tasks at read time, and a rejected finding that has become irrelevant is not deleted — it is read against a tree that has moved on.
5. Out of scope, and say so in the help: this tool does not run reviews, does not call a model, and does not judge whether a rejection was right. It answers what was decided, by whom and why.
6. Positive control: a decision recorded against a task that touched a path comes back when that path is asked about, and one recorded against a task that did not touch it does not.

## Acceptance criteria

- [x] A finding recorded as rejected against a task is readable back with its reason and its actor [proof: rejected-finding-readable]
