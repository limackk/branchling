---
id: TL-509
title: "One task's deployment state is readable on its own"
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
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: [TL-501]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: show-tests
    bash: "node --test scripts/tests/environments.test.mjs"
---

## Goal

One task's computed deployment state can be read without a list query: a single-task view prints, for TL-501's `deploy_targets`, every target the task touched and its state in each stage, with the SHA of each ref read.

## Context

TL-501's step 4 asked to expose the per-task deployment answer in `branchling show <ID>`, but no `show` command exists in scripts/cli.mjs (there is no single-task reading command at all). TL-501 exposed the answer in `query --json` (a `deploy` key per task, and an envelope-level `deploy` naming the trunk and every ref with its SHA) and in `query --env` / `--not-env`, and did not invent a new command inside a task about computing deployment state. Today the per-task answer is reachable as `query --text <ID> --status <all statuses> --json`, which is clumsy for a person. `scripts/environments.mjs` already exports `describeTaskDeployment(task)` (one line per target) and `taskDeploymentJson(task)` for this purpose. Decide whether a `show <ID>` command is wanted at all (it would also be the natural place for the task's frontmatter, its modified files from scripts/modified-files.mjs and its cross-branch state) or whether `query` gains a text rendering of `deploy` instead; then implement the chosen one following the branchling-cli skill (allow-listed flags, --help, --json, exit codes, README command table).

**Decided 2026-11-02 by the owner:** implement a new `show <ID>` command (not a `query` rendering). It prints the facts COMPUTED about one task that its file does not hold: (1) the deployment state per target and stage, with the trunk and every ref read and its SHA, unknown for an unresolvable ref, an explicit line for a task with no commits, and the unobservable state for targets in another repository (TL-507/TL-512); (2) the task's status on other branches and worktrees (the `elsewhere` computation `query` already uses); (3) each `blocked_by` task with its current status, saying whether the task is still blocked. A one-line header gives id, title, status and priority; the markdown body is NOT reprinted. `--json` carries the same three sections. An unknown id fails.

## Steps

1. Add the `show` command per the decision above, following the branchling-cli skill (command table, allow-listed flags, --help, README command table, docs/manual.md).
2. Its --json carries taskDeploymentJson() with the refs read and their SHAs, the elsewhere states and the blockers with their statuses, as a new envelope kind.
3. Add tests against a fixture repository with deploy_targets declared, including a task with no commits, an unresolvable ref, a task with a different status on another branch, and an open and a closed blocker.

## Acceptance criteria

- [ ] One task's deployment state per target and stage is printed in text and JSON, an unresolvable ref reads as unknown, and a task with no commits says so. [proof: show-tests]
