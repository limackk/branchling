---
id: TL-532
title: "The backlog's vocabularies are read as one JSON envelope"
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
  - id: vocabulary-envelope
    bash: "node --test scripts/tests/vocabulary.test.mjs scripts/tests/json-envelope.test.mjs scripts/tests/external-consumer-doc.test.mjs"
---

## Goal

One read-only command answers the vocabularies this backlog declares in config.yaml as a JSON envelope, so an external consumer can order, group and colour tasks the way the backlog defines them instead of hard-coding status names or reading config.yaml itself.

## Context

Consumer: branchling-ui (limackk/branchling-ui), which may reach a backlog only through this CLI's --json answers. Its UI-18 renders every status in one neutral colour because nothing gives it the vocabulary, and its UI-24 cannot list the declared releases. Today `stats --json` gives only the keys of byStatus and byPriority, with no order, no archived set and no meaning; `doctor --json` reports that a `vocabulary` check passed, not the values; `instructions overview` prints the vocabularies as prose; `deploy status --json` gives no list of declared releases. A backlog with renamed or extra statuses therefore cannot be shown correctly by a consumer that keeps to the CLI. The command name is open: `vocabulary --json` or a `config --json` subset would both do.

## Steps

1. Add the read command with kind `vocabulary`: `statuses` in declared order, each `{ name, archived, reasonRequired }`; `priorities` in order; `types`; `estimates`; `boards`; `roles`; `releases` and `deploy_targets` with the fields `declare` writes
2. Give each status a semantic `role` a consumer can colour without knowing its name (e.g. open, active, waiting, closed, cancelled), derived from what config.yaml already says or from a new optional `status_roles:` key, and say which source was used
3. Declare the kind in scripts/json-envelope.mjs and document it in docs/external-consumers.md

## Acceptance criteria

- [x] A fixture with a renamed and an extra status answers its statuses in order with roles, the archived set and the declared releases, and the kind is declared and documented. [proof: vocabulary-envelope]
