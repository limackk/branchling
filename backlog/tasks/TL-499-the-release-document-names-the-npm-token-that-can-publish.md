---
id: TL-499
title: "The release document names the npm token that can publish the package"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m                      # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: high                   # how much you trust the estimate
created: 2026-10-30
updated: 2026-10-30
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:                      # paths relative to the repository root
  - docs/releasing.md
  - .github/workflows/release.yml
verification:                      # HOW to check the task is really done
  - id: release-docs
    bash: "node --test scripts/tests/release-notes.test.mjs"
  - id: refs
    bash: "node scripts/cli.mjs check --refs"
---

## Goal

`docs/releasing.md` and the header of `.github/workflows/release.yml` state
which npm token the `NPM_TOKEN` secret must hold for `npm publish` to succeed
from the workflow, and what a failed publish step means for the tag, so the
next release does not rediscover it through repeated E403 failures.

## Context

Both files said the secret holds "an automation token of the npm organization
that owns the name". Neither half was right on 2026-10-30: the package
`branchling` is owned by the maintainer's personal npm account, not by the
`branchling` organization, and npm no longer issues classic automation tokens;
a granular access token is the only kind left.

The first tag-driven release (v0.2.0, run 41060971919) failed twice at
`npm publish` with `E403 Forbidden - PUT https://registry.npmjs.org/branchling
- You may not perform that action with these credentials`, each time after the
tests, the guards and the provenance signature had passed. The third token the
owner created published the package. Because nothing reached the registry
before that, the failed job was rerun against the same tag rather than
retagged — the document did not say that this is the correct recovery.

## Pre-flight reading

1. `docs/releasing.md` — "The tag" and "When a release goes wrong".
2. `.github/workflows/release.yml` — the header comment.
3. `scripts/tests/release-notes.test.mjs` — the existing assertions on the
   workflow.

## Steps

1. Describe the token: granular, read and write on the package `branchling`,
   two-factor authentication bypassed, created by an account that can publish
   the package; and the package setting that disallows tokens altogether.
2. Describe the E403 symptom and the recovery: replace the secret, rerun the
   failed job, keep the tag.
3. Correct the workflow header to point at the document instead of repeating
   a description that drifted.
4. Assert in `release-notes.test.mjs` that neither file describes the
   credential as an automation token.

## Acceptance criteria

- [x] the release document names the token that publishes and the recovery
      from a failed publish, and neither file calls it an automation token
      [proof: release-docs]
- [x] every path the task and the document reference resolves [proof: refs]
