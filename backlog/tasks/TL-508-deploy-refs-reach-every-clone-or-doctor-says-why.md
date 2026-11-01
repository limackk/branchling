---
id: TL-508
title: "Deploy refs reach every clone or doctor says why"
type: task
labels: []
board: main
epic: "Release tracking across environments"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: [TL-501]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: fetch-tests
    bash: "node --test scripts/tests/release-fetch-refspec.test.mjs"
---

## Goal

A deploy ref declared in `deploy_targets` reaches every clone, and when it cannot, the tool says so: `branchling doctor` reports a declared ref namespace (such as `refs/deploys/*`) that the remote's fetch refspec does not include, with the exact `git config --add remote.<name>.fetch` line that fixes it.

## Context

Found while auditing the release-tracking tasks against `docs/release-tracking.md` §3. The default fetch refspec is `+refs/heads/*:refs/remotes/<remote>/*` plus tags, so a ref under `refs/deploys/` that CI pushes (the trunk-based shape in §2) or that a recorded stage writes (TL-506) exists on the remote and in the clone that wrote it, and nowhere else. Every other clone would then resolve the stage as unknown, or worse, read an old copy of it. Fetching inside every reading command was rejected: a read that silently contacts the network is slow, fails offline and changes the repository behind the user's back. Rewriting the user's git config automatically was rejected for the same reason the tool never pushes: it is the owner's repository configuration. The tool detects and names the fix; the person applies it.

## Steps

1. Collect the ref namespaces declared by `deploy_targets` that lie outside refs/heads, refs/remotes and refs/tags.
2. Compare them with `git config --get-all remote.<name>.fetch` for the remote the refs are read from, and add a `doctor` row that is red with the fix line when one is missing.
3. Test with a fixture whose remote fetch refspec lacks refs/deploys and one that has it (positive control).

## Acceptance criteria

- [x] doctor names a missing fetch refspec for a declared deploy ref namespace with the fixing command, and is green once the refspec is present. [proof: fetch-tests]
