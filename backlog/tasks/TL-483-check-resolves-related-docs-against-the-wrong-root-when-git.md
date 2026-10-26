---
id: TL-483
title: "check resolves related_docs against the wrong root when GIT_DIR is set in a worktree"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-10-26
updated: 2026-10-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: paths
    bash: "node --test scripts/tests/paths.test.mjs"
  - id: suite
    bash: "npm test"
---

## Goal

`branchling check` (and every caller of `repositoryRoot()`) resolves the repository root the same way whether or not `GIT_DIR` is in the environment, so the pre-commit hook installed by `branchling hooks install` passes in a linked worktree exactly when a manual run does.

## Context

Reported from a downstream repository on 2026-10-26 (branchling 0.1.0, node v24.18.0, macOS). In a linked worktree git exports `GIT_DIR=<repo>/.git/worktrees/<name>` to hooks. `repositoryRoot()` in `scripts/paths.mjs` runs `git -C <backlog> rev-parse --show-toplevel`; with `GIT_DIR` set and no `GIT_WORK_TREE`, git takes the current directory (the backlog directory) as the top of the work tree. The root becomes `<repo>/backlog`, so every `related_docs` entry such as `docs/spec.md` is looked up as `backlog/docs/spec.md` and the docs gate fails: `✗ docs: 415 of 415 target(s) lead nowhere`. No commit can be made from the worktree. `GIT_DIR=.git branchling check --docs` in a main checkout fails the same way.

Reproduction in a fresh repository:

```bash
git init -q main && cd main && git commit -q --allow-empty -m init
mkdir docs && echo "# Spec" > docs/spec.md
branchling init --dir backlog
echo '{"goal":"g","verification":[{"id":"v","bash":"true","proves":"p"}]}' | branchling new --title "A task" --dir backlog
sed -i '' 's#^related_docs: \[\]#related_docs: [docs/spec.md]#' backlog/tasks/TASK-2-*.md
git add -A && git commit -q -m t
git worktree add -q ../wt -b wt && cd ../wt
branchling check --docs                                      # passes
GIT_DIR=$(git rev-parse --git-dir) branchling check --docs   # fails
```

The downstream workaround is `unset GIT_DIR` at the top of `.git/hooks/pre-commit`, above the branchling block. Other git calls of the tool that discover a repository from a directory may share the cause; check them in the same pass.

## Steps

1. Read `repositoryRoot()` in scripts/paths.mjs and every other spawn of `git -C <dir> rev-parse` or discovery from a directory.
2. Run discovery calls with `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` removed from the child environment (keep them for calls that must act on the hook's index), or resolve the root another way that ignores them.
3. Add a regression test in scripts/tests/paths.test.mjs: a temporary repository with a linked worktree, `repositoryRoot()` and `branchling check --docs` with `GIT_DIR` set to the worktree's git dir, both resolving the worktree root.
4. Run the whole suite.

## Acceptance criteria

- [ ] repositoryRoot() returns the work tree root with GIT_DIR set in a linked worktree [proof: paths]
- [ ] the whole suite stays green [proof: suite]
