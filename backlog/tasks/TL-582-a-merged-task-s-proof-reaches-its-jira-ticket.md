---
id: TL-582
title: "A merged task's proof reaches its Jira ticket"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: [TL-581]  # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: jira-proof-tests
    bash: "node --test scripts/tests/jira-proof.test.mjs"
  - id: example-job-exists
    bash: "test -f examples/jira-proof.yml && grep -q 'secrets\\.' examples/jira-proof.yml"
---

## Goal

When a task that came from Jira reaches the closed status on `main`, its Jira ticket gets one comment saying which task closed it, which checks its verification ran and what each one proves. People who never open the repository see the evidence where they already work. Branchling still makes no network request: a command produces the comments as data, and a copyable CI job only posts them.

## Context

On 2026-11-05 an assessment of a Jira integration concluded for two one-directional pipes and against any synchronisation. Jira keeps the request and the conversation; the repository keeps execution, status and proof. The inbound pipe is TL-581, which this task is blocked by. It writes the `Imported from Jira: <site>/browse/<KEY>` line this task reads, so this task cannot start before that shape exists.

What Jira already shows without branchling: with Atlassian's GitHub integration installed, a Jira key in a branch name, commit message or pull-request title puts the branch, commits and pull request on the ticket, and Jira Automation can transition the ticket when a pull request is merged. This task does NOT duplicate that, and it never transitions a ticket. It adds only what Jira cannot see: the verification contract and the record of the run that closed the task.

The pattern to follow is `pr-summary` (TL-89) and `examples/pr-summary.yml`: "every decision is in the command; this file is checkout, run, comment". The decisions belong in a command and not in YAML or shell:
- which tasks entered the closed status in a commit range;
- which of them carry a Jira marker;
- what the comment says.
A task without a marker is reported as skipped, with a count, rather than dropped silently. Whether this extends `pr-summary --json` or becomes a command of its own is for the implementer to settle. `show --json` already exposes the verification contract (TL-561), and the ledger records are readable as JSON (TL-562).

The CI job lives in `examples/jira-proof.yml`. It runs on push to `main` over the pushed range, reads the Jira site credentials from CI secrets (never from branchling), and posts each comment through the Jira REST API. The v3 comment endpoint takes an ADF body, so either the command emits ADF or the job wraps plain text: decide which, and record why. A re-run over the same range must not post a second comment for the same task, for example by a marker in the comment text that the job checks first, as `pr-summary.yml` does with its marker.

Not part of this task: transitioning tickets, syncing status or fields back, reading Jira comments into the backlog, and posting for tasks closed before the job was installed.

## Steps

1. Decide where the range-to-comments logic lives (an extension of `pr-summary --json` or a new command) and write it: tasks that entered the closed status in `<base>..HEAD`, their Jira browse URL from the marker line, their verification entries with what each proves, and the run record that closed them.
2. Report tasks without a Jira marker as skipped, with a count.
3. Write `examples/jira-proof.yml`: checkout with full history, run the command, post one comment per task through the Jira REST API with credentials from secrets, and skip a task whose ticket already carries the marker comment.
4. Document the job beside the import in `docs/guide.md` and, if a JSON kind changes or is added, in `docs/external-consumers.md`.
5. Add `scripts/tests/jira-proof.test.mjs` over a fixture repository: one Jira-linked task closed in the range (reported), one Jira-linked task moved to a non-closed status (not reported), one closed task without a marker (counted as skipped), and an empty range (a complete envelope with nothing to post).

## Acceptance criteria

- [ ] The command reports exactly the Jira-linked tasks that entered the closed status in the range, with their verification and run record, and counts the ones it skipped. [proof: jira-proof-tests]
- [ ] A copyable CI job posts the comments, with Jira credentials taken from CI secrets. [proof: example-job-exists]
