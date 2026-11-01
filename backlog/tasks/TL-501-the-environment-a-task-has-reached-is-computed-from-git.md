---
id: TL-501
title: "The environment a task has reached is computed from git"
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
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-502, TL-503, TL-504, TL-505, TL-506, TL-507]                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: env-tests
    bash: "node --test scripts/tests/environments.test.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Which environment a task has reached is COMPUTED from git, never typed. `config.yaml` declares the deployables of the project and, for each, its promotion stages as an ordered list of git refs; a module answers, for every task and every target it touched, which stages hold ALL of its commits, which hold only some, and which hold none.

## Context

Before a launch the owner found no way to tell which finished tasks wait for the test environment and which wait for production. Every professional tracker researched separates the two questions the same way: the workflow status says the WORK is finished; deployment state comes from the delivery pipeline, linked to the task through the task key in commit messages. Jira's Deployments panel is fed by CI and scans the commits of the deployed branch for issue keys, with fixed environment types (development, testing, staging, production). Linear's Releases documentation states that issue status alone does not show whether work reached staging or production, and creates releases from CI with a commit SHA. GitLab marks merge requests deployed to an environment; Sentry associates commits with a release and records deploys per environment.

A hand-maintained `environment:` frontmatter field was rejected: it is Law 2's failure mode exactly, a stale value that reads like a fact, and a rollback would never update it. The commit-to-task link already exists: `scripts/modified-files.mjs` (TL-75) reads task ids from commit messages, the convention this repository requires.

Projects release in very different ways and ship different kinds of product — web applications, desktop and mobile applications, libraries, self-hosted installations; a branch per environment, release tags, trunk-based CI that leaves no trace in git, several deployables in one repository, regions or release lines deployed in parallel, stages outside git such as store review or an update channel. No kind of product may be assumed. `docs/release-tracking.md` derives one model from all of them; this task implements its git half:

  deploy_targets:
    - name: backend
      paths: [backend/]
      stages:
        - { name: test, ref: origin/main }
        - { name: production, ref: origin/production }
    - name: mobile
      paths: [app/]
      stages:
        - { name: tagged, ref: "refs/tags/mobile-v*" }

A project with one deployable omits `paths`. The ORDER of stages is the promotion order. A stage may carry `refs:` (a list) instead of `ref:` for regions, tenants or maintained release lines deployed in parallel; a task has reached it only when it is in every one of them, and the answer names which ones hold it. A ref is a ref name or a tag glob resolved to the newest match by version sort. A task's targets are computed from the paths its commits touched. A ref that does not resolve is reported as unknown, never as empty. A task with some commits in a stage and later ones outside it is PARTIAL, a state of its own. Only commits reachable from the trunk count, so squash merges, merge commits and rebases give the same answer; a cherry-picked hotfix counts by patch identity (`git cherry`), not by SHA. The `recorded: true` stage flag is TL-506 and is NOT part of this task, but the validator must not make it impossible to add.

## Steps

1. Validate an optional `deploy_targets:` key in scripts/config.mjs: a non-empty list of {name, paths?, stages: [{name, ref | refs}]}, exactly one of `ref` and `refs`, unique names, unknown sub-keys fail.
2. Write scripts/environments.mjs: resolve each ref, compute each task's targets from the paths of its trunk commits, then classify the task as full, partial or absent per target and stage using `git rev-list` reachability plus patch identity, reusing the scanner from scripts/task-id.mjs.
3. Expose the per-task answer in `branchling show <ID>` and in `query --json`, and add `query --env <name>` / `--not-env <name>`.
4. Write scripts/tests/environments.test.mjs against fixture repositories covering a branch per environment, release tags, two targets selected by paths, a stage with two parallel refs of which only one holds the task, a squash merge, a cherry-picked hotfix, a partial task, a rollback (ref moved back) and an unresolvable ref.

## Acceptance criteria

- [ ] Tasks are classified full, partial or absent per target and stage for branch, tag, multi-target and parallel-ref layouts, squash merges and cherry-picks give the right answer, a rollback removes a task from a stage, and an unresolvable ref is reported as unknown. [proof: env-tests]
- [ ] The rest of the suite stays green with the new config key. [proof: suite]
