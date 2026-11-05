---
id: TL-533
title: "An undeclared name in deploy status is a refusal envelope"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: unknown-name
    bash: "node --test scripts/tests/deploy-command.test.mjs scripts/tests/external-consumer-doc.test.mjs"
---

## Goal

`deploy status --json` with an undeclared `--release`, `--target` or `--env` answers a refusal envelope naming the rejected value and what is declared, so a consumer can tell a person's typo from its own wrongly built call.

## Context

Consumer: branchling-ui (limackk/branchling-ui), which may reach a backlog only through this CLI's --json answers. Its UI-21 ships an interim guess and UI-24 waits on this. At 86b6209 `deploy status --json --release nope` exits 2 with stderr only ("this project declares no `releases` in config.yaml, so it plans no release `nope`", or "`nope` is not a declared release (declared: …)"). Exit 2 means the call itself was wrong, which is right for a misspelt flag and wrong for a value a person typed; telling them apart today means parsing stderr, which an external contract should not require.

## Steps

1. On an undeclared value print a `release-status` envelope with `refusalKind: "unknown-name"`, `refusal`, `rejected: { flag, value }` and `declared: [...]` (empty when nothing is declared), exit 1
2. Keep exit 2 for a flag that does not exist or a missing value
3. Document the refusal kind in docs/external-consumers.md

## Acceptance criteria

- [x] An undeclared release, target and env each answer the unknown-name refusal envelope with exit 1, while a misspelt flag still exits 2. [proof: unknown-name]
