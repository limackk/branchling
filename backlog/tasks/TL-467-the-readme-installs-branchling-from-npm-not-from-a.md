---
id: TL-467
title: "The README installs branchling from npm, not from a placeholder clone"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude-code
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-15
updated: 2026-10-15
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-455]                   # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: readme-npm-install
    bash: "grep -q 'npm install -g branchling' README.md && ! grep -q '<repository-url>' README.md && ! grep -qi 'not published to the npm registry' README.md"
  - id: readme-gates
    bash: "node --test scripts/tests/publish-gate.test.mjs scripts/tests/docs-links.test.mjs && node scripts/cli.mjs check"
---

## Goal

The README's installation section installs branchling from the npm registry, so the package page on npmjs.com tells a stranger the one command that works once 0.1.0 is published.

## Context

On 2026-10-15 the owner decided to publish a basic 0.1.0 before the public announcement instead of after it: the name branchling is still unclaimed on npm (npm view branchling returns 404), and the unscoped name is not protected by the registered `branchling` organization. The README ships in the tarball and is rendered as the package page, yet its section 'Getting it' (README.md, around line 120) still says the package is not published and starts from `git clone <repository-url>`, a literal placeholder. This task changes only that section; shortening the README into a public front door stays with TL-453, which now belongs to the announcement rather than to the release. The canonical repository URL is the one in package.json: https://github.com/limackk/branchling.

## Steps

1. Rewrite 'Getting it' so the first path is `npm install -g branchling` (and `npx branchling` for a run without installing), and remove the sentence saying the package is not published.
2. Keep a clone-based path for contributors, with the canonical repository URL instead of `<repository-url>`.
3. Make sure no other occurrence of `<repository-url>` remains in README.md.

## Acceptance criteria

- [x] The README installs from npm and carries no repository placeholder. [proof: readme-npm-install]
- [x] The changed README remains safe to publish and its links resolve. [proof: readme-gates]
