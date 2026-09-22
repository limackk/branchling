---
id: TL-433
title: "A task cannot cite a file that only an npm install creates"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
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
  - id: no-task-cites-node-modules
    bash: "grep -rn node_modules backlog/tasks && exit 1 || echo 'no task cites a path under node_modules — OK'"
  - id: docs-guard-green
    bash: "node scripts/cli.mjs check --docs"
  - id: docs-links-suite
    bash: "test -f scripts/tests/docs-links.test.mjs && node --test scripts/tests/docs-links.test.mjs"
---

## Goal

No task's `related_docs` points at a path that only exists after `npm install`, so `check --docs` is green on a fresh clone — which is the only tree CI ever has.

## Context

Measured on 2026-09-22 (Europe/Warsaw) in the GitHub Actions run https://github.com/limackk/branchling/actions/runs/35697131745 for commit 12bacb6: `scripts/tests/docs-links.test.mjs` fails on ALL SIX matrix jobs with

    docs: 1 of 608 target(s) lead nowhere or to a missing section
      - backlog/tasks/TL-343-fleet-setup-selects-intended-roles-before-profile-routing.md:18 -> node_modules/@clack/prompts/README.md  (related_docs)

It passes on every developer machine and can never fail there, because `node_modules/` is present locally and absent in CI: the workflow installs nothing on purpose (the package has zero runtime dependencies). So the guard is right and the reference is wrong — a task cannot cite a file that is not in the repository, and a reader without that package installed gets no context and no error.

Decide what TL-343 meant to cite (an upstream URL is citable, a path under `node_modules/` is not) and, since the same mistake is one paste away at any time, make the docs guard say so by name rather than as a generic dead link.

## Steps

1. Read `backlog/tasks/TL-343-fleet-setup-selects-intended-roles-before-profile-routing.md` line 18 and replace the `node_modules/...` entry with something a fresh clone can resolve — the upstream URL, or nothing.
2. In `scripts/check-docs-links.mjs`, report a target under `node_modules/` with its own message: it is not a dead link, it is a link into an install artefact, and the two need different fixes.
3. Add the positive control for that message in `scripts/tests/docs-links.test.mjs`.

## Acceptance criteria

- [ ] No task file cites a path that exists only after an install. [proof: no-task-cites-node-modules]
- [ ] The docs guard passes over the whole tree. [proof: docs-guard-green]
- [ ] The guard's own tests, including the control for the new message, pass. [proof: docs-links-suite]
