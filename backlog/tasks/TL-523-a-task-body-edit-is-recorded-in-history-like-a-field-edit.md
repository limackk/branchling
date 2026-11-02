---
id: TL-523
title: "A task body edit is recorded in history like a field edit"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-02
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: body-history
    bash: "node --test scripts/tests/body-history.test.mjs"
---

## Goal

Editing a task's body through the tool is recorded in backlog/history/ as a `__body__` change with actor and reason, so an interface can offer body editing without leaving an unexplained change behind.

## Context

FIELD_BODY (`__body__`) is reserved in scripts/task-fields.mjs but not implemented; the plan for body history is in docs/branchling-state-and-sync.md sections 5.2 and 5.3. Today a body edit made outside the tool is reconciled as an `unknown` change, and no command writes a body at all, so an external interface (for example a separate branchling-ui package) can edit only frontmatter. Body history must not store the whole body on every edit if the design in the state-and-sync document says otherwise; follow it, or amend it with a reason.

## Steps

1. Re-read docs/branchling-state-and-sync.md sections 5.2 and 5.3 and settle the record shape for a body change.
2. Add a write path (a command reading the new body from stdin or --body-file, with --reason and --json) that writes the file atomically and appends one `__body__` record.
3. Make `branchling log` render body changes legibly without printing whole bodies.
4. Keep the frontmatter untouched by a body write, and refuse a body that would break the required sections.

## Decisions

- **The record holds hashes, not text.** docs/branchling-state-and-sync.md section 5.3 guards a body write with a base-version hash, so a `__body__` entry records exactly that: `from` and `to` are `sha256:<hex>` of the body before and after, plus `lines: {added, removed}` for a reader. The body text is already in the file and in git; copying every revision into an append-only log would make it grow with the prose instead of with the number of edits. The design document needed no amendment.
- **`--base` is optional.** An interface that read the body passes the hash it read and is refused (exit 1, `stale-base`) when the file has moved; a person writing a whole body from a file has no earlier read to protect.
- **"Required sections" means the acceptance-criteria contract.** It is the only section the tool proves (`criteria.mjs`, used by `done` and `check --criteria`). A body is refused on any criteria error, or on a warning the current body does not already carry, so a body write cannot be the quiet way to delete what `done` proves, yet is not refused for a weakness it did not introduce. Also refused: an empty body and a body opening with a `---` fence.
- **`updated:` is not bumped.** The frontmatter stays byte-identical; bumping it would be a second change inside an act about prose.
- **No ownership gate.** A body edit by somebody other than the owner is guarded by the base hash, which is the content-class rule of section 5.1, not by the claim.
- **Not done here:** the viewer still renders a `__body__` entry as a hash transition; that is a separate task.

## Acceptance criteria

- [x] A body written through the tool leaves the frontmatter byte-identical, appends exactly one __body__ record with actor and reason, and `branchling log` shows it. [proof: body-history]
