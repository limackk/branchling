---
id: TL-510
title: "A short deploy ref outside git's namespaces does not pass doctor unnoticed"
type: task
labels: []
board: main
epic: "Release tracking across environments"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: short-name
    bash: "node --test scripts/tests/release-fetch-refspec.test.mjs scripts/tests/environments.test.mjs"
---

## Goal

A deploy stage declared by a short ref name that git resolves under refs/<name> is either rejected by config validation or checked by doctor, instead of silently getting no deploy-fetch row.

## Context

TL-508 added the doctor row `deploy refs reach every clone` (scripts/deploy-fetch.mjs, declaredForeignRefs). It judges only full `refs/...` names outside refs/heads, refs/remotes and refs/tags. A short name such as `deploys/web/production` is skipped: git rev-parse, which scripts/environments.mjs resolveRef uses, tries refs/<name> before tags, heads and remotes, so that stage reads refs/deploys/web/production wherever it exists, yet in a fresh clone nothing distinguishes it from `origin/main`. The limitation is documented on declaredForeignRefs. The decision left open: reject such short names in scripts/deploy-targets.mjs validateDeployTargets (require a full refs/ name for anything that is not a branch, remote-tracking branch or tag), or resolve them against the remote's advertised refs (git ls-remote) in doctor.

## Steps

1. Decide between validation and resolution, recording the reason.
2. Implement it with a fixture that declares `deploys/web/production` and shows the new behaviour, plus a positive control with `origin/main`.

## Acceptance criteria

- [ ] a short deploy ref outside git's own namespaces no longer passes unnoticed [proof: short-name]
