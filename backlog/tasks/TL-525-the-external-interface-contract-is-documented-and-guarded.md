---
id: TL-525
title: "The external interface contract is documented and guarded"
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
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: consumer-doc
    bash: "node --test scripts/tests/external-consumer-doc.test.mjs"
---

## Goal

A person building an interface on top of branchling, such as a separate branchling-ui package, can read in one document which reading kinds and writing commands are the stable contract, how versions are pinned, and what the built-in viewer will and will not cover, and a test fails when that document falls behind the code.

## Context

The fourth law makes `--json` and callable writing commands the only extension surface, and scripts/json-envelope.mjs states the versioning rules in a comment, but nothing addressed to an external consumer lists the declared kinds, the writing commands with their reason requirements, the role of `branchling mcp` as a long-lived channel, or the boundary between the built-in viewer (scripts/build-viewer.mjs, scripts/serve-backlog.mjs) and an external interface. docs/branchling-global-tool.md already assigns cross-repository portfolio views to an external reporting system; an external interface is that system, and it needs a contract to build against rather than the internals of scripts/. The decision on the built-in viewer's scope belongs here, so that work in flight on it (TL-450, TL-451) and an external interface do not duplicate each other.

## Decision: the scope of the built-in viewer

The built-in viewer stays the zero-install view of ONE backlog: browsing, filtering and shareable links, the dashboard and release board, inline editing of the fields the loopback write route supports (live mode only), and a read-only snapshot. Several repositories at once, hosting, accounts, notifications and any dependency or build step belong to an external interface. The viewer's HTTP routes (`/api/task`, `/api/ping`, the SSE channel, the per-process capability) are NOT a contract: an external interface builds on `--json`, `follow --json` and `mcp`, and a missing capability becomes a new kind or writing command available to every consumer, never a route on the viewer's server. Chosen because the alternative, publishing the viewer's routes, would create a second write surface beside the CLI that the four laws exist to prevent, and would freeze routes that today reject foreign origins on purpose.

## Steps

1. Write docs/external-consumers.md: the envelope rules, every declared kind with the command that emits it, every writing command with its required inputs, version pinning (schemaVersion plus the package version range), MCP as an alternative channel, and the decided scope of the built-in viewer.
2. Add a test that every kind declared in scripts/json-envelope.mjs appears in the document and every kind in the document is declared, with a positive control on a known kind.
3. Link the document from README.md and docs/branchling-global-tool.md.

## Acceptance criteria

- [x] The document lists exactly the envelope kinds declared in scripts/json-envelope.mjs, and removing one kind from either side fails the test. [proof: consumer-doc]
