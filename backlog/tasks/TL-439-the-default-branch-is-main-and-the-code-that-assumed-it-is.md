---
id: TL-439
title: "The default branch is main, and the code that assumed it is right"
type: task
labels: []
board: main
epic: ""
priority: P1
status: in_progress
owner: agent:claude
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-22
updated: 2026-09-22
blocked_by: []
blocks: [TL-158]
related_docs: [AGENTS.md, scripts/resume-task.mjs, scripts/pr-summary.mjs]
verification:
  - id: master-is-gone
    bash: "git rev-parse --verify --quiet refs/heads/master >/dev/null && { echo 'refs/heads/master still exists'; exit 1; }; git rev-parse --verify refs/heads/main >/dev/null && echo 'the local default branch is main and master is gone — OK'"
  # THE PATTERN IS SPLIT ACROSS TWO STRING LITERALS ON PURPOSE. This file is
  # itself under backlog/tasks/, so a contract that spelled the forbidden text
  # in one piece would match its own line and be red forever — the TL-438
  # defect class, where a guard reads the prose it is written in.
  - id: no-contract-names-master
    bash: "p=\"--branch ma\"\"ster\"; grep -rn -- \"$p\" backlog/tasks/ && exit 1; grep -rlq -- '--branch main' backlog/tasks/ && echo 'the contracts name main, and none names the old branch — OK'"
  - id: the-forge-agrees
    bash: "test \"$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)\" = main && echo 'the forge reports main as the default branch — OK'"
---

## Goal

One name for the default branch, in the repository and on the forge: `main`.
Today the branch is called `master` in both places while AGENTS.md, the
templates and — the part that matters — the CODE already say `main`.

## Context

The owner settled this on 2026-09-22. The question was which name open source
uses: GitHub has defaulted to `main` since October 2020, `git init` still
produces `master` unless `init.defaultBranch` is set, and the projects that
kept `master` are the ones that predate the change and did not want to void
other people's links. This repository was created after that cut-off; the name
survived because the history was flattened at extraction, not because anybody
chose it.

**The drift is not cosmetic, and it is already in the code.**
`scripts/resume-task.mjs` exports `DEFAULT_BASE = "main"` and
`scripts/pr-summary.mjs` starts from `let base = "main"`. Both are wrong today
and become right the moment the branch is renamed — so this is a rename that
REMOVES special cases rather than adding them.

**What does NOT need changing.** `.github/workflows/test.yml` triggers on
`push:` and `pull_request:` with no branch filter, so CI follows the rename by
itself. The badge line recorded in TL-158 deliberately carries no `?branch=`
query, so the forge resolves it to whatever the default branch is. The board
slug `main` in `config.yaml` is unrelated vocabulary and is not touched.

**What the rename breaks until the forge follows.** Four task files pin CI
contracts to the OLD branch name in a `gh run list` flag (TL-158, TL-434,
TL-435, TL-436). They are rewritten to `main` here. Those contracts are red
today anyway — CI is failing on all six matrix jobs — so no green evidence is
lost. This file never spells that old flag value out, and the contract above
explains why.

**Why this blocks TL-158.** The badge points at the default branch. Adding it
before the rename settles would publish an image whose meaning changes under
the reader.

## Pre-flight reading

1. `backlog/tasks/TL-158-the-ci-badge-and-the-first-publicly-visible-green-run.md`
   — its Context records the discrepancy this task closes; update it rather
   than leaving a paragraph that describes a state that no longer exists.
2. `scripts/resume-task.mjs` — `DEFAULT_BASE`, the code that was already right.

## Steps

1. `git branch -m master main` in the main checkout.
2. Rewrite the branch flag in those four task files to name `main`.
3. Correct the TL-158 paragraph that records the discrepancy.
4. Publish, which is a SEPARATE decision and needs the owner's word:
   `git push -u origin main`, then set the default on the forge
   (`gh repo edit --default-branch main`), then `git push origin --delete
   master` and `git remote set-head origin -a`.

## Acceptance criteria

- [ ] No local branch is called `master`, and `main` exists. [proof: master-is-gone]
- [ ] No verification contract in the backlog names the branch `master`. [proof: no-contract-names-master]
- [ ] The forge reports `main` as this repository's default branch. [proof: the-forge-agrees]
