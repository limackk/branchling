---
id: TL-749
title: "Each contract entry declares its kind and done holds it to it"
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
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-16
updated: 2026-11-16
blocked_by: [TL-747, TL-748]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: kinds-carried
    bash: "node --test scripts/tests/contract-kinds.test.mjs"
  - id: kinds-held
    bash: "node --test scripts/tests/done-contract-kinds.test.mjs"
  - id: consumers-doc
    bash: "grep -q 'invariant' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A verification entry carries `kind: red | invariant | metric | vouch`; `new`, `seed`, `show --json` and `done --json` carry it; and `done` holds each kind to its meaning. An evidence report can then say how each task was proven, so a release proven mostly by vouches cannot pass for one proven by tests that failed before the change.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U5). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

Not all work can fail first, and the consumer names four kinds: `red` fails on the base commit and passes on the change (features, fixes); `invariant` passes before and after, and the change stays inside declared paths (refactoring, upgrades); `metric` crosses a declared threshold (performance, size, coverage); `vouch` is a named person confirming (UI, copy, design).

Proposed rules for a real close: a `red` entry needs the red-before verdict `red` (TL-748) against the base the seal names (TL-747), and a red entry on an unsealed task is refused with a kind that says the base is unknown; an `invariant` task needs the files its commits changed (which scripts/modified-files.mjs already computes from the commit messages that name the task) to match a new task field `paths:` (globs); a `metric` entry runs as any bash entry, its threshold being the command's own exit code, and only its kind is recorded; a `vouch` entry is a `manual:` entry and is refused when the vouching actor is in the `agent:` namespace. An entry with no kind keeps today's behaviour, so no existing backlog changes meaning.

Open for the maintainer before the work: whether `paths:` is a frontmatter field or an entry key, and whether a project may declare a default kind.

## Steps

1. Write scripts/tests/contract-kinds.test.mjs red-first: the key is parsed, validated (an unknown kind is refused) and carried by new, seed, show --json and done --json; an entry without a kind behaves as today
2. Write scripts/tests/done-contract-kinds.test.mjs: each refusal beside its positive control (a red entry that is red closes and one that is weak does not; an invariant task inside its paths closes and one outside does not; a vouch by a person closes and one by an agent does not)
3. Implement the parsing, the validation in check --contracts, and the per-kind rules in done
4. Document the kinds and the refusal kinds in docs/external-consumers.md and docs/manual.md

## Acceptance criteria

- [ ] an entry's kind is validated and carried by new, seed, show --json and done --json [proof: kinds-carried]
- [ ] done holds red, invariant and vouch entries to their meaning, each refusal beside a close that passes [proof: kinds-held]
- [ ] the external consumer contract documents the contract kinds [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
