---
id: TL-536
title: "Open questions across the backlog are listed by one command"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: open-questions
    bash: "node --test scripts/tests/log-read.test.mjs scripts/tests/json-envelope.test.mjs scripts/tests/external-consumer-doc.test.mjs"
---

## Goal

One call lists every question still waiting on a person across the backlog, with what a person needs to answer it: the question, who asked and when, the options and the recommendation.

## Context

Consumer: branchling-ui (limackk/branchling-ui), which may reach a backlog only through this CLI's --json answers. Its UI-23 waits on this. There is no such listing: the consumer runs `query --json` and then `log <ID> --decisions --json` for every active task, about 0.45 s per spawn, so its decisions screen, the one a non-technical person opens most, gets slower as the backlog grows. `log --decisions --json` also omits a question's `options` and `recommend`, which `ask --json` and `resume --json` carry, so a UI cannot offer the choices the asker gave. The command name is open (e.g. `log --open-questions --json` or `query --waiting-on-decision --json`).

## Steps

1. Add the listing with kind `open-questions`: per question `{ task, title, event, question, askedBy, askedAt, options, recommend }`
2. Add `options` and `recommend` to the entries of `log <ID> --decisions --json`
3. Declare and document the kind

## Acceptance criteria

- [x] Two tasks with open questions, one asked with options and a recommendation, are listed by one call with their options, and an answered question is not listed. [proof: open-questions]
