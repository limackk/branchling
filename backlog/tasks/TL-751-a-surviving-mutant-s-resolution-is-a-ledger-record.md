---
id: TL-751
title: "A surviving mutant's resolution is a ledger record"
type: task
labels: []
board: main
epic: "Proof core"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-16
updated: 2026-11-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: resolution-recorded
    bash: "node --test scripts/tests/survivor-resolution.test.mjs"
  - id: consumers-doc
    bash: "grep -q 'survivor-resolution' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`resolve <ID> --survivor <key> --as killed|equivalent|accepted-risk --reason "…" [--test-commit <sha>] [--actor <ns:name>] [--json]` appends a `__resolution__` record with the survivor's identity, its state, the reason and the actor, and `log --records --json` and `show --json` (`resolutions`) return it. Each surviving mutant then ends in a record an auditor can sample, not in a comment.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U7). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

The consumer's gate mutates the lines a change added, runs the task's contract against each mutant, and names every survivor. Each survivor ends in one of three states: killed (a test that fails on the mutant and passes on the change lands), equivalent (the mutant does not change behaviour) or accepted risk (a named person answers the concrete question). Its concept records them through `decide` and vouches where they fit, and names a missing record type as an upstream task. They do not fit: `decide` records free text and has no structured subject, so a reader cannot tell which mutant a decision settled or tell a resolution from any other decision; a vouch belongs to a `manual:` entry of the contract, and a survivor is not an entry.

Proposed: the survivor's identity arrives as JSON on stdin (file, line, column, operator, original and replacement text, engine and version) and is stored as given; core reads only `--survivor <key>`, a stable key the consumer computes from it. `accepted-risk` is refused to an `agent:` actor. `killed` requires `--test-commit`; the consumer checks before recording that the test fails on the mutant and passes on the head. A later resolution of the same key supersedes the earlier one and both stay in the log.

Who may mark a survivor `equivalent` was put to the consumer's founder (question 01M7K3XWGCX8WFQDVSWS0AZN6F on that backlog's PF-23) and answered on 2026-11-17: an agent may propose it, and it takes effect only when a person, an actor outside `agent:` and other than the task's executor, confirms it with `decide`. An `equivalent` waives a test, the decision the gate keeps from the agent that wrote the change; built from ask and decide, it has the independence of an amendment (TL-747) and of the executor rule (TL-756).

## Steps

1. Write scripts/tests/survivor-resolution.test.mjs red-first: each state recorded and read back through log --records --json and show --json; accepted-risk refused to an agent beside the same resolution by a person; killed refused without --test-commit beside one with it; a second resolution of the same key supersedes and both remain in the log
2. Add the command, its --json envelope (`survivor-resolution`) and the history record
3. Apply the rule for `equivalent`: an agent's resolution is recorded as proposed and counts as unresolved until a person other than the executor confirms it with `decide`; a person's own resolution, and the confirmation, are refused to the executor
4. Document the command, the record and the show key in docs/external-consumers.md and docs/manual.md

## Acceptance criteria

- [ ] a survivor's resolution is a ledger record with its state, reason and actor, readable as JSON, and its refusals hold [proof: resolution-recorded]
- [ ] the external consumer contract documents the resolution record [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
