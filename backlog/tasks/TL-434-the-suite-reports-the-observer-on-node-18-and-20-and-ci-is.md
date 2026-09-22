---
id: TL-434
title: "The suite reports the observer on Node 18 and 20, and CI is where it shows"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-22
updated: 2026-09-22
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-158]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: terminal-independence-suite
    bash: "test -f scripts/tests/suite-is-terminal-independent.test.mjs && node --test scripts/tests/suite-is-terminal-independent.test.mjs"
  - id: green-on-node-18
    bash: "id=$(gh run list --workflow test.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId') && gh run view $id --json jobs --jq '.jobs[] | select(.name | test("18")) | .conclusion' | grep -vqx success && exit 1 || echo 'every Node 18 job of the latest run on main is green — OK'"
  - id: green-on-node-20
    bash: "id=$(gh run list --workflow test.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId') && gh run view $id --json jobs --jq '.jobs[] | select(.name | test("20")) | .conclusion' | grep -vqx success && exit 1 || echo 'every Node 20 job of the latest run on main is green — OK'"
---

## Goal

`scripts/tests/suite-is-terminal-independent.test.mjs` is green on every Node version the manifest claims to support, not only on the newest one — today it is red on Node 18 and 20.

## Context

Measured on 2026-09-22 (Europe/Warsaw) in https://github.com/limackk/branchling/actions/runs/35697131745 (commit 12bacb6). On `test (18, ubuntu-latest)`, `test (20, ubuntu-latest)`, `test (18, macos-latest)` and `test (20, macos-latest)` the meta test fails with

    the suite is green through a pipe and red at a keyboard - it is reporting the observer
    not ok 56 - an empty backlog INSIDE a repository: a number with no warning

It passes on Node 22 on both operating systems and on Node 24 locally, so the case that breaks under `FORCE_COLOR` is version-dependent: something in that case's expected output differs between Node versions when colour is on. The suite run WITHOUT colour is green everywhere, which is why nothing caught this before CI existed.

`engines` says `>=18` and the matrix exists to measure that claim rather than decorate it, so the fix is either to make the case version-independent or to narrow `engines` — and narrowing is a decision, not a repair.

## Steps

1. Find the case 'an empty backlog INSIDE a repository: a number with no warning' and run it under Node 18 with FORCE_COLOR=1 (nvm, or a node:18 container) to see the difference rather than guessing it.
2. Fix the case or the renderer so its output does not depend on the Node version; if the difference is in Node's own formatting, assert on the plain text rather than on the rendered line.
3. Re-run the whole suite under Node 18 and Node 22 before closing.

## Acceptance criteria

- [x] The meta test passes on the Node version the session is running. [proof: terminal-independence-suite]
- [x] Both Node 18 jobs of the newest run on the default branch concluded success. [proof: green-on-node-18]
- [x] Both Node 20 jobs of the newest run on the default branch concluded success. [proof: green-on-node-20]
