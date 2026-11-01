---
id: TL-506
title: "A deployment stage outside git is recorded as a ref"
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
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-01
blocked_by: [TL-501]                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [docs/release-tracking.md] # paths relative to the repository root
verification:
  - id: record-tests
    bash: "node --test scripts/tests/release-record.test.mjs"
---

## Goal

A stage that git cannot observe — store review, a staged rollout reaching 100%, a sign-off on the test environment — is a recorded stage: `branchling release record --target <t> --stage <s> <commit-or-tag> --reason "..."` moves that stage's ref and writes an annotated tag object carrying the actor, time and reason, so every stage remains a git ref that is shared by push and whose history can be inspected.

## Context

Depends on TL-501, which implements the stages that git observes. `docs/release-tracking.md` §4 sets out the design. A mobile app released from a tag still has to pass store review and a staged rollout before it reaches users, and nothing in git moves when it does; the same holds for a person signing off a change on the test environment. Querying each store, flag system or CI provider was rejected: it would make the tool depend on every one of them, and Law 4 asks for a callable input instead, so a CI step or a person calls the command and the tool never polls.

A stage is declared `recorded: true` in `deploy_targets`, with a ref in the `refs/deploys/` namespace by convention. A recorded stage with parallel refs (`refs:`, for example one per customer installation or per update channel) needs `--ref <name>` to say which one moves; omitting it on such a stage fails rather than moving all of them. A record on a stage that is not declared `recorded` fails: moving an observed ref by hand would make the tool assert a deployment nobody made. The reason is required, as for `reason_required_statuses`. Recording a commit that is not in the previous stage fails, because stages are ordered. Moving the ref backwards is allowed and is how a halted rollout is recorded; it also carries a reason.

## Steps

1. Accept `recorded: true` on a stage in the config validator from TL-501.
2. Add `release record` to scripts/cli.mjs with --target, --stage, --reason, --json, following the branchling-cli skill.
3. Document the command in docs/manual.md.
4. Write the annotated tag object with actor (from scripts/actor.mjs), time and reason, and update the ref; print the push command rather than pushing.
5. Show recorded stages, with who recorded them and when, in `release status` and the viewer.

## Acceptance criteria

- [ ] A record moves only a declared recorded stage, requires a reason, refuses a commit missing from the previous stage, stores actor, time and reason in an annotated tag, and a backwards move is accepted with a reason. [proof: record-tests]
