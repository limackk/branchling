---
id: TL-443
title: "A contract that cannot fail closes a task as green as one that can"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-22
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

1. Decide what can be established WITHOUT a second full run. A mutation-testing pass is out of scope and out of budget: the narrower question is whether this entry's run touched the files this task changed (`modified-files.mjs` already computes them).
2. Weigh a negative control against a coverage signal. A negative control re-runs the contract against a tree with the change reverted and requires RED — expensive, and impossible where the change is not revertible in isolation. A coverage signal observes the run and requires that it executed at least one of the task's own modified files. Pick one, and record in the task why the other was rejected.
3. THE VERDICT HAS THREE VALUES, not two: shown capable of failing, shown INCAPABLE, and undetermined by construction. A binary forces a wrong answer onto every task proved by a `manual:` entry and every task whose change is a document, and a signal that is wrong for a whole class of tasks is read as wrong for all of them.
4. The verdict belongs in the history beside the closing, not only on the terminal: a closing whose contract was never shown to be capable of failing must be readable back as such.
5. `done` DOES NOT REFUSE ON THIS, and the default may not become a refusal later without another task arguing for it. The reading belongs where a person already looks — `audit`, which judges declarations and is read by a human — and not in the closing path an unattended loop runs. A project that wants it to fail opts in through `config.yaml`, the way `reason_required_statuses` already does; it is never the default.
6. Name the Goodhart risk in the implementation, because it is the way this feature fails WORSE than the state it replaces. A hand that knows the signal exists can satisfy a coverage check by importing the changed module and asserting nothing, and the closing then carries a green verdict saying the contract was checked. Whatever is chosen has to be something a hand cannot satisfy by touching a file.
7. Positive control: a task whose contract asserts nothing about its own change is reported, and the same task with a real assertion is not.

## Acceptance criteria

- [ ] A closing whose contract cannot go red is reported, and one whose contract can is not [proof: empty-contract-reported]
