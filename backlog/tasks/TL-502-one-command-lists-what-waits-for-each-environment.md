---
id: TL-502
title: "One command lists what waits for each environment"
type: task
labels: []
board: main
epic: "Release tracking across environments"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: [TL-501]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: status-tests
    bash: "node --test scripts/tests/release-status.test.mjs"
---

## Goal

One command answers 'what is waiting for which environment': `branchling release status` prints, for each deploy target, the pipeline as stages — closed but not on the trunk, on the trunk but not on the first environment, then each environment but not the next — with the tasks in each, and `--json` for composition.

## Context

Depends on the environment classification module (scripts/environments.mjs) filed in the same epic. This is the question the owner asked before a launch: which tasks wait for the test environment and which wait for production. Jira answers it with a release hub plus a Deployments panel, Linear with Releases per pipeline; here the answer is a computed view over git and the task files, so it cannot go stale between builds.

Each stage lists task id, title, the date the task closed and how long it has waited in that stage (from the commit date of its newest commit, since git records no deploy time; a ref that is an annotated tag can supply the deploy time). A stage with zero tasks is printed as zero, not omitted. A stage with parallel refs (`refs:`, docs/release-tracking.md §3) lists a task as reached only when every ref holds it, and otherwise names the refs that do. The header names the resolved SHA of every ref, because the answer is only as fresh as the refs it read. `--target <name>` and `--env <name>` narrow to one target and one stage, `--count` prints only counts, which keeps the command inside the context budget AGENTS.md asks for.

## Steps

1. Add the `release` command group with `status` to the command table in scripts/cli.mjs, following the branchling-cli skill (flag validation, --help, --json envelope, --dir).
2. Compute the stages from scripts/environments.mjs and the task files; reuse the shared JSON envelope.
3. Document the command in docs/manual.md.
4. Test with the fixture repository from the environments test, including a stage with two parallel refs.

## Acceptance criteria

- [ ] Each stage lists exactly the tasks between two adjacent stages, a parallel stage names which refs hold a task, empty stages print as zero, and --json carries the same stages. [proof: status-tests]
