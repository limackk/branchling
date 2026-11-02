---
id: TL-516
title: "The scope report covers releases that have shipped"
type: task
labels: []
board: main
epic: "Release tracking across environments"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: [TL-513, TL-515]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: shipped-scope
    bash: "node --test scripts/tests/release-shipped-scope.test.mjs scripts/tests/release-scope.test.mjs"
---

## Goal

The planned-scope report also covers releases that have shipped: a release can name the ref that marks it (for example its tag), and the report lists what that release carried without having planned it, not only what the next promotion carries.

## Context

Decided 2026-11-02 by the owner. TL-505 bounded the 'unplanned' list to work in the pipeline that has not reached the last stage, so once a release goes out, the unplanned work that went with it disappears from the report. Answering 'what did 1.0 carry that nobody planned' needs to know where 1.0 ends: an entry in `releases:` may become `{name, ref}` beside the plain slug, where `ref` is a ref name or tag (no glob — a release is one point). The previous release's ref, in list order (chronological, per the current-release task), is where it begins; the first release begins at the root.

A release with a `ref` that resolves is reported as shipped up to that commit: planned tasks not contained in it are 'planned, not shipped', and tasks whose commits it contains but whose `release:` names another or none are 'shipped unplanned'. A release without `ref` keeps today's behaviour. An unresolvable ref is unknown, never empty. Both shapes of entry must be accepted in the same list, and the slug rules for the name stay.

## Steps

1. Accept `{name, ref}` entries in `releases:` in scripts/config.mjs and keep every reader of the release names working on both shapes.
2. Compute the commit range of a shipped release from its ref and the previous release's ref, and extend releaseScope with a shipped-unplanned list.
3. Document it in docs/manual.md and docs/release-tracking.md; test with a fixture of two tagged releases and one in progress.

## Acceptance criteria

- [ ] A release with a resolving ref lists the unplanned tasks it shipped and the planned tasks it did not, the range starts at the previous release's ref, a release without ref behaves as before, and an unresolvable ref reads as unknown. [proof: shipped-scope]
