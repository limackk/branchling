---
id: TL-443
title: "A contract that cannot fail closes a task as green as one that can"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex-subagent
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-25
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: empty-contract-reported
    bash: "node --test scripts/tests/contract-can-fail.test.mjs"
---

## Goal

`done` runs a task's `verification:` entries and closes on green, but nothing asks whether a green entry could ever have been red. An entry that asserts nothing — a test that touches none of the changed files, a command that exits 0 whatever the tree looks like — closes a task with the same `proven` reason as a contract that genuinely guards the thesis. The two are indistinguishable in the history afterwards, which is the one outcome a proof may not have.

## Context

Surfaced on 2026-09-22 while analysing two published agent workflows. One of them ran a stack of gates after every implementation phase, including deliberate assertion breaking: the assertion is inverted on purpose to see whether the test goes red, because a test that stays green when the claim is false protects nothing. branchling has no equivalent. `check --contracts` judges which PROGRAM a command names, TL-424 (pending) judges whether a `node --test` path EXISTS, and `check --proofs` re-runs an archived proof against the current tree — all three take for granted that a green run measured something. TL-424 catches a contract that executes nothing; this one catches a contract that executes and measures nothing.

## Steps

1. THE MECHANISM IS SETTLED: a coverage signal, and the choice is not reopened here. The entry's run is observed, and the question asked of it is whether it executed at least one of the files this task itself changed — `modified-files.mjs` already computes that set. The negative control was rejected, and the reason is an event in this task's own history rather than a paragraph here: `branchling log TL-443 --decisions`.
2. A mutation-testing pass remains out of scope and out of budget. It was never the alternative on the table, and nothing below should grow into one.
3. The open question is HOW a run is observed, and it is the first thing to settle in implementation. For a `node --test` entry the coverage is available from Node itself; for an entry that runs a foreign program it is not, and it may not be assumed. Those entries are `undetermined`, never `incapable` — a tool that reports what it did not measure is the defect this task is closing, one level up.
4. THE VERDICT HAS THREE VALUES, not two: shown capable of failing, shown INCAPABLE, and undetermined by construction. A binary forces a wrong answer onto every task proved by a `manual:` entry and every task whose change is a document, and a signal that is wrong for a whole class of tasks is read as wrong for all of them.
5. The verdict belongs in the history beside the closing, not only on the terminal: a closing whose contract was never shown to be capable of failing must be readable back as such.
6. `done` DOES NOT REFUSE ON THIS, and the default may not become a refusal later without another task arguing for it. The reading belongs where a person already looks — `audit`, which judges declarations and is read by a human — and not in the closing path an unattended loop runs. A project that wants it to fail opts in through `config.yaml`, the way `reason_required_statuses` already does; it is never the default.
7. WORD THE VERDICT AS WHAT WAS MEASURED, because coverage is exactly the signal a hand can satisfy without doing the work: importing the changed module and asserting nothing scores the same as a real assertion. The record therefore says `the run executed a file this task changed` and never `the contract guards the thesis`. A signal that overclaims is worse than no signal, because the closing then carries a green statement that it was checked.
8. Positive control: a task whose contract executes none of its own changed files is reported, and the same task with a contract that executes one of them is not.

## Acceptance criteria

- [x] A closing whose contract cannot go red is reported, and one whose contract can is not [proof: empty-contract-reported]
